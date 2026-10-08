// tests/hibp.test.ts : fuites de données publiées (Have I Been Pwned ; spec 2026-10-04 souveraineté § 2.3 ; contrats § 2.4, arbitrage 16,
// règle O5) sur l'extrait du 04/10/2026 (27 fuites dont 10 domaines en .fr, aucune ajoutée depuis 30 jours ; noms, titres, domaines et
// descriptions remplacés à la copie, dates, comptes et drapeaux gardés) et des fuites construites, aux noms fictifs. La réponse ne porte
// qu'un compte, la date la plus récente et un lien : ni titre, ni domaine, ni nom de fuite.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import { HIBP_BREACHES_URL, HIBP_PUBLIC_URL, frenchRecentBreaches, loadHibp } from '../api/_lib/hibp.js';
import { SOURCE_USER_AGENT } from '../api/_lib/source-http.js';
import { respond, sentHeader, stubFetch } from './helpers/traffic-fixtures.ts';

type Breach = Record<string, unknown>;
const REAL = (): Breach[] => JSON.parse(readFileSync(new URL('./fixtures/sovereignty/hibp-breaches-reduit.json', import.meta.url), 'utf8')) as Breach[];
const NOW = Date.parse('2026-10-04T16:48:30+02:00');
const fictive = (over: Breach = {}): Breach => ({
  Name: 'BoutiqueFictive', Title: 'Boutique fictive', Domain: 'boutique-fictive.exemple.fr', BreachDate: '2026-09-20', AddedDate: '2026-09-28T09:00:00Z',
  PwnCount: 12345, Description: 'In September 2026, …', DataClasses: ['Email addresses'], IsFabricated: false, IsSpamList: false, IsRetired: false, ...over,
});

beforeEach(() => { __resetSwrCacheForTests(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('frenchRecentBreaches', () => {
  it('le 04/10 : 10 domaines en .fr dans l’extrait, aucun ajouté depuis 30 jours : compte nul, pas de date', () => {
    expect(REAL().filter((b) => String(b.Domain).endsWith('.fr'))).toHaveLength(10);
    expect(frenchRecentBreaches(REAL(), NOW)).toEqual({ count: 0, newestAddedDate: null, url: HIBP_PUBLIC_URL });
  });
  it('fuite .fr ajoutée depuis moins de 30 jours : compte, date et lien seulement, jamais titre, domaine, nom ni description', () => {
    const s = frenchRecentBreaches([fictive()], NOW);
    expect(s).toEqual({ count: 1, newestAddedDate: '2026-09-28T09:00:00Z', url: 'https://haveibeenpwned.com/PwnedWebsites' });
    expect(JSON.stringify(s)).not.toMatch(/Boutique|boutique|exemple|September/);
  });
  it('écartées : fabriquée, liste de spam, retirée, domaine hors .fr, ajoutée il y a 30 jours ou plus', () => {
    const list = [
      fictive({ IsFabricated: true }), fictive({ IsSpamList: true }), fictive({ IsRetired: true }), fictive({ Domain: 'boutique-fictive.example' }),
      fictive({ AddedDate: '2026-09-04T14:48:30Z' }),
    ];
    expect(frenchRecentBreaches(list, NOW)).toMatchObject({ count: 0, newestAddedDate: null });
  });
  it('date la plus récente retenue ; forme inattendue : erreur', () => {
    const two = [fictive({ Name: 'A', AddedDate: '2026-09-10T00:00:00Z' }), fictive({ Name: 'B', AddedDate: '2026-10-01T00:00:00Z' })];
    expect(frenchRecentBreaches(two, NOW)).toMatchObject({ count: 2, newestAddedDate: '2026-10-01T00:00:00Z' });
    expect(() => frenchRecentBreaches({ breaches: [] }, NOW)).toThrow('liste des fuites illisible');
  });
});

describe('loadHibp', () => {
  it('liste publique sans clé, User-Agent FranceMonitor, relue toutes les 6 h ; aucune clé de titre ni de domaine', async () => {
    const log = stubFetch((url) => (url === HIBP_BREACHES_URL ? respond([...REAL(), fictive()]) : respond('introuvable', 404)));
    const first = await loadHibp(NOW);
    await loadHibp(NOW + 3_600_000);
    expect(first).toEqual({ readAt: '2026-10-04T14:48:30.000Z', count: 1, newestAddedDate: '2026-09-28T09:00:00Z', url: HIBP_PUBLIC_URL });
    expect(log.urls.length).toBe(1);
    expect(sentHeader(log.inits[0], 'User-Agent')).toBe(SOURCE_USER_AGENT);
    expect(sentHeader(log.inits[0], 'hibp-api-key')).toBeUndefined();
  });
  it('jamais lue et en panne : erreur', async () => {
    stubFetch(() => respond('Forbidden', 403));
    await expect(loadHibp(NOW)).rejects.toThrow('HTTP 403');
  });
});
