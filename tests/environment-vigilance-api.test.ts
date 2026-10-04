// tests/environment-vigilance-api.test.ts : vigilance Météo-France (spec 2026-10-04 environnement § 2.1, contrat § 2.1), sur
// les réponses réelles du 04/10/2026 à 10 h 00 (carte réduite à 7 domaines ; textes : national, Pyrénées-Orientales et
// les 7 blocs zonaux réels, dont ZDF_SUD rempli). Pannes amont : clé absente, 401, page HTML, défi anti-robot, partielles.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import { __resetKvForTests, __setKvClientForTests, kvSetJson } from '../api/_lib/kv-history.js';
import { DAILY_KEY, __resetVigilanceArchiveForTests } from '../api/_lib/vigilance-archive.js';
import {
  CARTE_URL, TEXTES_URL, __resetVigilanceStateForTests, meteoFranceKey, parseVigilanceCarte, parseVigilanceTextes,
} from '../api/_lib/meteo-vigilance.js';
import handler from '../api/_handlers/environment/vigilance.js';
import type { VigilanceResponse } from '../src/types/index.ts';
import { type FakeResponse, callHandler, respond, sentHeader, stubFetch } from './helpers/traffic-fixtures.ts';

const fx = (name: string): string => readFileSync(new URL(`./fixtures/environment/${name}`, import.meta.url), 'utf8');
const fxJson = <T>(name: string): T => JSON.parse(fx(name)) as T;

const NOW = Date.parse('2026-10-04T10:10:00+02:00');
const KEY = 'cle-test';

interface RawTextes { meta: unknown; product: Record<string, unknown> & { text_bloc_items: unknown[] } }

/** Textes du 04/10 : bloc national et Pyrénées-Orientales (fixture réduite), plus les 7 blocs zonaux réels, dans l'ordre publié. */
function textesDuJour(): RawTextes {
  const t = fxJson<RawTextes>('vigilance-textes-reduit.json');
  const zonal = fxJson<{ text_bloc_items: unknown[] }>('vigilance-textes-zonal.json').text_bloc_items;
  const [national, ...departemental] = t.product.text_bloc_items;
  return { ...t, product: { ...t.product, text_bloc_items: [national, ...zonal, ...departemental] } };
}

interface RawCarte { product: { periods: Array<{ echeance: string; timelaps: { domain_ids: Array<Record<string, unknown>> } }> } }

function carteDuJour(): RawCarte {
  return fxJson<RawCarte>('vigilance-encours-reduit.json');
}

/** Carte et textes réels ; `override` force la réponse d'une URL. */
function sources(override: (url: string) => FakeResponse | null = () => null): ReturnType<typeof stubFetch> {
  return stubFetch((url) => {
    const forced = override(url);
    if (forced) return forced;
    if (url === CARTE_URL) return respond(fx('vigilance-encours-reduit.json'));
    if (url === TEXTES_URL) return respond(textesDuJour());
    return respond('introuvable', 404);
  });
}

beforeEach(async () => {
  __resetSwrCacheForTests();
  __resetVigilanceStateForTests();
  __resetVigilanceArchiveForTests();
  __resetKvForTests();
  __setKvClientForTests({ get: async () => null, set: async () => undefined });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.stubEnv('METEO_FRANCE_API_KEY', KEY);
  vi.stubEnv('VITE_METEOFRANCE_API_KEY', '');
  // Archive déjà relue aujourd'hui (tâche 5) : ces tests ne lisent que la carte et les textes.
  await kvSetJson(DAILY_KEY, { days: [], checkedDay: '2026-10-04', error: null }, 3_600, NOW);
});
afterEach(() => {
  __setKvClientForTests(null);
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('carte de vigilance (cartevigilance/encours)', () => {
  it('échéance J du 04/10 : Aude et Pyrénées-Orientales en orange, Gard en jaune ; phénomènes, couleurs et créneaux publiés', () => {
    const { updateTime, periods, errors } = parseVigilanceCarte(carteDuJour());
    expect([updateTime, errors]).toEqual(['2026-10-04T08:00:12Z', []]);
    const j = periods[0];
    expect([j.echeance, j.begin, j.end, j.maxColor]).toEqual(['J', '2026-10-04T08:00:00Z', '2026-10-04T22:00:00Z', 3]);
    expect(j.comment).toBe('Un nouvel épisode pluvio-orageux actif est attendu sur les Pyrénées-orientales et l\'Aude.');
    expect(j.departments.map((d) => [d.code, d.name, d.color])).toEqual([
      ['11', 'Aude', 3], ['66', 'Pyrénées-Orientales', 3], ['30', 'Gard', 2],
    ]);
    const aude = j.departments[0];
    expect(aude.phenomena).toEqual([
      { id: '2', color: 3, slots: [
        { from: '2026-10-04T08:00:00Z', to: '2026-10-04T14:00:00Z', color: 3 },
        { from: '2026-10-04T14:00:00Z', to: '2026-10-04T18:00:00Z', color: 2 },
        { from: '2026-10-04T18:00:00Z', to: '2026-10-04T22:00:00Z', color: 1 },
      ] },
      { id: '3', color: 2, slots: [
        { from: '2026-10-04T08:00:00Z', to: '2026-10-04T18:00:00Z', color: 2 },
        { from: '2026-10-04T18:00:00Z', to: '2026-10-04T22:00:00Z', color: 1 },
      ] },
    ]);
    // Pyrénées-Orientales : crues (4) en jaune sans créneau publié, la frise prendra toute l'échéance.
    expect(j.departments[1].phenomena.map((p) => [p.id, p.color, p.slots.length])).toEqual([['2', 3, 3], ['3', 2, 2], ['4', 2, 0]]);
    expect(j.departments[2].phenomena).toEqual([{ id: '3', color: 2, slots: [
      { from: '2026-10-04T08:00:00Z', to: '2026-10-04T17:00:00Z', color: 1 },
      { from: '2026-10-04T17:00:00Z', to: '2026-10-04T22:00:00Z', color: 2 },
    ] }]);
    expect(j.greenDepartments).toBe(93);
    expect(j.counts).toEqual([{ color: 2, count: 5 }, { color: 3, count: 2 }]);
    expect(j.perPhenomenon).toEqual([
      { id: '2', anyColor: 3, counts: [{ color: 2, count: 1 }, { color: 3, count: 2 }] },
      { id: '3', anyColor: 7, counts: [{ color: 2, count: 7 }] },
      { id: '4', anyColor: 1, counts: [{ color: 2, count: 1 }] },
    ]);
  });

  it('domaine littoral « XX10 » lu (vagues-submersion), FRA et Paris (vert) hors de la liste des départements', () => {
    const j = parseVigilanceCarte(carteDuJour()).periods[0];
    expect(j.coast).toEqual([{
      code: '3010', departement: '30', name: 'Gard, littoral', color: 1,
      slots: [{ from: '2026-10-04T08:00:00Z', to: '2026-10-04T22:00:00Z', color: 1 }],
    }]);
    expect(j.departments.map((d) => d.code)).not.toContain('75');
    expect(j.departments.map((d) => d.code)).not.toContain('FRA');
  });

  it('échéance J+1 : quatre départements jaunes triés par nom, commentaire vide rendu null', () => {
    const j1 = parseVigilanceCarte(carteDuJour()).periods[1];
    expect([j1.echeance, j1.begin, j1.end, j1.maxColor, j1.comment]).toEqual(['J1', '2026-10-04T22:00:00Z', '2026-10-05T22:00:00Z', 2, null]);
    expect(j1.departments.map((d) => `${d.code} ${d.name}`)).toEqual(['11 Aude', '2A Corse-du-Sud', '30 Gard', '66 Pyrénées-Orientales']);
    expect(j1.greenDepartments).toBe(92);
    expect(j1.counts).toEqual([{ color: 2, count: 6 }]);
  });

  it('couleur hors 1 à 4 : domaine rejeté et nommé une fois, les autres gardés', () => {
    const carte = carteDuJour();
    const po = carte.product.periods[0].timelaps.domain_ids.find((d) => d.domain_id === '66');
    if (po) po.max_color_id = 7;
    const { periods, errors } = parseVigilanceCarte(carte);
    expect(errors).toEqual(['Météo-France, carte : domaine 66 illisible']);
    expect(periods[0].departments.map((d) => d.code)).toEqual(['11', '30']);
    expect(periods[1].departments.map((d) => d.code)).toContain('66');
  });

  it('domaine rejeté ou absent : jamais compté vert, nommé dans errors', () => {
    const carte = carteDuJour();
    const ids = carte.product.periods[0].timelaps.domain_ids;
    const po = ids.find((d) => d.domain_id === '66');
    if (po) po.max_color_id = 7;
    carte.product.periods[0].timelaps.domain_ids = ids.filter((d) => d.domain_id !== '13' && d.domain_id !== '75');
    const { periods, errors } = parseVigilanceCarte(carte);
    expect(periods[0].greenDepartments).toBe(93 - 2);
    expect(errors).toContain('Météo-France, carte : domaine 66 illisible');
    expect(errors).toContain('Météo-France, carte : échéance J, 2 départements absents du produit (13, 75)');
    expect(periods[1].greenDepartments).toBe(92);
  });

  it('échéance J+1 absente : nommée, J gardée', () => {
    const carte = carteDuJour();
    carte.product.periods = carte.product.periods.filter((p) => p.echeance === 'J');
    const { periods, errors } = parseVigilanceCarte(carte);
    expect(periods.map((p) => p.echeance)).toEqual(['J']);
    expect(errors).toEqual(['Météo-France, carte : échéance J+1 absente du produit']);
  });

  it('textes tiers : signes de comparaison gardés, vraies balises retirées', () => {
    const t = textesDuJour();
    const national = t.product.text_bloc_items[0] as { bloc_items: Array<{ text_items: Array<{ term_items: Array<{ subdivision_text: unknown[] }> }> }> };
    national.bloc_items[0].text_items[0].term_items[0].subdivision_text = [
      { underline_text: '', bold_text: 'Cumuls :', text: ['Cumuls < 5 mm, jusqu\'à > 10 mm', 'Ligne<br/>suivante <b>forte</b> &lt; 3 &amp; plus'] },
    ];
    const { bulletins } = parseVigilanceTextes(t);
    expect(bulletins[0].items[0].paragraphs[0].text).toEqual(['Cumuls < 5 mm, jusqu\'à > 10 mm', 'Ligne suivante forte < 3 & plus']);
  });

  it('forme inattendue : erreur levée (jamais une carte vide)', () => {
    expect(() => parseVigilanceCarte({ product: {} })).toThrow(/forme inattendue/);
    expect(() => parseVigilanceCarte({ product: { update_time: '2026-10-04T08:00:12Z', periods: [{ echeance: 'J1' }] } })).toThrow(/forme inattendue/);
  });
});

describe('textes de vigilance (textesvigilance/encours)', () => {
  it('bulletin national, 7 zones de défense dans l’ordre fixe, bulletin départemental des Pyrénées-Orientales', () => {
    const { updateTime, bulletins } = parseVigilanceTextes(textesDuJour());
    expect(updateTime).toBe('2026-10-04T08:00:12Z');
    expect(bulletins.map((b) => `${b.scope} ${b.domainId} ${b.items.length}`)).toEqual([
      'national FRA 2', 'zonal ZDF_NORD 0', 'zonal ZDF_EST 0', 'zonal ZDF_OUEST 0', 'zonal ZDF_PARIS 0', 'zonal ZDF_SUD 2',
      'zonal ZDF_SUD_EST 0', 'zonal ZDF_SUD_OUEST 0', 'departemental 66 2',
    ]);
    const [situation, suivi] = bulletins[0].items;
    expect(situation).toMatchObject({ kind: 'situation', phenomenon: null, hazard: 'tous aléas', echeance: 'J', color: 3 });
    expect(situation.paragraphs[0]).toEqual({ heading: 'Faits nouveaux', text: ['Néant.'] });
    expect(situation.paragraphs[1].heading).toBe('Situation générale');
    expect(suivi).toMatchObject({ kind: 'suivi', phenomenon: '2', hazard: 'Pluie', echeance: 'J', color: 3 });
    expect(suivi.paragraphs.map((p) => p.heading)).toEqual(['Qualification', 'Observations notables', 'Évolution prévue']);
    expect(bulletins[8].domainName).toBe('Pyrénées-Orientales');
  });

  it('zone Sud : rubrique soulignée reprise comme titre, deux termes de la même échéance réunis', () => {
    const sud = parseVigilanceTextes(textesDuJour()).bulletins.find((b) => b.domainId === 'ZDF_SUD');
    expect(sud?.domainName).toBe('Défense Sud');
    expect(sud?.items[0].paragraphs[0]).toEqual({ heading: 'Arc méditerranéen et/ou Corse', text: [] });
    const suivi = sud?.items[1];
    expect(suivi?.paragraphs.map((p) => p.heading)).toEqual([
      'Arc méditerranéen et/ou Corse', 'Qualification', 'Départements en Vigilance Orange Pluie', 'Observations notables', 'Évolution prévue',
    ]);
    expect(suivi?.paragraphs[2].text).toEqual(['Pyrénées-Orientales (66), Aude (11)']);
  });

  it('échéance « J1 » acceptée, toute autre ignorée ; zones absentes du flux gardées vides', () => {
    const t = textesDuJour();
    const national = t.product.text_bloc_items[0] as { bloc_items: Array<{ text_items: Array<{ term_items: Array<{ term_names: string }> }> }> };
    national.bloc_items[0].text_items[0].term_items[0].term_names = 'J1';
    national.bloc_items[1].text_items[0].term_items[0].term_names = 'J2';
    t.product.text_bloc_items = [national];
    const { bulletins } = parseVigilanceTextes(t);
    expect(bulletins[0].items.map((i) => `${i.kind} ${i.echeance}`)).toEqual(['situation J1']);
    expect(bulletins.filter((b) => b.scope === 'zonal').map((b) => b.items.length)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(bulletins).toHaveLength(8);
  });
});

describe('/api/environment/vigilance', () => {
  it('réponse complète du 04/10 : carte, textes, date du produit et de la lecture ; cache 5 min', async () => {
    sources();
    const { status, body, cache } = await callHandler<VigilanceResponse>(handler);
    expect([status, cache, body.errors]).toEqual([200, 's-maxage=300, stale-while-revalidate=600', []]);
    expect([body.updateTime, body.textsUpdateTime, body.readAt]).toEqual(['2026-10-04T08:00:12Z', '2026-10-04T08:00:12Z', '2026-10-04T08:10:00.000Z']);
    expect(body.periods.map((p) => p.echeance)).toEqual(['J', 'J1']);
    expect(body.bulletins).toHaveLength(9);
  });

  it('clé dans l’en-tête apikey, nettoyée des espaces ; jamais dans un message d’erreur', async () => {
    vi.stubEnv('METEO_FRANCE_API_KEY', ' cle\n-test ');
    expect(meteoFranceKey()).toBe('cle-test');
    const log = sources(() => respond('{"code":"900901","message":"Invalid Credentials"}', 401));
    const { status, body } = await callHandler<VigilanceResponse>(handler);
    expect(sentHeader(log.inits[0], 'apikey')).toBe('cle-test');
    expect(log.urls.every((u) => !u.includes('cle-test'))).toBe(true);
    expect([status, body.errors]).toEqual([502, ['Météo-France, carte : HTTP 401', 'Météo-France, textes : HTTP 401']]);
    expect(JSON.stringify(body)).not.toContain('cle-test');
  });

  it('repli sur VITE_METEOFRANCE_API_KEY', () => {
    vi.stubEnv('METEO_FRANCE_API_KEY', '');
    vi.stubEnv('VITE_METEOFRANCE_API_KEY', 'cle-vite');
    expect(meteoFranceKey()).toBe('cle-vite');
  });

  it('clé absente : 502 non mis en cache, « Météo-France : clé absente », aucun appel', async () => {
    vi.stubEnv('METEO_FRANCE_API_KEY', '');
    const log = sources();
    const { status, body, cache } = await callHandler<VigilanceResponse>(handler);
    expect([status, cache, body.errors, log.urls.length]).toEqual([502, 'no-store', ['Météo-France : clé absente'], 0]);
    expect([body.updateTime, body.periods, body.bulletins, body.readAt]).toEqual([null, [], [], null]);
  });

  it('carte en panne, textes lus : 200 partiel, panne nommée, cache CDN court', async () => {
    sources((url) => (url === CARTE_URL ? respond('{"error":"x"}', 500) : null));
    const { status, body, cache } = await callHandler<VigilanceResponse>(handler);
    expect([status, cache, body.errors]).toEqual([200, 's-maxage=300, stale-while-revalidate=600', ['Météo-France, carte : HTTP 500']]);
    expect([body.updateTime, body.periods, body.readAt, body.textsUpdateTime]).toEqual([null, [], null, '2026-10-04T08:00:12Z']);
  });

  it('textes en panne, carte lue : 200 partiel, bulletins vides et panne nommée', async () => {
    sources((url) => (url === TEXTES_URL ? respond('{"code":"900901"}', 401) : null));
    const { status, body } = await callHandler<VigilanceResponse>(handler);
    expect([status, body.errors, body.bulletins, body.textsUpdateTime]).toEqual([200, ['Météo-France, textes : HTTP 401'], [], null]);
    expect(body.periods[0].departments).toHaveLength(3);
  });

  it('page HTML à la place du JSON : panne nommée', async () => {
    sources((url) => (url === CARTE_URL ? respond('<!DOCTYPE html><html><body>Maintenance du portail</body></html>') : null));
    const { body } = await callHandler<VigilanceResponse>(handler);
    expect(body.errors).toEqual(['Météo-France, carte : page HTML reçue au lieu de données']);
  });

  it('défi anti-robot servi en 200 puis en 403 : panne nommée, jamais lue comme une carte', async () => {
    const challenge = '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>cf-chl-bypass</body></html>';
    sources((url) => (url === CARTE_URL ? respond(challenge) : url === TEXTES_URL ? respond(challenge, 403) : null));
    const { status, body } = await callHandler<VigilanceResponse>(handler);
    expect([status, body.errors]).toEqual([502, ['Météo-France, carte : page de contrôle anti-robot', 'Météo-France, textes : page de contrôle anti-robot (HTTP 403)']]);
  });

  it('une seule lecture par partie en 5 min ; ensuite carte en panne : dernière carte servie avec sa date et panne nommée', async () => {
    let carteDown = false;
    const log = sources((url) => (url === CARTE_URL && carteDown ? respond('{"error":"x"}', 500) : null));
    await callHandler<VigilanceResponse>(handler);
    await callHandler<VigilanceResponse>(handler);
    expect(log.urls.filter((u) => u === CARTE_URL)).toHaveLength(1);
    carteDown = true;
    vi.setSystemTime(NOW + 6 * 60_000);
    const { status, body } = await callHandler<VigilanceResponse>(handler);
    expect(log.urls.filter((u) => u === CARTE_URL)).toHaveLength(2);
    expect([status, body.updateTime, body.readAt, body.errors]).toEqual([200, '2026-10-04T08:00:12Z', '2026-10-04T08:10:00.000Z', ['Météo-France, carte : HTTP 500']]);
  });
});
