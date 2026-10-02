// src/components/layer-panel/gas.ts : vue pure du panneau Réseau gaz (spec lot 2 § 3.1) ; aucun accès réseau ni DOM.
import type { BiogasState, EcoGazSignal, GasNetworkState } from '../../types/index.ts';
import { levelColorVar, type VigilanceLevel } from '../../services/vigilance.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { renderVigilancePill } from '../shared/vigilancePill.ts';
import { absoluteTime, kvRow } from '../fiche/kit.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { dayMonth, formatGwhDay, formatPct, formatSignedPct, formatTwh, frNumber, weekdayOf } from './format.ts';
import { lineChart } from './chart.ts';
import { barRow, emptyLine, listRow, loadingBody, renderNdPill, valueHtml, type LayerView } from './frame.ts';

export interface GasViewInput {
  data: GasNetworkState | null;
  biogas: BiogasState | null;
  enabled: boolean;
  now: number;
  open: (sectionId: string, byDefault: boolean) => boolean;
}

type SourceState = 'ok' | 'stale' | 'error';

const ECOGAZ_LEVEL: Record<EcoGazSignal, VigilanceLevel | 'nd'> = { green: 'vert', yellow: 'jaune', orange: 'orange', red: 'rouge', unknown: 'nd' };
const ECOGAZ_WORD: Record<EcoGazSignal, string> = {
  green: 'pas de tension', yellow: 'vigilance', orange: 'système tendu', red: 'système très tendu', unknown: 'signal indisponible',
};
const THEME = 'Énergie';
const TITLE = 'Réseau gaz';
const VISIBLE_SITES = 3;
const MIN_BIOGAS_SITES = 100;

export function fillLevel(pct: number): VigilanceLevel {
  return pct < 30 ? 'rouge' : pct < 50 ? 'orange' : pct < 70 ? 'jaune' : 'vert';
}

export function ecogazLevel(signal: EcoGazSignal): VigilanceLevel | 'nd' {
  return ECOGAZ_LEVEL[signal];
}

export function ecogazWord(signal: EcoGazSignal): string {
  return ECOGAZ_WORD[signal];
}

export function biogasSignal(s: BiogasState): { word: 'Normal' | 'Baisse' | 'Alerte'; level: 'vert' | 'jaune' | 'orange' } {
  const ratio = s.avg7dMWh > 0 ? s.latestMWh / s.avg7dMWh : 1;
  if (ratio >= 0.9) return { word: 'Normal', level: 'vert' };
  if (ratio >= 0.7) return { word: 'Baisse', level: 'jaune' };
  return { word: 'Alerte', level: 'orange' };
}

/** Somme des envois des terminaux GNL ; null si aucun n'en publie. */
function lngSendOut(data: GasNetworkState): number | null {
  const sent = data.terminals.map((t) => t.currentSendOut).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return sent.length === 0 ? null : sent.reduce((a, b) => a + b, 0);
}

/** Les flux aux frontières ne sont fiables que si GRTgaz répond (sinon valeurs de repli). */
function pirOk(data: GasNetworkState): boolean {
  return data.sourceStatus.grtgaz === 'ok';
}

export function gasLead(data: GasNetworkState): string {
  const parts: string[] = [];
  const net = data.nationalStats.storageNetFlowGWhDay;
  if (net !== undefined && Number.isFinite(net)) {
    if (Math.abs(net) < 1) parts.push('Stockages stables.');
    else if (net > 0) parts.push(`Stockages en injection (${formatGwhDay(net, { signed: true })}).`);
    else parts.push(`Stockages en soutirage (${formatGwhDay(net, { signed: true })}).`);
  }
  const lng = lngSendOut(data);
  if (pirOk(data)) {
    const imports = data.nationalStats.totalImportGWhDay - data.nationalStats.totalExportGWhDay + (lng ?? 0);
    parts.push(`Imports nets de ${formatGwhDay(imports)}${lng ? `, dont ${formatGwhDay(lng)} par les terminaux GNL` : ''}.`);
  } else if (lng) parts.push(`Terminaux GNL : ${formatGwhDay(lng)} ; flux aux frontières indisponibles.`);
  else parts.push('Flux aux frontières indisponibles.');
  return parts.join(' ');
}

function plural(n: number, one: string, many: string = `${one}s`): string {
  return n > 1 ? many : one;
}

function ecogazSection(data: GasNetworkState, open: GasViewInput['open']): FicheSection {
  const { ecogaz } = data;
  const upcoming = ecogaz.forecast.filter((f) => f.date > ecogaz.date).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3);
  const firstTense = upcoming.find((f) => f.signal !== 'green');
  const last = upcoming.at(-1);
  const summary = firstTense ? `${ecogazWord(firstTense.signal)} ${weekdayOf(firstTense.date, 'long')}`
    : last ? `aucune tension prévue d’ici ${weekdayOf(last.date, 'long')}` : 'prévision non publiée';
  const html = upcoming.length === 0 ? emptyLine('Prévision Ecogaz non publiée.')
    : `<div class="lp-days">${upcoming.map((f) => {
      const wd = weekdayOf(f.date, 'short');
      const level = ecogazLevel(f.signal);
      const pill = level === 'nd' ? renderNdPill() : renderVigilancePill(level);
      return `<div><span class="fmk-num">${escapeHtml(`${wd.charAt(0).toUpperCase()}${wd.slice(1)} ${dayMonth(f.date)}`)}</span>${pill}</div>`;
    }).join('')}</div>`;
  return { id: 'ecogaz', title: 'Ecogaz', summary: escapeHtml(summary), collapsible: true, open: open('ecogaz', true), html };
}

function movement(data: GasNetworkState): string {
  const net = data.nationalStats.storageNetFlowGWhDay;
  if (net === undefined || !Number.isFinite(net)) return 'mouvement n.d.';
  if (Math.abs(net) < 1) return 'stable';
  return `${net > 0 ? 'injection' : 'soutirage'} ${formatGwhDay(net, { signed: true })}`;
}

function storageSection(data: GasNetworkState, open: GasViewInput['open']): FicheSection {
  const avg = data.nationalStats.averageFillLevel;
  const net = data.nationalStats.storageNetFlowGWhDay;
  const row = (s: GasNetworkState['storages'][number]): string => {
    const stock = s.currentStockTWh ?? (s.capacityTWh * s.fillLevel) / 100;
    return barRow({ label: `${s.name} (${s.operator})`, pct: s.fillLevel, value: `${formatPct(s.fillLevel)} · ${formatTwh(stock)}`, level: fillLevel(s.fillLevel) });
  };
  const sites = [...data.storages].sort((a, b) => b.fillLevel - a.fillLevel);
  const rest = sites.slice(VISIBLE_SITES);
  const netText = net === undefined || !Number.isFinite(net) ? valueHtml('n.d.')
    : Math.abs(net) < 1 ? 'stable' : `${net > 0 ? 'injection' : 'soutirage'} ${valueHtml(formatGwhDay(net, { signed: true }))}`;
  let html = data.sourceStatus.odre !== 'ok' ? '<p class="fmk-callout">Remplissage ODRÉ injoignable : valeurs de référence affichées.</p>' : '';
  html += barRow({ label: 'Remplissage', pct: avg, value: formatPct(avg, 1), level: fillLevel(avg) })
    + kvRow('Mouvement net', netText)
    + '<h4 class="fmk-eyebrow">Par site</h4>'
    + sites.slice(0, VISIBLE_SITES).map(row).join('');
  if (rest.length > 0) {
    html += `<details class="lp-more"><summary>${rest.length} ${plural(rest.length, 'autre')} ${plural(rest.length, 'site')}</summary>${rest.map(row).join('')}</details>`;
  }
  return { id: 'storage', title: 'Stockages', summary: escapeHtml(`${formatPct(avg, 1)} · ${movement(data)}`), collapsible: true, open: open('storage', true), html };
}

function interconnectionsSection(data: GasNetworkState, open: GasViewInput['open']): FicheSection {
  const base = { id: 'interconnections', title: 'Interconnexions', collapsible: true, open: open('interconnections', false) };
  if (!pirOk(data)) {
    return { ...base, summary: 'n.d.', html: '<p class="fmk-note">Flux aux frontières indisponibles (ENTSOG) : valeurs de repli non affichées.</p>' };
  }
  const balance = data.nationalStats.totalImportGWhDay - data.nationalStats.totalExportGWhDay;
  const summary = Math.abs(balance) < 0.5 ? 'équilibre' : balance > 0 ? `import net ${formatGwhDay(balance)}` : `export net ${formatGwhDay(-balance)}`;
  const html = data.interconnections.map((i) => listRow({
    text: `${i.name} (${i.country})`,
    value: i.flowGWhDay > 0 ? `import ${formatGwhDay(i.flowGWhDay)}` : i.flowGWhDay < 0 ? `export ${formatGwhDay(-i.flowGWhDay)}` : 'équilibre',
  })).join('');
  return { ...base, summary: escapeHtml(summary), html };
}

const TERMINAL_WORD = { active: 'en service', maintenance: 'maintenance', offline: 'hors service' } as const;

function terminalsSection(data: GasNetworkState, open: GasViewInput['open']): FicheSection {
  const lng = lngSendOut(data);
  const active = data.terminals.filter((t) => t.status === 'active').length;
  const summary = lng === null ? 'n.d.' : `${formatGwhDay(lng)} · ${active} ${plural(active, 'terminal', 'terminaux')} en service`;
  const html = data.terminals.map((t) => {
    const notes: string[] = [t.operator];
    if (t.inventoryPct !== undefined) notes.push(`stock GNL ${formatPct(t.inventoryPct)}`);
    notes.push(t.dataDate ? `GIE ALSI, journée du ${dayMonth(t.dataDate)}` : 'valeurs de configuration');
    return listRow({
      text: `${t.name} · ${TERMINAL_WORD[t.status]}`, value: formatGwhDay(t.currentSendOut ?? null),
      level: t.status === 'active' ? 'vert' : 'gris', note: notes.join(' · '),
    }) + barRow({ label: 'Utilisation', pct: t.utilizationPct ?? null, value: formatPct(t.utilizationPct ?? null), color: 'var(--cat-lng)', dot: false });
  }).join('');
  return { id: 'terminals', title: 'Terminaux GNL', summary: escapeHtml(summary), collapsible: true, open: open('terminals', false), html };
}

function biogasSection(s: BiogasState | null, open: GasViewInput['open']): FicheSection {
  const base = { id: 'biomethane', title: 'Biométhane', collapsible: true, open: open('biomethane', true) };
  const latest = s?.daily[0];
  if (!s || !latest) return { ...base, summary: 'n.d.', html: emptyLine('Production de biométhane indisponible.') };
  const sig = biogasSignal(s);
  const value = formatGwhDay(s.latestMWh / 1000, { digits: 1 });
  const delta = s.deltaJ1Pct;
  const gap = delta === null || !Number.isFinite(delta) ? 'écart n.d.'
    : `${valueHtml(formatSignedPct(delta, 1), delta < 0 ? 'orange' : delta > 0 ? 'vert' : null)} sur la veille`;
  let html = s.alert && s.alert.severityPct > 30
    ? `<p class="fmk-callout">Chute de ${escapeHtml(formatPct(s.alert.severityPct, 1))} de la production par rapport à la moyenne sur 7 jours.</p>` : '';
  html += listRow({ text: `Production du ${dayMonth(latest.date)}`, value, level: sig.level, noteHtml: `${sig.word} · ${gap}` })
    + kvRow('Moyenne 7 jours', valueHtml(formatGwhDay(s.avg7dMWh / 1000, { digits: 1 })))
    + kvRow('Sites injectant', escapeHtml(String(latest.sitesCount)))
    + kvRow('Statut', escapeHtml(`${latest.status.toLowerCase()}, journée du ${dayMonth(latest.date)}`));
  const points = s.daily.filter((d) => d.sitesCount > MIN_BIOGAS_SITES)
    .map((d) => ({ at: Date.parse(d.date), value: d.productionMWh / 1000 }))
    .filter((p) => Number.isFinite(p.at));
  if (points.length >= 2) {
    const ats = points.map((p) => p.at);
    html += lineChart(points, {
      label: 'Production de biométhane sur 30 jours', from: Math.min(...ats), to: Math.max(...ats), stroke: levelColorVar(sig.level),
      value: (v) => formatGwhDay(v, { digits: 1 }), tick: (ms) => dayMonth(new Date(ms).toISOString().slice(0, 10)),
    });
  }
  return { ...base, summary: escapeHtml(`${value} · ${sig.word}`), html };
}

const SOURCE_LEVEL: Record<SourceState, VigilanceLevel> = { ok: 'vert', stale: 'jaune', error: 'rouge' };
const SOURCE_WORD: Record<SourceState, string> = { ok: 'à jour', stale: 'valeurs de repli', error: 'injoignable' };

function sourcesSection(data: GasNetworkState, biogas: BiogasState | null, now: number, open: GasViewInput['open']): FicheSection {
  const st = data.sourceStatus;
  const rows: Array<[string, SourceState, number]> = [
    ['Ecogaz (ODRÉ)', st.ecogaz, data.lastUpdate.getTime()],
    ['Stockages (ODRÉ)', st.odre, data.lastUpdate.getTime()],
    ['Flux aux frontières (ENTSOG)', st.grtgaz, data.lastUpdate.getTime()],
    ['Stockages agrégés (GIE AGSI)', st.agsi, data.lastUpdate.getTime()],
    ['Terminaux GNL (GIE ALSI)', st.alsi, data.lastUpdate.getTime()],
    ['Biométhane (GRDF)', biogas ? 'ok' : 'error', (biogas?.updatedAt ?? data.lastUpdate).getTime()],
  ];
  const html = rows.map(([text, state, at]) => listRow({
    text, value: SOURCE_WORD[state], level: SOURCE_LEVEL[state], note: `lu à ${absoluteTime(at, now, 'fr')}`,
  })).join('');
  return {
    id: 'sources', title: 'Sources', summary: 'GRTgaz, Teréga, ODRÉ, GIE, ENTSOG', collapsible: true, open: open('sources', false), tone: 'reference', html,
  };
}

export function buildGasView(input: GasViewInput): LayerView {
  if (!input.enabled) {
    return { head: { theme: THEME, title: TITLE, status: [] }, sections: [], bodyHtml: emptyLine('Couche désactivée sur cette instance.') };
  }
  const { data, biogas, now, open } = input;
  if (!data) return { head: { theme: THEME, title: TITLE, status: ['chargement…'] }, sections: [], bodyHtml: loadingBody() };
  const avg = data.nationalStats.averageFillLevel;
  const reference = data.sourceStatus.odre !== 'ok' ? ' · valeurs de référence' : '';
  const lead = gasLead(data);
  return {
    head: {
      theme: THEME,
      title: TITLE,
      level: ecogazLevel(data.ecogaz.signal),
      figure: {
        value: formatPct(avg, 1),
        caption: `stockages remplis · ${frNumber(data.nationalStats.currentStorageTWh, 1)} sur ${formatTwh(data.nationalStats.totalStorageCapacityTWh)}${reference}`,
        level: fillLevel(avg),
      },
      status: [`Ecogaz : ${ecogazWord(data.ecogaz.signal)}`, `journée gazière du ${dayMonth(data.ecogaz.date)}`, 'GRTgaz, Teréga'],
      lead: lead.length > 0 ? lead : null,
    },
    sections: [
      ecogazSection(data, open), storageSection(data, open), interconnectionsSection(data, open),
      terminalsSection(data, open), biogasSection(biogas, open), sourcesSection(data, biogas, now, open),
    ],
  };
}
