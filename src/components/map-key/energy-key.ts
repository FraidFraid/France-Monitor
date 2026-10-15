// src/components/map-key/energy-key.ts
/**
 * energy-key.ts : bloc Énergie de la légende « Lire la carte » (spec 2026-10-15, proposition B).
 * Même grammaire que events-key.ts : couleur = état (une ligne par état présent, nombre, clic = masquer),
 * picto = filière, inventaire en tons neutres reconnu à sa forme, seulement ce qui est à l'écran.
 */
import type { EnergyKeyModel } from '../deckgl/energy-map.ts';
import { REGION_BALANCE_COLORS } from '../deckgl/constants.ts';
import {
  ENERGY_FLOW_HEX, ENERGY_NETWORK_HEX, ENERGY_SECTOR_ICON, ENERGY_SECTOR_LABEL, ENERGY_STATE_HEX, ENERGY_STATE_LABEL,
  ENERGY_STATE_PHRASE, ENERGY_STATES,
} from '../../services/energy-state.ts';
import { levelHex } from '../../services/vigilance.ts';
import { fmIcon } from '../shared/icons.ts';
import { nestedCirclesSvg } from './events-key.ts';

const NBSP = ' ';
const STROKE = 'rgba(10,10,18,0.9)';

function dot(color: string, r = 7): string {
  const d = r * 2 + 4;
  return `<svg width="${d}" height="${d}" viewBox="0 0 ${d} ${d}" aria-hidden="true"><circle cx="${d / 2}" cy="${d / 2}" r="${r}" fill="${color}" stroke="${STROKE}"/></svg>`;
}

function shape(kind: 'circle' | 'triangle' | 'square' | 'diamond', color: string): string {
  const body = kind === 'circle' ? `<circle cx="8" cy="8" r="6" fill="${color}" stroke="${STROKE}"/>`
    : kind === 'triangle' ? `<path d="M8 2 14 13H2z" fill="${color}" stroke="${STROKE}"/>`
      : kind === 'square' ? `<rect x="2" y="2" width="12" height="12" fill="${color}" stroke="${STROKE}"/>`
        : `<path d="M8 1 15 8 8 15 1 8z" fill="${color}" stroke="${STROKE}"/>`;
  return `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">${body}</svg>`;
}

function line(dashed: boolean, color = ENERGY_NETWORK_HEX): string {
  return `<svg width="22" height="10" aria-hidden="true"><line x1="1" y1="5" x2="21" y2="5" stroke="${color}" stroke-width="3"${dashed ? ' stroke-dasharray="6 3"' : ''}/></svg>`;
}

function arrow(dir: 'out' | 'in'): string {
  const d = dir === 'out' ? 'M2 6h16m-5-4 5 4-5 4' : 'M20 6H4m5-4-5 4 5 4';
  return `<svg width="22" height="12" aria-hidden="true"><path d="${d}" fill="none" stroke="${ENERGY_FLOW_HEX}" stroke-width="2"/></svg>`;
}

function staticRow(sym: string, label: string, n: number | null = null): string {
  return `<div class="mk-row mk-row--static"><span class="mk-sym">${sym}</span><span class="mk-lbl">${label}</span><span class="mk-n">${n ?? ''}</span></div>`;
}

function statesBlock(m: EnergyKeyModel): string {
  const rows = ENERGY_STATES.filter((s) => m.counts[s] > 0).map((s) => {
    const on = !m.hiddenStates.has(s);
    return `<button type="button" class="mk-row${on ? '' : ' mk-row--off'}" data-key-action="energy:${s}" aria-pressed="${on}" title="Afficher ou masquer cet état">`
      + `<span class="mk-sym">${dot(ENERGY_STATE_HEX[s])}</span><span class="mk-lbl"><b>${ENERGY_STATE_LABEL[s]}</b> · ${ENERGY_STATE_PHRASE[s]}</span>`
      + `<span class="mk-n">${m.counts[s]}</span></button>`;
  }).join('');
  const icons = m.alertSectors.length > 0
    ? `<div class="mk-sub">Pictogramme : filière (à l’arrêt ou sous tension)</div><div class="mk-icons">${m.alertSectors.map(([sector, state]) =>
      `<span><i class="mk-pic" style="--r:11px;--lvl:${ENERGY_STATE_HEX[state]}">${fmIcon(ENERGY_SECTOR_ICON[sector], { size: 11 })}</i>${ENERGY_SECTOR_LABEL[sector]}</span>`).join('')}</div>`
    : '';
  const empty = rows === '' ? '<p class="mk-sub">Aucune installation sur la carte.</p>' : '';
  return '<section class="mk" aria-label="État des installations"><h3>État des installations <small>toutes filières</small></h3>'
    + `<div class="mk-sub">Couleur : état de l’installation</div>${rows}${empty}${icons}</section>`;
}

function networksBlock(m: EnergyKeyModel): string {
  const parts: string[] = [];
  const lines = [
    m.networks.gas ? staticRow(line(false), 'Gazoduc') : '',
    m.networks.oil ? staticRow(line(true), 'Oléoduc') : '',
    m.networks.drom ? staticRow(line(false, '#aeaeb2'), 'Ligne HTA (outre-mer)') : '',
  ].join('');
  if (lines) parts.push(`<div class="mk-sub">Trait : réseau de transport</div>${lines}`);
  if (m.flows.exports + m.flows.imports > 0) {
    parts.push('<div class="mk-sub">Flèche : échange avec l’étranger, épaisseur = volume</div>'
      + (m.flows.exports > 0 ? staticRow(arrow('out'), 'Export · vers la frontière', m.flows.exports) : '')
      + (m.flows.imports > 0 ? staticRow(arrow('in'), 'Import · depuis la frontière', m.flows.imports) : ''));
  }
  if (m.regions) {
    const sw = (c: string): string => `<svg width="16" height="12" aria-hidden="true"><rect width="16" height="12" fill="${c}" stroke="rgba(255,255,255,0.25)"/></svg>`;
    parts.push('<div class="mk-sub">Fond des régions : solde électrique (ce n’est pas une vigilance)</div><div class="mk-icons">'
      + `<span>${sw(REGION_BALANCE_COLORS.exportatrice)}exporte</span><span>${sw(REGION_BALANCE_COLORS.importatrice)}importe</span>`
      + `<span>${sw(REGION_BALANCE_COLORS.equilibree)}équilibrée</span></div>`);
  }
  if (m.fuelTension) {
    const ft = m.fuelTension;
    const fill = (lvl: 'rouge' | 'orange' | 'jaune'): string => `<svg width="16" height="12" aria-hidden="true"><rect width="16" height="12" fill="${levelHex(lvl)}" fill-opacity="0.45" stroke="${levelHex(lvl)}"/></svg>`;
    const rows = ([['rouge', 'Tension critique'], ['orange', 'Tension forte'], ['jaune', 'Tension moyenne']] as const)
      .filter(([lvl]) => ft[lvl] > 0).map(([lvl, label]) => staticRow(fill(lvl), label, ft[lvl])).join('');
    if (rows) parts.push(`<div class="mk-sub">Fond des départements : tension carburants</div>${rows}`);
  }
  if (parts.length === 0) return '';
  return `<section class="mk" aria-label="Réseaux et flux"><h3>Réseaux et flux <small>inventaire</small></h3>${parts.join('')}</section>`;
}

function sitesBlock(m: EnergyKeyModel): string {
  const grey = ENERGY_STATE_HEX.nonSuivi;
  const shapes = [
    m.shapes.reactor ? `<span>${shape('circle', grey)}Réacteur, unité</span>` : '',
    m.shapes.refinery ? `<span>${shape('triangle', grey)}Raffinerie</span>` : '',
    m.shapes.storage ? `<span>${shape('square', grey)}Stockage, terminal</span>` : '',
    m.shapes.hydro ? `<span>${shape('diamond', grey)}Barrage, STEP</span>` : '',
  ].join('');
  const wind = m.windClusters
    ? '<div class="mk-sub">Taille : éoliennes regroupées</div><div class="mk-key">'
      + nestedCirclesSvg([14, 10, 7], [`200${NBSP}éoliennes et plus`, `50 à 199`, `moins de 50`], 'Éoliennes regroupées') + '</div>'
    : '';
  const metro = m.metro ? '<div class="mk-sub">Taille : consommation relative des métropoles (grand = forte)</div>' : '';
  if (!shapes && !wind && !metro) return '';
  return '<section class="mk" aria-label="Sites"><h3>Sites <small>forme = filière</small></h3>'
    + (shapes ? `<div class="mk-icons">${shapes}</div>` : '') + wind + metro + '</section>';
}

export function buildEnergyKeyHtml(m: EnergyKeyModel): string {
  if (!m.visible) return '';
  return statesBlock(m) + networksBlock(m) + sitesBlock(m);
}
