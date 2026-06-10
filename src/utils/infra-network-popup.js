function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

import { getDatacenterStatusMeta, getDatacenterVisualMeta } from './infra-network-visuals.js';

function row(label, value) {
    if (!value) return '';
    return `
      <span style="color:#9898a8">${escapeHtml(label)}</span>
      <span>${escapeHtml(value)}</span>
    `;
}

/**
 * @param {{
 *   name?: string,
 *   provider?: string,
 *   region?: string,
 *   city?: string,
 *   address?: string,
 *   status?: string,
 *   incidents?: Array<{ title?: string }>,
 *   operationalState?: string,
 *   powerBand?: string,
 *   powerDetail?: string,
 *   detailSummary?: string,
 *   rawSource?: string,
 *   sourceUrl?: string,
 *   source?: string,
 *   lastUpdated?: string,
 *   realLng?: number,
 *   realLat?: number,
 *   offsetMeters?: number,
 * }} input
 */
export function buildDatacenterPopupHtml(input = {}) {
    const statusMeta = getDatacenterStatusMeta(input.status);
    const visualMeta = getDatacenterVisualMeta(input);
    const incidents = Array.isArray(input.incidents) ? input.incidents : [];
    const updatedLabel = input.lastUpdated
        ? new Date(String(input.lastUpdated)).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
        : '—';
    const coordsLabel = Number.isFinite(input.realLat) && Number.isFinite(input.realLng)
        ? `${Number(input.realLat).toFixed(4)}, ${Number(input.realLng).toFixed(4)}`
        : '—';
    const offsetLabel = Number(input.offsetMeters ?? 0) > 0 ? `${Math.round(Number(input.offsetMeters))} m` : 'Aucun';
    const sourceLabel = input.source || 'Statuspage officielle';
    const siteState = input.operationalState || '';
    const address = input.address || '';
    const powerBand = input.powerBand || '';
    const powerDetail = input.powerDetail || '';
    const city = input.city || '';
    const detailSummary = input.detailSummary || '';
    const rawSource = input.rawSource || '';
    const sourceUrl = input.sourceUrl || '';

    const detailRows = [
        row('Ville', city),
        row('Adresse', address),
        row('État du site', siteState),
        row('Puissance exacte', powerDetail),
        row('Puissance', powerBand),
        row('Coord. réelle', coordsLabel),
        row('Décalage affichage', offsetLabel),
        row('Mis à jour', updatedLabel),
        row('Source terrain', sourceLabel),
        row('Source projet', rawSource),
    ].filter(Boolean).join('');

    const incidentsHtml = incidents.length
        ? incidents.map((incident) => `<div style="font-size:11px;color:#0EA5E9;margin-top:4px;">⚠ ${escapeHtml(incident.title ?? 'Incident')}</div>`).join('')
        : `<div style="font-size:11px;color:var(--text-muted);">Aucun incident actif</div>`;

    return `
      <div style="color:#e8e8ec;font-family:sans-serif;min-width:240px;max-width:320px;">
        <h4 style="margin:0 0 2px;font-weight:700;font-size:14px;color:#fff;">${escapeHtml(input.name || 'Datacenter')}</h4>
        <div style="font-size:11px;color:#6366f1;margin-bottom:10px;">${escapeHtml(input.provider || '')} · ${escapeHtml(input.region || '')}</div>
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px;">
          <span style="color:#9898a8">Statut opérateur</span>
          <span style="font-weight:700;color:${statusMeta.color}">${escapeHtml(statusMeta.label)}</span>
        </div>
        ${siteState ? `
        <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:13px;">
          <span style="color:#9898a8">État du site</span>
          <span style="font-weight:700;color:${visualMeta.popupColor}">${escapeHtml(siteState)}</span>
        </div>` : ''}
        <div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:.04em;">Incidents</div>
        ${incidentsHtml}
        <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 10px;margin-top:10px;font-size:11px;">
          ${detailRows}
        </div>
        ${detailSummary ? `<div style="margin-top:10px;font-size:11px;line-height:1.45;color:#c8c8d4;">${escapeHtml(detailSummary)}</div>` : ''}
        ${sourceUrl ? `<div style="margin-top:8px;"><a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer" style="color:#64d2ff;font-size:10px;text-decoration:none;">Fiche source ↗</a></div>` : ''}
      </div>`;
}
