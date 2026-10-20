// api/_lib/vigicrues-forecasts.js : prévisions de hauteur publiées par Vigicrues aux stations des tronçons en vigilance (spec
// 2026-10-20 onglet Environnement, lot 3). Service « previsions.json » (sans clé, flux annoncé « Beta ») : hauteur prévue
// heure par heure avec une fourchette (min, moyenne, max). Une station sans prévision publiée n'a rien : aucune valeur
// n'est extrapolée des mesures. Lecture bornée dans le temps : une prévision manquante n'empêche jamais la réponse.
import { mapLimit } from './map-limit.js';
import { cachedSource, fetchStrictJson } from './source-http.js';

const STATION_CODE = /^[A-Z0-9]{10}$/;
/** Prévisions relues toutes les 15 min (les services de prévision publient en général toutes les 1 à 6 h). */
export const FORECAST_TTL_SEC = 900;
/** Au-delà de 12 h, une prévision n'est plus une prévision : écartée. */
export const FORECAST_MAX_AGE_MS = 12 * 3_600_000;

/** Adresse de la prévision de hauteur d'une station (code de 10 caractères seulement). */
export function forecastUrl(code) {
  if (typeof code !== 'string' || !STATION_CODE.test(code)) throw new Error('code de station illisible');
  return `https://www.vigicrues.gouv.fr/services/previsions.json/index.php?CdStationHydro=${code}&GrdSerie=H&FormatSortie=json`;
}

const num = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Prévision publiée : `{ producedAt, points: [{ at, min, mean, max }] }`, points futurs seulement, triés ; null sans prévision
 * (liste vide, date de production absente ou trop ancienne). Lève sur une forme inattendue.
 * @param {unknown} json
 * @param {number} now
 */
export function parseForecast(json, now) {
  const simul = json && typeof json === 'object' ? json.Simul : null;
  if (!simul || typeof simul !== 'object' || !Array.isArray(simul.Prevs)) throw new Error('prévision Vigicrues sans série');
  const produced = num(simul.DtProdSimul) ? simul.DtProdSimul : null;
  if (produced === null || now - produced > FORECAST_MAX_AGE_MS) return null;
  const points = simul.Prevs
    .filter((p) => p && num(p.DtPrev) && num(p.ResMoyPrev) && p.DtPrev >= now - 3_600_000)
    .map((p) => ({
      at: new Date(p.DtPrev).toISOString(),
      min: num(p.ResMinPrev) ? p.ResMinPrev : p.ResMoyPrev,
      mean: p.ResMoyPrev,
      max: num(p.ResMaxPrev) ? p.ResMaxPrev : p.ResMoyPrev,
    }))
    .sort((a, b) => a.at.localeCompare(b.at));
  return points.length === 0 ? null : { producedAt: new Date(produced).toISOString(), points };
}

/**
 * Prévisions des stations, lues en parallèle (6 à la fois), chacune en cache 15 min ; au-delà de `waitMs`, on répond avec
 * celles déjà lues (les autres remplissent le cache pour la relève suivante). Ne rejette jamais.
 * @param {readonly string[]} codes
 * @param {number} now
 * @param {number} waitMs
 * @returns {Promise<Map<string, { producedAt: string, points: Array<{ at: string, min: number, mean: number, max: number }> }>>}
 */
export async function loadForecasts(codes, now, waitMs) {
  const out = new Map();
  const safe = codes.filter((c) => typeof c === 'string' && STATION_CODE.test(c));
  if (safe.length === 0 || waitMs <= 0) return out;
  const work = mapLimit(safe, 6, async (code) => {
    try {
      const f = await cachedSource(`env:vigicrues:prev:${code}`, { ttlSec: FORECAST_TTL_SEC, staleSec: 3 * 3_600, shared: false },
        async () => ({ value: parseForecast(await fetchStrictJson(forecastUrl(code), { timeoutMs: 10_000 }), Date.now()) }));
      if (f?.value) out.set(code, f.value);
    } catch {
      // Prévision illisible ou service en panne : la station reste sans prévision, jamais une erreur de la route.
    }
  });
  work.catch(() => {});
  let timer;
  await Promise.race([work, new Promise((resolve) => { timer = setTimeout(resolve, waitMs); })]);
  clearTimeout(timer);
  return out;
}
