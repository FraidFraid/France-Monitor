// server/prod/traffic-collectors.mjs : relève serveur des collectes à quota (spec 2026-10-03 panneaux
// trafic, T4). Lancée par server/prod/http-server.mjs quand il tourne en production (VM) : toutes les
// minutes, chaque collecteur vérifie s'il est dû et ne fait rien sinon. Les routes appellent les mêmes
// fonctions : sans relève (dev, panne du minuteur), la collecte se fait à la demande, à la même cadence.
import { ensureAirFresh } from '../../api/_shared/air-traffic.js';
import { ensureUrbanFresh } from '../../api/_lib/tomtom-urban.js';

export const COLLECTOR_TICK_MS = 60_000;

/** Collecteurs : nom et fonction `(now) => Promise<unknown>` qui ne collecte que si c'est dû. */
export const COLLECTORS = [
  { name: 'tomtom', run: ensureUrbanFresh },
  { name: 'opensky', run: ensureAirFresh },
];

/**
 * Démarre la relève ; rend une fonction d'arrêt. Une erreur d'un collecteur est journalisée (message seul,
 * jamais d'URL : celle de TomTom porte la clé) et n'arrête ni les autres ni la relève suivante.
 * @param {{ collectors?: Array<{ name: string, run: (now: number) => Promise<unknown> }>, tickMs?: number, now?: () => number, log?: Pick<Console, 'error'> }} [options]
 */
export function startTrafficCollectors({ collectors = COLLECTORS, tickMs = COLLECTOR_TICK_MS, now = () => Date.now(), log = console } = {}) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      for (const c of collectors) {
        try {
          await c.run(now());
        } catch (err) {
          log.error(`[collecte ${c.name}] ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => { void tick(); }, tickMs);
  timer.unref?.();
  void tick();
  return () => clearInterval(timer);
}
