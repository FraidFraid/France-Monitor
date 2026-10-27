// src/services/vm-snapshot.ts : lecture d'un relevé calculé par la VM (scripts/vm-snapshot.ts) avec le code même du navigateur.
// Rend le tableau s'il est de la bonne version, à jour et bien formé ; sinon null, et l'appelant calcule lui-même comme avant.

/**
 * Délai de lecture. Le serveur répond en quelques millisecondes, mais sur une page très chargée (enregistreur de la note sur la VM,
 * carte dessinée sans carte graphique) recevoir et décoder le relevé dépassait 10 s : le relevé était jeté et le calcul de secours
 * lançait une centaine de requêtes (/api/oil-proxy, /api/fuel-prices-proxy), d'où carburants et pétrole absents de relevés (27/10/2026).
 */
export const VM_SNAPSHOT_TIMEOUT_MS = 30_000;

export async function readVmSnapshot<T>(
  url: string, version: number, maxAgeMs: number, wellFormed: (d: unknown) => boolean, now: number = Date.now(),
): Promise<T | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(VM_SNAPSHOT_TIMEOUT_MS) });
    if (!res.ok) return null;
    const body = await res.json() as { version?: unknown; generatedAt?: unknown; dashboard?: unknown };
    const at = typeof body.generatedAt === 'string' ? Date.parse(body.generatedAt) : Number.NaN;
    if (body.version !== version || !Number.isFinite(at) || now - at > maxAgeMs) return null;
    return body.dashboard && typeof body.dashboard === 'object' && wellFormed(body.dashboard) ? body.dashboard as T : null;
  } catch {
    return null;
  }
}
