// api/_handlers/health/syndromic.js : passages aux urgences (OSCOUR) et actes SOS Médecins par syndrome,
// Odissé (Santé publique France), hebdomadaire, publié le mercredi (spec 2026-10-03 panneaux santé § 2.1).
// Remplace oscour-sos.js, departmental.js et epidemiology.js (jeux COVID gelés, routes retirées).
// Taux Odissé = pour 100 000 passages codés (ou actes) ; la réponse donne des parts en % (taux / 1 000).
// Requêtes : 7 exports France (toutes les semaines depuis le 04/07/2022) + 7 exports départementaux
// (dernière semaine et même semaine des trois saisons précédentes) + 1 lecture de métadonnées ; jamais de `limit`.
import { HealthFetchError, cachedSource, handlePreflight, sendHealthJson, sourceError } from '../../_lib/health-http.js';
import { fetchDatasetInfo, fetchExport, odsDate, odsList } from '../../_lib/odisse.js';

export const SERIES_START = '2022-07-04';
export const AGES_WEEKS = 14;
const TTL_SEC = 6 * 3600;
export const CACHE_CONTROL = 's-maxage=21600, stale-while-revalidate=86400';

/** Jeux Odissé par syndrome (identifiants vérifiés le 03/10/2026, exceptions -dep comprises), ordre de la réponse. */
export const SYNDROMES = Object.freeze([
  { key: 'ira', label: 'IRA', field: 'ira', ageClass: 'Tous âges', ages: ['00-04 ans', '05-14 ans', '15-64 ans', '65 ans ou plus'],
    france: 'infections-respiratoires-aigues-ira-passages-aux-urgences-et-actes-sos-medecins-france',
    departement: 'infections-respiratoires-aigues-ira-passages-aux-urgences-et-actes-sos-medecins-departement' },
  { key: 'bronchio', label: 'Bronchiolite', field: 'bronchio', ageClass: '0 an', ages: [],
    france: 'bronchiolite-passages-aux-urgences-et-actes-sos-medecins-france',
    departement: 'bronchiolite-passages-aux-urgences-et-actes-sos-medecins-departement' },
  { key: 'gastro', label: 'Gastro-entérite', field: 'gastro', ageClass: 'Tous âges', ages: [],
    france: 'gastro-enterite-aigue-passages-aux-urgences-et-actes-sos-medecins-france',
    departement: 'gastro-enterite-aigue-passages-aux-urgences-et-actes-sos-medecins-departement' },
  { key: 'asthme', label: 'Asthme', field: 'asthme', ageClass: 'Tous âges', ages: [],
    france: 'asthme-passages-aux-urgences-et-actes-sos-medecins-france',
    departement: 'asthme-passages-aux-urgences-et-actes-sos-medecins-dep' },
  { key: 'allergie', label: 'Allergie', field: 'allergie', ageClass: 'Tous âges', ages: [],
    france: 'allergie-passages-aux-urgences-et-actes-sos-medecins-france',
    departement: 'allergie-passages-aux-urgences-et-actes-sos-medecins-dep' },
  { key: 'grippe', label: 'Grippe', field: 'grippe', ageClass: 'Tous âges', ages: [],
    france: 'grippe-passages-aux-urgences-et-actes-sos-medecins-france',
    departement: 'grippe-passages-aux-urgences-et-actes-sos-medecins-departement' },
  { key: 'covid', label: 'COVID-19', field: 'covid', ageClass: 'Tous âges', ages: ['65 ans ou plus'],
    france: 'covid-19-passages-aux-urgences-et-actes-sos-medecins-france',
    departement: 'covid-19-passages-aux-urgences-et-actes-sos-medecins-departement' },
]);

/** Taux pour 100 000 → part en % arrondie au millième (2 108,22 → 2,108) ; null reste null, jamais 0. */
export function rateToPct(rate) {
  return typeof rate === 'number' && Number.isFinite(rate) ? Math.round(rate) / 1000 : null;
}

/** Dimanche d'une semaine dont on connaît le lundi (AAAA-MM-JJ). */
export function weekEnd(start) {
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}

/**
 * Même semaine ISO des `seasons` saisons précédentes, la plus récente d'abord ; chaque entrée liste les
 * semaines candidates (une semaine 53 retombe sur la 52 de l'année qui n'en a pas).
 */
export function previousSeasonWeeks(weekId, seasons = 3) {
  const m = /^(\d{4})-S(\d{2})$/.exec(String(weekId));
  if (!m) return [];
  const out = [];
  for (let k = 1; k <= seasons; k += 1) {
    const year = Number(m[1]) - k;
    out.push(m[2] === '53' ? [`${year}-S53`, `${year}-S52`] : [`${year}-S${m[2]}`]);
  }
  return out;
}

function toPoint(cfg, row) {
  return {
    week: String(row.semaine),
    start: String(row.date_complet),
    er: rateToPct(row[`taux_passages_${cfg.field}_sau`]),
    hosp: rateToPct(row[`taux_hospit_${cfg.field}_sau`]),
    sos: rateToPct(row[`taux_actes_${cfg.field}_sos`]),
  };
}

const byStart = (a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0);

/** Série France d'un syndrome (classe principale chronologique, classes d'âge sur 14 semaines). */
export function buildSeries(cfg, rows) {
  const byClass = new Map();
  for (const row of rows) {
    const cls = String(row.sursaud_cl_age_gene ?? '');
    if (!byClass.has(cls)) byClass.set(cls, []);
    byClass.get(cls).push(toPoint(cfg, row));
  }
  const ages = {};
  for (const cls of cfg.ages) ages[cls] = [...(byClass.get(cls) ?? [])].sort(byStart).slice(-AGES_WEEKS);
  return { key: cfg.key, label: cfg.label, ageClass: cfg.ageClass, france: [...(byClass.get(cfg.ageClass) ?? [])].sort(byStart), ages };
}

/** Dernière semaine publiée parmi les séries (elles sont livrées ensemble). */
export function latestWeek(series) {
  let last = null;
  for (const s of series) {
    const p = s.france.at(-1);
    if (p && (!last || p.start > last.start)) last = p;
  }
  return last ? { id: last.week, start: last.start, end: weekEnd(last.start) } : null;
}

/**
 * Départements de la semaine `weekId` (ceux qu'Odissé publie cette semaine-là) ; pour chaque syndrome, la
 * part aux urgences, hospitalisations et SOS Médecins (null : pas d'association), et refEr, parts de la même
 * semaine des trois saisons précédentes, la plus récente d'abord (valeurs absentes omises).
 */
export function buildDepartments(weekId, rowsBySyndrome) {
  const seasons = previousSeasonWeeks(weekId);
  const departments = new Map();
  for (const cfg of SYNDROMES) {
    const rows = rowsBySyndrome[cfg.key];
    if (!Array.isArray(rows)) continue;
    const index = new Map(rows.map((r) => [`${r.semaine}|${r.dep}`, r]));
    for (const row of rows) {
      if (row.semaine !== weekId) continue;
      const code = String(row.dep);
      if (!departments.has(code)) departments.set(code, { code, name: String(row.libgeo ?? code), values: {} });
      const refEr = [];
      for (const candidates of seasons) {
        const ref = candidates.map((w) => index.get(`${w}|${code}`)).find(Boolean);
        const er = ref ? rateToPct(ref[`taux_passages_${cfg.field}_sau`]) : null;
        if (er !== null) refEr.push(er);
      }
      const { er, hosp, sos } = toPoint(cfg, row);
      departments.get(code).values[cfg.key] = { er, hosp, sos, refEr };
    }
  }
  return [...departments.values()].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

const fields = (cfg) => `taux_passages_${cfg.field}_sau,taux_hospit_${cfg.field}_sau,taux_actes_${cfg.field}_sos`;

async function nonEmpty(rowsPromise) {
  const rows = await rowsPromise;
  if (rows.length === 0) throw new HealthFetchError('aucune ligne', { kind: 'empty' });
  return rows;
}

function franceRows(cfg) {
  return cachedSource(`syndromic:fr:${cfg.key}`, { ttlSec: TTL_SEC }, () => nonEmpty(fetchExport(cfg.france, {
    select: `semaine,date_complet,sursaud_cl_age_gene,${fields(cfg)}`,
    where: `date_complet>=${odsDate(SERIES_START)} and sursaud_cl_age_gene in ${odsList([cfg.ageClass, ...cfg.ages])}`,
    orderBy: 'date_complet',
  })));
}

function departmentRows(cfg, weekIds) {
  return cachedSource(`syndromic:dep:${cfg.key}:${weekIds[0]}`, { ttlSec: TTL_SEC }, () => nonEmpty(fetchExport(cfg.departement, {
    select: `semaine,date_complet,dep,libgeo,${fields(cfg)}`,
    where: `semaine in ${odsList(weekIds)} and sursaud_cl_age_gene in ${odsList([cfg.ageClass])}`,
  })));
}

/** Réponse complète (SyndromicResponse) ; une source en échec n'empêche jamais les autres. */
export async function loadSyndromic() {
  const errors = [];
  const rowsFrance = {};
  await Promise.all(SYNDROMES.map(async (cfg) => {
    try {
      rowsFrance[cfg.key] = await franceRows(cfg);
    } catch (err) {
      errors.push(sourceError(`Odissé, ${cfg.label} France`, err));
    }
  }));
  const syndromes = SYNDROMES.map((cfg) => buildSeries(cfg, rowsFrance[cfg.key] ?? []));
  const week = latestWeek(syndromes);

  let publishedAt = null;
  try {
    publishedAt = (await cachedSource('syndromic:meta', { ttlSec: TTL_SEC }, () => fetchDatasetInfo(SYNDROMES[0].france))).dataProcessed;
  } catch (err) {
    errors.push(sourceError('Odissé, date de publication', err));
  }

  let departments = [];
  if (week) {
    const weekIds = [week.id, ...previousSeasonWeeks(week.id).flat()];
    const rowsDep = {};
    await Promise.all(SYNDROMES.map(async (cfg) => {
      try {
        rowsDep[cfg.key] = await departmentRows(cfg, weekIds);
      } catch (err) {
        errors.push(sourceError(`Odissé, ${cfg.label} départements`, err));
      }
    }));
    departments = buildDepartments(week.id, rowsDep);
  }
  return { week, publishedAt, syndromes, departments, errors: errors.sort() };
}

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  const body = await loadSyndromic();
  sendHealthJson(res, body, { ok: body.week !== null, cacheControl: CACHE_CONTROL });
}
