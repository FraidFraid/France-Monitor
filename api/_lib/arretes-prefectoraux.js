// api/_lib/arretes-prefectoraux.js : arrêtés préfectoraux liés aux rassemblements, lus dans les recueils des actes administratifs
// (RAA) des préfectures dont le site est ouvert (vérifié le 19/10/2026 : Loiret, Gironde ; la préfecture de police de Paris filtre
// les robots, jamais contournée). Un arrêté compte s'il autorise des drones « pour la sécurité des rassemblements », interdit ou
// encadre une manifestation (périmètre, armes, polices municipales) : il dit qu'une préfecture attend du monde, quand et où.
// Parties pures (analyse du texte et des pages) : le relevé lui-même est fait par scripts/build-arretes.mjs, hors des requêtes.

/** Préfectures suivies : site et page d'entrée des recueils. */
export const PREFECTURES = Object.freeze([
  { dept: '45', label: 'Loiret', site: 'https://www.loiret.gouv.fr', root: '/Publications/Recueil-des-actes-administratifs/Recueil-des-actes-administratifs-departementaux' },
  { dept: '33', label: 'Gironde', site: 'https://www.gironde.gouv.fr', root: '/Publications/Recueil-des-Actes-Administratifs' },
]);

const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
// Mois accentués, tels qu'écrits dans les arrêtés (avant repliement).
const MONTHS_FR = 'janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre';
const DAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

export const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ');

const decodeEntities = (s) => String(s).replace(/&amp;/g, '&').replace(/&#039;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');

/** Liens d'une page HTML : `{ href, text }` (adresse absolue sur le site, texte sans balises). */
export function pageLinks(html, site) {
  const out = [];
  for (const m of String(html).matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const raw = decodeEntities(m[1]).trim();
    if (!raw || raw.startsWith('#') || /^(?:mailto|javascript):/i.test(raw)) continue;
    let href;
    try { href = new URL(raw, site).toString(); } catch { continue; }
    if (!href.startsWith(site)) continue;
    out.push({ href, text: decodeEntities(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() });
  }
  return out;
}

/** Liens de téléchargement de recueils (PDF du site), dans l'ordre de la page (le plus récent d'abord sur ces sites). */
export function recueilLinks(html, site) {
  const seen = new Set();
  return pageLinks(html, site).filter((l) => /\/contenu\/telechargement\//.test(l.href) && /\.pdf(?:$|\?)/i.test(l.href)
    && !seen.has(l.href) && seen.add(l.href));
}

/**
 * Pages à suivre vers les recueils du mois : lien dont le texte nomme le mois et l'année (« Octobre 2026 »), sinon celui de
 * l'année (« Recueil des actes administratifs de l'année 2026 », « Recueil des actes administratifs départementaux »).
 */
export function nextPages(html, site, now = Date.now()) {
  const d = new Date(now);
  const months = [0, 1].map((back) => {
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1));
    return { month: MONTHS[t.getUTCMonth()], year: String(t.getUTCFullYear()) };
  });
  const links = pageLinks(html, site);
  const byMonth = months.flatMap(({ month, year }) => links.filter((l) => {
    const t = fold(l.text);
    return t.includes(month) && t.includes(year);
  }));
  if (byMonth.length > 0) return [...new Set(byMonth.map((l) => l.href))];
  const year = months[0].year;
  const byYear = links.filter((l) => { const t = fold(l.text); return t.includes(year) && /recueil|actes|raa/.test(t); });
  if (byYear.length > 0) return [byYear[0].href];
  const dept = links.filter((l) => /recueil.*departementaux|actes administratifs departementaux/.test(fold(l.text)));
  return dept.length > 0 ? [dept[0].href] : [];
}

// ─── Analyse d'un recueil ───

const ACT_ID = /\b(\d{2,3}-\d{4}-\d{2}-\d{2}-\d{5})\b/;

/** Pages d'un recueil regroupées par arrêté (identifiant « 45-2026-10-14-00001 » du pied de page, sinon de l'en-tête) ; sommaire écarté. */
export function splitActs(pages) {
  const acts = new Map();
  for (const page of pages) {
    const p = String(page);
    if (/\bsommaire\b/i.test(p.slice(0, 200))) continue;
    const id = ACT_ID.exec(p.slice(-400))?.[1] ?? ACT_ID.exec(p.slice(0, 400))?.[1];
    if (!id) continue;
    acts.set(id, `${acts.get(id) ?? ''}\n${page}`);
  }
  return [...acts.entries()].map(([id, text]) => ({ id, text }));
}

// Arrêtés pertinents : drones pour la sécurité des rassemblements, interdiction ou encadrement d'une manifestation.
const DRONE = /captation[\s\S]{0,80}aeronef|cameras installees sur (?:des|un) aeronefs?/;
const PROTEST = /\bmanifestations?\b(?! sportives?\b)(?![\s\S]{0,40}vehicules terrestres)|\brassemblements?\b(?! festifs?)|\bmobilisations?\b|\bcortege|\bmouvement (?:lyceen|etudiant|social)/;
const BAN = /portant interdiction[\s\S]{0,60}(?:manifestation|rassemblement|cortege)|interdi(?:t|sant|ction)[\s\S]{0,40}(?:de manifester|toute manifestation|tout rassemblement|les manifestations|les rassemblements)/;
const FESTIF = /\brassemblements? festifs?\b|\bteknival|\brave(?:-party| party)?\b|\bfree party\b/;
const SPORT = /manifestation sportive|vehicules terrestres a moteur|epreuve sportive/;

/** Nature d'un arrêté : 'drone', 'interdiction', 'mesures' (périmètre, armes, polices municipales…) ou null s'il ne concerne pas un rassemblement. */
export function actKind(text) {
  const t = fold(text);
  // Rassemblement festif (teknival) ou épreuve sportive : pas une manifestation, sauf si le texte parle aussi de manifestants.
  if ((FESTIF.test(t) || SPORT.test(t)) && !/\bmanifestants?\b|\bmobilisation/.test(t)) return null;
  if (!PROTEST.test(t)) return null;
  if (DRONE.test(t)) return 'drone';
  if (BAN.test(t)) return 'interdiction';
  if (/interdiction (?:temporaire )?de port|perimetre|mise en commun des moyens des polices municipales|interdiction de (?:vente|transport)/.test(t)) return 'mesures';
  return null;
}

/**
 * Texte des articles (« Article 1er » jusqu'à la signature « Fait à … le … »), où se trouvent dates, heures et lieux autorisés ;
 * l'annexe (périmètres) est gardée : elle redit souvent les jours et les heures. Tout le texte sinon.
 */
const articles = (text) => {
  const t = String(text).replace(/\s+/g, ' ');
  const f = fold(t);
  const i = f.search(/\barticle (?:1(?:er)?|premier)\b/);
  if (i < 0) return t;
  const sign = f.slice(i).search(/\bfait a [a-z' -]+, le\b/);
  const annex = f.search(/\bannexe\b/);
  return sign < 0 ? t.slice(i) : `${t.slice(i, i + sign)} ${annex > i + sign ? t.slice(annex) : ''}`;
};

/** Jours (« AAAA-MM-JJ ») nommés dans le texte : « jeudi 15 octobre 2026 », « les 15 et 16 octobre 2026 », « 1er octobre ». */
export function actDays(text, year) {
  const t = fold(text).replace(/\s+/g, ' ');
  const out = new Set();
  const re = new RegExp(`\\b(1er|\\d{1,2})((?:\\s*(?:,|et|au)\\s*(?:(?:${DAYS.join('|')})\\s+)?(?:1er|\\d{1,2}))*)\\s+(${MONTHS.join('|')})(?:\\s+(\\d{4}))?`, 'g');
  for (const m of t.matchAll(re)) {
    const month = MONTHS.indexOf(m[3]) + 1;
    const y = m[4] ? Number(m[4]) : year;
    const days = [m[1], ...(m[2].match(/1er|\d{1,2}/g) ?? [])].map((x) => (x === '1er' ? 1 : Number(x))).filter((d) => d >= 1 && d <= 31);
    // « du 10 au 12 octobre » : tous les jours de l'intervalle.
    if (/\bau\b/.test(m[2]) && days.length === 2 && days[1] > days[0] && days[1] - days[0] <= 7) {
      for (let d = days[0]; d <= days[1]; d += 1) out.add(`${y}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
      continue;
    }
    for (const d of days) out.add(`${y}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  return [...out].sort();
}

/** Plage horaire autorisée : « de 07h00 à 18h00 », « de 8h à 20h » → ['07:00', '18:00'] ; null sinon. */
export function actHours(text) {
  const m = /\bde (\d{1,2}) ?h ?(\d{2})? ?(?:a|jusqu'a) (\d{1,2}) ?h ?(\d{2})?\b/.exec(fold(text));
  if (!m || Number(m[1]) > 23 || Number(m[3]) > 24) return null;
  const hm = (h, mi) => `${String(Number(h)).padStart(2, '0')}:${String(Number(mi ?? 0)).padStart(2, '0')}`;
  return [hm(m[1], m[2]), hm(m[3], m[4])];
}

/**
 * Communes nommées dans les articles : « commune d'Orléans », « communes de Ingré, La Chapelle-Saint-Mesmin et Ormes »,
 * « à Paris le ». Noms tels qu'écrits (majuscule initiale), sans doublon ; la vérification contre le référentiel est faite ensuite.
 */
export function actCommunes(text) {
  const t = articles(text).replace(/\s+/g, ' ');
  const out = new Set();
  const NAME = "[A-ZÉÈÀÂÎÔÛ][\\wÀ-ÿ'’-]+(?:[ -](?:sur|sous|en|de|du|des|la|le|les|lès|lez|Saint|Sainte|[A-ZÉÈÀÂÎÔÛ][\\wÀ-ÿ'’-]+))*";
  for (const m of t.matchAll(new RegExp(`\\bcommunes? (?:de |d['’]|du )((?:${NAME})(?:\\s*(?:,|et)\\s*(?:${NAME}))*)`, 'g'))) {
    for (const n of m[1].split(/\s*(?:,|\bet\b)\s*/)) if (n.trim().length >= 2) out.add(n.trim());
  }
  for (const m of t.matchAll(new RegExp(`\\b(?:autoris[ée]e?s? |interdite?s? |lieu )?à (${NAME}) (?:le|les|du|au|entre|de)\\b`, 'g'))) out.add(m[1]);
  return [...out];
}

/**
 * Rendez-vous nommé, s'il y en a un : la phrase qui cite la manifestation (« manifestation lycéenne organisée devant le lycée
 * Maurice Genevoix à Ingré le mardi 13 octobre 2026 de 8h00 à 18h00 »), 220 caractères au plus.
 */
export function actExcerpt(text) {
  const t = String(text).replace(/\s+/g, ' ');
  const f = fold(t);
  const i = f.search(/\b(?:manifestations?|mobilisations?|rassemblements?|cortege)\b[^.;]{0,160}\b(?:organisee?s?|prevue?s?|attendue?s?|declaree?s?|devant|place|au depart)\b/);
  if (i < 0) return null;
  const start = Math.max(0, t.lastIndexOf(' ', Math.max(0, i - 40)));
  const end = t.slice(i).search(/[.;]/);
  const s = t.slice(start, end < 0 ? i + 220 : i + end).trim();
  return s.length > 220 ? `${s.slice(0, 219).trimEnd()}…` : s;
}

/** Lieu de rendez-vous du texte (« devant le lycée Maurice Genevoix ») pour le géocodage, ou null. */
export function actPlace(excerpt) {
  if (!excerpt) return null;
  const m = /\bdevant (?:le |la |l['’]|les )?([^,;.]{3,80}?)(?= à | a | le | les | de \d| du |,|$)/i.exec(excerpt);
  return m ? m[1].trim() : null;
}

/** Date de publication du recueil (« PUBLIÉ LE 14 OCTOBRE 2026 »), « AAAA-MM-JJ » ou null. */
export function publishedDay(firstPage) {
  const m = new RegExp(`publie le (1er|\\d{1,2}) (${MONTHS.join('|')}) (\\d{4})`).exec(fold(firstPage));
  if (!m) return null;
  return `${m[3]}-${String(MONTHS.indexOf(m[2]) + 1).padStart(2, '0')}-${String(m[1] === '1er' ? 1 : Number(m[1])).padStart(2, '0')}`;
}

/** Titre d'un arrêté : première ligne « Arrêté … » après l'en-tête, 200 caractères au plus. */
function actTitle(text) {
  const m = /(arr[êe]t[ée][^\n]{10,240})/i.exec(String(text));
  const s = (m ? m[1] : '').replace(/\s+/g, ' ').trim();
  return s.length > 200 ? `${s.slice(0, 199).trimEnd()}…` : s || 'Arrêté préfectoral';
}

/**
 * Arrêtés utiles d'un recueil : `pages` = texte de chaque page. Rend `[{ act, kind, title, days, hours, communes, excerpt, place }]`,
 * jours à partir de la publication seulement (un arrêté rappelle souvent les journées passées dans ses considérants).
 */
export function analyseRecueil(pages, publishedOn) {
  const year = Number(String(publishedOn ?? '').slice(0, 4)) || new Date().getUTCFullYear();
  const out = [];
  for (const { id, text } of splitActs(pages)) {
    const kind = actKind(text);
    if (!kind) continue;
    // Date de l'arrêté lui-même (« Arrêté préfectoral du 14 octobre 2026 », répétée en pied de page) : jamais un jour de rassemblement.
    const body = articles(text).replace(new RegExp(`arr[êe]t[ée][^.;]{0,60}?\\bdu (?:1er|\\d{1,2}) (?:${MONTHS_FR})\\s+\\d{4}`, 'gi'), ' ');
    const days = actDays(body, year).filter((d) => !publishedOn || d >= publishedOn);
    if (days.length === 0) continue;
    const excerpt = actExcerpt(text);
    out.push({ act: id, kind, title: actTitle(text), days, hours: actHours(body), communes: actCommunes(text), excerpt, place: actPlace(excerpt) });
  }
  return out;
}
