// api/situation-history.js
// Vercel Node function — situation history store + read.
//
// POST /api/situation-history
//   Body: SituationSnapshot (JSON)
//   Stores the snapshot in Redis with SET NX (idempotent per slot).
//   Returns: { stored: boolean }
//
// GET /api/situation-history?days=7|30
//   Builds the canonical UTC slot grid, fetches all slots via MGET,
//   returns missing slots explicitly as { slotKey, status: "missing" }.
//   Relevés de l'enregistreur de la VM (api/_lib/score-history.js) d'abord, Redis (navigateurs) pour les créneaux qu'il n'a pas.
// GET /api/situation-history?days=7|30&resolution=15m
//   Relevés bruts de l'enregistreur de la VM, au quart d'heure : { records }.

import { redisGet, redisSet, redisMGet, redisRPush, redisLTrim } from '../_utils/redis.js';
import { currentSlotKey, buildSlotGrid } from '../_utils/slots.js';
import { preferSnapshot, readScoreRecords, recentRecords, slotsFromRecords } from '../_lib/score-history.js';
import { asRateLimitRequest, checkRateLimit } from '../_utils/rate-limit.js';

/** Envois par adresse et par minute (une page en fait un par créneau de 6 h, deux si sa couverture progresse). */
const PUSH_RATE_LIMIT_PER_MIN = 6;
/** Taille maximale d'un relevé rangé (un relevé réel pèse 2 à 4 Ko). */
const MAX_SNAPSHOT_BYTES = 16 * 1024;
const SEVERITIES = ['critical', 'high', 'medium', 'watch'];

// eslint-disable-next-line no-control-regex
const text = (value, max) => (typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max) : '');
const num = (value, min, max) => (typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : null);

/**
 * Relevé reconstruit champ par champ : rien de ce que le client envoie n'est rangé tel quel. null si la forme n'est pas celle
 * d'un relevé. Exportée pour les tests.
 */
export function sanitizeSnapshot(payload, slotKey) {
  if (!payload || typeof payload !== 'object' || payload.version !== 1 || !Number.isFinite(payload.score)) return null;
  const capturedMs = Date.parse(payload.capturedAt);
  const axes = {};
  for (const key of ['continuity', 'defense', 'security', 'signal', 'cyber', 'social']) axes[key] = num(payload.axes?.[key], 0, 100);
  const situations = (Array.isArray(payload.situations) ? payload.situations : []).slice(0, 10)
    .filter((s) => s && typeof s === 'object' && SEVERITIES.includes(s.severity))
    .map((s) => ({
      id: text(s.id, 80),
      type: text(s.type, 40),
      severity: s.severity,
      title: text(s.title, 160),
      topDriver: text(s.topDriver, 100),
      affectedZones: (Array.isArray(s.affectedZones) ? s.affectedZones : []).slice(0, 3).map((z) => text(z, 60)).filter(Boolean),
      confidence: num(s.confidence, 0, 1) ?? 0,
    }));
  const total = num(payload.coverage?.total, 0, 200);
  const read = num(payload.coverage?.read, 0, total ?? 0);
  const clean = {
    ...payload.dataStatus && typeof payload.dataStatus === 'object'
      ? {
        dataStatus: {
          overall: payload.dataStatus.overall === 'ok' ? 'ok' : 'degraded',
          sources: Object.fromEntries(['countryAxes', 'cyber', 'social'].map((k) => [k, payload.dataStatus.sources?.[k] === 'ok' ? 'ok' : 'missing'])),
        },
      }
      : {},
    version: 1,
    slotKey,
    capturedAt: Number.isFinite(capturedMs) ? new Date(capturedMs).toISOString() : new Date().toISOString(),
    score: num(payload.score, 0, 100),
    axes,
    situations,
    meta: {
      totalSituations: num(payload.meta?.totalSituations, 0, 500) ?? situations.length,
      maxSeverity: SEVERITIES.includes(payload.meta?.maxSeverity) ? payload.meta.maxSeverity : null,
      avgConfidence: num(payload.meta?.avgConfidence, 0, 1) ?? 0,
    },
    ...(total !== null && read !== null ? { coverage: { read, total } } : {}),
  };
  return JSON.stringify(clean).length <= MAX_SNAPSHOT_BYTES ? clean : null;
}

const SNAP_TTL    = 31 * 24 * 60 * 60; // 31 days in seconds
const INDEX_KEY   = 'france:history:index';
const SLOT_RE     = /^\d{4}-\d{2}-\d{2}T(?:00|06|12|18):00$/;
const snapKey = (slot) => `france:history:${slot}`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'POST')   return handlePush(req, res);
  if (req.method === 'GET')    return handleRead(req, res);
  res.status(405).end();
}

// ─── POST ─────────────────────────────────────────────────────────────────────

async function handlePush(req, res) {
  const payload = req.body;
  if (
    !payload
    || typeof payload !== 'object'
    || typeof payload.slotKey !== 'string'
    || !SLOT_RE.test(payload.slotKey)
    || !Number.isFinite(payload.score)
    || payload.version !== 1
  ) {
    return res.status(400).json({ error: 'invalid_payload' });
  }

  // Prevent outsized payloads — legitimate clients send at most 10 situations
  if (Array.isArray(payload.situations) && payload.situations.length > 20) {
    return res.status(400).json({ error: 'payload_too_large' });
  }

  // En production la VM enregistre la note elle-même (scripts/score-recorder.mjs, fichier lu par le GET) : les relevés des
  // navigateurs ne sont plus rangés. N'importe qui pouvait écrire un relevé falsifié, servi ensuite à tous, et remplir le
  // stockage Redis (audit du 13/11/2026). Réponse 200 pour que la page n'insiste pas.
  if (process.env.NODE_ENV === 'production') {
    return res.status(200).json({ stored: false, reason: 'recorder_only' });
  }

  // Hors production (poste de développement) : créneau courant seulement, relevé reconstruit et borné, débit limité.
  if (payload.slotKey !== currentSlotKey()) {
    return res.status(400).json({ error: 'slot_not_current' });
  }
  const rl = await checkRateLimit('situation-history', asRateLimitRequest(req), PUSH_RATE_LIMIT_PER_MIN);
  if (!rl.allowed) return res.status(429).json({ error: 'Too Many Requests' });
  const clean = sanitizeSnapshot(payload, payload.slotKey);
  if (!clean) return res.status(400).json({ error: 'invalid_payload' });

  // Le relevé le plus couvrant garde le créneau (26/10/2026) : avant, le premier reçu le figeait, souvent pris avant que la page ait
  // lu ses sources.
  const key = snapKey(clean.slotKey);
  const storedRaw = await redisGet(key);
  let stored = null;
  try { stored = storedRaw ? JSON.parse(storedRaw) : null; } catch { stored = null; }
  const written = preferSnapshot(stored, clean)
    ? await redisSet(key, JSON.stringify(clean), SNAP_TTL).then(() => true, () => false)
    : false;

  // Maintain a trimmed index of the 120 most-recent slot keys.
  // Currently unused by GET (which uses buildSlotGrid instead).
  // Reserved for a future "latest populated slot" query.
  if (written && !stored) {
    await redisRPush(INDEX_KEY, clean.slotKey);
    await redisLTrim(INDEX_KEY, 0, 119);
  }

  res.status(200).json({ stored: written });
}

// ─── GET ──────────────────────────────────────────────────────────────────────

async function handleRead(req, res) {
  const daysParam = Number(req.query.days);
  if (daysParam !== 7 && daysParam !== 30) {
    return res.status(400).json({ error: 'days must be 7 or 30' });
  }

  const records = await readScoreRecords();
  if (req.query.resolution === '15m') {
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ records: recentRecords(records, daysParam) });
  }

  const count   = daysParam * 4;
  const current = currentSlotKey();
  const grid    = buildSlotGrid(current, count);
  const fromVm  = slotsFromRecords(grid, records);
  const keys    = grid.map(snapKey);

  const raw = await redisMGet(keys);

  const slots = grid.map((slotKey, i) => {
    const vm = fromVm.get(slotKey);
    if (vm) return vm;
    if (raw[i] === null) return { slotKey, status: 'missing' };
    try {
      return JSON.parse(raw[i]);
    } catch {
      return { slotKey, status: 'missing' };
    }
  });

  const captured = slots.filter(s => !('status' in s));
  const missing  = slots.filter(s => 'status' in s);
  const degraded = captured.filter(s => s.dataStatus?.overall === 'degraded');

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    requestedRange: {
      from: grid[0] + ':00.000Z',
      to:   grid[grid.length - 1] + ':00.000Z',
    },
    slotCount: {
      expected: count,
      captured: captured.length,
      missing:  missing.length,
      degraded: degraded.length,
    },
    slots,
  });
}
