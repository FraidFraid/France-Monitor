import { describe, expect, it } from 'vitest';
import { cityCase, giletsJaunesItems, indexPlaces } from '../api/_lib/protests-giletsjaunes.js';
import { isProtestsResponse } from '../src/services/protests.ts';

const NOW = Date.parse('2026-10-20T10:00:00Z');
const sites = { maj: '2026-09-15', lieux: [[805800297, 'peage', 49.48, 0.23, 'Péage de Fréville', 'Sanef', 'FRÉVILLE', '76190', '76']] };
const lieux = { lieux: [[500000001, 'manif', 44.60943, 2.02883, "Jardins de l'hôpital", '', 'Figeac', '46100', '46', '10:00', 0, 0]] };
const stations = {
  colonnes: ['id', 'lat', 'lon', 'ville', 'cp', 'adresse', 'dep', 'gazole', 'e10', 'maj'],
  stations: [[1000001, 46.201, 5.198, 'SAINT-DENIS-LÈS-BOURG', '01000', '596 AVENUE DE TREVOUX', '01', 2.4, 2.1, '2026-09-15']],
};
const actions = {
  actions: {
    '500000001': [['manifestation', '14:00', '2026-10-24', 0], ['assemblee', '18:00', '2026-10-24', 7320004]],
    '805800297': [['barrage_filtrant', '07:00', '2026-10-24', 0, 'Barrière de péage, sortie 4', 'message libre']],
    '1000001': [['blocage', '08:30', '2026-10-17', 0]],
    '999999999': [['rassemblement', '10:00', '2026-10-21', 0]],
  },
};

describe('carte des gilets jaunes (17octobregiletjaune.net, 20/10/2026)', () => {
  const places = indexPlaces(sites, lieux, stations);
  const r = giletsJaunesItems(actions, places, NOW);

  it('lieux des trois listes, stations lues par leurs colonnes nommées', () => {
    expect(places.get('1000001')).toMatchObject({ lat: 46.201, lon: 5.198, genre: 'station', city: 'SAINT-DENIS-LÈS-BOURG', dept: '01' });
    expect(places.get('805800297')).toMatchObject({ genre: 'peage', name: 'Péage de Fréville' });
  });

  it('fenêtre de 7 jours, assemblées écartées, lieu retiré compté sans position, message libre jamais repris', () => {
    expect(r.items.map((x) => x.id)).toEqual([
      'giletsjaunes:500000001:2026-10-24:14:00:manifestation',
      'giletsjaunes:805800297:2026-10-24:07:00:barrage_filtrant',
    ]);
    expect(r.unplaced).toBe(1);
    const barrage = r.items[1];
    expect(barrage).toMatchObject({ title: 'Barrage filtrant (gilets jaunes)', status: 'annonce', city: 'Fréville', place: 'Barrière de péage, sortie 4', startsAt: '2026-10-24T05:00:00.000Z' });
    expect(JSON.stringify(r.items)).not.toContain('message libre');
  });

  it('nom du lieu complété par son genre quand l’action ne précise rien', () => {
    const only = giletsJaunesItems({ actions: { '805800297': [['blocage', '09:00', '2026-10-22', 0]] } }, places, NOW);
    expect(only.items[0].place).toBe('Péage de Fréville');
    const st = giletsJaunesItems({ actions: { '1000001': [['blocage', '09:00', '2026-10-22', 0]] } }, places, NOW);
    expect(st.items[0]).toMatchObject({ place: '596 AVENUE DE TREVOUX (station-service)', city: 'Saint-Denis-lès-Bourg' });
  });

  it('communes en capitales écrites à la française', () => {
    expect(['MONTAUBAN-DE-BRETAGNE', 'LE MANS', "L'ISLE-D'ABEAU", 'Paris'].map(cityCase)).toEqual(['Montauban-de-Bretagne', 'Le Mans', "L'Isle-d'Abeau", 'Paris']);
  });

  it('acceptées par la garde du contrat côté client (sinon tout le panneau passerait à n.d.)', () => {
    const body = { readAt: new Date(NOW).toISOString(), items: r.items, demosphere: { readAt: null, editions: 0, failedEditions: [], scanned: 0 },
      gdelt: { readAt: null, files: 0, missingFiles: 0 }, presse: { readAt: null, scanned: 0, matched: 0, unplaced: 0 }, errors: [] };
    expect(isProtestsResponse(body)).toBe(true);
  });
});
