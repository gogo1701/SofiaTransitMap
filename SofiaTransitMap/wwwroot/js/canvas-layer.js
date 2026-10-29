// Canvas layer for stops, route lines and route stops.
// Leaflet's own canvas/SVG renderers stretch their bitmap during a zoom animation and redraw only when it ends,
// so dots balloon and snap back. This layer redraws every frame at constant pixel size instead. During animated
// zooms it reads the progress of the same CSS transition the tiles use, so drawings stay pinned to the map.

const TAU = Math.PI * 2;
const PROGRESS_PX = 1000;

export function createCanvasLayer(map, paneName, zIndex, { zoomStyle } = {}) {
    const pane = map.getPane(paneName) || map.createPane(paneName);
    pane.style.zIndex = zIndex;
    pane.style.pointerEvents = 'none';
    const canvas = L.DomUtil.create('canvas', 'cv-layer', pane);
    const proxy = L.DomUtil.create('div', 'leaflet-zoom-animated cv-proxy', pane);
    const ctx = canvas.getContext('2d');
    const crs = map.options.crs;
    const base = crs.scale(0);

    let lines = [];
    let points = [];
    let groups = [];
    let sx = new Float32Array(0), sy = new Float32Array(0), sr = new Float32Array(0);
    let width = 0, height = 0, dpr = 1;
    let view = null;
    let anim = null;
    let frame = 0;

    const project = (lat, lon) => crs.latLngToPoint(L.latLng(lat, lon), 0);

    function currentView() {
        const tl = map.containerPointToLayerPoint([0, 0]);
        const o = map.getPixelOrigin();
        return { k: crs.scale(map.getZoom()) / base, x: o.x + tl.x, y: o.y + tl.y };
    }

    function resize() {
        const size = map.getSize();
        dpr = window.devicePixelRatio || 1;
        width = size.x; height = size.y;
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
    }

    function draw(v) {
        view = v;
        L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);
        const { k, x: ox, y: oy } = v;

        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        for (const l of lines) {
            const p = l.p;
            ctx.beginPath();
            ctx.moveTo(p[0] * k - ox, p[1] * k - oy);
            for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i] * k - ox, p[i + 1] * k - oy);
            ctx.setLineDash(l.dash || []);
            ctx.globalAlpha = l.opacity ?? 1;
            ctx.strokeStyle = l.color;
            ctx.lineWidth = l.w;
            ctx.stroke();
        }
        ctx.setLineDash([]);

        sx.fill(NaN);
        const style = zoomStyle ? zoomStyle(Math.log2(k)) : { alpha: 1, scale: 1 };
        if (style && style.alpha > 0) {
            for (const g of groups) {
                const r = g.r * style.scale;
                const w = g.w * style.scale;
                const pad = r + w;
                ctx.beginPath();
                for (const i of g.idx) {
                    const pt = points[i];
                    const x = pt.p.x * k - ox;
                    const y = pt.p.y * k - oy;
                    sx[i] = x; sy[i] = y; sr[i] = r + w / 2;
                    if (x < -pad || y < -pad || x > width + pad || y > height + pad) continue;
                    ctx.moveTo(x + r, y);
                    ctx.arc(x, y, r, 0, TAU);
                }
                if (g.fill) { ctx.globalAlpha = style.alpha * g.fillAlpha; ctx.fillStyle = g.fill; ctx.fill(); }
                if (g.w > 0 && g.color) { ctx.globalAlpha = style.alpha; ctx.strokeStyle = g.color; ctx.lineWidth = w; ctx.stroke(); }
            }
        }
        ctx.globalAlpha = 1;
    }

    function redraw() {
        if (!anim && map._loaded) draw(currentView());
    }

    function progress() {
        const t = getComputedStyle(proxy).transform;
        if (!t || t === 'none') return 0;
        return Math.min(1, Math.max(0, new DOMMatrixReadOnly(t).m41 / PROGRESS_PX));
    }

    function tick() {
        if (!anim) return;
        const e = progress();
        const s = 1 + (anim.s - 1) * e;
        draw({ k: anim.from.k * s, x: s * anim.from.x - e * anim.tx, y: s * anim.from.y - e * anim.ty });
        frame = requestAnimationFrame(tick);
    }

    function endAnim() {
        if (!anim) return;
        anim = null;
        cancelAnimationFrame(frame);
        proxy.style.transform = '';
    }

    map.on('zoomanim', e => {
        endAnim();
        const from = view || currentView();
        const k1 = crs.scale(e.zoom) / base;
        const o = map._getNewPixelOrigin(e.center, e.zoom);
        const pp = map._getMapPanePos();
        const to = { x: o.x - pp.x, y: o.y - pp.y };
        const s = k1 / from.k;
        anim = { from, s, tx: s * from.x - to.x, ty: s * from.y - to.y };
        proxy.style.transform = 'translate3d(0,0,0)';
        void proxy.offsetWidth;
        proxy.style.transform = `translate3d(${PROGRESS_PX}px,0,0)`;
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(tick);
    });
    map.on('move zoom viewreset', () => {
        if (map._animatingZoom) return;
        endAnim();
        redraw();
    });
    map.on('zoomend', () => { endAnim(); redraw(); });
    map.on('resize', () => { resize(); redraw(); });
    resize();

    return {
        set({ lines: ls = [], points: ps = [] } = {}) {
            lines = ls.map(l => {
                const p = new Float64Array(l.pts.length * 2);
                l.pts.forEach((ll, i) => { const q = project(ll[0], ll[1]); p[i * 2] = q.x; p[i * 2 + 1] = q.y; });
                return { ...l, p };
            });
            points = ps.map(pt => ({ ...pt, p: project(pt.lat, pt.lon) }));
            const byKey = new Map();
            points.forEach((pt, i) => {
                const key = `${pt.color}|${pt.fill}|${pt.fillAlpha ?? 1}|${pt.r}|${pt.w ?? 0}`;
                let g = byKey.get(key);
                if (!g) byKey.set(key, g = { color: pt.color, fill: pt.fill, fillAlpha: pt.fillAlpha ?? 1, r: pt.r, w: pt.w ?? 0, idx: [] });
                g.idx.push(i);
            });
            groups = [...byKey.values()];
            sx = new Float32Array(points.length);
            sy = new Float32Array(points.length);
            sr = new Float32Array(points.length);
            if (anim) tick(); else redraw();
        },
        /** Nearest interactive point under a container point, or null. */
        hit(cp, slop = 4) {
            let best = null;
            let bestD = Infinity;
            for (let i = 0; i < points.length; i++) {
                if (!points[i].interactive || Number.isNaN(sx[i])) continue;
                const dx = sx[i] - cp.x, dy = sy[i] - cp.y;
                const d = dx * dx + dy * dy;
                const lim = sr[i] + slop;
                if (d <= lim * lim && d < bestD) { bestD = d; best = { point: points[i], radius: sr[i] }; }
            }
            return best;
        },
    };
}
