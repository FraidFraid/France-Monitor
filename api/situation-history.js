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

import { redisSetNX, redisMGet, redisRPush, redisLTrim } from '../utils/redis.js';
import { currentSlotKey, buildSlotGrid } from '../utils/slots.js';

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

  const key = snapKey(payload.slotKey);
  const written = await redisSetNX(key, JSON.stringify(payload), SNAP_TTL);

  // Maintain a trimmed index of the 120 most-recent slot keys.
  // Currently unused by GET (which uses buildSlotGrid instead).
  // Reserved for a future "latest populated slot" query.
  if (written) {
    await redisRPush(INDEX_KEY, payload.slotKey);
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

  const count   = daysParam * 4;
  const current = currentSlotKey();
  const grid    = buildSlotGrid(current, count);
  const keys    = grid.map(snapKey);

  const raw = await redisMGet(keys);

  const slots = grid.map((slotKey, i) => {
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
