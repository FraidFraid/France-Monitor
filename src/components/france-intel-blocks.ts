// src/components/france-intel-blocks.ts — blocs « Domaines », « Énergie » et « Chronologie 7 jours »
// du tiroir Intelligence France, extraits en rendus purs (refonte UI, étape 2) pour être partagés
// avec le volet « Pourquoi ce niveau ? » de la fiche France. Aucun accès au DOM : testable sous
// Node. Rendu identique à l'ancien tiroir ; seul l'échappement passe par la version chaîne.

import type {
  FranceCountrySnapshot,
  FranceIntelEnergySummary,
  FranceIntelTimelineLane,
  MeteoVigilanceLevel,
} from '../types/index.ts';
import { escapeHtml } from './france-intel-events.ts';
import {
  filterFuelPriceSeries,
  formatFuelDeltaCents,
  formatFuelPrice,
  renderFuelPriceChartSvg,
} from '../utils/fuelPriceChart.ts';
import { fuelTensionLevel, levelColorVar, levelLabel, officialLevel } from '../services/vigilance.ts';
import { renderVigilancePill } from './shared/vigilancePill.ts';

type Lang = 'fr' | 'en';

function t(lang: Lang, fr: string, en: string): string {
  return lang === 'fr' ? fr : en;
}

const VIGILANCE_LABELS: Record<MeteoVigilanceLevel, string> = {
  green: 'Vert',
  yellow: 'Jaune',
  orange: 'Orange',
  red: 'Rouge',
  violet: 'Violet',
};

const RISK_LABELS: Record<string, string> = {
  wind: 'Vent',
  'rain-flood': 'Pluie-inondation',
  thunderstorm: 'Orages',
  flood: 'Crues',
  'snow-ice': 'Neige-verglas',
  heat: 'Canicule',
  cold: 'Grand froid',
  avalanche: 'Avalanches',
  'wave-surge': 'Vagues-submersion',
};

function intensity(count: number): number {
  if (count <= 0) return 0.08;
  if (count === 1) return 0.25;
  if (count === 2) return 0.45;
  if (count === 3) return 0.65;
  return 0.9;
}

function renderTimelineLane(lane: FranceIntelTimelineLane): string {
  return `
    <div class="frintel-timeline-row">
      <div class="frintel-timeline-label">${escapeHtml(lane.label)}</div>
      <div class="frintel-timeline-track">
        ${lane.counts.map((count) => `
          <span
            class="frintel-timeline-cell"
            title="${escapeHtml(`${lane.label}: ${count}`)}"
            style="--fi-timeline-color:${lane.color};--fi-timeline-alpha:${intensity(count)};"
          >${count > 0 ? count : ''}</span>
        `).join('')}
      </div>
    </div>
  `;
}

export function renderDomainsBlock(snapshot: Pick<FranceCountrySnapshot, 'signals' | 'meteo'>, lang: Lang): string {
  const s = snapshot.signals;
  const outages = s.powerOutages + s.telecomOutages;
  const meteoTotal = s.meteoAlerts + s.floodAlerts + s.fireDetections;
  type Level = 'low' | 'medium' | 'high';
  const tiles: Array<{ label: string; value: number; meta: string; level: Level }> = [
    {
      label: 'Cyber', value: s.cyberAlerts,
      meta: `${t(lang, 'alertes 30j', '30d alerts')} · ${s.cyberCritical} CVE`,
      level: s.cyberCritical > 0 ? 'high' : s.cyberAlerts > 5 ? 'medium' : 'low',
    },
    {
      label: 'Rail', value: s.railDisruptions,
      meta: `${s.railSevere} ${t(lang, 'fortes', 'severe')}`,
      level: s.railSevere > 0 ? 'high' : s.railDisruptions > 10 ? 'medium' : 'low',
    },
    {
      label: t(lang, 'Militaire', 'Military'), value: s.militaryFlights,
      meta: t(lang, 'vols actifs', 'active flights'),
      level: s.militaryFlights > 10 ? 'medium' : 'low',
    },
    {
      label: 'Maritime', value: s.maritimeTrafficFrance,
      meta: t(lang, 'navires zone FR', 'ships FR waters'),
      level: 'low',
    },
    {
      label: t(lang, 'Pannes', 'Outages'), value: outages,
      meta: `${t(lang, 'élec', 'power')} ${s.powerOutages} · ${t(lang, 'télécom', 'telecom')} ${s.telecomOutages}`,
      level: outages > 5 ? 'high' : outages > 0 ? 'medium' : 'low',
    },
    {
      label: t(lang, 'Défense', 'Defense'), value: s.defenseAlerts + s.jammingSignals,
      meta: `${t(lang, 'câbles', 'cables')} ${s.defenseAlerts} · GPS ${s.jammingSignals}`,
      level: s.defenseHigh > 0 || s.jammingSignals > 0 ? 'high' : s.defenseAlerts > 0 ? 'medium' : 'low',
    },
    {
      label: t(lang, 'Météo', 'Weather'), value: meteoTotal,
      meta: `${t(lang, 'vigies', 'watches')} ${s.meteoAlerts} · ${t(lang, 'crues', 'floods')} ${s.floodAlerts} · ${t(lang, 'feux', 'fires')} ${s.fireDetections}`,
      level: s.meteoAlerts > 3 || s.floodAlerts > 2 ? 'high' : meteoTotal > 0 ? 'medium' : 'low',
    },
    {
      label: 'Finance', value: s.marketStress,
      meta: t(lang, 'lignes sous tension', 'stressed lines'),
      level: s.marketStress > 2 ? 'medium' : 'low',
    },
  ];
  const levelColor: Record<Level, string> = {
    low: levelColorVar('vert'), medium: levelColorVar('jaune'), high: levelColorVar('orange'),
  };
  const tilesHtml = tiles.map((tile) => `
    <div class="frintel-dom-tile">
      <span class="frintel-dom-dot" style="background:${levelColor[tile.level]};"></span>
      <span class="frintel-dom-label">${escapeHtml(tile.label)}</span>
      <div class="frintel-dom-value">${tile.value} <span class="frintel-dom-meta">${escapeHtml(tile.meta)}</span></div>
    </div>
  `).join('');

  // Chips vigilances météo actives (même logique qu'avant, sans emoji)
  const riskMap = new Map<string, { level: MeteoVigilanceLevel; count: number }>();
  for (const alert of snapshot.meteo.filter((item) => item.level !== 'green')) {
    for (const risk of alert.risks) {
      const prev = riskMap.get(risk);
      riskMap.set(risk, {
        level: prev && (prev.level === 'red' || prev.level === 'violet') ? prev.level : alert.level,
        count: (prev?.count ?? 0) + 1,
      });
    }
  }
  const chips: string[] = [];
  for (const [risk, item] of riskMap.entries()) {
    chips.push(`<span class="frintel-chip frintel-chip-warn">${escapeHtml(RISK_LABELS[risk] ?? risk)} · ${escapeHtml(VIGILANCE_LABELS[item.level])}${item.count > 1 ? ` ×${item.count}` : ''}</span>`);
  }
  if (s.railSevere > 0) chips.push(`<span class="frintel-chip frintel-chip-warn">${s.railSevere} SNCF ${t(lang, 'fortes', 'severe')}</span>`);
  if (s.criticalNews > 0) chips.push(`<span class="frintel-chip frintel-chip-crit">${s.criticalNews} ${t(lang, 'titres critiques', 'critical headlines')}</span>`);

  return `
    <section class="frintel-card">
      <div class="frintel-card-top">
        <div class="frintel-card-title">${t(lang, 'Domaines', 'Domains')}</div>
        <div class="frintel-card-meta">${t(lang, 'État par domaine de surveillance', 'Status by watch domain')}</div>
      </div>
      <div class="frintel-dom-grid">${tilesHtml}</div>
      ${chips.length > 0 ? `<div class="frintel-chip-wrap">${chips.join('')}</div>` : ''}
    </section>
  `;
}

export function renderEnergyBlock(energy: FranceIntelEnergySummary | null, lang: Lang): string {
  const energySegments = energy
    ? [
        { label: 'Nuclear', color: '#7c3aed', value: energy.shares.nuclear },
        { label: 'Gas', color: '#2563eb', value: energy.shares.gas },
        { label: 'Hydro', color: '#38bdf8', value: energy.shares.hydro },
        { label: 'Wind', color: '#60a5fa', value: energy.shares.wind },
        { label: 'Solar', color: '#facc15', value: energy.shares.solar },
        { label: t(lang, 'Autre', 'Other'), color: '#34c759', value: energy.shares.other },
      ].filter((segment) => segment.value > 0)
    : [];

  return `
    <section class="frintel-card">
      <div class="frintel-card-top">
        <div class="frintel-card-title">${t(lang, 'Énergie', 'Energy')}</div>
        <div class="frintel-card-meta">${energy?.ecowattSignal ? `${t(lang, 'Écowatt : signal', 'Ecowatt: signal')} ${levelLabel(officialLevel(energy.ecowattSignal), lang).toLowerCase()}` : t(lang, 'Données partielles', 'Partial data')}</div>
      </div>
      ${energy ? `
        <div class="frintel-energy-stack">
          ${energySegments.map((segment) => `<span style="width:${segment.value}%;background:${segment.color};"></span>`).join('')}
        </div>
        <div class="frintel-energy-legend">
          ${energySegments.map((segment) => `
            <div class="frintel-energy-row">
              <span class="frintel-energy-dot" style="background:${segment.color};"></span>
              <span>${escapeHtml(segment.label)} ${segment.value}%</span>
            </div>
          `).join('')}
        </div>
        <div class="frintel-energy-meta">
          <span>${t(lang, 'Production totale', 'Total production')} ${energy.totalMw ?? 'n/a'} MW</span>
          <span>${t(lang, 'Éolien live', 'Live wind')} ${energy.windGw != null ? `${energy.windGw.toFixed(1)} GW` : 'n/a'}</span>
          <span>${t(lang, 'Charge éolienne', 'Wind load factor')} ${energy.windLoadFactor != null ? `${energy.windLoadFactor}%` : 'n/a'}</span>
        </div>
        ${(() => {
          const oilDays = energy.oilStocksDays;
          const oilStatus = energy.oilVigilanceStatus;
          const fuelLevel = energy.fuelTensionLevel;
          const fuelAnomaly = energy.fuelTensionAnomalyShare;
          const fuelHistory = energy.fuelPriceHistory;
          const hasFuelHistory = !!fuelHistory && fuelHistory.series.length > 0;
          if (!oilDays && !fuelLevel && !hasFuelHistory) return '';
          // Jamais vert pour un statut inconnu (couleur neutre) ; les autres statuts suivent L1.
          const oilColor = oilStatus === 'critical' ? levelColorVar('rouge')
            : oilStatus === 'tense' ? levelColorVar('orange')
            : oilStatus === 'normal' ? levelColorVar('vert')
            : 'var(--text-secondary)';
          const oilLabel = oilStatus === 'critical' ? t(lang, 'Critique', 'Critical')
            : oilStatus === 'tense' ? t(lang, 'Sous tension', 'Tense')
            : oilStatus === 'normal' ? t(lang, 'Normal', 'Normal')
            : t(lang, 'Inconnu', 'Unknown');
          const visibleSeries = hasFuelHistory ? filterFuelPriceSeries(fuelHistory, '1m') : [];
          const fuelChart = visibleSeries.length > 0
            ? renderFuelPriceChartSvg(visibleSeries, {
                width: 320,
                height: 92,
                showAxes: false,
              })
            : '';
          const fuelLegend = visibleSeries.map((series) => `
            <div class="frintel-fuel-row">
              <span class="frintel-fuel-name">
                <span class="frintel-fuel-dot" style="background:${series.color};"></span>
                ${escapeHtml(series.label)}
              </span>
              <span class="frintel-fuel-value">${escapeHtml(formatFuelPrice(series.latestPrice))}</span>
              <span class="frintel-fuel-delta" style="color:var(--text-secondary);">7j ${escapeHtml(formatFuelDeltaCents(series.delta7dCents))}</span>
            </div>
          `).join('');
          return `
            <div class="frintel-oil-block">
              <div class="frintel-oil-title">${t(lang, 'Pétrole & Carburants', 'Oil & Fuels')}</div>
              <div class="frintel-oil-grid">
                ${oilDays != null ? `
                  <div class="frintel-oil-row">
                    <span class="frintel-oil-label">${t(lang, 'Stocks nationaux', 'National stocks')}</span>
                    <span class="frintel-oil-value" style="color:${oilColor};">${oilDays}j <span class="frintel-oil-badge" style="color:${oilColor};">${escapeHtml(oilLabel)}</span></span>
                  </div>
                ` : ''}
                ${fuelLevel != null ? `
                  <div class="frintel-oil-row">
                    <span class="frintel-oil-label">${t(lang, 'Tension carburants', 'Fuel tension')}</span>
                    <span class="frintel-oil-value">
                      ${renderVigilancePill(fuelTensionLevel(fuelLevel), lang)}
                      ${fuelAnomaly != null ? ` <span class="frintel-oil-badge" style="color:${levelColorVar(fuelTensionLevel(fuelLevel))};">${fuelAnomaly.toFixed(1)}% ${t(lang, 'anomalies', 'anomalies')}</span>` : ''}
                    </span>
                  </div>
                ` : ''}
              </div>
              ${fuelChart ? `
                <div class="frintel-fuel-history">
                  <div class="frintel-fuel-history-title">${t(lang, 'Prix moyens carburants · 30 jours', 'Average fuel prices · 30 days')}</div>
                  <div class="frintel-fuel-chart">${fuelChart}</div>
                  <div class="frintel-fuel-legend">${fuelLegend}</div>
                </div>
              ` : ''}
            </div>
          `;
        })()}
      ` : `<div class="frintel-empty">${t(lang, 'Aucun profil énergie disponible.', 'No energy profile available.')}</div>`}
    </section>
  `;
}

export function renderTimelineBlock(timeline: FranceCountrySnapshot['timeline'], lang: Lang): string {
  return `
    <section class="frintel-card">
      <div class="frintel-card-top">
        <div class="frintel-card-title">${t(lang, 'Chronologie 7 jours', '7-Day Timeline')}</div>
        <div class="frintel-card-meta">${t(lang, 'Lecture par intensité de signal', 'Signal intensity view')}</div>
      </div>
      <div class="frintel-timeline-head">
        <div></div>
        <div class="frintel-timeline-days">
          ${timeline.days.map((day) => `<span>${escapeHtml(day)}</span>`).join('')}
        </div>
      </div>
      <div class="frintel-timeline">
        ${timeline.lanes.map(renderTimelineLane).join('')}
      </div>
    </section>
  `;
}
