// Accessible combobox for addresses and stops, backed by /api/geocode.
import { api } from './api.js';
import { t, lang } from './i18n.js';
import { esc, ICON, debounce } from './util.js';

let uid = 0;

// Results that are a street, area or plain address get a pin; named businesses and landmarks get a storefront.
const ADDRESS_KINDS = new Set(['place', 'highway', 'building', 'boundary', 'landuse', 'point', 'route', 'street_address',
    'premise', 'subpremise', 'geocode', 'locality', 'sublocality', 'sublocality_level_1', 'neighborhood', 'postal_code']);
const iconFor = p => p.kind === 'stop' ? ICON.stop : p.kind === 'here' ? ICON.locate
    : ADDRESS_KINDS.has(p.kind) ? ICON.pin : ICON.poi;
const newSession = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function attachAutocomplete(input, { onPick, signal, extraItems }) {
    const wrap = input.parentElement;
    wrap.style.position = 'relative';
    const list = document.createElement('ul');
    const id = `suggest-${++uid}`;
    list.id = id;
    list.className = 'suggest';
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    wrap.appendChild(list);
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', id);
    input.setAttribute('aria-expanded', 'false');

    let items = [];
    let active = -1;
    let controller;
    // Google bills autocomplete keystrokes + the final details lookup as one session when they share a token.
    let session = newSession();

    const close = () => {
        list.hidden = true;
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
        active = -1;
    };
    const open = () => { list.hidden = false; input.setAttribute('aria-expanded', 'true'); };

    const render = (state) => {
        if (state === 'loading') {
            list.innerHTML = `<li class="s-empty" role="option" aria-disabled="true">${esc(t('search.loading'))}</li>`;
        } else if (!items.length) {
            list.innerHTML = `<li class="s-empty" role="option" aria-disabled="true">${esc(t(state === 'error' ? 'search.error' : 'search.none'))}</li>`;
        } else {
            list.innerHTML = items.map((p, i) => `
                <li role="option" id="${id}-${i}" data-i="${i}" aria-selected="${i === active}">
                    <span class="s-icon">${iconFor(p)}</span>
                    <span><span class="s-main">${esc(p.label)}</span>${p.detail ? `<br><span class="s-detail">${esc(p.detail)}</span>` : ''}</span>
                </li>`).join('');
        }
        open();
    };

    const pick = async i => {
        const p = items[i];
        if (!p) return;
        input.value = p.label;
        close();
        if (p.lat != null && p.lon != null) { onPick(p); return; }
        if (!p.placeId) return;
        const token = session;
        session = newSession();
        try {
            const place = await api(`geocode/place/${encodeURIComponent(p.placeId)}`, { params: { lang: lang(), session: token }, signal });
            if (input.value !== p.label) return;
            onPick({ ...p, ...place, label: p.label, detail: p.detail ?? place.detail });
        } catch (err) {
            if (err.name !== 'AbortError') { items = []; render('error'); }
        }
    };

    const search = debounce(async q => {
        controller?.abort();
        controller = new AbortController();
        try {
            const results = await api('geocode', { params: { q, lang: lang(), session }, signal: controller.signal });
            if (input.value.trim() !== q) return;
            items = results;
            active = -1;
            render();
        } catch (err) {
            if (err.name !== 'AbortError') { items = []; render('error'); }
        }
    }, 320);

    input.addEventListener('input', () => {
        const q = input.value.trim();
        if (q.length < 2) {
            items = extraItems?.() ?? [];
            items.length ? render() : close();
            return;
        }
        items = [];
        render('loading');
        search(q);
    });
    input.addEventListener('focus', () => {
        if (!input.value.trim() && extraItems) { items = extraItems(); if (items.length) render(); }
    });
    input.addEventListener('keydown', e => {
        if (list.hidden || !items.length) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
            render();
            input.setAttribute('aria-activedescendant', `${id}-${active}`);
            list.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter') {
            e.preventDefault();
            pick(active >= 0 ? active : 0);
        } else if (e.key === 'Escape') {
            close();
        }
    });
    list.addEventListener('mousedown', e => {
        const li = e.target.closest('[data-i]');
        if (li) { e.preventDefault(); pick(Number(li.dataset.i)); }
    });
    input.addEventListener('blur', () => setTimeout(close, 120));
    signal?.addEventListener('abort', () => controller?.abort());
}
