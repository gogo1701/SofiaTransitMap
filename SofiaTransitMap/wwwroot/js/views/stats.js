// Punctuality statistics: live network state plus history aggregated from the SQLite snapshots.
import { api } from '../api.js';
import { t, lang } from '../i18n.js';
import { theme } from '../theme.js';
import { esc, badge, MODES, MODE_COLOR, modeName, routeColor, stateBlock, errorText, clock, dateTime, shortDate, fmtNum, fmtPct, fmtMin, toast } from '../util.js';

const RANGES = [
    { key: '6h', hours: 6 },
    { key: '24h', hours: 24 },
    { key: '7d', hours: 24 * 7 },
    { key: '30d', hours: 24 * 30 },
];
let rangeKey = '24h';
let tableMode = null;
let sortKey = 'avgDelaySec';
let sortDir = -1;

const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function renderStats(root, { params, signal }) {
    const charts = new Map();
    let selectedLine = params.id ? decodeURIComponent(params.id) : null;
    let lines = [];
    let liveTimer;
    let historyController;

    if (!window.Chart) {
        root.innerHTML = `<div class="stats">${stateBlock({ title: t('error.title'), text: t('stats.noCharts'), kind: 'error' })}</div>`;
        return;
    }
    const C = window.Chart;
    C.defaults.font.family = "'Sofia Sans', system-ui, sans-serif";
    C.defaults.font.size = 12;
    C.defaults.color = css('--muted') || '#5B6472';
    C.defaults.borderColor = css('--line') || '#E5E7EB';
    C.defaults.plugins.legend.labels.boxWidth = 10;
    C.defaults.plugins.legend.labels.boxHeight = 10;
    C.defaults.plugins.tooltip.backgroundColor = theme() === 'dark' ? '#2A3245' : '#111827';
    C.defaults.plugins.tooltip.padding = 10;
    C.defaults.plugins.tooltip.cornerRadius = 4;
    C.defaults.animation = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 300 };

    const NAVY = css('--accent') || '#2B3C8F';
    const NAVY_SOFT = theme() === 'dark' ? '#6F7BB5' : '#8C95C2';
    const WARN = css('--warn') || '#B45309';
    const BAD = css('--bad') || '#B91C1C';
    const OK = css('--ok') || '#15803D';

    root.innerHTML = `
        <div class="stats">
            <header class="stats-head">
                <div>
                    <h1>${esc(t('stats.title'))}</h1>
                    <p>${esc(t('stats.intro'))}</p>
                </div>
                <div class="stats-toolbar">
                    <span class="field-label" id="rangeLabel">${esc(t('stats.range'))}</span>
                    <div class="segmented" role="group" aria-labelledby="rangeLabel">
                        ${RANGES.map(r => `<button type="button" data-range="${r.key}">${esc(t(`stats.range.${r.key}`))}</button>`).join('')}
                    </div>
                </div>
            </header>

            <section aria-labelledby="nowTitle">
                <h2 class="visually-hidden" id="nowTitle">${esc(t('stats.now'))}</h2>
                <div class="now-strip" id="nowStrip">${'<div><div class="skeleton" style="height:58px"></div></div>'.repeat(6)}</div>
            </section>

            <div class="grid-2">
                <article class="card">
                    <div class="card-head"><div><h3>${esc(t('stats.trend'))}</h3><p id="trendNote">${esc(t('stats.trendNote'))}</p></div></div>
                    <div class="chart-box"><canvas id="cTrend" role="img" aria-label="${esc(t('stats.trend'))}"></canvas></div>
                </article>
                <article class="card">
                    <div class="card-head"><div><h3>${esc(t('stats.distribution'))}</h3><p>${esc(t('stats.distributionNote'))}</p></div></div>
                    <div class="chart-box"><canvas id="cHist" role="img" aria-label="${esc(t('stats.distribution'))}"></canvas></div>
                </article>
            </div>

            <div class="strip-title"><h2>${esc(t('stats.period'))}</h2><span id="periodNote"></span></div>
            <div class="now-strip plain" id="periodStrip">${'<div><div class="skeleton" style="height:58px"></div></div>'.repeat(4)}</div>

            <div class="grid-2 even">
                <article class="card">
                    <div class="card-head"><div><h3>${esc(t('stats.byHour'))}</h3><p>${esc(t('stats.byHourNote'))}</p></div></div>
                    <div class="chart-box"><canvas id="cHourly" role="img" aria-label="${esc(t('stats.byHour'))}"></canvas></div>
                </article>
                <article class="card">
                    <div class="card-head"><div><h3>${esc(t('stats.byMode'))}</h3><p>${esc(t('stats.byModeNote'))}</p></div></div>
                    <div class="mode-bars" id="modeBars"></div>
                </article>
            </div>

            <div class="grid-2">
                <article class="card">
                    <div class="card-head"><div><h3>${esc(t('stats.worstLines'))}</h3><p>${esc(t('stats.worstLinesNote'))}</p></div></div>
                    <div class="chart-box tall"><canvas id="cLines" role="img" aria-label="${esc(t('stats.worstLines'))}"></canvas></div>
                </article>
                <article class="card">
                    <div class="card-head"><div><h3>${esc(t('stats.byWeekday'))}</h3><p>${esc(t('stats.byWeekdayNote'))}</p></div></div>
                    <div class="chart-box tall"><canvas id="cWeekday" role="img" aria-label="${esc(t('stats.byWeekday'))}"></canvas></div>
                </article>
            </div>

            <article class="card" style="margin-top:16px" id="lineTableCard">
                <div class="card-head">
                    <div><h3>${esc(t('stats.allLines'))}</h3><p>${esc(t('stats.allLinesNote'))}</p></div>
                    <div class="chips" role="group" aria-label="${esc(t('layers.modes'))}">
                        <button type="button" class="chip" data-tmode="">${esc(t('lines.all'))}</button>
                        ${MODES.map(m => `<button type="button" class="chip" data-tmode="${m}"><span class="swatch" style="background:${MODE_COLOR[m]}"></span>${esc(modeName(m, true))}</button>`).join('')}
                    </div>
                </div>
                <div id="lineDetail"></div>
                <div class="table-wrap" id="lineTable"></div>
            </article>

            <p class="source-note">${esc(t('stats.source'))}</p>
        </div>`;

    const $ = sel => root.querySelector(sel);

    const chart = (id, config) => {
        charts.get(id)?.destroy();
        const canvas = $(`#${id}`);
        canvas.parentElement.querySelector('.chart-empty')?.remove();
        const c = new C(canvas, config);
        charts.set(id, c);
        return c;
    };
    const emptyChart = (id, text) => {
        charts.get(id)?.destroy();
        charts.delete(id);
        const box = $(`#${id}`).parentElement;
        box.querySelector('.chart-empty')?.remove();
        box.insertAdjacentHTML('beforeend', `<div class="chart-empty">${esc(text)}</div>`);
    };
    const minAxis = { beginAtZero: true, title: { display: true, text: t('unit.min') }, ticks: { precision: 0 } };
    const timeLabel = (iso, hours) => hours <= 24 ? clock(iso) : `${shortDate(iso)} ${clock(iso)}`;
    const delayColor = sec => sec >= 600 ? BAD : sec >= 180 ? WARN : OK;

    // ---------- Live ----------
    async function loadLive() {
        try {
            const live = await api('stats/live', { signal });
            const n = live.network;
            const delayedMin = Math.round(live.thresholds.delayed / 60);
            const severeMin = Math.round(live.thresholds.severe / 60);
            $('#nowStrip').innerHTML = `
                <div><div class="label">${esc(t('stats.onRoute'))}</div><div class="value">${fmtNum(n.vehicles)}</div>
                    <div class="sub">${live.fetchedAt ? `${esc(t('stats.asOf'))} ${esc(clock(live.fetchedAt))}` : esc(t('veh.noData'))}${live.fresh ? '' : ` · ${esc(t('stats.stale'))}`}</div></div>
                <div><div class="label">${esc(t('stats.delayedNow', { min: delayedMin }))}</div><div class="value">${fmtNum(n.delayed)}</div>
                    <div class="sub">${esc(fmtPct(n.tracked ? n.delayed / n.tracked : null))} ${esc(t('stats.ofTracked'))}</div></div>
                <div><div class="label">${esc(t('stats.avgDelay'))}</div><div class="value">${esc(fmtMin(n.avgDelaySec))}<small>${esc(t('unit.min'))}</small></div>
                    <div class="sub">${esc(t('stats.median'))} ${esc(fmtMin(n.medianDelaySec))} ${esc(t('unit.min'))}</div></div>
                <div><div class="label">${esc(t('stats.p90'))}</div><div class="value">${esc(fmtMin(n.p90DelaySec))}<small>${esc(t('unit.min'))}</small></div>
                    <div class="sub">${esc(t('stats.max'))} ${esc(fmtMin(n.maxDelaySec))} ${esc(t('unit.min'))}</div></div>
                <div><div class="label">${esc(t('stats.severe', { min: severeMin }))}</div><div class="value">${fmtNum(n.severe)}</div>
                    <div class="sub">${fmtNum(n.early)} ${esc(t('stats.early'))}</div></div>
                <div><div class="label">${esc(t('stats.alerts'))}</div><div class="value">${fmtNum(live.activeAlerts)}</div>
                    <div class="sub"><a href="#/alerts">${esc(t('stats.seeAlerts'))}</a></div></div>`;

            const edges = live.histogramEdgesMin;
            const labels = n.histogram.map((_, i) => i === 0 ? `< ${edges[0]}`
                : i === n.histogram.length - 1 ? `≥ ${edges[i - 1]}` : `${edges[i - 1]}–${edges[i]}`);
            if (!n.tracked) emptyChart('cHist', t('stats.noLive'));
            else chart('cHist', {
                type: 'bar',
                data: {
                    labels,
                    datasets: [{
                        label: t('stats.vehicles'), data: n.histogram, borderRadius: 3,
                        backgroundColor: n.histogram.map((_, i) => {
                            const lo = i === 0 ? -99 : edges[i - 1];
                            return lo >= 10 ? BAD : lo >= 3 ? WARN : i === 0 ? NAVY : OK;
                        }),
                    }],
                },
                options: {
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false }, tooltip: { callbacks: { title: items => `${items[0].label} ${t('unit.min')}` } } },
                    scales: { x: { grid: { display: false }, title: { display: true, text: t('stats.delayMin') } }, y: { beginAtZero: true, ticks: { precision: 0 } } },
                },
            });
        } catch (err) {
            if (err.name === 'AbortError') return;
            $('#nowStrip').innerHTML = `<div style="grid-column:1/-1">${stateBlock({ title: t('error.title'), text: errorText(err), kind: 'error' })}</div>`;
        }
    }

    // ---------- History ----------
    async function loadHistory() {
        historyController?.abort();
        historyController = new AbortController();
        const historySignal = historyController.signal;
        const range = RANGES.find(r => r.key === rangeKey);
        const hours = range.hours;
        const days = Math.max(1, Math.ceil(hours / 24));
        root.querySelectorAll('[data-range]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.range === rangeKey)));

        // Mode and line views share one database aggregation instead of scanning
        // the route snapshots separately, and do not hold the network charts hostage.
        api('stats/mode-lines', { params: { hours }, signal: historySignal })
            .then(({ modes, lines: rows }) => {
                if (historySignal.aborted) return;
                lines = rows;
                renderModes(modes);
                renderLines();
                if (selectedLine) loadLineDetail(selectedLine, historySignal);
            })
            .catch(err => {
                if (err.name !== 'AbortError' && !historySignal.aborted) {
                    $('#modeBars').innerHTML = stateBlock({ title: t('error.title'), text: errorText(err), kind: 'error' });
                    emptyChart('cLines', errorText(err));
                    $('#lineTable').innerHTML = stateBlock({ title: t('error.title'), text: errorText(err), kind: 'error' });
                }
            });

        try {
            const [summary, series, hourly, weekday] = await Promise.all([
                api('stats/summary', { params: { hours }, signal: historySignal }),
                api('stats/timeseries', { params: { hours }, signal: historySignal }),
                api('stats/hourly', { params: { days }, signal: historySignal }),
                api('stats/weekday', { params: { days: Math.max(7, days) }, signal: historySignal }),
            ]);
            if (historySignal.aborted) return;
            const thin = summary.samples < 2;
            const collecting = t('stats.collecting');

            $('#periodNote').textContent = summary.samples
                ? t('stats.samples', { n: fmtNum(summary.samples), from: dateTime(summary.from), to: dateTime(summary.to) })
                : collecting;
            $('#periodStrip').innerHTML = summary.samples ? `
                <div><div class="label">${esc(t('stats.avgDelay'))}</div><div class="value">${esc(fmtMin(summary.avgDelaySec))}<small>${esc(t('unit.min'))}</small></div>
                    <div class="sub">${esc(t('stats.p90'))} ø ${esc(fmtMin(summary.avgP90Sec))} ${esc(t('unit.min'))}</div></div>
                <div><div class="label">${esc(t('stats.avgDelayed'))}</div><div class="value">${fmtNum(summary.avgDelayed)}</div>
                    <div class="sub">${esc(t('stats.ofAvg', { n: fmtNum(summary.avgVehicles) }))}</div></div>
                <div><div class="label">${esc(t('stats.onTimeShare'))}</div><div class="value">${esc(fmtPct(summary.onTimeShare))}</div>
                    <div class="sub">${esc(fmtPct(summary.delayedShare))} ${esc(t('stats.delayedShort'))} · ${esc(fmtPct(summary.severeShare, 1))} ${esc(t('stats.severeShort'))}</div></div>
                <div><div class="label">${esc(t('stats.peak'))}</div><div class="value">${fmtNum(summary.peakDelayed)}</div>
                    <div class="sub">${esc(dateTime(summary.peakAt))} · ${esc(t('stats.max'))} ${esc(fmtMin(summary.maxDelaySec))} ${esc(t('unit.min'))}</div></div>`
                : `<div style="grid-column:1/-1">${stateBlock({ title: collecting, text: t('stats.collectingText') })}</div>`;

            // Trend: average delay line over delayed-vehicle bars.
            if (thin) emptyChart('cTrend', collecting);
            else chart('cTrend', {
                data: {
                    labels: series.points.map(p => timeLabel(p.t, hours)),
                    datasets: [
                        { type: 'line', label: t('stats.avgDelayMin'), data: series.points.map(p => +(p.avgDelaySec / 60).toFixed(2)), borderColor: NAVY, backgroundColor: NAVY, borderWidth: 2, pointRadius: 0, tension: .25, yAxisID: 'y' },
                        { type: 'line', label: t('stats.p90Min'), data: series.points.map(p => +(p.p90DelaySec / 60).toFixed(2)), borderColor: NAVY_SOFT, borderDash: [4, 4], borderWidth: 1.5, pointRadius: 0, tension: .25, yAxisID: 'y' },
                        { type: 'bar', label: t('stats.delayedVehicles'), data: series.points.map(p => p.delayed), backgroundColor: WARN + '47', yAxisID: 'y1', barPercentage: 1, categoryPercentage: 1 },
                    ],
                },
                options: {
                    maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
                    plugins: { legend: { position: 'bottom' } },
                    scales: {
                        x: { grid: { display: false }, ticks: { maxTicksLimit: 8, maxRotation: 0 } },
                        y: { ...minAxis, position: 'left' },
                        y1: { beginAtZero: true, position: 'right', grid: { display: false }, title: { display: true, text: t('stats.vehicles') }, ticks: { precision: 0 } },
                    },
                },
            });

            // Hour-of-day profile.
            const hrs = hourly.hours;
            if (!hrs.some(h => h.samples)) emptyChart('cHourly', collecting);
            else chart('cHourly', {
                data: {
                    labels: hrs.map(h => `${String(h.hour).padStart(2, '0')}:00`),
                    datasets: [
                        { type: 'bar', label: t('stats.avgDelayMin'), data: hrs.map(h => h.samples ? +(h.avgDelaySec / 60).toFixed(2) : null), backgroundColor: hrs.map(h => delayColor(h.avgDelaySec)), borderRadius: 3, yAxisID: 'y' },
                        { type: 'line', label: t('stats.delayedShare'), data: hrs.map(h => h.samples ? +(h.delayedShare * 100).toFixed(1) : null), borderColor: NAVY, backgroundColor: NAVY, pointRadius: 2, borderWidth: 2, spanGaps: true, yAxisID: 'y1' },
                    ],
                },
                options: {
                    maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
                    plugins: { legend: { position: 'bottom' } },
                    scales: {
                        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 8 } },
                        y: minAxis,
                        y1: { beginAtZero: true, max: 100, position: 'right', grid: { display: false }, ticks: { callback: v => `${v}%` } },
                    },
                },
            });

            // Weekday profile.
            const wdFmt = new Intl.DateTimeFormat(lang() === 'en' ? 'en-GB' : 'bg-BG', { weekday: 'short' });
            if (!weekday.length) emptyChart('cWeekday', collecting);
            else chart('cWeekday', {
                type: 'bar',
                data: {
                    labels: weekday.map(d => wdFmt.format(new Date(2024, 0, 7 + d.day))),
                    datasets: [{ label: t('stats.avgDelayMin'), data: weekday.map(d => +(d.avgDelaySec / 60).toFixed(2)), backgroundColor: weekday.map(d => delayColor(d.avgDelaySec)), borderRadius: 3 }],
                },
                options: {
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false }, tooltip: { callbacks: { afterLabel: i => `${t('stats.avgDelayed')}: ${fmtNum(weekday[i.dataIndex].delayed)}` } } },
                    scales: { x: { grid: { display: false } }, y: minAxis },
                },
            });

        } catch (err) {
            if (err.name === 'AbortError' || historySignal.aborted) return;
            toast(errorText(err));
        }
    }

    function renderModes(modes) {
        const maxMode = Math.max(60, ...modes.map(m => m.avgDelaySec));
        $('#modeBars').innerHTML = modes.length ? modes.map(m => `
            <div class="mode-bar">
                <span class="name"><i style="background:${MODE_COLOR[m.mode] || MODE_COLOR.Unknown}"></i>${esc(modeName(m.mode, true))}</span>
                <span class="track"><span class="fill" style="display:block;width:${Math.max(2, (m.avgDelaySec / maxMode) * 100).toFixed(1)}%;background:${MODE_COLOR[m.mode] || MODE_COLOR.Unknown}"></span></span>
                <span class="val">${esc(fmtMin(m.avgDelaySec))} ${esc(t('unit.min'))}</span>
                <span class="detail">${esc(t('stats.modeDetail', { veh: fmtNum(m.avgVehicles), delayed: fmtNum(m.avgDelayed), share: fmtPct(m.delayedShare) }))}</span>
            </div>`).join('') : stateBlock({ title: t('stats.collecting') });
    }

    function renderLines() {
        const top = lines.filter(l => l.tracked >= 3).slice(0, 15);
        if (!top.length) emptyChart('cLines', t('stats.collecting'));
        else chart('cLines', {
            type: 'bar',
            data: {
                labels: top.map(l => `${modeName(l.mode)} ${l.shortName}`),
                datasets: [{ label: t('stats.avgDelayMin'), data: top.map(l => +(l.avgDelaySec / 60).toFixed(2)), backgroundColor: top.map(l => routeColor(l)), borderRadius: 3 }],
            },
            options: {
                indexAxis: 'y', maintainAspectRatio: false,
                onClick: (_, els) => { if (els[0]) selectLine(top[els[0].index].routeId, true); },
                onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : ''; },
                plugins: { legend: { display: false }, tooltip: { callbacks: { afterLabel: i => `${t('stats.delayedShare')}: ${fmtPct(top[i.dataIndex].delayedShare)}` } } },
                scales: { x: minAxis, y: { grid: { display: false }, ticks: { autoSkip: false } } },
            },
        });
        drawTable();
    }

    // ---------- Lines table ----------
    const COLS = [
        { key: 'shortName', label: 'stats.col.line' },
        { key: 'mode', label: 'stats.col.mode' },
        { key: 'avgDelaySec', label: 'stats.col.avgDelay', num: true },
        { key: 'delayedShare', label: 'stats.col.delayedShare', num: true },
        { key: 'maxDelaySec', label: 'stats.col.maxDelay', num: true },
        { key: 'avgVehicles', label: 'stats.col.vehicles', num: true },
    ];
    function drawTable() {
        root.querySelectorAll('[data-tmode]').forEach(c => c.setAttribute('aria-pressed', String((c.dataset.tmode || null) === tableMode)));
        const rows = lines.filter(l => !tableMode || l.mode === tableMode).slice().sort((a, b) => {
            const x = a[sortKey], y = b[sortKey];
            if (sortKey === 'shortName') return sortDir * x.localeCompare(y, 'bg', { numeric: true });
            if (sortKey === 'mode') return sortDir * (MODES.indexOf(x) - MODES.indexOf(y));
            return sortDir * (x - y);
        });
        if (!rows.length) { $('#lineTable').innerHTML = stateBlock({ title: t('stats.collecting'), text: t('stats.collectingText') }); return; }
        $('#lineTable').innerHTML = `<table class="data-table">
            <thead><tr>${COLS.map(c => `<th scope="col" class="${c.num ? 'num-col' : ''}" ${c.key === sortKey ? `aria-sort="${sortDir > 0 ? 'ascending' : 'descending'}"` : ''}>
                <button type="button" data-sort="${c.key}">${esc(t(c.label))}${c.key === sortKey ? (sortDir > 0 ? ' ↑' : ' ↓') : ''}</button></th>`).join('')}</tr></thead>
            <tbody>${rows.map(l => `<tr data-line="${esc(l.routeId)}" tabindex="0" aria-selected="${l.routeId === selectedLine}">
                <td>${badge(l, 'sm')}</td>
                <td>${esc(modeName(l.mode))}</td>
                <td class="num-col"><span class="delay ${l.avgDelaySec >= 600 ? 'bad' : l.avgDelaySec >= 180 ? 'warn' : ''}" style="font-size:inherit">${esc(fmtMin(l.avgDelaySec))}</span></td>
                <td class="num-col">${esc(fmtPct(l.delayedShare))}<span class="share-bar" aria-hidden="true"><i style="width:${(l.delayedShare * 100).toFixed(0)}%"></i></span></td>
                <td class="num-col">${esc(fmtMin(l.maxDelaySec))}</td>
                <td class="num-col">${fmtNum(l.avgVehicles, 1)}</td>
            </tr>`).join('')}</tbody></table>`;
    }

    async function loadLineDetail(routeId, requestSignal = signal) {
        const box = $('#lineDetail');
        const hours = RANGES.find(r => r.key === rangeKey).hours;
        box.innerHTML = '<div class="skeleton" style="height:200px;margin-bottom:16px"></div>';
        try {
            const d = await api(`stats/lines/${encodeURIComponent(routeId)}`, { params: { hours }, signal: requestSignal });
            if (selectedLine !== routeId) return;
            const route = d.route || { shortName: routeId, mode: 'Unknown' };
            box.innerHTML = `<div class="line-detail card" style="margin:0 0 16px;background:var(--surface)">
                <div class="card-head">
                    <div class="line-head">${badge(route, 'lg')}<div><h3>${esc(modeName(route.mode))} ${esc(route.shortName)}</h3>
                        <p>${esc(t('stats.lineSummary', { avg: fmtMin(d.avgDelaySec), share: fmtPct(d.delayedShare), max: fmtMin(d.maxDelaySec) }))}</p></div></div>
                    <div style="display:flex;gap:8px"><a class="btn btn-ghost btn-sm" href="#/lines/${encodeURIComponent(routeId)}">${esc(t('stats.onMap'))}</a>
                    <button type="button" class="btn btn-ghost btn-sm" id="closeLine">${esc(t('stats.close'))}</button></div>
                </div>
                <div class="grid-2" style="margin:0"><div class="chart-box"><canvas id="cLine" role="img" aria-label="${esc(t('stats.trend'))}"></canvas></div>
                <div class="chart-box"><canvas id="cLineHourly" role="img" aria-label="${esc(t('stats.byHour'))}"></canvas></div></div>
            </div>`;
            $('#closeLine').addEventListener('click', () => selectLine(null));
            const color = routeColor(route);
            if (d.samples < 2) { emptyChart('cLine', t('stats.collecting')); emptyChart('cLineHourly', t('stats.collecting')); return; }
            chart('cLine', {
                data: {
                    labels: d.points.map(p => timeLabel(p.t, hours)),
                    datasets: [
                        { type: 'line', label: t('stats.avgDelayMin'), data: d.points.map(p => +(p.avgDelaySec / 60).toFixed(2)), borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 0, tension: .25, yAxisID: 'y' },
                        { type: 'bar', label: t('stats.vehicles'), data: d.points.map(p => p.vehicles), backgroundColor: NAVY + (theme() === 'dark' ? '33' : '24'), yAxisID: 'y1', barPercentage: 1, categoryPercentage: 1 },
                    ],
                },
                options: {
                    maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
                    plugins: { legend: { position: 'bottom' } },
                    scales: {
                        x: { grid: { display: false }, ticks: { maxTicksLimit: 6, maxRotation: 0 } },
                        y: minAxis,
                        y1: { beginAtZero: true, position: 'right', grid: { display: false }, ticks: { precision: 0 } },
                    },
                },
            });
            chart('cLineHourly', {
                type: 'bar',
                data: {
                    labels: d.hourly.map(h => `${String(h.hour).padStart(2, '0')}:00`),
                    datasets: [{ label: t('stats.avgDelayMin'), data: d.hourly.map(h => +(h.avgDelaySec / 60).toFixed(2)), backgroundColor: d.hourly.map(h => delayColor(h.avgDelaySec)), borderRadius: 3 }],
                },
                options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { maxRotation: 0 } }, y: minAxis } },
            });
        } catch (err) {
            if (err.name !== 'AbortError') box.innerHTML = stateBlock({ title: t('error.title'), text: errorText(err), kind: 'error' });
        }
    }

    function selectLine(routeId, scroll = false) {
        selectedLine = routeId;
        history.replaceState(null, '', routeId ? `#/stats/${encodeURIComponent(routeId)}` : '#/stats');
        ['cLine', 'cLineHourly'].forEach(id => { charts.get(id)?.destroy(); charts.delete(id); });
        drawTable();
        if (routeId) {
            loadLineDetail(routeId);
            if (scroll) $('#lineTableCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else $('#lineDetail').innerHTML = '';
    }

    root.querySelectorAll('[data-range]').forEach(b => b.addEventListener('click', () => {
        if (rangeKey === b.dataset.range) return;
        rangeKey = b.dataset.range;
        loadHistory();
    }));
    root.querySelectorAll('[data-tmode]').forEach(c => c.addEventListener('click', () => { tableMode = c.dataset.tmode || null; drawTable(); }));
    $('#lineTable').addEventListener('click', e => {
        const sort = e.target.closest('[data-sort]');
        if (sort) {
            const k = sort.dataset.sort;
            sortDir = k === sortKey ? -sortDir : (k === 'shortName' || k === 'mode' ? 1 : -1);
            sortKey = k;
            drawTable();
            return;
        }
        const row = e.target.closest('[data-line]');
        if (row) selectLine(row.dataset.line === selectedLine ? null : row.dataset.line);
    });
    $('#lineTable').addEventListener('keydown', e => {
        const row = e.target.closest('[data-line]');
        if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); row.click(); }
    });

    loadLive();
    loadHistory();
    liveTimer = setInterval(loadLive, 60000);
    if (selectedLine) setTimeout(() => $('#lineTableCard')?.scrollIntoView({ block: 'start' }), 400);

    return () => {
        clearInterval(liveTimer);
        historyController?.abort();
        charts.forEach(c => c.destroy());
        charts.clear();
    };
}
