// src/components/layer-panel/nuclear.ts : vue pure du panneau « Parc nucléaire » (spec 2026-10-02 § 6.1).
// Construit l'en-tête, les onglets et les sections du kit ; la coquille DOM est dans frame.ts. Aucun accès réseau ni DOM.
import type { EcowattResponse, NuclearRemitSignal, NuclearState } from '../../types/index.ts';
import { NUCLEAR_UNITS } from '../../config/infrastructure.ts';
import {
  activeOutages, availabilityLevel, fleetCalendar, fleetLevel, fleetSummary, plantRows, remitMatchWords, shortLabel, unitLabel,
  type OutageKind, type UnitOutage,
} from '../../services/nuclear-fleet.ts';
import type { VigilanceLevel } from '../../services/vigilance.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { absoluteTime, kvRow, levelDot, meterRow, type MeterRow } from '../fiche/kit.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { formatGw, formatPct } from './format.ts';
import { emptyLine, loadingBody, sourceErrorCallout, sourceLinkHtml, type LayerTab, type LayerView } from './frame.ts';

export type NuclearTab = 'overview' | 'calendar' | 'remit';
export const NUCLEAR_TABS: readonly NuclearTab[] = ['overview', 'calendar', 'remit'];

export interface NuclearViewInput {
  state: NuclearState | null;
  ecowatt: EcowattResponse | null;
  tab: NuclearTab;
  now: number;
  open: (sectionId: string, byDefault: boolean) => boolean;
}

const PARIS = 'Europe/Paris';
const MINUS = '−';
const TAB_LABELS: Record<NuclearTab, string> = { overview: 'Vue d’ensemble', calendar: 'Calendrier', remit: 'Signaux REMIT' };
const RTE_URL = 'https://www.services-rte.com/fr/visualisez-les-donnees-publiees-par-rte.html';
const ECO2MIX_URL = 'https://www.rte-france.com/eco2mix';
const MAX_OUTAGE_ROWS = 8;
const MAX_BAR_ROWS = 12;
const MAX_LIST_ROWS = 8;
const LATE_AFTER_MS = 30 * 60_000;

const KIND_WORDS: Record<OutageKind, string> = { fortuit: 'fortuit', reduit: 'puissance réduite', programme: 'programmé' };
const KIND_FILL: Record<OutageKind, string> = { fortuit: 'var(--sev-orange)', reduit: 'var(--sev-yellow)', programme: '#6e6e80' };

export function kindWord(kind: OutageKind): string {
  return KIND_WORDS[kind];
}

export function kindLevel(kind: OutageKind): 'orange' | 'jaune' | null {
  return kind === 'fortuit' ? 'orange' : kind === 'reduit' ? 'jaune' : null;
}

// ── Formats ───────────────────────────────────────────────────────────────────

/** « dd/mm » en Europe/Paris. */
function dm(ms: number): string {
  return new Date(ms).toLocaleDateString('fr-FR', { timeZone: PARIS, day: '2-digit', month: '2-digit' });
}

/** « dd/mm à hh:mm » en Europe/Paris. */
function dmAt(ms: number, now: number): string {
  const [date, clock] = absoluteTime(ms, now, 'fr', { withDate: true }).split(' ');
  return `${date} à ${clock}`;
}

function plural(n: number, one: string, many: string = `${one}s`): string {
  return n > 1 ? many : one;
}

function ratioPct(part: number | null, whole: number): number | null {
  return part === null || !(whole > 0) ? null : Math.round((part / whole) * 100);
}

/** Heure de lecture des indisponibilités RTE (serveur ou cache), à défaut celle de construction de l'état. */
function rteAt(state: NuclearState): number {
  return (state.rteFetchedAt ?? state.fetchedAt).getTime();
}

function remitAt(state: NuclearState): number {
  return (state.remitFetchedAt ?? state.fetchedAt).getTime();
}

// ── En-tête et onglets ────────────────────────────────────────────────────────

function tabsOf(state: NuclearState | null): LayerTab[] {
  const n = state?.unconfirmedSignals.length ?? 0;
  return NUCLEAR_TABS.map((id) => ({ id, label: TAB_LABELS[id], count: id === 'remit' && n > 0 ? n : null }));
}

// ── Vue d'ensemble ────────────────────────────────────────────────────────────

function outageRow(o: UnitOutage, now: number): string {
  const since = `depuis le ${dm(o.start)}`;
  const back = o.end !== null ? `retour prévu le ${dmAt(o.end, now)}` : 'fin non communiquée';
  return `<div class="lp-row">${levelDot(kindLevel(o.kind))}<span>${escapeHtml(unitLabel(o.unit))} · ${kindWord(o.kind)}</span>`
    + `<span class="fmk-num">${MINUS}${escapeHtml(formatGw(o.lostMw))}</span><small>${since} · ${back}</small></div>`;
}

function productionMw(ecowatt: EcowattResponse | null): number | null {
  const v = ecowatt?.grid?.mix.nuclear ?? ecowatt?.national.nuclear ?? null;
  return v !== null && Number.isFinite(v) && v > 0 ? v : null;
}

function productionSection(state: NuclearState, ecowatt: EcowattResponse | null, installed: number, available: number | null, open: NuclearViewInput['open']): FicheSection {
  const prod = productionMw(ecowatt);
  const share = available === null ? null : ratioPct(prod, available);
  const summary = prod === null ? 'n.d.' : `${formatGw(prod)}${share === null ? '' : ` · ${formatPct(share)} du disponible`}`;
  const meter = (label: string, mw: number | null, color: Pick<MeterRow, 'level' | 'color'>): string =>
    meterRow({ label, value: ratioPct(mw, installed), display: formatGw(mw), ...color });
  const availLevel = available !== null && installed > 0 ? availabilityLevel(available / installed) : null;
  let html = meter('Produit', prod, { level: null, color: 'var(--mix-nuclear)' })
    + meter('Disponible', available, { level: availLevel })
    + meter('Installé', installed, { level: null, color: 'color-mix(in srgb, var(--mix-nuclear) 35%, transparent)' });
  if (prod !== null && available !== null && prod < 0.8 * available) {
    html += '<p class="fmk-note">Le parc produit en dessous du disponible : modulation liée à la demande et aux exports, pas une indisponibilité.</p>';
  }
  if (state.stress?.gridTensionRisk) {
    html += '<p class="fmk-note">Le nucléaire fournit moins de 35 % de la production nationale.</p>';
  }
  return { id: 'production', title: 'Production', summary: escapeHtml(summary), collapsible: true, open: open('production', true), html };
}

function outagesSection(outages: UnitOutage[], now: number, open: NuclearViewInput['open']): FicheSection {
  const total = outages.reduce((s, o) => s + o.lostMw, 0);
  const summary = outages.length === 0 ? 'aucun' : `${outages.length} ${plural(outages.length, 'tranche')} · ${formatGw(total)}`;
  let html: string;
  if (outages.length === 0) html = emptyLine('Aucun arrêt en cours.');
  else {
    const rest = outages.slice(MAX_OUTAGE_ROWS);
    html = outages.slice(0, MAX_OUTAGE_ROWS).map((o) => outageRow(o, now)).join('');
    if (rest.length > 0) {
      const lost = rest.reduce((s, o) => s + o.lostMw, 0);
      html += `<details class="lp-more"><summary>${rest.length} ${plural(rest.length, 'autre arrêt', 'autres arrêts')} : ${escapeHtml(formatGw(lost))}</summary>`
        + rest.map((o) => outageRow(o, now)).join('') + '</details>';
    }
  }
  return { id: 'outages', title: 'Arrêts en cours', summary: escapeHtml(summary), collapsible: true, open: open('outages', true), html };
}

function sitesSection(outages: UnitOutage[], open: NuclearViewInput['open']): FicheSection {
  const rows = plantRows(NUCLEAR_UNITS, outages);
  const withOutage = rows.filter((r) => r.worst !== null).length;
  const html = rows.map((r) =>
    `<div class="lp-row" data-nuclear-plant="${escapeHtml(r.name)}">${levelDot(r.worst ? kindLevel(r.worst) : 'vert')}<span>${escapeHtml(r.name)}</span>`
    + `<span class="fmk-num">${r.unitsAvailable} / ${r.unitsTotal} ${plural(r.unitsTotal, 'tranche')} · ${escapeHtml(formatGw(r.availableMw))}</span></div>`).join('');
  return {
    id: 'sites', title: 'Sites', summary: escapeHtml(`${rows.length} sites · ${withOutage} avec arrêt`),
    collapsible: true, open: open('sites', false), html,
  };
}

function methodSection(state: NuclearState, now: number, open: NuclearViewInput['open']): FicheSection {
  const html = '<p class="fmk-note">Niveau du parc : puissance perdue en arrêts fortuits, vert sous 1\u00A0GW, jaune de 1 à 3\u00A0GW, orange de 3 à 6\u00A0GW, rouge au-delà. '
    + 'Les arrêts programmés ne colorent pas le niveau. '
    + 'Jauge « Disponible » : vert à partir de 85\u00A0% de la puissance installée, jaune de 70 à 85\u00A0%, orange de 55 à 70\u00A0%, rouge en dessous.</p>'
    + kvRow('Indisponibilités', `${sourceLinkHtml('RTE indisponibilités', RTE_URL)} · lu à ${escapeHtml(absoluteTime(rteAt(state), now, 'fr'))}`)
    + kvRow('Signaux précoces', escapeHtml('REMIT RTE IIP'))
    + kvRow('Production', sourceLinkHtml('ODRÉ éCO2mix', ECO2MIX_URL));
  return { id: 'method', title: 'Méthode et sources', collapsible: true, open: open('method', false), tone: 'reference', html };
}

// ── Calendrier ────────────────────────────────────────────────────────────────

function legendItem(kind: OutageKind | 'upcoming'): string {
  const style = kind === 'upcoming'
    ? 'background:none;border:1px dashed var(--text-secondary)'
    : `background:${KIND_FILL[kind]}`;
  const word = kind === 'upcoming' ? 'à venir' : kindWord(kind);
  return `<span class="lp-key"><i style="${style}"></i>${word}</span>`;
}

/** Liste plafonnée à 8 lignes, le reste résumé en « n autres ». */
function capped(lines: string[]): string {
  const shown = lines.slice(0, MAX_LIST_ROWS).join('');
  const rest = lines.length - MAX_LIST_ROWS;
  return rest > 0 ? `${shown}<p class="fmk-note">${rest} ${plural(rest, 'autre')}</p>` : shown;
}

function calendarSvg(cal: ReturnType<typeof fleetCalendar>, now: number): string {
  const rows = cal.rows.slice(0, MAX_BAR_ROWS);
  const height = 16 + 20 * rows.length + 16;
  const X0 = 84;
  const W = 384;
  const span = cal.to - cal.from;
  const xOf = (t: number): number => X0 + Math.max(0, Math.min(1, (t - cal.from) / span)) * (W - X0);
  const bars = rows.map((row, i) => {
    const y = 16 + 20 * i;
    const segs = row.segments.map((b) => {
      const x1 = xOf(b.start);
      const x2 = b.end === null ? W : xOf(b.end);
      const style = b.upcoming
        ? 'fill="none" stroke="var(--text-secondary)" stroke-dasharray="3 2"'
        : `fill="${KIND_FILL[b.kind]}"`;
      return `<rect x="${x1.toFixed(1)}" y="${y + 2}" width="${Math.max(2, x2 - x1).toFixed(1)}" height="12" rx="2" ${style}/>`;
    }).join('');
    const full = unitLabel(row.unit);
    return `<g><title>${escapeHtml(full)}</title>`
      + `<text x="0" y="${y + 11}" font-size="10.5" fill="var(--text-secondary)">${escapeHtml(shortLabel(row.unit))}</text>${segs}</g>`;
  }).join('');
  const nowX = xOf(now).toFixed(1);
  const axisY = 16 + 20 * rows.length + 11;
  const tick = (x: number, label: string, anchor: string): string =>
    `<text x="${x.toFixed(1)}" y="${axisY}" font-size="10" text-anchor="${anchor}" fill="var(--text-secondary)">${escapeHtml(label)}</text>`;
  const ticks = tick(X0, dm(cal.from), 'start') + tick(Number(nowX), 'auj.', 'middle')
    + tick(xOf(cal.from + span / 2), dm(cal.from + span / 2), 'middle') + tick(W, dm(cal.to), 'end');
  const names = rows.map((r) => unitLabel(r.unit)).join(', ');
  const aria = `Calendrier des indisponibilités du ${dm(cal.from)} au ${dm(cal.to)} : ${cal.rows.length} ${plural(cal.rows.length, 'tranche')} (${names})`;
  const more = cal.rows.length > MAX_BAR_ROWS ? `<p class="fmk-note">${cal.rows.length - MAX_BAR_ROWS} ${plural(cal.rows.length - MAX_BAR_ROWS, 'autre tranche', 'autres tranches')}</p>` : '';
  return `<svg viewBox="0 0 384 ${height}" width="100%" role="img" aria-label="${escapeHtml(aria)}">${bars}`
    + `<line x1="${nowX}" x2="${nowX}" y1="8" y2="${16 + 20 * rows.length}" stroke="var(--v2-brand)" stroke-width="1.5"/>${ticks}</svg>${more}`
    + `<div class="lp-legend">${legendItem('fortuit')}${legendItem('programme')}${legendItem('reduit')}${legendItem('upcoming')}</div>`;
}

function calendarSections(state: NuclearState, now: number, open: NuclearViewInput['open']): FicheSection[] {
  const cal = fleetCalendar(state.unavailabilities, NUCLEAR_UNITS, now);
  const gain = cal.returns.reduce((s, r) => s + r.gainMw, 0);
  return [
    {
      id: 'window', title: '14 prochains jours', collapsible: true, open: open('window', true),
      summary: escapeHtml(`${cal.returns.length} ${plural(cal.returns.length, 'retour')} · ${cal.upcoming.length} ${plural(cal.upcoming.length, 'nouvel arrêt', 'nouveaux arrêts')}`),
      html: cal.rows.length === 0 ? emptyLine('Aucune indisponibilité sur la période.') : calendarSvg(cal, now),
    },
    {
      id: 'returns', title: 'Retours prévus', collapsible: true, open: open('returns', true),
      summary: escapeHtml(`${cal.returns.length} ${plural(cal.returns.length, 'tranche')} · ${formatGw(gain)}`),
      html: cal.returns.length === 0 ? emptyLine('Aucun retour prévu sur la période.')
        : capped(cal.returns.map((r) => kvRow(unitLabel(r.unit), `${dm(r.at)} · +${escapeHtml(formatGw(r.gainMw))}`))),
    },
    {
      id: 'upcoming', title: 'Arrêts programmés à venir', collapsible: true, open: open('upcoming', true),
      html: cal.upcoming.length === 0 ? emptyLine('Aucun arrêt programmé sur la période.')
        : capped(cal.upcoming.map((r) => kvRow(unitLabel(r.unit), `à partir du ${dm(r.at)} · ${MINUS}${escapeHtml(formatGw(r.lostMw))}`))),
    },
  ];
}

// ── Signaux REMIT ─────────────────────────────────────────────────────────────

const REMIT_WORDS: Record<NuclearRemitSignal['classifiedAs'], string> = {
  UNPLANNED_OUTAGE: 'arrêt fortuit', PLANNED_MAINTENANCE: 'arrêt programmé', RESTART: 'redémarrage',
  EXTENSION: 'prolongation d’arrêt', OTHER: 'autre',
};

function remitRow(s: NuclearRemitSignal, now: number, extra: string): string {
  const level = s.classifiedAs === 'UNPLANNED_OUTAGE' ? 'orange' : null;
  const sign = s.classifiedAs === 'RESTART' ? '+' : MINUS;
  const power = s.capacityMW === null ? 'n.d.' : `${sign}${formatGw(s.capacityMW)}`;
  return `<div class="lp-row">${levelDot(level)}<span>${escapeHtml(s.unitName ?? s.plantName)} · ${REMIT_WORDS[s.classifiedAs]}</span>`
    + `<span class="fmk-num">${escapeHtml(power)}</span><small>publié le ${dmAt(s.publishedAt.getTime(), now)}${extra}</small></div>`;
}

function feedText(state: NuclearState, now: number): string {
  const at = absoluteTime(remitAt(state), now, 'fr');
  switch (state.remitStatus) {
    case 'loading': return 'Flux REMIT en cours de lecture…';
    case 'unavailable': return `Flux REMIT injoignable depuis ${at} : signaux précoces indisponibles.`;
    case 'html': return 'Flux REMIT reçu dans un format inattendu.';
    default: return `Flux REMIT lu à ${at}.`;
  }
}

function remitSections(state: NuclearState, now: number, open: NuclearViewInput['open']): FicheSection[] {
  const pending = state.unconfirmedSignals;
  const confirmed = state.remitSignals.filter((s) => s.confirmedByRTE);
  return [
    {
      id: 'unconfirmed', title: 'Pas encore dans les données RTE', collapsible: true, open: open('unconfirmed', true), summary: String(pending.length),
      html: pending.length === 0 ? emptyLine('Aucun signal en attente de confirmation.')
        : '<p class="fmk-note">Publications REMIT des exploitants, en avance sur les indisponibilités consolidées par RTE. À confirmer.</p>'
          + pending.map((p) => remitRow(p.remitSignal, now,
            ` · ${remitMatchWords(p.confidence)} · ${sourceLinkHtml('publication', p.remitSignal.link)}`)).join(''),
    },
    {
      id: 'confirmed', title: 'Confirmés par RTE', collapsible: true, open: open('confirmed', false), summary: String(confirmed.length),
      html: confirmed.length === 0 ? emptyLine('Aucun signal confirmé.') : confirmed.map((s) => remitRow(s, now, '')).join(''),
    },
    {
      id: 'feed', title: 'Flux REMIT', collapsible: true, open: open('feed', false), tone: 'reference',
      summary: escapeHtml(`RTE IIP · lu à ${absoluteTime(remitAt(state), now, 'fr')}`),
      html: `<p class="fmk-note">${escapeHtml(feedText(state, now))}</p>`,
    },
  ];
}

// ── Vue ───────────────────────────────────────────────────────────────────────

export function buildNuclearView(input: NuclearViewInput): LayerView {
  const { state, ecowatt, tab, now, open } = input;
  const tabs = tabsOf(state);
  if (state === null) {
    return { head: { theme: 'Énergie', title: 'Parc nucléaire', status: ['chargement…'] }, tabs, activeTab: tab, sections: [], bodyHtml: loadingBody() };
  }

  const outages = activeOutages(state.unavailabilities, NUCLEAR_UNITS, now);
  const summary = fleetSummary(NUCLEAR_UNITS, outages);

  if (!state.rteAvailable) {
    const head = {
      theme: 'Énergie', title: 'Parc nucléaire', figure: { value: 'n.d.', caption: 'puissance disponible' },
      level: null, status: ['Données RTE indisponibles'],
    };
    if (tab === 'remit') return { head, tabs, activeTab: tab, sections: remitSections(state, now, open) };
    if (tab === 'calendar') return { head, tabs, activeTab: tab, sections: [], bodyHtml: sourceErrorCallout(null, now) };
    // La production réelle et la méthode restent lisibles sans RTE ; seul le disponible devient n.d.
    return {
      head, tabs, activeTab: tab, bodyHtml: sourceErrorCallout(null, now),
      sections: [productionSection(state, ecowatt, summary.installedMw, null, open), methodSection(state, now, open)],
    };
  }

  const level: VigilanceLevel = fleetLevel(summary.byKind.fortuit.lostMw);
  const fortuit = summary.byKind.fortuit;
  const planned = summary.byKind.programme.count;
  const reduced = summary.byKind.reduit.count;
  const rteTime = rteAt(state);
  const late = now - rteTime > LATE_AFTER_MS;
  const head = {
    theme: 'Énergie', title: 'Parc nucléaire',
    figure: {
      value: formatGw(summary.availableMw),
      caption: `disponibles sur ${formatGw(summary.installedMw)} · ${formatPct(summary.ratio * 100)}`,
      level,
    },
    level,
    status: [
      fortuit.count > 0 ? `${fortuit.count} ${plural(fortuit.count, 'arrêt')} ${plural(fortuit.count, 'fortuit')} (${formatGw(fortuit.lostMw)})` : 'aucun arrêt fortuit',
      planned > 0 ? `${planned} ${plural(planned, 'arrêt')} ${plural(planned, 'programmé')}` : 'aucun arrêt programmé',
      ...(reduced > 0 ? [`${reduced} en puissance réduite`] : []),
      `RTE lu à ${absoluteTime(rteTime, now, 'fr')}${late ? ' (en retard)' : ''}`,
    ],
    lead: null,
  };

  const sections = tab === 'overview'
    ? [
      productionSection(state, ecowatt, summary.installedMw, summary.availableMw, open),
      outagesSection(summary.outages, now, open),
      sitesSection(outages, open),
      methodSection(state, now, open),
    ]
    : tab === 'calendar' ? calendarSections(state, now, open) : remitSections(state, now, open);
  return { head, tabs, activeTab: tab, sections };
}
