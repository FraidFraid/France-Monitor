import { describe, it, expect } from 'vitest';
import {
  renderDomainsBlock, renderEnergyBlock, renderTimelineBlock,
  domainTiles, domainChips, DOMAIN_LEVEL, energySegments, oilStatusInfo, timelineIntensity,
} from './france-intel-blocks.ts';
import type { FranceCountrySignals, FranceIntelEnergySummary } from '../types/index.ts';
import { ENV_FIXTURE_NOW, FIRES_FIXTURE, FLOODS_FIXTURE, VIGILANCE_FIXTURE } from './layer-panel/environment.fixture.ts';
import { buildEnvironmentInputs } from '../services/environment-inputs.ts';
import { buildFranceSignals, type FranceRawData } from '../services/france-country-intel.ts';
import { buildSovereigntyInputs } from '../services/sovereignty-inputs.ts';
import { withGnssInputs } from '../services/sovereignty-inputs-b.ts';
import { MILITARY_FIGURE_LABEL } from '../services/sovereignty-levels.ts';
import {
  CABLES_WATCH_FIXTURE, CABLES_WATCH_FROZEN_FIXTURE, CYBER_FIXTURE, GNSS_FIXTURE, GNSS_STORM_FIXTURE, MILITARY_FIXTURE, SOV_FIXTURE_NOW,
} from './layer-panel/sovereignty.fixture.ts';

function signals(over: Partial<FranceCountrySignals> = {}): FranceCountrySignals {
  return {
    criticalNews: 0, highNews: 0, topNewsCount: 0, meteoAlerts: 0, floodAlerts: 0, fireDetections: 0,
    railDisruptions: 0, railSevere: 0, roadIncidents: 0, telecomOutages: 0,
    cyberAlerts: 0, cyberCritical: 0, militaryFlights: 0, maritimeTrafficFrance: 0,
    defenseAlerts: 0, defenseHigh: 0, jammingSignals: 0, marketStress: 0, ...over,
  };
}

/** Tuile « Météo » calculée de bout en bout : entrées Environnement, signaux du score, tuiles. */
function meteoTileFrom(env: ReturnType<typeof buildEnvironmentInputs>) {
  const raw = {
    newsItems: [], isnrData: null, cyber: null, railTrains: [], roadEvents: [], urbanJamCount: 0, telecomOutages: null,
    cableAlerts: [], gnssDegraded: null, militaryFlightsCount: 0, maritimeCount: 0, marketData: [], ecowattResponse: null, gasState: null,
    nuclearState: null, eolienLive: null, aisAnomalies: [], timeline: { days: [], lanes: [] }, briefLang: 'fr', oilDashboard: null,
    fuelTensionDashboard: null, ...env,
  } satisfies FranceRawData;
  return domainTiles(buildFranceSignals(raw), 'fr').find((x) => x.label === 'Météo');
}

function energy(over: Partial<FranceIntelEnergySummary> = {}): FranceIntelEnergySummary {
  return {
    ecowattSignal: 'red', totalMw: 53600, shares: { nuclear: 70, gas: 5, hydro: 10, wind: 8, solar: 4, other: 3 },
    nuclearStress: null, windGw: 4.2, windLoadFactor: 18, oilStocksDays: 46, oilVigilanceStatus: 'tense',
    fuelTensionLevel: 'HIGH', fuelTensionAnomalyShare: 9.2, fuelPriceHistory: null, ...over,
  };
}

describe('blocs du tiroir en rendus purs (refonte UI étape 2)', () => {
  it('domaines : tuiles en casse normale et risques météo actifs', () => {
    const html = renderDomainsBlock({
      signals: signals({ cyberAlerts: 7, meteoAlerts: 2 }),
      meteo: [{ department: 'Var', departmentCode: '83', level: 'red', risks: ['heat'] }],
    }, 'fr');
    expect(html).toContain('>Domaines<');
    expect(html).toContain('Cyber');
    expect(html).toContain('Canicule · Rouge');
  });

  it('énergie : signal Écowatt en mot L1, carburants en pastille, statut inconnu jamais vert', () => {
    const html = renderEnergyBlock(energy(), 'fr');
    expect(html).toContain('Écowatt (national) : signal rouge');
    expect(html).toContain('<span class="fm-vig fm-vig--orange">Orange</span>');
    expect(renderEnergyBlock(energy({ oilVigilanceStatus: 'unknown' }), 'fr')).toContain('color:var(--text-secondary);">46j');
    expect(renderEnergyBlock(null, 'fr')).toContain('Aucun profil énergie disponible.');
  });

  it('chronologie : jours et libellés échappés', () => {
    const html = renderTimelineBlock({
      days: ['<b>1 sept.</b>'],
      lanes: [{ key: 'social', label: '<i>Social</i>', color: '#ef4444', counts: [2] }],
    }, 'fr');
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('<i>');
    expect(html).toContain('&lt;i&gt;Social&lt;/i&gt;');
  });
});

describe('rendu v1 figé avant extraction (spec 2026-10-01, v1 inchangée)', () => {
  const rich = {
    signals: signals({
      cyberAlerts: 24, cyberCritical: 20, railDisruptions: 215, railSevere: 159, militaryFlights: 36,
      telecomOutages: 1333, meteoAlerts: 10, fireDetections: 29, marketStress: 7, criticalNews: 2,
      jammingSignals: 1,
    }),
    meteo: [
      { department: 'Var', departmentCode: '83', level: 'yellow' as const, risks: ['thunderstorm' as const] },
      { department: 'Gard', departmentCode: '30', level: 'orange' as const, risks: ['thunderstorm' as const, 'rain-flood' as const] },
    ],
  };
  const history = {
    provider: 'carbu' as const, generatedAt: '2026-10-01T00:00:00Z', sourceLabel: 'test',
    rangeStart: '2026-09-01T00:00:00Z', rangeEnd: '2026-10-01T00:00:00Z',
    series: [{
      fuelType: 'gazole' as const, label: 'Gazole (B7)', color: '#f59e0b', latestPrice: 2.337, delta7dCents: -6.3, delta30dCents: -1,
      points: [{ timestamp: '2026-09-20T00:00:00Z', price: 2.4 }, { timestamp: '2026-10-01T00:00:00Z', price: 2.337 }],
    }],
  };

  it('domaines', () => {
    expect(renderDomainsBlock(rich, 'fr')).toMatchSnapshot();
    expect(renderDomainsBlock(rich, 'en')).toMatchSnapshot();
  });

  it('énergie et carburants', () => {
    expect(renderEnergyBlock(energy({ fuelPriceHistory: history }), 'fr')).toMatchSnapshot();
    expect(renderEnergyBlock(energy({ oilVigilanceStatus: 'unknown', fuelTensionLevel: null, ecowattSignal: null }), 'en')).toMatchSnapshot();
    expect(renderEnergyBlock(null, 'fr')).toMatchSnapshot();
  });

  it('chronologie', () => {
    expect(renderTimelineBlock({
      days: ['25 sept.', '26 sept.'],
      lanes: [{ key: 'weather', label: 'Météo', color: '#eab308', counts: [0, 10] }],
    }, 'fr')).toMatchSnapshot();
  });
});

describe('données partagées des blocs (spec 2026-10-01)', () => {
  it('tuiles de domaines : 8, dans l’ordre, avec niveau', () => {
    const tiles = domainTiles(signals({ cyberAlerts: 24, cyberCritical: 20, militaryFlights: 36 }), 'fr');
    expect(tiles.map((t) => t.label)).toEqual(['Cyber', 'Rail', 'Militaire', 'Maritime', 'Pannes', 'Défense', 'Météo', 'Finance']);
    expect(tiles[0]).toEqual({ label: 'Cyber', value: 24, meta: 'alertes CERT-FR en cours · 20\u00a0vulnérabilités exploitées citées', level: 'high' });
    expect(tiles[2]?.level).toBe('medium');
    expect(DOMAIN_LEVEL).toEqual({ low: 'vert', medium: 'jaune', high: 'orange', critical: 'rouge' });
  });

  it('tuile Pannes : pannes télécoms récentes seules, jamais « élec » ; n.d. et point gris sans fichier ARCEP lu', () => {
    const tile = (n: number | null) => domainTiles(signals({ telecomOutages: n }), 'fr').find((x) => x.label === 'Pannes');
    expect(tile(0)).toEqual({ label: 'Pannes', value: 0, meta: 'télécoms récentes', level: 'low' });
    expect(tile(50)).toMatchObject({ value: 50, level: 'medium' });
    expect(tile(51)).toMatchObject({ value: 51, level: 'high' });
    expect(tile(null)).toEqual({ label: 'Pannes', value: null, meta: 'télécoms récentes', level: null });
    expect(domainTiles(signals({ telecomOutages: 12 }), 'en').find((x) => x.label === 'Outages')?.meta).toBe('recent telecom');
    expect(JSON.stringify(domainTiles(signals({ telecomOutages: 12 }), 'fr'))).not.toMatch(/élec/);
    expect(renderDomainsBlock({ signals: signals({ telecomOutages: null }), meteo: [] }, 'fr')).toContain('n.d.');
  });

  it('tuiles Souveraineté du 04/10 : Cyber 3 alertes en cours (pastille orange), Militaire 9 dont 4 français (O9, verte), Défense 0 ; indisponibles : n.d.', () => {
    const base = {
      newsItems: [], isnrData: null, meteoAlerts: [], floodSegments: [], activeFires: [], railTrains: [], roadEvents: [], urbanJamCount: 0,
      telecomOutages: null, maritimeCount: 0, marketData: [], ecowattResponse: null, gasState: null, nuclearState: null,
      eolienLive: null, aisAnomalies: [], timeline: { days: [], lanes: [] }, briefLang: 'fr' as const, oilDashboard: null, fuelTensionDashboard: null,
    };
    const tile = (label: string, sov: ReturnType<typeof buildSovereigntyInputs>, lang: 'fr' | 'en' = 'fr') => {
      const raw = { ...base, ...sov } satisfies FranceRawData;
      return domainTiles(buildFranceSignals(raw, SOV_FIXTURE_NOW), lang).find((x) => x.label === label);
    };
    const day = buildSovereigntyInputs(MILITARY_FIXTURE(), CABLES_WATCH_FIXTURE(), CYBER_FIXTURE(), SOV_FIXTURE_NOW);
    expect(tile('Cyber', day)).toEqual({ label: 'Cyber', value: 3, meta: 'alertes CERT-FR en cours · 7\u00a0vulnérabilités exploitées citées', level: 'high' });
    expect(tile('Militaire', day)).toEqual({ label: 'Militaire', value: 9, meta: `${MILITARY_FIGURE_LABEL} · 4\u00a0français`, level: 'low' });
    expect(tile('Military', day, 'en')).toMatchObject({ meta: 'military or state aircraft visible on ADS-B over metropolitan France · 4\u00a0French' });
    // Phase A : aucune grille GNSS mesurée, « GNSS non évalué », jamais « GNSS 0 » ; le chiffre et le niveau ne lisent que les câbles.
    expect(tile('Défense', day)).toEqual({ label: 'Défense', value: 0, meta: 'câbles\u00a00 · GNSS non évalué', level: 'low' });
    expect(tile('Defense', day, 'en')).toMatchObject({ meta: 'cables\u00a00 · GNSS not assessed' });
    expect(JSON.stringify(domainTiles(buildFranceSignals({ ...base, ...day }, SOV_FIXTURE_NOW), 'fr'))).not.toMatch(/au-dessus de la France|[Ff]aille|GPS|GNSS[ \u00a0]0/);
    // Sources indisponibles ou en retard (S3) : « n.d. », point gris, et aucun compte « 0 » dans la légende.
    const down = buildSovereigntyInputs(null, CABLES_WATCH_FROZEN_FIXTURE(), null, SOV_FIXTURE_NOW);
    expect(tile('Cyber', down)).toEqual({ label: 'Cyber', value: null, meta: 'alertes CERT-FR en cours', level: null });
    expect(tile('Militaire', down)).toEqual({ label: 'Militaire', value: null, meta: MILITARY_FIGURE_LABEL, level: null });
    expect(tile('Défense', down)).toEqual({ label: 'Défense', value: null, meta: 'câbles non évalués · GNSS non évalué', level: null });
    // Phase B (tâche B28) : grille du 04/10 lue (2 mailles sur 24 h) ; niveau des mailles = pastille Défense (jaune), pastille de la tuile
    // « Militaire » aussi. Câbles en retard, grille lue : la part GNSS seule. Orage (dégradation générale) : « GNSS non évalué ».
    const withGnss = withGnssInputs(day, GNSS_FIXTURE(), MILITARY_FIXTURE(), SOV_FIXTURE_NOW);
    expect(tile('Défense', withGnss)).toEqual({ label: 'Défense', value: 2, meta: 'câbles\u00a00 · GNSS\u00a02', level: 'medium' });
    // Revue de B28 (m3) : la couleur vient de la seule grille, la tuile le dit ; sans grille ou en orage, rien n'est ajouté.
    expect(tile('Militaire', withGnss)).toEqual({ label: 'Militaire', value: 9, meta: `${MILITARY_FIGURE_LABEL} · 4\u00a0français · GNSS à vérifier`, level: 'medium' });
    expect(tile('Military', withGnss, 'en')?.meta).toBe('military or state aircraft visible on ADS-B over metropolitan France · 4\u00a0French · GNSS to be checked');
    expect(tile('Militaire', withGnssInputs(day, GNSS_STORM_FIXTURE(), MILITARY_FIXTURE(), SOV_FIXTURE_NOW))?.meta).toBe(`${MILITARY_FIGURE_LABEL} · 4\u00a0français`);
    const three = withGnssInputs(day, { ...GNSS_FIXTURE(), degraded: { rolling24h: 3, previousUtcDays: [3, null] } }, MILITARY_FIXTURE(), SOV_FIXTURE_NOW);
    expect(tile('Défense', three)).toMatchObject({ value: 3, meta: 'câbles\u00a00 · GNSS\u00a03', level: 'high' });
    // Compte positif sur une mesure partielle de 5 h (report 10 de la revue finale) : la tuile le dit.
    const gnssPartial = { ...GNSS_FIXTURE(), degraded: { rolling24h: 3, previousUtcDays: [3, null] as const } };
    const windowStart = new Date(Date.parse(gnssPartial.readAt ?? '') - 5 * 3_600_000 - 60_000).toISOString();
    const partial = withGnssInputs(day, { ...gnssPartial, windowStart }, MILITARY_FIXTURE(), SOV_FIXTURE_NOW);
    expect(tile('Défense', partial)?.meta).toBe('câbles\u00a00 · GNSS\u00a03 (mesure partielle de 5\u00a0h)');
    expect(tile('Defense', partial, 'en')?.meta).toBe('cables\u00a00 · GNSS\u00a03 (partial measurement, 5\u00a0h)');
    expect(tile('Défense', three)?.meta).not.toContain('partielle');
    const cablesLate = withGnssInputs(buildSovereigntyInputs(MILITARY_FIXTURE(), CABLES_WATCH_FROZEN_FIXTURE(), CYBER_FIXTURE(), SOV_FIXTURE_NOW), GNSS_FIXTURE(), MILITARY_FIXTURE(), SOV_FIXTURE_NOW);
    expect(tile('Défense', cablesLate)).toEqual({ label: 'Défense', value: 2, meta: 'câbles non évalués · GNSS\u00a02', level: 'medium' });
    expect(tile('Défense', withGnssInputs(day, GNSS_STORM_FIXTURE(), MILITARY_FIXTURE(), SOV_FIXTURE_NOW)))
      .toEqual({ label: 'Défense', value: 0, meta: 'câbles\u00a00 · GNSS non évalué', level: 'low' });
    // Catalogue KEV en retard, CERT-FR à l'heure : alertes comptées, vulnérabilités citées « non évaluées ».
    const kevLate = CYBER_FIXTURE();
    kevLate.kev.readAt = new Date(SOV_FIXTURE_NOW - 27 * 3_600_000).toISOString();
    const late = buildSovereigntyInputs(MILITARY_FIXTURE(), CABLES_WATCH_FIXTURE(), kevLate, SOV_FIXTURE_NOW);
    expect(tile('Cyber', late)).toMatchObject({ value: 3, meta: 'alertes CERT-FR en cours · vulnérabilités citées non évaluées' });
  });

  it('tuile « Météo » du 04/10 (jeux d’essai réels) : vigilance, crues et feux distincts, jamais additionnés ; niveau le plus haut', () => {
    const env = buildEnvironmentInputs(VIGILANCE_FIXTURE(), FLOODS_FIXTURE(), FIRES_FIXTURE(), [], ENV_FIXTURE_NOW);
    const raw = {
      newsItems: [], isnrData: null, cyber: null, railTrains: [], roadEvents: [], urbanJamCount: 0, telecomOutages: null,
      cableAlerts: [], gnssDegraded: null, militaryFlightsCount: 0, maritimeCount: 0, marketData: [], ecowattResponse: null, gasState: null,
      nuclearState: null, eolienLive: null, aisAnomalies: [], timeline: { days: [], lanes: [] }, briefLang: 'fr', oilDashboard: null,
      fuelTensionDashboard: null, ...env,
    } satisfies FranceRawData;
    const tile = domainTiles(buildFranceSignals(raw), 'fr').find((x) => x.label === 'Météo');
    expect(tile).toEqual({
      label: 'Météo', value: null, level: 'high',
      meta: 'dépts orange ou rouges · tronçons orange ou rouges · foyers confirmés',
      parts: [
        { label: 'Vigilance', value: 2, level: 'high' },
        { label: 'Crues', value: 0, level: 'low' },
        { label: 'Feux', value: 3, level: 'medium' },
      ],
    });
  });

  it('part « Feux » (arbitrage 14) : orange dès un foyer confirmé d’au moins 10 MW ; jaune s’ils sont tous plus petits', () => {
    const big = domainTiles(signals({ fireFoyersConfirmed: 2, fireFoyersOrange: 1 }), 'fr').find((x) => x.label === 'Météo');
    expect(big?.parts?.[2]).toEqual({ label: 'Feux', value: 2, level: 'high' });
    const small = domainTiles(signals({ fireFoyersConfirmed: 2 }), 'fr').find((x) => x.label === 'Météo');
    expect([small?.level, small?.parts?.[2]]).toEqual(['medium', { label: 'Feux', value: 2, level: 'medium' }]);
  });

  it('part « Feux » (arbitrage 14) : des détections isolées seules la mettent au jaune, comme la pastille Feux ; le chiffre reste celui des foyers confirmés', () => {
    const isolated = domainTiles(signals({ fireFoyersIsolated: 4, fireDetections: 4 }), 'fr').find((x) => x.label === 'Météo');
    expect([isolated?.level, isolated?.parts?.[2]]).toEqual(['medium', { label: 'Feux', value: 0, level: 'medium' }]);
  });

  it('tuile « Météo » : un rouge ou un foyer majeur la met au rouge ; rien : vert ; les détections brutes n’y comptent plus', () => {
    const red = domainTiles(signals({ meteoAlerts: 1, meteoRedAlerts: 1 }), 'fr').find((x) => x.label === 'Météo');
    expect([red?.level, red?.parts?.[0].level]).toEqual(['critical', 'critical']);
    const major = domainTiles(signals({ fireFoyersConfirmed: 1, fireFoyersMajor: 1 }), 'fr').find((x) => x.label === 'Météo');
    expect([major?.level, major?.parts?.[2]]).toEqual(['critical', { label: 'Feux', value: 1, level: 'critical' }]);
    const calm = domainTiles(signals({ fireDetections: 259 }), 'fr').find((x) => x.label === 'Météo');
    expect([calm?.level, calm?.value, calm?.parts?.map((p) => p.value)]).toEqual(['low', null, [0, 0, 0]]);
  });

  it('tuile « Météo » (S3) : vigilance, crues et feux indisponibles (jamais lus, en échec, collecte de plus de 2 jours) : n.d. en gris, jamais un « 0 » vert', () => {
    const now = Date.parse(FIRES_FIXTURE().readAt ?? '') + 2 * 86_400_000 + 60_000;
    const env = buildEnvironmentInputs(null, null, FIRES_FIXTURE(), [], now);
    const raw = {
      newsItems: [], isnrData: null, cyber: null, railTrains: [], roadEvents: [], urbanJamCount: 0, telecomOutages: null,
      cableAlerts: [], gnssDegraded: null, militaryFlightsCount: 0, maritimeCount: 0, marketData: [], ecowattResponse: null, gasState: null,
      nuclearState: null, eolienLive: null, aisAnomalies: [], timeline: { days: [], lanes: [] }, briefLang: 'fr', oilDashboard: null,
      fuelTensionDashboard: null, ...env,
    } satisfies FranceRawData;
    const tile = domainTiles(buildFranceSignals(raw), 'fr').find((x) => x.label === 'Météo');
    expect(tile).toEqual({
      label: 'Météo', value: null, level: null,
      meta: 'dépts orange ou rouges · tronçons orange ou rouges · foyers confirmés',
      parts: [
        { label: 'Vigilance', value: null, level: null },
        { label: 'Crues', value: null, level: null },
        { label: 'Feux', value: null, level: null },
      ],
    });
    const html = renderDomainsBlock({ signals: buildFranceSignals(raw), meteo: [] }, 'fr');
    for (const label of ['Vigilance', 'Crues', 'Feux']) {
      expect(html).toContain(`<span class="frintel-dom-part"><span class="frintel-dom-dot" style="background:var(--sev-grey);"></span>${label}\u00a0n.d.</span>`);
    }
    expect(html).toContain('<span class="frintel-dom-dot" style="background:var(--sev-grey);"></span>\n      <span class="frintel-dom-label">Météo</span>');
    expect(html).not.toMatch(/(Vigilance|Crues|Feux)[ \u00a0]0/);
  });

  it('part « Feux » : suit toute la pastille Feux (firesLevel), météo des forêts du jour comprise ; le chiffre reste celui des foyers confirmés', () => {
    const fires = FIRES_FIXTURE();
    const fd = fires.forestDanger;
    if (fd === null) throw new Error('jeu d’essai sans météo des forêts');
    const forest3 = { ...fd, departments: [{ ...fd.departments[0], j1: 3 as const }] };
    const feux = (f: typeof fires) => meteoTileFrom(buildEnvironmentInputs(null, null, f, [], ENV_FIXTURE_NOW))?.parts?.[2];
    // Danger élevé (niveau 3) en J1, aucun foyer : orange.
    expect(feux({ ...fires, foyers: [], detections: [], forestDanger: forest3 })).toEqual({ label: 'Feux', value: 0, level: 'high' });
    // Niveau 3 et trois petits foyers confirmés (jaune) : le plus haut, orange ; chiffre des foyers confirmés.
    expect(feux({ ...fires, forestDanger: forest3 })).toEqual({ label: 'Feux', value: 3, level: 'high' });
    // Météo des forêts indisponible, une détection isolée en France : jaune (niveau des foyers gardé).
    const [isolated] = fires.foyers.filter((f) => !f.confirmed && !f.recurrent);
    expect(feux({ ...fires, foyers: [isolated], forestDanger: null })).toEqual({ label: 'Feux', value: 0, level: 'medium' });
    // FIRMS en panne, météo des forêts du jour (niveau 2) : couleur de la pastille, nombre de foyers « n.d. ».
    expect(feux({ ...fires, readAt: null })).toEqual({ label: 'Feux', value: null, level: 'medium' });
    // Les deux en panne : n.d.
    expect(feux({ ...fires, readAt: null, forestDanger: null })).toEqual({ label: 'Feux', value: null, level: null });
  });

  it('tuile « Météo » (S3) : une part indisponible ne compte pas dans le niveau de la tuile, les autres gardent leur couleur', () => {
    const tile = domainTiles(signals({ vigilanceUnavailable: true, floodAlerts: 1, fireFoyersConfirmed: 1 }), 'fr').find((x) => x.label === 'Météo');
    expect([tile?.level, tile?.parts]).toEqual(['high', [
      { label: 'Vigilance', value: null, level: null },
      { label: 'Crues', value: 1, level: 'high' },
      { label: 'Feux', value: 1, level: 'medium' },
    ]]);
  });

  it('tuile « Météo » rendue : chaque part avec sa puce et son chiffre, aucune somme', () => {
    const html = renderDomainsBlock({ signals: signals({ meteoAlerts: 2, fireFoyersConfirmed: 3, fireDetections: 119 }), meteo: [] }, 'fr');
    expect(html).toContain('<span class="frintel-dom-part"><span class="frintel-dom-dot" style="background:var(--sev-orange);"></span>Vigilance\u00a02</span>');
    expect(html).toContain('<span class="frintel-dom-part"><span class="frintel-dom-dot" style="background:var(--sev-green);"></span>Crues\u00a00</span>');
    expect(html).toContain('Feux\u00a03</span>');
    expect(html).not.toContain('124');
  });

  it('étiquettes : risques météo cumulés, SNCF fortes, titres critiques', () => {
    const chips = domainChips({
      signals: signals({ railSevere: 3, criticalNews: 2 }),
      meteo: [
        { department: 'Var', departmentCode: '83', level: 'yellow', risks: ['thunderstorm' as const] },
        { department: 'Gard', departmentCode: '30', level: 'yellow', risks: ['thunderstorm' as const] },
      ],
    }, 'fr');
    expect(chips).toEqual([
      { text: 'Orages · Jaune ×2', tone: 'warn' },
      { text: '3 SNCF fortes', tone: 'warn' },
      { text: '2 titres critiques', tone: 'crit' },
    ]);
  });

  it('mix énergétique : segments non nuls seulement', () => {
    expect(energySegments(energy({ shares: { nuclear: 70, gas: 0, hydro: 10, wind: 8, solar: 4, other: 8 } })).map((s) => s.key))
      .toEqual(['nuclear', 'hydro', 'wind', 'solar', 'other']);
  });

  it('statut pétrolier : jamais vert si inconnu', () => {
    expect(oilStatusInfo('tense', 'fr')).toEqual({ level: 'orange', label: 'Sous tension' });
    expect(oilStatusInfo('critical', 'fr')).toEqual({ level: 'rouge', label: 'Critique' });
    expect(oilStatusInfo('normal', 'en')).toEqual({ level: 'vert', label: 'Normal' });
    expect(oilStatusInfo('unknown', 'fr')).toEqual({ level: null, label: 'Inconnu' });
    expect(oilStatusInfo(null, 'fr')).toEqual({ level: null, label: 'Inconnu' });
  });

  it('intensité de la chronologie', () => {
    expect([0, 1, 2, 3, 9].map(timelineIntensity)).toEqual([0.08, 0.25, 0.45, 0.65, 0.9]);
  });
});
