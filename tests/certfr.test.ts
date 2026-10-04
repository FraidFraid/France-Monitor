// tests/certfr.test.ts : alertes et avis du CERT-FR (spec 2026-10-04 souveraineté § 2.3, V4 ; contrats § 2.4, arbitrage 14) sur les
// flux réels du 04/10/2026 (40 alertes de 2015 à 2026 et 40 avis, dans le désordre), la page de l'alerte CERTFR-2026-ALE-011 et la page
// réduite de l'avis CERTFR-2026-AVI-1257.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ALERT_KEEP_DAYS, AVIS_KEEP_DAYS, CERTFR_ALERT_LIST_URL, CERTFR_CTI_FEED, CERTFR_FEEDS, MAX_PAGES_PER_CYCLE, applyAlertList, applyPageRead,
  fetchAlertList, fetchCtiReports, frenchDate, mergeCertFrItems, pageDue, parseCertFrAlertList, parseCertFrFeed, parseCertFrPage,
  parseCtiFeed, resolveAlertStatus, sortCertFr,
} from '../api/_lib/certfr.js';
import { SOURCE_USER_AGENT } from '../api/_lib/source-http.js';
import { respond, sentHeader, stubFetch } from './helpers/traffic-fixtures.ts';

const fx = (name: string): string => readFileSync(new URL(`./fixtures/sovereignty/${name}`, import.meta.url), 'utf8');
const NOW = Date.parse('2026-10-04T16:48:30+02:00');
afterEach(() => { vi.unstubAllGlobals(); });
const ALERTS = parseCertFrFeed(fx('certfr-alerte-feed.xml'), 'alerte');
const AVIS = parseCertFrFeed(fx('certfr-avis-feed.xml'), 'avis');

describe('frenchDate', () => {
  it('« 30 septembre 2026 », « 02 octobre 2026 », « 1er août 2026 » ; illisible : null', () => {
    expect([frenchDate('30 septembre 2026'), frenchDate('02 octobre 2026'), frenchDate('1er août 2026'), frenchDate('le 5 décembre 2025')])
      .toEqual(['2026-09-30', '2026-10-02', '2026-08-01', '2025-12-05']);
    expect([frenchDate('30/09/2026'), frenchDate('32 mai 2026'), frenchDate('3 brumaire 2026')]).toEqual([null, null, null]);
  });
});

describe('parseCertFrFeed', () => {
  it('40 alertes et 40 avis lus, références tirées du lien (3 ou 4 chiffres)', () => {
    expect([ALERTS.length, AVIS.length]).toEqual([40, 40]);
    expect(AVIS.map((a) => a.ref)).toContain('CERTFR-2019-AVI-429');
    expect(AVIS.map((a) => a.ref)).toContain('CERTFR-2026-AVI-0644');
    expect(CERTFR_FEEDS).toEqual({ alerte: 'https://www.cert.ssi.gouv.fr/alerte/feed/', avis: 'https://www.cert.ssi.gouv.fr/avis/feed/' });
  });
  it('ALE-011 : aucune CVE ni « [MàJ] » dans le flux ; titre sans la date ; produit ; première version = pubDate', () => {
    expect(ALERTS.find((a) => a.ref === 'CERTFR-2026-ALE-011')).toEqual({
      ref: 'CERTFR-2026-ALE-011', kind: 'alerte', title: 'Multiples vulnérabilités dans Citrix NetScaler ADC et Gateway',
      product: 'Citrix NetScaler ADC et Gateway', updatedMark: false, url: 'https://www.cert.ssi.gouv.fr/alerte/CERTFR-2026-ALE-011/',
      firstVersion: '2026-09-28', feedCves: [],
    });
  });
  it('« [Màj] » et « [MàJ] » reconnus et retirés du titre ; CVE du résumé', () => {
    expect(ALERTS.find((a) => a.ref === 'CERTFR-2026-ALE-005')).toMatchObject({
      title: 'Vulnérabilité dans Microsoft Exchange Server', product: 'Microsoft Exchange Server', updatedMark: true, feedCves: ['CVE-2026-42897'],
    });
    expect(ALERTS.find((a) => a.ref === 'CERTFR-2024-ALE-008')).toMatchObject({ title: 'Vulnérabilité dans les produits Check Point', updatedMark: true });
  });
  it('titre d’une autre forme : produit null (le titre sera affiché)', () => {
    expect(ALERTS.find((a) => a.ref === 'CERTFR-2026-ALE-003')).toMatchObject({ title: 'Note d’alerte – Ciblage des messageries instantanées', product: null });
  });
  it('AVI-1257 : Fortinet FortiMail, 02/10, CVE-2026-104286 dans le résumé', () => {
    expect(AVIS.find((a) => a.ref === 'CERTFR-2026-AVI-1257')).toMatchObject({
      kind: 'avis', title: 'Vulnérabilité dans Fortinet FortiMail', product: 'Fortinet FortiMail', firstVersion: '2026-10-02', feedCves: ['CVE-2026-104286'],
    });
  });
  it('flux vide ou HTML : aucun élément', () => {
    expect(parseCertFrFeed('<rss><channel></channel></rss>', 'avis')).toEqual([]);
  });
});

describe('parseCertFrPage', () => {
  it('ALE-011 : dernière version le 30/09, première le 28/09, CVE de la section « Référence CVE » seulement, en cours, exploitation signalée', () => {
    expect(parseCertFrPage(fx('certfr-alerte-CERTFR-2026-ALE-011.html'))).toEqual({
      lastVersion: '2026-09-30', firstVersion: '2026-09-28', cves: ['CVE-2026-88771', 'CVE-2026-88772'], closed: false, closedAt: null,
      exploited: true, exploitedQuote: 'Ces vulnérabilités sont activement exploitées et les exploitations ont commencé avant la disponibilité des correctifs.',
    });
  });
  it('ALE-008 : page close le 22/09 (« Clôture de l’alerte ») ; le texte de clôture ne compte pas comme exploitation', () => {
    expect(parseCertFrPage(fx('certfr-alerte-CERTFR-2026-ALE-008.html'))).toMatchObject({
      lastVersion: '2026-09-22', firstVersion: '2026-07-22', cves: ['CVE-2026-50522', 'CVE-2026-58644'], closed: true, closedAt: '2026-09-22',
      exploited: true, exploitedQuote: 'Dans son avis du 14 juillet 2026, Microsoft a indiqué que la vulnérabilité CVE-2026-58644 est activement exploitée.',
    });
  });
  it('négation liée à l’exploitation seulement : « ne nécessite pas d’authentification et est activement exploitée » reste signalée', () => {
    const page = (sentence: string): ReturnType<typeof parseCertFrPage> => parseCertFrPage(`<td>Date de la dernière version</td><td>1 octobre 2026</td><p>${sentence}</p>`);
    expect(page('Cette vulnérabilité ne nécessite pas d’authentification et est activement exploitée.').exploited).toBe(true);
    for (const negated of [
      'La vulnérabilité n’est pas activement exploitée.', 'La vulnérabilité n’est pas exploitée.', 'Il existe aucune exploitation connue.', 'Il n’y a pas d’exploitation connue.',
      'La vulnérabilité est non exploitée.', 'Sans exploitation signalée à ce jour.', 'La vulnérabilité n’a pas été exploitée.', 'Le CERT-FR n’a pas connaissance d’exploitations actives.',
    ]) expect([negated, page(negated).exploited]).toEqual([negated, false]);
  });
  it('phrase négative : pas d’exploitation signalée', () => {
    const html = '<td>Date de la dernière version</td><td>1 octobre 2026</td><p>Le CERT-FR n’a pas connaissance d’exploitations actives.</p><p>Seule la mise à jour protège contre l’exploitation.</p>';
    expect(parseCertFrPage(html)).toMatchObject({ exploited: false, exploitedQuote: null, closed: false });
  });
  it('page d’avis (même tableau, vérification 21 des contrats) : AVI-1257, 02/10, CVE-2026-104286', () => {
    expect(parseCertFrPage(fx('certfr-avis-CERTFR-2026-AVI-1257.html'))).toEqual({
      lastVersion: '2026-10-02', firstVersion: '2026-10-02', cves: ['CVE-2026-104286'], closed: false, closedAt: null, exploited: false, exploitedQuote: null,
    });
  });
  it('entités HTML dans les libellés : lues ; page sans date de dernière version : erreur', () => {
    const html = '<td>Date de la derni&egrave;re version</td><td>1er octobre 2026</td><li>R&eacute;f&eacute;rence CVE CVE-2026-00001</li>';
    expect(parseCertFrPage(html)).toMatchObject({ lastVersion: '2026-10-01', firstVersion: null, cves: ['CVE-2026-00001'] });
    expect(() => parseCertFrPage('<html><body>Maintenance</body></html>')).toThrow('page sans « Date de la dernière version »');
  });
});

describe('accumulation, fenêtres et tri', () => {
  const merged = mergeCertFrItems([], [...ALERTS, ...AVIS], NOW);
  it(`alertes de moins de ${ALERT_KEEP_DAYS} jours (ALE-006 à ALE-011) et avis de moins de ${AVIS_KEEP_DAYS} jours (38) ; 2015 et 2024 écartés`, () => {
    expect(merged.filter((i) => i.kind === 'alerte').map((i) => i.ref)).toEqual([
      'CERTFR-2026-ALE-011', 'CERTFR-2026-ALE-010', 'CERTFR-2026-ALE-009', 'CERTFR-2026-ALE-008', 'CERTFR-2026-ALE-007', 'CERTFR-2026-ALE-006',
    ]);
    expect(merged.filter((i) => i.kind === 'avis')).toHaveLength(38);
    expect(merged[0]).toMatchObject({ ref: 'CERTFR-2026-AVI-1257', lastVersion: null, pageCves: null, pageReadAt: null, status: null, closedAt: null, exploited: null });
  });
  it('plus récent d’abord, à date égale la référence la plus haute ; la dernière version passe devant la première', () => {
    const withPage = merged.map((i) => (i.ref === 'CERTFR-2026-ALE-011' ? { ...i, lastVersion: '2026-10-03' } : i));
    expect(sortCertFr(withPage).slice(0, 3).map((i) => i.ref)).toEqual(['CERTFR-2026-ALE-011', 'CERTFR-2026-AVI-1257', 'CERTFR-2026-AVI-1256']);
  });
  it('le flux tourne : un avis sorti du flux reste accumulé ; les données de page sont gardées', () => {
    const read = merged.map((i) => (i.ref === 'CERTFR-2026-AVI-1220' ? { ...i, lastVersion: '2026-09-23', pageCves: ['CVE-2026-94127'], pageReadAt: '2026-10-04T13:00:00.000Z' } : i));
    const next = mergeCertFrItems(read, AVIS.slice(-5), NOW + 3_600_000);
    expect(next.filter((i) => i.kind === 'avis')).toHaveLength(38);
    expect(next.find((i) => i.ref === 'CERTFR-2026-AVI-1220')).toMatchObject({ pageCves: ['CVE-2026-94127'], pageReadAt: '2026-10-04T13:00:00.000Z' });
  });
  it('une alerte sort de la fenêtre après 90 jours de Paris', () => {
    // ALE-006 (15/07) : 89 jours le 12/10, 90 le 13/10.
    expect(mergeCertFrItems(merged, [], Date.parse('2026-10-12T23:30:00+02:00')).some((i) => i.ref === 'CERTFR-2026-ALE-006')).toBe(true);
    expect(mergeCertFrItems(merged, [], Date.parse('2026-10-13T00:30:00+02:00')).some((i) => i.ref === 'CERTFR-2026-ALE-006')).toBe(false);
  });
});

describe('pageDue (arbitrage 14)', () => {
  const base = { firstVersion: '2026-09-28', lastVersion: null, pageReadAt: null };
  it('alerte de moins de 30 jours : jamais lue, ou relue après 24 h', () => {
    expect(pageDue({ ...base, kind: 'alerte' }, NOW)).toBe(true);
    expect(pageDue({ ...base, kind: 'alerte', lastVersion: '2026-09-30', pageReadAt: '2026-10-04T08:00:00.000Z' }, NOW)).toBe(false);
    expect(pageDue({ ...base, kind: 'alerte', lastVersion: '2026-09-30', pageReadAt: '2026-10-03T14:48:30.000Z' }, NOW)).toBe(true);
  });
  it('alerte de 30 à 90 jours : relue tous les 7 jours ; au-delà de 90 jours : jamais', () => {
    const older = { kind: 'alerte' as const, firstVersion: '2026-07-22', lastVersion: '2026-07-22' };
    expect(pageDue({ ...older, pageReadAt: '2026-09-30T14:48:30.000Z' }, NOW)).toBe(false);
    expect(pageDue({ ...older, pageReadAt: '2026-09-27T14:48:30.000Z' }, NOW)).toBe(true);
    expect(pageDue({ kind: 'alerte', firstVersion: '2026-05-15', lastVersion: null, pageReadAt: null }, NOW)).toBe(false);
  });
  it('avis de moins de 30 jours : lu une fois ; plus ancien : jamais', () => {
    expect(pageDue({ ...base, kind: 'avis' }, NOW)).toBe(true);
    expect(pageDue({ ...base, kind: 'avis', pageReadAt: '2026-10-01T00:00:00.000Z' }, NOW)).toBe(false);
    expect(pageDue({ kind: 'avis', firstVersion: '2026-09-02', lastVersion: null, pageReadAt: null }, NOW)).toBe(false);
  });
  it(`le 04/10 : 44 pages dues (6 alertes, 38 avis), lues ${MAX_PAGES_PER_CYCLE} par cycle`, () => {
    expect(mergeCertFrItems([], [...ALERTS, ...AVIS], NOW).filter((i) => pageDue(i, NOW))).toHaveLength(44);
    expect(MAX_PAGES_PER_CYCLE).toBe(20);
  });
});

describe('statut officiel (amendement 7, O1 et O3), page liste du 04/10/2026', () => {
  const list = parseCertFrAlertList(fx('certfr-alerte-liste.html'));
  it('10 alertes : ALE-011, 010 et 009 en cours ; ALE-008 close le 22/09 ; dates de publication lues', () => {
    expect(list).toHaveLength(10);
    expect(list.filter((e) => e.status === 'en-cours').map((e) => e.ref)).toEqual(['CERTFR-2026-ALE-011', 'CERTFR-2026-ALE-010', 'CERTFR-2026-ALE-009']);
    expect(list.find((e) => e.ref === 'CERTFR-2026-ALE-011')).toEqual({ ref: 'CERTFR-2026-ALE-011', publishedAt: '2026-09-28', status: 'en-cours', closedAt: null });
    expect(list.find((e) => e.ref === 'CERTFR-2026-ALE-008')).toEqual({ ref: 'CERTFR-2026-ALE-008', publishedAt: '2026-07-22', status: 'cloturee', closedAt: '2026-09-22' });
  });
  it('statut illisible : l’alerte reste dans le résultat avec status null, jamais « en cours » ; applyAlertList garde le statut déjà lu', () => {
    const html = fx('certfr-alerte-liste.html').replace('Alerte en cours', 'Statut à venir');
    const unreadable = parseCertFrAlertList(html);
    expect(unreadable).toHaveLength(10);
    expect(unreadable.filter((e) => e.status === null).map((e) => e.ref)).toEqual(['CERTFR-2026-ALE-011', 'CERTFR-2026-ALE-010', 'CERTFR-2026-ALE-009']);
    const page = parseCertFrPage(fx('certfr-alerte-CERTFR-2026-ALE-011.html'));
    expect(resolveAlertStatus(unreadable[0], page)).toEqual({ status: null, closedAt: null, conflict: false });
    const item = { ref: 'CERTFR-2026-ALE-011', kind: 'alerte', status: 'en-cours', closedAt: null };
    expect(applyAlertList([item], unreadable)).toEqual([item]);
  });
  it('page sans alerte lisible (maintenance, défi) : erreur', () => {
    expect(() => parseCertFrAlertList('<html><body>Maintenance</body></html>')).toThrow('page liste des alertes sans statut lisible');
  });
  it('la liste l’emporte ; sans la liste, la page close fait foi ; sinon statut inconnu (jamais « en cours » supposé) ; contradiction signalée', () => {
    const page = parseCertFrPage(fx('certfr-alerte-CERTFR-2026-ALE-008.html'));
    expect(resolveAlertStatus({ status: 'cloturee', closedAt: '2026-09-22' }, page)).toEqual({ status: 'cloturee', closedAt: '2026-09-22', conflict: false });
    expect(resolveAlertStatus(null, page)).toEqual({ status: 'cloturee', closedAt: '2026-09-22', conflict: false });
    expect(resolveAlertStatus(null, parseCertFrPage(fx('certfr-alerte-CERTFR-2026-ALE-011.html')))).toEqual({ status: null, closedAt: null, conflict: false });
    expect(resolveAlertStatus({ status: 'en-cours', closedAt: null }, page)).toEqual({ status: 'en-cours', closedAt: null, conflict: true });
  });
  it('applyAlertList et applyPageRead : statut, clôture et exploitation portés par l’élément accumulé ; un avis n’a pas de statut', () => {
    const merged = mergeCertFrItems([], [...ALERTS, ...AVIS], NOW);
    const withStatus = applyAlertList(merged, list);
    expect(withStatus.filter((i) => i.kind === 'alerte').map((i) => [i.ref, i.status])).toEqual([
      ['CERTFR-2026-ALE-011', 'en-cours'], ['CERTFR-2026-ALE-010', 'en-cours'], ['CERTFR-2026-ALE-009', 'en-cours'],
      ['CERTFR-2026-ALE-008', 'cloturee'], ['CERTFR-2026-ALE-007', 'cloturee'], ['CERTFR-2026-ALE-006', 'cloturee'],
    ]);
    expect(withStatus.find((i) => i.kind === 'avis')?.status).toBeNull();
    const ale011 = withStatus.find((i) => i.ref === 'CERTFR-2026-ALE-011');
    const read = applyPageRead(ale011, parseCertFrPage(fx('certfr-alerte-CERTFR-2026-ALE-011.html')), list[0], NOW);
    expect(read).toMatchObject({ status: 'en-cours', closedAt: null, lastVersion: '2026-09-30', exploited: true, pageReadAt: '2026-10-04T14:48:30.000Z' });
    const avis = applyPageRead(withStatus.find((i) => i.kind === 'avis'), parseCertFrPage(fx('certfr-avis-CERTFR-2026-AVI-1257.html')), null, NOW);
    expect(avis).toMatchObject({ status: null, closedAt: null, exploited: false });
  });
  it('fetchAlertList : une lecture, User-Agent FranceMonitor ; page en panne : erreur nommée', async () => {
    const log = stubFetch((url) => (url === CERTFR_ALERT_LIST_URL ? respond(fx('certfr-alerte-liste.html')) : respond('introuvable', 404)));
    expect((await fetchAlertList()).filter((e) => e.status === 'en-cours')).toHaveLength(3);
    expect(log.urls).toEqual([CERTFR_ALERT_LIST_URL]);
    expect(sentHeader(log.inits[0], 'User-Agent')).toBe(SOURCE_USER_AGENT);
    stubFetch(() => respond('indisponible', 503));
    await expect(fetchAlertList()).rejects.toThrow('HTTP 503');
  });
});

describe('Rapports Menaces et incidents (ANSSI), flux CTI du 04/10/2026 (S12)', () => {
  const cti = parseCtiFeed(fx('certfr-cti-feed.xml'));
  it('plus récent d’abord : CTI-007 (02/10), CTI-006 REACTIV (30/09) ; titre sans date finale ; lien et référence', () => {
    expect(cti.slice(0, 2)).toEqual([
      { ref: 'CERTFR-2026-CTI-007', title: 'Vulnérabilités de produits du secteur santé : Retour d\'expérience du CERT Santé et du CERT-FR', lang: 'fr', date: '2026-10-02', url: 'https://www.cert.ssi.gouv.fr/cti/CERTFR-2026-CTI-007/' },
      { ref: 'CERTFR-2026-CTI-006', title: 'Point de situation de l’opération REACTIV – septembre 2026', lang: 'fr', date: '2026-09-30', url: 'https://www.cert.ssi.gouv.fr/cti/CERTFR-2026-CTI-006/' },
    ]);
    expect(cti.every((r, i) => i === 0 || cti[i - 1].date >= r.date)).toBe(true);
  });
  it('rapports en anglais : drapeau retiré, langue notée', () => {
    expect(cti.find((r) => r.ref === 'CERTFR-2026-CTI-003')).toMatchObject({ title: 'Cyber Threat Overview 2025', lang: 'en', date: '2026-05-13' });
  });
  it('fetchCtiReports : une lecture ; flux vide : erreur', async () => {
    const log = stubFetch(() => respond(fx('certfr-cti-feed.xml')));
    expect((await fetchCtiReports()).length).toBe(cti.length);
    expect(log.urls).toEqual([CERTFR_CTI_FEED]);
    expect(sentHeader(log.inits[0], 'User-Agent')).toBe(SOURCE_USER_AGENT);
    stubFetch(() => respond('<rss><channel></channel></rss>'));
    await expect(fetchCtiReports()).rejects.toThrow('flux CTI sans rapport lisible');
  });
});
