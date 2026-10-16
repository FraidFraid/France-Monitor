// src/components/map-key/energy-key.ts
/**
 * energy-key.ts : bloc Énergie de la légende « Lire la carte » (spec 2026-10-16 § 8). Quatre sections, seulement ce qui est à
 * l'écran : état des installations (couleur, clic = masquer), filières (teinte et picto), échanges avec l'étranger (couleur =
 * filière et sens), contexte (fonds, réseaux, inventaire).
 */
import type { EnergyKeyModel } from '../deckgl/energy-map.ts';
import { REGION_BALANCE_COLORS } from '../deckgl/constants.ts';
import {
  ENERGY_CHOKE_HEX, ENERGY_DISC_STATE_HEX, ENERGY_FLOW_COLORS, ENERGY_SECTOR_HEX, ENERGY_SECTOR_ICON, ENERGY_SECTOR_LABEL,
  ENERGY_STATE_HEX, ENERGY_STATE_LABEL, ENERGY_STATE_PHRASE, ENERGY_STATES, type EnergyFlowKind, type EnergySector, type EnergyState,
} from '../../services/energy-state.ts';
import { levelHex } from '../../services/vigilance.ts';
import { fmIcon } from '../shared/icons.ts';
import { nestedCirclesSvg } from './events-key.ts';
import { metroRadiusPx } from '../deckgl/energy-map.ts';

const NBSP = '\u00a0';

const STROKE = 'rgba(10,10,18,0.9)';

function dot(color: string, r = 7, opacity = 1): string {
  const d = r * 2 + 4;
  return `<svg width="${d}" height="${d}" viewBox="0 0 ${d} ${d}" aria-hidden="true"><circle cx="${d / 2}" cy="${d / 2}" r="${r}" fill="${color}" fill-opacity="${opacity}" stroke="${STROKE}"/></svg>`;
}

/** « Normal » et « Sans état suivi » : rangée de petits disques aux teintes des filières présentes (le vert n'est pas dessiné). */
function sectorDots(sectors: readonly EnergySector[], opacity: number): string {
  const list = sectors.length > 0 ? sectors.slice(0, 3) : (['nucleaire'] as const);
  return `<span class="mk-dots">${list.map((x) => dot(ENERGY_SECTOR_HEX[x], 4, opacity)).join('')}</span>`;
}

function line(color: string, dashed: boolean): string {
  return `<svg width="22" height="10" aria-hidden="true"><line x1="1" y1="5" x2="21" y2="5" stroke="${color}" stroke-width="3"${dashed ? ' stroke-dasharray="6 3"' : ''}/></svg>`;
}

/** Flèche de 34 × 12 à la couleur du flux. */
function flowArrow(color: string): string {
  return `<svg width="34" height="12" viewBox="0 0 34 12" aria-hidden="true"><line x1="1" y1="6" x2="24" y2="6" stroke="${color}" stroke-width="4"/>`
    + `<path d="M23 1 33 6 23 11z" fill="${color}"/></svg>`;
}

function staticRow(sym: string, label: string, n: number | null = null): string {
  return `<div class="mk-row mk-row--static"><span class="mk-sym">${sym}</span><span class="mk-lbl">${label}</span><span class="mk-n">${n ?? ''}</span></div>`;
}

function stateSymbol(s: EnergyState, m: EnergyKeyModel): string {
  if (s === 'normal') return sectorDots(m.sectors, 1);
  if (s === 'nonSuivi') return sectorDots(m.sectors, 0.55);
  if (s === 'arret' || s === 'tension' || s === 'reduit' || s === 'maintenance') return dot(ENERGY_DISC_STATE_HEX[s]);
  return dot(ENERGY_STATE_HEX[s]);
}

function statesBlock(m: EnergyKeyModel): string {
  const rows = ENERGY_STATES.filter((s) => m.counts[s] > 0).map((s) => {
    const on = !m.hiddenStates.has(s);
    return `<button type="button" class="mk-row${on ? '' : ' mk-row--off'}" data-key-action="energy:${s}" aria-pressed="${on}" title="Afficher ou masquer cet état">`
      + `<span class="mk-sym">${stateSymbol(s, m)}</span><span class="mk-lbl"><b>${ENERGY_STATE_LABEL[s]}</b> · ${ENERGY_STATE_PHRASE[s]}</span>`
      + `<span class="mk-n">${m.counts[s]}</span></button>`;
  }).join('');
  const empty = rows === '' ? '<p class="mk-sub">Aucune installation sur la carte.</p>' : '';
  return '<section class="mk" aria-label="État des installations"><h3>État des installations <small>toutes filières</small></h3>'
    + `<div class="mk-sub">Couleur : état de l’installation. Les couleurs vives ne servent qu’aux états anormaux.</div>${rows}${empty}</section>`;
}

function sectorsBlock(m: EnergyKeyModel): string {
  if (m.sectors.length === 0 && !m.clusters) return '';
  const disc = (x: EnergySector): string => `<i class="mk-pic" style="--r:8px;--lvl:${ENERGY_SECTOR_HEX[x]}">${fmIcon(ENERGY_SECTOR_ICON[x], { size: 10 })}</i>`;
  const rows = m.sectors.map((x) => staticRow(disc(x), ENERGY_SECTOR_LABEL[x])).join('');
  const groups = m.clusters
    ? staticRow(dot(ENERGY_SECTOR_HEX.eolien, 7), 'Groupe de barrages ou d’éoliennes, orange s’il contient une alerte')
    : '';
  return '<section class="mk" aria-label="Filières"><h3>Filières <small>teinte et picto</small></h3>' + rows + groups + '</section>';
}

const FLOW_LABEL: Readonly<Record<EnergyFlowKind, { export: string; import: string }>> = {
  elec: { export: 'Électricité · export', import: 'Électricité · import' },
  gaz: { export: 'Gaz · export', import: 'Gaz · import' },
  petrole: { export: 'Pétrole · export', import: 'Pétrole · import, route maritime, épaisseur = volume' },
};

function flowsBlock(m: EnergyKeyModel): string {
  const rows = m.flowKinds.flatMap((f) => [
    f.exports > 0 ? staticRow(flowArrow(ENERGY_FLOW_COLORS[f.kind].export), FLOW_LABEL[f.kind].export, f.exports) : '',
    f.imports > 0 ? staticRow(flowArrow(ENERGY_FLOW_COLORS[f.kind].import), FLOW_LABEL[f.kind].import, f.imports) : '',
  ]).join('');
  const choke = m.chokes
    ? staticRow(`<svg width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="5" fill="#05060a" stroke="${ENERGY_CHOKE_HEX}" stroke-width="2"/></svg>`,
      'Détroit, point de passage obligé')
    : '';
  if (!rows && !choke) return '';
  return '<section class="mk" aria-label="Échanges avec l’étranger"><h3>Échanges avec l’étranger <small>couleur = filière et sens</small></h3>'
    + rows + choke + '</section>';
}

function contextBlock(m: EnergyKeyModel): string {
  const parts: string[] = [];
  if (m.fuelTension) {
    const ft = m.fuelTension;
    const fill = (lvl: 'rouge' | 'orange' | 'jaune'): string => `<svg width="16" height="12" aria-hidden="true"><rect width="16" height="12" fill="${levelHex(lvl)}" fill-opacity="0.3" stroke="${levelHex(lvl)}" stroke-width="2"/></svg>`;
    parts.push(([['rouge', 'Tension carburants critique'], ['orange', 'Tension carburants forte'], ['jaune', 'Tension carburants moyenne']] as const)
      .filter(([lvl]) => ft[lvl] > 0).map(([lvl, label]) => staticRow(fill(lvl), label, ft[lvl])).join(''));
  }
  if (m.networks.gas) parts.push(staticRow(line(ENERGY_SECTOR_HEX.gaz, false), 'Gazoduc'));
  if (m.networks.oil) parts.push(staticRow(line(ENERGY_SECTOR_HEX.petrole, true), 'Oléoduc'));
  if (m.networks.drom) parts.push(staticRow(line('#aeaeb2', false), 'Ligne HTA (outre-mer)'));
  if (m.metro) {
    const ref = [3000, 1000, 200];
    parts.push('<div class="mk-sub">Consommation des métropoles : surface du cercle proportionnelle</div><div class="mk-key">'
      + nestedCirclesSvg(ref.map(metroRadiusPx), ref.map((v) => `${v.toLocaleString('fr-FR').replace(/\s/g, NBSP)}${NBSP}MW`), 'Consommation des métropoles')
      + '</div>');
  }
  if (m.inventory.biomethane) parts.push(staticRow(dot(ENERGY_SECTOR_HEX.gaz, 3), 'Site de biométhane'));
  if (m.inventory.depots) parts.push(staticRow(dot(ENERGY_SECTOR_HEX.petrole, 3), 'Dépôt pétrolier'));
  if (m.regions) {
    const sw = (c: string): string => `<svg width="16" height="12" aria-hidden="true"><rect width="16" height="12" fill="${c}" stroke="rgba(255,255,255,0.25)"/></svg>`;
    parts.push('<div class="mk-sub">Fond des régions : solde électrique (ce n’est pas une vigilance)</div><div class="mk-icons">'
      + `<span>${sw(REGION_BALANCE_COLORS.exportatrice)}exporte</span><span>${sw(REGION_BALANCE_COLORS.importatrice)}importe</span>`
      + `<span>${sw(REGION_BALANCE_COLORS.equilibree)}équilibrée</span></div>`);
  }
  const body = parts.join('');
  if (!body) return '';
  return `<section class="mk" aria-label="Contexte"><h3>Contexte <small>fonds, réseaux, inventaire</small></h3>${body}</section>`;
}

export function buildEnergyKeyHtml(m: EnergyKeyModel): string {
  if (!m.visible) return '';
  return statesBlock(m) + sectorsBlock(m) + flowsBlock(m) + contextBlock(m);
}
