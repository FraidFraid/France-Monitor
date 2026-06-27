import { fetchJson, fetchText, setCors, parseCsv } from '../_shared/health-utils.js';
import { allDepartmentCodes, normalizeDepartmentCode } from '../_shared/departments.js';
import { APL_DEPARTEMENTS_SNAPSHOT, APL_SNAPSHOT_METADATA } from '../_shared/apl-departements-snapshot.js';

/**
 * APL — Accessibilité Potentielle Localisée aux médecins généralistes
 * Source principale : data.gouv.fr (dataset DREES/IRDES, mise à jour annuelle)
 * Alternative      : data.drees.solidarites-sante.gouv.fr (export CSV)
 *
 * Structure du CSV data.gouv.fr :
 *   code_com | nom | dep | apl | ...
 * On agrège les valeurs communales en moyenne par département.
 */

// Dataset data.gouv.fr (maintenu par la DREES, données 2023)
const DATAGOUV_APL_CSV =
  'https://static.data.gouv.fr/resources/donnees-sur-lindicateur-daccessibilite-potentielle-localisee-apl/20241015-135044/apl-medecins-generalistes-commune-2023.csv';

// Fallback : export CSV direct DREES (Opale/Shiny)
const DREES_APL_CSV_FALLBACK =
  'https://drees.shinyapps.io/apl/data/apl_mg_depuis2012.csv';

const DEP_KEYS = ['dep', 'departement', 'code_dep', 'code_departement', 'DEP', 'code_com'];
const APL_KEYS = ['apl', 'APL', 'apl_mg', 'apl_index', 'apl_medecin_generaliste'];

function toAplCategory(apl) {
  if (!Number.isFinite(apl)) return 'indisponible';
  if (apl < 2.5) return 'desert';    // < 2.5 consultations/an/hab = désert médical (seuil DREES 2023)
  if (apl < 4.0) return 'fragile';
  if (apl <= 7.0) return 'bon';
  return 'surdote';
}

function pickString(row, keys) {
  for (const key of keys) {
    const v = row?.[key];
    if (v == null) continue;
    const txt = String(v).trim();
    if (txt) return txt;
  }
  return '';
}

function pickNumber(row, keys) {
  for (const key of keys) {
    const n = Number.parseFloat(String(row?.[key] ?? '').replace(',', '.'));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Extracts department code from commune code (2 first chars, handle Corse 2A/2B) */
function depFromCom(comCode) {
  const s = String(comCode ?? '').trim().toUpperCase();
  if (s.startsWith('2A') || s.startsWith('2B')) return s.slice(0, 2);
  if (s.length >= 5) return s.slice(0, 2).replace(/^0/, '') || s.slice(0, 2);
  return '';
}

function aggregateAplByDepartment(rows) {
  const byDep = new Map();
  for (const row of rows) {
    let dep = normalizeDepartmentCode(pickString(row, ['dep', 'DEP', 'departement', 'code_departement']));
    if (!dep) {
      // Try extracting from commune code
      const com = pickString(row, ['code_com', 'CODGEO', 'codgeo', 'code_commune']);
      dep = normalizeDepartmentCode(depFromCom(com));
    }
    if (!dep) continue;
    const apl = pickNumber(row, APL_KEYS);
    if (apl == null || apl < 0) continue;
    const prev = byDep.get(dep) ?? { sum: 0, n: 0 };
    prev.sum += apl;
    prev.n += 1;
    byDep.set(dep, prev);
  }

  return [...byDep.entries()].map(([dep, agg]) => {
    const aplIndex = agg.n > 0 ? Math.round((agg.sum / agg.n) * 1000) / 1000 : null;
    return {
      code_insee: dep,
      apl_index: aplIndex,
      category: toAplCategory(aplIndex),
    };
  });
}

export default async function handler(req, res) {
  if (setCors(req, res)) return;

  try {
    let rows = [];
    let usedSource = null;

    // Try primary source (data.gouv CSV)
    try {
      const csvText = await fetchText(DATAGOUV_APL_CSV, { timeoutMs: 20000 });
      if (typeof csvText === 'string' && csvText.length > 500) {
        rows = parseCsv(csvText);
        usedSource = 'data.gouv.fr (DREES 2023)';
      }
    } catch (e) {
      console.warn('[api/health/apl] Primary source failed:', e.message);
    }

    // Try DREES fallback
    if (rows.length === 0) {
      try {
        const csvText = await fetchText(DREES_APL_CSV_FALLBACK, { timeoutMs: 15000 });
        if (typeof csvText === 'string' && csvText.length > 500) {
          rows = parseCsv(csvText);
          usedSource = 'DREES Shiny/Opale';
        }
      } catch (e) {
        console.warn('[api/health/apl] Fallback source failed:', e.message);
      }
    }

    let departements = aggregateAplByDepartment(rows);

    if (departements.length === 0) {
      // Sources DREES live indisponibles → snapshot curé bundlé (DREES 2023).
      // Garantit que la couche « déserts médicaux » s'affiche toujours en prod.
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
      res.status(200).json({
        departements: APL_DEPARTEMENTS_SNAPSHOT,
        metadata: {
          ...(APL_SNAPSHOT_METADATA ?? {}),
          generated_at: new Date().toISOString(),
          source: APL_SNAPSHOT_METADATA?.source ?? 'snapshot bundlé (DREES 2023)',
          rows: APL_DEPARTEMENTS_SNAPSHOT.length,
          fallback: true,
        },
      });
      return;
    }

    departements.sort((a, b) => a.code_insee.localeCompare(b.code_insee));

    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=3600');
    res.status(200).json({
      departements,
      metadata: {
        generated_at: new Date().toISOString(),
        source: usedSource,
        rows: rows.length,
        departments_found: departements.length,
      },
    });
  } catch (err) {
    console.error('[api/health/apl]', err);
    res.status(502).json({
      error: 'Failed to fetch APL data',
      departements: [],
      details: err instanceof Error ? err.message : String(err),
    });
  }
}
