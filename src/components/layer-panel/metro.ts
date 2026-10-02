// src/components/layer-panel/metro.ts : vue pure du panneau Charge métropolitaine (spec lot 2 § 3.5) ; aucun accès réseau ni DOM.
import type { MetropoleConsumption } from '../../services/metropoles.ts';
import type { VigilanceLevel } from '../../services/vigilance.ts';
import { classifyMetropoles, METRO_LEVEL, type MetropoleDisplayData } from '../../utils/metropolesElectric.ts';
import { absoluteTime } from '../fiche/kit.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { NBSP, formatGw, formatMw, formatPct, formatSignedPct } from './format.ts';
import { barRow, emptyLine, freshnessSegment, listRow, loadingBody, sourceLinkHtml, valueHtml, type LayerView } from './frame.ts';

export interface MetroViewInput {
  metros: MetropoleConsumption[] | null;
  nationalMw: number | null;
  now: number;
  open: (sectionId: string, byDefault: boolean) => boolean;
}

const THEME = 'Énergie';
const TITLE = 'Charge métropolitaine';
const SOURCE = 'ODRÉ éCO2mix métropoles';
const SOURCE_URL = 'https://odre.opendatasoft.com/explore/dataset/eco2mix-metropoles-tr/';
/** Publication toutes les heures : au-delà de deux périodes, la donnée est dite en retard. */
const PERIOD_MS = 60 * 60_000;
const TOP_DELTAS = 3;
const DELTA_THRESHOLD = 0.2;

/** Écart à la veille : hausse orange, baisse verte, moins de 0,2 % neutre. */
export function metroDeltaLevel(pct: number | undefined): VigilanceLevel | null {
  if (pct === undefined || !Number.isFinite(pct)) return null;
  if (pct >= DELTA_THRESHOLD) return 'orange';
  if (pct <= -DELTA_THRESHOLD) return 'vert';
  return null;
}

function sourcesSection(heure: number | null, now: number, open: MetroViewInput['open']): FicheSection {
  const stamp = heure !== null ? `données de ${absoluteTime(heure, now, 'fr')}` : 'aucune donnée reçue';
  const html = `<p class="fmk-note">Publication en retard possible d’une heure ; écart calculé sur la même heure la veille, à 30 minutes près. `
    + `Part nationale rapportée à la consommation nationale éCO2mix. `
    + `Classes de charge relatives au maximum observé : forte au-delà de 60${NBSP}%, moyenne de 20${NBSP}à 60${NBSP}%, faible en dessous.</p>`
    + `<div class="fmk-kv"><span class="fmk-kv-k">${sourceLinkHtml(SOURCE, SOURCE_URL)}</span><span class="fmk-kv-v">${stamp}</span></div>`;
  return { id: 'sources', title: 'Sources', collapsible: true, open: open('sources', false), tone: 'reference', summary: `ODRÉ · retard possible d’1${NBSP}h`, html };
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
  const { metros, nationalMw, now, open } = input;
  if (metros === null) return { head: { theme: THEME, title: TITLE, status: ['chargement…'] }, sections: [], bodyHtml: loadingBody() };
  if (metros.length === 0) {
    return {
      head: { theme: THEME, title: TITLE, status: [SOURCE] },
      sections: [sourcesSection(null, now, open)],
      bodyHtml: emptyLine('Aucune donnée métropolitaine reçue.'),
    };
  }
  const rows = classifyMetropoles(metros, nationalMw ?? undefined).sort((a, b) => b.loadMW - a.loadMW);
  const n = rows.length;
  const sum = rows.reduce((acc, r) => acc + r.loadMW, 0);
  const heure = Math.max(...rows.map((r) => Date.parse(r.date_heure)).filter(Number.isFinite));
  const hasHeure = Number.isFinite(heure);
  const first = rows[0];
  const rise = rows.filter((r) => (r.deltaVsJ1Pct ?? 0) > 0).sort((a, b) => (b.deltaVsJ1Pct ?? 0) - (a.deltaVsJ1Pct ?? 0))[0];
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
      figure: { value: formatGw(sum), caption: nationalMw ? `${n} métropoles · ${formatPct((sum / nationalMw) * 100)} de la consommation nationale` : `${n} métropoles` },
      status: [hasHeure ? freshnessSegment(heure, now, PERIOD_MS) : '', SOURCE].filter((s) => s !== ''),
      lead,
    },
    sections: [metrosSection, deltaSection(rows, open), sourcesSection(hasHeure ? heure : null, now, open)],
  };
}
