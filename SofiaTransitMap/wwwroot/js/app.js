// App shell: hash router, live polling, language switch and the mobile bottom sheet.
import { api } from './api.js';
import { t, setLang, applyStatic, onLangChange } from './i18n.js';
import { initTheme, onThemeChange } from './theme.js';
import * as M from './map.js';
import { renderHome, renderStop } from './views/home.js';
import { renderPlanner } from './views/planner.js';
import { renderLines, renderLine } from './views/lines.js';
import { renderAlerts } from './views/alerts.js';
import { renderStats } from './views/stats.js';

const ROUTES = [
    { re: /^\/?(map)?$/, tab: 'map', view: renderHome },
    { re: /^\/stop\/([^/]+)$/, tab: 'map', view: renderStop, keys: ['id'] },
    { re: /^\/plan$/, tab: 'plan', view: renderPlanner },
    { re: /^\/lines$/, tab: 'lines', view: renderLines },
    { re: /^\/lines\/([^/]+)$/, tab: 'lines', view: renderLine, keys: ['id'] },
    { re: /^\/stats(?:\/([^/]+))?$/, tab: 'stats', view: renderStats, keys: ['id'], page: true },
    { re: /^\/alerts$/, tab: 'alerts', view: renderAlerts },
];

const shell = document.getElementById('shell');
const panel = document.getElementById('panel');
const panelBody = document.getElementById('panelBody');
const page = document.getElementById('page');
const pill = document.getElementById('livePill');
const pillText = document.getElementById('liveText');
const offlineBanner = document.getElementById('offlineBanner');
const installBtn = document.getElementById('installBtn');

let current = { cleanup: null, controller: null, tab: null, page: false };
let installPrompt;

function updateConnectionStatus() {
    offlineBanner.hidden = navigator.onLine;
}

window.addEventListener('online', updateConnectionStatus);
window.addEventListener('offline', updateConnectionStatus);
updateConnectionStatus();

window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    installBtn.hidden = false;
});

installBtn.addEventListener('click', async () => {
    if (!installPrompt) return;
    const prompt = installPrompt;
    installPrompt = null;
    installBtn.hidden = true;
    try {
        await prompt.prompt();
    } catch (err) {
        console.error('PWA install prompt failed', err);
    }
});

window.addEventListener('appinstalled', () => {
    installPrompt = null;
    installBtn.hidden = true;
});

function navigate() {
    const path = decodeURI(location.hash.replace(/^#/, '')) || '/map';
    const route = ROUTES.find(r => r.re.test(path)) ?? ROUTES[0];
    const match = path.match(route.re) || [];
    const params = Object.fromEntries((route.keys || []).map((k, i) => [k, match[i + 1] ? decodeURIComponent(match[i + 1]) : undefined]));

    current.controller?.abort();
    try { current.cleanup?.(); } catch (err) { console.error(err); }

    document.querySelectorAll('[data-tab]').forEach(a => {
        if (a.dataset.tab === route.tab) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
    });

    const wasPage = current.page;
    shell.classList.toggle('is-page', !!route.page);
    page.hidden = !route.page;
    const root = route.page ? page : panelBody;
    if (route.page) panelBody.innerHTML = ''; else page.innerHTML = '';
    root.scrollTop = 0;
    panel.scrollTop = 0;

    const controller = new AbortController();
    let cleanup = null;
    try {
        const result = route.view(root, { params, signal: controller.signal });
        if (typeof result === 'function') cleanup = result;
        else if (result?.then) result.then(fn => { if (typeof fn === 'function') { if (controller.signal.aborted) fn(); else current.cleanup = fn; } });
    } catch (err) {
        console.error(err);
    }
    current = { cleanup, controller, tab: route.tab, page: !!route.page };
    if (wasPage && !route.page) requestAnimationFrame(M.invalidate);
}

// ---------- Live status ----------
let pollTimer;
async function pollVehicles() {
    clearTimeout(pollTimer);
    try {
        const data = await M.refreshVehicles();
        pill.dataset.state = data.fresh ? 'live' : 'stale';
        pillText.textContent = data.fresh ? t('live.ok', { n: data.vehicles.length }) : t('live.stale');
    } catch (err) {
        pill.dataset.state = err.code === 'feed-loading' ? 'loading' : 'error';
        pillText.textContent = t(err.code === 'feed-loading' ? 'live.loading' : 'live.error');
    }
    pollTimer = setTimeout(pollVehicles, document.hidden ? 60000 : 20000);
}

async function pollAlerts() {
    try {
        const { alerts } = await api('live/alerts');
        const badge = document.getElementById('alertCount');
        badge.textContent = alerts.length;
        badge.hidden = alerts.length === 0;
    } catch { /* the tab still works without the counter */ }
}

// ---------- Mobile sheet ----------
function initSheet() {
    const handle = document.getElementById('sheetHandle');
    handle.addEventListener('click', () => {
        const expanded = panel.classList.contains('expanded');
        const collapsed = panel.classList.contains('collapsed');
        panel.classList.remove('expanded', 'collapsed');
        if (!expanded && !collapsed) panel.classList.add('expanded');
        else if (expanded) panel.classList.add('collapsed');
        handle.setAttribute('aria-expanded', String(!panel.classList.contains('collapsed')));
        M.invalidate();
    });
}

// ---------- Boot ----------
applyStatic();
initTheme();
// Charts and route badges bake colours in when drawn, so the current view re-renders on a theme switch.
onThemeChange(() => navigate());
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(err => console.error('Service worker registration failed', err));
}
document.querySelectorAll('[data-lang]').forEach(b => b.addEventListener('click', () => setLang(b.dataset.lang)));
onLangChange(() => {
    navigate();
    if (pill.dataset.state === 'live' && M.vehicleData()) pillText.textContent = t('live.ok', { n: M.vehicleData().vehicles.length });
});

M.initMap();
initSheet();
window.addEventListener('hashchange', navigate);
document.addEventListener('visibilitychange', () => { if (!document.hidden) pollVehicles(); });

navigate();
M.loadStops().catch(err => console.warn('Stops failed to load', err));
pollVehicles();
pollAlerts();
setInterval(pollAlerts, 5 * 60 * 1000);
