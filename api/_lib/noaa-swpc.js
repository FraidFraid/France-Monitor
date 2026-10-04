// api/_lib/noaa-swpc.js : météo spatiale NOAA SWPC (spec 2026-10-04 souveraineté § 3.1 ; contrats § 2.5 ; faits § 5.11). Domaine
// public (NWS). Trois produits lus à part, chacun avec sa panne nommée : échelles R, S, G du jour et prévues (« noaa-scales.json »,
// valeurs en chaînes ; la clé « 1 » est la prévision du jour même), indice Kp planétaire par tranche de 3 h (liste d'objets), dernière
// alerte (« alerts.json », texte brut). Petits : cache partagé de 15 min. Une prévision R ou S non publiée reste null, jamais 0.
// Lecture stricte par api/_lib/source-http.js, User-Agent FranceMonitor imposé.
import { cachedSource, fetchStrictJson, sourceError } from './source-http.js';

export const NOAA_SCALES_URL = 'https://services.swpc.noaa.gov/products/noaa-scales.json';
export const NOAA_KP_URL = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json';
export const NOAA_ALERTS_URL = 'https://services.swpc.noaa.gov/products/alerts.json';
export const NOAA_TTL_SEC = 15 * 60;
export const KP_WINDOW_MS = 7 * 86_400_000;
const KP_SLOT_MS = 3 * 3_600_000;
const TIMEOUT_MS = 15_000;
const MAX_KP_POINTS = 60;
const ALERT_TITLE = /^(?:ALERT|WARNING|WATCH|SUMMARY|CONTINUED ALERT|EXTENDED WARNING|CANCEL[A-Z ]*):/;

/** Nombre publié en chaîne ou en nombre ; null si absent ou illisible (jamais 0 pour une absence). */
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** « 2026-10-04 14:03:28.167 » ou « 2026-10-04T09:00:00 » (UTC sans fuseau) vers ISO UTC ; null si illisible. */
function utcIso(text) {
  const s = String(text ?? '').trim().replace(' ', 'T');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(s)) return null;
  const t = Date.parse(`${s}Z`);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** Échelles du jour (clé « 0 », observée) et prévues (clés « 1 » à « 3 », datées par DateStamp). */
export function parseScales(json) {
  const day = (key, observed) => {
    const e = json && typeof json === 'object' ? json[key] : null;
    if (!e || typeof e !== 'object' || !/^\d{4}-\d{2}-\d{2}$/.test(String(e.DateStamp ?? ''))) return null;
    return {
      date: e.DateStamp, observed, r: num(e.R?.Scale), s: num(e.S?.Scale), g: num(e.G?.Scale), rMinorProb: num(e.R?.MinorProb),
      rMajorProb: num(e.R?.MajorProb), sProb: num(e.S?.Prob),
    };
  };
  const today = day('0', true);
  if (!today) throw new Error('échelles illisibles (clé « 0 » absente)');
  const forecast = ['1', '2', '3'].map((k) => day(k, false)).filter((d) => d !== null);
  return { today, forecast, scalesAt: utcIso(`${json['0'].DateStamp} ${json['0'].TimeStamp ?? ''}`) };
}

/** Tranches de 3 h `{ at, kp }`, plus ancienne d'abord, 60 au plus. */
export function parseKp(json) {
  if (!Array.isArray(json)) throw new Error('indice Kp illisible (liste attendue)');
  const points = [];
  for (const row of json) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const at = utcIso(row.time_tag);
    const kp = num(row.Kp);
    if (at !== null && kp !== null) points.push({ at, kp });
  }
  if (points.length === 0) throw new Error('indice Kp illisible (aucune tranche)');
  return points.sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(-MAX_KP_POINTS);
}

/** Alerte la plus récente : produit, heure d'émission, ligne de titre (ALERT, WARNING, WATCH, SUMMARY), échelle G citée (casse variable). */
export function parseAlerts(json) {
  if (!Array.isArray(json)) throw new Error('alertes illisibles (liste attendue)');
  let best = null;
  for (const a of json) {
    const issuedAt = utcIso(a?.issue_datetime);
    if (issuedAt === null || typeof a.product_id !== 'string') continue;
    if (best !== null && Date.parse(issuedAt) <= Date.parse(best.issuedAt)) continue;
    const message = String(a.message ?? '');
    const title = message.split(/\r?\n/).map((l) => l.trim()).find((l) => ALERT_TITLE.test(l)) ?? a.product_id;
    const g = /NOAA Scale:\s*G(\d)/i.exec(message);
    best = { productId: a.product_id, issuedAt, title, gScale: g ? Number(g[1]) : null };
  }
  return best;
}

/** Météo spatiale vide (jamais lue). */
export function emptySpaceWeather() {
  return { readAt: null, scalesAt: null, today: null, forecast: [], kp: [], lastAlert: null };
}

/** Un produit en cache partagé de 15 min, avec l'heure de sa lecture. */
function part(key, url, parse, now) {
  return cachedSource(`sov:noaa:${key}`, { ttlSec: NOAA_TTL_SEC, shared: true }, async () => ({
    readAt: new Date(now).toISOString(), value: parse(await fetchStrictJson(url, { timeoutMs: TIMEOUT_MS })),
  }));
}

/**
 * Météo spatiale du moment : chaque produit à sa cadence, une panne nommée par produit (les autres servis) ; ne lève jamais.
 * `readAt` : lecture la plus récente des trois ; Kp : tranches dont la fin tombe dans les 7 derniers jours.
 * @param {number} [now]
 */
export async function loadSpaceWeather(now = Date.now()) {
  const [scales, kp, alerts] = await Promise.allSettled([
    part('scales', NOAA_SCALES_URL, parseScales, now), part('kp', NOAA_KP_URL, parseKp, now), part('alerts', NOAA_ALERTS_URL, parseAlerts, now),
  ]);
  const sw = emptySpaceWeather();
  const errors = [];
  const reads = [];
  if (scales.status === 'fulfilled') {
    sw.today = scales.value.value.today;
    sw.forecast = scales.value.value.forecast;
    sw.scalesAt = scales.value.value.scalesAt;
    reads.push(scales.value.readAt);
  } else errors.push(sourceError('NOAA SWPC, échelles', scales.reason));
  if (kp.status === 'fulfilled') {
    sw.kp = kp.value.value.filter((p) => Date.parse(p.at) + KP_SLOT_MS > now - KP_WINDOW_MS);
    reads.push(kp.value.readAt);
  } else errors.push(sourceError('NOAA SWPC, indice Kp', kp.reason));
  if (alerts.status === 'fulfilled') {
    sw.lastAlert = alerts.value.value;
    reads.push(alerts.value.readAt);
  } else errors.push(sourceError('NOAA SWPC, alertes', alerts.reason));
  sw.readAt = reads.reduce((best, r) => (best === null || Date.parse(r) > Date.parse(best) ? r : best), null);
  return { spaceWeather: sw, errors };
}
