// src/components/layer-panel/drom.test.ts
import { describe, expect, it } from 'vitest';
import type { DromEnergyDashboard } from '../../services/drom-energy/index.ts';
import { DROM_NOW, dromLiveFixture } from './drom.fixture.ts';
import { buildDromView, DROM_TABS, sectorShares, type DromViewInput } from './drom.ts';
import { renderLayerView } from './frame.ts';
import { NBSP, breakableValue, visibleText } from './format.ts';

const open = (_: string, d: boolean): boolean => d;
const DASH: DromEnergyDashboard = {
  territories: [], communeMetrics: [], productionLimitations: [], datasets: [], updatedAt: '2026-04-29T16:38:45.329Z',
  assets: [
    { id: 'a1', territoryCode: 'RE', type: 'source_substation', name: '<img src=x onerror=1>', sourceDatasetId: 'x', voltageKv: 63, communeName: 'Saint-Denis', operator: 'EDF SEI' },
    { id: 'a2', territoryCode: 'RE', type: 'htb_pylon', name: 'Pylône 2', sourceDatasetId: 'x' },
  ],
};
const input = (over: Partial<DromViewInput> = {}): DromViewInput => ({
  live: dromLiveFixture(), liveError: null, dashboard: DASH, dashboardError: null, territory: 'RE', assetType: 'all', now: DROM_NOW, open, ...over,
});
const view = (over: Partial<DromViewInput> = {}) => buildDromView(input(over));
const html = (over: Partial<DromViewInput> = {}): string => renderLayerView('dromEnergy', view(over));

describe('vue Énergie DROM', () => {
  it('sélecteur de territoire : cinq onglets, territoire actif', () => {
    expect(DROM_TABS).toEqual(['RE', 'GP', 'MQ', 'GF', 'COR']);
    const v = view({ territory: 'GF' });
    expect(v.tabs?.map((t) => t.label)).toEqual(['Réunion', 'Guadeloupe', 'Martinique', 'Guyane', 'Corse']);
    expect(v.activeTab).toBe('GF');
  });
  it('en-tête : puissance totale en gros chiffre, part renouvelable, heure de Paris et heure locale, pas de pastille', () => {
    const v = view();
    expect(v.head.title).toBe('Énergie DROM');
    expect(v.head.level ?? null).toBeNull();
    expect(v.head.figure).toEqual({ value: `339${NBSP}MW`, caption: `La Réunion · 43${NBSP}% renouvelable` });
    expect(v.head.status).toEqual(['données de 08:55 (10:55 heure locale)', 'EDF SEI, estimé']);
    expect(v.head.lead).toBe(`La Réunion : 339${NBSP}MW ; fioul et diesel 35${NBSP}%, charbon 22${NBSP}%, photovoltaïque 21${NBSP}%.`);
  });
  it('heure locale des Antilles (UTC−4) et de la Corse (heure de Paris), statut non publié en Guyane', () => {
    expect(view({ territory: 'GP' }).head.status[0]).toBe('données de 08:56 (02:56 heure locale)');
    expect(view({ territory: 'COR' }).head.status[0]).toBe('données de 08:45');
    expect(view({ territory: 'GF' }).head.status[1]).toBe('EDF SEI');
  });
  it('donnée en retard au-delà de 30 minutes', () => {
    expect(view({ now: DROM_NOW + 40 * 60_000 }).head.status[0]).toBe('données de 08:55 (10:55 heure locale, en retard)');
  });
  it('parts par filière : valeurs positives seulement, triées', () => {
    const t = dromLiveFixture().territories[0];
    expect(sectorShares(t).slice(0, 3).map((x) => [x.sector, x.pct])).toEqual([['oil', 35], ['coal', 22], ['solar', 21]]);
    expect(sectorShares(t).find((x) => x.sector === 'turbine')?.pct ?? null).toBeNull();
  });
  it('sections dans l’ordre, ouvertes et repliées comme la spec', () => {
    expect(view().sections.map((s) => [s.id, s.open ?? false])).toEqual([['mix', true], ['day', true], ['all', false], ['infra', false], ['sources', false]]);
    expect(view().sections.at(-1)?.tone).toBe('reference');
  });
  it('production par filière : barre empilée et légende en couleurs de filière ; négatifs en légende seulement', () => {
    const s = view().sections.find((x) => x.id === 'mix');
    expect(s?.summary).toBe(`339${NBSP}MW · 43${NBSP}% renouvelable`);
    const h = s?.html ?? '';
    const bar = /<div class="lp-mix">([^]*?)<\/div>/.exec(h)?.[1] ?? '';
    expect(bar).toContain('var(--mix-oil)');
    expect(bar).toContain('var(--mix-coal)');
    expect(bar).not.toContain('var(--mix-turbine)');
    expect(h).toMatch(new RegExp(`var\\(--mix-turbine\\)[^]*Turbines à combustion[^]*−0,2${NBSP}MW`));
    expect(h).toContain('Valeur négative : stockage en charge, export par les liaisons ou consommation des auxiliaires.');
  });
  it('courbe du jour : journée locale, pic à l’heure locale', () => {
    const s = view().sections.find((x) => x.id === 'day');
    expect(s?.summary).toBe(`pic 339${NBSP}MW à 10:55 (heure locale)`);
    expect(s?.html).toContain('role="img"');
    expect(view({ territory: 'COR' }).sections.find((x) => x.id === 'day')?.summary).toBe(`pic 250${NBSP}MW à 08:45`);
  });
  it('les cinq territoires : puissance, part renouvelable en jauge de catégorie, heure ; territoire injoignable dit', () => {
    const s = view().sections.find((x) => x.id === 'all');
    expect(s?.summary).toBe(`4 sur 5 joignables · 813${NBSP}MW`);
    const h = s?.html ?? '';
    expect(h).toMatch(new RegExp(`Guadeloupe[^]*width:27%;background:var\\(--cat-renewable\\)[^]*141${NBSP}MW`));
    expect(h).toMatch(/Martinique[^]*Source injoignable/);
    expect(h).toContain('(UTC−3)');
  });
  it('territoire en erreur : chiffre n.d., encadré, autres sections conservées', () => {
    const v = view({ territory: 'MQ' });
    expect(v.head.figure?.value).toBe('n.d.');
    expect(v.bodyHtml).toContain('Source injoignable.');
    expect(v.sections.map((s) => s.id)).toEqual(['all', 'infra', 'sources']);
  });
  it('EDF injoignable avec données antérieures : dernières données et encadré daté', () => {
    const v = view({ liveError: 'HTTP 502' });
    expect(v.bodyHtml).toContain('Source injoignable. Dernières données : 09:00.');
    expect(v.head.figure?.value).toBe(`339${NBSP}MW`);
    const none = view({ live: null, liveError: 'HTTP 502' });
    expect(none.bodyHtml).toContain('Source injoignable. Aucune donnée reçue.');
    expect(none.sections.map((s) => s.id)).toEqual(['infra', 'sources']);
  });
  it('infrastructures : actifs du territoire, couleurs de type reprises, filtre de type, Corse et données absentes dites', () => {
    const h = view().sections.find((x) => x.id === 'infra')?.html ?? '';
    expect(h).not.toContain('<img');
    expect(h).toMatch(new RegExp(`background:var\\(--cat-substation\\)[^]*63${NBSP}kV[^]*Postes sources · Saint-Denis · EDF SEI`));
    expect(h).toContain('data-drom-filter="type"');
    expect(h).toContain('data-drom-asset="a1"');
    const pylons = view({ assetType: 'htb_pylon' }).sections.find((x) => x.id === 'infra')?.html ?? '';
    expect(pylons).toContain('Pylône 2');
    expect(pylons).not.toContain('data-drom-asset="a1"');
    expect(view({ territory: 'COR' }).sections.find((x) => x.id === 'infra')?.html).toContain('Pas d’inventaire d’infrastructures pour la Corse dans cette couche.');
    const empty = view({ dashboard: { ...DASH, assets: [] } }).sections.find((x) => x.id === 'infra')?.html ?? '';
    expect(empty).toContain('Aucune donnée d’infrastructure ouverte publiée pour ce territoire');
    expect(empty).toContain('Les enregistrements de démonstration ne sont pas affichés.');
    expect(view({ dashboard: null }).sections.find((x) => x.id === 'infra')?.html).toContain('Inventaire en cours de chargement…');
  });
  it('sources : EDF open data, pas de 5 min, estimé, Mayotte non publiée', () => {
    const h = view().sections.find((x) => x.id === 'sources')?.html ?? '';
    expect(h).toContain('href="https://opendata.edf.fr"');
    expect(h).toMatch(/pas de 5\u00A0min/);
    expect(h).toContain('Mayotte : production non publiée en temps réel.');
  });
  it('chargement ; R1 ; aucun tiret cadratin, aucune police à chasse fixe, aucune couleur brute', () => {
    expect(view({ live: null }).bodyHtml).toContain('Chargement des données…');
    for (const territory of DROM_TABS) {
      const h = html({ territory });
      expect(breakableValue(visibleText(h))).toBeNull();
      expect(h).not.toMatch(/—|&mdash;|monospace|#[0-9a-fA-F]{6}\b|rgba?\(/);
    }
  });
});
