import * as cheerioModule from 'cheerio';
import * as turfModule from '@turf/turf';

// ── Constants ──────────────────────────────────────────────────────────────

const RATE_LIMIT_MS = 1200; // 1.2s entre chaque requête scraping (< 1req/s par politesse)
const GEOCODE_BATCH_DELAY_MS = 150; // délai entre batches de géocodage (API Adresse = pas de rate limit strict)
const GEOCODE_BATCH_SIZE = 8; // géocodages en parallèle par batch
const FETCH_TIMEOUT_MS = 8_000;
const CITY_PAGE_TIMEOUT_MS = 2_000; // timeout court pour les pages villes (fetch parallèle)
const STALE_THRESHOLD_MS = 48 * 60 * 60_000; // 48h — ignorer villes sans signalement récent
const GEOCODE_CACHE_TTL_MS = 24 * 60 * 60_000; // 24h (les villes ne bougent pas)
const DBSCAN_RADIUS_KM = 10;
const DBSCAN_MIN_POINTS = 3;

const USER_AGENT =
  'FranceMonitor/2.0 (+https://github.com/france-monitor; contact@example.com) situational-awareness-dashboard';

const HEADERS = {
  'User-Agent': USER_AGENT,
  Accept: 'application/json, text/html, */*',
  'Accept-Language': 'fr-FR,fr;q=0.9',
};

// Module-level server cache (shared across warm invocations)
let _serverCache = null;
let _geocodeCache = new Map(); // ville → [lng, lat]
let _lastFetchTimes = {}; // source → timestamp (rate limiting)

// ── Main Handler ────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // Serve from server cache if fresh (10 min)
  const now = Date.now();
  if (_serverCache && now - _serverCache.fetchedAt < 10 * 60_000) {
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=120');
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json(_serverCache.data);
  }

  try {
    // ── Scrape sources (GeoBlackout retiré : pas d'API publique disponible) ──
    const [infocoupureReports, coupureElecReports] = await Promise.allSettled([
      scrapeInfoCoupure(),
      scrapeCoupureElec(),
    ]);

    const sourcesStatus = {
      infocoupure: infocoupureReports.status === 'fulfilled' ? 'ok' : 'error',
      'coupure-elec': coupureElecReports.status === 'fulfilled' ? 'ok' : 'error',
    };

    // Flatten all reports, filtering out failures
    const allReports = [
      ...(infocoupureReports.status === 'fulfilled' ? infocoupureReports.value : []),
      ...(coupureElecReports.status === 'fulfilled' ? coupureElecReports.value : []),
    ];

    // Log source errors for debugging
    if (infocoupureReports.status === 'rejected') {
      console.warn('[citizen-outages] InfoCoupure error:', infocoupureReports.reason?.message);
    }
    if (coupureElecReports.status === 'rejected') {
      console.warn('[citizen-outages] Coupure-elec error:', coupureElecReports.reason?.message);
    }

    // ── Cluster reports into geographic zones ──
    const zones = await clusterZones(allReports);
    const criticalZones = zones.features.filter((f) => f.properties.severity === 'critical').length;

    const response = {
      zones,
      reports: allReports,
      stats: {
        totalReports: allReports.reduce((s, r) => s + r.reportCount, 0),
        totalZones: zones.features.length,
        criticalZones,
        sourcesStatus,
        fetchedAt: new Date().toISOString(),
      },
    };

    // Update server cache
    _serverCache = { data: response, fetchedAt: now };

    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=120');
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[citizen-outages] Fatal error:', message);

    // Return stale cache on error rather than failing
    if (_serverCache) {
      res.setHeader('Cache-Control', 's-maxage=60');
      return res.status(200).json({
        ..._serverCache.data,
        stats: { ..._serverCache.data.stats, stale: true },
      });
    }

    return res.status(502).json({ error: `Citizen outages fetch failed: ${message}` });
  }
}

// ── Scraper: InfoCoupure.fr ─────────────────────────────────────────────────
//
// Site WordPress/Kadence. Structure :
//   - Page d'index : liste des départements avec liens /departement-{code}/
//   - Pages départementales : contenu WordPress avec le compte de signalements
//
// Stratégie :
//   1. Tenter l'API WordPress REST (wp-json) pour récupérer le contenu en JSON
//   2. Fallback : fetch HTML direct de chaque page département + parse cheerio
//
// On scrappe les 25 départements prioritaires (population + activité) en parallèle
// par batches de 5 (rate-limit). Chaque département → un report au centroïde.

// Départements qui ont une page sur infocoupure.fr (code → nom, lng, lat centroïde)
// Construits depuis la liste visible sur le site + coordonnées INSEE connues.
const INFOCOUPURE_DEPTS = {
  '01': { name: 'Ain',                   coords: [5.34, 46.22] },
  '03': { name: 'Allier',                coords: [3.17, 46.34] },
  '06': { name: 'Alpes-Maritimes',       coords: [7.12, 43.93] },
  '07': { name: 'Ardèche',               coords: [4.39, 44.75] },
  '13': { name: 'Bouches-du-Rhône',      coords: [5.37, 43.53] },
  '15': { name: 'Cantal',                coords: [2.67, 45.06] },
  '21': { name: 'Côte-d\'Or',            coords: [4.77, 47.42] },
  '22': { name: 'Côtes-d\'Armor',        coords: [-2.87, 48.45] },
  '25': { name: 'Doubs',                 coords: [6.36, 47.12] },
  '26': { name: 'Drôme',                 coords: [5.18, 44.72] },
  '29': { name: 'Finistère',             coords: [-4.10, 48.27] },
  '31': { name: 'Haute-Garonne',         coords: [1.44, 43.42] },
  '33': { name: 'Gironde',               coords: [-0.58, 44.84] },
  '34': { name: 'Hérault',               coords: [3.50, 43.61] },
  '35': { name: 'Ille-et-Vilaine',       coords: [-1.62, 48.17] },
  '38': { name: 'Isère',                 coords: [5.58, 45.27] },
  '39': { name: 'Jura',                  coords: [5.75, 46.67] },
  '42': { name: 'Loire',                 coords: [4.13, 45.74] },
  '43': { name: 'Haute-Loire',           coords: [3.72, 45.07] },
  '44': { name: 'Loire-Atlantique',      coords: [-1.68, 47.35] },
  '56': { name: 'Morbihan',              coords: [-2.77, 47.81] },
  '58': { name: 'Nièvre',                coords: [3.45, 47.09] },
  '59': { name: 'Nord',                  coords: [3.24, 50.52] },
  '63': { name: 'Puy-de-Dôme',          coords: [3.08, 45.77] },
  '67': { name: 'Bas-Rhin',             coords: [7.57, 48.60] },
  '69': { name: 'Rhône',                coords: [4.56, 45.87] },
  '70': { name: 'Haute-Saône',          coords: [6.08, 47.62] },
  '71': { name: 'Saône-et-Loire',       coords: [4.55, 46.64] },
  '73': { name: 'Savoie',               coords: [6.44, 45.49] },
  '74': { name: 'Haute-Savoie',         coords: [6.44, 46.01] },
  '75': { name: 'Paris',                coords: [2.35, 48.85] },
  '76': { name: 'Seine-Maritime',       coords: [1.10, 49.67] },
  '89': { name: 'Yonne',               coords: [3.57, 47.80] },
  '90': { name: 'Territoire de Belfort',coords: [6.86, 47.62] },
};

// Priorité : on scrappe d'abord les départements les plus peuplés (max 20/cycle)
const PRIORITY_DEPT_CODES = [
  '75','69','13','59','67','33','34','06','31','44',
  '38','76','29','35','56','42','31','67','73','74',
  '63','21','22','25','26','39','58','70','71','90',
  '01','03','07','15','43','89',
];

/**
 * Scrape infocoupure.fr — structure réelle confirmée :
 *
 * Page département (ex: /departement-69/) = liste d'articles WordPress.
 * Chaque <article class="category-departement-69"> = une ville affectée.
 * Titre : "Coupures d'électricité Saint-Priest (69) aujourd'hui"
 * Pas de compteur numérique affiché sur la page liste — présence d'article = signal.
 *
 * Stratégie :
 *   - Fetch HTML de chaque page département (batch de 4, rate-limited)
 *   - Parser les <article> → extraire nom de ville + URL
 *   - 1 CitizenOutageReport par ville (reportCount = 1)
 *   - Géocodage via API Adresse data.gouv.fr (avec cache 24h)
 */
async function scrapeInfoCoupure() {
  // 8 départements max — laisser du budget temps pour le géocodage parallèle
  const codesToFetch = PRIORITY_DEPT_CODES.filter(c => INFOCOUPURE_DEPTS[c]).slice(0, 8);
  const allReports = [];

  for (let i = 0; i < codesToFetch.length; i += 4) {
    const batch = codesToFetch.slice(i, i + 4);
    const batchResults = await Promise.allSettled(
      batch.map(code => fetchDeptCities(code))
    );
    for (const r of batchResults) {
      if (r.status === 'fulfilled') allReports.push(...r.value);
    }
    if (i + 4 < codesToFetch.length) await sleep(RATE_LIMIT_MS);
  }

  return allReports;
}

/**
 * Fetche la page d'un département et retourne un report par ville affectée.
 *
 * Flux :
 *   1. Fetch HTML page département → liste de villes (articles WordPress)
 *   2. Fetch pages villes en parallèle (timeout court 2.5s) → compte de signalements
 *   3. Filtrer villes sans signalement récent (> 48h)
 *   4. Géocodage séquentiel (cache 24h réduit les appels réels)
 *
 * @param {string} code — ex: '69'
 * @returns {Promise<object[]>} tableau de CitizenOutageReport (un par ville)
 */
async function fetchDeptCities(code) {
  const dept = INFOCOUPURE_DEPTS[code];
  if (!dept) return [];

  await rateLimitWait('infocoupure');

  let html = '';
  try {
    const resp = await fetchWithTimeout(`https://infocoupure.fr/departement-${code}/`, {
      headers: { ...HEADERS, Accept: 'text/html' },
    });
    if (!resp.ok) return [];
    html = await resp.text();
  } catch {
    return [];
  }

  // ── Parser les articles ──
  // Structure confirmée :
  //   <article class="... category-departement-69 ...">
  //     <h2 class="entry-title"><a href="/saint-priest/">Coupures d'électricité Saint-Priest (69) aujourd'hui</a></h2>
  //   </article>
  const cityEntries = parseDeptArticles(html, code);
  if (cityEntries.length === 0) return [];

  // ── Fetch pages villes en parallèle (commentaires wpDiscuz) ──
  // Chaque page ville = thread wpDiscuz avec N signalements datés.
  // On récupère : nombre de commentaires × nombre de pages = reportCount approximatif
  //               + date du commentaire le plus récent (filtre staleness)
  const MAX_CITIES = 8;
  const entriesToProcess = cityEntries.slice(0, MAX_CITIES);

  const cityData = await Promise.all(
    entriesToProcess.map(async (entry) => {
      const reportData = await fetchCityReportData(entry.href);
      return { ...entry, reportData };
    })
  );

  // ── Filtrer les villes sans signalement récent (> 48h) ──
  const now = Date.now();
  const freshEntries = cityData.filter(({ reportData }) => {
    // Si on n'a pas pu fetch la page ville, on garde quand même
    // (article présent sur la page dept = signal récent)
    if (!reportData) return true;
    return now - reportData.mostRecentDate.getTime() < STALE_THRESHOLD_MS;
  });

  // ── Géocodage parallèle (API Adresse = pas de rate limit strict) ──
  const coordsMap = await geocodeCitiesBatch(
    freshEntries.map(e => ({ city: e.city, dept: code }))
  );
  const reports = freshEntries.map(entry => {
    const coords = coordsMap.get(`${entry.city}|${code}`) ?? dept.coords;
    return {
      id: `infocoupure-${code}-${slugify(entry.city)}-${Date.now()}`,
      source: 'infocoupure',
      city: entry.city,
      department: dept.name,
      departmentCode: code,
      reportCount: entry.reportData?.count ?? 1,
      timestamp: entry.reportData?.mostRecentDate ?? new Date(),
      coordinates: coords,
      type: 'electricity',
    };
  });
  return reports;
}

/**
 * Parse le HTML d'une page département pour extraire les villes affectées.
 *
 * Sélecteur confirmé via inspection DevTools :
 *   <article class="post type-post ... category-departement-69 ...">
 *     <h2 class="entry-title">
 *       <a href="https://infocoupure.fr/saint-priest/">
 *         Coupures d'électricité Saint-Priest (69) aujourd'hui
 *       </a>
 *     </h2>
 *   </article>
 *
 * Structure validation :
 *   On considère le HTML valide si la page contient au moins l'un des marqueurs :
 *   - Une balise <article avec class="post"
 *   - Une balise <h2 class="entry-title"
 *   - Une balise <div class="entry-content"
 *   Si aucun de ces marqueurs n'est présent, on logue une alerte "structure inattendue"
 *   pour qu'on n'interprète pas une réponse HTML incompatible comme "zéro panne".
 */
function parseDeptArticles(html, deptCode) {
  const results = [];

  // ── Validation de structure ──
  // Vérifier que la page ressemble à du WordPress (infocoupure est un site WP)
  const IS_WORDPRESS = /<article[^>]+class="[^"]*post[^"]*"[^>]*>/i.test(html)
    || /<h2[^>]+class="[^"]*entry-title[^"]*"/i.test(html)
    || /<div[^>]+class="[^"]*entry-content[^"]*"/i.test(html);

  if (!IS_WORDPRESS) {
    console.warn(
      `[infocoupure] /departement-${deptCode}/ : structure HTML inattendue — ` +
      'marqueurs WordPress absents. Le scraper est peut-\u00eatre cass\u00e9.'
    );
    return [];
  }

  // Regex pour extraire le contenu de chaque article de la catégorie du département
  // On cherche les <article> avec la classe category-departement-{code}
  const articlePattern = new RegExp(
    `<article[^>]+category-departement-${deptCode}[^>]*>[\\s\\S]*?<\/article>`,
    'gi'
  );
  const articles = html.match(articlePattern) ?? [];

  // Fallback : si pas de catégorie spécifique, prendre tous les articles de la page
  const sourceArticles = articles.length > 0
    ? articles
    : (html.match(/<article[^>]+class="[^"]*post[^"]*"[^>]*>[\s\S]*?<\/article>/gi) ?? []);

  if (sourceArticles.length === 0) {
    // La page est bien un WP mais sans article pour ce dépt = aucune panne connue
    console.info(`[infocoupure] /departement-${deptCode}/ : aucune panne publiée (0 article)`);
    return [];
  }

  for (const article of sourceArticles) {
    // Extraire le lien + titre depuis <h2 class="entry-title"><a href="...">...</a></h2>
    const linkMatch = article.match(
      /<h2[^>]*entry-title[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i
    );
    if (!linkMatch) continue;

    const href = linkMatch[1];
    const titleRaw = decodeHtmlText(linkMatch[2].replace(/<[^>]+>/g, '').trim()); // strip HTML tags

    // Extraire le nom de la ville depuis le titre
    // Pattern : "Coupures d'électricité Saint-Priest (69) aujourd'hui"
    //        ou "Panne électricité Lyon (69)"
    //        ou simplement le slug de l'URL en fallback
    const cityFromTitle = extractCityFromTitle(titleRaw, deptCode);
    const cityFromUrl = extractCityFromUrl(href);
    const city = cityFromTitle || cityFromUrl;

    if (!city || city.length < 2) continue;

    results.push({ city, href });
  }

  return results;
}

/**
 * Extrait le nom de la ville depuis un titre d'article infocoupure.fr.
 * Ex: "Coupures d'électricité Saint-Priest (69) aujourd'hui" → "Saint-Priest"
 */
function extractCityFromTitle(title, deptCode) {
  // Extraire tout ce qui précède (deptCode)
  const m = title.match(new RegExp(`^(.+?)\\s*\\(${deptCode}\\)`, 'i'));
  if (!m) return '';

  let candidate = m[1].trim();

  // Supprimer les préfixes de bruit en cascade (ordre du plus spécifique au plus général)
  candidate = candidate
    .replace(/^coupures?\s+d(?:[’'`]\s*)?électricit[eé]\s*/i, '')
    .replace(/^pannes?\s+d(?:[’'`]\s*)?électricit[eé]\s*/i, '')
    .replace(/^coupures?\s+d[''e]\s*électricit[eé]\s*/i, '')
    .replace(/^pannes?\s+(?:de\s+)?électricit[eé]\s*/i, '')
    .replace(/^pannes?\s+électriques?\s*/i, '')
    .replace(/^coupures?\s+électriques?\s*/i, '')
    .replace(/^pannes?\s+de\s+courant\s*/i, '')
    .replace(/^coupures?\s+de\s+courant\s*/i, '')
    .replace(/^(?:pannes?|coupures?)\s*/i, '')
    .replace(/^d(?:[’'`]\s*)?électricit[eé]\s*/i, '')
    .replace(/^(?:électricit[eé]|électriques?|courants?)\s*/i, '')
    .replace(/^(?:à|de|d[''e]|du|le|la|les)\s+/i, '')
    .trim();

  return candidate.length >= 2 ? candidate : '';
}

/**
 * Extrait le nom de la ville depuis l'URL d'un article.
 * Ex: "https://infocoupure.fr/saint-priest/" → "Saint-Priest"
 */
function extractCityFromUrl(href) {
  const slug = href.replace(/.*\/([^/]+)\/?$/, '$1');
  if (!slug || slug === 'departement') return '';
  return slug
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join('-');
}

// ── City page parser (wpDiscuz comments) ────────────────────────────────────

/**
 * Fetch la page d'une ville infocoupure.fr pour extraire le nombre de signalements.
 *
 * Les pages villes utilisent wpDiscuz (plugin commentaires WordPress).
 * Structure :
 *   <div class="wpd-comment-wrap">  ← un par signalement
 *     <div class="wpd-comment-date" title="14 mars 2026 10 h 03 min">
 *     <div class="wpd-comment-text"><p>Rue Jules Verne</p></div>
 *   </div>
 *   Pagination : <span aria-current="page" class="page-numbers current">6</span>
 *
 * @param {string} href — ex: "/saint-priest/" ou "https://infocoupure.fr/saint-priest/"
 * @returns {{ count: number, totalPages: number, mostRecentDate: Date } | null}
 */
async function fetchCityReportData(href) {
  try {
    const url = href.startsWith('http') ? href : `https://infocoupure.fr${href}`;
    const resp = await fetch(url, {
      headers: { ...HEADERS, Accept: 'text/html' },
      signal: AbortSignal.timeout(CITY_PAGE_TIMEOUT_MS),
    });
    if (!resp.ok) return null;
    const html = await resp.text();
    return parseCityComments(html);
  } catch {
    return null;
  }
}

/**
 * Parse les commentaires wpDiscuz d'une page ville.
 *
 * @returns {{ count: number, totalPages: number, mostRecentDate: Date }}
 */
function parseCityComments(html) {
  // Compter les blocs commentaires sur cette page
  const wrapMatches = html.match(/<div[^>]+class="[^"]*wpd-comment-wrap[^"]*"/g) ?? [];
  const commentsOnPage = wrapMatches.length;

  // Nombre total de pages (pour estimer le total de signalements)
  // <span aria-current="page" class="page-numbers current">6</span>
  const currentPageMatch = html.match(/<span[^>]+aria-current="page"[^>]*>(\d+)<\/span>/i);
  const totalPages = currentPageMatch ? parseInt(currentPageMatch[1], 10) : 1;

  // Estimation : commentsOnPage × totalPages (approximatif — on ne fetch qu'une page)
  const estimatedTotal = Math.max(commentsOnPage, commentsOnPage * totalPages);

  // Date du commentaire le plus récent
  // <div class="wpd-comment-date" title="14 mars 2026 10 h 03 min">
  const allDates = [...html.matchAll(/class="wpd-comment-date"[^>]+title="([^"]+)"/gi)]
    .map(m => parseFrenchDate(m[1]))
    .filter(d => !isNaN(d.getTime()));

  const mostRecentDate = allDates.length > 0
    ? new Date(Math.max(...allDates.map(d => d.getTime())))
    : new Date();

  return {
    count: Math.max(1, estimatedTotal),
    totalPages,
    mostRecentDate,
  };
}

/**
 * Parse une date française au format wpDiscuz : "14 mars 2026 10 h 03 min"
 */
function parseFrenchDate(str) {
  const MONTHS = {
    'janvier': 0, 'février': 1, 'mars': 2, 'avril': 3, 'mai': 4, 'juin': 5,
    'juillet': 6, 'août': 7, 'septembre': 8, 'octobre': 9, 'novembre': 10, 'décembre': 11,
  };
  const m = str.match(/(\d+)\s+(\w+)\s+(\d{4})\s+(\d+)\s*h\s*(\d+)/i);
  if (!m) return new Date(NaN);
  const month = MONTHS[m[2].toLowerCase()];
  if (month === undefined) return new Date(NaN);
  return new Date(parseInt(m[3]), month, parseInt(m[1]), parseInt(m[4]), parseInt(m[5]));
}

// ── Scraper: Coupure-elec.fr ────────────────────────────────────────────────

/**
 * Coupure-elec.fr : signalements citoyens de pannes électriques.
 *
 * Le site est Next.js App Router (React Server Components). Seules les pages
 * /departement/[slug] sont rendues côté serveur avec les données complètes.
 * La page /coupures n'existe pas ; l'accueil utilise des composants CSR.
 *
 * Structure HTML réelle (Tailwind, vérifiée sur le site réel) :
 *   <div class="p-6">                        ← conteneur d'une panne
 *     <span>Actif | Résolu | Obsolète…</span> ← badge de statut
 *     <a href="/ville/SLUG">→ Nom Ville</a>  ← lien ville
 *     <div>N signalements</div>               ← compteur
 *   </div>
 *
 * Stratégie : 5 départements à forte densité urbaine, fetch séquentiel
 * pour respecter le rate limit (1.2 s entre requêtes).
 */

/** Départements à scraper — couvre ~35 % de la population métropolitaine. */
const COUPURE_ELEC_DEPTS = [
  { slug: 'nord',             name: 'Nord',             code: '59' },
  { slug: 'bouches-du-rhone', name: 'Bouches-du-Rhône', code: '13' },
  { slug: 'rhone',            name: 'Rhône',            code: '69' },
  { slug: 'gironde',          name: 'Gironde',          code: '33' },
  { slug: 'haute-garonne',    name: 'Haute-Garonne',    code: '31' },
];

async function scrapeCoupureElec() {
  const cheerio = cheerioModule;

  const raw = [];

  // Fetch séquentiel pour respecter le rate limit inter-requêtes
  for (const dept of COUPURE_ELEC_DEPTS) {
    try {
      await rateLimitWait('coupure-elec');
      const resp = await fetchWithTimeout(
        `https://www.coupure-elec.fr/departement/${dept.slug}`,
        { headers: { ...HEADERS, Accept: 'text/html' } },
      );
      if (!resp.ok) {
        console.warn(`[coupure-elec] HTTP ${resp.status} pour /departement/${dept.slug}`);
        continue;
      }
      const html = await resp.text();
      const { results, stats } = parseCoupureElecDept(cheerio, html, dept);
      if (stats.total === 0) {
        console.warn(`[coupure-elec] /departement/${dept.slug} — aucun lien /ville/ trouvé (structure HTML changée ?)`);
      } else if (stats.active === 0) {
        console.info(`[coupure-elec] /departement/${dept.slug} — ${stats.total} panne(s) trouvée(s), toutes filtrées. Statuts: [${stats.statuses.join(', ')}]`);
      }
      raw.push(...results);
    } catch (err) {
      console.warn(`[coupure-elec] erreur /departement/${dept.slug}:`, err?.message ?? err);
    }
  }

  if (raw.length === 0) {
    console.info('[coupure-elec] aucune panne active sur les 5 départements — réseau stable ou tous statuts filtrés');
    return [];
  }

  const limited = raw.slice(0, 30);
  const coordsMap = await geocodeCitiesBatch(
    limited.map(r => ({ city: r.city, dept: r.deptCode }))
  );
  const reports = limited
    .map(r => {
      const coords = coordsMap.get(`${r.city}|${r.deptCode}`);
      if (!coords) return null;
      return {
        id: `coupure-elec-${slugify(r.city)}-${Date.now()}`,
        source: 'coupure-elec',
        city: r.city,
        department: r.deptName,
        departmentCode: r.deptCode,
        reportCount: r.count,
        timestamp: new Date(),
        coordinates: coords,
        type: 'electricity',
      };
    })
    .filter(Boolean);
  return reports;
}

/**
 * Parse les pannes actives d'une page /departement/[slug].
 * Sélecteur clé : a[href^="/ville/"] — chaque lien ville identifie une panne.
 * On remonte au conteneur .p-6 pour lire le statut et le nombre de signalements.
 *
 * Structure validation :
 *   On vérifie que la page est bien une page Next.js de coupure-elec.fr en cherchant
 *   l'un des marqueurs attendus :
 *   - Un lien <a href="/ville/..."
 *   - Un élément [class*="p-6"]
 *   Si aucun marqueur n'est présent, on considère la structure changée et on le logue.
 *
 * Retourne { results, stats } pour permettre le diagnostic en prod :
 *   - stats.total    : entrées brutes trouvées (liens /ville/ avec container)
 *   - stats.active   : entrées retenues après filtre statut
 *   - stats.statuses : échantillon des libellés de statut rencontrés (dédup, max 5)
 *   - stats.structureValid : false si la structure HTML a changé
 */
function parseCoupureElecDept(cheerio, html, dept) {
  const $ = cheerio.load(html);
  const results = [];
  let totalFound = 0;
  const seenStatuses = new Set();

  // Essayer plusieurs schémas d'URL ville (le site peut avoir changé /ville/ -> /commune/ etc.)
  const CITY_LINK_SELECTORS = [
    'a[href^="/ville/"]',
    'a[href^="/commune/"]',
    'a[href^="/pannes/"]',
    'a[href*="/ville/"]',
    'a[href*="/commune/"]',
  ];
  let cityLinkSelector = null;
  for (const sel of CITY_LINK_SELECTORS) {
    if ($(sel).length > 0) { cityLinkSelector = sel; break; }
  }

  const hasPContainer = $('[class*="p-6"]').length > 0;

  if (!cityLinkSelector && !hasPContainer) {
    console.warn(
      `[coupure-elec] /departement/${dept.slug} : structure HTML inattendue — ` +
      'aucun lien ville ni conteneur .p-6 trouvé. Scraper peut-être cassé.'
    );
    return { results: [], stats: { total: 0, active: 0, statuses: [], structureValid: false } };
  }

  $(cityLinkSelector ?? 'a[href]').each((_, el) => {
    const $link = $(el);
    const city = $link.text().replace(/^[\s\u2192]+/, '').trim();
    if (!city || city.length < 2) return;
    if (/^(voir|plus|retour|accueil|carte|liste)/i.test(city)) return;

    const $container = $link.closest('[class*="p-6"]');
    if (!$container.length) return;

    totalFound++;
    const statusText = $container.find('span').first().text().trim();
    if (seenStatuses.size < 5) seenStatuses.add(statusText || '(vide)');

    // Ignorer les pannes obsolètes (>6h) ou résolues
    const statusLower = statusText.toLowerCase();
    if (statusLower.includes('obsolète') || statusLower.includes('résolu')) return;

    const countMatch = $container.text().match(/(\d+)\s+signalement/);
    const count = countMatch ? parseInt(countMatch[1], 10) : 1;

    results.push({ city, deptName: dept.name, deptCode: dept.code, count });
  });

  return { results, stats: { total: totalFound, active: results.length, statuses: [...seenStatuses], structureValid: true } };
}

// ── Clustering DBSCAN (Turf.js) ─────────────────────────────────────────────

/**
 * Transforme une liste de signalements en zones géographiques (polygones GeoJSON).
 *
 * Algorithme :
 * 1. Convertir reports → GeoJSON points (pondérés par reportCount)
 * 2. DBSCAN clustering (rayon 10km, min 3 points)
 * 3. Pour chaque cluster : calculer convex hull ou buffer circulaire
 * 4. Calculer densité et severity
 *
 * @returns {import('geojson').FeatureCollection<import('geojson').Polygon>}
 */
async function clusterZones(reports) {
  // Dédupliquer par ville (somme des signalements)
  const deduped = deduplicateReports(reports);

  if (deduped.length === 0) {
    return { type: 'FeatureCollection', features: [] };
  }

  // Construire FeatureCollection de points pour Turf
  const pointFeatures = deduped.map((r) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: r.coordinates },
    properties: {
      reportCount: r.reportCount,
      city: r.city,
      source: r.source,
      id: r.id,
    },
  }));

  const fc = { type: 'FeatureCollection', features: pointFeatures };

  const turf = turfModule;

  // DBSCAN clustering
  let clustered;
  try {
    clustered = turf.clustersDbscan(fc, DBSCAN_RADIUS_KM, {
      minPoints: DBSCAN_MIN_POINTS,
      units: 'kilometers',
    });
  } catch (err) {
    console.warn('[citizen-outages] Turf DBSCAN failed, fallback grille simple:', err.message);
    return buildSimpleZones(deduped);
  }

  // Grouper les points par cluster ID
  const clusterGroups = new Map();
  for (const feature of clustered.features) {
    const clusterId = feature.properties.dbscan === 'core' || feature.properties.dbscan === 'edge'
      ? feature.properties.cluster
      : -1;

    if (clusterId < 0) continue;

    if (!clusterGroups.has(clusterId)) {
      clusterGroups.set(clusterId, { points: [], totalReports: 0, sources: new Set() });
    }
    const group = clusterGroups.get(clusterId);
    group.points.push(feature);
    group.totalReports += feature.properties.reportCount;
    group.sources.add(feature.properties.source);
  }

  // Construire un polygone par cluster
  const zoneFeatures = [];

  for (const [clusterId, group] of clusterGroups) {
    if (group.points.length === 0) continue;

    // Centre du cluster
    const centerFc = { type: 'FeatureCollection', features: group.points };
    const center = turf.center(centerFc);
    const centerCoords = center.geometry.coordinates;

    // Polygone = convex hull si >= 3 points, sinon buffer circulaire
    let polygon;
    if (group.points.length >= 3) {
      try {
        const hull = turf.convex(centerFc);
        // Buffer de 2km autour du hull pour couvrir les zones périphériques
        polygon = hull ? turf.buffer(hull, 2, { units: 'kilometers' }) : null;
      } catch {
        polygon = null;
      }
    }

    if (!polygon) {
      // Buffer circulaire autour du centroïde
      const radiusKm = Math.max(2, Math.min(15, Math.sqrt(group.totalReports) * 0.8));
      polygon = turf.circle(centerCoords, radiusKm, { units: 'kilometers' });
    }

    // Calculer la superficie pour la densité
    let areaKm2 = 1;
    try {
      areaKm2 = Math.max(1, turf.area(polygon) / 1_000_000);
    } catch {
      areaKm2 = Math.PI * Math.pow(DBSCAN_RADIUS_KM, 2);
    }

    const density = group.totalReports / areaKm2;
    const severity = computeSeverity(group.totalReports, density);

    zoneFeatures.push({
      type: 'Feature',
      geometry: polygon.geometry,
      properties: {
        clusterId,
        density: Math.round(density * 100) / 100,
        totalReports: group.totalReports,
        sources: [...group.sources],
        severity,
        center: centerCoords,
        radiusKm: Math.round(Math.sqrt(areaKm2 / Math.PI) * 10) / 10,
        createdAt: new Date().toISOString(),
      },
    });
  }

  // Trier par severity puis totalReports
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  zoneFeatures.sort(
    (a, b) =>
      (severityOrder[a.properties.severity] - severityOrder[b.properties.severity]) ||
      (b.properties.totalReports - a.properties.totalReports)
  );

  return { type: 'FeatureCollection', features: zoneFeatures };
}

/**
 * Fallback simple si Turf indisponible : zones circulaires par département.
 */
function buildSimpleZones(reports) {
  const byDept = new Map();
  for (const r of reports) {
    const key = r.departmentCode || r.department || 'XX';
    if (!byDept.has(key)) byDept.set(key, { reports: [], center: r.coordinates });
    byDept.get(key).reports.push(r);
  }

  const features = [];
  let id = 0;
  for (const [, group] of byDept) {
    if (group.reports.length === 0) continue;
    const total = group.reports.reduce((s, r) => s + r.reportCount, 0);
    const severity = computeSeverity(total, total / 100);
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [makeCircleCoords(group.center, 15, 12)],
      },
      properties: {
        clusterId: id++,
        density: total / (Math.PI * 225),
        totalReports: total,
        sources: [...new Set(group.reports.map((r) => r.source))],
        severity,
        center: group.center,
        radiusKm: 15,
        createdAt: new Date().toISOString(),
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

/** Génère les coordonnées d'un cercle approximatif (sans Turf). */
function makeCircleCoords([lng, lat], radiusKm, steps = 16) {
  const coords = [];
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    const dLng = (radiusKm / 111.32) / Math.cos((lat * Math.PI) / 180) * Math.cos(angle);
    const dLat = (radiusKm / 111.32) * Math.sin(angle);
    coords.push([lng + dLng, lat + dLat]);
  }
  coords.push(coords[0]); // fermer le polygone
  return coords;
}

// ── Severity Computation ────────────────────────────────────────────────────

/**
 * Calcule la sévérité d'une zone à partir du nombre de signalements et de la densité.
 *
 * Seuils calibrés pour la France :
 * - critical : > 100 signalements ET > 0.5/km²  (coupure massive)
 * - high     : > 30 signalements OU > 0.2/km²
 * - medium   : > 10 signalements
 * - low      : reste
 */
function computeSeverity(totalReports, density) {
  if (totalReports > 100 && density > 0.5) return 'critical';
  if (totalReports > 30 || density > 0.2) return 'high';
  if (totalReports > 10) return 'medium';
  return 'low';
}

// ── Geocoding (API Adresse gouv.fr) ─────────────────────────────────────────

/**
 * Géocode une ville française via l'API Adresse officielle (data.gouv.fr).
 * Cache en mémoire 24h (les centroïdes de villes ne changent pas).
 *
 * @returns {Promise<[number, number] | null>} [lng, lat] ou null si non trouvé
 */
/**
 * Géocode plusieurs villes en parallèle (batches de GEOCODE_BATCH_SIZE).
 * Retourne une Map cacheKey → [lng, lat] | null.
 */
async function geocodeCitiesBatch(cityDeptPairs) {
  const resultMap = new Map();
  for (let i = 0; i < cityDeptPairs.length; i += GEOCODE_BATCH_SIZE) {
    const batch = cityDeptPairs.slice(i, i + GEOCODE_BATCH_SIZE);
    await Promise.all(
      batch.map(async ({ city, dept }) => {
        const coords = await geocodeCity(city, dept);
        resultMap.set(`${city}|${dept}`, coords);
      })
    );
    if (i + GEOCODE_BATCH_SIZE < cityDeptPairs.length) await sleep(GEOCODE_BATCH_DELAY_MS);
  }
  return resultMap;
}

async function geocodeCity(city, dept) {
  const cacheKey = `${city}|${dept}`.toLowerCase();
  const cached = _geocodeCache.get(cacheKey);
  if (cached) return cached.coords;
  if (cached === null) return null; // marqueur "not found"

  // Pas de rate limit — l'API Adresse data.gouv.fr est conçue pour du volume
  // et le géocodage séquentiel avec 1.2s/ville provoquait des timeouts Vercel (>60s)

  try {
    const params = new URLSearchParams({
      q: city,
      type: 'municipality',
      limit: '5',
    });
    const url = `https://api-adresse.data.gouv.fr/search/?${params.toString()}`;

    const resp = await fetchWithTimeout(url, {
      headers: { 'User-Agent': USER_AGENT },
    });

    if (!resp.ok) throw new Error(`Geocode HTTP ${resp.status}`);

    const data = await resp.json();
    const features = Array.isArray(data?.features) ? data.features : [];
    const feature = pickMunicipalityFeature(features, dept);

    if (!feature) {
      _geocodeCache.set(cacheKey, null);
      return null;
    }

    const coords = [feature.geometry.coordinates[0], feature.geometry.coordinates[1]];
    _geocodeCache.set(cacheKey, { coords, ts: Date.now() });

    // TTL cleanup (éviter memory leak sur longues sessions)
    if (_geocodeCache.size > 5000) {
      const now = Date.now();
      for (const [k, v] of _geocodeCache) {
        if (v && now - v.ts > GEOCODE_CACHE_TTL_MS) _geocodeCache.delete(k);
      }
    }

    return coords;
  } catch (err) {
    console.warn(`[citizen-outages] Geocode failed for "${city}":`, err.message);
    _geocodeCache.set(cacheKey, null);
    return null;
  }
}

function pickMunicipalityFeature(features, dept) {
  if (features.length === 0) return null;
  if (!dept) return features[0];

  const normalizedDept = String(dept).padStart(2, '0');
  return features.find((feature) => {
    const props = feature?.properties ?? {};
    const citycode = String(props.citycode ?? '');
    const postcode = String(props.postcode ?? '');
    return citycode.startsWith(normalizedDept) || postcode.startsWith(normalizedDept);
  }) ?? features[0];
}

function decodeHtmlText(value) {
  return value
    .replace(/&rsquo;|&#8217;|&#x2019;/gi, '’')
    .replace(/&apos;|&#39;|&#x27;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Utilities ───────────────────────────────────────────────────────────────

/** Rate limiting par source : attend si le délai minimum n'est pas écoulé. */
async function rateLimitWait(source) {
  const last = _lastFetchTimes[source] ?? 0;
  const elapsed = Date.now() - last;
  if (elapsed < RATE_LIMIT_MS) {
    await sleep(RATE_LIMIT_MS - elapsed);
  }
  _lastFetchTimes[source] = Date.now();
}

/** fetch avec timeout AbortSignal. */
async function fetchWithTimeout(url, options = {}) {
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  return fetch(url, { ...options, signal });
}

/** Déduplique les reports par (source, city) — somme les reportCounts. */
function deduplicateReports(reports) {
  const map = new Map();
  for (const r of reports) {
    const key = `${r.source}:${r.city.toLowerCase()}`;
    if (map.has(key)) {
      map.get(key).reportCount += r.reportCount;
    } else {
      map.set(key, { ...r });
    }
  }
  return [...map.values()];
}

/** Slugifie une chaîne pour les IDs. */
function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 30);
}

/** Délai async. */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
