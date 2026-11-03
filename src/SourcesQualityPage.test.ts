// @vitest-environment happy-dom
// src/SourcesQualityPage.test.ts : page séparée Sources & qualité. 03/11/2026 : « 0 source active » remplacé par « non mesuré » sans
// relevé de la carte ; refonte (maquette A) : ligne d'état L1, puces de filtre, sources groupées par thème, problèmes d'abord.
import { afterEach, describe, expect, it } from 'vitest';
import { agoLabel, filterSources, groupSources, measureNote, renderSourcesQualityPage, snapshotWhen, sourceFamily } from './SourcesQualityPage.ts';
import { SOURCES_SNAPSHOT_KEY, serializeSourcesSnapshot } from './services/sources-snapshot.ts';
import type { QualitySourceRow, QualityStatus } from './services/qualityMeta.ts';
import type { DataSourceStatus } from './types/index.ts';

const NOW = Date.parse('2026-11-03T10:35:00Z');
const ok = (name: string): DataSourceStatus => ({ name, status: 'ok', lastUpdate: new Date(Date.now() - 60_000) });
const text = (el: Element): string => (el.textContent ?? '').replace(/[ \t\n]+/g, ' ');
const row = (name: string, domain: string, status: QualityStatus, official = true): QualitySourceRow => ({
  id: name, name, domain, typeLabel: official ? 'Officielle' : 'Technique',
  quality: { status, sourceType: official ? 'official' : 'technical', confidenceScore: 80 }, lastCollectionLabel: 'N/D', limitsLabel: 'Limite',
});

afterEach(() => localStorage.clear());

describe('Sources & qualité sans relevé de la carte', () => {
  it('« non mesuré » au lieu de chiffres, lien vers la carte, pas de filtre « À surveiller »', () => {
    const host = document.createElement('div');
    renderSourcesQualityPage(host);
    const t = text(host);
    expect(t).toContain('État des flux non mesuré.');
    expect(host.querySelector('.sq-unmeasured a')?.getAttribute('href')).toBe('/?view=app#live');
    expect(host.querySelector('.sq-state')).toBeNull();
    expect(host.querySelector('[data-sq-filter="issue"]')).toBeNull();
    const states = [...host.querySelectorAll('.sq-st')].map(text);
    expect(states.length).toBeGreaterThan(30);
    expect(states.every((s) => s.includes('non mesuré'))).toBe(true);
  });
});

describe('Sources & qualité avec un relevé de la carte', () => {
  it('relevé daté, ligne d’état, les deux comptes expliqués', () => {
    localStorage.setItem(SOURCES_SNAPSHOT_KEY, serializeSourcesSnapshot([ok('Vigicrues'), ok('RTE'), { name: 'DGS-Urgent', status: 'error', lastUpdate: null }], Date.now() - 4 * 60_000));
    const host = document.createElement('div');
    renderSourcesQualityPage(host);
    const t = text(host);
    expect(t).toContain('État relevé par la carte le');
    expect(t).toContain('3\u00a0flux techniques (2\u00a0à jour)');
    expect(host.querySelector('.sq-state')).not.toBeNull();
    expect(t).not.toContain('non mesuré');
  });

  it('un clic sur une puce filtre la liste et garde la même grille de colonnes', () => {
    localStorage.setItem(SOURCES_SNAPSHOT_KEY, serializeSourcesSnapshot([ok('Vigicrues')], Date.now()));
    const host = document.createElement('div');
    renderSourcesQualityPage(host);
    const all = host.querySelectorAll('.sq-row').length;
    const energy = host.querySelector<HTMLButtonElement>('[data-sq-filter="Énergie"]');
    energy?.click();
    const groups = [...host.querySelectorAll('.sq-group h2')].map(text);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toContain('Énergie');
    expect(host.querySelectorAll('.sq-row').length).toBeLessThan(all);
    expect(energy?.getAttribute('aria-pressed')).toBe('true');
    // l'en-tête de colonnes n'est pas re-rendu : il reste le même nœud, sur la même grille que les lignes
    expect(host.querySelector('.sq-cols')).not.toBeNull();
  });
});

describe('outils de la page', () => {
  it('heure de Paris et âge du relevé', () => {
    expect(snapshotWhen(NOW - 4 * 60_000, NOW)).toBe('03/11 à 11:31 (il y a 4\u00a0min)');
    expect(snapshotWhen(NOW - 75 * 60_000, NOW)).toBe('03/11 à 10:20 (il y a 1\u00a0h\u00a015)');
    expect(agoLabel(3 * 86_400_000)).toBe('il y a 3\u00a0j');
    expect(measureNote(null, 38)).toContain('non mesuré');
  });

  it('familles, filtres et ordre « problèmes d’abord »', () => {
    expect(sourceFamily('Crues')).toBe('Météo et environnement');
    expect(sourceFamily('Inconnu au registre')).toBe('Autres');
    const rows = [row('B', 'Énergie', 'active'), row('A', 'Énergie', 'active'), row('C', 'Énergie', 'error'), row('D', 'Cyber', 'cached', false), row('E', 'Cyber', 'unknown', false)];
    expect(filterSources(rows, 'issue').map((r) => r.name)).toEqual(['C', 'D']);
    expect(filterSources(rows, 'official').map((r) => r.name)).toEqual(['B', 'A', 'C']);
    expect(groupSources(rows, true).map(([f, l]) => [f, l.map((r) => r.name)])).toEqual([
      ['Énergie', ['C', 'A', 'B']],
      ['Défense, cyber et sanctions', ['D', 'E']],
    ]);
    expect(groupSources(rows, false)[0][1].map((r) => r.name)).toEqual(['A', 'B', 'C']);
  });
});
