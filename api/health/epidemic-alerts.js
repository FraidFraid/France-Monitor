import {
  decodeHtmlEntities,
  fetchText,
  setCors,
} from '../_shared/health-utils.js';

const MENINGOCOQUE_DOSSIER_URL =
  'https://www.santepubliquefrance.fr/maladies-et-traumatismes/maladies-a-prevention-vaccinale/infections-invasives-a-meningocoque';
const ODISSE_WINTER_ALERTS_URL =
  'https://odisse.santepubliquefrance.fr/api/explore/v2.1/catalog/datasets/ma_region_epidemies_hivernales_alertes/records?limit=100&order_by=-date&where=valeur%20%3E%3D%203';

const ACTIVE_ALERT_WINDOW_DAYS = 120;
const ALERTS_CACHE_TTL_MS = 60 * 60 * 1000;

let alertsCache = null;

function stripTags(input) {
  return decodeHtmlEntities(String(input || '').replace(/<[^>]+>/g, ' '));
}

function normalizeUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://www.santepubliquefrance.fr${raw.startsWith('/') ? raw : `/${raw}`}`;
}

const REGION_CODE_TO_NAME = {
  '01': 'Guadeloupe',
  '02': 'Martinique',
  '03': 'Guyane',
  '04': 'La Réunion',
  '06': 'Mayotte',
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
  '93': "Provence-Alpes-Côte d'Azur",
  '94': 'Corse',
};

function slugify(input) {
  return String(input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseFrenchDate(raw) {
  const text = decodeHtmlEntities(raw)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  const months = {
    janvier: '01',
    fevrier: '02',
    février: '02',
    mars: '03',
    avril: '04',
    mai: '05',
    juin: '06',
    juillet: '07',
    aout: '08',
    août: '08',
    septembre: '09',
    octobre: '10',
    novembre: '11',
    decembre: '12',
    décembre: '12',
  };

  const match = text.match(/^(\d{1,2})\s+([a-zéûôîàèç]+)\s+(\d{4})$/i);
  if (!match) return null;

  const month = months[match[2]];
  if (!month) return null;

  return `${match[3]}-${month}-${match[1].padStart(2, '0')}`;
}

function isRecentDate(isoDate) {
  if (!isoDate) return false;
  const ts = Date.parse(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts <= ACTIVE_ALERT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

function looksLikeActiveAlert(title, label) {
  const haystack = `${title} ${label}`.toLowerCase();
  return /alerte|recrudescence|augmentation|cas eleve|cas élevé|nombre de cas élevé|nombre de cas eleve/.test(haystack);
}

function computeSeverity(title, summary) {
  const haystack = `${title} ${summary}`.toLowerCase();
  if (/deces|décès|critique|urgence/.test(haystack)) return 'critical';
  if (/alerte|recrudescence|augmentation|cas eleve|cas élevé|cluster|regroupement/.test(haystack)) return 'high';
  return 'warning';
}

function computeOdiseeSeverity(level) {
  if (level >= 4) return 'high';
  if (level >= 3) return 'warning';
  return 'warning';
}

function parseMeningocoqueCards(html) {
  const cards = [];
  const anchorRegex = /<a href="([^"]*infections-invasives-a-meningocoque[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;

  let match;
  while ((match = anchorRegex.exec(html)) !== null) {
    const url = normalizeUrl(match[1]);
    const inner = match[2];
    const titleMatch = inner.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
    const subtitleMatch = inner.match(/<div class="subtitle">\s*<span>([\s\S]*?)<\/span>\s*([\s\S]*?)<\/div>/i);
    const title = stripTags(titleMatch?.[1] ?? '');
    const label = stripTags(subtitleMatch?.[1] ?? '');
    const date = parseFrenchDate(subtitleMatch?.[2] ?? '');

    if (!url || !title || !date) continue;

    cards.push({
      url,
      label,
      title,
      date,
    });
  }

  const deduped = new Map();
  for (const card of cards) {
    if (!deduped.has(card.url)) deduped.set(card.url, card);
  }
  return [...deduped.values()].sort((a, b) => b.date.localeCompare(a.date));
}

function extractArticleSummary(html) {
  const introMatch = html.match(
    /<div class="article__main-intro edito">[\s\S]*?<h1 class="h1">[\s\S]*?<\/h1><p>([\s\S]*?)<\/p>/i
  );
  if (introMatch?.[1]) return stripTags(introMatch[1]);

  const firstParagraphMatch = html.match(/<div id="block-[^"]+" class="content__wysiwyg edito[\s\S]*?<p>([\s\S]*?)<\/p>/i);
  return stripTags(firstParagraphMatch?.[1] ?? '');
}

async function fetchActiveMeningocoqueAlerts() {
  const dossierHtml = await fetchText(MENINGOCOQUE_DOSSIER_URL, { timeoutMs: 15000 });
  const cards = parseMeningocoqueCards(dossierHtml)
    .filter((card) => isRecentDate(card.date))
    .filter((card) => looksLikeActiveAlert(card.title, card.label))
    .slice(0, 3);

  const alerts = await Promise.all(cards.map(async (card) => {
    let summary = '';
    try {
      if (!card.url.toLowerCase().endsWith('.pdf')) {
        const detailHtml = await fetchText(card.url, { timeoutMs: 15000 });
        summary = extractArticleSummary(detailHtml);
      }
    } catch {
      // Keep generic fallback summary below.
    }

    if (!summary) {
      summary = 'Signal officiel récent publié par Santé publique France. Ouvrir la source pour le détail sanitaire et les recommandations.';
    }

    return {
      id: `meningocoque-${card.date}-${slugify(card.title)}`,
      pathogen: 'Méningocoque',
      severity: computeSeverity(card.title, summary),
      title: card.title,
      summary,
      locations: ['France'],
      date: card.date,
      sourceLabel: 'Santé publique France',
      sourceUrl: card.url,
    };
  }));

  return alerts;
}

async function fetchOdiseeWinterAlerts() {
  const payload = await fetchText(ODISSE_WINTER_ALERTS_URL, { timeoutMs: 15000 });
  const parsed = JSON.parse(payload);
  const rows = Array.isArray(parsed?.results) ? parsed.results : [];
  if (rows.length === 0) return [];

  const latestDate = rows
    .map((row) => String(row?.date ?? '').trim())
    .filter(Boolean)
    .sort()
    .slice(-1)[0];

  if (!latestDate) return [];

  const latestRows = rows.filter((row) => String(row?.date ?? '').trim() === latestDate);
  const grouped = new Map();

  for (const row of latestRows) {
    const theme = String(row?.theme ?? '').trim();
    const regionCode = String(row?.reg ?? '').trim();
    const regionName = REGION_CODE_TO_NAME[regionCode] ?? `Région ${regionCode}`;
    const level = Number(row?.valeur);
    const dateLib = String(row?.date_lib ?? '').trim();

    if (!theme || !regionCode || !Number.isFinite(level) || level < 3) continue;

    const key = `${theme}::${dateLib}`;
    const existing = grouped.get(key) ?? {
      theme,
      date: latestDate,
      dateLib,
      maxLevel: level,
      regions: [],
    };

    existing.maxLevel = Math.max(existing.maxLevel, level);
    existing.regions.push({ regionCode, regionName, level });
    grouped.set(key, existing);
  }

  return [...grouped.values()].map((group) => {
    const sortedRegions = group.regions
      .sort((a, b) => b.level - a.level || a.regionName.localeCompare(b.regionName));
    const locations = sortedRegions.map((region) => `${region.regionName} (niveau ${region.level})`);
    const topRegions = locations.slice(0, 4);
    const extraCount = locations.length - topRegions.length;

    return {
      id: `odisee-${slugify(group.theme)}-${group.dateLib}`,
      pathogen: group.theme,
      severity: computeOdiseeSeverity(group.maxLevel),
      title: `${group.theme} · signal hivernal SPF`,
      summary: `Niveaux d'alerte relevés dans le bulletin hivernal ${group.dateLib}${extraCount > 0 ? `, avec ${extraCount} région(s) supplémentaire(s)` : ''}.`,
      locations: topRegions,
      date: group.date,
      sourceLabel: 'Santé publique France / Odissé',
      sourceUrl: 'https://odisse.santepubliquefrance.fr/explore/dataset/ma_region_epidemies_hivernales_alertes/api/?flg=fr-fr',
    };
  });
}

export default async function handler(req, res) {
  if (setCors(req, res)) return;

  try {
    if (alertsCache && Date.now() - alertsCache.fetchedAt < ALERTS_CACHE_TTL_MS) {
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=1800');
      res.status(200).json({
        alerts: alertsCache.alerts,
        metadata: {
          generated_at: new Date(alertsCache.fetchedAt).toISOString(),
          source: 'Santé publique France',
          dossier_url: MENINGOCOQUE_DOSSIER_URL,
          cached: true,
        },
      });
      return;
    }

    const [odiseeAlerts, meningocoqueAlerts] = await Promise.all([
      fetchOdiseeWinterAlerts().catch(() => []),
      fetchActiveMeningocoqueAlerts().catch(() => []),
    ]);
    const alerts = [...odiseeAlerts, ...meningocoqueAlerts]
      .sort((a, b) => b.date.localeCompare(a.date));
    alertsCache = { fetchedAt: Date.now(), alerts };

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=1800');
    res.status(200).json({
      alerts,
      metadata: {
        generated_at: new Date().toISOString(),
        source: 'Santé publique France',
        dossier_url: MENINGOCOQUE_DOSSIER_URL,
        cached: false,
      },
    });
  } catch (err) {
    console.error('[api/health/epidemic-alerts]', err);

    if (alertsCache?.alerts) {
      res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800');
      res.status(200).json({
        alerts: alertsCache.alerts,
        metadata: {
          generated_at: new Date(alertsCache.fetchedAt).toISOString(),
          source: 'Santé publique France',
          dossier_url: MENINGOCOQUE_DOSSIER_URL,
          cached: true,
          stale: true,
          error: err instanceof Error ? err.message : String(err),
        },
      });
      return;
    }

    res.status(502).json({
      error: 'Failed to fetch epidemic alerts',
      details: err instanceof Error ? err.message : String(err),
      alerts: [],
    });
  }
}
