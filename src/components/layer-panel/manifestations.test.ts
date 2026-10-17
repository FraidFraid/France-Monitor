// src/components/layer-panel/manifestations.test.ts : vue pure du panneau Manifestations.
import { describe, expect, it } from 'vitest';
import type { ProtestItem, ProtestsResponse } from '../../types/index.ts';
import { visibleText } from './format.ts';
import { renderLayerView } from './frame.ts';
import { buildManifestationsView, bucketProtests, protestsHeadLevel, protestsTodayCount } from './manifestations.ts';
import { PROTESTS_LEGEND, protestsLegend } from './manifestations-legend.ts';

const DASH = String.fromCharCode(0x2014);
// Samedi 17 octobre 2026, 11:00 à Paris.
const NOW = Date.parse('2026-10-17T09:00:00Z');
const ann = (over: Partial<ProtestItem> = {}): ProtestItem => ({
  id: 'd1', source: 'demosphere', status: 'annonce', title: 'Rassemblement pour la paix', startsAt: '2026-10-17T13:00:00.000Z', allDay: false,
  city: 'Toulouse', dept: '31', lat: 43.6, lon: 1.44, url: 'https://demosphere.net/rv/1', edition: 'Toulouse', violent: false, participants: null, precision: 'commune', articles: [], articleCount: 0, ...over,
});
const sig = (over: Partial<ProtestItem> = {}): ProtestItem => ({
  id: 'g1', source: 'gdelt', status: 'signale', title: 'Manifestation', startsAt: '2026-10-17T08:30:00.000Z', allDay: false, city: 'Paris', dept: null,
  lat: 48.85, lon: 2.35, url: null, edition: null, violent: false, participants: null, precision: 'commune', articleCount: 1,
  articles: [{ url: 'https://exemple.fr/a', domain: 'exemple.fr', seenAt: '2026-10-17T08:30:00.000Z', violent: false, title: null, outlet: null }], ...over,
});
const body = (items: ProtestItem[], over: Partial<ProtestsResponse> = {}): ProtestsResponse => ({
  readAt: '2026-10-17T08:55:00.000Z', items,
  demosphere: { readAt: '2026-10-17T08:55:00.000Z', editions: 19, failedEditions: [], scanned: 100 },
  gdelt: { readAt: '2026-10-17T08:50:00.000Z', files: 96, missingFiles: 0 }, presse: { readAt: null, scanned: 0, matched: 0, unplaced: 0 }, errors: [], ...over,
});
const view = (d: ProtestsResponse | null, error: string | null = null) =>
  buildManifestationsView({ data: d, error, canFocus: true, now: NOW, open: (_id, byDefault) => byDefault });
const text = (d: ProtestsResponse | null, error: string | null = null) => visibleText(renderLayerView('protests', view(d, error)));
const full = (): ProtestsResponse => body([
  sig({ violent: true, articles: [{ url: 'https://exemple.fr/a', domain: 'exemple.fr', seenAt: '2026-10-17T08:30:00.000Z', violent: true, title: null, outlet: null }] }),
  ann(),
  ann({ id: 'd2', title: 'Marche demain', startsAt: '2026-10-18T14:00:00.000Z', city: 'Lyon', dept: '69', lat: 45.7, lon: 4.8 }),
  ann({ id: 'd3', title: 'Sans lieu', lat: null, lon: null, city: null, dept: null, allDay: true }),
]);

describe('répartition', () => {
  it('signalés, aujourd’hui, prochains jours et sans lieu précis', () => {
    const b = bucketProtests(full().items, NOW);
    expect(b.signaled).toHaveLength(1);
    expect(b.today.map((x) => x.id)).toEqual(['d1']);
    expect(b.upcoming.map((d) => d.day)).toEqual(['2026-10-18']);
    expect(b.unplaced.map((x) => x.id)).toEqual(['d3']);
  });
  it('une annonce commencée la veille (encore dans la fenêtre) reste dans « aujourd’hui »', () => {
    expect(bucketProtests([ann({ startsAt: '2026-10-16T22:30:00.000Z' })], NOW).today).toHaveLength(1);
  });
});

describe('pastille', () => {
  it('chiffre = annonces du jour (lieu connu ou non) + signalés ; les jours suivants ne comptent pas', () => {
    expect(protestsTodayCount(full().items, NOW)).toBe(3);
  });
  it('orange si heurts signalés, jaune si signalé, vert sinon', () => {
    expect(protestsHeadLevel(full(), NOW)).toBe('orange');
    expect(protestsHeadLevel(body([sig()]), NOW)).toBe('jaune');
    expect(protestsHeadLevel(body([ann()]), NOW)).toBe('vert');
  });
  it('n.d. sans relevé lisible ou en retard', () => {
    expect(protestsHeadLevel(null, NOW)).toBe('nd');
    expect(protestsHeadLevel(body([], { readAt: null }), NOW)).toBe('nd');
    expect(protestsHeadLevel(body([], { readAt: '2026-10-17T07:00:00.000Z' }), NOW)).toBe('nd');
    const v = view(null, 'HTTP 502');
    expect(v.head.level).toBe('nd');
    expect(v.head.figure?.value).toBe('n.d.');
  });
  it('en-tête : chiffre et légende « aujourd’hui »', () => {
    const v = view(full());
    expect(v.head.figure).toMatchObject({ value: '3', caption: 'aujourd’hui', level: 'orange' });
  });
});

describe('sections et contenu', () => {
  it('six sections dans l’ordre voulu', () => {
    expect(view(full()).sections.map((s) => s.id)).toEqual(['presse', 'monde', 'aujourdhui', 'prochains', 'sans-lieu', 'methode']);
  });
  it('presse française : lieux par nombre d’articles, participants insécables, titres en liens, département dit', () => {
    const fr = (over: Partial<ProtestItem>): ProtestItem => sig({
      source: 'presse', articleCount: 2, participants: null,
      articles: [{ url: 'https://lequotidien.fr/a', domain: 'lequotidien.fr', seenAt: '2026-10-17T08:30:00.000Z', violent: false, title: '800 personnes rassemblées à Gap', outlet: 'Le Dauphiné' }],
      ...over,
    });
    const d = body([
      fr({ id: 'p1', city: 'Gap', lat: 44.56, lon: 6.08, participants: 800 }),
      fr({ id: 'p2', city: 'Paris', articleCount: 40, violent: true }),
      fr({ id: 'p3', city: 'Vendée', precision: 'departement', lat: 46.6, lon: -1.3 }),
    ]);
    const b = bucketProtests(d.items, NOW);
    expect(b.press.map((x) => x.city)).toEqual(['Paris', 'Gap', 'Vendée']);
    expect(b.world).toEqual([]);
    const html = renderLayerView('protests', view(d));
    expect(html).toContain('800\u00a0pers.');
    expect(html).toContain('href="https://lequotidien.fr/a"');
    const t = visibleText(html);
    expect(t).toContain('Le Dauphiné');
    expect(t).toContain('800 personnes rassemblées à Gap');
    expect(t).toContain('Vendée (département)');
    expect(t).toContain('40 articles');
    expect(view(d).sections[0].summary).toBe('3 lieux · 1 avec heurts');
  });
  it('presse : badge heurts, lieu ou « France, sans lieu précis », articles en liens externes avec heure de Paris', () => {
    const t = text(body([sig({ violent: true }), sig({ id: 'g2', city: null, lat: null, lon: null })]));
    expect(t).toContain('heurts');
    expect(t).toContain('France, sans lieu précis');
    const html = renderLayerView('protests', view(body([sig()])));
    expect(html).toContain('href="https://exemple.fr/a"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('noopener');
    expect(html).toMatch(/exemple\.fr\u00a010:30/);
  });
  it('aujourd’hui : groupé par ville · département, heure ou « journée », dit « annoncé », lien Démosphère', () => {
    const html = renderLayerView('protests', view(full()));
    const t = text(full());
    expect(t).toContain('Toulouse · 31');
    expect(t).toContain('15:00');
    expect(t).toContain('annoncé, non confirmé');
    expect(html).toContain('href="https://demosphere.net/rv/1"');
    expect(t).toContain('journée');
  });
  it('prochains jours : groupés par date en toutes lettres', () => {
    expect(text(full())).toContain('dimanche 18 octobre');
  });
  it('méthode : agenda militant non confirmé, GDELT, aucun effet sur l’indice', () => {
    const t = text(full());
    expect(t).toContain('Démosphère');
    expect(t).toContain('19');
    expect(t).toContain('Paris presque vide');
    expect(t).toContain('n’est pas une manifestation constatée');
    expect(t).toContain('GDELT');
    expect(t).toContain('aucun effet sur l’indice de stabilité');
  });
  it('erreurs de lecture et éditions illisibles nommées ; relevé daté par source', () => {
    const t = text(body([], { errors: ['Démosphère : HTTP 500'], demosphere: { readAt: null, editions: 19, failedEditions: ['Lille'], scanned: 0 } }));
    expect(t).toContain('Démosphère : HTTP 500');
    expect(t).toContain('Lille');
    expect(t).toContain('injoignable');
    expect(t).toContain('relevé');
  });
  it('lignes vides explicites, jamais une section muette', () => {
    const t = text(body([]));
    expect(t).toContain('Aucune manifestation rapportée par la presse française');
    expect(t).toContain('Aucun autre signalement de la presse mondiale');
    expect(t).toContain('Aucun rendez-vous annoncé aujourd’hui');
  });
  it('chargement : ni donnée ni erreur', () => {
    expect(view(null).bodyHtml).toBeDefined();
    expect(view(null).sections).toEqual([]);
  });
  it('lignes placées cliquables avec leur clé de position', () => {
    const html = renderLayerView('protests', view(full()));
    expect(html).toContain('data-protest="43.6,1.44"');
    expect(html).toContain('is-link');
  });
});

describe('texte tiers', () => {
  it('titres, villes, adresses et domaines échappés', () => {
    const evil = '<script>alert(1)</script>';
    const html = renderLayerView('protests', view(body([
      ann({ title: evil, city: evil, url: 'javascript:alert(1)' }),
      sig({ city: evil, title: evil, articles: [{ url: 'https://x.fr/"><img src=x>', domain: evil, seenAt: '2026-10-17T08:30:00.000Z', violent: false, title: null, outlet: null }] }),
    ])));
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x>');
    expect(html).not.toContain('javascript:alert');
  });
  it('aucun tiret cadratin dans la sortie, ni dans la légende', () => {
    expect(renderLayerView('protests', view(full()))).not.toContain(DASH);
    expect(renderLayerView('protests', view(null, 'HTTP 502'))).not.toContain(DASH);
    expect(JSON.stringify(protestsLegend(full(), NOW))).not.toContain(DASH);
  });
});

describe('légende', () => {
  it('trois couleurs, catégorie protests, datée du relevé', () => {
    expect(PROTESTS_LEGEND.id).toBe('protests');
    expect(PROTESTS_LEGEND.items.map((i) => i.label)).toEqual(['Heurts signalés (presse)', 'Signalé par la presse', 'Annoncé (agenda militant)']);
    expect(protestsLegend(full(), NOW).notes?.[0]).toContain('relevé');
    expect(protestsLegend(null, NOW).notes?.[0]).toContain('indisponibles');
  });
});
