// Map tab: search, stops in view, network pulse. Stop view: live departures board.
import { apiReady } from '../api.js';
import { t } from '../i18n.js';
import * as M from '../map.js';
import { esc, badge, nameOf, ICON, skeleton, stateBlock, errorText, debounce, clock, minutesUntil, fmtDelay, delayClass, fmtPct, fmtMin, modeName, MODE_COLOR } from '../util.js';
import { attachAutocomplete } from '../autocomplete.js';
import { setPlannerPlace } from './planner.js';

const dist = (a, b) => {
    const dLat = (a.lat - b.lat) * 111320, dLon = (a.lon - b.lon) * 111320 * Math.cos(a.lat * Math.PI / 180);
    return Math.hypot(dLat, dLon);
};

export function renderHome(root, { signal }) {
    root.innerHTML = `
        <div class="section">
            <h1 class="sr-only">${esc(t('home.title'))}</h1>
            <div class="search">
                ${ICON.search}
                <input class="input" id="homeSearch" type="search" autocomplete="off" spellcheck="false"
                    placeholder="${esc(t('home.searchPh'))}" aria-label="${esc(t('home.searchPh'))}">
            </div>
            <div class="od-actions" style="margin:10px 0 0">
                <button type="button" class="link-btn" id="nearMe">${ICON.locate}${esc(t('home.nearMe'))}</button>
                <a class="link-btn" href="#/plan">${ICON.pin}${esc(t('home.plan'))}</a>
            </div>
        </div>
        <div class="section" id="pulse"><div class="skeleton" style="height:64px"></div></div>
        <div>
            <div class="section-head" style="padding:16px 20px 0;margin:0">
                <h2 style="font-size:1rem">${esc(t('home.inView'))}</h2>
            </div>
            <ul class="list" id="nearList" style="margin-top:8px">${skeleton(4)}</ul>
        </div>`;

    const input = root.querySelector('#homeSearch');
    attachAutocomplete(input, {
        signal,
        onPick(place) {
            if (place.kind === 'stop' && place.stopId) location.hash = `#/stop/${encodeURIComponent(place.stopId)}`;
            else {
                M.getMap().flyTo([place.lat, place.lon], 16, { duration: .7 });
                M.setPin('to', [place.lat, place.lon]);
                renderAddressCard(root, place);
            }
        },
    });

    root.querySelector('#nearMe').addEventListener('click', () => M.locate().catch(() => {}));

    const listEl = root.querySelector('#nearList');
    const renderNear = () => {
        const all = M.allStops();
        if (!all.length) return;
        const c = M.getMap().getCenter();
        const center = { lat: c.lat, lon: c.lng };
        const near = all.map(s => ({ s, d: dist(s, center) })).sort((a, b) => a.d - b.d).slice(0, 10);
        listEl.innerHTML = near.map(({ s, d }) => `
            <li><a class="row-btn" href="#/stop/${encodeURIComponent(s.id)}" style="text-decoration:none">
                <span style="width:12px;height:12px;border-radius:50%;flex-shrink:0;border:3px solid ${MODE_COLOR[s.mode]}"></span>
                <span class="row-main"><span class="row-title" style="display:block">${esc(nameOf(s))}</span>
                <span class="row-sub">#${esc(s.code)} · ${s.modes.map(m => esc(modeName(m))).join(', ')}</span></span>
                <span class="row-sub num">${d < 1000 ? Math.round(d / 10) * 10 + ' ' + esc(t('unit.m')) : (d / 1000).toFixed(1) + ' ' + esc(t('unit.km'))}</span>
            </a></li>`).join('');
    };
    const onMove = debounce(renderNear, 250);
    M.getMap().on('moveend', onMove);
    if (M.allStops().length) renderNear();
    else M.loadStops().then(renderNear).catch(err => {
        listEl.innerHTML = stateBlock({ title: t('error.title'), text: errorText(err), kind: 'error' });
    });

    const pulse = root.querySelector('#pulse');
    const renderPulse = data => {
        const tracked = data.vehicles.filter(v => v.delaySec != null);
        const delayed = tracked.filter(v => v.delaySec >= 180).length;
        const avg = tracked.length ? tracked.reduce((s, v) => s + Math.max(0, v.delaySec), 0) / tracked.length : null;
        pulse.innerHTML = `
            <div class="section-head" style="margin-bottom:8px"><h2 style="font-size:1rem">${esc(t('home.pulse'))}</h2>
                <a class="link-btn" href="#/stats">${esc(t('home.toStats'))}</a></div>
            <dl class="line-facts" style="margin:0">
                <div><dt>${esc(t('home.onRoute'))}</dt><dd>${data.vehicles.filter(v => !v.scheduled).length}</dd></div>
                <div><dt>${esc(t('home.delayedShare'))}</dt><dd>${fmtPct(tracked.length ? delayed / tracked.length : null)}</dd></div>
                <div><dt>${esc(t('home.avgDelay'))}</dt><dd>${fmtMin(avg)} <small class="muted">${esc(t('unit.min'))}</small></dd></div>
            </dl>`;
    };
    if (M.vehicleData()) renderPulse(M.vehicleData());
    const off = M.onVehicles(renderPulse);

    return () => { M.getMap().off('moveend', onMove); off(); };
}

function renderAddressCard(root, place) {
    let card = root.querySelector('#addrCard');
    if (!card) {
        card = document.createElement('div');
        card.className = 'section';
        card.id = 'addrCard';
        root.querySelector('.section').after(card);
    }
    card.innerHTML = `
        <div class="row-title">${esc(place.label)}</div>
        ${place.detail ? `<div class="row-sub">${esc(place.detail)}</div>` : ''}
        <div class="popup-actions">
            <button type="button" class="btn btn-primary btn-sm" data-plan="to">${esc(t('stop.planTo'))}</button>
            <button type="button" class="btn btn-ghost btn-sm" data-plan="from">${esc(t('stop.planFrom'))}</button>
        </div>`;
    card.querySelectorAll('[data-plan]').forEach(btn => btn.addEventListener('click', () => {
        setPlannerPlace(btn.dataset.plan, place);
        location.hash = '#/plan';
    }));
}

export function renderStop(root, { params, signal }) {
    const id = params.id;
    root.innerHTML = `<div class="section">${skeleton(2)}</div>${skeleton(6)}`;

    const load = async first => {
        try {
            const [info, deps] = await Promise.all([
                first ? apiReady(`stations/${encodeURIComponent(id)}`, { signal }) : Promise.resolve(null),
                apiReady(`stations/${encodeURIComponent(id)}/departures`, { signal, params: { minutes: 120, limit: 40 } }),
            ]);
            if (signal.aborted) return;
            if (info) renderHeader(root, info);
            renderDepartures(root, deps);
        } catch (err) {
            if (err.name === 'AbortError') return;
            if (first) {
                root.innerHTML = `<div class="section"><a class="back-link" href="#/map">${ICON.back}${esc(t('nav.back'))}</a></div>`
                    + stateBlock({ title: err.status === 404 ? t('stop.notFound') : t('error.title'), text: errorText(err), kind: 'error' });
            }
        }
    };

    load(true);
    const timer = setInterval(() => load(false), 30000);
    return () => { clearInterval(timer); M.selectStop(null); };
}

function renderHeader(root, info) {
    const s = info.stop;
    M.selectStop(s);
    root.innerHTML = `
        <div class="section">
            <a class="back-link" href="#/map">${ICON.back}${esc(t('nav.back'))}</a>
            <div class="stop-title">
                <div style="flex:1;min-width:0">
                    <h1 style="font-size:1.25rem">${esc(nameOf(s))}</h1>
                    <div class="row-sub" style="margin-top:4px">${s.modes.map(m => esc(modeName(m))).join(' · ')}</div>
                </div>
                <span class="stop-code" title="${esc(t('stop.code'))}">#${esc(s.code)}</span>
            </div>
            <div class="stop-lines">${info.routes.map(r => `<a href="#/lines/${encodeURIComponent(r.id)}" style="text-decoration:none">${badge(r, 'sm')}</a>`).join('')}</div>
            <div class="popup-actions">
                <button type="button" class="btn btn-ghost btn-sm" data-plan="from">${esc(t('stop.planFrom'))}</button>
                <button type="button" class="btn btn-ghost btn-sm" data-plan="to">${esc(t('stop.planTo'))}</button>
            </div>
        </div>
        ${info.entrances?.length ? `<details class="section exits">
            <summary><span class="exit-sign" aria-hidden="true">M</span>${esc(t('stop.exits'))} <span class="muted">${info.entrances.length}</span></summary>
            <ul class="exit-list">${info.entrances.map((e, i) => `<li><button type="button" class="exit-row" data-exit="${i}">${esc(nameOf(e))}</button></li>`).join('')}</ul>
        </details>` : ''}
        <div class="refresh-note"><span>${esc(t('stop.departures'))}</span><span id="depUpdated"></span></div>
        <ul class="departures" id="depList"></ul>`;
    root.querySelectorAll('[data-exit]').forEach(btn => btn.addEventListener('click', () => {
        const e = info.entrances[Number(btn.dataset.exit)];
        M.focusEntrance(e);
    }));
    root.querySelectorAll('[data-plan]').forEach(btn => btn.addEventListener('click', () => {
        setPlannerPlace(btn.dataset.plan, { label: nameOf(s), detail: `#${s.code}`, lat: s.lat, lon: s.lon, kind: 'stop', stopId: s.id });
        location.hash = '#/plan';
    }));
}

function renderDepartures(root, data) {
    const list = root.querySelector('#depList');
    if (!list) return;
    root.querySelector('#depUpdated').textContent = `${t('stop.updated')} ${clock(data.generatedAt)}`;
    if (!data.departures.length) {
        list.innerHTML = stateBlock({ title: t('stop.noDepartures'), text: t('stop.noDeparturesText') });
        return;
    }
    list.innerHTML = data.departures.map(d => {
        const when = d.predicted || d.scheduled;
        const mins = minutesUntil(when);
        const big = mins <= 0 ? `<span class="dep-min">${esc(t('stop.now'))}</span>`
            : mins < 60 ? `<span class="dep-min">${mins}<small>${esc(t('unit.min'))}</small></span>`
            : `<span class="dep-min">${esc(clock(when))}</span>`;
        const shifted = d.predicted && Math.abs(new Date(d.predicted) - new Date(d.scheduled)) >= 60000;
        return `<li class="dep">
            <a href="#/lines/${encodeURIComponent(d.route.id)}" style="text-decoration:none">${badge(d.route)}</a>
            <div class="dep-head">
                <div class="row-title">${esc(nameOf(d, 'headsign'))}</div>
                <div class="row-sub">${d.live ? `<span class="live-tag">${esc(t('stop.live'))}</span>` : esc(t('stop.scheduled'))}${d.live && d.delaySec != null ? ` · <span class="delay ${delayClass(d.delaySec)}">${esc(fmtDelay(d.delaySec))}</span>` : ''}${d.wheelchair ? ` · <span title="${esc(t('stop.wheelchair'))}">${ICON.wheelchair}</span>` : ''}</div>
            </div>
            <div class="dep-when">${big}<div class="dep-clock">${shifted ? `<s>${esc(clock(d.scheduled))}</s>` : ''}${esc(clock(when))}</div></div>
        </li>`;
    }).join('');
}
