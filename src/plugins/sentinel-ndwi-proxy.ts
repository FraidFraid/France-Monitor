/**
 * Relais de développement de /api/sentinel-ndwi (20/10/2026) : sert le gestionnaire de production (api/sentinel-ndwi.ts), hors
 * du routeur commun, donc absent du repli api-router-fallback. Plus de copie de la logique ici : l'ancienne copie gardait le
 * choix « scène la plus récente sur ± 2 jours », qui donnait des images presque vides en bordure de fauchée. Le gestionnaire lit
 * lui-même le corps brut : on n'y touche pas avant de l'appeler.
 */
import type { Plugin } from 'vite';

type NdwiHandler = (req: unknown, res: unknown) => Promise<void>;

export function sentinelNdwiProxyPlugin(): Plugin {
  return {
    name: 'sentinel-ndwi-proxy',
    configureServer(server) {
      server.middlewares.use('/api/sentinel-ndwi', (req, res, next) => {
        import('../../api/sentinel-ndwi.ts')
          .then((mod) => (mod as unknown as { default: NdwiHandler }).default(req, res))
          .catch((err: unknown) => next(err instanceof Error ? err : new Error(String(err))));
      });
    },
  };
}
