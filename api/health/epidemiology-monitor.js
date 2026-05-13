import { fetchJson, setCors } from '../_shared/health-utils.js';

const ODISSE_URL =
  'https://odisse.santepubliquefrance.fr/api/explore/v2.1/catalog/datasets/' +
  'ma_region_epidemies_hivernales_alertes/records?limit=400&order_by=-date';

function formatSemaineEpid(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return 'unknown';

  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((utcDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);

  return `${utcDate.getUTCFullYear()}-S${String(week).padStart(2, '0')}`;
}

function territoryLevelFromCode(code) {
  if (code === 'FR') return 'nation';
  if (/^(971|972|973|974|976)$/.test(code)) return 'outre_mer';
  if (/^\d{2}$|^2[AB]$/.test(code)) return 'departement';
  return 'region';
}

function statusFromValue(value) {
  if (value >= 4) return 'epidemie';
  if (value >= 3) return 'pre-epidemie';
  if (value <= 1) return 'niveau_de_base';
  return 'post-epidemie';
}

function pathologieFromTheme(theme) {
  const normalized = String(theme || '').toLowerCase();
  if (normalized.includes('bronchi')) return 'bronchiolite';
  if (normalized.includes('gripp')) return 'grippe';
  if (normalized.includes('covid')) return 'covid';
  if (normalized.includes('respir')) return 'ira';
  return theme || 'ira';
}

export default async function handler(req, res) {
  if (setCors(req, res)) return;

  const checkedAt = new Date().toISOString();

  try {
    const payload = await fetchJson(ODISSE_URL, { timeoutMs: 18000 });
    const alerts = Array.isArray(payload?.results)
      ? payload.results
        .filter((row) => row?.reg && row?.date && Number.isFinite(Number(row?.valeur)))
        .map((row) => {
          const dateMaj = new Date(String(row.date)).toISOString();
          return {
            source: 'SPF_Odisse',
            path: ODISSE_URL,
            dataset_id: 'ma_region_epidemies_hivernales_alertes',
            territoire_niveau: territoryLevelFromCode(String(row.reg)),
            territoire_code: String(row.reg),
            semaine_epid: formatSemaineEpid(dateMaj),
            date_maj_source: dateMaj,
            last_checked_at: checkedAt,
            statut: statusFromValue(Number(row.valeur)),
            pathologie: pathologieFromTheme(row.theme),
            valeur: Number(row.valeur),
            unite: 'niveau_alerte',
            obsolete: Date.now() - new Date(dateMaj).getTime() > 10 * 24 * 60 * 60 * 1000,
            meta: {
              date_lib: row.date_lib ?? null,
            },
          };
        })
      : [];

    res.setHeader('Cache-Control', 's-maxage=14400, stale-while-revalidate=3600');
    res.status(200).json({
      checked_at: checkedAt,
      policy: {
        stale_after_days: 10,
        refresh_after_hours: 12,
      },
      alerts,
      logs: [
        {
          level: 'info',
          at: checkedAt,
          source: 'SPF_Odisse',
          message: `Fetched ${alerts.length} normalized epidemiology alerts`,
        },
      ],
    });
  } catch (error) {
    console.error('[api/health/epidemiology-monitor]', error);
    res.status(502).json({
      checked_at: checkedAt,
      alerts: [],
      logs: [
        {
          level: 'error',
          at: checkedAt,
          source: 'SPF_Odisse',
          message: 'Failed to fetch Odissé epidemiology alerts',
          details: error instanceof Error ? error.message : String(error),
        },
      ],
    });
  }
}
