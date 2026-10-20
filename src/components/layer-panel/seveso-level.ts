// src/components/layer-panel/seveso-level.ts : exposition et niveau de la pastille Sites Seveso (20/10/2026). Pur et léger : l'app
// l'importe pour le voyant et la carte sans charger la vue entière du panneau (layer-panel/seveso.ts).
import type { Exposure, ExposureAsset, ExposureResult } from '../../services/environment-exposure.ts';
import type { SevesoDataset } from '../../services/exposure-assets.ts';
import { LEVEL_RANK, type VigilanceLevel } from '../../services/vigilance.ts';

export const isSeveso = (a: ExposureAsset): boolean => a.kind === 'seveso-haut' || a.kind === 'seveso-bas';

/**
 * Niveau de la pastille : phénomène le plus grave touchant un site seuil haut ; un site seuil bas compte un cran plus bas (rouge
 * vaut orange). Aucun site exposé : vert (croisement fait). Fichier ou phénomènes indisponibles : n.d.
 */
export function sevesoHeadLevel(data: SevesoDataset | null, exposed: readonly Exposure[] | null): VigilanceLevel | 'nd' {
  if (data === null || exposed === null) return 'nd';
  let best: VigilanceLevel = 'vert';
  for (const e of exposed) {
    if (!isSeveso(e.asset)) continue;
    const l: VigilanceLevel = e.asset.kind === 'seveso-bas' && e.hazard.level === 'rouge' ? 'orange' : e.hazard.level;
    if (LEVEL_RANK[l] > LEVEL_RANK[best]) best = l;
  }
  return best;
}

/**
 * Sites Seveso exposés : proches d'un phénomène localisé (croisement de l'onglet), plus les sites seuil haut d'un département en
 * vigilance orange ou rouge dont le phénomène les concerne (distance null : « dans le département »). Le plus grave d'abord.
 */
export function sevesoExposures(result: ExposureResult | null, sites: readonly ExposureAsset[]): Exposure[] | null {
  if (result === null) return null;
  const out = result.nearby.filter((e) => isSeveso(e.asset));
  const seen = new Set(out.map((e) => e.asset.id));
  for (const d of result.departmental) {
    if (!d.hazard.kinds.includes('seveso-haut')) continue;
    for (const a of sites) {
      if (a.kind !== 'seveso-haut' || a.dept !== d.dept || seen.has(a.id)) continue;
      seen.add(a.id);
      out.push({ asset: a, hazard: d.hazard, distanceKm: null });
    }
  }
  return out.sort((x, y) => LEVEL_RANK[y.hazard.level] - LEVEL_RANK[x.hazard.level] || (x.distanceKm ?? 1e9) - (y.distanceKm ?? 1e9));
}
