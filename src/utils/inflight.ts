/**
 * inflight.ts — Déduplication des requêtes concurrentes (single-flight).
 *
 * Plusieurs services de FranceMonitor sont appelés au démarrage à la fois par
 * un « warm-up » précoce (ex: widget baromètre réseau, `renderShell()`) et par
 * le chargement des couches critiques une fois la carte prête. Sans garde, ces
 * deux appels quasi simultanés déclenchent chacun leur propre requête réseau
 * (constaté en prod : `vigilance` ×2, `ecowatt` ×2, `cert.ssi` ×2, etc. —
 * docs/audit-2026-09-annexes/E-mesures-prod.md).
 *
 * `dedupe()` garantit qu'un seul appel réseau est en vol à la fois pour une
 * même clé : tout appelant qui arrive pendant que la promesse est en cours
 * reçoit la MÊME promesse plutôt que d'en déclencher une nouvelle. Dès que la
 * promesse se résout (succès OU échec), l'entrée est retirée : l'appel
 * suivant relance un fetch normal (pas de cache TTL ici, seulement un verrou
 * de concurrence — le TTL reste la responsabilité de chaque service, cf.
 * `persistentCache.ts` pour la persistance).
 */

const inFlight = new Map<string, Promise<unknown>>();

/**
 * Exécute `fn()` en garantissant qu'un seul appel est en vol pour `key` à la
 * fois. Les appels concurrents sur la même clé partagent la promesse en
 * cours ; un appel après résolution (succès ou échec) relance `fn()`.
 */
export function dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;

  const promise = fn().finally(() => {
    // Ne retirer que si c'est toujours notre propre promesse : une clé peut
    // avoir été réutilisée entre-temps par un appel ultérieur si `fn()` a
    // levé de façon synchrone puis été relancée (cas limite, protection
    // défensive sans coût).
    if (inFlight.get(key) === promise) inFlight.delete(key);
  });

  inFlight.set(key, promise);
  return promise;
}

/**
 * `fetch` JSON en single-flight, clé = URL complète (+ méthode si fournie).
 * Deux appelants qui interrogent la même URL pendant que la requête est en
 * vol partagent la même réponse au lieu de doubler l'appel réseau — c'est ce
 * qui permet à `cyber.ts` et `threat-map.ts` de partager le même fetch
 * CERT-FR/ransomware.live sans se connaître l'un l'autre : ils construisent
 * la même URL de proxy et retombent donc sur la même clé.
 *
 * Lève une erreur sur réponse HTTP non-OK (le corps caller doit gérer via
 * try/catch, comme un `fetch` classique suivi d'une vérification `.ok`).
 */
export async function fetchJsonOnce<T>(url: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? 'GET';
  const key = `${method} ${url}`;
  return dedupe(key, async () => {
    const response = await fetch(url, init);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  });
}

/** Utilitaire de test : vide le registre des requêtes en vol. */
export function _resetInFlightForTests(): void {
  inFlight.clear();
}
