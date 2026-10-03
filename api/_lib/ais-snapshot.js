// api/_lib/ais-snapshot.js : instantané maritime du relais AIS (spec 2026-10-03 panneaux trafic § 2.5, T3).
// Fonctions pures et suivi en mémoire, utilisés par ais-relay.js (VM) : navires vus depuis 10 min dans les eaux
// françaises (métropole et Corse ; Royaume-Uni, îles anglo-normandes, Espagne, Monaco, Italie et Seine en amont
// de Rouen exclus ; tracé simplifié à une dizaine de kilomètres près), mémoire MMSI des données statiques
// (type, nom, dimensions, destination ; gardée 7 jours), comptes par zone, par port, par type et par statut,
// signalements croisés et navires sensibles près des côtes.
import { distanceToMetropoleKm, haversineKm, inPolygon } from './geo-fr.js';

export const SEEN_WINDOW_MS = 10 * 60_000;
export const STATIC_KEEP_MS = 7 * 86_400_000;
/** T3 : statut constant au moins 30 min, au moins deux positions, vitesse sous 0,5 nœud, hors zone portuaire. */
export const SIGNAL_MIN_DURATION_MS = 30 * 60_000;
export const SIGNAL_MIN_POSITIONS = 2;
export const SIGNAL_MAX_SOG = 0.5;
export const HARBOUR_RADIUS_KM = 8;
/** Navires sensibles : pétroliers et navires à passagers à moins de 12 milles nautiques des côtes. */
export const SENSITIVE_NM = 12;
const NM_KM = 1.852;
const PORT_PRESENT_KM = 25;
const PORT_ANCHOR_KM = 40;
const UNDER_WAY_KNOTS = 0.5;

/** Eaux françaises (lon, lat) : Manche, mer du Nord et Atlantique ; Méditerranée et Corse. */
export const FRENCH_WATERS = {
  atlanticChannel: [[
    [2.55, 51.09], [2.55, 51.32], [2.10, 51.26], [1.58, 51.03], [1.20, 50.80], [0.40, 50.40], [-0.60, 50.15], [-1.80, 50.05],
    [-3.00, 49.85], [-4.20, 49.55], [-5.30, 49.20], [-6.20, 48.95], [-10.50, 48.90], [-10.50, 44.00], [-4.00, 44.00], [-2.60, 43.75],
    [-1.95, 43.50], [-1.79, 43.36], [0.00, 43.00], [1.50, 46.00], [1.60, 49.00], [2.00, 50.00], [2.55, 51.09],
  ]],
  mediterranean: [[
    [3.05, 42.43], [3.60, 42.43], [4.60, 41.80], [6.50, 41.40], [8.40, 41.10], [9.20, 41.30], [9.62, 41.35], [9.70, 42.40],
    [9.66, 43.10], [7.55, 43.76], [7.53, 44.20], [3.00, 44.20], [2.90, 43.30], [3.05, 42.43],
  ]],
};
/** Exclusions dans ces polygones : îles anglo-normandes, Monaco, Seine en amont de Rouen. */
export const EXCLUDED_WATERS = {
  channelIslands: [[[-2.80, 48.85], [-1.95, 48.85], [-1.95, 49.80], [-2.80, 49.80], [-2.80, 48.85]]],
  monaco: [[[7.40, 43.71], [7.46, 43.71], [7.46, 43.76], [7.40, 43.76], [7.40, 43.71]]],
  seineUpstream: [[[1.10, 49.47], [3.00, 49.47], [3.00, 48.30], [0.98, 48.30], [0.98, 49.30], [1.06, 49.37], [1.10, 49.47]]],
};

/** Vrai si le point est dans les eaux françaises suivies. */
export function inFrenchWaters(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (Object.values(EXCLUDED_WATERS).some((p) => inPolygon(lon, lat, p))) return false;
  return inPolygon(lon, lat, FRENCH_WATERS.atlanticChannel) || inPolygon(lon, lat, FRENCH_WATERS.mediterranean);
}

export const ZONE_LABELS = { 'pas-de-calais': 'Pas-de-Calais', manche: 'Manche', atlantique: 'Atlantique', mediterranee: 'Méditerranée' };

/** Zone d'un point des eaux françaises. */
export function zoneOf(lat, lon) {
  if (inPolygon(lon, lat, FRENCH_WATERS.mediterranean)) return 'mediterranee';
  if (lat >= 50.4 && lon >= 0.7) return 'pas-de-calais';
  if (lat >= 48.2) return 'manche';
  return 'atlantique';
}

/** Ports suivis (§ 2.5) ; Marseille-Fos : point entre les deux bassins. */
export const PORTS = [
  { port: 'Le Havre', lat: 49.48, lon: 0.11 }, { port: 'Rouen', lat: 49.45, lon: 1.06 }, { port: 'Dunkerque', lat: 51.05, lon: 2.36 },
  { port: 'Calais', lat: 50.97, lon: 1.85 }, { port: 'Brest', lat: 48.38, lon: -4.49 }, { port: 'Saint-Nazaire', lat: 47.27, lon: -2.20 },
  { port: 'Bordeaux', lat: 44.87, lon: -0.55 }, { port: 'Marseille-Fos', lat: 43.36, lon: 5.12 }, { port: 'Toulon', lat: 43.10, lon: 5.92 },
];

/** Zones portuaires (rayon de 8 km) où un statut « échoué » ou « non maître de sa manœuvre » n'est jamais retenu. */
export const HARBOURS = [
  [49.48, 0.11], [49.45, 1.06], [51.05, 2.36], [50.97, 1.85], [48.38, -4.49], [47.27, -2.20], [44.87, -0.55], [43.30, 5.35], [43.42, 4.88],
  [43.10, 5.92], [49.65, -1.62], [48.64, -2.02], [48.72, -3.97], [47.73, -3.37], [47.87, -3.92], [46.15, -1.22], [46.49, -1.79], [43.53, -1.51],
  [50.73, 1.60], [49.93, 1.08], [49.28, -0.25], [48.83, -1.60], [43.40, 3.70], [43.02, 3.06], [42.52, 3.11], [43.69, 7.29], [43.55, 7.01],
  [42.70, 9.45], [41.92, 8.74], [42.57, 8.76], [41.59, 9.28], [41.39, 9.16],
];

export function inHarbour(lat, lon) {
  return HARBOURS.some(([hlat, hlon]) => haversineKm(lat, lon, hlat, hlon) <= HARBOUR_RADIUS_KM);
}

/** Codes pays (MID) français : métropole et outre-mer. */
const FRENCH_MIDS = new Set(['226', '227', '228', '329', '347', '361', '501', '540', '546', '578', '607', '618', '635', '660']);
export function isFrenchFlag(mmsi) {
  return FRENCH_MIDS.has(String(mmsi).slice(0, 3));
}

/** Libellé d'un type AIS (code 0 à 99) ; null si inconnu. */
export function typeLabel(code) {
  const c = Number(code);
  if (!Number.isInteger(c) || c <= 0) return null;
  if (c >= 80 && c <= 89) return 'Pétrolier';
  if (c >= 60 && c <= 69) return 'Passagers';
  if (c >= 70 && c <= 79) return 'Cargo';
  if (c === 30) return 'Pêche';
  if (c === 31 || c === 32 || c === 52) return 'Remorqueur';
  if (c === 35) return 'Militaire';
  if (c === 36) return 'Voilier';
  if (c === 37) return 'Plaisance';
  if (c >= 40 && c <= 49) return 'Grande vitesse';
  if (c >= 50 && c <= 59) return 'Pilote, sauvetage, service';
  return 'Autre';
}

/** Catégories de comptes par type (MaritimeSnapshot.byType), dans l'ordre d'affichage. */
export const TYPE_CATEGORIES = ['cargo', 'petrolier', 'passagers', 'peche', 'remorqueur', 'plaisance', 'grande-vitesse', 'service', 'militaire', 'autre', 'inconnu'];

/** Comptes par type, tous à 0. */
export function emptyByType() {
  return Object.fromEntries(TYPE_CATEGORIES.map((k) => [k, 0]));
}

/** Catégorie d'un code de type AIS ; « inconnu » sans type statique connu (null ou 0), « autre » pour tout autre code. */
export function typeCategory(code) {
  const c = Number(code);
  if (code === null || code === undefined || !Number.isInteger(c) || c <= 0) return 'inconnu';
  if (c >= 80 && c <= 89) return 'petrolier';
  if (c >= 70 && c <= 79) return 'cargo';
  if (c >= 60 && c <= 69) return 'passagers';
  if (c >= 40 && c <= 49) return 'grande-vitesse';
  if (c === 30) return 'peche';
  if (c === 31 || c === 32 || c === 52) return 'remorqueur';
  if (c === 36 || c === 37) return 'plaisance';
  if (c === 35) return 'militaire';
  if ([33, 34, 50, 51, 53, 54, 55, 58].includes(c)) return 'service';
  return 'autre';
}

function sensitiveKind(code) {
  const c = Number(code);
  if (c >= 80 && c <= 89) return 'petrolier';
  if (c >= 60 && c <= 69) return 'passagers';
  return null;
}

export const STATUS_LABELS = { 2: 'Non maître de sa manœuvre', 6: 'Échoué' };
const SIGNAL_STATUSES = new Set([2, 6]);

/** « 2026-10-03 13:12:10.10811891 +0000 UTC » → instant (ms) ; NaN si illisible. */
export function aisTime(text) {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(\.\d+)? \+0000 UTC$/.exec(String(text ?? '').trim());
  if (!m) return Number.NaN;
  return Date.parse(`${m[1]}T${m[2]}${m[3] ? m[3].slice(0, 4) : ''}Z`);
}

/**
 * Message aisstream (texte JSON) → position ou données statiques ; null pour les autres messages.
 * @returns {null | { kind: 'position', mmsi: string, at: number, lat: number, lon: number, sog: number | null, status: number | null, classA: boolean, name: string | null }
 *   | { kind: 'static', mmsi: string, at: number, type: number | null, name: string | null, destination: string | null, length: number | null, draught: number | null }}
 */
export function parseAisMessage(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  const meta = msg?.MetaData;
  const mmsi = meta?.MMSI != null ? String(meta.MMSI) : null;
  const at = aisTime(meta?.time_utc);
  if (!mmsi || !Number.isFinite(at)) return null;
  const name = String(meta.ShipName ?? '').trim() || null;
  if (msg.MessageType === 'PositionReport' || msg.MessageType === 'StandardClassBPositionReport') {
    const body = msg.Message?.[msg.MessageType] ?? {};
    const lat = Number(body.Latitude ?? meta.latitude);
    const lon = Number(body.Longitude ?? meta.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    const classA = msg.MessageType === 'PositionReport';
    return {
      kind: 'position', mmsi, at, lat, lon,
      sog: Number.isFinite(Number(body.Sog)) ? Number(body.Sog) : null,
      status: classA && Number.isInteger(body.NavigationalStatus) ? body.NavigationalStatus : null,
      classA, name,
    };
  }
  if (msg.MessageType === 'ShipStaticData') {
    const body = msg.Message?.ShipStaticData ?? {};
    const d = body.Dimension ?? {};
    const length = Number(d.A) + Number(d.B);
    return {
      kind: 'static', mmsi, at,
      type: Number.isInteger(body.Type) ? body.Type : null,
      name: String(body.Name ?? '').trim() || name,
      destination: String(body.Destination ?? '').trim() || null,
      length: Number.isFinite(length) && length > 0 ? length : null,
      draught: Number.isFinite(Number(body.MaximumStaticDraught)) ? Number(body.MaximumStaticDraught) : null,
    };
  }
  return null;
}

/**
 * Suivi en mémoire des messages AIS reçus par le relais.
 * `ingest(raw)` à chaque message ; `snapshot(now)` pour GET /snapshot ; `exportStatics(now)` et
 * `importStatics(list, now)` pour garder la mémoire MMSI au-delà d'un redémarrage.
 */
export function createAisTracker() {
  const vessels = new Map();
  const statics = new Map();
  let lastMessageAt = null;

  function ingest(raw) {
    const m = parseAisMessage(raw);
    if (!m) return;
    if (lastMessageAt === null || m.at > lastMessageAt) lastMessageAt = m.at;
    if (m.kind === 'static') {
      statics.set(m.mmsi, { type: m.type, name: m.name, destination: m.destination, length: m.length, draught: m.draught, at: m.at });
      return;
    }
    const v = vessels.get(m.mmsi) ?? { mmsi: m.mmsi, run: null };
    v.lat = m.lat; v.lon = m.lon; v.sog = m.sog; v.classA = m.classA; v.lastAt = m.at; v.name = m.name ?? v.name ?? null;
    if (m.classA) v.status = m.status;
    if (m.classA && SIGNAL_STATUSES.has(m.status)) {
      if (v.run && v.run.status === m.status) {
        v.run.positions += 1;
        v.run.lastAt = m.at;
        v.run.maxSog = Math.max(v.run.maxSog, m.sog ?? Infinity);
      } else {
        v.run = { status: m.status, since: m.at, lastAt: m.at, positions: 1, maxSog: m.sog ?? Infinity };
      }
    } else if (m.classA) {
      v.run = null;
    }
    vessels.set(m.mmsi, v);
  }

  function snapshot(now) {
    for (const [mmsi, v] of vessels) if (now - v.lastAt > 2 * SEEN_WINDOW_MS) vessels.delete(mmsi);
    for (const [mmsi, s] of statics) if (now - s.at > STATIC_KEEP_MS) statics.delete(mmsi);
    const seen = [...vessels.values()].filter((v) => now - v.lastAt <= SEEN_WINDOW_MS && inFrenchWaters(v.lat, v.lon));
    const zones = Object.fromEntries(Object.keys(ZONE_LABELS).map((z) => [z, {
      zone: z, label: ZONE_LABELS[z], vessels: 0, classA: 0, classB: 0, atAnchor: 0, moored: 0, underWay: 0, restricted: 0, fishing: 0,
    }]));
    const ports = PORTS.map((p) => ({ port: p.port, vessels: 0, atAnchor: 0, moored: 0, underWay: 0 }));
    const info = { restricted: 0, draught: 0, fishing: 0 };
    const signals = [];
    const sensitive = { tankers: 0, passenger: 0, list: [] };
    const byType = emptyByType();
    let typed = 0;
    let frenchFlag = 0;
    for (const v of seen) {
      const st = statics.get(v.mmsi) ?? null;
      if (st?.type) typed += 1;
      byType[typeCategory(st?.type)] += 1;
      if (isFrenchFlag(v.mmsi)) frenchFlag += 1;
      const z = zones[zoneOf(v.lat, v.lon)];
      z.vessels += 1;
      if (v.classA) z.classA += 1; else z.classB += 1;
      if (v.status === 1) z.atAnchor += 1;
      if (v.status === 5) z.moored += 1;
      if ((v.sog ?? 0) > UNDER_WAY_KNOTS) z.underWay += 1;
      if (v.status === 3) { z.restricted += 1; info.restricted += 1; }
      if (v.status === 4) info.draught += 1;
      if (v.status === 7) { z.fishing += 1; info.fishing += 1; }
      PORTS.forEach((p, i) => {
        const km = haversineKm(v.lat, v.lon, p.lat, p.lon);
        if (km <= PORT_ANCHOR_KM && v.status === 1) ports[i].atAnchor += 1;
        if (km > PORT_PRESENT_KM) return;
        ports[i].vessels += 1;
        if (v.status === 5) ports[i].moored += 1;
        if ((v.sog ?? 0) > UNDER_WAY_KNOTS) ports[i].underWay += 1;
      });
      const kind = sensitiveKind(st?.type);
      if (kind) {
        const nm = distanceToMetropoleKm(v.lat, v.lon, SENSITIVE_NM * NM_KM) / NM_KM;
        if (nm <= SENSITIVE_NM) {
          if (kind === 'petrolier') sensitive.tankers += 1; else sensitive.passenger += 1;
          sensitive.list.push({ mmsi: v.mmsi, name: st?.name ?? v.name ?? null, type: kind, lat: v.lat, lon: v.lon, distanceNm: Math.round(nm * 10) / 10 });
        }
      }
      const run = v.run;
      if (run && run.lastAt - run.since >= SIGNAL_MIN_DURATION_MS && run.positions >= SIGNAL_MIN_POSITIONS
        && run.maxSog < SIGNAL_MAX_SOG && !inHarbour(v.lat, v.lon)) {
        signals.push({
          mmsi: v.mmsi, name: st?.name ?? v.name ?? null, type: typeLabel(st?.type), status: run.status, statusLabel: STATUS_LABELS[run.status],
          lat: v.lat, lon: v.lon, since: new Date(run.since).toISOString(), confirmed: true, sensitive: sensitiveKind(st?.type) !== null,
        });
      }
    }
    sensitive.list.sort((a, b) => a.distanceNm - b.distanceNm);
    return {
      at: new Date(now).toISOString(),
      lastMessageAt: lastMessageAt === null ? null : new Date(lastMessageAt).toISOString(),
      vessels: seen.length,
      frenchFlag,
      typedShare: seen.length ? Math.round((typed / seen.length) * 100) : 0,
      zones: Object.values(zones),
      ports,
      byType,
      signals,
      info,
      sensitive: { ...sensitive, list: sensitive.list.slice(0, 50) },
      errors: [],
    };
  }

  function exportStatics(now) {
    return [...statics].filter(([, s]) => now - s.at <= STATIC_KEEP_MS).map(([mmsi, s]) => ({ mmsi, ...s }));
  }

  function importStatics(list, now) {
    for (const s of Array.isArray(list) ? list : []) {
      if (!s?.mmsi || !Number.isFinite(s.at) || now - s.at > STATIC_KEEP_MS || statics.has(String(s.mmsi))) continue;
      statics.set(String(s.mmsi), { type: s.type ?? null, name: s.name ?? null, destination: s.destination ?? null, length: s.length ?? null, draught: s.draught ?? null, at: s.at });
    }
  }

  return { ingest, snapshot, exportStatics, importStatics, get size() { return { vessels: vessels.size, statics: statics.size }; } };
}

/**
 * Corps de GET /snapshot : instantané du suivi, avec les pannes nommées (S3). Sans clé ou sans flux amont,
 * l'instantané garde sa dernière donnée (`lastMessageAt`) : la vue écrit « AIS indisponible depuis hh:mm »,
 * jamais « aucun navire ».
 * @param {{ snapshot(now: number): object }} tracker
 * @param {number} now
 * @param {{ hasKey: boolean, upstreamOpen: boolean }} state
 */
export function snapshotResponse(tracker, now, { hasKey, upstreamOpen }) {
  const body = tracker.snapshot(now);
  const errors = [];
  if (!hasKey) errors.push('AIS : clé aisstream absente (AISSTREAM_API_KEY)');
  else if (!upstreamOpen) errors.push('AIS : flux aisstream déconnecté');
  return { ...body, errors };
}
