// src/components/layer-panel/outages-legend.test.ts
// Légendes de carte des couches Pannes réseau (spec 2026-10-08) : identifiants, sources appelées réellement, teintes MapLibre égales aux
// jetons de main.css.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { LegendCategory } from '../MapLegend.ts';
import { breakableValue } from './format.ts';
import { levelHex } from '../../services/vigilance.ts';
import {
  OUT_LATE_HEX, OUT_LONG_HEX, OUT_MAINT_HEX, OUT_RECENT_HEX, OUT_REF_HEX, cloudLegend, internetLegend, powerLegend, telecomLegend,
} from './outages-legend.ts';

const css = readFileSync(new URL('../../styles/main.css', import.meta.url), 'utf8');
const text = (c: LegendCategory): string[] =>
  [c.title, ...c.items.map((i) => i.label), c.source?.label ?? '', c.refresh?.label ?? '', ...(c.notes ?? [])];

describe('teintes : jetons CSS égaux aux hex de MapLibre', () => {
  it('--cat-out-recent, --cat-out-long et --cat-out-maint valent les hex de la carte', () => {
    for (const [token, hex] of [['--cat-out-recent', OUT_RECENT_HEX], ['--cat-out-long', OUT_LONG_HEX], ['--cat-out-maint', OUT_MAINT_HEX]] as const) {
      expect(css, token).toContain(`${token}: ${hex};`);
    }
  });
  it('le gris d’une donnée en retard est le gris de sévérité --sev-grey', () => {
    expect(css).toContain(`--sev-grey: ${OUT_LATE_HEX};`);
  });
  it('les trois teintes de catégorie et le gris sont distincts', () => {
    expect(new Set([OUT_RECENT_HEX, OUT_LONG_HEX, OUT_MAINT_HEX, OUT_LATE_HEX]).size).toBe(4);
  });
  it('--cat-out-ref (inventaire du référentiel Cloud) vaut OUT_REF_HEX, distinct des teintes de catégorie et de niveau', () => {
    expect(OUT_REF_HEX).toBe('#8b8f9a');
    expect(css).toContain(`--cat-out-ref: ${OUT_REF_HEX};`);
    const others = [OUT_RECENT_HEX, OUT_LONG_HEX, OUT_MAINT_HEX, OUT_LATE_HEX, ...(['vert', 'jaune', 'orange', 'rouge'] as const).map(levelHex)];
    expect(others).not.toContain(OUT_REF_HEX);
  });
});

describe('légendes : identifiants, teintes et sources', () => {
  it('Télécoms : identifiants et couleurs des trois classes', () => {
    const l = telecomLegend();
    expect([l.id, l.title]).toEqual(['outagesTelecom', 'Télécoms mobiles']);
    expect(l.items.map((i) => i.id)).toEqual(['telecom-recent', 'telecom-long', 'telecom-maint']);
    expect(l.items.map((i) => i.color)).toEqual([OUT_RECENT_HEX, OUT_LONG_HEX, OUT_MAINT_HEX]);
    expect(l.refresh?.label).toContain('ARCEP');
  });
  it('Électricité : identifiants, arrêt imprévu en rouge, maintenance en gris clair, unités sans emplacement non dessinées', () => {
    const l = powerLegend();
    expect([l.id, l.title]).toEqual(['outagesElec', 'Électricité : production et transport']);
    expect(l.items.map((i) => i.id)).toEqual(['power-unplanned', 'power-planned']);
    expect(l.items.map((i) => i.color)).toEqual([OUT_RECENT_HEX, OUT_MAINT_HEX]);
    expect(l.notes?.join(' ')).toContain('sans emplacement connu n’est pas dessinée');
  });
  it('Internet : département en anomalie en cours (rouge) et contour des anomalies terminées depuis moins de 7 jours ; opérateur et outre-mer dits non dessinés', () => {
    const l = internetLegend();
    expect([l.id, l.title]).toEqual(['outagesInternet', 'Internet']);
    expect(l.items.map((i) => i.id)).toEqual(['internet-ongoing', 'internet-recent']);
    expect(l.items.map((i) => i.color)).toEqual([levelHex('rouge'), OUT_LONG_HEX]);
    expect(l.items.every((i) => i.shape === 'zone')).toBe(true);
    expect(l.refresh?.label).toContain('IODA');
    expect(l.refresh?.label).toContain('Cloudflare Radar');
    const notes = l.notes?.join(' ') ?? '';
    expect(notes).toContain('Un opérateur n’a pas de lieu : il n’est pas dessiné.');
    expect(notes).toContain('Outre-mer : listé dans le panneau, non dessiné.');
    expect(notes).toContain('Donnée en retard');
  });
  it('Cloud : une teinte par statut, le référentiel en teinte neutre, un site coloré seulement si son fournisseur publie un état', () => {
    const l = cloudLegend();
    expect([l.id, l.title]).toEqual(['outagesCloud', 'Cloud et hébergement']);
    expect(l.items.map((i) => i.id)).toEqual(['cloud-ok', 'cloud-maint', 'cloud-degraded', 'cloud-partial', 'cloud-major', 'cloud-ref']);
    expect(l.items.map((i) => i.color)).toEqual([levelHex('vert'), OUT_MAINT_HEX, levelHex('jaune'), levelHex('orange'), levelHex('rouge'), OUT_REF_HEX]);
    expect(l.items.at(-1)?.label).toBe('Centre de données du référentiel (inventaire)');
    expect(l.refresh?.label).toContain('Pages d’état');
    expect(l.notes?.join(' ')).toContain('Un site n’est coloré que si son fournisseur publie un état.');
  });
  it('aucun libellé ne contient « temps réel », « LIVE » ni de tiret cadratin', () => {
    for (const c of [telecomLegend(), powerLegend(), internetLegend(), cloudLegend()]) {
      for (const t of text(c)) expect(t).not.toMatch(/temps réel|LIVE|\u2014/i);
    }
  });
  it('R1 : aucun nombre séparé de son unité par une espace sécable', () => {
    for (const c of [telecomLegend(), powerLegend(), internetLegend(), cloudLegend()]) {
      for (const t of text(c)) expect(breakableValue(t), t).toBeNull();
    }
  });
  it('copies : modifier une légende rendue ne change pas la suivante', () => {
    telecomLegend().items.push({ id: 'x', label: 'x' });
    expect(telecomLegend().items).toHaveLength(3);
    internetLegend().items.push({ id: 'x', label: 'x' });
    cloudLegend().items.push({ id: 'x', label: 'x' });
    expect(internetLegend().items).toHaveLength(2);
    expect(cloudLegend().items).toHaveLength(6);
  });
});
