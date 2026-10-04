// api/_lib/meteo-vigilance.js : carte et textes de la vigilance Météo-France (DPVigilance), lus et normalisés pour
// /api/environment/vigilance (spec 2026-10-04 environnement § 2.1, contrat § 2.1). Lecture stricte (source-http.js) :
// non 2xx, page HTML, défi anti-robot ou forme inattendue = erreur nommée. La clé passe dans l'en-tête `apikey`,
// jamais dans une URL ni dans un message. Domaines lus : départements de métropole et Corse (2 caractères) et
// domaines littoraux « XX10 » (vagues-submersion) ; FRA et tout autre domaine ignorés (l'outre-mer n'est pas dans ce
// flux). Les niveaux sont repris tels quels (E1) : aucun calcul refait ici.
import { DEPT_NAMES } from '../_shared/departments.js';
import { cachedSource, decodeEntities, fetchStrictJson, sourceError } from './source-http.js';
import { parisDay } from './paris-time.js';
import { overlayCurrentDay, readVigilanceHistory, recordCurrentDay, refreshWithin } from './vigilance-archive.js';

export const CARTE_URL = 'https://public-api.meteofrance.fr/public/DPVigilance/v1/cartevigilance/encours';
export const TEXTES_URL = 'https://public-api.meteofrance.fr/public/DPVigilance/v1/textesvigilance/encours';
/** Départements de métropole et Corse couverts par la carte. */
export const METROPOLE_DEPARTMENTS = 96;
/** Zones de défense des bulletins zonaux, toujours présentes dans la réponse (items vides quand la zone n'a pas de texte). */
export const DEFENSE_ZONES = [
  ['ZDF_NORD', 'Défense Nord'], ['ZDF_EST', 'Défense Est'], ['ZDF_OUEST', 'Défense Ouest'], ['ZDF_PARIS', 'Défense Paris'],
  ['ZDF_SUD', 'Défense Sud'], ['ZDF_SUD_EST', 'Défense Sud-Est'], ['ZDF_SUD_OUEST', 'Défense Sud-Ouest'],
];

const CARTE_KEY = 'env:vigilance:carte';
const TEXTES_KEY = 'env:vigilance:textes';
const TTL_SEC = 300;
/** Une carte servie périmée garde sa date (S1) ; au-delà de 2 jours elle n'est plus servie. */
const STALE_SEC = 172_800;
const PHENOMENA = new Set(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
const ECHEANCES = ['J', 'J1'];

/** Clé DPVigilance : espaces et retours à la ligne retirés (une valeur collée avec un saut de ligne rend l'en-tête invalide). */
export function meteoFranceKey() {
  return (process.env.METEO_FRANCE_API_KEY || process.env.VITE_METEOFRANCE_API_KEY || '').replace(/\s+/g, '');
}

/**
 * Texte lisible d'un texte tiers : seules les vraies balises HTML (`<` suivi d'une lettre ou de `/`, puis le nom et `>`)
 * sont retirées avant le décodage des entités ; « Cumuls < 5 mm, jusqu'à > 10 mm » reste intact. Le résultat est du
 * texte brut : le client l'affiche échappé (textContent), jamais en HTML. Aucun tiret cadratin affiché.
 */
function cleanText(raw) {
  return decodeEntities(String(raw ?? '').replace(/<br\s*\/?>/gi, ' ').replace(/<\/?[a-z][^<>]*>/gi, ' '))
    .replace(/\s*\u2014\s*/g, ' : ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Codes des départements de métropole et Corse (96). */
const METROPOLE_CODES = Object.keys(DEPT_NAMES).filter((c) => /^(?:0[1-9]|[1-8]\d|9[0-5]|2A|2B)$/.test(c));

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);

function shapeError(detail) {
  return new Error(`forme inattendue (${detail})`);
}

/** Couleur officielle 1 à 4 (nombre ou texte « 3 ») ; null sinon. */
function colorOf(v) {
  if (typeof v !== 'number' && typeof v !== 'string') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 4 ? n : null;
}

/** Créneaux publiés d'un phénomène ; null si l'un d'eux est illisible. */
function readSlots(items) {
  const slots = [];
  for (const t of list(items)) {
    const color = colorOf(t?.color_id);
    if (!isRecord(t) || color === null || typeof t.begin_time !== 'string' || typeof t.end_time !== 'string') return null;
    slots.push({ from: t.begin_time, to: t.end_time, color });
  }
  return slots;
}

/** Couleur maximale et phénomènes d'un domaine ; null si une couleur ou un créneau est illisible. */
function readDomain(d) {
  const color = colorOf(d.max_color_id);
  if (color === null) return null;
  const phenomena = [];
  for (const p of list(d.phenomenon_items)) {
    const id = String(p?.phenomenon_id ?? '');
    if (!PHENOMENA.has(id)) continue;
    const pColor = colorOf(p.phenomenon_max_color_id);
    const slots = readSlots(p.timelaps_items);
    if (pColor === null || slots === null) return null;
    phenomena.push({ id, color: pColor, slots });
  }
  return { color, phenomena };
}

/** Du plus fort au plus faible, puis par numéro de phénomène. */
const byStrength = (a, b) => b.color - a.color || Number(a.id) - Number(b.id);

function commentOf(textItems) {
  const items = Array.isArray(textItems) ? textItems : isRecord(textItems) ? [textItems] : [];
  const lines = items.flatMap((t) => list(t?.text)).filter((s) => typeof s === 'string').map(cleanText).filter(Boolean);
  return lines.length > 0 ? lines.join(' ') : null;
}

function colorCounts(items) {
  return list(items)
    .map((m) => ({ color: colorOf(m?.color_id), count: Number(m?.count) }))
    .filter((c) => c.color !== null && c.color >= 2 && Number.isInteger(c.count) && c.count >= 0)
    .sort((a, b) => a.color - b.color);
}

function parsePeriod(raw, echeance, errors) {
  const domains = raw?.timelaps?.domain_ids;
  if (typeof raw.begin_validity_time !== 'string' || typeof raw.end_validity_time !== 'string' || !Array.isArray(domains)) {
    throw shapeError(`échéance ${echeance}`);
  }
  const departments = [];
  const coast = [];
  const seen = new Set();
  const rejected = new Set();
  let green = 0;
  let maxColor = 1;
  for (const d of domains) {
    if (!isRecord(d)) continue;
    const id = String(d.domain_id ?? '');
    const isDepartment = /^(?:\d{2}|2A|2B)$/.test(id) && Object.hasOwn(DEPT_NAMES, id);
    const coastOf = /^(\d{2}|2A|2B)10$/.exec(id)?.[1] ?? null;
    if (!isDepartment && !(coastOf !== null && Object.hasOwn(DEPT_NAMES, coastOf))) continue;
    const read = readDomain(d);
    if (read === null) {
      errors.push(`Météo-France, carte : domaine ${id} illisible`);
      rejected.add(id);
      continue;
    }
    maxColor = Math.max(maxColor, read.color);
    if (isDepartment) {
      seen.add(id);
      if (read.color < 2) {
        green += 1;
        continue;
      }
      departments.push({
        code: id, name: DEPT_NAMES[id], color: read.color,
        phenomena: read.phenomena.filter((p) => p.color >= 2).sort(byStrength),
      });
    } else {
      const surge = read.phenomena.find((p) => p.id === '9');
      coast.push({ code: id, departement: coastOf, name: `${DEPT_NAMES[coastOf]}, littoral`, color: read.color, slots: surge?.slots ?? [] });
    }
  }
  const missing = METROPOLE_CODES.filter((c) => !seen.has(c) && !rejected.has(c));
  if (missing.length > 0) {
    errors.push(`Météo-France, carte : échéance ${echeance}, ${missing.length} départements absents du produit (${missing.join(', ')})`);
  }
  departments.sort((a, b) => b.color - a.color || a.name.localeCompare(b.name, 'fr'));
  coast.sort((a, b) => a.code.localeCompare(b.code));
  return {
    echeance,
    begin: raw.begin_validity_time,
    end: raw.end_validity_time,
    maxColor,
    comment: commentOf(raw.text_items),
    departments,
    greenDepartments: green,
    coast,
    counts: colorCounts(raw.max_count_items),
    perPhenomenon: list(raw.per_phenomenon_items)
      .filter((p) => PHENOMENA.has(String(p?.phenomenon_id ?? '')))
      .map((p) => ({ id: String(p.phenomenon_id), anyColor: Number(p.any_color_count) || 0, counts: colorCounts(p.phenomenon_counts) }))
      .sort((a, b) => Number(a.id) - Number(b.id)),
  };
}

/**
 * Carte de vigilance (cartevigilance/encours) : `{ updateTime, periods: [J, J1], errors }` ; lève sur une forme
 * inattendue (produit, date ou échéance J absents). `errors` nomme les domaines rejetés (couleur hors 1 à 4).
 */
export function parseVigilanceCarte(json) {
  const product = isRecord(json) ? json.product : null;
  if (!isRecord(product) || typeof product.update_time !== 'string' || !Number.isFinite(Date.parse(product.update_time))
    || !Array.isArray(product.periods)) {
    throw shapeError('produit, update_time ou periods absents');
  }
  const errors = [];
  const periods = [];
  for (const echeance of ECHEANCES) {
    const raw = product.periods.find((p) => isRecord(p) && p.echeance === echeance);
    if (raw) periods.push(parsePeriod(raw, echeance, errors));
    else if (echeance !== 'J') errors.push('Météo-France, carte : échéance J+1 absente du produit');
  }
  if (periods[0]?.echeance !== 'J') throw shapeError('échéance J absente');
  return { updateTime: product.update_time, periods, errors: [...new Set(errors)] };
}

/** Rubriques d'un texte : titre sans deux-points final (souligné quand le gras est vide), paragraphes non vides. */
function paragraphsOf(subdivisions) {
  const out = [];
  for (const s of list(subdivisions)) {
    if (!isRecord(s)) continue;
    const bold = typeof s.bold_text === 'string' ? cleanText(s.bold_text) : '';
    const underline = typeof s.underline_text === 'string' ? cleanText(s.underline_text) : '';
    const heading = (bold || underline).replace(/\s*:\s*$/, '');
    const text = list(s.text).filter((t) => typeof t === 'string').map(cleanText).filter(Boolean);
    if (!heading && text.length === 0) continue;
    out.push({ heading, text });
  }
  return out;
}

/** Textes d'un bloc : un élément par texte et par échéance (« J », « J1 ») ; les termes de même échéance sont réunis. */
function bulletinItems(bloc) {
  const items = [];
  for (const group of list(bloc.bloc_items)) {
    const kind = group?.type_group === 'SITUATION' ? 'situation' : group?.type_group === 'SUIVI' ? 'suivi' : null;
    if (kind === null) continue;
    for (const text of list(group.text_items)) {
      if (!isRecord(text)) continue;
      const code = text.hazard_code === null || text.hazard_code === undefined ? null : String(text.hazard_code);
      const phenomenon = code !== null && PHENOMENA.has(code) ? code : null;
      const hazard = typeof text.hazard_name === 'string' ? cleanText(text.hazard_name) : 'tous aléas';
      const byEcheance = new Map();
      for (const term of list(text.term_items)) {
        if (!isRecord(term) || !ECHEANCES.includes(term.term_names)) continue;
        const color = colorOf(term.risk_code);
        if (color === null) continue;
        const paragraphs = paragraphsOf(term.subdivision_text);
        const previous = byEcheance.get(term.term_names);
        if (previous) {
          previous.paragraphs.push(...paragraphs);
          previous.color = Math.max(previous.color, color);
        } else {
          byEcheance.set(term.term_names, { kind, phenomenon, hazard, echeance: term.term_names, color, paragraphs });
        }
      }
      items.push(...[...byEcheance.values()].filter((i) => i.paragraphs.length > 0));
    }
  }
  return items;
}

/** « 2A » et « 2B » entre « 19 » et « 21 ». */
const departmentOrder = (code) => (code === '2A' ? '20A' : code === '2B' ? '20B' : code);

/**
 * Textes de vigilance (textesvigilance/encours) : `{ updateTime, bulletins }` dans l'ordre national, 7 zones de défense
 * (toujours présentes), départements dont le bulletin n'est pas vide ; lève sur une forme inattendue.
 */
export function parseVigilanceTextes(json) {
  const product = isRecord(json) ? json.product : null;
  if (!isRecord(product) || typeof product.update_time !== 'string' || !Number.isFinite(Date.parse(product.update_time))
    || !Array.isArray(product.text_bloc_items)) {
    throw shapeError('produit, update_time ou text_bloc_items absents');
  }
  const blocs = product.text_bloc_items.filter(isRecord);
  const national = blocs.find((b) => b.bloc_id === 'BULLETIN_NATIONAL');
  const bulletins = [{ scope: 'national', domainId: 'FRA', domainName: 'France', items: national ? bulletinItems(national) : [] }];
  for (const [id, name] of DEFENSE_ZONES) {
    const bloc = blocs.find((b) => b.bloc_id === 'BULLETIN_ZONAL' && b.domain_id === id);
    bulletins.push({ scope: 'zonal', domainId: id, domainName: name, items: bloc ? bulletinItems(bloc) : [] });
  }
  const departemental = blocs
    .filter((b) => b.bloc_id === 'BULLETIN_DEPARTEMENTAL' && typeof b.domain_id === 'string' && Object.hasOwn(DEPT_NAMES, b.domain_id))
    .map((b) => ({ scope: 'departemental', domainId: b.domain_id, domainName: DEPT_NAMES[b.domain_id], items: bulletinItems(b) }))
    .filter((b) => b.items.length > 0)
    .sort((a, b) => departmentOrder(a.domainId).localeCompare(departmentOrder(b.domainId)));
  return { updateTime: product.update_time, bulletins: [...bulletins, ...departemental] };
}

/** Dernier échec de chaque partie (mémoire du processus) : nommé tant que la valeur servie est plus ancienne que lui (S3). */
const failures = new Map();

/** Réservé aux tests : oublie les échecs mémorisés. */
export function __resetVigilanceStateForTests() {
  failures.clear();
}

/**
 * Une partie (carte ou textes) lue par le cache partagé : `{ value, error }`. Valeur servie périmée après un échec :
 * gardée avec sa propre date (`readAt`) et l'échec nommé ; rien en cache : `value` null et l'échec nommé.
 */
async function readPart(key, label, read) {
  try {
    const value = await cachedSource(key, { ttlSec: TTL_SEC, staleSec: STALE_SEC, shared: false }, async () => {
      try {
        const parsed = await read();
        failures.delete(key);
        return { ...parsed, readAt: new Date(Date.now()).toISOString() };
      } catch (err) {
        failures.set(key, { at: Date.now(), message: sourceError(label, err) });
        throw err;
      }
    });
    const failure = failures.get(key);
    return { value, error: failure && Date.parse(value.readAt) < failure.at ? failure.message : null };
  } catch (err) {
    return { value: null, error: sourceError(label, err) };
  }
}

/** Réponse sans aucune partie lue (clé absente). */
function emptyVigilance(errors) {
  return { updateTime: null, textsUpdateTime: null, periods: [], bulletins: [], history: { days: [], since: null }, readAt: null, errors };
}

/**
 * Réponse complète (VigilanceResponse) à l'instant `now`. Carte et textes sont lus en parallèle ; chacun peut manquer sans
 * empêcher l'autre (réponse partielle nommée). Historique : 30 jours de l'archive, jour de l'échéance J superposé ; une
 * panne de l'archive est nommée sans retirer le reste.
 */
export async function loadVigilance(now = Date.now(), archiveWaitMs = 0) {
  const key = meteoFranceKey();
  if (!key) return emptyVigilance(['Météo-France : clé absente']);
  const headers = { apikey: key };
  const [carte, textes, archive] = await Promise.all([
    readPart(CARTE_KEY, 'Météo-France, carte', async () => parseVigilanceCarte(await fetchStrictJson(CARTE_URL, { headers }))),
    readPart(TEXTES_KEY, 'Météo-France, textes', async () => parseVigilanceTextes(await fetchStrictJson(TEXTES_URL, { headers }))),
    // Relève de l'archive attendue en parallèle de la carte et des textes (jamais plus de `archiveWaitMs`), puis historique lu.
    (async () => {
      if (archiveWaitMs > 0) await refreshWithin(now, archiveWaitMs);
      return readVigilanceHistory(now);
    })(),
  ]);
  const periodJ = carte.value?.periods.find((p) => p.echeance === 'J') ?? null;
  const running = await recordCurrentDay(periodJ, carte.value?.updateTime ?? null, now);
  // Jour de Paris en cours : maximum partiel (« jour en cours »), jamais présenté comme définitif.
  const today = parisDay(now);
  const days = overlayCurrentDay(archive.days, periodJ, running).map((d) => (d.date === today ? { ...d, partial: true } : d));
  const errors = [carte.error, ...(carte.value?.errors ?? []), textes.error, archive.error].filter((e) => typeof e === 'string');
  return {
    updateTime: carte.value?.updateTime ?? null,
    textsUpdateTime: textes.value?.updateTime ?? null,
    periods: carte.value?.periods ?? [],
    bulletins: textes.value?.bulletins ?? [],
    history: { days, since: days[0]?.date ?? null },
    readAt: carte.value?.readAt ?? null,
    errors,
  };
}
