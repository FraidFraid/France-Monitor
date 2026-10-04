// api/_lib/gnss-grid.js : grille GNSS mesurée sur la précision déclarée des aéronefs (spec 2026-10-04 souveraineté § 3.1 ;
// contrats § 2.5, arbitrages 28, 32 à 34 ; amendement 7, O15 à O17). Pur, sans réseau : cumul sur une fenêtre (24 h glissantes, ou un
// jour UTC), mailles de 0,5° × 0,5°, un aéronef distinct (hex) compté une fois par maille avec sa pire classe ; « bon » si nac_p vaut 8
// ou plus, « dégradé » de 1 à 7 ; nac_p absent ou illisible compté à part, jamais au calcul. O16 : un nac_p 0 déclaré par un appareil
// qui a déclaré une bonne précision plus tôt dans la même fenêtre compte « dégradé » là où il déclare 0 (un brouillage fort fait perdre
// la position : la mesure le sous-estime) ; un nac_p 0 sans bonne précision antérieure reste compté à part. Part dégradée
// = 100 × (dégradés − 1) / (bons + dégradés), formule de gpsjam.org, bornée à 0 ; au moins 5 aéronefs au calcul, sinon « trop peu
// d'avions ». Mesure d'une précision de position dégradée, jamais d'un brouillage : seules la DGAC et l'ANFR qualifient un brouillage
// (O15). Seuils propres au serveur : le client lit `level`, `generalDegradation` et les comptes.
import { inFranceV2 } from './territory.js';

export const GNSS_CELL_DEG = 0.5;
export const GNSS_MIN_AIRCRAFT = 5;
export const GNSS_GOOD_NACP = 8;
export const GNSS_YELLOW_PCT = 2;
export const GNSS_ORANGE_PCT = 10;
export const GENERAL_DEGRADATION_SHARE = 0.3;
/** Kp « 5 ou plus » = 5− (4,67) et au-delà (arbitrage 28). */
export const GENERAL_DEGRADATION_KP = 14 / 3;
export const GNSS_WINDOW_MS = 24 * 3_600_000;
/** Position plus vieille que 2 min à la lecture : écartée (même garde que les vols militaires). */
export const MAX_POSITION_AGE_S = 120;
const KP_SLOT_MS = 3 * 3_600_000;
const DAY_MS = 86_400_000;
/** Ordre des classes gardées par maille et par aéronef : la pire l'emporte. */
const CLASSES = ['good', 'degraded', 'unknown'];

/** Coin sud-ouest d'une maille : « 48.5:-1.5 ». */
export function cellKey(lat, lon) {
  const corner = (v) => Math.floor(v / GNSS_CELL_DEG) * GNSS_CELL_DEG;
  return `${corner(lat)}:${corner(lon)}`;
}

/**
 * Classe d'une précision déclarée prise seule : bon (8 et plus), dégradé (1 à 7), inconnu (0, absent, illisible). Le 0 qui suit une
 * bonne précision du même appareil (O16) se décide dans la fenêtre, qui connaît l'historique de l'appareil.
 */
export function nacClass(nacP) {
  if (typeof nacP !== 'number' || !Number.isFinite(nacP) || nacP <= 0) return 'unknown';
  return nacP >= GNSS_GOOD_NACP ? 'good' : 'degraded';
}

/** Part dégradée exacte (gpsjam.org, bornée à 0) ; null sous 5 aéronefs au calcul. */
export function cellPct(good, degraded) {
  const total = good + degraded;
  if (total < GNSS_MIN_AIRCRAFT) return null;
  return Math.max(0, (100 * (degraded - 1)) / total);
}

/** Niveau d'une maille : jaune de 2 à 10 %, orange au-delà de 10 %, vert en dessous de 2 % ; « peu » sans part. */
export function cellLevel(pct) {
  if (pct === null) return 'peu';
  if (pct > GNSS_ORANGE_PCT) return 'orange';
  return pct >= GNSS_YELLOW_PCT ? 'jaune' : 'vert';
}

/** « 2026-10-04 » : jour UTC d'un instant (ms). */
export function utcDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Début (ms) d'un jour UTC « AAAA-MM-JJ ». */
export function utcDayStart(day) {
  return Date.parse(`${day}T00:00:00Z`);
}

/** Jour UTC qui précède `day` de `n` jours. */
export function utcDayBefore(day, n = 1) {
  return utcDay(utcDayStart(day) - n * DAY_MS);
}

/** Position utilisable d'un aéronef (en vol, lisible, de moins de 120 s), ou null. */
function positionOf(ac) {
  if (!ac || typeof ac !== 'object') return null;
  const hex = typeof ac.hex === 'string' ? ac.hex.trim().toLowerCase() : '';
  if (!hex || typeof ac.lat !== 'number' || typeof ac.lon !== 'number' || !Number.isFinite(ac.lat) || !Number.isFinite(ac.lon)) return null;
  if (ac.alt_baro === 'ground') return null;
  if (typeof ac.seen_pos === 'number' && ac.seen_pos > MAX_POSITION_AGE_S) return null;
  return { hex, lat: ac.lat, lon: ac.lon };
}

/**
 * Cumul de lectures en mémoire du processus (arbitrage 17) : au redémarrage, il recommence. Sert à la fois aux 24 h glissantes
 * (avec `prune`) et à un jour UTC (sans `prune`). Une observation (maille, aéronef, classe) garde sa date la plus récente.
 * `add(acList, atMs)` : une lecture /v2/point, dans l'ordre des dates ; `prune(nowMs)` : retire ce qui a plus de 24 h ; `cells()` :
 * mailles survolées ; `largestGapMs(from, to)` : plus long intervalle sans lecture entre deux bornes (couverture d'un jour).
 */
export function createGnssWindow() {
  /** @type {Map<string, Map<string, { good: number | null, degraded: number | null, unknown: number | null }>>} */
  const byCell = new Map();
  /** Dernière bonne précision déclarée par appareil (O16), toutes mailles confondues. @type {Map<string, number>} */
  const lastGood = new Map();
  /** @type {number[]} */
  let readTimes = [];
  /** @type {number | null} */
  let startedAt = null;
  /** @type {Map<string, boolean>} */
  const franceMemo = new Map();
  const inFrance = (key) => {
    if (!franceMemo.has(key)) {
      const [lat, lon] = key.split(':').map(Number);
      franceMemo.set(key, inFranceV2(lat + GNSS_CELL_DEG / 2, lon + GNSS_CELL_DEG / 2));
    }
    return franceMemo.get(key) === true;
  };
  /** Classe d'une observation à `atMs` : nac_p 0 après une bonne précision de moins de 24 h du même appareil, dégradé (O16). */
  const classify = (hex, nacP, atMs) => {
    const cls = nacClass(nacP);
    if (cls !== 'unknown' || nacP !== 0) return cls;
    const good = lastGood.get(hex);
    return good !== undefined && good < atMs && atMs - good < GNSS_WINDOW_MS ? 'degraded' : 'unknown';
  };
  return {
    add(acList, atMs) {
      if (!Number.isFinite(atMs)) return;
      if (startedAt === null) startedAt = atMs;
      readTimes.push(atMs);
      const goodNow = [];
      for (const ac of Array.isArray(acList) ? acList : []) {
        const p = positionOf(ac);
        if (!p) continue;
        const cls = classify(p.hex, ac.nac_p, atMs);
        if (cls === 'good') goodNow.push(p.hex);
        const key = cellKey(p.lat, p.lon);
        let cell = byCell.get(key);
        if (!cell) {
          cell = new Map();
          byCell.set(key, cell);
        }
        const seen = cell.get(p.hex) ?? { good: null, degraded: null, unknown: null };
        seen[cls] = Math.max(seen[cls] ?? Number.NEGATIVE_INFINITY, atMs);
        cell.set(p.hex, seen);
      }
      // Bonnes précisions retenues après la lecture : un 0 de la même lecture ne s'appuie jamais sur elle.
      for (const hex of goodNow) lastGood.set(hex, Math.max(lastGood.get(hex) ?? Number.NEGATIVE_INFINITY, atMs));
    },
    prune(nowMs) {
      const from = nowMs - GNSS_WINDOW_MS;
      readTimes = readTimes.filter((t) => t > from);
      if (readTimes.length === 0) startedAt = null;
      for (const [hex, t] of lastGood) if (t <= from) lastGood.delete(hex);
      for (const [key, cell] of byCell) {
        for (const [hex, seen] of cell) {
          for (const cls of CLASSES) if (seen[cls] !== null && seen[cls] <= from) seen[cls] = null;
          if (seen.good === null && seen.degraded === null && seen.unknown === null) cell.delete(hex);
        }
        if (cell.size === 0) byCell.delete(key);
      }
    },
    cells() {
      const out = [];
      for (const [key, cell] of byCell) {
        let good = 0;
        let degraded = 0;
        let unknown = 0;
        for (const seen of cell.values()) {
          if (seen.degraded !== null) degraded += 1;
          else if (seen.good !== null) good += 1;
          else unknown += 1;
        }
        const [lat, lon] = key.split(':').map(Number);
        const exact = cellPct(good, degraded);
        out.push({
          lat, lon, good, degraded, unknown, pct: exact === null ? null : Math.round(exact * 10) / 10, level: cellLevel(exact), inFrance: inFrance(key),
        });
      }
      return out.sort((a, b) => b.lat - a.lat || a.lon - b.lon);
    },
    largestGapMs(fromMs, toMs) {
      let previous = fromMs;
      let largest = 0;
      for (const t of [...readTimes].sort((a, b) => a - b)) {
        if (t < fromMs || t > toMs) continue;
        largest = Math.max(largest, t - previous);
        previous = t;
      }
      return Math.max(largest, toMs - previous);
    },
    get startedAt() { return startedAt; },
    get reads() { return readTimes.length; },
    get aircraft() {
      const hexes = new Set();
      for (const cell of byCell.values()) for (const hex of cell.keys()) hexes.add(hex);
      return hexes.size;
    },
  };
}

/** Mailles françaises d'au moins 5 aéronefs au calcul (dénominateur de la dégradation générale et du compte « sur N »). */
export function frenchMeasuredCells(cells) {
  return cells.filter((c) => c.inFrance && c.level !== 'peu');
}

/** Plus de 30 % des mailles françaises mesurées en jaune ou orange ET Kp ≥ 5− dans la fenêtre ; Kp inconnu : non. */
export function generalDegradation(cells, kp) {
  const measured = frenchMeasuredCells(cells);
  if (measured.length === 0 || typeof kp !== 'number' || !Number.isFinite(kp)) return false;
  const degraded = measured.filter((c) => c.level === 'jaune' || c.level === 'orange').length;
  return degraded / measured.length > GENERAL_DEGRADATION_SHARE && kp >= GENERAL_DEGRADATION_KP;
}

/**
 * Mailles françaises orange (plus de 10 % des aéronefs) hors dégradation générale : celles que comptent la pastille Défense et le
 * score (O17 : seul leur nombre sort en direct). Coin sud-ouest et part arrondie.
 */
export function degradedCells(cells, general) {
  if (general) return [];
  return cells.filter((c) => c.inFrance && c.level === 'orange').map((c) => ({ lat: c.lat, lon: c.lon, pct: c.pct ?? 0 }));
}

/**
 * Comptes sans lieu d'une fenêtre : mailles françaises mesurées, jaunes, orange, dégradation générale avec le Kp donné, et mailles
 * comptées (orange hors dégradation générale).
 */
export function gnssSummary(cells, kp) {
  const measured = frenchMeasuredCells(cells);
  const general = generalDegradation(cells, kp);
  return {
    measured: measured.length,
    jaune: measured.filter((c) => c.level === 'jaune').length,
    orange: measured.filter((c) => c.level === 'orange').length,
    general,
    degraded: degradedCells(cells, general).length,
  };
}

/** Kp le plus haut des tranches de 3 h qui recouvrent [fromMs, toMs[ ; null sans tranche. */
export function maxKpInWindow(points, fromMs, toMs) {
  let best = null;
  for (const p of Array.isArray(points) ? points : []) {
    const at = Date.parse(p?.at);
    if (!Number.isFinite(at) || typeof p.kp !== 'number' || !Number.isFinite(p.kp)) continue;
    if (at < toMs && at + KP_SLOT_MS > fromMs && (best === null || p.kp > best)) best = p.kp;
  }
  return best;
}
