// tests/cybermalveillance.test.ts : flux Atom de Cybermalveillance.gouv.fr (spec 2026-10-04 souveraineté § 2.3 ; contrats § 2.4) sur les
// flux réels du 04/10/2026 (1 alerte, 20 actualités ; entités HTML dans les titres, dates de publication sans fuseau).
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import { CYBERMALVEILLANCE_FEEDS, loadCybermalveillance, parseAtom } from '../api/_lib/cybermalveillance.js';
import { SOURCE_USER_AGENT } from '../api/_lib/source-http.js';
import { respond, sentHeader, stubFetch } from './helpers/traffic-fixtures.ts';

const fx = (name: string): string => readFileSync(new URL(`./fixtures/sovereignty/${name}`, import.meta.url), 'utf8');
const NOW = Date.parse('2026-10-04T16:48:30+02:00');

beforeEach(() => { __resetSwrCacheForTests(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('parseAtom', () => {
  it('alertes : une entrée, publication sans fuseau lue à l’heure de Paris', () => {
    expect(parseAtom(fx('cybermalveillance-alertes.xml'), 'alertes')).toEqual([{
      feed: 'alertes', title: 'Cybermois 2026', url: 'https://www.cybermalveillance.gouv.fr/tous-nos-contenus/alertes/le-cybermois-arrive-preparez-vous',
      published: '2026-09-15T08:54:02.000Z', updated: '2026-09-30T20:39:53.000Z',
    }]);
  });
  it('actualités : 20 entrées, entités décodées (« d’information »), ordre du flux', () => {
    const list = parseAtom(fx('cybermalveillance-actualites.xml'), 'actualites');
    expect(list).toHaveLength(20);
    expect(list.slice(0, 2).map((e) => e.title)).toEqual(['Lettres d’information', 'Cybermois 2026 : « Se Cyber Protéger, ce n’est pas si bête »']);
    expect(list[0]).toMatchObject({ published: '2026-10-01T14:11:46.000Z', updated: '2026-10-01T14:11:47.000Z' });
  });
  it('flux vide : liste vide ; entrée sans lien : écartée', () => {
    expect(parseAtom('<feed></feed>', 'alertes')).toEqual([]);
    expect(parseAtom('<feed><entry><title>Sans lien</title></entry></feed>', 'alertes')).toEqual([]);
  });
});

describe('loadCybermalveillance', () => {
  it('deux flux lus, User-Agent FranceMonitor ; relus toutes les heures', async () => {
    const log = stubFetch((url) => respond(url === CYBERMALVEILLANCE_FEEDS.alertes ? fx('cybermalveillance-alertes.xml') : fx('cybermalveillance-actualites.xml')));
    const r = await loadCybermalveillance(NOW);
    expect([r.readAt, r.entries.length, r.errors]).toEqual(['2026-10-04T14:48:30.000Z', 21, []]);
    await loadCybermalveillance(NOW + 30 * 60_000);
    expect(log.urls).toHaveLength(2);
    expect(log.inits.every((i) => sentHeader(i, 'User-Agent') === SOURCE_USER_AGENT)).toBe(true);
  });
  it('un flux en panne : nommé, l’autre servi ; page HTML nommée', async () => {
    stubFetch((url) => (url === CYBERMALVEILLANCE_FEEDS.alertes ? respond('indisponible', 503) : respond('<!DOCTYPE html><html></html>')));
    const r = await loadCybermalveillance(NOW);
    expect([r.readAt, r.entries, r.errors]).toEqual([null, [], ['Cybermalveillance, alertes : HTTP 503', 'Cybermalveillance, actualités : page HTML reçue au lieu de données']]);
  });
});
