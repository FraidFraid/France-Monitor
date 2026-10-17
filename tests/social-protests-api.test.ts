// tests/social-protests-api.test.ts
// /api/social/protests (spec 2026-10-17 manifestations) : annonces Démosphère (titre de manifestation, commune exacte, fenêtre
// -6 h / +7 j) et signal presse GDELT (code 14, territoire français, acteurs français, un relevé par lieu) ; chaque source tombe seule.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import {
  DEMOSPHERE_EDITIONS, icsTime, indexCommunes, isProtestTitle, locateCommune, locateNationally, parseIcs, protestsOfEdition,
} from '../api/_lib/protests-demosphere.js';
import {
  __resetGdeltForTests, GDELT_LAST_UPDATE, groupGdelt, latestExportStamp, parseExport, unzipFirstEntry, windowStamps,
} from '../api/_lib/protests-gdelt.js';
import { sortProtests } from '../api/_lib/protests.js';
import type { ProtestItem, ProtestsResponse } from '../src/types/index.ts';
import handler, { CACHE_CONTROL } from '../api/_handlers/social/protests.js';
import { callHandler, respond, stubFetch } from './helpers/traffic-fixtures.ts';

const fixture = (name: string): string => readFileSync(new URL(`./fixtures/social/${name}`, import.meta.url), 'utf8');
const ZIP = readFileSync(new URL('./fixtures/social/gdelt-20261017110000.export.CSV.zip', import.meta.url));
const TSV = fixture('gdelt-export-extrait.tsv');
const NOW = Date.parse('2026-10-17T11:00:00Z');

beforeEach(() => { __resetSwrCacheForTests(); __resetGdeltForTests(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const commune = (nom: string, dept: string, cps: string[], lon = 1, lat = 45) =>
  ({ nom, codeDepartement: dept, codesPostaux: cps, centre: { type: 'Point', coordinates: [lon, lat] } });
const COMMUNES: Record<string, ReturnType<typeof commune>[]> = {
  31: [commune('Toulouse', '31', ['31000', '31100', '31200', '31300', '31400', '31500'], 1.4328, 43.6007),
    commune('Saint-Orens-de-Gameville', '31', ['31650'], 1.5332, 43.555)],
  30: [commune('Nîmes', '30', ['30000', '30900'], 4.3471, 43.8445)],
  35: [commune('Rennes', '35', ['35000', '35200', '35700'], -1.6744, 48.1159)],
  72: [commune('Le Mans', '72', ['72000', '72100'], 0.1996, 47.9956)],
  59: [commune('Dunkerque', '59', ['59140', '59240', '59640'], 2.3426, 51.0307), commune('Lille', '59', ['59000', '59800'], 3.0473, 50.632)],
  67: [commune('Strasbourg', '67', ['67000', '67100', '67200'], 7.7673, 48.5712)],
};

describe('titre de manifestation', () => {
  it.each([
    ['MANIFESTATIONS LYCEENNES, TRAVAILLEUSES, GJ.', true],
    ['Manifestons en gilets jaunes !', true],
    ["Manifestation Gilets Jaunes suivie d'une Assemblée pour organiser les suites !", true],
    ['Convergence des luttes - Rassemblement aux Jardins de la Fontaine', true],
    ['Occupation de Rond Point', true],
    ['Grève internationale des étudiants contre la guerre', true],
    ['Marche blanche pour Lola', true],
    ['📣 Formation sécurité en manif 📣', false],
    ["Répète d'avant manif de LA FAUNE FURIEUSE !!!", false],
    ['Marché de Noël Solidaire', false],
    ['MARCHÉ DE NOËL', false],
    ['Permanence syndicale CGT des bureaux d’étude', false],
    ["Café Bricol' à St-Orens de Gameville", false],
  ])('%s : %s', (title, expected) => {
    expect(isProtestTitle(title)).toBe(expected);
  });
});

describe('iCalendar Démosphère', () => {
  it('heure UTC lue telle quelle ; journée : minuit heure de Paris (été, puis hiver)', () => {
    expect(icsTime('20261017T120000Z')).toBe(Date.parse('2026-10-17T12:00:00Z'));
    expect(icsTime('20261017', true)).toBe(Date.parse('2026-10-16T22:00:00Z'));
    expect(icsTime('20261206', true)).toBe(Date.parse('2026-12-05T23:00:00Z'));
    expect(icsTime('n.d.')).toBeNull();
  });
  it('lignes repliées, échappements, journée entière et fiche', () => {
    const events = parseIcs(fixture('demosphere-toulouse.ics'));
    expect(events).toHaveLength(6);
    expect(events[0]).toMatchObject({
      uid: 'https://toulouse.demosphere.net/rv/36235', allDay: true, start: Date.parse('2026-10-16T22:00:00Z'),
      title: 'Journee mondiale du refus de la misère . Defendons la paix pour un monde habitable',
      url: 'https://toulouse.demosphere.net/rv/36235',
    });
    expect(events[0].location.split('\n')[0]).toBe('Toulouse 31200, ');
    expect(events[3].title).toBe('MANIFESTATIONS LYCEENNES, TRAVAILLEUSES, GJ.');
  });
});

describe('commune du lieu', () => {
  const index = indexCommunes([...COMMUNES[31], ...COMMUNES[59], commune('Bagnères', '65', ['65200']), commune('Bagnères', '31', ['31110'])]);
  it.each([
    ['Toulouse 31000, \nMetro Jean Jaurès', 'Toulouse'],
    ['St Orens 31650, \nRue du Stade \n31650, Saint Orens de Gameville', 'Saint-Orens-de-Gameville'],
    ['Lille Moulins, \nMaison des syndicats', 'Lille'],
    ['#Dunkerque, \nPlace Jean Bart', 'Dunkerque'],
    ['Gare, \nParvis \nToulouse', 'Toulouse'],
  ])('%j : %s', (location, name) => {
    expect(locateCommune(location, index)?.name).toBe(name);
  });
  it('homonymes sans code postal : jamais tranché ; avec code postal : la bonne', () => {
    expect(locateCommune('Bagnères, \nPlace', index)).toBeNull();
    expect(locateCommune('Bagnères 65200, \nPlace', index)?.dept).toBe('65');
  });
  it('lieu inconnu : null, jamais une commune approchante', () => {
    expect(locateCommune('Le Verdon, \nPort Médoc', index)).toBeNull();
  });
  it('secours national : nom exact et unique en France seulement', async () => {
    const lookup = async (name: string) => (name === 'Montségur' ? [commune('Montségur', '09', ['09300'])]
      : name === 'Saint-Denis' ? [commune('Saint-Denis', '93', ['93200']), commune('Saint-Denis', '11', ['11310'])] : []);
    expect((await locateNationally('Montségur, \nMontségur _ Ariège', lookup))?.dept).toBe('09');
    expect(await locateNationally('Saint-Denis, \nGare', lookup)).toBeNull();
  });
});

describe('manifestations d’une édition', () => {
  const toulouse = DEMOSPHERE_EDITIONS.find((e) => e.key === 'toulouse')!;
  const index = indexCommunes(COMMUNES[31]);
  it('seuls les titres de manifestation, dans la fenêtre, localisés', () => {
    const items = protestsOfEdition(toulouse, parseIcs(fixture('demosphere-toulouse.ics')), index, NOW);
    expect(items).toEqual([{
      id: 'demosphere:https://toulouse.demosphere.net/rv/' + items[0].id.split('/').pop(),
      source: 'demosphere', status: 'annonce', title: 'MANIFESTATIONS LYCEENNES, TRAVAILLEUSES, GJ.',
      startsAt: '2026-10-17T12:00:00.000Z', allDay: false, city: 'Toulouse', dept: '31', lat: 43.6007, lon: 1.4328,
      url: items[0].url, edition: 'Toulouse', violent: false, articles: [],
    }]);
  });
  it('commencée depuis plus de 6 h ou à plus de 7 jours : écartée', () => {
    const events = parseIcs(fixture('demosphere-toulouse.ics'));
    expect(protestsOfEdition(toulouse, events, index, NOW + 6 * 3_600_000 + 3_600_001)).toHaveLength(0);
    expect(protestsOfEdition(toulouse, events, index, NOW - 8 * 86_400_000)).toHaveLength(0);
  });
  it('éditions françaises seulement, départements renseignés', () => {
    expect(DEMOSPHERE_EDITIONS.map((e) => e.key)).not.toContain('bxl');
    for (const e of DEMOSPHERE_EDITIONS) expect(e.depts.length).toBeGreaterThan(0);
  });
});

describe('GDELT', () => {
  it('archive zip lue sans dépendance', () => {
    expect(unzipFirstEntry(ZIP)).toBe(TSV);
    expect(() => unzipFirstEntry(Buffer.from('pas un zip, pas du tout, vraiment pas'))).toThrow('archive zip illisible');
  });
  it('dernier export et fenêtre de 96 exports de 15 min', () => {
    expect(latestExportStamp('46434 0fc0 http://data.gdeltproject.org/gdeltv2/20261017110000.export.CSV.zip\n')).toBe('20261017110000');
    const stamps = windowStamps('20261017110000');
    expect(stamps).toHaveLength(96);
    expect(stamps[1]).toBe('20261017104500');
    expect(stamps[95]).toBe('20261016111500');
  });
  it('code 14 en France, acteurs français ou sans pays, daté d’hier ou d’aujourd’hui', () => {
    const events = parseExport(TSV, NOW);
    const urls = new Set(events.map((e) => e.url));
    expect([...urls].some((u) => u.includes('albanian') || u.includes('havanatimes') || u.includes('democracynow'))).toBe(false);
    expect([...urls].some((u) => u.includes('kenya-today') || u.includes('dailysabah') || u.includes('dhakacourier'))).toBe(false);
    expect([...urls].some((u) => u.includes('heraldscotland') || u.includes('connexionfrance'))).toBe(false);
    expect(urls.has('https://www.bbc.co.uk/news/live/ckpdg1v41562t')).toBe(true);
    const paris = events.find((e) => e.url.includes('bbc'))!;
    expect(paris).toMatchObject({ place: 'Paris', fips: 'FR', lat: 48.8667, lon: 2.33333 });
    const national = events.find((e) => e.url.includes('wrp.org.uk'))!;
    expect(national).toMatchObject({ place: null, lat: null, lon: null, featureId: 'pays:FR' });
  });
  it('un relevé par lieu ; articles sans doublon ; heurts ; plus récent d’abord', () => {
    const items = groupGdelt(parseExport(TSV, NOW), NOW);
    const paris = items.find((i) => i.city === 'Paris')!;
    expect(paris).toMatchObject({ source: 'gdelt', status: 'signale', violent: true, title: 'Manifestation ou rassemblement' });
    expect(paris.articles.map((a) => a.domain)).toEqual(['bbc.co.uk', 'moneycontrol.com', 'en.shafaqna.com', 'euronews.com', 'moneycontrol.com']);
    expect(paris.articles.filter((a) => a.violent).map((a) => a.domain)).toEqual(['bbc.co.uk', 'euronews.com']);
    expect(paris.url).toBe('https://www.bbc.co.uk/news/live/ckpdg1v41562t');
    const france = items.find((i) => i.id === 'gdelt:pays:FR')!;
    expect(france).toMatchObject({ city: null, lat: null, lon: null });
  });
  it('événement relevé il y a plus de 24 h : écarté', () => {
    expect(groupGdelt(parseExport(TSV, NOW), NOW + 2 * 86_400_000)).toEqual([]);
  });
});

describe('ordre', () => {
  it('signalés d’abord (plus récent d’abord), puis annonces par heure de début', () => {
    const item = (id: string, status: ProtestItem['status'], startsAt: string) => ({ id, status, startsAt }) as ProtestItem;
    const sorted = sortProtests([
      item('a2', 'annonce', '2026-10-17T14:00:00Z'), item('s1', 'signale', '2026-10-17T08:00:00Z'),
      item('a1', 'annonce', '2026-10-17T09:00:00Z'), item('s2', 'signale', '2026-10-17T10:00:00Z'),
    ]);
    expect(sorted.map((i) => i.id)).toEqual(['s2', 's1', 'a1', 'a2']);
  });
});

describe('route', () => {
  const binary = (buf: Buffer) => ({ ...respond(''), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) });
  function route(url: string, { gdeltDown = false, demosphereDown = false } = {}) {
    if (url === GDELT_LAST_UPDATE) {
      if (gdeltDown) return respond('panne', 503);
      return binary(Buffer.from('1 x http://data.gdeltproject.org/gdeltv2/20261017110000.export.CSV.zip\n'));
    }
    if (url.includes('data.gdeltproject.org')) return url.includes('20261017110000') ? binary(ZIP) : respond('', 404);
    const demo = /^https:\/\/([^.]+)\.demosphere\.net\/events\.ics/.exec(url);
    if (demo) {
      if (demosphereDown) return respond('panne', 503);
      try { return respond(fixture(`demosphere-${demo[1]}.ics`)); } catch { return respond('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n'); }
    }
    const dept = /codeDepartement=([0-9AB]+)/.exec(url);
    if (dept) return respond(COMMUNES[dept[1]] ?? [commune('Ailleurs', dept[1], ['00000'])]);
    if (url.includes('geo.api.gouv.fr/communes?nom=')) return respond([]);
    return respond('inattendu', 500);
  }

  it('deux sources : annonces localisées, Paris signalé avec heurts ; en-tête de cache', async () => {
    stubFetch((url) => route(url));
    const { status, body, cache } = await callHandler<ProtestsResponse>(handler);
    expect(status).toBe(200);
    expect(cache).toBe(CACHE_CONTROL);
    expect(body.errors).toEqual([]);
    expect(body.gdelt).toEqual({ readAt: '2026-10-17T11:00:00.000Z', files: 1, missingFiles: 95 });
    expect(body.demosphere).toMatchObject({ editions: DEMOSPHERE_EDITIONS.length, failedEditions: [] });
    expect(body.items[0]).toMatchObject({ source: 'gdelt', city: 'Paris', violent: true });
    const announced = body.items.filter((i) => i.status === 'annonce');
    expect(announced.every((i) => i.lat !== null)).toBe(true);
    expect(announced.some((i) => i.title.startsWith('Répète'))).toBe(false);
    // Rennes (6 h, heure de Paris) a commencé depuis plus de 6 h à 13 h : écartée.
    expect(new Set(announced.map((i) => i.city))).toEqual(new Set(['Le Mans', 'Toulouse', 'Nîmes', 'Strasbourg', 'Dunkerque']));
  });

  it('GDELT en panne : annonces servies, panne nommée', async () => {
    stubFetch((url) => route(url, { gdeltDown: true }));
    const { status, body } = await callHandler<ProtestsResponse>(handler);
    expect(status).toBe(200);
    expect(body.errors).toEqual(['GDELT : HTTP 503']);
    expect(body.items.every((i) => i.source === 'demosphere')).toBe(true);
  });

  it('les deux sources en panne : 502 avec les pannes nommées', async () => {
    stubFetch((url) => route(url, { gdeltDown: true, demosphereDown: true }));
    const { status, body } = await callHandler<ProtestsResponse>(handler);
    expect(status).toBe(502);
    expect(body.readAt).toBeNull();
    expect(body.errors).toHaveLength(2);
    expect(body.errors[1]).toBe('GDELT : HTTP 503');
  });
});
