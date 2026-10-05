// src/components/layer-panel/cyber.ts : vue pure du panneau Vigilance cyber (spec 2026-10-04 souveraineté § 2.3 ; contrats § 4.1 ;
// amendement 7 : O1 à O5, S10 à S13) ; aucun accès réseau ni DOM. Alertes du CERT-FR avec leur statut officiel repris tel quel
// (« en cours », « clôturée le … », sinon « statut non lu », jamais supposé) ; exploitation signalée par le CERT-FR citée telle quelle,
// l'inscription au catalogue KEV de la CISA en appui ; vulnérabilités exploitées du catalogue, celles citées par le CERT-FR d'abord ;
// revendications de rançongiciels agrégées (V3 : revendiquées par le groupe, non confirmées ; jaune au plus ; aucun nom de victime) ;
// rapports Menaces et incidents de l'ANSSI ; fuites publiées en .fr en compte et lien seulement ; alertes de Cybermalveillance.gouv.fr.
// La pastille est celle de `cyberLevel` (A1), jamais recalculée ici. Aucun lieu n'est publié : rien sur la carte (V5). Chaque source
// porte sa date (S1).
import type {
  CertFrItem, CertFrReport, CyberResponse, CybermalveillanceEntry, KevItem, RansomShare, RansomwareSummary,
} from '../../types/index.ts';
import { parisDayOf } from '../../services/environment-levels.ts';
import {
  CERTFR_RECENT_DAYS, CLAIMS_RATIO_JAUNE, certfrAgeDays, certfrDate, claimsRatio, cyberLevel, isCertFrAlertOpen, isCertFrPublishedRecently,
  isSovereigntyDataLate,
} from '../../services/sovereignty-levels.ts';
import type { VigilanceLevel } from '../../services/vigilance.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { kvRow } from '../fiche/kit.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { lineChart, stackedDayBars, type ChartPoint, type DayStack } from './chart.ts';
import { NBSP, dayMonth, formatSignedPct, frNumber } from './format.ts';
import {
  barRow, emptyLine as plainEmptyLine, listRow, loadingBody, sourceErrorCallout, sourceLinkHtml, valueHtml, type LayerHeadModel, type LayerView,
} from './frame.ts';
import {
  SOVEREIGNTY_THEME, certfrProductText, clockOf, dataMs, dateOf, formatCount, glueSovUnits, note as plainNote, plural, readErrors, sectorWord,
  shortDate, sourceDown, stamp,
} from './sovereignty-format.ts';

/** R1 (revue finale M2) : notes et lignes vides de la vue, nombre et unité ou mot compté insécables (« 7 jours », « 22 avis »). */
const note = (text: string): string => plainNote(glueSovUnits(text));
const emptyLine = (text: string): string => plainEmptyLine(glueSovUnits(text));
/** Résumé de section, insécable puis échappé. */
const summaryText = (text: string): string => escapeHtml(glueSovUnits(text));

export type OpenFn = (sectionId: string, byDefault: boolean) => boolean;
export interface CyberViewInput { cyber: CyberResponse | null; cyberError: string | null; now: number; open: OpenFn }

export const CYBER_TITLE = 'Vigilance cyber';

const DAY_MS = 86_400_000;
const AVIS_SHOWN = 12;
const KEV_UNCITED_SHOWN = 8;
const REPORTS_SHOWN = 6;
const WEEKS = 12;
const CERTFR_URL = 'https://www.cert.ssi.gouv.fr';
const CERTFR_CONTACT_URL = 'https://www.cert.ssi.gouv.fr/contact/';
const CERTFR_CTI_URL = 'https://www.cert.ssi.gouv.fr/cti/';
const CSIRT_URL = 'https://www.cert.ssi.gouv.fr/csirt/csirt-territoriaux/';
const CYBER17_URL = 'https://17cyber.gouv.fr/';
/** Panorama de la cybermenace 2025 de l'ANSSI (CERTFR-2026-CTI-002, 11/03/2026) : source du chiffre de contexte (S11). */
const PANORAMA_2025_URL = 'https://www.cert.ssi.gouv.fr/uploads/CERTFR-2026-CTI-002.pdf';
const KEV_URL = 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog';
const RANSOMWARE_URL = 'https://www.ransomware.live';
const RANSOMWARE_FR_URL = 'https://www.ransomware.live/country/FR';
const RANSOMWARE_TERMS_URL = 'https://www.ransomware.live/t&c';
const HIBP_URL = 'https://haveibeenpwned.com';
const CYBERMALVEILLANCE_URL = 'https://www.cybermalveillance.gouv.fr';
const KEV_CITED_COLOR = 'var(--cat-kev-cite)';
const KEV_COLOR = 'var(--cat-kev)';
const CLAIMS_COLOR = 'var(--cat-revendication)';
const CERTFR_NAME = 'alertes et avis CERT-FR';
const KEV_NAME = 'catalogue KEV de la CISA';
const CLAIMS_NAME = 'revendications de ransomware.live';
const REPORTS_NAME = 'rapports Menaces et incidents du CERT-FR';
const REPORTS_ERROR_PREFIX = 'CERT-FR, rapports Menaces et incidents';
const V3_SENTENCE = 'Annonces publiées par des groupes cybercriminels : revendiquées par le groupe, non confirmées. Aucun nom de victime n’est affiché ici ; '
  + 'la liste publique est sur la source.';

/** Âge d'une vulnérabilité du catalogue KEV en jours de Paris révolus depuis son ajout (« moins de 7 jours » : 0 à 6). */
export function kevAgeDays(k: Pick<KevItem, 'dateAdded'>, now: number): number {
  return Math.round((Date.parse(`${parisDayOf(now)}T00:00:00Z`) - Date.parse(`${k.dateAdded}T00:00:00Z`)) / DAY_MS);
}

/** « à 16:30 » le jour même, « le 03/10 à 14:00 » sinon (heure de Paris) ; null sans date lisible. */
function atText(iso: string | null | undefined, now: number): string | null {
  if (dataMs(iso) === null) return null;
  const [first, second] = clockOf(iso, now).split(' ');
  return second === undefined ? `à ${first}` : `le ${first} à ${second}`;
}

/** « depuis 16:30 » le jour même, « depuis le 03/10 à 14:00 » sinon (heure de Paris). */
function sinceText(iso: string | null | undefined, now: number): string {
  const at = atText(iso, now);
  return at === null ? 'une heure n.d.' : at.startsWith('à ') ? at.slice(2) : at;
}

function lateMark(late: boolean): string {
  return late ? ' (en retard)' : '';
}

function certfrLate(c: CyberResponse, now: number): boolean {
  return isSovereigntyDataLate('certfr', c.certfr.readAt, now);
}

/** Publication la plus récente d'abord, puis référence décroissante (même ordre que la pastille). */
function byPublication(a: CertFrItem, b: CertFrItem): number {
  return b.firstVersion.localeCompare(a.firstVersion) || b.ref.localeCompare(a.ref, 'fr', { numeric: true });
}

/** Alertes au statut « en cours » repris du CERT-FR (O1), la plus récemment publiée d'abord. */
function openAlerts(c: CyberResponse): CertFrItem[] {
  return c.certfr.alerts.filter(isCertFrAlertOpen).sort(byPublication);
}

function avisWithin(c: CyberResponse, now: number, days: number): CertFrItem[] {
  return c.certfr.avis.filter((a) => certfrAgeDays(a, now) < days);
}

/** Vulnérabilités ajoutées depuis moins de `days` jours ; une date d'ajout future (âge négatif) n'est jamais comptée. */
function kevWithin(c: CyberResponse, now: number, days: number): KevItem[] {
  return c.kev.recent.filter((k) => {
    const age = kevAgeDays(k, now);
    return age >= 0 && age < days;
  });
}

/** Éditeur et produit du catalogue ; « Multiple Products » de la CISA dit en français (aucun texte anglais générique affiché). */
function kevName(k: KevItem): string {
  const product = k.product.trim() === 'Multiple Products' ? '(plusieurs produits)' : k.product;
  return `${k.vendor} ${product}`.trim();
}

function shortRef(ref: string): string {
  return ref.replace(/^CERTFR-\d{4}-/, '');
}

// ─── En-tête ───

function figureCaption(c: CyberResponse, isLate: boolean, now: number): string {
  const open = openAlerts(c);
  const latest = open[0];
  const head = latest === undefined ? 'alerte CERT-FR en cours'
    : open.length > 1
      ? `alertes CERT-FR en cours · la plus récente : ${certfrProductText(latest)}, publiée le ${shortDate(latest.firstVersion, now)}`
      : `alerte CERT-FR en cours · ${certfrProductText(latest)}, publiée le ${shortDate(latest.firstVersion, now)}`;
  const unread = c.certfr.alerts.filter((a) => a.status === null).length;
  const unreadText = unread > 0 ? ` · ${plural(unread, 'alerte au statut non lu', 'alertes au statut non lu')}` : '';
  return glueSovUnits(`${head} · ${avisWithin(c, now, 7).length} avis sur 7 jours${unreadText}${lateMark(isLate)}`);
}

/** Date de chaque source (S1) ; les revendications par la publication du fichier de ransomware.live, pas par la lecture. */
function stamps(c: CyberResponse, now: number): string {
  const ransom = c.ransomware;
  return [
    stamp('CERT-FR', c.certfr.readAt, certfrLate(c, now), now),
    stamp('CISA KEV', c.kev.readAt, isSovereigntyDataLate('kev', c.kev.readAt, now), now),
    stamp('Ransomware.live', ransom?.lastModified ?? null, ransom !== null && isSovereigntyDataLate('ransomware', ransom.lastModified, now), now),
  ].join(' · ');
}

/** Phrase d'appui sur le catalogue KEV ; catalogue en retard (26 h) : datée et dite « en retard », jamais lue comme actuelle. */
function leadOf(c: CyberResponse, now: number): string | null {
  if (c.kev.readAt === null) return null;
  const week = kevWithin(c, now, 7);
  const cited = week.filter((k) => k.certfrRefs.length > 0);
  const names = [...new Set(cited.map(kevName))];
  const late = isSovereigntyDataLate('kev', c.kev.readAt, now) ? ` (catalogue lu ${atText(c.kev.readAt, now) ?? 'à une heure n.d.'}, en retard)` : '';
  return glueSovUnits(`${plural(week.length, 'vulnérabilité exploitée ajoutée', 'vulnérabilités exploitées ajoutées')} au catalogue KEV de la CISA en 7 jours, `
    + `dont ${cited.length} ${cited.length > 1 ? 'citées' : 'citée'} par le CERT-FR${names.length > 0 ? ` : ${names.join(', ')}` : ''}${late}.`);
}

/** Pastille et raison de `cyberLevel` (O2), jamais recalculées ; gros chiffre : alertes en cours, sans couleur à zéro ou en retard. */
function headOf(c: CyberResponse, now: number): LayerHeadModel {
  const verdict = cyberLevel(c, now);
  const base = {
    theme: SOVEREIGNTY_THEME, title: CYBER_TITLE, lead: leadOf(c, now), level: verdict.level, status: [glueSovUnits(verdict.reason), stamps(c, now)],
  };
  if (c.certfr.readAt === null) {
    return { ...base, figure: { value: 'n.d.', caption: 'alertes CERT-FR en cours : CERT-FR indisponible', level: null } };
  }
  const isLate = certfrLate(c, now);
  const count = openAlerts(c).length;
  return { ...base, figure: { value: formatCount(count), caption: figureCaption(c, isLate, now), ...(isLate || count === 0 ? { level: null } : {}) } };
}

// ─── Alertes et avis CERT-FR ───

/**
 * Puce d'une ligne, seuils de la pastille (O2) : alerte en cours publiée depuis moins de 7 jours orange, depuis 7 jours ou plus jaune ;
 * alerte close ou au statut non lu grise ; avis de moins de 7 jours citant une vulnérabilité du catalogue KEV jaune ; autres avis sans
 * puce (aucun niveau inventé). CERT-FR en retard : toutes grises.
 */
function certfrDot(item: CertFrItem, isLate: boolean, now: number): VigilanceLevel | 'gris' | null {
  if (isLate) return 'gris';
  if (item.kind === 'alerte') {
    if (!isCertFrAlertOpen(item)) return 'gris';
    return isCertFrPublishedRecently(item, now) ? 'orange' : 'jaune';
  }
  const age = certfrAgeDays(item, now);
  return item.kevCves.length > 0 && age >= 0 && age < CERTFR_RECENT_DAYS ? 'jaune' : null;
}

/** Statut officiel repris tel quel (O1) ; jamais « en cours » supposé. */
function statusText(item: CertFrItem, now: number): string {
  if (item.status === 'en-cours') return 'en cours';
  if (item.status === 'cloturee') return item.closedAt !== null ? `clôturée le ${shortDate(item.closedAt, now)}` : 'clôturée';
  return 'statut non lu';
}

/**
 * Exploitation (O3) : « exploitation signalée par le CERT-FR » avec la phrase de la page citée telle quelle (elle peut attribuer
 * l'exploitation à un éditeur) ; inscription au catalogue KEV de la CISA en appui, datée quand l'ajout a moins de 30 jours ; sinon
 * « non inscrite au catalogue KEV » sur une alerte, jamais « pas d'exploitation connue ». Un avis hors catalogue ne porte aucune mention
 * (arbitrage du contrôleur : la section le dit une fois).
 */
function exploitationParts(item: CertFrItem, c: CyberResponse, now: number): string[] {
  const parts: string[] = [];
  if (item.exploited === true) {
    parts.push(item.exploitedQuote ? `exploitation signalée par le CERT-FR : « ${glueSovUnits(item.exploitedQuote)} »` : 'exploitation signalée par le CERT-FR');
  } else if (item.exploited === null && item.kind === 'alerte') {
    parts.push('page non lue');
  }
  if (item.kevCves.length > 0) {
    const added = item.kevCves.map((cve) => c.kev.recent.find((k) => k.cve === cve)?.dateAdded).filter((d): d is string => d !== undefined).sort()[0];
    const word = item.kevCves.length > 1 ? 'inscrites' : 'inscrite';
    parts.push(`${word} au catalogue KEV de la CISA${added !== undefined ? ` le ${shortDate(added, now)}` : ''} : ${item.kevCves.join(', ')}`);
  } else if (item.kind === 'alerte') {
    parts.push('non inscrite au catalogue KEV');
  }
  return parts;
}

function certfrRow(item: CertFrItem, c: CyberResponse, isLate: boolean, now: number): string {
  const isAlert = item.kind === 'alerte';
  const updated = item.lastVersion !== null && item.lastVersion !== item.firstVersion;
  const dates = isAlert
    ? [`publiée le ${shortDate(item.firstVersion, now)}`, ...(updated && item.lastVersion !== null ? [`dernière version le ${shortDate(item.lastVersion, now)}`] : [])]
    : (updated ? [`publié le ${shortDate(item.firstVersion, now)}`] : []);
  const parts = [item.ref, ...dates, ...exploitationParts(item, c, now)];
  return listRow({
    text: `${isAlert ? 'Alerte' : 'Avis'} : ${certfrProductText(item)}`,
    value: isAlert ? statusText(item, now) : shortDate(certfrDate(item), now),
    level: certfrDot(item, isLate, now),
    noteHtml: `${escapeHtml(parts.join(' · '))} · ${sourceLinkHtml('page CERT-FR', item.url)}`,
  });
}

/** Contacts en cas d'incident (S13), toujours affichés. */
function incidentLine(): string {
  return `<p class="fmk-note">${escapeHtml('En cas d’incident : ')}${sourceLinkHtml('CERT-FR', CERTFR_CONTACT_URL)}${escapeHtml(' (administrations, OIV, OSE), ')}`
    + `${sourceLinkHtml('CSIRT territorial de la région', CSIRT_URL)}, ${sourceLinkHtml('17Cyber', CYBER17_URL)}.</p>`;
}

function certfrSection(c: CyberResponse, now: number, open: OpenFn): FicheSection {
  const base = { id: 'certfr', title: 'Alertes et avis CERT-FR', collapsible: true, open: open('certfr', true) };
  if (c.certfr.readAt === null) return { ...base, summary: 'n.d.', html: sourceDown(CERTFR_NAME) + incidentLine() };
  const isLate = certfrLate(c, now);
  const alerts = [...c.certfr.alerts].sort(byPublication).map((a) => certfrRow(a, c, isLate, now)).join('');
  const avis = c.certfr.avis.map((a) => certfrRow(a, c, isLate, now));
  const more = avis.length - AVIS_SHOWN;
  const summary = `${plural(c.certfr.alerts.length, 'alerte')} sur 90 jours, dont ${openAlerts(c).length} en cours · `
    + `${avisWithin(c, now, 7).length} avis sur 7 jours${lateMark(isLate)}`;
  return {
    ...base,
    summary: summaryText(summary),
    // En retard : la lecture est dite dans le corps, au-dessus des statuts qu'elle date (puces grises), pas seulement dans le résumé.
    html: (isLate ? note(`Statuts et avis lus ${atText(c.certfr.readAt, now) ?? 'à une heure n.d.'} (en retard) : à revérifier sur le site du CERT-FR.`) : '')
      + (alerts || emptyLine('Aucune alerte CERT-FR depuis 90 jours.'))
      + note('Statut repris du CERT-FR : en cours, ou clôturée le JJ/MM. Une clôture « ne signifie pas la fin d’une menace » (CERT-FR).')
      + note('Avis des 30 derniers jours ; sans mention : non inscrite au catalogue KEV.')
      + (avis.length > 0 ? avis.slice(0, AVIS_SHOWN).join('') : emptyLine('Aucun avis CERT-FR depuis 30 jours.'))
      + (more > 0 ? `<details class="lp-more"><summary>${summaryText(`${more} avis de plus`)}</summary>${avis.slice(AVIS_SHOWN).join('')}</details>` : '')
      + note('Exploitation : « exploitation signalée par le CERT-FR » quand le texte de l’alerte le dit, phrase citée telle quelle ; l’inscription au '
        + 'catalogue KEV de la CISA vient en appui. Lire l’alerte officielle.')
      + incidentLine(),
  };
}

// ─── Vulnérabilités exploitées (catalogue KEV de la CISA) ───

function kevRow(k: KevItem): string {
  const cited = k.certfrRefs.length > 0;
  const parts = [k.cve, cited ? `citée par le CERT-FR (${k.certfrRefs.map(shortRef).join(', ')})` : 'catalogue mondial, non citée par le CERT-FR',
    k.ransomware ? 'campagne de rançongiciel connue' : null];
  return listRow({ text: kevName(k), value: dayMonth(k.dateAdded), color: cited ? KEV_CITED_COLOR : KEV_COLOR, note: parts.filter((p): p is string => p !== null).join(' · ') });
}

function constructionNote(n: number): string {
  return n < WEEKS ? note(`Référence en construction (${n} ${n > 1 ? 'semaines' : 'semaine'} sur ${WEEKS}).`) : '';
}

function kevChart(c: CyberResponse, now: number): string {
  const days: DayStack[] = c.kev.weeks.flatMap((w) => {
    const at = dataMs(w.weekStart);
    return at === null ? [] : [{
      day: at,
      parts: [
        { value: w.cited, color: KEV_CITED_COLOR, label: 'citées par le CERT-FR' },
        { value: Math.max(0, w.added - w.cited), color: KEV_COLOR, label: 'autres' },
      ],
    }];
  });
  const chart = stackedDayBars(days, {
    label: 'Vulnérabilités ajoutées au catalogue KEV de la CISA par semaine, sur 12 semaines, celles citées par le CERT-FR en couleur foncée',
    value: (v) => formatCount(v), tick: (ms) => shortDate(new Date(ms).toISOString(), now),
  });
  if (!chart) return '';
  return `<div class="lp-legend"><span class="lp-key"><i style="background:${KEV_CITED_COLOR}"></i>citées par le CERT-FR</span>`
    + `<span class="lp-key"><i style="background:${KEV_COLOR}"></i>autres</span></div>${chart}${constructionNote(days.length)}`;
}

function kevSection(c: CyberResponse, now: number, open: OpenFn): FicheSection {
  const base = { id: 'kev', title: 'Vulnérabilités exploitées (catalogue KEV de la CISA)', collapsible: true, open: open('kev', true) };
  if (c.kev.readAt === null) return { ...base, summary: 'n.d.', html: sourceDown(KEV_NAME) };
  const cited = c.kev.recent.filter((k) => k.certfrRefs.length > 0);
  const others = c.kev.recent.filter((k) => k.certfrRefs.length === 0);
  const rest = others.slice(KEV_UNCITED_SHOWN);
  const late = isSovereigntyDataLate('kev', c.kev.readAt, now);
  const catalog = `version ${c.kev.catalogVersion ?? 'n.d.'} du ${dateOf(c.kev.dateReleased)}, `
    + `${c.kev.count === null ? 'n.d.' : formatCount(c.kev.count)} vulnérabilités`;
  return {
    ...base,
    summary: summaryText(`${kevWithin(c, now, 7).length} sur 7 jours · ${c.kev.recent.length} sur 30 jours${lateMark(late)}`),
    html: (c.kev.recent.length > 0
      ? [...cited, ...others.slice(0, KEV_UNCITED_SHOWN)].map(kevRow).join('')
      : emptyLine('Aucune vulnérabilité ajoutée au catalogue KEV depuis 30 jours.'))
      + (rest.length > 0 ? `<details class="lp-more"><summary>${summaryText(`${rest.length} vulnérabilités de plus`)}</summary>${rest.map(kevRow).join('')}</details>` : '')
      + kevChart(c, now)
      + note(`Catalogue KEV de la CISA (domaine public), ${catalog}. « Citée par le CERT-FR » : CVE présente dans une alerte ou un avis du CERT-FR ; `
        + '« catalogue mondial » : vulnérabilité exploitée dans le monde, pas un événement en France.'),
  };
}

// ─── Revendications de rançongiciels (V3, O4, S11) ───

function claimsChart(r: RansomwareSummary, now: number): string {
  const points: ChartPoint[] = r.weeks.flatMap((w) => {
    const at = dataMs(w.weekStart);
    return at === null ? [] : [{ at, value: w.count }];
  });
  if (points.length < 2) return '';
  const chart = lineChart(points, {
    label: glueSovUnits('Revendications de rançongiciels en France par semaine, sur 12 semaines ; moyenne des 90 jours précédents en tirets'),
    from: points[0].at, to: points[points.length - 1].at, stroke: CLAIMS_COLOR, refValue: r.baselineWeekly, markPeak: true,
    value: (v) => frNumber(v, 0), tick: (ms) => shortDate(new Date(ms).toISOString(), now),
  });
  return `<div class="lp-legend"><span class="lp-key"><i style="background:${CLAIMS_COLOR}"></i>revendications par semaine</span>`
    + `<span class="lp-key"><i class="lp-dash"></i>moyenne des 90${NBSP}jours précédents</span></div>` + chart + constructionNote(points.length);
}

function shareRows(shares: readonly RansomShare[], word: (label: string) => string): string {
  const top = shares.slice(0, 6);
  const max = Math.max(1, ...top.map((s) => s.count));
  return top.map((s) => barRow({ label: word(s.label), pct: (s.count / max) * 100, value: formatCount(s.count), color: CLAIMS_COLOR })).join('');
}

/** Ligne de datation des comptes (S1) : publication du fichier (lastModified), puis lecture du serveur. */
function claimsFileLine(r: RansomwareSummary, late: boolean, now: number): string {
  const published = atText(r.lastModified, now);
  const checked = atText(r.checkedAt, now);
  const file = published === null ? 'Fichier de ransomware.live sans date de modification' : `Fichier publié par ransomware.live ${published}`;
  return note(`${file}${lateMark(late)}${checked === null ? '' : `, lu ${checked}`} : comptes de ce fichier.`);
}

/** Contexte officiel (S11) : chiffre du Panorama de la cybermenace 2025 de l'ANSSI, cité tel quel. */
function anssiContext(): string {
  return `<p class="fmk-note">${escapeHtml('En 2025, 128 compromissions par rançongiciel ont été portées à la connaissance de l’ANSSI (')}`
    + `${sourceLinkHtml('Panorama de la cybermenace 2025', PANORAMA_2025_URL)}${escapeHtml(') : les revendications ne sont pas ce décompte.')}</p>`;
}

function claimsSection(c: CyberResponse, now: number, open: OpenFn): FicheSection {
  const base = { id: 'revendications', title: 'Revendications de rançongiciels en France', collapsible: true, open: open('revendications', true) };
  const r = c.ransomware;
  if (r === null) return { ...base, summary: 'n.d.', html: sourceDown(CLAIMS_NAME) };
  const late = isSovereigntyDataLate('ransomware', r.lastModified, now);
  const ratio = claimsRatio(r);
  const ratioText = ratio === null ? 'moyenne n.d.' : `${frNumber(ratio, 2)} fois la moyenne`;
  // O4 : jaune au plus, même au-delà de 3 fois la moyenne (une revendication n'est pas confirmée) ; en retard : sans couleur.
  const ratioLevel: VigilanceLevel | null = !late && ratio !== null && ratio > CLAIMS_RATIO_JAUNE ? 'jaune' : null;
  const gap = r.baseline30 !== null && r.baseline30 > 0 ? `${formatSignedPct((r.last30 / r.baseline30 - 1) * 100)} par rapport à la moyenne` : 'moyenne n.d.';
  const html = claimsFileLine(r, late, now)
    + claimsChart(r, now)
    + kvRow('Cette semaine', valueHtml(`${formatCount(r.weekCount)} · ${ratioText}`, ratioLevel))
    + kvRow(glueSovUnits('Moyenne hebdomadaire (90 jours précédents)'), valueHtml(r.baselineWeekly === null ? 'n.d.' : frNumber(r.baselineWeekly, 1)))
    + kvRow('30 derniers jours', valueHtml(`${formatCount(r.last30)} · ${gap}`))
    + note('Secteurs sur 30 jours')
    + (r.sectors30.length > 0 ? shareRows(r.sectors30, sectorWord) : emptyLine('Aucune revendication en France sur 30 jours.'))
    + note('Groupes cybercriminels sur 30 jours')
    + (r.groups30.length > 0 ? shareRows(r.groups30, (label) => label) : emptyLine('Aucun groupe sur 30 jours.'))
    + note(V3_SENTENCE)
    + anssiContext()
    + `<p class="fmk-note">${sourceLinkHtml('liste publique des revendications (ransomware.live), non confirmées', RANSOMWARE_FR_URL)} · `
    + `${sourceLinkHtml('Source : Ransomware.live', RANSOMWARE_URL)}</p>`
    + note('Comptées par la date de découverte de ransomware.live ; semaine : 7 fois 24 heures jusqu’à la lecture.')
    + (r.baselineWeekly === null ? note('Moyenne n.d. : historique insuffisant.') : '');
  return { ...base, summary: summaryText(`${formatCount(r.weekCount)} en 7 jours · ${formatCount(r.last30)} en 30 jours${lateMark(late)}`), html };
}

// ─── Rapports Menaces et incidents de l'ANSSI (S12) ───

function reportRow(r: CertFrReport, now: number): string {
  return listRow({
    text: r.title, value: shortDate(r.date, now),
    noteHtml: `${escapeHtml(`${r.ref}${r.lang === 'en' ? ' · en anglais' : ''}`)} · ${sourceLinkHtml('lire le rapport', r.url)}`,
  });
}

function reportsSection(c: CyberResponse, now: number, open: OpenFn): FicheSection {
  const base = { id: 'rapports', title: 'Rapports Menaces et incidents (ANSSI)', collapsible: true, open: open('rapports', false) };
  if (c.certfr.readAt === null) return { ...base, summary: 'n.d.', html: sourceDown(REPORTS_NAME) };
  const reports = [...c.certfr.reports].sort((a, b) => b.date.localeCompare(a.date) || b.ref.localeCompare(a.ref, 'fr', { numeric: true }));
  const latest = reports[0];
  if (latest === undefined) {
    const down = c.errors.some((e) => e.startsWith(REPORTS_ERROR_PREFIX));
    return {
      ...base, summary: down ? 'n.d.' : 'aucun rapport lu',
      html: down ? sourceDown(REPORTS_NAME) : emptyLine('Aucun rapport lu dans le flux Menaces et incidents du CERT-FR.'),
    };
  }
  const rows = reports.map((r) => reportRow(r, now));
  const more = rows.length - REPORTS_SHOWN;
  return {
    ...base,
    summary: summaryText(`${plural(reports.length, 'rapport')} · dernier le ${shortDate(latest.date, now)}${lateMark(certfrLate(c, now))}`),
    html: rows.slice(0, REPORTS_SHOWN).join('')
      + (more > 0 ? `<details class="lp-more"><summary>${summaryText(`${more} rapports de plus`)}</summary>${rows.slice(REPORTS_SHOWN).join('')}</details>` : '')
      + note('Flux « Menaces et incidents » du CERT-FR (ANSSI) : rapports d’analyse de la menace ; titre, date et lien seulement.'),
  };
}

// ─── Fuites publiées (HIBP, O5 : un compte et un lien seulement) ───

function leaksSection(c: CyberResponse, now: number, open: OpenFn): FicheSection {
  const base = { id: 'fuites', title: 'Fuites de données publiées', collapsible: true, open: open('fuites', false) };
  const h = c.hibp;
  if (h === null) return { ...base, summary: 'n.d.', html: sourceDown('Have I Been Pwned') };
  const late = isSovereigntyDataLate('hibp', h.readAt, now);
  const counted = kvRow(glueSovUnits('Fuites de domaines en .fr ajoutées depuis 30 jours'), valueHtml(formatCount(h.count)))
    + kvRow('Ajout le plus récent', valueHtml(shortDate(h.newestAddedDate, now)));
  // V1 : une liste en retard n'est jamais un calme ; « aucune fuite » n'est dit que sur une lecture à jour.
  const notEvaluated = `Non évalué · Have I Been Pwned non relu depuis ${sinceText(h.readAt, now)}`;
  const counts = late
    ? (h.count === 0 ? emptyLine(`${notEvaluated}.`) : note(`${notEvaluated} : comptes de la dernière lecture.`) + counted)
    : h.count === 0 ? emptyLine('Aucune fuite de domaine en .fr ajoutée à Have I Been Pwned depuis 30 jours.') : counted;
  const summary = h.count === 0 ? (late ? 'non évalué' : 'aucune en .fr sur 30 jours') : `${plural(h.count, 'fuite')} en .fr sur 30 jours`;
  return {
    ...base,
    summary: summaryText(`${summary}${lateMark(late)}`),
    html: counts
      + `<p class="fmk-note">${sourceLinkHtml('liste publique des fuites sur Have I Been Pwned', h.url)}</p>`
      + note('Compte et lien seulement, sans titre ni domaine : pour les violations de données des services de l’État, l’ANSSI centralise la '
        + 'communication technique de crise (opération REACTIV) ; ne pas amplifier une fuite.')
      + note('Critère : domaine finissant par .fr (HIBP ne publie pas de pays), ajout depuis moins de 30 jours ; fausses fuites, listes de spam et '
        + 'fuites retirées écartées.')
      + note(`Liste lue ${atText(h.readAt, now) ?? 'à une heure n.d.'}${lateMark(late)}.`)
      + `<p class="fmk-note">${sourceLinkHtml('Have I Been Pwned, CC BY 4.0', HIBP_URL)}</p>`,
  };
}

// ─── Cybermalveillance.gouv.fr ───

function entryDate(e: CybermalveillanceEntry): string | null {
  return e.updated ?? e.published;
}

function byEntryDate(a: CybermalveillanceEntry, b: CybermalveillanceEntry): number {
  return (dataMs(entryDate(b)) ?? 0) - (dataMs(entryDate(a)) ?? 0);
}

function entryRow(e: CybermalveillanceEntry, now: number): string {
  return listRow({ text: e.title, value: shortDate(entryDate(e), now), noteHtml: sourceLinkHtml('lire sur cybermalveillance.gouv.fr', e.url) });
}

function cybermalveillanceSection(c: CyberResponse, now: number, open: OpenFn): FicheSection {
  const base = { id: 'cybermalveillance', title: 'Alertes cybermalveillance.gouv.fr', collapsible: true, open: open('cybermalveillance', false) };
  const cm = c.cybermalveillance;
  if (cm === null || cm.readAt === null) return { ...base, summary: 'n.d.', html: sourceDown('Cybermalveillance.gouv.fr') };
  const late = isSovereigntyDataLate('cybermalveillance', cm.readAt, now);
  const alerts = cm.entries.filter((e) => e.feed === 'alertes').sort(byEntryDate);
  const news = cm.entries.filter((e) => e.feed === 'actualites').sort(byEntryDate).slice(0, 5);
  const latest = alerts[0];
  const summary = latest === undefined ? 'aucune alerte' : `${plural(alerts.length, 'alerte')} · dernière le ${shortDate(entryDate(latest), now)}`;
  return {
    ...base,
    summary: summaryText(`${summary}${lateMark(late)}`),
    html: (alerts.length > 0 ? alerts.map((e) => entryRow(e, now)).join('') : emptyLine('Aucune alerte publiée par Cybermalveillance.gouv.fr.'))
      + (news.length > 0 ? `<details class="lp-more"><summary>Actualités</summary>${news.map((e) => entryRow(e, now)).join('')}</details>` : '')
      + note('Alertes grand public et petites entreprises du dispositif national d’assistance : titre, date et lien seulement.')
      + note(`Flux lus ${atText(cm.readAt, now) ?? 'à une heure n.d.'}${lateMark(late)}.`),
  };
}

// ─── Méthode et sources ───

function methodSection(input: CyberViewInput): FicheSection {
  const { cyber: c, cyberError, now, open } = input;
  const missing = c === null && cyberError === null ? 'chargement…' : 'source indisponible';
  const state = (iso: string | null | undefined): string => {
    const at = atText(iso, now);
    return at === null ? missing : `lu ${at}`;
  };
  const ransom = c?.ransomware ?? null;
  const ransomState = ransom === null ? missing : `fichier publié ${atText(ransom.lastModified, now) ?? 'sans date de modification'}`;
  const html = kvRow('Alertes et avis', `${sourceLinkHtml('CERT-FR (ANSSI)', CERTFR_URL)} · ${escapeHtml(`Licence ouverte 2.0 · ${state(c?.certfr.readAt)}`)}`)
    + kvRow('Rapports de l’ANSSI', `${sourceLinkHtml('flux Menaces et incidents', CERTFR_CTI_URL)} · ${escapeHtml(`Licence ouverte 2.0 · ${state(c?.certfr.readAt)}`)}`)
    + kvRow('Vulnérabilités exploitées', `${sourceLinkHtml('catalogue KEV de la CISA', KEV_URL)} · ${escapeHtml(`domaine public · ${state(c?.kev.readAt)}`)}`)
    + kvRow('Revendications', `${sourceLinkHtml('Ransomware.live', RANSOMWARE_URL)} · ${escapeHtml('usage non commercial, attribution (')}`
      + `${sourceLinkHtml('conditions d’utilisation', RANSOMWARE_TERMS_URL)}${escapeHtml(`) · ${ransomState}`)}`)
    + kvRow('Fuites publiées', `${sourceLinkHtml('Have I Been Pwned', HIBP_URL)} · ${escapeHtml(`CC BY 4.0 · ${state(c?.hibp?.readAt)}`)}`)
    + kvRow('Alertes grand public', `${sourceLinkHtml('Cybermalveillance.gouv.fr', CYBERMALVEILLANCE_URL)} · ${escapeHtml(state(c?.cybermalveillance?.readAt))}`)
    + note('Définitions du CERT-FR. Les alertes de sécurité sont des documents destinés à prévenir d’un danger immédiat. '
      + 'Les avis de sécurité sont des documents faisant état de vulnérabilités et des moyens de s’en prémunir.')
    + note('Statut repris tel quel de la page liste des alertes du CERT-FR (« Alerte en cours », « Clôturée le … »), sinon de la page de l’alerte '
      + '(« Clôture de l’alerte ») ; un statut que la lecture n’a pas trouvé reste « statut non lu », jamais supposé.')
    + note('Pastille : rouge si deux alertes CERT-FR en cours ont été publiées depuis moins de 7 jours ; orange si une alerte en cours a été publiée '
      + 'depuis moins de 7 jours ; jaune si une alerte en cours a été publiée il y a 7 jours ou plus, si un avis de moins de 7 jours cite une '
      + 'vulnérabilité du catalogue KEV, ou si les revendications de la semaine dépassent 1,5 fois la moyenne (jaune au plus : une revendication '
      + 'n’est pas confirmée) ; vert sinon ; n.d. si le CERT-FR est en panne ou en retard, ou si le statut d’une alerte récente n’a pas été lu.')
    + note('Retard : CERT-FR lu il y a plus de 6 heures, catalogue KEV il y a plus de 26 heures, fichier de ransomware.live publié il y a plus de '
      + '24 heures, liste de Have I Been Pwned lue il y a plus de 26 heures, flux de Cybermalveillance.gouv.fr lus il y a plus de 6 heures.')
    + note('Carte : aucune de ces sources ne publie de lieu ; la couche ne dessine rien (légende : « pas de lieu publié : voir le panneau »).')
    + note('Retirés : exposition Shodan et Censys, FrenchBreaches, fuites de plus de 30 jours, titres et domaines des fuites, CVE mondiales hors catalogue KEV.')
    + readErrors(c !== null ? c.errors.map(glueSovUnits) : []);
  return { id: 'methode', title: 'Méthode et sources', collapsible: true, open: open('methode', false), tone: 'reference', html, summary: summaryText('5 sources') };
}

// ─── Assemblage ───

export function buildCyberView(input: CyberViewInput): LayerView {
  const { cyber: c, cyberError, now, open } = input;
  if (c === null && cyberError === null) {
    return { head: { theme: SOVEREIGNTY_THEME, title: CYBER_TITLE, status: ['chargement…'] }, sections: [], bodyHtml: loadingBody() };
  }
  if (c === null) {
    const down = (id: string, title: string, html: string): FicheSection => ({ id, title, collapsible: true, open: open(id, false), summary: 'n.d.', html });
    return {
      head: {
        theme: SOVEREIGNTY_THEME, title: CYBER_TITLE, level: 'nd',
        figure: { value: 'n.d.', caption: 'alertes CERT-FR en cours : sources cyber injoignables', level: null }, status: ['sources cyber injoignables'],
      },
      sections: [
        down('certfr', 'Alertes et avis CERT-FR', sourceDown(CERTFR_NAME) + incidentLine()),
        down('kev', 'Vulnérabilités exploitées (catalogue KEV de la CISA)', sourceDown(KEV_NAME)),
        down('revendications', 'Revendications de rançongiciels en France', sourceDown(CLAIMS_NAME)),
        methodSection(input),
      ],
      bodyHtml: sourceErrorCallout(null, now),
    };
  }
  const sections = [
    certfrSection(c, now, open), kevSection(c, now, open), claimsSection(c, now, open), reportsSection(c, now, open), leaksSection(c, now, open),
    cybermalveillanceSection(c, now, open), methodSection(input),
  ];
  return { head: headOf(c, now), sections, bodyHtml: cyberError !== null ? sourceErrorCallout(dataMs(c.readAt), now) : undefined };
}
