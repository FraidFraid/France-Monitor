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
const ODISSE_RECENT_SIGNAL_WINDOW_DAYS = 90;
const REGIONAL_BULLETIN_WINDOW_DAYS = 45;
const REGIONAL_BULLETIN_MAX_PER_REGION = 2;
const ALERTS_CACHE_TTL_MS = 60 * 60 * 1000;

const SPF_REGIONAL_BULLETIN_SOURCES = [
  {
    regionSlug: 'ocean-indien',
    label: 'Santé publique France / Océan Indien',
    pageUrl: 'https://www.santepubliquefrance.fr/regions-et-territoires/ocean-indien',
    defaultLocations: ['Mayotte', 'La Réunion'],
  },
  {
    regionSlug: 'guyane',
    label: 'Santé publique France / Guyane',
    pageUrl: 'https://www.santepubliquefrance.fr/regions-et-territoires/guyane',
    defaultLocations: ['Guyane'],
  },
  {
    regionSlug: 'antilles',
    label: 'Santé publique France / Antilles',
    pageUrl: 'https://www.santepubliquefrance.fr/regions-et-territoires/antilles',
    defaultLocations: ['Guadeloupe', 'Martinique', 'Antilles'],
  },
];

const REGIONAL_BULLETIN_HEALTH_RE =
  /surveillance sanitaire|grippe|bronchiolite|covid|chikungunya|dengue|cholera|choléra|paludisme|leptospirose|arboviro|gastro|gastro-enter|gastroent|rougeole|virus/i;
const REGIONAL_BULLETIN_EXCLUDE_RE =
  /conduites suicidaires|suicide|vaccination|couverture vaccinale|sant[eé] mentale|tabac|nutrition/i;

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

function isWithinDays(isoDate, days) {
  if (!isoDate) return false;
  const ts = Date.parse(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts <= days * 24 * 60 * 60 * 1000;
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

function normalizeSpfBulletinUrl(url) {
  const normalized = normalizeUrl(url);
  if (!normalized) return null;
  return normalized.replace('/index.php/', '/');
}

function extractRegionalBulletinLinks(html, regionSlug) {
  const links = new Set();
  const pathRe = new RegExp(`href="([^"]*\\/regions-et-territoires\\/${regionSlug}\\/bulletin-regional\\/[^"]*)"`, 'gi');
  let match;

  while ((match = pathRe.exec(html)) !== null) {
    const normalized = normalizeSpfBulletinUrl(match[1]);
    if (!normalized) continue;
    if (/facebook\.com|twitter\.com|linkedin\.com|mailto:/i.test(normalized)) continue;
    links.add(normalized);
  }

  return [...links];
}

function extractRegionalBulletinDate(html, url) {
  const publishedMatch = html.match(/Publié le\s*([^<\n]+)/i);
  const published = parseFrenchDate(publishedMatch?.[1] ?? '');
  if (published) return published;

  const titleDateMatch = decodeHtmlEntities(stripTags(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? ''))
    .match(/(\d{1,2}\s+[a-zéûôîàèç]+\s+\d{4})/i);
  const titleDate = parseFrenchDate(titleDateMatch?.[1] ?? '');
  if (titleDate) return titleDate;

  const urlDateMatch = url.match(/(\d{1,2})-(janvier|fevrier|février|mars|avril|mai|juin|juillet|aout|août|septembre|octobre|novembre|decembre|décembre)-(\d{4})/i);
  if (!urlDateMatch) return null;
  return parseFrenchDate(`${urlDateMatch[1]} ${urlDateMatch[2]} ${urlDateMatch[3]}`);
}

function extractRegionalBulletinSummary(html) {
  const bulletsMatch = html.match(/<h2[^>]*>Points cl[ée]s<\/h2>[\s\S]*?<ul>([\s\S]*?)<\/ul>/i);
  if (bulletsMatch?.[1]) {
    const bullets = [...bulletsMatch[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
      .map((match) => stripTags(match[1]))
      .filter(Boolean)
      .slice(0, 3);
    if (bullets.length > 0) return bullets.join(' ');
  }

  const sections = [
    /<h2[^>]*>Synth[èe]se [ée]pid[ée]miologique<\/h2>[\s\S]*?<p>([\s\S]*?)<\/p>/i,
    /<h2[^>]*>Analyse de la situation [ée]pid[ée]miologique<\/h2>[\s\S]*?<p>([\s\S]*?)<\/p>/i,
  ];
  for (const re of sections) {
    const match = html.match(re);
    const text = stripTags(match?.[1] ?? '');
    if (text) return text;
  }

  return extractArticleSummary(html);
}

function inferPathogenFromTitle(title) {
  const normalized = title.toLowerCase();
  if (normalized.includes('bronchiolite') && normalized.includes('grippe') && normalized.includes('covid')) {
    return 'Bronchiolite / Covid-19 / Grippe';
  }
  if (normalized.includes('chikungunya')) return 'Chikungunya';
  if (normalized.includes('dengue')) return 'Dengue';
  if (normalized.includes('paludisme')) return 'Paludisme';
  if (normalized.includes('cholera') || normalized.includes('choléra')) return 'Choléra';
  if (normalized.includes('leptospirose')) return 'Leptospirose';
  if (normalized.includes('bronchiolite')) return 'Bronchiolite';
  if (normalized.includes('grippe')) return 'Grippe';
  if (normalized.includes('covid')) return 'Covid-19';
  return 'Surveillance sanitaire';
}

function inferLocationsFromBulletin(title, defaults) {
  const locations = new Set();
  const haystack = title.toLowerCase();
  if (haystack.includes('mayotte')) locations.add('Mayotte');
  if (haystack.includes('la reunion') || haystack.includes('la réunion')) locations.add('La Réunion');
  if (haystack.includes('guyane')) locations.add('Guyane');
  if (haystack.includes('martinique')) locations.add('Martinique');
  if (haystack.includes('guadeloupe')) locations.add('Guadeloupe');
  if (haystack.includes('antilles')) {
    locations.add('Guadeloupe');
    locations.add('Martinique');
  }
  for (const item of defaults) locations.add(item);
  return [...locations];
}

async function fetchRegionalBulletinAlerts() {
  const regionAlerts = await Promise.all(SPF_REGIONAL_BULLETIN_SOURCES.map(async (source) => {
    const regionHtml = await fetchText(source.pageUrl, { timeoutMs: 15000 });
    const bulletinLinks = extractRegionalBulletinLinks(regionHtml, source.regionSlug).slice(0, 10);
    const detailCandidates = await Promise.all(bulletinLinks.map(async (url) => {
      try {
        const html = await fetchText(url, { timeoutMs: 15000 });
        const title = stripTags(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '');
        if (!title) return null;
        if (!REGIONAL_BULLETIN_HEALTH_RE.test(title) || REGIONAL_BULLETIN_EXCLUDE_RE.test(title)) return null;

        const date = extractRegionalBulletinDate(html, url);
        if (!date || !isWithinDays(date, REGIONAL_BULLETIN_WINDOW_DAYS)) return null;

        const summary = extractRegionalBulletinSummary(html)
          || 'Bulletin régional récent de Santé publique France. Ouvrir la source pour le détail sanitaire.';

        return {
          id: `spf-regional-${source.regionSlug}-${date}-${slugify(title)}`,
          pathogen: inferPathogenFromTitle(title),
          severity: computeSeverity(title, summary),
          title,
          summary,
          locations: inferLocationsFromBulletin(title, source.defaultLocations),
          date,
          sourceLabel: source.label,
          sourceUrl: url,
        };
      } catch {
        return null;
      }
    }));

    return detailCandidates
      .filter((item) => item !== null)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, REGIONAL_BULLETIN_MAX_PER_REGION);
  }));

  return regionAlerts.flat();
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

  const recentRows = rows.filter((row) => {
    const isoDate = String(row?.date ?? '').trim();
    return isWithinDays(isoDate, ODISSE_RECENT_SIGNAL_WINDOW_DAYS);
  });

  const latestByRegionTheme = new Map();
  for (const row of recentRows) {
    const theme = String(row?.theme ?? '').trim();
    const regionCode = String(row?.reg ?? '').trim();
    const regionName = REGION_CODE_TO_NAME[regionCode] ?? `Région ${regionCode}`;
    const level = Number(row?.valeur);
    const dateLib = String(row?.date_lib ?? '').trim();
    const isoDate = String(row?.date ?? '').trim();

    if (!theme || !regionCode || !isoDate || !Number.isFinite(level) || level < 3) continue;

    const key = `${theme}::${regionCode}`;
    const prev = latestByRegionTheme.get(key);
    if (prev && String(prev.date ?? '') >= isoDate) continue;

    latestByRegionTheme.set(key, {
      theme,
      regionCode,
      regionName,
      level,
      date: isoDate,
      dateLib,
    });
  }

  const grouped = new Map();
  for (const row of latestByRegionTheme.values()) {
    const key = row.theme;
    const existing = grouped.get(key) ?? {
      theme: row.theme,
      latestDate: row.date,
      latestDateLib: row.dateLib,
      maxLevel: row.level,
      regions: [],
    };

    if (row.date > existing.latestDate) {
      existing.latestDate = row.date;
      existing.latestDateLib = row.dateLib;
    }
    existing.maxLevel = Math.max(existing.maxLevel, row.level);
    existing.regions.push({
      regionCode: row.regionCode,
      regionName: row.regionName,
      level: row.level,
      date: row.date,
      dateLib: row.dateLib,
    });
    grouped.set(key, existing);
  }

  return [...grouped.values()].map((group) => {
    const sortedRegions = group.regions
      .sort((a, b) => b.date.localeCompare(a.date) || b.level - a.level || a.regionName.localeCompare(b.regionName));
    const locations = sortedRegions.map((region) => `${region.regionName} (${region.dateLib}, niveau ${region.level})`);
    const topRegions = locations.slice(0, 6);
    const extraCount = locations.length - topRegions.length;

    return {
      id: `odisee-${slugify(group.theme)}-${group.latestDateLib}`,
      pathogen: group.theme,
      severity: computeOdiseeSeverity(group.maxLevel),
      title: `${group.theme} · signaux hivernaux SPF`,
      summary: `Signaux de niveau 3 ou 4 relevés sur les ${ODISSE_RECENT_SIGNAL_WINDOW_DAYS} derniers jours. Dernier bulletin concerné : ${group.latestDateLib}${extraCount > 0 ? `, avec ${extraCount} territoire(s) supplémentaire(s)` : ''}.`,
      locations: topRegions,
      date: group.latestDate,
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

    const [odiseeAlerts, meningocoqueAlerts, regionalBulletinAlerts] = await Promise.all([
      fetchOdiseeWinterAlerts().catch(() => []),
      fetchActiveMeningocoqueAlerts().catch(() => []),
      fetchRegionalBulletinAlerts().catch(() => []),
    ]);
    const alerts = [...odiseeAlerts, ...meningocoqueAlerts, ...regionalBulletinAlerts]
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
