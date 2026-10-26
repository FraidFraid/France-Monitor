// src/services/upcoming.test.ts : échéances annoncées par les sources (26/10/2026).
import { describe, expect, it } from 'vitest';
import type { EcowattResponse, ProtestItem, VigilanceResponse } from '../types/index.ts';
import { parisDay, upcomingFromSources } from './upcoming.ts';

const NOW = Date.parse('2026-10-26T14:00:00Z');
const day = (date: string, level: 'green' | 'orange' | 'red') => ({ date, level, message: level === 'green' ? 'Pas d’alerte.' : 'Consommation élevée.', hours: [] });
const ecowatt = (source: 'rte' | 'odre', levels: Array<'green' | 'orange' | 'red'>): EcowattResponse =>
  ({ official: { source, generatedAt: null, days: levels.map((l, i) => day(`2026-10-${26 + i}`, l)) } }) as unknown as EcowattResponse;
const vigilance = (departments: Array<{ code: string; name: string; color: 1 | 2 | 3 | 4; phenomena: Array<{ id: string; color: 1 | 2 | 3 | 4 }> }>): VigilanceResponse =>
  ({ periods: [{ echeance: 'J', begin: '2026-10-25T22:00:00Z', departments: [] }, { echeance: 'J1', begin: '2026-10-26T23:00:00Z', departments }] }) as unknown as VigilanceResponse;
const protest = (startsAt: string, city: string | null, source = 'giletsjaunes', status = 'annonce'): ProtestItem =>
  ({ id: `${startsAt}-${city}`, source, status, startsAt, city }) as unknown as ProtestItem;
const run = (over: Partial<Parameters<typeof upcomingFromSources>[0]>) => upcomingFromSources({ ecowatt: null, vigilance: null, protests: null, now: NOW, ...over });

describe('Écowatt (RTE)', () => {
  it('jours à venir non verts : une ligne par jour, niveau RTE, attribuée', () => {
    const items = run({ ecowatt: ecowatt('rte', ['green', 'orange', 'green', 'red']) });
    expect(items.map((i) => [i.day, i.level, i.source])).toEqual([['2026-10-27', 'orange', 'RTE'], ['2026-10-29', 'rouge', 'RTE']]);
  });
  it('tout vert : « aucune alerte annoncée jusqu’au … » ; le jour même n’est jamais une échéance', () => {
    expect(run({ ecowatt: ecowatt('rte', ['red', 'green', 'green', 'green']) }).map((i) => i.title)).toEqual(['Écowatt : aucune alerte annoncée jusqu\'au 29/10']);
  });
  it('repli ODRÉ (jours passés) : jamais présenté comme une annonce', () => {
    expect(run({ ecowatt: ecowatt('odre', ['orange', 'orange']) })).toEqual([]);
  });
});

describe('vigilance Météo-France de J+1', () => {
  it('orange et rouge nommés par département et phénomène ; jaune compté', () => {
    const items = run({ vigilance: vigilance([
      { code: '29', name: 'Finistère', color: 3, phenomena: [{ id: '1', color: 3 }] },
      { code: '56', name: 'Morbihan', color: 3, phenomena: [{ id: '1', color: 3 }, { id: '2', color: 2 }] },
      { code: '35', name: 'Ille-et-Vilaine', color: 2, phenomena: [{ id: '2', color: 2 }] },
    ]) });
    expect(items.map((i) => [i.day, i.level, i.title, i.detail])).toEqual([
      ['2026-10-27', 'orange', 'Vigilance orange vent violent dans 2 départements', 'Finistère (29), Morbihan (56)'],
      ['2026-10-27', 'jaune', 'Vigilance jaune dans 1 département', null],
    ]);
  });
  it('aucun département jaune ou plus : dit en clair ; carte non lue : rien', () => {
    expect(run({ vigilance: vigilance([]) }).map((i) => i.title)).toEqual(['Météo-France : aucune vigilance jaune ou plus annoncée']);
    expect(run({ vigilance: null })).toEqual([]);
  });
});

describe('rassemblements annoncés', () => {
  it('annonces des 7 prochains jours, groupées par jour, villes citées, jamais confirmées ; signalés et jour même écartés', () => {
    const items = run({ protests: [
      protest('2026-10-31T13:00:00Z', 'Toulouse'), protest('2026-10-31T14:00:00Z', 'Lyon'), protest('2026-10-31T14:00:00Z', 'Lyon', 'demosphere'),
      protest('2026-10-26T18:00:00Z', 'Paris'), protest('2026-11-10T10:00:00Z', 'Nantes'), protest('2026-10-31T10:00:00Z', 'Lille', 'presse', 'signale'),
    ] });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ day: '2026-10-31', level: null, title: '3 rassemblements annoncés', source: 'carte des gilets jaunes, Démosphère' });
    expect(items[0].detail).toBe('dont Toulouse, Lyon ; annonces publiques, non confirmées');
  });
});

describe('ordre et jour de Paris', () => {
  it('par jour puis par gravité publiée ; jour calculé à l’heure de Paris', () => {
    expect(parisDay(Date.parse('2026-10-26T23:30:00Z'))).toBe('2026-10-27');
    const items = run({ ecowatt: ecowatt('rte', ['green', 'green', 'orange']), protests: [protest('2026-10-27T10:00:00Z', 'Paris')],
      vigilance: vigilance([{ code: '13', name: 'Bouches-du-Rhône', color: 4, phenomena: [{ id: '3', color: 4 }] }]) });
    expect(items.map((i) => `${i.day} ${i.level ?? '-'}`)).toEqual(['2026-10-27 rouge', '2026-10-27 -', '2026-10-28 orange']);
  });
});
