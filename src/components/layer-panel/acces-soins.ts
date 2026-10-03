// src/components/layer-panel/acces-soins.ts : vue pure du panneau Accès aux soins (spec 2026-10-03 § 3.3) ; aucun accès réseau ni
// DOM. APL DREES 2024, cinq professions ; pas de pastille (donnée annuelle), millésime affiché, jamais « en retard ».
import type { AplDataset, AplDepartment, AplProfession } from '../../types/index.ts';
import type { VigilanceLevel } from '../../services/vigilance.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { kvRow } from '../fiche/kit.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { NBSP, formatPct, frNumber } from './format.ts';
import { barRow, emptyLine, listRow, loadingBody, sourceErrorCallout, sourceLinkHtml, valueHtml, type LayerView } from './frame.ts';
import {
  APL_DIGITS, APL_PROFESSIONS, APL_PROFESSION_LABEL, APL_PROFESSION_SHORT, APL_UNIT, PER_100K, aplMgLevel, digitWord, joinFr, parisDay,
} from './health-format.ts';

export interface AccesSoinsViewInput {
  data: AplDataset | null;
  error: string | null;
  /** Profession de la carte (sélecteur du panneau). */
  profession: AplProfession;
  now: number;
  open: (sectionId: string, byDefault: boolean) => boolean;
}

type Year = AplDataset['france']['byYear'][number];
type OpenFn = AccesSoinsViewInput['open'];

const THEME = 'Santé';
const TITLE = 'Accès aux soins';
const DREES_URL = 'https://data.drees.solidarites-sante.gouv.fr/explore/dataset/530_l-accessibilite-potentielle-localisee-apl/';
const CAPTION_BASE = 'de la population vit dans une commune où l’APL aux médecins généralistes est inférieure à 2,5';
const OUTRE_MER_CORSE: readonly string[] = ['2A', '2B', '971', '972', '973', '974'];
const MISSING_NAME: Readonly<Record<string, string>> = { '976': 'Mayotte' };
const note = (text: string): string => `<p class="fmk-note">${escapeHtml(text)}</p>`;
const millions = (n: number): string => `${frNumber(n / 1_000_000, 1)}${NBSP}millions`;

function years(d: AplDataset): Year[] {
  return [...d.france.byYear].sort((a, b) => a.year - b.year);
}

/** Gros chiffre (spec § 3.3) : la part sous 2,5 a monté aux deux derniers millésimes : orange ; à un seul : jaune ; sinon vert. */
export function shareTrendLevel(byYear: readonly Year[]): VigilanceLevel | null {
  const last = [...byYear].sort((a, b) => a.year - b.year).slice(-3);
  if (last.length < 2) return null;
  const ups = last.slice(1).filter((y, i) => y.shareUnder25 > last[i].shareUnder25).length;
  return ups >= 2 ? 'orange' : ups === 1 ? 'jaune' : 'vert';
}

/** Barre des généralistes : reculs de l'APL nationale aux derniers millésimes (deux : orange, un : jaune, aucun : vert). */
function mgTrendLevel(ys: readonly Year[]): VigilanceLevel {
  const last = ys.slice(-3);
  const falls = last.slice(1).filter((y, i) => y.aplMg < last[i].aplMg).length;
  return falls >= 2 ? 'orange' : falls === 1 ? 'jaune' : 'vert';
}

function leadOf(d: AplDataset, ys: readonly Year[]): string {
  const latest = ys[ys.length - 1];
  const prev = ys[ys.length - 2];
  const steps = ys.slice(1).map((y, i) => y.aplMg - ys[i].aplMg);
  const first = ys.length >= 3 && steps.every((x) => x < 0)
    ? `L’accès au médecin généraliste recule depuis ${digitWord(ys.length)} ans (APL nationale ${frNumber(latest.aplMg, 2)}).`
    : ys.length >= 3 && steps.every((x) => x > 0)
      ? `L’accès au médecin généraliste progresse depuis ${digitWord(ys.length)} ans (APL nationale ${frNumber(latest.aplMg, 2)}).`
      : `APL nationale aux médecins généralistes : ${frNumber(latest.aplMg, 2)}${prev ? ` (${frNumber(prev.aplMg, 2)} en ${prev.year})` : ''}.`;
  const top = [...d.departments].sort((a, b) => b.shareUnder25 - a.shareUnder25).slice(0, 3);
  if (top.length === 0) return first;
  const tenths = Math.floor(Math.min(...top.map((x) => x.shareUnder25)) / 10);
  const names = joinFr(top.map((x) => x.name));
  const who = tenths === 1 ? 'plus d’un habitant' : `plus de ${digitWord(tenths)} habitants`;
  return `${first} ${tenths >= 1 ? `${names} ont ${who} sur dix sous le seuil.` : `Départements les plus exposés : ${names}.`}`;
}

function headOf(d: AplDataset): LayerView['head'] {
  const ys = years(d);
  const last = ys[ys.length - 1];
  const first = ys[0];
  const compare = first.year !== last.year ? `${formatPct(first.shareUnder25, 1)} en ${first.year}` : null;
  const compareLevel: VigilanceLevel | null = last.shareUnder25 > first.shareUnder25 ? 'rouge' : last.shareUnder25 < first.shareUnder25 ? 'vert' : null;
  const base = `${CAPTION_BASE} · ${millions(last.popUnder25)} d’habitants`;
  return {
    theme: THEME, title: TITLE,
    figure: {
      value: formatPct(last.shareUnder25, 1), level: shareTrendLevel(ys),
      caption: `${base}${compare ? ` · ${compare}` : ''}`,
      captionHtml: `${escapeHtml(base)}${compare ? ` · ${valueHtml(compare, compareLevel)}` : ''}`,
    },
    status: [`millésime ${d.vintage} (activité ${d.vintage}, population ${d.vintage - 2})`, 'DREES'],
    lead: leadOf(d, ys),
  };
}

function arrowHtml(value: number, prev: number): string {
  if (value === prev) return '<span class="lp-trend" aria-label="stable">=</span>';
  return value < prev
    ? '<span class="lp-trend lp-lvl lp-lvl--rouge" aria-label="en recul">▼</span>'
    : '<span class="lp-trend lp-lvl lp-lvl--vert" aria-label="en progrès">▲</span>';
}

function professionsSection(d: AplDataset, open: OpenFn): FicheSection {
  const ys = years(d);
  const prevYear = d.vintage - 1;
  const rows = APL_PROFESSIONS.map((p) => {
    const value = d.france.apl[p];
    const prev = d.france.apl2023[p];
    const digits = APL_DIGITS[p];
    const values = d.departments.flatMap((x) => {
      const v = x.apl[p];
      return v === null ? [] : [{ name: x.name, v }];
    });
    const best = values.reduce((m, x) => Math.max(m, x.v), 0);
    const low = values.reduce<{ name: string; v: number } | null>((m, x) => (m === null || x.v < m.v ? x : m), null);
    const level: VigilanceLevel = p === 'mg' ? mgTrendLevel(ys) : value < prev ? 'jaune' : 'vert';
    return barRow({
      label: APL_PROFESSION_LABEL[p], pct: best > 0 ? (value / best) * 100 : null, value: frNumber(value, digits),
      valueHtml: `${valueHtml(frNumber(value, digits))}${arrowHtml(value, prev)}`, level,
      note: `${APL_UNIT[p]} · ${prevYear} : ${frNumber(prev, digits)}${low ? ` · le plus bas : ${low.name} ${frNumber(low.v, digits)}` : ''}`,
    });
  }).join('');
  const declines = APL_PROFESSIONS.filter((p) => d.france.apl[p] < d.france.apl2023[p]).length;
  return {
    id: 'professions', title: 'Par profession', collapsible: true, open: open('professions', true),
    summary: escapeHtml(`${APL_PROFESSIONS.length} professions · ${declines} en baisse`),
    html: rows + note(`Médecins : consultations accessibles par an et par habitant standardisé. Autres professions : équivalents temps plein ${PER_100K} `
      + `(sages-femmes : pour ${frNumber(100_000, 0)} femmes). Flèche : évolution sur ${prevYear}, rouge en recul, verte en progrès. `
      + 'Barre : valeur nationale rapportée au département le mieux doté ; couleur : recul sur les derniers millésimes.'),
  };
}

function exposedSection(d: AplDataset, open: OpenFn): FicheSection {
  const top = d.departments
    .flatMap((x) => (x.apl.mg === null ? [] : [{ x, mg: x.apl.mg }]))
    .sort((a, b) => b.x.shareUnder25 - a.x.shareUnder25).slice(0, 10);
  const base = { id: 'exposed', title: 'Départements les plus exposés', collapsible: true, open: open('exposed', true) };
  if (top.length === 0) return { ...base, summary: 'n.d.', html: emptyLine('Aucune valeur départementale.') };
  const rows = top.map(({ x, mg }) => barRow({
    label: x.name, pct: x.shareUnder25, value: `${formatPct(x.shareUnder25, 0)} · ${frNumber(mg, 2)}`, level: aplMgLevel(mg), data: { dept: x.code },
  })).join('');
  const min = Math.min(...top.map(({ x }) => x.shareUnder25));
  return {
    ...base, summary: escapeHtml(`${top.length} au-dessus de ${formatPct(Math.floor(min), 0)} sous le seuil`),
    html: rows + note('Part de la population vivant dans une commune où l’APL aux généralistes est inférieure à 2,5, puis APL du département ; '
      + 'couleur : APL du département (rouge sous 2,5, orange de 2,5 à 3,5, jaune de 3,5 à 4, vert au-delà).'),
  };
}

function evolutionSection(d: AplDataset, open: OpenFn): FicheSection {
  const ys = years(d);
  const last = ys[ys.length - 1];
  const first = ys[0];
  const rows = ys.map((y) => {
    const share = valueHtml(formatPct(y.shareUnder25, 1));
    return kvRow(String(y.year), `${y === last ? `<b>${share}</b>` : share} · APL ${valueHtml(frNumber(y.aplMg, 2))} · ${valueHtml(millions(y.popUnder25))}`);
  }).join('');
  return {
    id: 'evolution', title: 'Évolution', collapsible: true, open: open('evolution', true),
    summary: escapeHtml(first.year !== last.year ? `${formatPct(last.shareUnder25, 1)} en ${last.year} contre ${formatPct(first.shareUnder25, 1)} en ${first.year}` : formatPct(last.shareUnder25, 1)),
    html: rows + note('Par millésime : part de la population vivant dans une commune sous 2,5, APL nationale aux généralistes, habitants concernés.'),
  };
}

function outreMerSection(d: AplDataset, open: OpenFn): FicheSection {
  const rows: AplDepartment[] = OUTRE_MER_CORSE.flatMap((code) => d.departments.filter((x) => x.code === code));
  const html = rows.map((x) => listRow({
    text: x.name, value: x.apl.mg === null ? 'n.d.' : frNumber(x.apl.mg, 2), level: x.apl.mg === null ? 'gris' : aplMgLevel(x.apl.mg),
    note: `${formatPct(x.shareUnder25, 1)} de la population sous 2,5`, data: { dept: x.code },
  })).join('') + d.missing.map((code) => listRow({
    text: MISSING_NAME[code] ?? code, value: 'n.d.', level: 'gris', note: 'absente du fichier DREES : non remplacée',
  })).join('');
  const low = rows.flatMap((x) => (x.apl.mg === null ? [] : [{ name: x.name, mg: x.apl.mg }])).reduce<{ name: string; mg: number } | null>(
    (m, x) => (m === null || x.mg < m.mg ? x : m), null);
  const missing = d.missing.map((code) => `${MISSING_NAME[code] ?? code} absente du fichier`);
  return {
    id: 'outremer', title: 'Outre-mer et Corse', collapsible: true, open: open('outremer', false),
    summary: escapeHtml([low ? `${low.name} ${frNumber(low.mg, 2)}` : null, ...missing].filter((x): x is string => x !== null).join(' · ') || 'n.d.'),
    html: html || emptyLine('Aucune valeur pour l’outre-mer et la Corse.'),
  };
}

function methodSection(d: AplDataset | null, error: string | null, open: OpenFn): FicheSection {
  const state = d
    ? `millésime ${d.vintage}, publié le ${parisDay(d.publishedAt)}${error !== null ? ' ; fichier injoignable au dernier essai' : ''}`
    : error !== null ? 'source indisponible' : 'chargement…';
  const html = kvRow('APL, cinq professions', `${sourceLinkHtml('DREES, accessibilité potentielle localisée', DREES_URL)} · ${escapeHtml(state)}`)
    + note(`APL : consultations accessibles par an et par habitant (médecins généralistes) ou équivalents temps plein ${PER_100K} `
      + '(autres professions), selon l’offre et la demande des communes voisines.')
    + note('Département : moyenne des communes pondérée par la population standardisée (règle DREES) ; part sous un seuil : population totale des communes concernées.')
    + note('Seuil 2,5 consultations par an et par habitant : seuil historique du zonage médecin 2017 à 2022 (zone d’intervention prioritaire). '
      + 'Le zonage 2025 (seuils 2,71 et 3,98, calculés sur l’APL 2023 à la maille du territoire de vie-santé) n’est pas comparable aux parts communales affichées ici.')
    + note('Autres professions : pas de seuil officiel de sous-densité dans ces fichiers ; lecture en écart à la moyenne nationale.')
    + note('Carte : généralistes rouge sous 2,5, orange de 2,5 à 3,5, jaune de 3,5 à 4, vert au-delà ; autres professions en rapport à la moyenne '
      + 'nationale : rouge sous la moitié, orange sous les trois quarts, jaune sous la moyenne, vert au-delà.')
    + note('Donnée annuelle : le millésime est affiché, jamais « en retard ». Mayotte est absente du fichier DREES.');
  return { id: 'method', title: 'Méthode et sources', collapsible: true, open: open('method', false), tone: 'reference', summary: 'DREES · zonage 2025', html };
}

function selectorHtml(selected: AplProfession): string {
  const buttons = APL_PROFESSIONS.map((p) => `<button type="button" class="lp-toggle" data-apl-profession="${p}" aria-pressed="${p === selected}">`
    + `${escapeHtml(APL_PROFESSION_SHORT[p])}</button>`).join('');
  return `<div class="lp-seg" role="group" aria-label="Profession affichée sur la carte">${buttons}</div>`;
}

export function buildAccesSoinsView(input: AccesSoinsViewInput): LayerView {
  const { data, error, now, open } = input;
  if (data === null && error === null) return { head: { theme: THEME, title: TITLE, status: ['chargement…'] }, sections: [], bodyHtml: loadingBody() };
  if (data === null) {
    return {
      head: { theme: THEME, title: TITLE, figure: { value: 'n.d.', caption: CAPTION_BASE }, status: ['fichier DREES injoignable', 'DREES'] },
      sections: [methodSection(null, error, open)], bodyHtml: sourceErrorCallout(null, now),
    };
  }
  if (data.departments.length === 0 || data.france.byYear.length === 0) {
    return {
      head: { theme: THEME, title: TITLE, figure: { value: 'n.d.', caption: CAPTION_BASE }, status: [`millésime ${data.vintage}`, 'DREES'] },
      sections: [methodSection(data, error, open)], bodyHtml: emptyLine('Aucune valeur APL dans le fichier.'),
    };
  }
  const failed = error !== null ? `<p class="fmk-callout lp-callout">${escapeHtml(`Fichier injoignable au dernier essai : millésime ${data.vintage} affiché.`)}</p>` : '';
  return {
    head: headOf(data),
    sections: [professionsSection(data, open), exposedSection(data, open), evolutionSection(data, open), outreMerSection(data, open), methodSection(data, error, open)],
    bodyHtml: selectorHtml(input.profession) + failed,
  };
}
