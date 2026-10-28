// Leaflet map: base tiles, stops (canvas), live vehicles (gliding div markers), journey/line overlays.
import { api, apiReady } from './api.js';
import { t, onLangChange } from './i18n.js';
import { esc, badge, routeColor, textOn, nameOf, fmtDelay, delayClass, modeName, MODE_COLOR, clock, toast } from './util.js';

const SOFIA = [42.6977, 23.3219];
const VEHICLE_MODES = ['Tram', 'Trolleybus', 'Bus'];

let map, renderer, stopLayer, overlay, vehLayer, pinLayer, selectedLayer, userMarker;
const stops = [];
const vehicles = new Map();
const clickHandlers = [];
const listeners = new Set();
const prefs = loadPrefs();
let routeFilter = null;
let lastVehicleData = null;
let stopZoomBand = -1;

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

    renderer = L.canvas({ padding: 0.4 });
    map.createPane('routes').style.zIndex = 420;
    map.createPane('stopsPane').style.zIndex = 430;
    stopLayer = L.layerGroup().addTo(map);
    overlay = L.layerGroup().addTo(map);
    selectedLayer = L.layerGroup().addTo(map);
    vehLayer = L.layerGroup().addTo(map);
    pinLayer = L.layerGroup().addTo(map);

    map.on('zoomend', () => { updateZoomClass(); renderStops(); });
    map.on('click', e => clickHandlers.at(-1)?.(e.latlng));
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
    onLangChange(() => { renderLayersMenu(); renderLegend(); renderStops(true); if (lastVehicleData) applyVehicles(lastVehicleData); });
}

function updateZoomClass() {
    map.getContainer().classList.toggle('zoom-far', map.getZoom() < 14);
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
        renderStops(true);
        if (lastVehicleData) applyVehicles(lastVehicleData);
    }));
}

function renderLegend() {
    document.getElementById('mapLegend').innerHTML =
        VEHICLE_MODES.concat('Metro').map(m => `<span><i style="background:${MODE_COLOR[m]}"></i>${esc(modeName(m))}</span>`).join('') +
        `<span><i style="background:#F59E0B"></i>${esc(t('legend.late3'))}</span><span><i style="background:#B91C1C"></i>${esc(t('legend.late10'))}</span>`;
}

// ---------- Stops ----------
export async function loadStops() {
    const data = await apiReady('stations', { params: { limit: 5000 } }, 60);
    stops.length = 0;
    stops.push(...data);
    renderStops(true);
    return stops;
}

export const allStops = () => stops;

function renderStops(force = false) {
    if (!map) return;
    const z = map.getZoom();
    const band = !prefs.stops || z < 14 ? 0 : z < 16 ? 1 : 2;
    if (!force && band === stopZoomBand) return;
    stopZoomBand = band;
    stopLayer.clearLayers();
    if (band === 0) return;
    for (const s of stops) {
        if (!s.modes.some(m => prefs.modes.has(m))) continue;
        const color = MODE_COLOR[s.mode] ?? MODE_COLOR.Unknown;
        const marker = L.circleMarker([s.lat, s.lon], {
            renderer, pane: 'stopsPane',
            radius: band === 1 ? 3.5 : 6,
            color, weight: band === 1 ? 1.5 : 2.5, fillColor: '#fff', fillOpacity: 1,
        });
        marker.bindTooltip(`${esc(nameOf(s))} <span style="color:#5B6472">#${esc(s.code)}</span>`, { direction: 'top', offset: [0, -6] });
        marker.on('click', e => { L.DomEvent.stop(e); location.hash = `#/stop/${encodeURIComponent(s.id)}`; });
        stopLayer.addLayer(marker);
    }
}

export function selectStop(stop) {
    selectedLayer.clearLayers();
    if (!stop) return;
    L.circleMarker([stop.lat, stop.lon], { radius: 11, color: '#2B3C8F', weight: 3, fillColor: '#fff', fillOpacity: .9, pane: 'stopsPane' }).addTo(selectedLayer);
    L.circleMarker([stop.lat, stop.lon], { radius: 4, color: '#2B3C8F', weight: 0, fillColor: '#2B3C8F', fillOpacity: 1, pane: 'stopsPane' }).addTo(selectedLayer);
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
    return `<div class="veh" aria-hidden="true" style="--c:${c};--tc:${textOn(c)};--b:${v.bearing ?? 0}deg">${esc(v.route)}`
        + (v.bearing != null ? '<i class="arrow"></i>' : '')
        + (late ? `<i class="late ${late}"></i>` : '') + '</div>';
}

function applyVehicles(data, instant = false) {
    const container = map.getContainer();
    if (instant) container.classList.add('no-glide');
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
    if (instant) requestAnimationFrame(() => container.classList.remove('no-glide'));
}

function vehiclePopup(v) {
    const route = { shortName: v.route, color: v.color, mode: v.mode };
    const occupancy = v.occupancy ? t(`occ.${v.occupancy}`) : null;
    return `<div class="popup-head">${badge(route)}<strong>${esc(nameOf(v, 'headsign'))}</strong></div>
        <dl class="popup-grid">
            <dt>${esc(t('veh.delay'))}</dt><dd><span class="delay ${delayClass(v.delaySec)}">${v.delaySec == null ? esc(t('veh.noData')) : esc(fmtDelay(v.delaySec))}</span></dd>
            ${v.nextStop ? `<dt>${esc(t('veh.next'))}</dt><dd>${esc(nameOf(v, 'nextStop'))}</dd>` : ''}
            ${v.speedKmh != null ? `<dt>${esc(t('veh.speed'))}</dt><dd>${v.speedKmh} ${esc(t('unit.kmh'))}</dd>` : ''}
            ${occupancy && !occupancy.startsWith('occ.') ? `<dt>${esc(t('veh.occupancy'))}</dt><dd>${esc(occupancy)}</dd>` : ''}
            <dt>${esc(t('veh.vehicle'))}</dt><dd>${esc(v.id)}${v.wheelchair ? ' ♿' : ''}</dd>
            <dt>${esc(t('veh.updated'))}</dt><dd>${esc(clock(v.timestamp * 1000))}</dd>
        </dl>
        <div class="popup-actions"><a class="btn btn-ghost btn-sm" href="#/lines/${encodeURIComponent(v.routeId)}">${esc(t('veh.showLine'))}</a></div>`;
}

// ---------- Overlays ----------
export function clearOverlay() { overlay.clearLayers(); map.getContainer().classList.remove('focus'); }

function line(points, color, weight, extra = {}) {
    return L.polyline(points, { color, weight, opacity: 1, lineJoin: 'round', lineCap: 'round', pane: 'routes', ...extra });
}

export function drawRoute(route, direction, onStopClick) {
    overlay.clearLayers();
    map.getContainer().classList.remove('focus');
    const color = routeColor(route);
    line(direction.shape, '#fff', 9).addTo(overlay);
    const poly = line(direction.shape, color, 5).addTo(overlay);
    direction.stops.forEach((s, i) => {
        const end = i === 0 || i === direction.stops.length - 1;
        const m = L.circleMarker([s.lat, s.lon], { pane: 'stopsPane', radius: end ? 7 : 5, color, weight: 3, fillColor: end ? color : '#fff', fillOpacity: 1 });
        m.bindTooltip(esc(nameOf(s)), { direction: 'top', offset: [0, -6] });
        m.on('click', e => { L.DomEvent.stop(e); onStopClick?.(s); });
        m.addTo(overlay);
    });
    fit(poly.getBounds());
}

export function drawJourney(journey) {
    overlay.clearLayers();
    map.getContainer().classList.add('focus');
    const bounds = L.latLngBounds([]);
    for (const leg of journey.legs) {
        const pts = leg.geometry?.length ? leg.geometry : [[leg.from.lat, leg.from.lon], [leg.to.lat, leg.to.lon]];
        pts.forEach(p => bounds.extend(p));
        if (leg.type === 'walk') {
            line(pts, '#4B5563', 4, { dashArray: '1 9' }).addTo(overlay);
        } else {
            const color = routeColor(leg.route);
            line(pts, '#fff', 10).addTo(overlay);
            line(pts, color, 6).addTo(overlay);
            (leg.stops || []).forEach((s, i, arr) => {
                const end = i === 0 || i === arr.length - 1;
                L.circleMarker([s.lat, s.lon], { pane: 'stopsPane', radius: end ? 6 : 3.5, color, weight: end ? 3 : 2, fillColor: '#fff', fillOpacity: 1 })
                    .bindTooltip(`${esc(nameOf(s))} · ${esc(clock(s.time))}`, { direction: 'top', offset: [0, -4] })
                    .addTo(overlay);
            });
        }
    }
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
