// src/components/layer-panel/submersion.ts : section « Submersion marine » du panneau Vigilance météo (spec 2026-10-04 environnement
// § 3.4) ; pure, sans réseau ni DOM. Domaines littoraux « XX10 » de la vigilance vagues-submersion (couleur, créneaux) et, par
// marégraphe du SHOM (liste fixe de 19 ports), dernière hauteur observée, variation sur 1 h, heure et courbe de 24 h (E5). Aucun écart
// à la marée prédite : le SHOM ne la publie qu'avec une clé (S4).
import type { OfficialColorId, SeaLevelsResponse, TideGauge, VigilanceCoastDomain, VigilancePeriod } from '../../types/index.ts';
import { isEnvironmentDataLate } from '../../services/environment-levels.ts';
import type { VigilanceLevel } from '../../services/vigilance.ts';
import { escapeHtml } from '../france-intel-events.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { lineChart, type ChartPoint } from './chart.ts';
import { NBSP } from './format.ts';
import { emptyLine, listRow } from './frame.ts';
import { CAT_PORT } from './traffic-format.ts';
import { COLOR_LEVEL, COLOR_WORD, clockOf, formatChangeM, formatHeightM, note, plural, readErrors, slotText, sourceDown } from './environment-format.ts';

export interface SubmersionInput {
  period: VigilancePeriod | null;
  seaLevels: SeaLevelsResponse | null;
  seaLevelsError: string | null;
  /** La carte peut recentrer (carte WebGL) ; sinon les lignes ne se donnent pas pour cliquables. */
  canFocus: boolean;
  now: number;
  /** Carte de vigilance en retard (S2) : couleurs des domaines retirées, « (en retard) » dit. */
  late?: boolean;
}
type OpenFn = (sectionId: string, byDefault: boolean) => boolean;

const PANEL_ID = 'environmental';
const DAY_MS = 86_400_000;
const GAP_MS = 30 * 60_000;
const SHOM_URL = 'https://data.shom.fr/donnees/refmar';

function domainOf(period: VigilancePeriod | null, code: string): VigilanceCoastDomain | null {
  return period?.coast.find((d) => d.code === code) ?? null;
}

function gaugeLate(g: TideGauge, now: number): boolean {
  return isEnvironmentDataLate('refmar', g.lastAt, now);
}

// ─── Domaines littoraux ───

function coastHtml(period: VigilancePeriod | null, now: number, late: boolean): string {
  if (!period) return sourceDown('carte de vigilance Météo-France (domaines littoraux)');
  const alert = period.coast.filter((d) => d.color >= 2).sort((a, b) => b.color - a.color || a.name.localeCompare(b.name, 'fr'));
  const green = period.coast.length - alert.length;
  if (alert.length === 0) return note(`Les ${period.coast.length} domaines littoraux sont en vert (vagues-submersion).`);
  const rows = alert.map((d) => {
    const slots = d.slots.filter((s) => s.color >= 2);
    return listRow({
    text: d.name, value: COLOR_WORD[d.color], level: late ? 'gris' : COLOR_LEVEL[d.color],
    note: slots.length > 0 ? slots.map((s) => slotText(s, now)).join(' · ') : 'toute l’échéance',
    });
  }).join('');
  return (late ? note('Carte de vigilance en retard : couleurs retirées.') : '') + rows + (green > 0 ? note(`${plural(green, 'autre domaine littoral', 'autres domaines littoraux')} en vert.`) : '');
}

// ─── Marégraphes ───

function gaugeRow(g: TideGauge, domain: VigilanceCoastDomain | null, canFocus: boolean, now: number, mapLate: boolean): string {
  const late = gaugeLate(g, now);
  const domainName = domain?.name ?? `domaine ${g.coastDomain}`;
  const level: VigilanceLevel | 'gris' = late || mapLate || g.lastAt === null ? 'gris' : COLOR_LEVEL[domain?.color ?? 1];
  const noteText = g.lastAt === null
    ? `aucune mesure lue · ${domainName}`
    : `${formatChangeM(g.change1hM)} en 1${NBSP}h · mesure ${clockOf(g.lastAt, now)}${late ? ' (en retard)' : ''} · ${domainName}`;
  return listRow({
    text: g.name, value: formatHeightM(g.heightM), level, note: noteText,
    ...(canFocus ? { data: { gauge: String(g.id) }, link: true } : {}),
  });
}

/** Graduation de la courbe : heure de Paris ; `clockOf` y ajoute déjà le jour (« 03/10 22:00 ») quand elle n'est pas d'aujourd'hui (E5). */
function tickOf(ms: number, now: number): string {
  return clockOf(new Date(ms).toISOString(), now);
}

function gaugeCurve(g: TideGauge, domainColor: OfficialColorId, now: number, open: OpenFn): string {
  const points: ChartPoint[] = g.series.flatMap((p) => {
    const at = Date.parse(p.at);
    return Number.isFinite(at) ? [{ at, value: p.value }] : [];
  });
  const last = g.lastAt !== null ? Date.parse(g.lastAt) : Number.NaN;
  if (points.length < 2 || !Number.isFinite(last)) return '';
  const late = gaugeLate(g, now);
  const chart = lineChart(points, {
    label: `Hauteur d’eau à ${g.name}, 24 dernières heures`, from: last - DAY_MS, to: last, stroke: late ? 'var(--text-primary)' : CAT_PORT, gapMs: GAP_MS,
    value: (v) => formatHeightM(v), tick: (ms) => tickOf(ms, now), nowAt: null,
  });
  if (chart === '') return '';
  const key = `maregraphe-${g.id}`;
  const isOpen = open(key, domainColor >= 2);
  return `<details class="lp-sub" data-section="${escapeHtml(`layer:${PANEL_ID}:${key}`)}"${isOpen ? ' open' : ''}>`
    + `<summary>${escapeHtml(`Hauteur d’eau sur 24${NBSP}h, ${g.name}`)}</summary>${chart}</details>`;
}

function gaugesHtml(input: SubmersionInput, open: OpenFn): string {
  const { period, seaLevels, seaLevelsError, canFocus, now } = input;
  const mapLate = input.late === true;
  if (!seaLevels) return seaLevelsError !== null ? sourceDown('marégraphes SHOM') : emptyLine('Chargement des marégraphes…');
  const stale = seaLevelsError !== null ? note(`Dernière lecture des marégraphes en échec (${seaLevelsError}) : mesures de la lecture précédente.`) : '';
  if (seaLevels.gauges.length === 0) return sourceDown('marégraphes SHOM');
  const rows = seaLevels.gauges.map((g) => gaugeRow(g, domainOf(period, g.coastDomain), canFocus, now, mapLate)).join('');
  const curves = seaLevels.gauges.map((g) => gaugeCurve(g, mapLate ? 1 : domainOf(period, g.coastDomain)?.color ?? 1, now, open)).join('');
  return `<h4 class="fmk-eyebrow">Marégraphes</h4>${stale}${rows}${curves}`;
}

export function submersionSection(input: SubmersionInput, open: OpenFn): FicheSection {
  const { period, seaLevels, now } = input;
  const late = input.late === true;
  const alert = period?.coast.filter((d) => d.color >= 2) ?? [];
  const top = alert.reduce<OfficialColorId>((m, d) => (d.color > m ? d.color : m), 1);
  const coastSummary = !period ? 'domaines n.d.'
    : alert.length === 0 ? `${period.coast.length} domaines en vert`
      : late ? `${plural(alert.length, 'domaine')} (en retard)`
        : `${plural(alert.filter((d) => d.color === top).length, 'domaine')} en ${COLOR_WORD[top]}`;
  const measured = seaLevels?.gauges.some((g) => g.lastAt !== null) ?? false;
  const gauges = !seaLevels ? 'marégraphes n.d.' : measured ? plural(seaLevels.gauges.length, 'marégraphe') : 'aucune mesure';
  const html = coastHtml(period, now, late) + gaugesHtml(input, open)
    + note('Hauteur d’eau observée au-dessus du zéro hydrographique, marée comprise ; l’écart à la marée prédite n’est pas affiché : le SHOM ne publie la prédiction qu’avec une clé.')
    + note(`Marégraphes REFMAR du SHOM (19 ports sensibles, liste fixe), une mesure par minute ; courbe : une valeur toutes les 10${NBSP}min, un trou de mesure reste un trou ; en retard au-delà de 30${NBSP}min.`)
    + `<p class="fmk-note"><a class="lp-link" href="${SHOM_URL}" target="_blank" rel="noopener noreferrer">Données REFMAR (SHOM)</a></p>`
    + readErrors(seaLevels?.errors ?? []);
  return {
    id: 'submersion', title: 'Submersion marine', collapsible: true, open: open('submersion', alert.length > 0),
    summary: escapeHtml(`${coastSummary} · ${gauges}`), html,
  };
}
