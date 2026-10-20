// src/components/layer-panel/crues-impact.ts : section « Conséquences des crues » du panneau Crues (20/10/2026). Pure, sans réseau ni DOM.
// Pour chaque tronçon en vigilance : zone inondable officielle (Géorisques, crue fréquente et moyenne) ou repli sur la distance au
// tronçon, habitants DANS la zone (carreaux Insee de 200 m, estimation arrondie) et communes touchées, enjeux (centrales, Seveso,
// urgences, EHPAD) dans la zone ou à portée, et ceux que la zone officielle écarte. Jamais un nombre de sinistrés. Interrupteur en
// tête : éteint, les zones ne sont ni lues ni dessinées, et seules les communes touchées sont citées (leur population en contexte).
import type { Exposure, ExposureAssetKind } from '../../services/environment-exposure.ts';
import type { HazardPopulation } from '../../services/exposure-population.ts';
import { CARREAUX_YEAR, roundPeople } from '../../services/flood-zone-people.ts';
import { LEVEL_RANK, type VigilanceLevel } from '../../services/vigilance.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { kvRow } from '../fiche/kit.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { note, plural } from './environment-format.ts';
import { NBSP, frNumber } from './format.ts';
import { emptyLine, listRow, loadingBody } from './frame.ts';

/** État de la zone inondable d'un tronçon. */
export type FloodZoneStatus =
  /** Interrupteur éteint : rien de lu. */
  | 'off'
  /** Lecture Géorisques en cours. */
  | 'lecture'
  /** Zones trouvées le long du tronçon. */
  | 'cartographiee'
  /** Lu, rien de cartographié ici (hors territoire à risque important). */
  | 'non-cartographiee'
  /** Vigilance jaune : zones non demandées (orange et rouge seulement). */
  | 'non-demandee';

export interface SectionImpact {
  sectionId: string;
  name: string;
  level: VigilanceLevel;
  zone: FloodZoneStatus;
  zoneCount: number;
  population: HazardPopulation | null;
  /** Habitants dans la zone inondable : estimation, 'lecture' pendant la lecture des carreaux, null sans zone cartographiée. */
  people: ZoneImpactPeople | 'lecture' | null;
  /** Enjeux exposés à ce tronçon (le phénomène le plus grave d'un enjeu peut être un autre tronçon). */
  exposures: Exposure[];
  /** Enjeux à moins de 2 km du tronçon que la zone officielle écarte (hors zone, zone cartographiée). */
  excluded: Exposure[];
}

/** Habitants en zone inondable (carreaux Insee) : total, 80 ans et plus, par commune. */
export interface ZoneImpactPeople {
  total: number;
  over80: number;
  communes: Array<{ name: string; dept: string; people: number; pop: number | null }>;
}

export interface CruesImpactInput {
  /** null : enjeux et communes pas encore lus. */
  impacts: SectionImpact[] | null;
  zonesOn: boolean;
  canFocus: boolean;
}

const MAX_SECTIONS = 8;
const MAX_COMMUNES = 6;
const MAX_ASSETS = 8;

const KIND_WORD: Readonly<Record<ExposureAssetKind, [string, string]>> = {
  nucleaire: ['centrale nucléaire', 'centrales nucléaires'],
  'seveso-haut': ['site Seveso seuil haut', 'sites Seveso seuil haut'],
  hopital: ['service d’urgences', 'services d’urgences'],
  'seveso-bas': ['site Seveso seuil bas', 'sites Seveso seuil bas'],
  ehpad: ['EHPAD', 'EHPAD'],
};
const KIND_ORDER: readonly ExposureAssetKind[] = ['nucleaire', 'seveso-haut', 'hopital', 'seveso-bas', 'ehpad'];

const fmt = (n: number): string => frNumber(n, 0);
/** Estimation : arrondie, précédée de « ≈ » ; « moins de 10 » plutôt qu'un zéro trompeur. */
const approx = (n: number): string => (n > 0 && n < 5 ? 'moins de 10' : `≈${NBSP}${fmt(roundPeople(n))}`);
const km = (d: number): string => `à ${frNumber(d, d < 10 ? 1 : 0)}${NBSP}km du tronçon`;

function zoneText(s: SectionImpact): string {
  switch (s.zone) {
    case 'cartographiee': return `cartographiée (${plural(s.zoneCount, 'zone')})`;
    case 'lecture': return 'lecture en cours…';
    case 'non-cartographiee': return 'non cartographiée ici';
    case 'non-demandee': return 'non lue (jaune)';
    case 'off': return 'masquée';
  }
}

/** Règle du tracé appliquée : zone officielle, ou distance au tronçon à défaut. */
function ruleText(s: SectionImpact): string {
  const why: Readonly<Record<FloodZoneStatus, string>> = {
    cartographiee: 'Zone inondable Géorisques, crue fréquente et moyenne. ',
    lecture: 'Zone inondable en cours de lecture : distance au tronçon en attendant. ',
    'non-cartographiee': 'Pas de zone cartographiée ici (hors territoire à risque important). ',
    'non-demandee': 'Zones lues pour les tronçons orange et rouge seulement. ',
    off: 'Zones inondables masquées (interrupteur éteint). ',
  };
  return why[s.zone] + (s.zone === 'cartographiee'
    ? `Habitants : carreaux Insee de 200${NBSP}m (${CARREAUX_YEAR}) dont le centre est en zone, estimation arrondie. Enjeux : dans la zone.`
    : 'Enjeux : à moins de 2\u00a0km du tronçon. Communes : centre à moins de 3\u00a0km du tronçon, population totale donnée en contexte.');
}

function countsText(list: readonly Exposure[]): string {
  const counts = new Map<ExposureAssetKind, number>();
  for (const e of list) counts.set(e.asset.kind, (counts.get(e.asset.kind) ?? 0) + 1);
  return KIND_ORDER.filter((k) => counts.has(k)).map((k) => {
    const n = counts.get(k) ?? 0;
    return `${fmt(n)}${NBSP}${KIND_WORD[k][n > 1 ? 1 : 0]}`;
  }).join(', ');
}

function headNote(s: SectionImpact): string {
  if (s.people !== null && s.people !== 'lecture') return `${approx(s.people.total)}${NBSP}habitants en zone inondable`;
  const p = s.population;
  if (!p) return 'communes non lues';
  return p.communes.length === 0 ? 'aucune commune touchée' : `${plural(p.communes.length, 'commune')} touchée${p.communes.length > 1 ? 's' : ''}`;
}

/** Communes : habitants en zone d'abord (estimation), sinon communes touchées avec leur population totale en note. */
function communesBlock(s: SectionImpact): string {
  const people = s.people !== null && s.people !== 'lecture' ? s.people : null;
  if (people) {
    const list = people.communes.filter((c) => c.people >= 5);
    if (list.length === 0) return '';
    return `<p class="fmk-sub">Communes, habitants en zone</p>` + list.slice(0, MAX_COMMUNES).map((c) => listRow({
      text: c.name, value: `${approx(c.people)}${NBSP}hab.`,
      note: `département ${c.dept}${c.pop === null ? '' : ` · ${fmt(c.pop)}${NBSP}hab. dans la commune`}`,
    })).join('') + (list.length > MAX_COMMUNES ? note(`Et ${plural(list.length - MAX_COMMUNES, 'autre commune', 'autres communes')}.`) : '');
  }
  const p = s.population;
  if (!p || p.communes.length === 0) return '';
  return `<p class="fmk-sub">Communes touchées</p>` + p.communes.slice(0, MAX_COMMUNES).map((c) => listRow({
    text: c.name, value: null, note: `département ${c.dept}${c.pop === null ? '' : ` · ${fmt(c.pop)}${NBSP}hab. au total`}`,
  })).join('') + (p.communes.length > MAX_COMMUNES ? note(`Et ${plural(p.communes.length - MAX_COMMUNES, 'autre commune', 'autres communes')}.`) : '')
    + note(s.people === 'lecture' ? 'Habitants en zone inondable : lecture des carreaux Insee…'
      : 'Population totale des communes, pas des habitants exposés : allumer les zones inondables pour les estimer.');
}

function excludedNote(s: SectionImpact): string {
  if (s.excluded.length === 0) return '';
  const names = s.excluded.slice(0, 3).map((e) => `${e.asset.name} (${KIND_WORD[e.asset.kind][0]}${e.asset.commune ? `, ${e.asset.commune}` : ''})`).join(' ; ');
  const more = s.excluded.length > 3 ? ` et ${plural(s.excluded.length - 3, 'autre', 'autres')}` : '';
  return note(`Écarté${s.excluded.length > 1 ? 's' : ''} par la zone officielle, hors zone bien qu'à moins de 2${NBSP}km du tronçon : ${names}${more}.`);
}

function sectionBlock(s: SectionImpact, canFocus: boolean): string {
  const head = listRow({
    text: s.name, value: s.level, level: s.level, note: headNote(s),
    ...(canFocus ? { data: { section: s.sectionId }, link: true } : {}),
  });
  const people = s.people !== null && s.people !== 'lecture' ? s.people : null;
  const rows = kvRow('Zone inondable', escapeHtml(zoneText(s)))
    + (people
      ? kvRow('Habitants en zone', escapeHtml(approx(people.total))) + kvRow('dont 80 ans et plus', escapeHtml(approx(people.over80)))
      : kvRow('Habitants en zone', escapeHtml(s.people === 'lecture' ? 'lecture…' : 'n.d. sans zone')))
    + kvRow('Enjeux exposés', escapeHtml(s.exposures.length > 0 ? fmt(s.exposures.length) : 'aucun recensé'));
  const assets = s.exposures.length > 0
    ? `<p class="fmk-sub">Enjeux exposés</p>` + note(`${countsText(s.exposures)}.`) + s.exposures.slice(0, MAX_ASSETS).map((e) => listRow({
      text: e.asset.name, value: e.inFloodZone ? 'en zone inondable' : e.distanceKm === null ? null : km(e.distanceKm), level: s.level,
      // Détail redisant le type (« Seveso seuil bas ») : omis.
      note: [KIND_WORD[e.asset.kind][0], e.asset.commune, KIND_WORD[e.asset.kind][0].toLowerCase().includes((e.asset.detail ?? '').toLowerCase()) ? null : e.asset.detail]
        .filter((x): x is string => x !== null && x !== '').join(' · '),
      ...(canFocus ? { data: { lon: String(e.asset.lon), lat: String(e.asset.lat) }, link: true } : {}),
    })).join('') + (s.exposures.length > MAX_ASSETS ? note(`Et ${plural(s.exposures.length - MAX_ASSETS, 'autre enjeu', 'autres enjeux')}, sur la carte.`) : '')
    : '';
  return `<div class="crues-impact">${head}${rows}${communesBlock(s)}${assets}${excludedNote(s)}${note(ruleText(s))}</div>`;
}

const peopleOf = (s: SectionImpact): number => (s.people !== null && s.people !== 'lecture' ? s.people.total : s.population?.total ?? 0);

/** Tri : niveau, puis habitants en zone (à défaut, population des communes touchées). */
export function sortImpacts(list: readonly SectionImpact[]): SectionImpact[] {
  return [...list].sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level] || peopleOf(b) - peopleOf(a));
}

export function impactSection(input: CruesImpactInput, open: boolean): FicheSection {
  const toggle = `<button type="button" class="lp-toggle" data-flood-zones aria-pressed="${input.zonesOn}">`
    + `${input.zonesOn ? 'Zones inondables affichées : masquer' : 'Afficher les zones inondables officielles'}</button>`
    + note(input.zonesOn
      ? 'Zones lues pour les tronçons orange et rouge seulement, environ 3 à 4\u00a0Mo par tronçon en ville, une fois par session.'
      : 'Éteint : aucune zone lue ni dessinée ; enjeux et communes comptés à distance du tronçon.');
  const base = { id: 'consequences', title: 'Conséquences des crues', collapsible: true, open };
  if (input.impacts === null) return { ...base, summary: '…', html: toggle + loadingBody() };
  const list = sortImpacts(input.impacts);
  if (list.length === 0) return { ...base, summary: 'aucune', html: toggle + emptyLine('Aucun tronçon en vigilance : pas de conséquence à estimer.') };
  const strong = list.filter((x) => x.level === 'orange' || x.level === 'rouge').length;
  const html = toggle + list.slice(0, MAX_SECTIONS).map((s) => sectionBlock(s, input.canFocus)).join('')
    + (list.length > MAX_SECTIONS ? note(`Et ${plural(list.length - MAX_SECTIONS, 'autre tronçon', 'autres tronçons')} en vigilance jaune.`) : '')
    + note('Habitants résidant en zone inondable (estimation Insee), jamais un nombre de sinistrés ; deux tronçons voisins peuvent partager des habitants.');
  // Pas de total d'habitants : deux tronçons voisins peuvent partager une même zone.
  return { ...base, summary: escapeHtml(strong > 0 ? `${plural(strong, 'tronçon')} orange ou rouge` : plural(list.length, 'tronçon')), html };
}
