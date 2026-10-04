// tests/vigicrues.test.ts : lecture du flux InfoVigiCru et des référentiels Vigicrues (spec 2026-10-04 environnement § 2.2),
// sur des réponses réelles du 04/10/2026 (4 tronçons dont la Têt et l'Agly en jaune, territoire 21).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseInfoVigiCru, parseSectionStations, parseTerritories, sectionStationsUrl, territoryUrl } from '../api/_lib/vigicrues.js';

const fx = (name: string): string => readFileSync(new URL(`./fixtures/environment/${name}`, import.meta.url), 'utf8');
const fxJson = <T>(name: string): T => JSON.parse(fx(name)) as T;

interface InfoFeature { properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } }
const info = (): { type: string; features: InfoFeature[] } => fxJson('vigicrues-infovigicru-reduit.geojson');

describe('InfoVigiCru', () => {
  it('comptes par niveau, tronçons jaunes et plus avec leur tracé publié et leur territoire', () => {
    const parsed = parseInfoVigiCru(info());
    expect([parsed.total, parsed.counts, parsed.unreadable]).toEqual([4, { vert: 2, jaune: 2, orange: 0, rouge: 0 }, 0]);
    expect(parsed.sections.map((s) => [s.id, s.name, s.level, s.territoryCode])).toEqual([['MO12', 'Têt', 2, '21'], ['MO11', 'Agly', 2, '21']]);
    // Tracé tel que publié par Vigicrues : aucun recalage.
    expect(parsed.sections[0].path).toEqual([[[2.369602999999433, 42.58782099999868], [2.374479999998804, 42.595693999995774], [2.377472000004463, 42.597535999998115]]]);
    expect(parsed.sections[1].path).toHaveLength(2);
  });
  it('rouges d’abord, puis orange, puis jaunes ; ordre du flux à niveau égal', () => {
    const fc = info();
    fc.features[2].properties.NivInfViCr = 4;
    fc.features[1].properties.NivInfViCr = 3;
    expect(parseInfoVigiCru(fc).sections.map((s) => s.id)).toEqual(['CO1', 'MO11', 'MO12']);
  });
  it('niveau illisible : compté à part, jamais en vert', () => {
    const fc = info();
    fc.features[3].properties.NivInfViCr = 7;
    const parsed = parseInfoVigiCru(fc);
    expect([parsed.total, parsed.counts.vert, parsed.unreadable]).toEqual([3, 1, 1]);
  });
  it('forme inattendue : erreur', () => {
    expect(() => parseInfoVigiCru({ type: 'FeatureCollection' })).toThrow('flux InfoVigiCru sans tronçons');
    expect(() => parseInfoVigiCru({ type: 'FeatureCollection', features: [{ properties: {} }] })).toThrow('flux InfoVigiCru sans tronçon lisible');
  });
});

describe('référentiels Vigicrues', () => {
  it('territoires : 20 services, « 21 » = Méditerranée Ouest ; page du territoire', () => {
    const t = parseTerritories(fxJson('vigicrues-terent.json'));
    expect([Object.keys(t).length, t['21'], t['26']]).toEqual([20, 'Méditerranée Ouest', 'Méditerranée Est (bassin Corse)']);
    expect(territoryUrl('21')).toBe('https://www.vigicrues.gouv.fr/territoire/21');
  });
  it('stations d’un tronçon : entités filles de type 7, ordre du référentiel', () => {
    expect(sectionStationsUrl('MO12')).toBe('https://www.vigicrues.gouv.fr/services/TronEntVigiCru.json?CdEntVigiCru=MO12&TypEntVigiCru=8');
    expect(parseSectionStations(fxJson('vigicrues-tronent-MO12.json'))).toEqual([
      { code: 'Y046401001', name: 'Vinca' }, { code: 'Y047403001', name: 'Perpignan [Pont-Joffre]' }, { code: 'Y046600501', name: 'Ille-sur-Têt' },
    ]);
    const json = fxJson<{ ListEntVigiCru: Array<{ aNMoinsUn: Array<Record<string, string>> }> }>('vigicrues-tronent-MO11.json');
    json.ListEntVigiCru[0].aNMoinsUn.push({ CdEntVigiCruInferieur: 'MO11b', TypEntVigiCruInferieur: '8', LbEntVigiCruInferieur: 'Tronçon fils' });
    expect(parseSectionStations(json)).toEqual([{ code: 'Y067406001', name: 'Rivesaltes' }]);
    expect(() => parseSectionStations({ ListEntVigiCru: [] })).toThrow('référentiel du tronçon illisible');
  });
});
