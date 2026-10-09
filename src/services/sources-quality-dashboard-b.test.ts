// src/services/sources-quality-dashboard-b.test.ts : tableau de qualité, sources de la phase B (contrats § 3.4 ; amendement 7, O15, S7,
// S8) : une entrée par ligne du panneau des sources, socle selon la nature de la source, limites dites.
import { describe, expect, it } from 'vitest';
import { OUTAGES_SOURCE_NAMES } from '../config/outages-sources.ts';
import { SOVEREIGNTY_SOURCE_NAMES } from '../config/sovereignty-sources.ts';
import { getSourceQualityRegistry } from './sources-quality-dashboard.ts';

describe('tableau de qualité : sources de la phase B', () => {
  it('Grille GNSS, NOAA SWPC, RIPEstat, Registre des gels', () => {
    const byId = new Map(getSourceQualityRegistry().map((e) => [e.id, e]));
    const ids = ['gnss-grid', 'noaa-swpc', 'ripestat', 'gels-avoirs'];
    expect(ids.map((id) => [byId.get(id)?.watchdogNames, byId.get(id)?.natureBaseline, byId.get(id)?.domain, byId.get(id)?.sourceType])).toEqual([
      [['Grille GNSS'], 50, 'Défense', 'technical'], [['NOAA SWPC'], 90, 'Météo spatiale', 'official'],
      [['RIPEstat'], 80, 'Connectivité', 'open_data'], [['Registre des gels'], 90, 'Sanctions', 'official'],
    ]);
    // Chaque ligne nommée est une ligne réelle du panneau des sources.
    for (const id of ids) for (const name of byId.get(id)?.watchdogNames ?? []) expect(SOVEREIGNTY_SOURCE_NAMES).toContain(name);
    expect(byId.get('gnss-grid')?.limits).toContain('Une maille dégradée est à vérifier : seules la DGAC et l’ANFR qualifient un brouillage');
    expect(byId.get('gnss-grid')?.limits).toContain('Mailles localisées publiées pour le jour UTC précédent seulement ; en direct, un compte sans lieu');
    expect(byId.get('ripestat')?.limits).toContain('Hors score : visibilité d’un réseau, pas sa disponibilité');
    expect(byId.get('gels-avoirs')?.limits).toContain('Aucun nom affiché');
    const text = JSON.stringify(ids.map((id) => byId.get(id)));
    expect(text).not.toMatch(/\u2014|brouillage mesuré|navigation dégradée|pleinement visible/);
    // Un nombre et son unité tiennent sur une ligne (R1).
    expect(text).not.toMatch(/\d (?:heures|h|%|jours)\b/);
  });
});

describe('tableau de qualité : sources Pannes réseau (Télécoms et Électricité)', () => {
  it('chaque ligne du panneau des sources Pannes réseau a son entrée, une seule fois ; plus de ligne « Télécoms »', () => {
    const registry = getSourceQualityRegistry();
    const watched = registry.flatMap((e) => e.watchdogNames);
    for (const name of OUTAGES_SOURCE_NAMES) expect(watched.filter((n) => n === name)).toHaveLength(1);
    expect(watched).not.toContain('Télécoms');
    const byId = new Map(registry.map((e) => [e.id, e]));
    expect(['arcep', 'edf-indispo', 'rte-iip', 'edf-sei'].map((id) => byId.get(id)?.watchdogNames)).toEqual(
      OUTAGES_SOURCE_NAMES.map((n) => [n]),
    );
    const text = JSON.stringify(['arcep', 'edf-indispo', 'rte-iip', 'edf-sei'].map((id) => byId.get(id)));
    expect(text).not.toMatch(/\u2014|temps réel/i);
  });
});
