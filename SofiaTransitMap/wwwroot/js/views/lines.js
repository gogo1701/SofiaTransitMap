// Lines: index grouped by mode, and a line detail with directions, stops and live vehicles.
import { api } from '../api.js';
import { t } from '../i18n.js';
import * as M from '../map.js';
import { esc, badge, nameOf, ICON, MODES, MODE_COLOR, modeName, routeColor, textOn, skeleton, stateBlock, errorText, clock, fmtNum } from '../util.js';

let routesCache = null;
let modeFilter = null;

export async function renderLines(root, { signal }) {
    root.innerHTML = `
        <div class="section">
            <h1 style="font-size:1.2rem;margin-bottom:14px">${esc(t('lines.title'))}</h1>
            <div class="search">${ICON.search}<input class="input" id="lineSearch" type="search" autocomplete="off"
                placeholder="${esc(t('lines.searchPh'))}" aria-label="${esc(t('lines.searchPh'))}"></div>
            <div class="chips" role="group" aria-label="${esc(t('layers.modes'))}" style="margin-top:12px">
                <button type="button" class="chip" data-mode="">${esc(t('lines.all'))}</button>
                ${MODES.map(m => `<button type="button" class="chip" data-mode="${m}"><span class="swatch" style="background:${MODE_COLOR[m]}"></span>${esc(modeName(m, true))}</button>`).join('')}
            </div>
        </div>
        <div class="section" id="lineList">${skeleton(4)}</div>`;

    const list = root.querySelector('#lineList');
    const search = root.querySelector('#lineSearch');
    const chips = root.querySelectorAll('[data-mode]');

    const draw = () => {
        chips.forEach(c => c.setAttribute('aria-pressed', String((c.dataset.mode || null) === modeFilter)));
        const q = search.value.trim().toLowerCase();
        const routes = routesCache.filter(r => (!modeFilter || r.mode === modeFilter)
            && (!q || r.shortName.toLowerCase().includes(q) || (r.longName || '').toLowerCase().includes(q) || (r.longNameEn || '').toLowerCase().includes(q)));
        if (!routes.length) { list.innerHTML = stateBlock({ title: t('lines.none'), text: t('lines.noneText') }); return; }
        const groups = MODES.concat('Unknown').map(m => [m, routes.filter(r => r.mode === m)]).filter(([, rs]) => rs.length);
        list.innerHTML = groups.map(([m, rs]) => `
            <div class="line-group">
                <h3><span class="swatch" style="background:${MODE_COLOR[m]}"></span>${esc(modeName(m, true))}
                    <span class="muted">${rs.length} · ${fmtNum(rs.reduce((s, r) => s + r.liveVehicles, 0))} ${esc(t('lines.liveNow'))}</span></h3>
                <div class="line-grid">${rs.map(r => {
                    const c = routeColor(r);
                    return `<a class="badge" href="#/lines/${encodeURIComponent(r.id)}" style="--c:${c};--tc:${textOn(c)}"
                        title="${esc(nameOf(r, 'longName'))}">${esc(r.shortName)}</a>`;
                }).join('')}</div>
            </div>`).join('');
    };

    chips.forEach(c => c.addEventListener('click', () => { modeFilter = c.dataset.mode || null; draw(); }));
    search.addEventListener('input', draw);

    try {
        routesCache ??= await api('routes', { signal });
        if (signal.aborted) return;
        draw();
    } catch (err) {
        if (err.name !== 'AbortError') list.innerHTML = stateBlock({ title: t('error.title'), text: errorText(err), kind: 'error' });
    }
}

export function renderLine(root, { params, signal }) {
    const id = params.id;
    let data = null;
    let dir = 0;
    root.innerHTML = `<div class="section"><a class="back-link" href="#/lines">${ICON.back}${esc(t('lines.all'))}</a>${skeleton(6)}</div>`;

    const draw = () => {
        const { route, directions } = data;
        const d = directions[dir];
        const c = routeColor(route);
        const live = (M.vehicleData()?.vehicles || []).filter(v => v.routeId === route.id);
        const liveHere = new Map();
        live.filter(v => nameOf(v, 'headsign') === nameOf(d, 'headsign') || directions.length === 1)
            .forEach(v => { if (v.nextStop) liveHere.set(v.nextStop, (liveHere.get(v.nextStop) || 0) + 1); });
        const avgDelay = live.filter(v => v.delaySec != null);
        const avg = avgDelay.length ? avgDelay.reduce((s, v) => s + v.delaySec, 0) / avgDelay.length : null;

        root.innerHTML = `
            <div class="section">
                <a class="back-link" href="#/lines">${ICON.back}${esc(t('lines.all'))}</a>
                <div class="line-head" style="margin-top:10px">
                    ${badge(route, 'lg')}
                    <div><h2>${esc(modeName(route.mode))} ${esc(route.shortName)}</h2>
                    <div class="row-sub">${esc(nameOf(route, 'longName'))}</div></div>
                </div>
                ${directions.length > 1 ? `<div class="segmented dir-switch" role="group" aria-label="${esc(t('lines.direction'))}">
                    ${directions.map((x, i) => `<button type="button" data-dir="${i}" aria-pressed="${i === dir}">${esc(t('plan.towards'))} ${esc(nameOf(x, 'headsign'))}</button>`).join('')}
                </div>` : ''}
                <dl class="line-facts">
                    <div><dt>${esc(t('lines.tripsToday'))}</dt><dd>${fmtNum(d.tripsToday)}</dd></div>
                    <div><dt>${esc(t('lines.firstLast'))}</dt><dd>${d.firstDeparture ? `${esc(clock(d.firstDeparture))}–${esc(clock(d.lastDeparture))}` : '–'}</dd></div>
                    <div><dt>${esc(t(live.length && live.every(v => v.scheduled) ? 'lines.scheduledNow' : 'lines.liveNow'))}</dt><dd>${live.length}${avg != null ? ` <small class="delay ${avg >= 600 ? 'bad' : avg >= 180 ? 'warn' : 'ok'}" style="font-size:.75rem">ø ${fmtNum(avg / 60, 1)} ${esc(t('unit.min'))}</small>` : ''}</dd></div>
                </dl>
                <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
                    <a class="btn btn-ghost btn-sm" href="#/stats/${encodeURIComponent(route.id)}">${esc(t('lines.punctuality'))}</a>
                </div>
            </div>
            <div class="section-head" style="padding:14px 20px 0;margin:0"><h3>${esc(t('lines.stops'))} · ${d.stops.length}</h3></div>
            <ol class="stops-line" style="--c:${c}">
                ${d.stops.map(s => {
                    const n = liveHere.get(s.name);
                    return `<li><span class="stn"></span><button type="button" data-stop="${esc(s.id)}">
                        <span>${esc(nameOf(s))}</span>
                        ${n ? `<span class="veh-here">${n} ${esc(t('lines.approaching'))}</span>` : `<span class="muted num" style="font-size:.75rem">${esc(s.code)}</span>`}
                    </button></li>`;
                }).join('')}
            </ol>`;
        root.querySelectorAll('[data-dir]').forEach(b => b.addEventListener('click', () => { dir = Number(b.dataset.dir); draw(); M.drawRoute(route, directions[dir], goStop); }));
        root.querySelectorAll('[data-stop]').forEach(b => b.addEventListener('click', () => { location.hash = `#/stop/${encodeURIComponent(b.dataset.stop)}`; }));
    };
    const goStop = s => { location.hash = `#/stop/${encodeURIComponent(s.id)}`; };

    (async () => {
        try {
            data = await api(`routes/${encodeURIComponent(id)}`, { signal });
            if (signal.aborted) return;
            if (!data.directions.length) {
                root.innerHTML = `<div class="section"><a class="back-link" href="#/lines">${ICON.back}${esc(t('lines.all'))}</a></div>` + stateBlock({ title: t('lines.noService') });
                return;
            }
            M.setRouteFilter(data.route.id);
            M.drawRoute(data.route, data.directions[dir], goStop);
            draw();
        } catch (err) {
            if (err.name === 'AbortError') return;
            root.innerHTML = `<div class="section"><a class="back-link" href="#/lines">${ICON.back}${esc(t('lines.all'))}</a></div>`
                + stateBlock({ title: err.status === 404 ? t('lines.notFound') : t('error.title'), text: err.status === 404 ? '' : errorText(err), kind: err.status === 404 ? '' : 'error' });
        }
    })();

    const off = M.onVehicles(() => { if (data?.directions.length) draw(); });
    return () => {
        off();
        M.setRouteFilter(null);
        M.clearOverlay();
    };
}
