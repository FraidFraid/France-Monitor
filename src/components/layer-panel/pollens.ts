// src/components/layer-panel/pollens.ts : vue pure du panneau Pollens (Atmo France, 20/10/2026) ; aucun accès réseau ni DOM. Niveau de
// pollens de J, J+1 et J+2 par département (plus haut code des communes, échelle Atmo de 1 à 6), taxons responsables, couverture des
// AASQA. E1 : niveaux tels que publiés ; S1 : date de mise à jour de la source ; S2 : en retard au-delà de 36 h, couleurs retirées ;
// S3 : une panne est nommée, un jour ou un département non publié n'est jamais « sans pollen ».
import type { PollenDay, PollenDept, PollenDeptDay, PollenResponse, PollenTaxon } from '../../types/index.ts';
import { parisDayOf } from '../../services/environment-levels.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { kvRow } from '../fiche/kit.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { NBSP, frNumber } from './format.ts';
import { emptyLine, listRow, loadingBody, sourceErrorCallout, sourceLinkHtml, type LayerHeadModel, type LayerTab, type LayerView } from './frame.ts';
import { departementName } from './health-format.ts';
import { ENVIRONMENT_THEME, capitalize, clockOf, glueEnvUnits, note, parisDayWord, plural, readErrors, sourceDown, stamp } from './environment-format.ts';
import { POLLEN_HEX, POLLEN_WORD } from './pollens-legend.ts';
import { POLLEN_HIGH as HIGH, POLLEN_TAXA_INFO, POLLEN_TAXA_ORDER, pollenDate, pollenWordFor, pollenDayRows as dayRows, pollenLate, pollenLevelOf, pollensHeadLevel } from './pollens-level.ts';

export const POLLENS_TITLE = 'Pollens';
/** Onglets Aujourd’hui, Demain et Après-demain (échéances J, J+1 et J+2 de la carte). */
export const POLLENS_TABS: readonly PollenDay[] = ['J', 'J1', 'J2'];
const TAB_LABEL: Readonly<Record<PollenDay, string>> = { J: 'Aujourd’hui', J1: 'Demain', J2: 'Après-demain' };

type OpenFn = (sectionId: string, byDefault: boolean) => boolean;
export interface PollensViewInput {
  pollen: PollenResponse | null;
  error: string | null;
  day: PollenDay;
  /** La carte peut recentrer sur un département (carte WebGL) ; sinon les lignes ne se donnent pas pour cliquables. */
  canFocus: boolean;
  now: number;
  open: OpenFn;
}

/** Taxons dans l'ordre d'affichage, avec leur genre pour accorder « élevé » (graminées au féminin pluriel). */
const MAX_ROWS = 15;
const ATMO_URL = 'https://www.atmo-france.org/';
const ATMO_DATA_URL = 'https://data.atmo-france.org/';
/** Codes INSEE des 96 départements de métropole (01 à 19, 2A, 2B, 21 à 95). */
const METRO_CODES: readonly string[] = [
  ...Array.from({ length: 19 }, (_, i) => String(i + 1).padStart(2, '0')), '2A', '2B', ...Array.from({ length: 75 }, (_, i) => String(i + 21)),
];

// Niveau et jours : module léger pollens-level.ts (importé par l'app sans la vue entière).
export { POLLEN_TAXA_INFO, POLLEN_TAXA_ORDER, pollenDate, pollenDeptDayOf, pollenLate, pollenLevelOf, pollenWordFor, pollensHeadLevel } from './pollens-level.ts';

function deptLabel(d: PollenDept): string {
  const name = departementName(d.code);
  return `${name === d.code ? d.name : name} (${d.code})`;
}

function maxCodeOf(rows: ReadonlyArray<{ d: PollenDeptDay }>): number {
  return rows.reduce((m, r) => Math.max(m, r.d.maxCode), 0);
}

// ─── En-tête ───

interface TaxonDrive { taxon: PollenTaxon; code: number; depts: PollenDept[] }

/** Taxons au niveau élevé ou plus dans au moins un département : plus haut code, départements concernés (le plus haut d'abord). */
function drivers(rows: ReadonlyArray<{ dept: PollenDept; d: PollenDeptDay }>): TaxonDrive[] {
  const out: TaxonDrive[] = [];
  for (const taxon of POLLEN_TAXA_ORDER) {
    const hits = rows.flatMap((r) => {
      const t = r.d.taxa.find((x) => x.taxon === taxon);
      return t !== undefined && t.code >= HIGH ? [{ dept: r.dept, code: t.code }] : [];
    }).sort((a, b) => b.code - a.code);
    if (hits.length > 0) out.push({ taxon, code: hits[0].code, depts: hits.map((h) => h.dept) });
  }
  return out.sort((a, b) => b.code - a.code || b.depts.length - a.depts.length);
}

function driverText(t: TaxonDrive): string {
  const names = t.depts.slice(0, 3).map((d) => d.name);
  const more = t.depts.length > 3 ? ' …' : '';
  return `${POLLEN_TAXA_INFO[t.taxon].label} ${pollenWordFor(t.code, t.taxon)} dans ${plural(t.depts.length, 'département')} (${names.join(', ')}${more})`;
}

function leadOf(p: PollenResponse, date: string, now: number): string | null {
  const rows = dayRows(p, date);
  const when = parisDayWord(date, now);
  if (rows.length === 0) return `Pollens : ${when} pas encore publié.`;
  const high = rows.filter((r) => r.d.maxCode >= HIGH);
  if (high.length === 0) {
    const top = maxCodeOf(rows);
    return `Aucun département à pollens élevés ${when} (${plural(rows.length, 'département couvert', 'départements couverts')}, niveau le plus haut : ${POLLEN_WORD[top] ?? 'n.d.'}).`;
  }
  const lines = drivers(high).slice(0, 3).map(driverText);
  return `${capitalize((lines.length > 0 ? lines : [`pollens élevés dans ${plural(high.length, 'département')}`]).join(' ; '))} ${when}.`;
}

function headOf(p: PollenResponse, day: PollenDay, now: number): LayerHeadModel {
  const date = pollenDate(day, now);
  const late = pollenLate(p, now);
  const rows = dayRows(p, date);
  const high = rows.filter((r) => r.d.maxCode >= HIGH);
  const published = rows.length > 0;
  const level = pollensHeadLevel(p, now);
  const todayRows = dayRows(p, parisDayOf(now));
  const reason = todayRows.length === 0
    ? 'pollens du jour non publiés'
    : `niveau le plus haut aujourd’hui : ${POLLEN_WORD[maxCodeOf(todayRows)] ?? 'n.d.'}`;
  return {
    theme: ENVIRONMENT_THEME, title: POLLENS_TITLE,
    // Pas de gros « 0 » (lu comme un score) : aucun département à pollens élevés, la phrase de tête le dit.
    figure: published && high.length === 0 ? null : {
      value: published ? frNumber(high.length, 0) : 'n.d.',
      caption: glueEnvUnits(`départements à pollens élevés ou plus ${parisDayWord(date, now)} · Atmo France, ${clockOf(p.updatedAt, now)}${late ? ' (en retard)' : ''}`),
      level: late || !published ? null : pollenLevelOf(maxCodeOf(rows)),
    },
    level,
    status: [
      late ? 'niveau suspendu : pollens Atmo France en retard' : glueEnvUnits(reason),
      stamp('Atmo', p.updatedAt, late, now),
      ...(p.errors.length > 0 ? [`${plural(p.errors.length, 'incident')} de lecture (voir Méthode et sources)`] : []),
    ],
    lead: late ? null : leadOf(p, date, now),
  };
}

function tabsOf(p: PollenResponse, now: number): LayerTab[] {
  return POLLENS_TABS.map((day) => {
    const rows = dayRows(p, pollenDate(day, now));
    return { id: day, label: TAB_LABEL[day], count: rows.length === 0 ? null : rows.filter((r) => r.d.maxCode >= HIGH).length };
  });
}

// ─── Départements à pollens élevés ───

function highSection(p: PollenResponse | null, day: PollenDay, canFocus: boolean, now: number, open: OpenFn): FicheSection {
  const base = { id: 'eleves', title: 'Départements à pollens élevés', collapsible: true, open: open('eleves', true) };
  if (!p) return { ...base, summary: 'n.d.', html: sourceDown('pollens (Atmo France)') };
  const date = pollenDate(day, now);
  const when = parisDayWord(date, now);
  const rows = dayRows(p, date);
  if (rows.length === 0) return { ...base, summary: 'n.d.', html: emptyLine(`Pollens ${when} non encore publiés par Atmo France (publication le matin).`) };
  const late = pollenLate(p, now);
  const high = rows.filter((r) => r.d.maxCode >= HIGH)
    .sort((a, b) => b.d.maxCode - a.d.maxCode || b.d.high - a.d.high || a.dept.name.localeCompare(b.dept.name, 'fr'));
  if (high.length === 0) {
    const top = POLLEN_WORD[maxCodeOf(rows)] ?? 'n.d.';
    return {
      ...base, summary: late ? 'aucun (en retard)' : 'aucun',
      html: emptyLine(`Aucun département à pollens élevés ${when} : ${plural(rows.length, 'département couvert', 'départements couverts')}, niveau le plus haut : ${top}${late ? ' (en retard)' : ''}.`),
    };
  }
  const html = high.slice(0, MAX_ROWS).map(({ dept, d }) => {
    const taxa = d.taxa.filter((t) => t.code >= HIGH).map((t) => `${POLLEN_TAXA_INFO[t.taxon].label} ${pollenWordFor(t.code, t.taxon)}`);
    const noteText = `${plural(d.high, 'commune')} sur ${frNumber(d.communes, 0)} à élevé ou plus${taxa.length > 0 ? ` · ${taxa.join(', ')}` : ''}${d.alerte ? ' · alerte publiée' : ''}`;
    return listRow({
      text: deptLabel(dept), value: POLLEN_WORD[d.maxCode] ?? 'n.d.', ...(late ? { level: 'gris' as const } : { color: POLLEN_HEX[d.maxCode] }),
      note: noteText, ...(canFocus ? { data: { department: dept.code }, link: true } : {}),
    });
  }).join('')
    + (high.length > MAX_ROWS ? note(`${plural(high.length - MAX_ROWS, 'autre département', 'autres départements')} à pollens élevés ou plus.`) : '')
    + (canFocus ? note('Clic sur une ligne : le département sur la carte.') : '');
  return { ...base, summary: escapeHtml(`${plural(high.length, 'département')}${late ? ' (en retard)' : ''}`), html };
}

// ─── Pollens par taxon ───

function taxaSection(p: PollenResponse | null, day: PollenDay, now: number, open: OpenFn): FicheSection {
  const base = { id: 'taxons', title: 'Pollens par taxon', collapsible: true, open: open('taxons', false) };
  if (!p) return { ...base, summary: 'n.d.', html: sourceDown('pollens (Atmo France)') };
  const date = pollenDate(day, now);
  const rows = dayRows(p, date);
  if (rows.length === 0) return { ...base, summary: 'n.d.', html: emptyLine(`Taxons ${parisDayWord(date, now)} non encore publiés.`) };
  const late = pollenLate(p, now);
  const stats = POLLEN_TAXA_ORDER.map((taxon) => {
    const counts = new Map<number, number>();
    for (const r of rows) {
      const t = r.d.taxa.find((x) => x.taxon === taxon);
      if (t !== undefined) counts.set(t.code, (counts.get(t.code) ?? 0) + 1);
    }
    const max = [...counts.keys()].reduce((m, c) => Math.max(m, c), 0);
    return { taxon, counts, max };
  }).sort((a, b) => b.max - a.max || POLLEN_TAXA_ORDER.indexOf(a.taxon) - POLLEN_TAXA_ORDER.indexOf(b.taxon));
  const html = stats.map(({ taxon, counts, max }) => {
    if (max === 0) return listRow({ text: capitalize(POLLEN_TAXA_INFO[taxon].label), value: 'n.d.', level: 'gris', note: 'niveau non publié ce jour' });
    const spread = [...counts].sort((a, b) => b[0] - a[0]).map(([code, n]) => `${POLLEN_WORD[code]} ${frNumber(n, 0)}`).join(' · ');
    return listRow({
      text: capitalize(POLLEN_TAXA_INFO[taxon].label), value: pollenWordFor(max, taxon), ...(late ? { level: 'gris' as const } : { color: POLLEN_HEX[max] }),
      note: `plus haut niveau national · départements : ${spread}`,
    });
  }).join('') + note('Niveau d’un taxon dans un département : plus haut niveau de ses communes ; le nombre qui suit chaque niveau compte les départements.');
  const top = stats[0];
  return {
    ...base,
    summary: escapeHtml(top.max === 0 ? 'n.d.' : `${POLLEN_TAXA_INFO[top.taxon].label} ${pollenWordFor(top.max, top.taxon)}${late ? ' (en retard)' : ''}`),
    html,
  };
}

// ─── Méthode et sources ───

function methodSection(p: PollenResponse | null, failed: boolean, day: PollenDay, now: number, open: OpenFn): FicheSection {
  const late = p !== null && pollenLate(p, now);
  const state = p?.updatedAt ? `mise à jour ${clockOf(p.updatedAt, now)}${late ? ' (en retard)' : ''}` : failed || p !== null ? 'source indisponible' : 'chargement…';
  const rows = p === null ? [] : dayRows(p, pollenDate(day, now));
  const covered = new Set(rows.map((r) => r.dept.code));
  const uncovered = METRO_CODES.filter((c) => !covered.has(c));
  const coverage = p === null || rows.length === 0 ? ''
    : note(`Couverture ${parisDayWord(pollenDate(day, now), now)} : ${plural(rows.length, 'département')} publié${rows.length > 1 ? 's' : ''}`
      + `${uncovered.length === 0 ? ' (toute la métropole).' : `, ${plural(uncovered.length, 'département')} de métropole sans pollens publiés (${uncovered.map(departementName).join(', ')}).`}`);
  const html = kvRow('Pollens', `${sourceLinkHtml('Atmo France, indice pollen par commune (couche ind_pol)', ATMO_DATA_URL)} · ${escapeHtml(state)}`)
    + kvRow('Producteurs', `${sourceLinkHtml('Associations agréées de surveillance de la qualité de l’air (AASQA)', ATMO_URL)}${p && p.sources.length > 0 ? ` · ${escapeHtml(p.sources.join(', '))}` : ''}`)
    + kvRow('Lecture', escapeHtml(p?.readAt ? `serveur ${clockOf(p.readAt, now)}` : 'n.d.'))
    + note('Licence Ouverte. Niveaux officiels tels que publiés (E1) : 1 très faible, 2 faible, 3 modéré, 4 élevé, 5 très élevé, 6 extrêmement élevé. Aulne, bouleau, olivier, graminées, armoise, ambroisie.')
    + note('Niveau d’un département : plus haut niveau de ses communes, communes publiées deux fois comptées une fois. Un code absent ou à 0 est indisponible, jamais un niveau.')
    + note('Pastille : rouge si un département atteint le niveau extrêmement élevé (6) aujourd’hui ; orange à très élevé (5) ; jaune à élevé (4) ; vert sinon. Carte et lignes du panneau : palette officielle Atmo ; pastille et chiffre d’en-tête : échelle FranceMonitor.')
    + coverage
    + note('Certaines régions peuvent ne pas publier de pollens : un département absent n’est pas « sans pollens ».')
    + note(`Retard : au-delà de 36${NBSP}h après la mise à jour. Relève toutes les 2${NBSP}h ; chaque jour est lu par une requête filtrée par date, sans géométrie.`)
    + readErrors(p?.errors ?? []);
  return { id: 'methode', title: 'Méthode et sources', collapsible: true, open: open('methode', false), tone: 'reference', summary: 'Atmo France', html };
}

// ─── Assemblage ───

export function buildPollensView(input: PollensViewInput): LayerView {
  const { pollen: p, error, day, canFocus, now, open } = input;
  if (p === null && error === null) {
    return { head: { theme: ENVIRONMENT_THEME, title: POLLENS_TITLE, status: ['chargement…'] }, sections: [], bodyHtml: loadingBody() };
  }
  const sections = [highSection(p, day, canFocus, now, open), taxaSection(p, day, now, open), methodSection(p, error !== null, day, now, open)];
  const tabs = POLLENS_TABS.map((id) => ({ id, label: TAB_LABEL[id], count: null as number | null }));
  if (p === null) {
    return {
      head: {
        theme: ENVIRONMENT_THEME, title: POLLENS_TITLE, level: 'nd',
        figure: { value: 'n.d.', caption: 'départements à pollens élevés ou plus', level: null }, status: ['Atmo France injoignable'],
      },
      tabs, activeTab: day, sections, bodyHtml: sourceErrorCallout(null, now),
    };
  }
  const last = p.updatedAt ? Date.parse(p.updatedAt) : Number.NaN;
  return {
    head: headOf(p, day, now), tabs: tabsOf(p, now), activeTab: day, sections,
    bodyHtml: error !== null ? sourceErrorCallout(Number.isFinite(last) ? last : null, now) : undefined,
  };
}
