// src/components/layer-panel/env-brief.test.ts : panneau « En bref » de l'onglet Environnement.
import { describe, expect, it } from 'vitest';
import type { FloodsResponse, MapLayers, VigilanceResponse, WebcamsDataset } from '../../types/index.ts';
import { buildHazards, computeExposure, type ExposureAsset } from '../../services/environment-exposure.ts';
import { visibleText } from './format.ts';
import { renderLayerView } from './frame.ts';
import { buildEnvBriefView, envAttention, envBriefNoteText, envChanges, envRisingForecasts, envOverallLevel, envTomorrow, envWebcams, type EnvBriefInput } from './env-brief.ts';
import type { WatchLevel } from './watch.ts';

const NOW = Date.parse('2026-10-20T10:00:00Z');

const vigilance = (j: Array<[string, 1 | 2 | 3 | 4]>, j1: Array<[string, 1 | 2 | 3 | 4]> | null): VigilanceResponse => {
  const period = (echeance: 'J' | 'J1', list: Array<[string, 1 | 2 | 3 | 4]>) => ({
    echeance, begin: '2026-10-20T00:00:00Z', end: '2026-10-21T00:00:00Z', maxColor: 3 as const, comment: null, greenDepartments: 90, coast: [], counts: [], perPhenomenon: [],
    departments: list.map(([code, color]) => ({ code, name: code, color, phenomena: [{ id: '2' as const, color, slots: [] }] })),
  });
  return {
    updateTime: null, textsUpdateTime: null, bulletins: [], history: { days: [], since: null }, readAt: null, errors: [],
    periods: j1 === null ? [period('J', j)] : [period('J', j), period('J1', j1)],
  };
};

const floods: FloodsResponse = {
  readAt: '2026-10-20T09:55:00Z', total: 337, counts: { vert: 336, jaune: 0, orange: 1, rouge: 0 }, stationsReadAt: null, stationsOmitted: 0, errors: [],
  sections: [{
    id: 'MO12', name: 'Gardon', level: 3, territory: { code: '21', name: null, url: '' }, path: [[[4.0, 44.0], [4.2, 44.0]]],
    stations: [{ code: 'V1', name: 'Alès', lat: 44.1, lon: 4.08, lastAt: '2026-10-20T09:40:00Z', heightM: 2.1, flowM3s: null, change1hM: 0.32, heightSeries: [], flowSeries: [] }],
  }],
};

const assets: ExposureAsset[] = [
  { id: 'seveso-1', kind: 'seveso-haut', name: 'Usine chimique', commune: 'Salindres', dept: '30', lon: 4.1, lat: 44.01, detail: 'Seveso seuil haut', url: null },
  { id: 'hop-1', kind: 'hopital', name: 'CHU de Nîmes', commune: 'Nîmes', dept: '30', lon: 4.36, lat: 43.84, detail: 'urgences adultes', url: null },
];

const webcams: WebcamsDataset = {
  generatedAt: '2026-10-18T00:00:00Z', sources: [],
  webcams: [
    { id: 'w1', name: 'Pont d’Alès', lat: 44.1, lon: 4.08, commune: 'Alès', dept: '30', source: 'osm', pageUrl: null, imageUrl: null, streamUrl: null, license: null, attribution: null, status: 'ok', httpStatus: 200, contentType: null, checkedAt: null, countable: false },
    { id: 'w2', name: 'Morte', lat: 44.1, lon: 4.08, commune: 'Alès', dept: '30', source: 'osm', pageUrl: null, imageUrl: null, streamUrl: null, license: null, attribution: null, status: 'down', httpStatus: 404, contentType: null, checkedAt: null, countable: false },
    { id: 'w3', name: 'Ailleurs', lat: 48.8, lon: 2.3, commune: 'Paris', dept: '75', source: 'osm', pageUrl: null, imageUrl: null, streamUrl: null, license: null, attribution: null, status: 'ok', httpStatus: 200, contentType: null, checkedAt: null, countable: false },
  ],
};

function input(over: Partial<EnvBriefInput> = {}): EnvBriefInput {
  const v = vigilance([['30', 3], ['34', 2]], [['30', 4], ['13', 3]]);
  const hazards = buildHazards({ vigilance: v, floods, fires: null, earthquakes: null, ems: null, now: NOW });
  return {
    levels: new Map<keyof MapLayers, WatchLevel>([['environmental', 'orange'], ['floods', 'orange'], ['fires', 'vert'], ['airQuality', 'nd']]),
    labels: { environmental: 'Vigilance météo', floods: 'Crues' },
    vigilance: v, floods, fires: null, earthquakes: null, ems: null,
    exposure: computeExposure(hazards, assets), assetsLoading: false, assetsMissing: [],
    webcams, changes: [{ key: 'floods', label: 'Crues', from: 'jaune', to: 'orange', at: NOW - 2 * 3600_000 }],
    sources: [{ key: 'floods', label: 'Crues (Vigicrues)', at: NOW - 6 * 60_000, verb: 'lu', level: 'orange' }, { key: 'airQuality', label: 'Qualité de l’air', at: null, verb: 'lu', level: 'nd' }],
    now: NOW, open: (_id, byDefault) => byDefault, ...over,
  };
}

describe('En bref : en-tête', () => {
  it('niveau = pire pastille ; chiffre = enjeux proches ; phrase des phénomènes les plus graves', () => {
    const v = buildEnvBriefView(input());
    expect(v.head.level).toBe('orange');
    expect(v.head.figure).toMatchObject({ value: '1', level: 'orange' });
    expect(v.head.lead).toContain('Vigilance orange pluie-inondation (Gard)');
  });
  it('niveau n.d. seulement si toutes les pastilles lues sont indisponibles', () => {
    expect(envOverallLevel(new Map<keyof MapLayers, WatchLevel>([['fires', 'nd'], ['floods', 'vert']]))).toBe('vert');
    expect(envOverallLevel(new Map<keyof MapLayers, WatchLevel>([['fires', 'nd']]))).toBe('nd');
    expect(envOverallLevel(new Map())).toBeNull();
  });
});

describe('En bref : ce qui demande attention', () => {
  it('une pastille rouge sans zone (sécheresse) passe en tête, et la phrase d’en-tête la nomme', () => {
    const levels = new Map<keyof MapLayers, WatchLevel>([['environmental', 'orange'], ['drought', 'rouge']]);
    const i = input({ levels, labels: { drought: 'Sécheresse', environmental: 'Vigilance météo' } });
    expect(envAttention(i)[0]).toMatchObject({ text: 'Sécheresse rouge', level: 'rouge' });
    expect(buildEnvBriefView(i).head.lead).toBe('Sécheresse rouge (arrêtés de restriction d’eau, VigiEau).');
  });
});

describe('En bref : sections', () => {
  it('six sections dans l’ordre de lecture d’une permanence', () => {
    expect(buildEnvBriefView(input()).sections.map((s) => s.id)).toEqual(['attention', 'changes', 'tomorrow', 'exposed', 'webcams', 'sources']);
  });
  it('ce qui change : passage de niveau et station en hausse, le plus récent d’abord', () => {
    const c = envChanges(input());
    expect(c.map((x) => x.text)).toEqual(['Gardon : station en hausse, Alès +32\u00a0cm en 1\u00a0h', 'Crues : passe de jaune à orange']);
  });
  it('demain : le Gard passe en rouge, les Bouches-du-Rhône passent en orange', () => {
    expect(envTomorrow(input().vigilance)).toEqual([
      { dept: '30', level: 'rouge', today: 'orange', phenomena: 'pluie-inondation' },
      { dept: '13', level: 'orange', today: 'vert', phenomena: 'pluie-inondation' },
    ]);
  });
  it('demain non publié : dit, jamais vide', () => {
    const t = visibleText(renderLayerView('envBrief', buildEnvBriefView(input({ vigilance: vigilance([['30', 3]], null) }))));
    expect(t).toContain('Échéance de demain non publiée par Météo-France.');
  });
  it('enjeux : site Seveso à 1,1 km du Gardon, comptes du Gard en vigilance orange', () => {
    const t = visibleText(renderLayerView('envBrief', buildEnvBriefView(input())));
    expect(t).toContain('Usine chimique');
    expect(t).toContain('à 1,1\u00a0km');
    expect(t).toContain('Gard · Vigilance orange pluie-inondation');
    expect(t).toContain('1\u00a0site Seveso seuil haut, 1\u00a0service d’urgences (Usine chimique)');
  });
  it('enjeux non lus : dit ; en lecture : chargement', () => {
    const t = visibleText(renderLayerView('envBrief', buildEnvBriefView(input({ assetsMissing: ['EHPAD'] }))));
    expect(t).toContain('Enjeux non lus : EHPAD.');
    const loading = buildEnvBriefView(input({ exposure: null, assetsLoading: true }));
    expect(loading.sections.find((s) => s.id === 'exposed')?.summary).toBe('…');
  });
  it('voir sur place : webcams actives des départements touchés seulement', () => {
    expect(envWebcams(input()).map((w) => w.id)).toEqual(['w1']);
  });
  it('fraîcheur : âge de la donnée, n.d. pour une source indisponible', () => {
    const s = buildEnvBriefView(input()).sections.find((x) => x.id === 'sources');
    expect(s?.html).toContain('lu il y a 6\u00a0min');
    expect(visibleText(s?.html ?? '')).toContain('n.d.');
  });
  it('jamais de tiret cadratin', () => {
    expect(renderLayerView('envBrief', buildEnvBriefView(input()))).not.toContain('—');
    expect(envBriefNoteText(input())).not.toContain('—');
  });
});

describe('En bref : hausse prévue par Vigicrues', () => {
  it('station dont la moyenne prévue dépasse la mesure : listée dans « À venir » et dans la note', () => {
    const st = floods.sections[0].stations[0];
    const withForecast: FloodsResponse = { ...floods, sections: [{ ...floods.sections[0], stations: [{ ...st, forecast: {
      producedAt: '2026-10-20T09:00:00Z', points: [{ at: '2026-10-20T12:00:00Z', min: 2.3, mean: 2.6, max: 2.9 }],
    } }] }] };
    const i = input({ floods: withForecast });
    const [r] = envRisingForecasts(i);
    expect(r).toMatchObject({ section: 'Gardon', station: 'Alès', text: '2,10 → 2,60\u00a0m dans 2\u00a0h', level: 'orange' });
    expect(r.rise).toBeCloseTo(0.5, 5);
    expect(buildEnvBriefView(i).sections.find((x) => x.id === 'tomorrow')?.title).toBe('À venir');
    expect(envBriefNoteText(i)).toContain('- Gardon, Alès : 2,10 → 2,60 m dans 2 h.');
  });
});

describe('En bref : texte pour une note', () => {
  it('texte brut, phénomènes, évolutions, demain, enjeux, sources', () => {
    const t = envBriefNoteText(input());
    expect(t).toContain('Environnement, point de situation du 20/10/2026 12:00');
    expect(t).toContain('- Vigilance orange pluie-inondation : Gard.');
    expect(t).toContain('- Gard : rouge (pluie-inondation).');
    expect(t).toContain('- Usine chimique (Salindres), à 1,1 km : Crue orange · Gardon.');
    expect(t).not.toContain('<');
    expect(t).not.toContain('\u00a0');
  });
});

describe('En bref : habitants des communes touchées (20/10/2026)', () => {
  it('ligne du phénomène : communes, habitants, méthode ; repris dans la note', () => {
    const i = input();
    const hz = i.exposure?.hazards.find((h) => h.kind === 'crue');
    const population = new Map([[hz?.id ?? '', { communes: [{ code: '30321', name: 'Sommières', dept: '30', pop: 5000, lon: 4.09, lat: 43.785 }], total: 5000, method: 'zone-inondable' as const }]]);
    const t = visibleText(renderLayerView('envBrief', buildEnvBriefView({ ...i, population })));
    expect(t.replace(/[\u00a0\u202f]/g, ' ')).toContain('1 commune, 5 000 habitants (Sommières) · communes riveraines de la zone inondable cartographiée');
    expect(envBriefNoteText({ ...i, population })).toContain('1 commune, 5 000 habitants (Sommières)');
  });
});
