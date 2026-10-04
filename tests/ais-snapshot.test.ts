import { describe, expect, it } from 'vitest';
import {
  aisTime, createAisTracker, inFrenchWaters, inHarbour, isFrenchFlag, parseAisMessage, snapshotResponse, typeCategory, typeLabel, upstreamErrors, boundStatics, STATICS_MAX_BYTES, zoneOf,
} from '../api/_lib/ais-snapshot.js';
import { fixtureText } from './helpers/traffic-fixtures.ts';

const LINES = fixtureText('ais-messages.jsonl').split('\n').filter(Boolean);
const LAST = Date.parse('2026-10-03T13:19:48.822Z');
const line = (mmsi: number, type = 'PositionReport') => LINES.find((l) => l.includes(`"MMSI":${mmsi},`) && l.includes(`"MessageType":"${type}"`)) ?? '';

/** Message réel modifié : statut de navigation, vitesse et heure (scénario T3 construit sur une position réelle). */
function variant(raw: string, { status, sog, at }: { status: number; sog: number; at: number }): string {
  const msg = JSON.parse(raw) as { MetaData: { time_utc: string }; Message: { PositionReport: { NavigationalStatus: number; Sog: number } } };
  msg.Message.PositionReport.NavigationalStatus = status;
  msg.Message.PositionReport.Sog = sog;
  msg.MetaData.time_utc = `${new Date(at).toISOString().replace('T', ' ').replace('Z', '')} +0000 UTC`;
  return JSON.stringify(msg);
}

function trackerWithFixture() {
  const t = createAisTracker();
  for (const l of LINES) t.ingest(l);
  return t;
}

describe('eaux françaises, zones et ports (tracé simplifié)', () => {
  it.each([
    ['Le Havre', 49.48, 0.11, true], ['port de Rouen', 49.45, 1.06, true], ['Dunkerque', 51.05, 2.36, true], ['Calais', 50.97, 1.85, true],
    ['Brest', 48.38, -4.49, true], ['Bordeaux', 44.87, -0.55, true], ['Fos-sur-Mer', 43.42, 4.88, true], ['Bastia', 42.70, 9.45, true],
    ['Bonifacio', 41.39, 9.16, true], ['Port-Vendres', 42.52, 3.11, true],
    ['Solent (Royaume-Uni)', 50.79, -1.11, false], ['Jersey', 49.18, -2.11, false], ['Douvres', 51.12, 1.33, false], ['Barcelone', 41.38, 2.17, false],
    ['Galice', 42.9, -9.3, false], ['Monaco', 43.735, 7.425, false], ['Sanremo', 43.81, 7.78, false], ['Elbe', 42.78, 10.25, false],
    ['Paris (Seine)', 48.86, 2.35, false], ['Vernon (Seine)', 49.09, 1.49, false],
    ['baie de Menton (en mer)', 43.76, 7.50, true], ['port de Menton-Garavan', 43.782, 7.52, true],
    ['Grimaldi (terre italienne, 1 km de la frontière)', 43.79, 7.542, false], ['eaux italiennes au large de Grimaldi', 43.77, 7.56, false],
    ['Olivetta San Michele (Italie, vallée de la Roya)', 43.879, 7.515, false], ['vallée de la Gesso (Italie)', 44.17, 7.40, false],
  ])('%s : %s', (_name, lat, lon, expected) => {
    expect(inFrenchWaters(lat, lon)).toBe(expected);
  });
  it('zones : Pas-de-Calais, Manche, Atlantique, Méditerranée', () => {
    expect([zoneOf(50.97, 1.85), zoneOf(49.48, 0.11), zoneOf(47.27, -2.2), zoneOf(43.30, 5.35)]).toEqual(['pas-de-calais', 'manche', 'atlantique', 'mediterranee']);
  });
  it('zones portuaires (8 km) ; pavillon français ; types AIS', () => {
    expect(inHarbour(49.478, 0.121)).toBe(true);
    expect(inHarbour(49.52, -3.598)).toBe(false);
    expect([isFrenchFlag('228403600'), isFrenchFlag('241453000')]).toEqual([true, false]);
    expect([typeLabel(80), typeLabel(89), typeLabel(60), typeLabel(70), typeLabel(0)]).toEqual(['Pétrolier', 'Pétrolier', 'Passagers', 'Cargo', null]);
  });
});

describe('messages aisstream réels (3 octobre 2026, 15 h 19)', () => {
  it('date du flux, position de classe A, données statiques, confirmation d’abonnement ignorée', () => {
    expect(aisTime('2026-10-03 13:12:10.10811891 +0000 UTC')).toBe(Date.parse('2026-10-03T13:12:10.108Z'));
    expect(parseAisMessage(line(241453000))).toMatchObject({ kind: 'position', mmsi: '241453000', classA: true, status: 0, sog: 8.5, name: 'FAITHFUL WARRIOR' });
    expect(parseAisMessage(line(241453000, 'ShipStaticData'))).toMatchObject({ kind: 'static', type: 80, name: 'FAITHFUL WARRIOR' });
    expect(parseAisMessage(LINES[0])).toBeNull();
    expect(parseAisMessage('pas du json')).toBeNull();
  });
});

describe('instantané (eaux françaises, vus depuis 10 min)', () => {
  const s = trackerWithFixture().snapshot(LAST + 1000);
  it('navires, pavillon français, part typée, dernière réception', () => {
    expect(s).toMatchObject({ vessels: 43, frenchFlag: 23, typedShare: 40, lastMessageAt: '2026-10-03T13:19:48.822Z', at: '2026-10-03T13:19:49.822Z' });
  });
  it('Solent, Barcelone, Seine à Paris et Jersey écartés ; comptes par zone', () => {
    expect(s.zones.map((z) => [z.zone, z.vessels, z.classA, z.classB])).toEqual([
      ['pas-de-calais', 4, 4, 0], ['manche', 22, 19, 3], ['atlantique', 7, 3, 4], ['mediterranee', 10, 6, 4],
    ]);
  });
  it('ports : Le Havre, 9 présents (zone du Havre et de Port-Jérôme) dont 4 au mouillage ; Dunkerque et Bordeaux sans message dans l’échantillon', () => {
    expect(s.ports.find((p) => p.port === 'Le Havre')).toEqual({ port: 'Le Havre', vessels: 9, atAnchor: 4, moored: 1, underWay: 2, lastSeenAt: expect.stringMatching(/^2026-10-03T13:1\d:/) });
    expect(s.ports.find((p) => p.port === 'Dunkerque')).toEqual({ port: 'Dunkerque', vessels: 0, atAnchor: 0, moored: 0, underWay: 0, lastSeenAt: null });
  });
  it('statuts 3, 4 et 7 : information seulement ; « échoué » dans les ports du Havre et de Brest : jamais un signalement', () => {
    expect(s.info).toEqual({ restricted: 3, draught: 1, fishing: 2 });
    expect(s.signals).toEqual([]);
  });
  it('navires sensibles : pétroliers et passagers à moins de 12 milles, du plus proche au plus loin', () => {
    expect(s.sensitive.tankers).toBe(5);
    expect(s.sensitive.passenger).toBe(3);
    expect(s.sensitive.list.map((v) => [v.name, v.type, v.distanceNm]).slice(-3)).toEqual([
      ['FAITHFUL WARRIOR', 'petrolier', 5.8], ['AN HAI WAN', 'petrolier', 6.5], ['LAKSHMI', 'petrolier', 9.1],
    ]);
  });
  it('au-delà de 10 min sans message : plus compté ; panne nommée sans effacer la date de dernière réception', () => {
    const later = trackerWithFixture();
    expect(later.snapshot(LAST + 11 * 60_000).vessels).toBe(0);
    const r = snapshotResponse(later, LAST + 11 * 60_000, { hasKey: true, upstreamOpen: false });
    expect([r.vessels, r.lastMessageAt, r.errors]).toEqual([0, '2026-10-03T13:19:48.822Z', ['AIS : flux aisstream déconnecté']]);
    expect(snapshotResponse(createAisTracker(), LAST, { hasKey: false, upstreamOpen: false })).toMatchObject({ lastMessageAt: null, errors: ['AIS : clé aisstream absente (AISSTREAM_API_KEY)'] });
  });
});

describe('signalements croisés (T3), scénario construit sur des positions réelles', () => {
  const t0 = Date.parse('2026-10-03T13:20:00Z');
  const run = (mmsi: number, steps: Array<{ status: number; sog: number; min: number }>) => {
    const t = trackerWithFixture();
    for (const s of steps) t.ingest(variant(line(mmsi), { status: s.status, sog: s.sog, at: t0 + s.min * 60_000 }));
    const lastMin = steps[steps.length - 1]?.min ?? 0;
    return t.snapshot(t0 + lastMin * 60_000 + 1000).signals;
  };
  it('cargo au large, « non maître de sa manœuvre » 31 min sur 3 positions, sous 0,5 nœud : retenu, non sensible', () => {
    const signals = run(244554000, [{ status: 2, sog: 0.1, min: 0 }, { status: 2, sog: 0.2, min: 15 }, { status: 2, sog: 0.1, min: 31 }]);
    expect(signals).toEqual([{
      mmsi: '244554000', name: 'ANKIE', type: 'Cargo', status: 2, statusLabel: 'Non maître de sa manœuvre', lat: 49.52003, lon: -3.598465,
      since: '2026-10-03T13:20:00.000Z', confirmed: true, sensitive: false,
    }]);
  });
  it('pétrolier au large du Havre, « échoué » 30 min : retenu et sensible', () => {
    const signals = run(241453000, [{ status: 6, sog: 0, min: 0 }, { status: 6, sog: 0, min: 30 }]);
    expect(signals.map((x) => [x.name, x.statusLabel, x.sensitive])).toEqual([['FAITHFUL WARRIOR', 'Échoué', true]]);
  });
  it.each([
    ['moins de 30 min', [{ status: 2, sog: 0.1, min: 0 }, { status: 2, sog: 0.1, min: 29 }]],
    ['une seule position', [{ status: 2, sog: 0.1, min: 31 }]],
    ['vitesse de 0,5 nœud ou plus', [{ status: 2, sog: 0.1, min: 0 }, { status: 2, sog: 0.6, min: 15 }, { status: 2, sog: 0.1, min: 31 }]],
    ['statut interrompu', [{ status: 2, sog: 0.1, min: 0 }, { status: 0, sog: 0.1, min: 10 }, { status: 2, sog: 0.1, min: 31 }]],
    ['statut 3 (manœuvrabilité restreinte)', [{ status: 3, sog: 0, min: 0 }, { status: 3, sog: 0, min: 40 }]],
  ])('%s : jamais retenu', (_case, steps) => {
    expect(run(244554000, steps)).toEqual([]);
  });
  it('mémoire MMSI exportée puis réimportée (redémarrage du relais) : le type reste connu', () => {
    const t = trackerWithFixture();
    const saved = JSON.parse(JSON.stringify(t.exportStatics(LAST)));
    const restarted = createAisTracker();
    restarted.importStatics(saved, LAST + 60_000);
    restarted.ingest(line(241453000));
    expect(restarted.snapshot(LAST + 60_000).sensitive.list.map((v) => v.name)).toEqual(['FAITHFUL WARRIOR']);
    expect(createAisTracker().size).toEqual({ vessels: 0, statics: 0 });
  });
});

describe('comptes par type (byType)', () => {
  const KEYS = ['cargo', 'petrolier', 'passagers', 'peche', 'remorqueur', 'plaisance', 'grande-vitesse', 'service', 'militaire', 'autre', 'inconnu'];
  it.each([
    [null, 'inconnu'], [undefined, 'inconnu'], [0, 'inconnu'],
    [29, 'autre'], [30, 'peche'], [31, 'remorqueur'], [32, 'remorqueur'], [33, 'service'], [34, 'service'], [35, 'militaire'],
    [36, 'plaisance'], [37, 'plaisance'], [38, 'autre'], [39, 'autre'], [40, 'grande-vitesse'], [49, 'grande-vitesse'],
    [50, 'service'], [51, 'service'], [52, 'remorqueur'], [53, 'service'], [54, 'service'], [55, 'service'], [56, 'autre'], [57, 'autre'], [58, 'service'], [59, 'autre'],
    [60, 'passagers'], [69, 'passagers'], [70, 'cargo'], [79, 'cargo'], [80, 'petrolier'], [89, 'petrolier'], [90, 'autre'], [99, 'autre'],
  ])('code %s : %s', (code, expected) => {
    expect(typeCategory(code)).toBe(expected);
  });
  it('la somme des types égale les navires de l’instantané (même population), les onze clés présentes', () => {
    const s = trackerWithFixture().snapshot(LAST + 1000);
    expect(Object.keys(s.byType).sort()).toEqual([...KEYS].sort());
    expect(Object.values(s.byType).reduce((a, b) => a + b, 0)).toBe(s.vessels);
    // Valeurs relevées une fois sur la fixture réelle, puis figées : 43 navires, 17 typés (40 %), 26 sans type connu.
    expect(s.byType).toMatchObject({ inconnu: 26 });
    expect(43 - s.byType.inconnu).toBe(Math.round((s.typedShare / 100) * 43));
    expect(s.byType.petrolier).toBeGreaterThanOrEqual(s.sensitive.tankers);
    expect(s.byType.passagers).toBeGreaterThanOrEqual(s.sensitive.passenger);
  });
  it('relais en panne ou sans clé : onze clés à 0', () => {
    for (const r of [snapshotResponse(createAisTracker(), LAST, { hasKey: false, upstreamOpen: false }), snapshotResponse(createAisTracker(), LAST, { hasKey: true, upstreamOpen: false })]) {
      expect(Object.keys(r.byType).sort()).toEqual([...KEYS].sort());
      expect(Object.values(r.byType).every((n) => n === 0)).toBe(true);
    }
  });
});

/** Position réelle déplacée : autre navire (MMSI), autre lieu, statut, vitesse et heure. */
function placed(raw: string, o: { mmsi: number; lat: number; lon: number; status?: number; sog?: number; at: number }): string {
  const msg = JSON.parse(raw) as { MetaData: { MMSI: number; latitude: number; longitude: number; time_utc: string }; Message: { PositionReport: { Latitude: number; Longitude: number; NavigationalStatus: number; Sog: number } } };
  msg.MetaData.MMSI = o.mmsi; msg.MetaData.latitude = o.lat; msg.MetaData.longitude = o.lon;
  msg.MetaData.time_utc = `${new Date(o.at).toISOString().replace('T', ' ').replace('Z', '')} +0000 UTC`;
  msg.Message.PositionReport.Latitude = o.lat; msg.Message.PositionReport.Longitude = o.lon;
  msg.Message.PositionReport.NavigationalStatus = o.status ?? 0; msg.Message.PositionReport.Sog = o.sog ?? 0;
  return JSON.stringify(msg);
}

describe('ports en zones de plusieurs points, comptés une fois par port', () => {
  const t0 = Date.parse('2026-10-03T14:00:00Z');
  const base = line(244554000);
  const only = (lat: number, lon: number) => {
    const t = createAisTracker();
    t.ingest(placed(base, { mmsi: 999000001, lat, lon, at: t0 }));
    return t.snapshot(t0 + 1000);
  };
  it.each([
    ['Dunkerque (bassin Ouest)', 51.02, 2.17, 'Dunkerque'], ['Bordeaux (Pauillac)', 45.20, -0.74, 'Bordeaux'], ['Bordeaux (Le Verdon)', 45.55, -1.07, 'Bordeaux'],
    ['Bordeaux (Ambès)', 45.01, -0.55, 'Bordeaux'], ['Marseille-Fos (Lavéra)', 43.39, 5.00, 'Marseille-Fos'], ['Saint-Nazaire (Donges-Montoir)', 47.31, -2.08, 'Saint-Nazaire'],
    ['Le Havre (Port-Jérôme)', 49.48, 0.55, 'Le Havre'],
  ])('%s : un navire, compté une fois dans son port', (_n, lat, lon, port) => {
    const s = only(lat, lon);
    expect(s.vessels).toBe(1);
    expect(s.ports.find((p) => p.port === port)?.vessels).toBe(1);
    expect(s.ports.find((p) => p.port === port)?.lastSeenAt).toBe(new Date(t0).toISOString());
  });
  it('un navire proche de deux points du même port n’est compté qu’une fois ; lastSeenAt reste sur 24 h', () => {
    const s = only(43.40, 4.95);
    expect(s.ports.find((p) => p.port === 'Marseille-Fos')?.vessels).toBe(1);
    const t = createAisTracker();
    t.ingest(placed(base, { mmsi: 999000001, lat: 44.9, lon: -0.53, at: t0 }));
    expect(t.snapshot(t0 + 23 * 3_600_000).ports.find((p) => p.port === 'Bordeaux')?.lastSeenAt).toBe(new Date(t0).toISOString());
    expect(t.snapshot(t0 + 25 * 3_600_000).ports.find((p) => p.port === 'Bordeaux')?.lastSeenAt).toBeNull();
  });
  it('un navire hors de toute zone portuaire ne touche lastSeenAt d’aucun port', () => {
    expect(only(47.0, -6.0).ports.every((p) => p.lastSeenAt === null)).toBe(true);
  });
});

describe('signalements T3 dans les ports ajoutés', () => {
  const t0 = Date.parse('2026-10-03T14:00:00Z');
  const run = (lat: number, lon: number, sog = 0.1) => {
    const t = trackerWithFixture();
    for (const min of [0, 15, 30]) t.ingest(placed(line(244554000), { mmsi: 999000002, lat, lon, status: 6, sog, at: t0 + min * 60_000 }));
    return t.snapshot(t0 + 30 * 60_000 + 1000).signals;
  };
  it.each([
    ['quai du bassin Ouest de Dunkerque', 51.02, 2.17], ['Pauillac', 45.20, -0.74], ['Le Verdon', 45.55, -1.07], ['Port-Jérôme', 49.48, 0.55], ['Lavéra', 43.39, 5.00],
  ])('%s, « échoué » 30 min : jamais retenu', (_n, lat, lon) => {
    expect(run(lat, lon)).toEqual([]);
  });
  it('même scénario au large : retenu (le port est bien la seule cause de l’exclusion)', () => {
    expect(run(49.2, -3.0).map((x) => x.mmsi)).toEqual(['999000002']);
  });
  it('vitesse exactement 0,5 nœud : retenue (règle « au plus 0,5 ») ; 0,6 : jamais', () => {
    expect(run(49.2, -3.0, 0.5)).toHaveLength(1);
    expect(run(49.2, -3.0, 0.6)).toEqual([]);
  });
});

describe('dernier message de l’instantané : eaux françaises seulement', () => {
  it('un message d’outre-mer ou du Solent, plus récent, n’avance pas lastMessageAt', () => {
    const t = trackerWithFixture();
    const later = LAST + 5 * 60_000;
    t.ingest(placed(line(244554000), { mmsi: 999000003, lat: 14.6, lon: -61.0, at: later }));
    t.ingest(placed(line(244554000), { mmsi: 999000004, lat: 50.79, lon: -1.11, at: later }));
    const s = t.snapshot(later + 1000);
    expect(s.lastMessageAt).toBe('2026-10-03T13:19:48.822Z');
    t.ingest(placed(line(244554000), { mmsi: 999000005, lat: 49.2, lon: -3.0, at: later }));
    expect(t.snapshot(later + 1000).lastMessageAt).toBe(new Date(later).toISOString());
  });
});

describe('connexions amont : lot coupé ou muet nommé avec ses zones', () => {
  const now = Date.parse('2026-10-03T14:00:00Z');
  const lot = (index: number, o: { open?: boolean; ago?: number | null; labels?: string[]; metro?: boolean }) => ({
    index, open: o.open ?? true, lastAt: o.ago === null ? null : now - (o.ago ?? 1000), labels: o.labels ?? [`zone ${index + 1}`], metro: o.metro ?? true,
  });
  it('trois lots sains : aucune erreur ; lot d’outre-mer seul coupé : aucune erreur', () => {
    expect(upstreamErrors([lot(0, {}), lot(1, {}), lot(2, { open: false, metro: false })], now)).toEqual([]);
  });
  it('panne partielle : le lot 2 coupé est nommé avec ses zones', () => {
    expect(upstreamErrors([lot(0, {}), lot(1, { open: false, labels: ['Gironde', 'Antilles'] }), lot(2, {})], now))
      .toEqual(['flux AIS partiel : lot 2 sur 3 coupé (Gironde, Antilles)']);
  });
  it('connexion ouverte mais muette depuis plus de 5 min : nommée ; 5 min pile : saine', () => {
    expect(upstreamErrors([lot(0, { ago: 7 * 60_000 + 5_000, labels: ['Manche', 'Atlantique'] }), lot(1, {})], now))
      .toEqual(['flux AIS partiel : lot 1 sur 2 muet depuis 7 min (Manche, Atlantique)']);
    expect(upstreamErrors([lot(0, { ago: 5 * 60_000 })], now)).toEqual([]);
  });
  it('tous les lots suivis hors service : « interrompu » ; réponse du relais : erreurs ajoutées, jamais « aucun navire » sans cause', () => {
    const lots = [lot(0, { open: false }), lot(1, { ago: 9 * 60_000 })];
    expect(upstreamErrors(lots, now)).toEqual(['flux AIS interrompu : lot 1 sur 2 coupé (zone 1)', 'flux AIS interrompu : lot 2 sur 2 muet depuis 9 min (zone 2)']);
    const r = snapshotResponse(trackerWithFixture(), now, { hasKey: true, upstreamOpen: true, upstreams: [lot(0, {}), lot(1, { open: false })] });
    expect(r.errors).toEqual(['flux AIS partiel : lot 2 sur 2 coupé (zone 2)']);
  });
});

describe('mémoire MMSI : navires des eaux françaises, champs minimaux, taille bornée', () => {
  it('seuls les statiques de navires vus en eaux françaises sont exportés, avec les champs minimaux', () => {
    const t = trackerWithFixture();
    const exported = t.exportStatics(LAST);
    expect(exported.length).toBeGreaterThan(0);
    expect(Object.keys(exported[0]).sort()).toEqual(['at', 'mmsi', 'name', 'seen', 'type']);
    const solent = LINES.map((l) => JSON.parse(l) as { MetaData?: { MMSI?: number; latitude?: number; longitude?: number } })
      .find((m) => (m.MetaData?.latitude ?? 0) > 50.7 && (m.MetaData?.latitude ?? 0) < 50.9 && (m.MetaData?.longitude ?? 0) < -1);
    if (solent?.MetaData?.MMSI) expect(exported.map((e) => e.mmsi)).not.toContain(String(solent.MetaData.MMSI));
  });
  it('un navire jamais vu en eaux françaises (donnée statique seule) n’est pas exporté', () => {
    const t = createAisTracker();
    t.ingest(line(241453000, 'ShipStaticData'));
    expect(t.exportStatics(LAST)).toEqual([]);
  });
  it('au-delà de 900 Ko : les plus anciennes entrées sont retirées, la taille mesurée est exacte', () => {
    const many = Array.from({ length: 12_000 }, (_, i) => ({ mmsi: String(200_000_000 + i), type: 70, name: `NAVIRE ESSAI NUMERO ${i}`.padEnd(40, 'X'), at: i, seen: i }));
    expect(Buffer.byteLength(JSON.stringify(many))).toBeGreaterThan(STATICS_MAX_BYTES);
    const out = boundStatics(many);
    expect(out.bytes).toBeLessThanOrEqual(STATICS_MAX_BYTES);
    expect(out.bytes).toBe(Buffer.byteLength(JSON.stringify(out.list)));
    expect(out.trimmed).toBe(many.length - out.list.length);
    expect(out.trimmed).toBeGreaterThan(0);
    expect(out.list[0].mmsi).toBe('200011999');
    expect(out.list.some((e) => e.mmsi === '200000000')).toBe(false);
    expect(boundStatics(many.slice(0, 10)).trimmed).toBe(0);
  });
  it('élagage sur minuteur : prune() borne les suivis sans appel à snapshot()', () => {
    const t = trackerWithFixture();
    expect(t.size.vessels).toBeGreaterThan(0);
    t.prune(LAST + 21 * 60_000);
    expect(t.size.vessels).toBe(0);
    t.prune(LAST + 8 * 86_400_000);
    expect(t.size.statics).toBe(0);
  });
});
