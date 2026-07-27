/**
 * api/_lib/firms-window.js — Fenêtre temporelle des détections FIRMS.
 *
 * Fonctions PURES, partagées entre la fonction Vercel (`api/fires.js`) et son
 * miroir de développement (`src/plugins/fires-proxy.ts`) — un seul code, donc
 * aucune dérive possible entre les deux.
 *
 * Pourquoi ce module existe : l'API FIRMS `area/csv` prend une plage en JOURS,
 * et `/1` signifie « depuis minuit UTC », pas « les 24 dernières heures ». À
 * 11 h UTC, la prod ne recevait donc que 11 h de données, alors que le repli
 * sans clé lit `SUOMI_VIIRS_C2_Europe_24h.csv` — 24 h glissantes. Résultat
 * contre-intuitif : la clé API faisait voir MOINS de données que pas de clé,
 * et le déficit était maximal le matin.
 *
 * Correction : demander 2 jours à FIRMS, puis filtrer ici sur une vraie
 * fenêtre glissante. La couverture devient constante quelle que soit l'heure.
 */

/** Tolérance d'avance d'horloge entre FIRMS et nous. */
const CLOCK_SKEW_MS = 60 * 60 * 1000;

/**
 * Horodatage UTC d'une détection, en millisecondes.
 *
 * FIRMS écrit `acq_date` en `YYYY-MM-DD` et `acq_time` en `HHMM` **sans zéro
 * de tête** : « 109 » vaut 01 h 09, « 0 » vaut minuit. Renvoie `null` sur une
 * valeur illisible — jamais une date approximative, qui placerait la détection
 * au mauvais endroit dans la fenêtre.
 *
 * @param {Record<string, unknown>} row
 * @returns {number | null}
 */
export function detectionTimestamp(row) {
  const date = String(row?.acq_date ?? '');
  const time = String(row?.acq_time ?? '');
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!dateMatch || !/^\d{1,4}$/.test(time)) return null;

  const padded = time.padStart(4, '0');
  const hours = Number.parseInt(padded.slice(0, 2), 10);
  const minutes = Number.parseInt(padded.slice(2), 10);
  if (hours > 23 || minutes > 59) return null;

  return Date.UTC(
    Number.parseInt(dateMatch[1], 10),
    Number.parseInt(dateMatch[2], 10) - 1,
    Number.parseInt(dateMatch[3], 10),
    hours,
    minutes,
  );
}

/**
 * Ne garde que les détections des `hours` dernières heures.
 *
 * Une détection dont l'horodatage est illisible est **écartée** : on ne peut
 * pas la situer dans le temps, donc la garder corromprait la fenêtre. Ce qui
 * est écarté est journalisé — une perte silencieuse serait invisible.
 *
 * @param {Array<Record<string, unknown>>} rows
 * @param {number} hours
 * @param {number} nowMs
 * @returns {Array<Record<string, unknown>>}
 */
export function filterRecentDetections(rows, hours, nowMs) {
  const oldest = nowMs - hours * 60 * 60 * 1000;
  const newest = nowMs + CLOCK_SKEW_MS;
  const kept = [];
  let unreadable = 0;

  for (const row of rows) {
    const ts = detectionTimestamp(row);
    if (ts === null) {
      unreadable += 1;
      continue;
    }
    if (ts >= oldest && ts <= newest) kept.push(row);
  }

  if (unreadable > 0) {
    console.warn(`[firms-window] ${unreadable} détection(s) écartée(s) : horodatage illisible`);
  }
  return kept;
}
