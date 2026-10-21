// api/_lib/outages-exposure.js : services publics exposés aux pannes (control room des pannes, lot 2, spec 2026-10-21 § 5.4). Pur,
// sauf loadServices (lecture du fichier statique). Services : gendarmeries, commissariats, préfectures, sous-préfectures, SDIS,
// hôpitaux avec urgences (public/data/services-publics.json, npm run build:services-publics).
// Croisement :
//   - panne d'un département : les services du département ;
//   - panne d'un opérateur mobile : les services des communes où ses antennes sont coupées (fichier ARCEP), hôpitaux à moins de 3 km ;
//   - panne nationale (téléphone, internet, urgences) sans antenne connue : un décompte national par type, sans liste.
// Un service exposé n'est jamais dit « coupé » : rien ne dit qu'il est client de l'opérateur ni qu'il a perdu ses lignes.
import { readFileSync } from 'node:fs';

export const SERVICES_PATH = new URL('../../public/data/services-publics.json', import.meta.url);
/** Hôpitaux pris en compte autour d'une antenne coupée (pas de code commune dans FINESS). */
export const HOSPITAL_RADIUS_KM = 3;
/** Services nommés dans le détail d'une panne. */
export const SAMPLE_MAX = 40;
/** Services placés sur la carte par panne (pictos de la salle). */
export const POINTS_MAX = 300;
const TYPE_ORDER = ['prefecture', 'sous_pref', 'police', 'gendarmerie', 'sdis', 'hopital'];
const NATIONAL_NETWORKS = new Set(['mobile', 'internet', 'urgence']);

/** @type {Array<{ t: string, n: string, c: string | null, d: string, x: number, y: number }> | null} */
let cache = null;

/** Services publics (lus une fois) ; liste vide si le fichier manque. */
export function loadServices() {
  if (cache !== null) return cache;
  try {
    const json = JSON.parse(readFileSync(SERVICES_PATH, 'utf8'));
    cache = Array.isArray(json?.services) ? json.services : [];
  } catch {
    cache = [];
  }
  return cache;
}

function km(aLon, aLat, bLon, bLat) {
  const r = Math.PI / 180;
  const x = (bLon - aLon) * r * Math.cos(((aLat + bLat) / 2) * r);
  const y = (bLat - aLat) * r;
  return 6371 * Math.hypot(x, y);
}

function summarize(list, basis) {
  const byType = {};
  for (const s of list) byType[s.t] = (byType[s.t] ?? 0) + 1;
  const sorted = [...list].sort((a, b) => TYPE_ORDER.indexOf(a.t) - TYPE_ORDER.indexOf(b.t) || a.n.localeCompare(b.n, 'fr'));
  return {
    basis, total: list.length, byType,
    sample: basis === 'national' ? [] : sorted.slice(0, SAMPLE_MAX).map((s) => ({ type: s.t, name: s.n, commune: s.c, dept: s.d })),
    points: basis === 'national' ? [] : sorted.slice(0, POINTS_MAX).map((s) => ({ type: s.t, name: s.n, lon: s.x, lat: s.y })),
  };
}

/**
 * Services exposés à une panne, ou null si la panne n'a pas de territoire (cloud, ouvrage électrique, réseau sans lieu).
 * @param {{ network: string, scope: string, operator: string | null, dept: string | null, national: boolean }} outage
 * @param {{ services: Array<{ t: string, n: string, c: string | null, d: string, x: number, y: number }>, sites: Array<{ insee: string | null, operator: string, lon: number, lat: number, cls: string }> }} ctx
 */
export function exposureOf(outage, { services, sites }) {
  if (outage.scope === 'departement' && outage.dept) return summarize(services.filter((s) => s.d === outage.dept), 'departement');
  if (outage.network === 'mobile' && outage.scope === 'operateur' && outage.operator) {
    const cut = sites.filter((s) => s.cls === 'recente' && s.operator === outage.operator && Number.isFinite(s.lon) && Number.isFinite(s.lat));
    if (cut.length > 0) {
      const communes = new Set(cut.map((s) => s.insee).filter((c) => c));
      const exposed = services.filter((s) => (s.c !== null && communes.has(s.c))
        || (s.t === 'hopital' && cut.some((a) => km(a.lon, a.lat, s.x, s.y) <= HOSPITAL_RADIUS_KM)));
      return summarize(exposed, 'communes');
    }
  }
  if (outage.national && NATIONAL_NETWORKS.has(outage.network)) return summarize(services, 'national');
  return null;
}
