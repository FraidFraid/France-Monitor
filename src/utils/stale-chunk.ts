// Garde « chunk périmé » : après un déploiement, les anciens fichiers JS hachés n'existent plus.
// Un onglet resté sur l'ancienne version (ou servi par l'ancien service worker) échoue alors sur
// ses imports dynamiques et reste sur un écran noir. On recharge pour récupérer la nouvelle version.

/** Délai minimal entre deux rechargements automatiques dans un même onglet (anti-boucle). */
export const STALE_CHUNK_RELOAD_COOLDOWN_MS = 30_000;

const STALE_CHUNK_PATTERNS = [
  'Failed to fetch dynamically imported module', // Chrome
  'error loading dynamically imported module', // Firefox
  'Importing a module script failed', // Safari
  'Unable to preload CSS', // préchargeur Vite
  'Failed to load module script', // fichier remplacé par une page HTML
];

export function isStaleChunkError(message: string): boolean {
  return STALE_CHUNK_PATTERNS.some((p) => message.includes(p));
}

/**
 * Vrai si l'onglet peut se recharger. `lastReload` est l'horodatage (ms) du dernier rechargement
 * automatique gardé en sessionStorage. L'ancien drapeau (« 1 », une fois par session) bloquait toute
 * récupération au déploiement suivant dans le même onglet : on ne bloque plus que les rechargements
 * rapprochés, qui signalent une boucle.
 */
export function shouldReloadForStaleChunk(lastReload: string | null, now: number): boolean {
  const last = Number(lastReload);
  if (!lastReload || !Number.isFinite(last)) return true;
  return now - last > STALE_CHUNK_RELOAD_COOLDOWN_MS;
}
