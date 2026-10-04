// src/services/cyber-threat-scoring.ts : pression cyber consolidée (pilier Sécurité du score France, baromètre des infrastructures).
// Familles et plafonds inchangés, entrées nouvelles (spec 2026-10-04 souveraineté § 2.3 ; contrats § 6, arbitrage 12 ; amendement 7,
// O1, O5, O6, S10) : fuites publiées en .fr (Have I Been Pwned, un compte et une date), revendications rapportées à leur moyenne
// (Ransomware.live), vulnérabilités exploitées citées par le CERT-FR (catalogue KEV de la CISA), exposition retirée (aucune mesure
// gratuite et sourcée), corrélations sans lieu (aucun lieu de victime publié). Une partie en retard ne compte pas (« (en retard) » retire
// les couleurs) ; plus aucun seuil sur un stock ni repli sur l'ancien tableau. Pur, sans réseau.
import type { CyberResponse } from '../types/index.ts';
import { certfrKevAdvisories, isCertFrAlertOpen, isSovereigntyDataLate } from './sovereignty-levels.ts';

const DAY_MS = 86_400_000;
const RECENT_DAYS = 30;
const NBSP = '\u00a0';

const FAMILY_CAPS = {
  leaks: 20,
  ransomware: 25,
  vulnerabilities: 20,
  exposure: 20,
  correlation: 15,
} as const;

const FAMILY_BASE_WEIGHTS = { leaks: 7, vulnerabilities: 8 } as const;
/** Fenêtres de fraîcheur (jours) : la contribution décroît au-delà. */
const FAMILY_WINDOWS_DAYS = { leaks: 45, vulnerabilities: 21 } as const;
/** Une vulnérabilité du catalogue de la CISA est exploitée : facteur de l'ancienne sévérité « critique ». */
const EXPLOITED_FACTOR = 1.35;

/** Secteurs critiques tels que ransomware.live les publie (santé, énergie, administration, secteur public, télécoms, transport). */
const CRITICAL_SECTORS: ReadonlySet<string> = new Set([
  'Healthcare', 'Energy & Utilities', 'Government & Defense', 'Public Sector', 'Telecommunication', 'Transportation', 'Transportation/Logistics',
]);

export type CyberSignalFamily = 'leaks' | 'ransomware' | 'vulnerabilities' | 'exposure' | 'correlation';

export interface CyberPressureBreakdownItem {
  family: CyberSignalFamily;
  label: string;
  score: number;
  cap: number;
  eventCount: number;
  explanation: string;
}

export interface CyberPressureContext {
  powerOutageCount?: number;
  telecomOutageCount?: number;
  cloudIncidentCount?: number;
}

export interface CyberPressureAssessment {
  score: number;
  inputs: {
    /** Fuites publiées en .fr ajoutées depuis moins de 30 jours (Have I Been Pwned à l'heure) ; 0 sinon. */
    leaks30d: number;
    /** Revendications de la semaine rapportées à la moyenne des 90 jours précédents ; null sans moyenne ou fichier en retard. */
    claimsRatio: number | null;
    /** Vulnérabilités du catalogue de la CISA citées par le CERT-FR, ajoutées depuis moins de 30 jours (catalogue à l'heure). */
    kevCited30d: number;
    /** Alertes CERT-FR au statut « en cours » repris du CERT-FR (O1, gros chiffre du panneau Vigilance cyber). */
    openAlerts: number;
    /** Avis du CERT-FR qui citent une vulnérabilité ajoutée au catalogue KEV depuis moins de 7 jours (O6, catalogue à l'heure). */
    kevAdvisories7d: number;
    /** Revendications des 30 derniers jours dans un secteur critique (fichier de ransomware.live à l'heure). */
    criticalSectorClaims30d: number;
  };
  dominantFamily: CyberSignalFamily | null;
  breakdown: CyberPressureBreakdownItem[];
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function scaleCount(count: number, cap: number, maxContribution: number): number {
  if (count <= 0 || cap <= 0 || maxContribution <= 0) return 0;
  const bounded = Math.min(count, cap);
  return (Math.log1p(bounded) / Math.log1p(cap)) * maxContribution;
}

/** Âge en jours d'une date « AAAA-MM-JJ » ou ISO ; null si illisible ou dans le futur au-delà d'un jour. */
function daysOld(date: string, now: number): number | null {
  const t = Date.parse(date);
  if (!Number.isFinite(t)) return null;
  const days = (now - t) / DAY_MS;
  return days < -1 ? null : Math.max(0, days);
}

/** Fraîcheur reprise de l'ancien calcul : pleine 2 jours, décroissante sur la fenêtre de la famille, nulle au-delà de 4 fenêtres. */
function freshnessWeight(age: number, family: keyof typeof FAMILY_WINDOWS_DAYS): number {
  const windowDays = FAMILY_WINDOWS_DAYS[family];
  if (age <= 2) return 1;
  if (age >= windowDays * 4) return 0;
  const progress = Math.min(age / windowDays, 4);
  if (progress <= 1) return 1 - progress * 0.45;
  if (progress <= 2) return 0.55 - (progress - 1) * 0.22;
  return Math.max(0.08, 0.33 - (progress - 2) * 0.12);
}

/** « 3 vulnérabilités exploitées citées » : nombre et nom collés par une espace insécable (R1). */
function plural(n: number, one: string, many: string): string {
  return `${n}${NBSP}${n > 1 ? many : one}`;
}

/**
 * Pression cyber 0 à 100 sur la réponse de /api/sovereignty/cyber à l'instant `now` ; réponse absente : 0, aucune famille.
 * Fuites : 7 points par fuite pondérés par la fraîcheur de la plus récente (plafond 20 ; O5 : un compte et une date, plus de taille).
 * Revendications : 25 × (rapport − 1) / 2, nul à la moyenne, plein à 3 fois la moyenne (plafond 25). Vulnérabilités : 8 × 1,35 par
 * vulnérabilité citée, pondérés par fraîcheur (plafond 20). Exposition : 0. Corrélations : revendications dans un secteur critique,
 * renforcées par des pannes réseau concomitantes (plafond 15). Fuites, catalogue et revendications en retard (tableau S2) : 0.
 */
export function computeCyberPressureAssessment(
  cyber: CyberResponse | null,
  context: CyberPressureContext = {},
  now: number = Date.now(),
): CyberPressureAssessment {
  const hibp = cyber?.hibp ?? null;
  const hibpFresh = hibp !== null && !isSovereigntyDataLate('hibp', hibp.readAt, now);
  const kevFresh = cyber !== null && !isSovereigntyDataLate('kev', cyber.kev.readAt, now);
  const ransomware = cyber?.ransomware ?? null;
  const claimsLate = ransomware !== null && isSovereigntyDataLate('ransomware', ransomware.lastModified, now);
  const claimsFresh = ransomware !== null && !claimsLate;

  const leaks30d = hibpFresh ? hibp.count : 0;
  const newestLeakAge = hibpFresh && hibp.newestAddedDate !== null ? daysOld(hibp.newestAddedDate, now) : null;
  const kevCited = kevFresh ? cyber.kev.recent.filter((k) => k.certfrRefs.length > 0).flatMap((k) => {
    const age = daysOld(k.dateAdded, now);
    return age !== null && age < RECENT_DAYS ? [age] : [];
  }) : [];
  const openAlerts = cyber === null ? 0 : cyber.certfr.alerts.filter(isCertFrAlertOpen).length;
  const kevAdvisories7d = kevFresh ? certfrKevAdvisories(cyber, now).length : 0;
  const claimsRatio = claimsFresh ? ransomware.ratio : null;
  const criticalSectorClaims30d = claimsFresh
    ? ransomware.sectors30.filter((s) => CRITICAL_SECTORS.has(s.label.trim())).reduce((n, s) => n + s.count, 0)
    : 0;

  const leaksRaw = FAMILY_BASE_WEIGHTS.leaks * leaks30d * (newestLeakAge === null ? 1 : freshnessWeight(newestLeakAge, 'leaks'));
  const claimsRaw = claimsRatio === null ? 0 : (FAMILY_CAPS.ransomware * Math.max(0, claimsRatio - 1)) / 2;
  const kevRaw = kevCited.reduce((sum, age) => sum + FAMILY_BASE_WEIGHTS.vulnerabilities * EXPLOITED_FACTOR * freshnessWeight(age, 'vulnerabilities'), 0);
  const outages = (context.powerOutageCount ?? 0) + (context.telecomOutageCount ?? 0) + (context.cloudIncidentCount ?? 0);
  const correlationRaw = scaleCount(criticalSectorClaims30d, 8, 5)
    + (outages > 0 && criticalSectorClaims30d > 0 ? Math.min(3 + outages, 6) : 0);

  const claimsText = claimsLate ? 'fichier de ransomware.live en retard, non retenues'
    : claimsRatio === null ? 'sans moyenne'
    : `${claimsRatio.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}${NBSP}fois la moyenne, non confirmées`;
  const breakdown: CyberPressureBreakdownItem[] = [
    {
      family: 'leaks', label: 'Fuites publiées', score: clamp(Math.min(FAMILY_CAPS.leaks, leaksRaw)), cap: FAMILY_CAPS.leaks, eventCount: leaks30d,
      explanation: `${plural(leaks30d, 'fuite en .fr ajoutée', 'fuites en .fr ajoutées')} à Have I Been Pwned depuis 30${NBSP}jours.`,
    },
    {
      family: 'ransomware', label: 'Revendications', score: clamp(Math.min(FAMILY_CAPS.ransomware, claimsRaw)), cap: FAMILY_CAPS.ransomware,
      eventCount: claimsFresh ? ransomware.weekCount : 0,
      explanation: `Revendications de la semaine : ${claimsText} (nul à la moyenne, plein à 3${NBSP}fois).`,
    },
    {
      family: 'vulnerabilities', label: 'Vulnérabilités exploitées citées', score: clamp(Math.min(FAMILY_CAPS.vulnerabilities, kevRaw)),
      cap: FAMILY_CAPS.vulnerabilities, eventCount: kevCited.length,
      explanation: `${plural(kevCited.length, 'vulnérabilité exploitée citée', 'vulnérabilités exploitées citées')} par le CERT-FR, ajoutées au catalogue KEV de la CISA depuis 30${NBSP}jours.`,
    },
    {
      family: 'exposure', label: 'Exposition (retirée)', score: 0, cap: FAMILY_CAPS.exposure, eventCount: 0,
      explanation: 'Retirée : aucune mesure gratuite et sourcée.',
    },
    {
      family: 'correlation', label: 'Corrélations', score: clamp(Math.min(FAMILY_CAPS.correlation, correlationRaw)), cap: FAMILY_CAPS.correlation,
      eventCount: criticalSectorClaims30d,
      explanation: `Revendications dans un secteur critique sur 30${NBSP}jours, renforcées par des pannes réseau concomitantes.`,
    },
  ];

  const top = [...breakdown].sort((a, b) => b.score - a.score)[0];
  return {
    score: clamp(breakdown.reduce((sum, item) => sum + item.score, 0)),
    inputs: { leaks30d, claimsRatio, kevCited30d: kevCited.length, openAlerts, kevAdvisories7d, criticalSectorClaims30d },
    dominantFamily: top !== undefined && top.score > 0 ? top.family : null,
    breakdown,
  };
}
