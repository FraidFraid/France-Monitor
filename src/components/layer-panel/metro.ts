// src/components/layer-panel/metro.ts : vue pure du panneau Charge métropolitaine (spec lot 2 § 3.5) ; aucun accès réseau ni DOM.
import type { MetropoleConsumption } from '../../services/metropoles.ts';
import type { VigilanceLevel } from '../../services/vigilance.ts';
import { classifyMetropoles, METRO_LEVEL, type MetropoleDisplayData } from '../../utils/metropolesElectric.ts';
import { absoluteTime } from '../fiche/kit.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { NBSP, formatGw, formatMw, formatPct, formatSignedPct } from './format.ts';
import { barRow, emptyLine, listRow, loadingBody, sourceLinkHtml, valueHtml, type LayerView } from './frame.ts';

export interface MetroViewInput {
  metros: MetropoleConsumption[] | null;
  now: number;
  open: (sectionId: string, byDefault: boolean) => boolean;
}

const THEME = 'Énergie';
const TITLE = 'Charge métropolitaine';
const SOURCE = 'ODRÉ éCO2mix métropoles';
const SOURCE_URL = 'https://odre.opendatasoft.com/explore/dataset/eco2mix-metropoles-tr/';
/** ODRÉ publie un lot par jour (dernier point vers 00:00 UTC, publié vers 00:25 UTC) : la donnée a donc jusqu'à ~25 h normalement, en retard au-delà de 30 h. */
export const LATE_MS = 30 * 60 * 60_000;
const FIGURE_THRESHOLD = 5;
const TOP_DELTAS = 3;
const DELTA_THRESHOLD = 0.2;

/** Écart à la veille : hausse orange, baisse verte, moins de 0,2 % neutre. */
export function metroDeltaLevel(pct: number | undefined): VigilanceLevel | null {
  if (pct === undefined || !Number.isFinite(pct)) return null;
  if (pct >= DELTA_THRESHOLD) return 'orange';
  if (pct <= -DELTA_THRESHOLD) return 'vert';
  return null;
}

/** Couleur du chiffre : écart de la charge totale à la veille (même heure de donnée par métropole) ; null si J-1 manque ou donnée en retard. */
export function metroFigureLevel(rows: Array<{ loadMW: number; deltaVsJ1Pct?: number }>, late: boolean): VigilanceLevel | null {
  if (late) return null;
  let now = 0;
  let j1 = 0;
  for (const r of rows) {
    if (r.deltaVsJ1Pct === undefined || !Number.isFinite(r.deltaVsJ1Pct) || r.deltaVsJ1Pct <= -100) continue;
    now += r.loadMW;
    j1 += r.loadMW / (1 + r.deltaVsJ1Pct / 100);
  }
  if (j1 <= 0) return null;
  const pct = (now / j1 - 1) * 100;
  // Hausse marquée sur la veille : orange ; charge stable ou en baisse : vert (état normal, comme les autres panneaux).
  return pct >= FIGURE_THRESHOLD ? 'orange' : 'vert';
}

function sourcesSection(heure: number | null, now: number, open: MetroViewInput['open']): FicheSection {
  const stamp = heure !== null ? `données de ${absoluteTime(heure, now, 'fr')}` : 'aucune donnée reçue';
  const html = `<p class="fmk-note">Publication par lot quotidien : la donnée a jusqu’à 25${NBSP}h, en retard au-delà de 30${NBSP}h ; écart calculé sur la même heure de donnée la veille. `
    + `Couleur du chiffre : écart de la charge totale à la veille, même heure : orange dès +5${NBSP}% de hausse, vert sinon. `
    + `Part nationale rapportée à la consommation nationale éCO2mix. `
    + `Classes de charge relatives au maximum observé : forte au-delà de 60${NBSP}%, moyenne de 20${NBSP}à 60${NBSP}%, faible en dessous.</p>`
    + `<div class="fmk-kv"><span class="fmk-kv-k">${sourceLinkHtml(SOURCE, SOURCE_URL)}</span><span class="fmk-kv-v">${stamp}</span></div>`;
  return { id: 'sources', title: 'Sources', collapsible: true, open: open('sources', false), tone: 'reference', summary: `ODRÉ · lot quotidien, retard au-delà de 30${NBSP}h`, html };
}

function deltaSection(rows: MetropoleDisplayData[], open: MetroViewInput['open']): FicheSection {
  const withDelta = rows.filter((r) => r.deltaVsJ1Pct !== undefined);
  const row = (r: MetropoleDisplayData): string =>
    listRow({ text: r.name, valueHtml: valueHtml(formatSignedPct(r.deltaVsJ1Pct, 1), metroDeltaLevel(r.deltaVsJ1Pct)) });
  const rises = withDelta.filter((r) => (r.deltaVsJ1Pct ?? 0) > 0).sort((a, b) => (b.deltaVsJ1Pct ?? 0) - (a.deltaVsJ1Pct ?? 0)).slice(0, TOP_DELTAS);
  const falls = withDelta.filter((r) => (r.deltaVsJ1Pct ?? 0) < 0).sort((a, b) => (a.deltaVsJ1Pct ?? 0) - (b.deltaVsJ1Pct ?? 0)).slice(0, TOP_DELTAS);
  let html = '';
  if (withDelta.length === 0) html = emptyLine('Écart à la veille indisponible : données de la veille non publiées.');
  else {
    if (rises.length > 0) html += `<h4 class="fmk-eyebrow">Plus fortes hausses</h4>${rises.map(row).join('')}`;
    if (falls.length > 0) html += `<h4 class="fmk-eyebrow">Plus fortes baisses</h4>${falls.map(row).join('')}`;
  }
  return { id: 'delta', title: 'Écart à la veille', collapsible: true, open: open('delta', true), summary: 'même heure, la veille', html };
}

export function buildMetroView(input: MetroViewInput): LayerView {
  const { metros, now, open } = input;
  if (metros === null) return { head: { theme: THEME, title: TITLE, status: ['chargement…'] }, sections: [], bodyHtml: loadingBody() };
  if (metros.length === 0) {
    return {
      head: { theme: THEME, title: TITLE, status: [SOURCE] },
      sections: [sourcesSection(null, now, open)],
      bodyHtml: emptyLine('Aucune donnée métropolitaine reçue.'),
    };
  }
  const rows = classifyMetropoles(metros).sort((a, b) => b.loadMW - a.loadMW);
  const n = rows.length;
  const sum = rows.reduce((acc, r) => acc + r.loadMW, 0);
  const heure = Math.max(...rows.map((r) => Date.parse(r.date_heure)).filter(Number.isFinite));
  const hasHeure = Number.isFinite(heure);
  const late = hasHeure && now - heure > LATE_MS;
  const first = rows[0];
  // Somme des parts de chaque métropole sur la consommation nationale de son propre instant ; incomplète, elle serait trompeuse : omise.
  const shares = rows.map((r) => (r.nationalMw && r.nationalMw > 0 ? (r.loadMW / r.nationalMw) * 100 : null));
  const totalShare = shares.every((x): x is number => x !== null) ? shares.reduce((acc, x) => acc + x, 0) : null;
  // « Plus forte hausse » seulement si la valeur affichée (arrondie) est positive.
  const rise = rows.filter((r) => Math.round(r.deltaVsJ1Pct ?? 0) > 0).sort((a, b) => (b.deltaVsJ1Pct ?? 0) - (a.deltaVsJ1Pct ?? 0))[0];
  const lead = `${first.name} ${formatGw(first.loadMW)}`
    + (first.deltaVsJ1Pct !== undefined ? ` (${formatSignedPct(first.deltaVsJ1Pct)} sur la veille à la même heure)` : '') + '.'
    + (rise ? ` Plus forte hausse : ${rise.name} (${formatSignedPct(rise.deltaVsJ1Pct)}).` : '');
  const metrosSection: FicheSection = {
    id: 'metros', title: 'Métropoles', collapsible: true, open: open('metros', true), summary: `${n} classées par charge`,
    html: rows.map((r) => barRow({
      label: r.name, pct: r.relativeLoad * 100, value: formatMw(r.loadMW), level: METRO_LEVEL[r.sizeClass],
      note: r.nationalSharePct !== undefined ? `${formatPct(r.nationalSharePct, 1)} de la consommation nationale` : null,
    })).join(''),
  };
  return {
    head: {
      theme: THEME, title: TITLE,
      figure: { value: formatGw(sum), level: metroFigureLevel(rows, late), caption: totalShare !== null ? `${n} métropoles · ${formatPct(totalShare, 1)} de la consommation nationale` : `${n} métropoles` },
      status: [hasHeure ? `données de ${absoluteTime(heure, now, 'fr')}${late ? ' (en retard)' : ''}` : '', SOURCE].filter((s) => s !== ''),
      lead,
    },
    sections: [metrosSection, deltaSection(rows, open), sourcesSection(hasHeure ? heure : null, now, open)],
  };
}
