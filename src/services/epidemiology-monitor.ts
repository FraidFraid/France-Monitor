import type { AlerteEpidemique, StatutEpidemique } from '../types/index.ts';

export interface EpidemiologySourceConfig {
  source: AlerteEpidemique['source'];
  path: string;
  dataset_id?: string | null;
  stale_after_ms: number;
  refresh_after_ms: number;
}

export interface EpidemiologyIngestionLog {
  level: 'info' | 'warn' | 'error';
  at: string;
  source: string;
  message: string;
  details?: string;
}

export interface EpidemiologyIngestionResult {
  alerts: AlerteEpidemique[];
  logs: EpidemiologyIngestionLog[];
  checked_at: string;
}

export const SPF_ODISSE_WINTER_ALERTS_URL =
  'https://odisse.santepubliquefrance.fr/api/explore/v2.1/catalog/datasets/' +
  'ma_region_epidemies_hivernales_alertes/records?limit=400&order_by=-date';

export const SPF_DATAGOUV_COVID_DATASET_SEARCH_URL =
  'https://www.data.gouv.fr/api/1/datasets/?q=' +
  encodeURIComponent("Synthese des indicateurs de suivi de l'epidemie COVID-19") +
  '&page_size=5';

export const DEFAULT_EPIDEMIOLOGY_SOURCES: EpidemiologySourceConfig[] = [
  {
    source: 'SPF_Odisse',
    path: SPF_ODISSE_WINTER_ALERTS_URL,
    dataset_id: 'ma_region_epidemies_hivernales_alertes',
    stale_after_ms: 10 * 24 * 60 * 60 * 1000,
    refresh_after_ms: 12 * 60 * 60 * 1000,
  },
  {
    source: 'SPF_DataGouv',
    path: SPF_DATAGOUV_COVID_DATASET_SEARCH_URL,
    dataset_id: 'synthese-des-indicateurs-de-suivi-de-lepidemie-covid-19',
    stale_after_ms: 10 * 24 * 60 * 60 * 1000,
    refresh_after_ms: 12 * 60 * 60 * 1000,
  },
];

function parseDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isAlertObsolete(alert: Pick<AlerteEpidemique, 'date_maj_source'>, now = new Date(), thresholdMs = 10 * 24 * 60 * 60 * 1000): boolean {
  const sourceDate = parseDate(alert.date_maj_source);
  if (!sourceDate) return true;
  return now.getTime() - sourceDate.getTime() > thresholdMs;
}

export function shouldRefreshSource(lastCheckedAt: string | null | undefined, now = new Date(), thresholdMs = 12 * 60 * 60 * 1000): boolean {
  if (!lastCheckedAt) return true;
  const lastChecked = parseDate(lastCheckedAt);
  if (!lastChecked) return true;
  return now.getTime() - lastChecked.getTime() > thresholdMs;
}

export function deriveStatutFromOdiseeValue(rawValue: number): StatutEpidemique {
  if (rawValue >= 4) return 'epidemie';
  if (rawValue >= 3) return 'pre-epidemie';
  if (rawValue <= 1) return 'niveau_de_base';
  return 'post-epidemie';
}

export function formatSemaineEpidFromDate(value: string): string {
  const date = parseDate(value);
  if (!date) return 'unknown';

  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((utcDate.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);

  return `${utcDate.getUTCFullYear()}-S${String(week).padStart(2, '0')}`;
}

function normalizeTerritoryLevel(code: string): AlerteEpidemique['territoire_niveau'] {
  if (code === 'FR') return 'nation';
  if (/^(971|972|973|974|976)$/.test(code)) return 'outre_mer';
  if (/^\d{2}$|^2[AB]$/.test(code)) return 'departement';
  return 'region';
}

function mapOdiseePathologie(theme: string): AlerteEpidemique['pathologie'] {
  const normalized = theme.toLowerCase();
  if (normalized.includes('bronchi')) return 'bronchiolite';
  if (normalized.includes('gripp')) return 'grippe';
  if (normalized.includes('covid')) return 'covid';
  if (normalized.includes('respir')) return 'ira';
  return theme || 'ira';
}

export async function runSpfEpidemiologyCron(
  fetcher: typeof fetch = fetch,
  now = new Date(),
): Promise<EpidemiologyIngestionResult> {
  const checked_at = now.toISOString();
  const logs: EpidemiologyIngestionLog[] = [];

  try {
    const response = await fetcher(SPF_ODISSE_WINTER_ALERTS_URL, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`Odissé HTTP ${response.status}`);
    }

    const payload = await response.json() as {
      results?: Array<{
        theme?: string;
        reg?: string;
        date?: string;
        valeur?: number;
        date_lib?: string;
      }>;
    };

    const alerts = (payload.results ?? [])
      .filter((row) => row.reg && row.date && Number.isFinite(Number(row.valeur)))
      .map((row) => {
        const territoryCode = String(row.reg ?? '').trim();
        const dateMaj = new Date(String(row.date ?? '')).toISOString();
        const valeur = Number(row.valeur);
        const alert: AlerteEpidemique = {
          source: 'SPF_Odisse',
          path: SPF_ODISSE_WINTER_ALERTS_URL,
          dataset_id: 'ma_region_epidemies_hivernales_alertes',
          territoire_niveau: normalizeTerritoryLevel(territoryCode),
          territoire_code: territoryCode,
          semaine_epid: formatSemaineEpidFromDate(dateMaj),
          date_maj_source: dateMaj,
          last_checked_at: checked_at,
          statut: deriveStatutFromOdiseeValue(valeur),
          pathologie: mapOdiseePathologie(String(row.theme ?? '')),
          valeur,
          unite: 'niveau_alerte',
          obsolete: isAlertObsolete({ date_maj_source: dateMaj }, now),
          meta: {
            date_lib: row.date_lib ?? null,
          },
        };
        return alert;
      });

    logs.push({
      level: 'info',
      at: checked_at,
      source: 'SPF_Odisse',
      message: `Fetched ${alerts.length} Odissé alert rows`,
    });

    return { alerts, logs, checked_at };
  } catch (error) {
    logs.push({
      level: 'error',
      at: checked_at,
      source: 'SPF_Odisse',
      message: 'SPF epidemiology cron failed',
      details: error instanceof Error ? error.message : String(error),
    });
    return { alerts: [], logs, checked_at };
  }
}

export async function backoffFetchJson<T>(
  input: string,
  fetcher: typeof fetch = fetch,
  attempts = 3,
  initialDelayMs = 750,
): Promise<T> {
  let delayMs = initialDelayMs;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetcher(input, { headers: { Accept: 'application/json' } });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json() as T;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      delayMs *= 2;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
