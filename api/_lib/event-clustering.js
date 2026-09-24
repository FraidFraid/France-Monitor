// api/_lib/event-clustering.js — regroupement d'articles en événements (fonctions pures).
//
// Un « événement » réunit les articles qui rapportent le même fait. Le rapprochement est
// lexical (titres normalisés) et borné dans le temps ; la géographie ne sert que de pénalité,
// car le géocodage des articles nationaux est approximatif. Calibré le 23/09/2026 sur 1 000
// articles réels de 24 h : seuil 0,50 → 791 événements, dont 57 couverts par plusieurs flux.
// Entre 0,35 et 0,50 la paire est « ambiguë » : laissée séparée par prudence, et seulement
// comptée (stats du cron) pour mesurer si un arbitrage payant vaudrait le coût.

export const MATCH_THRESHOLD = 0.5;
export const AMBIGUOUS_THRESHOLD = 0.35;
export const WINDOW_BEFORE_MS = 72 * 60 * 60 * 1000;
export const WINDOW_AFTER_MS = 6 * 60 * 60 * 1000;
const FAR_KM = 200;
const FAR_PENALTY = 0.8;
const MAX_MEMBERS_COMPARED = 20;

const STOPWORDS = new Set(`a ai au aux avec ce ces cet cette comme dans de des du elle elles en entre est et etre eux il ils je la le les leur leurs lui mais me meme mes moi mon ne nos notre nous on ou par pas pour qu que qui sa sans se ses si son sont sur ta te tes toi ton tu un une vos votre vous y apres avant contre depuis deja encore fait faire font lors moins plus peu tres tout tous toute toutes selon sous vers voici voila bien aussi alors ainsi car donc dont quand quel quelle quels quelles cela celle celui ceux ici ont sera seront etait etaient avoir avait deux trois cest quil nest ete fois jour jours hier demain aujourd hui annee ans`.split(/\s+/));

// Rubriques que la PQR place en tête de titre (« Décryptage. », « Vidéo. ») : sans valeur pour le rapprochement.
const SECTION_WORDS = new Set(['decryptage', 'temoignages', 'temoignage', 'video', 'videos', 'direct', 'info', 'infos', 'exclusif', 'enquete', 'portrait', 'entretien', 'analyse', 'podcast', 'live', 'photos', 'carte', 'chronique', 'tribune', 'edito', 'interview', 'reportage', 'recit', 'faits', 'divers', 'breve', 'alerte', 'urgent', 'exclu', 'infographie', 'quiz', 'question']);

/**
 * Caractère d'une entité numérique. Hors plage (0, demi-substituts, > U+10FFFF) → U+FFFD :
 * fromCodePoint lèverait (et bloquerait toute la passe du cron), et Postgres refuse le NUL.
 */
function safeCodePoint(code) {
  if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '�';
  return String.fromCodePoint(code);
}

/** Décode les entités HTML vues dans les flux (&#039;, &#xE9;, &quot;…) et unifie les apostrophes. */
export function decodeEntities(input) {
  return String(input ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(Number(dec)))
    .replace(/&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/[’‘`´]/g, "'");
}

/** Titre de gabarit non rendu (constaté chez EBRA : « Vidéo. $content.TitleNoTags ») : à ignorer. */
export function isUnrenderedTemplate(title) {
  return /\$[a-z]+\.[A-Za-z]+/.test(String(title ?? ''));
}

function fold(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function stem(word) {
  return word.length > 4 && /[sx]$/.test(word) ? word.slice(0, -1) : word;
}

/** Mots significatifs du titre, repliés (minuscules, sans accents, pluriel simple retiré). */
export function titleTokens(title) {
  const words = fold(decodeEntities(title)).replace(/[^a-z0-9]+/g, ' ').split(' ');
  const out = new Set();
  for (const word of words) {
    if (!word) continue;
    if (/^\d+$/.test(word)) {
      if (word.length >= 2) out.add(word);
      continue;
    }
    if (word.length < 3 || STOPWORDS.has(word) || SECTION_WORDS.has(word)) continue;
    out.add(stem(word));
  }
  return out;
}

/** Noms propres et nombres du titre : ils distinguent deux faits survenus au même endroit. */
export function entityTokens(title) {
  const out = new Set();
  for (const match of decodeEntities(title).matchAll(/\b([A-ZÀ-ÖØ-Þ][\p{L}'-]{2,}|\d{2,})\b/gu)) {
    const word = stem(fold(match[1]).replace(/'.*$/, ''));
    if (word.length >= 2 && !STOPWORDS.has(word) && !SECTION_WORDS.has(word)) out.add(word);
  }
  return out;
}

/** @param {string} title */
export function fingerprint(title) {
  return { tokens: titleTokens(title), entities: entityTokens(title) };
}

function overlap(a, b) {
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  return shared;
}

/**
 * Similarité 0..1 entre deux empreintes : moitié Jaccard, moitié inclusion (titres de longueurs
 * différentes), puis 30 % d'accord sur les noms propres quand les deux titres en ont.
 */
export function titleSimilarity(a, b) {
  if (a.tokens.size === 0 || b.tokens.size === 0) return 0;
  const shared = overlap(a.tokens, b.tokens);
  const jaccard = shared / (a.tokens.size + b.tokens.size - shared);
  const containment = shared / Math.min(a.tokens.size, b.tokens.size);
  const lexical = 0.5 * jaccard + 0.5 * containment;
  if (a.entities.size === 0 || b.entities.size === 0) return lexical;
  const sharedEntities = overlap(a.entities, b.entities);
  return 0.7 * lexical + 0.3 * (sharedEntities / (a.entities.size + b.entities.size - sharedEntities));
}

function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

function hasCoords(x) {
  return typeof x.lat === 'number' && typeof x.lon === 'number';
}

/**
 * @typedef {{ id: number, title: string, publishedAt: number, lat: number | null, lon: number | null }} ArticleIn
 * @typedef {{ articleId: number, eventId: number, title: string, publishedAt: number, lat: number | null, lon: number | null }} MemberIn
 * @typedef {{ articleId: number, target: { eventId: number } | { seedArticleId: number }, score: number }} Attach
 * @typedef {{ articleId: number, candidate: { eventId: number } | { seedArticleId: number }, score: number }} Ambiguous
 */

/**
 * Décide, pour chaque nouvel article, s'il rejoint un événement existant, un événement créé
 * dans le même lot, ou s'il en ouvre un nouveau (dont il devient l'article « graine »).
 * Les articles sont traités du plus ancien au plus récent ; pur et déterministe.
 * @param {ArticleIn[]} articles  nouveaux articles à rattacher
 * @param {MemberIn[]} members    articles déjà rattachés (fenêtre récente)
 * @returns {{ seeds: number[], attaches: Attach[], ambiguous: Ambiguous[], skipped: number[] }}
 */
export function planEventAssignments(articles, members) {
  /** @type {Map<string, Array<{ title: string, fp: ReturnType<typeof fingerprint>, publishedAt: number, lat: number | null, lon: number | null }>>} */
  const groups = new Map();
  const keyOf = (target) => ('eventId' in target ? `e${target.eventId}` : `s${target.seedArticleId}`);
  const targets = new Map();
  for (const m of [...members].sort((a, b) => a.publishedAt - b.publishedAt)) {
    const target = { eventId: m.eventId };
    const key = keyOf(target);
    if (!groups.has(key)) { groups.set(key, []); targets.set(key, target); }
    groups.get(key).push({ title: m.title, fp: fingerprint(m.title), publishedAt: m.publishedAt, lat: m.lat, lon: m.lon });
  }

  const seeds = [];
  const attaches = [];
  const ambiguous = [];
  const skipped = [];
  for (const article of [...articles].sort((a, b) => a.publishedAt - b.publishedAt || a.id - b.id)) {
    if (isUnrenderedTemplate(article.title)) { skipped.push(article.id); continue; }
    const fp = fingerprint(article.title);
    if (fp.tokens.size === 0) { skipped.push(article.id); continue; }
    let bestKey = null;
    let bestScore = 0;
    for (const [key, list] of groups) {
      for (const member of list.slice(-MAX_MEMBERS_COMPARED)) {
        if (member.publishedAt < article.publishedAt - WINDOW_BEFORE_MS) continue;
        if (member.publishedAt > article.publishedAt + WINDOW_AFTER_MS) continue;
        let score = titleSimilarity(fp, member.fp);
        if (hasCoords(article) && hasCoords(member) && distanceKm(article, member) > FAR_KM) score *= FAR_PENALTY;
        if (score > bestScore) { bestScore = score; bestKey = key; }
      }
    }
    const entry = { title: article.title, fp, publishedAt: article.publishedAt, lat: article.lat, lon: article.lon };
    if (bestKey && bestScore >= MATCH_THRESHOLD) {
      attaches.push({ articleId: article.id, target: targets.get(bestKey), score: Number(bestScore.toFixed(3)) });
      groups.get(bestKey).push(entry);
      continue;
    }
    if (bestKey && bestScore >= AMBIGUOUS_THRESHOLD) {
      ambiguous.push({ articleId: article.id, candidate: targets.get(bestKey), score: Number(bestScore.toFixed(3)) });
    }
    const target = { seedArticleId: article.id };
    const key = keyOf(target);
    seeds.push(article.id);
    groups.set(key, [entry]);
    targets.set(key, target);
  }
  return { seeds, attaches, ambiguous, skipped };
}
