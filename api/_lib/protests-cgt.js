// api/_lib/protests-cgt.js : rendez-vous des cartes de mobilisation de la CGT, carte.cgt.fr (03/11/2026, demandée par l'utilisateur).
// Vérifié le 03/11 : site WordPress en lecture libre ; robots.txt n'interdit que /wp-json/ et ?rest_route=, jamais lus ici. Chaque carte
// (/carto/carte/<nom>/) écrit ses points dans un tableau HTML : n°, « 77 – MELUN », date (« 5 novembre », sans année), heure (« 10h30 »),
// lieu, lat/lon (souvent arrondis au centième, donc à la commune), lien de la fiche. Les adresses des cartes changent à chaque
// mobilisation (« carte-5-novembre-2026 », « 6novembre ») : on lit toutes celles que la page d'accueil met en avant. Les cartes
// thématiques (urgences, luttes, salaires, unions départementales) n'ont pas de date et ne donnent donc rien. Annonces du syndicat,
// non confirmées.
import { cachedSource, cleanText, fetchStrictHtml } from './source-http.js';
import { icsTime } from './protests-demosphere.js';
import { cityCase } from './protests-giletsjaunes.js';

export const CGT_BASE = 'https://carte.cgt.fr';
export const CGT_EDITION = 'carte.cgt.fr';

/** Mêmes fenêtres que les autres annonces : commencées depuis moins de 6 h, ou à venir dans les 7 jours. */
export const PAST_WINDOW_MS = 6 * 3_600_000;
export const FUTURE_WINDOW_MS = 7 * 86_400_000;
const TTL_SEC = 1_800;
const TIMEOUT_MS = 20_000;
/** Garde-fou : la page d'accueil en met une dizaine en avant. */
const MAX_MAPS = 15;

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** Noms des cartes mises en avant par la page d'accueil (`/carto/carte/<nom>`), sans doublon. */
export function cgtMapSlugs(homeHtml) {
  const slugs = new Set();
  for (const m of String(homeHtml ?? '').matchAll(/carte\.cgt\.fr\/carto\/carte\/([a-z0-9-]+)/gi)) slugs.add(m[1].toLowerCase());
  return [...slugs].slice(0, MAX_MAPS);
}

const cell = (row, name) => {
  const m = new RegExp(`class="element-${name}[^"]*">([\\s\\S]*?)</td>`).exec(row);
  return m ? cleanText(m[1]) : null;
};

/** Titre de la page (« 📍 Carte du 5 novembre 2026 | carte.cgt.fr 🗺️ » → « Carte du 5 novembre 2026 »). */
export function cgtMapTitle(html) {
  const m = /<title>([\s\S]*?)<\/title>/i.exec(String(html ?? ''));
  if (!m) return null;
  const t = cleanText(m[1]).split('|')[0].replace(/[^\p{L}\p{N}\s'’-]/gu, '').replace(/\s+/g, ' ').trim();
  return t || null;
}

/** Lignes du tableau d'une carte : `{ id, title, date, hour, place, lat, lon, url, layer }`. */
export function cgtRows(html) {
  const rows = [];
  for (const row of String(html ?? '').split('<tr>').slice(1)) {
    const title = cell(row, 'title');
    if (!title) continue;
    const id = cell(row, 'id');
    const lat = Number.parseFloat(cell(row, 'lat') ?? '');
    const lon = Number.parseFloat(cell(row, 'long') ?? '');
    rows.push({
      id: id && /^\d+$/.test(id) ? id : null,
      title: title.replace(/\[\s*Voir\s*\+\s*\]/i, '').trim(),
      date: cell(row, 'date') || null, hour: cell(row, 'heure') || null, place: cell(row, 'lieu') || null,
      lat: Number.isFinite(lat) ? lat : null, lon: Number.isFinite(lon) ? lon : null,
      url: cell(row, 'url') || null, layer: cell(row, 'calque') || null,
    });
  }
  return rows;
}

/** « 77 – MELUN » → { dept: '77', city: 'Melun' } ; « 6 – NICE » → '06' ; « 80 – » → ville inconnue ; sans numéro : tout le titre est la commune. */
export function cgtPlace(title) {
  const m = /^(\d{1,3}|2[AB])\s*[–-]\s*(.*)$/i.exec(title);
  if (!m) return { dept: null, city: cityCase(title) || null };
  const dept = /^\d$/.test(m[1]) ? `0${m[1]}` : m[1].toUpperCase();
  return { dept, city: cityCase(m[2].trim()) || null };
}

/** Jour « 5 novembre » / « 1er mai » sans année : l'année qui le place au plus près de maintenant. Renvoie « AAAAMMJJ » ou null. */
export function cgtDay(text, now) {
  const m = /(\d{1,2})(?:er)?\s+([a-zéû]+)/i.exec(String(text ?? ''));
  if (!m) return null;
  const month = MONTHS.indexOf(m[2].toLowerCase()) + 1;
  const day = Number(m[1]);
  if (month === 0 || day < 1 || day > 31) return null;
  const year = new Date(now).getUTCFullYear();
  const best = [year - 1, year, year + 1].map((y) => ({ y, d: Math.abs(Date.UTC(y, month - 1, day) - now) })).sort((a, b) => a.d - b.d)[0].y;
  return `${best}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;
}

/** « 10h30 », « 9 h », « 14H00 » → « HHMM » ; null sans heure lisible. */
export function cgtClock(text) {
  const m = /(\d{1,2})\s*h\s*(\d{2})?/i.exec(String(text ?? ''));
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2] ?? '0');
  return h < 24 && mi < 60 ? `${String(h).padStart(2, '0')}${String(mi).padStart(2, '0')}` : null;
}

/** Rendez-vous de la couche Manifestations : `{ items, rows, undated }` (cartes lues : `{ slug, html }`). */
export function cgtItems(maps, now) {
  const items = [];
  const seen = new Set();
  let rows = 0;
  let undated = 0;
  for (const { slug, html } of maps) {
    const mapTitle = cgtMapTitle(html);
    for (const r of cgtRows(html)) {
      rows += 1;
      const day = cgtDay(r.date, now);
      if (day === null) { undated += 1; continue; }
      const clock = cgtClock(r.hour);
      const start = icsTime(`${day}T${clock ?? '0000'}00`);
      if (start === null) continue;
      const end = clock ? start + PAST_WINDOW_MS : start + 86_400_000;
      if (end < now || start > now + FUTURE_WINDOW_MS) continue;
      // Un même rendez-vous peut figurer sur deux cartes (carte du jour et carte des mobilisations).
      const id = `cgt:${r.id ?? `${slug}:${r.title}`}:${day}:${clock ?? 'journee'}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const { dept, city } = cgtPlace(r.title);
      const placed = r.lat !== null && r.lon !== null;
      items.push({
        id, source: 'cgt', status: 'annonce',
        title: 'Mobilisation (CGT)',
        startsAt: new Date(start).toISOString(), allDay: clock === null,
        city, dept, lat: placed ? r.lat : null, lon: placed ? r.lon : null,
        url: r.url ?? `${CGT_BASE}/carto/carte/${slug}/`,
        edition: r.layer ?? mapTitle,
        place: r.place,
        violent: false, participants: null, precision: placed ? 'commune' : null,
        articles: [], articleCount: 0,
      });
    }
  }
  return { items, rows, undated };
}

/** Cartes de la page d'accueil, relues toutes les 30 min ; seules les lignes datées sont gardées en cache. */
export async function loadCgt(now) {
  const { maps } = await cachedSource('protests:cgt:v1', { ttlSec: TTL_SEC }, async () => {
    const opts = { timeoutMs: TIMEOUT_MS };
    const slugs = cgtMapSlugs(await fetchStrictHtml(`${CGT_BASE}/`, opts));
    if (slugs.length === 0) throw new Error('aucune carte sur la page d’accueil');
    const read = await Promise.allSettled(slugs.map((slug) => fetchStrictHtml(`${CGT_BASE}/carto/carte/${slug}/`, opts)));
    if (read.every((r) => r.status === 'rejected')) throw read[0].reason;
    const out = [];
    read.forEach((r, i) => {
      if (r.status !== 'fulfilled') return;
      // Page réduite à son titre et à ses lignes datées (une carte pèse jusqu'à 600 Ko).
      const kept = r.value.split('<tr>').slice(1).filter((row) => cell(row, 'date'));
      if (kept.length === 0) return;
      const title = /<title>[\s\S]*?<\/title>/i.exec(r.value)?.[0] ?? '';
      out.push({ slug: slugs[i], html: `${title}<table>${kept.map((row) => `<tr>${row.split('</tr>')[0]}</tr>`).join('')}</table>` });
    });
    return { maps: out };
  });
  return cgtItems(maps, now);
}
