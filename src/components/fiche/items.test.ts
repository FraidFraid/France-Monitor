import { describe, it, expect } from 'vitest';
import {
  buildEventFiche,
  buildMarketFiche,
  buildOfficialFiche,
  buildSituationFiche,
  buildThemeFiche,
  type EventFicheInput,
  type SituationFicheInput,
  type ThemeFicheInput,
} from './items.ts';
import { renderFiche, type FicheModel } from './parts.ts';
import { energySection, fuelSection } from './france-indicators.ts';
import { buildWorkQueue, officialAlertGroups, type WorkQueueInput } from '../../services/work-queue.ts';
import type {
  DetectedSituation,
  EcowattHourValue,
  EcowattResponse,
  EcowattSignal,
  FranceCountrySignals,
  FranceIntelEnergySummary,
  NewsEvent,
  NewsEventDetail,
} from '../../types/index.ts';
import { parisDate } from '../../services/ecowatt-official.ts';

const NOW = Date.parse('2026-09-24T08:00:00Z');

function signals(over: Partial<FranceCountrySignals> = {}): FranceCountrySignals {
  return {
    criticalNews: 0, highNews: 0, topNewsCount: 0, meteoAlerts: 0, floodAlerts: 0, fireDetections: 0,
    railDisruptions: 0, railSevere: 0, roadIncidents: 0, powerOutages: 0, telecomOutages: 0,
    cyberAlerts: 0, cyberCritical: 0, militaryFlights: 0, maritimeTrafficFrance: 0,
    defenseAlerts: 0, defenseHigh: 0, jammingSignals: 0, marketStress: 0, ...over,
  };
}

function situation(over: Partial<DetectedSituation> = {}): DetectedSituation {
  return {
    id: 'energy-stress', type: 'ENERGY_STRESS', severity: 'high', confidence: 0.8, title: 'Tension énergétique nationale',
    summary: 'Signal Écowatt orange confirmé.', affectedZones: ['Bretagne'], drivers: [], recommendedActions: [],
    sourceRefs: ['Ecowatt RTE'], updatedAt: new Date(NOW), ...over,
  };
}

// Écowatt est un signal NATIONAL (RTE) : le jour est ancré sur l'horloge réelle (Europe/Paris),
// comme dans work-queue.ts (officialEntries → ecowattToday(ecowatt?.official, Date.now())).
function ecowatt(level: EcowattSignal): EcowattResponse {
  const mix = { timestamp: new Date(0), nuclear: 0, wind: 0, solar: 0, hydro: 0, gas: 0, other: 0, total: 0 };
  const hourValue: EcowattHourValue = level === 'green' ? 1 : level === 'orange' ? 2 : 3;
  return {
    official: {
      source: 'rte',
      generatedAt: new Date(NOW).toISOString(),
      days: [{ date: parisDate(Date.now()), level, message: '', hours: Array(24).fill(hourValue) as EcowattHourValue[] }],
    },
    mixes: {}, national: mix, interconnections: [], grid: null,
  };
}

function energy(): FranceIntelEnergySummary {
  return {
    ecowattSignal: 'green', totalMw: 53600, shares: { nuclear: 70, gas: 5, hydro: 10, wind: 8, solar: 4, other: 3 },
    nuclearStress: null, windGw: 4.2, windLoadFactor: 18, oilStocksDays: 46, oilVigilanceStatus: 'normal',
    fuelTensionLevel: 'LOW', fuelTensionAnomalyShare: 1, fuelPriceHistory: null,
  };
}

function queue(over: Partial<WorkQueueInput> = {}): ReturnType<typeof buildWorkQueue> {
  return buildWorkQueue({
    situations: [], alerts: [], events: null, ecowatt: null, meteo: [], floods: [], markets: [],
    baseline: null, firstSeen: new Map(), lang: 'fr', ...over,
  });
}

function themeInput(over: Partial<ThemeFicheInput> = {}): ThemeFicheInput {
  return {
    theme: 'energy', queue: queue(), snapshot: { signals: signals(), energy: null }, events: null,
    changeTimes: new Map(), freshness: '33 sources sur 35 à jour', sectionOpen: new Map(), now: NOW, ready: true, lang: 'fr', ...over,
  };
}

describe('fiche thème (spec 2026-10-01 fiches § 4.3)', () => {
  const ids = (m: FicheModel): Array<string | undefined> => m.sections.map((s) => s.id);
  const envInput = (): ThemeFicheInput => themeInput({
    theme: 'environment',
    queue: queue({
      meteo: [{ department: 'Var', departmentCode: '83', level: 'yellow', risks: [] }],
      situations: [situation({ id: 'flood-crisis', type: 'FLOOD_CRISIS', severity: 'critical', title: 'Crise hydrologique active' })],
    }),
    snapshot: { signals: signals({ meteoAlerts: 3, floodAlerts: 2, fireDetections: 14 }), energy: null },
  });

  it('rien à traiter : fiche verte, contexte et synthèse', () => {
    const m = buildThemeFiche(themeInput({ queue: queue({ ecowatt: ecowatt('green') }) }));
    expect(m.kind).toBe('Thème');
    expect(m.name).toBe('Énergie');
    expect(m.level).toBe('vert');
    expect(m.lead).toBe('Rien à traiter. 1 élément suivi est au vert.');
    expect(m.context).toEqual(['rien à traiter', '33 sources sur 35 à jour']);
  });

  it('niveau, signaux officiels, chiffres et éléments dans la section indicateurs', () => {
    const m = buildThemeFiche(envInput());
    expect(m.level).toBe('rouge');
    expect(m.context?.[0]).toBe('Crise hydrologique active');
    expect(m.lead).toContain('1 élément à traiter, dont 1 rouge.');
    expect(m.lead).toContain('Vigilance météo jaune.');
    expect(ids(m)[0]).toBe('indicators');
    expect(m.sections[0]).toMatchObject({ collapsible: true, open: true });
    const html = m.sections[0].html;
    expect(html).toContain('Départements en vigilance orange ou rouge');
    expect(html).toContain('Signaux officiels');
    expect(html).toContain('Éléments à traiter');
    expect(html).toContain('fm-vig');
    expect(html).toContain('Le niveau du thème est le plus élevé');
    const sources = m.sections.find((s) => s.id === 'sources');
    expect(sources).toMatchObject({ open: false, tone: 'reference' });
    expect(sources?.html).toContain('Météo-France');
  });

  it('énergie : bloc énergie du kit, aucune trace des anciennes cartes', () => {
    const m = buildThemeFiche(themeInput({ snapshot: { signals: signals(), energy: energy() } }));
    expect(m.sections[0].html).toContain(energySection(energy(), 'fr').html);
    expect(m.sections[0].html).not.toContain('frintel-card');
    expect(JSON.stringify(m)).not.toContain('fiche-why');
    expect(JSON.stringify(m)).not.toContain('—');
  });

  it('évolution : heures absolues, ouverte quand des changements existent, remplacée par sectionOpen', () => {
    const base = envInput();
    expect(buildThemeFiche(base).sections.find((s) => s.id === 'evolution')).toBeUndefined();
    const withBaseline = themeInput({ ...base, queue: queue({
      baseline: {},
      meteo: [{ department: 'Var', departmentCode: '83', level: 'yellow', risks: [] }],
      situations: [situation({ id: 'flood-crisis', type: 'FLOOD_CRISIS', severity: 'critical', title: 'Crise hydrologique active' })],
    }) });
    const badged = withBaseline.queue.items.filter((i) => i.theme === 'environment' && i.badge !== null && i.ref.kind !== 'event');
    expect(badged.length).toBeGreaterThan(0);
    const changeTimes = new Map(badged.map((i) => [i.key, NOW - 3600_000] as [string, number]));
    const m = buildThemeFiche({ ...withBaseline, changeTimes });
    const ev = m.sections.find((s) => s.id === 'evolution');
    expect(ev).toMatchObject({ collapsible: true, open: true });
    expect(ev?.summary).toBe(badged.length === 1 ? '1 changement' : `${badged.length} changements`);
    expect(ev?.html).toContain('09:00');
    const closed = buildThemeFiche({ ...withBaseline, changeTimes, sectionOpen: new Map([['evolution', false]]) });
    expect(closed.sections.find((s) => s.id === 'evolution')?.open).toBe(false);
    expect(buildThemeFiche({ ...base, sectionOpen: new Map([['indicators', false]]) }).sections[0].open).toBe(false);
  });

  it('échappe un titre d’élément hostile et n’emploie aucun tiret cadratin', () => {
    const m = buildThemeFiche(themeInput({
      theme: 'environment',
      queue: queue({ situations: [situation({ id: 'flood-crisis', type: 'FLOOD_CRISIS', severity: 'critical', title: '<img src=x>' })] }),
    }));
    expect(m.sections[0].html).toContain('&lt;img');
    expect(m.sections[0].html).not.toContain('<img src=x>');
    expect(JSON.stringify(buildThemeFiche(envInput()))).not.toContain('—');
  });

  it('avant les couches critiques : « Chargement des données… », jamais « Rien à traiter »', () => {
    const m = buildThemeFiche(themeInput({ ready: false, queue: queue({ ecowatt: ecowatt('green') }) }));
    expect(m.lead).toContain('Chargement des données…');
    expect(JSON.stringify(m).toLowerCase()).not.toContain('rien à traiter');
    expect(m.context?.join(' ').toLowerCase()).not.toContain('rien à traiter');
  });

  it('énergie : le bloc carburants suit le bloc énergie, production, éolien et stocks affichés une seule fois', () => {
    const e = { ...energy(), oilStocksDays: 46, fuelTensionLevel: 'HIGH' as const, windGw: 4.2 };
    const html = buildThemeFiche(themeInput({ snapshot: { signals: signals(), energy: e } })).sections[0].html;
    const fuel = fuelSection(e, 'fr')?.html ?? '';
    expect(fuel).not.toBe('');
    expect(html).toContain(fuel);
    expect(html).toContain('Stocks nationaux');
    expect(html.indexOf(fuel)).toBeGreaterThan(html.indexOf('Production totale'));
    expect(html).not.toContain('Production nationale');
    expect(html.match(/Production (totale|nationale)/g)).toHaveLength(1);
    expect(html).not.toContain('Stocks de carburant');
    expect(html).not.toContain('Production éolienne');
    expect(html.match(/Éolien en direct/g)).toHaveLength(1);
    expect(html.match(/46 j/g)).toHaveLength(1);
  });
});

describe('fiche événement (spec 2026-10-01 fiches § 4.1)', () => {
  const NOW = Date.parse('2026-10-01T08:30:00Z');
  const ev = (over: Partial<NewsEvent> = {}): NewsEvent => ({
    id: 13516, evidenceId: 'E13516', title: 'Haut-Rhin : menace d’attentat contre un lycée', category: 'security', severity: 'medium',
    status: 'cooling', firstSeen: '2026-09-30T17:11:00Z', lastSeen: '2026-10-01T06:44:00Z', articleCount: 11, sourceCount: 8,
    independentCount: 5, sourceNames: ['Le Dauphiné', 'Le Progrès', 'DNA'], lat: 47.6, lon: 7.5, peakSeverity: 'medium',
    zone: 'france', temporality: 'en_cours', reasons: [], ...over,
  });
  const detail: NewsEventDetail = {
    event: ev(),
    articles: [
      { id: 1, title: 'Article ancien', link: 'https://exemple.fr/a', feedName: 'DNA', publishedAt: '2026-09-30T17:11:00Z' },
      { id: 2, title: 'Article récent <b>', link: 'https://exemple.fr/b', feedName: 'Le Figaro', publishedAt: '2026-10-01T04:44:00Z' },
    ],
    log: [
      { at: '2026-10-01T06:30:00Z', kind: 'cooling', from: 'active', to: 'cooling' },
      { at: '2026-09-30T21:00:00Z', kind: 'corroborated', from: '1', to: '2' },
      { at: '2026-10-01T08:30:00Z', kind: 'corroborated', from: '4', to: '5' },
      { at: '2026-10-01T05:00:00Z', kind: 'corroborated', from: '2', to: '3' },
      { at: '2026-10-01T07:00:00Z', kind: 'corroborated', from: '3', to: '4' },
    ],
  };
  const build = (over: Partial<EventFicheInput> = {}): FicheModel => buildEventFiche({
    event: ev(), detail, place: { code: '68', nom: 'Haut-Rhin' }, sectionOpen: new Map(), lang: 'fr', now: NOW, ...over,
  });
  const byId = (m: FicheModel) => new Map(m.sections.map((s) => [s.id, s]));

  it('en-tête : lieu avec numéro, depuis en heure absolue, statut daté, synthèse', () => {
    const m = build();
    expect(m.kind).toBe('Événement · Sécurité et défense');
    expect(m.context).toEqual(['Haut-Rhin (68)', 'depuis 30/09 19:11', 'en refroidissement depuis 08:30']);
    expect(m.lead).toBe('Repris par 8 sources (Le Dauphiné, Le Progrès, DNA). Dernier article à 08:44.');
  });

  it('sections : indicateurs et évolution ouverts, articles repliés au ton référence', () => {
    const s = byId(build());
    expect(s.get('indicators')).toMatchObject({ collapsible: true, open: true, summary: '5 groupes indépendants · 11 articles' });
    expect(s.get('evolution')).toMatchObject({ collapsible: true, open: true, summary: '5 changements' });
    expect(s.get('articles')).toMatchObject({ collapsible: true, open: false, tone: 'reference', summary: '11 articles · 8 flux' });
    expect(byId(build({ sectionOpen: new Map([['articles', true], ['indicators', false]]) })).get('articles')?.open).toBe(true);
  });

  it('indicateurs : courbe de corroboration 1 → 5, confirmation, gravité, volume, lieu, preuve', () => {
    const html = byId(build()).get('indicators')?.html ?? '';
    expect(html).toContain('class="fmk-curve"');
    expect(html).toContain('<text x="12" y="12" text-anchor="end">5</text>');
    expect(html).toContain('confirmé par 5 groupes de presse indépendants');
    expect(html).toContain('fm-vig--jaune');
    expect(html).toContain('11 articles · 8 flux');
    expect(html).toContain('Haut-Rhin (68)');
    expect(html).toContain('E13516');
  });

  it('à confirmer : contexte et gravité signalée au-dessus de la retenue ; motifs en mots', () => {
    const m = build({ event: ev({ severity: 'medium', peakSeverity: 'high', independentCount: 1, sourceCount: 1, reasons: ['non_confirme'] }) });
    expect(m.context).toContain('à confirmer, signalé orange');
    const html = byId(m).get('indicators')?.html ?? '';
    expect(html).toContain('source unique');
    expect(html).toContain('niveau le plus grave signalé par une seule source indépendante');
  });

  it('évolution : heures absolues, la plus récente en tête', () => {
    const html = byId(build()).get('evolution')?.html ?? '';
    expect(html.indexOf('10:30')).toBeLessThan(html.indexOf('09:00'));
    expect(html).toContain('<li class="fiche-change is-latest"><span class="fiche-time">10:30</span>');
    expect(html).toContain('30/09 23:00');
  });

  it('articles : lignes simples, du plus récent au plus ancien, échappés, date absolue', () => {
    const html = byId(build()).get('articles')?.html ?? '';
    expect(html.indexOf('Article récent')).toBeLessThan(html.indexOf('Article ancien'));
    expect(html).toContain('Article récent &lt;b&gt;');
    expect(html).toContain('<small>Le Figaro · 06:44</small>');
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
    expect(html).not.toContain('fiche-source');
  });

  it('détail absent, en cours ou en erreur : messages, pas de courbe, jamais d’exception', () => {
    for (const d of [undefined, 'loading', 'error'] as const) {
      const s = byId(build({ detail: d }));
      expect(s.get('indicators')?.html).not.toContain('fmk-curve');
      expect(s.get('evolution')?.html).toContain(d === 'error' ? 'Journal indisponible pour le moment.' : 'Chargement du journal…');
      expect(s.get('articles')?.html).toContain(d === 'error' ? 'Articles indisponibles pour le moment.' : 'Chargement des articles…');
    }
  });

  it('articles hostiles : lien non http en span, titre, flux et source échappés', () => {
    const hostile: NewsEventDetail = {
      ...detail,
      articles: [{ id: 9, title: '<img src=x onerror=alert(1)>', link: 'javascript:alert(1)', feedName: '<i>flux</i>', publishedAt: '2026-10-01T04:44:00Z' }],
    };
    const m = build({ event: ev({ sourceNames: ['<b>X</b>'] }), detail: hostile });
    const html = byId(m).get('articles')?.html ?? '';
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('<span>&lt;img');
    expect(html).toContain('&lt;i&gt;flux&lt;/i&gt;');
    const all = renderFiche(m, 'fr');
    expect(all).toContain('&lt;b&gt;X&lt;/b&gt;');
    expect(all).not.toContain('<b>X</b>');
  });

  it('courbe : première étape sans valeur de départ, la courbe part de 1', () => {
    const d: NewsEventDetail = { ...detail, log: [{ at: '2026-10-01T05:00:00Z', kind: 'corroborated', from: null, to: '3' }] };
    const html = byId(build({ detail: d })).get('indicators')?.html ?? '';
    expect(html).toContain('<text x="12" y="63" text-anchor="end">1</text>');
  });

  it('un seul groupe de presse ; journal en mots L1', () => {
    const one = byId(build({ event: ev({ independentCount: 1, sourceCount: 3 }) })).get('indicators')?.html ?? '';
    expect(one).toContain('un seul groupe de presse (3 titres)');
    const d: NewsEventDetail = { ...detail, log: [{ at: '2026-10-01T07:00:00Z', kind: 'escalated', from: 'medium', to: 'high' }] };
    expect(byId(build({ detail: d })).get('evolution')?.html).toContain('aggravé jaune → orange');
  });

  it('journal des statuts : libellé français seul, jamais de statut anglais ni de flèche', () => {
    const d: NewsEventDetail = {
      ...detail,
      log: [
        { at: '2026-10-01T05:00:00Z', kind: 'cooling', from: 'active', to: 'cooling' },
        { at: '2026-10-01T06:00:00Z', kind: 'closed', from: 'cooling', to: 'closed' },
        { at: '2026-10-01T07:00:00Z', kind: 'reopened', from: 'closed', to: 'active' },
      ],
    };
    const html = byId(build({ detail: d })).get('evolution')?.html ?? '';
    expect(html).toContain('en refroidissement');
    expect(html).toContain('clos');
    expect(html).toContain('rouvert');
    expect(html).not.toMatch(/cooling|closed|active|→/);
  });

  it('articles chargés mais vides : « Aucun article disponible. »', () => {
    const html = byId(build({ detail: { ...detail, articles: [] } })).get('articles')?.html ?? '';
    expect(html).toContain('Aucun article disponible.');
    expect(html).not.toContain('<ul');
  });

  it('évolution : « 8 sur n changements » au-delà de 8 entrées', () => {
    const many: NewsEventDetail = {
      ...detail,
      log: Array.from({ length: 11 }, (_, i) => ({ at: `2026-10-01T0${i % 8}:00:00Z`, kind: 'corroborated' as const, from: String(i), to: String(i + 1) })),
    };
    const ev8 = byId(build({ detail: many })).get('evolution');
    expect(ev8?.summary).toBe('8 sur 11 changements');
    expect(ev8?.html.match(/<li /g)).toHaveLength(8);
    expect(byId(build({ detail: { ...detail, log: many.log.slice(0, 8) } })).get('evolution')?.summary).toBe('8 changements');
  });

  it('première apparition illisible : « depuis n.d. », jamais l’heure actuelle', () => {
    const m = build({ event: ev({ firstSeen: 'pas une date' }) });
    expect(m.context).toContain('depuis n.d.');
    expect(m.reference).toContain('n.d.');
  });

  it('référence copiable et actions', () => {
    const m = build();
    expect(m.reference).toBe('E13516 · Haut-Rhin : menace d’attentat contre un lycée · Jaune · première apparition 30/09 19:11');
    expect(m.actions.map((a) => a.id)).toEqual(['map', 'copy-ref']);
    expect(build({ event: ev({ lat: null, lon: null }) }).actions.map((a) => a.id)).toEqual(['copy-ref']);
  });

  it('étranger : lieu « à l’étranger » ; aucun tiret cadratin nulle part', () => {
    const m = build({ event: ev({ zone: 'etranger' }), place: null });
    expect(m.context?.[0]).toBe('à l’étranger');
    expect(JSON.stringify(m)).not.toContain('—');
  });
});

describe('fiche situation : couleurs, doublons, provenance (revue finale)', () => {
  const NOW_S = Date.parse('2026-10-01T08:30:00Z');
  const build = (over: Partial<DetectedSituation> = {}, input: Partial<SituationFicheInput> = {}): FicheModel => buildSituationFiche({
    situation: situation({ updatedAt: new Date('2026-10-01T06:57:00Z'), ...over }),
    kind: 'situation', badge: null, changeAt: null, hasDossier: false, sectionOpen: new Map(), lang: 'fr', now: NOW_S, ...input,
  });
  const indicators = (m: FicheModel): string => m.sections.find((x) => x.id === 'indicators')?.html ?? '';

  it('la barre suit le mot de statut du moteur : « sous tension » est orange, pas vert', () => {
    const html = indicators(build({ drivers: ['Vigilance stocks pétroliers : sous tension (score 49/100)'] }));
    expect(html).toContain('width:49%;background:var(--sev-orange)');
    expect(html).not.toContain('width:49%;background:var(--sev-green)');
  });

  it('SOCIAL_ESCALATION réel : une barre par libellé, aucune note « . »', () => {
    const m = build({
      type: 'SOCIAL_ESCALATION', title: 'Escalade sociale localisée',
      summary: '5 département(s) avec tensions sociales ou sécuritaires élevées. Score national ISNR : 42/100.',
      affectedZones: ['Seine-Saint-Denis (72/100)', 'Rhône (61/100)'],
      drivers: ['5 dept(s) avec dimension sociale/sécurité ≥ 40', 'Score national ISNR : 42/100', '1 dept(s) en situation critique (score ≥ 65)'],
    });
    const html = indicators(m);
    expect(html.match(/Score national ISNR/g)).toHaveLength(1);
    expect(html).not.toMatch(/>\.</);
    expect(html).not.toContain('fmk-muted">.');
  });

  it('provenance anglaise « Sources: », tendance dans le résumé, heure du badge', () => {
    const over = { drivers: ['Score cyber consolidé : 63/100 (tendance haussière)'], sourceRefs: ['CERT-FR'] };
    const en = build(over, { lang: 'en' });
    expect(indicators(en)).toContain('Sources: CERT-FR');
    expect(indicators(en)).not.toContain('Sources :');
    const fr = build(over);
    expect(fr.sections.find((x) => x.id === 'indicators')?.summary).toMatch(/ · tendance haussière$/);
    const badged = build(over, { badge: 'nouveau', changeAt: Date.parse('2026-10-01T07:15:00Z') });
    expect(badged.context).toContain('nouveau depuis votre visite (09:15)');
  });
});

describe('fiche situation (spec 2026-10-01 fiches § 4.2)', () => {
  const NOW_S = Date.parse('2026-10-01T08:30:00Z');
  const sit = (over: Partial<DetectedSituation> = {}): DetectedSituation => situation({
    id: 'cyber-pressure', type: 'CYBER_PRESSURE', severity: 'high', confidence: 0.8, title: 'Pression cyber multi-source',
    summary: 'Pression cyber soutenue. Baromètre cyber consolidé à 65/100, dominé par ransomware.',
    affectedZones: ['France'],
    drivers: ['Score cyber consolidé : 65/100 (tendance stable)', 'Ransomware : 25/25', 'CERT/NVD : 14/20', 'Ransomwares actifs en hausse'],
    recommendedActions: [{ label: 'Surveiller les revendications', ownerHint: 'Analyste cyber', actionType: 'monitor', automatable: true }],
    sourceRefs: ['CERT-FR', 'RansomwareLive'], updatedAt: new Date('2026-10-01T06:57:00Z'), ...over,
  });
  const build = (over: Partial<SituationFicheInput> = {}): FicheModel => buildSituationFiche({
    situation: sit(), kind: 'situation', badge: null, changeAt: null, hasDossier: false, sectionOpen: new Map(), lang: 'fr', now: NOW_S, ...over,
  });
  const byId = (m: FicheModel) => new Map(m.sections.map((s) => [s.id, s]));

  it('en-tête : sur-titre avec thème, phrase du niveau, zones, mise à jour absolue ; synthèse non chiffrée', () => {
    const m = build();
    expect(m.kind).toMatch(/^Situation · /);
    expect(m.context).toEqual(['soyez très vigilant', 'France', 'mise à jour 08:57']);
    expect(m.lead).toBe('Pression cyber soutenue.');
  });

  it('indicateurs ouverts : une barre par sous-score à sa propre intensité, confiance grise, phrase chiffrée en note, provenance', () => {
    const s = byId(build());
    const ind = s.get('indicators');
    expect(ind).toMatchObject({ collapsible: true, open: true, summary: 'confiance élevée · tendance stable' });
    const html = ind?.html ?? '';
    expect(html).toContain('Score cyber consolidé');
    expect(html).toContain('width:65%;background:var(--sev-yellow)');
    expect(html).toContain('width:100%;background:var(--sev-red)');
    expect(html).toContain('width:70%;background:var(--sev-orange)');
    expect(html).toContain('tendance stable');
    expect(html).toContain('width:80%;background:var(--text-secondary)');
    expect(html).toContain('Baromètre cyber consolidé à 65/100, dominé par ransomware.');
    expect(html).toContain('Sources : CERT-FR, RansomwareLive · mise à jour 08:57');
  });

  it('à faire, facteurs non chiffrés, zones en étiquettes avec scores de zone en barres', () => {
    const m = build({ situation: sit({ affectedZones: ['Seine-Saint-Denis (72/100)', 'Paris'] }) });
    const s = byId(m);
    expect(s.get('todo')).toMatchObject({ open: true, summary: '1 action' });
    expect(s.get('todo')?.html).toContain('<ol class="fmk-todo">');
    expect(s.get('todo')?.html).toContain('<small>Analyste cyber · Surveillance · IA possible</small>');
    expect(s.get('factors')?.html).toContain('Ransomwares actifs en hausse');
    expect(s.get('factors')?.html).not.toContain('25/25');
    expect(s.get('zones')?.html).toContain('<span class="fmk-tag">Seine-Saint-Denis</span>');
    expect(s.get('indicators')?.html).toContain('width:72%');
    expect(m.context).toContain('Seine-Saint-Denis, Paris');
  });

  it('sources repliées au ton référence, lien d’origine en tête', () => {
    const s = byId(build({ situation: sit({ linkUrl: 'https://exemple.fr/x', linkLabel: 'Article' }) }));
    expect(s.get('sources')).toMatchObject({ collapsible: true, open: false, tone: 'reference', summary: '3 sources' });
    expect(s.get('sources')?.html.indexOf('Article')).toBeLessThan(s.get('sources')?.html.indexOf('CERT-FR') ?? 0);
  });

  it('nouveau depuis la visite dans le contexte ; référence copiable ; aucun tiret cadratin', () => {
    const m = build({ badge: 'nouveau' });
    expect(m.context).toContain('nouveau depuis votre visite');
    expect(m.reference).toBe('cyber-pressure · Pression cyber multi-source · Orange · mise à jour 01/10 08:57');
    expect(m.actions.map((a) => a.id)).toContain('copy-ref');
    expect(JSON.stringify(m)).not.toContain('—');
  });

  it('alerte : lien source http(s) seulement, dossier et carte quand ils existent', () => {
    const alert = situation({
      id: 'news-alert-1', type: 'NEWS_ALERT', linkUrl: 'https://example.org/a', linkLabel: 'Ouvrir l’article', lat: 49.4, lon: 1.1,
    });
    const model = build({ situation: alert, kind: 'alert', badge: 'nouveau' });
    expect(model.kind).toMatch(/^Alerte · /);
    expect(byId(model).get('sources')?.html).toContain('Ouvrir l’article');
    expect(model.actions.map((a) => a.id)).toEqual(['map', 'copy-ref']);
    const unsafe = build({ situation: { ...alert, linkUrl: 'javascript:alert(1)' }, kind: 'alert' });
    expect(byId(unsafe).get('sources')?.html ?? '').not.toContain('Ouvrir l’article');
    const fire = build({ situation: situation({ id: 'wildfire-7', type: 'WILDFIRE_ESCALATION' }), hasDossier: true });
    expect(fire.actions).toContainEqual({ id: 'dossier', label: 'Ouvrir le dossier d’incident' });
  });

  it('lignes atypiques du moteur : jamais de barre fausse', () => {
    const m = build({ situation: sit({ drivers: ['Vigilance stocks pétroliers : sous tension (score 49/100)', 'Phrase sans séparateur 3/10', 'Indice : 3,5/10'] }) });
    const html = byId(m).get('indicators')?.html ?? '';
    expect(html).toContain('width:49%');
    expect(html).toContain('width:35%');
    expect(html).toContain('Phrase sans séparateur 3/10');
  });
});

describe('fiches alerte officielle et marché (spec 2026-10-01 fiches § 4.4 et 4.5)', () => {
  const ids = (m: FicheModel): Array<string | undefined> => m.sections.map((s) => s.id);
  const officialGroup = (): ReturnType<typeof officialAlertGroups>[number] =>
    officialAlertGroups(null, [{ department: '<Var>', departmentCode: '83', level: 'violet', risks: ['heat'] }], [])[0];
  const line = { symbol: 'CAC40', name: 'CAC 40', price: 7212.5, changePercent: -3.42, kind: 'index' } as const;

  it('alerte officielle : émetteur, lieux, niveau repris tel quel, détail par lieu échappé, sources repliées', () => {
    const m = buildOfficialFiche(officialGroup(), { freshness: '30 sources sur 39 à jour', sectionOpen: new Map(), lang: 'fr' });
    expect(m.kind).toBe('Alerte officielle · Météo-France');
    expect(m.context).toEqual(['Météo-France', '30 sources sur 39 à jour']);
    expect(m.lead).toContain('<Var>');
    expect(ids(m)).toEqual(['indicators', 'places', 'sources']);
    expect(m.sections[0]).toMatchObject({ open: true });
    expect(m.sections[0].html).toContain('Lieux concernés');
    expect(m.sections[0].html).toContain('Niveau publié par Météo-France, repris tel quel.');
    expect(m.sections[0].html).toContain('Le violet de Météo-France compte comme rouge.');
    expect(m.sections[1]).toMatchObject({ title: 'Détail par lieu', open: true, summary: '1' });
    expect(m.sections[1].html).toContain('&lt;Var&gt; : Canicule');
    expect(m.sections[2]).toMatchObject({ open: false, tone: 'reference' });
    expect(m.actions.map((a) => a.id)).toEqual(['show-layer']);
    expect(JSON.stringify(m)).not.toContain('—');
    const closed = buildOfficialFiche(officialGroup(), { freshness: '', sectionOpen: new Map([['places', false]]), lang: 'fr' });
    expect(closed.sections[1].open).toBe(false);
  });

  it('marché : cours, variation, seuil ; aucune section sources', () => {
    const m = buildMarketFiche(line, { sectionOpen: new Map(), lang: 'fr' });
    expect(m.kind).toBe('Marché');
    expect(m.level).toBe('jaune');
    expect(m.context).toEqual(['mouvement exceptionnel']);
    expect(m.lead).toBe('CAC 40 varie de −3,42 % sur la journée, au-delà du seuil de ±3 %.');
    expect(ids(m)).toEqual(['indicators']);
    expect(m.sections[0]).toMatchObject({ open: true });
    expect(m.sections[0].html).toContain('Cours');
    expect(m.sections[0].html).toContain('Variation');
    expect(m.sections[0].html).toContain('Seuil d’alerte');
    expect(JSON.stringify(m)).not.toContain('—');
    expect(buildMarketFiche(line, { sectionOpen: new Map([['indicators', false]]), lang: 'fr' }).sections[0].open).toBe(false);
  });
});
