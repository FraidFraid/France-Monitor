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
  FloodSectionRef,
  ISNRData,
  MeteoAlert,
  NewsItem,
  TelecomOutagesResponse,
  RailTrain,
  RoadEvent,
  WatchdogSnapshot,
} from '../types/index.ts';
import { dayMonth, frNumber } from './layer-panel/format.ts';
import { telecomLevel } from '../services/outages-levels.ts';
import { eventLevel, isnrLevel, levelVigilanceWord, situationLevel } from '../services/vigilance.ts';
import { ecowattLevelLabel, ecowattToday } from '../services/ecowatt-official.ts';
import {
  buildSituationReportHtml,
  type ReportDomainSignal,
  type ReportEvent,
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
  floodSegments: FloodSectionRef[];
  ecowatt: EcowattResponse | null;
  /** Trains signalés par la SNCF, en cours et à venir (spec 2026-10-03 trafics § 2.4). */
  railTrains: RailTrain[];
  /** Événements en cours du réseau routier national (DIR, § 2.1). */
  roadEvents: RoadEvent[];
  /** Réponse de /api/outages/telecom ; null si non lue. */
  telecomOutages: TelecomOutagesResponse | null;
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
  if (ms == null || !Number.isFinite(ms) || ms < 0) return 'n.d.';

  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} j`;
}

// ─── Signaux par domaine (uniquement les états NON nominaux) ──────────────────

function buildDomainSignals(ctx: SituationReportContext): ReportDomainSignal[] {
  const signals: ReportDomainSignal[] = [];

  // Écowatt — signal NATIONAL (RTE) ; inclus si le niveau du jour est orange ou rouge.
  // Le jour Écowatt est ancré sur l'horloge réelle (Europe/Paris), pas sur `generatedAt` : le
  // signal RTE du jour ne se rejoue pas pour une note générée à une date arbitraire.
  if (ctx.ecowatt) {
    const level = ecowattToday(ctx.ecowatt.official, Date.now());
    if (level === 'red' || level === 'orange') {
      signals.push({
        domain: 'Écowatt (signal national RTE)',
        levelLabel: level === 'red' ? 'Rouge' : 'Orange',
        level: level === 'red' ? 'rouge' : 'orange',
        detail: `Signal national : ${ecowattLevelLabel(level)}.`,
      });
    }
  }

  // Vigilance météo : départements orange ou rouges.
  const meteoRed = ctx.meteoAlerts.filter((a) => a.level === 'red');
  const meteoOrange = ctx.meteoAlerts.filter((a) => a.level === 'orange');
  if (meteoRed.length > 0 || meteoOrange.length > 0) {
    const names = [...meteoRed, ...meteoOrange].map((a) => a.department).slice(0, 6);
    signals.push({
      domain: 'Vigilance météo',
      levelLabel: meteoRed.length > 0 ? 'Rouge' : 'Orange',
      level: meteoRed.length > 0 ? 'rouge' : 'orange',
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
      level: floodRed.length > 0 ? 'rouge' : 'orange',
      detail: `${floodRed.length} tronçon(s) rouge, ${floodOrange.length} orange${names.length > 0 ? ` : ${names.join(', ')}` : ''}.`,
    });
  }

  // Transport : trains supprimés ou retardés (SNCF), accidents et coupures en cours sur le réseau national (DIR) au moins 3.
  const sncfMajor = ctx.railTrains.filter((t) => t.effect === 'supprime' || t.effect === 'retard');
  const trafficMajor = ctx.roadEvents.filter((e) => e.kind === 'accident' || e.kind === 'closure');
  if (sncfMajor.length > 0 || trafficMajor.length >= 3) {
    const hasCritical = sncfMajor.some((t) => t.effect === 'supprime');
    const parts: string[] = [];
    if (sncfMajor.length > 0) parts.push(`${sncfMajor.length} perturbation(s) ferroviaire(s) majeure(s)`);
    if (trafficMajor.length > 0) parts.push(`${trafficMajor.length} incident(s) routier(s) majeur(s)`);
    signals.push({
      domain: 'Transport',
      levelLabel: 'Perturbé',
      level: hasCritical ? 'orange' : 'jaune',
      detail: `${parts.join(', ')}.`,
    });
  }

  // Pannes réseaux : sites mobiles tombés depuis moins de 24 h (fichier ARCEP) ; l'électricité n'a pas de source ouverte fiable.
  // Niveau de la pastille du panneau Télécoms (telecomLevel, seuils partagés) : seuls les états non nominaux entrent dans la note.
  const recent = ctx.telecomOutages?.summary?.recent ?? 0;
  const telecom = ctx.telecomOutages === null ? null : telecomLevel(ctx.telecomOutages);
  if (recent > 0 && telecom !== null && telecom !== 'vert') {
    const file = ctx.telecomOutages?.file ?? null;
    signals.push({
      domain: 'Pannes réseaux',
      levelLabel: 'Actives',
      level: telecom,
      detail: `${frNumber(recent, 0)}\u00a0antenne${recent > 1 ? 's' : ''} en panne imprévue depuis moins de 24\u00a0h${file ? ` (fichier ARCEP du ${dayMonth(file.day)})` : ''}.`,
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
    level: situationLevel(s.severity),
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
      statusLabel: levelVigilanceWord(isnrLevel(ctx.stability.nationalScore)),
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
      level: eventLevel(n.threat?.level ?? 'info'),
    }));

  const sources: ReportSource[] = ctx.sources
    .map((snap) => ({
      label: snap.status.name,
      state: snap.status.status,
      // Source hebdomadaire ou annuelle (santé) : sa période réelle, jamais un âge relatif (spec 2026-10-03 S1).
      ageLabel: snap.status.period ?? formatAge(
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
