// tests/cisa-kev.test.ts : catalogue des failles exploitées de la CISA (spec 2026-10-04 souveraineté § 2.3, V3 ; contrats § 2.4) sur le
// catalogue réduit du 04/10/2026 (en-tête, 150 entrées les plus récentes et celles citées par le CERT-FR : 167 sur 1 733).
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import { KEV_URL, crossCertFr, kevWeeks, loadKev, parseKev } from '../api/_lib/cisa-kev.js';
import { SOURCE_USER_AGENT } from '../api/_lib/source-http.js';
import { respond, sentHeader, stubFetch } from './helpers/traffic-fixtures.ts';

const KEV_TEXT = readFileSync(new URL('./fixtures/sovereignty/cisa-kev-reduit.json', import.meta.url), 'utf8');
const KEV = (): unknown => JSON.parse(KEV_TEXT);
const NOW = Date.parse('2026-10-04T16:48:30+02:00');
/** CVE cités par le CERT-FR au 04/10 : pages d'ALE-011 et d'AVI-1257, résumés des avis AVI-1220, 1236, 1242 et 1246. */
const CERTFR = [
  { ref: 'CERTFR-2026-ALE-011', cves: ['CVE-2026-88771', 'CVE-2026-88772'] },
  { ref: 'CERTFR-2026-AVI-1257', cves: ['CVE-2026-104286'] },
  { ref: 'CERTFR-2026-AVI-1220', cves: ['CVE-2026-94127'] },
  { ref: 'CERTFR-2026-AVI-1236', cves: ['CVE-2026-86950'] },
  { ref: 'CERTFR-2026-AVI-1242', cves: ['CVE-2026-85706'] },
  { ref: 'CERTFR-2026-AVI-1246', cves: ['CVE-2026-76504'] },
];

beforeEach(() => { __resetSwrCacheForTests(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('parseKev', () => {
  const kev = parseKev(KEV());
  it('version 2026.10.02, 1 733 failles annoncées, 167 lues (catalogue réduit)', () => {
    expect([kev.catalogVersion, kev.dateReleased, kev.count, kev.cves.length, kev.items.length]).toEqual(['2026.10.02', '2026-10-02T15:19:38.2945Z', 1733, 167, 167]);
  });
  it('CVE-2026-88771 : Citrix NetScaler, ajoutée le 27/09, échéance le 30/09, sans campagne de rançongiciel connue', () => {
    expect(kev.items.find((i) => i.cve === 'CVE-2026-88771')).toEqual({
      cve: 'CVE-2026-88771', vendor: 'Citrix', product: 'NetScaler', name: 'Citrix NetScaler Improper Input Validation Vulnerability',
      dateAdded: '2026-09-27', dueDate: '2026-09-30', ransomware: false,
    });
    expect(kev.items.find((i) => i.cve === 'CVE-2026-15409')?.ransomware).toBe(true);
  });
  it('plus récentes d’abord (Zammad, 02/10)', () => {
    expect(kev.items.slice(0, 2).map((i) => [i.cve, i.dateAdded])).toEqual([['CVE-2026-102489', '2026-10-02'], ['CVE-2026-102490', '2026-10-02']]);
  });
  it('forme inattendue : erreur', () => {
    expect(() => parseKev({ title: 'x' })).toThrow('catalogue KEV illisible');
  });
});

describe('crossCertFr et kevWeeks', () => {
  const crossed = crossCertFr(parseKev(KEV()), CERTFR);
  it('citées par le CERT-FR d’abord : 104286 (AVI-1257), 76504, 86950, 88771 et 88772 (ALE-011), 94127, 85706', () => {
    expect(crossed.filter((k) => k.certfrRefs.length > 0).map((k) => [k.cve, k.certfrRefs])).toEqual([
      ['CVE-2026-104286', ['CERTFR-2026-AVI-1257']], ['CVE-2026-76504', ['CERTFR-2026-AVI-1246']], ['CVE-2026-86950', ['CERTFR-2026-AVI-1236']],
      ['CVE-2026-88771', ['CERTFR-2026-ALE-011']], ['CVE-2026-88772', ['CERTFR-2026-ALE-011']], ['CVE-2026-94127', ['CERTFR-2026-AVI-1220']],
      ['CVE-2026-85706', ['CERTFR-2026-AVI-1242']],
    ]);
    expect(crossed[7].certfrRefs).toEqual([]);
  });
  it('12 semaines de 7 × 24 h finissant au relevé, plus ancienne d’abord ; une faille compte à minuit UTC de son jour d’ajout', () => {
    const weeks = kevWeeks(crossed, NOW);
    expect(weeks).toHaveLength(12);
    expect([weeks[0].weekStart, weeks[11].weekStart]).toEqual(['2026-07-12T14:48:30.000Z', '2026-09-27T14:48:30.000Z']);
    // Dernière semaine : 29/09 (Apple), 30/09 (Cisco), 01/10 (Fortinet), 02/10 (Zammad, 2) ; les deux Citrix du 27/09 (minuit UTC,
    // avant 16 h 48) comptent dans la semaine précédente, avec F5 BIG-IP.
    expect(weeks[11]).toEqual({ weekStart: '2026-09-27T14:48:30.000Z', added: 5, cited: 3 });
    expect(weeks[10]).toEqual({ weekStart: '2026-09-20T14:48:30.000Z', added: 12, cited: 3 });
    expect(weeks.map((w) => w.added)).toEqual([10, 6, 3, 6, 3, 9, 11, 10, 14, 7, 12, 5]);
  });
});

describe('loadKev', () => {
  it('lu une fois toutes les 6 h, User-Agent FranceMonitor ; entrées détaillées des 120 derniers jours, tous les CVE gardés', async () => {
    const log = stubFetch((url) => (url === KEV_URL ? respond(KEV_TEXT) : respond('introuvable', 404)));
    const first = await loadKev(NOW);
    expect([first.readAt, first.cves.length, first.items.every((i: { dateAdded: string }) => i.dateAdded >= '2026-06-06')]).toEqual(['2026-10-04T14:48:30.000Z', 167, true]);
    await loadKev(NOW + 3_600_000);
    expect(log.urls).toEqual([KEV_URL]);
    expect(sentHeader(log.inits[0], 'User-Agent')).toBe(SOURCE_USER_AGENT);
  });
  it('catalogue en panne et jamais lu : erreur nommée par l’appelant (HTTP 503)', async () => {
    stubFetch(() => respond('indisponible', 503));
    await expect(loadKev(NOW)).rejects.toThrow('HTTP 503');
  });
});
