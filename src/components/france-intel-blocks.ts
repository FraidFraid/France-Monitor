// src/components/france-intel-blocks.ts — blocs « Domaines », « Énergie » et « Chronologie 7 jours »
// du tiroir Intelligence France, extraits en rendus purs (refonte UI, étape 2) pour être partagés
// avec le volet « Pourquoi ce niveau ? » de la fiche France. Aucun accès au DOM : testable sous
// Node. Rendu identique à l'ancien tiroir ; seul l'échappement passe par la version chaîne.

import type {
  FranceCountrySignals,
  FranceCountrySnapshot,
  FranceIntelEnergySummary,
  FranceIntelTimelineLane,
  MeteoVigilanceLevel,
  OilVigilanceStatus,
} from '../types/index.ts';
import { escapeHtml } from './france-intel-events.ts';
import {
  filterFuelPriceSeries,
  formatFuelDeltaCents,
  formatFuelPrice,
  renderFuelPriceChartSvg,
} from '../utils/fuelPriceChart.ts';
import { fuelTensionLevel, levelColorVar, levelLabel, officialLevel, type VigilanceLevel } from '../services/vigilance.ts';
import { renderVigilancePill } from './shared/vigilancePill.ts';
import { MILITARY_FIGURE_LABEL } from '../services/sovereignty-levels.ts';

type Lang = 'fr' | 'en';

function t(lang: Lang, fr: string, en: string): string {
  return lang === 'fr' ? fr : en;
}

/** Libellés des quatre couleurs officielles de la vigilance (spec 2026-10-04 environnement E1). */
const VIGILANCE_LABELS: Record<MeteoVigilanceLevel, string> = {
  green: 'Vert',
  yellow: 'Jaune',
  orange: 'Orange',
  red: 'Rouge',
};

const METEO_RANK: Record<MeteoVigilanceLevel, number> = { green: 0, yellow: 1, orange: 2, red: 3 };

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

export function timelineIntensity(count: number): number {
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
            style="--fi-timeline-color:${lane.color};--fi-timeline-alpha:${timelineIntensity(count)};"
          >${count > 0 ? count : ''}</span>
        `).join('')}
      </div>
    </div>
  `;
}

export type DomainLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * Chiffre distinct d'une tuile à plusieurs parts (tuile « Météo » : vigilance, crues, feux), avec son propre niveau. value et level
 * null : source indisponible, « n.d. » et point gris, hors du niveau de la tuile (S3).
 */
export interface DomainTilePart { label: string; value: number | null; level: DomainLevel | null }

export interface DomainTile {
  label: string;
  /** null : la tuile n'additionne pas ses parts (unités différentes), chacune est affichée. */
  value: number | null;
  meta: string;
  /** null : aucune part lue (toutes indisponibles), point gris, jamais un vert par défaut. */
  level: DomainLevel | null;
  parts?: DomainTilePart[];
}

/** Niveau L1 d'une tuile de domaine (couleurs du point, inchangées depuis le tiroir v1 ; `critical` : rouge). */
export const DOMAIN_LEVEL: Record<DomainLevel, VigilanceLevel> = { low: 'vert', medium: 'jaune', high: 'orange', critical: 'rouge' };

const DOMAIN_RANK: Record<DomainLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };

/** Rouge si un rouge, orange si un orange, vert sinon. */
function partLevel(red: number, any: number): DomainLevel {
  return red > 0 ? 'critical' : any > 0 ? 'high' : 'low';
}

/** Couleur de la pastille Feux vers le niveau de tuile (inverse de DOMAIN_LEVEL). */
const PILL_DOMAIN_LEVEL: Record<VigilanceLevel, DomainLevel> = { vert: 'low', jaune: 'medium', orange: 'high', rouge: 'critical' };

/**
 * Niveau des seuls foyers, pour des signaux sans niveau de pastille (anciennes entrées) : rouge si un foyer majeur, orange si un
 * foyer confirmé d'au moins 10 MW ; jaune pour des foyers confirmés plus petits ou des détections isolées (arbitrage 14) ; vert sinon.
 */
function firePartLevel(s: FranceCountrySignals): DomainLevel {
  if ((s.fireFoyersMajor ?? 0) > 0) return 'critical';
  if ((s.fireFoyersOrange ?? 0) > 0) return 'high';
  return (s.fireFoyersConfirmed ?? 0) > 0 || (s.fireFoyersIsolated ?? 0) > 0 ? 'medium' : 'low';
}

/** Part d'une source : son chiffre et son niveau, ou « n.d. » sans niveau si elle est indisponible (S3). */
function tilePart(label: string, unavailable: boolean | undefined, value: number, level: DomainLevel): DomainTilePart {
  return unavailable === true ? { label, value: null, level: null } : { label, value, level };
}

/**
 * Part « Feux » (arbitrage 14) : couleur de la pastille Feux (firesLevel : foyers et météo des forêts du jour, le plus haut des deux),
 * n.d. si FIRMS et météo des forêts sont indisponibles ; chiffre : foyers confirmés, « n.d. » si FIRMS est indisponible.
 */
function firePart(s: FranceCountrySignals, lang: Lang): DomainTilePart {
  const label = t(lang, 'Feux', 'Fires');
  if (s.firesPillLevel === undefined) return tilePart(label, s.firesUnavailable, s.fireFoyersConfirmed ?? 0, firePartLevel(s));
  return {
    label,
    value: s.firesUnavailable === true ? null : s.fireFoyersConfirmed ?? 0,
    level: s.firesPillLevel === 'nd' ? null : PILL_DOMAIN_LEVEL[s.firesPillLevel],
  };
}

/**
 * Tuile « Météo » (spec 2026-10-04 environnement § 2.7) : départements en vigilance orange ou rouge, tronçons orange ou rouges et
 * foyers confirmés en France, trois chiffres distincts (jamais additionnés) ; niveau = le plus haut des parts lues ; une source
 * indisponible dit « n.d. » (S3) ; aucune part lue : tuile sans niveau.
 */
function meteoTile(s: FranceCountrySignals, lang: Lang): DomainTile {
  const parts: DomainTilePart[] = [
    tilePart(t(lang, 'Vigilance', 'Weather'), s.vigilanceUnavailable, s.meteoAlerts, partLevel(s.meteoRedAlerts ?? 0, s.meteoAlerts)),
    tilePart(t(lang, 'Crues', 'Floods'), s.floodsUnavailable, s.floodAlerts, partLevel(s.floodRedAlerts ?? 0, s.floodAlerts)),
    firePart(s, lang),
  ];
  return {
    label: t(lang, 'Météo', 'Weather'),
    value: null,
    meta: t(lang, 'dépts orange ou rouges · tronçons orange ou rouges · foyers confirmés', 'orange or red depts · orange or red sections · confirmed fires'),
    level: parts.reduce<DomainLevel | null>(
      (m, p) => (p.level !== null && (m === null || DOMAIN_RANK[p.level] > DOMAIN_RANK[m]) ? p.level : m), null,
    ),
    parts,
  };
}

/** Libellé anglais du gros chiffre Défense (O9). */
const MILITARY_FIGURE_LABEL_EN = 'military or state aircraft visible on ADS-B over metropolitan France';

/**
 * Niveau d'une tuile Souveraineté : la pastille de son panneau (mêmes fonctions, arbitrage 14 de l'Environnement) ; n.d. ou source
 * indisponible : sans niveau (point gris) ; pastille absente (anciennes entrées) : l'ancien seuil.
 */
function pillTileLevel(pill: FranceCountrySignals['cyberPillLevel'], unavailable: boolean | undefined, legacy: DomainLevel): DomainLevel | null {
  if (unavailable === true) return null;
  if (pill === undefined) return legacy;
  return pill === 'nd' ? null : PILL_DOMAIN_LEVEL[pill];
}

/** « 7 vulnérabilités » : nombre et nom collés par une espace insécable (R1, la légende passe à la ligne, jamais le compte). */
function countWord(n: number, one: string, many: string): string {
  return `${n}\u00a0${n > 1 ? many : one}`;
}

/**
 * Tuile « Cyber » : gros chiffre du panneau Vigilance cyber (O1 : alertes en cours), niveau = sa pastille. Une source indisponible ou en
 * retard ne donne jamais un compte (S3) : CERT-FR absent, « n.d. » sans compte de vulnérabilités ; catalogue KEV en retard,
 * « vulnérabilités citées non évaluées ».
 */
function cyberTile(s: FranceCountrySignals, lang: Lang): DomainTile {
  const alerts = t(lang, 'alertes CERT-FR en cours', 'CERT-FR alerts in progress');
  const vulnerabilities = s.kevUnavailable === true
    ? t(lang, 'vulnérabilités citées non évaluées', 'cited vulnerabilities not assessed')
    : lang === 'fr'
      ? countWord(s.cyberCritical, 'vulnérabilité exploitée citée', 'vulnérabilités exploitées citées')
      : countWord(s.cyberCritical, 'exploited vulnerability cited', 'exploited vulnerabilities cited');
  return {
    label: 'Cyber',
    value: s.cyberUnavailable === true ? null : s.cyberOpenAlerts ?? s.cyberAlerts,
    meta: s.cyberUnavailable === true ? alerts : `${alerts} · ${vulnerabilities}`,
    level: pillTileLevel(s.cyberPillLevel, s.cyberUnavailable, s.cyberCritical > 0 ? 'high' : s.cyberAlerts > 5 ? 'medium' : 'low'),
  };
}

/**
 * Tuile « Militaire » : gros chiffre Défense (O9) et appareils français ; niveau = pastille Défense (urgences affichées sur deux relevés),
 * jamais le nombre d'aéronefs. adsb.lol indisponible ou en retard : « n.d. », sans compte de français.
 */
function militaryTile(s: FranceCountrySignals, lang: Lang): DomainTile {
  const label = t(lang, MILITARY_FIGURE_LABEL, MILITARY_FIGURE_LABEL_EN);
  return {
    label: t(lang, 'Militaire', 'Military'),
    value: s.militaryUnavailable === true ? null : s.militaryFlights,
    meta: s.militaryUnavailable === true ? label : `${label} · ${s.militaryFrench ?? 0}\u00a0${t(lang, 'français', 'French')}`,
    level: pillTileLevel(s.defensePillLevel, s.militaryUnavailable, s.militaryFlights > 10 ? 'medium' : 'low'),
  };
}

/**
 * Tuile « Défense » : formule inchangée sur les parts lues, navires lents confirmés sur un câble (AIS frais) et mailles à précision GNSS
 * dégradée. Une part non lue est dite « non évaluée » et n'entre ni au chiffre ni au niveau (phase A : aucune grille GNSS, « GNSS non
 * évalué », jamais « GNSS 0 ») ; aucune part lue : « n.d. », point gris.
 */
function defenseTile(s: FranceCountrySignals, lang: Lang): DomainTile {
  const cablesOff = s.cablesUnavailable === true;
  const gnssOff = s.gnssUnavailable === true;
  const cableAlerts = cablesOff ? 0 : s.defenseAlerts;
  const cableHigh = cablesOff ? 0 : s.defenseHigh;
  const cells = gnssOff ? 0 : s.jammingSignals;
  const cables = cablesOff ? t(lang, 'câbles non évalués', 'cables not assessed') : `${t(lang, 'câbles', 'cables')} ${s.defenseAlerts}`;
  const gnss = gnssOff ? t(lang, 'GNSS non évalué', 'GNSS not assessed') : `GNSS ${s.jammingSignals}`;
  return {
    label: t(lang, 'Défense', 'Defense'),
    value: cablesOff && gnssOff ? null : cableAlerts + cells,
    meta: `${cables} · ${gnss}`,
    level: cablesOff && gnssOff ? null : cableHigh > 0 || cells > 0 ? 'high' : cableAlerts > 0 ? 'medium' : 'low',
  };
}

export function domainTiles(s: FranceCountrySignals, lang: Lang): DomainTile[] {
  const outages = s.powerOutages + s.telecomOutages;
  return [
    cyberTile(s, lang),
    {
      label: 'Rail', value: s.railDisruptions,
      meta: `${s.railSevere} ${t(lang, 'fortes', 'severe')}`,
      level: s.railSevere > 0 ? 'high' : s.railDisruptions > 10 ? 'medium' : 'low',
    },
    militaryTile(s, lang),
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
    defenseTile(s, lang),
    meteoTile(s, lang),
    {
      label: 'Finance', value: s.marketStress,
      meta: t(lang, 'lignes sous tension', 'stressed lines'),
      level: s.marketStress > 2 ? 'medium' : 'low',
    },
  ];
}

export interface DomainChip {
  text: string;
  tone: 'warn' | 'crit';
}

/** Étiquettes sous les domaines : risques météo actifs, SNCF fortes, titres critiques. */
export function domainChips(snapshot: Pick<FranceCountrySnapshot, 'signals' | 'meteo'>, lang: Lang): DomainChip[] {
  const s = snapshot.signals;
  const riskMap = new Map<string, { level: MeteoVigilanceLevel; count: number }>();
  for (const alert of snapshot.meteo.filter((item) => item.level !== 'green')) {
    const level = alert.level;
    for (const risk of alert.risks) {
      const prev = riskMap.get(risk);
      riskMap.set(risk, {
        level: prev && METEO_RANK[prev.level] >= METEO_RANK[level] ? prev.level : level,
        count: (prev?.count ?? 0) + 1,
      });
    }
  }
  const chips: DomainChip[] = [];
  for (const [risk, item] of riskMap.entries()) {
    chips.push({ text: `${RISK_LABELS[risk] ?? risk} · ${VIGILANCE_LABELS[item.level]}${item.count > 1 ? ` ×${item.count}` : ''}`, tone: 'warn' });
  }
  if (s.railSevere > 0) chips.push({ text: `${s.railSevere} SNCF ${t(lang, 'fortes', 'severe')}`, tone: 'warn' });
  if (s.criticalNews > 0) chips.push({ text: `${s.criticalNews} ${t(lang, 'titres critiques', 'critical headlines')}`, tone: 'crit' });
  return chips;
}

export type EnergyKey = 'nuclear' | 'gas' | 'hydro' | 'wind' | 'solar' | 'other';

export interface EnergySegment {
  key: EnergyKey;
  color: string;
  value: number;
}

/** Mix de production (couleurs du tiroir v1), segments non nuls. */
export function energySegments(energy: FranceIntelEnergySummary): EnergySegment[] {
  const all: EnergySegment[] = [
    { key: 'nuclear', color: '#7c3aed', value: energy.shares.nuclear },
    { key: 'gas', color: '#2563eb', value: energy.shares.gas },
    { key: 'hydro', color: '#38bdf8', value: energy.shares.hydro },
    { key: 'wind', color: '#60a5fa', value: energy.shares.wind },
    { key: 'solar', color: '#facc15', value: energy.shares.solar },
    { key: 'other', color: '#34c759', value: energy.shares.other },
  ];
  return all.filter((segment) => segment.value > 0);
}

/** Statut des stocks pétroliers : jamais vert pour un statut inconnu. */
export function oilStatusInfo(status: OilVigilanceStatus | null, lang: Lang): { level: VigilanceLevel | null; label: string } {
  if (status === 'critical') return { level: 'rouge', label: t(lang, 'Critique', 'Critical') };
  if (status === 'tense') return { level: 'orange', label: t(lang, 'Sous tension', 'Tense') };
  if (status === 'normal') return { level: 'vert', label: t(lang, 'Normal', 'Normal') };
  return { level: null, label: t(lang, 'Inconnu', 'Unknown') };
}

export function renderDomainsBlock(snapshot: Pick<FranceCountrySnapshot, 'signals' | 'meteo'>, lang: Lang): string {
  const tiles = domainTiles(snapshot.signals, lang);
  // Sans niveau (source indisponible, S3) : point gris.
  const levelColor = (level: DomainLevel | null): string => (level === null ? 'var(--sev-grey)' : levelColorVar(DOMAIN_LEVEL[level]));
  const valueHtml = (tile: DomainTile): string => (tile.parts
    ? tile.parts.map((p) => `<span class="frintel-dom-part"><span class="frintel-dom-dot" style="background:${levelColor(p.level)};"></span>`
      + `${escapeHtml(p.label)} ${p.value ?? 'n.d.'}</span>`).join('')
    : `${tile.value ?? 'n.d.'}`);
  const tilesHtml = tiles.map((tile) => `
    <div class="frintel-dom-tile">
      <span class="frintel-dom-dot" style="background:${levelColor(tile.level)};"></span>
      <span class="frintel-dom-label">${escapeHtml(tile.label)}</span>
      <div class="frintel-dom-value">${valueHtml(tile)} <span class="frintel-dom-meta">${escapeHtml(tile.meta)}</span></div>
    </div>
  `).join('');

  const chips = domainChips(snapshot, lang).map((c) => `<span class="frintel-chip frintel-chip-${c.tone}">${escapeHtml(c.text)}</span>`);

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
  const V1_ENERGY_LABEL: Record<EnergyKey, string> = { nuclear: 'Nuclear', gas: 'Gas', hydro: 'Hydro', wind: 'Wind', solar: 'Solar', other: '' };
  const segments = energy
    ? energySegments(energy).map((seg) => ({ label: seg.key === 'other' ? t(lang, 'Autre', 'Other') : V1_ENERGY_LABEL[seg.key], color: seg.color, value: seg.value }))
    : [];

  return `
    <section class="frintel-card">
      <div class="frintel-card-top">
        <div class="frintel-card-title">${t(lang, 'Énergie', 'Energy')}</div>
        <div class="frintel-card-meta">${energy?.ecowattSignal ? `${t(lang, 'Écowatt (national) : signal', 'Ecowatt (national): signal')} ${levelLabel(officialLevel(energy.ecowattSignal), lang).toLowerCase()}` : t(lang, 'Données partielles', 'Partial data')}</div>
      </div>
      ${energy ? `
        <div class="frintel-energy-stack">
          ${segments.map((segment) => `<span style="width:${segment.value}%;background:${segment.color};"></span>`).join('')}
        </div>
        <div class="frintel-energy-legend">
          ${segments.map((segment) => `
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
          const oil = oilStatusInfo(oilStatus, lang);
          const oilColor = oil.level ? levelColorVar(oil.level) : 'var(--text-secondary)';
          const oilLabel = oil.label;
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
