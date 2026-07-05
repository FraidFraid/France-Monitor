/**
 * SituationReport.ts — Collecte de l'état courant + ouverture de la note.
 *
 * `collectSituationReportData()` assemble un `SituationReportData` à partir de
 * l'état déjà en cache dans l'application (aucun nouveau fetch). Les sources
 * absentes du cache dégradent proprement la note ("non disponible") sans jamais
 * empêcher sa génération.
 *
 * `openSituationReport()` ouvre une fenêtre, y écrit le document HTML autonome
 * produit par le module pur `situation-report.ts`, puis déclenche l'impression.
 */

import type {
  DetectedSituation,
  EcowattResponse,
  FloodSegment,
  ISNRData,
  MeteoAlert,
  NewsItem,
  PowerOutage,
  SituationSeverity,
  TelecomOutage,
  ThreatLevel,
  TransportDisruption,
  WatchdogSnapshot,
} from '../types/index.ts';
import type { TrafficIncident } from '../services/traffic.ts';
import {
  buildSituationReportHtml,
  type ReportDomainSignal,
  type ReportEvent,
  type ReportSeverity,
  type ReportSituation,
  type ReportSource,
  type ReportSourceState,
  type ReportStability,
  type SituationReportData,
} from '../services/situation-report.ts';

// ─── Contexte fourni par l'orchestrateur (App.ts) ─────────────────────────────

/** Instantané de l'état courant nécessaire pour composer la note. */
export interface SituationReportContext {
  generatedAt: Date;
  permalink: string;
  situations: DetectedSituation[];
  stability: ISNRData | null;
  meteoAlerts: MeteoAlert[];
  floodSegments: FloodSegment[];
  ecowatt: EcowattResponse | null;
  sncfDisruptions: TransportDisruption[];
  trafficIncidents: TrafficIncident[];
  powerOutages: PowerOutage[];
  telecomOutages: TelecomOutage[];
  newsItems: NewsItem[];
  sources: WatchdogSnapshot[];
  version: string | null;
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const TZ = 'Europe/Paris';
const SITUATION_CAP = 6;
const EVENTS_CAP = 6;
const TOP_DEPARTMENTS_CAP = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

const ECOWATT_REGION_NAMES: Record<string, string> = {
  '11': 'Île-de-France',
  '24': 'Centre-Val de Loire',
  '27': 'Bourgogne-Franche-Comté',
  '28': 'Normandie',
  '32': 'Hauts-de-France',
  '44': 'Grand Est',
  '52': 'Pays de la Loire',
  '53': 'Bretagne',
  '75': 'Nouvelle-Aquitaine',
  '76': 'Occitanie',
  '84': 'Auvergne-Rhône-Alpes',
  '93': 'PACA',
  '94': 'Corse',
};

const STATE_PRIORITY: Record<ReportSourceState, number> = {
  error: 0,
  stale: 1,
  loading: 2,
  ok: 3,
};

// ─── Formatteurs (Europe/Paris) ───────────────────────────────────────────────

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatGeneratedAt(date: Date): string {
  const formatted = new Intl.DateTimeFormat('fr-FR', {
    timeZone: TZ,
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(date);
  return `${formatted} (Europe/Paris)`;
}

function formatAge(cacheAgeMs: number | null, lastUpdate: Date | null, now: Date): string {
  let ms = cacheAgeMs;
  if (ms == null && lastUpdate) ms = now.getTime() - lastUpdate.getTime();
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';

  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} j`;
}

// ─── Mappings de sévérité ─────────────────────────────────────────────────────

function mapSituationSeverity(severity: SituationSeverity): ReportSeverity {
  switch (severity) {
    case 'critical':
      return 'critical';
    case 'high':
      return 'high';
    case 'medium':
      return 'medium';
    case 'watch':
      return 'low';
  }
}

function mapThreatLevel(level: ThreatLevel | undefined): ReportSeverity {
  switch (level) {
    case 'critical':
      return 'critical';
    case 'high':
      return 'high';
    case 'medium':
      return 'medium';
    case 'low':
      return 'low';
    default:
      return 'info';
  }
}

function stabilityStatusLabel(score: number): string {
  if (score >= 80) return 'CRITIQUE';
  if (score >= 60) return 'ÉLEVÉ';
  if (score >= 40) return 'TENSION';
  if (score >= 20) return 'VEILLE';
  return 'STABLE';
}

// ─── Signaux par domaine (uniquement les états NON nominaux) ──────────────────

function buildDomainSignals(ctx: SituationReportContext): ReportDomainSignal[] {
  const signals: ReportDomainSignal[] = [];

  // Écowatt — inclus si au moins une région orange/rouge.
  if (ctx.ecowatt) {
    const entries = Object.entries(ctx.ecowatt.signals);
    const red = entries.filter(([, s]) => s === 'red');
    const orange = entries.filter(([, s]) => s === 'orange');
    if (red.length > 0 || orange.length > 0) {
      const names = [...red, ...orange]
        .map(([code]) => ECOWATT_REGION_NAMES[code] ?? `Région ${code}`)
        .slice(0, 5);
      signals.push({
        domain: 'Écowatt (tension électrique)',
        levelLabel: red.length > 0 ? 'Rouge' : 'Orange',
        severity: red.length > 0 ? 'high' : 'medium',
        detail: `${red.length} région(s) rouge, ${orange.length} orange${names.length > 0 ? ` : ${names.join(', ')}` : ''}.`,
      });
    }
  }

  // Vigilance météo — départements orange/rouge (violet assimilé rouge).
  const meteoRed = ctx.meteoAlerts.filter((a) => a.level === 'red' || a.level === 'violet');
  const meteoOrange = ctx.meteoAlerts.filter((a) => a.level === 'orange');
  if (meteoRed.length > 0 || meteoOrange.length > 0) {
    const names = [...meteoRed, ...meteoOrange].map((a) => a.department).slice(0, 6);
    signals.push({
      domain: 'Vigilance météo',
      levelLabel: meteoRed.length > 0 ? 'Rouge' : 'Orange',
      severity: meteoRed.length > 0 ? 'critical' : 'medium',
      detail: `${meteoRed.length} dépt rouge, ${meteoOrange.length} orange${names.length > 0 ? ` : ${names.join(', ')}` : ''}.`,
    });
  }

  // Crues — tronçons orange/rouge.
  const floodRed = ctx.floodSegments.filter((s) => s.level === 'red');
  const floodOrange = ctx.floodSegments.filter((s) => s.level === 'orange');
  if (floodRed.length > 0 || floodOrange.length > 0) {
    const names = [...floodRed, ...floodOrange].map((s) => s.name).slice(0, 5);
    signals.push({
      domain: 'Crues (Vigicrues)',
      levelLabel: floodRed.length > 0 ? 'Rouge' : 'Orange',
      severity: floodRed.length > 0 ? 'critical' : 'medium',
      detail: `${floodRed.length} tronçon(s) rouge, ${floodOrange.length} orange${names.length > 0 ? ` : ${names.join(', ')}` : ''}.`,
    });
  }

  // Transport — perturbations majeures (SNCF high/critical, routier high/critical ≥ 3).
  const sncfMajor = ctx.sncfDisruptions.filter((d) => d.severity === 'high' || d.severity === 'critical');
  const trafficMajor = ctx.trafficIncidents.filter((t) => t.severity === 'high' || t.severity === 'critical');
  if (sncfMajor.length > 0 || trafficMajor.length >= 3) {
    const hasCritical =
      sncfMajor.some((d) => d.severity === 'critical') || trafficMajor.some((t) => t.severity === 'critical');
    const parts: string[] = [];
    if (sncfMajor.length > 0) parts.push(`${sncfMajor.length} perturbation(s) ferroviaire(s) majeure(s)`);
    if (trafficMajor.length > 0) parts.push(`${trafficMajor.length} incident(s) routier(s) majeur(s)`);
    signals.push({
      domain: 'Transport',
      levelLabel: 'Perturbé',
      severity: hasCritical ? 'high' : 'medium',
      detail: `${parts.join(', ')}.`,
    });
  }

  // Pannes réseaux — électricité (PDL hors réseau) et/ou télécom dégradé/HS.
  const powerActive = ctx.powerOutages.filter((p) => p.offGridCount > 0);
  const telecomActive = ctx.telecomOutages.filter((t) => t.voiceStatus !== 'OK' || t.dataStatus !== 'OK');
  if (powerActive.length > 0 || telecomActive.length > 0) {
    const totalOff = powerActive.reduce((sum, p) => sum + p.offGridCount, 0);
    const parts: string[] = [];
    if (powerActive.length > 0) {
      parts.push(`${powerActive.length} département(s) touché(s) (électricité, ~${totalOff.toLocaleString('fr-FR')} foyers)`);
    }
    if (telecomActive.length > 0) parts.push(`${telecomActive.length} site(s) télécom dégradés/HS`);
    signals.push({
      domain: 'Pannes réseaux',
      levelLabel: 'Actives',
      severity: totalOff >= 5000 || telecomActive.length >= 5 ? 'high' : 'medium',
      detail: `${parts.join(', ')}.`,
    });
  }

  return signals;
}

// ─── Assemblage principal ─────────────────────────────────────────────────────

/**
 * Transforme l'état courant en données de note. Pur au sens fonctionnel :
 * ne lit que le `ctx` fourni, aucun fetch ni accès DOM.
 */
export function collectSituationReportData(ctx: SituationReportContext): SituationReportData {
  const shownSituations = ctx.situations.slice(0, SITUATION_CAP);
  const situations: ReportSituation[] = shownSituations.map((s) => ({
    title: s.title,
    severity: mapSituationSeverity(s.severity),
    since: `constatée à ${formatTime(s.updatedAt)}`,
    zone: s.affectedZones[0] ?? 'France',
    summary: s.summary,
  }));

  let stability: ReportStability | null = null;
  if (ctx.stability) {
    const topDepartments = ctx.stability.scores
      .filter((s) => s.score > 0)
      .slice(0, TOP_DEPARTMENTS_CAP)
      .map((s) => ({ code: s.code, name: s.name, score: s.score }));
    stability = {
      nationalScore: ctx.stability.nationalScore,
      statusLabel: stabilityStatusLabel(ctx.stability.nationalScore),
      topDepartments,
    };
  }

  const cutoff = ctx.generatedAt.getTime() - DAY_MS;
  const events: ReportEvent[] = ctx.newsItems
    .filter(
      (n) =>
        (n.threat?.level === 'high' || n.threat?.level === 'critical') && n.pubDate.getTime() >= cutoff,
    )
    .sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime())
    .slice(0, EVENTS_CAP)
    .map((n) => ({
      time: formatTime(n.pubDate),
      place: n.locationName ?? n.feedRegion,
      title: n.title,
      source: n.source,
      severity: mapThreatLevel(n.threat?.level),
    }));

  const sources: ReportSource[] = ctx.sources
    .map((snap) => ({
      label: snap.status.name,
      state: snap.status.status,
      ageLabel: formatAge(
        snap.status.cacheAgeMs ?? null,
        snap.status.lastUpdate ?? snap.status.lastSuccess ?? null,
        ctx.generatedAt,
      ),
    }))
    .sort(
      (a, b) => STATE_PRIORITY[a.state] - STATE_PRIORITY[b.state] || a.label.localeCompare(b.label, 'fr'),
    );

  return {
    generatedAtLabel: formatGeneratedAt(ctx.generatedAt),
    periodLabel: 'dernières 24 h',
    permalink: ctx.permalink,
    situations,
    moreSituationsCount: Math.max(0, ctx.situations.length - shownSituations.length),
    stability,
    domainSignals: buildDomainSignals(ctx),
    events,
    newsCacheAvailable: ctx.newsItems.length > 0,
    sources,
    version: ctx.version,
  };
}

// ─── Ouverture + impression ───────────────────────────────────────────────────

/**
 * Ouvre la note dans une nouvelle fenêtre et déclenche l'impression.
 * La fenêtre reste consultable (bouton « Imprimer / PDF » présent).
 */
export function openSituationReport(ctx: SituationReportContext): void {
  const html = buildSituationReportHtml(collectSituationReportData(ctx));

  const win = window.open('', '_blank');
  if (!win) {
    console.warn('[SituationReport] Ouverture de la fenêtre impossible (popup bloqué).');
    return;
  }

  win.document.open();
  win.document.write(html);
  win.document.close();

  const triggerPrint = (): void => {
    win.focus();
    win.print();
  };

  if (win.document.readyState === 'complete') {
    win.setTimeout(triggerPrint, 300);
  } else {
    win.addEventListener('load', () => win.setTimeout(triggerPrint, 300));
  }
}
