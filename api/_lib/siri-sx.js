// api/_lib/siri-sx.js : situations ferroviaires SNCF au format SIRI SX Lite (point d'accès national, sans clé,
// licence ODbL ; spec 2026-10-03 panneaux trafic § 2.4). Le flux ne publie que les situations actives ; aucune
// cause structurée (`Severity` toujours « slight », `Route` vide) : la cause est lue dans le texte français
// (« Cause : … »), classée par mots-clés ; le rattachement à un axe ou une région vient de `ParticipantRef`
// (table relevée le 03/10/2026, « Non rattaché » sinon). Les messages d'information voyageur sans effet sur
// la circulation (ascenseur, train complet, arrêt déporté, voitures hors quai…) sont écartés.
import { parisLocalToIso } from './paris-time.js';
import { cleanText, decodeEntities, fetchStrictXml } from './source-http.js';

export const SIRI_SX_URL = 'https://proxy.transport.data.gouv.fr/resource/sncf-siri-lite-situation-exchange';

/** Émetteur (`ParticipantRef`) → axe ou région ; exemples vérifiés dans le flux du 03/10/2026. */
export const PARTICIPANT_SCOPES = {
  NPC: 'Hauts-de-France', 'COP PARIS NORD': 'Hauts-de-France', 'Expert COP PARIS NORD': 'Hauts-de-France',
  'Admin COP PARIS NORD': 'Hauts-de-France', 'CSO SVEA': 'Hauts-de-France',
  LOR: 'Grand Est', AL: 'Grand Est', CA: 'Grand Est', 'CSO PGE': 'Grand Est', 'Expert CSO PGE': 'Grand Est', TTMVT: 'Grand Est',
  'COP OCCITANIE': 'Occitanie', MPY: 'Occitanie', LR: 'Occitanie', 'LR,MPY': 'Occitanie',
  PCA: 'Nouvelle-Aquitaine',
  PAK: "Provence-Alpes-Côte d'Azur", 'CSO SVSA': "Provence-Alpes-Côte d'Azur", 'Admin CSO SVSA': "Provence-Alpes-Côte d'Azur",
  PDL: 'Pays de la Loire', BRE: 'Bretagne', CEN: 'Centre-Val de Loire', EUR: 'Centre-Val de Loire', NOR: 'Normandie',
  RA: 'Auvergne-Rhône-Alpes', AUV: 'Auvergne-Rhône-Alpes', RRR: 'Auvergne-Rhône-Alpes', LEX: 'Auvergne-Rhône-Alpes',
  BFC: 'Bourgogne-Franche-Comté',
  EST: 'Axe Est', NORD: 'Axe Nord', ATL: 'Axe Atlantique', 'SUD-EST': 'Axe Sud-Est', IC: 'Intercités', OUI: 'Ouigo',
  'EST,ATL,SUD-EST,NORD,IC,OUI': 'Toutes grandes lignes',
};
export const UNATTACHED = 'Non rattaché';

/** Messages d'information voyageur sans effet sur la circulation : reconnus au début du titre seulement. */
const NOISE_TITLE_RE = /^\W*(?:train complet|voitures? hors quai|ascenseur|escalator|escalier m[ée]canique|distributeur|guichet|[ée]clairage|positionnement (?:de la )?rame|placement [àa] l'avant|rame ferm[ée]e aux voyageurs|affluence|arr[êe]t d[ée]port[ée]|[ée]quipement en gare)/i;

/** Classement de la cause par mots-clés, dans cet ordre (le premier qui correspond l'emporte). */
const CAUSE_RULES = [
  ['passage-a-niveau', /passage [àa] niveau/],
  ['intemperies', /intemp[ée]ries|pr[ée]cipitations|\bcrues?\b|inondation|neige|temp[êe]te|orage|vents? violents?|chutes? d'arbres?|canicule|fortes chaleurs/],
  ['forces-ordre', /forces de l'ordre|police|gendarmerie|op[ée]ration de s[ûu]ret[ée]|colis suspect|bagage abandonn[ée]|malveillance/],
  ['malaise', /malaise|[ée]tat de sant[ée]|personne malade|secours [àa] (un|une) voyageu/],
  ['obstacle', /obstacle|personnes? (ont [ée]t[ée] )?aper[çc]ues?|pr[ée]sence de personnes|animal|heurt/],
  ['travaux', /travaux|chantier/],
  ['panne-train', /panne (de|d'un) train|mat[ée]riel|maintenance|formation du train|rame initialement|v[ée]rifications techniques|incident technique|pr[ée]paration du train/],
  ['panne-installation', /installation|signalisation|aiguillage|cat[ée]naire|d[ée]rangement|alimentation [ée]lectrique|panne [ée]lectrique/],
];

/** Catégorie de cause (RailCauseKind) d'un texte français. */
export function classifyCause(text) {
  const t = String(text ?? '').toLowerCase().replace(/[’`]/g, "'");
  for (const [kind, re] of CAUSE_RULES) if (re.test(t)) return kind;
  return 'autre';
}

/** « Cause : … » (ou « Motif : … ») du texte français, jusqu'au premier point final ou à la ligne ; null sinon. */
export function extractCause(text) {
  const m = /(?:Cause|Motif)\s*:\s*(.+?)(?:\.(?=\s|$)|\n|$)/.exec(String(text ?? '').replace(/[ \t]+/g, ' '));
  return m ? m[1].trim() : null;
}

/** Message sans effet sur la circulation (information voyageur), reconnu sur son titre ; le texte détaillé n'entre pas en compte. */
export function isNoise(title) {
  return NOISE_TITLE_RE.test(String(title ?? '').replace(/[’`]/g, "'"));
}

/** Texte français brut d'une balise : `Detail` contient du HTML échappé ; paragraphes rendus en sauts de ligne. */
function frenchRaw(block, tag) {
  const m = new RegExp(`<${tag} xml:lang="FR">([\\s\\S]*?)</${tag}>`).exec(block);
  if (!m) return '';
  return decodeEntities(decodeEntities(m[1])).replace(/<\/p>|<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ' ');
}

function frenchText(block, tag) {
  return cleanText(frenchRaw(block, tag));
}

const GENERIC_SUMMARY_RE = /^\W*plus d.infos?(?:rmations?)?\s*:?\s*$/i;

/** Première phrase d'un texte (160 caractères au plus). */
function firstSentence(text) {
  const sentence = String(text ?? '').split(/(?<=[.!?])\s/)[0]?.trim() ?? '';
  return sentence.length > 160 ? `${sentence.slice(0, 159)}…` : sentence;
}

function tagText(block, tag) {
  const m = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(block);
  return m ? m[1].trim() : null;
}

/** Instant (ms) d'une date SIRI ; sans fuseau, heure de Paris ; NaN si illisible. */
function siriTime(text) {
  const t = String(text ?? '').trim();
  if (!t) return Number.NaN;
  return Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/.test(t) ? t : (parisLocalToIso(t) ?? ''));
}

/** Texte d'une date SIRI au format ISO avec fuseau (celui de la source s'il y en a un). */
function siriIso(text) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  return /(?:Z|[+-]\d{2}:?\d{2})$/.test(t) ? t : parisLocalToIso(t);
}

/**
 * Analyse le flux SIRI SX : toutes les situations (bruit écarté), avec leurs périodes de validité, sans filtre de date.
 * @returns {{ at: string | null, entries: Array<{ situation: import('../../src/types/index.ts').RailSituation, periods: Array<{ start: string | null, end: string | null }> }> }}
 */
export function parseSiriSxEntries(xml, now = Date.now()) {
  const text = String(xml ?? '');
  if (!/<Siri[\s>]/.test(text) || !/<SituationExchangeDelivery/.test(text)) throw new SyntaxError('SIRI SX : document inattendu');
  const entries = [];
  for (const m of text.matchAll(/<PtSituationElement>([\s\S]*?)<\/PtSituationElement>/g)) {
    const block = m[1];
    const summary = frenchText(block, 'Summary');
    const description = frenchText(block, 'Description');
    const detail = frenchText(block, 'Detail');
    // « Plus d'information : » n'est qu'un renvoi : le titre est alors la première phrase du texte détaillé.
    const title = !summary || GENERIC_SUMMARY_RE.test(summary) ? firstSentence(description || detail) : summary;
    if (!title) continue;
    if (isNoise(title)) continue;
    const periods = [...block.matchAll(/<ValidityPeriod>([\s\S]*?)<\/ValidityPeriod>/g)].map((p) => ({ start: siriIso(tagText(p[1], 'StartTime')), end: siriIso(tagText(p[1], 'EndTime')) }));
    const cause = extractCause(frenchRaw(block, 'Description')) ?? extractCause(frenchRaw(block, 'Detail'));
    const participant = tagText(block, 'ParticipantRef') ?? '';
    entries.push({
      situation: {
        id: tagText(block, 'SituationNumber') ?? '',
        title,
        cause,
        causeKind: classifyCause(cause ?? `${title} ${description} ${detail}`),
        scope: Object.hasOwn(PARTICIPANT_SCOPES, participant) ? PARTICIPANT_SCOPES[participant] : UNATTACHED,
        start: '',
        end: null,
        trains: (block.match(/<AffectedVehicleJourney>/g) ?? []).length,
      },
      periods,
    });
  }
  // Sans heure de réponse dans le flux : l'heure de lecture.
  const responseMs = siriTime(tagText(text, 'ResponseTimestamp'));
  return { at: new Date(Number.isFinite(responseMs) ? responseMs : now).toISOString(), entries };
}

/**
 * Situations en vigueur à `now` : une période de validité qui contient l'instant suffit ; début absent = en vigueur
 * depuis une date inconnue (début vide), fin absente = sans fin connue. Plus récentes d'abord.
 */
export function situationsAt(entries, now) {
  const out = [];
  for (const { situation, periods } of entries) {
    let hit = null;
    if (periods.length === 0) hit = { start: null, end: null };
    for (const p of periods) {
      const startMs = p.start ? Date.parse(p.start) : Number.NEGATIVE_INFINITY;
      const endMs = p.end ? Date.parse(p.end) : Number.POSITIVE_INFINITY;
      if (startMs <= now && now <= endMs) { hit = p; break; }
    }
    if (hit) out.push({ ...situation, start: hit.start ?? '', end: hit.end });
  }
  const startOf = (x) => (x.start ? Date.parse(x.start) : Number.NEGATIVE_INFINITY);
  out.sort((a, b) => (startOf(b) === startOf(a) ? 0 : startOf(b) > startOf(a) ? 1 : -1));
  return out;
}

/**
 * Analyse le flux SIRI SX et rend les situations en vigueur à `now`, bruit écarté, plus récentes d'abord.
 * @returns {{ at: string, situations: import('../../src/types/index.ts').RailSituation[] }}
 */
export function parseSiriSx(xml, now) {
  const { at, entries } = parseSiriSxEntries(xml, now);
  return { at, situations: situationsAt(entries, now) };
}

/** Lecture du flux national (4,2 Mo), sans filtre de date : le filtre se fait à chaque réponse, sur l'heure courante. */
export async function loadRailSituationEntries(now) {
  return parseSiriSxEntries(await fetchStrictXml(SIRI_SX_URL, { timeoutMs: 30_000 }), now);
}
