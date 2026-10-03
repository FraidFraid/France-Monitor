// src/components/layer-panel/hopitaux.ts : vue pure du panneau Hôpitaux (spec 2026-10-03 § 3.4) ; aucun accès réseau ni DOM.
// Offre de soins (SAE 2025 et FINESS) : sites d'urgences autorisés, catégories, capacités. Aucune donnée d'occupation ni de
// tension (il n'en existe pas en données ouvertes) ; pas de pastille ; donnée annuelle, jamais « en retard ».
import type { EmergencySite, HospitalsDataset } from '../../types/index.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { kvRow } from '../fiche/kit.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { NBSP, frNumber } from './format.ts';
import { emptyLine, listRow, loadingBody, sourceErrorCallout, sourceLinkHtml, valueHtml, type LayerView } from './frame.ts';
import { HOSPITAL_CATEGORY_LABEL, HOSPITAL_CATEGORY_ORDER, departementName, hospitalCategoryVar, parisDay } from './health-format.ts';

export interface HopitauxViewInput {
  data: HospitalsDataset | null;
  error: string | null;
  now: number;
  open: (sectionId: string, byDefault: boolean) => boolean;
}

type OpenFn = HopitauxViewInput['open'];

const THEME = 'Santé';
const TITLE = 'Hôpitaux';
const CAPTION = 'sites d’urgences autorisés';
const SAE_URL = 'https://data.drees.solidarites-sante.gouv.fr/explore/dataset/707_bases-administratives-sae/';
const FINESS_URL = 'https://www.data.gouv.fr/fr/datasets/finess-extraction-du-fichier-des-etablissements/';
const MAX_DEPARTMENTS = 20;
const note = (text: string): string => `<p class="fmk-note">${escapeHtml(text)}</p>`;
const share = (part: number, total: number): number => Math.round((part / total) * 1000) / 10;

function monthYear(date: string): string {
  const ms = Date.parse(`${date.slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(ms) ? new Date(ms).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : date;
}

function headOf(d: HospitalsDataset): LayerView['head'] {
  const t = d.totals;
  return {
    theme: THEME, title: TITLE,
    figure: { value: frNumber(t.sites, 0), level: null, caption: `${CAPTION} · ${frNumber(t.passages / 1_000_000, 1)}${NBSP}millions de passages en ${d.vintage}` },
    status: [`données annuelles ${d.vintage}`, 'DREES SAE, FINESS'],
    lead: `${frNumber(t.sites, 0)} sites d’urgences, ${frNumber(t.bedsIcu, 0)} lits de réanimation. `
      + 'Aucune donnée ouverte ne mesure la tension hospitalière en temps réel : le panneau décrit l’offre, pas l’occupation.',
  };
}

function categoriesSection(d: HospitalsDataset, open: OpenFn): FicheSection {
  const base = { id: 'categories', title: 'Urgences par catégorie', collapsible: true, open: open('categories', true) };
  const counts = HOSPITAL_CATEGORY_ORDER.map((c) => ({ c, n: d.sites.filter((s) => s.category === c).length }))
    .filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
  const total = counts.reduce((a, x) => a + x.n, 0);
  if (total === 0) return { ...base, summary: 'n.d.', html: emptyLine('Aucun site placé.') };
  const bar = `<div class="lp-mix" role="img" aria-label="Sites d’urgences par catégorie">`
    + counts.map((x) => `<i style="width:${share(x.n, total)}%;background:${hospitalCategoryVar(x.c)}"></i>`).join('') + '</div>';
  const legend = '<div class="lp-leg">' + counts.map((x) => `<div><span class="lp-swatch" style="background:${hospitalCategoryVar(x.c)}"></span>`
    + `<span>${escapeHtml(HOSPITAL_CATEGORY_LABEL[x.c])}</span><b class="fmk-num">${frNumber(x.n, 0)}</b></div>`).join('') + '</div>';
  const pediatric = d.sites.filter((s) => s.pediatric).length;
  const antennas = d.sites.filter((s) => s.antenna).length;
  const seasonal = d.sites.filter((s) => s.seasonal).length;
  const sub = `<div class="fmk-sub">${escapeHtml(`dont urgences pédiatriques ${pediatric} · antennes ${antennas} · saisonnières ${seasonal}`)}</div>`;
  return { ...base, summary: escapeHtml(`${frNumber(d.totals.sites, 0)} sites · ${pediatric} pédiatriques`), html: bar + legend + sub };
}

function capacitySection(d: HospitalsDataset, open: OpenFn): FicheSection {
  const t = d.totals;
  const html = kvRow('Lits de médecine, chirurgie, obstétrique', valueHtml(frNumber(t.bedsMco, 0)))
    + kvRow('Lits de réanimation', valueHtml(frNumber(t.bedsIcu, 0)))
    + kvRow('Lits de soins intensifs', valueHtml(frNumber(t.bedsIntensive, 0)))
    + kvRow('Sites de réanimation', valueHtml(frNumber(t.icuSites, 0)))
    + note(`Lits installés au 31/12/${d.vintage} (SAE) ; aucune donnée ouverte d’occupation.`);
  return {
    id: 'capacity', title: 'Capacités', collapsible: true, open: open('capacity', true), html,
    summary: escapeHtml(`${frNumber(t.bedsMco, 0)} lits MCO · ${frNumber(t.bedsIcu, 0)} en réanimation`),
  };
}

function siteNote(s: EmergencySite, vintage: number): string {
  return [`${s.commune} (${s.dept})`, HOSPITAL_CATEGORY_LABEL[s.category], `passages en ${vintage}`,
    s.bedsIcu ? `${s.bedsIcu} lits de réanimation` : null].filter((x): x is string => x !== null).join(' · ');
}

function busiestSection(d: HospitalsDataset, open: OpenFn): FicheSection {
  const base = { id: 'busiest', title: 'Sites les plus fréquentés', collapsible: true, open: open('busiest', true) };
  const top = d.sites.flatMap((s) => (s.passages === null ? [] : [{ s, passages: s.passages }]))
    .sort((a, b) => b.passages - a.passages).slice(0, 5);
  const first = top[0];
  if (!first) return { ...base, summary: 'n.d.', html: emptyLine('Aucun nombre de passages publié.') };
  const rows = top.map(({ s, passages }) => listRow({
    text: s.name, value: frNumber(passages, 0), color: hospitalCategoryVar(s.category), note: siteNote(s, d.vintage),
    data: { 'hosp-finess': s.finess }, link: true, title: `n° FINESS ${s.finess}`,
  })).join('');
  return {
    ...base, summary: escapeHtml(`${first.s.name} ${frNumber(first.passages, 0)} passages`),
    html: rows + note('Clic : le site sur la carte, avec sa fiche (autorisations, passages, lits, n° FINESS).'),
  };
}

function departmentsSection(d: HospitalsDataset, open: OpenFn): FicheSection {
  const base = { id: 'departments', title: 'Par département', collapsible: true, open: open('departments', false) };
  const by = new Map<string, { n: number; passages: number }>();
  for (const s of d.sites) {
    const e = by.get(s.dept) ?? { n: 0, passages: 0 };
    by.set(s.dept, { n: e.n + 1, passages: e.passages + (s.passages ?? 0) });
  }
  const ranked = [...by.entries()].sort((a, b) => b[1].n - a[1].n || b[1].passages - a[1].passages);
  const [one, two] = ranked;
  if (!one) return { ...base, summary: 'n.d.', html: emptyLine('Aucun site placé.') };
  const rows = ranked.slice(0, MAX_DEPARTMENTS).map(([code, e]) => listRow({
    text: `${departementName(code)} (${code})`, value: `${e.n} site${e.n > 1 ? 's' : ''}`, note: `${frNumber(e.passages, 0)} passages en ${d.vintage}`,
  })).join('');
  const more = ranked.length > MAX_DEPARTMENTS ? note(`${ranked.length - MAX_DEPARTMENTS} autres départements.`) : '';
  const summary = `${departementName(one[0])} ${one[1].n} sites${two ? ` · ${departementName(two[0])} ${two[1].n}` : ''}`;
  return { ...base, summary: escapeHtml(summary), html: rows + more };
}

function establishmentsSection(d: HospitalsDataset, open: OpenFn): FicheSection {
  const total = d.establishments.reduce((a, e) => a + e.count, 0);
  return {
    id: 'establishments', title: 'Établissements de santé', collapsible: true, open: open('establishments', false),
    summary: escapeHtml(`${frNumber(total, 0)} établissements · FINESS ${monthYear(d.finessDate)}`),
    html: d.establishments.map((e) => kvRow(e.label, valueHtml(frNumber(e.count, 0)))).join('')
      + note('Établissements de santé géographiques par catégorie agrégée FINESS, tous services confondus (pas seulement les urgences).'),
  };
}

function methodSection(d: HospitalsDataset | null, error: string | null, open: OpenFn): FicheSection {
  const failed = error !== null ? ' ; fichier injoignable au dernier essai' : '';
  const sae = d ? `année ${d.vintage}${failed}` : error !== null ? 'source indisponible' : 'chargement…';
  const finess = d ? `extraction du ${parisDay(d.finessDate)}` : error !== null ? 'source indisponible' : 'chargement…';
  const html = kvRow('Urgences, passages, lits', `${sourceLinkHtml('DREES, SAE (base administrative)', SAE_URL)} · ${escapeHtml(sae)}`)
    + kvRow('Sites et coordonnées', `${sourceLinkHtml('FINESS géolocalisé', FINESS_URL)} · ${escapeHtml(finess)}`)
    + (d ? note(`Jointure sur le n° FINESS géographique : ${d.totals.sites} sites d’urgences autorisés, ${d.sites.length} placés sur la carte`
      + `${d.unmatched.length > 0 ? ` ; sans coordonnées FINESS : ${d.unmatched.join(', ')}` : ''}.`) : '')
    + note('Catégories : CHU et CHR, centres hospitaliers, cliniques privées, groupements de coopération sanitaire, hôpitaux des armées, autres ; '
      + 'couleurs de catégorie, pas de niveau.')
    + note('Carte : un point par site, couleur de la catégorie, taille selon les passages annuels ; clic : fiche du site.')
    + note('Aucune donnée ouverte d’occupation des lits ni de tension hospitalière : le panneau décrit l’offre. Donnée annuelle : jamais « en retard ».');
  return {
    id: 'method', title: 'Méthode et sources', collapsible: true, open: open('method', false), tone: 'reference', html,
    summary: escapeHtml(d ? `SAE ${d.vintage} · FINESS ${monthYear(d.finessDate)}` : 'SAE · FINESS'),
  };
}

export function buildHopitauxView(input: HopitauxViewInput): LayerView {
  const { data, error, now, open } = input;
  if (data === null && error === null) return { head: { theme: THEME, title: TITLE, status: ['chargement…'] }, sections: [], bodyHtml: loadingBody() };
  if (data === null) {
    return {
      head: { theme: THEME, title: TITLE, figure: { value: 'n.d.', level: null, caption: CAPTION }, status: ['fichier injoignable', 'DREES SAE, FINESS'] },
      sections: [methodSection(null, error, open)], bodyHtml: sourceErrorCallout(null, now),
    };
  }
  if (data.sites.length === 0) {
    return {
      head: { theme: THEME, title: TITLE, figure: { value: 'n.d.', level: null, caption: CAPTION }, status: [`données annuelles ${data.vintage}`, 'DREES SAE, FINESS'] },
      sections: [methodSection(data, error, open)], bodyHtml: emptyLine('Aucun site d’urgences dans le fichier.'),
    };
  }
  const failed = error !== null ? `<p class="fmk-callout lp-callout">${escapeHtml(`Fichier injoignable au dernier essai : données ${data.vintage} affichées.`)}</p>` : '';
  return {
    head: headOf(data),
    sections: [
      categoriesSection(data, open), capacitySection(data, open), busiestSection(data, open), departmentsSection(data, open),
      establishmentsSection(data, open), methodSection(data, error, open),
    ],
    bodyHtml: failed || undefined,
  };
}
