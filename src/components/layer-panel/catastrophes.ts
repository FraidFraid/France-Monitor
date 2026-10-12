// src/components/layer-panel/catastrophes.ts : vue pure du panneau Catastrophes (GDACS) (spec 2026-10-12 GDACS) ; aucun accès réseau
// ni DOM. Bloc 1 : alertes sur le territoire français (tous niveaux) ; bloc 2 (s'il y a lieu) : contexte européen touchant la métropole ;
// bloc 3 : alertes orange et rouges du monde. Textes GDACS traduits (disasters-format.ts).
// Relevé du serveur daté (S1), en retard au-delà de 30 min (S2).
import type { DisasterAlert, DisasterLevel, DisastersResponse } from '../../types/index.ts';
import { frenchName, frenchSeverity, isEuropeanContext } from '../../services/disasters-format.ts';
import { isEnvironmentDataLate } from '../../services/environment-levels.ts';
import type { VigilanceLevel } from '../../services/vigilance.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { kvRow } from '../fiche/kit.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { emptyLine, listRow, loadingBody, sourceErrorCallout, sourceLinkHtml, type LayerView } from './frame.ts';
import { NBSP } from './format.ts';
import { ENVIRONMENT_THEME, note, plural, readErrors, shortDate, stamp } from './environment-format.ts';
import { ALERT_WORD, DISASTER_TYPE_LABEL } from './environment-legend.ts';

export const CATASTROPHES_TITLE = 'Catastrophes (GDACS)';
type OpenFn = (sectionId: string, byDefault: boolean) => boolean;
export interface CatastrophesViewInput { disasters: DisastersResponse | null; disastersError: string | null; canFocus: boolean; now: number; open: OpenFn }

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

function methodSection(d: DisastersResponse | null, late: boolean, now: number, open: OpenFn): FicheSection {
  const state = d === null || d.readAt === null ? 'injoignable' : stamp('relevé', d.readAt, late, now);
  const html = kvRow('GDACS', `${sourceLinkHtml('GDACS', GDACS_URL)} · ${escapeHtml(state)}`)
    + note('Système mondial d’alerte et de coordination en cas de catastrophe (ONU, Commission européenne). Niveaux calculés par modèle selon l’aléa et l’exposition : ce n’est pas une vigilance officielle française.')
    + note(`Territoire français : métropole, départements et collectivités d’outre-mer, tous niveaux. Monde : alertes orange et rouges seulement. Relève toutes les 10${NBSP}min.`)
    + readErrors(d?.errors ?? []);
  return { id: 'methode', title: 'Méthode et sources', collapsible: true, open: open('methode', false), tone: 'reference', summary: 'GDACS', html };
}

export function buildCatastrophesView(input: CatastrophesViewInput): LayerView {
  const { disasters: d, disastersError, canFocus, now, open } = input;
  if (d === null && disastersError === null) {
    return { head: { theme: ENVIRONMENT_THEME, title: CATASTROPHES_TITLE, status: ['chargement…'] }, sections: [], bodyHtml: loadingBody() };
  }
  const late = d !== null && isEnvironmentDataLate('gdacs', d.readAt, now);
  const context = contextSection(d, late, canFocus, now, open);
  const sections = [franceSection(d, late, canFocus, now, open), ...(context ? [context] : []), worldSection(d, late, canFocus, now, open), methodSection(d, late, now, open)];
  if (d === null || d.readAt === null) {
    return {
      head: {
        theme: ENVIRONMENT_THEME, title: CATASTROPHES_TITLE, level: 'nd',
        figure: { value: 'n.d.', caption: 'alertes GDACS sur le territoire français', level: null }, status: ['GDACS injoignable'],
      },
      sections, bodyHtml: sourceErrorCallout(null, now),
    };
  }
  const french = d.alerts.filter(isFrench);
  const top = french.reduce<DisasterLevel>((m, x) => (RANK[x.level] > RANK[m] ? x.level : m), 'vert');
  const readMs = Date.parse(d.readAt);
  return {
    head: {
      theme: ENVIRONMENT_THEME, title: CATASTROPHES_TITLE,
      figure: { value: String(french.length), caption: `alertes GDACS sur le territoire français, 7${NBSP}derniers jours`, level: late ? null : level(top) },
      level: late ? 'nd' : level(top),
      status: [stamp('relevé GDACS', d.readAt, late, now)],
    },
    sections,
    bodyHtml: disastersError !== null ? sourceErrorCallout(Number.isFinite(readMs) ? readMs : null, now) : undefined,
  };
}
