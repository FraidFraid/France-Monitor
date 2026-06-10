// Extracted from DeckGLMap.ts — base map style helpers.
import maplibregl from 'maplibre-gl';

// ─── Base map style ───
// Carto Dark Matter - French labels applied via setMapLanguage after style load
export const BASE_STYLE_URL = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

// Satellite basemap layer ID — injected into Carto style at init, toggled by setBasemapSatellite()
export const LYR_SATELLITE = 'wm-basemap-satellite';

/**
 * Fetch and modify style to use French labels before applying to map.
 * This is more reliable than post-hoc modification.
 */
export async function getFrenchStyle(): Promise<maplibregl.StyleSpecification> {
  const response = await fetch(BASE_STYLE_URL);
  const style = await response.json() as maplibregl.StyleSpecification;

  // Modify all symbol layers to use French names
  for (const layer of style.layers || []) {
    if (layer.type !== 'symbol') continue;
    const layout = (layer as maplibregl.SymbolLayerSpecification).layout;
    if (!layout || !('text-field' in layout)) continue;

    const textField = layout['text-field'];
    const textFieldStr = JSON.stringify(textField);

    // Skip layers that don't reference 'name'
    if (!textFieldStr.includes('name')) continue;

    // Replace with French-first coalesce expression
    layout['text-field'] = ['coalesce',
      ['get', 'name:fr'],
      ['get', 'name_fr'],
      ['get', 'name']
    ] as maplibregl.ExpressionSpecification;
  }

  // ─── Inject Esri World Imagery satellite source ───
  // MVP: Esri tiles are free for display use, no API key needed.
  // Upgrade path: swap the tile URL for a self-hosted raster tile service.
  (style.sources as Record<string, maplibregl.SourceSpecification>)['esri-satellite'] = {
    type: 'raster',
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    tileSize: 256,
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP',
    maxzoom: 19,
  };

  // Insert satellite raster layer right after 'background' — below all Carto fills but above
  // the map background.  setBasemapSatellite() hides the opaque Carto fill layers when active
  // so the satellite imagery is fully visible with roads/labels rendered on top.
  const bgIdx = (style.layers || []).findIndex((l) => l.id === 'background');
  const insertAt = bgIdx >= 0 ? bgIdx + 1 : 0;
  (style.layers as maplibregl.LayerSpecification[]).splice(insertAt, 0, {
    id: LYR_SATELLITE,
    type: 'raster',
    source: 'esri-satellite',
    layout: { visibility: 'none' },
  } as maplibregl.RasterLayerSpecification);

  return style;
}
