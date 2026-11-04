// src/services/upcoming-core.js : échéances annoncées par les sources, partie pure partagée client et serveur (04/11/2026, issue de
// src/services/upcoming.ts du 26/10/2026). France Monitor ne prévoit rien : il reprend ce que les émetteurs publient eux-mêmes pour
// les jours à venir, attribué et daté. Les deux dépendances propres au client (libellé des phénomènes de vigilance, lecture des
// prévisions Vigicrues) sont passées en argument (`deps`) : le serveur importe ce fichier depuis src/ (code partagé, jamais l'inverse).
import { parisDay } from './paris-day.js';

export { parisDay };

const DAY_MS = 24 * 3_600_000;
export const PROTESTS_HORIZON_DAYS = 7;

/**
 * @typedef {import('../types/index.ts').EcowattResponse} EcowattResponse
 * @typedef {import('../types/index.ts').VigilanceResponse} VigilanceResponse
 * @typedef {import('../types/index.ts').FloodsResponse} FloodsResponse
 * @typedef {import('../types/index.ts').FloodStation} FloodStation
 * @typedef {import('../types/index.ts').ProtestItem} ProtestItem
 * @typedef {'vert'|'jaune'|'orange'|'rouge'} VigilanceLevel
 * @typedef {object} UpcomingItem
 * @property {string} day Jour concerné, heure de Paris, « AAAA-MM-JJ ».
 * @property {VigilanceLevel|null} level Niveau publié par la source ; null : annonce sans niveau.
 * @property {string} title
 * @property {string|null} detail
 * @property {string} source
 * @typedef {object} UpcomingDeps
 * @property {Record<string, string>} phenomenonWord Libellé par identifiant de phénomène de vigilance.
 * @property {(station: FloodStation, now: number) => ({ trend: string, key: { at: string, mean: number, min: number, max: number } }|null)} readForecast
 */

function dayMonth(/** @type {string} */ day) {
  const [, m, d] = day.split('-');
  return `${d}/${m}`;
}

function names(/** @type {readonly string[]} */ list, max = 4) {
  if (list.length <= max) return list.join(', ');
  const rest = list.length - max;
  return `${list.slice(0, max).join(', ')} et ${rest} autre${rest > 1 ? 's' : ''}`;
}

/** @returns {UpcomingItem[]} */
function ecowattItems(/** @type {EcowattResponse|null} */ ecowatt, /** @type {string} */ today) {
  const official = ecowatt?.official;
  // Repli ODRÉ : jours passés seulement, jamais une annonce.
  if (!official || official.source !== 'rte') return [];
  const future = official.days.filter((d) => d.date > today);
  if (future.length === 0) return [];
  const alerts = future.filter((d) => d.level !== 'green');
  if (alerts.length === 0) {
    const last = future[future.length - 1].date;
    return [{ day: future[0].date, level: null, title: `Écowatt : aucune alerte annoncée jusqu'au ${dayMonth(last)}`, detail: null, source: 'RTE' }];
  }
  return alerts.map((d) => ({
    day: d.date,
    level: d.level === 'red' ? 'rouge' : 'orange',
    title: d.level === 'red' ? 'Écowatt rouge : coupures possibles si la consommation ne baisse pas' : 'Écowatt orange : système électrique tendu',
    detail: d.message || null,
    source: 'RTE',
  }));
}

/** @type {Readonly<Record<number, VigilanceLevel>>} */
const COLOR_LEVEL = { 1: 'vert', 2: 'jaune', 3: 'orange', 4: 'rouge' };

/** @returns {UpcomingItem[]} */
function vigilanceItems(/** @type {VigilanceResponse|null} */ vigilance, /** @type {Record<string, string>} */ phenomenonWord) {
  const period = vigilance?.periods.find((p) => p.echeance === 'J1');
  if (!period) return [];
  const day = parisDay(Date.parse(period.begin) + 12 * 3_600_000);
  const strong = period.departments.filter((d) => d.color >= 3);
  const yellow = period.departments.filter((d) => d.color === 2);
  /** @type {UpcomingItem[]} */
  const items = [];
  for (const color of [4, 3]) {
    const depts = strong.filter((d) => d.color === color);
    if (depts.length === 0) continue;
    const phenomena = [...new Set(depts.flatMap((d) => d.phenomena.filter((p) => p.color === color).map((p) => phenomenonWord[p.id])))];
    items.push({
      day,
      level: COLOR_LEVEL[color],
      title: `Vigilance ${COLOR_LEVEL[color]} ${phenomena.join(', ')} dans ${depts.length} département${depts.length > 1 ? 's' : ''}`,
      detail: names(depts.map((d) => `${d.name} (${d.code})`)),
      source: 'Météo-France',
    });
  }
  if (yellow.length > 0) {
    items.push({ day, level: 'jaune', title: `Vigilance jaune dans ${yellow.length} département${yellow.length > 1 ? 's' : ''}`, detail: null, source: 'Météo-France' });
  }
  if (items.length === 0) {
    items.push({ day, level: null, title: 'Météo-France : aucune vigilance jaune ou plus annoncée', detail: null, source: 'Météo-France' });
  }
  return items;
}

/** @type {Readonly<Record<number, VigilanceLevel>>} */
const FLOOD_LEVEL = { 2: 'jaune', 3: 'orange', 4: 'rouge' };
const metres = (/** @type {number} */ v) => `${v.toFixed(2).replace('.', ',')}\u00a0m`;

/**
 * Une échéance par tronçon en vigilance dont Vigicrues prévoit une hausse : la station au plus haut pic prévu.
 * @returns {UpcomingItem[]}
 */
function floodItems(/** @type {FloodsResponse|null|undefined} */ floods, /** @type {number} */ now, /** @type {UpcomingDeps['readForecast']} */ readForecast) {
  if (!floods) return [];
  /** @type {UpcomingItem[]} */
  const items = [];
  for (const section of floods.sections) {
    const rising = section.stations
      .map((st) => ({ st, r: readForecast(st, now) }))
      .filter((x) => x.r !== null && x.r.trend === 'hausse')
      .sort((a, b) => b.r.key.mean - a.r.key.mean);
    const top = rising[0];
    if (!top) continue;
    const k = top.r.key;
    const range = k.min !== k.max ? `fourchette ${metres(k.min).replace('\u00a0m', '')} à ${metres(k.max)}` : null;
    items.push({
      day: parisDay(Date.parse(k.at)),
      level: FLOOD_LEVEL[section.level] ?? null,
      title: `Hausse annoncée : ${section.name} à ${top.st.name}, jusqu'à ${metres(k.mean)}`,
      detail: [range, rising.length > 1 ? `${rising.length} stations en hausse sur le tronçon` : null].filter(Boolean).join(' ; ') || null,
      source: 'Vigicrues',
    });
  }
  return items;
}

/** @type {Readonly<Record<string, string>>} */
const PROTEST_SOURCE_LABEL = { demosphere: 'Démosphère', giletsjaunes: 'carte des gilets jaunes', cgt: 'cartes de la CGT', prefecture: 'préfectures' };

/** @returns {UpcomingItem[]} */
function protestItems(/** @type {readonly ProtestItem[]|null} */ protests, /** @type {number} */ now, /** @type {string} */ today) {
  if (!protests) return [];
  const horizon = parisDay(now + PROTESTS_HORIZON_DAYS * DAY_MS);
  /** @type {Map<string, ProtestItem[]>} */
  const byDay = new Map();
  for (const p of protests) {
    if (p.status !== 'annonce' || !p.startsAt) continue;
    const day = parisDay(Date.parse(p.startsAt));
    if (day <= today || day > horizon) continue;
    byDay.set(day, [...(byDay.get(day) ?? []), p]);
  }
  return [...byDay.entries()].map(([day, list]) => {
    const cities = [...new Map(list.filter((p) => p.city).map((p) => [/** @type {string} */ (p.city), true])).keys()];
    const sources = [...new Set(list.map((p) => PROTEST_SOURCE_LABEL[p.source] ?? p.source))];
    return {
      day,
      level: null,
      title: `${list.length} rassemblement${list.length > 1 ? 's' : ''} annoncé${list.length > 1 ? 's' : ''}`,
      detail: cities.length > 0 ? `dont ${names(cities)} ; annonces publiques, non confirmées` : 'annonces publiques, non confirmées',
      source: sources.join(', '),
    };
  });
}

/**
 * Échéances des jours à venir, par jour puis par gravité publiée.
 * @param {{ ecowatt: EcowattResponse|null, vigilance: VigilanceResponse|null, protests: readonly ProtestItem[]|null, floods?: FloodsResponse|null, now: number }} input
 * @param {UpcomingDeps} deps
 * @returns {UpcomingItem[]}
 */
export function upcomingFromSources(input, deps) {
  const today = parisDay(input.now);
  const rank = (/** @type {VigilanceLevel|null} */ l) => (l === 'rouge' ? 0 : l === 'orange' ? 1 : l === 'jaune' ? 2 : 3);
  return [...ecowattItems(input.ecowatt, today), ...vigilanceItems(input.vigilance, deps.phenomenonWord), ...floodItems(input.floods, input.now, deps.readForecast), ...protestItems(input.protests, input.now, today)]
    .sort((a, b) => a.day.localeCompare(b.day) || rank(a.level) - rank(b.level));
}
