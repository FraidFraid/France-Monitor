/**
 * Service Cybersécurité Nationale
 *
 * Agrège 3 sources Open Data :
 * - CERT-FR (ANSSI) : Alertes et avis de sécurité via RSS
 * - RansomwareLive : Tracker victimes ransomware (API publique)
 * - NVD (NIST) : Base CVE (API publique)
 *
 * Calcule un score de tension cyber 0-100 avec pondération configurable.
 */

import type {
  CyberState,
  CyberAlert,
  CyberCVE,
  CyberRansomwareVictim,
  CyberSourceStatus,
  CyberSeverity,
} from '../types';
import { CYBER_THRESHOLDS } from '../types';

// ═══ Cache ═══

interface CyberCache {
  data: CyberState;
  fetchedAt: number;
}

let cache: CyberCache | null = null;
const CACHE_TTL = 5 * 60_000; // 5 minutes

// ═══ API URLs ═══

// CERT-FR RSS (via notre proxy pour éviter CORS)
const CERT_FR_RSS_URL = import.meta.env.PROD
  ? '/api/rss'
  : 'http://localhost:3001/api/rss';

// Proxy JSON pour APIs externes (contourne CORS/403)
const JSON_PROXY_URL = import.meta.env.PROD
  ? '/api/json-proxy'
  : 'http://localhost:3001/api/json-proxy';

// RansomwareLive API (via proxy pour éviter CORS)
const RANSOMWARE_API_URL = 'https://data.ransomware.live/posts.json';

// NVD API (via proxy pour éviter rate limiting et CORS)
const NVD_API_URL = 'https://services.nvd.nist.gov/rest/json/cves/2.0';

// ═══ Fetch CERT-FR Alerts (via RSS proxy) ═══

interface CertFrRawItem {
  title: string;
  link: string;
  pubDate: string;
  description?: string;
}

function parseSeverityFromTitle(title: string): CyberSeverity {
  const lower = title.toLowerCase();
  const upper = title.toUpperCase();

  // Mots-clés critiques explicites
  const criticalKeywords = [
    'critique', 'critical',
    'exécution de code à distance', 'remote code execution',
    'vulnérabilité critique',
    '0-day', 'zero-day', 'zeroday',
  ];

  if (criticalKeywords.some(kw => lower.includes(kw))) {
    return 'critical';
  }

  // CERTFR-2026-ALE = Alerte CERT-FR → sévérité high par défaut
  // Format: CERTFR-YYYY-ALE-NNN (Alerte) vs CERTFR-YYYY-AVI-NNN (Avis)
  if (upper.includes('CERTFR-') && upper.includes('-ALE')) {
    return 'high';
  }

  // Autres mots-clés high/medium
  if (lower.includes('importante') || lower.includes('high') || lower.includes('élevé')) {
    return 'high';
  }
  if (lower.includes('moyenne') || lower.includes('medium') || lower.includes('modéré')) {
    return 'medium';
  }

  return 'low';
}

async function fetchCertFrAlerts(): Promise<{ alerts: CyberAlert[]; status: CyberSourceStatus }> {
  const now = new Date().toISOString();
  const certFrFeedUrl = 'https://www.cert.ssi.gouv.fr/feed/';
  const proxyUrl = `${CERT_FR_RSS_URL}?url=${encodeURIComponent(certFrFeedUrl)}`;

  try {
    const resp = await fetch(proxyUrl, {
      signal: AbortSignal.timeout(10_000),
    });

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
    }

    const data = await resp.json();
    const items: CertFrRawItem[] = data.items || [];

    if (items.length === 0) {
      console.warn('[Cyber/CERT-FR] No items in response');
    }

    // Filtrer les 30 derniers jours
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

    const alerts: CyberAlert[] = items
      .filter((item) => new Date(item.pubDate).getTime() > thirtyDaysAgo)
      .map((item, idx) => ({
        id: `cert-${idx}-${Date.now()}`,
        title: item.title || 'Sans titre',
        severity: parseSeverityFromTitle(item.title || ''),
        url: item.link || '#',
        date: item.pubDate || now,
        source: 'CERT-FR' as const,
      }))
      .slice(0, 20);

    return {
      alerts,
      status: { source: 'CERT-FR', isUp: true, lastSync: now },
    };
  } catch (err) {
    console.error('[Cyber/CERT-FR] Fetch FAILED:', err);
    return {
      alerts: [],
      status: { source: 'CERT-FR', isUp: false, lastSync: now, error: String(err) },
    };
  }
}

// ═══ Fetch Ransomware Victims (RansomwareLive) ═══

interface RansomwareRawVictim {
  post_title: string;
  country: string;
  activity?: string;
  discovered: string;
  group_name: string;
}

async function fetchRansomwareData(): Promise<{
  total30d: number;
  topSectors: CyberRansomwareVictim[];
  status: CyberSourceStatus;
}> {
  const now = new Date().toISOString();

  // Utiliser le proxy JSON pour contourner CORS
  const proxyUrl = `${JSON_PROXY_URL}?url=${encodeURIComponent(RANSOMWARE_API_URL)}`;

  try {
    const resp = await fetch(proxyUrl, {
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
    }

    const rawData = await resp.json();
    const victims: RansomwareRawVictim[] = Array.isArray(rawData) ? rawData : [];

    // Filtrer victimes françaises des 30 derniers jours
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

    const frenchVictims = victims.filter((v) => {
      const country = (v.country || '').toLowerCase();
      const isFrench = country === 'france' || country === 'fr';
      const isRecent = new Date(v.discovered).getTime() > thirtyDaysAgo;
      return isFrench && isRecent;
    });

    // Agrégation par secteur
    const sectorCounts = new Map<string, number>();
    for (const v of frenchVictims) {
      const sector = v.activity || 'Inconnu';
      sectorCounts.set(sector, (sectorCounts.get(sector) || 0) + 1);
    }

    const topSectors: CyberRansomwareVictim[] = Array.from(sectorCounts.entries())
      .map(([sector, count]) => ({ sector, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      total30d: frenchVictims.length,
      topSectors,
      status: { source: 'RansomwareLive', isUp: true, lastSync: now },
    };
  } catch (err) {
    console.error('[Cyber/Ransomware] Fetch FAILED:', err);
    return {
      total30d: 0,
      topSectors: [],
      status: { source: 'RansomwareLive', isUp: false, lastSync: now, error: String(err) },
    };
  }
}

// ═══ Fetch CVEs (NVD) ═══

interface NvdCveItem {
  id: string;
  metrics?: {
    cvssMetricV31?: Array<{
      cvssData: {
        baseScore: number;
      };
    }>;
  };
  descriptions?: Array<{
    lang: string;
    value: string;
  }>;
  configurations?: Array<{
    nodes?: Array<{
      cpeMatch?: Array<{
        criteria: string;
      }>;
    }>;
  }>;
}

interface NvdResponse {
  vulnerabilities?: Array<{
    cve: NvdCveItem;
  }>;
}

function extractTargetFromCpe(cve: NvdCveItem): string {
  try {
    const cpeMatch = cve.configurations?.[0]?.nodes?.[0]?.cpeMatch?.[0];
    if (cpeMatch?.criteria) {
      // Format: cpe:2.3:a:vendor:product:version:...
      const parts = cpeMatch.criteria.split(':');
      if (parts.length >= 5) {
        return `${parts[3]}/${parts[4]}`.replace(/_/g, ' ');
      }
    }
  } catch {
    // ignore
  }
  return 'Divers';
}

async function fetchNvdCves(): Promise<{ criticalCount: number; topCVEs: CyberCVE[]; status: CyberSourceStatus }> {
  const now = new Date().toISOString();
  try {
    // Le NIST 2.0 exige un format YYYY-MM-DDTHH:mm:ss (sans millisecondes ni 'Z')
    // Il nécessite impérativement pubStartDate ET pubEndDate pour éviter le 404
    const dateStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const dateEnd = new Date();

    const pubStartDate = dateStart.toISOString().split('.')[0];
    const pubEndDate = dateEnd.toISOString().split('.')[0];

    const nvdUrl = `${NVD_API_URL}?pubStartDate=${pubStartDate}&pubEndDate=${pubEndDate}&cvssV3Severity=CRITICAL&resultsPerPage=20`;
    const proxyUrl = `${JSON_PROXY_URL}?url=${encodeURIComponent(nvdUrl)}`;

    const resp = await fetch(proxyUrl, { signal: AbortSignal.timeout(20_000) });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    // Utilisation de l'interface NvdResponse pour typer la réponse et supprimer l'alerte "declared but never used"
    const data = (await resp.json()) as NvdResponse;
    const items = data.vulnerabilities || [];

    const topCVEs: CyberCVE[] = items.map((item) => {
      const cve = item.cve;
      return {
        id: cve.id,
        score: cve.metrics?.cvssMetricV31?.[0]?.cvssData?.baseScore || 0,
        target: extractTargetFromCpe(cve), // Utilise ta fonction utilitaire
        url: `https://nvd.nist.gov/vuln/detail/${cve.id}`,
      };
    })
      .filter((cve) => cve.score >= 9.0) // On ne garde que le très critique
      .sort((a, b) => b.score - a.score);

    return {
      criticalCount: topCVEs.length,
      topCVEs,
      status: { source: 'NVD', isUp: true, lastSync: now }
    };
  } catch (err) {
    console.error('[Cyber/NVD] Fetch failed:', err);
    return {
      criticalCount: 0,
      topCVEs: [],
      status: { source: 'NVD', isUp: false, lastSync: now, error: String(err) }
    };
  }
}

// ═══ Calcul du Score Global ═══

interface ScoreInputs {
  certCriticalCount: number;
  certHighCount: number;
  ransomwareCount: number;
  cveCriticalCount: number;
  hasCriticalCertAlert: boolean;
}

function calculateGlobalScore(inputs: ScoreInputs, sources: CyberSourceStatus[]): number {
  const T = CYBER_THRESHOLDS;

  // Vérifier si des sources cruciales sont tombées
  const criticalSourcesDown = sources.some(s => !s.isUp && (s.source === 'CERT-FR' || s.source === 'RansomwareLive'));

  let globalScore = (inputs.certHighCount * 5) + (inputs.ransomwareCount * 10) + (inputs.cveCriticalCount * 2);

  // Plancher de sécurité si alerte critique CERT-FR
  if (inputs.hasCriticalCertAlert) {
    globalScore = Math.max(globalScore, T.CRITICAL_FLOOR);
  }
  // ÉTAT DÉGRADÉ : Si les sources sont en erreur ou timeout, on force 50 (Orange)
  else if (criticalSourcesDown && globalScore < 50) {
    return 50;
  }

  return Math.round(Math.min(globalScore, 100));
}

function determineTrend(currentScore: number, previousScore?: number): 'rising' | 'stable' | 'falling' {
  if (previousScore === undefined) return 'stable';
  const delta = currentScore - previousScore;
  if (delta > 5) return 'rising';
  if (delta < -5) return 'falling';
  return 'stable';
}

// ═══ Main Fetch Function ═══

let previousScore: number | undefined;
let fetchInFlight: Promise<CyberState> | null = null;

export async function fetchCyberDashboard(): Promise<CyberState> {
  // Check cache
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL) {
    return cache.data;
  }

  // Deduplicate concurrent calls (race condition guard)
  if (fetchInFlight) {
    return fetchInFlight;
  }

  fetchInFlight = (async (): Promise<CyberState> => {
    // Fetch all sources in parallel
    const [certResult, ransomResult, nvdResult] = await Promise.all([
      fetchCertFrAlerts(),
      fetchRansomwareData(),
      fetchNvdCves(),
    ]);

    // Count severities for scoring
    const certCriticalCount = certResult.alerts.filter((a) => a.severity === 'critical').length;
    const certHighCount = certResult.alerts.filter((a) => a.severity === 'high').length;
    const hasCriticalCertAlert = certCriticalCount > 0;

    // Calcul du score avec les deux arguments requis : inputs ET sources
    const globalScore = calculateGlobalScore({
      certCriticalCount,
      certHighCount,
      ransomwareCount: ransomResult.total30d,
      cveCriticalCount: nvdResult.criticalCount,
      hasCriticalCertAlert,
    }, [certResult.status, ransomResult.status, nvdResult.status]);

    const trend = determineTrend(globalScore, previousScore);
    previousScore = globalScore;

    const state: CyberState = {
      meta: {
        globalScore,
        trend,
        sources: [
          certResult.status,
          ransomResult.status,
          nvdResult.status,
        ],
        lastUpdate: new Date(),
      },
      alerts: {
        count30d: certResult.alerts.length,
        latest: certResult.alerts.slice(0, 10),
      },
      ransomware: {
        total30d: ransomResult.total30d,
        topSectors: ransomResult.topSectors,
      },
      vulnerabilities: {
        criticalCount: nvdResult.criticalCount,
        topCVEs: nvdResult.topCVEs.slice(0, 5),
      },
    };

    // Update cache
    cache = { data: state, fetchedAt: Date.now() };
    console.log(`[Cyber] score=${globalScore} trend=${trend} alerts=${state.alerts.count30d} ransomware=${state.ransomware.total30d} cves=${state.vulnerabilities.criticalCount}`);

    return state;
  })().finally(() => { fetchInFlight = null; });

  return fetchInFlight;
}

// ═══ Helpers ═══

export function getCyberScoreColor(score: number): { color: string; label: string } {
  if (score <= 33) {
    return { color: '#10B981', label: 'Vigilance normale' };
  } else if (score <= 66) {
    return { color: '#F59E0B', label: 'Vigilance accrue' };
  } else {
    return { color: '#EF4444', label: 'Alerte cyber' };
  }
}

export function formatCyberDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
    });
  } catch {
    return dateStr;
  }
}

export function getSeverityColor(severity: CyberSeverity): string {
  switch (severity) {
    case 'critical':
      return '#EF4444'; // red-500
    case 'high':
      return '#F97316'; // orange-500
    case 'medium':
      return '#F59E0B'; // amber-500
    case 'low':
      return '#10B981'; // emerald-500
    default:
      return '#6B7280'; // gray-500
  }
}

// ═══ Feature Flag Check ═══

export function isCyberPanelEnabled(): boolean {
  return import.meta.env.VITE_ENABLE_CYBER_PANEL !== 'false';
}
