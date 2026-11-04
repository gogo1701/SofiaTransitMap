// Light/dark theme. Follows the OS until the user picks one; the choice is remembered.
// index.html sets data-theme before first paint, this module keeps it in sync afterwards.
const KEY = 'stm.theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set();

const stored = () => { try { return localStorage.getItem(KEY); } catch { return null; } };

export const theme = () => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';

function apply(next) {
    if (next === theme() && document.documentElement.dataset.theme) return;
    document.documentElement.dataset.theme = next;
    syncChrome();
    listeners.forEach(fn => fn(next));
}

function syncChrome() {
    const bar = getComputedStyle(document.documentElement).getPropertyValue('--topbar-bg').trim();
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bar || '#2B3C8F');
    const btn = document.getElementById('themeBtn');
    btn?.setAttribute('aria-pressed', String(theme() === 'dark'));
}

export function toggleTheme() {
    const next = theme() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, next); } catch { /* private mode: still switch for this visit */ }
    apply(next);
}

export function onThemeChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function initTheme() {
    media.addEventListener('change', e => { if (!stored()) apply(e.matches ? 'dark' : 'light'); });
    document.getElementById('themeBtn')?.addEventListener('click', toggleTheme);
    syncChrome();
}

/** Read a resolved CSS custom property, for canvas and chart drawing. */
export const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
