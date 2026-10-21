/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** Identifiant du build (vite.config.ts, define) : version des scripts autonomes de public/. */
declare const __BUILD_ID__: string;

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
