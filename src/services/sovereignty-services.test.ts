// src/services/sovereignty-services.test.ts : lecture client de la Souveraineté (spec 2026-10-04 souveraineté S1 à S4, V1 ; contrats
// § 3.2, § 3.3 ; amendement 7, O5, O14) sur les réponses construites par le serveur le 04/10 (sovereignty.fixture.ts) : formes
// exactes vérifiées élément par élément et nommées, réponse 502 de même forme nommée par ses erreurs, lignes du panneau des sources
// datées par la donnée, mentions de la ligne Vigipirate.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CABLES_FILE_FIXTURE, CABLES_WATCH_ALERTS_FIXTURE, CABLES_WATCH_FIXTURE, CABLES_WATCH_FROZEN_FIXTURE, CABLES_WATCH_ZONE_MUTED_FIXTURE,
  CYBER_FIXTURE, MILITARY_EMERGENCY_FIXTURE, MILITARY_FIXTURE, MILITARY_FRENCH_EMERGENCY_FIXTURE, SOV_FIXTURE_NOW, VIGIPIRATE_CHECK_CHANGED_FIXTURE,
  VIGIPIRATE_CHECK_FIXTURE, VIGIPIRATE_FIXTURE,
} from '../components/layer-panel/sovereignty.fixture.ts';
import type { MilitaryResponse, VigipiratePageCheck } from '../types/index.ts';
import { resetTrafficSourceCache } from './traffic-source.ts';
import {
  CERTFR_PAGES_NOTE, CYBER_PENDING_NOTE, GELS_PENDING_NOTE, GNSS_CONSTRUCTION_NOTE, MILITARY_PENDING_NOTE, RIPE_PENDING_NOTE,
  SOVEREIGNTY_PROGRESS_NOTES, describeProblems,
  isSovereigntyProgressNote, resetSovereigntySourceCache, sovereigntySlotStatus,
} from './sovereignty-source.ts';
import {
  DEFENSE_OSM_URL, MILITARY_TTL_MS, MILITARY_URL, fetchDefenseOsmWorks, fetchMilitary, isDefenseOsmWorksFile, isMilitaryResponse, mergeMilitary,
  militaryResponseProblems, militaryStatus, resetDefenseOsmWorksCache,
} from './sovereignty-military.ts';
import {
  CABLES_FILE_URL, CABLES_WATCH_TTL_MS, CABLES_WATCH_URL, cablesStatus, cablesWatchProblems, fetchCables, isCablesWatchResponse,
  isSubseaCablesFile, mergeCables,
} from './sovereignty-cables.ts';
import {
  CYBER_TTL_MS, CYBER_URL, RANSOMWARE_UNDATED_NOTE, cyberResponseProblems, cyberStatus, fetchCyber, isCyberResponse, mergeCyber,
} from './sovereignty-cyber.ts';
import {
  VIGIPIRATE_CHECK_LATE_AFTER_H, VIGIPIRATE_CHECK_URL, fetchVigipirateCheck, isVigipiratePageCheck, mergeVigipirateCheck, vigipirateAlertEndPassed,
  vigipirateCheckStatus, vigipirateNotices,
} from './sovereignty-vigipirate.ts';

const NOW = SOV_FIXTURE_NOW;
const MIN = 60_000;
const HOUR = 60 * MIN;

type Reply = { status: number; body?: unknown; html?: boolean };
function stubFetch(bodies: Record<string, unknown>, over: Record<string, Reply> = {}) {
  const f = vi.fn(async (url: string) => {
    const o = over[url];
    if (o?.html) return { ok: o.status >= 200 && o.status < 300, status: o.status, json: async () => { throw new SyntaxError('Unexpected token <'); } };
    if (o) return { ok: o.status >= 200 && o.status < 300, status: o.status, json: async () => o.body ?? {} };
    if (!(url in bodies)) throw new Error(`URL inattendue ${url}`);
    return { ok: true, status: 200, json: async () => bodies[url] };
  });
  vi.stubGlobal('fetch', f);
  return f;
}

/** Corps 502 du serveur : aucune donnée lue, pannes nommées. */
const MILITARY_502 = (errors: string[]): MilitaryResponse => ({
  readAt: null, sourceNow: null, frenchByDept: [], aircraft: [], abroadCount: 0, abroad: [], emergencies: [], emergencyLog: [],
  hourly: { hours: [], since: null }, errors,
});

const WORKS = {
  generatedAt: '2026-10-04T15:51:29.478Z', osmBase: '2026-10-04T15:48:05Z', licence: 'ODbL 1.0', source: "© les contributeurs d'OpenStreetMap",
  items: [{ id: 'way/22761044', name: 'Base aérienne 105 Évreux-Fauville', kind: 'airfield', type: 'air', lat: 49.03051, lon: 1.21751, dept: '27' }],
};

const field = (v: unknown): Record<string, unknown> => v as Record<string, unknown>;

afterEach(() => { vi.unstubAllGlobals(); resetTrafficSourceCache(); resetSovereigntySourceCache(); resetDefenseOsmWorksCache(); });

describe('socle : statut daté par la donnée, notes d’avancement, filtre par source', () => {
  const slot = (errors: string[]) => ({ data: { errors }, error: null, fetchedAt: NOW });
  it('date de la donnée (jamais l’heure de lecture), « (en retard) » selon S2', () => {
    expect(sovereigntySlotStatus(slot([]), 'adsb-mil', '2026-10-04T14:48:30.000Z', NOW))
      .toEqual({ status: 'ok', lastUpdate: new Date('2026-10-04T14:48:30.000Z'), error: undefined, period: '16:48' });
    expect(sovereigntySlotStatus(slot([]), 'adsb-mil', '2026-10-04T14:38:29.000Z', NOW)).toMatchObject({ status: 'stale', period: '16:38 (en retard)' });
  });
  it('chargement, panne sans donnée, date de la source absente (jamais lue)', () => {
    expect(sovereigntySlotStatus({ data: null, error: null, fetchedAt: null }, 'certfr', null, NOW).status).toBe('loading');
    expect(sovereigntySlotStatus({ data: null, error: 'HTTP 502', fetchedAt: null }, 'certfr', null, NOW)).toEqual({ status: 'error', lastUpdate: null, error: 'HTTP 502', period: undefined });
    expect(sovereigntySlotStatus(slot(['HIBP : HTTP 403']), 'hibp', null, NOW, 'HIBP')).toEqual({ status: 'error', lastUpdate: null, error: 'HIBP : HTTP 403', period: 'n.d.' });
  });
  it('notes d’avancement : statut ok, note jointe à la période ; une panne reste dégradée ; une note seule sans donnée : chargement', () => {
    expect(SOVEREIGNTY_PROGRESS_NOTES).toEqual([
      MILITARY_PENDING_NOTE, CERTFR_PAGES_NOTE, CYBER_PENDING_NOTE, GNSS_CONSTRUCTION_NOTE, RIPE_PENDING_NOTE, GELS_PENDING_NOTE,
    ]);
    expect(isSovereigntyProgressNote('CERT-FR, avis : HTTP 503')).toBe(false);
    expect(sovereigntySlotStatus(slot([CERTFR_PAGES_NOTE]), 'certfr', '2026-10-04T14:48:30.000Z', NOW, 'CERT-FR'))
      .toMatchObject({ status: 'ok', error: undefined, period: `16:48 · ${CERTFR_PAGES_NOTE}` });
    expect(sovereigntySlotStatus({ data: null, error: MILITARY_PENDING_NOTE, fetchedAt: null }, 'adsb-mil', null, NOW))
      .toEqual({ status: 'loading', lastUpdate: null, error: undefined, period: `n.d. · ${MILITARY_PENDING_NOTE}` });
  });
  it('filtre par source : la ligne CERT-FR ne prend que les erreurs du CERT-FR ; avec les sources de la réponse, une erreur qui n’en nomme aucune vaut pour chaque ligne', () => {
    const errors = ['CERT-FR, avis : HTTP 503', 'CISA KEV : HTTP 503', 'HIBP : HTTP 403', 'Collecte cyber interrompue : délai dépassé'];
    expect(sovereigntySlotStatus(slot(errors), 'certfr', '2026-10-04T14:48:30.000Z', NOW, 'CERT-FR').error).toBe('CERT-FR, avis : HTTP 503');
    expect(sovereigntySlotStatus(slot(errors), 'kev', '2026-10-04T14:48:30.000Z', NOW, 'CISA KEV').error).toBe('CISA KEV : HTTP 503');
    expect(sovereigntySlotStatus(slot(errors), 'kev', '2026-10-04T14:48:30.000Z', NOW, 'CISA KEV', { parts: ['CERT-FR', 'CISA KEV', 'HIBP'] }).error)
      .toBe('CISA KEV : HTTP 503 ; Collecte cyber interrompue : délai dépassé');
    // Panne de lecture (502 nommé) : retirée d'une ligne seulement si elle nomme une autre source.
    const failed = { data: null, error: 'CERT-FR, alertes : HTTP 503 ; HIBP : HTTP 503 ; HTTP 502', fetchedAt: null };
    expect(sovereigntySlotStatus(failed, 'hibp', null, NOW, 'HIBP', { parts: ['CERT-FR', 'HIBP'] }).error).toBe('HIBP : HTTP 503 ; HTTP 502');
  });
  it('écarts nommés : au plus cinq, puis leur nombre', () => {
    expect(describeProblems(['a', 'b'])).toBe('a, b');
    expect(describeProblems(['a', 'b', 'c', 'd', 'e', 'f', 'g'])).toBe('a, b, c, d, e et 2\u00a0autres');
  });
});

describe('Défense', () => {
  it('gardes : relevé du 04/10, urgences d’appareils étrangers et français acceptés', () => {
    expect([MILITARY_FIXTURE(), MILITARY_EMERGENCY_FIXTURE(), MILITARY_FRENCH_EMERGENCY_FIXTURE()].map(isMilitaryResponse)).toEqual([true, true, true]);
  });
  it('forme exacte (décision du 08/10/2026) : identité complète exigée pour chaque appareil et chaque urgence, champ manquant, en trop ou inconnu : réponse refusée, élément nommé', () => {
    const registration = MILITARY_FIXTURE();
    delete field(registration.aircraft[0]).registration;
    expect(militaryResponseProblems(registration)).toEqual(['aircraft[0].registration (absent)']);
    const family = MILITARY_FIXTURE();
    field(family.aircraft[2]).family = 'inconnue';
    expect(militaryResponseProblems(family)).toEqual(['aircraft[2].family']);
    const abroadFamily = MILITARY_FIXTURE();
    delete field(abroadFamily.abroad[1]).family;
    expect(militaryResponseProblems(abroadFamily)).toEqual(['abroad[1].family (absent)']);
    const extra = MILITARY_FIXTURE();
    field(extra.aircraft[1]).masked = true;
    expect(militaryResponseProblems(extra)).toEqual(['aircraft[1].masked (en trop)']);
    const located = MILITARY_FRENCH_EMERGENCY_FIXTURE();
    delete field(located.emergencies[1]).lat;
    delete field(located.emergencies[1]).callsign;
    expect(militaryResponseProblems(located)).toEqual(['emergencies[1].callsign (absent)', 'emergencies[1].lat (absent)']);
    const squawk = MILITARY_EMERGENCY_FIXTURE();
    field(squawk.emergencies[0]).squawk = '1200';
    expect(militaryResponseProblems(squawk)).toEqual(['emergencies[0].squawk']);
    const french = MILITARY_EMERGENCY_FIXTURE();
    field(french.emergencyLog[1]).family = 'francais';
    expect(isMilitaryResponse(french)).toBe(true);
    const missing = MILITARY_FIXTURE();
    delete field(missing).aircraft;
    expect([isMilitaryResponse(missing), militaryResponseProblems(missing)]).toEqual([false, ['aircraft (absent)']]);
    const old = MILITARY_FIXTURE();
    Object.assign(field(old), { others: [], maskedOthers: 0 });
    expect(militaryResponseProblems(old)).toEqual(['others (en trop)', 'maskedOthers (en trop)']);
  });
  it('décision du 08/10/2026 : appareils français (pays « France », bloc 380000 à 3BFFFF), à adresse non OACI ou marqués PIA montrés dans `aircraft`, `abroad` et les urgences, réponse acceptée', () => {
    const french = MILITARY_FIXTURE();
    expect(french.aircraft.filter((a) => a.family === 'francais').map((a) => [a.hex, a.callsign, a.country])).toEqual([
      ['3bf001', 'FICTIF01', 'France'], ['3bf002', 'FICTIF02', 'France'], ['3bf003', 'FICTIF03', 'France'], ['3bf004', 'FICTIF04', 'France'],
    ]);
    expect(isMilitaryResponse(french)).toBe(true);
    const byCountry = MILITARY_FIXTURE();
    Object.assign(field(byCountry.aircraft[5]), { country: 'France', family: 'francais' });
    expect(isMilitaryResponse(byCountry)).toBe(true);
    const unknown = MILITARY_FIXTURE();
    Object.assign(field(unknown.aircraft[8]), { hex: '~4b0def', country: null });
    expect(isMilitaryResponse(unknown)).toBe(true);
    const abroad = MILITARY_FIXTURE();
    Object.assign(field(abroad.abroad[1]), { hex: '3a0001', country: 'France', family: 'francais', registration: 'F-ZFIC' });
    expect(isMilitaryResponse(abroad)).toBe(true);
    const abroadUnknown = MILITARY_FIXTURE();
    Object.assign(field(abroadUnknown.abroad[2]), { hex: '~4b0def', country: null });
    expect(isMilitaryResponse(abroadUnknown)).toBe(true);
    const emergency = MILITARY_FRENCH_EMERGENCY_FIXTURE();
    expect(emergency.emergencies.map((e) => [e.icao24, e.callsign, e.registration, e.squawk, e.family, e.dept])).toEqual([
      ['44f684', 'GRZLY21', null, '7500', 'autres', '64'],
      ['3bf004', 'FICTIF04', 'F-ZFIC', '7700', 'francais', '69'],
    ]);
    expect(isMilitaryResponse(emergency)).toBe(true);
  });
  it('lecture sous le cache de 100 s, jamais de rejet ; échec : données gardées, panne portée', async () => {
    const f = stubFetch({ [MILITARY_URL]: MILITARY_FIXTURE() });
    const first = await fetchMilitary(null, NOW);
    await fetchMilitary(first, NOW + MILITARY_TTL_MS - 1);
    expect(f).toHaveBeenCalledTimes(1);
    stubFetch({}, { [MILITARY_URL]: { status: 502, body: { readAt: null } } });
    const failed = await fetchMilitary(first, NOW + MILITARY_TTL_MS);
    expect([failed.military.error, failed.military.data?.aircraft.length]).toEqual(['HTTP 502', 9]);
    expect(mergeMilitary(first, failed).military.data?.readAt).toBe('2026-10-04T14:48:30.000Z');
  });
  it('502 de même forme : la panne est nommée par le serveur ; note d’avancement seule : chargement, jamais une panne', async () => {
    stubFetch({}, { [MILITARY_URL]: { status: 502, body: MILITARY_502(['adsb.lol : HTTP 429, nouvelle tentative après 16:58']) } });
    const limited = await fetchMilitary(null, NOW);
    expect(militaryStatus(limited, NOW)).toEqual({ status: 'error', lastUpdate: null, error: 'adsb.lol : HTTP 429, nouvelle tentative après 16:58', period: undefined });
    stubFetch({}, { [MILITARY_URL]: { status: 502, body: MILITARY_502([MILITARY_PENDING_NOTE]) } });
    expect(militaryStatus(await fetchMilitary(null, NOW), NOW)).toMatchObject({ status: 'loading', period: `n.d. · ${MILITARY_PENDING_NOTE}` });
  });
  it('réponse 200 mal formée : panne nommée par ses éléments, rien n’est gardé d’elle ; page HTML : « réponse illisible »', async () => {
    const bad = MILITARY_FIXTURE();
    field(bad.aircraft[1]).registration = 130615;
    stubFetch({ [MILITARY_URL]: bad });
    const read = await fetchMilitary(null, NOW);
    expect([read.military.data, read.military.error]).toEqual([null, 'réponse des vols militaires mal formée : aircraft[1].registration']);
    stubFetch({}, { [MILITARY_URL]: { status: 200, html: true } });
    expect((await fetchMilitary(null, NOW)).military.error).toBe('réponse illisible');
  });
  it('lectures concurrentes : une seule requête', async () => {
    const f = stubFetch({ [MILITARY_URL]: MILITARY_FIXTURE() });
    await Promise.all([fetchMilitary(null, NOW), fetchMilitary(null, NOW)]);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('« Vols militaires » daté par le relevé adsb.lol ; en retard au-delà de 10 min', () => {
    const state = { military: { data: MILITARY_FIXTURE(), error: null, fetchedAt: NOW } };
    expect(militaryStatus(state, NOW)).toMatchObject({ status: 'ok', period: '16:48' });
    expect(militaryStatus(state, NOW + 10 * MIN + 1000)).toMatchObject({ status: 'stale', period: '16:48 (en retard)' });
  });
  it('ouvrages OpenStreetMap : fichier daté lu une fois par session ; échec retenté, jamais de rejet', async () => {
    expect(isDefenseOsmWorksFile(WORKS)).toBe(true);
    expect(isDefenseOsmWorksFile({ ...WORKS, licence: 'CC BY' })).toBe(false);
    expect(isDefenseOsmWorksFile({ ...WORKS, items: [{ ...WORKS.items[0], description: 'escadron' }] })).toBe(false);
    stubFetch({}, { [DEFENSE_OSM_URL]: { status: 404 } });
    expect(await fetchDefenseOsmWorks()).toEqual({ data: null, error: 'HTTP 404' });
    const f = stubFetch({ [DEFENSE_OSM_URL]: WORKS });
    expect((await fetchDefenseOsmWorks()).data?.items).toHaveLength(1);
    await fetchDefenseOsmWorks();
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('Connectivité', () => {
  it('gardes : fichier des câbles (Shom et OpenStreetMap) et relevés (à jour, alertes, AIS muet, zone muette) acceptés', () => {
    expect(isSubseaCablesFile(CABLES_FILE_FIXTURE())).toBe(true);
    expect([CABLES_WATCH_FIXTURE(), CABLES_WATCH_ALERTS_FIXTURE(), CABLES_WATCH_FROZEN_FIXTURE(), CABLES_WATCH_ZONE_MUTED_FIXTURE()].every(isCablesWatchResponse)).toBe(true);
    expect(isCablesWatchResponse({ ...CABLES_WATCH_FROZEN_FIXTURE(), cablesFile: null })).toBe(true);
  });
  it('éléments faux nommés : vitesse absente, compte de navires publié sans évaluation, licence d’un câble qui n’est pas celle de sa source', () => {
    const speed = CABLES_WATCH_ALERTS_FIXTURE();
    field(speed.alerts[0]).speedKn = null;
    expect(cablesWatchProblems(speed)).toEqual(['alerts[0].speedKn']);
    expect(cablesWatchProblems({ ...CABLES_WATCH_FROZEN_FIXTURE(), slowVessels: 3 }))
      .toEqual(['réponse (slowVessels nul si et seulement si la veille n’est pas évaluée)']);
    const file = CABLES_FILE_FIXTURE();
    const shom = file.cables.findIndex((c) => c.source === 'Shom');
    field(file.cables[shom]).licence = 'ODbL 1.0';
    expect(isSubseaCablesFile(file)).toBe(false);
    const oos = CABLES_FILE_FIXTURE();
    delete field(oos.cables[0]).outOfService;
    expect(isSubseaCablesFile(oos)).toBe(false);
  });
  it('fichier lu une fois ; veille sous son cache de 4 min ; échec du fichier nommé, veille servie', async () => {
    const cables = CABLES_FILE_FIXTURE().cables.length;
    const f = stubFetch({ [CABLES_WATCH_URL]: CABLES_WATCH_FIXTURE(), [CABLES_FILE_URL]: CABLES_FILE_FIXTURE() });
    const first = await fetchCables(null, NOW);
    expect([first.file?.cables.length, first.fileError, first.watch.data?.evaluated]).toEqual([cables, null, true]);
    await fetchCables(first, NOW + CABLES_WATCH_TTL_MS);
    expect(f.mock.calls.map(([u]) => u)).toEqual([CABLES_WATCH_URL, CABLES_FILE_URL, CABLES_WATCH_URL]);
    resetSovereigntySourceCache();
    stubFetch({ [CABLES_WATCH_URL]: CABLES_WATCH_FIXTURE() }, { [CABLES_FILE_URL]: { status: 404 } });
    const noFile = await fetchCables(null, NOW);
    expect([noFile.file, noFile.fileError, noFile.watch.error]).toEqual([null, 'HTTP 404', null]);
    expect(mergeCables(first, noFile).file?.cables).toHaveLength(cables);
  });
  it('« Câbles et AIS » daté par le dernier message AIS ; AIS muet depuis moins de 15 min (amendement 5) : panne du relais nommée, ligne dégradée sans « (en retard) »', () => {
    const at = (data: ReturnType<typeof CABLES_WATCH_FIXTURE>) => cablesStatus({ watch: { data, error: null, fetchedAt: NOW }, file: null, fileError: null }, NOW);
    expect(at(CABLES_WATCH_FIXTURE())).toMatchObject({ status: 'ok', period: '16:46' });
    const frozen = at(CABLES_WATCH_FROZEN_FIXTURE());
    expect([frozen.status, frozen.period]).toEqual(['stale', '16:41']);
    expect(frozen.error).toContain('flux AIS interrompu');
    expect(at(CABLES_WATCH_ZONE_MUTED_FIXTURE())).toMatchObject({ status: 'stale', period: '16:46', error: expect.stringContaining('flux AIS partiel') });
  });
  it('« Câbles et AIS » en retard au-delà de 15 min après le dernier message AIS (amendement 5), pas avant', () => {
    const state = { watch: { data: CABLES_WATCH_FIXTURE(), error: null, fetchedAt: NOW }, file: null, fileError: null };
    const last = Date.parse('2026-10-04T14:46:58.000Z');
    expect(cablesStatus(state, last + 15 * MIN)).toMatchObject({ status: 'ok', period: '16:46' });
    expect(cablesStatus(state, last + 15 * MIN + 1000)).toMatchObject({ status: 'stale', period: '16:46 (en retard)' });
  });
});

describe('Vigilance cyber', () => {
  it('garde : réponse du 04/10 acceptée ; parties absentes (null) acceptées ; éléments faux refusés et nommés par leur référence', () => {
    expect(isCyberResponse(CYBER_FIXTURE())).toBe(true);
    expect(isCyberResponse({ ...CYBER_FIXTURE(), ransomware: null, hibp: null, cybermalveillance: null })).toBe(true);
    const kind = CYBER_FIXTURE();
    field(kind.certfr.alerts[0]).kind = 'note';
    expect(cyberResponseProblems(kind)).toEqual(['certfr.alerts[CERTFR-2026-ALE-011].kind']);
    const avisStatus = CYBER_FIXTURE();
    field(avisStatus.certfr.avis[0]).status = 'en-cours';
    expect(cyberResponseProblems(avisStatus)).toEqual(['certfr.avis[CERTFR-2026-AVI-1257] (avis sans statut attendu)']);
    const status = CYBER_FIXTURE();
    field(status.certfr.alerts[1]).status = 'ouverte';
    expect(cyberResponseProblems(status)).toEqual(['certfr.alerts[CERTFR-2026-ALE-008].status']);
  });
  it('O5 : un compte et un lien pour HIBP ; un titre ou un domaine de fuite refuse la réponse', () => {
    const hibp = CYBER_FIXTURE();
    Object.assign(field(hibp.hibp), { titles: ['Fuite'], domain: 'exemple.fr' });
    expect(cyberResponseProblems(hibp)).toEqual(['hibp.titles (en trop)', 'hibp.domain (en trop)']);
  });
  it('lecture sous le cache de 10 min ; échec : données gardées', async () => {
    const f = stubFetch({ [CYBER_URL]: CYBER_FIXTURE() });
    const first = await fetchCyber(null, NOW);
    await fetchCyber(first, NOW + CYBER_TTL_MS - 1);
    expect(f).toHaveBeenCalledTimes(1);
    stubFetch({}, { [CYBER_URL]: { status: 500, html: true } });
    const failed = await fetchCyber(first, NOW + CYBER_TTL_MS);
    expect(failed.cyber.error).toBe('HTTP 500');
    expect(mergeCyber(first, failed).cyber.data?.certfr.alerts).toHaveLength(6);
  });
  it('cinq lignes, chacune datée par sa donnée et ne portant que ses erreurs', () => {
    const data = { ...CYBER_FIXTURE(), errors: ['CERT-FR, avis : HTTP 503', 'HIBP : HTTP 403'] };
    const state = { cyber: { data, error: null, fetchedAt: NOW } };
    expect(cyberStatus(state, 'certfr', NOW)).toMatchObject({ status: 'stale', period: '16:48', error: 'CERT-FR, avis : HTTP 503' });
    expect(cyberStatus(state, 'kev', NOW)).toMatchObject({ status: 'ok', period: '16:48', error: undefined });
    expect(cyberStatus(state, 'ransomware', NOW)).toMatchObject({ status: 'ok', period: '16:30' });
    expect(cyberStatus(state, 'hibp', NOW)).toMatchObject({ status: 'stale', error: 'HIBP : HTTP 403' });
    expect(cyberStatus(state, 'cybermalveillance', NOW)).toMatchObject({ status: 'ok', period: '16:48' });
    expect(cyberStatus(state, 'ransomware', NOW + 24 * HOUR)).toMatchObject({ status: 'stale', period: '04/10 16:30 (en retard)' });
    expect(cyberStatus(state, 'cybermalveillance', NOW + 6 * HOUR + MIN)).toMatchObject({ status: 'stale', period: '16:48 (en retard)' });
  });
  it('retards des lignes (S2), de part et d’autre de chaque limite : CERT-FR 6 h, CISA KEV 26 h, HIBP 26 h', () => {
    const state = { cyber: { data: CYBER_FIXTURE(), error: null, fetchedAt: NOW } };
    const read = Date.parse('2026-10-04T14:48:30.000Z');
    for (const [part, hours] of [['certfr', 6], ['kev', 26], ['hibp', 26]] as const) {
      expect([part, cyberStatus(state, part, read + hours * HOUR).status]).toEqual([part, 'ok']);
      expect([part, cyberStatus(state, part, read + hours * HOUR + 1000)]).toEqual([part, expect.objectContaining({ status: 'stale', period: expect.stringMatching(/16:48 \(en retard\)$/) })]);
    }
  });
  it('Ransomware.live sans date de modification publiée : datée par le relevé du serveur et dite, jamais « source jamais lue »', () => {
    const data = CYBER_FIXTURE();
    if (data.ransomware === null) throw new Error('jeu d’essai sans revendications');
    data.ransomware = { ...data.ransomware, lastModified: null };
    const state = { cyber: { data, error: null, fetchedAt: NOW } };
    expect(cyberStatus(state, 'ransomware', NOW)).toEqual({
      status: 'ok', lastUpdate: new Date('2026-10-04T14:48:30.000Z'), error: undefined, period: `16:48 · ${RANSOMWARE_UNDATED_NOTE}`,
    });
    expect(cyberStatus(state, 'ransomware', NOW + 24 * HOUR + MIN)).toMatchObject({ status: 'stale', period: `04/10 16:48 · ${RANSOMWARE_UNDATED_NOTE} (en retard)` });
    // Ni date du fichier ni relevé : jamais lue.
    data.ransomware = { ...data.ransomware, checkedAt: null };
    expect(cyberStatus(state, 'ransomware', NOW)).toMatchObject({ status: 'error', error: 'source jamais lue', period: 'n.d.' });
  });
  it('erreur sans source (collecte interrompue) et note commune : sur les cinq lignes', () => {
    const data = { ...CYBER_FIXTURE(), errors: ['Collecte cyber interrompue : délai dépassé', CYBER_PENDING_NOTE] };
    const state = { cyber: { data, error: null, fetchedAt: NOW } };
    for (const part of ['certfr', 'kev', 'ransomware', 'hibp', 'cybermalveillance'] as const) {
      expect(cyberStatus(state, part, NOW)).toMatchObject({ status: 'stale', error: 'Collecte cyber interrompue : délai dépassé' });
      expect(cyberStatus(state, part, NOW).period).toContain(`· ${CYBER_PENDING_NOTE}`);
    }
  });
});

describe('Vigipirate : vérification de la page officielle (O14, S1)', () => {
  const slot = (data: VigipiratePageCheck | null, error: string | null = null) => ({ data, error, fetchedAt: NOW });
  it('garde : relectures du serveur acceptées ; empreinte illisible refusée', () => {
    expect([VIGIPIRATE_CHECK_FIXTURE(), VIGIPIRATE_CHECK_CHANGED_FIXTURE()].every(isVigipiratePageCheck)).toBe(true);
    expect(isVigipiratePageCheck({ ...VIGIPIRATE_CHECK_FIXTURE(), fingerprint: 'abc' })).toBe(false);
    expect(isVigipiratePageCheck({ ...VIGIPIRATE_CHECK_FIXTURE(), text: 'vigilance renforcée' })).toBe(false);
  });
  it('page relue sans changement : aucune mention', () => {
    expect(vigipirateNotices(VIGIPIRATE_FIXTURE, slot(VIGIPIRATE_CHECK_FIXTURE()), NOW))
      .toEqual({ alertEnd: null, recheck: null, reminder: null, checkFailure: null });
  });
  it('page modifiée après la saisie : « niveau à revérifier sur sgdsn.gouv.fr (page modifiée le 05/10) »', () => {
    const later = NOW + 24 * HOUR;
    expect(vigipirateNotices(VIGIPIRATE_FIXTURE, slot(VIGIPIRATE_CHECK_CHANGED_FIXTURE()), later).recheck)
      .toBe('niveau à revérifier sur sgdsn.gouv.fr (page modifiée le 05/10)');
    // Saisie mise à jour le jour du changement : plus rien à revérifier.
    expect(vigipirateNotices({ ...VIGIPIRATE_FIXTURE, saisiLe: '2026-10-05' }, slot(VIGIPIRATE_CHECK_CHANGED_FIXTURE()), later).recheck).toBeNull();
  });
  it('« alerte attentat » : fin des 12 jours ; saisie de plus de 4\u00a0mois : rappel', () => {
    const alerte = { ...VIGIPIRATE_FIXTURE, stade: 'alerte-attentat' as const, depuis: '2026-10-05', saisiLe: '2026-10-05' };
    expect(vigipirateNotices(alerte, slot(VIGIPIRATE_CHECK_FIXTURE()), NOW + 24 * HOUR).alertEnd).toBe('jusqu’au 17/10, sauf renouvellement par le Premier ministre');
    expect(vigipirateNotices(VIGIPIRATE_FIXTURE, slot(VIGIPIRATE_CHECK_FIXTURE()), Date.parse('2027-02-15T12:00:00+01:00')).reminder)
      .toBe('saisie du 04/10/2026, de plus de 4\u00a0mois : à vérifier sur sgdsn.gouv.fr');
  });
  it('« alerte attentat » : fin des 12 jours le 17/10 encore dite jusqu’à minuit de Paris, puis échéance passée à revérifier', () => {
    const alerte = { ...VIGIPIRATE_FIXTURE, stade: 'alerte-attentat' as const, depuis: '2026-10-05', saisiLe: '2026-10-05' };
    const lastEvening = Date.parse('2026-10-17T23:30:00+02:00');
    const afterMidnight = Date.parse('2026-10-18T00:30:00+02:00');   // 17/10 22:30 UTC : jour UTC encore le 17, jour de Paris le 18
    expect(new Date(afterMidnight).toISOString().slice(0, 10)).toBe('2026-10-17');
    expect([vigipirateAlertEndPassed(alerte, lastEvening), vigipirateAlertEndPassed(alerte, afterMidnight)]).toEqual([false, true]);
    expect(vigipirateNotices(alerte, slot(VIGIPIRATE_CHECK_FIXTURE()), lastEvening).alertEnd)
      .toBe('jusqu’au 17/10, sauf renouvellement par le Premier ministre');
    expect(vigipirateNotices(alerte, slot(VIGIPIRATE_CHECK_FIXTURE()), afterMidnight).alertEnd)
      .toBe('échéance des 12\u00a0jours de l’alerte attentat passée le 17/10 · niveau à revérifier sur sgdsn.gouv.fr');
    expect(vigipirateAlertEndPassed(VIGIPIRATE_FIXTURE, afterMidnight)).toBe(false);
    expect(vigipirateNotices(VIGIPIRATE_FIXTURE, slot(VIGIPIRATE_CHECK_FIXTURE()), afterMidnight).alertEnd).toBeNull();
  });
  it('rappel de 4 mois (120 jours de Paris après la saisie) : pas le 01/02/2027 à 23 h 59, oui le 02/02/2027 à 0 h 01', () => {
    const check = slot(VIGIPIRATE_CHECK_FIXTURE());
    expect(vigipirateNotices(VIGIPIRATE_FIXTURE, check, Date.parse('2027-02-01T23:59:00+01:00')).reminder).toBeNull();
    expect(vigipirateNotices(VIGIPIRATE_FIXTURE, check, Date.parse('2027-02-02T00:01:00+01:00')).reminder)
      .toBe('saisie du 04/10/2026, de plus de 4\u00a0mois : à vérifier sur sgdsn.gouv.fr');
  });
  it('jour de Paris, pas jour UTC : relecture ou changement à 22 h 30 UTC un soir d’été tombe le lendemain à Paris', () => {
    const lateEvening = '2026-10-04T22:30:00.000Z';
    const failed = { ...VIGIPIRATE_CHECK_FIXTURE(), readAt: lateEvening, errors: ['SGDSN, page Vigipirate : HTTP 503'] };
    expect(vigipirateNotices(VIGIPIRATE_FIXTURE, slot(failed), Date.parse('2026-10-05T08:00:00Z')).checkFailure)
      .toBe('page officielle non relue depuis le 05/10 : SGDSN, page Vigipirate : HTTP 503');
    const changed = { ...VIGIPIRATE_CHECK_CHANGED_FIXTURE(), readAt: lateEvening, pageChangedAt: lateEvening };
    expect(vigipirateNotices(VIGIPIRATE_FIXTURE, slot(changed), Date.parse('2026-10-05T08:00:00Z')).recheck)
      .toBe('niveau à revérifier sur sgdsn.gouv.fr (page modifiée le 05/10)');
    // 21 h 30 UTC : encore le 04/10 à Paris, jour de la saisie : rien à revérifier.
    const sameDay = { ...changed, readAt: '2026-10-04T21:30:00.000Z', pageChangedAt: '2026-10-04T21:30:00.000Z' };
    expect(vigipirateNotices(VIGIPIRATE_FIXTURE, slot(sameDay), Date.parse('2026-10-05T08:00:00Z')).recheck).toBeNull();
  });
  it('ligne « Vigipirate (page du SGDSN) » datée par la relecture du serveur ; en retard au-delà de 26 h ; panne nommée, date gardée', async () => {
    expect(VIGIPIRATE_CHECK_LATE_AFTER_H).toBe(26);
    const state = { check: slot(VIGIPIRATE_CHECK_FIXTURE()) };
    expect(vigipirateCheckStatus(state, NOW)).toMatchObject({ status: 'ok', period: '16:48', lastUpdate: new Date('2026-10-04T14:48:30.000Z') });
    expect(vigipirateCheckStatus(state, NOW + 26 * HOUR)).toMatchObject({ status: 'ok' });
    expect(vigipirateCheckStatus(state, NOW + 26 * HOUR + 1000)).toMatchObject({ status: 'stale' });
    expect(vigipirateCheckStatus(state, NOW + 26 * HOUR + 1000).period).toMatch(/\(en retard\)$/);
    const failed = { check: slot({ ...VIGIPIRATE_CHECK_FIXTURE(), errors: ['SGDSN, page Vigipirate : HTTP 503'] }) };
    expect(vigipirateCheckStatus(failed, NOW)).toMatchObject({ status: 'stale', error: 'SGDSN, page Vigipirate : HTTP 503', period: '16:48' });
    expect(vigipirateCheckStatus({ check: slot(null) }, NOW)).toMatchObject({ status: 'loading', lastUpdate: null });
    // 502 sans relecture réussie : ligne en erreur, nommée par le serveur ; une lecture en échec garde la vérification en mémoire.
    stubFetch({}, { [VIGIPIRATE_CHECK_URL]: { status: 502, body: { readAt: null, fingerprint: null, pageChangedAt: null, errors: ['SGDSN, page Vigipirate : HTTP 503'] } } });
    const never = await fetchVigipirateCheck(null, NOW);
    expect(vigipirateCheckStatus(never, NOW)).toMatchObject({ status: 'error', lastUpdate: null, error: 'SGDSN, page Vigipirate : HTTP 503' });
    const kept = mergeVigipirateCheck(state, never);
    expect(kept.check.data).toEqual(VIGIPIRATE_CHECK_FIXTURE());
    expect(vigipirateCheckStatus(kept, NOW)).toMatchObject({ status: 'stale', period: '16:48', error: 'SGDSN, page Vigipirate : HTTP 503' });
  });
  it('vérification en panne ou en retard : dite, jamais « inchangée »', async () => {
    const failed = { ...VIGIPIRATE_CHECK_FIXTURE(), errors: ['SGDSN, page Vigipirate : page de contrôle anti-robot'] };
    expect(vigipirateNotices(VIGIPIRATE_FIXTURE, slot(failed), NOW).checkFailure)
      .toBe('page officielle non relue depuis le 04/10 : SGDSN, page Vigipirate : page de contrôle anti-robot');
    expect(vigipirateNotices(VIGIPIRATE_FIXTURE, slot(VIGIPIRATE_CHECK_FIXTURE()), NOW + 26 * HOUR).checkFailure).toBeNull();
    expect(vigipirateNotices(VIGIPIRATE_FIXTURE, slot(VIGIPIRATE_CHECK_FIXTURE()), NOW + 26 * HOUR + 1000).checkFailure).toBe('page officielle non relue depuis le 04/10');
    stubFetch({}, { [VIGIPIRATE_CHECK_URL]: { status: 502, body: { readAt: null, fingerprint: null, pageChangedAt: null, errors: ['SGDSN, page Vigipirate : HTTP 503'] } } });
    const never = await fetchVigipirateCheck(null, NOW);
    expect(vigipirateNotices(VIGIPIRATE_FIXTURE, never.check, NOW).checkFailure).toBe('page officielle jamais relue : SGDSN, page Vigipirate : HTTP 503');
    expect(vigipirateNotices(VIGIPIRATE_FIXTURE, slot(null), NOW).checkFailure).toBeNull();
  });
});
