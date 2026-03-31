/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare module '*.geojson' {
  const value: {
    type: 'FeatureCollection';
    features: Array<{
      type?: 'Feature';
      geometry: {
        type: 'LineString' | 'MultiLineString';
        coordinates: [number, number][] | [number, number][][];
      };
      properties?: Record<string, unknown>;
    }>;
  };

  export default value;
}
