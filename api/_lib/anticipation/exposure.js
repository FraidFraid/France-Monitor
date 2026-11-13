// api/_lib/anticipation/exposure.js : enjeux exposés dans la zone d'un scénario (13/11/2026). Comptes par département tirés des jeux
// publiés par le site (exposure-data.js, généré). Un scénario national n'a pas d'enjeux listés : la zone est le pays.
import { EXPOSURE_BY_DEPT, EXPOSURE_SOURCES } from './exposure-data.js';

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
export function withExposure(/** @type {any} */ scenario) {
  const exposure = exposureOf(scenario);
  return exposure ? { ...scenario, exposure } : scenario;
}
