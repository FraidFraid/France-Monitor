// api/_lib/ecowatt-official.js — normalisation pure du signal Écowatt OFFICIEL de RTE.
//
// Deux sources, une seule forme de sortie (EcowattOfficial, voir src/types/index.ts) :
//   - RTE Écowatt v5 (temps réel, jour J à J+3) : normalizeRteSignals().
//   - Repli open data ODRÉ « nouveau_signal_ecowatt » (jours passés seulement) : normalizeOdreRecords().
//
// Un jour invalide (dvalue/couleur_du_jour hors 1..3, pas manquants, hvalue hors 0..3, date
// illisible) est ÉCARTÉ, jamais « corrigé ». Aucune fonction ici ne fait d'I/O.

const LEVEL_BY_VALUE = { 1: 'green', 2: 'orange', 3: 'red' };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * dvalue (RTE) / couleur_du_jour (ODRÉ) → niveau Écowatt, ou null si hors 1..3.
 * @param {unknown} value
 * @returns {'green' | 'orange' | 'red' | null}
 */
function levelFromValue(value) {
  return LEVEL_BY_VALUE[/** @type {1 | 2 | 3} */ (value)] ?? null;
}

/** @param {unknown} value @returns {value is 0 | 1 | 2 | 3} */
function isHourValue(value) {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

// Séquences UTF-8 relues en Windows-1252 (double encodage constaté sur le champ `message` du
// jeu ODRÉ « nouveau_signal_ecowatt »). Remplacements ciblés uniquement : un texte déjà propre
// (accents corrects) n'est jamais touché, faute de correspondre à l'une de ces séquences.
const MOJIBAKE_REPLACEMENTS = [
  [/â€™/g, '’'], // '
  [/â€˜/g, '‘'], // '
  [/â€œ/g, '“'], // "
  [/â€\u009d/g, '”'], // "
  [/â€“/g, '–'], // –
  [/â€”/g, '—'], // —
  [/â€¦/g, '…'], // …
  [/Ã©/g, 'é'],
  [/Ã¨/g, 'è'],
  [/Ãª/g, 'ê'],
  [/Ã /g, 'à'], // Ã + espace insécable (0xA0 relu en cp1252)
  [/Ã /g, 'à'], // Ã + espace normal, au cas où la source a été re-normalisée
  [/Ã§/g, 'ç'],
  [/Ã´/g, 'ô'],
  [/Ã®/g, 'î'],
  [/Ã‰/g, 'É'],
];

/**
 * Répare le double encodage UTF-8 lu en Windows-1252 constaté sur ODRÉ (« Pas dâ€™alerte. » →
 * « Pas d'alerte. »). Sans effet sur un texte déjà correctement encodé.
 * @param {unknown} text
 * @returns {string}
 */
export function repairMojibake(text) {
  if (typeof text !== 'string' || text === '') return typeof text === 'string' ? text : '';
  let out = text;
  for (const [pattern, replacement] of MOJIBAKE_REPLACEMENTS) out = out.replace(pattern, replacement);
  return out;
}

/**
 * Normalise un signal RTE (un jour) : { jour, dvalue, message, values: [{ pas, hvalue }] }.
 * @param {unknown} signal
 * @returns {import('../../src/types/index.ts').EcowattOfficialDay | null}
 */
function normalizeRteDay(signal) {
  if (!signal || typeof signal !== 'object') return null;
  const s = /** @type {Record<string, unknown>} */ (signal);

  const jour = s.jour;
  if (typeof jour !== 'string' || jour.length < 10) return null;
  const date = jour.slice(0, 10);
  if (!DATE_RE.test(date)) return null;

  const level = levelFromValue(s.dvalue);
  if (!level) return null;

  const values = Array.isArray(s.values) ? s.values : null;
  if (!values || values.length !== 24) return null;

  const sorted = [...values].sort((a, b) => {
    const pasA = a && typeof a === 'object' ? /** @type {any} */ (a).pas : NaN;
    const pasB = b && typeof b === 'object' ? /** @type {any} */ (b).pas : NaN;
    return Number(pasA) - Number(pasB);
  });

  const hours = [];
  for (let pas = 0; pas < 24; pas += 1) {
    const entry = sorted[pas];
    if (!entry || typeof entry !== 'object') return null;
    const e = /** @type {Record<string, unknown>} */ (entry);
    if (e.pas !== pas) return null; // pas dupliqué ou manquant
    if (!isHourValue(e.hvalue)) return null;
    hours.push(e.hvalue);
  }

  const message = typeof s.message === 'string' ? s.message : '';
  return { date, level, message, hours: /** @type {(0 | 1 | 2 | 3)[]} */ (hours) };
}

/**
 * Normalise la réponse brute de GET .../open_api/ecowatt/v5/signals ({ signals: [...] }).
 * generatedAt = la plus récente des `GenerationFichier` (chaîne telle quelle), parmi TOUS les
 * signaux reçus (même ceux dont le jour est écarté : c'est une information de fraîcheur du
 * fichier, pas de validité du jour).
 * @param {unknown} raw
 * @returns {import('../../src/types/index.ts').EcowattOfficial}
 */
export function normalizeRteSignals(raw) {
  const r = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
  const signals = Array.isArray(r.signals) ? r.signals : [];

  let generatedAt = /** @type {string | null} */ (null);
  let generatedAtMs = -Infinity;
  const days = [];

  for (const signal of signals) {
    if (signal && typeof signal === 'object') {
      const genFichier = /** @type {Record<string, unknown>} */ (signal).GenerationFichier;
      if (typeof genFichier === 'string') {
        const ms = Date.parse(genFichier);
        if (!Number.isNaN(ms) && ms > generatedAtMs) {
          generatedAtMs = ms;
          generatedAt = genFichier;
        }
      }
    }
    const day = normalizeRteDay(signal);
    if (day) days.push(day);
  }

  days.sort((a, b) => a.date.localeCompare(b.date));

  return { source: 'rte', generatedAt, days };
}

/**
 * Normalise un enregistrement ODRÉ « nouveau_signal_ecowatt » : { date, couleur_du_jour, h0..h23, message }.
 * @param {unknown} record
 * @returns {import('../../src/types/index.ts').EcowattOfficialDay | null}
 */
function normalizeOdreRecord(record) {
  if (!record || typeof record !== 'object') return null;
  const r = /** @type {Record<string, unknown>} */ (record);

  const date = r.date;
  if (typeof date !== 'string' || !DATE_RE.test(date)) return null;

  const level = levelFromValue(r.couleur_du_jour);
  if (!level) return null;

  const hours = [];
  for (let h = 0; h < 24; h += 1) {
    const value = r[`h${h}`];
    if (!isHourValue(value)) return null;
    hours.push(value);
  }

  const message = repairMojibake(typeof r.message === 'string' ? r.message : '');
  return { date, level, message, hours: /** @type {(0 | 1 | 2 | 3)[]} */ (hours) };
}

/**
 * Normalise `results` de GET .../nouveau_signal_ecowatt/records (repli ODRÉ, jours passés
 * seulement). generatedAt est toujours null (l'information n'existe pas dans ce jeu).
 * @param {unknown} records
 * @returns {import('../../src/types/index.ts').EcowattOfficial}
 */
export function normalizeOdreRecords(records) {
  const list = Array.isArray(records) ? records : [];
  const days = list.map(normalizeOdreRecord).filter((d) => d !== null);
  days.sort((a, b) => a.date.localeCompare(b.date));
  return { source: 'odre', generatedAt: null, days };
}
