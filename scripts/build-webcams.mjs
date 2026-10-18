#!/usr/bin/env node
// scripts/build-webcams.mjs : recensement des webcams publiques en France (métropole et DROM) pour la couche Webcams
// → public/data/webcams.json (WebcamsDataset de src/types/index.ts). Contrat partagé avec flux_osint (src/09_webcams.py) :
// /Users/fraid/Desktop/flux_osint/docs/webcams_format.md. Relancer à la main : `npm run build:webcams`.
//
// Sources (chacune peut tomber sans bloquer les autres) :
//   a. OpenStreetMap (Overpass) : surveillance:type=webcam, webcam=*, contact:webcam=* ; le lien vient du tag. Licence ODbL des données ;
//      l'image reste au site d'origine (licence inconnue : jamais « countable »). Instances essayées tour à tour, reprise avec attente
//      exponentielle, découpage par région si la requête France entière échoue partout.
//   b. data.gouv.fr (API des jeux, licence lue dans le champ license) : Orléans Métropole, Loire-Atlantique (pont de Saint-Nazaire et
//      bacs de Loire), Anglet (littoral), Métropole de Lyon (caméras Web Criter, trouvé par la recherche « caméra » le 18/10/2026).
//      Recherche refaite le 18/10/2026 (webcam, webcams, camera trafic, caméras routières, caméra, images trafic, cameras web) : les autres
//      jeux « caméra » sont de la vidéoprotection ou du comptage, sans image publique : écartés.
//   c. Windy Webcams API v3, seulement si WINDY_WEBCAMS_KEY est définie (palier gratuit) ; ignorée sinon.
// Vivacité : une requête limitée par webcam (GET avec Range, corps abandonné, 8 s, 8 en parallèle, hôtes entrelacés) sur imageUrl sinon
// pageUrl. AUCUNE image n'est enregistrée. Aucun site n'est aspiré : seuls les liens présents dans ces sources ouvertes sont suivis.
// Commune et département : geo.api.gouv.fr (commune contenant le point) ; un point qu'elle ne place dans aucune commune française
// (pays voisin, collectivité d'outre-mer hors DROM) est écarté pour OSM et Windy.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// En-tête en ASCII seulement : un caractère accentué fait rejeter la requête par certains serveurs (API Adresse : 404).
export const USER_AGENT = 'FranceMonitor-webcams/1.0 (+https://francemonitor.com; link check only, no image stored)';
export const CHECK_TIMEOUT_MS = 8000;
export const CHECK_CONCURRENCY = 8;
export const DEDUPE_RADIUS_M = 30;
export const OVERPASS_URLS = Object.freeze([
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]);
const DATAGOUV = (id) => `https://www.data.gouv.fr/api/1/datasets/${id}/`;
const GEO_COMMUNE = (lat, lon) => `https://geo.api.gouv.fr/communes?lat=${lat}&lon=${lon}&fields=nom,code,codeDepartement&format=json`;
const BAN_SEARCH = (q) => `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=1`;

export const DATASETS = Object.freeze({
  orleans: '614139655a08d865022bd965',
  loireAtlantique: '5da150d406e3e750c129a305',
  anglet: '660211416a2043f6cd8c8f68',
  lyon: '56ebdc1788ee38517d89c52d',
});

/** Emprises : métropole et Corse, puis les cinq DROM. Un point hors de ces cadres est écarté (Nouvelle-Calédonie, etc.). */
export const AREAS = Object.freeze([
  { id: 'metropole', s: 41.2, w: -5.6, n: 51.2, e: 9.8 },
  { id: 'guadeloupe', s: 15.8, w: -61.9, n: 16.6, e: -60.9 },
  { id: 'martinique', s: 14.3, w: -61.3, n: 14.95, e: -60.75 },
  { id: 'guyane', s: 2.0, w: -54.7, n: 6.0, e: -51.5 },
  { id: 'reunion', s: -21.45, w: 55.15, n: -20.85, e: 55.9 },
  { id: 'mayotte', s: -13.05, w: 44.95, n: -12.6, e: 45.35 },
]);

/** Découpage de repli d'Overpass : la métropole en quatre, puis chaque DROM. */
export const OVERPASS_REGIONS = Object.freeze([
  { id: 'metropole-sud-ouest', s: 41.2, w: -5.6, n: 46.3, e: 2.3 },
  { id: 'metropole-sud-est', s: 41.2, w: 2.3, n: 46.3, e: 9.8 },
  { id: 'metropole-nord-ouest', s: 46.3, w: -5.6, n: 51.2, e: 2.3 },
  { id: 'metropole-nord-est', s: 46.3, w: 2.3, n: 51.2, e: 9.8 },
  ...AREAS.slice(1),
]);

const LICENSES = { lov2: 'Licence Ouverte 2.0', 'fr-lo': 'Licence Ouverte 1.0', 'odc-odbl': 'ODbL', 'cc-by': 'CC BY 4.0', 'cc-by-sa': 'CC BY-SA 4.0', 'cc-zero': 'CC0' };
/** Licence lisible d'un jeu data.gouv (champ license). */
export function licenseLabel(code) {
  return LICENSES[code] ?? (code ? String(code) : null);
}
/** Licences qui autorisent la réutilisation (contrat : Licence Ouverte, ODbL, CC BY, CC0). */
export function isReusableLicense(license) {
  return typeof license === 'string' && /licence ouverte|etalab|odbl|cc[ -]by|cc0/i.test(license);
}

const sleepReal = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** URL http(s) bien formée, sinon null (les tags OSM contiennent parfois du texte libre). */
export function cleanUrl(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim().split(/[;\s]/)[0];
  if (!/^https?:\/\//i.test(s)) return null;
  try { return new URL(s).href; } catch { return null; }
}

/** Lien direct vers une image (extension), sans requête. */
export function isDirectImageUrl(url) {
  if (!url) return false;
  try { return /\.(jpe?g|png|gif|webp)$/i.test(new URL(url).pathname); } catch { return false; }
}

export function inAreas(lat, lon) {
  return AREAS.some((a) => lat >= a.s && lat <= a.n && lon >= a.w && lon <= a.e);
}

/** Distance en mètres (haversine). */
export function distanceM(a, b) {
  const R = 6_371_000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const round6 = (v) => Math.round(v * 1e6) / 1e6;

/** Webcam avant vérification : champs du contrat, état « unknown ». */
function draft(w) {
  return {
    // Jamais de tiret cadratin dans l'app : « — » d'un nom de source devient « · ».
    id: w.id, name: typeof w.name === 'string' ? w.name.replace(/\s*\u2014\s*/g, ' · ') : w.name, lat: round6(w.lat), lon: round6(w.lon), commune: w.commune ?? null, dept: w.dept ?? null, source: w.source,
    pageUrl: w.pageUrl ?? null, imageUrl: w.imageUrl ?? null, streamUrl: w.streamUrl ?? null, license: w.license ?? null,
    attribution: w.attribution ?? null, status: 'unknown', httpStatus: null, contentType: null, checkedAt: null, countable: false,
    // Interne : le point peut-il être écarté si aucune commune française ne le contient (retiré avant écriture).
    _needsFrance: w.needsFrance ?? false,
  };
}

// ─── a. OpenStreetMap ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export function overpassQuery(bbox = null) {
  const sel = bbox ? `(${bbox.s},${bbox.w},${bbox.n},${bbox.e})` : '(area.fr)';
  const head = bbox ? '[out:json][timeout:120];' : '[out:json][timeout:180];area["ISO3166-1"="FR"][admin_level=2]->.fr;';
  return `${head}(nwr["surveillance:type"="webcam"]${sel};nwr["webcam"]${sel};nwr["contact:webcam"]${sel};);out center tags;`;
}

const OSM_ATTRIBUTION = '© contributeurs OpenStreetMap (ODbL) · image : site d’origine';

/** Éléments Overpass → webcams. Les balises de vent (man_made=monitoring_station sans surveillance:type) sont écartées :
 *  Pioupiou, Balise Météo… portent contact:webcam vers une page d'anémomètre, pas une caméra. */
export function parseOverpass(json) {
  const out = [];
  for (const e of json?.elements ?? []) {
    const t = e.tags ?? {};
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    if (typeof lat !== 'number' || typeof lon !== 'number' || !inAreas(lat, lon)) continue;
    if (t.man_made === 'monitoring_station' && !t['surveillance:type']) continue;
    const link = cleanUrl(t['contact:webcam']) ?? cleanUrl(t.webcam)
      ?? (t['surveillance:type'] === 'webcam' ? cleanUrl(t.url) ?? cleanUrl(t.website) ?? cleanUrl(t['contact:website']) : null);
    if (!link) continue;
    const image = isDirectImageUrl(link);
    const name = typeof t.name === 'string' && t.name.trim() ? t.name.trim() : null;
    out.push(draft({
      id: `osm:${e.type}/${e.id}`, name, lat, lon, source: 'osm', commune: t['addr:city'] ?? null,
      pageUrl: image ? null : link, imageUrl: image ? link : null, license: null, attribution: OSM_ATTRIBUTION, needsFrance: true,
    }));
  }
  return out;
}

async function fetchJsonOnce(url, init, fetchImpl, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { ...init, signal: ctl.signal, headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...(init?.headers ?? {}) } });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Une requête Overpass : instances tour à tour, deux essais chacune, attente exponentielle (2 s, 4 s, 8 s…). */
async function overpassRun(query, ctx) {
  let wait = ctx.backoffMs;
  const errors = [];
  for (let round = 0; round < 2; round += 1) {
    for (const url of ctx.overpassUrls) {
      try {
        const json = await fetchJsonOnce(url, {
          method: 'POST', body: new URLSearchParams({ data: query }).toString(),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }, ctx.fetchImpl, 200_000);
        if (typeof json?.remark === 'string' && /runtime error|timed out|out of memory/i.test(json.remark)) throw new Error(json.remark.slice(0, 120));
        if (!Array.isArray(json?.elements)) throw new Error('réponse sans elements');
        return json;
      } catch (err) {
        errors.push(`${new URL(url).host} : ${err.message}`);
        ctx.log(`  Overpass ${new URL(url).host} en échec (${err.message}), nouvel essai dans ${Math.round(wait / 1000)} s`);
        await ctx.sleep(wait);
        wait *= 2;
      }
    }
  }
  throw new Error(errors.join(' ; '));
}

export async function fetchOsm(ctx) {
  try {
    return parseOverpass(await overpassRun(overpassQuery(), ctx));
  } catch (err) {
    ctx.log(`  Overpass France entière impossible (${err.message}) : découpage par région`);
  }
  const all = [];
  const failed = [];
  for (const region of OVERPASS_REGIONS) {
    try {
      all.push(...parseOverpass(await overpassRun(overpassQuery(region), ctx)));
    } catch {
      failed.push(region.id);
    }
  }
  if (failed.length === OVERPASS_REGIONS.length) throw new Error('Overpass indisponible sur toutes les régions');
  if (failed.length > 0) ctx.log(`  Overpass : régions manquantes ${failed.join(', ')}`);
  return all;
}

// ─── b. data.gouv.fr ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Métadonnées d'un jeu data.gouv : licence, producteur, URL de la ressource du format voulu. */
async function datagouvResource(id, pick, ctx) {
  const meta = await fetchJsonOnce(DATAGOUV(id), {}, ctx.fetchImpl, 30_000);
  const res = (meta.resources ?? []).find(pick);
  if (!res) throw new Error(`jeu ${id} : ressource introuvable`);
  return { url: res.url, license: licenseLabel(meta.license), producer: meta.organization?.name ?? null, page: meta.page ?? null };
}

const norm = (s) => String(s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Orléans Métropole : point de la webcam, sinon adresse de l'équipement géocodée (API Adresse), retenue seulement si la commune
 *  rendue est exactement celle du jeu (l'API rend toujours une commune approchante). Illustration (url_illustration) : image fixe
 *  du site, pas la webcam : ignorée. */
export async function parseOrleans(rows, meta, geocode) {
  const out = [];
  for (const r of rows) {
    const link = cleanUrl(r.url_webcam);
    if (!link) continue;
    let pos = r.geo_point_webcam && typeof r.geo_point_webcam.lat === 'number' ? { lat: r.geo_point_webcam.lat, lon: r.geo_point_webcam.lon } : null;
    if (!pos && r.adresse_complete_equipement) pos = await geocode(r.adresse_complete_equipement, r.commune_equipement);
    if (!pos) continue;
    out.push(draft({
      id: `orleans:${r.id_webcam}`, name: r.nom_webcam || r.nom_court_webcam || null, lat: pos.lat, lon: pos.lon,
      commune: r.commune_equipement ?? null, dept: '45', source: 'orleans', pageUrl: isDirectImageUrl(link) ? null : link,
      imageUrl: isDirectImageUrl(link) ? link : null, license: meta.license, attribution: `© ${meta.producer ?? 'Orléans Métropole'}`,
    }));
  }
  return out;
}

/** Loire-Atlantique : le jeu ne donne que les images (nom de fichier) ; position de l'ouvrage filmé (approchée, rive nord). */
export const LOIRE_ATLANTIQUE_PLACES = Object.freeze({
  'psn.jpg': { name: 'Pont de Saint-Nazaire', lat: 47.2905, lon: -2.168, commune: 'Saint-Nazaire' },
  'indre1.jpg': { name: 'Bac Basse-Indre · Indret (vue 1)', lat: 47.1983, lon: -1.6802, commune: 'Indre' },
  'indre2.jpg': { name: 'Bac Basse-Indre · Indret (vue 2)', lat: 47.1983, lon: -1.6802, commune: 'Indre' },
  'coueron1.jpg': { name: 'Bac Couëron · Le Pellerin (vue 1)', lat: 47.2077, lon: -1.7302, commune: 'Couëron' },
  'coueron2.jpg': { name: 'Bac Couëron · Le Pellerin (vue 2)', lat: 47.2077, lon: -1.7302, commune: 'Couëron' },
});

export function parseLoireAtlantique(rows, meta) {
  const out = [];
  for (const r of rows) {
    const f = r.file ?? {};
    const place = LOIRE_ATLANTIQUE_PLACES[f.filename];
    const url = cleanUrl(f.url);
    if (!place || !url) continue;
    out.push(draft({
      id: `loire-atlantique:${String(f.filename).replace(/\.\w+$/, '')}`, name: place.name, lat: place.lat, lon: place.lon,
      commune: place.commune, dept: '44', source: 'loire-atlantique', pageUrl: 'https://inforoutes.loire-atlantique.fr', imageUrl: url,
      license: meta.license, attribution: `© ${meta.producer ?? 'Département de Loire-Atlantique'}`,
    }));
  }
  return out;
}

export function parseAnglet(rows, meta) {
  const out = [];
  for (const r of rows) {
    const link = cleanUrl(r.lien);
    const p = r.geo_point_2d;
    if (!link || !p || typeof p.lat !== 'number') continue;
    out.push(draft({
      id: `anglet:${r.ogc_fid}`, name: String(r.nom ?? '').replace(/^Webcam\s*-\s*/i, '').trim() || null, lat: p.lat, lon: p.lon,
      commune: 'Anglet', dept: '64', source: 'anglet', pageUrl: isDirectImageUrl(link) ? null : link, imageUrl: isDirectImageUrl(link) ? link : null,
      // La licence du jeu couvre la localisation ; l'image appartient au diffuseur du lien (Viewsurf) : licence inconnue.
      license: null, attribution: `Localisation : ${meta.producer ?? 'Commune d’Anglet'} (${meta.license ?? 'licence n.d.'}) · image : site d’origine`,
    }));
  }
  return out;
}

/** Métropole de Lyon, caméras Web Criter : image JPEG rafraîchie chaque minute (download.data.grandlyon.com). */
export function parseLyon(geojson, meta) {
  const out = [];
  for (const f of geojson?.features ?? []) {
    const p = f.properties ?? {};
    const [lon, lat] = f.geometry?.coordinates ?? [];
    const url = cleanUrl(p.url);
    if (typeof lat !== 'number' || typeof lon !== 'number' || !url) continue;
    const name = [p.nom, p.libellelong].filter((s) => typeof s === 'string' && s.trim()).join(' · ') || null;
    out.push(draft({
      id: `grand-lyon:${p.numeromaintenance ?? p.gid}`, name, lat, lon, dept: '69', source: 'grand-lyon', pageUrl: null, imageUrl: url,
      license: meta.license, attribution: `© ${meta.producer ?? 'Métropole de Lyon'} (Criter)`,
    }));
  }
  return out;
}

/** API Adresse : position retenue seulement si la commune rendue est exactement celle attendue. */
function banGeocoder(ctx) {
  return async (address, commune) => {
    try {
      const json = await fetchJsonOnce(BAN_SEARCH(address), {}, ctx.fetchImpl, 15_000);
      const f = json?.features?.[0];
      const [lon, lat] = f?.geometry?.coordinates ?? [];
      if (typeof lat !== 'number' || norm(f.properties?.city) !== norm(commune) || (f.properties?.score ?? 0) < 0.6) return null;
      return { lat, lon };
    } catch {
      return null;
    }
  };
}

// ─── c. Windy (facultatif) ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Windy Webcams API v3 : pages de 50 (le palier gratuit plafonne l'offset à 1 000). Les URL d'image expirent : page seulement. */
export async function fetchWindy(key, ctx) {
  const out = [];
  for (let offset = 0; offset < 1000; offset += 50) {
    const url = `https://api.windy.com/webcams/api/v3/webcams?countries=FR&limit=50&offset=${offset}&include=location,urls&lang=fr`;
    const json = await fetchJsonOnce(url, { headers: { 'x-windy-api-key': key } }, ctx.fetchImpl, 30_000);
    const list = json?.webcams ?? [];
    for (const w of list) {
      const loc = w.location ?? {};
      if (typeof loc.latitude !== 'number' || typeof loc.longitude !== 'number' || !inAreas(loc.latitude, loc.longitude)) continue;
      out.push(draft({
        id: `windy:${w.webcamId}`, name: w.title ?? null, lat: loc.latitude, lon: loc.longitude, commune: loc.city ?? null, source: 'windy',
        pageUrl: cleanUrl(w.urls?.detail), imageUrl: null, license: null, attribution: 'Windy.com Webcams', needsFrance: true,
      }));
    }
    if (list.length < 50) break;
  }
  return out;
}

// ─── Dédoublonnage, vivacité, commune ─────────────────────────────────────────────────────────────────────────────────────────

/** Clé de lien comparable : schéma, « www. » et barre finale ignorés. */
export function linkKey(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.host.replace(/^www\./, '').toLowerCase()}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  } catch {
    return null;
  }
}

/** Doublons : même lien principal (image directe, sinon page) à moins de 2 km, ou même source à moins de 30 m. Le seuil de 2 km garde
 *  distinctes les caméras éloignées qui renvoient vers la même page générique (accueil d'un site d'info routière). Exception aux 30 m :
 *  deux images directes distinctes au même point sont deux caméras (ex. les deux vues d'un même bac). Le premier gardé l'emporte
 *  (sources ouvertes lues avant OSM) ; il complète son image, sa page ou son nom avec ceux du doublon. */
export const SAME_LINK_RADIUS_M = 2000;
export function dedupeWebcams(list) {
  const kept = [];
  const byLink = new Map();
  for (const w of list) {
    const key = linkKey(w.imageUrl ?? w.pageUrl);
    const dup = (key ? (byLink.get(key) ?? []).find((k) => distanceM(k, w) < SAME_LINK_RADIUS_M) : undefined)
      ?? kept.find((k) => k.source === w.source && distanceM(k, w) < DEDUPE_RADIUS_M
        && !(k.imageUrl && w.imageUrl && linkKey(k.imageUrl) !== linkKey(w.imageUrl)));
    if (dup) {
      if (!dup.imageUrl && w.imageUrl) dup.imageUrl = w.imageUrl;
      if (!dup.pageUrl && w.pageUrl) dup.pageUrl = w.pageUrl;
      if (!dup.name && w.name) dup.name = w.name;
      continue;
    }
    kept.push(w);
    if (key) byLink.set(key, [...(byLink.get(key) ?? []), w]);
  }
  return kept;
}

/** Codes HTTP qui ne prouvent pas qu'un lien est mort (blocage de robot, quota) : état inconnu. */
const UNKNOWN_CODES = new Set([401, 403, 405, 406, 429, 451]);

/** Une requête limitée : GET avec Range (le corps est abandonné dès les en-têtes), délai 8 s. */
export async function checkLink(url, fetchImpl, timeoutMs = CHECK_TIMEOUT_MS) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: 'GET', redirect: 'follow', signal: ctl.signal,
      headers: { 'User-Agent': USER_AGENT, Range: 'bytes=0-1023', Accept: 'image/*,text/html;q=0.9,*/*;q=0.8' },
    });
    try { await res.body?.cancel(); } catch { /* corps déjà fermé */ }
    const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() || null;
    const status = res.status >= 200 && res.status < 400 ? 'ok' : UNKNOWN_CODES.has(res.status) ? 'unknown' : 'down';
    return { status, httpStatus: res.status, contentType };
  } catch (err) {
    // Délai dépassé : serveur lent, pas forcément mort. Nom inconnu, connexion refusée, certificat : mort.
    const aborted = err?.name === 'AbortError' || ctl.signal.aborted;
    return { status: aborted ? 'unknown' : 'down', httpStatus: null, contentType: null };
  } finally {
    clearTimeout(timer);
  }
}

/** Règle du contrat : image directe vivante (type image/*) ET licence de réutilisation. */
export function isCountable(w) {
  return w.status === 'ok' && w.imageUrl !== null && typeof w.contentType === 'string' && w.contentType.startsWith('image/')
    && isReusableLicense(w.license);
}

/** Résultat de vérification appliqué ; une page qui répond par une image devient l'image directe de la webcam. */
export function applyCheck(w, result, checkedAt) {
  const next = { ...w, status: result.status, httpStatus: result.httpStatus, contentType: result.contentType, checkedAt };
  if (!next.imageUrl && next.pageUrl && result.status === 'ok' && result.contentType?.startsWith('image/')) {
    next.imageUrl = next.pageUrl;
    next.pageUrl = null;
  }
  next.countable = isCountable(next);
  return next;
}

/** Ordre de vérification : hôtes entrelacés, pour ne jamais enchaîner huit requêtes sur le même site. */
export function interleaveByHost(list) {
  const groups = new Map();
  for (const w of list) {
    const url = w.imageUrl ?? w.pageUrl;
    let host = '';
    try { host = url ? new URL(url).host : ''; } catch { /* hôte vide */ }
    if (!groups.has(host)) groups.set(host, []);
    groups.get(host).push(w);
  }
  const queues = [...groups.values()];
  const out = [];
  for (let i = 0; out.length < list.length; i += 1) for (const q of queues) if (i < q.length) out.push(q[i]);
  return out;
}

async function pool(items, size, fn) {
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
}

/** Commune contenant le point (geo.api.gouv.fr) : { nom, dept } ; 'hors' si aucune commune française ; null si la requête échoue. */
async function communeAt(w, ctx) {
  try {
    const list = await fetchJsonOnce(GEO_COMMUNE(w.lat, w.lon), {}, ctx.fetchImpl, 15_000);
    if (!Array.isArray(list)) return null;
    if (list.length === 0) return 'hors';
    return { nom: list[0].nom, dept: list[0].codeDepartement ?? null };
  } catch {
    return null;
  }
}

// ─── Assemblage ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const SOURCE_META = Object.freeze({
  osm: { name: 'OpenStreetMap', license: 'ODbL', url: 'https://www.openstreetmap.org' },
  orleans: { name: 'Orléans Métropole (data.gouv.fr)', url: `https://www.data.gouv.fr/datasets/${DATASETS.orleans}/` },
  'loire-atlantique': { name: 'Département de Loire-Atlantique (data.gouv.fr)', url: `https://www.data.gouv.fr/datasets/${DATASETS.loireAtlantique}/` },
  anglet: { name: 'Commune d’Anglet (data.gouv.fr)', url: `https://www.data.gouv.fr/datasets/${DATASETS.anglet}/` },
  'grand-lyon': { name: 'Métropole de Lyon, caméras Web Criter (data.gouv.fr)', url: `https://www.data.gouv.fr/datasets/${DATASETS.lyon}/` },
  windy: { name: 'Windy Webcams', license: 'Conditions Windy', url: 'https://www.windy.com/webcams' },
});

/**
 * Recensement complet. `ctx` : fetchImpl (injecté par les tests), now, log, sleep, overpassUrls, backoffMs, windyKey.
 * Rend { dataset, errors } ; une source en échec est listée dans errors et absente de `sources`.
 */
export async function buildWebcams(opts = {}) {
  const ctx = {
    fetchImpl: opts.fetchImpl ?? fetch, now: opts.now ?? (() => new Date()), log: opts.log ?? ((m) => console.error(m)),
    sleep: opts.sleep ?? sleepReal, overpassUrls: opts.overpassUrls ?? OVERPASS_URLS, backoffMs: opts.backoffMs ?? 2000,
    windyKey: opts.windyKey ?? null, checkConcurrency: opts.checkConcurrency ?? CHECK_CONCURRENCY,
  };
  const errors = [];
  const licenses = {};
  const collected = [];
  const ranOk = new Set();
  const run = async (id, fn) => {
    try {
      const list = await fn();
      collected.push(...list);
      ranOk.add(id);
      ctx.log(`${id} : ${list.length} webcams lues`);
    } catch (err) {
      errors.push(`${id} : ${err.message}`);
      ctx.log(`${id} : source en échec (${err.message})`);
    }
  };

  await run('orleans', async () => {
    const meta = await datagouvResource(DATASETS.orleans, (r) => r.format === 'json' && !/geojson/i.test(r.title), ctx);
    licenses.orleans = meta.license;
    return parseOrleans(await fetchJsonOnce(meta.url, {}, ctx.fetchImpl, 30_000), meta, banGeocoder(ctx));
  });
  await run('loire-atlantique', async () => {
    const meta = await datagouvResource(DATASETS.loireAtlantique, (r) => r.format === 'json', ctx);
    licenses['loire-atlantique'] = meta.license;
    return parseLoireAtlantique(await fetchJsonOnce(meta.url, {}, ctx.fetchImpl, 30_000), meta);
  });
  await run('anglet', async () => {
    const meta = await datagouvResource(DATASETS.anglet, (r) => r.format === 'json' && !/geojson/i.test(r.title), ctx);
    licenses.anglet = meta.license;
    return parseAnglet(await fetchJsonOnce(meta.url, {}, ctx.fetchImpl, 30_000), meta);
  });
  await run('grand-lyon', async () => {
    const meta = await datagouvResource(DATASETS.lyon, (r) => r.format === 'geojson', ctx);
    licenses['grand-lyon'] = meta.license;
    return parseLyon(await fetchJsonOnce(meta.url, {}, ctx.fetchImpl, 30_000), meta);
  });
  // OSM après les jeux ouverts : en cas de doublon, la fiche du producteur (licence connue) l'emporte.
  await run('osm', () => fetchOsm(ctx));
  if (ctx.windyKey) await run('windy', () => fetchWindy(ctx.windyKey, ctx));
  else ctx.log('windy : WINDY_WEBCAMS_KEY absente, source ignorée');

  const unique = dedupeWebcams(collected);
  ctx.log(`${collected.length} lues, ${unique.length} après dédoublonnage ; communes et vérification des liens…`);

  // Commune et département (geo.api.gouv.fr), en parallèle modéré.
  const dropped = new Set();
  await pool(unique, 8, async (w) => {
    if (w.commune && w.dept) return;
    const c = await communeAt(w, ctx);
    if (c === 'hors') {
      if (w._needsFrance) dropped.add(w.id);
      return;
    }
    // Champs déjà connus de la source gardés ; seuls les manquants sont complétés.
    if (c) {
      w.commune ??= c.nom;
      w.dept ??= c.dept;
    }
  });
  const inFrance = unique.filter((w) => !dropped.has(w.id));
  if (dropped.size > 0) ctx.log(`${dropped.size} points hors des communes françaises écartés`);

  // Vivacité : imageUrl sinon pageUrl ; sans lien : inconnu.
  const checked = new Map();
  await pool(interleaveByHost(inFrance), ctx.checkConcurrency, async (w) => {
    const url = w.imageUrl ?? w.pageUrl;
    const result = url ? await checkLink(url, ctx.fetchImpl) : { status: 'unknown', httpStatus: null, contentType: null };
    checked.set(w.id, applyCheck(w, result, ctx.now().toISOString()));
  });

  const webcams = inFrance.map((w) => {
    const { _needsFrance, ...rest } = checked.get(w.id) ?? w;
    void _needsFrance;
    if (!rest.name) rest.name = rest.commune ? `Webcam · ${rest.commune}` : 'Webcam';
    return rest;
  }).sort((a, b) => a.source.localeCompare(b.source) || a.id.localeCompare(b.id));

  const counts = new Map();
  for (const w of webcams) counts.set(w.source, (counts.get(w.source) ?? 0) + 1);
  const sources = Object.keys(SOURCE_META).filter((id) => ranOk.has(id)).map((id) => ({
    id, name: SOURCE_META[id].name, license: licenses[id] ?? SOURCE_META[id].license ?? null, url: SOURCE_META[id].url, count: counts.get(id) ?? 0,
  }));
  return { dataset: { generatedAt: ctx.now().toISOString(), sources, webcams }, errors };
}

/** Fichier écrit : une webcam par ligne (diff lisible), JSON valide. */
export function serializeDataset(ds) {
  const head = JSON.stringify({ generatedAt: ds.generatedAt, sources: ds.sources });
  const lines = ds.webcams.map((w) => `  ${JSON.stringify(w)}`).join(',\n');
  return `${head.slice(0, -1)},"webcams":[\n${lines}\n]}\n`;
}

async function main() {
  const { dataset, errors } = await buildWebcams({ windyKey: process.env.WINDY_WEBCAMS_KEY || null });
  if (dataset.webcams.length === 0) throw new Error(`aucune webcam recensée (${errors.join(' ; ')}) : fichier non écrit`);
  const out = fileURLToPath(new URL('../public/data/webcams.json', import.meta.url));
  const text = serializeDataset(dataset);
  await writeFile(out, text);
  const by = (k) => dataset.webcams.filter((w) => w.status === k).length;
  console.log(`public/data/webcams.json : ${dataset.webcams.length} webcams (${dataset.sources.map((s) => `${s.id} ${s.count}`).join(', ')}) ;`
    + ` ok ${by('ok')}, down ${by('down')}, unknown ${by('unknown')} ; countable ${dataset.webcams.filter((w) => w.countable).length} ;`
    + ` ${Math.round(Buffer.byteLength(text) / 1024)} Ko`);
  if (errors.length > 0) console.log(`Sources en échec : ${errors.join(' ; ')}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
