// src/components/fiche/france-indicators.ts — sections d'indicateurs de la fiche France v2 (spec
// 2026-10-01 § 3.2) dans le kit fmk : Infrastructures, Domaines, Énergie, Carburants, Chronologie.
// Pures (aucun DOM) ; mêmes données et mêmes calculs que les blocs v1, partagés avec eux.

import type { FranceCountrySnapshot, FranceIntelEnergySummary } from '../../types/index.ts';
import { INFRA_NOTE, infraRows, infraValueLevel, type InfraInput } from '../../services/infra-continuity.ts';
import { fuelTensionLevel, infraStatusLevel, levelColorVar, levelLabel, officialLevel } from '../../services/vigilance.ts';
import {
  DOMAIN_LEVEL,
  domainChips,
  domainTiles,
  energySegments,
  oilStatusInfo,
  timelineIntensity,
  type DomainLevel,
  type DomainTile,
  type EnergyKey,
} from '../france-intel-blocks.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { renderVigilancePill } from '../shared/vigilancePill.ts';
import {
  filterFuelPriceSeries,
  formatFuelDeltaCents,
  formatFuelPrice,
  renderFuelPriceChartSvg,
} from '../../utils/fuelPriceChart.ts';
import { kvRow, levelCounts, levelDot, meterRow } from './kit.ts';
import { formatNumber, t, type Lang } from './parts.ts';

export type IndicatorId = 'infra' | 'domains' | 'energy' | 'fuel' | 'timeline';

export interface IndicatorSection {
  id: IndicatorId;
  title: string;
  /** HTML échappé du résumé de la ligne de titre. */
  summary: string;
  html: string;
}

const ENERGY_LABEL: Record<EnergyKey, Record<Lang, string>> = {
  nuclear: { fr: 'Nucléaire', en: 'Nuclear' },
  gas: { fr: 'Gaz', en: 'Gas' },
  hydro: { fr: 'Hydraulique', en: 'Hydro' },
  wind: { fr: 'Éolien', en: 'Wind' },
  solar: { fr: 'Solaire', en: 'Solar' },
  other: { fr: 'Autre', en: 'Other' },
};

const percent = (value: number, lang: Lang): string => (lang === 'fr' ? `${value} %` : `${value}%`);

export function infraSection(infra: InfraInput | null, lang: Lang): IndicatorSection {
  const title = t(lang, 'Infrastructures', 'Infrastructure');
  const result = infra?.result ?? null;
  if (!infra || !result) {
    return {
      id: 'infra', title, summary: escapeHtml(t(lang, 'en attente', 'pending')),
      html: `<p class="fmk-muted">${t(lang, 'Chargement du baromètre des infrastructures…', 'Loading the infrastructure barometer…')}</p>`,
    };
  }
  const rows = infraRows(infra, lang);
  const watched = rows.filter((r) => r.value !== null && r.value < 85).length;
  const summary = `${levelDot(infraStatusLevel(result.status))}<span class="fmk-num">${result.score}/100</span>`
    + (watched > 0 ? escapeHtml(t(lang, ` · ${watched} à surveiller`, ` · ${watched} to watch`)) : '');
  const cyberNational = result.details.cyberNational ?? null;
  const meters = rows.map((r) => meterRow({
    label: r.label,
    value: r.value,
    level: infraValueLevel(r.value),
    display: r.value === null ? (r.note ?? 'n.d.') : `${r.value} / 100`,
    noteHtml: r.key === 'cyber' && cyberNational !== null
      ? `<button type="button" class="fmk-link" data-action="open-cyber">${t(lang, `National ${cyberNational}/100`, `National ${cyberNational}/100`)}</button>`
      : r.value !== null && r.note ? `<span class="fmk-muted">${escapeHtml(r.note)}</span>` : undefined,
  })).join('');
  return {
    id: 'infra', title, summary,
    html: `<div class="fmk-meters fmk-meters--infra">${meters}</div><p class="fmk-note">${escapeHtml(INFRA_NOTE[lang])}</p>`,
  };
}

export function domainsSection(snapshot: Pick<FranceCountrySnapshot, 'signals' | 'meteo'>, lang: Lang): IndicatorSection {
  const tiles = domainTiles(snapshot.signals, lang);
  // Sans niveau (source indisponible, S3) : point gris, « n.d. », hors du compte par niveau.
  const dot = (level: DomainLevel | null): string => levelDot(level === null ? null : DOMAIN_LEVEL[level]);
  const num = (v: number | null): string => `<b class="fmk-num">${v === null ? 'n.d.' : formatNumber(v, lang)}</b>`;
  const value = (tile: DomainTile): string => (tile.parts
    ? `<span class="fmk-domain-parts">${tile.parts.map((p) => `<span class="fmk-domain-part">${dot(p.level)}`
      + `${escapeHtml(p.label)} ${num(p.value)}</span>`).join('')}</span>`
    : num(tile.value));
  const grid = tiles.map((tile) => `<div class="fmk-domain">`
    + `<span class="fmk-domain-name">${dot(tile.level)}${escapeHtml(tile.label)}</span>`
    + `${value(tile)}<small>${escapeHtml(tile.meta)}</small></div>`).join('');
  const chips = domainChips(snapshot, lang)
    .map((c) => `<span class="fmk-tag fmk-tag--${c.tone}">${escapeHtml(c.text)}</span>`).join('');
  return {
    id: 'domains',
    title: t(lang, 'Domaines', 'Domains'),
    summary: levelCounts(tiles.flatMap((tile) => (tile.level === null ? [] : [DOMAIN_LEVEL[tile.level]])), lang),
    html: `<div class="fmk-domains">${grid}</div>${chips ? `<div class="fmk-tags">${chips}</div>` : ''}`,
  };
}

export function energySection(energy: FranceIntelEnergySummary | null, lang: Lang): IndicatorSection {
  const title = t(lang, 'Énergie', 'Energy');
  if (!energy) {
    return {
      id: 'energy', title, summary: escapeHtml(t(lang, 'données partielles', 'partial data')),
      html: `<p class="fmk-muted">${t(lang, 'Aucun profil énergie disponible.', 'No energy profile available.')}</p>`,
    };
  }
  const parts: string[] = [];
  if (energy.ecowattSignal) parts.push(`Écowatt ${levelLabel(officialLevel(energy.ecowattSignal), lang).toLowerCase()}`);
  if (energy.totalMw != null) parts.push(`${formatNumber(energy.totalMw, lang)} MW`);
  const summary = escapeHtml(parts.length > 0 ? parts.join(' · ') : t(lang, 'données partielles', 'partial data'));
  const segments = energySegments(energy);
  const bar = segments.map((s) => `<i style="flex:${s.value};background:${s.color}"></i>`).join('');
  const legend = segments.map((s) => `${ENERGY_LABEL[s.key][lang]} ${percent(s.value, lang)}`).join(' · ');
  const wind = energy.windGw != null
    ? `${formatNumber(Math.round(energy.windGw * 10) / 10, lang)} GW${energy.windLoadFactor != null ? ` · ${t(lang, 'charge', 'load')} ${percent(energy.windLoadFactor, lang)}` : ''}`
    : 'n.d.';
  return {
    id: 'energy', title, summary,
    html: `<div class="fmk-mix" role="img" aria-label="${escapeHtml(legend)}">${bar}</div>`
      + `<p class="fmk-legend">${escapeHtml(legend)}</p>`
      + kvRow(t(lang, 'Production totale', 'Total production'), energy.totalMw != null ? `${formatNumber(energy.totalMw, lang)} MW` : 'n.d.')
      + kvRow(t(lang, 'Éolien en direct', 'Live wind'), escapeHtml(wind)),
  };
}

export function fuelSection(energy: FranceIntelEnergySummary | null, lang: Lang): IndicatorSection | null {
  if (!energy) return null;
  const { oilStocksDays: oilDays, fuelTensionLevel: fuelLevel, fuelTensionAnomalyShare: anomaly, fuelPriceHistory: history } = energy;
  const hasHistory = !!history && history.series.length > 0;
  if (oilDays == null && fuelLevel == null && !hasHistory) return null;
  const oil = oilStatusInfo(energy.oilVigilanceStatus, lang);
  const summaryParts: string[] = [];
  if (fuelLevel != null) summaryParts.push(renderVigilancePill(fuelTensionLevel(fuelLevel), lang));
  if (oilDays != null) summaryParts.push(escapeHtml(t(lang, `stocks ${oilDays} j`, `stocks ${oilDays} d`)));
  const rows: string[] = [];
  if (oilDays != null) {
    const color = oil.level ? levelColorVar(oil.level) : 'var(--text-secondary)';
    rows.push(kvRow(t(lang, 'Stocks nationaux', 'National stocks'), `<span style="color:${color}">${escapeHtml(t(lang, `${oilDays} j · ${oil.label}`, `${oilDays} d · ${oil.label}`))}</span>`));
  }
  if (fuelLevel != null) {
    const share = anomaly != null ? ` ${escapeHtml(t(lang, `${formatNumber(Math.round(anomaly * 10) / 10, lang)} % d’anomalies`, `${anomaly.toFixed(1)}% anomalies`))}` : '';
    rows.push(kvRow(t(lang, 'Tension carburants', 'Fuel tension'), `${renderVigilancePill(fuelTensionLevel(fuelLevel), lang)}${share}`));
  }
  const series = hasHistory ? filterFuelPriceSeries(history, '1m') : [];
  const prices = series.map((s) => kvRow(s.label, `${escapeHtml(formatFuelPrice(s.latestPrice))} <span class="fmk-muted">· ${escapeHtml(t(lang, '7 j', '7 d'))} ${escapeHtml(formatFuelDeltaCents(s.delta7dCents))}</span>`)).join('');
  const chart = series.length > 0 ? renderFuelPriceChartSvg(series, { width: 320, height: 92, showAxes: false }) : '';
  return {
    id: 'fuel',
    title: t(lang, 'Carburants', 'Fuels'),
    summary: summaryParts.length > 0 ? summaryParts.join(' ') : escapeHtml(t(lang, 'prix sur 30 jours', '30-day prices')),
    html: rows.join('') + prices
      + (chart ? `<div class="fmk-sub fmk-eyebrow">${t(lang, 'Prix moyens · 30 jours', 'Average prices · 30 days')}</div><div class="fmk-chart">${chart}</div>` : ''),
  };
}

export function timelineSection(timeline: FranceCountrySnapshot['timeline'], lang: Lang): IndicatorSection {
  const title = t(lang, 'Chronologie 7 jours', '7-day timeline');
  let top: { lane: string; day: string; count: number } | null = null;
  for (const lane of timeline.lanes) {
    for (let i = 0; i < lane.counts.length; i++) {
      const count = lane.counts[i] ?? 0;
      if (count > 0 && (!top || count > top.count)) top = { lane: lane.label, day: timeline.days[i] ?? '', count };
    }
  }
  const summary = escapeHtml(top
    ? t(lang, `pic ${top.lane.toLowerCase()} le ${top.day}`, `peak ${top.lane.toLowerCase()} on ${top.day}`)
    : t(lang, 'calme', 'calm'));
  if (timeline.lanes.length === 0) {
    return { id: 'timeline', title, summary, html: `<p class="fmk-muted">${t(lang, 'Aucun signal sur 7 jours.', 'No signal over 7 days.')}</p>` };
  }
  const columns = `grid-template-columns:5.5rem repeat(${timeline.days.length}, minmax(0, 1fr))`;
  const head = `<span></span>${timeline.days.map((d) => `<span class="fmk-heat-day">${escapeHtml(d)}</span>`).join('')}`;
  const lanes = timeline.lanes.map((lane) => `<span class="fmk-heat-label">${escapeHtml(lane.label)}</span>`
    + lane.counts.map((count) => `<span class="fmk-heat-cell fmk-num" title="${escapeHtml(`${lane.label} : ${count}`)}" style="--c:${lane.color};--a:${timelineIntensity(count)}">${count > 0 ? count : ''}</span>`).join('')).join('');
  return { id: 'timeline', title, summary, html: `<div class="fmk-heat" style="${columns}">${head}${lanes}</div>` };
}
