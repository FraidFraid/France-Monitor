import { MAIN_HOSPITALS_DB } from '../config/hospitals-db';

export async function fetchHospitalsData(): Promise<GeoJSON.FeatureCollection<GeoJSON.Point>> {
    // Option : En production, ce service devrait fetch('/data/hospitals.json') généré 
    // par le script de la DREES (FINESS data).
    // Pour l'instant, nous intégrons directement le top 20 des gros CHU pour maquer la tension vitale.

    const features: GeoJSON.Feature<GeoJSON.Point>[] = MAIN_HOSPITALS_DB.map(h => ({
        type: 'Feature',
        geometry: {
            type: 'Point',
            coordinates: [h.lon, h.lat]
        },
        properties: {
            finess: h.finess,
            name: h.name,
            type: h.type,
            beds: h.beds,
            emergency: h.emergency
        }
    }));

    return {
        type: 'FeatureCollection',
        features
    };
}
