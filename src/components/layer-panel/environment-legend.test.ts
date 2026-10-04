import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FiresResponse, FloodsResponse, VigilancePeriod, VigilanceResponse } from '../../types/index.ts';
import type { Radar2dManifest } from '../../services/radar-2d.ts';
import { levelHex } from '../../services/vigilance.ts';
import type { LegendCategory } from '../MapLegend.ts';
import { envBreakable } from './environment-format.ts';
import { NBSP } from './format.ts';
import {
  ECHO_TOP_CLASSES, ENV_NEUTRAL_HEX, FIRES_LEGEND, FIRE_ABROAD_HEX, FIRE_RECURRENT_HEX, FLOODS_LEGEND, FLOOD_STATION_HEX, RADAR_DBZ_CLASSES,
  AIR_QUALITY_LEGEND, DROUGHT_LEGEND, RADAR_LEGEND, VIGILANCE_LEGEND, firesLegend, floodsLegend, radarLegend, vigilanceLegend, withFillMask,
} from './environment-legend.ts';

const css = readFileSync(new URL('../../styles/main.css', import.meta.url), 'utf8');
const render = readFileSync(new URL('../../../services/radar-worker/render.py', import.meta.url), 'utf8');
const NOW = Date.parse('2026-10-04T10:10:00+02:00');
const H = 3_600_000;
const text = (c: LegendCategory): string =>
  [c.title, ...c.items.map((i) => i.label), c.source?.label ?? '', c.refresh?.label ?? '', ...(c.notes ?? [])].join(' | ');
const COLORS_GONE = 'En retard : couleurs de niveau retirées de la carte.';

function period(echeance: 'J' | 'J1', begin: string, end: string): VigilancePeriod {
  return { echeance, begin, end, maxColor: 3, comment: null, departments: [], greenDepartments: 96, coast: [], counts: [], perPhenomenon: [] };
}
const VIGILANCE: VigilanceResponse = {
  updateTime: '2026-10-04T08:00:12Z', textsUpdateTime: '2026-10-04T08:00:12Z',
  periods: [period('J', '2026-10-04T08:00:00Z', '2026-10-04T22:00:00Z'), period('J1', '2026-10-04T22:00:00Z', '2026-10-05T22:00:00Z')],
  bulletins: [], history: { days: [], since: null }, readAt: '2026-10-04T08:05:00Z', errors: [],
};
const FLOODS: FloodsResponse = {
  readAt: '2026-10-04T08:05:00Z', total: 337, counts: { vert: 333, jaune: 4, orange: 0, rouge: 0 }, sections: [], stationsReadAt: '2026-10-04T08:05:00Z',
  stationsOmitted: 0, errors: [],
};
const MANIFEST: Radar2dManifest = {
  schemaVersion: 1, source: 'Météo-France DPRadar', observedAt: '2026-10-04T08:05:00Z', generatedAt: '2026-10-04T08:10:25Z',
  bounds: [-9.965, 39.46785, 14.564708, 53.67], imageUrl: 'https://www.francemonitor.com/radar/rasters/radar-20261004T0805Z.webp', resolutionMeters: 1000,
  license: 'Licence Ouverte 2.0', echoTopImageUrl: 'https://www.francemonitor.com/radar/rasters/radar-echotops-20261004T0805Z.webp',
};
const FIRES: FiresResponse = {
  readAt: '2026-10-04T08:00:00Z', lastAcquisitionAt: '2026-10-04T04:43:00Z', sources: [], detections: [], abroadCount: 0, abroad: [], foyers: [],
  daily: { days: [], since: null }, nextPasses: [],
  forestDanger: { publishedAt: '2026-10-03T14:50:06Z', j1Date: '2026-10-04', j2Date: '2026-10-05', season: 'en-saison', departments: [], history: [] },
  errors: [],
};

describe('teintes : jetons CSS égaux aux hex de MapLibre, palettes du worker radar', () => {
  it('catégories de l’environnement', () => {
    expect(css).toContain(`--cat-station-hydro: ${FLOOD_STATION_HEX};`);
    expect(css).toContain(`--cat-feu-recurrent: ${FIRE_RECURRENT_HEX};`);
    expect(css).toContain(`--cat-feu-etranger: ${FIRE_ABROAD_HEX};`);
    RADAR_DBZ_CLASSES.forEach((c, i) => expect(css).toContain(`--radar-dbz-${i + 1}: ${c.hex};`));
    ECHO_TOP_CLASSES.forEach((c, i) => expect(css).toContain(`--echo-top-${i + 1}: ${c.hex};`));
  });
  it('classes dBZ et sommets d’écho : mêmes seuils et teintes que services/radar-worker/render.py', () => {
    const hex = (r: string, g: string, b: string): string => `#${[r, g, b].map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`;
    const palette = (name: string): Array<[number, string]> => {
      const start = render.indexOf(`${name} = (`);
      const block = render.slice(start, render.indexOf('\n)', start));
      return [...block.matchAll(/\((-?[\d.]+), \((\d+), (\d+), (\d+), \d+\)\)/g)].map((m) => [Number(m[1]), hex(m[2], m[3], m[4])]);
    };
    expect(palette('PALETTE')).toEqual(RADAR_DBZ_CLASSES.map((c) => [c.dbz, c.hex]));
    expect(palette('ECHO_TOP_PALETTE')).toEqual(ECHO_TOP_CLASSES.map((c) => [c.km * 1000, c.hex]));
  });
  it('gris neutre hors palette L1 ; niveaux en palette L1', () => {
    expect(Object.values({ v: 'vert', j: 'jaune', o: 'orange', r: 'rouge' } as const).map((l) => levelHex(l))).not.toContain(ENV_NEUTRAL_HEX);
    expect(VIGILANCE_LEGEND.items.find((i) => i.id === 'env-vig-orange')?.color).toBe(levelHex('orange'));
    expect(FLOODS_LEGEND.items.find((i) => i.id === 'flood-yellow')?.color).toBe(levelHex('jaune'));
    expect(FIRES_LEGEND.items.find((i) => i.id === 'fire-recurrent')?.color).toBe(FIRE_RECURRENT_HEX);
  });
});

describe('légendes datées (S1), périmètres (E4), retard (S2)', () => {
  it('vigilance : carte datée, prochaine carte, échéance et ses bornes, périmètre ; en retard : couleurs retirées', () => {
    const l = vigilanceLegend(VIGILANCE, 'J', NOW);
    expect(l.id).toBe('environmental');
    expect(l.refresh?.label).toBe('Carte du 04/10 à 10:00 · prochaine vers 16:00');
    expect(l.notes?.[0]).toBe('Échéance affichée : aujourd’hui, de 10:00 à minuit.');
    expect(text(l)).toContain('Métropole et Corse ; l’outre-mer n’est pas dans ce flux.');
    expect(vigilanceLegend(VIGILANCE, 'J1', NOW).notes?.[0]).toBe('Échéance affichée : demain, de 00:00 à minuit.');
    const late = vigilanceLegend(VIGILANCE, 'J', Date.parse('2026-10-05T08:00:00Z'));
    expect(late.refresh?.label).toBe('Carte du 04/10 à 10:00 (en retard) · prochaine vers 16:00');
    expect(late.notes).toContain(COLORS_GONE);
    expect(vigilanceLegend(null, 'J', NOW).refresh?.label).toBe('Carte Météo-France indisponible');
  });
  it('crues : relevé du serveur (pas d’heure de bulletin), tronçons surveillés, pas une cote d’alerte', () => {
    const l = floodsLegend(FLOODS, NOW);
    expect(l.refresh?.label).toBe('Relevé Vigicrues 10:05');
    expect(l.notes?.[0]).toBe('337 tronçons surveillés par l’État ; verts non dessinés.');
    expect(text(l)).toContain('pas une cote d’alerte');
    expect(floodsLegend(FLOODS, NOW + H).notes).toContain(COLORS_GONE);
    expect(floodsLegend(null, NOW).refresh?.label).toBe('Vigicrues indisponible');
  });
  it('radar : image datée, mosaïque 1 km, pluie équivalente, sommets d’écho seulement si l’option est cochée', () => {
    const l = radarLegend(MANIFEST, false, NOW);
    expect(l.refresh?.label).toBe(`Image du 04/10 à 10:05 · mosaïque 1${NBSP}km · une image toutes les 5${NBSP}min`);
    expect(l.items.find((i) => i.id === 'radar-dbz-30')?.label).toBe(`30${NBSP}dBZ et plus · 2,7${NBSP}mm/h`);
    expect(l.items.some((i) => i.id.startsWith('echo-top'))).toBe(false);
    const tops = radarLegend(MANIFEST, true, NOW);
    expect(tops.items.find((i) => i.id === 'echo-top-8')?.label).toBe(`8${NBSP}km et plus`);
    expect(radarLegend(MANIFEST, false, NOW + 11 * 60_000).refresh?.label).toContain('(en retard)');
    expect(radarLegend(null, false, NOW).refresh?.label).toBe('Radar Météo-France indisponible');
    expect(RADAR_LEGEND.id).toBe('weatherRadar');
  });
  it('feux : dernière acquisition et son âge, périmètre France, météo des forêts nommée avec son jour réel si le remplissage est coché', () => {
    const l = firesLegend(FIRES, false, NOW);
    expect(l.refresh?.label).toBe(`Dernière acquisition 04/10 à 06:43 (il y a 3${NBSP}h${NBSP}27)`);
    expect(text(l)).toContain('Départements français seulement ; détections hors de France en gris.');
    // Arbitrage 14 du contrôleur : orange dès 10 MW cumulés, plus petit en jaune comme une détection isolée.
    expect(l.items.find((i) => i.id === 'fire-confirmed')?.label).toBe(`Foyer confirmé de 10${NBSP}MW ou plus (deux passages ou plus)`);
    expect(l.items.find((i) => i.id === 'fire-isolated')?.label).toBe(`Détection isolée ou foyer confirmé de moins de 10${NBSP}MW`);
    expect(l.items.some((i) => i.id.startsWith('mdf'))).toBe(false);
    const fill = firesLegend(FIRES, true, NOW);
    expect(fill.items.find((i) => i.id === 'mdf-2')?.color).toBe(levelHex('jaune'));
    expect(fill.notes).toContain('Météo des forêts publiée le 03/10 à 16:50, niveaux pour aujourd’hui.');
    expect(firesLegend(FIRES, false, NOW + 14 * H).notes).toContain(COLORS_GONE);
    expect(firesLegend({ ...FIRES, readAt: null }, false, NOW).refresh?.label).toBe('NASA FIRMS indisponible');
  });
  it('aucun tiret cadratin ni « temps réel » dans les légendes', () => {
    for (const l of [vigilanceLegend(VIGILANCE, 'J', NOW), floodsLegend(FLOODS, NOW), radarLegend(MANIFEST, true, NOW), firesLegend(FIRES, true, NOW)]) {
      expect(text(l)).not.toMatch(/\u2014|temps réel|live/i);
    }
  });
});

describe('R1 : aucune unité détachée dans les légendes', () => {
  it('envBreakable nul sur tous les textes de toutes les légendes', () => {
    const all = [
      VIGILANCE_LEGEND, FLOODS_LEGEND, RADAR_LEGEND, FIRES_LEGEND,
      vigilanceLegend(VIGILANCE, 'J', NOW), vigilanceLegend(VIGILANCE, 'J1', NOW), floodsLegend(FLOODS, NOW), radarLegend(MANIFEST, true, NOW),
      radarLegend(MANIFEST, true, NOW + 11 * 60_000), firesLegend(FIRES, true, NOW), firesLegend(FIRES, true, NOW + 14 * H),
    ];
    for (const l of all) expect(envBreakable(text(l))).toBeNull();
    expect(radarLegend(MANIFEST, true, NOW).items.find((i) => i.id === 'echo-top-0')?.label).toContain('pas un niveau');
  });
});

describe('deux remplissages départementaux : la légende du masqué le dit', () => {
  it('le dernier activé est au-dessus ; seul, aucune note', () => {
    expect(text(withFillMask(DROUGHT_LEGEND, ['drought', 'airQuality']))).toContain('Remplissage masqué par Qualité de l’air.');
    expect(text(withFillMask(AIR_QUALITY_LEGEND, ['drought', 'airQuality']))).not.toContain('masqué');
    expect(text(withFillMask(AIR_QUALITY_LEGEND, ['airQuality', 'drought']))).toContain('Remplissage masqué par Sécheresse.');
    expect(withFillMask(DROUGHT_LEGEND, ['drought'])).toBe(DROUGHT_LEGEND);
    expect(withFillMask(DROUGHT_LEGEND, [])).toBe(DROUGHT_LEGEND);
  });
});
