// src/components/map-key/environment-key.ts
/**
 * environment-key.ts : bloc Environnement de la légende « Lire la carte » (onglet Environnement, 20/10/2026). La grille de lecture
 * commune aux couches, avec les éléments comptés à l'écran : couleur = niveau officiel (Météo-France, Vigicrues) ou mesuré ;
 * picto = phénomène ; anneau = enjeu exposé. Stations, feux et séismes sont décrits par la carte de leur couche, qui suit. Pur.
 */
import type { VigilancePhenomenonId } from '../../types/index.ts';
import { levelHex, type VigilanceLevel } from '../../services/vigilance.ts';
import { PHENOMENON_ICON, PHENOMENON_LABEL } from '../layer-panel/environment-format.ts';
import { EXPOSURE_KIND_HEX } from '../deckgl/exposure-map.ts';
import { fmIcon } from '../shared/icons.ts';

export interface EnvironmentKeyModel {
  visible: boolean;
  /** Départements par niveau de vigilance (J). */
  vigilance: Partial<Record<VigilanceLevel, number>>;
  /** Phénomènes présents sur la carte (picto du département). */
  phenomena: readonly VigilancePhenomenonId[];
  /** Tronçons Vigicrues par niveau. */
  floods: Partial<Record<VigilanceLevel, number>>;
  /** Enjeux exposés dessinés (pastille En bref allumée), null sinon. */
  exposed: number | null;
}

const LEVELS: readonly VigilanceLevel[] = ['rouge', 'orange', 'jaune'];
const LEVEL_WORD: Readonly<Record<VigilanceLevel, string>> = { rouge: 'Rouge', orange: 'Orange', jaune: 'Jaune', vert: 'Vert' };

function swatch(level: VigilanceLevel): string {
  return `<svg width="16" height="12" aria-hidden="true"><rect width="16" height="12" fill="${levelHex(level)}" fill-opacity="0.35" stroke="${levelHex(level)}" stroke-width="2"/></svg>`;
}
function stroke(level: VigilanceLevel): string {
  return `<svg width="22" height="10" aria-hidden="true"><line x1="1" y1="5" x2="21" y2="5" stroke="${levelHex(level)}" stroke-width="3"/></svg>`;
}
function ringDot(fill: string, ring: string): string {
  return `<svg width="18" height="18" aria-hidden="true"><circle cx="9" cy="9" r="6" fill="${fill}" stroke="${ring}" stroke-width="3"/></svg>`;
}
function row(sym: string, label: string, n: number | null = null): string {
  return `<div class="mk-row mk-row--static"><span class="mk-sym">${sym}</span><span class="mk-lbl">${label}</span><span class="mk-n">${n ?? ''}</span></div>`;
}

export function buildEnvironmentKeyHtml(m: EnvironmentKeyModel): string {
  if (!m.visible) return '';
  const vig = LEVELS.filter((l) => (m.vigilance[l] ?? 0) > 0).map((l) => row(swatch(l), `Vigilance ${LEVEL_WORD[l].toLowerCase()} · département`, m.vigilance[l] ?? 0)).join('');
  const icons = m.phenomena.length === 0 ? '' : '<div class="mk-sub">Picto du département : phénomène le plus fort</div><div class="mk-icons">'
    + m.phenomena.map((p) => `<span>${fmIcon(PHENOMENON_ICON[p], { size: 12 })}${PHENOMENON_LABEL[p]}</span>`).join('') + '</div>';
  const floods = LEVELS.filter((l) => (m.floods[l] ?? 0) > 0).map((l) => row(stroke(l), `Crue ${LEVEL_WORD[l].toLowerCase()} · tronçon Vigicrues`, m.floods[l] ?? 0)).join('');
  const exposed = m.exposed === null ? ''
    : '<div class="mk-sub">Enjeux exposés : disque = type d’enjeu, anneau = niveau du phénomène</div>'
      + row(ringDot(EXPOSURE_KIND_HEX.nucleaire, levelHex('orange')), 'Centrale, site Seveso, urgences, EHPAD à portée d’un phénomène', m.exposed);
  const body = vig + icons + floods + exposed;
  return '<section class="mk" aria-label="Environnement"><h3>Environnement <small>couleur = niveau officiel ou mesuré</small></h3>'
    + '<div class="mk-sub">Rouge, orange, jaune : niveaux publiés par Météo-France et Vigicrues, ou mesurés ; gris : donnée en retard ; jamais de vert supposé.</div>'
    + (body || '<p class="mk-sub">Aucun phénomène en jaune ou plus à l’écran.</p>') + '</section>';
}
