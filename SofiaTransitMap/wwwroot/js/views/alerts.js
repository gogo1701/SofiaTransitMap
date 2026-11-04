// Service alerts published by the Urban Mobility Center.
import { api } from '../api.js';
import { t, lang } from '../i18n.js';
import { esc, badge, safeHtml, skeleton, stateBlock, errorText, dateTime, ICON } from '../util.js';

const EFFECT_CLASS = { Detour: 'detour', StopMoved: 'detour', NoService: 'no-service', ReducedService: 'no-service' };

export function renderAlerts(root, { signal }) {
    let filter = '';
    let data = null;
    root.innerHTML = `
        <div class="section">
            <h1 style="font-size:1.2rem">${esc(t('alerts.title'))}</h1>
            <p class="section-note">${esc(t('alerts.intro'))}</p>
            <div class="search" style="margin-top:12px">${ICON.search}<input class="input" id="alertFilter" type="search" autocomplete="off"
                placeholder="${esc(t('alerts.filterPh'))}" aria-label="${esc(t('alerts.filterPh'))}"></div>
        </div>
        <div id="alertList" aria-live="polite">${skeleton(5)}</div>`;
    const list = root.querySelector('#alertList');

    const text = a => ({
        header: (lang() === 'en' ? a.headerEn || a.headerBg : a.headerBg || a.headerEn) || '',
        body: (lang() === 'en' ? a.descriptionEn || a.descriptionBg : a.descriptionBg || a.descriptionEn) || '',
    });

    const draw = () => {
        const q = filter.toLowerCase();
        const items = data.alerts.filter(a => !q
            || a.routes.some(r => r.shortName.toLowerCase() === q)
            || text(a).header.toLowerCase().includes(q) || text(a).body.toLowerCase().includes(q));
        if (!items.length) {
            list.innerHTML = stateBlock(data.alerts.length
                ? { title: t('alerts.noMatch') }
                : { title: t('alerts.none'), text: t('alerts.noneText') });
            return;
        }
        list.innerHTML = items.map(a => {
            const { header, body } = text(a);
            const effect = t(`effect.${a.effect}`);
            return `<article class="alert-item">
                <div class="alert-meta">
                    <span class="effect-tag ${EFFECT_CLASS[a.effect] || ''}">${esc(effect.startsWith('effect.') ? t('effect.OtherEffect') : effect)}</span>
                    ${a.start ? `<span>${esc(t('alerts.from'))} ${esc(dateTime(a.start))}</span>` : ''}
                    ${a.end ? `<span>${esc(t('alerts.until'))} ${esc(dateTime(a.end))}</span>` : ''}
                </div>
                <h3 style="margin:8px 0 0;font-size:1rem">${esc(header)}</h3>
                ${a.routes.length ? `<div class="alert-routes">${a.routes.map(r => `<a href="#/lines/${encodeURIComponent(r.id)}">${badge(r, 'sm')}</a>`).join('')}</div>` : ''}
                ${body && body !== header ? `<div class="alert-text clamped">${safeHtml(body)}</div>
                    <button type="button" class="link-btn more" aria-expanded="false" hidden>${esc(t('alerts.more'))}</button>` : ''}
                ${a.url ? `<a class="link-btn" href="${esc(a.url)}" target="_blank" rel="noopener">${esc(t('alerts.source'))} ↗</a>` : ''}
            </article>`;
        }).join('');
        list.querySelectorAll('.alert-text').forEach(el => {
            const more = el.nextElementSibling;
            if (el.scrollHeight > el.clientHeight + 2) more.hidden = false;
            more.addEventListener('click', () => {
                const open = el.classList.toggle('clamped') === false;
                more.setAttribute('aria-expanded', String(open));
                more.textContent = t(open ? 'alerts.less' : 'alerts.more');
            });
        });
    };

    root.querySelector('#alertFilter').addEventListener('input', e => { filter = e.target.value.trim(); if (data) draw(); });

    api('live/alerts', { signal })
        .then(d => { data = d; draw(); })
        .catch(err => { if (err.name !== 'AbortError') list.innerHTML = stateBlock({ title: t('error.title'), text: errorText(err), kind: 'error' }); });
}
