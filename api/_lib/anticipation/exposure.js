// api/_lib/anticipation/exposure.js : enjeux exposés dans la zone d'un scénario (13/11/2026). Comptes par département tirés des jeux
// publiés par le site (exposure-data.js, généré). Un scénario national n'a pas d'enjeux listés : la zone est le pays.
import { EXPOSURE_BY_DEPT, EXPOSURE_SOURCES } from './exposure-data.js';
import { FLOOD_EXPOSURE_BY_DEPT, FLOOD_EXPOSURE_META } from './flood-exposure-data.js';

/**
 * @typedef {object} Exposure
 * @property {number} urgences Services d'urgences.
 * @property {number} passages Passages annuels aux urgences.
 * @property {string[]} mainHospitals Les plus fréquentés.
 * @property {number} ehpad
 * @property {number} ehpadPlaces
 * @property {number} sevesoHaut
 * @property {number} sevesoBas
 * @property {string[]} sources Sources datées des comptes.
 */

/**
 * @param {{ zone?: { dept?: string[] } }} scenario
 * @param {Record<string, Omit<Exposure, 'sources'>>} [table]
 * @returns {Exposure|null}
 */
export function exposureOf(scenario, table = EXPOSURE_BY_DEPT) {
  const depts = (Array.isArray(scenario?.zone?.dept) ? scenario.zone.dept : []).filter((d) => typeof d === 'string' && Object.prototype.hasOwnProperty.call(table, d));
  if (!depts.length) return null;
  const out = { urgences: 0, passages: 0, mainHospitals: /** @type {string[]} */ ([]), ehpad: 0, ehpadPlaces: 0, sevesoHaut: 0, sevesoBas: 0 };
  for (const d of depts) {
    const e = table[d];
    out.urgences += e.urgences; out.passages += e.passages; out.ehpad += e.ehpad; out.ehpadPlaces += e.ehpadPlaces;
    out.sevesoHaut += e.sevesoHaut; out.sevesoBas += e.sevesoBas;
    out.mainHospitals.push(...e.mainHospitals);
  }
  return { ...out, mainHospitals: out.mainHospitals.slice(0, 3), sources: [EXPOSURE_SOURCES.urgences, EXPOSURE_SOURCES.ehpad, EXPOSURE_SOURCES.seveso] };
}

/** Copie du scénario avec ses enjeux exposés (champ absent pour un scénario national). */
/** Règles dont l'effet touche les établissements comptés (eau, vent, chaleur, froid, neige) ; les autres fiches n'affichent pas d'enjeux. */
export const EXPOSURE_RULES = new Set(['crue-inondation', 'tempete-reseaux', 'chaleur-sante', 'froid-electricite', 'neige-transports']);

/** Établissements nommés au plus par fiche, les plus exposés d'abord. */
export const FLOOD_SITES_MAX = 12;
const KIND_RANK = /** @type {Record<string, number>} */ ({ urgences: 0, seveso_haut: 1, ehpad: 2, seveso_bas: 3 });

/**
 * Établissements des départements de la zone situés dans une zone de crue cartographiée (Géorisques, TRI). Crue moyenne avant crue
 * extrême, urgences et Seveso seuil haut d'abord, EHPAD par nombre de places. `total` compte tout, `sites` est borné.
 * @param {{ zone?: { dept?: string[] } }} scenario
 * @param {Record<string, Array<{ kind: string, name: string, commune: string, scenario: string, river: string|null, places?: number }>>} [table]
 */
export function floodSitesOf(scenario, table = FLOOD_EXPOSURE_BY_DEPT) {
  const depts = (Array.isArray(scenario?.zone?.dept) ? scenario.zone.dept : []).filter((d) => typeof d === 'string');
  const all = depts.flatMap((d) => (Object.prototype.hasOwnProperty.call(table, d) ? table[d] : []));
  if (!all.length) return null;
  const sorted = [...all].sort((a, b) => (a.scenario === b.scenario ? 0 : a.scenario === 'moyen' ? -1 : 1)
    || (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9) || (b.places ?? 0) - (a.places ?? 0) || a.name.localeCompare(b.name, 'fr'));
  /** @type {Record<string, number>} */
  const counts = {};
  for (const s of all) counts[s.kind] = (counts[s.kind] ?? 0) + 1;
  return { total: all.length, counts, sites: sorted.slice(0, FLOOD_SITES_MAX), source: FLOOD_EXPOSURE_META.source };
}

export function withExposure(/** @type {any} */ scenario) {
  const exposure = EXPOSURE_RULES.has(scenario?.ruleId) ? exposureOf(scenario) : null;
  if (!exposure) return scenario;
  const flood = scenario.ruleId === 'crue-inondation' ? floodSitesOf(scenario) : null;
  return { ...scenario, exposure: flood ? { ...exposure, flood } : exposure };
}
