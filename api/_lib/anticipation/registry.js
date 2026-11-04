// api/_lib/anticipation/registry.js : registre sur disque de l'anticipation (04/11/2026). Journal des scénarios (JSONL par mois de
// Paris), archive des signaux (JSONL par jour de Paris, réécrite seulement quand l'ensemble change ou après 15 min) et compaction
// au-delà de 13 mois. L'état est rebâti au démarrage en rejouant le journal du mois en cours et du précédent (même id : pas de doublon).
// Une écriture ne lève jamais : sur échec, `writable` passe à false, l'erreur nomme le dossier et la mémoire reste à jour.
import { appendFile, mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { parisDay } from '../../_shared/paris-day.js';

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

const DEFAULT_DIR = '/var/lib/francemonitor/data/anticipation';
const ARCHIVE_EVERY_MS = 15 * 60_000;
const KEEP_MONTHS = 13;

/** Mois de Paris AAAA-MM. */
const parisMonth = (/** @type {number} */ ms) => parisDay(ms).slice(0, 7);
/** Mois précédent d'une clé AAAA-MM. */
function previousMonth(/** @type {string} */ key) {
  const [y, m] = key.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}
const errMsg = (/** @type {unknown} */ e) => (e instanceof Error ? e.message : String(e));

/**
 * @param {{ dir?: string, now: number }} opts
 */
export async function openRegistry({ dir, now }) {
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
    state: () => scenarios,
    record,
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
      let prefix = '';
      if (!checkedFiles.has(file)) {
        try {
          const existing = await readFile(file, 'utf8');
          if (existing.length > 0 && !existing.endsWith('\n')) prefix = '\n';
        } catch (e) {
          if (/** @type {NodeJS.ErrnoException} */ (e).code !== 'ENOENT') throw e;
        }
      }
      await appendFile(file, prefix + line, 'utf8');
      checkedFiles.add(file);
      registry.writable = true;
    } catch (e) {
      fail(e);
    }
  }

  // Relecture du journal : mois précédent puis mois en cours, une ligne illisible (écriture coupée) est ignorée.
  const month = parisMonth(now);
  for (const key of [previousMonth(month), month]) {
    let text = '';
    try {
      text = await readFile(path.join(journalDir, `${key}.jsonl`), 'utf8');
    } catch (e) {
      if (/** @type {NodeJS.ErrnoException} */ (e).code !== 'ENOENT') {
        pushError(`journal/${key}.jsonl : lecture impossible dans ${root} : ${errMsg(e)}`);
      }
      continue; // fichier absent : rien à rejouer
    }
    let dropped = 0;
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line);
        if (ev && ev.scenario && typeof ev.scenario.id === 'string') scenarios.set(ev.scenario.id, ev.scenario);
        else dropped += 1;
      } catch {
        dropped += 1; // ligne coupée : ignorée mais comptée
      }
    }
    if (dropped > 0) pushError(`journal/${key}.jsonl : ${dropped} ligne${dropped > 1 ? 's' : ''} illisible${dropped > 1 ? 's' : ''} ignorée${dropped > 1 ? 's' : ''}`);
  }
  try {
    await ensureDirs();
  } catch (e) {
    fail(e);
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

  async function archiveNow(/** @type {Signal[]} */ signals, /** @type {number} */ at) {
    const fingerprint = signals.map((s) => `${s.id}|${s.level}|${s.value}`).sort().join('\n');
    if (fingerprint === lastFingerprint && at - lastArchiveAt < ARCHIVE_EVERY_MS) return;
    lastFingerprint = fingerprint;
    lastArchiveAt = at;
    const line = JSON.stringify({ at: new Date(at).toISOString(), signals });
    await append(path.join(signalsDir, `${parisDay(at)}.jsonl`), `${line}\n`);
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
      let text;
      try {
        text = await readFile(path.join(signalsDir, `${day}.jsonl`), 'utf8');
      } catch {
        continue; // jour absent ou compacté : rien à relire
      }
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          const row = JSON.parse(line);
          const at = Date.parse(row?.at);
          if (Number.isFinite(at) && at >= a && at <= b && Array.isArray(row.signals)) out.push(...row.signals);
        } catch {
          // ligne coupée : ignorée
        }
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
        for (const line of (await readFile(path.join(signalsDir, name), 'utf8')).split('\n')) {
          if (!line.trim()) continue;
          let row;
          try { row = JSON.parse(line); } catch { continue; }
          for (const s of Array.isArray(row?.signals) ? row.signals : []) {
            if (seen.has(s.id)) continue; // un signal vu dans plusieurs relevés du jour compte une fois
            seen.add(s.id);
            for (const d of Array.isArray(s.dept) && s.dept.length ? s.dept : ['n.d.']) {
              const k = `${s.kind}|${d}`;
              counts[k] = (counts[k] ?? 0) + 1;
            }
          }
        }
        await writeFile(path.join(signalsDir, `${m[1]}.summary.json`), `${JSON.stringify({ day: m[1], counts })}\n`, 'utf8');
        await unlink(path.join(signalsDir, name));
      } catch (e) {
        pushError(`signals/${name} : compaction impossible dans ${root} : ${errMsg(e)}`);
      }
    }
  }

  return registry;
}
