// src/components/layer-panel/catastrophes.ts : vue pure du panneau Catastrophes (GDACS) (spec 2026-10-12 GDACS) ; aucun accès réseau
// ni DOM. Bloc 1 : alertes sur le territoire français (tous niveaux) ; bloc 2 (s'il y a lieu) : contexte européen touchant la métropole ;
// bloc 3 : alertes orange et rouges du monde. Textes GDACS traduits (disasters-format.ts).
// Relevé du serveur daté (S1), en retard au-delà de 30 min (S2).
import type { DisasterAlert, DisasterLevel, DisastersResponse, EmsActivation, EmsResponse } from '../../types/index.ts';
import { frenchName, frenchSeverity, isEuropeanContext } from '../../services/disasters-format.ts';
import { isEnvironmentDataLate } from '../../services/environment-levels.ts';
import type { VigilanceLevel } from '../../services/vigilance.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { kvRow } from '../fiche/kit.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { emptyLine, listRow, loadingBody, sourceErrorCallout, sourceLinkHtml, type LayerView } from './frame.ts';
import { NBSP, frNumber } from './format.ts';
import { ENVIRONMENT_THEME, note, plural, readErrors, shortDate, stamp } from './environment-format.ts';
import { ALERT_WORD, DISASTER_TYPE_LABEL, EMS_CATEGORY_LABEL } from './environment-legend.ts';

export const CATASTROPHES_TITLE = 'Catastrophes (GDACS)';
type OpenFn = (sectionId: string, byDefault: boolean) => boolean;
export interface CatastrophesViewInput {
  disasters: DisastersResponse | null; disastersError: string | null; canFocus: boolean; now: number; open: OpenFn;
  /** Copernicus EMS (spec 2026-10-12) ; absent : panneau GDACS seul. */
  ems?: EmsResponse | null; emsError?: string | null;
}

const GDACS_URL = 'https://www.gdacs.org/';
const MAX_WORLD_ROWS = 12;
const RANK: Readonly<Record<DisasterLevel, number>> = { vert: 1, orange: 2, rouge: 3 };
const level = (l: DisasterLevel): VigilanceLevel => l;

function period(x: DisasterAlert, now: number): string {
  return x.current ? `en cours depuis le ${shortDate(x.from, now)}` : `du ${shortDate(x.from, now)} au ${shortDate(x.to, now)}`;
}

/**
 * Ligne d'une alerte : libellés français (gravité, nom ; nom GDACS d'origine en infobulle) ; puce de niveau seulement pour une alerte
 * française à jour, grise sinon (monde, contexte européen, relevé en retard : S2) ; note avec le lien vers la fiche GDACS.
 */
function row(x: DisasterAlert, colored: boolean, late: boolean, canFocus: boolean, now: number, where: string): string {
  const name = frenchName(x);
  const parts = [name !== where ? name : null, period(x, now), frenchSeverity(x)].filter((s): s is string => s !== null && s !== '');
  const link = x.url ? ` · ${sourceLinkHtml('Fiche GDACS', x.url)}` : '';
  return listRow({
    text: `${DISASTER_TYPE_LABEL[x.type]} · ${where}`, value: ALERT_WORD[x.level],
    level: colored && !late ? level(x.level) : 'gris',
    noteHtml: `${escapeHtml(parts.join(' · '))}${link}`,
    title: x.name !== '' ? x.name : null,
    data: { disaster: x.id }, link: canFocus,
  });
}

/** Alerte du territoire français au sens strict : hors contexte européen (chiffre, couleur, bloc 1). */
const isFrench = (x: DisasterAlert): boolean => x.frenchTerritory !== null && !isEuropeanContext(x);
const countriesWhere = (x: DisasterAlert): string => x.countries.length > 1 ? `${x.countries.length} pays` : (x.countries[0] ?? 'n.d.');

const LATE_SUFFIX = ' (relevé en retard)';

function franceSection(d: DisastersResponse | null, late: boolean, canFocus: boolean, now: number, open: OpenFn): FicheSection {
  const list = (d?.alerts ?? []).filter(isFrench);
  const html = d === null ? emptyLine('Source indisponible : GDACS.')
    : list.length === 0 ? emptyLine(`Aucune alerte GDACS sur le territoire français ces 7${NBSP}derniers jours${late ? LATE_SUFFIX : ''}.`)
    : list.map((x) => row(x, true, late, canFocus, now, x.frenchTerritory ?? 'n.d.')).join('');
  return { id: 'france', title: 'Territoire français', collapsible: true, open: open('france', true), summary: plural(list.length, 'alerte'), html };
}

/** Bloc 2, seulement s'il y a lieu : événements centrés hors de France qui touchent la métropole (sécheresse d'Europe centrale). */
function contextSection(d: DisastersResponse | null, late: boolean, canFocus: boolean, now: number, open: OpenFn): FicheSection | null {
  const list = (d?.alerts ?? []).filter(isEuropeanContext);
  if (list.length === 0) return null;
  const html = list.map((x) => row(x, false, late, canFocus, now, frenchName(x) ?? countriesWhere(x))).join('')
    + note('Événements centrés hors de France dont l’emprise touche la métropole : hors du chiffre et de la couleur du panneau.');
  return { id: 'contexte', title: 'Contexte européen (touche la France)', collapsible: true, open: open('contexte', false), summary: plural(list.length, 'alerte'), html };
}

function worldSection(d: DisastersResponse | null, late: boolean, canFocus: boolean, now: number, open: OpenFn): FicheSection {
  const list = (d?.alerts ?? []).filter((x) => x.frenchTerritory === null);
  const shown = list.slice(0, MAX_WORLD_ROWS);
  const html = d === null ? emptyLine('Source indisponible : GDACS.')
    : list.length === 0 ? emptyLine(`Aucune alerte orange ou rouge dans le monde ces 7${NBSP}derniers jours${late ? LATE_SUFFIX : ''}.`)
    : shown.map((x) => row(x, false, late, canFocus, now, countriesWhere(x))).join('')
      + (list.length > shown.length ? note(`${list.length - shown.length} autres alertes non affichées.`) : '');
  return { id: 'monde', title: 'Monde (alertes orange et rouges)', collapsible: true, open: open('monde', false), summary: plural(list.length, 'alerte'), html };
}

/** « FL1102030 » → fiche GDACS (type et numéro) ; format inconnu : rien. */
function gdacsReportUrl(id: string): string | null {
  const m = /^([A-Z]{2})(\d+)$/.exec(id);
  return m ? `https://www.gdacs.org/report.aspx?eventtype=${m[1]}&eventid=${m[2]}` : null;
}

function emsRow(a: EmsActivation, active: boolean, now: number): string {
  const parts = [
    a.place !== a.territory ? a.place : null,
    a.code,
    `activée le ${shortDate(a.activationTime, now)}`,
    a.activator,
    a.products > 0 ? plural(a.products, 'carte').replace(' ', NBSP) : null,
    a.population !== null ? `${frNumber(a.population, 0)}${NBSP}hab. dans l’emprise` : null,
  ].filter((s): s is string => s !== null && s !== '');
  const gdacs = a.gdacsId ? gdacsReportUrl(a.gdacsId) : null;
  const links = sourceLinkHtml('Fiche Copernicus', a.url) + (gdacs ? ` · ${sourceLinkHtml('Fiche GDACS', gdacs)}` : '');
  return listRow({
    text: `${EMS_CATEGORY_LABEL[a.category]} · ${a.territory}`, value: active ? 'en cours' : 'close',
    level: active ? 'orange' : 'gris', noteHtml: `${escapeHtml(parts.join(' · '))} · ${links}`, title: a.name,
  });
}

/** Activations françaises comptées dans le chiffre du panneau : relevé EMS à jour seulement. */
function emsCounted(e: EmsResponse | null | undefined, now: number): EmsActivation[] {
  return e && e.readAt !== null && !isEnvironmentDataLate('ems', e.readAt, now) ? e.active : [];
}

function emsSections(e: EmsResponse | null, error: string | null, now: number, open: OpenFn): FicheSection[] {
  const late = e !== null && isEnvironmentDataLate('ems', e.readAt, now);
  const unavailable = e === null || e.readAt === null;
  const activeHtml = unavailable ? emptyLine('Source indisponible : Copernicus EMS.')
    : e.active.length === 0 ? emptyLine(`Aucune activation en cours sur le territoire français${late ? LATE_SUFFIX : ''}.`)
    : e.active.map((a) => emsRow(a, !late, now)).join('');
  const elsewhere = !unavailable && e.elsewhere.count > 0
    ? note(`${plural(e.elsewhere.count, 'activation')} en cours ailleurs : ${e.elsewhere.countries.join(', ')}.`) : '';
  const current: FicheSection = {
    id: 'ems', title: 'Cartographie d’urgence (Copernicus)', collapsible: true, open: open('ems', true),
    summary: unavailable ? 'n.d.' : plural(e.active.length, 'activation'), html: activeHtml + elsewhere,
  };
  const recent = unavailable ? [] : e.recent;
  const history: FicheSection = {
    id: 'ems-recent', title: '12 derniers mois (Copernicus)', collapsible: true, open: open('ems-recent', false),
    summary: plural(recent.length, 'activation'),
    html: recent.length === 0 ? emptyLine('Aucune activation sur le territoire français ces 12 derniers mois.') : recent.map((a) => emsRow(a, false, now)).join(''),
  };
  void error;
  return [current, history];
}

/** Ligne Copernicus EMS de la méthode (seulement quand la source est câblée) ; pannes nommées. */
function emsMethod(e: EmsResponse | null, now: number): string {
  const state = e === null || e.readAt === null ? 'injoignable' : stamp('relevé', e.readAt, isEnvironmentDataLate('ems', e.readAt, now), now);
  return kvRow('Copernicus EMS', `${sourceLinkHtml('Copernicus EMS', 'https://mapping.emergency.copernicus.eu/')} · ${escapeHtml(state)}`)
    + note('Copernicus EMS : cartographie satellite d’urgence de l’Union européenne, activée à la demande d’un État (en France, le COGIC). Zones tracées pour les activations en cours.')
    + readErrors(e?.errors ?? []);
}

function methodSection(d: DisastersResponse | null, late: boolean, now: number, open: OpenFn, e?: EmsResponse | null): FicheSection {
  const state = d === null || d.readAt === null ? 'injoignable' : stamp('relevé', d.readAt, late, now);
  const html = kvRow('GDACS', `${sourceLinkHtml('GDACS', GDACS_URL)} · ${escapeHtml(state)}`)
    + note('Système mondial d’alerte et de coordination en cas de catastrophe (ONU, Commission européenne). Niveaux calculés par modèle selon l’aléa et l’exposition : ce n’est pas une vigilance officielle française.')
    + note(`Territoire français : métropole, départements et collectivités d’outre-mer, tous niveaux. Monde : alertes orange et rouges seulement. Relève toutes les 10${NBSP}min.`)
    + readErrors(d?.errors ?? [])
    + (e === undefined ? '' : emsMethod(e, now));
  return { id: 'methode', title: 'Méthode et sources', collapsible: true, open: open('methode', false), tone: 'reference', summary: 'GDACS', html };
}

export function buildCatastrophesView(input: CatastrophesViewInput): LayerView {
  const { disasters: d, disastersError, canFocus, now, open } = input;
  if (d === null && disastersError === null) {
    return { head: { theme: ENVIRONMENT_THEME, title: CATASTROPHES_TITLE, status: ['chargement…'] }, sections: [], bodyHtml: loadingBody() };
  }
  const late = d !== null && isEnvironmentDataLate('gdacs', d.readAt, now);
  const context = contextSection(d, late, canFocus, now, open);
  const ems = input.ems !== undefined ? emsSections(input.ems, input.emsError ?? null, now, open) : [];
  const sections = [franceSection(d, late, canFocus, now, open), ...ems, ...(context ? [context] : []), worldSection(d, late, canFocus, now, open), methodSection(d, late, now, open, input.ems)];
  if (d === null || d.readAt === null) {
    return {
      head: {
        theme: ENVIRONMENT_THEME, title: CATASTROPHES_TITLE, level: 'nd',
        figure: { value: 'n.d.', caption: 'alertes GDACS sur le territoire français', level: null }, status: ['GDACS injoignable'],
      },
      sections, bodyHtml: sourceErrorCallout(null, now),
    };
  }
  const emsActive = emsCounted(input.ems, now);
  const french = d.alerts.filter(isFrench);
  const gdacsTop = french.reduce<DisasterLevel>((m, x) => (RANK[x.level] > RANK[m] ? x.level : m), 'vert');
  const top: DisasterLevel = emsActive.length > 0 && RANK.orange > RANK[gdacsTop] ? 'orange' : gdacsTop;
  const count = french.length + emsActive.length;
  const caption = input.ems !== undefined
    ? `alertes GDACS (7${NBSP}jours) et activations Copernicus en cours, territoire français`
    : `alertes GDACS sur le territoire français, 7${NBSP}derniers jours`;
  const readMs = Date.parse(d.readAt);
  return {
    head: {
      theme: ENVIRONMENT_THEME, title: CATASTROPHES_TITLE,
      figure: { value: String(count), caption, level: late ? null : level(top) },
      level: late ? 'nd' : level(top),
      status: [stamp('relevé GDACS', d.readAt, late, now)],
    },
    sections,
    bodyHtml: disastersError !== null ? sourceErrorCallout(Number.isFinite(readMs) ? readMs : null, now) : undefined,
  };
}
