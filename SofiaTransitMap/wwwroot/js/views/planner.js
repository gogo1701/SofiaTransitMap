// Journey planner: address/stop/map-point to address, departing now, at, or arriving by a time.
import { api } from '../api.js';
import { t, lang } from '../i18n.js';
import * as M from '../map.js';
import { attachAutocomplete } from '../autocomplete.js';
import { esc, badge, nameOf, ICON, stateBlock, errorText, clock, duration, fmtDuration, fmtDelay, delayClass, fmtMeters, sofiaNowParts, dayLabel, routeColor, prettyName } from '../util.js';

const state = loadState();
let active = null; // live view handle while the planner tab is open

function loadState() {
    const now = sofiaNowParts();
    const base = { from: null, to: null, when: 'now', date: now.date, time: now.time, maxWalk: 900, result: null, selected: 0 };
    try {
        const saved = JSON.parse(sessionStorage.getItem('stm.plan') || 'null');
        return saved ? { ...base, from: saved.from, to: saved.to, maxWalk: saved.maxWalk ?? 900 } : base;
    } catch { return base; }
}
function persist() {
    sessionStorage.setItem('stm.plan', JSON.stringify({ from: state.from, to: state.to, maxWalk: state.maxWalk }));
}

export function setPlannerPlace(kind, place) {
    state[kind] = place;
    state.result = null;
    persist();
    active?.syncPlaces();
}

export function renderPlanner(root, { signal }) {
    root.innerHTML = `
        <div class="section">
            <h1 style="font-size:1.2rem;margin-bottom:14px">${esc(t('plan.title'))}</h1>
            <form class="planner-form" id="planForm" novalidate>
                <div class="od">
                    <span class="od-dot"><i></i></span>
                    <div class="search">${ICON.search}<input class="input" id="fromInput" type="text" autocomplete="off" spellcheck="false"
                        placeholder="${esc(t('plan.fromPh'))}" aria-label="${esc(t('plan.from'))}"></div>
                    <button type="button" class="icon-btn swap" id="swapBtn" title="${esc(t('plan.swap'))}" aria-label="${esc(t('plan.swap'))}">${ICON.swap}</button>
                    <span class="od-dot to"><i></i></span>
                    <div class="search">${ICON.search}<input class="input" id="toInput" type="text" autocomplete="off" spellcheck="false"
                        placeholder="${esc(t('plan.toPh'))}" aria-label="${esc(t('plan.to'))}"></div>
                    <span class="od-line" aria-hidden="true"></span>
                </div>
                <div class="od-actions">
                    <button type="button" class="link-btn" id="myLoc">${ICON.locate}${esc(t('plan.myLocation'))}</button>
                </div>
                <p class="pick-hint" id="pickHint">${esc(t('plan.mapHint'))}</p>
                <div class="when">
                    <div class="segmented" role="group" aria-label="${esc(t('plan.when'))}">
                        <button type="button" data-when="now">${esc(t('plan.now'))}</button>
                        <button type="button" data-when="depart">${esc(t('plan.departAt'))}</button>
                        <button type="button" data-when="arrive">${esc(t('plan.arriveBy'))}</button>
                    </div>
                    <div class="field" data-timed><label for="planDate">${esc(t('plan.date'))}</label><input class="input" id="planDate" type="date"></div>
                    <div class="field" data-timed><label for="planTime">${esc(t('plan.time'))}</label><input class="input" id="planTime" type="time" step="300"></div>
                </div>
                <div class="planner-opts">
                    <div class="field">
                        <label for="maxWalk">${esc(t('plan.maxWalk'))}</label>
                        <select class="select" id="maxWalk">
                            ${[400, 700, 900, 1300, 2000].map(m => `<option value="${m}">${esc(fmtMeters(m))}</option>`).join('')}
                        </select>
                    </div>
                    <button class="btn btn-primary" type="submit" id="planBtn" style="align-self:flex-end">${esc(t('plan.submit'))}</button>
                </div>
            </form>
        </div>
        <div id="planResults" aria-live="polite"></div>`;

    const form = root.querySelector('#planForm');
    const fromInput = root.querySelector('#fromInput');
    const toInput = root.querySelector('#toInput');
    const dateInput = root.querySelector('#planDate');
    const timeInput = root.querySelector('#planTime');
    const walkSelect = root.querySelector('#maxWalk');
    const results = root.querySelector('#planResults');
    const btn = root.querySelector('#planBtn');
    let controller;

    const syncWhen = () => {
        root.querySelectorAll('[data-when]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.when === state.when)));
        root.querySelectorAll('[data-timed]').forEach(f => { f.hidden = state.when === 'now'; });
    };
    const syncPlaces = () => {
        fromInput.value = state.from?.label ?? '';
        toInput.value = state.to?.label ?? '';
        M.setPin('from', state.from ? [state.from.lat, state.from.lon] : null);
        M.setPin('to', state.to ? [state.to.lat, state.to.lon] : null);
        root.querySelector('#pickHint').hidden = !!(state.from && state.to);
        if (state.from && state.to && !state.result) plan();
    };

    dateInput.value = state.date;
    timeInput.value = state.time;
    walkSelect.value = String(state.maxWalk);
    syncWhen();

    root.querySelectorAll('[data-when]').forEach(b => b.addEventListener('click', () => {
        state.when = b.dataset.when;
        if (state.when !== 'now' && !timeInput.value) { const n = sofiaNowParts(); dateInput.value = n.date; timeInput.value = n.time; }
        syncWhen();
        if (state.from && state.to) plan();
    }));
    dateInput.addEventListener('change', () => { state.date = dateInput.value; });
    timeInput.addEventListener('change', () => { state.time = timeInput.value; });
    walkSelect.addEventListener('change', () => { state.maxWalk = Number(walkSelect.value); persist(); if (state.from && state.to) plan(); });

    const hereItem = () => [{ label: t('plan.myLocation'), kind: 'here', lat: 0, lon: 0 }];
    const onPick = kind => async place => {
        if (place.kind === 'here') {
            try {
                const ll = await M.locate();
                place = { label: t('plan.myLocation'), kind: 'here', lat: ll.lat, lon: ll.lng };
            } catch { (kind === 'from' ? fromInput : toInput).value = ''; return; }
        }
        state[kind] = place;
        state.result = null;
        persist();
        syncPlaces();
    };
    attachAutocomplete(fromInput, { signal, onPick: onPick('from'), extraItems: hereItem });
    attachAutocomplete(toInput, { signal, onPick: onPick('to'), extraItems: hereItem });

    root.querySelector('#swapBtn').addEventListener('click', () => {
        [state.from, state.to] = [state.to, state.from];
        state.result = null;
        persist();
        syncPlaces();
    });
    root.querySelector('#myLoc').addEventListener('click', () => onPick('from')({ kind: 'here' }));

    // Map clicks fill the empty end first, then move the destination.
    const offClick = M.pushClickHandler(async latlng => {
        const kind = !state.from ? 'from' : 'to';
        const place = { label: t('plan.mapPoint'), kind: 'point', lat: latlng.lat, lon: latlng.lng };
        state[kind] = place;
        state.result = null;
        persist();
        syncPlaces();
        try {
            const named = await api('geocode/reverse', { params: { lat: latlng.lat.toFixed(6), lon: latlng.lng.toFixed(6), lang: lang() } });
            if (state[kind] === place) {
                place.label = named.label;
                place.detail = named.detail;
                (kind === 'from' ? fromInput : toInput).value = named.label;
                persist();
            }
        } catch { /* keep the generic label */ }
    });

    form.addEventListener('submit', e => { e.preventDefault(); plan(); });

    async function plan() {
        if (!state.from || !state.to) {
            results.innerHTML = stateBlock({ title: t('plan.needPlaces'), text: t('plan.mapHint') });
            (state.from ? toInput : fromInput).focus();
            return;
        }
        controller?.abort();
        controller = new AbortController();
        const n = sofiaNowParts();
        const params = {
            fromLat: state.from.lat.toFixed(6), fromLon: state.from.lon.toFixed(6), fromName: state.from.label,
            toLat: state.to.lat.toFixed(6), toLon: state.to.lon.toFixed(6), toName: state.to.label,
            date: state.when === 'now' ? n.date : dateInput.value || n.date,
            time: state.when === 'now' ? n.time : timeInput.value || n.time,
            arriveBy: state.when === 'arrive', maxWalk: state.maxWalk, count: 5,
        };
        btn.disabled = true;
        btn.textContent = t('plan.searching');
        results.innerHTML = `<div aria-busy="true">${'<div class="skeleton" style="height:88px;margin:12px 20px"></div>'.repeat(3)}</div>`;
        try {
            state.result = await api('plan', { params, signal: controller.signal });
            state.selected = 0;
            renderResults();
        } catch (err) {
            if (err.name === 'AbortError') return;
            results.innerHTML = stateBlock({ title: t('error.title'), text: errorText(err), kind: 'error' });
        } finally {
            btn.disabled = false;
            btn.textContent = t('plan.submit');
        }
    }

    function renderResults() {
        const r = state.result;
        if (!r) { results.innerHTML = ''; M.clearOverlay(); return; }
        if (!r.journeys.length) {
            M.clearOverlay();
            results.innerHTML = stateBlock({ title: t(`plan.msg.${r.message || 'no-connection'}`), text: t(`plan.msg.${r.message || 'no-connection'}.text`) });
            return;
        }
        const head = `<div class="refresh-note"><span>${esc(r.arriveBy ? t('plan.arriveByAt') : t('plan.departFrom'))} ${esc(clock(r.requestedTime))}, ${esc(dayLabel(r.requestedTime))}</span>
            <span>${r.journeys.length} ${esc(t('plan.options'))}</span></div>`;
        results.innerHTML = head + `<ul class="journeys">${r.journeys.map((j, i) => journeyItem(j, i)).join('')}</ul>`;
        results.querySelectorAll('.journey-btn').forEach(b => b.addEventListener('click', () => {
            const i = Number(b.dataset.i);
            state.selected = state.selected === i ? -1 : i;
            renderResults();
        }));
        results.querySelectorAll('.tl-toggle').forEach(b => b.addEventListener('click', () => {
            const list = b.nextElementSibling;
            list.hidden = !list.hidden;
            b.setAttribute('aria-expanded', String(!list.hidden));
        }));
        const sel = r.journeys[state.selected];
        if (sel) M.drawJourney(sel); else M.clearOverlay();
    }

    active = { syncPlaces };
    syncPlaces();
    if (state.result) renderResults();

    return () => {
        active = null;
        offClick();
        controller?.abort();
        M.clearOverlay();
        M.clearPins();
    };
}

function journeyItem(j, i) {
    const d = duration(j.durationSec);
    const legs = j.legs.map(l => l.type === 'walk'
        ? (l.durationSec >= 60 ? `<span class="walk-chip" title="${esc(t('plan.walk'))}">${ICON.walk}${Math.round(l.durationSec / 60)}</span>` : '')
        : badge(l.route)).filter(Boolean).join('<span class="sep" aria-hidden="true">›</span>');
    const rides = j.legs.filter(l => l.type !== 'walk');
    const late = rides.find(l => l.delaySec >= 120);
    const expanded = i === (state.selected ?? -1);
    return `<li class="journey" aria-expanded="${expanded}">
        <button type="button" class="journey-btn" data-i="${i}" aria-expanded="${expanded}">
            <div class="j-top">
                <span class="j-times">${esc(clock(j.departure))} – ${esc(clock(j.arrival))}</span>
                <span class="j-dur">${d.value} <small>${esc(d.unit)}</small></span>
            </div>
            <div class="j-legs">${legs}</div>
            <div class="j-meta">
                <span>${rides.length ? (j.transfers ? `${j.transfers} ${esc(t(j.transfers === 1 ? 'plan.transfer' : 'plan.transfers'))}` : esc(t('plan.direct'))) : esc(t('plan.walkOnly'))}</span>
                <span>${esc(t('plan.walking'))} ${esc(fmtMeters(j.walkMeters))}</span>
                ${late ? `<span class="delay ${delayClass(late.delaySec)}">${esc(late.route.shortName)}: ${esc(fmtDelay(late.delaySec))}</span>` : ''}
            </div>
        </button>
        ${expanded ? timeline(j) : ''}
    </li>`;
}

function timeline(j) {
    const rows = j.legs.map(l => {
        if (l.type === 'walk') {
            return `<li class="tl-leg walk">
                <span class="tl-time">${esc(clock(l.departure))}</span>
                <span class="tl-rail"><span class="node"></span></span>
                <div class="tl-body">
                    <div class="tl-place">${esc(placeName(l.from))}</div>
                    <div class="tl-detail"><span class="walk-chip">${ICON.walk}</span>${esc(t('plan.walk'))} ${esc(fmtDuration(l.durationSec))} · ${esc(fmtMeters(l.distanceM))}</div>
                </div>
            </li>`;
        }
        const c = routeColor(l.route);
        const inner = (l.stops || []).slice(1, -1);
        return `<li class="tl-leg" style="--c:${c}">
            <span class="tl-time">${esc(clock(l.departure))}</span>
            <span class="tl-rail"><span class="node"></span></span>
            <div class="tl-body">
                <div class="tl-place">${esc(placeName(l.from))}</div>
                <div class="tl-detail">${badge(l.route)}<span>${esc(t('plan.towards'))} ${esc(nameOf(l, 'headsign'))}</span></div>
                <div class="row-sub" style="margin-top:4px">${esc(fmtDuration(l.durationSec))}${l.delaySec != null ? ` · <span class="delay ${delayClass(l.delaySec)}">${esc(t('plan.now'))}: ${esc(fmtDelay(l.delaySec))}</span>` : ''}${l.wheelchair ? ` · ${ICON.wheelchair}` : ''}</div>
                ${inner.length ? `<button type="button" class="tl-toggle" aria-expanded="false">${inner.length} ${esc(t(inner.length === 1 ? 'plan.stop' : 'plan.stops'))}</button>
                <ol class="tl-stops" hidden>${inner.map(s => `<li><span>${esc(nameOf(s))}</span><span class="num">${esc(clock(s.time))}</span></li>`).join('')}</ol>` : ''}
                <div class="row-sub" style="margin-top:6px">${esc(t('plan.getOff'))} <strong style="color:var(--ink)">${esc(placeName(l.to))}</strong> · ${esc(clock(l.arrival))}</div>
            </div>
        </li>`;
    }).join('');
    const last = j.legs.at(-1);
    return `<ol class="timeline">${rows}
        <li class="tl-end"><span class="tl-time">${esc(clock(j.arrival))}</span>
            <span class="tl-rail" style="--c:var(--bus)"><span class="node" style="margin:0;border-radius:2px"></span></span>
            <div class="tl-place">${esc(placeName(last.to))}</div></li>
    </ol>`;
}

const placeName = p => prettyName(lang() === 'en' ? (p.nameEn || p.name) : p.name);
