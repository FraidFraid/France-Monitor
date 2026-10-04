// src/services/sovereignty-levels.test.ts : retards par source, pastilles et gravités des panneaux Souveraineté (spec 2026-10-04
// souveraineté § 1 et § 2 ; contrats § 3.1 ; amendement 7 : conformité aux autorités), sur des objets typés du 4 octobre 2026 :
// 9 aéronefs militaires ou d'État au-dessus de la métropole (4 français comptés par département), un 7700 confirmé au-dessus du
// Finistère, un 7500 vu une fois au-dessus de Genève, AIS muet, alertes CERT-FR en cours ALE-009 à ALE-011, ALE-008 close le 22/09.
import { describe, expect, it } from 'vitest';
import type {
  CableAlert, CablesWatchResponse, CertFrItem, CyberResponse, MaskedMilitaryEmergency, MilitaryAircraft, MilitaryEmergency,
  MilitaryResponse, RansomwareSummary, ShownMilitaryEmergency, VigipiratePageCheck,
} from '../types/index.ts';
import {
  CABLES_WATCH_STALE_MIN, MILITARY_FIGURE_LABEL, SOVEREIGNTY_LATE_AFTER_MIN, VIGIPIRATE_ALERTE_ATTENTAT_DAYS, VIGIPIRATE_REMINDER_DAYS,
  cableAlertLevel, cablesLevel, certfrAgeDays, certfrDate, certfrExploitationText, certfrPublishedAgeDays, claimsRatio, cyberLevel,
  defenseLevel, defenseSituationSeverity, isCertFrAlertOpen, isDefenseSituationEmergency, isSovereigntyDataLate, militaryCounts,
  militaryEmergencyLevel, vigipirateAlertEnd, vigipiratePageChangedOn, vigipirateReminderDue,
} from './sovereignty-levels.ts';

const T = (iso: string): number => Date.parse(iso);
/** 4 octobre 2026, 16 h 48 min 30 s à Paris (14:48:30Z) : heure des relevés de la spec. */
const NOW = T('2026-10-04T16:48:30+02:00');
const NBSP = '\u00a0';

// ─── Retards ───

describe('isSovereigntyDataLate (tableau S2)', () => {
  it.each(Object.entries(SOVEREIGNTY_LATE_AFTER_MIN))('%s : en retard au-delà de %i min, pas à la limite', (source, minutes) => {
    const s = source as keyof typeof SOVEREIGNTY_LATE_AFTER_MIN;
    expect(isSovereigntyDataLate(s, new Date(NOW - minutes * 60_000).toISOString(), NOW)).toBe(false);
    expect(isSovereigntyDataLate(s, new Date(NOW - minutes * 60_000 - 1000).toISOString(), NOW)).toBe(true);
  });
  it('cadences de la spec : vols 10 min, câbles 15 min (amendement 5), CERT-FR 6 h, KEV 26 h, ransomware.live 24 h, RIPEstat 10 h, gels 26 h', () => {
    expect(SOVEREIGNTY_LATE_AFTER_MIN).toEqual({
      'adsb-mil': 10, 'ais-cables': 15, certfr: 360, kev: 1560, ransomware: 1440, hibp: 1560, cybermalveillance: 360,
      'adsb-gnss': 40, noaa: 180, ripestat: 600, gels: 1560,
    });
  });
  it('date absente ou illisible : en retard', () => {
    expect(isSovereigntyDataLate('adsb-mil', null, NOW)).toBe(true);
    expect(isSovereigntyDataLate('certfr', 'hier', NOW)).toBe(true);
  });
});

// ─── Vigipirate ───

describe('Vigipirate : saisie datée, jamais en retard, rappel au-delà de 120 jours', () => {
  it('saisie du 04/10/2026 : pas de rappel le jour même ni le 01/02/2027 (120 jours), rappel le 02/02/2027', () => {
    expect(VIGIPIRATE_REMINDER_DAYS).toBe(120);
    expect(vigipirateReminderDue({ saisiLe: '2026-10-04' }, NOW)).toBe(false);
    expect(vigipirateReminderDue({ saisiLe: '2026-10-04' }, T('2027-02-01T23:59:00+01:00'))).toBe(false);
    expect(vigipirateReminderDue({ saisiLe: '2026-10-04' }, T('2027-02-02T00:01:00+01:00'))).toBe(true);
  });
  it('date de saisie illisible : rappel', () => {
    expect(vigipirateReminderDue({ saisiLe: '04/10/2026' }, NOW)).toBe(true);
  });
});

describe('Vigipirate : fin des 12 jours de l’alerte attentat (O14)', () => {
  it('alerte attentat depuis le 04/10 : jusqu’au 16/10 ; depuis le 25/09 : jusqu’au 07/10', () => {
    expect(VIGIPIRATE_ALERTE_ATTENTAT_DAYS).toBe(12);
    expect(vigipirateAlertEnd({ stade: 'alerte-attentat', depuis: '2026-10-04' })).toBe('2026-10-16');
    expect(vigipirateAlertEnd({ stade: 'alerte-attentat', depuis: '2026-09-25' })).toBe('2026-10-07');
  });
  it('autre stade ou date illisible : aucune fin', () => {
    expect(vigipirateAlertEnd({ stade: 'vigilance-renforcee', depuis: '2026-06-22' })).toBeNull();
    expect(vigipirateAlertEnd({ stade: 'vigilance', depuis: '2026-06-22' })).toBeNull();
    expect(vigipirateAlertEnd({ stade: 'alerte-attentat', depuis: '22/06/2026' })).toBeNull();
  });
});

describe('Vigipirate : page officielle modifiée après la saisie (O14)', () => {
  function check(pageChangedAt: string | null): VigipiratePageCheck {
    return { readAt: '2026-10-06T05:10:00.000Z', fingerprint: 'a3f1', pageChangedAt, errors: [] };
  }
  it('page jamais relue, ou empreinte jamais changée : rien à revérifier', () => {
    expect(vigipiratePageChangedOn({ saisiLe: '2026-10-04' }, null)).toBeNull();
    expect(vigipiratePageChangedOn({ saisiLe: '2026-10-04' }, check(null))).toBeNull();
  });
  it('page modifiée le 01/10 (avant la saisie du 04/10) ou le jour de la saisie : rien ; le 06/10 : « page modifiée le 06/10 »', () => {
    expect(vigipiratePageChangedOn({ saisiLe: '2026-10-04' }, check('2026-10-01T05:10:00.000Z'))).toBeNull();
    expect(vigipiratePageChangedOn({ saisiLe: '2026-10-04' }, check('2026-10-04T05:10:00.000Z'))).toBeNull();
    expect(vigipiratePageChangedOn({ saisiLe: '2026-10-04' }, check('2026-10-06T05:10:00.000Z'))).toBe('2026-10-06');
  });
  it('le jour est celui de Paris : 22:30Z le 04/10 est le 05/10 à Paris', () => {
    expect(vigipiratePageChangedOn({ saisiLe: '2026-10-04' }, check('2026-10-04T22:30:00.000Z'))).toBe('2026-10-05');
  });
  it('saisie illisible : toute modification lue demande la vérification ; date de modification illisible : rien', () => {
    expect(vigipiratePageChangedOn({ saisiLe: '04/10/2026' }, check('2026-10-01T05:10:00.000Z'))).toBe('2026-10-01');
    expect(vigipiratePageChangedOn({ saisiLe: '2026-10-04' }, check('hier'))).toBeNull();
  });
});

// ─── Défense ───

/** Urgence d'un appareil montré ; `confirmed: false` : vue une seule fois (première et dernière vue identiques). */
function emergency(over: Partial<ShownMilitaryEmergency> & { confirmed?: boolean } = {}): ShownMilitaryEmergency {
  const { confirmed = true, ...rest } = over;
  return {
    masked: false, icao24: 'ae0805', callsign: 'RCH161', squawk: '7700', lat: 48.2, lon: -4.1, altitudeM: 7620,
    firstSeen: confirmed ? '2026-10-04T14:46:24.501Z' : '2026-10-04T14:48:24.501Z', lastSeen: '2026-10-04T14:48:24.501Z',
    overFrance: true, type: 'C17', country: 'États-Unis', family: 'autres', emergency: 'general', inFrance: true, dept: '29', ...rest,
  };
}
/** Urgence d'un appareil masqué (O10) : appareil d'État français par défaut, au-dessus du Morbihan, confirmée. */
function masked(over: Partial<MaskedMilitaryEmergency> = {}): MaskedMilitaryEmergency {
  return {
    masked: true, family: 'francais', squawk: '7700', firstSeen: '2026-10-04T14:46:24.501Z', lastSeen: '2026-10-04T14:48:24.501Z',
    overFrance: true, emergency: 'general', inFrance: true, dept: '56', ...over,
  };
}
/** 7500 au-dessus de Genève : hors de France (V2) mais dans les approches de 40 km (4,4 km de la frontière). */
const GENEVE = emergency({
  icao24: '4b1a2c', callsign: 'SUI7500', squawk: '7500', lat: 46.204, lon: 6.143, country: 'Suisse', emergency: 'unlawful',
  inFrance: false, dept: null, confirmed: false,
});
const GENEVE_CONFIRMED: ShownMilitaryEmergency = { ...GENEVE, firstSeen: '2026-10-04T14:46:24.501Z' };
const BRUXELLES = emergency({ overFrance: false, inFrance: false, lat: 50.85, lon: 4.35, dept: null });

function aircraft(hex: string, callsign: string, country: string, dept: string, lat: number, lon: number): MilitaryAircraft {
  return { hex, callsign, type: 'A332', country, lat, lon, dept, altitudeFt: 38000, speedKt: 422, track: 321, seenAt: '2026-10-04T14:48:24.307Z' };
}
/** Réponse du 04/10 : 4 français comptés (3 dans les Bouches-du-Rhône, 1 dans le Rhône), 5 autres montrés, 3 hors de France. */
function military(emergencies: MilitaryEmergency[] = [], readAt: string | null = '2026-10-04T14:48:30.000Z'): MilitaryResponse {
  return {
    readAt, sourceNow: readAt === null ? null : '2026-10-04T14:48:24.501Z',
    frenchByDept: [{ dept: '13', count: 3 }, { dept: '69', count: 1 }],
    others: [
      aircraft('894081', 'BAH11', 'Bahreïn', '71', 47.017, 4.423), aircraft('c2b5b7', 'CFC2902', 'Canada', '13', 43.484, 4.676),
      aircraft('44f684', 'GRZLY21', 'Belgique', '64', 43.381, -0.469), aircraft('43c6f6', 'RRR2243', 'Royaume-Uni', '62', 50.693, 1.626),
      aircraft('43c700', 'RRR2301', 'Royaume-Uni', '63', 45.947, 3.590),
    ],
    maskedOthers: 0, abroadCount: 3, abroad: [],
    emergencies, emergencyLog: emergencies, hourly: { hours: [{ hour: '2026-10-04T14', francais: 4, autres: 5 }], since: '2026-10-04T14' }, errors: [],
  };
}

describe('militaryCounts et libellé du gros chiffre (O9, O10)', () => {
  it('04/10 : 9 aéronefs, 4 français comptés par département, 5 autres ; les appareils masqués sont comptés, jamais montrés', () => {
    expect(militaryCounts(military())).toEqual({ francais: 4, autres: 5, total: 9 });
    expect(militaryCounts({ ...military(), maskedOthers: 2, frenchByDept: [{ dept: '13', count: 3 }, { dept: null, count: 1 }] })).toEqual({
      francais: 4, autres: 7, total: 11,
    });
  });
  it('libellé « aéronefs militaires ou d’État visibles en ADS-B au-dessus de la métropole »', () => {
    expect(MILITARY_FIGURE_LABEL).toBe('aéronefs militaires ou d’État visibles en ADS-B au-dessus de la métropole');
  });
});

describe('militaryEmergencyLevel', () => {
  it('7500 confirmé : rouge ; 7700 et 7600 confirmés : orange', () => {
    expect(militaryEmergencyLevel(emergency({ squawk: '7500' }))).toBe('rouge');
    expect(militaryEmergencyLevel(emergency({ squawk: '7700' }))).toBe('orange');
    expect(militaryEmergencyLevel(emergency({ squawk: '7600' }))).toBe('orange');
  });
  it('vue une fois au-dessus de la France ou de ses approches : jaune (Genève) ; hors des approches : gris, même confirmée', () => {
    expect(militaryEmergencyLevel(GENEVE)).toBe('jaune');
    expect(militaryEmergencyLevel(BRUXELLES)).toBe('gris');
    expect(militaryEmergencyLevel(emergency({ overFrance: false, inFrance: false, confirmed: false }))).toBe('gris');
  });
  it('appareil masqué (O10) : mêmes couleurs, sans adresse ni position', () => {
    expect(militaryEmergencyLevel(masked())).toBe('orange');
    expect(militaryEmergencyLevel(masked({ squawk: '7500' }))).toBe('rouge');
    expect(militaryEmergencyLevel(masked({ firstSeen: '2026-10-04T14:48:24.501Z' }))).toBe('jaune');
  });
});

describe('defenseLevel (pastille Défense, § 2.1)', () => {
  it('04/10 : 9 aéronefs, aucune urgence : vert, jamais « Situation normale » ; l’absence dite comme une observation ADS-B', () => {
    expect(defenseLevel(military(), NOW)).toEqual({
      level: 'vert', reason: 'aucun code d’urgence affiché par un aéronef militaire ou d’État visible en ADS-B au-dessus de la métropole ou de ses approches',
    });
  });
  it('7700 affiché sur deux relevés au-dessus du Finistère : orange, nommé', () => {
    expect(defenseLevel(military([emergency()]), NOW)).toEqual({ level: 'orange', reason: `7700${NBSP}(urgence) affiché sur deux relevés : RCH161` });
  });
  it('7500 vu une fois au-dessus de Genève : jaune (approches), « à confirmer », intervention illicite (S3)', () => {
    expect(defenseLevel(military([GENEVE]), NOW)).toEqual({
      level: 'jaune', reason: `7500${NBSP}(intervention${NBSP}illicite) vu une fois, à confirmer : SUI7500`,
    });
  });
  it('7500 sur deux relevés au-dessus de Genève : rouge (moins de 40 km), même hors du compte V2, « non confirmé par les autorités »', () => {
    expect(defenseLevel(military([GENEVE_CONFIRMED]), NOW)).toEqual({
      level: 'rouge', reason: `7500${NBSP}(intervention${NBSP}illicite) affiché sur deux relevés, non confirmé par les autorités : SUI7500`,
    });
  });
  it('le 7500 l’emporte sur le 7700 ; 7600 sur deux relevés : orange', () => {
    expect(defenseLevel(military([emergency(), GENEVE_CONFIRMED]), NOW).level).toBe('rouge');
    expect(defenseLevel(military([emergency({ squawk: '7600', emergency: 'nordo' })]), NOW).reason).toBe(
      `7600${NBSP}(panne${NBSP}radio) affiché sur deux relevés : RCH161`,
    );
  });
  it('urgence hors des approches (Bruxelles) : vert, la dit vue hors des approches', () => {
    expect(defenseLevel(military([BRUXELLES]), NOW)).toEqual({
      level: 'vert', reason: 'aucun code d’urgence au-dessus de la métropole ou de ses approches (urgence vue hors des approches)',
    });
  });
  it('indicatif absent : l’adresse est nommée', () => {
    expect(defenseLevel(military([emergency({ callsign: null })]), NOW).reason).toBe(`7700${NBSP}(urgence) affiché sur deux relevés : adresse ae0805`);
  });
  it('appareil d’État français (O10) : jamais d’indicatif ni d’adresse, le département ou la mer territoriale', () => {
    expect(defenseLevel(military([masked()]), NOW)).toEqual({
      level: 'orange', reason: `7700${NBSP}(urgence) affiché sur deux relevés : appareil d’État français · Dépt${NBSP}56`,
    });
    expect(defenseLevel(military([masked({ dept: null })]), NOW).reason).toBe(`7700${NBSP}(urgence) affiché sur deux relevés : appareil d’État français · mer territoriale`);
    expect(defenseLevel(military([masked({ dept: null, inFrance: false, firstSeen: '2026-10-04T14:48:24.501Z' })]), NOW).reason).toBe(
      `7700${NBSP}(urgence) vu une fois, à confirmer : appareil d’État français · approches de la France`,
    );
  });
  it('appareil d’une autre nation marqué PIA ou LADD (O10) : identité protégée, département seul', () => {
    expect(defenseLevel(military([masked({ family: 'autres', squawk: '7500', dept: '13' })]), NOW)).toEqual({
      level: 'rouge',
      reason: `7500${NBSP}(intervention${NBSP}illicite) affiché sur deux relevés, non confirmé par les autorités : appareil à identité protégée (PIA ou LADD) · Dépt${NBSP}13`,
    });
  });
  it('adsb.lol jamais lu : n.d. ; relevé de plus de 10 min : n.d. « muet depuis 16:37 », jamais vert ni « 0 aéronef »', () => {
    expect(defenseLevel(military([], null), NOW)).toEqual({ level: 'nd', reason: 'adsb.lol indisponible' });
    expect(defenseLevel(military([], '2026-10-04T14:37:29.000Z'), NOW)).toEqual({ level: 'nd', reason: 'non évalué · adsb.lol muet depuis 16:37' });
    expect(defenseLevel(military([], '2026-10-04T14:38:30.000Z'), NOW).level).toBe('vert');
  });
  it('phase B : 3 mailles à précision GNSS dégradée orange, 1 ou 2 jaune, « à vérifier » (O15) ; un 7500 sur deux relevés reste rouge', () => {
    expect(defenseLevel(military(), NOW, 3)).toEqual({
      level: 'orange', reason: `3 mailles à précision GNSS dégradée (plus de 10${NBSP}% des aéronefs), à vérifier`,
    });
    expect(defenseLevel(military(), NOW, 1)).toEqual({
      level: 'jaune', reason: `1 maille à précision GNSS dégradée (plus de 10${NBSP}% des aéronefs), à vérifier`,
    });
    expect(defenseLevel(military([GENEVE]), NOW, 2).reason).toBe(`7500${NBSP}(intervention${NBSP}illicite) vu une fois, à confirmer : SUI7500`);
    expect(defenseLevel(military([GENEVE_CONFIRMED]), NOW, 5).level).toBe('rouge');
    expect(defenseLevel(military([], null), NOW, 5).level).toBe('nd');
  });
});

describe('defenseSituationSeverity (« Signal défense », O7)', () => {
  it('04/10 : 9 aéronefs sans urgence ni grille : aucune situation (un aéronef observé n’est pas un événement)', () => {
    expect(defenseSituationSeverity([], null)).toBeNull();
  });
  it('7700 et 7600 sur deux relevés : aucune situation, ils restent des urgences aériennes du panneau et du moniteur', () => {
    expect(defenseSituationSeverity([emergency(), emergency({ squawk: '7600' }), masked()], null)).toBeNull();
    expect([emergency(), masked()].some(isDefenseSituationEmergency)).toBe(false);
  });
  it('7500 sur deux relevés au-dessus de la France ou de ses approches : moyenne, jamais plus ; vu une fois ou hors des approches : rien', () => {
    expect(defenseSituationSeverity([GENEVE_CONFIRMED], null)).toBe('medium');
    expect(defenseSituationSeverity([masked({ squawk: '7500' })], null)).toBe('medium');
    expect(defenseSituationSeverity([GENEVE], null)).toBeNull();
    expect(defenseSituationSeverity([{ ...BRUXELLES, squawk: '7500' }], null)).toBeNull();
    expect([GENEVE_CONFIRMED, GENEVE, emergency()].filter(isDefenseSituationEmergency)).toEqual([GENEVE_CONFIRMED]);
  });
  it('GNSS : 3 mailles sur 24 h, moyenne ; élevée seulement si les deux derniers jours UTC en avaient aussi 3 ou plus', () => {
    expect(defenseSituationSeverity([], { rolling24h: 2, previousUtcDays: [5, 5] })).toBeNull();
    expect(defenseSituationSeverity([], { rolling24h: 3, previousUtcDays: [2, 5] })).toBe('medium');
    expect(defenseSituationSeverity([], { rolling24h: 3, previousUtcDays: [3, null] })).toBe('medium');
    expect(defenseSituationSeverity([], { rolling24h: 4, previousUtcDays: [3, 6] })).toBe('high');
    expect(defenseSituationSeverity([GENEVE_CONFIRMED], { rolling24h: 4, previousUtcDays: [3, 6] })).toBe('high');
  });
});

// ─── Connectivité ───

function alert(over: Partial<CableAlert> = {}): CableAlert {
  return {
    id: '227000001:way/761201757', mmsi: '227000001', name: 'NAVIRE ESSAI', vesselType: 'Cargo', cableId: 'way/761201757', cableName: 'AMITIE',
    lat: 43.25, lon: 4.9, distanceM: 300, speedKn: 1, navStatus: 1,
    firstSeen: '2026-10-04T14:36:00.000Z', lastSeen: '2026-10-04T14:42:00.000Z', confirmed: true, ...over,
  };
}
function watch(over: Partial<CablesWatchResponse> = {}): CablesWatchResponse {
  return {
    readAt: '2026-10-04T14:47:00.000Z', aisLastMessageAt: '2026-10-04T14:46:58.000Z', evaluated: true,
    cablesFile: { generatedAt: '2026-10-04T15:00:00.000Z', osmBase: '2026-10-04T14:47:16Z', cables: 39, landings: 52 },
    slowVessels: 412, alerts: [], errors: [], ...over,
  };
}

describe('cableAlertLevel et cablesLevel (pastille Connectivité, § 2.2)', () => {
  it('alerte confirmée orange, vue une fois jaune ; AIS muet : gris, même confirmée', () => {
    expect(cableAlertLevel(alert(), true)).toBe('orange');
    expect(cableAlertLevel(alert({ confirmed: false }), true)).toBe('jaune');
    expect(cableAlertLevel(alert(), false)).toBe('gris');
  });
  it('aucune alerte : vert ; confirmée : orange « à vérifier » ; vue une fois : jaune', () => {
    expect(cablesLevel(watch(), NOW)).toEqual({ level: 'vert', reason: `aucun navire lent à moins de 500${NBSP}m d’un câble` });
    expect(cablesLevel(watch({ alerts: [alert()] }), NOW)).toEqual({ level: 'orange', reason: '1 navire lent confirmé sur un câble, à vérifier : NAVIRE ESSAI (AMITIE)' });
    expect(cablesLevel(watch({ alerts: [alert({ confirmed: false, name: null })] }), NOW)).toEqual({
      level: 'jaune', reason: '1 navire lent vu une fois sur un câble, à vérifier : MMSI 227000001 (AMITIE)',
    });
  });
  it('AIS muet depuis 6 min : n.d. « non évalué · AIS muet depuis 16:42 », alerte confirmée gardée mais sans couleur', () => {
    expect(cablesLevel(watch({ evaluated: false, aisLastMessageAt: '2026-10-04T14:42:00.000Z', alerts: [alert()] }), NOW)).toEqual({
      level: 'nd', reason: 'non évalué · AIS muet depuis 16:42',
    });
  });
  it(`relais jamais lu : n.d. ; relevé de plus de ${CABLES_WATCH_STALE_MIN} min : n.d.`, () => {
    expect(cablesLevel(watch({ readAt: null, aisLastMessageAt: null, evaluated: false }), NOW)).toEqual({ level: 'nd', reason: 'relais AIS jamais lu' });
    expect(cablesLevel(watch({ readAt: '2026-10-04T14:33:29.000Z' }), NOW)).toEqual({ level: 'nd', reason: 'non évalué · veille des câbles non relevée depuis 16:33' });
    expect(cablesLevel(watch({ readAt: '2026-10-04T14:33:30.000Z' }), NOW).level).toBe('vert');
  });
});

// ─── Vigilance cyber ───

/** Alerte en cours par défaut, page lue sans phrase d'exploitation ; un avis n'a pas de statut. */
function item(over: Partial<CertFrItem> & Pick<CertFrItem, 'ref' | 'firstVersion'>): CertFrItem {
  const kind = over.kind ?? 'alerte';
  return {
    kind, title: 'Vulnérabilité', product: null, updatedMark: false, url: `https://www.cert.ssi.gouv.fr/${kind}/${over.ref}/`,
    lastVersion: null, cves: [], kevCves: [], pageReadAt: '2026-10-04T14:00:00.000Z',
    status: kind === 'alerte' ? 'en-cours' : null, closedAt: null, exploited: false, exploitedQuote: null, ...over,
  };
}
const ALE_011 = item({
  ref: 'CERTFR-2026-ALE-011', title: 'Multiples vulnérabilités dans Citrix NetScaler ADC et Gateway', product: 'Citrix NetScaler ADC et Gateway',
  firstVersion: '2026-09-28', lastVersion: '2026-09-30', cves: ['CVE-2026-88771', 'CVE-2026-88772'], kevCves: ['CVE-2026-88771', 'CVE-2026-88772'],
  exploited: true, exploitedQuote: 'Ces vulnérabilités sont activement exploitées.',
});
const ALE_010 = item({ ref: 'CERTFR-2026-ALE-010', title: 'Vulnérabilité dans Metabase', product: 'Metabase', firstVersion: '2026-09-10' });
const ALE_009 = item({
  ref: 'CERTFR-2026-ALE-009', firstVersion: '2026-09-02', cves: ['CVE-2026-83548'], kevCves: ['CVE-2026-83548'],
  exploited: true, exploitedQuote: 'L’éditeur indique que ces deux vulnérabilités sont activement exploitées.',
});
/** Publiée le 22/07, close le 22/09 : sa dernière version a 12 jours, elle ne colore rien (O1). */
const ALE_008 = item({ ref: 'CERTFR-2026-ALE-008', firstVersion: '2026-07-22', lastVersion: '2026-09-22', status: 'cloturee', closedAt: '2026-09-22' });
const AVI_1257 = item({
  ref: 'CERTFR-2026-AVI-1257', kind: 'avis', title: 'Vulnérabilité dans Fortinet FortiMail', product: 'Fortinet FortiMail',
  firstVersion: '2026-10-02', lastVersion: '2026-10-02', cves: ['CVE-2026-104286'], kevCves: ['CVE-2026-104286'], exploited: null,
});
const ALE_012 = item({ ref: 'CERTFR-2026-ALE-012', firstVersion: '2026-10-03', cves: ['CVE-2026-104286'], kevCves: ['CVE-2026-104286'] });
function ransom(ratio: number | null): RansomwareSummary {
  return {
    lastModified: '2026-10-04T14:30:09.000Z', checkedAt: '2026-10-04T14:48:30.000Z', weeks: [], weekCount: 7,
    baselineWeekly: ratio === null ? null : 5.44, ratio, last30: 25, baseline30: 20.67, sectors30: [], groups30: [],
  };
}
function cyber(alerts: CertFrItem[], avis: CertFrItem[] = [], ratio: number | null = 1.29, readAt: string | null = '2026-10-04T14:00:00.000Z'): CyberResponse {
  return {
    readAt, certfr: { readAt, alerts, avis, reports: [] },
    kev: { readAt: '2026-10-04T12:00:00.000Z', catalogVersion: '2026.10.02', dateReleased: '2026-10-02T15:19:38.2945Z', count: 1733, recent: [], weeks: [] },
    ransomware: ransom(ratio), hibp: { readAt: '2026-10-04T12:00:00.000Z', count: 0, newestAddedDate: null, url: 'https://haveibeenpwned.com/PwnedWebsites' },
    cybermalveillance: null, errors: [],
  };
}

describe('certfrDate, certfrAgeDays et certfrPublishedAgeDays (jours de Paris révolus)', () => {
  it('dernière version d’abord, sinon première ; ALE-011 a 4 jours le 04/10 par sa dernière version, 6 par sa publication', () => {
    expect([certfrDate(ALE_011), certfrDate(ALE_010)]).toEqual(['2026-09-30', '2026-09-10']);
    expect([certfrAgeDays(ALE_011, NOW), certfrAgeDays(ALE_010, NOW), certfrAgeDays(AVI_1257, NOW)]).toEqual([4, 24, 2]);
    expect([certfrPublishedAgeDays(ALE_011, NOW), certfrPublishedAgeDays(ALE_008, NOW), certfrAgeDays(ALE_008, NOW)]).toEqual([6, 74, 12]);
  });
  it('le jour change à minuit de Paris, pas à minuit UTC', () => {
    expect(certfrAgeDays(ALE_011, T('2026-10-04T23:30:00+02:00'))).toBe(4);
    expect(certfrAgeDays(ALE_011, T('2026-10-05T00:30:00+02:00'))).toBe(5);
    expect(certfrPublishedAgeDays(ALE_011, T('2026-10-05T00:30:00+02:00'))).toBe(7);
  });
  it('rapport des revendications : celui du résumé, null sans résumé ni moyenne', () => {
    expect([claimsRatio(ransom(1.29)), claimsRatio(ransom(null)), claimsRatio(null)]).toEqual([1.29, null, null]);
  });
});

describe('statut officiel et exploitation (O1, O3)', () => {
  it('seule une alerte au statut « en cours » lu du CERT-FR est en cours : jamais une alerte close, un avis ni un statut non lu', () => {
    expect([ALE_011, ALE_008, AVI_1257, { ...ALE_012, status: null }].map(isCertFrAlertOpen)).toEqual([true, false, false, false]);
  });
  it('« exploitation signalée par le CERT-FR » quand le texte le dit ; sinon le catalogue KEV ; jamais « pas d’exploitation connue »', () => {
    expect(certfrExploitationText(ALE_011)).toBe('exploitation signalée par le CERT-FR');
    expect(certfrExploitationText(ALE_012)).toBe('vulnérabilité exploitée CVE-2026-104286 (catalogue KEV de la CISA)');
    expect(certfrExploitationText(ALE_010)).toBe('non inscrite au catalogue KEV');
    expect(certfrExploitationText({ ...ALE_010, exploited: null })).toBeNull();
  });
});

describe('cyberLevel (pastille Vigilance cyber, § 2.3 ; amendement 7, O2 et O4)', () => {
  const ALL = [ALE_011, ALE_010, ALE_009, ALE_008];
  it('04/10 : ALE-011 en cours, publiée le 28/09 (moins de 7 jours) : orange, exploitation signalée par le CERT-FR', () => {
    expect(cyberLevel(cyber(ALL, [AVI_1257]), NOW)).toEqual({
      level: 'orange', reason: 'CERTFR-2026-ALE-011 en cours, publiée le 28/09 : exploitation signalée par le CERT-FR',
    });
  });
  it('05/10 : ALE-011 publiée depuis 7 jours, trois alertes en cours : jaune, la plus récente nommée', () => {
    expect(cyberLevel(cyber(ALL, [AVI_1257], 1.29, '2026-10-04T22:00:00.000Z'), T('2026-10-05T00:30:00+02:00'))).toEqual({
      level: 'jaune', reason: '3 alertes CERT-FR en cours, la plus récente publiée le 28/09 : CERTFR-2026-ALE-011, CERTFR-2026-ALE-010, CERTFR-2026-ALE-009',
    });
  });
  it('l’ordre de la liste ne change rien : la plus récente par sa publication', () => {
    expect(cyberLevel(cyber([...ALL].reverse(), [AVI_1257]), NOW).reason).toBe('CERTFR-2026-ALE-011 en cours, publiée le 28/09 : exploitation signalée par le CERT-FR');
  });
  it('rouge : deux alertes en cours publiées depuis moins de 7 jours', () => {
    expect(cyberLevel(cyber([ALE_011, ALE_012]), NOW)).toEqual({
      level: 'rouge', reason: `2 alertes CERT-FR en cours publiées depuis moins de 7${NBSP}jours : CERTFR-2026-ALE-012, CERTFR-2026-ALE-011`,
    });
  });
  it('deux alertes récentes dont une close : orange, jamais rouge ; une alerte close récemment mise à jour ne colore rien', () => {
    const closed012 = { ...ALE_012, status: 'cloturee' as const, closedAt: '2026-10-04' };
    expect(cyberLevel(cyber([closed012, ALE_011]), NOW).level).toBe('orange');
    expect(cyberLevel(cyber([ALE_008]), NOW)).toEqual({ level: 'vert', reason: 'aucune alerte CERT-FR en cours ni vulnérabilité exploitée citée par un avis de moins de 7\u00a0jours' });
  });
  it('alerte récente sans phrase d’exploitation : le catalogue KEV, sinon « non inscrite au catalogue KEV »', () => {
    expect(cyberLevel(cyber([ALE_012]), NOW).reason).toBe('CERTFR-2026-ALE-012 en cours, publiée le 03/10 : vulnérabilité exploitée CVE-2026-104286 (catalogue KEV de la CISA)');
    expect(cyberLevel(cyber([{ ...ALE_012, kevCves: [] }]), NOW).reason).toBe('CERTFR-2026-ALE-012 en cours, publiée le 03/10 : non inscrite au catalogue KEV');
    expect(cyberLevel(cyber([{ ...ALE_012, kevCves: [], exploited: null }]), NOW).reason).toBe('CERTFR-2026-ALE-012 en cours, publiée le 03/10');
  });
  it('jaune : une alerte en cours publiée depuis 7 jours ou plus ; avis de moins de 7 jours citant une vulnérabilité KEV', () => {
    expect(cyberLevel(cyber([ALE_010]), NOW)).toEqual({ level: 'jaune', reason: 'CERTFR-2026-ALE-010 en cours, publiée le 10/09' });
    expect(cyberLevel(cyber([ALE_008], [AVI_1257]), NOW)).toEqual({
      level: 'jaune', reason: 'CERTFR-2026-AVI-1257 : avis citant la vulnérabilité exploitée CVE-2026-104286 (catalogue KEV de la CISA)',
    });
  });
  it('revendications : jaune au plus (O4), même à 3,2 fois la moyenne ; 1,5 exactement : rien', () => {
    expect(cyberLevel(cyber([], [], 3.2), NOW)).toEqual({ level: 'jaune', reason: 'hausse des revendications, non confirmées : 3,2 fois la moyenne' });
    expect(cyberLevel(cyber([], [], 1.6), NOW)).toEqual({ level: 'jaune', reason: 'hausse des revendications, non confirmées : 1,6 fois la moyenne' });
    expect(cyberLevel(cyber([], [], 1.5), NOW).level).toBe('vert');
    expect(cyberLevel(cyber([ALE_011, ALE_012], [], 3.2), NOW).level).toBe('rouge');
  });
  it('vert : alertes closes, avis ancien, rapport 1,29', () => {
    const oldAvis = { ...AVI_1257, firstVersion: '2026-09-23', lastVersion: '2026-09-23' };
    expect(cyberLevel(cyber([ALE_008], [oldAvis]), NOW)).toEqual({
      level: 'vert', reason: 'aucune alerte CERT-FR en cours ni vulnérabilité exploitée citée par un avis de moins de 7\u00a0jours',
    });
  });
  it('alerte de moins de 7 jours au statut non lu : n.d. si rien ne colore déjà en orange, jamais « en cours » supposé ni vert', () => {
    const unread = { ...ALE_012, status: null };
    expect(cyberLevel(cyber([unread, ALE_010]), NOW)).toEqual({ level: 'nd', reason: 'non évalué · statut de CERTFR-2026-ALE-012 non lu' });
    expect(cyberLevel(cyber([unread, ALE_011]), NOW).level).toBe('orange');
    expect(cyberLevel(cyber([{ ...ALE_010, status: null }]), NOW).level).toBe('vert');
  });
  it('CERT-FR jamais lu ou relu il y a plus de 6 h : n.d., même avec des revendications fortes', () => {
    expect(cyberLevel(cyber([ALE_011], [], 3.5, null), NOW)).toEqual({ level: 'nd', reason: 'CERT-FR indisponible' });
    expect(cyberLevel(cyber([ALE_011], [], 3.5, '2026-10-04T08:48:29.000Z'), NOW)).toEqual({ level: 'nd', reason: 'non évalué · CERT-FR non relu depuis 10:48' });
  });
});
