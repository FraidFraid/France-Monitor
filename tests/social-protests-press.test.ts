// tests/social-protests-press.test.ts
// Détecteur de manifestations sur la presse française ingérée (spec 2026-10-17 manifestations) : titres retenus et écartés, lieux
// nommés dans le titre (villes, départements, jamais une rue ni une région), outre-mer avant les homonymes, heurts, participants.
// Titres réels relevés le 17/10/2026.
import { describe, expect, it } from 'vitest';
import {
  groupPress, headlinePlaces, isProtestHeadline, isViolentHeadline, participantsOf, PRESS_WINDOW_MS,
} from '../api/_lib/protests-press.js';
import { indexCommunes } from '../api/_lib/protests-demosphere.js';

const NOW = Date.parse('2026-10-17T15:00:00Z');
const PLACES: Record<string, { lat: number; lon: number; source: string }> = {
  Paris: { lat: 48.8566, lon: 2.3522, source: 'cities' },
  Marseille: { lat: 43.2965, lon: 5.3698, source: 'cities' },
  Gap: { lat: 44.5594, lon: 6.0786, source: 'cities' },
  Grenoble: { lat: 45.1885, lon: 5.7245, source: 'cities' },
  Lyon: { lat: 45.764, lon: 4.8357, source: 'cities' },
  Rennes: { lat: 48.1173, lon: -1.6778, source: 'cities' },
  Clichy: { lat: 48.904, lon: 2.306, source: 'cities' },
  'Saint-Denis': { lat: 48.9362, lon: 2.3553, source: 'cities' },
  Isère: { lat: 45.26, lon: 5.57, source: 'departements' },
  Vendée: { lat: 46.67, lon: -1.43, source: 'departements' },
  Bretagne: { lat: 48.2, lon: -2.9, source: 'regions' },
};
const resolve = async (name: string) => {
  const p = PLACES[name];
  return p ? { ...p, locationName: name, confidence: 1 } : null;
};
const REUNION = indexCommunes([
  { nom: 'Saint-Denis', codeDepartement: '974', codesPostaux: ['97400'], centre: { type: 'Point', coordinates: [55.45, -20.88] } },
  { nom: 'Le Port', codeDepartement: '974', codesPostaux: ['97420'], centre: { type: 'Point', coordinates: [55.29, -20.94] } },
]);
const row = (title: string, over: Record<string, unknown> = {}) =>
  ({ title, link: `https://exemple.fr/${encodeURIComponent(title).slice(0, 40)}`, feed: 'Exemple', region: null, at: NOW - 3_600_000, ...over });

describe('titres retenus', () => {
  it.each([
    'Mobilisation du 17 octobre : plus de 800 personnes rassemblées à Gap',
    'Manifestation du 17 octobre: à Nantes, des tensions débutent sur la place du Maréchal-Foch',
    'Gilets jaunes à Dinan : pas de blocage et des revendications diverses',
    'Mobilisation du 17 octobre : le pont Chaban-Delmas bloqué, des actions en Gironde',
    'Un cortège "non déclaré" stoppé par des policiers dans le Xe arrondissement de Paris',
    'Les enseignants en grève devant le rectorat de Lille',
  ])('« %s »', (t) => expect(isProtestHeadline(t)).toBe(true));
});

describe('titres écartés', () => {
  it.each([
    'Alsace. Mobilisation générale des viticulteurs face à la menace de la flavescence dorée',
    'Un cheval attelé d’une charrette est tombé dans la Sèvre Niortaise : les pompiers de Vendée se mobilisent pour le sauver',
    'A7 : la circulation bloquée après un accident à Valence',
    'Pour fêter ses 80 ans, Var-matin ressort ses archives : le 10 mai 1983, les enseignants en grève sont à la une',
    'ENTRETIEN. Colère des lycéens, et maintenant ? Deux économistes répondent',
    '"Mon engagement m’avait fait perdre mon emploi" : huit ans après, trois figures des gilets jaunes racontent',
  ])('« %s »', (t) => expect(isProtestHeadline(t)).toBe(false));
});

describe('heurts et participants', () => {
  it('heurts : tensions, lacrymogènes, interpellations, intrusion ; pas un défilé calme', () => {
    expect(isViolentHeadline('Des heurts éclatent à Marseille en marge de la journée')).toBe(true);
    expect(isViolentHeadline('Tensions et gaz lacrymogènes place de la République')).toBe(true);
    expect(isViolentHeadline('24 interpellations à Toulouse ce matin')).toBe(true);
    expect(isViolentHeadline('400 personnes se rassemblent à Cahors dans une ambiance festive')).toBe(false);
  });
  it('participants : un seul lieu, jamais un total national ni une prévision', () => {
    expect(participantsOf('plus de 800 personnes rassemblées à Gap', 1)).toBe(800);
    expect(participantsOf('entre 150 et 200 manifestants à Bourg-en-Bresse', 1)).toBe(200);
    expect(participantsOf('Environ 1 200 manifestants à Caen', 1)).toBe(1200);
    expect(participantsOf('une cinquantaine de Gilets jaunes filtrent la circulation à Dole', 1)).toBe(50);
    expect(participantsOf('Plusieurs dizaines de gilets jaunes réunis au Muy', 1)).toBeNull();
    expect(participantsOf('32 800 manifestants dans les régions, vives tensions à Paris', 1)).toBeNull();
    expect(participantsOf('40 000 personnes prévues à Paris', 1)).toBeNull();
    expect(participantsOf('800 manifestants à Lyon et Rennes', 2)).toBeNull();
  });
});

describe('lieux du titre', () => {
  it('chaque ville citée ; jamais une région ; le département s’efface devant une ville', async () => {
    expect((await headlinePlaces('Lyon, Rennes, Marseille... Le point sur la journée de mobilisation', resolve)).map((p) => p.name).sort())
      .toEqual(['Lyon', 'Marseille', 'Rennes']);
    expect(await headlinePlaces('Bretagne. Manifestations dans toute la région', resolve)).toEqual([]);
    expect((await headlinePlaces('Isère. Mobilisation du 17 octobre : départ de la manifestation à Grenoble', resolve)).map((p) => p.name))
      .toEqual(['Grenoble']);
    expect(await headlinePlaces('Mobilisation du 17 octobre en Vendée : barrage au rond-point', resolve))
      .toEqual([{ name: 'Vendée', lat: 46.67, lon: -1.43, dept: true }]);
  });
  it('un nom de place ou de rue n’est pas une ville', async () => {
    const places = await headlinePlaces('Mobilisation du 17 octobre à Paris : le trajet va de République jusqu’à la place de Clichy', resolve);
    expect(places.map((p) => p.name)).toEqual(['Paris']);
  });
  it('journal d’outre-mer : ses communes avant les homonymes de métropole (« au Port » = Le Port)', async () => {
    const places = await headlinePlaces('Mobilisation du 17 octobre : barrages filtrants à Saint-Denis et au Port', resolve, REUNION);
    expect(places.map((p) => [p.name, p.lat])).toEqual(expect.arrayContaining([['Saint-Denis', -20.88], ['Le Port', -20.94]]));
  });
});

describe('regroupement par lieu', () => {
  it('une dépêche reprise par plusieurs journaux compte une fois ; heurts et participants du lieu ; plus récent d’abord', async () => {
    const { items, matched, unplaced } = await groupPress([
      row('Social. Mobilisation du 17 octobre : vives tensions à Paris', { feed: 'Le Progrès', link: 'https://leprogres.fr/a' }),
      row('Social. Mobilisation du 17 octobre : vives tensions à Paris', { feed: 'Le Dauphiné', link: 'https://ledauphine.com/a', at: NOW - 600_000 }),
      row('Mobilisation du 17 octobre : plus de 800 personnes rassemblées à Gap', { at: NOW - 7_200_000 }),
      row('Mobilisation du 17 octobre : des milliers de manifestants attendus partout'),
      row('Mobilisation du 17 octobre : une manifestation à Gap', { at: NOW - PRESS_WINDOW_MS - 1 }),
      row('Le marché de Noël ouvre à Gap'),
    ], NOW, resolve);
    expect(matched).toBe(4);
    expect(unplaced).toBe(1);
    const paris = items.find((i) => i.city === 'Paris');
    expect(paris).toMatchObject({ source: 'presse', status: 'signale', violent: true, articleCount: 1, title: 'Heurts ou tensions', precision: 'commune', place: null });
    expect(paris?.articles[0]).toMatchObject({ outlet: 'Le Dauphiné', url: 'https://ledauphine.com/a' });
    expect(items.find((i) => i.city === 'Gap')).toMatchObject({ violent: false, participants: 800, title: 'Manifestation ou rassemblement' });
  });
  it('journal d’outre-mer : Saint-Denis de La Réunion, pas de Seine-Saint-Denis', async () => {
    const { items } = await groupPress([row('Mobilisation du 17 octobre : un rassemblement dans le calme à Saint-Denis', { region: 'La Réunion' })],
      NOW, resolve, new Map([['La Réunion', REUNION]]));
    expect(items.map((i) => [i.city, i.lat])).toEqual([['Saint-Denis', -20.88]]);
  });
});

describe('chiffres nationaux attribués à une ville', () => {
  it('a. marqueur national : le chiffre n’est pas local', () => {
    expect(participantsOf('800 000 manifestants en France, vives tensions à Limoges', 1)).toBeNull();
    expect(participantsOf('Dans toute la France, 450 000 manifestants selon la CGT, cortège à Paris', 1)).toBeNull();
    expect(participantsOf('En France, 800 000 manifestants, cortège à Limoges', 1)).toBeNull();
    expect(participantsOf('450 000 manifestants au niveau national, rassemblement à Paris', 1)).toBeNull();
    expect(participantsOf('800 000 manifestants sur tout le territoire selon l’intersyndicale, défilé à Limoges', 1)).toBeNull();
    expect(participantsOf('15 000 manifestants à Limoges', 1)).toBe(15_000);
    expect(participantsOf('800 000 manifestants en France, 12 000 à Lyon', 1)).toBeNull();
    expect(participantsOf('800 000 manifestants en France, dont 12 000 manifestants à Lyon', 1)).toBe(12_000);
  });
  const withLimoges: Record<string, { lat: number; lon: number; source: string }> = { ...PLACES, Limoges: { lat: 45.8, lon: 1.26, source: 'cities' } };
  const resolveL = async (name: string) => { const p = withLimoges[name]; return p ? { ...p, locationName: name, confidence: 1 } : null; };
  const population = async (p: { lat: number }) => (p.lat === 45.8 ? 130_000 : p.lat === 48.8566 ? 2_100_000 : null);
  it('b. plafond de 15 % des habitants', async () => {
    const { items } = await groupPress([
      row('Mobilisation du 17 octobre : 800 000 manifestants à Limoges'),
      row('Mobilisation du 17 octobre : 15 000 manifestants à Paris'),
    ], NOW, resolveL, new Map(), population);
    expect(items.find((i) => i.city === 'Limoges')?.participants).toBeNull();
    expect(items.find((i) => i.city === 'Paris')?.participants).toBe(15_000);
    const ok = await groupPress([row('Mobilisation du 17 octobre : 15 000 manifestants à Limoges')], NOW, resolveL, new Map(), population);
    expect(ok.items[0].participants).toBe(15_000);
  });
  it('b. population illisible : la règle a seule, la source ne tombe pas', async () => {
    const { items } = await groupPress([row('Mobilisation du 17 octobre : 800 manifestants à Gap')], NOW, resolve, new Map(),
      async () => { throw new Error('réseau'); });
    expect(items[0].participants).toBe(800);
    const sans = await groupPress([row('Mobilisation du 17 octobre : 800 manifestants à Gap')], NOW, resolve, new Map(), async () => null);
    expect(sans.items[0].participants).toBe(800);
  });
  it('c. même chiffre sur plusieurs villes : total repris partout', async () => {
    const { items } = await groupPress([
      row('Mobilisation du 17 octobre : 5 000 manifestants à Lyon'),
      row('Manifestation du 17 octobre : 5 000 manifestants à Rennes'),
      row('Manifestation du 17 octobre : 3 000 manifestants à Marseille'),
      row('Manifestation du 17 octobre : 50 manifestants à Gap'),
      row('Manifestation du 17 octobre : 50 manifestants à Grenoble'),
    ], NOW, resolve);
    const by = (c: string) => items.find((i) => i.city === c)?.participants;
    expect([by('Lyon'), by('Rennes'), by('Marseille'), by('Gap'), by('Grenoble')]).toEqual([null, null, 3000, 50, 50]);
  });
});
