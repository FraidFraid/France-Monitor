// src/components/france-intel-score.ts — rendu HTML pur de la carte « niveau national » et des
// lignes de situation du tiroir Intelligence France, dans le langage commun L1 (refonte UI,
// spec §4). Aucun accès au DOM : testable sous Node. L'indice chiffré, les piliers et le
// plafond ne sont visibles que dans le volet replié « Pourquoi ce niveau ? ».

import type { DetectedSituation, FranceScoreBreakdown } from '../types/index.ts';
import type { StabilityPillarValues } from '../utils/stability-history.ts';
import { escapeHtml } from './france-intel-events.ts';
import { renderVigilancePill } from './shared/vigilancePill.ts';
import {
  confidenceLabel,
  levelColorVar,
  levelPhrase,
  scoreLevel,
  situationLevel,
  type VigilanceLevel,
} from '../services/vigilance.ts';

type Lang = 'fr' | 'en';

function t(lang: Lang, fr: string, en: string): string {
  return lang === 'fr' ? fr : en;
}

const PILLAR_UI: ReadonlyArray<{ key: FranceScoreBreakdown['pillars'][number]['key']; fr: string; en: string }> = [
  { key: 'continuity', fr: 'Continuité', en: 'Continuity' },
  { key: 'security', fr: 'Sécurité', en: 'Security' },
  { key: 'signal', fr: 'Signal', en: 'Signal' },
  { key: 'defense', fr: 'Défense', en: 'Defense' },
];

export interface ScoreCardInput {
  breakdown: FranceScoreBreakdown;
  delta24h: number | null;
  pillarDeltas: StabilityPillarValues | null;
  series: number[];
  lang: Lang;
  whyOpen: boolean;
}

/** « tirée par … » : les deux premières composantes du pilier qui retire le plus de points. HTML échappé. */
export function scoreDriverText(breakdown: FranceScoreBreakdown, lang: Lang): string {
  const dominant = [...breakdown.pillars].sort((a, b) => b.deduction - a.deduction)[0];
  if (!dominant || dominant.deduction < 1) return t(lang, 'sans pression dominante', 'no dominant pressure');
  const parts = dominant.components.slice(0, 2).map((c) => escapeHtml(c.label));
  if (parts.length > 0) return `${t(lang, 'tirée par', 'driven by')} ${parts.join(', ')}`;
  const ui = PILLAR_UI.find((p) => p.key === dominant.key);
  const name = ui ? t(lang, ui.fr, ui.en).toLowerCase() : escapeHtml(dominant.key);
  return `${t(lang, 'tirée par', 'driven by')} ${name}`;
}

function trendText(delta: number | null, lang: Lang): string {
  if (delta == null || delta === 0) return '';
  return delta < 0
    ? t(lang, 'en dégradation sur 24 h', 'worsening over 24 h')
    : t(lang, 'en amélioration sur 24 h', 'improving over 24 h');
}

/** Pilier = pression 0–100 (plus haut = pire) ; mêmes seuils que l'ancien affichage. */
function pillarLevel(value: number): VigilanceLevel {
  if (value >= 55) return 'orange';
  if (value >= 35) return 'jaune';
  return 'vert';
}

function formatDelta(delta: number | null | undefined): string {
  if (delta == null) return '—';
  if (delta > 0) return `+${delta} ▲`;
  if (delta < 0) return `−${Math.abs(delta)} ▼`;
  return '0 ·';
}

function renderSparkline(series: number[], level: VigilanceLevel, lang: Lang): string {
  if (series.length < 2) return '';
  const W = 200;
  const H = 26;
  const min = Math.min(...series) - 2;
  const max = Math.max(...series) + 2;
  const range = max - min || 1;
  const toX = (i: number): number => (i / (series.length - 1)) * W;
  const toY = (v: number): number => H - ((v - min) / range) * H;
  const pts = series.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ');
  const last = series[series.length - 1];
  return `
    <svg class="frintel-spark" viewBox="0 0 ${W} ${H}" role="img"
      aria-label="${t(lang, 'Historique de l’indice sur 7 jours', '7-day index history')}">
      <polyline points="${pts}" fill="none" stroke="var(--text-accent)" stroke-width="1.5"/>
      <circle cx="${toX(series.length - 1).toFixed(1)}" cy="${toY(last).toFixed(1)}" r="2" fill="${levelColorVar(level)}"/>
    </svg>
    <div class="frintel-spark-caption">${t(lang, '7 jours', '7 days')}</div>
  `;
}

export function renderScoreCard(input: ScoreCardInput): string {
  const { breakdown: bd, lang } = input;
  const level = scoreLevel(bd.score);
  const trend = trendText(input.delta24h, lang);

  const pillarRows = PILLAR_UI.map(({ key, fr, en }) => {
    const pillar = bd.pillars.find((p) => p.key === key);
    if (!pillar) return '';
    const delta = input.pillarDeltas ? input.pillarDeltas[key] : null;
    return `
      <div class="frintel-pillar-label">${t(lang, fr, en)}</div>
      <div class="frintel-pillar-track"><span class="frintel-pillar-fill" style="width:${Math.min(100, pillar.value)}%;background:${levelColorVar(pillarLevel(pillar.value))};"></span></div>
      <div class="frintel-pillar-val">${pillar.value}</div>
      <div class="frintel-pillar-delta">${formatDelta(delta)}</div>
      <div class="frintel-pillar-ded">−${pillar.deduction.toFixed(1)}</div>
    `;
  }).join('');

  const capLine = bd.situationCap != null
    ? `<div class="frintel-score-cap">${t(lang, `Indice plafonné à ${bd.situationCap} tant qu'une situation corrélée est active`, `Index capped at ${bd.situationCap} while a correlated situation is active`)}</div>`
    : '';

  return `
    <section class="frintel-card frintel-level-card">
      <div class="frintel-level-row">
        ${renderVigilancePill(level, lang)}
        <span class="frintel-level-phrase">${levelPhrase(level, lang)}</span>
      </div>
      <div class="frintel-level-driver">${scoreDriverText(bd, lang)}${trend ? ` · ${trend}` : ''}</div>
      <details class="frintel-why"${input.whyOpen ? ' open' : ''}>
        <summary>${t(lang, 'Pourquoi ce niveau ?', 'Why this level?')}</summary>
        <div class="frintel-why-body">
          <div class="frintel-why-index">${t(lang, `Indice de stabilité ${bd.score}/100 (base ${bd.baseline}, moins la pression en temps réel)`, `Stability index ${bd.score}/100 (baseline ${bd.baseline}, minus live pressure)`)}</div>
          <div class="frintel-gauge" role="img" aria-label="${t(lang, `Indice ${bd.score} sur 100`, `Index ${bd.score} out of 100`)}">
            <span class="frintel-gauge-zone" style="width:55%;background:${levelColorVar('rouge')};"></span>
            <span class="frintel-gauge-zone" style="width:15%;background:${levelColorVar('orange')};"></span>
            <span class="frintel-gauge-zone" style="width:15%;background:${levelColorVar('jaune')};"></span>
            <span class="frintel-gauge-zone" style="width:15%;background:${levelColorVar('vert')};"></span>
            <span class="frintel-gauge-marker" style="left:${bd.score}%;"></span>
          </div>
          <div class="frintel-gauge-scale"><span>0</span><span>100</span></div>
          ${renderSparkline(input.series, level, lang)}
          <div class="frintel-pillars">${pillarRows}</div>
          ${capLine}
        </div>
      </details>
    </section>
  `;
}

export function renderSituationRow(s: DetectedSituation, lang: Lang, expanded: boolean): string {
  const level = situationLevel(s.severity);
  const id = escapeHtml(s.id);
  const detailId = `frintel-sit-detail-${id}`;
  const drivers = s.drivers.map((d, i) => `
    <div class="frintel-sit-driver">${i === s.drivers.length - 1 ? '└─' : '├─'} ${escapeHtml(d)}</div>
  `).join('');
  const zoneChips = s.affectedZones.slice(0, 4).map((z) => `<span class="frintel-chip frintel-chip-zone">${escapeHtml(z)}</span>`).join('');
  const sourceChips = s.sourceRefs.slice(0, 5).map((r) => `<span class="frintel-chip">${escapeHtml(r)}</span>`).join('');
  const actionChips = s.recommendedActions.slice(0, 3).map((a) => `<span class="frintel-chip">${t(lang, 'Action', 'Action')} : ${escapeHtml(a.label)}</span>`).join('');
  return `
    <article class="frintel-sit${expanded ? ' is-expanded' : ''}" data-sit-id="${id}">
      <span class="frintel-sit-rail" style="background:${levelColorVar(level)};"></span>
      <div class="frintel-sit-body">
        <button type="button" class="frintel-sit-head" aria-expanded="${expanded ? 'true' : 'false'}"${expanded ? ` aria-controls="${detailId}"` : ''}>
          ${renderVigilancePill(level, lang)}
          <span class="frintel-sit-conf">${confidenceLabel(s.confidence, lang)}</span>
        </button>
        <div class="frintel-sit-title">${escapeHtml(s.title)}</div>
        ${expanded ? `
          <div class="frintel-sit-detail" id="${detailId}">
            <p class="frintel-sit-summary">${escapeHtml(s.summary)}</p>
            <div class="frintel-sit-drivers">${drivers}</div>
            <div class="frintel-sit-tags">${zoneChips}${sourceChips}${actionChips}</div>
          </div>
        ` : ''}
      </div>
    </article>
  `;
}
