// api/_lib/siri-sx.js : situations ferroviaires SNCF au format SIRI SX Lite (point d'accès national, sans clé,
// licence ODbL ; spec 2026-10-03 panneaux trafic § 2.4). Le flux ne publie que les situations actives ; aucune
// cause structurée (`Severity` toujours « slight », `Route` vide) : la cause est lue dans le texte français
// (« Cause : … »), classée par mots-clés ; le rattachement à un axe ou une région vient de `ParticipantRef`
// (table relevée le 03/10/2026, « Non rattaché » sinon). Les messages d'information voyageur sans effet sur
// la circulation (ascenseur, train complet, arrêt déporté, voitures hors quai…) sont écartés.
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

const NOISE_RE = /train complet|voitures? hors quai|ascenseur|escalator|escalier m[ée]canique|distributeur|guichet|[ée]clairage|positionnement (de la )?rame|placement [àa] l'avant|rame ferm[ée]e aux voyageurs|affluence|arr[êe]t d[ée]port[ée]|[ée]quipement en gare/i;

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

/** Message sans effet sur la circulation (information voyageur). */
export function isNoise(summary, description) {
  return NOISE_RE.test(`${summary} ${description}`.replace(/[’`]/g, "'"));
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

/**
 * Analyse le flux SIRI SX et rend les situations en vigueur à `now`, bruit écarté, plus récentes d'abord.
 * @returns {{ at: string | null, situations: import('../../src/types/index.ts').RailSituation[] }}
 */
export function parseSiriSx(xml, now) {
  const text = String(xml ?? '');
  if (!/<Siri[\s>]/.test(text) || !/<SituationExchangeDelivery/.test(text)) throw new SyntaxError('SIRI SX : document inattendu');
  const situations = [];
  for (const m of text.matchAll(/<PtSituationElement>([\s\S]*?)<\/PtSituationElement>/g)) {
    const block = m[1];
    const summary = frenchText(block, 'Summary');
    const description = frenchText(block, 'Description');
    const detail = frenchText(block, 'Detail');
    // « Plus d'information : » n'est qu'un renvoi : le titre est alors la première phrase du texte détaillé.
    const title = !summary || GENERIC_SUMMARY_RE.test(summary) ? firstSentence(description || detail) : summary;
    if (!title) continue;
    if (isNoise(title, description)) continue;
    const start = tagText(block, 'StartTime');
    const end = tagText(block, 'EndTime');
    const startMs = Date.parse(start ?? '');
    const endMs = end ? Date.parse(end) : Number.NaN;
    if (!Number.isFinite(startMs) || startMs > now || (Number.isFinite(endMs) && endMs < now)) continue;
    const cause = extractCause(frenchRaw(block, 'Description')) ?? extractCause(frenchRaw(block, 'Detail'));
    const participant = tagText(block, 'ParticipantRef') ?? '';
    situations.push({
      id: tagText(block, 'SituationNumber') ?? '',
      title,
      cause,
      causeKind: classifyCause(cause ?? `${title} ${description} ${detail}`),
      scope: Object.hasOwn(PARTICIPANT_SCOPES, participant) ? PARTICIPANT_SCOPES[participant] : UNATTACHED,
      start: start ?? '',
      end,
      trains: (block.match(/<AffectedVehicleJourney>/g) ?? []).length,
    });
  }
  situations.sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
  return { at: tagText(text, 'ResponseTimestamp'), situations };
}

/** Lecture du flux national (4,2 Mo). */
export async function loadRailSituations(now) {
  return parseSiriSx(await fetchStrictXml(SIRI_SX_URL, { timeoutMs: 30_000 }), now);
}
