// src/components/layer-panel/criminalite.test.ts : vue pure du panneau Criminalité, sur le vrai fichier public/data/crime.json.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CrimeDataset, CrimeIndicatorKey } from '../../types/index.ts';
import { isCrimeDataset } from '../../services/crime.ts';
import { breakableValue, visibleText } from './format.ts';
import { renderLayerView } from './frame.ts';
import { buildCriminaliteView, frDate, indicatorSelectHtml } from './criminalite.ts';
import { CRIME_LEGEND, crimeLegend } from './criminalite-legend.ts';
import { formatCrimeRate, formatEvolution, readingNote } from './crime-format.ts';

const DASH = String.fromCharCode(0x2014);
const raw: unknown = JSON.parse(readFileSync(new URL('../../../public/data/crime.json', import.meta.url), 'utf8'));
const ds = (): CrimeDataset => {
  if (!isCrimeDataset(raw)) throw new Error('crime.json invalide');
  return raw;
};
const view = (indicator: CrimeIndicatorKey = 'homicides', data: CrimeDataset | null = ds(), error: string | null = null) =>
  buildCriminaliteView({ data, error, indicator, canFocus: true, now: Date.now(), open: (_id, byDefault) => byDefault });
const html = (indicator: CrimeIndicatorKey = 'homicides') => renderLayerView('crime', view(indicator));

describe('en-tête', () => {
  it('chiffre = homicides France de l’année du fichier, pas de niveau, ligne de source datée', () => {
    const v = view();
    expect(v.head.theme).toBe('Sécurité et défense');
    expect(v.head.title).toBe('Criminalité');
    expect(v.head.figure?.caption).toBe('homicides en 2025');
    expect(v.head.figure?.value).toBe('975');
    expect(v.head.level).toBeNull();
    expect(v.head.status).toEqual(['SSMSI · données 2025 · publié le 09/07/2026']);
  });
  it('chargement, puis fichier indisponible', () => {
    expect(view('homicides', null).bodyHtml).toBeDefined();
    expect(view('homicides', null).sections).toEqual([]);
    const err = view('homicides', null, 'HTTP 500');
    expect(err.head.figure?.value).toBe('n.d.');
    expect(err.bodyHtml).toContain('indisponible');
  });
  it('date française', () => {
    expect(frDate('2026-07-09')).toBe('09/07/2026');
    expect(frDate(null)).toBeNull();
  });
});

describe('sélecteur', () => {
  it('liste les 16 indicateurs, l’indicateur choisi est sélectionné', () => {
    const h = indicatorSelectHtml(ds(), 'cambriolages');
    expect(h.match(/<option /g)).toHaveLength(16);
    expect(h).toContain('<option value="cambriolages" selected>');
    expect(h).toContain('data-crime-indicator');
    expect(view('cambriolages').bodyHtml).toContain('data-crime-indicator');
  });
});

describe('sections', () => {
  it('cinq sections dans l’ordre voulu', () => {
    expect(view().sections.map((s) => s.id)).toEqual(['homicides', 'villes', 'departements', 'france', 'methode']);
    expect(view().sections.at(-1)?.tone).toBe('reference');
  });
  it('homicides : 15 départements au taux pour 100 000, mention explicite sans chiffre par ville, tendance 2016 à 2025', () => {
    const sec = view().sections[0];
    expect((sec.html.match(/class="lp-row/g) ?? [])).toHaveLength(15);
    const t = visibleText(sec.html);
    expect(t).toContain('pour\u00a0100\u00a0000\u00a0hab.');
    expect(t).toContain('Pas de chiffre par ville : le ministère de l’Intérieur ne publie les homicides qu’au département.');
    expect(sec.html).toContain('<svg');
    expect(t).toContain('2016');
    expect(sec.title).toBe('Homicides par département (2025)');
  });
  it('villes : homicides, département seulement, invite à choisir un autre indicateur', () => {
    const sec = view('homicides').sections[1];
    expect(sec.html).not.toContain('lp-row');
    expect(visibleText(sec.html)).toContain('publié au département seulement');
    expect(visibleText(sec.html)).toContain('Choisir un autre indicateur');
  });
  it('villes : 20 lignes cliquables classées par taux, avec nombre, évolution et département', () => {
    const sec = view('violencesPhysiques').sections[1];
    expect(sec.title).toMatch(/^Villes de 20[\u00a0\u202f]000\u00a0habitants et plus$/);
    expect(sec.html.match(/class="lp-row/g)).toHaveLength(20);
    expect(sec.html).toMatch(/data-crime="[\d.]+,[\d.]+"/);
    expect(sec.html).toContain('data-crime-city="');
    expect(sec.html).toContain('is-link');
    const t = visibleText(sec.html);
    expect(t).toMatch(/ · \d/);
    expect(t).toMatch(/vs\u00a02024/);
    expect(t).toContain('‰');
  });
  it('villes sans lien quand la carte ne peut pas recentrer', () => {
    const v = buildCriminaliteView({ data: ds(), error: null, indicator: 'cambriolages', canFocus: false, now: 0, open: () => true });
    expect(v.sections[1].html).not.toContain('is-link');
  });
  it('départements : 15 lignes avec le rapport à la France', () => {
    const sec = view('cambriolages').sections[2];
    expect(sec.html.match(/class="lp-row/g)).toHaveLength(15);
    expect(visibleText(sec.html)).toMatch(/fois\u00a0la France|fois la France/);
  });
  it('France : les 16 indicateurs avec nombre, taux et évolution', () => {
    const sec = view().sections[3];
    expect(sec.html.match(/class="lp-row/g)).toHaveLength(16);
    expect(visibleText(sec.html)).toContain('Cambriolages');
  });
  it('méthode : enregistrée et non réelle, lieu des faits, pour mille, secret statistique, rééditions, lien, aucun effet', () => {
    const sec = view().sections[4];
    const t = visibleText(sec.html);
    expect(t).toContain('Délinquance enregistrée');
    expect(t).toContain('pas la délinquance réelle');
    expect(t).toContain('Lieu de commission');
    expect(t).toContain('pour mille logements');
    expect(t).toContain('estimé');
    expect(t).toContain('janvier et en juillet');
    expect(sec.html).toContain(`href="${ds().sourceUrl}"`);
    expect(t).toContain('aucun effet sur l’indice de stabilité, les situations ni la synthèse');
  });
});

describe('estimé, formats et typographie', () => {
  it('un nombre masqué par le secret statistique est dit « estimé »', () => {
    expect(readingNote({ count: null, rate: 1.2, estimated: true, previous: null }, 2024)).toBe('estimé');
    expect(readingNote({ count: 12, rate: 1.2, estimated: false, previous: 10 }, 2024)).toBe('12\u00a0faits · +20\u00a0%\u00a0vs\u00a02024');
    expect(readingNote({ count: 1, rate: 1.2, estimated: false, previous: null }, 2024)).toContain('1\u00a0fait');
  });
  it('une ville au nombre masqué mais au taux publié figure au classement, dite « estimé »', () => {
    const base = ds();
    const city = { ...base.cities[0], name: 'Villetest', code: 'zz', values: { cambriolages: [null, 99, null] as [number | null, number | null, number | null] } };
    const v = buildCriminaliteView({ data: { ...base, cities: [city, ...base.cities] }, error: null, indicator: 'cambriolages', canFocus: true, now: 0, open: () => true });
    const first = visibleText(v.sections[1].html).slice(0, 120);
    expect(first).toContain('Villetest');
    expect(first).toContain('estimé');
  });
  it('taux : homicides pour 100 000, autres en ‰, jamais « 0,0 »', () => {
    expect(formatCrimeRate('homicides', 0.0143)).toBe('1,4\u00a0pour\u00a0100\u00a0000\u00a0hab.');
    expect(formatCrimeRate('volsArmes', 0.0574)).toBe('0,057\u00a0‰');
    expect(formatCrimeRate('cambriolages', 8.6726)).toBe('8,7\u00a0‰');
    expect(formatCrimeRate('cambriolages', null)).toBe('n.d.');
    expect(formatEvolution(110, 100)).toBe('+10\u00a0%');
    expect(formatEvolution(null, 100)).toBe('n.d.');
  });
  it('aucun nombre séparé de son unité par une espace sécable, aucun tiret cadratin', () => {
    for (const key of ['homicides', 'violencesPhysiques', 'cambriolages', 'stupefiantsTrafic'] as const) {
      const h = html(key);
      expect(breakableValue(visibleText(h))).toBeNull();
      expect(h).not.toContain(DASH);
    }
    expect(JSON.stringify(CRIME_LEGEND)).not.toContain(DASH);
  });
});

describe('légende', () => {
  it('cinq bandes, règle de couleur et réserve sur les homicides', () => {
    expect(CRIME_LEGEND.items).toHaveLength(5);
    expect(CRIME_LEGEND.notes?.join(' ')).toContain('département seulement');
  });
  it('datée : indicateur, année, taux de la France', () => {
    const note = crimeLegend(ds(), 'cambriolages').notes?.[0] ?? '';
    expect(note).toContain('Cambriolages');
    expect(note).toContain('2025');
    expect(note).toContain('pour mille logements');
    expect(crimeLegend(null, 'homicides').notes?.[0]).toContain('indisponible');
  });
});
