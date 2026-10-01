import { describe, it, expect } from 'vitest';
import { buildFranceFiche, franceChangeDigest, type FranceFicheInput, type FranceFicheSnapshot } from './france.ts';
import { renderFiche } from './parts.ts';
import { buildWorkQueue } from '../../services/work-queue.ts';
import type {
  ChangeDigestItem,
  DetectedSituation,
  FranceCountrySignals,
  FranceScoreBreakdown,
  IntelEventsState,
  NewsEvent,
  StructuredBrief,
} from '../../types/index.ts';

const NOW = Date.parse('2026-09-24T08:00:00Z');
const H = 3600_000;

function breakdown(score = 43): FranceScoreBreakdown {
  return {
    score,
    baseline: 95,
    pillars: [
      { key: 'continuity', value: 61, deduction: 18.9, components: [{ label: 'Carburants & pétrole', value: 100 }] },
      { key: 'security', value: 57, deduction: 14.7, components: [] },
      { key: 'signal', value: 28, deduction: 3.4, components: [] },
      { key: 'defense', value: 65, deduction: 8.8, components: [] },
    ],
    shockValue: 55,
    shockExtra: 1.3,
    situationCap: 55,
  };
}

function signals(): FranceCountrySignals {
  return {
    criticalNews: 0, highNews: 0, topNewsCount: 0, meteoAlerts: 0, floodAlerts: 0, fireDetections: 0,
    railDisruptions: 0, railSevere: 0, roadIncidents: 0, powerOutages: 0, telecomOutages: 0,
    cyberAlerts: 0, cyberCritical: 0, militaryFlights: 0, maritimeTrafficFrance: 0,
    defenseAlerts: 0, defenseHigh: 0, jammingSignals: 0, marketStress: 0,
  };
}

function situation(over: Partial<DetectedSituation> = {}): DetectedSituation {
  return {
    id: 'energy-stress', type: 'ENERGY_STRESS', severity: 'high', confidence: 0.8, title: 'Tension énergétique nationale',
    summary: 'Signal Écowatt orange confirmé.', affectedZones: ['Bretagne'], drivers: [], recommendedActions: [],
    sourceRefs: ['Ecowatt RTE'], updatedAt: new Date(NOW), ...over,
  };
}

function event(over: Partial<NewsEvent> = {}): NewsEvent {
  return {
    id: 42, evidenceId: 'E42', title: 'Explosion dans une usine chimique', category: 'security', severity: 'critical',
    status: 'active', firstSeen: '2026-09-24T07:30:00Z', lastSeen: '2026-09-24T07:50:00Z', articleCount: 3,
    sourceCount: 3, independentCount: 3, sourceNames: ['France Info'], lat: 49.4, lon: 1.1, ...over,
  };
}

function eventsState(over: Partial<IntelEventsState> = {}): IntelEventsState {
  return { events: [event()], digest: [], totals: {}, anchor: { since: NOW - 3 * H, kind: 'last-visit' }, fetchedAt: NOW, unavailable: false, ...over };
}

const BRIEF: StructuredBrief = {
  bluf: 'France en vigilance rouge, en dégradation sur 24 h.',
  judgments: [{
    priority: 1, text: 'L’approvisionnement restera tendu 48 h.', confidence: 'high',
    sources: ['SDES'], evidence: ['E42', 'S1'], unsupported: false,
  }],
  watch: [{ text: 'Signal Écowatt de demain', horizon: '6h' }],
  origin: 'llm',
};

function snapshot(over: Partial<FranceFicheSnapshot> = {}): FranceFicheSnapshot {
  return {
    score: 43, scoreBreakdown: breakdown(43), situations: [situation()], signals: signals(), meteo: [], energy: null,
    timeline: { days: [], lanes: [] }, ...over,
  };
}

function input(over: Partial<FranceFicheInput> = {}): FranceFicheInput {
  const snap = over.snapshot ?? snapshot();
  const events = over.events === undefined ? eventsState() : over.events;
  const queue = buildWorkQueue({
    situations: snap.situations, alerts: [], events, ecowatt: null, meteo: [], floods: [], markets: [],
    baseline: {}, firstSeen: new Map(), lang: 'fr',
  });
  return {
    snapshot: snap, queue, drivers: ['energy'], brief: { brief: BRIEF, freshness: 'fresh' }, briefSituationIds: ['energy-stress'],
    events, resolved: [], changeTimes: new Map(), score: { delta24h: -4, pillarDeltas: null, series: [81, 70, 43] },
    briefMeta: { at: NOW - 30 * 60_000, level: 'orange' },
    freshness: '33 sources sur 35 à jour', infra: null, sectionOpen: new Map(), ready: true, lang: 'fr', now: NOW, ...over,
  };
}

const sectionTitles = (html: string): string[] => [...html.matchAll(/<h3 class="fiche-part-title fmk-eyebrow">([^<]*)<\/h3>/g)].map((m) => m[1] ?? '');
const section = (id: string) => (over: Partial<FranceFicheInput> = {}) => buildFranceFiche(input(over)).sections.find((s) => s.id === id);

describe('onglet État de la France (spec 2026-09-29 § 7)', () => {
  it('en-tête Instrument, puis Situations, Note, Depuis votre visite, indicateurs, Preuves et sources', () => {
    const model = buildFranceFiche(input());
    expect(model.score).not.toBe('pending');
    expect(sectionTitles(renderFiche(model, 'fr'))).toEqual([
      'Situations actives', 'Note de situation', 'Depuis votre dernière visite',
      'Infrastructures', 'Domaines', 'Énergie', 'Chronologie 7 jours', 'Preuves et sources',
    ]);
  });

  it('ouvertures par défaut : situations et note ouvertes, le reste replié ; situations non repliable', () => {
    const byId = new Map(buildFranceFiche(input()).sections.map((s) => [s.id, s]));
    expect(byId.get('situations')?.collapsible).toBe(false);
    expect(byId.get('note')).toMatchObject({ collapsible: true, open: true });
    for (const id of ['changes', 'infra', 'domains', 'energy', 'timeline', 'sources']) expect(byId.get(id)).toMatchObject({ collapsible: true, open: false });
  });

  it('état retenu par section : remplace la valeur par défaut', () => {
    const byId = new Map(buildFranceFiche(input({ sectionOpen: new Map([['note', false], ['infra', true]]) })).sections.map((s) => [s.id, s]));
    expect(byId.get('note')?.open).toBe(false);
    expect(byId.get('infra')?.open).toBe(true);
  });

  it('score : valeur, niveau, piliers dans l’ordre, écart formaté, facteur, plafond', () => {
    const score = buildFranceFiche(input()).score;
    if (score === undefined || score === 'pending') throw new Error('score attendu');
    expect(score).toMatchObject({ value: 43, level: 'rouge', baseline: 95, delta24h: '−4 ▼', cap: 55 });
    expect(score.pillars.map((p) => p.label)).toEqual(['Continuité', 'Sécurité', 'Signal', 'Défense']);
    expect(score.pillars[0]).toMatchObject({ value: 61, level: 'orange', delta: 'n.d.', deduction: '−18,9' });
    expect(score.factor).toContain('Continuité (Carburants &amp; pétrole 100');
    expect(score.sparkline).toContain('frintel-spark');
  });

  it('avant les couches critiques : score en attente, ni indice ni piliers', () => {
    const model = buildFranceFiche(input({ ready: false, snapshot: snapshot({ score: 95, scoreBreakdown: breakdown(95), situations: [] }) }));
    expect(model.score).toBe('pending');
    const html = renderFiche(model, 'fr');
    expect(html).toContain('Calcul du niveau national…');
    for (const part of ['fmk-scale', 'fmk-meters--pillars', '95/100']) expect(html).not.toContain(part);
  });

  it('note : « En bref », jugements avec preuves cliquables, à surveiller ; résumé IA, heure, niveau de rédaction', () => {
    const note = section('note')();
    expect(note?.html).toContain('<b>En bref :</b> France en vigilance rouge, en dégradation sur 24 h.');
    expect(note?.html).toContain('data-select="event:42"');
    expect(note?.html).toContain('6 h');
    expect(note?.html).not.toContain('Rédigée à');
    expect(note?.html).not.toContain('Brief : IA');
    expect(note?.summary).toMatch(/^IA · rédigée \d{2}:\d{2} · au niveau orange$/);
  });

  it('note : en cache, synthèse automatique, même niveau, en préparation', () => {
    const cached = section('note')({ brief: { brief: BRIEF, freshness: 'cached' } });
    expect(cached?.summary).toMatch(/^IA, en cache · rédigée/);
    const auto = section('note')({ brief: { brief: { ...BRIEF, origin: 'deterministic' }, freshness: 'fresh' } });
    expect(auto?.summary).toMatch(/^Synthèse automatique · rédigée/);
    expect(section('note')({ briefMeta: { at: NOW - 30 * 60_000, level: 'rouge' } })?.summary).not.toContain('au niveau');
    const none = section('note')({ brief: null, briefMeta: null });
    expect(none?.summary).toBe('en préparation');
    expect(none?.html).toContain('Synthèse nationale en cours de préparation…');
    expect((none?.html ?? '') + (none?.summary ?? '')).not.toContain('indisponible');
  });

  it('note périmée (plus de 12 h) : contenu grisé avec sa date, résumé grisé', () => {
    const note = section('note')({ briefMeta: { at: NOW - 13 * H, level: 'orange' } });
    expect(note?.html).toContain('fiche-stale');
    expect(note?.html).toContain('données du');
    expect(note?.summary).toContain('<span class="fmk-stale">');
  });

  it('depuis la visite : résumé du nombre de changements, chargement, aucun', () => {
    expect(section('changes')({ events: null })?.summary).toBe('chargement…');
    const events = Array.from({ length: 2 }, (_, i) => event({ id: 100 + i, title: `Événement ${i}`, severity: 'high' }));
    const digest: ChangeDigestItem[] = events.map((e) => ({ event: e, kinds: ['created'], latestAt: '2026-09-24T07:40:00Z', severityFrom: null, independentFrom: null }));
    expect(section('changes')({ events: eventsState({ events, digest }) })?.summary).toBe('3 changements orange ou rouges');
    expect(section('changes')({ snapshot: snapshot({ situations: [] }), events: eventsState({ events: [], digest: [] }) })?.summary).toBe('aucun changement orange ou rouge');
  });

  it('situations : nombre en résumé ; aucune : message', () => {
    expect(section('situations')()?.summary).toBe('1');
    const none = section('situations')({ snapshot: snapshot({ situations: [] }) });
    expect(none?.summary).toBe('0');
    expect(none?.html).toContain('Aucune situation active.');
  });

  it('preuves et sources : section repliable, résumé compté, plus de partie séparée', () => {
    const model = buildFranceFiche(input());
    const sources = model.sections.find((s) => s.id === 'sources');
    expect(sources?.summary).toBe('2 preuves · 1 source');
    expect(sources?.html).toContain('E42 · Explosion dans une usine chimique');
    expect(sources?.html).toContain('SDES');
    expect(buildFranceFiche(input({ brief: null })).sections.find((s) => s.id === 'sources')).toBeUndefined();
  });

  it('carburants seulement quand l’énergie en porte', () => {
    expect(buildFranceFiche(input()).sections.find((s) => s.id === 'fuel')).toBeUndefined();
  });

  it('preuves lisibles et sources nommées des jugements', () => {
    const html = renderFiche(buildFranceFiche(input()), 'fr');
    expect(html).toContain('E42 · Explosion dans une usine chimique');
    expect(html).toContain('SDES');
  });

  it('note en attente : « en cours de préparation », jamais « indisponible »', () => {
    const note = buildFranceFiche(input({ brief: null, briefMeta: null })).sections.find((s) => s.title === 'Note de situation')?.html ?? '';
    expect(note).toContain('Synthèse nationale en cours de préparation…');
    expect(note).not.toContain('indisponible');
  });

  it('depuis la visite : le résumé compte tous les changements importants, sans plafond', () => {
    const events = Array.from({ length: 7 }, (_, i) => event({ id: 100 + i, title: `Événement ${i}`, severity: 'high' }));
    const digest: ChangeDigestItem[] = events.map((e) => ({ event: e, kinds: ['created'], latestAt: '2026-09-24T07:40:00Z', severityFrom: null, independentFrom: null }));
    const sec = section('changes')({ events: eventsState({ events, digest }) });
    // 7 événements listés + la situation active nouvelle = 8, au-delà du plafond de 5 lignes.
    expect(sec?.summary).toBe('8 changements orange ou rouges');
    expect(sec?.html.match(/data-select=/g)?.length ?? 0).toBeLessThanOrEqual(5);
  });

  it('en-tête : situations actives, heure de mise à jour, sources', () => {
    expect(buildFranceFiche(input()).freshness).toMatch(/^1 situation active · MAJ \d{2}:\d{2} · 33 sources sur 35 à jour$/);
  });

  it('depuis la visite : totaux, puis 5 changements orange ou rouges au plus, résolues comprises', () => {
    const events = Array.from({ length: 7 }, (_, i) => event({ id: 100 + i, title: `Événement ${i}`, severity: 'high' }));
    const digest: ChangeDigestItem[] = events.map((e) => ({ event: e, kinds: ['created'], latestAt: '2026-09-24T07:40:00Z', severityFrom: null, independentFrom: null }));
    const low = event({ id: 200, title: 'Fait mineur', severity: 'low' });
    digest.push({ event: low, kinds: ['created'], latestAt: '2026-09-24T07:45:00Z', severityFrom: null, independentFrom: null });
    const { meta, rows } = franceChangeDigest(input({ events: eventsState({ events: [...events, low], digest }) }));
    expect(meta).toContain('Depuis votre visite de');
    // Le fait mineur n'est pas une ligne du fil : ni compté, ni listé.
    // 7 événements du fil + la situation active (1 nouvelle) ; l'événement bas ne compte plus (avant : 9).
    expect(meta).toContain('8 nouveaux');
    expect(meta).not.toContain('9 nouveaux');
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.text)).not.toContain('Nouveau : Fait mineur');
  });

  it('depuis la visite : un événement étranger du résumé n’apparaît ni dans les lignes ni dans les totaux', () => {
    const foreign = event({ id: 300, title: 'Inondations à Bangkok', severity: 'critical', zone: 'etranger' });
    const digest: ChangeDigestItem[] = [{ event: foreign, kinds: ['created'], latestAt: '2026-09-24T07:40:00Z', severityFrom: null, independentFrom: null }];
    const { meta, rows } = franceChangeDigest(input({ snapshot: snapshot({ situations: [] }), events: eventsState({ events: [foreign], digest }) }));
    expect(meta).not.toContain('nouveau');
    expect(rows.map((r) => r.text).join(' ')).not.toContain('Bangkok');
  });

  it('première visite : « dernières 24 h » sans totaux, lignes orange ou rouges du fil', () => {
    const local = event({ id: 301, title: 'Panne à Lyon', severity: 'high' });
    const digest: ChangeDigestItem[] = [{ event: local, kinds: ['created'], latestAt: '2026-09-24T07:40:00Z', severityFrom: null, independentFrom: null }];
    const { meta, rows } = franceChangeDigest(input({ events: eventsState({ events: [local], digest, anchor: { since: NOW - 24 * H, kind: 'default' } }) }));
    expect(meta).toBe('Première visite : dernières 24 h');
    expect(rows.map((r) => r.text).join(' ')).toContain('Panne à Lyon');
  });

  it('S<n> désigne la situation figée au moment du brief, pas l’instantané courant', () => {
    const html = renderFiche(buildFranceFiche(input({ briefSituationIds: ['cyber-pressure'] })), 'fr');
    expect(html).toContain('data-select="situation:cyber-pressure">S1');
  });

  it('actions : voir sur la carte et note de situation ; bascule EN', () => {
    const model = buildFranceFiche(input({ lang: 'en' }));
    expect(model.actions.map((a) => a.id)).toEqual(['show-france', 'report']);
    expect(model.kind).toBe('State of France');
    expect(model.driver).toBe('driven by energy');
  });
});
