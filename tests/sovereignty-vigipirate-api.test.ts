// tests/sovereignty-vigipirate-api.test.ts : relecture quotidienne de la page Vigipirate du SGDSN (amendement 7, O14 ; arbitrage du
// contrôleur : route /api/sovereignty/vigipirate, forme VigipiratePageCheck). Page réelle enregistrée le 04/10/2026
// (tests/fixtures/sovereignty/sgdsn-vigipirate.html). L'empreinte porte sur le texte principal de la section Vigipirate, sans
// menus, scripts ni dates de mise à jour : un changement cosmétique ne compte pas, un changement de stade ou de date d'effet compte.
// Le texte de la page n'est jamais gardé ni servi.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetKvForTests, __setKvClientForTests, kvGetJson } from '../api/_lib/kv-history.js';
import { SOURCE_USER_AGENT } from '../api/_lib/source-http.js';
import {
  VIGIPIRATE_INTERVAL_MS, VIGIPIRATE_KEY, VIGIPIRATE_PAGE_URL, VIGIPIRATE_RETRY_MS, __resetVigipirateForTests, ensureVigipirateFresh,
  vigipirateFingerprint,
} from '../api/_lib/vigipirate-page.js';
import handler, { CACHE_CONTROL } from '../api/_handlers/sovereignty/vigipirate.js';
import type { VigipiratePageCheck } from '../src/types/index.ts';
import { callHandler, respond, sentHeader, stubFetch } from './helpers/traffic-fixtures.ts';

const PAGE = readFileSync(new URL('./fixtures/sovereignty/sgdsn-vigipirate.html', import.meta.url), 'utf8');
const NOW = Date.parse('2026-10-04T16:48:30+02:00');
const DAY = 86_400_000;
const PROSE_END = '</p>\n\n  </div>';

/** Page réelle dont le texte principal passe au stade « alerte attentat ». */
const ALERTE_ATTENTAT = PAGE.replace('Positionnée au nouveau stade «&nbsp;vigilance renforcée&nbsp;»', 'Positionnée au nouveau stade «&nbsp;alerte attentat&nbsp;»');

function page(html: string) {
  return stubFetch((url) => (url === VIGIPIRATE_PAGE_URL ? respond(html) : respond('introuvable', 404)));
}

beforeEach(() => {
  __resetKvForTests();
  __setKvClientForTests({ get: async () => null, set: async () => undefined });
  __resetVigipirateForTests();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => { __setKvClientForTests(null); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('empreinte du texte principal de la page Vigipirate', () => {
  it('SHA-256 hexadécimal, stable pour la même page', () => {
    expect(vigipirateFingerprint(PAGE)).toMatch(/^[0-9a-f]{64}$/);
    expect(vigipirateFingerprint(PAGE)).toBe(vigipirateFingerprint(PAGE));
  });
  it('changements cosmétiques sans effet : scripts, menus, pied de page, tuiles, images, classes, espaces, casse, date de mise à jour', () => {
    const cosmetic = PAGE
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '<script>var t = 42;</script>')
      .replace('aria-label="Menu principal">', 'aria-label="Menu principal"><a href="/nouveau">Nouvelle rubrique</a>')
      .replace('<footer class="fr-footer"', '<footer class="fr-footer"><p>Plan du site révisé le 4 octobre 2026</p></footer><footer class="x"')
      .replace('Les affiches de sensibilisation\n', 'Les nouvelles affiches de sensibilisation\n')
      .replace('Logo_Vigipirate_orange_RVB.jpg', 'Logo_Vigipirate_rouge.png')
      .replace('class="fr-prose"', 'class="fr-prose fr-mt-2w"')
      .replace('prend effet à compter du', 'prend  effet\n à compter du')
      .replace('nouveau plan VIGIPIRATE 2026', 'nouveau plan Vigipirate 2026')
      .replace('«&nbsp;été-automne 2026&nbsp;» prend', '« été-automne 2026 » prend')
      .replace(PROSE_END, `</p><p>Mis à jour le 03/10/2026</p><p><time datetime="2026-10-03">3 octobre 2026</time></p>${PROSE_END}`);
    expect(cosmetic).not.toBe(PAGE);
    expect(vigipirateFingerprint(cosmetic)).toBe(vigipirateFingerprint(PAGE));
  });
  it('changement du texte utile : stade, date d’effet, accent de la posture', () => {
    const base = vigipirateFingerprint(PAGE);
    expect(vigipirateFingerprint(ALERTE_ATTENTAT)).not.toBe(base);
    expect(vigipirateFingerprint(PAGE.replace('<strong>22 juin 2026</strong>', '<strong>23 juin 2026</strong>'))).not.toBe(base);
    expect(vigipirateFingerprint(PAGE.replace('la sécurité des bâtiments publics et institutionnels.', 'la sécurité des transports.'))).not.toBe(base);
  });
  it('page sans texte Vigipirate lisible (maintenance, page d’erreur servie en 200) : erreur, jamais une empreinte', () => {
    expect(() => vigipirateFingerprint('<!doctype html><html><body><main><p>Site en maintenance</p></main></body></html>')).toThrow('page sans posture Vigipirate lisible');
    expect(() => vigipirateFingerprint('<!doctype html><html><body><p>Vigipirate vigilance</p></body></html>')).toThrow('page sans texte principal');
  });
});

describe('/api/sovereignty/vigipirate : relecture quotidienne', () => {
  it('première lecture : 200, empreinte, aucun changement vu ; une seule lecture, en-tête FranceMonitor', async () => {
    const log = page(PAGE);
    const { status, body, cache } = await callHandler<VigipiratePageCheck>(handler);
    expect([status, cache]).toEqual([200, CACHE_CONTROL]);
    expect(body).toEqual({ readAt: '2026-10-04T14:48:30.000Z', fingerprint: vigipirateFingerprint(PAGE), pageChangedAt: null, errors: [] });
    expect(log.urls).toEqual([VIGIPIRATE_PAGE_URL]);
    expect(sentHeader(log.inits[0], 'User-Agent')).toBe(SOURCE_USER_AGENT);
  });
  it('une lecture par jour : rien avant 24 h, une lecture ensuite', async () => {
    const log = page(PAGE);
    await ensureVigipirateFresh(NOW);
    for (const t of [NOW + 60_000, NOW + 6 * 3_600_000, NOW + VIGIPIRATE_INTERVAL_MS - 60_000]) {
      vi.setSystemTime(t);
      await ensureVigipirateFresh(t);
    }
    expect(log.urls).toHaveLength(1);
    vi.setSystemTime(NOW + VIGIPIRATE_INTERVAL_MS);
    const body = await ensureVigipirateFresh(NOW + VIGIPIRATE_INTERVAL_MS);
    expect(log.urls).toHaveLength(2);
    expect([body.readAt, body.pageChangedAt]).toEqual(['2026-10-05T14:48:30.000Z', null]);
  });
  it('empreinte changée : pageChangedAt daté de la lecture qui l’a vue, gardé ensuite', async () => {
    page(PAGE);
    const first = await ensureVigipirateFresh(NOW);
    page(ALERTE_ATTENTAT);
    vi.setSystemTime(NOW + DAY);
    const changed = await ensureVigipirateFresh(NOW + DAY);
    expect(changed.fingerprint).not.toBe(first.fingerprint);
    expect([changed.readAt, changed.pageChangedAt, changed.errors]).toEqual(['2026-10-05T14:48:30.000Z', '2026-10-05T14:48:30.000Z', []]);
    vi.setSystemTime(NOW + 2 * DAY);
    const next = await ensureVigipirateFresh(NOW + 2 * DAY);
    expect([next.readAt, next.fingerprint, next.pageChangedAt]).toEqual(['2026-10-06T14:48:30.000Z', changed.fingerprint, '2026-10-05T14:48:30.000Z']);
  });
  it('changement cosmétique : empreinte inchangée, aucun changement vu', async () => {
    page(PAGE);
    await ensureVigipirateFresh(NOW);
    page(PAGE.replace('class="fr-prose"', 'class="fr-prose fr-mb-4w"'));
    vi.setSystemTime(NOW + DAY);
    const body = await ensureVigipirateFresh(NOW + DAY);
    expect([body.fingerprint, body.pageChangedAt]).toEqual([vigipirateFingerprint(PAGE), null]);
  });
  it('page de contrôle anti-robot : erreur nommée, jamais « inchangé » ; dernière lecture gardée avec sa date ; nouvel essai une heure plus tard', async () => {
    page(PAGE);
    await ensureVigipirateFresh(NOW);
    const log = page('<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>cf-chl-</body></html>');
    vi.setSystemTime(NOW + DAY);
    const blocked = await ensureVigipirateFresh(NOW + DAY);
    expect(blocked).toEqual({
      readAt: '2026-10-04T14:48:30.000Z', fingerprint: vigipirateFingerprint(PAGE), pageChangedAt: null,
      errors: ['SGDSN, page Vigipirate : page de contrôle anti-robot'],
    });
    vi.setSystemTime(NOW + DAY + VIGIPIRATE_RETRY_MS - 60_000);
    await ensureVigipirateFresh(NOW + DAY + VIGIPIRATE_RETRY_MS - 60_000);
    expect(log.urls).toHaveLength(1);
    page(PAGE);
    vi.setSystemTime(NOW + DAY + VIGIPIRATE_RETRY_MS);
    const back = await ensureVigipirateFresh(NOW + DAY + VIGIPIRATE_RETRY_MS);
    expect([back.readAt, back.pageChangedAt, back.errors]).toEqual(['2026-10-05T15:48:30.000Z', null, []]);
  });
  it('page illisible ou HTTP 503 après une lecture : erreur nommée, empreinte précédente gardée, pas de changement inventé', async () => {
    page(PAGE);
    await ensureVigipirateFresh(NOW);
    page('<!doctype html><html><body><main><p>Site en maintenance</p></main></body></html>');
    vi.setSystemTime(NOW + DAY);
    const unreadable = await ensureVigipirateFresh(NOW + DAY);
    expect([unreadable.fingerprint, unreadable.pageChangedAt, unreadable.errors]).toEqual([
      vigipirateFingerprint(PAGE), null, ['SGDSN, page Vigipirate : page sans posture Vigipirate lisible'],
    ]);
    stubFetch(() => respond('indisponible', 503));
    vi.setSystemTime(NOW + DAY + VIGIPIRATE_RETRY_MS);
    const { status, body } = await callHandler<VigipiratePageCheck>(handler);
    expect([status, body.readAt, body.errors]).toEqual([200, '2026-10-04T14:48:30.000Z', ['SGDSN, page Vigipirate : HTTP 503']]);
  });
  it('jamais lue : 502 non mis en cache, panne nommée', async () => {
    stubFetch(() => respond('indisponible', 503));
    const { status, body, cache } = await callHandler<VigipiratePageCheck>(handler);
    expect([status, cache]).toEqual([502, 'no-store']);
    expect(body).toEqual({ readAt: null, fingerprint: null, pageChangedAt: null, errors: ['SGDSN, page Vigipirate : HTTP 503'] });
  });
  it('le texte de la page n’est ni servi ni gardé : empreinte et dates seulement', async () => {
    page(PAGE);
    const body = await ensureVigipirateFresh(NOW);
    const stored = await kvGetJson(VIGIPIRATE_KEY, NOW);
    for (const value of [JSON.stringify(body), JSON.stringify(stored)]) {
      expect(value).not.toMatch(/vigilance|posture|attentat|sgdsn/i);
    }
    expect(Object.keys(body).sort()).toEqual(['errors', 'fingerprint', 'pageChangedAt', 'readAt']);
  });
});
