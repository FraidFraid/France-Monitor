// api/_lib/pollen.js : pollens (Atmo France, WFS ind_pol:ind_national_pol sans clé, Licence Ouverte ; 20/10/2026). Une entité par
// commune et par jour d'échéance (J, J+1, J+2), environ 34 800 communes par jour. Chaque jour est lu dans sa propre requête, filtrée
// en CQL par date et réduite par propertyName (sans géométrie : environ 11 Mo par jour au lieu de 36 Mo pour les trois jours,
// 28 s mesurées pour les trois jours ensemble). Agrégation par département : plus haut code, communes comptées, communes à 4 ou plus,
// alerte, et plus haut code de chacun des six taxons. Échelle Atmo : 1 très faible, 2 faible, 3 modéré, 4 élevé, 5 très élevé,
// 6 extrêmement élevé ; 0 ou absent : indisponible, jamais compté comme un niveau.
import { DEPT_NAMES } from '../_shared/departments.js';
import { parisDay } from './paris-time.js';
import { addDays, deptOfCommune } from './atmo.js';
import { cachedSourceReport, fetchStrictText, sourceError } from './source-http.js';

export const POLLEN_BASE = 'https://data.atmo-france.org/geoserver/ind_pol/ows';
/** Plafond de la garde « réponse non filtrée » : 34 806 communes par jour mesurées le 20/10 ; au-delà, le filtre n'a pas été appliqué. */
export const POLLEN_MAX_MATCHED = 45_000;
/** Corps borné à 30 Mo (11 Mo mesurés par jour). */
export const POLLEN_MAX_BYTES = 30_000_000;
/** Une requête tient en 0,5 s à chaud et jusqu'à 20 s à froid (cache du serveur Atmo) ; la route répond en 15 s au plus. */
export const POLLEN_TIMEOUT_MS = 14_000;
export const POLLEN_PROPERTIES = 'code_zone,code_qual,date_ech,date_maj,alerte,source,code_aul,code_boul,code_oliv,code_gram,code_arm,code_ambr';

/** Taxons publiés : propriété Atmo, identifiant stable. */
export const POLLEN_TAXA = [
  { taxon: 'aulne', prop: 'code_aul' },
  { taxon: 'bouleau', prop: 'code_boul' },
  { taxon: 'olivier', prop: 'code_oliv' },
  { taxon: 'graminees', prop: 'code_gram' },
  { taxon: 'armoise', prop: 'code_arm' },
  { taxon: 'ambroisie', prop: 'code_ambr' },
];
const TAXON_ORDER = POLLEN_TAXA.map((t) => t.taxon);

/** Commune INSEE (5 caractères, Corse 2A et 2B) : les autres zones ne sont pas rattachées à un département. */
const COMMUNE_RE = /^(?:\d{5}|2[AB]\d{3})$/;
const EXTRA_NAMES = { 975: 'Saint-Pierre-et-Miquelon', 977: 'Saint-Barthélemy', 978: 'Saint-Martin' };

export function pollenUrl(day) {
  const url = new URL(POLLEN_BASE);
  const params = {
    service: 'WFS', version: '2.0.0', request: 'GetFeature', typeName: 'ind_pol:ind_national_pol', outputFormat: 'application/json',
    propertyName: POLLEN_PROPERTIES, cql_filter: `date_ech='${day}'`,
  };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

/** Relève : la prévision est publiée le matin (date_maj vers 10 h UTC) ; une relecture toutes les 2 h suffit. */
export function pollenTtlSec() {
  return 7_200;
}

function deptKey(code) {
  if (code === '2A') return 20.1;
  if (code === '2B') return 20.2;
  return Number(code);
}

function isoOrNull(ms) {
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** Code Atmo valide : entier de 1 à 6 ; 0, absent ou hors échelle : null (indisponible). */
function validCode(v) {
  const n = Number(v);
  return v !== null && v !== undefined && v !== '' && Number.isInteger(n) && n >= 1 && n <= 6 ? n : null;
}

/** Lecture WFS stricte d'un jour, avec garde « réponse non filtrée » (trop d'entités annoncées ou date hors du filtre). */
export async function fetchPollenDay(day) {
  const text = await fetchStrictText(pollenUrl(day), { expect: 'json', timeoutMs: POLLEN_TIMEOUT_MS, maxBytes: POLLEN_MAX_BYTES });
  let fc;
  try {
    fc = JSON.parse(text);
  } catch {
    throw new Error('JSON illisible');
  }
  if (!fc || typeof fc !== 'object' || !Array.isArray(fc.features)) throw new Error('FeatureCollection attendue');
  const matched = Number(fc.numberMatched ?? fc.totalFeatures ?? fc.features.length);
  if (Number.isFinite(matched) && matched > POLLEN_MAX_MATCHED) throw new Error(`réponse WFS non filtrée (${matched} entités)`);
  for (const f of fc.features) {
    const date = String(f?.properties?.date_ech ?? '').slice(0, 10);
    if (date !== day) throw new Error(`réponse WFS non filtrée (date ${date || 'absente'} hors du filtre)`);
  }
  return fc;
}

/**
 * Un jour d'échéance agrégé par département. Une commune publiée deux fois garde le plus haut de ses codes ; une commune sans code
 * valide n'est pas comptée. Retourne `date: null` quand aucune commune n'est lisible (jour non publié).
 */
export function aggregatePollenDay(fc, date) {
  const best = new Map();
  const sources = new Set();
  let updatedMs = -Infinity;
  for (const f of fc.features) {
    const p = f?.properties ?? {};
    const code = String(p.code_zone ?? '');
    const q = validCode(p.code_qual);
    if (!COMMUNE_RE.test(code) || q === null) continue;
    const cur = best.get(code) ?? { q: 0, alerte: false, taxa: new Map() };
    cur.q = Math.max(cur.q, q);
    cur.alerte = cur.alerte || p.alerte === true;
    for (const { taxon, prop } of POLLEN_TAXA) {
      const c = validCode(p[prop]);
      if (c !== null) cur.taxa.set(taxon, Math.max(cur.taxa.get(taxon) ?? 0, c));
    }
    best.set(code, cur);
    if (typeof p.source === 'string' && p.source.trim() !== '') sources.add(p.source.trim());
    const t = typeof p.date_maj === 'string' ? Date.parse(p.date_maj) : Number.NaN;
    if (Number.isFinite(t) && t > updatedMs) updatedMs = t;
  }
  const byDept = new Map();
  for (const [code, c] of best) {
    const dept = deptOfCommune(code);
    const d = byDept.get(dept) ?? { dept, date, maxCode: 0, communes: 0, high: 0, alerte: false, taxa: new Map() };
    d.communes += 1;
    if (c.q >= 4) d.high += 1;
    d.maxCode = Math.max(d.maxCode, c.q);
    d.alerte = d.alerte || c.alerte;
    for (const [taxon, v] of c.taxa) d.taxa.set(taxon, Math.max(d.taxa.get(taxon) ?? 0, v));
    byDept.set(dept, d);
  }
  return {
    date: best.size > 0 ? date : null,
    updatedAt: isoOrNull(updatedMs),
    communes: best.size,
    sources: [...sources].sort((a, b) => a.localeCompare(b, 'fr')),
    departments: [...byDept.values()].sort((a, b) => deptKey(a.dept) - deptKey(b.dept)).map((d) => ({
      dept: d.dept, date: d.date, maxCode: d.maxCode, communes: d.communes, high: d.high, alerte: d.alerte,
      taxa: [...d.taxa].map(([taxon, code]) => ({ taxon, code }))
        .sort((a, b) => b.code - a.code || TAXON_ORDER.indexOf(a.taxon) - TAXON_ORDER.indexOf(b.taxon)),
    })),
  };
}

export function emptyPollen(errors) {
  return { readAt: null, days: [], updatedAt: null, departments: [], sources: [], errors };
}

/** Assemble la réponse de la route à partir des jours agrégés (les jours non publiés sont absents de `days`). */
export function buildPollenResponse(dayResults, readAt, errors) {
  const published = dayResults.filter((r) => r.date !== null).sort((a, b) => a.date.localeCompare(b.date));
  const byDept = new Map();
  for (const r of published) {
    for (const d of r.departments) {
      const entry = byDept.get(d.dept) ?? { code: d.dept, name: DEPT_NAMES[d.dept] ?? EXTRA_NAMES[d.dept] ?? d.dept, days: [] };
      entry.days.push({ date: d.date, maxCode: d.maxCode, communes: d.communes, high: d.high, alerte: d.alerte, taxa: d.taxa });
      byDept.set(d.dept, entry);
    }
  }
  const updated = published.map((r) => Date.parse(r.updatedAt ?? '')).filter(Number.isFinite).sort((a, b) => a - b).at(-1);
  return {
    readAt,
    days: published.map((r) => r.date),
    updatedAt: updated === undefined ? null : new Date(updated).toISOString(),
    departments: [...byDept.values()].sort((a, b) => deptKey(a.code) - deptKey(b.code)),
    sources: [...new Set(published.flatMap((r) => r.sources))].sort((a, b) => a.localeCompare(b, 'fr')),
    errors,
  };
}

/** Réponse de la route : 200 si au moins un jour a été lu (ou servi du cache avec sa date), sinon 502. */
export async function loadPollen(now = Date.now()) {
  const j = parisDay(now);
  const days = [j, addDays(j, 1), addDays(j, 2)];
  const ttlSec = pollenTtlSec();
  const readAt = new Date(now).toISOString();
  const label = 'Atmo France, pollens';
  const reads = await Promise.allSettled(days.map((day) => cachedSourceReport(
    `env:pollen:${day}`, { ttlSec, staleSec: 2 * 86_400, shared: true, waitMs: POLLEN_TIMEOUT_MS }, label,
    async () => aggregatePollenDay(await fetchPollenDay(day), day),
  )));
  const errors = [];
  const results = [];
  reads.forEach((r, i) => {
    if (r.status === 'rejected') errors.push(sourceError(`${label} ${days[i]}`, r.reason));
    else {
      results.push(r.value.value);
      if (r.value.error) errors.push(r.value.error);
    }
  });
  const body = buildPollenResponse(results, readAt, [...new Set(errors)]);
  return body.days.length === 0 && results.length === 0 ? emptyPollen(errors) : body;
}
