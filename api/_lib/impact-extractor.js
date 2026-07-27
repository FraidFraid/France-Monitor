/**
 * api/_lib/impact-extractor.js — Extraction déterministe des faits d'impact
 * incendie depuis du texte de presse ou de communiqué préfectoral.
 *
 * Fonctions PURES, aucune I/O : tout est testable sans réseau ni base.
 * Voir docs/design-alertes-grands-feux-2026-07.md §3, §12.
 *
 * Principe : on préfère ne rien extraire plutôt qu'extraire un fait douteux.
 * Un blanc honnête vaut mieux qu'un chiffre plausible (§7).
 */

/**
 * Vocabulaire incendie : porte d'entrée de l'extraction.
 * Inclut une formulation journalistique usuelle qui ne contient pas le mot
 * « incendie » lui-même : « le feu a parcouru X ha ».
 *
 * N'inclut PLUS « hectares…détruits » (round 2, Finding 6) : structurellement
 * dangereux, cet indice est mot pour mot ce que consomme le motif area_ha,
 * sans second signal distinguant « détruit par le feu » d'une autre cause
 * (grêle, inondation, tempête, gel) — vérifié en revue sur 4 phrases réelles
 * hors sujet qui produisaient toutes un area_ha fabriqué.
 */
const FIRE_LEXICON =
  /\b(incendies?|feux?\s+de\s+for[êe]t|feux?\s+de\s+v[ée]g[ée]tation|feux?\s+(?:a|ont)\s+parcouru|sinistr[ée]s?|br[ûu]l[ée]s?|flammes?|hectares?\s+br[ûu]l)/i;

/** Domaines officiels = source primaire (l'acteur lui-même). */
const OFFICIAL_HOST = /(^|\.)gouv\.fr$|(^|\.)sdis\d*\.fr$|(^|\.)prefectures-regions\.gouv\.fr$/i;

/** Consolidations tertiaires. */
const TERTIARY_HOST = /(^|\.)wikipedia\.org$|(^|\.)wikimedia\.org$/i;

/** Formulations approximatives : le chiffre reste exploitable mais signalé. */
const HEDGE = /\b(pr[èe]s\s+de|environ|quelque|plus\s+de|au\s+moins|autour\s+de|une\s+(?:cinquantaine|centaine|dizaine|vingtaine))\b/i;

/** Bornes de vraisemblance — au-delà, on suppose une erreur de lecture. */
const PLAUSIBLE = {
  area_ha: 1_000_000,
  evacuated: 5_000_000,
  dwellings_destroyed: 100_000,
  injured: 10_000,
  road_closed: 2_000,
};

/**
 * @param {string} text
 * @returns {boolean}
 */
export function mentionsFire(text) {
  return typeof text === 'string' && FIRE_LEXICON.test(text);
}

/** @param {string} sourceUrl @returns {string|null} */
function hostOf(sourceUrl) {
  try {
    return new URL(sourceUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Niveau de source, indépendant de sa fiabilité (§12.2).
 * @param {string} sourceUrl
 * @returns {'primary'|'secondary'|'tertiary'}
 */
export function deriveSourceLevel(sourceUrl) {
  const host = hostOf(sourceUrl);
  if (!host) return 'secondary';
  if (OFFICIAL_HOST.test(host)) return 'primary';
  if (TERTIARY_HOST.test(host)) return 'tertiary';
  return 'secondary';
}

/**
 * Fiabilité de la source, dérivée du domaine puis du tier de feeds.ts (§12.1).
 * A = officiel primaire, B/C/D = presse par tier, E = inconnu.
 * @param {string} sourceUrl
 * @param {number|null} tier
 * @returns {'A'|'B'|'C'|'D'|'E'}
 */
export function deriveReliability(sourceUrl, tier) {
  if (deriveSourceLevel(sourceUrl) === 'primary') return 'A';
  if (tier === 1) return 'B';
  if (tier === 2) return 'C';
  if (tier === 3) return 'D';
  return 'E';
}

/**
 * Un séparateur de milliers français va toujours par groupes de 3 chiffres
 * (« 42.000 », jamais « 42.00 » ni « 42.5 »). Un point suivi d'1 ou 2
 * chiffres en fin de nombre trahit donc une décimale, pas un millier — on
 * refuse plutôt que de la lire comme telle (ex. « 42.5 » lu à tort 425,
 * un facteur 10 sur une surface : incident relevé en revue).
 */
const AMBIGUOUS_DECIMAL_TAIL = /\.\d{1,2}$/;

/**
 * Normalise « 42 000 », « 42.000 », « 42 000 » (insécable) → 42000.
 * @param {string} raw
 * @returns {number|null}
 */
function parseFrenchNumber(raw) {
  const trimmed = raw.trim();
  if (AMBIGUOUS_DECIMAL_TAIL.test(trimmed)) return null;
  const cleaned = trimmed.replace(/[\s .]/g, '');
  if (!/^\d+$/.test(cleaned)) return null;
  const value = Number.parseInt(cleaned, 10);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Un « . » collé entre deux chiffres est un séparateur de milliers, pas une
 * fin de phrase (« 42.000 » ne doit pas couper la citation en deux).
 */
function isThousandsSeparatorDot(text, i) {
  return text[i] === '.' && /\d/.test(text[i - 1] ?? '') && /\d/.test(text[i + 1] ?? '');
}

/**
 * Phrase englobant l'index donné, pour la citation verbatim. La citation EST
 * la preuve de provenance (§7) : elle ne doit jamais être amputée en plein
 * milieu d'un nombre à cause d'un point qui n'est en réalité qu'un
 * séparateur de milliers.
 */
function sentenceAt(text, index) {
  let start = 0;
  for (let i = index - 1; i >= 0; i--) {
    if (text[i] === '.' && !isThousandsSeparatorDot(text, i)) { start = i + 1; break; }
  }
  let end = text.length;
  for (let i = index; i < text.length; i++) {
    if (text[i] === '.' && !isThousandsSeparatorDot(text, i)) { end = i + 1; break; }
  }
  return text.slice(start, end).trim();
}

/**
 * Motifs chiffrés. `unit` null = compte de personnes/objets.
 * @type {Array<{kind: string, re: RegExp, unit: string|null}>}
 */
// Grammaire d'un nombre français : soit un groupement strict par milliers
// (1 à 3 chiffres puis AU MOINS un SÉPARATEUR+3 chiffres — espace, insécable
// ou point), soit un simple run de chiffres continu de longueur quelconque.
// Jamais de mélange tronqué des deux : round 1 utilisait `\d{1,3}(?:[…]\d{3})*`
// (le `*` au lieu du `+`, sans alternative « run continu »), ce qui laissait
// le moteur regex démarrer le match n'importe où dans un nombre non séparé
// et n'en capturer qu'un préfixe/suffixe de 1 à 3 chiffres — "1200" lu 200,
// "123456" lu 456 (round 2, Finding 5). `(?<!\d)`/`(?!\d)` interdisent de
// démarrer ou de s'arrêter au milieu d'un run de chiffres plus long : soit
// tout le nombre est capturé, soit rien ne l'est — jamais un fragment.
// Volontairement sans `.*` ni classe autorisant les lettres dans la partie
// groupée : un « . » non suivi de 3 chiffres n'est jamais consommé, donc le
// motif ne peut pas enjamber une fin de phrase pour aller chercher un nombre
// de la phrase suivante (cf. « Le score final était 42. Hectares … »). La
// queue optionnelle `(?:\.\d{1,2})?` capte quand même une pseudo-décimale
// ambiguë (« 42.5 ») entière plutôt que de la couper au milieu — c'est
// `parseFrenchNumber` qui la rejette explicitement ensuite.
// Définie comme un littéral regex (pas une chaîne) puis `.source` : ça évite
// tout risque de double-échappement lors de l'interpolation dans les motifs
// composites ci-dessous (piège déjà rencontré au round 1 avec `\d`/`\s`/`\b`
// silencieusement avalés par le décodage d'échappement des template literals).
const FRENCH_NUMBER = /(?<!\d)(?:\d{1,3}(?:[\s.]\d{3})+|\d+)(?:\.\d{1,2})?(?!\d)/.source;

const NUMERIC_PATTERNS = [
  { kind: 'area_ha', unit: 'ha', re: new RegExp(`(${FRENCH_NUMBER})\\s*(?:hectares?|ha)\\b`, 'gi') },
  // Pas de `\b` avant `[ée]vacu`/`d[ée]plac` : en JS, `\b` ne traite pas les
  // lettres accentuées comme des caractères de mot (\w = [A-Za-z0-9_] only),
  // donc `\b` ne matche jamais entre un espace et un « é ». Un `\b` placé là
  // empêcherait silencieusement tout match sur « … à évacuer ».
  { kind: 'evacuated', unit: null, re: new RegExp(`(${FRENCH_NUMBER})\\s*(?:personnes?|habitants?|r[ée]sidents?)\\b[^.]{0,60}?(?:[ée]vacu|d[ée]plac)`, 'gi') },
  { kind: 'dwellings_destroyed', unit: null, re: new RegExp(`(${FRENCH_NUMBER})\\s*(?:maisons?|habitations?|logements?|b[âa]timents?)\\b`, 'gi') },
  { kind: 'injured', unit: null, re: new RegExp(`(${FRENCH_NUMBER})\\s*(?:sapeurs?-pompiers?|pompiers?|personnes?)\\s+bless[ée]s?\\b`, 'gi') },
  { kind: 'road_closed', unit: 'km', re: new RegExp(`(?:coup[ée]e?|ferm[ée]e?|neutralis[ée]e?)\\s+sur\\s+(${FRENCH_NUMBER})\\s*km\\b`, 'gi') },
];

/** Motifs qualitatifs : un fait sans chiffre reste un fait (§3.4). */
const QUALITATIVE_PATTERNS = [
  { kind: 'evacuation_order', re: /\b(?:FR-Alert|ordre\s+d['’]?[ée]vacuation|ordonner\s+l['’]?[ée]vacuation|[ée]vacuation\s+(?:imm[ée]diate|pr[ée]ventive))\b/i },
  { kind: 'rail_disrupted', re: /\b(?:circulation\s+(?:ferroviaire|des\s+trains)\s+(?:interrompue|suspendue)|trafic\s+(?:TER|TGV)\s+(?:interrompu|suspendu))\b/i },
];

/**
 * Extrait les faits d'impact d'un texte. Retourne [] plutôt qu'un fait douteux.
 * @param {{text: string, sourceUrl: string, sourceName: string, tier: number|null, observedAt: string}} input
 * @returns {Array<object>}
 */
export function extractImpactFacts(input) {
  const { text, sourceUrl, sourceName, tier, observedAt } = input ?? {};
  // Provenance incomplète → aucun fait affichable (§3.3). On rejette, on ne dégrade pas.
  if (!text || !sourceUrl || !sourceName || !observedAt) return [];
  // Porte d'entrée : sans vocabulaire incendie, on ne tente même pas
  // l'extraction — un motif numérique/qualitatif isolé (« 42 personnes
  // blessées », « coupée sur 70 km ») matche tout autant un fait divers
  // routier ou un article sportif qu'un incendie. FIRE_LEXICON a été élargi
  // (cf. plus haut) pour couvrir les formulations réelles de presse qui ne
  // disent jamais littéralement « incendie » dans la même phrase.
  if (!mentionsFire(text)) return [];

  const sourceLevel = deriveSourceLevel(sourceUrl);
  const reliability = deriveReliability(sourceUrl, tier ?? null);
  /** @type {Array<object>} */
  const facts = [];
  const seen = new Set();

  const push = (kind, value, unit, quote) => {
    const key = `${kind}|${value}`;
    if (seen.has(key)) return;
    seen.add(key);
    facts.push({
      kind, value, unit, quote,
      sourceUrl, sourceName, sourceLevel, reliability,
      hedged: HEDGE.test(quote),
      observedAt,
    });
  };

  for (const { kind, re, unit } of NUMERIC_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const value = parseFrenchNumber(m[1]);
      if (value === null || value <= 0) continue;
      if (value > PLAUSIBLE[kind]) continue; // garde-fou anti-faux positif
      push(kind, value, unit, sentenceAt(text, m.index));
    }
  }

  for (const { kind, re } of QUALITATIVE_PATTERNS) {
    const m = re.exec(text);
    if (m) push(kind, null, null, sentenceAt(text, m.index));
  }

  return facts;
}

export { FIRE_LEXICON };
