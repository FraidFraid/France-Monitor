// src/components/layer-panel/theme-brief.test.ts : panneau « En bref » des onglets (Énergie, Sécurité, Santé, Transports, Vue générale).
import { describe, expect, it } from 'vitest';
import type { WorkItem } from '../../services/work-queue.ts';
import { visibleText } from './format.ts';
import { renderLayerView } from './frame.ts';
import { buildThemeBriefView, isZeroFigure, themeAttention, themeBriefLevel, themeBriefNoteText, themeChanges, type ThemeBriefInput } from './theme-brief.ts';

const NOW = Date.parse('2026-10-20T10:00:00Z');
const item = (over: Partial<WorkItem>): WorkItem => ({
  key: 'event:1', level: 'jaune', title: 'Panne électrique', place: 'Gard', since: NOW - 2 * 3_600_000, independentSources: 3,
  theme: 'energy', badge: null, ref: { kind: 'event' } as unknown as WorkItem['ref'], ...over,
});

function input(over: Partial<ThemeBriefInput> = {}): ThemeBriefInput {
  return {
    themeName: 'Énergie',
    pastilles: [
      { key: 'powerGrid', label: 'Réseau électrique', level: 'vert' },
      { key: 'nuclearFleet', label: 'Parc nucléaire', level: 'orange' },
      { key: 'gasNetwork', label: 'Réseau gaz', level: null },
      { key: 'oilNetwork', label: 'Pétrole', level: 'nd' },
    ],
    items: [
      item({ key: 'situation:a', level: 'rouge', title: 'Arrêt de 3 réacteurs', place: 'Vallée du Rhône', badge: 'aggrave' }),
      item({}),
    ],
    themeLevel: 'jaune',
    changes: [{ label: 'Parc nucléaire', from: 'jaune', to: 'orange', at: NOW - 3_600_000 }],
    eventsStatus: 'ok',
    now: NOW, open: (_id, byDefault) => byDefault, ...over,
  };
}

describe('synthèse des pastilles (en-tête du panneau de chaque pastille)', () => {
  it('chiffre clé, légende, phrase et état de la source ; le plus grave d’abord ; ligne cliquable vers le panneau', () => {
    const i = input({ pastilles: [
      { key: 'powerGrid', label: 'Réseau électrique', level: 'vert', head: { theme: 'Énergie', title: 'Réseau', figure: { value: '62,1\u00a0GW', caption: 'consommation' }, status: ['relevé il y a 3 min'] } },
      { key: 'nuclearFleet', label: 'Parc nucléaire', level: 'orange', head: { theme: 'Énergie', title: 'Nucléaire', figure: { value: '12,4\u00a0GW', caption: 'indisponibles' }, status: [], lead: 'Trois réacteurs à l’arrêt imprévu.' } },
      { key: 'gasNetwork', label: 'Réseau gaz', level: null, head: null },
    ] });
    const s = buildThemeBriefView(i).sections.find((x) => x.id === 'pastilles');
    const t = visibleText(s?.html ?? '');
    expect(t.indexOf('Parc nucléaire')).toBeLessThan(t.indexOf('Réseau électrique'));
    expect(t).toContain('indisponibles · Trois réacteurs à l’arrêt imprévu.');
    expect(t).toContain('consommation · relevé il y a 3 min');
    expect(t).toContain('panneau pas encore lu');
    expect(s?.html).toContain('data-pastille="nuclearFleet"');
    expect(themeBriefNoteText(i)).toContain('- Parc nucléaire : 12,4 GW indisponibles (orange).');
  });
});

describe('En bref des onglets', () => {
  it('niveau = pire entre le poste et les pastilles lisibles ; n.d. seulement si rien d’autre', () => {
    expect(themeBriefLevel(input())).toBe('orange');
    expect(themeBriefLevel({ pastilles: [{ key: 'oilNetwork', label: 'Pétrole', level: 'nd' }], themeLevel: null })).toBe('nd');
    expect(themeBriefLevel({ pastilles: [], themeLevel: null })).toBeNull();
  });
  it('pastille dont un élément parle déjà : pas répétée ; surtitre « Synthèse »', () => {
    const i = input({ items: [item({ key: 'official:meteo:rouge', level: 'rouge', title: 'Parc nucléaire : 3 réacteurs à l’arrêt' })] });
    expect(themeAttention(i).map((r) => r.text)).toEqual(['Parc nucléaire : 3 réacteurs à l’arrêt']);
    expect(renderLayerView('brief', buildThemeBriefView(input()))).toContain('Énergie · Synthèse');
  });
  it('attention : élément rouge d’abord, puis pastille orange ; jaune absent', () => {
    expect(themeAttention(input()).map((r) => [r.text, r.level])).toEqual([['Arrêt de 3 réacteurs', 'rouge'], ['Parc nucléaire orange', 'orange']]);
  });
  it('en-tête : chiffre = éléments orange ou rouges, phrase des plus graves', () => {
    const v = buildThemeBriefView(input());
    expect(v.head.figure).toMatchObject({ value: '1', level: 'rouge' });
    expect(v.head.lead).toBe('Arrêt de 3 réacteurs (Vallée du Rhône).');
    expect(v.sections.map((s) => s.id)).toEqual(['attention', 'pastilles', 'items', 'changes']);
  });
  it('éléments cliquables (clé de la liste) ; état des pastilles en mots, n.d. dit', () => {
    const html = renderLayerView('brief', buildThemeBriefView(input()));
    expect(html).toContain('data-work="situation:a"');
    const t = visibleText(html);
    // Élément jaune : dans « Autres éléments à traiter », avec son lieu et son âge.
    expect(t).toContain('Panne électrique');
    expect(html).toContain('data-work="event:1"');
    expect(t).toContain('n.d.');
    expect(t).toContain('non lu');
    expect(html).not.toContain('—');
  });
  it('ce qui change : passage de niveau et élément aggravé', () => {
    expect(themeChanges(input()).map((c) => c.text)).toEqual(['Parc nucléaire : passe de jaune à orange', 'Aggravé : Arrêt de 3 réacteurs']);
  });
  it('rien à traiter : dit, jamais vide', () => {
    const t = visibleText(renderLayerView('brief', buildThemeBriefView(input({ items: [], pastilles: [], changes: [] }))));
    expect(t).toContain('Rien en orange ni en rouge dans cet onglet.');
    expect(t).toContain('Rien à traiter dans cet onglet pour le moment.');
  });
  it('note : texte brut, sans HTML ni espace insécable', () => {
    const n = themeBriefNoteText(input());
    expect(n).toContain('Énergie, point de situation du 20/10/2026 12:00');
    expect(n).toContain('- Arrêt de 3 réacteurs : Vallée du Rhône.');
    expect(n).toContain('- Panne électrique (Gard).');
    expect(n).not.toMatch(/<|\u00a0/);
  });
});

describe('zéros lisibles (20/10/2026)', () => {
  it('compte de problèmes à zéro : « RAS » et la phrase du panneau, pas un 0 lu comme un score', () => {
    expect([isZeroFigure('0'), isZeroFigure('0,0'), isZeroFigure('10'), isZeroFigure('0,5')]).toEqual([true, true, false, false]);
    const i = input({ items: [], changes: [], pastilles: [
      { key: 'trafficAir', label: 'Trafic aérien', level: 'vert', head: { theme: 'Transports', title: 'Trafic aérien', figure: { value: '0', caption: 'aéronef en urgence' }, status: [], lead: 'Aucun code d’urgence en vol.' } },
    ] });
    const t = visibleText(buildThemeBriefView(i).sections.find((x) => x.id === 'pastilles')?.html ?? '');
    expect(t).toContain('RAS');
    expect(t).toContain('Aucun code d’urgence en vol.');
    expect(t).not.toContain('aéronef en urgence');
  });
  it('rien d’orange ni de rouge : pas de gros chiffre ; phrase de l’état des pastilles', () => {
    const v = buildThemeBriefView(input({ items: [], pastilles: [
      { key: 'oilNetwork', label: 'Pétrole', level: 'jaune' }, { key: 'powerGrid', label: 'Réseau électrique', level: 'vert' },
      { key: 'gasNetwork', label: 'Réseau gaz', level: 'vert' }, { key: 'nuclearFleet', label: 'Parc nucléaire', level: 'nd' },
    ] }));
    expect(v.head.figure).toBeNull();
    expect(v.head.lead).toBe('Aucun signal orange ou rouge · en jaune : Pétrole · 2 pastilles au vert · indisponible : Parc nucléaire.');
  });
});
