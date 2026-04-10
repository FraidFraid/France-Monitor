// src/plugins/situation-history-proxy.ts
// Vite dev proxy for /api/situation-history (POST + GET).
//
// In dev mode Redis is unavailable, so we return minimal valid stub responses
// that match the production shapes exactly, preventing client errors:
//   POST → { stored: false }
//   GET  → HistoryResponse with all slots marked as missing

import type { Plugin } from 'vite';

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

function buildMissingHistoryResponse(days: 7 | 30): object {
  const count = days * 4;
  const current = currentSlotKey();
  const grid = buildSlotGrid(current, count);

  return {
    requestedRange: {
      from: grid[0] + ':00.000Z',
      to:   grid[grid.length - 1] + ':00.000Z',
    },
    slotCount: {
      expected: count,
      captured: 0,
      missing:  count,
      degraded: 0,
    },
    slots: grid.map((slotKey) => ({ slotKey, status: 'missing' })),
  };
}

export function situationHistoryProxyPlugin(): Plugin {
  return {
    name: 'situation-history-proxy',
    configureServer(server) {
      server.middlewares.use('/api/situation-history', (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');

        // POST — stub: no Redis in dev, signal stored: false
        if (req.method === 'POST') {
          let body = '';
          req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
          req.on('end', () => {
            // Consume body to avoid socket errors; no validation needed in dev
            void body;
            res.statusCode = 200;
            res.end(JSON.stringify({ stored: false }));
          });
          return;
        }

        // GET — return a valid HistoryResponse with all slots missing
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
          res.end(JSON.stringify(buildMissingHistoryResponse(daysParam as 7 | 30)));
          return;
        }

        res.statusCode = 405;
        res.end(JSON.stringify({ error: 'Method not allowed' }));
      });
    },
  };
}
