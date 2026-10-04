// api/_lib/seismes.js : séismes des 7 derniers jours en France et à 20 km autour (spec 2026-10-04 environnement § 3.3, contrats § 2.8).
// BCSF-RéNaSS (FDSN, sans clé) filtré par RAYON : la boîte minlat/maxlat/minlon/maxlon est ignorée par l'API (vérifié le 04/10 :
// 1 000 événements mondiaux), et les paramètres de date et de magnitude renvoient 500 ; la fenêtre de 7 jours est appliquée ici.
// « En France » (amendement 2) : territoire métropolitain (Corse comprise) ou eaux françaises ; hors de France à 20 km au plus :
// gardé, en gris. Tirs de carrière, explosions et glissements écartés (comptés). Repli EMSC (boîte appliquée par l'API).
import { departementAt, distanceToMetropoleKm, insideMetropole } from './geo-fr.js';
import { inFrenchWaters } from './ais-snapshot.js';
import { cachedSource, cleanText, fetchStrictJson, sourceError } from './source-http.js';

export const BCSF_URL = 'https://api.franceseisme.fr/fdsnws/event/1/query?format=json&latitude=46.5&longitude=2.5&maxradius=8&orderby=time&limit=1000';
export const BCSF_LIMIT = 1000;
export const EMSC_BASE = 'https://www.seismicportal.eu/fdsnws/event/1/query';
export const QUAKE_WINDOW_MS = 7 * 86_400_000;
export const NEAR_KM = 20;
const MAX_DISTANCE_KM = 999;
const SEARCH_KM = 400;
const EMSC_SEISMIC = new Set(['ke', 'se']);

/** Repli EMSC : boîte de la spec (appliquée par cette API) et début de fenêtre à la seconde, sans fuseau (format accepté le 04/10). */
export function emscUrl(since) {
  return `${EMSC_BASE}?format=json&minlat=40.8&maxlat=51.5&minlon=-5.8&maxlon=10.0&start=${since.slice(0, 19)}&orderby=time&limit=1000`;
}

const round = (v, digits) => Math.round(v * 10 ** digits) / 10 ** digits;

/** Périmètre d'un épicentre : en France (territoire ou eaux françaises), distance au territoire, gardé ou non. */
export function quakeScope(lat, lon) {
  const onLand = insideMetropole(lat, lon);
  const inFrance = onLand || inFrenchWaters(lat, lon);
  const raw = onLand ? 0 : distanceToMetropoleKm(lat, lon, SEARCH_KM);
  const distanceKm = Number.isFinite(raw) ? Math.min(MAX_DISTANCE_KM, round(raw, 1)) : MAX_DISTANCE_KM;
  return { inFrance, distanceKm, keep: inFrance || distanceKm <= NEAR_KM };
}

function inWindow(t, now) {
  return Number.isFinite(t) && t <= now + 60_000 && now - t <= QUAKE_WINDOW_MS;
}

function byTimeDesc(a, b) {
  return Date.parse(b.at) - Date.parse(a.at);
}

function titleCase(text) {
  return String(text ?? '').toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_m, sep, ch) => `${sep}${ch.toUpperCase()}`).trim();
}

function quake(base, lat, lon, scope) {
  return { ...base, lat: round(lat, 4), lon: round(lon, 4), dept: departementAt(lat, lon), distanceKm: scope.distanceKm, inFrance: scope.inFrance };
}

/** Réponse BCSF-RéNaSS : séismes gardés (plus récent d'abord), événements non sismiques comptés, fenêtre de 7 jours complète ou non. */
export function parseBcsf(fc, now) {
  if (!fc || typeof fc !== 'object' || !Array.isArray(fc.features)) throw new Error('FeatureCollection attendue');
  const quakes = [];
  let nonSeismic = 0;
  let oldest = Infinity;
  for (const f of fc.features) {
    const p = f?.properties ?? {};
    const t = Date.parse(String(p.time ?? ''));
    const lat = Number(p.latitude);
    const lon = Number(p.longitude);
    const mag = Number(p.mag);
    if (!Number.isFinite(t) || !Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(mag)) continue;
    oldest = Math.min(oldest, t);
    if (!inWindow(t, now)) continue;
    const scope = quakeScope(lat, lon);
    if (!scope.keep) continue;
    const type = typeof p.type === 'string' ? p.type : null;
    if (type !== null && type !== 'earthquake') { nonSeismic += 1; continue; }
    const depth = Number(p.depth);
    quakes.push(quake({
      id: String(f.id ?? `${p.time}`), at: new Date(t).toISOString(), depthKm: Number.isFinite(depth) ? round(depth, 1) : null, magnitude: round(mag, 1),
      magType: typeof p.magType === 'string' ? p.magType : null, type, description: cleanText(p.description?.fr ?? p.description?.en ?? ''),
      status: p.automatic === false ? 'revu' : 'automatique', url: typeof p.url?.fr === 'string' ? p.url.fr : null, source: 'BCSF-RéNaSS',
    }, lat, lon, scope));
  }
  return { quakes: quakes.sort(byTimeDesc), nonSeismic, complete: fc.features.length < BCSF_LIMIT || oldest <= now - QUAKE_WINDOW_MS };
}

/** Réponse EMSC (repli) : région en clair, statut « automatique » (aucune révision publiée), types ke et se seulement. */
export function parseEmsc(fc, now) {
  if (!fc || typeof fc !== 'object' || !Array.isArray(fc.features)) throw new Error('FeatureCollection attendue');
  const quakes = [];
  let nonSeismic = 0;
  for (const f of fc.features) {
    const p = f?.properties ?? {};
    const t = Date.parse(String(p.time ?? ''));
    const lat = Number(p.lat);
    const lon = Number(p.lon);
    const mag = Number(p.mag);
    if (!Number.isFinite(t) || !Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(mag) || !inWindow(t, now)) continue;
    const scope = quakeScope(lat, lon);
    if (!scope.keep) continue;
    const type = typeof p.evtype === 'string' ? p.evtype : null;
    if (type !== null && !EMSC_SEISMIC.has(type)) { nonSeismic += 1; continue; }
    const id = String(p.unid ?? f.id ?? p.time);
    const depth = Number(p.depth);
    quakes.push(quake({
      id, at: new Date(t).toISOString(), depthKm: Number.isFinite(depth) ? round(depth, 1) : null, magnitude: round(mag, 1),
      magType: typeof p.magtype === 'string' ? p.magtype : null, type, description: titleCase(p.flynn_region), status: 'automatique',
      url: `https://www.seismicportal.eu/eventdetails.html?unid=${encodeURIComponent(id)}`, source: 'EMSC',
    }, lat, lon, scope));
  }
  return { quakes: quakes.sort(byTimeDesc), nonSeismic };
}

export function emptyQuakes(errors) {
  return { readAt: null, source: null, quakes: [], nonSeismic: 0, errors };
}

function served(v, now, errors) {
  return { readAt: v.readAt, source: v.source, quakes: v.quakes.filter((q) => now - Date.parse(q.at) <= QUAKE_WINDOW_MS), nonSeismic: v.nonSeismic, errors };
}

const FETCH_TIMEOUT_MS = 20_000;
const FRESH_SEC = 600;
/**
 * Âge du relevé BCSF encore servi sans panne : `readAt` est daté AVANT la lecture et le cache compte ses 10 min APRÈS elle ;
 * une lecture dure au plus FETCH_TIMEOUT_MS, d'où la marge (sinon une entrée encore fraîche pour le cache passerait pour une panne).
 */
const FRESH_READ_MS = FRESH_SEC * 1000 + FETCH_TIMEOUT_MS;
/** Relevé BCSF périmé (relecture en échec) : panne nommée ; la date du relevé est dans `readAt`, dite à l'heure de Paris par la vue. */
export const BCSF_DOWN_ERROR = 'BCSF-RéNaSS : source indisponible';
export const BCSF_STALE_SERVED_ERROR = 'BCSF-RéNaSS : source indisponible, relevé précédent servi';

/**
 * BCSF-RéNaSS d'abord (cache de 10 min, attente alignée sur le délai de lecture), EMSC en repli. Une valeur BCSF périmée
 * (servie par le cache après un échec) compte comme une panne nommée : EMSC est essayé ; si lui aussi échoue, la valeur
 * périmée est servie avec sa date de lecture d'origine et les deux pannes nommées. Jamais de panne silencieuse.
 */
export async function loadEarthquakes(now = Date.now()) {
  const errors = [];
  const readAt = new Date(now).toISOString();
  let stale = null;
  try {
    const v = await cachedSource('env:seismes', { ttlSec: FRESH_SEC, staleSec: 86_400, shared: false, waitMs: FETCH_TIMEOUT_MS }, async () => {
      const parsed = parseBcsf(await fetchStrictJson(BCSF_URL, { timeoutMs: FETCH_TIMEOUT_MS }), now);
      if (!parsed.complete) throw new Error('fenêtre de 7 jours incomplète');
      return { quakes: parsed.quakes, nonSeismic: parsed.nonSeismic, source: 'BCSF-RéNaSS', readAt };
    });
    if (now - Date.parse(v.readAt) <= FRESH_READ_MS) return served(v, now, errors);
    stale = v;
  } catch (err) {
    errors.push(sourceError('BCSF-RéNaSS', err));
  }
  try {
    const v = await cachedSource('env:seismes:emsc', { ttlSec: FRESH_SEC, staleSec: 86_400, shared: false, waitMs: FETCH_TIMEOUT_MS }, async () => {
      const parsed = parseEmsc(await fetchStrictJson(emscUrl(new Date(now - QUAKE_WINDOW_MS).toISOString()), { timeoutMs: FETCH_TIMEOUT_MS }), now);
      return { quakes: parsed.quakes, nonSeismic: parsed.nonSeismic, source: 'EMSC', readAt };
    });
    // EMSC servi : le relevé BCSF périmé ne l'est pas, la panne seule est nommée.
    return served(v, now, stale ? [BCSF_DOWN_ERROR, ...errors] : errors);
  } catch (err) {
    errors.push(sourceError('EMSC (repli)', err));
  }
  return stale ? served(stale, now, [BCSF_STALE_SERVED_ERROR, ...errors]) : emptyQuakes(errors);
}
