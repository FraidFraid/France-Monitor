import {
    fetchJson,
    fetchText,
    parseCsv,
    setCors,
    toIsoDate,
    REGION_CODE_TO_NAME,
} from '../_shared/health-utils.js';

// ── Mapping département → région ──────────────────────────────────────────
const DEP_TO_REGION = {
    '01': '84', '02': '32', '03': '84', '04': '93', '05': '93', '06': '93', '07': '84', '08': '44', '09': '76',
    '10': '44', '11': '76', '12': '76', '13': '93', '14': '28', '15': '84', '16': '75', '17': '75', '18': '24',
    '19': '75', '21': '27', '22': '53', '23': '75', '24': '75', '25': '27', '26': '84', '27': '28', '28': '24',
    '29': '53', '30': '76', '31': '76', '32': '76', '33': '75', '34': '76', '35': '53', '36': '24', '37': '24',
    '38': '84', '39': '27', '40': '75', '41': '24', '42': '84', '43': '84', '44': '52', '45': '24', '46': '76',
    '47': '75', '48': '76', '49': '52', '50': '28', '51': '44', '52': '44', '53': '52', '54': '44', '55': '44',
    '56': '53', '57': '44', '58': '27', '59': '32', '60': '32', '61': '28', '62': '32', '63': '84', '64': '75',
    '65': '76', '66': '76', '67': '44', '68': '44', '69': '84', '70': '27', '71': '27', '72': '52', '73': '84',
    '74': '84', '75': '11', '76': '28', '77': '11', '78': '11', '79': '75', '80': '32', '81': '76', '82': '76',
    '83': '93', '84': '93', '85': '52', '86': '75', '87': '75', '88': '44', '89': '27', '90': '27', '91': '11',
    '92': '11', '93': '11', '94': '11', '95': '11',
    '2A': '94', '2B': '94',
    '971': '01', '972': '02', '973': '03', '974': '04', '976': '06',
};

// ── DREES departmental dataset URLs ───────────────────────────────────────
// National appariement dataset (SI-VIC / SI-DEP / VAC-SI) — may contain dep-level data
const DREES_NATIONAL_URLS = [
    'https://data.drees.solidarites-sante.gouv.fr/api/explore/v2.1/catalog/datasets/covid-19-resultats-issus-des-appariements-entre-si-vic-si-dep-et-vac-si/records?limit=200&order_by=-date',
];

// DREES urgences départementales (series longues urgences)
const DREES_URGENCES_URLS = [
    'https://data.drees.solidarites-sante.gouv.fr/api/explore/v2.1/catalog/datasets/passages-aux-urgences-pour-certaines-pathologies/records?limit=200&order_by=-date',
    'https://data.drees.solidarites-sante.gouv.fr/api/explore/v2.1/catalog/datasets/nombre-de-passages-aux-urgences-nombre-d-hospitalisations-apres-passage-aux-urgences/records?limit=200&order_by=-date',
];

// ── SPF data.gouv datasets with departmental granularity ──────────────────
const SPF_ORG_URL =
    'https://www.data.gouv.fr/api/1/organizations/sante-publique-france/datasets/?page_size=50';

function pickNumber(row, keys) {
    if (!row) return null;
    for (const key of keys) {
        if (!(key in row)) continue;
        const value = Number.parseFloat(String(row[key]).replace(',', '.'));
        if (Number.isFinite(value)) return value;
    }
    return null;
}

function pickString(row, keys) {
    if (!row) return '';
    for (const key of keys) {
        const value = row[key];
        if (value == null) continue;
        const txt = String(value).trim();
        if (txt) return txt;
    }
    return '';
}

function normalizeDepartmentCode(raw) {
    if (raw == null) return null;
    const s = String(raw).trim().toUpperCase();
    if (!s) return null;
    // Handle special Corsican codes
    if (s === '2A' || s === '2B') return s;
    // Handle numeric codes
    const n = s.replace(/^0+/, '');
    if (/^\d{1,3}$/.test(n)) {
        const code = n.padStart(2, '0');
        // Valid metro departments: 01-95 (excluding 20), DROM: 971-976
        if (DEP_TO_REGION[code]) return code;
    }
    return null;
}

// ── Fetch DREES dept data ─────────────────────────────────────────────────
async function fetchDreesDepData() {
    const byDep = new Map();

    for (const url of DREES_NATIONAL_URLS) {
        try {
            const payload = await fetchJson(url, { timeoutMs: 18000 });
            const rows = Array.isArray(payload?.results) ? payload.results : [];

            for (const row of rows) {
                const depCode = normalizeDepartmentCode(row.dep || row.departement || row.code_dep);
                if (!depCode) continue;

                const isoDate = toIsoDate(row.date || row.jour);
                if (!isoDate) continue;

                const prev = byDep.get(depCode);
                if (prev && prev.date > isoDate) continue;

                byDep.set(depCode, {
                    dep_code: depCode,
                    date: isoDate,
                    hosp: pickNumber(row, ['hc', 'hosp', 'hospitalisations']),
                    rea: pickNumber(row, ['sc', 'rea', 'reanimation', 'soins_critiques']),
                    incidence: pickNumber(row, ['incidence', 'tx_incidence', 'nb_pcr']),
                    positivity: pickNumber(row, ['tx_pos', 'taux_positivite', 'tp']),
                    dc: pickNumber(row, ['dc', 'deces', 'deaths']),
                    source: 'drees',
                });
            }
            if (byDep.size > 0) break;
        } catch {
            // try next URL
        }
    }

    return byDep;
}

// ── Fetch SPF departmental indicators via data.gouv discovery ─────────────
function selectDeptCandidates(datasets) {
    const candidates = [];

    for (const ds of datasets) {
        const title = String(ds?.title || '').toLowerCase();
        const resources = Array.isArray(ds?.resources) ? ds.resources : [];

        for (const r of resources) {
            const url = String(r?.url || '');
            if (!url) continue;
            const format = String(r?.format || '').toLowerCase();
            const rTitle = String(r?.title || '').toLowerCase();

            // Look for departmental resources (structured format)
            const isDept = /(?:^|[-_\/])(dep|departement|dept)(?:[-_\/]|$)/i.test(url)
                || /\bdep\b/i.test(rTitle)
                || /departement/i.test(rTitle);
            const isStructured = format.includes('csv') || format.includes('json')
                || /\.csv(?:\?|$)/i.test(url) || /\.json(?:\?|$)/i.test(url);

            if (!isDept || !isStructured) continue;

            const score =
                (title.includes('urgences') ? 5 : 0) +
                (title.includes('sos') ? 4 : 0) +
                (title.includes('hospit') ? 3 : 0) +
                (title.includes('epidem') ? 2 : 0) +
                (title.includes('incidence') ? 2 : 0) +
                (title.includes('covid') ? 1 : 0) +
                (format.includes('json') ? 1 : 0);

            candidates.push({
                datasetId: ds.id,
                datasetTitle: ds.title,
                resourceTitle: r.title,
                url,
                score,
            });
        }
    }

    candidates.sort((a, b) => b.score - a.score);

    const selected = [];
    const usedIds = new Set();
    for (const c of candidates) {
        if (usedIds.has(c.datasetId)) continue;
        selected.push(c);
        usedIds.add(c.datasetId);
        if (selected.length >= 3) break;
    }

    return selected;
}

async function fetchSpfDeptIndicators() {
    try {
        const org = await fetchJson(SPF_ORG_URL, { timeoutMs: 16000 });
        const datasets = Array.isArray(org?.data) ? org.data : [];
        const selected = selectDeptCandidates(datasets);

        if (selected.length === 0) return { records: [], sources: [] };

        const bundles = await Promise.all(selected.map(async (sel) => {
            try {
                const txt = await fetchText(sel.url, { timeoutMs: 16000 });
                let rows;
                if (/\.json(?:\?|$)/i.test(sel.url)) {
                    const parsed = JSON.parse(txt);
                    rows = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.results) ? parsed.results : []);
                } else {
                    rows = parseCsv(txt);
                }
                return { sel, rows };
            } catch {
                return { sel, rows: [] };
            }
        }));

        const byDep = new Map();
        for (const { rows } of bundles) {
            for (const row of rows) {
                const depCode = normalizeDepartmentCode(
                    pickString(row, ['dep', 'departement', 'code_dep', 'code_departement', 'dept'])
                );
                if (!depCode) continue;

                const isoDate = toIsoDate(
                    pickString(row, ['date', 'jour', 'date_de_passage', 'semaine', 'week'])
                );

                const prev = byDep.get(depCode);
                if (prev && isoDate && prev.date > isoDate) continue;

                const hosp = pickNumber(row, ['hosp', 'hospitalisations', 'nbre_hospit_corona', 'hc', 'nb_hospit']);
                const rea = pickNumber(row, ['rea', 'reanimation', 'sc', 'soins_critiques']);
                const incidence = pickNumber(row, ['incidence', 'tx_incidence', 'taux_incidence', 'nb']);
                const urgences = pickNumber(row, ['nbre_pass_total', 'nbre_pass_corona', 'passages', 'nb_passages']);

                if (hosp == null && rea == null && incidence == null && urgences == null) continue;

                byDep.set(depCode, {
                    dep_code: depCode,
                    date: isoDate,
                    hosp: hosp ?? prev?.hosp ?? null,
                    rea: rea ?? prev?.rea ?? null,
                    incidence: incidence ?? prev?.incidence ?? null,
                    urgences: urgences ?? prev?.urgences ?? null,
                    source: 'spf',
                });
            }
        }

        return {
            records: [...byDep.values()],
            sources: bundles.map(b => ({
                dataset_title: b.sel.datasetTitle,
                resource_title: b.sel.resourceTitle,
                points: b.rows.length,
            })),
        };
    } catch {
        return { records: [], sources: [] };
    }
}

// ── Fetch DREES urgences départementales ───────────────────────────────────
async function fetchDreesUrgences() {
    for (const url of DREES_URGENCES_URLS) {
        try {
            const payload = await fetchJson(url, { timeoutMs: 15000 });
            const rows = Array.isArray(payload?.results) ? payload.results : [];
            const byDep = new Map();

            for (const row of rows) {
                const depCode = normalizeDepartmentCode(
                    row.dep || row.departement || row.code_dep || row.region_dep
                );
                if (!depCode) continue;

                const isoDate = toIsoDate(row.date || row.jour || row.date_de_passage);
                const prev = byDep.get(depCode);
                if (prev && isoDate && prev.date > isoDate) continue;

                const passages = pickNumber(row, ['nb_passages', 'nbre_pass_total', 'passages', 'nb']);
                if (passages == null) continue;

                byDep.set(depCode, {
                    dep_code: depCode,
                    date: isoDate,
                    urgences: passages,
                });
            }

            if (byDep.size > 0) return [...byDep.values()];
        } catch {
            // try next URL
        }
    }
    return [];
}

// ── Department name resolution ────────────────────────────────────────────
const DEPT_NAMES = {
    '01': 'Ain', '02': 'Aisne', '03': 'Allier', '04': 'Alpes-de-Haute-Provence', '05': 'Hautes-Alpes',
    '06': 'Alpes-Maritimes', '07': 'Ardèche', '08': 'Ardennes', '09': 'Ariège', '10': 'Aube',
    '11': 'Aude', '12': 'Aveyron', '13': 'Bouches-du-Rhône', '14': 'Calvados', '15': 'Cantal',
    '16': 'Charente', '17': 'Charente-Maritime', '18': 'Cher', '19': 'Corrèze', '21': 'Côte-d\'Or',
    '22': 'Côtes-d\'Armor', '23': 'Creuse', '24': 'Dordogne', '25': 'Doubs', '26': 'Drôme',
    '27': 'Eure', '28': 'Eure-et-Loir', '29': 'Finistère', '30': 'Gard', '31': 'Haute-Garonne',
    '32': 'Gers', '33': 'Gironde', '34': 'Hérault', '35': 'Ille-et-Vilaine', '36': 'Indre',
    '37': 'Indre-et-Loire', '38': 'Isère', '39': 'Jura', '40': 'Landes', '41': 'Loir-et-Cher',
    '42': 'Loire', '43': 'Haute-Loire', '44': 'Loire-Atlantique', '45': 'Loiret', '46': 'Lot',
    '47': 'Lot-et-Garonne', '48': 'Lozère', '49': 'Maine-et-Loire', '50': 'Manche',
    '51': 'Marne', '52': 'Haute-Marne', '53': 'Mayenne', '54': 'Meurthe-et-Moselle',
    '55': 'Meuse', '56': 'Morbihan', '57': 'Moselle', '58': 'Nièvre', '59': 'Nord', '60': 'Oise',
    '61': 'Orne', '62': 'Pas-de-Calais', '63': 'Puy-de-Dôme', '64': 'Pyrénées-Atlantiques',
    '65': 'Hautes-Pyrénées', '66': 'Pyrénées-Orientales', '67': 'Bas-Rhin', '68': 'Haut-Rhin',
    '69': 'Rhône', '70': 'Haute-Saône', '71': 'Saône-et-Loire', '72': 'Sarthe', '73': 'Savoie',
    '74': 'Haute-Savoie', '75': 'Paris', '76': 'Seine-Maritime', '77': 'Seine-et-Marne',
    '78': 'Yvelines', '79': 'Deux-Sèvres', '80': 'Somme', '81': 'Tarn', '82': 'Tarn-et-Garonne',
    '83': 'Var', '84': 'Vaucluse', '85': 'Vendée', '86': 'Vienne', '87': 'Haute-Vienne',
    '88': 'Vosges', '89': 'Yonne', '90': 'Territoire de Belfort', '91': 'Essonne',
    '92': 'Hauts-de-Seine', '93': 'Seine-Saint-Denis', '94': 'Val-de-Marne', '95': 'Val-d\'Oise',
    '2A': 'Corse-du-Sud', '2B': 'Haute-Corse',
    '971': 'Guadeloupe', '972': 'Martinique', '973': 'Guyane', '974': 'La Réunion', '976': 'Mayotte',
};

export default async function handler(req, res) {
    if (setCors(req, res)) return;

    try {
        const [dreesData, spfData, urgencesData] = await Promise.all([
            fetchDreesDepData(),
            fetchSpfDeptIndicators(),
            fetchDreesUrgences(),
        ]);

        // Merge all sources by dep code
        const merged = new Map();

        // 1. DREES base data
        for (const [depCode, data] of dreesData) {
            merged.set(depCode, { ...data });
        }

        // 2. SPF indicators (fill gaps)
        for (const rec of spfData.records) {
            const existing = merged.get(rec.dep_code) || { dep_code: rec.dep_code };
            merged.set(rec.dep_code, {
                ...existing,
                hosp: existing.hosp ?? rec.hosp,
                rea: existing.rea ?? rec.rea,
                incidence: existing.incidence ?? rec.incidence,
                urgences: existing.urgences ?? rec.urgences,
                date: existing.date ?? rec.date,
                source: existing.source ? `${existing.source}+spf` : 'spf',
            });
        }

        // 3. DREES urgences overlay
        for (const rec of urgencesData) {
            const existing = merged.get(rec.dep_code) || { dep_code: rec.dep_code };
            merged.set(rec.dep_code, {
                ...existing,
                urgences: existing.urgences ?? rec.urgences,
                date: existing.date ?? rec.date,
            });
        }

        // Enrich with names and region codes
        const departments = [...merged.values()].map((d) => ({
            dep_code: d.dep_code,
            dep_name: DEPT_NAMES[d.dep_code] || `Département ${d.dep_code}`,
            region_code: DEP_TO_REGION[d.dep_code] || null,
            region_name: REGION_CODE_TO_NAME[DEP_TO_REGION[d.dep_code]] || null,
            date: d.date || null,
            hosp: d.hosp ?? null,
            rea: d.rea ?? null,
            incidence: d.incidence ?? null,
            urgences: d.urgences ?? null,
            positivity: d.positivity ?? null,
            source: d.source || 'unknown',
        })).sort((a, b) => a.dep_code.localeCompare(b.dep_code));

        const dreesCount = dreesData.size;
        const spfCount = spfData.records.length;
        const urgCount = urgencesData.length;

        res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=300');
        res.status(200).json({
            departments,
            metadata: {
                generated_at: new Date().toISOString(),
                total_departments: departments.length,
                sources: {
                    drees: { points: dreesCount, status: dreesCount > 0 ? 'ok' : 'empty' },
                    spf: { points: spfCount, status: spfCount > 0 ? 'ok' : 'empty', datasets: spfData.sources },
                    urgences: { points: urgCount, status: urgCount > 0 ? 'ok' : 'empty' },
                },
            },
        });
    } catch (err) {
        console.error('[api/health/departmental]', err);
        res.status(502).json({
            error: 'Failed to fetch departmental health data',
            details: err instanceof Error ? err.message : String(err),
            departments: [],
        });
    }
}
