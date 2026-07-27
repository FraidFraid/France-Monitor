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

/** Vocabulaire incendie : porte d'entrée de l'extraction. */
const FIRE_LEXICON =
  /\b(incendies?|feux?\s+de\s+for[êe]t|feux?\s+de\s+v[ée]g[ée]tation|sinistr[ée]s?|br[ûu]l[ée]s?|flammes?|hectares?\s+br[ûu]l)/i;

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
 * Normalise « 42 000 », « 42.000 », « 42 000 » (insécable) → 42000.
 * @param {string} raw
 * @returns {number|null}
 */
function parseFrenchNumber(raw) {
  const cleaned = raw.replace(/[\s .]/g, '');
  if (!/^\d+$/.test(cleaned)) return null;
  const value = Number.parseInt(cleaned, 10);
  return Number.isSafeInteger(value) ? value : null;
}

/** Phrase englobant l'index donné, pour la citation verbatim. */
function sentenceAt(text, index) {
  const start = Math.max(0, text.lastIndexOf('.', index - 1) + 1);
  const dot = text.indexOf('.', index);
  const end = dot === -1 ? text.length : dot + 1;
  return text.slice(start, end).trim();
}

/**
 * Motifs chiffrés. `unit` null = compte de personnes/objets.
 * @type {Array<{kind: string, re: RegExp, unit: string|null}>}
 */
const NUMERIC_PATTERNS = [
  { kind: 'area_ha', unit: 'ha', re: /([\d\s .]+?)\s*(?:hectares?|ha)\b/gi },
  { kind: 'evacuated', unit: null, re: /([\d\s .]+?)\s*(?:personnes?|habitants?|r[ée]sidents?)\b[^.]{0,60}?(?:[ée]vacu|d[ée]plac)/gi },
  { kind: 'dwellings_destroyed', unit: null, re: /([\d\s .]+?)\s*(?:maisons?|habitations?|logements?|b[âa]timents?)\b/gi },
  { kind: 'injured', unit: null, re: /([\d\s .]+?)\s*(?:sapeurs?-pompiers?|pompiers?|personnes?)\s+bless[ée]s?\b/gi },
  { kind: 'road_closed', unit: 'km', re: /(?:coup[ée]e?|ferm[ée]e?|neutralis[ée]e?)\s+sur\s+([\d\s .]+?)\s*km\b/gi },
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
  // Pas de garde `mentionsFire` ici : un communiqué préfectoral (ordre
  // d'évacuation via FR-Alert) ou une brève sur une coupure routière liée
  // à l'incendie ne réemploient pas forcément le vocabulaire incendie dans
  // la même phrase. La sûreté vient des motifs eux-mêmes (étroits) + des
  // bornes de vraisemblance + de l'exigence de provenance complète.
  // `mentionsFire`/`FIRE_LEXICON` restent exportés pour le tri amont (cron).

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
