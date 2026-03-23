export function setCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return true;
  }

  return false;
}

export async function fetchJson(url, { timeoutMs = 12000, headers = {} } = {}) {
  const resp = await fetch(url, {
    headers: {
      Accept: 'application/json',
      ...headers,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} for ${url}`);
  }

  return await resp.json();
}

export async function fetchText(url, { timeoutMs = 12000, headers = {} } = {}) {
  const resp = await fetch(url, {
    headers: {
      Accept: 'text/plain, text/csv, text/html;q=0.9, */*;q=0.8',
      ...headers,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} for ${url}`);
  }

  return await resp.text();
}

export function decodeHtmlEntities(input) {
  return String(input || '')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&eacute;/g, 'é')
    .replace(/&egrave;/g, 'è')
    .replace(/&ecirc;/g, 'ê')
    .replace(/&agrave;/g, 'à')
    .replace(/&ocirc;/g, 'ô')
    .replace(/&uuml;/g, 'ü')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function toIsoDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const ymdSlash = raw.match(/^(\d{4})[\/-](\d{2})[\/-](\d{2})$/);
  if (ymdSlash) {
    return `${ymdSlash[1]}-${ymdSlash[2]}-${ymdSlash[3]}`;
  }

  const dmy = raw.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})$/);
  if (dmy) {
    return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  }

  const dt = new Date(raw);
  if (!Number.isNaN(dt.getTime())) {
    return dt.toISOString().slice(0, 10);
  }
  return null;
}

export function parseCsv(text) {
  const cleaned = String(text || '').replace(/^\uFEFF/, '');
  const lines = cleaned
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  if (lines.length < 2) return [];

  const delim = detectDelimiter(lines[0]);
  const headers = splitCsvLine(lines[0], delim).map((h) => normalizeHeader(h));

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = splitCsvLine(lines[i], delim);
    if (cols.length === 0) continue;
    const obj = {};
    for (let c = 0; c < headers.length; c += 1) {
      obj[headers[c]] = (cols[c] ?? '').trim();
    }
    rows.push(obj);
  }
  return rows;
}

function detectDelimiter(line) {
  const cands = [';', ',', '\t'];
  let best = ';';
  let bestScore = -1;
  for (const d of cands) {
    const score = splitCsvLine(line, d).length;
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

function splitCsvLine(line, delim) {
  const out = [];
  let cur = '';
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];

    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (!quoted && ch === delim) {
      out.push(cur);
      cur = '';
      continue;
    }

    cur += ch;
  }

  out.push(cur);
  return out;
}

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export const REGION_CODE_TO_NAME = {
  '11': 'Île-de-France',
  '24': 'Centre-Val de Loire',
  '27': 'Bourgogne-Franche-Comté',
  '28': 'Normandie',
  '32': 'Hauts-de-France',
  '44': 'Grand Est',
  '52': 'Pays de la Loire',
  '53': 'Bretagne',
  '75': 'Nouvelle-Aquitaine',
  '76': 'Occitanie',
  '84': 'Auvergne-Rhône-Alpes',
  '93': "Provence-Alpes-Côte d'Azur",
  '94': 'Corse',
};

const REGION_ALIAS_TO_CODE = {
  // Current short aliases (DREES/SPF)
  IDF: '11', CVL: '24', BFC: '27', NOR: '28', HDF: '32', GES: '44', PDL: '52',
  BRE: '53', NAQ: '75', OCC: '76', ARA: '84', PAC: '93', COR: '94',

  // Legacy names used by Sentinelles REG granularity
  ALSACE: '44',
  CHAMPAGNEARDENNE: '44',
  LORRAINE: '44',
  AQUITAINE: '75',
  LIMOUSIN: '75',
  POITOUCHARENTES: '75',
  AUVERGNE: '84',
  RHONEALPES: '84',
  BASSENORMANDIE: '28',
  HAUTENORMANDIE: '28',
  BOURGOGNE: '27',
  FRANCHECOMTE: '27',
  LANGUEDOCROUSSILLON: '76',
  MIDIPYRENEES: '76',
  NORDPASDECALAIS: '32',
  PICARDIE: '32',
  PROVENCEALPESCOTEDAZUR: '93',
  PAYSDELALOIRE: '52',
  BRETAGNE: '53',
  CENTRE: '24',
  CORSE: '94',
  ILEDEFRANCE: '11',
  OUTREMER: null,
};

export function resolveRegionCode(input) {
  if (input == null) return null;
  const raw = String(input).trim();
  if (!raw) return null;

  const digits = raw.replace(/^0+/, '');
  if (/^\d{1,3}$/.test(digits)) {
    const code = digits.padStart(2, '0');
    return REGION_CODE_TO_NAME[code] ? code : null;
  }

  const alias = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase();

  if (Object.prototype.hasOwnProperty.call(REGION_ALIAS_TO_CODE, alias)) {
    return REGION_ALIAS_TO_CODE[alias];
  }

  return null;
}
