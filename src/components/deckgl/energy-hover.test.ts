// src/components/deckgl/energy-hover.test.ts
import { describe, expect, it } from 'vitest';
import {
  chokeCard, clusterCard, flowCard, fmtNum, fmtTime, infraCard, powerUnitCard, regionCard, tooltipCardHtml, gasCard,
} from './energy-hover.ts';
import { effectiveOpacity, energyCardFor, hydroCard, oilDepotCard, oilDepotDetailCard } from './energy-hover.ts';
import { ENERGY_HOVER_LAYER_IDS, pickEnergyHover, type HoverCandidate } from './energy-hover.ts';

describe('gabarit de bulle', () => {
  it('nombres au format français avec unité insécable ; n.d. si absent', () => {
    expect(fmtNum(1310, 'MW')).toBe(`${(1310).toLocaleString('fr-FR')} MW`);
    expect(fmtNum(10.12, '%', 1)).toBe('10,1 %');
    expect(fmtNum(undefined, 'MW')).toBe('n.d.');
    expect(fmtNum(Number.NaN, 'MW')).toBe('n.d.');
  });
  it('heure courte ; null si illisible', () => {
    expect(fmtTime('2026-10-16T07:45:00Z')).toMatch(/^\d{2}:\d{2}$/);
    expect(fmtTime('')).toBeNull();
  });
  it('titre, état en mots et en couleur, lignes, source ; jamais de tiret cadratin ni de undefined', () => {
    const html = tooltipCardHtml({ sectorHex: '#8b5cf6', title: 'Belleville <1>', time: '09:45', state: 'maintenance',
      rows: [['Indisponible', '1 310 MW']], source: 'EDF' });
    expect(html).toContain('Belleville &lt;1&gt;');
    expect(html).toContain('Arrêt annoncé ou hors service');
    expect(html).toContain('Source : EDF · 09:45');
    expect(html).not.toMatch(/—|undefined|NaN/);
    const nd = tooltipCardHtml({ sectorHex: '#fff', title: 'X', time: null, state: null, rows: [], source: null });
    expect(nd).toContain('Source : n.d.');
  });
  it('site nucléaire : liste trois unités indisponibles au plus, puis le reste', () => {
    const units = ['A', 'B', 'C', 'D'].map((n) => ({ name: n, lostMw: 900, kind: 'planifiee' }));
    const c = infraCard({ type: 'nuclear', name: 'Tricastin', energyState: 'maintenance', available: 2700, power: 3600 }, units);
    expect(c.rows.map((r) => r[0])).toEqual(['Disponible', 'A', 'B', 'C', 'Autres unités']);
    expect(c.rows[4][1]).toBe('1');
  });
  it('unité EDF : nom lisible, indisponibilité et nature', () => {
    const c = powerUnitCard({ name: 'FR_MAREGES_G3', kind: 'planifiee', lostMw: 120, energyState: 'maintenance', sector: 'Hydraulique' });
    expect(c.title).toBe('Marèges G3');
    expect(c.rows).toEqual([['Filière', 'Hydraulique'], ['Indisponible', fmtNum(120, 'MW')], ['Nature', 'maintenance']]);
  });
  it('stockage de gaz : sans relevé, état « sans état suivi » et remplissage n.d.', () => {
    const c = gasCard({ type: 'storage', name: 'Lussagnet', energyState: 'nonSuivi', fillLevel: null, capacity: 3.5 });
    expect(c.state).toBe('nonSuivi');
    expect(c.rows[0]).toEqual(['Remplissage', 'n.d.']);
  });
  it('groupe : nombre, alertes, invitation à zoomer', () => {
    const c = clusterCard('wind', 42, 2);
    expect(c.title).toBe('42 éoliennes');
    expect(c.rows).toEqual([['Dont en alerte', '2']]);
    expect(c.hint).toBe('Zoomer pour le détail');
  });
  it('flux et détroit', () => {
    const f = flowCard({ kind: 'petrole', isImport: true, who: 'Afrique', flowValue: 336, flowUnit: 'kb/j', hubName: 'Fos / Lavera' });
    expect(f.title).toBe('Afrique · pétrole');
    expect(f.rows).toContainEqual(['Port d’arrivée', 'Fos / Lavera']);
    const d = chokeCard({ name: 'Suez', flows: JSON.stringify([{ who: 'Moyen-Orient', value: 93, unit: 'kb/j' }]) });
    expect(d.rows).toEqual([['Moyen-Orient', fmtNum(93, 'kb/j')], ['Total', fmtNum(93, 'kb/j')]]);
  });
  it('région', () => {
    const r = regionCard({ name: 'Grand Est', consumptionMw: 4700, productionMw: 6100, deltaPct: -8.2, updatedAt: null });
    expect(r.rows).toEqual([['Consommation', fmtNum(4700, 'MW')], ['Production', fmtNum(6100, 'MW')], ['Solde', `+${fmtNum(1400, 'MW')}`]]);
  });
});

const c = (layerId: string, over: Partial<HoverCandidate> = {}): HoverCandidate => ({ layerId, properties: {}, distancePx: 2, opacity: 1, ...over });

describe('arbitre de survol', () => {
  it('une alerte passe devant une installation, une installation devant un flux, un flux devant la région', () => {
    expect(pickEnergyHover([c('power-region-fill'), c('energy-flow-lines'), c('gas-storages')])?.layerId).toBe('gas-storages');
    expect(pickEnergyHover([c('power-region-fill'), c('energy-flow-lines')])?.kind).toBe('flow');
    const alert = c('out-power-unplanned', { properties: { energyState: 'arret' }, distancePx: 3 });
    expect(pickEnergyHover([c('energy-infra-circles', { distancePx: 0 }), alert])?.layerId).toBe('out-power-unplanned');
  });
  it('à rang égal, le plus proche du curseur gagne', () => {
    const a = c('oil-refineries', { distancePx: 3, properties: { name: 'Fos' } });
    const b = c('gas-terminals', { distancePx: 1, properties: { name: 'Cavaou' } });
    expect(pickEnergyHover([a, b])?.properties.name).toBe('Cavaou');
  });
  it('un calque transparent, atténué ou inconnu ne répond pas ; aucun candidat donne null', () => {
    expect(pickEnergyHover([c('gas-storages', { opacity: 0 })])).toBeNull();
    expect(pickEnergyHover([c('gas-storages', { opacity: 0.1 }), c('power-region-fill')])?.kind).toBe('region');
    expect(pickEnergyHover([c('news-points')])).toBeNull();
    expect(pickEnergyHover([])).toBeNull();
  });
  it('tous les calques du tableau sont interrogés', () => {
    expect(ENERGY_HOVER_LAYER_IDS).toContain('energy-choke');
    expect(ENERGY_HOVER_LAYER_IDS).toContain('hydro-cluster');
    expect(ENERGY_HOVER_LAYER_IDS).not.toContain('interconn-arc-hitarea');
  });
});
describe('aiguillage des bulles', () => {
  it('chaque type de survol donne sa carte ; les données de contexte manquantes donnent n.d.', () => {
    expect(energyCardFor({ kind: 'windCluster', properties: { point_count: 42, alerts: 2 } }, {})?.title).toBe('42 éoliennes');
    expect(energyCardFor({ kind: 'region', properties: { code: '44', nom: 'Grand Est' } }, {})?.rows[0]).toEqual(['Consommation', 'n.d.']);
    expect(energyCardFor({ kind: 'region', properties: { code: '44', nom: 'Grand Est' } }, {})?.rows[2]).toEqual(['Solde', 'n.d.']);
    expect(energyCardFor({ kind: 'infra', properties: { type: 'nuclear', name: 'Bugey', energyState: 'arret' } }, { units: [] })?.state).toBe('arret');
  });
  it('les autres types sont aiguillés vers leur constructeur', () => {
    expect(energyCardFor({ kind: 'hydroCluster', properties: { point_count: 7, alerts: 0 } }, {})?.title).toBe('7 barrages');
    expect(energyCardFor({ kind: 'choke', properties: { name: 'Ormuz', flows: '[]' } }, {})?.title).toBe('Ormuz');
    expect(energyCardFor({ kind: 'gasPipeline', properties: { name: '' } }, {})?.title).toBe('Gazoduc');
    expect(energyCardFor({ kind: 'powerUnit', properties: { name: 'X', kind: 'imprevue', lostMw: 10 } }, {})?.rows[2]).toEqual(['Nature', 'arrêt imprévu']);
  });
});

describe('position de l’objet retenu', () => {
  it('l’arbitre rend la position du point retenu (bulle d’un site : unités voisines)', () => {
    const hit = pickEnergyHover([{ layerId: 'energy-infra-circles', properties: {}, distancePx: 1, opacity: 1, coordinates: [5.27, 45.8] }]);
    expect(hit?.coordinates).toEqual([5.27, 45.8]);
  });
});

describe('gazoducs', () => {
  it('opérateur déduit du calque, département de la donnée', () => {
    const c = energyCardFor({ kind: 'gasPipeline', layerId: 'gas-network-terega-line', properties: { nom_du_departement: 'Landes' } }, {});
    expect(c?.rows).toEqual([['Nature', 'Gazoduc'], ['Opérateur', 'Teréga'], ['Département', 'Landes']]);
    const g = energyCardFor({ kind: 'gasPipeline', layerId: 'gas-network-grt-line', properties: {} }, {});
    expect(g?.rows[1]).toEqual(['Opérateur', 'GRTgaz']);
  });
});

describe('relecture finale', () => {
  it('opacité : un calque pâle par nature répond ; seul un calque atténué par la légende se tait', () => {
    expect(effectiveOpacity(0.16, 0.16)).toBe(1);
    expect(effectiveOpacity(0.16 * 0.15, 0.16)).toBeCloseTo(0.15);
    expect(effectiveOpacity(['*', ['get', 'x'], 0.15], undefined)).toBe(0.15);
    expect(effectiveOpacity(['match', ['get', 'x'], 'a', 1, 0.5], undefined)).toBe(1);
    expect(effectiveOpacity(0, 0)).toBe(0);
  });
  it('site nucléaire et ses unités au même point : la bulle du site, qui liste les unités', () => {
    const at: readonly [number, number] = [5.27, 45.8];
    const hit = pickEnergyHover([
      { layerId: 'out-power-unplanned', properties: { energyState: 'arret', name: 'BUGEY 2' }, distancePx: 0, opacity: 1, coordinates: at },
      { layerId: 'out-power-planned', properties: { energyState: 'maintenance', name: 'BUGEY 3' }, distancePx: 0, opacity: 1, coordinates: at },
      { layerId: 'energy-infra-circles', properties: { type: 'nuclear', name: 'Bugey', energyState: 'normal' }, distancePx: 0, opacity: 1, coordinates: at },
    ]);
    expect(hit?.layerId).toBe('energy-infra-circles');
    expect(hit?.coordinates).toEqual(at);
  });
  it('unité EDF isolée (pas de site nucléaire voisin) : la bulle de l’unité', () => {
    const hit = pickEnergyHover([
      { layerId: 'out-power-planned', properties: { name: 'MAREGES' }, distancePx: 0, opacity: 1, coordinates: [2.3, 45.4] },
      { layerId: 'energy-infra-circles', properties: { type: 'nuclear', name: 'Golfech' }, distancePx: 3, opacity: 1, coordinates: [0.85, 44.1] },
    ]);
    expect(hit?.layerId).toBe('out-power-planned');
  });
  it('sans mesure : « Disponible » et capacités nulles en n.d., jamais une valeur inventée', () => {
    const c = infraCard({ type: 'nuclear', name: 'Bugey', energyState: 'nonSuivi', available: 3600, power: 3600 }, []);
    expect(c.rows[0]).toEqual(['Disponible', 'n.d.']);
    expect(infraCard({ type: 'thermal', name: 'X', capacity: 0 }, []).rows[0]).toEqual(['Capacité', 'n.d.']);
    expect(hydroCard({ name: 'B', capacityMw: 0 }).rows[1]).toEqual(['Puissance', 'n.d.']);
  });
  it('barrage : libellés lisibles (type, tendance, source), heure lue sur la date brute', () => {
    const c = hydroCard({ name: 'Sablons', type: 'hydro_production', hydroTrend: 'low', signalSource: 'DERIVED_CONTEXT_ONLY',
      observationTimestamp: '16/10/2026 09:45', lastUpdate: '2026-10-16T07:45:00Z', capacityMw: 81 });
    expect(c.rows).toEqual([['Type', 'Production hydraulique'], ['Puissance', fmtNum(81, 'MW')], ['Tendance', 'retenue basse']]);
    expect(c.source).toBe('Hub’Eau (contexte, sans station liée)');
    expect(c.time).toMatch(/^\d{2}:\d{2}$/);
  });
});

describe('dépôts pétroliers', () => {
  it('bulle : type, capacité en m³ (valeur sur une ligne), opérateur', () => {
    const c = oilDepotCard({ name: 'Frontignan (SAGESS)', role: 'strategic', capacityM3: 450000, operator: 'SAGESS' });
    expect(c.rows).toEqual([['Type', 'Dépôt stratégique'], ['Capacité', fmtNum(450000, 'm³')], ['Opérateur', 'SAGESS']]);
    expect(oilDepotCard({ name: 'X', role: 'distribution' }).rows).toEqual([['Type', 'Dépôt'], ['Capacité', 'n.d.'], ['Opérateur', 'n.d.']]);
  });
  it('fiche : rôle expliqué, imports qui arrivent au port, raffineries voisines', () => {
    const c = oilDepotDetailCard({ name: 'Dépôt Fos-sur-Mer', role: 'terminal', capacityM3: 3000000, operator: 'Raffineries' }, {
      imports: [{ who: 'Moyen-Orient', value: 93, unit: 'kb/j' }, { who: 'Afrique', value: 336, unit: 'kb/j' }],
      refineries: ['Lavéra', 'Fos-sur-Mer'],
    });
    expect(c.hint).toContain('Point d’entrée');
    expect(c.rows).toContainEqual(['Import · Afrique', fmtNum(336, 'kb/j')]);
    expect(c.rows).toContainEqual(['Import · Moyen-Orient', fmtNum(93, 'kb/j')]);
    expect(c.rows.findIndex((r) => r[0] === 'Import · Afrique')).toBeLessThan(c.rows.findIndex((r) => r[0] === 'Import · Moyen-Orient'));
    expect(c.rows).toContainEqual(['Raffineries à moins de 30 km', 'Lavéra, Fos-sur-Mer']);
    const s = oilDepotDetailCard({ name: 'Frontignan (SAGESS)', role: 'strategic' }, { imports: [], refineries: [] });
    expect(s.hint).toContain('SAGESS');
  });
});
