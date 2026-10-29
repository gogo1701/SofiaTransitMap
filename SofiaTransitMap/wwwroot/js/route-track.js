// Route lines for live-vehicle prediction: snap a reported position onto its trip's shape and walk along it.
import { api } from './api.js';

const M_PER_DEG = 111_320;
const KX = M_PER_DEG * Math.cos(42.7 * Math.PI / 180); // metres per degree of longitude around Sofia
const MAX_SNAP_M = 60;

const shapes = new Map(); // shapeId -> shape | null (failed) | Promise (loading)

export function shapeFor(id) {
    const s = shapes.get(id);
    return s && !(s instanceof Promise) ? s : null;
}

export function requestShape(id) {
    if (!id || shapes.has(id)) return;
    shapes.set(id, api(`live/shapes/${encodeURIComponent(id)}`)
        .then(pts => shapes.set(id, build(pts)))
        .catch(() => shapes.set(id, null)));
}

function build(pts) {
    if (!Array.isArray(pts) || pts.length < 2) return null;
    const x = pts.map(p => p[1] * KX), y = pts.map(p => p[0] * M_PER_DEG);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1]));
    return { x, y, cum, length: cum.at(-1) };
}

const heading = (dx, dy) => (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
const angleDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

/** Distance along the shape nearest to the position, preferring segments that run in the vehicle's direction. */
export function project(shape, lat, lon, bearing) {
    const px = lon * KX, py = lat * M_PER_DEG;
    let best = null;
    for (let i = 0; i < shape.x.length - 1; i++) {
        const ax = shape.x[i], ay = shape.y[i], dx = shape.x[i + 1] - ax, dy = shape.y[i + 1] - ay;
        const len2 = dx * dx + dy * dy;
        if (!len2) continue;
        if (bearing != null && angleDiff(heading(dx, dy), bearing) > 90) continue;
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
        const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
        if (!best || d < best.d) best = { d, s: shape.cum[i] + t * Math.sqrt(len2) };
    }
    return best && best.d <= MAX_SNAP_M ? best.s : null;
}

/** Point and heading at a distance along the shape. */
export function pointAt(shape, s) {
    const { x, y, cum } = shape;
    s = Math.max(0, Math.min(s, shape.length));
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] <= s) lo = mid; else hi = mid;
    }
    const seg = cum[hi] - cum[lo] || 1;
    const t = (s - cum[lo]) / seg;
    const px = x[lo] + (x[hi] - x[lo]) * t, py = y[lo] + (y[hi] - y[lo]) * t;
    return { lat: py / M_PER_DEG, lon: px / KX, bearing: heading(x[hi] - x[lo], y[hi] - y[lo]) };
}
