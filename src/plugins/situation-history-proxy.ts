// src/plugins/situation-history-proxy.ts
// Vite dev proxy for /api/situation-history (POST + GET).
//
// In dev mode Redis is unavailable, so we use a local JSON file
// in public/data/history-dev.json to persist snapshots across restarts.
//   POST → Save/update snapshot in local file
//   GET  → Return HistoryResponse based on local file data

import type { Plugin } from 'vite';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import type { SituationSnapshot, HistoryResponse, HistorySlot } from '../types/index.ts';

const HISTORY_FILE = resolve(process.cwd(), 'public/data/history-dev.json');
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

function currentSlotKey(now = new Date()): string {
  const h = now.getUTCHours();
  const slotHour = h < 6 ? 0 : h < 12 ? 6 : h < 18 ? 12 : 18;
  const d = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    slotHour, 0, 0, 0,
  ));
  return d.toISOString().slice(0, 16); // "2026-04-10T12:00"
}

function buildSlotGrid(currentSlot: string, count: number): string[] {
  const base = new Date(currentSlot + ':00.000Z').getTime();
  const slots: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const ms = base - i * SIX_HOURS_MS;
    const d = new Date(ms);
    slots.push(d.toISOString().slice(0, 16));
  }
  return slots;
}

function ensureHistoryFile() {
  const dir = dirname(HISTORY_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(HISTORY_FILE)) {
    writeFileSync(HISTORY_FILE, JSON.stringify({ slots: [] }, null, 2));
  }
}

function getStoredSnapshots(): SituationSnapshot[] {
  ensureHistoryFile();
  try {
    const data = JSON.parse(readFileSync(HISTORY_FILE, 'utf-8'));
    return data.slots || [];
  } catch {
    return [];
  }
}

function storeSnapshot(snapshot: SituationSnapshot) {
  const snapshots = getStoredSnapshots();
  // Filter out any existing same-slot entry
  const filtered = snapshots.filter(s => s.slotKey !== snapshot.slotKey);
  filtered.push(snapshot);
  // Keep last 40 days (160 slots) max to avoid huge file
  const limited = filtered.slice(-160);
  writeFileSync(HISTORY_FILE, JSON.stringify({ slots: limited }, null, 2));
}

function buildHistoryResponse(days: 7 | 30): HistoryResponse {
  const count = days * 4;
  const current = currentSlotKey();
  const grid = buildSlotGrid(current, count);
  const stored = getStoredSnapshots();

  let captured = 0;
  let missing = 0;

  const slots = grid.map((slotKey): HistorySlot => {
    const match = stored.find(s => s.slotKey === slotKey);
    if (match) {
      captured++;
      return match;
    }
    missing++;
    return { slotKey, status: 'missing' };
  });

  return {
    requestedRange: {
      from: grid[0] + ':00.000Z',
      to:   grid[grid.length - 1] + ':00.000Z',
    },
    slotCount: {
      expected: count,
      captured,
      missing,
      degraded: 0,
    },
    slots,
  };
}

export function situationHistoryProxyPlugin(): Plugin {
  return {
    name: 'situation-history-proxy',
    configureServer(server) {
      server.middlewares.use('/api/situation-history', (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');

        // POST — persistence in local JSON
        if (req.method === 'POST') {
          let body = '';
          req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
          req.on('end', () => {
            try {
              const payload = JSON.parse(body) as SituationSnapshot;
              storeSnapshot(payload);
              res.statusCode = 200;
              res.end(JSON.stringify({ stored: true, local: true }));
            } catch (e) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Invalid payload' }));
            }
          });
          return;
        }

        // GET — return true HistoryResponse based on local file
        if (req.method === 'GET') {
          const url = new URL(req.url ?? '', 'http://localhost');
          const daysParam = Number(url.searchParams.get('days'));
          if (daysParam !== 7 && daysParam !== 30) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'days must be 7 or 30' }));
            return;
          }
          res.setHeader('Cache-Control', 'no-store');
          res.statusCode = 200;
          res.end(JSON.stringify(buildHistoryResponse(daysParam as 7 | 30)));
          return;
        }

        res.statusCode = 405;
        res.end(JSON.stringify({ error: 'Method not allowed' }));
      });
    },
  };
}
