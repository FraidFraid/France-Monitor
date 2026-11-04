// api/_lib/anticipation/note.js : note de 7 h de l'anticipation (04/11/2026, spec § 8). Figée une fois par jour de Paris au premier
// tick à partir de 07:00, écrite dans notes/AAAA-MM-JJ.json. Phrase de synthèse déterministe : aucun texte produit par une IA.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parisDay } from '../../../src/services/paris-day.js';
import { WORDS, WORD_LABEL } from './probability.js';

/** @typedef {import('./registry.js').Scenario} Scenario */
/** @typedef {import('./agenda.js').AgendaDay} AgendaDay */
/**
 * @typedef {object} AnticipationNote
 * @property {string} day
 * @property {string} generatedAt
 * @property {string} bluf
 * @property {Scenario[]} today
 * @property {Array<{ day: string, scenario: Scenario }>} week Le scénario le plus fort de chaque jour de J+1 à J+6.
 * @property {{ opened: Scenario[], closed: Scenario[] }} sinceYesterday
 */

const DAY_MS = 86_400_000;
const rank = (/** @type {Scenario} */ s) => WORDS.indexOf(/** @type {any} */ (s.word));
/** Mot le plus fort d'abord, puis ouverture la plus ancienne. */
const byStrength = (/** @type {Scenario} */ a, /** @type {Scenario} */ b) => rank(b) - rank(a) || Date.parse(a.openedAt) - Date.parse(b.openedAt);
const sentence = (/** @type {Scenario} */ s) => `${s.title.replace(/[.\s]+$/, '')} (${WORD_LABEL[/** @type {keyof typeof WORD_LABEL} */ (s.word)] ?? s.word})`;

/**
 * @param {Scenario[]} open Scénarios servis (ouverts).
 * @param {AgendaDay[]} agenda Agenda de 7 jours (le premier est aujourd'hui).
 * @param {Scenario[]} closedYesterday Scénarios clos depuis la veille.
 * @param {number} now
 * @returns {AnticipationNote}
 */
export function buildNote(open, agenda, closedYesterday, now) {
  const list = (Array.isArray(open) ? open : []).filter((s) => s && s.status === 'ouvert');
  const byId = new Map(list.map((s) => [s.id, s]));
  const pick = (/** @type {string[]} */ ids) => ids.map((id) => byId.get(id)).filter((s) => s !== undefined).sort(byStrength);
  const days = Array.isArray(agenda) ? agenda : [];
  const today = pick(days[0]?.scenarioIds ?? []);
  /** @type {Array<{ day: string, scenario: Scenario }>} */
  const week = [];
  for (const d of days.slice(1)) {
    const top = pick(d.scenarioIds)[0];
    if (top) week.push({ day: d.day, scenario: top });
  }
  const topWeek = week.map((w) => w.scenario).sort(byStrength)[0];
  const parts = [];
  if (today[0]) parts.push(`Aujourd'hui : ${sentence(today[0])}.`);
  if (topWeek) parts.push(`Cette semaine : ${sentence(topWeek)}.`);
  const since = now - DAY_MS;
  return {
    day: parisDay(now), generatedAt: new Date(now).toISOString(),
    bluf: parts.length ? parts.join(' ') : 'Aucun croisement détecté aujourd\'hui.',
    today, week,
    sinceYesterday: {
      opened: list.filter((s) => Date.parse(s.openedAt) >= since).sort(byStrength),
      closed: (Array.isArray(closedYesterday) ? closedYesterday : []).filter(Boolean),
    },
  };
}

/** Heure de Paris (0 à 23) d'un instant. */
const PARIS_HOUR = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23' });
export const parisHour = (/** @type {number} */ ms) => Number(PARIS_HOUR.format(new Date(ms)));

const notesDir = (/** @type {string} */ root) => path.join(root, 'notes');
const errMsg = (/** @type {unknown} */ e) => (e instanceof Error ? e.message : String(e));

/** Une note existe-t-elle déjà pour ce jour ? (contrôle après redémarrage) */
export async function noteExists(/** @type {string} */ root, /** @type {string} */ day) {
  try { await readFile(path.join(notesDir(root), `${day}.json`), 'utf8'); return true; } catch { return false; }
}

/**
 * Écrit la note du jour sans jamais écraser une note déjà figée. Ne lève jamais : renvoie un message d'erreur ou null.
 * @returns {Promise<string|null>}
 */
export async function writeNote(/** @type {string} */ root, /** @type {AnticipationNote} */ note) {
  try {
    await mkdir(notesDir(root), { recursive: true });
    await writeFile(path.join(notesDir(root), `${note.day}.json`), `${JSON.stringify(note)}\n`, { encoding: 'utf8', flag: 'wx' });
    return null;
  } catch (e) {
    if (/** @type {NodeJS.ErrnoException} */ (e).code === 'EEXIST') return null; // déjà figée
    return `Note de 7 h non écrite dans ${notesDir(root)} : ${errMsg(e)}`;
  }
}

/** Note d'un jour, ou null (absente ou illisible). */
export async function readNote(/** @type {string} */ root, /** @type {string} */ day) {
  try { return JSON.parse(await readFile(path.join(notesDir(root), `${day}.json`), 'utf8')); } catch { return null; }
}

/** Note la plus récente à la date donnée ou avant (aujourd'hui figée, sinon celle de la veille ou plus ancienne), ou null. */
export async function latestNote(/** @type {string} */ root, /** @type {string} */ upToDay) {
  let names = [];
  try { names = await readdir(notesDir(root)); } catch { return null; }
  const days = names.map((n) => /^(\d{4}-\d{2}-\d{2})\.json$/.exec(n)?.[1]).filter((d) => typeof d === 'string' && d <= upToDay).sort();
  for (const d of days.reverse()) {
    const note = await readNote(root, /** @type {string} */ (d));
    if (note) return note;
  }
  return null;
}
