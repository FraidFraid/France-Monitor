// src/components/deckgl/pollen-map.ts : parties pures de la couche Pollens de la carte (Atmo France, 20/10/2026) : données GeoJSON des
// départements (couleur du plus haut code du jour choisi, palette officielle Atmo) et spécification des couches MapLibre. Aucun accès
// à MapLibre à l'exécution ; constantes propres (hors de constants.ts). Donnée en retard : gris neutre, couleurs de niveau retirées.
import type { ExpressionSpecification, LayerSpecification } from 'maplibre-gl';
import type { PollenDay, PollenResponse } from '../../types/index.ts';
import { departementName } from '../layer-panel/health-format.ts';
import { frNumber } from '../layer-panel/format.ts';
import { ENV_NEUTRAL_HEX } from '../layer-panel/environment-legend.ts';
import {
  POLLEN_TAXA_INFO, pollenDate, pollenDeptDayOf, pollenLate, pollenWordFor,
} from '../layer-panel/pollens-level.ts';
import { POLLEN_HEX, POLLEN_WORD } from '../layer-panel/pollens-legend.ts';
import { clockOf, parisDayWord } from '../layer-panel/environment-format.ts';
import { escapeHtml } from './format-utils.ts';

export const SRC_POLLEN = 'pollen-src';
export const LYR_POLLEN_FILL = 'pollen-fill';
export const LYR_POLLEN_LINE = 'pollen-line';
export const POLLEN_LAYER_IDS: readonly string[] = [LYR_POLLEN_FILL, LYR_POLLEN_LINE];

type Fc = GeoJSON.FeatureCollection;
const TRANSPARENT = 'rgba(0, 0, 0, 0)';
const HIGH = 4;

function head(title: string, sub: string): string {
  return `<b>${escapeHtml(title)}</b><div class="hm-sub">${escapeHtml(sub)}</div>`;
}
function row(label: string, value: string): string {
  return `<div class="hm-row"><span>${escapeHtml(label)}</span><span>${escapeHtml(value)}</span></div>`;
}
function note(text: string): string {
  return `<div class="hm-note">${escapeHtml(text)}</div>`;
}
function codeOf(f: GeoJSON.Feature): string {
  const code: unknown = f.properties?.['code'];
  return typeof code === 'string' ? code : String(code ?? '');
}

function pollenBody(code: string, p: PollenResponse, date: string, late: boolean, now: number): string {
  const name = `${departementName(code)} (${code})`;
  const d = pollenDeptDayOf(p.departments.find((x) => x.code === code), date);
  const when = parisDayWord(date, now);
  if (d === null) return head(name, `pas de pollens publiés ${when}`) + note('Département non couvert par une AASQA ce jour : absence de publication, pas absence de pollens.');
  const drivers = d.taxa.filter((t) => t.code >= HIGH).map((t) => `${POLLEN_TAXA_INFO[t.taxon].label} ${pollenWordFor(t.code, t.taxon)}`);
  const top = d.taxa.slice(0, 3).map((t) => `${POLLEN_TAXA_INFO[t.taxon].label} ${pollenWordFor(t.code, t.taxon)}`);
  return head(name, `pollens ${POLLEN_WORD[d.maxCode] ?? 'n.d.'} ${when}`)
    + row('Communes à élevé ou plus', `${frNumber(d.high, 0)} sur ${frNumber(d.communes, 0)}`)
    + row(drivers.length > 0 ? 'Pollens responsables' : 'Pollens dominants', (drivers.length > 0 ? drivers : top).join(', ') || 'n.d.')
    + (d.alerte ? note('Alerte publiée par au moins une commune.') : '')
    + note(`Pollens du ${date.slice(8, 10)}/${date.slice(5, 7)}, mis à jour ${clockOf(p.updatedAt, now)}${late ? ' (en retard) : couleur retirée' : ''} ; palette officielle Atmo.`);
}

/** Départements remplis par le plus haut code de pollens du jour choisi ; sans publication ce jour : non rempli. */
export function pollenDeptFeatures(geo: GeoJSON.FeatureCollection, p: PollenResponse | null, day: PollenDay, now: number): Fc {
  if (!p) return { type: 'FeatureCollection', features: [] };
  const late = pollenLate(p, now);
  const date = pollenDate(day, now);
  const byCode = new Map(p.departments.map((x) => [x.code, x]));
  return {
    type: 'FeatureCollection',
    features: geo.features.flatMap((f): GeoJSON.Feature[] => {
      if (!f.geometry) return [];
      const code = codeOf(f);
      const d = pollenDeptDayOf(byCode.get(code), date);
      const color = d === null ? TRANSPARENT : late ? ENV_NEUTRAL_HEX : POLLEN_HEX[d.maxCode] ?? ENV_NEUTRAL_HEX;
      return [{ type: 'Feature', geometry: f.geometry, properties: { code, color, body: pollenBody(code, p, date, late, now) } }];
    }),
  };
}

const COLOR: ExpressionSpecification = ['coalesce', ['get', 'color'], ENV_NEUTRAL_HEX];

/** Couches des départements, masquées au départ (la source est ajoutée par l'appelant sous le nom SRC_POLLEN). */
export const POLLEN_LAYERS: LayerSpecification[] = [
  { id: LYR_POLLEN_FILL, type: 'fill', source: SRC_POLLEN, layout: { visibility: 'none' }, paint: { 'fill-color': COLOR, 'fill-opacity': 0.45 } },
  { id: LYR_POLLEN_LINE, type: 'line', source: SRC_POLLEN, layout: { visibility: 'none' }, paint: { 'line-color': '#1a1a2e', 'line-width': 0.6, 'line-opacity': 0.8 } },
];
