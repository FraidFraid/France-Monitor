// src/components/layer-panel/drom.ts : vue pure du panneau Énergie DROM (spec lot 2 § 3.6) ; aucun accès réseau ni DOM.
// Production par filière en temps réel (EDF SEI), courbe de la journée locale, comparaison des cinq territoires,
// infrastructures statiques. Les enregistrements de démonstration ne parviennent jamais jusqu'ici (static-runtime.js).
import type { DromLiveCode, DromLiveResponse, DromLiveSector, DromLiveTerritory } from '../../types/index.ts';
import type { DromEnergyAsset, DromEnergyDashboard } from '../../services/drom-energy/index.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { absoluteTime, kvRow } from '../fiche/kit.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { NBSP, formatMw, formatPct, frNumber, localClock, zoneMidnight } from './format.ts';
import { lineChart, type ChartPoint } from './chart.ts';
import { barRow, emptyLine, listRow, loadingBody, sourceErrorCallout, sourceLinkHtml, valueHtml, type LayerView } from './frame.ts';

export const DROM_TABS: readonly DromLiveCode[] = ['RE', 'GP', 'MQ', 'GF', 'COR'];

export interface DromViewInput {
  live: DromLiveResponse | null;
  liveError: string | null;
  dashboard: DromEnergyDashboard | null;
  dashboardError: string | null;
  territory: DromLiveCode;
  assetType: string;
  now: number;
  open: (sectionId: string, byDefault: boolean) => boolean;
}

const THEME = 'Énergie';
const TITLE = 'Énergie DROM';
const DAY_MS = 24 * 3_600_000;
const LATE_MS = 30 * 60_000;
const MAX_ROWS = 40;
const TAB_LABEL: Record<DromLiveCode, string> = { RE: 'Réunion', GP: 'Guadeloupe', MQ: 'Martinique', GF: 'Guyane', COR: 'Corse' };
const TERRITORY_NAME: Record<DromLiveCode, string> = { RE: 'La Réunion', GP: 'Guadeloupe', MQ: 'Martinique', GF: 'Guyane', COR: 'Corse' };
/** Code de l'inventaire statique ; la Corse n'en a pas. */
const INVENTORY_CODE: Record<DromLiveCode, DromEnergyAsset['territoryCode'] | null> = { RE: 'RE', GP: 'GP', MQ: 'MQ', GF: 'GF', COR: null };

const SECTOR: Record<DromLiveSector, { label: string; color: string }> = {
  coal: { label: 'Charbon', color: 'var(--mix-coal)' },
  oil: { label: 'Fioul et diesel', color: 'var(--mix-oil)' },
  turbine: { label: 'Turbines à combustion', color: 'var(--mix-turbine)' },
  bio: { label: 'Bioénergies', color: 'var(--mix-bio)' },
  geothermal: { label: 'Géothermie', color: 'var(--mix-geo)' },
  hydro: { label: 'Hydraulique', color: 'var(--mix-hydro)' },
  solar: { label: 'Photovoltaïque', color: 'var(--mix-solar)' },
  wind: { label: 'Éolien', color: 'var(--mix-wind)' },
  storage: { label: 'Stockage', color: 'var(--mix-storage)' },
  links: { label: 'Liaisons', color: 'var(--mix-links)' },
  other: { label: 'Autres', color: 'var(--mix-other)' },
};
const SECTOR_ORDER = Object.keys(SECTOR) as DromLiveSector[];

const ASSET_TYPE: Record<string, { label: string; color: string }> = {
  source_substation: { label: 'Postes sources', color: 'var(--cat-substation)' },
  htb_pylon: { label: 'Pylônes HTB', color: 'var(--cat-pylon)' },
  production_site: { label: 'Sites de production', color: 'var(--cat-production)' },
  storage_site: { label: 'Sites de stockage', color: 'var(--mix-storage)' },
  hosting_capacity_point: { label: 'Capacités d’accueil', color: 'var(--mix-other)' },
};
const UNKNOWN_TYPE = { label: 'Autres actifs', color: 'var(--mix-other)' };

export function sectorShares(t: DromLiveTerritory): Array<{ sector: DromLiveSector; mw: number; pct: number | null }> {
  const total = t.totalMw ?? 0;
  return SECTOR_ORDER
    .flatMap((sector) => { const mw = t.mix[sector]; return mw === null || !Number.isFinite(mw) ? [] : [{ sector, mw }]; })
    .sort((a, b) => b.mw - a.mw)
    .map(({ sector, mw }) => ({ sector, mw, pct: mw > 0 && total > 0 ? Math.round((mw / total) * 100) : null }));
}

const tabsOf = (): Array<{ id: string; label: string }> => DROM_TABS.map((id) => ({ id, label: TAB_LABEL[id] }));

function frDate(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

function headStatus(t: DromLiveTerritory, now: number): string[] {
  const at = t.dataTime ?? now;
  const late = now - at > LATE_MS;
  const base = `données de ${absoluteTime(at, now, 'fr')}`;
  const time = t.code !== 'COR'
    ? `${base} (${localClock(at, t.timeZone)} heure locale${late ? ', en retard' : ''})`
    : late ? `${base} (en retard)` : base;
  const who = t.status === null ? 'EDF SEI' : t.status === 'Estimé' ? 'EDF SEI, estimé' : `EDF SEI, ${t.status.toLowerCase()}`;
  return [time, who];
}

/** Couleur du chiffre : part renouvelable (pas de rouge : la dépendance au fioul est structurelle, pas une crise). */
export function renewableLevel(t: DromLiveTerritory, now: number): 'vert' | 'jaune' | 'orange' | null {
  const share = t.renewableSharePct;
  if (share === null || !Number.isFinite(share) || now - (t.dataTime ?? now) > LATE_MS) return null;
  return share >= 50 ? 'vert' : share >= 25 ? 'jaune' : 'orange';
}

function lead(t: DromLiveTerritory): string | null {
  const parts = sectorShares(t).filter((s) => s.pct !== null).slice(0, 3)
    .map((s) => `${SECTOR[s.sector].label.toLowerCase()} ${formatPct(s.pct)}`);
  return parts.length > 0 ? `${t.name} : ${formatMw(t.totalMw)} ; ${parts.join(', ')}.` : null;
}

function mixSection(t: DromLiveTerritory, open: DromViewInput['open']): FicheSection {
  const shares = sectorShares(t);
  const positives = shares.filter((s) => s.mw > 0);
  const sum = positives.reduce((a, s) => a + s.mw, 0);
  const bar = positives.map((s) => `<i style="width:${Math.round((s.mw / sum) * 1000) / 10}%;background:${SECTOR[s.sector].color}"></i>`).join('');
  const legend = shares.map((s) => `<div><span class="lp-swatch" style="background:${SECTOR[s.sector].color}"></span>`
    + `<span>${escapeHtml(SECTOR[s.sector].label)}</span><b class="fmk-num">${escapeHtml(formatMw(s.mw, Math.abs(s.mw) < 10 ? 1 : 0))}</b></div>`).join('');
  const negative = shares.some((s) => s.mw < 0)
    ? '<p class="fmk-note">Valeur négative : stockage en charge, export par les liaisons ou consommation des auxiliaires.</p>' : '';
  return {
    id: 'mix', title: 'Production par filière', collapsible: true, open: open('mix', true),
    summary: `${formatMw(t.totalMw)} · ${formatPct(t.renewableSharePct)} renouvelable`,
    html: `${sum > 0 ? `<div class="lp-mix">${bar}</div>` : ''}<div class="lp-leg">${legend}</div>${negative}`,
  };
}

function daySection(t: DromLiveTerritory, open: DromViewInput['open']): FicheSection {
  const base = { id: 'day', title: 'Courbe du jour', collapsible: true, open: open('day', true) };
  const at = t.dataTime ?? 0;
  const from = zoneMidnight(at, t.timeZone);
  const points: ChartPoint[] = t.day.filter((p): p is typeof p & { totalMw: number } => p.totalMw !== null).map((p) => ({ at: p.at, value: p.totalMw }));
  if (points.length < 2) return { ...base, summary: 'n.d.', html: emptyLine('Moins de deux mesures depuis minuit, heure locale.') };
  const peak = points.reduce((b, p) => (p.value > b.value ? p : b), points[0]);
  const chart = lineChart(points, {
    label: `Puissance totale de ${t.name} sur la journée locale`, from, to: from + DAY_MS, stroke: 'var(--text-primary)', nowAt: at, markPeak: true,
    value: (v) => formatMw(v), tick: (ms) => (ms === from ? `0${NBSP}h` : `24${NBSP}h`),
  });
  return { ...base, summary: `pic ${formatMw(peak.value)} à ${localClock(peak.at, t.timeZone)}${t.code !== 'COR' ? ' (heure locale)' : ''}`, html: chart };
}

function allSection(live: DromLiveResponse, now: number, open: DromViewInput['open']): FicheSection {
  const okOnes = live.territories.filter((x) => x.state === 'ok');
  const total = okOnes.reduce((a, x) => a + (x.totalMw ?? 0), 0);
  const rows = live.territories.map((x) => x.state === 'ok'
    ? barRow({
      label: x.name, pct: x.renewableSharePct, value: formatMw(x.totalMw), color: 'var(--cat-renewable)', dot: false,
      note: `${formatPct(x.renewableSharePct)} renouvelable · données de ${absoluteTime(x.dataTime ?? now, now, 'fr')} (${x.utcOffsetLabel})`,
    })
    : listRow({ text: x.name, value: 'n.d.', level: 'gris', note: 'Source injoignable' })).join('');
  return { id: 'all', title: 'Les cinq territoires', collapsible: true, open: open('all', false), summary: `${okOnes.length} sur 5 joignables · ${formatMw(total)}`, html: rows };
}

function metricLine(m: DromEnergyDashboard['communeMetrics'][number]): string {
  // Chaque valeur (nombre + unité) est insécable ; la ligne, elle, peut passer à la ligne entre deux valeurs.
  const parts = [
    m.consumptionMwh !== undefined ? `${frNumber(m.consumptionMwh, 0)}${NBSP}MWh` : null,
    m.co2Tons !== undefined ? `${frNumber(m.co2Tons, 0)}${NBSP}t CO₂` : null,
    m.efficiencyActionsCount !== undefined ? `${m.efficiencyActionsCount}${NBSP}actions` : null,
    m.assetsCount !== undefined ? `${m.assetsCount}${NBSP}actifs` : null,
    m.substationsCount !== undefined ? `${m.substationsCount}${NBSP}postes sources` : null,
  ].filter((x): x is string => x !== null);
  return parts.length > 0 ? parts.map((p) => `<span class="lp-nb">${escapeHtml(p)}</span>`).join(' · ') : 'n.d.';
}

function infraSection(input: DromViewInput): FicheSection {
  const base = { id: 'infra', title: 'Infrastructures', collapsible: true, open: input.open('infra', false) };
  const code = INVENTORY_CODE[input.territory];
  if (code === null) return { ...base, summary: 'n.d.', html: emptyLine('Pas d’inventaire d’infrastructures pour la Corse dans cette couche.') };
  const d = input.dashboard;
  if (d === null) {
    return { ...base, summary: 'n.d.', html: emptyLine(input.dashboardError ? 'Inventaire des infrastructures injoignable.' : 'Inventaire en cours de chargement…') };
  }
  const assets = d.assets.filter((a) => a.territoryCode === code);
  const metrics = d.communeMetrics.filter((m) => m.territoryCode === code);
  const limits = d.productionLimitations.filter((l) => l.territoryCode === code);
  if (assets.length === 0 && metrics.length === 0 && limits.length === 0) {
    return { ...base, summary: 'aucune donnée', html: emptyLine('Aucune donnée d’infrastructure ouverte publiée pour ce territoire : les jeux EDF « Postes sources » sont annoncés sans données (vérifié le 02/10/2026). Les enregistrements de démonstration ne sont pas affichés.') };
  }
  const typeOf = (t: string): { label: string; color: string } => ASSET_TYPE[t] ?? UNKNOWN_TYPE;
  const types = [...new Set(assets.map((a) => a.type))];
  const options = [`<option value="all"${input.assetType === 'all' ? ' selected' : ''}>Tous les types</option>`,
    ...types.map((t) => `<option value="${escapeHtml(t)}"${input.assetType === t ? ' selected' : ''}>${escapeHtml(typeOf(t).label)}</option>`)].join('');
  const filtered = input.assetType === 'all' ? assets : assets.filter((a) => a.type === input.assetType);
  const assetRows = filtered.slice(0, MAX_ROWS).map((a) => listRow({
    text: a.name,
    value: a.voltageKv ? `${a.voltageKv}${NBSP}kV` : a.capacityMw ? formatMw(a.capacityMw, 1) : null,
    color: typeOf(a.type).color,
    note: [typeOf(a.type).label, a.communeName, a.operator].filter(Boolean).join(' · '),
    data: { 'drom-asset': a.id },
    title: a.coordinates ? `Coordonnées : ${frNumber(a.coordinates[1], 4)} ; ${frNumber(a.coordinates[0], 4)}` : null,
  })).join('');
  const more = filtered.length > MAX_ROWS ? `<p class="fmk-note">${filtered.length - MAX_ROWS} autres actifs</p>` : '';
  const assetsHtml = assets.length === 0 ? '' : `<div class="lp-toolbar"><select class="lp-select" data-drom-filter="type" aria-label="Type d’actif">${options}</select></div>`
    + (filtered.length === 0 ? emptyLine('Aucun actif de ce type pour ce territoire.') : assetRows + more);
  const metricsHtml = metrics.length === 0 ? '' : '<h4 class="fmk-eyebrow">Métriques communales</h4>'
    + metrics.slice(0, MAX_ROWS).map((m) => kvRow(m.year !== undefined ? `${m.communeName} (${m.year})` : m.communeName, metricLine(m))).join('');
  const limitsHtml = limits.length === 0 ? '' : '<h4 class="fmk-eyebrow">Limitations de production</h4>'
    + limits.slice(0, MAX_ROWS).map((l) => listRow({
      text: l.siteName ?? l.id, value: formatMw(l.limitedPowerMw ?? null, 1), level: 'orange',
      note: [l.productionType, l.limitationReason,
        l.startDate && l.endDate ? `du ${frDate(l.startDate)} au ${frDate(l.endDate)}` : l.startDate ? `depuis le ${frDate(l.startDate)}` : l.endDate ? `jusqu’au ${frDate(l.endDate)}` : null].filter(Boolean).join(' · '),
    })).join('');
  return { ...base, summary: `${assets.length} actifs`, html: assetsHtml + metricsHtml + limitsHtml };
}

function sourcesSection(input: DromViewInput): FicheSection {
  const { open, dashboard } = input;
  const updated = dashboard !== null && Number.isFinite(Date.parse(dashboard.updatedAt))
    ? `<p class="fmk-note">Inventaire mis à jour le ${escapeHtml(frDate(dashboard.updatedAt))}.</p>` : '';
  const datasets = dashboard === null ? '' : dashboard.datasets.map((d) => `<p class="fmk-note">${escapeHtml(d.label)}</p>`).join('');
  return {
    id: 'sources', title: 'Sources', collapsible: true, open: open('sources', false), tone: 'reference', summary: `EDF open data, pas de 5${NBSP}min`,
    html: `<p class="fmk-note">${sourceLinkHtml('EDF open data', 'https://opendata.edf.fr')} : production par filière en temps réel, pas de 5${NBSP}min (15${NBSP}min en Corse), statut « estimé ».</p>`
      + '<p class="fmk-note">Mayotte : production non publiée en temps réel.</p>'
      + `<p class="fmk-note">Part renouvelable : bioénergies, géothermie, hydraulique, photovoltaïque et éolien, rapportés au total publié. Couleur du chiffre : part renouvelable, vert dès 50${NBSP}%, jaune dès 25${NBSP}%, orange en dessous.</p>`
      + '<p class="fmk-note">La Réunion UTC+4 · Guadeloupe et Martinique UTC−4 · Guyane UTC−3 · Corse heure de Paris</p>'
      + updated + datasets,
  };
}

export function buildDromView(input: DromViewInput): LayerView {
  const { live, liveError, now, open } = input;
  const tabs = tabsOf();
  const activeTab = input.territory;
  const tail = [infraSection(input), sourcesSection(input)];
  if (live === null && liveError === null) {
    return { head: { theme: THEME, title: TITLE, status: ['chargement…'] }, tabs, activeTab, sections: [], bodyHtml: loadingBody() };
  }
  if (live === null) {
    return {
      head: { theme: THEME, title: TITLE, figure: { value: 'n.d.', caption: TERRITORY_NAME[input.territory] }, status: ['EDF SEI injoignable'] },
      tabs, activeTab, sections: tail, bodyHtml: sourceErrorCallout(null, now),
    };
  }
  const t = live.territories.find((x) => x.code === input.territory);
  if (!t || t.state === 'error') {
    return {
      head: { theme: THEME, title: TITLE, figure: { value: 'n.d.', caption: t?.name ?? TERRITORY_NAME[input.territory] }, status: ['EDF SEI injoignable pour ce territoire'] },
      tabs, activeTab, sections: [allSection(live, now, open), ...tail], bodyHtml: sourceErrorCallout(null, now),
    };
  }
  const level = renewableLevel(t, now);
  return {
    head: {
      theme: THEME, title: TITLE,
      figure: {
        value: formatMw(t.totalMw), caption: `${t.name} · ${formatPct(t.renewableSharePct)} renouvelable`, level,
        captionHtml: `${escapeHtml(`${t.name} · `)}${valueHtml(formatPct(t.renewableSharePct), level)}${escapeHtml(' renouvelable')}`,
      },
      status: headStatus(t, now), lead: lead(t),
    },
    tabs, activeTab,
    sections: [mixSection(t, open), daySection(t, open), allSection(live, now, open), ...tail],
    bodyHtml: liveError !== null ? sourceErrorCallout(live.fetchedAt, now) : undefined,
  };
}
