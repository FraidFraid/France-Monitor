// tests/social-protests-api.test.ts
// /api/social/protests (spec 2026-10-17 manifestations) : annonces Démosphère (titre de manifestation, commune exacte, fenêtre
// -6 h / +7 j) et signal presse GDELT (code 14, territoire français, acteurs français, un relevé par lieu) ; chaque source tombe seule.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import {
  DEMOSPHERE_EDITIONS, cleanPlace, icsTime, indexCommunes, isProtestTitle, locateCommune, locateNationally, mergeRelays, parseIcs, protestsOfEdition,
} from '../api/_lib/protests-demosphere.js';
import {
  __resetGdeltForTests, GDELT_LAST_UPDATE, groupGdelt, latestExportStamp, parseExport, unzipFirstEntry, windowStamps,
} from '../api/_lib/protests-gdelt.js';
import { sortProtests } from '../api/_lib/protests.js';
import { loadPress } from '../api/_lib/protests-press.js';
import { loadPressAnnouncements } from '../api/_lib/protests-press-annonces.js';
import type { ProtestItem, ProtestsResponse } from '../src/types/index.ts';
import handler, { CACHE_CONTROL } from '../api/_handlers/social/protests.js';
import { callHandler, respond, stubFetch } from './helpers/traffic-fixtures.ts';

// La presse française vient de la base des articles : simulée ici, testée seule dans tests/social-protests-press.test.ts.
vi.mock('../api/_lib/protests-press.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/_lib/protests-press.js')>()), loadPress: vi.fn(),
}));
const pressItem = (city: string, lat: number, lon: number): ProtestItem => ({
  id: `presse:${lat},${lon}`, source: 'presse', status: 'signale', title: 'Heurts ou tensions', startsAt: '2026-10-17T10:30:00.000Z', allDay: false,
  city, dept: null, lat, lon, url: 'https://exemple.fr/a', edition: null, violent: true, participants: 800, precision: 'commune',
  articles: [{ url: 'https://exemple.fr/a', domain: 'exemple.fr', seenAt: '2026-10-17T10:30:00.000Z', violent: true, title: `Tensions à ${city}`, outlet: 'Exemple' }],
  articleCount: 3,
});
// Annonces de la presse : même base, testées seules dans tests/social-protests-annonces.test.ts ; aucune par défaut.
vi.mock('../api/_lib/protests-press-annonces.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/_lib/protests-press-annonces.js')>()), loadPressAnnouncements: vi.fn(),
}));
beforeEach(() => { vi.mocked(loadPressAnnouncements).mockResolvedValue({ items: [], matched: 0, unplaced: 0, scanned: 0 }); });
const pressOk = (items: ProtestItem[]) => vi.mocked(loadPress).mockResolvedValue({ items, matched: 5, unplaced: 2, scanned: 40 });

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
    // Appels sans mot d'action, relevés sur les agendas du 19/10/2026.
    ['Ni congrès ni meeting pour le RN à Orléans les 24 et 25 octobre !', true],
    ['Appel national Ni congrès ni meeting pour le RN à Orléans les 24 et 25 octobre !', true],
    ['Pas de congrès pour le RN à Orléans les 24 et 25 octobre !', true],
    ['Contre le flicage des bénéficiaires d’aides sociales !', true],
    ['Free Palestine', true],
    ['Cercle de silence pour Gaza et le peuple palestinien', true],
    ['Contre la guerre : conférence', false],
    ['Pas de quartier pour les fachos : concert', false],
    ['Rencontre avec Clément Pairot', false],
    ['Ciné-débat COLLAPSE – FACE À GAZA', false],
    ["discussion Urgence Palestine - campagne contre l'armement d'Israël", false],
    ['Soutien à la cave Gensan', false],
  ])('%s : %s', (title, expected) => {
    expect(isProtestTitle(title)).toBe(expected);
  });
});

describe('rendez-vous relayé par plusieurs éditions', () => {
  const item = (edition: string, title: string, startsAt: string, city: string | null, place: string | null) =>
    ({ id: `demosphere:${edition}`, title, startsAt, city, dept: city ? '45' : null, edition, place }) as unknown as ProtestItem;
  it('même commune, moins de 2 h, un mot en commun : gardé une fois, lieu le plus précis, éditions jointes', () => {
    const out = mergeRelays([
      item('Rennes', 'Pas de congrès pour le RN à Orléans', '2026-10-24T08:00:00.000Z', 'Orléans', 'Orléans, Orléans'),
      item('Pyrénées', 'Ni congrès ni meeting pour le RN à Orléans', '2026-10-24T08:30:00.000Z', 'Orléans', 'Orléans, Place Sainte-Croix, 45000 Orléans'),
      item('Gard', 'Ni congrès ni meeting pour le RN à Orléans', '2026-10-24T08:30:00.000Z', 'Orléans', 'Orléans, Orléans'),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ edition: 'Rennes · Pyrénées · Gard', place: 'Orléans, Place Sainte-Croix, 45000 Orléans' });
  });
  it('autre jour, autre sujet ou lieu inconnu : séparés', () => {
    expect(mergeRelays([
      item('Rennes', 'Pas de congrès pour le RN à Orléans', '2026-10-24T08:00:00.000Z', 'Orléans', null),
      item('Rennes', 'Pas de congrès pour le RN à Orléans', '2026-10-25T09:00:00.000Z', 'Orléans', null),
      item('Berry', 'Free Palestine', '2026-10-24T08:30:00.000Z', 'Orléans', null),
      item('Lot', 'Pas de congrès pour le RN', '2026-10-24T08:00:00.000Z', null, null),
      item('Gard', 'Pas de congrès pour le RN', '2026-10-24T08:00:00.000Z', null, null),
    ])).toHaveLength(5);
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

describe('lieu de rendez-vous', () => {
  it('lignes jointes par « , », espaces normalisés, tronqué à 200 caractères', () => {
    expect(cleanPlace('Toulouse 31200, \nPlace Micoulaud', 'Toulouse')).toBe('Toulouse 31200, Place Micoulaud');
    expect(cleanPlace(parseIcs(fixture('demosphere-toulouse.ics'))[0].location, 'Toulouse')).toBe('Toulouse 31200, Place Micoulaud, Toulouse');
    expect(cleanPlace('Gare,   \n  Parvis \n\nNord', null)).toBe('Gare, Parvis, Nord');
    expect(cleanPlace('x'.repeat(300), null)).toHaveLength(200);
  });
  it('null si vide, « #Ville » seul ou nom de la commune seul', () => {
    expect(cleanPlace('#Dunkerque', 'Dunkerque')).toBeNull();
    expect(cleanPlace('#Dunkerque, \nPlace Jean Bart', 'Dunkerque')).toBeNull();
    expect(cleanPlace('  \n ', null)).toBeNull();
    expect(cleanPlace('Toulouse', 'Toulouse')).toBeNull();
    expect(cleanPlace('Toulouse, ', 'Toulouse')).toBeNull();
    expect(cleanPlace('', null)).toBeNull();
  });
});

describe('manifestations d’une édition', () => {
  const toulouse = DEMOSPHERE_EDITIONS.find((e) => e.key === 'toulouse')!;
  const index = indexCommunes(COMMUNES[31]);
  it('seuls les titres de manifestation, dans la fenêtre, localisés', () => {
    const all = protestsOfEdition(toulouse, parseIcs(fixture('demosphere-toulouse.ics')), index, NOW);
    // Appel national sans mot d'action, lieu hors du département de l'édition : gardé, sans position (pas de secours national ici).
    expect(all.find((i) => i.title.startsWith('Ni congrès'))).toMatchObject({ startsAt: '2026-10-24T08:30:00.000Z', city: null, precision: null });
    const items = all.filter((i) => !i.title.startsWith('Ni congrès'));
    expect(items).toEqual([{
      id: 'demosphere:https://toulouse.demosphere.net/rv/' + items[0].id.split('/').pop(),
      source: 'demosphere', status: 'annonce', title: 'MANIFESTATIONS LYCEENNES, TRAVAILLEUSES, GJ.',
      startsAt: '2026-10-17T12:00:00.000Z', allDay: false, city: 'Toulouse', dept: '31', lat: 43.6007, lon: 1.4328,
      url: items[0].url, place: 'Toulouse 31000, Metro Jean Jaurès', edition: 'Toulouse', violent: false, participants: null, precision: 'commune', articles: [], articleCount: 0,
    }]);
  });
  it('commencée depuis plus de 6 h ou à plus de 7 jours : écartée', () => {
    const events = parseIcs(fixture('demosphere-toulouse.ics'));
    expect(protestsOfEdition(toulouse, events, index, NOW + 6 * 3_600_000 + 3_600_001).map((i) => i.startsAt)).toEqual(['2026-10-24T08:30:00.000Z']);
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
    expect(paris).toMatchObject({ source: 'gdelt', status: 'signale', violent: true, place: null, title: 'Manifestation ou rassemblement' });
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

  it('trois sources : annonces localisées, presse française, Paris signalé par GDELT avec heurts ; en-tête de cache', async () => {
    stubFetch((url) => route(url));
    pressOk([pressItem('Marseille', 43.3, 5.37)]);
    const { status, body, cache } = await callHandler<ProtestsResponse>(handler);
    expect(status).toBe(200);
    expect(cache).toBe(CACHE_CONTROL);
    expect(body.errors).toEqual([]);
    expect(body.gdelt).toEqual({ readAt: '2026-10-17T11:00:00.000Z', files: 1, missingFiles: 95 });
    expect(body.presse).toEqual({ readAt: '2026-10-17T11:00:00.000Z', scanned: 40, matched: 5, unplaced: 2 });
    expect(body.demosphere).toMatchObject({ editions: DEMOSPHERE_EDITIONS.length, failedEditions: [] });
    expect(body.items.find((i) => i.source === 'gdelt' && i.city === 'Paris')).toMatchObject({ violent: true });
    expect(body.items.find((i) => i.source === 'presse')).toMatchObject({ city: 'Marseille', participants: 800 });
    const announced = body.items.filter((i) => i.status === 'annonce');
    // Orléans (appel national relayé par Toulouse) : commune absente du référentiel simulé, gardée sans position.
    expect(announced.every((i) => (i.lat !== null) === (i.precision === 'commune'))).toBe(true);
    expect(announced.some((i) => i.title.startsWith('Répète'))).toBe(false);
    // Rennes (6 h, heure de Paris) a commencé depuis plus de 6 h à 13 h : écartée.
    expect(new Set(announced.map((i) => i.city))).toEqual(new Set(['Le Mans', 'Toulouse', 'Nîmes', 'Strasbourg', 'Dunkerque', null]));
  });

  it('un lieu GDELT déjà relevé par la presse française n’est pas répété', async () => {
    stubFetch((url) => route(url));
    pressOk([pressItem('Paris', 48.86, 2.35)]);
    const { body } = await callHandler<ProtestsResponse>(handler);
    expect(body.items.filter((i) => i.city === 'Paris').map((i) => i.source)).toEqual(['presse']);
  });

  it('GDELT en panne : annonces servies, panne nommée', async () => {
    stubFetch((url) => route(url, { gdeltDown: true }));
    pressOk([]);
    const { status, body } = await callHandler<ProtestsResponse>(handler);
    expect(status).toBe(200);
    expect(body.errors).toEqual(['GDELT : HTTP 503']);
    expect(body.items.every((i) => i.source === 'demosphere')).toBe(true);
  });

  it('toutes les sources en panne : 502 avec les pannes nommées', async () => {
    stubFetch((url) => route(url, { gdeltDown: true, demosphereDown: true }));
    vi.mocked(loadPress).mockRejectedValue(new Error('base des articles non configurée'));
    vi.mocked(loadPressAnnouncements).mockRejectedValue(new Error('base des articles non configurée'));
    const { status, body } = await callHandler<ProtestsResponse>(handler);
    expect(status).toBe(502);
    expect(body.readAt).toBeNull();
    expect(body.errors).toHaveLength(4);
    expect(body.errors[1]).toMatch(/^Presse française : /);
    expect(body.errors[2]).toMatch(/^Presse française \(annonces\) : /);
    expect(body.errors[3]).toBe('GDELT : HTTP 503');
  });
});
