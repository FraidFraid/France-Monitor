// api/_lib/fire-foyers.js : rattachement, récurrence et foyers des détections FIRMS (spec 2026-10-04 environnement § 2.4, E3).
// Fonctions pures. Récurrence : historique d'empreintes sur une grille d'environ 1 km ; une source de chaleur vue au même
// endroit au moins 5 des 10 derniers jours est « à vérifier, probablement industrielle » et ne compte jamais comme feu, sauf
// (amendement 1 du contrôleur, restreint aux feux nouveaux) un foyer d'au moins 100 MW cumulés ou contenant une détection de
// confiance haute, apparu depuis 7 jours au plus : un vrai feu qui dure ne passe pas pour une usine, et une usine vue depuis
// longtemps (aciérie de Dunkerque, 194 MW et confiance 100 le 04/10) reste « à vérifier ».
// Foyers : lien simple entre détections à moins de 1 km et moins de 12 h ; confirmé s'il est vu par au moins 2 passages
// (passage = satellite et heure d'acquisition : deux satellites à 50 min d'écart font deux passages, amendement 7).
import { haversineKm } from './geo-fr.js';

export const CELL_LAT_DEG = 0.009;
export const CELL_LON_DEG = 0.0131;
export const RECURRENCE_DAYS = 10;
export const RECURRENCE_MIN_DAYS = 5;
export const FOYER_LINK_KM = 1;
export const FOYER_LINK_HOURS = 12;
/** Foyer majeur (pastille rouge) et garde de la récurrence : FRP cumulée d'au moins 100 MW. */
export const MAJOR_FOYER_MW = 100;
/** Premiers jours de la fenêtre de 10 jours : sans empreinte ces jours-là, un foyer est apparu depuis 7 jours au plus (nouveau). */
export const OLD_FOOTPRINT_DAYS = 3;

const DAY_MS = 86_400_000;
const SATELLITE_ORDER = ['Suomi NPP', 'NOAA-20', 'NOAA-21', 'Terra', 'Aqua'];
const CONFIDENCE_RANK = { faible: 0, nominale: 1, haute: 2 };

/** « AAAA-MM-JJ » : jour UTC d'un instant (ms). */
export function utcDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Les `n` jours UTC qui finissent à `date` (compris), du plus ancien au plus récent. */
export function lastDays(date, n) {
  const end = Date.parse(`${date}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => utcDay(end - (n - 1 - i) * DAY_MS));
}

/** Case de la grille d'environ 1 km contenant le point : « ligne:colonne ». */
export function cellOf(lat, lon) {
  return `${Math.floor(lat / CELL_LAT_DEG)}:${Math.floor(lon / CELL_LON_DEG)}`;
}

/** La case et ses 8 voisines (voisinage 3 × 3). */
export function neighbourCells(cell) {
  const [row, col] = cell.split(':').map(Number);
  const out = [];
  for (let dr = -1; dr <= 1; dr += 1) for (let dc = -1; dc <= 1; dc += 1) out.push(`${row + dr}:${col + dc}`);
  return out;
}

/**
 * Cases récurrentes à la date `date` : une case l'est si son voisinage porte des empreintes au moins RECURRENCE_MIN_DAYS jours
 * parmi les RECURRENCE_DAYS derniers jours UTC (jour `date` compris).
 * @param {Record<string, { cells: string[] }>} days
 * @param {string} date
 * @returns {Set<string>}
 */
export function recurrentCells(days, date) {
  const counts = new Map();
  for (const day of lastDays(date, RECURRENCE_DAYS)) {
    const cells = Array.isArray(days?.[day]?.cells) ? days[day].cells : [];
    const reached = new Set();
    for (const cell of cells) for (const n of neighbourCells(cell)) reached.add(n);
    for (const c of reached) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const out = new Set();
  for (const [c, n] of counts) if (n >= RECURRENCE_MIN_DAYS) out.add(c);
  return out;
}

/**
 * Cases touchées (voisinage 3 × 3 compris) par une empreinte des OLD_FOOTPRINT_DAYS premiers jours de la fenêtre de
 * RECURRENCE_DAYS jours finissant à `date` : un foyer dont aucune case n'y figure est un feu nouveau.
 * @param {Record<string, { cells: string[] }>} days
 * @param {string} date
 * @returns {Set<string>}
 */
export function oldFootprintCells(days, date) {
  const out = new Set();
  for (const day of lastDays(date, RECURRENCE_DAYS).slice(0, OLD_FOOTPRINT_DAYS)) {
    const cells = Array.isArray(days?.[day]?.cells) ? days[day].cells : [];
    for (const cell of cells) for (const n of neighbourCells(cell)) out.add(n);
  }
  return out;
}

/** Vrai si le point tombe dans une case récurrente à la date `date`. */
export function isRecurrent(lat, lon, days, date) {
  return recurrentCells(days, date).has(cellOf(lat, lon));
}

/**
 * Sépare les détections de France (département par point dans polygone, `deptOf` injecté : `departementAt` de geo-fr.js)
 * de celles hors de France (comptées à part, sans département).
 * @template {{ lat: number, lon: number, acquiredAt: string, frpMw: number, satellite: string }} D
 * @param {D[]} detections
 * @param {(lat: number, lon: number) => string | null} deptOf
 * @returns {{ france: Array<D & { dept: string }>, abroad: Array<{ lat: number, lon: number, acquiredAt: string, frpMw: number, satellite: string }> }}
 */
export function splitByDepartement(detections, deptOf) {
  const france = [];
  const abroad = [];
  for (const d of detections) {
    const dept = deptOf(d.lat, d.lon);
    if (dept) france.push({ ...d, dept });
    else abroad.push({ lat: d.lat, lon: d.lon, acquiredAt: d.acquiredAt, frpMw: d.frpMw, satellite: d.satellite });
  }
  return { france, abroad };
}

/**
 * Ajoute les empreintes des détections de France aux jours couverts : chaque jour couvert reçoit au moins une entrée (vide si
 * aucune détection), ses cases sont l'union des cases déjà gardées et des nouvelles ; les comptes ne changent pas ici.
 * @param {Record<string, { cells: string[], france: number, recurrent: number }>} days
 * @param {Array<{ lat: number, lon: number, acquiredAt: string }>} detections
 * @param {string[]} coveredDays
 */
export function mergeDayCells(days, detections, coveredDays) {
  const next = { ...days };
  for (const day of coveredDays) next[day] = { cells: [...(next[day]?.cells ?? [])], france: next[day]?.france ?? 0, recurrent: next[day]?.recurrent ?? 0 };
  for (const d of detections) {
    const day = d.acquiredAt.slice(0, 10);
    const entry = { ...(next[day] ?? { cells: [], france: 0, recurrent: 0 }) };
    const cell = cellOf(d.lat, d.lon);
    if (!entry.cells.includes(cell)) entry.cells = [...entry.cells, cell];
    next[day] = entry;
  }
  return next;
}

/** Garde les `keep` derniers jours (jusqu'à `today` compris). */
export function pruneDays(days, today, keep) {
  const kept = new Set(lastDays(today, keep));
  return Object.fromEntries(Object.entries(days).filter(([day]) => kept.has(day)));
}

/** Écart sous lequel deux détections d'un même satellite sont un seul passage (une trace coupée en deux granules). */
const PASS_GAP_MS = 10 * 60_000;

/** Passages d'un foyer : par satellite, détections à moins de 10 min l'une de l'autre (de proche en proche) = un passage. */
function countPasses(members) {
  const bySatellite = new Map();
  for (const d of members) bySatellite.set(d.satellite, [...(bySatellite.get(d.satellite) ?? []), Date.parse(d.acquiredAt)]);
  let passes = 0;
  for (const times of bySatellite.values()) {
    times.sort((a, b) => a - b);
    passes += 1 + times.slice(1).filter((t, i) => t - times[i] >= PASS_GAP_MS).length;
  }
  return passes;
}

function rankOf(f) {
  if (f.recurrent) return 0;
  if (f.confirmed && f.frpTotalMw >= MAJOR_FOYER_MW) return 3;
  return f.confirmed ? 2 : 1;
}

function majority(values, weight) {
  const score = new Map();
  values.forEach((v, i) => {
    const s = score.get(v) ?? { n: 0, w: 0 };
    score.set(v, { n: s.n + 1, w: s.w + weight[i] });
  });
  return [...score.entries()].sort((a, b) => b[1].n - a[1].n || b[1].w - a[1].w || a[0].localeCompare(b[0], 'fr'))[0][0];
}

function round(v, digits) {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

/**
 * Foyers des détections de France (24 h) : lien simple à moins de FOYER_LINK_KM et moins de FOYER_LINK_HOURS ; confirmé à 2
 * passages ; département majoritaire (égalité : FRP cumulée, puis code) ; centroïde pondéré par la FRP ; récurrent si le
 * centroïde tombe dans une case récurrente à la date de `now`. Garde (amendement 1, restreint aux feux nouveaux) : un foyer
 * qui cumule au moins 100 MW sur 24 h ou contient une détection de confiance haute n'est jamais récurrent si son voisinage
 * (cases 3 × 3 de son centroïde et de ses détections) n'a aucune empreinte dans les 3 premiers jours de la fenêtre de 10 jours
 * (feu apparu depuis 7 jours au plus) ; sinon la règle de récurrence s'applique normalement. Une détection est récurrente si
 * son foyer l'est ou si sa propre case l'est (même garde).
 * Tri : foyer majeur, confirmé, isolé, récurrent ; puis FRP cumulée décroissante.
 * @param {Array<{ id: string, lat: number, lon: number, acquiredAt: string, satellite: string, sensor: string, confidence: string, confidenceRaw: string, frpMw: number, daynight: string, dept: string }>} detections
 * @param {Record<string, { cells: string[] }>} days
 * @param {number} now
 */
export function clusterFoyers(detections, days, now) {
  const list = [...detections].sort((a, b) => Date.parse(a.acquiredAt) - Date.parse(b.acquiredAt) || a.id.localeCompare(b.id));
  const parent = list.map((_, i) => i);
  const find = (i) => {
    let r = i;
    while (parent[r] !== r) r = parent[r];
    while (parent[i] !== r) { const next = parent[i]; parent[i] = r; i = next; }
    return r;
  };
  const times = list.map((d) => Date.parse(d.acquiredAt));
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      if (times[j] - times[i] >= FOYER_LINK_HOURS * 3_600_000) break;
      if (haversineKm(list[i].lat, list[i].lon, list[j].lat, list[j].lon) < FOYER_LINK_KM) {
        const a = find(i);
        const b = find(j);
        if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
      }
    }
  }
  const groups = new Map();
  list.forEach((d, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), d]);
  });
  const recurrent = recurrentCells(days, utcDay(now));
  const old = oldFootprintCells(days, utcDay(now));
  const foyers = [];
  const out = [];
  for (const members of groups.values()) {
    const first = members[0];
    const frpTotal = members.reduce((s, d) => s + d.frpMw, 0);
    const weights = members.map((d) => (frpTotal > 0 ? d.frpMw : 1));
    const wSum = weights.reduce((s, w) => s + w, 0);
    const lat = members.reduce((s, d, i) => s + d.lat * weights[i], 0) / wSum;
    const lon = members.reduce((s, d, i) => s + d.lon * weights[i], 0) / wSum;
    const passes = countPasses(members);
    const confidenceMax = members.reduce((best, d) => (CONFIDENCE_RANK[d.confidence] > CONFIDENCE_RANK[best] ? d.confidence : best), 'faible');
    const isNew = ![cellOf(lat, lon), ...members.map((d) => cellOf(d.lat, d.lon))].some((c) => old.has(c));
    const guarded = (frpTotal >= MAJOR_FOYER_MW || confidenceMax === 'haute') && isNew;
    const foyerRecurrent = !guarded && recurrent.has(cellOf(lat, lon));
    const foyer = {
      id: first.id,
      dept: majority(members.map((d) => d.dept), members.map((d) => d.frpMw)),
      depts: [...new Set(members.map((d) => d.dept))].sort((a, b) => a.localeCompare(b, 'fr')),
      lat: round(lat, 5),
      lon: round(lon, 5),
      detections: members.length,
      passes,
      confirmed: passes >= 2,
      recurrent: foyerRecurrent,
      frpTotalMw: round(frpTotal, 2),
      frpMaxMw: round(Math.max(...members.map((d) => d.frpMw)), 2),
      firstAt: first.acquiredAt,
      lastAt: members[members.length - 1].acquiredAt,
      satellites: SATELLITE_ORDER.filter((s) => members.some((d) => d.satellite === s)),
      confidenceMax,
      nightDetections: members.filter((d) => d.daynight === 'N').length,
    };
    foyers.push(foyer);
    for (const d of members) {
      out.push({ ...d, recurrent: !guarded && (foyerRecurrent || recurrent.has(cellOf(d.lat, d.lon))), foyerId: foyer.id });
    }
  }
  foyers.sort((a, b) => rankOf(b) - rankOf(a) || b.frpTotalMw - a.frpTotalMw || a.id.localeCompare(b.id));
  out.sort((a, b) => Date.parse(b.acquiredAt) - Date.parse(a.acquiredAt) || a.id.localeCompare(b.id));
  return { detections: out, foyers };
}
