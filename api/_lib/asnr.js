// api/_lib/asnr.js : événements de sûreté publiés par l'ASNR (spec 2026-10-13 ASNR sûreté). Sources publiques sans clé, vérifiées le
// 13/10/2026 : flux RSS (10 items mêlés, texte complet ; l'URL sans « ?q= » redirige par meta refresh), liste des actualités (16 cartes
// par page, 13 pages) et page de chaque avis. Classement sur le TITRE seul : tout texte ASNR contient « Autorité de sûreté nucléaire et
// de radioprotection ». Site : centrale EDF cherchée dans le titre, puis dans le texte ; jamais de site deviné hors des 19 centrales.
import { cleanText, decodeEntities } from './source-http.js';

export const ASNR_ORIGIN = 'https://www.asnr.fr';
export const ASNR_RSS_URL = `${ASNR_ORIGIN}/rss.xml?q=/rss.xml`;
export const asnrListUrl = (page) => `${ASNR_ORIGIN}/actualites?page=${page}`;

/** Centrales EDF : identifiant et nom de src/config/infrastructure.ts (alignés par un test), motif sur le texte replié. Tricastin couvre aussi Orano Tricastin (même site). */
export const ASNR_PLANTS = [
  ['nuc-gravelines', 'Gravelines', /\bgravelines\b/], ['nuc-blayais', 'Blayais', /\bblayais\b/], ['nuc-bugey', 'Bugey', /\bbugey\b/],
  ['nuc-cattenom', 'Cattenom', /\bcattenom\b/], ['nuc-chinon', 'Chinon', /\bchinon\b/], ['nuc-chooz', 'Chooz', /\bchooz\b/],
  ['nuc-civaux', 'Civaux', /\bcivaux\b/], ['nuc-cruas', 'Cruas-Meysse', /\bcruas\b/], ['nuc-dampierre', 'Dampierre-en-Burly', /\bdampierre\b/],
  ['nuc-flamanville', 'Flamanville', /\bflamanville\b/], ['nuc-golfech', 'Golfech', /\bgolfech\b/],
  ['nuc-nogent', 'Nogent-sur-Seine', /\bnogent-sur-seine\b/], ['nuc-paluel', 'Paluel', /\bpaluel\b/], ['nuc-penly', 'Penly', /\bpenly\b/],
  ['nuc-saint-alban', 'Saint-Alban', /\bsaint-alban\b/], ['nuc-saint-laurent', 'Saint-Laurent-des-Eaux', /\bsaint-laurent-des-eaux\b/],
  ['nuc-tricastin', 'Tricastin', /\btricastin\b/], ['nuc-belleville', 'Belleville-sur-Loire', /\bbelleville-sur-loire\b/],
  ['nuc-fessenheim', 'Fessenheim', /\bfessenheim\b/],
];

const fold = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’‘]/g, "'");

const CRISIS = /\bactive son centre de crise\b/;
const EVENT = /\bincident\b|\bevenement (?:radiologique|significatif)|\bcontamination (?:externe|interne)\b|\birradiation\b|\bincendie (?:maitrise )?(?:a|dans)\b|\bfuite\b|\brepli du reacteur\b/;
const NOT_EVENT = /\b(?:bilan|analyse|statistiques|rapport|retrace|projet|guide|barometre)\b/;
const RADIOPROTECTION = /radioprotection|contamination|irradiation|exposition|radiologique|hospices|hopita|\bchu\b|institut|clinique|medecine nucleaire|radiotherapie|laboratoire|musee|transport/;
const INES = /niveau\s+(\d)\s+(?:de|sur)\s+l'echelle\s+ines/g;

/** URL absolue sans requête, fragment ni barre finale (clé du journal) ; null si illisible. */
export function canonicalUrl(href) {
  try {
    const u = new URL(String(href).trim(), ASNR_ORIGIN);
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

/** Centrale EDF nommée : titre d'abord, puis texte ; dans un même texte, la première citée. */
export function matchPlant(title, text = '') {
  for (const source of [fold(title), fold(text)]) {
    let best = null;
    for (const [id, name, re] of ASNR_PLANTS) {
      const m = re.exec(source);
      if (m && (best === null || m.index < best.index)) best = { id, name, index: m.index };
    }
    if (best) return { id: best.id, name: best.name };
  }
  return null;
}

/** Groupe d'un avis d'après son titre ; null hors sûreté (thèses, inspections, bilans, vie de l'institution). */
export function classifyAsnr(title, text = '') {
  const t = fold(title);
  if (CRISIS.test(t)) return 'crise';
  if (!EVENT.test(t) || NOT_EVENT.test(t)) return null;
  if (matchPlant(title, text)) return 'installation';
  return RADIOPROTECTION.test(t) ? 'radioprotection' : 'installation';
}

/** Niveau INES lu dans le texte (« au niveau 2 de l'échelle INES »), le plus haut cité ; null si absent. */
export function parseInes(text) {
  let max = null;
  for (const m of fold(text).matchAll(INES)) {
    const n = Number(m[1]);
    if (n <= 7 && (max === null || n > max)) max = n;
  }
  return max;
}

const PARIS_DAY = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Items du flux RSS : jour de Paris tiré de `<time datetime>` de la description, à défaut de pubDate. */
export function parseAsnrRss(xml) {
  const text = String(xml ?? '');
  if (!/<channel[\s>]/.test(text)) throw new Error('flux RSS illisible');
  const items = [];
  let undated = 0;
  for (const block of text.split(/<item>/).slice(1)) {
    const tag = (name) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block)?.[1] ?? '';
    const url = canonicalUrl(decodeEntities(tag('link')));
    const title = cleanText(tag('title'));
    const descHtml = decodeEntities(tag('description').replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, ''));
    const pub = Date.parse(tag('pubDate'));
    const date = /<time datetime="(\d{4}-\d{2}-\d{2})/.exec(descHtml)?.[1] ?? (Number.isFinite(pub) ? PARIS_DAY.format(pub) : null);
    if (!url || !title) continue;
    if (!date) { undated += 1; continue; }
    items.push({ url, title, date, text: cleanText(descHtml) });
  }
  return { items, undated };
}

/** Cartes d'une page de la liste des actualités (sans texte) ; aucune carte : erreur (maquette changée, jamais « 0 avis »). */
export function parseAsnrListPage(html) {
  const cards = String(html ?? '').split('irsn-related-card__link').slice(1);
  if (cards.length === 0) throw new Error('aucune actualité lisible');
  const items = [];
  let undated = 0;
  for (const card of cards) {
    const href = /href="([^"]+)"/.exec(card)?.[1];
    const url = href ? canonicalUrl(decodeEntities(href)) : null;
    const title = cleanText(/irsn-related-card__title[^>]*>([\s\S]*?)<\/div>/.exec(card)?.[1] ?? '');
    const d = /fr-card__date[^>]*>\s*(\d{2})\/(\d{2})\/(\d{4})/.exec(card);
    if (!url || !title) continue;
    if (!d) { undated += 1; continue; }
    items.push({ url, title, date: `${d[3]}-${d[2]}-${d[1]}`, text: null });
  }
  return { items, undated, cards: cards.length };
}

/** Texte lisible du contenu principal d'un avis (`<main>`) ; sans `<main>` : erreur. */
export function parseAsnrDetail(html) {
  const main = /<main[\s\S]*?<\/main>/.exec(String(html ?? ''))?.[0];
  if (!main) throw new Error('page d’avis illisible');
  return cleanText(main.replace(/<script[\s\S]*?<\/script>/g, ' '));
}
