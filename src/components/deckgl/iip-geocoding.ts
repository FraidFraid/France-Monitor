// Extracted from DeckGLMap.ts — IIP asset geocoding.
import { NUCLEAR_PLANTS, NUCLEAR_UNITS } from '../../config/infrastructure.ts';
import type { RTEIIPIncident } from '../../services/rte-iip.ts';

// ─── IIP asset geocoding ───────────────────────────────────────────────────────

// Static lookup for non-nuclear production assets (hydro, thermal, biomasse…)
export const IIP_ASSET_COORDS: Record<string, [number, number]> = {
  'GRAND MAISON':       [6.086,  45.227],
  'MONTEZIC':           [2.673,  44.767],
  'SUPER BISSORTE':     [6.699,  45.272],
  'REVIN':              [4.640,  49.942],
  'VOUGLANS':           [5.685,  46.531],
  'MAREGES':            [2.354,  45.366],
  'MAREGE':             [2.354,  45.366],
  'COMBE D AVRIEUX':    [6.736,  45.215],
  'COMBE AVRIEUX':      [6.736,  45.215],
  'PROVENCE':           [5.482,  43.500],
  'SAINT AVOLD':        [6.708,  49.108],
  'EMILE HUCHET':       [6.708,  49.108],
  'MARTIGUES':          [5.030,  43.410],
  'PONTEAU':            [5.030,  43.410],
  'CORDEMAIS':          [-1.885, 47.275],
  'PORCHEVILLE':        [1.893,  48.972],
  'ARRIGHI':            [9.200,  42.100],
  'TOUL ROSSIERES':     [5.883,  48.604],
  'BRAUD':              [-0.678, 45.244],
  'PREGUILLAC':         [-0.538, 45.042],
  'BOUTRE':             [6.034,  43.714],
  'MUHLBACH':           [7.230,  47.978],
  'LONNY':              [4.545,  49.827],
  'AVELIN':             [3.147,  50.527],
  'BAIXAS':             [2.814,  42.743],
  'ALBERTVILLE':        [6.394,  45.675],
  'VALDONNE':           [5.597,  43.695],
};

// Build a flat lookup: normalized unit name → plant coords
export const _iipNuclearLookup: Map<string, [number, number]> = (() => {
  const m = new Map<string, [number, number]>();
  const plantById = new Map(NUCLEAR_PLANTS.map(p => [p.id, p.coordinates as [number, number]]));
  for (const u of NUCLEAR_UNITS) {
    const coords = plantById.get(u.plantId);
    if (!coords) continue;
    m.set(u.unitName.toUpperCase().replace(/[-_]/g, ' '), coords);
    for (const alias of (u.aliases ?? [])) {
      m.set(alias.toUpperCase().replace(/[-_]/g, ' '), coords);
    }
    // Also index by plant name alone
    m.set(u.plantName.toUpperCase().replace(/[-_]/g, ' '), coords);
  }
  return m;
})();

export function resolveIIPCoords(inc: RTEIIPIncident): [number, number] | null {
  const label = (inc.assetLabel || inc.title).toUpperCase().replace(/[-_]/g, ' ').trim();

  // 1. Direct nuclear unit match (e.g. "GOLFECH 2", "PALUEL 3")
  if (_iipNuclearLookup.has(label)) return _iipNuclearLookup.get(label)!;

  // 2. Prefix nuclear match (asset label starts with a unit name)
  for (const [key, coords] of _iipNuclearLookup) {
    if (label.startsWith(key) || key.startsWith(label.replace(/\s+\d+$/, '').trim())) {
      return coords;
    }
  }

  // 3. Static non-nuclear lookup
  for (const [key, coords] of Object.entries(IIP_ASSET_COORDS)) {
    if (label.includes(key) || key.includes(label.split(' ').slice(0, 2).join(' '))) {
      return coords;
    }
  }

  // 4. For transmission: extract place names from "Liaison NNN kV A – B"
  if (inc.type === 'transmission') {
    const m = label.match(/(\d{2,3}\s*KV)\s+([A-ZÀÉÈÊÎÔÙÛ][A-ZÀÉÈÊÎÔÙÛ\s]+?)\s*[-–]\s*([A-ZÀÉÈÊÎÔÙÛ][A-ZÀÉÈÊÎÔÙÛ\s\d]+)/);
    if (m) {
      const a = m[2].trim();
      const b = m[3].trim().replace(/\s+\d+$/, '').trim();
      const ca = IIP_ASSET_COORDS[a] ?? _iipNuclearLookup.get(a) ?? null;
      const cb = IIP_ASSET_COORDS[b] ?? _iipNuclearLookup.get(b) ?? null;
      if (ca && cb) return [(ca[0] + cb[0]) / 2, (ca[1] + cb[1]) / 2];
      if (ca) return ca;
      if (cb) return cb;
    }
  }

  return null;
}
