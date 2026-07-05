/**
 * vigilance-meteo.ts — Service vigilance Météo-France.
 *
 * Passe par le proxy serveur /api/weather/vigilance (la clé API reste côté serveur).
 *
 * Doc API : https://portail-api.meteofrance.fr/web/fr/api/DPVigilance
 *
 * Fonctionnalités :
 * - Alertes par département avec niveau de vigilance
 * - Support des tranches horaires de 3h (timeline)
 * - Centroïdes départements pour affichage pictogrammes
 */

import type { MeteoAlert, MeteoVigilanceLevel, MeteoRiskType } from '../types/index.ts';
import { Watchdog } from './watchdog.ts';
import type { IconName } from '../components/shared/icons.ts';

// ── Watchdog registration ──
Watchdog.register('meteo-france', {
    label: 'Météo-France',
    staleAfterMs: 15 * 60_000,
    detail: 'Proxy serveur /api/weather/vigilance (clé côté serveur)',
});

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

/** Tranche horaire de vigilance (période de 3h) */
export interface VigilanceTimeSlot {
  index: number;           // 0-7 (8 tranches sur 24h)
  startTime: Date;
  endTime: Date;
  label: string;           // "00h-03h", "03h-06h", etc.
  alerts: MeteoAlert[];
}

/** Réponse complète avec toutes les tranches horaires */
export interface VigilanceTimeline {
  currentSlotIndex: number;
  slots: VigilanceTimeSlot[];
  currentDayAlerts: MeteoAlert[];
  currentDayDate: Date;
  nextDayAlerts: MeteoAlert[];
  nextDayDate: Date | null;
  fetchedAt: Date;
}

/** Pictogramme de risque météo — icône Lucide (`fmIcon`), plus de glyphe emoji. */
export interface RiskPictogram {
  type: MeteoRiskType;
  icon: IconName;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAPPINGS
// ═══════════════════════════════════════════════════════════════════════════════

const DEPT_NAMES: Record<string, string> = {
    '01': 'Ain', '02': 'Aisne', '03': 'Allier', '04': 'Alpes-de-Haute-Provence',
    '05': 'Hautes-Alpes', '06': 'Alpes-Maritimes', '07': 'Ardèche', '08': 'Ardennes',
    '09': 'Ariège', '10': 'Aube', '11': 'Aude', '12': 'Aveyron',
    '13': 'Bouches-du-Rhône', '14': 'Calvados', '15': 'Cantal', '16': 'Charente',
    '17': 'Charente-Maritime', '18': 'Cher', '19': 'Corrèze', '21': 'Côte-d\'Or',
    '22': 'Côtes-d\'Armor', '23': 'Creuse', '24': 'Dordogne', '25': 'Doubs',
    '26': 'Drôme', '27': 'Eure', '28': 'Eure-et-Loir', '29': 'Finistère',
    '2A': 'Corse-du-Sud', '2B': 'Haute-Corse', '30': 'Gard', '31': 'Haute-Garonne',
    '32': 'Gers', '33': 'Gironde', '34': 'Hérault', '35': 'Ille-et-Vilaine',
    '36': 'Indre', '37': 'Indre-et-Loire', '38': 'Isère', '39': 'Jura',
    '40': 'Landes', '41': 'Loir-et-Cher', '42': 'Loire', '43': 'Haute-Loire',
    '44': 'Loire-Atlantique', '45': 'Loiret', '46': 'Lot', '47': 'Lot-et-Garonne',
    '48': 'Lozère', '49': 'Maine-et-Loire', '50': 'Manche', '51': 'Marne',
    '52': 'Haute-Marne', '53': 'Mayenne', '54': 'Meurthe-et-Moselle', '55': 'Meuse',
    '56': 'Morbihan', '57': 'Moselle', '58': 'Nièvre', '59': 'Nord',
    '60': 'Oise', '61': 'Orne', '62': 'Pas-de-Calais', '63': 'Puy-de-Dôme',
    '64': 'Pyrénées-Atlantiques', '65': 'Hautes-Pyrénées', '66': 'Pyrénées-Orientales',
    '67': 'Bas-Rhin', '68': 'Haut-Rhin', '69': 'Rhône', '70': 'Haute-Saône',
    '71': 'Saône-et-Loire', '72': 'Sarthe', '73': 'Savoie', '74': 'Haute-Savoie',
    '75': 'Paris', '76': 'Seine-Maritime', '77': 'Seine-et-Marne', '78': 'Yvelines',
    '79': 'Deux-Sèvres', '80': 'Somme', '81': 'Tarn', '82': 'Tarn-et-Garonne',
    '83': 'Var', '84': 'Vaucluse', '85': 'Vendée', '86': 'Vienne',
    '87': 'Haute-Vienne', '88': 'Vosges', '89': 'Yonne', '90': 'Territoire de Belfort',
    '91': 'Essonne', '92': 'Hauts-de-Seine', '93': 'Seine-Saint-Denis',
    '94': 'Val-de-Marne', '95': 'Val-d\'Oise',
    // DROM-COM
    '971': 'Guadeloupe', '972': 'Martinique', '973': 'Guyane',
    '974': 'La Réunion', '976': 'Mayotte',
};

const RISK_MAP: Record<number, MeteoRiskType> = {
    1: 'wind',          // Vent violent
    2: 'rain-flood',    // Pluie-inondation
    3: 'thunderstorm',  // Orages
    4: 'flood',         // Crues (Il manquait ici !)
    5: 'snow-ice',      // Neige-verglas
    6: 'heat',          // Canicule
    7: 'cold',          // Grand froid
    8: 'avalanche',     // Avalanches
    9: 'wave-surge',    // Vagues-submersion
};

const LEVEL_MAP: Record<number, MeteoVigilanceLevel> = {
    1: 'green',
    2: 'yellow',
    3: 'orange',
    4: 'red',
};

// ═══════════════════════════════════════════════════════════════════════════════
// CENTROIDES DÉPARTEMENTS [lng, lat]
// ═══════════════════════════════════════════════════════════════════════════════

export const DEPT_CENTROIDS: Record<string, [number, number]> = {
    '01': [5.22, 46.00], '02': [3.62, 49.47], '03': [3.19, 46.39], '04': [6.24, 44.08],
    '05': [6.26, 44.66], '06': [7.12, 43.94], '07': [4.42, 44.75], '08': [4.62, 49.62],
    '09': [1.60, 42.92], '10': [4.08, 48.30], '11': [2.42, 43.11], '12': [2.67, 44.28],
    '13': [5.05, 43.54], '14': [-0.37, 49.09], '15': [2.67, 45.05], '16': [0.19, 45.72],
    '17': [-0.83, 45.75], '18': [2.50, 47.07], '19': [1.87, 45.35], '21': [4.90, 47.42],
    '22': [-2.97, 48.44], '23': [2.07, 46.08], '24': [0.75, 45.14], '25': [6.36, 47.17],
    '26': [5.17, 44.68], '27': [0.97, 49.11], '28': [1.38, 48.31], '29': [-4.10, 48.26],
    '2A': [8.92, 41.86], '2B': [9.29, 42.40], '30': [4.18, 43.99], '31': [1.18, 43.35],
    '32': [0.45, 43.69], '33': [-0.58, 44.83], '34': [3.58, 43.59], '35': [-1.68, 48.11],
    '36': [1.57, 46.78], '37': [0.69, 47.26], '38': [5.58, 45.26], '39': [5.69, 46.73],
    '40': [-0.77, 43.89], '41': [1.41, 47.62], '42': [4.16, 45.73], '43': [3.85, 45.11],
    '44': [-1.68, 47.36], '45': [2.10, 47.91], '46': [1.62, 44.62], '47': [0.46, 44.34],
    '48': [3.50, 44.52], '49': [-0.56, 47.39], '50': [-1.32, 49.08], '51': [4.07, 48.96],
    '52': [5.14, 48.11], '53': [-0.77, 48.07], '54': [6.17, 48.79], '55': [5.38, 49.00],
    '56': [-2.82, 47.74], '57': [6.67, 49.04], '58': [3.50, 47.11], '59': [3.22, 50.45],
    '60': [2.42, 49.42], '61': [0.11, 48.62], '62': [2.28, 50.51], '63': [3.13, 45.73],
    '64': [-0.77, 43.26], '65': [0.15, 43.05], '66': [2.53, 42.60], '67': [7.55, 48.67],
    '68': [7.21, 47.86], '69': [4.61, 45.87], '70': [6.08, 47.62], '71': [4.53, 46.64],
    '72': [0.20, 47.93], '73': [6.39, 45.49], '74': [6.42, 46.04], '75': [2.35, 48.86],
    '76': [0.97, 49.66], '77': [2.99, 48.62], '78': [1.83, 48.83], '79': [-0.33, 46.52],
    '80': [2.28, 49.92], '81': [2.17, 43.79], '82': [1.29, 44.08], '83': [6.22, 43.47],
    '84': [5.19, 44.05], '85': [-1.29, 46.68], '86': [0.46, 46.56], '87': [1.24, 45.89],
    '88': [6.37, 48.17], '89': [3.56, 47.84], '90': [6.92, 47.63], '91': [2.24, 48.52],
    '92': [2.24, 48.84], '93': [2.48, 48.91], '94': [2.47, 48.78], '95': [2.12, 49.08],
    // DROM-COM
    '971': [-61.55, 16.25], '972': [-61.02, 14.64], '973': [-53.13, 3.92],
    '974': [55.54, -21.12], '976': [45.15, -12.84],
};

// ═══════════════════════════════════════════════════════════════════════════════
// PICTOGRAMMES RISQUES (icône Lucide + description)
// ═══════════════════════════════════════════════════════════════════════════════

export const RISK_PICTOGRAMS: Record<MeteoRiskType, RiskPictogram> = {
    'wind': { type: 'wind', icon: 'wind' },
    'rain-flood': { type: 'rain-flood', icon: 'cloud-rain' },
    'thunderstorm': { type: 'thunderstorm', icon: 'cloud-lightning' },
    'flood': { type: 'flood', icon: 'waves' },
    'snow-ice': { type: 'snow-ice', icon: 'snowflake' },
    'heat': { type: 'heat', icon: 'thermometer' },
    'cold': { type: 'cold', icon: 'thermometer-snowflake' },
    'avalanche': { type: 'avalanche', icon: 'mountain-snow' },
    'wave-surge': { type: 'wave-surge', icon: 'waves' },
};

/** Retourne l'icône du risque principal (le premier, généralement le plus grave) */
export function getPrimaryRiskIcon(risks: MeteoRiskType[]): IconName {
    if (risks.length === 0) return 'triangle-alert';
    return RISK_PICTOGRAMS[risks[0]]?.icon ?? 'triangle-alert';
}

/** Retourne toutes les icônes de risques (dédoublonnage laissé au consommateur) */
export function getAllRiskIcons(risks: MeteoRiskType[]): IconName[] {
    return risks
        .map(r => RISK_PICTOGRAMS[r]?.icon)
        .filter((icon): icon is IconName => icon !== undefined);
}

// ═══════════════════════════════════════════════════════════════════════════════
// CACHE
// ═══════════════════════════════════════════════════════════════════════════════

let cache: { data: MeteoAlert[]; fetchedAt: number } | null = null;
let timelineCache: { data: VigilanceTimeline; fetchedAt: number } | null = null;
const CACHE_TTL = 15 * 60_000; // 15 min

// ═══════════════════════════════════════════════════════════════════════════════
// TIMELINE HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/** Génère les labels des 8 tranches de 3h sur 24h */
function generateTimeSlotLabels(): string[] {
    return [
        '00h-03h', '03h-06h', '06h-09h', '09h-12h',
        '12h-15h', '15h-18h', '18h-21h', '21h-00h'
    ];
}

/** Calcule l'index de la tranche horaire actuelle (0-7) */
function getCurrentSlotIndex(): number {
    const now = new Date();
    return Math.floor(now.getHours() / 3);
}

/** Génère les dates de début/fin pour une tranche donnée */
function getSlotTimes(slotIndex: number, baseDate: Date = new Date()): { start: Date; end: Date } {
    const start = new Date(baseDate);
    start.setHours(slotIndex * 3, 0, 0, 0);
    const end = new Date(start);
    end.setHours(start.getHours() + 3);
    return { start, end };
}

function getStartOfDay(date: Date): Date {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    return start;
}

function getNextDayDate(baseDate: Date = new Date()): Date {
    const nextDay = getStartOfDay(baseDate);
    nextDay.setDate(nextDay.getDate() + 1);
    return nextDay;
}

function isCurrentDayEcheance(value: string | undefined): boolean {
    if (!value) return false;
    const normalized = value.trim().toUpperCase();
    return normalized === 'J' || normalized === 'J0' || normalized === 'J+0' || normalized === 'D' || normalized === 'D0' || normalized === 'D+0';
}

function getDayOffset(date: Date, baseDate: Date = new Date()): number {
    const current = getStartOfDay(baseDate).getTime();
    const target = getStartOfDay(date).getTime();
    return Math.round((target - current) / 86_400_000);
}

function parsePeriodDate(period: PeriodItem): Date | null {
    const rawDate = period.begin_validity_time
        ?? period.echeance?.split('/')[0]
        ?? null;
    if (!rawDate) return null;

    const parsed = new Date(rawDate);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isNextDayEcheance(value: string | undefined): boolean {
    if (!value) return false;
    const normalized = value.trim().toUpperCase();
    return normalized === 'J1' || normalized === 'J+1' || normalized === 'D1' || normalized === 'D+1';
}

function getPeriodDayOffset(period: PeriodItem, baseDate: Date = new Date()): number | null {
    if (isCurrentDayEcheance(period.echeance)) return 0;
    if (isNextDayEcheance(period.echeance)) return 1;

    const periodDate = parsePeriodDate(period);
    return periodDate ? getDayOffset(periodDate, baseDate) : null;
}

function mergeAlerts(target: MeteoAlert[], alerts: MeteoAlert[]): void {
    for (const alert of alerts) {
        const existing = target.find((item) => item.departmentCode === alert.departmentCode);
        if (!existing) {
            target.push({ ...alert, risks: [...alert.risks] });
        } else if (levelToNumber(alert.level) > levelToNumber(existing.level)) {
            existing.level = alert.level;
            existing.risks = [...new Set([...existing.risks, ...alert.risks])];
        } else {
            existing.risks = [...new Set([...existing.risks, ...alert.risks])];
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES API
// ═══════════════════════════════════════════════════════════════════════════════

interface PhenomenonItem {
    phenomenon_id: number;
    phenomenon_max_color_id: number;
}

interface DomainItem {
    domain_id: string;
    max_color_id: number;
    phenomenon_items?: PhenomenonItem[];
}

interface TimelapsItem {
    echeance?: string;  // "J", "J1", etc. ou datetime ISO
    domain_ids?: DomainItem[];
}

interface PeriodItem {
    echeance?: string;           // Période ex: "2026-03-06T00:00:00Z/2026-03-06T03:00:00Z"
    begin_validity_time?: string;
    end_validity_time?: string;
    timelaps?: TimelapsItem | TimelapsItem[];
}

interface VigilanceApiResponse {
    product?: {
        periods?: PeriodItem[];
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// FETCH
// ═══════════════════════════════════════════════════════════════════════════════

// Proxy serveur : la clé Météo-France (header apikey) est ajoutée côté serveur.
const API_URL = '/api/weather/vigilance';

/**
 * Fetch alertes de vigilance Météo-France.
 * Retourne uniquement les départements en alerte (jaune+).
 *
 * Authentification gérée côté serveur (proxy /api/weather/vigilance).
 */
export async function fetchVigilanceMeteo(): Promise<MeteoAlert[]> {
    // Retourner le cache s'il est valide
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL) {
        return cache.data;
    }

    Watchdog.report('meteo-france', { type: 'loading' });
    const t0 = Date.now();

    try {
        const resp = await fetch(API_URL, {
            headers: {
                'Accept': 'application/json',
            },
            signal: AbortSignal.timeout(8000),
        });

        // Vérifier que la réponse est bien du JSON avant de parser
        const contentType = resp.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            console.warn(`[MeteoFrance] Unexpected content-type: ${contentType}`);
            const text = await resp.text();
            console.warn(`[MeteoFrance] Response preview: ${text.slice(0, 100)}...`);
            Watchdog.report('meteo-france', { type: 'failure', error: `content-type inattendu: ${contentType}`, isFallback: !!cache });
            return cache?.data ?? [];
        }

        // Gérer les erreurs HTTP
        if (resp.status === 401 || resp.status === 403) {
            console.warn(`[MeteoFrance] Auth error ${resp.status} - check API key`);
            Watchdog.report('meteo-france', { type: 'failure', error: `Auth ${resp.status} - vérifier apikey`, isFallback: !!cache });
            return cache?.data ?? [];
        }
        if (!resp.ok) {
            console.warn(`[MeteoFrance] HTTP error ${resp.status}`);
            Watchdog.report('meteo-france', { type: 'failure', error: `HTTP ${resp.status}`, isFallback: !!cache });
            return cache?.data ?? [];
        }

        // Parser la réponse JSON
        const json = await resp.json() as VigilanceApiResponse;
        const alerts = parseVigilanceResponse(json);

        // Mettre en cache
        cache = { data: alerts, fetchedAt: Date.now() };
        Watchdog.report('meteo-france', { type: 'success', responseTimeMs: Date.now() - t0 });
        console.log(`[MeteoFrance] ${alerts.length} départements en alerte`);
        return alerts;

    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[MeteoFrance] Fetch failed: ${msg}`);
        Watchdog.report('meteo-france', { type: 'failure', error: msg, isFallback: !!cache });
        return cache?.data ?? [];
    }
}

/**
 * Fetch la timeline complète de vigilance avec toutes les tranches horaires de 3h.
 * Permet de filtrer les alertes par créneau horaire.
 */
export async function fetchVigilanceTimeline(): Promise<VigilanceTimeline> {
    // Retourner le cache s'il est valide
    if (timelineCache && Date.now() - timelineCache.fetchedAt < CACHE_TTL) {
        return timelineCache.data;
    }

    try {
        const resp = await fetch(API_URL, {
            headers: {
                'Accept': 'application/json',
            },
            signal: AbortSignal.timeout(8000),
        });

        const contentType = resp.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            console.warn(`[MeteoFrance] Unexpected content-type: ${contentType}`);
            return timelineCache?.data ?? createEmptyTimeline();
        }

        if (!resp.ok) {
            console.warn(`[MeteoFrance] HTTP error ${resp.status}`);
            return timelineCache?.data ?? createEmptyTimeline();
        }

        const json = await resp.json() as VigilanceApiResponse;
        const timeline = parseVigilanceTimeline(json);

        // Mettre en cache
        timelineCache = { data: timeline, fetchedAt: Date.now() };
        console.log(`[MeteoFrance] Timeline fetched, ${timeline.slots.filter(s => s.alerts.length > 0).length} slots with alerts`);
        return timeline;

    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[MeteoFrance] Timeline fetch failed: ${msg}`);
        return timelineCache?.data ?? createEmptyTimeline();
    }
}

/** Crée une timeline vide */
function createEmptyTimeline(): VigilanceTimeline {
    const labels = generateTimeSlotLabels();
    const now = new Date();
    return {
        currentSlotIndex: getCurrentSlotIndex(),
        currentDayAlerts: [],
        currentDayDate: getStartOfDay(now),
        nextDayAlerts: [],
        nextDayDate: getNextDayDate(now),
        slots: labels.map((label, index) => {
            const { start, end } = getSlotTimes(index, now);
            return { index, startTime: start, endTime: end, label, alerts: [] };
        }),
        fetchedAt: new Date(),
    };
}

/**
 * Filtre les alertes pour une tranche horaire spécifique.
 */
export function getAlertsForTimeSlot(timeline: VigilanceTimeline, slotIndex: number): MeteoAlert[] {
    if (slotIndex < 0 || slotIndex >= timeline.slots.length) {
        return [];
    }
    return timeline.slots[slotIndex].alerts;
}

/**
 * Retourne le centroïde d'un département.
 */
export function getDepartmentCentroid(departmentCode: string): [number, number] | null {
    return DEPT_CENTROIDS[departmentCode] ?? null;
}

/**
 * Extrait les domain_ids depuis un timelaps (objet ou tableau).
 */
function extractDomains(timelaps: TimelapsItem | TimelapsItem[] | undefined): DomainItem[] {
    if (!timelaps) return [];
    if (Array.isArray(timelaps)) {
        // Prendre le premier timelaps (période courante)
        return timelaps[0]?.domain_ids ?? [];
    }
    return timelaps.domain_ids ?? [];
}

function getPeriodTimelaps(period: PeriodItem | undefined): TimelapsItem[] {
    if (!period?.timelaps) return [];
    return Array.isArray(period.timelaps) ? period.timelaps : [period.timelaps];
}

function getPeriodAlerts(period: PeriodItem | undefined): MeteoAlert[] {
    const alerts: MeteoAlert[] = [];
    for (const tl of getPeriodTimelaps(period)) {
        mergeAlerts(alerts, parseDomainsToAlerts(tl.domain_ids ?? []));
    }
    return alerts;
}

/**
 * Parse les domains en MeteoAlert[].
 */
function parseDomainsToAlerts(domains: DomainItem[]): MeteoAlert[] {
    const alerts: MeteoAlert[] = [];

    for (const domain of domains) {
        const code = domain.domain_id;

        // Ignorer les codes non-départementaux (FRA, 99, etc.)
        if (!DEPT_NAMES[code]) continue;

        const maxLevel = domain.max_color_id;

        // Ne garder que jaune (2) et au-dessus
        if (maxLevel < 2) continue;

        const risks: MeteoRiskType[] = [];
        for (const phenom of domain.phenomenon_items ?? []) {
            if (phenom.phenomenon_max_color_id >= 2) {
                const risk = RISK_MAP[phenom.phenomenon_id];
                if (risk) risks.push(risk);
            }
        }

        alerts.push({
            department: DEPT_NAMES[code] ?? `Dept ${code}`,
            departmentCode: code,
            level: LEVEL_MAP[maxLevel] ?? 'yellow',
            risks,
        });
    }

    return alerts;
}

/**
 * Parse la réponse JSON de l'API cartevigilance/encours.
 */
function parseVigilanceResponse(json: VigilanceApiResponse): MeteoAlert[] {
    const periods = json.product?.periods ?? [];
    const currentPeriod = periods.find((period) => isCurrentDayEcheance(period.echeance))
        ?? periods.find((period) => getPeriodDayOffset(period) === 0)
        ?? periods[0];
    const domains = extractDomains(currentPeriod?.timelaps);
    return parseDomainsToAlerts(domains);
}

/**
 * Parse la réponse JSON en timeline complète avec toutes les tranches horaires.
 */
function parseVigilanceTimeline(json: VigilanceApiResponse): VigilanceTimeline {
    const labels = generateTimeSlotLabels();
    const currentSlotIndex = getCurrentSlotIndex();
    const now = new Date();

    const slots: VigilanceTimeSlot[] = labels.map((label, index) => {
        const { start, end } = getSlotTimes(index, now);
        return {
            index,
            startTime: start,
            endTime: end,
            label,
            alerts: [],
        };
    });
    const currentDayAlerts: MeteoAlert[] = [];
    const currentDayDate = getStartOfDay(now);
    const nextDayAlerts: MeteoAlert[] = [];
    const nextDayDate = getNextDayDate(now);

    // L'API peut retourner plusieurs périodes avec différentes échéances
    const periods = json.product?.periods ?? [];

    for (const period of periods) {
        const timelaps = period.timelaps;
        if (!timelaps) continue;

        // Gérer le cas où timelaps est un tableau
        const timelapsArray = getPeriodTimelaps(period);
        const periodDayOffset = getPeriodDayOffset(period, now);

        for (const tl of timelapsArray) {
            const domains = tl.domain_ids ?? [];
            const alerts = parseDomainsToAlerts(domains);
            const tlIsCurrentDay = isCurrentDayEcheance(tl.echeance) || periodDayOffset === 0;
            const tlIsNextDay = isNextDayEcheance(tl.echeance) || periodDayOffset === 1;

            if (tlIsNextDay) {
                mergeAlerts(nextDayAlerts, alerts);
                continue;
            }

            if (tlIsCurrentDay) {
                mergeAlerts(currentDayAlerts, alerts);
            }

            // Déterminer à quelle tranche appartient cette période
            // Par défaut, on utilise la période actuelle
            let targetSlotIndex = currentSlotIndex;

            if (period.begin_validity_time) {
                const beginDate = new Date(period.begin_validity_time);
                targetSlotIndex = Math.floor(beginDate.getHours() / 3);
            }

            // Ajouter les alertes à la tranche correspondante
            if (targetSlotIndex >= 0 && targetSlotIndex < slots.length) {
                // Fusionner les alertes en évitant les doublons.
                mergeAlerts(slots[targetSlotIndex].alerts, alerts);
            }
        }
    }

    // Si aucune période spécifique, mettre toutes les alertes dans la tranche actuelle
    if (periods.length === 1 && slots[currentSlotIndex].alerts.length === 0) {
        const alerts = getPeriodAlerts(periods[0]);
        slots[currentSlotIndex].alerts = alerts;
        mergeAlerts(currentDayAlerts, alerts);
    }

    return {
        currentSlotIndex,
        slots,
        currentDayAlerts,
        currentDayDate,
        nextDayAlerts,
        nextDayDate,
        fetchedAt: new Date(),
    };
}

/** Convertit un niveau de vigilance en nombre pour comparaison */
function levelToNumber(level: MeteoVigilanceLevel): number {
    const map: Record<MeteoVigilanceLevel, number> = {
        green: 0,
        yellow: 1,
        orange: 2,
        red: 3,
        violet: 4,
    };
    return map[level] ?? 0;
}
