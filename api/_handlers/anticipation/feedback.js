// api/_handlers/anticipation/feedback.js : retour « Utile / Déjà su / Faux » sur un scénario (04/11/2026). Un vote par empreinte, par scénario et
// par jour de Paris. L'empreinte est sha256(sel aléatoire du jour + adresse IP) : le sel ne vit qu'en mémoire et change à minuit (Paris),
// l'adresse et l'empreinte ne sont jamais écrites (ni disque, ni journal) ; seul le compteur du scénario l'est.
// Revue finale : corps JSON exigé (415), 50 retours au plus par empreinte et par jour, 120 retours acceptés au plus par minute (429).
import { createHash, randomBytes } from 'node:crypto';
import { parisDay } from '../../../src/services/paris-day.js';
import { getClientIp } from '../../_utils/rate-limit.js';
import { recordFeedback } from '../../_lib/anticipation/room.js';

const VOTES = new Set(['utile', 'deja_su', 'faux']);
/** Retours au plus par empreinte et par jour de Paris, tous scénarios confondus. */
export const MAX_VOTES_PER_FINGERPRINT_DAY = 50;
/** Retours acceptés au plus par minute, toutes adresses confondues. */
export const MAX_VOTES_PER_MINUTE = 120;

/** @type {{ day: string, salt: string, seen: Set<string>, perFingerprint: Map<string, number> }} */
let daily = { day: '', salt: '', seen: new Set(), perFingerprint: new Map() };
/** Retours acceptés dans la minute en cours (fenêtre fixe). */
let minute = { key: -1, count: 0 };

/** Réservé aux tests : repart d'un sel, d'ensembles et de compteurs vides. */
export function __resetFeedbackForTests() {
  daily = { day: '', salt: '', seen: new Set(), perFingerprint: new Map() };
  minute = { key: -1, count: 0 };
}

/** En-tête Content-Type JSON (`application/json`, paramètres admis). */
function isJson(/** @type {any} */ req) {
  const raw = req?.headers?.['content-type'];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === 'string' && /^application\/json\s*(;|$)/i.test(v.trim());
}

/** Adresse du client derrière Caddy et Cloudflare : `cf-connecting-ip`, sinon `x-forwarded-for` / `x-real-ip` (même lecture que le limiteur de débit). */
function clientIp(/** @type {any} */ req) {
  const h = req?.headers ?? {};
  const cf = h['cf-connecting-ip'];
  if (typeof cf === 'string' && cf.trim()) return cf.trim();
  const get = (/** @type {string} */ k) => { const v = h[k]; return Array.isArray(v) ? v[0] : (typeof v === 'string' ? v : null); };
  return getClientIp({ headers: { get } });
}

function fingerprint(/** @type {any} */ req, /** @type {number} */ now) {
  const day = parisDay(now);
  if (daily.day !== day) daily = { day, salt: randomBytes(16).toString('hex'), seen: new Set(), perFingerprint: new Map() };
  return createHash('sha256').update(daily.salt + clientIp(req)).digest('hex');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'méthode non autorisée' });
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  if (!isJson(req)) {
    res.status(415).json({ error: 'corps JSON attendu (Content-Type: application/json)' });
    return;
  }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  const scenarioId = body && typeof body === 'object' ? body.scenarioId : null;
  const vote = body && typeof body === 'object' ? body.vote : null;
  if (typeof scenarioId !== 'string' || !scenarioId || scenarioId.length > 200 || typeof vote !== 'string' || !VOTES.has(vote)) {
    res.status(400).json({ error: 'corps invalide' });
    return;
  }
  const now = Date.now();
  const fp = fingerprint(req, now);
  const key = `${fp}:${scenarioId}`;
  if (daily.seen.has(key)) {
    res.status(429).json({ error: 'un seul retour par scénario et par jour' });
    return;
  }
  const mine = daily.perFingerprint.get(fp) ?? 0;
  if (mine >= MAX_VOTES_PER_FINGERPRINT_DAY) {
    res.status(429).json({ error: "trop de retours aujourd'hui depuis cette adresse" });
    return;
  }
  const minuteKey = Math.floor(now / 60_000);
  if (minute.key !== minuteKey) minute = { key: minuteKey, count: 0 };
  if (minute.count >= MAX_VOTES_PER_MINUTE) {
    // Refus passager (pas « déjà voté ») : le client le lit à l'en-tête Retry-After et ne mémorise pas le vote.
    res.setHeader('Retry-After', String(60 - Math.floor((now % 60_000) / 1000)));
    res.status(429).json({ error: 'trop de retours en ce moment, nouvel essai dans une minute' });
    return;
  }
  // Clé et compteurs posés avant l'attente : deux requêtes simultanées ne passent pas toutes les deux ; retirés si le scénario est inconnu.
  daily.seen.add(key);
  daily.perFingerprint.set(fp, mine + 1);
  const slot = minute;
  slot.count += 1;
  if (!(await recordFeedback(scenarioId, /** @type {'utile'|'deja_su'|'faux'} */ (vote), now))) {
    daily.seen.delete(key);
    const n = daily.perFingerprint.get(fp);
    if (typeof n === 'number') daily.perFingerprint.set(fp, Math.max(0, n - 1));
    slot.count = Math.max(0, slot.count - 1);
    res.status(400).json({ error: 'scénario inconnu' });
    return;
  }
  res.status(204).end();
}
