// src/components/layer-panel/pression.ts : vue pure du panneau « Pression par département » (refonte v2 de l'Indice stabilité,
// 12/10/2026) ; aucun accès réseau ni DOM. Niveau L1 par département (department-pressure.ts), cause dominante en mots, éléments
// du département choisi ; plus de score 0-100 qui contredisait l'indice national de l'en-tête.
import type { DepartmentPressure, PressureElement, PressureSource } from '../../services/department-pressure.ts';
import { themeLabel, type ThemeId } from '../../services/themes.ts';
import type { VigilanceLevel } from '../../services/vigilance.ts';
import { escapeHtml } from '../france-intel-events.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { emptyLine, listRow, loadingBody, type LayerView } from './frame.ts';

export interface PressureViewInput {
  /** null tant que les données du fil ne sont pas chargées. */
  depts: readonly DepartmentPressure[] | null;
  /** Département choisi dans la liste : ses éléments s'affichent. */
  selected: string | null;
  open: (sectionId: string, byDefault: boolean) => boolean;
}

const THEME = 'Sécurité et défense';
const TITLE = 'Pression par département';
const LIST_MAX = 20;

const SOURCE_LABEL: Record<PressureSource, string> = {
  event: 'Événement', situation: 'Situation', meteo: 'Vigilance', vigicrues: 'Vigicrues',
};
const LEVEL_WORD: Record<Exclude<VigilanceLevel, 'vert'>, string> = { rouge: 'rouge', orange: 'orange', jaune: 'jaune' };
const BADGE_WORD = { nouveau: 'Nouveau', aggrave: 'Aggravé' } as const;
/** Cause en mots : le thème, « Actualité » pour un sujet hors des thèmes (« Vue générale » n'est pas une cause). */
export function causeLabel(theme: ThemeId): string {
  return theme === 'general' ? 'Actualité' : themeLabel(theme);
}
const note = (text: string): string => `<p class="fmk-note">${escapeHtml(text)}</p>`;
const plural = (n: number, word: string): string => `${n} ${word}${n > 1 ? 's' : ''}`;

/** « 2 départements en rouge, 3 en orange » puis le département de tête et sa cause. */
export function pressureLead(depts: readonly DepartmentPressure[]): string {
  if (depts.length === 0) return 'Aucun département sous pression : aucun élément jaune ou plus n’y est rattaché.';
  const parts = (['rouge', 'orange', 'jaune'] as const)
    .map((lv) => [lv, depts.filter((d) => d.level === lv).length] as const)
    .filter(([, n]) => n > 0)
    .map(([lv, n], i) => (i === 0 ? `${plural(n, 'département')} en ${LEVEL_WORD[lv]}` : `${n} en ${LEVEL_WORD[lv]}`));
  const top = depts[0];
  return `${parts.join(', ')}. En tête : ${top.name}, ${causeLabel(top.driver).toLowerCase()}.`;
}

function deptNote(d: DepartmentPressure): string {
  const first = d.elements[0];
  const more = d.elements.length > 1 ? ` · +${d.elements.length - 1}` : '';
  const badge = d.badge ? `${BADGE_WORD[d.badge]} · ` : '';
  return `${badge}${first.title}${more}`;
}

function elementRow(e: PressureElement): string {
  return listRow({
    text: e.title, level: e.level, value: SOURCE_LABEL[e.source],
    note: e.badge ? BADGE_WORD[e.badge] : null,
    // Un événement ou une situation ouvre sa fiche ; un signal officiel n'a pas de fiche propre.
    link: e.key !== null, data: e.key !== null ? { key: e.key } : undefined,
  });
}

export function buildPressureView(input: PressureViewInput): LayerView {
  const { depts, open } = input;
  if (depts === null) {
    return { head: { theme: THEME, title: TITLE, status: [] }, sections: [], bodyHtml: loadingBody() };
  }
  const top = depts[0]?.level ?? null;
  const severe = depts.filter((d) => d.level === 'orange' || d.level === 'rouge').length;
  const sections: FicheSection[] = [];

  const rows = depts.slice(0, LIST_MAX).map((d) => listRow({
    text: `${d.name} (${d.code})`, level: d.level, value: causeLabel(d.driver), note: deptNote(d),
    link: true, data: { dept: d.code },
  })).join('');
  const rest = depts.length > LIST_MAX ? note(`Et ${plural(depts.length - LIST_MAX, 'autre département')} en jaune ou plus.`) : '';
  sections.push({
    id: 'depts', title: 'Départements sous pression', collapsible: true, open: open('depts', true),
    summary: escapeHtml(String(depts.length)),
    html: rows ? rows + rest : emptyLine('Aucun département en jaune ou plus.'),
  });

  const chosen = input.selected ? depts.find((d) => d.code === input.selected) : undefined;
  if (chosen) {
    sections.push({
      id: 'detail', title: `${chosen.name} : ${plural(chosen.elements.length, 'élément')}`, collapsible: false,
      html: chosen.elements.map(elementRow).join(''),
    });
  }

  sections.push({
    id: 'methode', title: 'Méthode', collapsible: true, open: open('methode', false), tone: 'reference',
    html: note('Chaque département prend le niveau de son élément le plus grave : événements recoupés situés dans le département '
      + '(jamais un événement à l’étranger ni un sujet national sans lieu), situations détectées, vigilance météo et tronçons Vigicrues. '
      + 'La cause indiquée est le thème de l’élément le plus grave, puis le plus représenté.')
      + note('Ce panneau ne remplace pas l’indice national de l’en-tête, calculé par sa propre méthode.'),
  });
  sections.push({
    id: 'sources', title: 'Sources', collapsible: true, open: open('sources', false), tone: 'reference',
    html: note('Événements recoupés France Monitor (presse nationale et régionale), moteur de situations, Météo-France (vigilance), Vigicrues.'),
  });

  return {
    head: {
      theme: THEME, title: TITLE, level: top,
      figure: { value: String(severe), caption: severe > 1 ? 'départements en orange ou rouge' : 'département en orange ou rouge', level: severe > 0 ? top : 'vert' },
      status: [plural(depts.length, 'département') + ' en jaune ou plus'],
      lead: pressureLead(depts),
    },
    sections,
  };
}
