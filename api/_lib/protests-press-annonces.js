// api/_lib/protests-press-annonces.js : rassemblements ANNONCÉS par la presse déjà ingérée (« les maires appellent au rassemblement
// devant la mairie ce lundi », « un acte II annoncé pour les samedis 24 et 31 octobre »). Mesure du 19/10/2026 : des dizaines de
// titres par jour annoncent un rendez-vous à venir que Démosphère n'a pas (Démosphère Paris est fermé depuis 2020).
// Un titre compte s'il parle d'une manifestation, porte un marqueur d'annonce (appel, prévu, annoncé, organisé, demain, ce lundi…)
// et une date à venir lisible ; lieu = villes ou départements cités dans le titre (headlinePlaces), jamais deviné.
import { getDb, hasDatabaseUrl } from './db.js';
import { icsTime } from './protests-demosphere.js';
import { headlinePlaces, isProtestHeadline } from './protests-press.js';
import { geocodeQuery } from './server-geocoder.js';
import { cachedSource } from './source-http.js';

/** Rendez-vous gardés : commencés depuis moins de 6 h, ou à venir dans les 7 jours (comme Démosphère). */
export const PAST_WINDOW_MS = 6 * 3_600_000;
export const FUTURE_WINDOW_MS = 7 * 86_400_000;
const MAX_ARTICLES = 8;

const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, "'");

const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
const DAY_RE = DAYS.join('|');

// Annonce : appel, prévision, organisation, futur. « Annonce » couvre aussi « annonce le préfet » : la date à venir tranche.
const FUTURE = /\bappel(?:le|lent|ait|aient)?\b|\ba l'appel\b|\bappels?\b|\bprevue?s?\b|\bannonc|\borganise(?:e|es|s|nt)?\b|\bauront? lieu\b|\bse tiendra|\bse rassembleront\b|\bmanifesteront\b|\bdefileront\b|\bvont (?:se )?(?:rassembler|manifester|defiler)|\bva (?:se )?(?:rassembler|manifester)|\bse prepare|\bdemain\b|\bprochain/;
// Interdiction : gardée seulement si le titre annonce aussi un rendez-vous précis (« une manifestation prévue demain à Lille sera
// interdite ») ; une interdiction générale (« rassemblements interdits ce lundi à Marseille ») n'est pas un rendez-vous.
const BANNED = /\binterdi/;
const ANNOUNCED_EVENT = /\bprevue?s?\b|\bannonce(?:e|es|s)?\b|\bappel/;
// Ni conseil aux voyageurs ni appel aux dons (« l'ESF lance un appel à la mobilisation face au manque de dons de plasma »).
// Les directs (« DIRECT. Manifestations du 17 octobre : … ») mêlent plusieurs faits en un titre : jamais lus comme une annonce.
const NOT_ANNOUNCE = /^(?:en )?direct\b|^live\b|\ben direct\b|\bevitez\b|\bressortissants\b|\bdons?\b|\bdon du sang\b|\bplasma\b|\bbenevoles\b/;

/** Jour de Paris d'un instant : `{ y, m, d, wd }` (m de 1 à 12, wd 0 = dimanche). */
export function parisDay(ms) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })
    .formatToParts(ms).map((p) => [p.type, p.value]));
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day), wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday) };
}

/** Jour de Paris décalé de `n` jours (calcul sur le calendrier, sans heure d'été). */
const addDays = ({ y, m, d }, n) => {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), wd: t.getUTCDay() };
};
const dayKey = ({ y, m, d }) => `${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;
const sameOrAfter = (a, b) => dayKey(a) >= dayKey(b);

/** Prochain jour de semaine `wd` à partir d'aujourd'hui (aujourd'hui compris, sauf `strict`). */
const nextWeekday = (today, wd, strict = false) => addDays(today, ((wd - today.wd + 7) % 7) || (strict ? 7 : 0));

/**
 * Jours annoncés d'un titre, relativement à sa publication (heure de Paris) : dates écrites (« samedi 24 octobre », « les samedis
 * 24 et 31 octobre », « le 5 novembre »), « demain », « ce lundi », « lundi prochain », « ce week-end », « aujourd'hui », « ce soir ».
 * Seuls les jours à partir de celui de la publication sont rendus (« Violences du 17 octobre » publié le 19 n'en est pas un).
 */
export function announcedDays(title, publishedAt) {
  const future = FUTURE.test(fold(title));
  // Citations retirées : « "Demain, je veux des explications" » n'annonce rien.
  const t = withoutQuotes(title);
  const today = parisDay(publishedAt);
  const out = new Map();
  const add = (day) => { if (sameOrAfter(day, today)) out.set(dayKey(day), day); };
  const monthRe = new RegExp(`\\b(1er|\\d{1,2})((?:\\s*(?:,|et)\\s*(?:1er|\\d{1,2}))*)\\s+(${MONTHS.join('|')})\\b`, 'g');
  for (const m of t.matchAll(monthRe)) {
    const month = MONTHS.indexOf(m[3]) + 1;
    for (const raw of [m[1], ...(m[2].match(/1er|\d{1,2}/g) ?? [])]) {
      const d = raw === '1er' ? 1 : Number(raw);
      if (d < 1 || d > 31) continue;
      // Année de la publication ; un mois déjà loin derrière (janvier lu en décembre) passe à l'année suivante.
      const y = month < today.m - 2 ? today.y + 1 : today.y;
      add(addDays({ y, m: month, d: 1 }, d - 1));
    }
  }
  if (/\bdemain\b/.test(t)) add(addDays(today, 1));
  if (/\baujourd'hui\b|\bce (?:midi|soir|matin)\b|\bcet apres-midi\b|\bcette apres-midi\b/.test(t)) add(today);
  if (/\bce (?:week-?end|weekend)\b/.test(t)) add(nextWeekday(today, 6));
  for (const m of t.matchAll(new RegExp(`\\b(?:(ce|cette|des ce|des)\\s+)?(${DAY_RE})(?:\\s+(prochain|midi|soir|matin|apres-midi))?\\b`, 'g'))) {
    const wd = DAYS.indexOf(m[2]);
    // Jour suivi d'une date écrite (déjà comptée) ou au pluriel (« les samedis 24 et 31 octobre ») : ignoré ici.
    if (/^\s*(?:1er|\d{1,2})\b/.test(t.slice(m.index + m[0].length)) || t[m.index + m[0].length] === 's') continue;
    if (m[3] === 'prochain') add(nextWeekday(today, wd, true));
    else if (m[1] || m[3]) {
      // « Ce samedi » lu un lundi : samedi passé dans un compte rendu, samedi prochain dans une annonce (« un acte II dès ce samedi »).
      const back = (today.wd - wd + 7) % 7;
      if (back === 0 || future || back > 3) add(nextWeekday(today, wd));
    }
    // Jour nu (« samedi ») : presque toujours un jour passé (« a perdu un œil samedi », « en marge de la manifestation samedi »), jamais lu.
  }
  return [...out.values()];
}

/** Titre replié sans ses citations entre guillemets (« … », "…", “…”). */
const withoutQuotes = (title) => fold(String(title).replace(/«[^»]*»|"[^"]*"|“[^”]*”/g, ' '));

/** Heure annoncée (heure de Paris) : « 18h », « 18 h 30 », « midi », « ce soir » (18 h) ; null si aucune. */
export function announcedHour(title) {
  const t = withoutQuotes(title);
  const m = /\b(?:a|des|de|vers)?\s*(\d{1,2})\s?h\s?(\d{2})?\b(?!\s*(?:de garde|sur|par))/.exec(t);
  if (m && Number(m[1]) <= 23 && Number(m[2] ?? 0) <= 59) return [Number(m[1]), Number(m[2] ?? 0)];
  if (/\bmidi\b/.test(t)) return [12, 0];
  if (/\bsoir\b|\bsoiree\b/.test(t)) return [18, 0];
  return null;
}

// Jour à venir nommé : suffit comme marqueur d'annonce (« un rassemblement pacifique ce lundi 19 octobre, à Brest ») ; la date lue
// doit ensuite tomber à partir du jour de publication.
const DAY_MARKER = new RegExp(`\\bdemain\\b|\\bce (?:midi|soir)\\b|\\b(?:ce|cette|des ce) (?:${DAY_RE})\\b|\\b(?:${DAY_RE}) (?:prochain|midi|soir)\\b|\\b(?:1er|\\d{1,2}) (?:${MONTHS.join('|')})\\b`);

/** Vrai si le titre annonce un rassemblement à venir (sans juger de la date, lue à part). */
export function isAnnouncementHeadline(title) {
  const t = fold(title);
  if (!isProtestHeadline(title) || NOT_ANNOUNCE.test(t) || !(FUTURE.test(t) || DAY_MARKER.test(t))) return false;
  return !BANNED.test(t) || ANNOUNCED_EVENT.test(t);
}

/** Lieu de rendez-vous nommé dans le titre (« devant la mairie », « place du Capitole »), rattaché à la commune ; null sinon. */
export function announcedPlace(title, city) {
  const t = fold(title);
  if (!city) return null;
  if (/\bdevant (?:la |leur |les )?(?:mairie|hotel de ville)s?\b/.test(t)) return /^[aeiouyhâéèêîôûAEIOUYHÂÉÈÊÎÔÛ]/.test(city) ? `Mairie d'${city}` : `Mairie de ${city}`;
  if (/\bdevant (?:la )?prefecture\b/.test(t)) return `Préfecture, ${city}`;
  const m = /\b(place|parvis|esplanade) (?:de la |du |des |de l'|de |d')?([a-z][a-z' -]{2,40}?)(?=\s*(?:[,.;:!?]|$|\s(?:a|ce|cette|des|le|la|les|pour|contre|en|apres|avant|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b))/.exec(t);
  if (!m) return null;
  const raw = String(title).slice(m.index, m.index + m[0].length);
  return `${raw.charAt(0).toUpperCase()}${raw.slice(1)}, ${city}`;
}

const domainOf = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
};
const titleKey = (title) => fold(title).replace(/^[a-z' -]{2,30}\.\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Rassemblements annoncés : un par lieu et par jour annoncé, dans la fenêtre (6 h passées, 7 jours à venir). `rows` = `{ title, link,
 * feed, region, at }` (at en ms) ; même dépêche reprise par plusieurs journaux comptée une fois. Rend `{ items, matched, unplaced }`.
 */
export async function groupAnnouncements(rows, now, resolve, localByRegion = new Map()) {
  const byKey = new Map();
  let matched = 0;
  let unplaced = 0;
  for (const row of rows) {
    if (!row.title || !/^https?:\/\//.test(row.link ?? '') || row.at > now + 3_600_000 || !isAnnouncementHeadline(row.title)) continue;
    const days = announcedDays(row.title, row.at);
    if (days.length === 0) continue;
    const hour = announcedHour(row.title);
    const starts = days.map((day) => {
      const [h, mi] = hour ?? [0, 0];
      const start = icsTime(`${dayKey(day)}T${String(h).padStart(2, '0')}${String(mi).padStart(2, '0')}00`);
      return { day, start, allDay: hour === null };
    }).filter(({ start, allDay }) => {
      const end = allDay ? start + 86_400_000 : start + PAST_WINDOW_MS;
      return end >= now && start <= now + FUTURE_WINDOW_MS;
    });
    if (starts.length === 0) continue;
    matched += 1;
    const places = await headlinePlaces(row.title, resolve, localByRegion.get(row.region) ?? null);
    if (places.length === 0) { unplaced += 1; continue; }
    const banned = BANNED.test(fold(row.title));
    for (const place of places) {
      for (const { day, start, allDay } of starts) {
        const key = `${place.lat.toFixed(3)},${place.lon.toFixed(3)}:${dayKey(day)}`;
        const group = byKey.get(key) ?? { place, start, allDay, articles: new Map(), banned: false, rdv: null };
        // Une heure précise l'emporte sur « toute la journée ».
        if (group.allDay && !allDay) Object.assign(group, { start, allDay });
        group.banned ||= banned;
        group.rdv ??= place.dept ? null : announcedPlace(row.title, place.name);
        const tk = titleKey(row.title);
        const prev = group.articles.get(tk);
        if (!prev || row.at > prev.at) group.articles.set(tk, row);
        byKey.set(key, group);
      }
    }
  }
  const items = [...byKey.entries()].map(([key, g]) => {
    const articles = [...g.articles.values()].sort((a, b) => b.at - a.at);
    return {
      id: `presse-annonce:${key}`,
      source: 'presse',
      status: 'annonce',
      title: g.banned ? 'Rassemblement annoncé, interdit par la préfecture' : 'Rassemblement annoncé',
      startsAt: new Date(g.start).toISOString(),
      allDay: g.allDay,
      city: g.place.name,
      dept: null,
      lat: g.place.lat,
      lon: g.place.lon,
      url: articles[0].link,
      place: g.rdv,
      edition: null,
      violent: false,
      participants: null,
      precision: g.place.dept ? 'departement' : 'commune',
      articles: articles.slice(0, MAX_ARTICLES).map((a) => ({
        url: a.link, domain: domainOf(a.link), seenAt: new Date(a.at).toISOString(), violent: false, title: a.title, outlet: a.feed ?? null,
      })),
      articleCount: articles.length,
    };
  });
  return { items, matched, unplaced };
}

// Préfiltre SQL large : un mot de manifestation ET un marqueur d'annonce ; le tri fin est fait par isAnnouncementHeadline.
const SQL_PROTEST = "(manif|rassembl|cort[eè]ge|gr[eè]v|mobilis|gilets? jaunes?|marche blanche|intersyndicale|sit-?in)";
const SQL_FUTURE = "(appel|pr[eé]vu|annonc|organis|aura lieu|auront lieu|demain|prochain|ce (lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|week|soir|midi)|cette semaine)";
const MAX_ROWS = 1500;

/** Annonces de la presse publiées depuis 7 jours : `{ items, matched, unplaced, scanned }`. Lève sans DATABASE_URL. */
export async function loadPressAnnouncements(now) {
  if (!hasDatabaseUrl()) throw new Error('base des articles non configurée');
  return cachedSource('protests:presse-annonces', { ttlSec: 300, waitMs: 20_000 }, async () => {
    const sql = getDb();
    const rows = await sql.query(
      `SELECT n.title, n.link, f.name AS feed, f.region, COALESCE(n.published_at, n.collected_at) AS at
         FROM news_items n LEFT JOIN feeds f ON f.id = n.feed_id
        WHERE n.collected_at > $1 AND n.title ~* $2 AND n.title ~* $3
        ORDER BY n.collected_at DESC LIMIT ${MAX_ROWS}`,
      [new Date(now - FUTURE_WINDOW_MS).toISOString(), SQL_PROTEST, SQL_FUTURE],
    );
    const parsed = rows.map((r) => ({ title: r.title, link: r.link, feed: r.feed, region: r.region, at: new Date(r.at).getTime() }))
      .filter((r) => Number.isFinite(r.at));
    return { ...(await groupAnnouncements(parsed, now, geocodeQuery)), scanned: rows.length };
  });
}
