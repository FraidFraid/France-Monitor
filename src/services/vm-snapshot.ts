// src/services/vm-snapshot.ts : lecture d'un relevé calculé par la VM (scripts/vm-snapshot.ts) avec le code même du navigateur.
// Rend le tableau s'il est de la bonne version, à jour et bien formé ; sinon null, et l'appelant calcule lui-même comme avant.

export async function readVmSnapshot<T>(
  url: string, version: number, maxAgeMs: number, wellFormed: (d: unknown) => boolean, now: number = Date.now(),
): Promise<T | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const body = await res.json() as { version?: unknown; generatedAt?: unknown; dashboard?: unknown };
    const at = typeof body.generatedAt === 'string' ? Date.parse(body.generatedAt) : Number.NaN;
    if (body.version !== version || !Number.isFinite(at) || now - at > maxAgeMs) return null;
    return body.dashboard && typeof body.dashboard === 'object' && wellFormed(body.dashboard) ? body.dashboard as T : null;
  } catch {
    return null;
  }
}
