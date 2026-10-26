// src/services/event-pressure.ts : lecture de /api/news/event-pressure (26/10/2026) : événements sociaux et de sécurité distincts sur
// 24 h complètes, comptés par le serveur (la page ne lit que les 1 000 derniers articles). Entrée des situations SOCIAL_MOBILISATION et
// SECURITY_UNREST (situation-engine.ts) ; jamais de rejet : une réponse absente, en erreur ou mal formée donne null, et null ne lève
// aucune de ces deux situations.
import type { EventPressureResponse } from '../types/index.ts';

export const EVENT_PRESSURE_URL = '/api/news/event-pressure';
/** Relève : 10 min (cache serveur 10 min). */
export const EVENT_PRESSURE_POLL_MS = 10 * 60_000;

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

export function isEventPressureResponse(v: unknown): v is EventPressureResponse {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.readAt === 'string' && typeof r.since === 'string' && isCount(r.socialEvents24h) && isCount(r.securityHighEvents24h);
}

export async function fetchEventPressure(fetchImpl: typeof fetch = fetch): Promise<EventPressureResponse | null> {
  try {
    const resp = await fetchImpl(EVENT_PRESSURE_URL, { signal: AbortSignal.timeout(15_000) });
    if (!resp.ok) return null;
    const body: unknown = await resp.json();
    return isEventPressureResponse(body) ? body : null;
  } catch {
    return null;
  }
}
