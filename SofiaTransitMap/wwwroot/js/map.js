// Leaflet map: base tiles, stops and route overlays (frame-synced canvas), live vehicles (gliding div markers).
import { api, apiReady } from './api.js';
import { t, onLangChange } from './i18n.js';
import { esc, badge, routeColor, textOn, nameOf, fmtDelay, delayClass, modeName, MODE_COLOR, clock, toast } from './util.js';
import { createCanvasLayer } from './canvas-layer.js';

const SOFIA = [42.6977, 23.3219];
const VEHICLE_MODES = ['Tram', 'Trolleybus', 'Bus'];

let map, stopsCv, overlayCv, selectedCv, vehLayer, pinLayer, userMarker, hoverTip;
const stops = [];
const vehicles = new Map();
const clickHandlers = [];
const listeners = new Set();
const prefs = loadPrefs();
let routeFilter = null;
let lastVehicleData = null;
let zooming = false;
let vehiclesPending = false;
let glideTimer;

function loadPrefs() {
    try {
        const p = JSON.parse(localStorage.getItem('stm.layers') || '{}');
        return { stops: p.stops ?? true, vehicles: p.vehicles ?? true, modes: new Set(p.modes ?? ['Metro', ...VEHICLE_MODES]) };
    } catch { return { stops: true, vehicles: true, modes: new Set(['Metro', ...VEHICLE_MODES]) }; }
}
function savePrefs() {
    localStorage.setItem('stm.layers', JSON.stringify({ stops: prefs.stops, vehicles: prefs.vehicles, modes: [...prefs.modes] }));
}

export const getMap = () => map;

export function initMap() {
    map = L.map('map', { zoomControl: false, minZoom: 10, maxZoom: 19 }).setView(SOFIA, 13);
    map.setMaxBounds([[42.35, 22.85], [43.05, 23.8]]);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · GTFS &copy; <a href="https://www.sofiatraffic.bg">ЦГМ</a>',
        maxZoom: 19, className: 'base-tiles',
    }).addTo(map);

    stopsCv = createCanvasLayer(map, 'stopsPane', 430, { zoomStyle: stopZoomStyle });
    overlayCv = createCanvasLayer(map, 'routePane', 440);
    selectedCv = createCanvasLayer(map, 'selectedPane', 445);
    vehLayer = L.layerGroup().addTo(map);
    pinLayer = L.layerGroup().addTo(map);
    hoverTip = L.tooltip({ direction: 'top', opacity: 1 });

    map.on('zoomstart', () => {
        zooming = true;
        stopVehicleGlide();
    });
    map.on('zoomanim', e => updateZoomClass(e.zoom));
    map.on('zoom', () => { if (!map._animatingZoom) updateZoomClass(); });
    map.on('zoomend', () => {
        zooming = false;
        updateZoomClass();
        if (vehiclesPending && lastVehicleData) { vehiclesPending = false; applyVehicles(lastVehicleData); }
    });
    map.on('mousemove', e => showHover(hitPoint(e.containerPoint)));
    map.on('mouseout zoomstart movestart', () => showHover(null));
    map.on('click', e => {
        const hit = hitPoint(e.containerPoint);
        if (hit?.point.onClick) hit.point.onClick();
        else clickHandlers.at(-1)?.(e.latlng);
    });
    updateZoomClass();

    document.getElementById('locateBtn').addEventListener('click', () => locate().catch(() => {}));
    const layersBtn = document.getElementById('layersBtn');
    const menu = document.getElementById('layersMenu');
    layersBtn.addEventListener('click', () => {
        const open = menu.hidden;
        menu.hidden = !open;
        layersBtn.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && !menu.hidden) { menu.hidden = true; layersBtn.setAttribute('aria-expanded', 'false'); layersBtn.focus(); }
    });
    renderLayersMenu();
    renderLegend();
    onLangChange(() => { renderLayersMenu(); renderLegend(); renderStops(); if (lastVehicleData) applyVehicles(lastVehicleData); });
}

function updateZoomClass(zoom = map.getZoom()) {
    map.getContainer().classList.toggle('zoom-far', zoom < 14);
}

// Stops fade in around zoom 14 and grow continuously, so zooming never pops them in or resizes them in steps.
function stopZoomStyle(z) {
    if (z < 13.4) return null;
    const grow = Math.min(1, Math.max(0, (z - 14) / 2));
    return { alpha: Math.min(1, (z - 13.4) / 0.6), scale: 0.55 + 0.45 * grow };
}

function hitPoint(cp) {
    return overlayCv.hit(cp) || stopsCv.hit(cp);
}

function showHover(hit) {
    map.getContainer().style.cursor = hit?.point.onClick ? 'pointer' : '';
    if (!hit) { if (map.hasLayer(hoverTip)) hoverTip.remove(); return; }
    hoverTip.options.offset = [0, -Math.round(hit.radius + 2)];
    hoverTip.setLatLng([hit.point.lat, hit.point.lon]).setContent(hit.point.tip);
    if (!map.hasLayer(hoverTip)) hoverTip.addTo(map);
}

// ---------- Layers menu & legend ----------
function renderLayersMenu() {
    const menu = document.getElementById('layersMenu');
    menu.innerHTML = `
        <h4>${esc(t('layers.show'))}</h4>
        <label class="check"><input type="checkbox" data-layer="vehicles" ${prefs.vehicles ? 'checked' : ''}> ${esc(t('layers.vehicles'))}</label>
        <label class="check"><input type="checkbox" data-layer="stops" ${prefs.stops ? 'checked' : ''}> ${esc(t('layers.stops'))}</label>
        <h4>${esc(t('layers.modes'))}</h4>
        ${['Metro', ...VEHICLE_MODES].map(m => `<label class="check"><input type="checkbox" data-mode="${m}" ${prefs.modes.has(m) ? 'checked' : ''}>
            <span class="swatch" style="background:${MODE_COLOR[m]}"></span>${esc(modeName(m, true))}</label>`).join('')}`;
    menu.querySelectorAll('input').forEach(input => input.addEventListener('change', () => {
        if (input.dataset.layer) prefs[input.dataset.layer] = input.checked;
        if (input.dataset.mode) input.checked ? prefs.modes.add(input.dataset.mode) : prefs.modes.delete(input.dataset.mode);
        savePrefs();
        renderStops();
        if (lastVehicleData) applyVehicles(lastVehicleData);
    }));
}

function renderLegend() {
    document.getElementById('mapLegend').innerHTML =
        VEHICLE_MODES.concat('Metro').map(m => `<span><i style="background:${MODE_COLOR[m]}"></i>${esc(modeName(m))}</span>`).join('') +
        `<span><i style="background:#F59E0B"></i>${esc(t('legend.late3'))}</span><span><i style="background:#B91C1C"></i>${esc(t('legend.late10'))}</span>` +
        `<span><i class="sched"></i>${esc(t('legend.scheduled'))}</span>`;
}

// ---------- Stops ----------
export async function loadStops() {
    const data = await apiReady('stations', { params: { limit: 5000 } }, 60);
    stops.length = 0;
    stops.push(...data);
    renderStops();
    return stops;
}

export const allStops = () => stops;

function renderStops() {
    if (!map) return;
    const points = !prefs.stops ? [] : stops.filter(s => s.modes.some(m => prefs.modes.has(m))).map(s => ({
        lat: s.lat, lon: s.lon, r: 6, w: 2.5,
        color: MODE_COLOR[s.mode] ?? MODE_COLOR.Unknown, fill: '#fff',
        interactive: true,
        tip: `${esc(nameOf(s))} <span style="color:#5B6472">#${esc(s.code)}</span>`,
        onClick: () => { location.hash = `#/stop/${encodeURIComponent(s.id)}`; },
    }));
    stopsCv.set({ points });
}

export function selectStop(stop) {
    if (!stop) { selectedCv.set(); return; }
    selectedCv.set({ points: [
        { lat: stop.lat, lon: stop.lon, r: 11, w: 3, color: '#2B3C8F', fill: '#fff', fillAlpha: .9 },
        { lat: stop.lat, lon: stop.lon, r: 4, w: 0, fill: '#2B3C8F' },
    ] });
    const target = L.latLng(stop.lat, stop.lon);
    if (!map.getBounds().pad(-0.15).contains(target) || map.getZoom() < 15) map.flyTo(target, Math.max(map.getZoom(), 16), { duration: .6 });
}

// ---------- Vehicles ----------
export function onVehicles(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export async function refreshVehicles() {
    const data = await api('live/vehicles');
    lastVehicleData = data;
    applyVehicles(data);
    listeners.forEach(fn => fn(data));
    return data;
}

export const vehicleData = () => lastVehicleData;

export function setRouteFilter(routeId) {
    routeFilter = routeId;
    if (lastVehicleData) applyVehicles(lastVehicleData, true);
}

function vehicleHtml(v) {
    const c = routeColor({ color: v.color, mode: v.mode });
    const late = v.delaySec >= 600 ? 'bad' : v.delaySec >= 180 ? 'warn' : '';
    return `<div class="veh${v.scheduled ? ' sched' : ''}" aria-hidden="true" style="--c:${c};--tc:${textOn(c)};--b:${v.bearing ?? 0}deg">${esc(v.route)}`
        + (v.bearing != null ? '<i class="arrow"></i>' : '')
        + (late ? `<i class="late ${late}"></i>` : '') + '</div>';
}

function stopVehicleGlide() {
    clearTimeout(glideTimer);
    map.getContainer().classList.remove('vehicle-glide');
}

function applyVehicles(data, instant = false) {
    // Moving markers mid-zoom fights Leaflet's zoom transition; the latest data is applied when the zoom settles.
    if (zooming) { vehiclesPending = true; return; }
    const container = map.getContainer();
    stopVehicleGlide();
    if (!instant) {
        container.classList.add('vehicle-glide');
        glideTimer = setTimeout(stopVehicleGlide, 1600);
    }
    const seen = new Set();
    for (const v of data.vehicles) {
        const visible = prefs.vehicles && prefs.modes.has(v.mode) && (!routeFilter || v.routeId === routeFilter);
        if (!visible) continue;
        seen.add(v.id);
        const html = vehicleHtml(v);
        let entry = vehicles.get(v.id);
        if (!entry) {
            const marker = L.marker([v.lat, v.lon], {
                icon: L.divIcon({ className: 'veh-icon', html, iconSize: [0, 0] }),
                keyboard: false, riseOnHover: true,
                title: `${modeName(v.mode)} ${v.route}`,
            });
            entry = { marker, html, v };
            marker.bindPopup(() => vehiclePopup(entry.v), { offset: [0, -8], maxWidth: 280 });
            marker.addTo(vehLayer);
            vehicles.set(v.id, entry);
        } else {
            entry.marker.setLatLng([v.lat, v.lon]);
            if (entry.html !== html) { entry.marker.setIcon(L.divIcon({ className: 'veh-icon', html, iconSize: [0, 0] })); entry.html = html; }
            if (entry.marker.isPopupOpen()) entry.marker.setPopupContent(vehiclePopup(v));
        }
        entry.v = v;
    }
    for (const [id, entry] of vehicles) {
        if (!seen.has(id)) { vehLayer.removeLayer(entry.marker); vehicles.delete(id); }
    }
}

function vehiclePopup(v) {
    const route = { shortName: v.route, color: v.color, mode: v.mode };
    const occupancy = v.occupancy ? t(`occ.${v.occupancy}`) : null;
    return `<div class="popup-head">${badge(route)}<strong>${esc(nameOf(v, 'headsign'))}</strong></div>
        <dl class="popup-grid">
            ${v.scheduled
                ? `<dt>${esc(t('veh.position'))}</dt><dd>${esc(t('veh.scheduled'))}</dd>`
                : `<dt>${esc(t('veh.delay'))}</dt><dd><span class="delay ${delayClass(v.delaySec)}">${v.delaySec == null ? esc(t('veh.noData')) : esc(fmtDelay(v.delaySec))}</span></dd>`}
            ${v.nextStop ? `<dt>${esc(t('veh.next'))}</dt><dd>${esc(nameOf(v, 'nextStop'))}</dd>` : ''}
            ${v.speedKmh != null ? `<dt>${esc(t('veh.speed'))}</dt><dd>${v.speedKmh} ${esc(t('unit.kmh'))}</dd>` : ''}
            ${occupancy && !occupancy.startsWith('occ.') ? `<dt>${esc(t('veh.occupancy'))}</dt><dd>${esc(occupancy)}</dd>` : ''}
            ${v.scheduled ? '' : `<dt>${esc(t('veh.vehicle'))}</dt><dd>${esc(v.id)}${v.wheelchair ? ' ♿' : ''}</dd>
            <dt>${esc(t('veh.updated'))}</dt><dd>${esc(clock(v.timestamp * 1000))}</dd>`}
        </dl>
        ${v.scheduled ? `<p class="popup-note">${esc(t('veh.scheduledNote'))}</p>` : ''}
        <div class="popup-actions"><a class="btn btn-ghost btn-sm" href="#/lines/${encodeURIComponent(v.routeId)}">${esc(t('veh.showLine'))}</a></div>`;
}

// ---------- Overlays ----------
export function clearOverlay() { overlayCv.set(); map.getContainer().classList.remove('focus'); }

export function drawRoute(route, direction, onStopClick) {
    map.getContainer().classList.remove('focus');
    const color = routeColor(route);
    const points = direction.stops.map((s, i) => {
        const end = i === 0 || i === direction.stops.length - 1;
        return {
            lat: s.lat, lon: s.lon, r: end ? 7 : 5, w: 3, color, fill: end ? color : '#fff',
            interactive: true, tip: esc(nameOf(s)), onClick: () => onStopClick?.(s),
        };
    });
    overlayCv.set({ lines: [{ pts: direction.shape, color: '#fff', w: 9 }, { pts: direction.shape, color, w: 5 }], points });
    if (direction.shape.length) fit(L.latLngBounds(direction.shape));
}

export function drawJourney(journey) {
    map.getContainer().classList.add('focus');
    const bounds = L.latLngBounds([]);
    const lines = [];
    const points = [];
    for (const leg of journey.legs) {
        const pts = leg.geometry?.length ? leg.geometry : [[leg.from.lat, leg.from.lon], [leg.to.lat, leg.to.lon]];
        pts.forEach(p => bounds.extend(p));
        if (leg.type === 'walk') {
            lines.push({ pts, color: '#4B5563', w: 4, dash: [1, 9] });
        } else {
            const color = routeColor(leg.route);
            lines.push({ pts, color: '#fff', w: 10 }, { pts, color, w: 6 });
            (leg.stops || []).forEach((s, i, arr) => {
                const end = i === 0 || i === arr.length - 1;
                points.push({
                    lat: s.lat, lon: s.lon, r: end ? 6 : 3.5, w: end ? 3 : 2, color, fill: '#fff',
                    interactive: true, tip: `${esc(nameOf(s))} · ${esc(clock(s.time))}`,
                });
            });
        }
    }
    overlayCv.set({ lines, points });
    if (bounds.isValid()) fit(bounds);
}

export function fit(bounds) {
    const mobile = window.matchMedia('(max-width: 860px)').matches;
    map.fitBounds(bounds, {
        paddingTopLeft: [40, 40],
        paddingBottomRight: mobile ? [40, Math.round(window.innerHeight * 0.46) + 20] : [60, 40],
        maxZoom: 17,
    });
}

// ---------- Pins & clicks ----------
const pins = {};
export function setPin(kind, latlng) {
    if (pins[kind]) { pinLayer.removeLayer(pins[kind]); delete pins[kind]; }
    if (!latlng) return;
    pins[kind] = L.marker(latlng, {
        icon: L.divIcon({ className: '', html: `<div class="place-pin ${kind}"><b>${kind === 'from' ? 'A' : 'B'}</b></div>`, iconSize: [0, 0] }),
        keyboard: false, zIndexOffset: 1000,
    }).addTo(pinLayer);
}
export function clearPins() { pinLayer.clearLayers(); Object.keys(pins).forEach(k => delete pins[k]); }

export function pushClickHandler(fn) {
    clickHandlers.push(fn);
    return () => { const i = clickHandlers.lastIndexOf(fn); if (i >= 0) clickHandlers.splice(i, 1); };
}

export function locate() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) { reject(new Error('unsupported')); return; }
        navigator.geolocation.getCurrentPosition(pos => {
            const ll = L.latLng(pos.coords.latitude, pos.coords.longitude);
            if (userMarker) userMarker.setLatLng(ll);
            else userMarker = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="user-dot"></div>', iconSize: [0, 0] }), keyboard: false }).addTo(map);
            map.flyTo(ll, 16, { duration: .8 });
            resolve(ll);
        }, err => {
            toast(t('error.locate'));
            reject(err);
        }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
    });
}

export function invalidate() { map?.invalidateSize(); }
