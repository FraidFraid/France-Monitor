// tests/sovereignty-cyber-api.test.ts : route /api/sovereignty/cyber (spec 2026-10-04 souveraineté § 2.3, V3, V4 ; contrats § 2.4 ;
// amendement 7, O1, O3, O5, S12) sur les réponses réelles du 04/10/2026 : flux CERT-FR (alertes et avis), page liste des alertes
// (statut officiel), flux CTI, pages d'ALE-011, d'ALE-008 et d'AVI-1257, catalogue KEV réduit, victims.json réduit et anonymisé,
// fuites HIBP, flux Cybermalveillance. Les pages non enregistrées sont construites à partir du flux (dernière version = première
// version, CVE du résumé) : elles ne servent qu'à dérouler la lecture des pages.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import { __resetKvForTests, __setKvClientForTests, kvGetJson, kvSetJson } from '../api/_lib/kv-history.js';
import { CERTFR_ALERT_LIST_URL, CERTFR_CTI_FEED, CERTFR_FEEDS, parseCertFrFeed } from '../api/_lib/certfr.js';
import { KEV_URL } from '../api/_lib/cisa-kev.js';
import { RANSOM_KEY, VICTIMS_URL, __resetRansomwareForTests } from '../api/_lib/ransomware-live.js';
import { HIBP_BREACHES_URL, HIBP_PUBLIC_URL } from '../api/_lib/hibp.js';
import { CYBERMALVEILLANCE_FEEDS } from '../api/_lib/cybermalveillance.js';
import {
  CERTFR_ITEMS_KEY, CERTFR_PAGES_NOTE, CERTFR_RETRY_MS, CYBER_KEY, CYBER_PENDING_NOTE, __resetCyberForTests, ensureCyberFresh,
} from '../api/_lib/cyber-collect.js';
import handler, { CACHE_CONTROL, loadCyber } from '../api/_handlers/sovereignty/cyber.js';
import { SOURCE_USER_AGENT } from '../api/_lib/source-http.js';
import type { CyberResponse } from '../src/types/index.ts';
import { type FakeResponse, callHandler, respond, sentHeader, stubFetch } from './helpers/traffic-fixtures.ts';

const fx = (name: string): string => readFileSync(new URL(`./fixtures/sovereignty/${name}`, import.meta.url), 'utf8');
const NOW = Date.parse('2026-10-04T16:48:30+02:00');
const HOUR = 3_600_000;
const FEED_ITEMS = [...parseCertFrFeed(fx('certfr-alerte-feed.xml'), 'alerte'), ...parseCertFrFeed(fx('certfr-avis-feed.xml'), 'avis')];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const PAGE_RE = /\/(?:alerte|avis)\/CERTFR-/;

/** Page construite pour un élément sans page enregistrée : dernière version = première version, CVE du résumé du flux. */
function constructedPage(ref: string): string {
  const item = FEED_ITEMS.find((i) => i.ref === ref);
  if (!item) return '<!doctype html><html><body>introuvable</body></html>';
  const [y, m, d] = item.firstVersion.split('-');
  const day = `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
  return `<!doctype html><html><body><table><tr><td>Référence</td><td>${ref}</td></tr>`
    + `<tr><td>Date de la première version</td><td>${day}</td></tr><tr><td>Date de la dernière version</td><td>${day}</td></tr></table>`
    + `<ul>${item.feedCves.map((c) => `<li>Référence CVE ${c}</li>`).join('')}</ul></body></html>`;
}

/** Sources réelles ; `override` force une réponse pour une URL (panne, page HTML…). */
function sources(override: (url: string) => FakeResponse | null = () => null) {
  return stubFetch((url) => {
    const forced = override(url);
    if (forced) return forced;
    if (url === CERTFR_FEEDS.alerte) return respond(fx('certfr-alerte-feed.xml'));
    if (url === CERTFR_FEEDS.avis) return respond(fx('certfr-avis-feed.xml'));
    if (url === CERTFR_ALERT_LIST_URL) return respond(fx('certfr-alerte-liste.html'));
    if (url === CERTFR_CTI_FEED) return respond(fx('certfr-cti-feed.xml'));
    if (url.endsWith('/alerte/CERTFR-2026-ALE-011/')) return respond(fx('certfr-alerte-CERTFR-2026-ALE-011.html'));
    if (url.endsWith('/alerte/CERTFR-2026-ALE-008/')) return respond(fx('certfr-alerte-CERTFR-2026-ALE-008.html'));
    if (url.endsWith('/avis/CERTFR-2026-AVI-1257/')) return respond(fx('certfr-avis-CERTFR-2026-AVI-1257.html'));
    const ref = /CERTFR-\d{4}-(?:ALE|AVI)-\d+/.exec(url)?.[0];
    if (ref) return respond(constructedPage(ref));
    if (url === KEV_URL) return respond(fx('cisa-kev-reduit.json'));
    if (url === VICTIMS_URL) return respond(fx('ransomware-live-victims-reduit.json'), 200, { 'Last-Modified': 'Sun, 04 Oct 2026 14:30:09 GMT' });
    if (url === HIBP_BREACHES_URL) return respond(fx('hibp-breaches-reduit.json'));
    if (url === CYBERMALVEILLANCE_FEEDS.alertes) return respond(fx('cybermalveillance-alertes.xml'));
    if (url === CYBERMALVEILLANCE_FEEDS.actualites) return respond(fx('cybermalveillance-actualites.xml'));
    return respond('introuvable', 404);
  });
}

/** Trois cycles CERT-FR (les 44 pages lues, 20 par cycle), puis toutes les autres sources relues à 16 h 48 min 30 s. */
async function steadyState(override?: (url: string) => FakeResponse | null) {
  sources(override);
  for (const t of [NOW - 2 * HOUR, NOW - HOUR]) {
    vi.setSystemTime(t);
    await ensureCyberFresh(t);
  }
  __resetSwrCacheForTests();
  await kvSetJson(RANSOM_KEY, null, 1, NOW - HOUR);
  vi.setSystemTime(NOW);
  return sources(override);
}

beforeEach(() => {
  __resetSwrCacheForTests();
  __resetKvForTests();
  __setKvClientForTests({ get: async () => null, set: async () => undefined });
  __resetRansomwareForTests();
  __resetCyberForTests();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => { __setKvClientForTests(null); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('/api/sovereignty/cyber : réponse complète du 04/10', () => {
  it('alertes de moins de 90 jours du plus récent au plus ancien (dernière version lue) ; ALE-011 : dernière version le 30/09, CVE-2026-88771 et 88772 au catalogue', async () => {
    await steadyState();
    const { status, body, cache } = await callHandler<CyberResponse>(handler);
    expect([status, cache, body.errors]).toEqual([200, CACHE_CONTROL, []]);
    expect(body.certfr.alerts.map((a) => [a.ref, a.lastVersion, a.kevCves])).toEqual([
      ['CERTFR-2026-ALE-011', '2026-09-30', ['CVE-2026-88771', 'CVE-2026-88772']],
      ['CERTFR-2026-ALE-008', '2026-09-22', ['CVE-2026-50522', 'CVE-2026-58644']],
      ['CERTFR-2026-ALE-010', '2026-09-10', []],
      ['CERTFR-2026-ALE-009', '2026-09-02', ['CVE-2026-83548']],
      ['CERTFR-2026-ALE-007', '2026-07-20', ['CVE-2026-60137', 'CVE-2026-63030']],
      ['CERTFR-2026-ALE-006', '2026-07-15', ['CVE-2026-15409']],
    ]);
    expect(body.certfr.alerts[0]).toMatchObject({ title: 'Multiples vulnérabilités dans Citrix NetScaler ADC et Gateway', product: 'Citrix NetScaler ADC et Gateway', firstVersion: '2026-09-28', updatedMark: false });
    expect(body.certfr.readAt).toBe('2026-10-04T14:48:30.000Z');
  });
  it('statut officiel repris de la page liste (O1) : trois alertes en cours, ALE-008 close le 22/09 ; avis sans statut', async () => {
    await steadyState();
    const body = await ensureCyberFresh(NOW);
    expect(body.certfr.alerts.map((a) => [a.ref, a.status, a.closedAt])).toEqual([
      ['CERTFR-2026-ALE-011', 'en-cours', null],
      ['CERTFR-2026-ALE-008', 'cloturee', '2026-09-22'],
      ['CERTFR-2026-ALE-010', 'en-cours', null],
      ['CERTFR-2026-ALE-009', 'en-cours', null],
      ['CERTFR-2026-ALE-007', 'cloturee', '2026-08-24'],
      ['CERTFR-2026-ALE-006', 'cloturee', '2026-08-24'],
    ]);
    expect(body.certfr.avis.every((a) => a.status === null && a.closedAt === null)).toBe(true);
  });
  it('exploitation signalée par le texte de l’alerte (O3), phrase citée telle quelle ; page sans mention : non signalée', async () => {
    await steadyState();
    const body = await ensureCyberFresh(NOW);
    expect(body.certfr.alerts[0]).toMatchObject({
      exploited: true,
      exploitedQuote: 'Ces vulnérabilités sont activement exploitées et les exploitations ont commencé avant la disponibilité des correctifs.',
    });
    expect(body.certfr.alerts[1].exploitedQuote).toBe('Dans son avis du 14 juillet 2026, Microsoft a indiqué que la vulnérabilité CVE-2026-58644 est activement exploitée.');
    expect(body.certfr.alerts.find((a) => a.ref === 'CERTFR-2026-ALE-010')).toMatchObject({ exploited: false, exploitedQuote: null });
  });
  it('rapports Menaces et incidents de l’ANSSI (flux CTI, S12) : plus récent d’abord', async () => {
    await steadyState();
    const body = await ensureCyberFresh(NOW);
    expect(body.certfr.reports).toHaveLength(40);
    expect(body.certfr.reports.slice(0, 2)).toEqual([
      { ref: 'CERTFR-2026-CTI-007', title: 'Vulnérabilités de produits du secteur santé : Retour d\'expérience du CERT Santé et du CERT-FR', lang: 'fr', date: '2026-10-02', url: 'https://www.cert.ssi.gouv.fr/cti/CERTFR-2026-CTI-007/' },
      { ref: 'CERTFR-2026-CTI-006', title: 'Point de situation de l’opération REACTIV – septembre 2026', lang: 'fr', date: '2026-09-30', url: 'https://www.cert.ssi.gouv.fr/cti/CERTFR-2026-CTI-006/' },
    ]);
  });
  it('38 avis de moins de 30 jours (le flux n’en garde que 40) ; AVI-1257 cite CVE-2026-104286, au catalogue', async () => {
    await steadyState();
    const body = await ensureCyberFresh(NOW);
    expect(body.certfr.avis).toHaveLength(38);
    expect(body.certfr.avis[0]).toMatchObject({ ref: 'CERTFR-2026-AVI-1257', lastVersion: '2026-10-02', cves: ['CVE-2026-104286'], kevCves: ['CVE-2026-104286'] });
  });
  it('vulnérabilités KEV des 30 derniers jours : citées par le CERT-FR d’abord ; 12 semaines', async () => {
    await steadyState();
    const body = await ensureCyberFresh(NOW);
    expect([body.kev.catalogVersion, body.kev.count, body.kev.recent.length]).toEqual(['2026.10.02', 1733, 38]);
    expect(body.kev.recent.filter((k) => k.certfrRefs.length > 0).map((k) => k.cve)).toEqual([
      'CVE-2026-104286', 'CVE-2026-76504', 'CVE-2026-86950', 'CVE-2026-88771', 'CVE-2026-88772', 'CVE-2026-94127', 'CVE-2026-85706',
    ]);
    expect(body.kev.recent.find((k) => k.cve === 'CVE-2026-88771')).toMatchObject({ dateAdded: '2026-09-27', certfrRefs: ['CERTFR-2026-ALE-011'], ransomware: false });
    expect(body.kev.weeks.at(-1)).toEqual({ weekStart: '2026-09-27T14:48:30.000Z', added: 5, cited: 3 });
  });
  it('revendications agrégées (7 cette semaine, rapport 1,29), fuites .fr récentes : un compte et un lien (O5), Cybermalveillance : 21 entrées datées', async () => {
    await steadyState();
    const body = await ensureCyberFresh(NOW);
    expect([body.ransomware?.weekCount, body.ransomware?.ratio, body.ransomware?.lastModified]).toEqual([7, 1.29, '2026-10-04T14:30:09.000Z']);
    expect(body.hibp).toEqual({ readAt: '2026-10-04T14:48:30.000Z', count: 0, newestAddedDate: null, url: HIBP_PUBLIC_URL });
    expect(body.cybermalveillance?.entries).toHaveLength(21);
    expect(body.cybermalveillance?.entries.every((e) => typeof e.published === 'string')).toBe(true);
    expect(body.readAt).toBe('2026-10-04T14:48:30.000Z');
  });
  it('aucun nom ni site de victime, aucun titre ni domaine de fuite dans la réponse ni dans le stockage clé-valeur ; valeurs de moins de 200 Ko', async () => {
    await steadyState();
    const body = await ensureCyberFresh(NOW);
    expect(JSON.stringify(body)).not.toMatch(/victime-|\.example|Fuite fictive|organisation-\d/);
    for (const key of [CYBER_KEY, CERTFR_ITEMS_KEY, RANSOM_KEY]) {
      const value = JSON.stringify(await kvGetJson(key, NOW));
      expect(value).not.toMatch(/victime-|\.example|Fuite fictive|organisation-\d/);
      expect(value.length).toBeLessThan(200_000);
    }
  });
  it('chaque appel sortant porte l’en-tête FranceMonitor', async () => {
    await steadyState();
    const log = sources();
    __resetSwrCacheForTests();
    await ensureCyberFresh(NOW);
    expect(log.inits.length).toBeGreaterThan(0);
    expect(log.inits.every((i) => sentHeader(i, 'User-Agent') === SOURCE_USER_AGENT)).toBe(true);
  });
});

describe('pages du CERT-FR, page liste et cadences', () => {
  it('premier cycle : 20 pages lues (alertes d’abord, puis les avis les plus récents), le reste au cycle suivant (note)', async () => {
    const log = sources();
    const body = await ensureCyberFresh(NOW);
    const pages = log.urls.filter((u) => PAGE_RE.test(u));
    expect(pages).toHaveLength(20);
    expect(pages.slice(0, 6).every((u) => u.includes('/alerte/'))).toBe(true);
    expect(body.errors).toEqual([CERTFR_PAGES_NOTE]);
    expect(body.certfr.alerts[0]).toMatchObject({ ref: 'CERTFR-2026-ALE-011', lastVersion: '2026-09-30' });
    expect(body.certfr.avis[0]).toMatchObject({ ref: 'CERTFR-2026-AVI-1257', lastVersion: '2026-10-02' });
    expect(body.certfr.avis.at(-1)).toMatchObject({ ref: 'CERTFR-2026-AVI-1220', lastVersion: null, cves: ['CVE-2026-94127'], exploited: null });
  });
  it('page liste lue une seule fois par cycle, quel que soit le nombre de pages lues', async () => {
    const log = sources();
    await ensureCyberFresh(NOW);
    expect(log.urls.filter((u) => u === CERTFR_ALERT_LIST_URL)).toHaveLength(1);
    expect(log.urls.filter((u) => u === CERTFR_CTI_FEED)).toHaveLength(1);
    vi.setSystemTime(NOW + 30 * 60_000);
    await ensureCyberFresh(NOW + 30 * 60_000);
    expect(log.urls.filter((u) => u === CERTFR_ALERT_LIST_URL)).toHaveLength(1);
    vi.setSystemTime(NOW + HOUR);
    await ensureCyberFresh(NOW + HOUR);
    expect(log.urls.filter((u) => u === CERTFR_ALERT_LIST_URL)).toHaveLength(2);
  });
  it('flux relus toutes les heures seulement ; le flux qui tourne ne fait pas retomber le compte des avis', async () => {
    sources();
    await ensureCyberFresh(NOW);
    const shortAvis = fx('certfr-avis-feed.xml').replace(/<item>[\s\S]*<\/item>/, (all) => all.split('</item>').slice(-6).join('</item>'));
    const log = sources((url) => (url === CERTFR_FEEDS.avis ? respond(shortAvis) : null));
    vi.setSystemTime(NOW + 30 * 60_000);
    await ensureCyberFresh(NOW + 30 * 60_000);
    expect(log.urls.filter((u) => u === CERTFR_FEEDS.avis)).toHaveLength(0);
    vi.setSystemTime(NOW + HOUR);
    const body = await ensureCyberFresh(NOW + HOUR);
    expect(log.urls.filter((u) => u === CERTFR_FEEDS.avis)).toHaveLength(1);
    expect(body.certfr.avis).toHaveLength(38);
  });
});

describe('statut officiel des alertes : jamais « en cours » supposé', () => {
  it('page liste jamais lue : statut non lu (null) pour les alertes ouvertes, « clôturée » pour celle dont la page le dit ; panne nommée', async () => {
    sources((url) => (url === CERTFR_ALERT_LIST_URL ? respond('indisponible', 503) : null));
    const body = await ensureCyberFresh(NOW);
    expect(body.errors).toEqual(['CERT-FR, liste des alertes : HTTP 503', CERTFR_PAGES_NOTE]);
    const byRef = new Map(body.certfr.alerts.map((a) => [a.ref, [a.status, a.closedAt]]));
    expect(byRef.get('CERTFR-2026-ALE-011')).toEqual([null, null]);
    expect(byRef.get('CERTFR-2026-ALE-010')).toEqual([null, null]);
    expect(byRef.get('CERTFR-2026-ALE-008')).toEqual(['cloturee', '2026-09-22']);
  });
  it('page liste en panne après une lecture : statuts déjà lus gardés, y compris à la relecture d’une page', async () => {
    sources();
    await ensureCyberFresh(NOW);
    // 25 h plus tard : les alertes de moins de 30 jours sont relues, la liste ne répond plus.
    const later = NOW + 25 * HOUR;
    vi.setSystemTime(later);
    const log = sources((url) => (url === CERTFR_ALERT_LIST_URL ? respond('<!DOCTYPE html><html><title>Just a moment...</title></html>', 403) : null));
    const body = await ensureCyberFresh(later);
    expect(log.urls.some((u) => u.endsWith('/alerte/CERTFR-2026-ALE-011/'))).toBe(true);
    expect(body.errors).toContain('CERT-FR, liste des alertes : page de contrôle anti-robot (HTTP 403)');
    expect(body.certfr.alerts.find((a) => a.ref === 'CERTFR-2026-ALE-011')).toMatchObject({ status: 'en-cours', pageReadAt: new Date(later).toISOString() });
    expect(body.certfr.alerts.find((a) => a.ref === 'CERTFR-2026-ALE-008')).toMatchObject({ status: 'cloturee', closedAt: '2026-09-22' });
  });
  it('alerte absente de la page liste, sans clôture sur sa page : statut non lu, jamais « en cours »', async () => {
    const list = fx('certfr-alerte-liste.html').replace(/CERTFR-2026-ALE-010/g, 'CERTFR-2026-ALE-099');
    sources((url) => (url === CERTFR_ALERT_LIST_URL ? respond(list) : null));
    const body = await ensureCyberFresh(NOW);
    expect(body.certfr.alerts.find((a) => a.ref === 'CERTFR-2026-ALE-010')).toMatchObject({ status: null, closedAt: null });
    expect(body.certfr.alerts.map((a) => a.ref)).not.toContain('CERTFR-2026-ALE-099');
  });
});

describe('pannes partielles (une partie en panne garde sa valeur et se nomme)', () => {
  it('flux des avis en panne : alertes servies, panne nommée', async () => {
    sources((url) => (url === CERTFR_FEEDS.avis ? respond('indisponible', 503) : null));
    const { status, body } = await callHandler<CyberResponse>(handler);
    expect([status, body.certfr.alerts.length, body.certfr.avis.length]).toEqual([200, 6, 0]);
    expect(body.errors).toEqual(['CERT-FR, avis : HTTP 503']);
  });
  it('flux CTI en panne après une lecture : rapports déjà lus gardés, panne nommée', async () => {
    sources();
    await ensureCyberFresh(NOW);
    vi.setSystemTime(NOW + HOUR);
    sources((url) => (url === CERTFR_CTI_FEED ? respond('indisponible', 503) : null));
    const body = await ensureCyberFresh(NOW + HOUR);
    expect(body.errors).toContain('CERT-FR, rapports Menaces et incidents : HTTP 503');
    expect(body.certfr.reports).toHaveLength(40);
  });
  it('catalogue KEV jamais lu : nommé, aucune vulnérabilité inventée', async () => {
    sources((url) => (url === KEV_URL ? respond('indisponible', 503) : null));
    const body = await ensureCyberFresh(NOW);
    expect(body.errors).toContain('CISA KEV : HTTP 503');
    expect([body.kev.readAt, body.kev.recent, body.certfr.alerts[0].kevCves]).toEqual([null, [], []]);
  });
  it('catalogue KEV en panne après une lecture : dernier croisement gardé, relevé précédent servi', async () => {
    sources();
    await ensureCyberFresh(NOW);
    vi.setSystemTime(NOW + 7 * HOUR);
    __resetSwrCacheForTests();
    sources((url) => (url === KEV_URL ? respond('indisponible', 503) : null));
    const body = await ensureCyberFresh(NOW + 7 * HOUR);
    expect(body.errors).toContain('CISA KEV : HTTP 503');
    expect(body.kev.readAt).toBe('2026-10-04T14:48:30.000Z');
    expect(body.certfr.alerts[0].kevCves).toEqual(['CVE-2026-88771', 'CVE-2026-88772']);
  });
  it('HIBP, ransomware.live et un flux Cybermalveillance en panne : chacun nommé avec sa source', async () => {
    sources((url) => {
      if (url === HIBP_BREACHES_URL) return respond('Forbidden', 403);
      if (url === VICTIMS_URL) return respond('indisponible', 503);
      if (url === CYBERMALVEILLANCE_FEEDS.alertes) return respond('<!DOCTYPE html><html></html>');
      return null;
    });
    const body = await ensureCyberFresh(NOW);
    expect(body.errors).toEqual(expect.arrayContaining([
      'HIBP : HTTP 403', 'Ransomware.live : HTTP 503', 'Cybermalveillance, alertes : page HTML reçue au lieu de données',
    ]));
    expect([body.hibp, body.ransomware, body.cybermalveillance?.entries.length]).toEqual([null, null, 20]);
  });
  it('entrée Cybermalveillance sans date de publication lisible : écartée et signalée, jamais servie sans date', async () => {
    const undated = fx('cybermalveillance-alertes.xml').replace(/<published>[^<]*<\/published>/, '<published>bientôt</published>');
    sources((url) => (url === CYBERMALVEILLANCE_FEEDS.alertes ? respond(undated) : null));
    const body = await ensureCyberFresh(NOW);
    expect(body.cybermalveillance?.entries).toHaveLength(20);
    expect(body.cybermalveillance?.entries.every((e) => typeof e.published === 'string')).toBe(true);
    expect(body.errors).toContain('Cybermalveillance, alertes : 1 entrée sans date de publication lisible, écartée');
  });
  it('aucun flux CERT-FR lu : nouvel essai 10 min plus tard, pas une heure', async () => {
    const log = sources((url) => (url === CERTFR_FEEDS.alerte || url === CERTFR_FEEDS.avis ? respond('indisponible', 503) : null));
    await ensureCyberFresh(NOW);
    vi.setSystemTime(NOW + 5 * 60_000);
    await ensureCyberFresh(NOW + 5 * 60_000);
    expect(log.urls.filter((u) => u === CERTFR_FEEDS.alerte)).toHaveLength(1);
    sources();
    vi.setSystemTime(NOW + CERTFR_RETRY_MS);
    const body = await ensureCyberFresh(NOW + CERTFR_RETRY_MS);
    expect([body.certfr.readAt, body.certfr.alerts.length]).toEqual(['2026-10-04T14:58:30.000Z', 6]);
  });
  it('CERT-FR en panne mais d’autres parties lues : 200, CERT-FR non daté', async () => {
    sources((url) => (url === CERTFR_FEEDS.alerte || url === CERTFR_FEEDS.avis ? respond('indisponible', 503) : null));
    const { status, body } = await callHandler<CyberResponse>(handler);
    expect([status, body.certfr.readAt, body.readAt]).toEqual([200, null, '2026-10-04T14:48:30.000Z']);
  });
  it('rien n’a répondu : 502 non mis en cache, toutes les pannes nommées', async () => {
    stubFetch(() => respond('indisponible', 503));
    const { status, body, cache } = await callHandler<CyberResponse>(handler);
    expect([status, cache, body.readAt]).toEqual([502, 'no-store', null]);
    expect(body.errors).toEqual([
      'CERT-FR, alertes : HTTP 503', 'CERT-FR, avis : HTTP 503', 'CERT-FR, liste des alertes : HTTP 503',
      'CERT-FR, rapports Menaces et incidents : HTTP 503', 'CISA KEV : HTTP 503', 'Ransomware.live : HTTP 503', 'HIBP : HTTP 503',
      'Cybermalveillance, alertes : HTTP 503', 'Cybermalveillance, actualités : HTTP 503',
    ]);
    expect(body.certfr.reports).toEqual([]);
  });
  it('collecte plus longue que l’échéance : réponse précédente servie avec « collecte en cours »', async () => {
    sources();
    await ensureCyberFresh(NOW);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    stubFetch(async () => { await gate; return respond('indisponible', 503); });
    vi.setSystemTime(NOW + 7 * HOUR);
    __resetSwrCacheForTests();
    const pending = await loadCyber(NOW + 7 * HOUR, { budgetMs: 20 });
    expect(pending.errors).toContain(CYBER_PENDING_NOTE);
    expect(pending.certfr.alerts).toHaveLength(6);
    release();
    // La collecte finit en arrière-plan (sources en panne) : la réponse gardée reste servie, pannes nommées.
    const done = await ensureCyberFresh(NOW + 7 * HOUR);
    expect(done.errors).toContain('CISA KEV : HTTP 503');
  });
});
