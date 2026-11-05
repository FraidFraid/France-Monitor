// api/_lib/brief-store.js : dernier brief national, rédigé une fois pour tous (05/11/2026). L'enregistreur de la VM
// (scripts/score-recorder.mjs, toutes les 15 min) le fait rédiger ; chaque visiteur lit le même, sans appel Groq.
// Un fichier JSON par langue, réécrit d'un bloc (fichier temporaire puis renommage) : jamais lu à moitié écrit.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const DEFAULT_DIR = '/var/lib/francemonitor/data';

/** @param {'fr' | 'en'} lang */
export function briefFile(lang) {
  const dir = process.env.FM_BRIEF_DIR ?? DEFAULT_DIR;
  return `${dir}/brief-latest-${lang === 'en' ? 'en' : 'fr'}.json`;
}

/**
 * Jeton de rédaction : seul l'enregistreur le porte (en-tête x-fm-brief-token). Sans FM_BRIEF_TOKEN dans l'environnement
 * (poste de développement), la rédaction reste ouverte comme avant ; en production le jeton est posé.
 * @param {string | null | undefined} presented
 * @param {string | undefined} expected
 */
export function mayGenerate(presented, expected) {
  if (!expected) return true;
  if (typeof presented !== 'string' || presented.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/**
 * Entrée gardée : le brief (déjà validé), l'heure de rédaction, la note du relevé et les identifiants des situations S1…S5 du
 * relevé (les preuves S<n> renvoient à ces situations-là, pas à celles que calcule le navigateur du visiteur).
 * @param {unknown} v
 * @returns {{ brief: unknown, generatedAt: string, score: number | null, situationIds: string[] } | null}
 */
export function parseStoredBrief(v) {
  if (!v || typeof v !== 'object') return null;
  const e = /** @type {Record<string, unknown>} */ (v);
  if (!e.brief || typeof e.brief !== 'object') return null;
  if (typeof e.generatedAt !== 'string' || !Number.isFinite(Date.parse(e.generatedAt))) return null;
  return {
    brief: e.brief,
    generatedAt: e.generatedAt,
    score: typeof e.score === 'number' && Number.isFinite(e.score) ? e.score : null,
    situationIds: Array.isArray(e.situationIds) ? e.situationIds.filter((s) => typeof s === 'string').slice(0, 12) : [],
  };
}

/** @param {'fr' | 'en'} lang */
export async function readStoredBrief(lang) {
  try {
    return parseStoredBrief(JSON.parse(await readFile(briefFile(lang), 'utf8')));
  } catch {
    return null;
  }
}

/**
 * @param {'fr' | 'en'} lang
 * @param {{ brief: unknown, generatedAt: string, score: number | null, situationIds: string[] }} entry
 */
export async function writeStoredBrief(lang, entry) {
  const file = briefFile(lang);
  try {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(`${file}.tmp`, JSON.stringify(entry));
    await rename(`${file}.tmp`, file);
    return true;
  } catch (err) {
    console.warn('[brief-store] écriture impossible', file, err instanceof Error ? err.message : err);
    return false;
  }
}
