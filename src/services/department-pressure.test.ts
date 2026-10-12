import { describe, it, expect } from 'vitest';
import { departmentPressure, zoneDepartmentCodes } from './department-pressure.ts';
import type { DepartementIndex } from './departement-lookup.ts';
import type { WorkItem } from './work-queue.ts';
import type { DetectedSituation, FloodSectionRef, MeteoAlert, NewsEvent } from '../types/index.ts';

const NOW = Date.parse('2026-10-12T08:00:00Z');

// Index factice : 13 Bouches-du-Rhône au sud (lat < 44), 69 Rhône au nord.
const DEPTS: DepartementIndex = {
  // Hors métropole (géométrie limitée à la métropole, comme departements.geojson) : rien.
  at: (lon, lat) => (lon < -6 || lon > 10 || lat < 41 ? null : lat < 44 ? { code: '13', nom: 'Bouches-du-Rhône' } : { code: '69', nom: 'Rhône' }),
  nameOf: (code) => ({ '13': 'Bouches-du-Rhône', '69': 'Rhône', '59': 'Nord', '33': 'Gironde' } as Record<string, string>)[code] ?? null,
};

function event(over: Partial<NewsEvent> = {}): NewsEvent {
  return {
    id: 1, evidenceId: 'E1', title: 'Rixe à Marseille', category: 'security', severity: 'high', status: 'active',
    firstSeen: '2026-10-12T07:00:00Z', lastSeen: '2026-10-12T07:30:00Z', articleCount: 3, sourceCount: 3, independentCount: 3,
    sourceNames: [], lat: 43.3, lon: 5.4, ...over,
  };
}

function eventItem(e: NewsEvent, over: Partial<WorkItem> = {}): WorkItem {
  return {
    key: `event:${e.id}`, level: 'orange', title: e.title, place: null, since: NOW, independentSources: 3,
    theme: 'security', badge: null, ref: { kind: 'event', event: e }, ...over,
  };
}

function situationItem(over: Partial<DetectedSituation> = {}, item: Partial<WorkItem> = {}): WorkItem {
  const situation: DetectedSituation = {
    id: 'social', type: 'SOCIAL_ESCALATION', severity: 'medium', confidence: 0.6, title: 'Escalade sociale localisée',
    summary: '', affectedZones: ['Nord (59)'], drivers: [], recommendedActions: [], sourceRefs: [], updatedAt: new Date(NOW), ...over,
  };
  return { key: `situation:${situation.id}`, level: 'jaune', title: situation.title, place: null, since: NOW, independentSources: null,
    theme: 'security', badge: null, ref: { kind: 'situation', situation }, ...item };
}

const meteo = (over: Partial<MeteoAlert> = {}): MeteoAlert => ({ department: 'Gironde', departmentCode: '33', level: 'orange', risks: ['thunderstorm'], ...over });

describe('zoneDepartmentCodes', () => {
  it('codes entre parenthèses, « Dépt NN », Corse ; rien pour une zone sans code', () => {
    expect(zoneDepartmentCodes('Nord (59)')).toEqual(['59']);
    expect(zoneDepartmentCodes('Haute-Corse (2B)')).toEqual(['2B']);
    expect(zoneDepartmentCodes('Dépt 05')).toEqual(['05']);
    expect(zoneDepartmentCodes('France')).toEqual([]);
    expect(zoneDepartmentCodes('BOUCHES-DU-RHONE')).toEqual([]);
  });
});

describe('departmentPressure (12/10/2026)', () => {
  const base = { meteo: [], floods: [], departements: DEPTS, now: NOW };

  it('événements par leur lieu ; jamais l’étranger ni un sujet national sans lieu ; les verts ne comptent pas', () => {
    const out = departmentPressure({ ...base, items: [
      eventItem(event({ id: 1 })),
      eventItem(event({ id: 2, zone: 'etranger' })),
      eventItem(event({ id: 3, lat: null, lon: null })),
      eventItem(event({ id: 4, lat: 45.7, lon: 4.8 }), { level: 'vert' }),
    ] });
    expect(out.map((d) => [d.code, d.level, d.elements.map((e) => e.key)])).toEqual([['13', 'orange', ['event:1']]]);
  });

  it('situations par leur lieu, sinon par les codes de leurs zones ; vigilance météo par département ; crues par leur tronçon', () => {
    const flood: FloodSectionRef = { id: 'f', name: 'Rhône aval', level: 'red', geometry: { type: 'LineString', coordinates: [[4.8, 45.6], [4.85, 45.7], [4.9, 45.8]] } };
    const out = departmentPressure({ ...base, items: [situationItem()], meteo: [meteo(), meteo({ endDate: new Date(NOW - 1), departmentCode: '13', department: 'Bouches-du-Rhône' })], floods: [flood] });
    expect(out.map((d) => [d.code, d.name, d.level, d.driver])).toEqual([
      ['69', 'Rhône', 'rouge', 'environment'],
      ['33', 'Gironde', 'orange', 'environment'],
      ['59', 'Nord', 'jaune', 'security'],
    ]);
    expect(out[0].elements[0]).toMatchObject({ key: null, title: 'Crue : Rhône aval', source: 'vigicrues' });
  });

  it('niveau = élément le plus grave ; thème moteur = celui de cet élément, puis le plus représenté ; tri par niveau puis par nombre', () => {
    const out = departmentPressure({ ...base, items: [
      eventItem(event({ id: 1 }), { level: 'jaune', theme: 'health' }),
      eventItem(event({ id: 2 }), { level: 'rouge', theme: 'security', badge: 'nouveau' }),
      eventItem(event({ id: 3 }), { level: 'rouge', theme: 'security' }),
      eventItem(event({ id: 4, lat: 45.7 }), { level: 'rouge', theme: 'energy', badge: 'aggrave' }),
    ] });
    expect(out.map((d) => [d.code, d.level, d.driver, d.badge, d.elements.length])).toEqual([
      ['13', 'rouge', 'security', 'nouveau', 3],
      ['69', 'rouge', 'energy', 'aggrave', 1],
    ]);
    expect(out[0].elements.map((e) => e.level)).toEqual(['rouge', 'rouge', 'jaune']);
  });

  it('outre-mer : un événement en Guadeloupe compte pour la Guadeloupe (971), hors de la géométrie de métropole', () => {
    const out = departmentPressure({ ...base, items: [eventItem(event({ id: 9, title: 'GIGN blessés en Guadeloupe', lat: 16.2, lon: -61.5 }))] });
    expect(out.map((d) => [d.code, d.name])).toEqual([['971', 'Guadeloupe']]);
  });

  it('géométrie des départements pas encore chargée : seuls les signaux à code de département comptent', () => {
    const out = departmentPressure({ ...base, departements: null, items: [eventItem(event()), situationItem()], meteo: [meteo()] });
    expect(out.map((d) => [d.code, d.name])).toEqual([['33', 'Gironde'], ['59', '59']]);
  });
});
