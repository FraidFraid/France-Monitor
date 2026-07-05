import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import type {
  ActiveFire,
  DetectedSituation,
  MeteoAlert,
  NewsItem,
  PowerOutage,
  TelecomOutage,
} from '../types/index.ts';
import type { TrafficIncident } from './traffic.ts';
import {
  buildExportFilename,
  collectExportableLayers,
  EXPORT_PROVENANCE,
  layerToCsv,
  serializeFires,
  serializeMeteoAlerts,
  serializeNews,
  serializeOutages,
  serializeSituations,
  serializeTrafficIncidents,
  toCsv,
  toGeoJson,
  type ExportableLayer,
  type ExportContext,
} from './data-export.ts';

// ─── Fixtures typées ──────────────────────────────────────────────────────────

function newsItem(overrides: Partial<NewsItem> = {}): NewsItem {
  return {
    id: 'n1',
    source: 'Le Télégramme',
    title: 'Grève des transports à Rennes',
    link: 'https://example.test/a',
    pubDate: new Date('2026-07-05T12:00:00Z'),
    isAlert: false,
    ...overrides,
  };
}

function situation(overrides: Partial<DetectedSituation> = {}): DetectedSituation {
  return {
    id: 'energy-stress-paca',
    type: 'ENERGY_STRESS',
    severity: 'high',
    confidence: 0.82,
    title: 'Tension électrique en PACA',
    summary: 'Signal Écowatt orange + pic de consommation.',
    affectedZones: ['PACA', 'Occitanie'],
    drivers: ['Écowatt orange', 'Vague de chaleur'],
    recommendedActions: [],
    sourceRefs: ['ecowatt'],
    updatedAt: new Date('2026-07-05T13:30:00Z'),
    ...overrides,
  };
}

function fire(overrides: Partial<ActiveFire> = {}): ActiveFire {
  return {
    id: 'f1',
    latitude: 43.5,
    longitude: 6.1,
    bright_ti4: 340.2,
    scan: 0.4,
    track: 0.4,
    acq_date: '2026-07-05',
    acq_time: '1348',
    satellite: 'NOAA-20',
    confidence: 'nominal',
    version: '2.0',
    bright_ti5: 300,
    frp: 12.5,
    daynight: 'D',
    ...overrides,
  };
}

// ─── toCsv : échappement, BOM, séparateur ─────────────────────────────────────

describe('toCsv', () => {
  const columns = [
    { key: 'a', label: 'colonne a' },
    { key: 'b', label: 'colonne b' },
  ];

  it('préfixe un BOM UTF-8 et sépare par « ; »', () => {
    const csv = toCsv([{ a: 'x', b: 'y' }], columns);
    assert.ok(csv.startsWith('﻿'), 'doit commencer par le BOM');
    assert.ok(csv.includes('colonne a;colonne b'), 'en-tête séparé par ;');
    assert.ok(csv.includes('x;y'), 'valeurs séparées par ;');
  });

  it('échappe les guillemets, points-virgules et retours ligne', () => {
    const csv = toCsv(
      [{ a: 'dit "bonjour"; salut', b: 'ligne1\nligne2' }],
      columns,
    );
    assert.ok(csv.includes('"dit ""bonjour""; salut"'), 'guillemets doublés + entourés');
    assert.ok(csv.includes('"ligne1\nligne2"'), 'retour ligne entouré de guillemets');
  });

  it('rend les valeurs nulles/indéfinies comme cellules vides', () => {
    const csv = toCsv([{ a: null, b: undefined }], columns);
    const lines = csv.replace('﻿', '').split('\r\n');
    assert.equal(lines[1], ';');
  });

  it('conserve les nombres avec séparateur décimal point (compatibilité SIG)', () => {
    const csv = toCsv([{ a: 43.5, b: -1.25 }], columns);
    assert.ok(csv.includes('43.5;-1.25'));
  });
});

// ─── toGeoJson : validité, [lng,lat], exclusion, metadata ─────────────────────

describe('toGeoJson', () => {
  it('produit une FeatureCollection avec coordonnées [lng, lat]', () => {
    const json = JSON.parse(
      toGeoJson([{ lat: 48.85, lon: 2.35, properties: { nom: 'Paris' } }]),
    );
    assert.equal(json.type, 'FeatureCollection');
    assert.equal(json.features.length, 1);
    assert.equal(json.features[0].geometry.type, 'Point');
    assert.deepEqual(json.features[0].geometry.coordinates, [2.35, 48.85]);
    assert.equal(json.features[0].properties.nom, 'Paris');
  });

  it('exclut les entités sans coordonnées finies', () => {
    const json = JSON.parse(
      toGeoJson([
        { lat: 48.85, lon: 2.35, properties: {} },
        { lat: Number.NaN, lon: 2.35, properties: {} },
        { lat: 45, lon: Number.POSITIVE_INFINITY, properties: {} },
      ]),
    );
    assert.equal(json.features.length, 1);
  });

  it('inclut une metadata racine quand fournie', () => {
    const json = JSON.parse(
      toGeoJson([], { source: EXPORT_PROVENANCE, exporte_le: '2026-07-05T14:00:00.000Z' }),
    );
    assert.equal(json.metadata.source, EXPORT_PROVENANCE);
    assert.equal(json.features.length, 0);
  });
});

// ─── Sérialiseurs représentatifs ──────────────────────────────────────────────

describe('serializeNews', () => {
  it('inclut toutes les lignes mais géolocalise seulement les items avec coords', () => {
    const { rows, features } = serializeNews([
      newsItem({ id: 'n1', lat: 48.1, lon: -1.68, locationName: 'Rennes' }),
      newsItem({ id: 'n2', lat: undefined, lon: undefined, feedRegion: 'Bretagne' }),
    ]);
    assert.equal(rows.length, 2, 'les 2 items sont en CSV');
    assert.equal(features.length, 1, 'seul l’item géolocalisé est en GeoJSON');
    assert.deepEqual([features[0].lon, features[0].lat], [-1.68, 48.1]);
    assert.equal(rows[1].lieu, 'Bretagne', 'fallback feedRegion pour le lieu');
    assert.equal(rows[0].date, '2026-07-05T12:00:00.000Z', 'date ISO');
  });

  it('reporte gravité et catégorie depuis la classification', () => {
    const { rows } = serializeNews([
      newsItem({ threat: { level: 'high', category: 'social', confidence: 0.7, source: 'keyword' } }),
    ]);
    assert.equal(rows[0].gravite, 'high');
    assert.equal(rows[0].categorie, 'social');
  });
});

describe('serializeSituations', () => {
  it('aplatit zones et facteurs et géolocalise si coords présentes', () => {
    const { rows, features, columns } = serializeSituations([
      situation({ lat: 43.3, lon: 5.4 }),
      situation({ id: 's2', lat: undefined, lon: undefined }),
    ]);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].zones, 'PACA, Occitanie');
    assert.equal(rows[0].facteurs, 'Écowatt orange, Vague de chaleur');
    assert.equal(rows[0].confiance, 0.82);
    assert.equal(features.length, 1);
    assert.deepEqual([features[0].lon, features[0].lat], [5.4, 43.3]);
    assert.ok(columns.some((c) => c.label === 'gravité'));
  });
});

describe('serializeFires', () => {
  it('compose une date ISO depuis acq_date + acq_time et géolocalise tout', () => {
    const { rows, features } = serializeFires([fire(), fire({ id: 'f2', acq_time: '905' })]);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].date, '2026-07-05T13:48:00Z');
    assert.equal(rows[1].date, '2026-07-05T09:05:00Z', 'heure sur 3 chiffres complétée');
    assert.equal(features.length, 2);
    assert.deepEqual([features[0].lon, features[0].lat], [6.1, 43.5]);
    assert.equal(rows[0].frp, 12.5);
  });
});

describe('serializeMeteoAlerts', () => {
  it('traduit les risques et ne produit aucune feature (pas de point)', () => {
    const alerts: MeteoAlert[] = [
      {
        department: 'Var',
        departmentCode: '83',
        level: 'orange',
        risks: ['heat', 'thunderstorm'],
        startDate: new Date('2026-07-05T06:00:00Z'),
      },
    ];
    const { rows, features } = serializeMeteoAlerts(alerts);
    assert.equal(rows[0].risques, 'Canicule, Orages');
    assert.equal(rows[0].debut, '2026-07-05T06:00:00.000Z');
    assert.equal(rows[0].fin, null);
    assert.equal(features.length, 0);
  });
});

describe('serializeOutages', () => {
  it('fusionne électricité (sans point) et télécom (géolocalisé)', () => {
    const power: PowerOutage[] = [
      {
        departmentCode: '29',
        departmentName: 'Finistère',
        offGridCount: 3200,
        totalPDL: 400000,
        eventCause: 'Tempête Caetano',
        trend: 'worsening',
      },
    ];
    const telecom: TelecomOutage[] = [
      {
        id: 't1',
        operator: 'Orange',
        department: 'Finistère',
        city: 'Brest',
        voiceStatus: 'HS',
        dataStatus: 'Degraded',
        reason: 'Coupure fibre',
        coordinates: [-4.49, 48.39],
      },
    ];
    const { rows, features } = serializeOutages(power, telecom);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].type, 'Électricité');
    assert.equal(rows[0].foyers, 3200);
    assert.equal(rows[1].type, 'Télécom');
    assert.equal(features.length, 1, 'seul le télécom géolocalisé');
    assert.deepEqual([features[0].lon, features[0].lat], [-4.49, 48.39]);
  });
});

describe('serializeTrafficIncidents', () => {
  it('joint les numéros de route et géolocalise', () => {
    const incidents: TrafficIncident[] = [
      {
        id: 'i1',
        lon: 4.83,
        lat: 45.75,
        type: 'Accident',
        severity: 'high',
        delay: 600,
        length: 1200,
        description: 'Accident A7',
        roadNumbers: ['A7', 'A47'],
      },
    ];
    const { rows, features } = serializeTrafficIncidents(incidents);
    assert.equal(rows[0].routes, 'A7, A47');
    assert.equal(features.length, 1);
    assert.deepEqual([features[0].lon, features[0].lat], [4.83, 45.75]);
  });
});

// ─── Nom de fichier ───────────────────────────────────────────────────────────

describe('buildExportFilename', () => {
  it('formate france-monitor-<layer>-<YYYYMMDD-HHmm>.<ext>', () => {
    const name = buildExportFilename('feux', 'csv', new Date(2026, 6, 5, 9, 4));
    assert.equal(name, 'france-monitor-feux-20260705-0904.csv');
  });
});

// ─── Composition & sélection ──────────────────────────────────────────────────

function emptyContext(): ExportContext {
  return {
    news: [],
    situations: [],
    meteoAlerts: [],
    floods: [],
    fires: [],
    powerOutages: [],
    telecomOutages: [],
    trafficIncidents: [],
  };
}

describe('collectExportableLayers', () => {
  it('omet les couches vides et compte les items des couches pleines', () => {
    const ctx: ExportContext = {
      ...emptyContext(),
      news: [newsItem(), newsItem({ id: 'n2' })],
      fires: [fire()],
    };
    const layers = collectExportableLayers(ctx);
    assert.equal(layers.length, 2);
    const keys = layers.map((l) => l.key);
    assert.deepEqual(keys, ['actualites', 'feux'], 'ordre stable, couches vides omises');
    assert.equal(layers[0].count, 2);
  });

  it('retourne une liste vide quand aucun cache n’a de données', () => {
    assert.deepEqual(collectExportableLayers(emptyContext()), []);
  });
});

describe('layerToCsv', () => {
  it('ajoute les colonnes de provenance exporte_le et source_donnees', () => {
    const serialized = serializeNews([newsItem()]);
    const layer: ExportableLayer = { key: 'actualites', label: 'Actualités', count: 1, serialized };
    const csv = layerToCsv(layer, new Date('2026-07-05T14:00:00Z'));
    const lines = csv.replace('﻿', '').split('\r\n');
    assert.ok(lines[0].endsWith('exporte_le;source_donnees'), 'colonnes de provenance en fin d’en-tête');
    assert.ok(lines[1].includes('2026-07-05T14:00:00.000Z'), 'horodatage ISO présent');
    assert.ok(lines[1].includes(EXPORT_PROVENANCE), 'chaîne de provenance présente');
  });
});
