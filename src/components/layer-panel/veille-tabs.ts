// src/components/layer-panel/veille-tabs.ts : onglets Outre-mer, International et Produits du panneau Veille sanitaire
// (spec 2026-10-03 § 3.1) et aiguillage des quatre onglets ; vue pure, sans réseau ni DOM.
import type { HealthBulletin, OutbreakNews, RecallRisk, ShortageStatus, SyndromeKey } from '../../types/index.ts';
import { alertInSeason, phaseLabel, phaseLevel, seasonalLevel } from '../../services/health-levels.ts';
import { dataDateMs, surveillanceLate, type HealthSurveillanceState } from '../../services/health-surveillance.ts';
import { LEVEL_RANK, levelColorVar, maxLevel, type VigilanceLevel } from '../../services/vigilance.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { kvRow, levelDot } from '../fiche/kit.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { formatPct, frNumber } from './format.ts';
import { emptyLine, listRow, sourceErrorCallout, sourceLinkHtml, valueHtml, type LayerView } from './frame.ts';
import {
  HEALTH_PART, SYNDROME_LABEL, capitalize, inSentence, parisDay, partFailed, sourceUnavailable, spfPagePart, syndromeDepartmentsPart, weekShort,
} from './health-format.ts';
import {
  DROM_TERRITORIES, activeAlertPhrases, alertsDown, allSourcesFailed, buildVeilleFranceView, methodSection, nationalSummary, territoryLevel,
  veilleHead, veilleLoadingView, veilleTabs, type Territory, type VeilleViewInput,
} from './veille.ts';

const DAY_MS = 86_400_000;
type OpenFn = VeilleViewInput['open'];
const note = (text: string): string => `<p class="fmk-note">${escapeHtml(text)}</p>`;
/** Part arrondie au dixième, pour la largeur d'un segment de barre empilée. */
const share = (part: number, total: number): number => Math.round((part / total) * 1000) / 10;

function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// ─── Outre-mer ───

const DROM_ROWS: ReadonlyArray<readonly [SyndromeKey, string]> = [
  ['ira', 'IRA'], ['grippe', 'Grippe'], ['bronchio', 'Bronchiolite (moins de 1 an)'], ['gastro', 'Gastro-entérite'],
];
/** Noms cherchés dans un bulletin : le territoire et son bassin (bulletins « Antilles », « Océan Indien »). */
const BASIN: Readonly<Record<string, readonly string[]>> = {
  '01': ['guadeloupe', 'antilles'], '02': ['martinique', 'antilles'], '03': ['guyane'], '04': ['reunion', 'ocean indien'], '06': ['mayotte', 'ocean indien'],
};
/** Page régionale Santé publique France qui publie les bulletins d'un territoire (libellés des gestionnaires). */
const BASIN_PAGE: Readonly<Record<string, string>> = { '01': 'Antilles', '02': 'Antilles', '03': 'Guyane', '04': 'Océan Indien', '06': 'Océan Indien' };

/** Bulletins d'un territoire : son nom ou celui de son bassin dans le territoire ou le titre du bulletin, du plus récent au plus ancien. */
export function bulletinsFor(region: string, bulletins: readonly HealthBulletin[]): HealthBulletin[] {
  const keys = BASIN[region] ?? [];
  return bulletins
    .filter((b) => {
      const hay = fold(`${b.territory} ${b.title}`);
      return keys.some((k) => hay.includes(k));
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

function territorySummary(state: HealthSurveillanceState, t: Territory, now: number): string {
  const alerts = activeAlertPhrases((state.alerts.data?.levels ?? []).filter((l) => l.region === t.region), now, false);
  const dep = state.syndromic.data?.departments.find((d) => d.code === t.dept);
  const notable = surveillanceLate(state, 'syndromic', now) ? [] : DROM_ROWS.flatMap(([k]) => {
    const v = dep?.values[k];
    if (!v || v.er === null) return [];
    const lv = seasonalLevel(v.er, v.refEr);
    return lv !== 'nd' && LEVEL_RANK[lv] >= LEVEL_RANK.jaune ? [{ k, er: v.er, rank: LEVEL_RANK[lv] }] : [];
  }).sort((a, b) => b.rank - a.rank || b.er - a.er).map((x) => `${inSentence(SYNDROME_LABEL[x.k])} ${formatPct(x.er, 1)}`);
  const parts = [...alerts, ...notable].slice(0, 2);
  return parts.length > 0 ? parts.join(' · ') : 'pas de signal au-dessus des saisons précédentes';
}

function territorySection(state: HealthSurveillanceState, t: Territory, now: number, open: OpenFn): FicheSection {
  const id = `drom-${t.dept}`;
  const alerts = (state.alerts.data?.levels ?? []).filter((l) => l.region === t.region);
  const inSeason = alerts.filter((l) => alertInSeason(l, now));
  const alertLevel = inSeason.length > 0 ? maxLevel(inSeason.map((l) => phaseLevel(l.phase))) : null;
  const syn = state.syndromic.data;
  const lateSyn = surveillanceLate(state, 'syndromic', now);
  const dep = syn?.departments.find((d) => d.code === t.dept) ?? null;
  const alertRows = alertsDown(state) ? sourceUnavailable('niveaux d’alerte Odissé')
    : (['grippe', 'bronchiolite'] as const).map((p) => {
      const l = alerts.find((x) => x.pathology === p);
      if (!l) return listRow({ text: capitalize(p), value: 'n.d.', level: 'gris', note: 'aucune publication' });
      const on = alertInSeason(l, now);
      return listRow({
        text: capitalize(p), value: on ? phaseLabel(l.phase) : 'hors saison', level: on ? phaseLevel(l.phase) : 'gris',
        note: on ? `semaine ${weekShort(l.week)}` : `dernière publication le ${parisDay(l.start)} : ${phaseLabel(l.phase)}`,
      });
    }).join('');
  const urgRows = syn === null ? sourceUnavailable('surveillance des urgences (Odissé)')
    : DROM_ROWS.map(([k, label]) => {
      if (partFailed(syn.errors, syndromeDepartmentsPart(k))) return listRow({ text: label, value: 'n.d.', level: 'gris', note: 'source indisponible' });
      const v = dep?.values[k];
      if (!v || v.er === null) return listRow({ text: label, value: 'n.d.', level: 'gris', note: 'pas de donnée publiée' });
      const lv = lateSyn ? 'nd' : seasonalLevel(v.er, v.refEr);
      return listRow({
        text: label, value: formatPct(v.er, 1), level: lv === 'nd' ? 'gris' : lv,
        note: `des passages aux urgences · ${v.sos === null ? 'pas d’association SOS Médecins' : `SOS Médecins ${formatPct(v.sos, 1)} des actes`}`,
      });
    }).join('');
  const alertsData = state.alerts.data;
  const basin = BASIN_PAGE[t.region] ?? t.name;
  // Page régionale en échec (ou réponse absente) : jamais « aucun bulletin » (S3).
  const bulletinsDown = alertsData === null || partFailed(alertsData.errors, spfPagePart(basin));
  const bulletins = alertsData ? bulletinsFor(t.region, alertsData.bulletins) : [];
  const listed = bulletins.map((b) => listRow({
    text: b.title, value: parisDay(b.date), level: alertLevel ?? 'gris',
    noteHtml: `${b.summary ? `${escapeHtml(b.summary)} · ` : ''}${sourceLinkHtml('bulletin Santé publique France', b.url)}`,
  })).join('');
  const bulletinRows = bulletinsDown ? sourceUnavailable(`bulletins Santé publique France (${basin})`) + listed
    : listed || emptyLine('Aucun bulletin régional publié depuis 45 jours.');
  const week = syn?.week ? `, ${weekShort(syn.week.id)}` : '';
  const html = `<h4 class="fmk-eyebrow">Niveaux d’alerte</h4>${alertRows}<h4 class="fmk-eyebrow">Urgences${week}</h4>${urgRows}`
    + `<h4 class="fmk-eyebrow">Bulletins régionaux</h4>${bulletinRows}`;
  const level = territoryLevel(state, t, now);
  const raised = level !== 'nd' && LEVEL_RANK[level] >= LEVEL_RANK.jaune;
  return { id, title: t.name, collapsible: true, open: open(id, raised), summary: escapeHtml(territorySummary(state, t, now)), html };
}

// ─── International ───

/** Séparateur maladie / lieux d'un titre OMS (« Avian Influenza A(H5N1) - Mexico », « Ebola …, Democratic Republic of the Congo & Uganda »). */
const OUTBREAK_SEP = / [-–] |, /;

/** Épidémie d'un message : titre original avant le séparateur (« Ebola disease caused by Bundibugyo virus »). */
function outbreakKey(n: OutbreakNews): string {
  return fold(n.originalTitle.split(OUTBREAK_SEP)[0]).trim();
}

/** Lieux d'un message (titre original après le séparateur, « & », « and » ou virgule) ; aucun lieu : ensemble vide. */
function outbreakPlaces(n: OutbreakNews): Set<string> {
  const m = OUTBREAK_SEP.exec(n.originalTitle);
  const rest = m ? n.originalTitle.slice(m.index + m[0].length) : '';
  return new Set(rest.split(/\s*(?:,|&|\band\b)\s*/).map((p) => fold(p).trim()).filter((p) => p !== ''));
}

/**
 * Messages groupés par épidémie : même maladie et au moins un lieu en commun (la série Ebola RDC, puis RDC et Ouganda, reste
 * groupée ; H5N1 au Mexique et au Cambodge font deux lignes : aucun pays masqué). Deux messages sans lieu se groupent par maladie.
 */
function groupOutbreaks(news: readonly OutbreakNews[]): OutbreakNews[][] {
  const groups: Array<{ key: string; places: Set<string>; items: OutbreakNews[] }> = [];
  for (const n of news) {
    const key = outbreakKey(n);
    const places = outbreakPlaces(n);
    const group = groups.find((g) => g.key === key
      && (places.size === 0 ? g.places.size === 0 : [...places].some((p) => g.places.has(p))));
    if (group) {
      group.items.push(n);
      for (const p of places) group.places.add(p);
    } else {
      groups.push({ key, places, items: [n] });
    }
  }
  return groups.map((g) => g.items);
}

function whoSection(state: HealthSurveillanceState, now: number, open: OpenFn): FicheSection {
  const base = { id: 'who', title: 'Alertes OMS', collapsible: true, open: open('who', true) };
  const d = state.international.data;
  if (!d || partFailed(d.errors, HEALTH_PART.who)) return { ...base, summary: 'n.d.', html: sourceUnavailable('OMS, Disease Outbreak News') };
  const sorted = [...d.who].sort((a, b) => b.date.localeCompare(a.date));
  const newest = sorted[0];
  if (!newest) return { ...base, summary: 'aucun message', html: emptyLine('Aucun message de l’OMS reçu.') };
  const rows = groupOutbreaks(sorted).slice(0, 6).map((g) => {
    const latest = g[0];
    const oldest = g[g.length - 1];
    const count = g.length > 1 ? ` · ${g.length} messages depuis le ${parisDay(oldest.date)}` : '';
    return listRow({
      text: latest.title, value: parisDay(latest.date), title: latest.originalTitle,
      noteHtml: `${sourceLinkHtml(`OMS, ${latest.id.replace(/^\d{4}-/, '')}`, latest.url)}${escapeHtml(count)}`,
    });
  }).join('');
  const recent = sorted.filter((n) => (dataDateMs(n.date) ?? 0) >= now - 90 * DAY_MS).length;
  return {
    ...base,
    summary: escapeHtml(`${recent} message${recent > 1 ? 's' : ''} en 90 jours · dernier le ${parisDay(newest.date)}`),
    html: rows + note('Messages officiels de l’OMS (Disease Outbreak News), regroupés par épidémie (même maladie, au moins un pays en commun) ; titres traduits par dictionnaire, titre original en infobulle.'),
  };
}

function ecdcSection(state: HealthSurveillanceState, open: OpenFn): FicheSection {
  const base = { id: 'ecdc', title: 'ECDC', collapsible: true, open: open('ecdc', true) };
  const d = state.international.data;
  if (!d || partFailed(d.errors, HEALTH_PART.ecdc)) return { ...base, summary: 'n.d.', html: sourceUnavailable('ECDC, rapport hebdomadaire des menaces') };
  const reports = [...d.ecdc].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
  const first = reports[0];
  if (!first) return { ...base, summary: 'aucun rapport', html: emptyLine('Aucun rapport hebdomadaire de l’ECDC reçu.') };
  const label = (title: string): string => {
    const m = /week (\d{1,2})/i.exec(title);
    return m ? `Semaine ${m[1]}` : title;
  };
  const rows = reports.map((r) => listRow({
    text: label(r.title), value: parisDay(r.date), title: r.title,
    noteHtml: `${escapeHtml(r.topics.length > 0 ? r.topics.join(', ') : 'sujets non extraits')} · ${sourceLinkHtml('rapport ECDC', r.url)}`,
  })).join('');
  return {
    ...base, summary: escapeHtml(`${label(first.title).toLowerCase()} · ${parisDay(first.date)}`),
    html: rows + note('Rapport hebdomadaire des menaces de maladies transmissibles de l’ECDC ; sujets extraits de sa description.'),
  };
}

// ─── Produits ───

const STATUS_WORD: Readonly<Record<ShortageStatus, string>> = {
  rupture: 'rupture', tension: 'tension', remise: 'remise à disposition', arret: 'arrêt de commercialisation',
};
const isActive = (s: ShortageStatus): boolean => s === 'rupture' || s === 'tension';

function drugsSection(state: HealthSurveillanceState, now: number, open: OpenFn): FicheSection {
  const base = { id: 'drugs', title: 'Médicaments (ANSM)', collapsible: true, open: open('drugs', true) };
  const d = state.drugs.data;
  if (!d || partFailed(d.errors, HEALTH_PART.drugs)) return { ...base, summary: 'n.d.', html: sourceUnavailable('ANSM, disponibilité des médicaments') };
  const late = surveillanceLate(state, 'drugs', now);
  const { rupture, tension, remise, arret } = d.counts;
  const active = rupture + tension;
  // En retard : pas de barre (une jauge n'est jamais grise), puces sans couleur.
  const bar = late || active === 0 ? ''
    : `<div class="lp-mix" role="img" aria-label="${rupture} ruptures et ${tension} tensions">`
      + `<i style="width:${share(rupture, active)}%;background:${levelColorVar('rouge')}"></i>`
      + `<i style="width:${share(tension, active)}%;background:${levelColorVar('orange')}"></i></div>`;
  const dot = (level: VigilanceLevel): string => levelDot(late ? null : level);
  const legend = `<div class="lp-leg"><div>${dot('rouge')}<span>Ruptures</span><b class="fmk-num">${frNumber(rupture, 0)}</b></div>`
    + `<div>${dot('orange')}<span>Tensions</span><b class="fmk-num">${frNumber(tension, 0)}</b></div></div>`;
  const byDomain = new Map<string, number>();
  for (const item of d.items) {
    if (!isActive(item.status)) continue;
    for (const dom of item.domains) byDomain.set(dom, (byDomain.get(dom) ?? 0) + 1);
  }
  const domains = [...byDomain.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr')).slice(0, 6);
  const domainsHtml = domains.length === 0 ? '' : '<h4 class="fmk-eyebrow">Situations actives par domaine</h4>'
    + domains.map(([dom, n]) => kvRow(dom, valueHtml(frNumber(n, 0)))).join('');
  const latest = d.items.filter((i) => isActive(i.status)).sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')).slice(0, 5);
  const latestHtml = latest.length === 0 ? '' : '<h4 class="fmk-eyebrow">Dernières entrées</h4>' + latest.map((i) => listRow({
    text: i.name, value: parisDay(i.updatedAt), level: late ? 'gris' : i.status === 'rupture' ? 'rouge' : 'orange',
    note: [i.startedAt ? `${STATUS_WORD[i.status]} depuis le ${parisDay(i.startedAt)}` : STATUS_WORD[i.status], ...i.domains].join(' · '),
  })).join('');
  const others = kvRow('Remises à disposition', valueHtml(frNumber(remise, 0))) + kvRow('Arrêts de commercialisation', valueHtml(frNumber(arret, 0)));
  const text = `Médicaments d’intérêt thérapeutique majeur en difficulté (ANSM) : ruptures et tensions sont les situations actives ; `
    + `liste mise à jour le ${parisDay(d.latestUpdate)}${late ? ' (en retard)' : ''}.`;
  const foot = `<p class="fmk-note">${escapeHtml(text)} ${sourceLinkHtml('Liste officielle des MITM', d.mitmListUrl)}</p>`;
  return {
    ...base, html: bar + legend + domainsHtml + latestHtml + others + foot,
    summary: escapeHtml(`${frNumber(active, 0)} situations actives · ${frNumber(rupture, 0)} ruptures${late ? ' (en retard)' : ''}`),
  };
}

/** Gravité d'un risque de rappel (palette des niveaux, comme la maquette) et ses mots. */
const RISK: Readonly<Record<RecallRisk, { label: string; word: string; level: VigilanceLevel | null }>> = {
  salmonelle: { label: 'Salmonelles', word: 'salmonelles', level: 'rouge' },
  listeria: { label: 'Listeria', word: 'listeria', level: 'rouge' },
  stec: { label: 'E. coli STEC', word: 'E. coli STEC', level: 'orange' },
  campylobacter: { label: 'Campylobacter', word: 'campylobacter', level: 'orange' },
  staphylocoque: { label: 'Staphylocoques', word: 'staphylocoques', level: 'orange' },
  histamine: { label: 'Histamine', word: 'histamine', level: 'orange' },
  allergene: { label: 'Allergènes non déclarés', word: 'allergènes non déclarés', level: 'jaune' },
  autre: { label: 'Autre risque', word: 'autre risque', level: null },
};
const RISK_ORDER = Object.keys(RISK) as RecallRisk[];

function recallsSection(state: HealthSurveillanceState, now: number, open: OpenFn): FicheSection {
  const base = { id: 'recalls', title: 'Rappels de produits', collapsible: true, open: open('recalls', true) };
  const d = state.recalls.data;
  if (!d || partFailed(d.errors, HEALTH_PART.recalls)) return { ...base, summary: 'n.d.', html: sourceUnavailable('RappelConso') };
  const late = surveillanceLate(state, 'recalls', now);
  const byRisk = RISK_ORDER.map((k): [RecallRisk, number] => [k, d.byRisk[k] ?? 0]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const legend = byRisk.length === 0 ? '' : `<div class="lp-leg">${byRisk.map(([k, n]) =>
    `<div>${levelDot(late ? null : RISK[k].level)}<span>${escapeHtml(RISK[k].label)}</span><b class="fmk-num">${frNumber(n, 0)}</b></div>`).join('')}</div>`;
  const rows = d.latest.slice(0, 10).map((r) => {
    const levels = r.risks.flatMap((k) => {
      const l = RISK[k].level;
      return l ? [l] : [];
    });
    const words = r.risks.map((k) => RISK[k].word).join(', ') || r.riskText;
    return listRow({
      text: capitalize(r.label), value: parisDay(r.date), level: late || levels.length === 0 ? 'gris' : maxLevel(levels),
      noteHtml: `${escapeHtml([words, r.brand, r.zone].filter((x) => x.length > 0).join(' · '))} · ${sourceLinkHtml('fiche', r.url)}`,
    });
  }).join('');
  const html = kvRow('Rappels publiés (14 jours)', valueHtml(frNumber(d.total, 0)))
    + kvRow('dont risque infectieux ou allergène', valueHtml(frNumber(d.healthRisk, 0))) + legend
    + (rows ? `<h4 class="fmk-eyebrow">Derniers rappels à risque sanitaire</h4>${rows}` : emptyLine('Aucun rappel à risque sanitaire en 14 jours.'))
    + note(`RappelConso : nouvelles fiches seulement (première version), depuis le ${parisDay(d.since)}${late ? ' ; dernière publication en retard' : ''}.`);
  return { ...base, html, summary: escapeHtml(`${frNumber(d.healthRisk, 0)} à risque sanitaire en 14 jours${late ? ' (en retard)' : ''}`) };
}

/** Aiguilleur des quatre onglets ; même en-tête et mêmes onglets partout, « Méthode et sources » en dernier. */
export function buildVeilleView(input: VeilleViewInput): LayerView {
  const { state, tab, now, open } = input;
  if (state === null) return veilleLoadingView(tab);
  if (tab === 'france') return buildVeilleFranceView(input);
  const sections = tab === 'outremer' ? DROM_TERRITORIES.map((t) => territorySection(state, t, now, open))
    : tab === 'international' ? [whoSection(state, now, open), ecdcSection(state, open)]
    : [drugsSection(state, now, open), recallsSection(state, now, open)];
  return {
    head: veilleHead(state, nationalSummary(state, now), now), tabs: veilleTabs(state, now), activeTab: tab,
    sections: [...sections, methodSection(state, now, open)],
    bodyHtml: allSourcesFailed(state) ? sourceErrorCallout(null, now) : undefined,
  };
}
