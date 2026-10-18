// src/services/webcams.fixture.ts : jeu de webcams d'exemple partagé par les tests (contrat docs/webcams_format.md de flux_osint).
import type { Webcam, WebcamsDataset } from '../types/index.ts';

export const CAM: Webcam = {
  id: 'grand-lyon:CWVV011', name: 'La Soie · Av. de Bohlen', lat: 45.7664, lon: 4.9296, commune: 'Vaulx-en-Velin', dept: '69',
  source: 'grand-lyon', pageUrl: null, imageUrl: 'https://download.data.grandlyon.com/files/rdata/x/CWVV011.JPG', streamUrl: null,
  license: 'Licence Ouverte 2.0', attribution: '© Métropole de Lyon (Criter)', status: 'ok', httpStatus: 200, contentType: 'image/jpeg',
  checkedAt: '2026-10-18T17:00:00.000Z', countable: true,
};
export const DS: WebcamsDataset = {
  generatedAt: '2026-10-18T17:00:00.000Z',
  sources: [
    { id: 'grand-lyon', name: 'Métropole de Lyon', license: 'Licence Ouverte 2.0', url: 'https://www.data.gouv.fr/datasets/x/', count: 1 },
    { id: 'osm', name: 'OpenStreetMap', license: 'ODbL', url: 'https://www.openstreetmap.org', count: 1 },
  ],
  webcams: [
    CAM,
    { ...CAM, id: 'osm:node/1', name: 'Col du Lautaret', source: 'osm', imageUrl: null, pageUrl: 'https://example.org/cam', license: null,
      attribution: '© contributeurs OpenStreetMap', status: 'down', httpStatus: 404, contentType: 'text/html', countable: false, commune: null, dept: null },
  ],
};
