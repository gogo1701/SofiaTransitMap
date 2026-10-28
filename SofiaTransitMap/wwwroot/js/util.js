// Small DOM, formatting and domain helpers shared by every view.
import { t, lang } from './i18n.js';

export const TZ = 'Europe/Sofia';

export function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function html(strings, ...values) {
    return strings.reduce((out, s, i) => out + s + (i < values.length ? (values[i] instanceof Raw ? values[i].v : esc(values[i])) : ''), '');
}

class Raw { constructor(v) { this.v = v; } }
export const raw = v => new Raw(Array.isArray(v) ? v.join('') : (v ?? ''));

export function debounce(fn, ms) {
    let id;
    return (...args) => { clearTimeout(id); id = setTimeout(() => fn(...args), ms); };
}

// ---------- Time ----------
const fmtCache = new Map();
function fmt(opts) {
    const key = lang() + JSON.stringify(opts);
    if (!fmtCache.has(key)) fmtCache.set(key, new Intl.DateTimeFormat(lang() === 'en' ? 'en-GB' : 'bg-BG', { timeZone: TZ, ...opts }));
    return fmtCache.get(key);
}

export const clock = d => d ? fmt({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(d)) : '–';
export const dayLabel = d => fmt({ weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(d));
export const shortDate = d => fmt({ day: 'numeric', month: 'short' }).format(new Date(d));
export const dateTime = d => fmt({ day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(d));

/** Today's date and current time in Sofia as input values (yyyy-mm-dd, HH:mm). */
export function sofiaNowParts() {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).map(p => [p.type, p.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

export function minutesUntil(d) {
    return Math.round((new Date(d) - Date.now()) / 60000);
}

export function duration(sec) {
    const m = Math.max(1, Math.round(sec / 60));
    if (m < 60) return { value: m, unit: t('unit.min') };
    const h = Math.floor(m / 60), r = m % 60;
    return { value: r ? `${h}:${String(r).padStart(2, '0')}` : h, unit: t('unit.h') };
}

export const fmtDuration = sec => { const d = duration(sec); return `${d.value} ${d.unit}`; };

export function fmtDelay(sec) {
    if (sec == null) return '';
    const m = Math.round(sec / 60);
    if (Math.abs(m) < 1) return t('delay.onTime');
    return m > 0 ? `+${m} ${t('unit.min')}` : `${m} ${t('unit.min')}`;
}

export function delayClass(sec) {
    if (sec == null) return '';
    if (sec >= 600) return 'bad';
    if (sec >= 180) return 'warn';
    return 'ok';
}

export const fmtNum = (n, digits = 0) => n == null || Number.isNaN(n) ? '–'
    : new Intl.NumberFormat(lang() === 'en' ? 'en-GB' : 'bg-BG', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
export const fmtPct = (share, digits = 0) => share == null ? '–' : `${fmtNum(share * 100, digits)}%`;
export const fmtMin = sec => sec == null ? '–' : fmtNum(sec / 60, 1);
export const fmtMeters = m => m >= 1000 ? `${fmtNum(m / 1000, 1)} ${t('unit.km')}` : `${Math.round(m / 10) * 10} ${t('unit.m')}`;

// ---------- Names ----------
const ACRONYMS = new Set(['УМБАЛ', 'МБАЛ', 'СБАЛ', 'НДК', 'ЦУМ', 'ТЕЦ', 'ДКЦ', 'СУ', 'ПГ', 'ДЗИ', 'ВМА', 'МОЛ', 'БАН', 'УНСС', 'НБУ', 'ТУ', 'ЛТУ', 'ВТУ', 'ВИАС',
    'ЖП', 'ГУМ', 'НАТФИЗ', 'НСА', 'АЕЦ', 'ОУ', 'ДГ', 'НХК', 'МВР', 'БНТ', 'БНР', 'ИАМН', 'ЦСМП', 'ХЕИ', 'КАТ', 'ПСТГД', 'II', 'III', 'IV', 'VI', 'VII', 'VIII', 'IX', 'XI', 'XII',
    'UMBAL', 'MBAL', 'NDK', 'TSUM', 'TETS', 'DKTS', 'SU', 'MOL', 'BAN', 'UNSS', 'NBU', 'TU', 'ZHP', 'GUM', 'NATFIZ', 'NSA', 'M1', 'M2', 'M3', 'M4']);

/** GTFS names are published in capitals; render them in sentence-style title case for legibility. */
export function prettyName(name) {
    if (!name) return '';
    const letters = name.replace(/[^A-Za-zА-Яа-я]/g, '');
    if (!letters || letters !== letters.toUpperCase()) return name;
    return name.toLowerCase().replace(/[A-Za-zА-Яа-яЁё0-9.]+/g, (word, offset) => {
        const upper = word.toUpperCase();
        if (ACRONYMS.has(upper.replace(/\.$/, ''))) return upper;
        if (/^[a-zа-я]{1,3}\.$/.test(word) || /^[a-zа-я]\.[a-zа-я]\.$/.test(word)) return offset === 0 ? word[0].toUpperCase() + word.slice(1) : word;
        if (offset > 0 && ['и', 'на', 'до', 'от', 'за', 'по', 'в', 'с', 'and', 'of', 'the'].includes(word)) return word;
        return word.charAt(0).toUpperCase() + word.slice(1);
    });
}

export const nameOf = (o, field = 'name') => prettyName(lang() === 'en' ? (o?.[field + 'En'] || o?.[field]) : o?.[field]);

// ---------- Modes and badges ----------
export const MODES = ['Metro', 'Tram', 'Trolleybus', 'Bus'];
export const MODE_COLOR = { Metro: '#2B3C8F', Tram: '#F7941D', Trolleybus: '#27AAE1', Bus: '#BE1E2D', Unknown: '#6B7280' };
export const modeName = (mode, plural = false) => t(`mode.${mode}${plural ? '.pl' : ''}`);

/** Pick ink or white text for a badge background so line numbers keep ≥4.5:1 contrast. */
export function textOn(hex) {
    const h = (hex || '').replace('#', '');
    if (h.length !== 6) return '#fff';
    const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const [r, g, b] = [0, 2, 4].map(i => lin(parseInt(h.slice(i, i + 2), 16)));
    const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return (1.05 / (L + 0.05)) >= 4.5 ? '#fff' : '#111827';
}

export function routeColor(route) {
    const c = route?.color ? `#${route.color.replace('#', '')}` : MODE_COLOR[route?.mode] ?? MODE_COLOR.Unknown;
    return c.toUpperCase() === '#000000' ? '#374151' : c;
}

export function badge(route, size = '') {
    if (!route) return '';
    const c = routeColor(route);
    return `<span class="badge ${size ? 'badge-' + size : ''}" style="--c:${c};--tc:${textOn(c)}" title="${esc(modeName(route.mode))} ${esc(route.shortName)}">${esc(route.shortName)}</span>`;
}

export const ICON = {
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="3" width="12" height="9" rx="2"/><path d="M12 12v9M9 21h6"/></svg>',
    pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>',
    swap: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4"/></svg>',
    locate: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7.5"/></svg>',
    back: '<svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M15 18l-6-6 6-6"/></svg>',
    walk: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="13" cy="4" r="2"/><path d="M10.5 8.5 8 21h2.2l1.6-7 2.2 2v5h2v-6.5l-2.1-2.1.6-3.1A6 6 0 0 0 19 12v-2a4 4 0 0 1-3.4-2l-1-1.6A2 2 0 0 0 12.9 5.5L8 7.6V12h2V8.9l.5-.4Z"/></svg>',
    clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    empty: '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="10" y="8" width="28" height="26" rx="4"/><path d="M10 22h28M16 40l4-6M32 40l-4-6"/><circle cx="17" cy="28" r="1.5"/><circle cx="31" cy="28" r="1.5"/></svg>',
    wheelchair: '<svg viewBox="0 0 24 24" aria-hidden="true" width="14" height="14" fill="currentColor"><circle cx="11" cy="4" r="2"/><path d="M19 13v-2c-1.5 0-2.9-.7-3.9-1.8l-1.3-1.4a2 2 0 0 0-1.5-.8H12a2 2 0 0 0-2 2v6a3 3 0 0 0 3 3h5v5h2v-5.5a2 2 0 0 0-2-2h-3v-3.5a7 7 0 0 0 4 1.5ZM12 20a3 3 0 1 1-2.8-4.2V13.7A5 5 0 1 0 15.9 20h-2.1A3 3 0 0 1 12 20Z"/></svg>',
};

// ---------- States ----------
export const skeleton = (rows = 5) => Array.from({ length: rows }, () => '<div class="skeleton sk-row"></div>').join('');

export function stateBlock({ title, text = '', kind = '', action = '' }) {
    return `<div class="state ${kind}">${kind === 'error' ? '' : ICON.empty}<h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}${action}</div>`;
}

export function errorText(err) {
    if (err?.code === 'feed-loading') return t('error.feedLoading');
    if (err?.status === 0) return t('error.network');
    return err?.message || t('error.generic');
}

let toastTimer;
export function toast(message, ms = 3500) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

/** Allow-listed rendering of the HTML that Sofia's alert feed publishes. */
export function safeHtml(source) {
    const doc = new DOMParser().parseFromString(`<div>${source || ''}</div>`, 'text/html');
    const allowed = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'UL', 'OL', 'LI', 'A', 'SPAN']);
    const walk = node => {
        [...node.childNodes].forEach(child => {
            if (child.nodeType === Node.ELEMENT_NODE) {
                if (!allowed.has(child.tagName)) {
                    walk(child);
                    child.replaceWith(...child.childNodes);
                    return;
                }
                [...child.attributes].forEach(a => {
                    if (!(child.tagName === 'A' && a.name === 'href' && /^https?:/i.test(a.value))) child.removeAttribute(a.name);
                });
                if (child.tagName === 'A') { child.target = '_blank'; child.rel = 'noopener'; }
                walk(child);
            } else if (child.nodeType !== Node.TEXT_NODE) child.remove();
        });
    };
    const root = doc.body.firstChild;
    walk(root);
    return root.innerHTML;
}
