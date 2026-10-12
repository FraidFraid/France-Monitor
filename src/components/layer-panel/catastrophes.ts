// src/components/layer-panel/catastrophes.ts : vue pure du panneau Catastrophes (GDACS) (spec 2026-10-12 GDACS) ; aucun accès réseau
// ni DOM. Bloc 1 : alertes sur le territoire français (tous niveaux) ; bloc 2 : alertes orange et rouges du monde, en contexte.
// Relevé du serveur daté (S1), en retard au-delà de 30 min (S2).
import type { DisasterAlert, DisasterLevel, DisastersResponse } from '../../types/index.ts';
import { isEnvironmentDataLate } from '../../services/environment-levels.ts';
import type { VigilanceLevel } from '../../services/vigilance.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { kvRow } from '../fiche/kit.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { emptyLine, listRow, loadingBody, sourceErrorCallout, sourceLinkHtml, type LayerView } from './frame.ts';
import { NBSP } from './format.ts';
import { ENVIRONMENT_THEME, note, plural, readErrors, shortDate, stamp } from './environment-format.ts';
import { DISASTER_TYPE_LABEL } from './environment-legend.ts';

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

function row(x: DisasterAlert, canFocus: boolean, now: number, where: string): string {
  return listRow({
    text: `${DISASTER_TYPE_LABEL[x.type]} · ${where}`, value: `Alerte ${x.level}`,
    level: x.frenchTerritory !== null ? level(x.level) : 'gris',
    note: [x.name, period(x, now), x.severity].filter((s): s is string => s !== null && s !== '').join(' · '),
    data: { disaster: x.id }, link: canFocus,
  });
}

function franceSection(d: DisastersResponse | null, canFocus: boolean, now: number, open: OpenFn): FicheSection {
  const list = (d?.alerts ?? []).filter((x) => x.frenchTerritory !== null);
  const html = d === null ? emptyLine('Source indisponible : GDACS.')
    : list.length === 0 ? emptyLine('Aucune alerte GDACS sur le territoire français ces 7 derniers jours.')
    : list.map((x) => row(x, canFocus, now, x.frenchTerritory ?? 'n.d.')).join('');
  return { id: 'france', title: 'Territoire français', collapsible: true, open: open('france', true), summary: plural(list.length, 'alerte'), html };
}

function worldSection(d: DisastersResponse | null, canFocus: boolean, now: number, open: OpenFn): FicheSection {
  const list = (d?.alerts ?? []).filter((x) => x.frenchTerritory === null);
  const shown = list.slice(0, MAX_WORLD_ROWS);
  const html = d === null ? emptyLine('Source indisponible : GDACS.')
    : list.length === 0 ? emptyLine('Aucune alerte orange ou rouge dans le monde ces 7 derniers jours.')
    : shown.map((x) => row(x, canFocus, now, x.countries.length > 1 ? `${x.countries.length} pays` : (x.countries[0] ?? 'n.d.'))).join('')
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
  const sections = [franceSection(d, canFocus, now, open), worldSection(d, canFocus, now, open), methodSection(d, late, now, open)];
  if (d === null || d.readAt === null) {
    return {
      head: {
        theme: ENVIRONMENT_THEME, title: CATASTROPHES_TITLE, level: 'nd',
        figure: { value: 'n.d.', caption: 'alertes GDACS sur le territoire français', level: null }, status: ['GDACS injoignable'],
      },
      sections, bodyHtml: sourceErrorCallout(null, now),
    };
  }
  const french = d.alerts.filter((x) => x.frenchTerritory !== null);
  const top = french.reduce<DisasterLevel>((m, x) => (RANK[x.level] > RANK[m] ? x.level : m), 'vert');
  const readMs = Date.parse(d.readAt);
  return {
    head: {
      theme: ENVIRONMENT_THEME, title: CATASTROPHES_TITLE,
      figure: { value: String(french.length), caption: 'alertes GDACS sur le territoire français, 7 derniers jours', level: late ? null : level(top) },
      level: late ? 'nd' : level(top),
      status: [stamp('relevé GDACS', d.readAt, late, now)],
    },
    sections,
    bodyHtml: disastersError !== null ? sourceErrorCallout(Number.isFinite(readMs) ? readMs : null, now) : undefined,
  };
}
