import { describe, it, expect } from 'vitest';
import { cloudIncidentCount, normalizeBgp, normalizeCloud, normalizeCyber, normalizeElec, normalizeTelecom, telecomInputs } from './network-barometer.ts';
import { telecomFixtureResponse } from '../components/layer-panel/outages.fixture.ts';
import { parisDate } from './ecowatt-official.ts';
import type { CloudIncident, CloudOutagesResponse, CloudProviderState, CloudStatus, EcowattResponse, EcowattSignal, InternetOutagesResponse } from '../types/index.ts';
import { CYBER_FIXTURE, SOV_FIXTURE_NOW } from '../components/layer-panel/sovereignty.fixture.ts';

describe('normalizeCyber : réponse de /api/sovereignty/cyber (arbitrage 11), plus d’ancien tableau ni d’événements de menace', () => {
  it('04/10 : 100 moins la pression consolidée (28) ; deux pannes télécom renforcent les corrélations (33)', () => {
    expect(normalizeCyber(CYBER_FIXTURE(), { telecomOutageCount: 0, cloudIncidentCount: 0 }, SOV_FIXTURE_NOW)).toBe(72);
    expect(normalizeCyber(CYBER_FIXTURE(), { telecomOutageCount: 2, cloudIncidentCount: 0 }, SOV_FIXTURE_NOW)).toBe(67);
  });
  it('source muette (`undefined`) : même score que sans contexte, jamais un 0 inventé qui se lirait comme une mesure', () => {
    expect(normalizeCyber(CYBER_FIXTURE(), { telecomOutageCount: undefined, cloudIncidentCount: undefined }, SOV_FIXTURE_NOW))
      .toBe(normalizeCyber(CYBER_FIXTURE(), {}, SOV_FIXTURE_NOW));
    expect(normalizeCyber(CYBER_FIXTURE(), { telecomOutageCount: 2 }, SOV_FIXTURE_NOW))
      .toBe(normalizeCyber(CYBER_FIXTURE(), { telecomOutageCount: 2, cloudIncidentCount: undefined }, SOV_FIXTURE_NOW));
    // Deux incidents cloud pèsent comme deux pannes télécom (corrélation des pannes, cyber-threat-scoring.ts).
    expect(normalizeCyber(CYBER_FIXTURE(), { cloudIncidentCount: 2 }, SOV_FIXTURE_NOW)).toBe(67);
  });
});

const NOW = Date.parse('2026-09-25T08:00:00Z');

function ecowatt(level: EcowattSignal | null): EcowattResponse {
  const mix = { timestamp: new Date(0), nuclear: 0, wind: 0, solar: 0, hydro: 0, gas: 0, other: 0, total: 0 };
  const official: EcowattResponse['official'] = level ? {
    source: 'rte',
    generatedAt: new Date(NOW).toISOString(),
    days: [{ date: parisDate(NOW), level, message: 'Test', hours: Array.from({ length: 24 }, () => 1) }],
  } : null;
  return { official, mixes: {}, national: mix, interconnections: [], grid: null };
}

describe('normalizeElec — Écowatt national (green/orange/red), jamais un 100 par défaut', () => {
  it('green → 100, orange → 60, red → 20', () => {
    expect(normalizeElec(ecowatt('green'), NOW)).toBe(100);
    expect(normalizeElec(ecowatt('orange'), NOW)).toBe(60);
    expect(normalizeElec(ecowatt('red'), NOW)).toBe(20);
  });

  it('niveau inconnu (signal officiel indisponible) → null, jamais 100 par défaut', () => {
    expect(normalizeElec(ecowatt(null), NOW)).toBeNull();
  });

  it('signal d’un autre jour (repli open data J-1) → null, pas présenté comme celui du jour', () => {
    const yesterday: EcowattResponse = {
      official: { source: 'odre', generatedAt: null, days: [{ date: '2026-09-24', level: 'red', message: 'Test', hours: Array.from({ length: 24 }, () => 1) }] },
      mixes: {},
      national: { timestamp: new Date(0), nuclear: 0, wind: 0, solar: 0, hydro: 0, gas: 0, other: 0, total: 0 },
      interconnections: [], grid: null,
    };
    expect(normalizeElec(yesterday, NOW)).toBeNull();
  });
});

describe('normalizeTelecom : 100 moins les pannes imprévues récentes divisées par 50 (arbitrage 7 du plan 2026-10-08)', () => {
  const withRecent = (recent: number) => {
    const t = telecomFixtureResponse();
    return { ...t, summary: t.summary === null ? null : { ...t.summary, recent } };
  };
  it('0 → 100, 264 → 95, 5 000 et plus → 0 (jamais négatif)', () => {
    expect(normalizeTelecom(withRecent(0))).toBe(100);
    expect(normalizeTelecom(withRecent(264))).toBe(95);
    expect(normalizeTelecom(withRecent(5000))).toBe(0);
    expect(normalizeTelecom(withRecent(9000))).toBe(0);
  });
  it('source muette (fichier non lu ou sans résumé) : null, composante exclue, jamais 100 par défaut', () => {
    expect(normalizeTelecom(null)).toBeNull();
    expect(normalizeTelecom({ ...telecomFixtureResponse(), summary: null })).toBeNull();
  });
});

describe('baromètre Télécom : fichier ARCEP passé par telecomIfFresh (P17)', () => {
  // Fichier du 08/10 : normal le 09/10 à 10 h à Paris, en retard à 16 h (fichier du jour attendu avant 15 h).
  const MORNING = Date.parse('2026-10-09T08:00:00Z');
  const AFTERNOON = Date.parse('2026-10-09T14:00:00Z');
  const withRecent = (recent: number) => {
    const t = telecomFixtureResponse();
    return { ...t, summary: t.summary === null ? null : { ...t.summary, recent } };
  };
  it('fichier de la veille à 10 h : composante et pannes du contexte cyber lues', () => {
    expect(telecomInputs(withRecent(264), MORNING)).toEqual({ score: 95, outageCount: 264 });
  });
  it('fichier de la veille lu à 16 h : composante null, aucune panne télécom au contexte cyber (score cyber égal à celui sans télécom)', () => {
    const late = telecomInputs(withRecent(2), AFTERNOON);
    expect(late).toEqual({ score: null, outageCount: undefined });
    expect(normalizeCyber(CYBER_FIXTURE(), { telecomOutageCount: late.outageCount }, SOV_FIXTURE_NOW)).toBe(72);
    expect(normalizeCyber(CYBER_FIXTURE(), { telecomOutageCount: telecomInputs(withRecent(2), MORNING).outageCount }, SOV_FIXTURE_NOW)).toBe(67);
  });
  it('fichier non lu ou sans résumé : composante null, aucune panne au contexte', () => {
    expect(telecomInputs(null, MORNING)).toEqual({ score: null, outageCount: undefined });
    expect(telecomInputs({ ...telecomFixtureResponse(), summary: null }, MORNING)).toEqual({ score: null, outageCount: undefined });
  });
});

const B_NOW = Date.parse('2026-10-09T12:00:00Z');

function internet(ripe: InternetOutagesResponse['ripe']): InternetOutagesResponse {
  return {
    readAt: '2026-10-09T11:55:00Z', iodaReadAt: '2026-10-09T11:55:00Z', radar: { configured: false, readAt: null, items: [] }, events: [], ripe, errors: [],
  };
}

describe('normalizeBgp : visibilité minimale des grands réseaux RIPEstat, jamais 100 par défaut (spec § 3.1, P15)', () => {
  const nets = (...pcts: number[]) => pcts.map((visibilityPct, i) => ({ asn: 3215 + i, name: `Réseau ${i}`, visibilityPct }));
  it('réseaux à 100, 99,6 et 98 % : 98', () => {
    expect(normalizeBgp(internet({ snapshotAt: '2026-10-09T08:00:00Z', networks: nets(100, 99.6, 98) }), B_NOW)).toBe(98);
  });
  it('minimum arrondi : 97,6 donne 98', () => {
    expect(normalizeBgp(internet({ snapshotAt: '2026-10-09T08:00:00Z', networks: nets(100, 97.6) }), B_NOW)).toBe(98);
  });
  it('rappel RIPEstat absent, sans réseau ou réponse non lue : null', () => {
    expect(normalizeBgp(internet(null), B_NOW)).toBeNull();
    expect(normalizeBgp(internet({ snapshotAt: '2026-10-09T08:00:00Z', networks: [] }), B_NOW)).toBeNull();
    expect(normalizeBgp(null, B_NOW)).toBeNull();
  });
  it('instantané vieux de 11 h (au-delà de la règle RIPEstat de 10 h) ou non daté : null', () => {
    expect(normalizeBgp(internet({ snapshotAt: '2026-10-09T01:00:00Z', networks: nets(100) }), B_NOW)).toBeNull();
    expect(normalizeBgp(internet({ snapshotAt: null, networks: nets(100) }), B_NOW)).toBeNull();
  });
});

const zone = (id: string, status: CloudStatus) => ({ id, label: id, status, updatedAt: '2026-10-09T11:00:00Z', lat: 48.86, lon: 2.35 });
function provider(p: Partial<CloudProviderState> & Pick<CloudProviderState, 'provider' | 'zones'>): CloudProviderState {
  return { label: p.provider, readAt: '2026-10-09T11:50:00Z', note: null, error: null, ...p };
}
function cloud(providers: CloudProviderState[], incidents: CloudIncident[] = []): CloudOutagesResponse {
  return {
    readAt: '2026-10-09T11:50:00Z', providers, incidents, maintenances: [], elsewhere: [],
    reference: { generatedAt: null, datacenters: [], exchanges: [] }, errors: [],
  };
}
const incident = (id: string, p: CloudIncident['provider'], state: CloudIncident['state']): CloudIncident => ({
  id, provider: p, title: id, zones: ['GRA'], state, impact: 'minor', start: '2026-10-09T10:00:00Z', updatedAt: null, url: null,
});

describe('normalizeCloud : part des zones françaises suivies saines (spec § 3.2, P16, R41)', () => {
  it('3 zones opérationnelles et 1 inconnue : 75 (une zone inconnue reste au dénominateur, elle n’est pas saine)', () => {
    const r = cloud([provider({ provider: 'ovhcloud', zones: [zone('GRA', 'operational'), zone('RBX', 'operational'), zone('SBG', 'operational'), zone('PAR', 'unknown')] })]);
    expect(normalizeCloud(r, B_NOW)).toBe(75);
  });
  it('une maintenance et une zone opérationnelle : 100 (la maintenance compte saine)', () => {
    expect(normalizeCloud(cloud([provider({ provider: 'scaleway', zones: [zone('fr-par-1', 'maintenance'), zone('fr-par-2', 'operational')] })]), B_NOW)).toBe(100);
  });
  it('une panne partielle et une zone opérationnelle : 50', () => {
    expect(normalizeCloud(cloud([provider({ provider: 'outscale', zones: [zone('eu-west-2', 'partial'), zone('cloudgouv', 'operational')] })]), B_NOW)).toBe(50);
  });
  it('fournisseur en retard (dernière lecture il y a 3 h) ou jamais lu : ses zones exclues', () => {
    const r = cloud([
      provider({ provider: 'ovhcloud', zones: [zone('GRA', 'operational')] }),
      provider({ provider: 'scaleway', readAt: '2026-10-09T09:00:00Z', zones: [zone('fr-par-1', 'major'), zone('fr-par-2', 'major')] }),
      provider({ provider: 'outscale', readAt: null, error: 'Outscale : HTTP 503', zones: [zone('eu-west-2', 'major')] }),
    ]);
    expect(normalizeCloud(r, B_NOW)).toBe(100);
  });
  it('fournisseur à jour dont une page a échoué : ses zones gardées comptent encore (lecture réussie de moins de 2 h, R41)', () => {
    const r = cloud([provider({ provider: 'ovhcloud', error: 'OVHcloud (network) : HTTP 503', zones: [zone('GRA', 'operational'), zone('RBX', 'partial')] })]);
    expect(normalizeCloud(r, B_NOW)).toBe(50);
  });
  // Zones GCP et AWS sans état publié (opérationnelles par absence d'incident, sans date) : ni au numérateur ni au dénominateur (ruling B9,
  // pas de vert déduit, comme la carte B8) ; un incident publié les y fait entrer, non saines.
  const deduced = (id: string) => ({ ...zone(id, 'operational'), updatedAt: null });
  it('OVHcloud opérationnel et zone Google Cloud déduite : 100, la zone déduite hors du dénominateur', () => {
    const r = cloud([provider({ provider: 'ovhcloud', zones: [zone('GRA', 'operational')] }), provider({ provider: 'gcp', zones: [deduced('europe-west9')] })]);
    expect(normalizeCloud(r, B_NOW)).toBe(100);
    const withPartial = cloud([
      provider({ provider: 'ovhcloud', zones: [zone('GRA', 'operational'), zone('RBX', 'partial')] }), provider({ provider: 'gcp', zones: [deduced('europe-west9')] }),
    ]);
    expect(normalizeCloud(withPartial, B_NOW)).toBe(50);
  });
  it('zone Google Cloud dégradée (incident publié) : comptée non saine, 50', () => {
    const r = cloud([
      provider({ provider: 'ovhcloud', zones: [zone('GRA', 'operational')] }),
      provider({ provider: 'gcp', zones: [{ ...zone('europe-west9', 'degraded'), updatedAt: null }] }),
    ]);
    expect(normalizeCloud(r, B_NOW)).toBe(50);
  });
  it('seuls Google Cloud et AWS à jour, sans incident publié : null (n.d.), jamais 100', () => {
    const r = cloud([
      provider({ provider: 'gcp', zones: [deduced('europe-west9')] }), provider({ provider: 'aws', zones: [deduced('eu-west-3')] }),
      provider({ provider: 'ovhcloud', readAt: '2026-10-09T08:00:00Z', zones: [zone('GRA', 'operational')] }),
    ]);
    expect(normalizeCloud(r, B_NOW)).toBeNull();
  });
  it('aucun fournisseur lu, aucun à jour, ou aucune zone suivie : null (jamais 100 par défaut)', () => {
    expect(normalizeCloud(null, B_NOW)).toBeNull();
    expect(normalizeCloud(cloud([]), B_NOW)).toBeNull();
    expect(normalizeCloud(cloud([provider({ provider: 'ovhcloud', readAt: '2026-10-09T08:00:00Z', zones: [zone('GRA', 'operational')] })]), B_NOW)).toBeNull();
    expect(normalizeCloud(cloud([provider({ provider: 'azure', zones: [] })]), B_NOW)).toBeNull();
  });
});

describe('cloudIncidentCount : contexte cyber = incidents France en cours des fournisseurs à jour (R41)', () => {
  it('compte les incidents « en cours », pas les « surveillés » ni ceux d’un fournisseur en retard', () => {
    const r = cloud(
      [provider({ provider: 'ovhcloud', zones: [zone('GRA', 'operational')] }), provider({ provider: 'scaleway', readAt: '2026-10-09T08:00:00Z', zones: [] })],
      [incident('a', 'ovhcloud', 'en-cours'), incident('b', 'ovhcloud', 'surveille'), incident('c', 'scaleway', 'en-cours')],
    );
    expect(cloudIncidentCount(r, B_NOW)).toBe(1);
  });
  it('aucun fournisseur à jour ou réponse non lue : undefined (source muette, jamais 0)', () => {
    expect(cloudIncidentCount(null, B_NOW)).toBeUndefined();
    expect(cloudIncidentCount(cloud([provider({ provider: 'ovhcloud', readAt: null, zones: [] })], [incident('a', 'ovhcloud', 'en-cours')]), B_NOW)).toBeUndefined();
  });
});
