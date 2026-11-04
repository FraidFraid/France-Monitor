// api/_lib/anticipation/registry.js : registre sur disque de l'anticipation (04/11/2026). Journal des scénarios (JSONL par mois de
// Paris), archive des signaux (JSONL par jour de Paris, réécrite seulement quand l'ensemble change ou après 15 min) et compaction
// au-delà de 13 mois. L'état est rebâti au démarrage en rejouant le journal du mois en cours et du précédent (même id : pas de doublon).
// Une écriture ne lève jamais : sur échec, `writable` passe à false, l'erreur nomme le dossier et la mémoire reste à jour.
// Archive bornée (revue finale du 04/11/2026) : copies allégées (ni titre ni adresse), presse limitée à ce que relisent les tests
// d'arrivée, lecture ligne à ligne, plafond de 50 Mo par jour.
import { appendFile, mkdir, open, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import process from 'node:process';
import { parisDay } from '../../../src/services/paris-day.js';

/** @typedef {import('./probability.js').Signal} Signal */
/**
 * @typedef {object} Scenario
 * @property {string} id
 * @property {string} ruleId
 * @property {number} ruleVersion
 * @property {{ dept: string[], communes: string[] }} zone
 * @property {{ from: string, to: string }} window
 * @property {string} title
 * @property {Array<{ text: string, signalIds: string[], levels?: Record<string, string|null> }>} chain
 * @property {string} word
 * @property {string} [peakWord] Mot le plus haut atteint (posé à l'ouverture, relevé par une révision, jamais abaissé) ; absent des anciens scénarios : `word`.
 * @property {string} why
 * @property {string[]} unknowns
 * @property {Array<{ id: string, label: string, state: 'surveille'|'atteint', at: string|null }>} bascules
 * @property {string[]} disconfirmers
 * @property {string[]} verify
 * @property {string} openedAt
 * @property {string} revisedAt
 * @property {'ouvert'|'arrive'|'pas_arrive'|'indecidable'|'expire'|'manque'} status
 * @property {string|null} closedAt
 * @property {string|null} outcomeNote
 * @property {{ utile: number, deja_su: number, faux: number }} feedback
 */
/** @typedef {{ at: string, type: 'ouverture'|'revision'|'bascule'|'cloture'|'manque'|'retour', scenario: Scenario }} JournalEvent */
/** @typedef {'utile'|'deja_su'|'faux'} Vote */
/** Ligne compacte d'un retour (revue finale) : le delta seul, jamais le scénario entier. Les anciennes lignes « retour » complètes restent lues. */
/** @typedef {{ at: string, type: 'retour', id: string, vote: Vote }} VoteEvent */

const VOTES = new Set(['utile', 'deja_su', 'faux']);
/** Scénario avec un vote de plus (copie). */
const withVote = (/** @type {Scenario} */ s, /** @type {Vote} */ vote) => ({ ...s, feedback: { utile: 0, deja_su: 0, faux: 0, ...s.feedback, [vote]: (s.feedback?.[vote] ?? 0) + 1 } });

const DEFAULT_DIR = '/var/lib/francemonitor/data/anticipation';
const ARCHIVE_EVERY_MS = 15 * 60_000;
const KEEP_MONTHS = 13;
/** Plafond d'un fichier d'archive du jour : au-delà, plus d'ajout ce jour-là (une erreur le dit). */
export const ARCHIVE_DAY_MAX_BYTES = 50 * 1024 * 1024;
/** Plafond de signaux de presse par ligne d'archive, les plus utiles aux tests d'arrivée d'abord. */
export const ARCHIVE_PRESS_MAX = 120;
/** Champs de `meta` gardés dans l'archive (lus par les tests d'arrivée, les crises manquées et la mémoire carburants). */
const ARCHIVE_META_KEYS = ['eventId', 'category', 'severity', 'network', 'phenomenon', 'echeance', 'participants', 'previousValue', 'exposed', 'national'];

/** Signal tiré de la presse (événement consolidé, ou mouvement social dans les transports lu dans un titre). */
const isPress = (/** @type {Signal} */ s) => s.kind === 'presse' || (s.kind === 'mouvement_social_transport' && String(s.origin).startsWith('presse:'));
/** Presse utile à une arrivée : mouvement social dans les transports, ou sécurité / social de gravité élevée. */
const pressRank = (/** @type {Signal} */ s) => {
  if (s.kind === 'mouvement_social_transport') return 0;
  const sev = s.meta?.severity;
  const grave = sev === 'high' || sev === 'critical';
  const cat = s.meta?.category === 'security' || s.meta?.category === 'social';
  return cat && grave ? 1 : grave ? 2 : 3;
};
/** Presse archivée : localisée, et sécurité ou social, ou gravité élevée, ou mouvement social dans les transports. */
const keepPress = (/** @type {Signal} */ s) => Array.isArray(s.dept) && s.dept.length > 0
  && (pressRank(s) < 3 || s.meta?.category === 'security' || s.meta?.category === 'social');

/**
 * Copies archivées des signaux : tous les signaux hors presse, la presse retenue par `keepPress` (au plus ARCHIVE_PRESS_MAX, les plus
 * utiles puis les plus récentes), sans titre, adresse ni texte long, champs nuls omis. Fonction pure.
 * @param {Signal[]} signals
 * @returns {Array<Record<string, unknown>>}
 */
export function archivedCopy(signals) {
  const list = (Array.isArray(signals) ? signals : []).filter((s) => s && typeof s === 'object' && typeof s.id === 'string');
  const press = list.filter((s) => isPress(s) && keepPress(s))
    .sort((a, b) => pressRank(a) - pressRank(b) || String(b.publishedAt ?? '').localeCompare(String(a.publishedAt ?? '')) || a.id.localeCompare(b.id))
    .slice(0, ARCHIVE_PRESS_MAX);
  const keptPress = new Set(press);
  return list.filter((s) => !isPress(s) || keptPress.has(s)).map((s) => {
    /** @type {Record<string, unknown>} */
    const meta = {};
    for (const k of ARCHIVE_META_KEYS) if (s.meta && /** @type {Record<string, unknown>} */ (s.meta)[k] !== undefined) meta[k] = /** @type {Record<string, unknown>} */ (s.meta)[k];
    // Champs nuls ou absents omis (les règles lisent `s.level`, `s.window?.from`, `s.value` avec tolérance).
    /** @type {Record<string, unknown>} */
    const out = { id: s.id, kind: s.kind, dept: Array.isArray(s.dept) ? s.dept : [] };
    for (const k of /** @type {const} */ (['domain', 'origin', 'official', 'level', 'value', 'window', 'publishedAt', 'observedAt', 'checkedAt'])) {
      if (s[k] !== null && s[k] !== undefined) out[k] = s[k];
    }
    if (Object.keys(meta).length) out.meta = meta;
    return out;
  });
}

/** Appelle `fn` pour chaque ligne non vide d'un fichier, lu en flux (jamais en entier en mémoire). Fichier absent : ENOENT levée. */
async function forEachLine(/** @type {string} */ file, /** @type {(line: string) => void} */ fn) {
  // Ouverture d'abord : un fichier absent ou un dossier lève ici, avant le flux (readline ne relaie pas toujours l'erreur d'ouverture).
  const handle = await open(file, 'r');
  if (!(await handle.stat()).isFile()) {
    await handle.close();
    throw new Error(`${path.basename(file)} n'est pas un fichier`);
  }
  const stream = handle.createReadStream({ encoding: 'utf8' });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) if (line.trim()) fn(line);
  } finally {
    lines.close();
    stream.destroy();
  }
}

/** Le fichier se termine-t-il par un saut de ligne ? Lit le seul dernier octet. Fichier absent ou vide : vrai. */
export async function endsWithNewline(/** @type {string} */ file) {
  let handle;
  try {
    handle = await open(file, 'r');
  } catch (e) {
    if (/** @type {NodeJS.ErrnoException} */ (e).code === 'ENOENT') return true;
    throw e;
  }
  try {
    const { size } = await handle.stat();
    if (size === 0) return true;
    const buf = Buffer.alloc(1);
    await handle.read(buf, 0, 1, size - 1);
    return buf[0] === 0x0a;
  } finally {
    await handle.close();
  }
}

/** Mois de Paris AAAA-MM. */
const parisMonth = (/** @type {number} */ ms) => parisDay(ms).slice(0, 7);
/** Mois précédent d'une clé AAAA-MM. */
export function previousMonth(/** @type {string} */ key) {
  const [y, m] = key.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}
const errMsg = (/** @type {unknown} */ e) => (e instanceof Error ? e.message : String(e));

/**
 * @param {{ dir?: string, now: number, archiveMaxBytes?: number }} opts `archiveMaxBytes` : plafond du fichier du jour (tests ; défaut 50 Mo).
 */
export async function openRegistry({ dir, now, archiveMaxBytes = ARCHIVE_DAY_MAX_BYTES }) {
  const root = dir || process.env.ANTICIPATION_DIR || DEFAULT_DIR;
  const journalDir = path.join(root, 'journal');
  const signalsDir = path.join(root, 'signals');
  /** @type {Map<string, Scenario>} */
  const scenarios = new Map();
  /** @type {string[]} */
  const errors = [];
  let lastFingerprint = null;
  let lastArchiveAt = -Infinity;

  const registry = {
    writable: true,
    errors,
    root,
    state: () => scenarios,
    scenariosOfMonth,
    record,
    recordVote,
    archiveSignals,
    signalsBetween,
    compact,
  };

  function pushError(/** @type {string} */ msg) {
    if (!errors.includes(msg)) errors.push(msg);
  }

  function fail(/** @type {unknown} */ e) {
    registry.writable = false;
    pushError(`Registre d'anticipation non inscriptible dans ${root} : ${errMsg(e)}`);
  }

  // File unique : toutes les écritures disque passent dans l'ordre des appels, même si l'appelant n'attend pas.
  let queue = Promise.resolve();
  function enqueue(/** @type {() => Promise<void>} */ fn) {
    const run = queue.then(fn);
    queue = run.catch(() => {});
    return run;
  }

  // Fichiers déjà vérifiés par ce processus : une dernière ligne coupée (sans saut de ligne) est terminée avant le premier ajout.
  const checkedFiles = new Set();

  async function ensureDirs() {
    await mkdir(journalDir, { recursive: true });
    await mkdir(signalsDir, { recursive: true });
  }

  async function append(/** @type {string} */ file, /** @type {string} */ line) {
    try {
      await ensureDirs();
      const prefix = !checkedFiles.has(file) && !(await endsWithNewline(file)) ? '\n' : '';
      await appendFile(file, prefix + line, 'utf8');
      checkedFiles.add(file);
      registry.writable = true;
    } catch (e) {
      fail(e);
    }
  }

  /** Rejoue le journal d'un mois (AAAA-MM) dans `into` ; une ligne illisible (écriture coupée) est ignorée mais comptée. */
  async function replayMonth(/** @type {string} */ key, /** @type {Map<string, Scenario>} */ into) {
    let text = '';
    try {
      text = await readFile(path.join(journalDir, `${key}.jsonl`), 'utf8');
    } catch (e) {
      if (/** @type {NodeJS.ErrnoException} */ (e).code !== 'ENOENT') {
        pushError(`journal/${key}.jsonl : lecture impossible dans ${root} : ${errMsg(e)}`);
      }
      return; // fichier absent : rien à rejouer
    }
    let dropped = 0;
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line);
        if (ev && ev.scenario && typeof ev.scenario.id === 'string') into.set(ev.scenario.id, ev.scenario);
        else if (ev && ev.type === 'retour' && typeof ev.id === 'string' && VOTES.has(ev.vote)) {
          // Retour compact : delta appliqué au scénario déjà relu (scénario d'un mois non relu : ignoré).
          const cur = into.get(ev.id);
          if (cur) into.set(ev.id, withVote(cur, ev.vote));
        } else dropped += 1;
      } catch {
        dropped += 1; // ligne coupée : ignorée mais comptée
      }
    }
    if (dropped > 0) pushError(`journal/${key}.jsonl : ${dropped} ligne${dropped > 1 ? 's' : ''} illisible${dropped > 1 ? 's' : ''} ignorée${dropped > 1 ? 's' : ''}`);
  }

  // Relecture au démarrage : mois précédent puis mois en cours.
  const month = parisMonth(now);
  for (const key of [previousMonth(month), month]) await replayMonth(key, scenarios);

  /** Scénarios d'un mois (AAAA-MM) tels que le journal de ce mois les a laissés (bilan d'un mois ancien). */
  async function scenariosOfMonth(/** @type {string} */ key) {
    await queue; // écritures en cours terminées
    /** @type {Map<string, Scenario>} */
    const out = new Map();
    await replayMonth(key, out);
    return out;
  }
  try {
    await ensureDirs();
  } catch (e) {
    fail(e);
  }

  /**
   * Retour compact : un vote de plus en mémoire, une ligne `{ at, type: 'retour', id, vote }` au journal. Scénario inconnu : false, rien
   * n'est écrit.
   * @param {string} id
   * @param {Vote} vote
   * @param {number} at
   */
  function recordVote(id, vote, at) {
    const cur = scenarios.get(id);
    if (!cur || !VOTES.has(vote)) return Promise.resolve(false);
    scenarios.set(id, withVote(cur, vote));
    /** @type {VoteEvent} */
    const event = { at: new Date(at).toISOString(), type: 'retour', id, vote };
    return enqueue(() => append(path.join(journalDir, `${parisMonth(at)}.jsonl`), `${JSON.stringify(event)}\n`)).then(() => true);
  }

  /** @param {JournalEvent} event */
  function record(event) {
    scenarios.set(event.scenario.id, event.scenario);
    const t = Date.parse(event.at);
    const key = parisMonth(Number.isFinite(t) ? t : Date.now());
    const line = `${JSON.stringify(event)}\n`;
    return enqueue(() => append(path.join(journalDir, `${key}.jsonl`), line));
  }

  /**
   * @param {Signal[]} signals
   * @param {number} at
   */
  function archiveSignals(signals, at) {
    return enqueue(() => archiveNow(signals, at));
  }

  // Jours dont le fichier a atteint le plafond : plus aucun ajout ce jour-là.
  const cappedDays = new Set();

  async function archiveNow(/** @type {Signal[]} */ signals, /** @type {number} */ at) {
    const kept = archivedCopy(signals);
    const fingerprint = kept.map((s) => `${s.id}|${s.level}|${s.value}`).sort().join('\n');
    if (fingerprint === lastFingerprint && at - lastArchiveAt < ARCHIVE_EVERY_MS) return;
    const day = parisDay(at);
    if (cappedDays.has(day)) return;
    const file = path.join(signalsDir, `${day}.jsonl`);
    try {
      if ((await stat(file)).size >= archiveMaxBytes) {
        cappedDays.add(day);
        pushError(`archive des signaux du ${day} : plafond de 50\u00a0Mo atteint`);
        return;
      }
    } catch {
      // fichier absent : premier ajout du jour
    }
    lastFingerprint = fingerprint;
    lastArchiveAt = at;
    const line = JSON.stringify({ at: new Date(at).toISOString(), signals: kept });
    await append(file, `${line}\n`);
  }

  /**
   * Signaux archivés dont le relevé tombe dans [from, to] (ISO). Lit les fichiers des jours de Paris qui couvrent la fenêtre ;
   * fichier absent ou ligne illisible : ignorés. Attend les écritures en cours pour voir ce qui vient d'être archivé.
   * @param {string} from
   * @param {string} to
   * @returns {Promise<Signal[]>}
   */
  async function signalsBetween(from, to) {
    const a = Date.parse(from), b = Date.parse(to);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return [];
    await queue;
    /** @type {Signal[]} */
    const out = [];
    // Jours de Paris couverts, chacun lu une seule fois (le pas de 12 h peut retomber sur le même jour).
    /** @type {Set<string>} */
    const days = new Set();
    for (let t = a; t <= b; t += 6 * 3_600_000) days.add(parisDay(t));
    days.add(parisDay(b));
    for (const day of [...days].sort()) {
      try {
        // Lecture ligne à ligne : l'horodatage de la ligne est lu avant de tout analyser, une ligne hors fenêtre n'est pas décodée.
        await forEachLine(path.join(signalsDir, `${day}.jsonl`), (line) => {
          const head = /^\{"at":"([^"]+)"/.exec(line);
          const t = head ? Date.parse(head[1]) : NaN;
          if (head && (!Number.isFinite(t) || t < a || t > b)) return;
          try {
            const row = JSON.parse(line);
            const at = Date.parse(row?.at);
            if (Number.isFinite(at) && at >= a && at <= b && Array.isArray(row.signals)) for (const sg of row.signals) out.push(sg);
          } catch {
            // ligne coupée : ignorée
          }
        });
      } catch {
        continue; // jour absent ou compacté : rien à relire
      }
    }
    return out;
  }

  /** @param {number} at */
  function compact(at) {
    return enqueue(() => compactNow(at));
  }

  async function compactNow(/** @type {number} */ at) {
    const limit = new Date(at);
    limit.setUTCMonth(limit.getUTCMonth() - KEEP_MONTHS);
    const limitDay = parisDay(limit.getTime());
    let names;
    try {
      names = await readdir(signalsDir);
    } catch {
      return; // dossier absent : rien à compacter
    }
    for (const name of names) {
      const m = /^(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(name);
      if (!m || m[1] >= limitDay) continue;
      try {
        const counts = {};
        const seen = new Set();
        await forEachLine(path.join(signalsDir, name), (line) => {
          let row;
          try { row = JSON.parse(line); } catch { return; }
          for (const s of Array.isArray(row?.signals) ? row.signals : []) {
            if (seen.has(s.id)) continue; // un signal vu dans plusieurs relevés du jour compte une fois
            seen.add(s.id);
            for (const d of Array.isArray(s.dept) && s.dept.length ? s.dept : ['n.d.']) {
              const k = `${s.kind}|${d}`;
              counts[k] = (counts[k] ?? 0) + 1;
            }
          }
        });
        await writeFile(path.join(signalsDir, `${m[1]}.summary.json`), `${JSON.stringify({ day: m[1], counts })}\n`, 'utf8');
        await unlink(path.join(signalsDir, name));
      } catch (e) {
        pushError(`signals/${name} : compaction impossible dans ${root} : ${errMsg(e)}`);
      }
    }
  }

  return registry;
}
