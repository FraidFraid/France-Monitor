// api/_lib/telecom-press.js : pannes télécoms signalées par la presse (21/10/2026). Pur. Le fichier ARCEP ne paraît qu'une fois par
// jour et ne compte que les antennes hors service : la panne nationale d'Orange du 21/10 (cœur de réseau, après la publication) n'y
// figurait pas. Articles des dernières 24 h classés infrastructure, medium ou plus, dont le titre parle d'une panne de réseau ;
// regroupés par opérateur cité (un article qui en cite deux compte pour chacun ; aucun cité : opérateur null).

export const PRESS_WINDOW_MS = 24 * 60 * 60 * 1000;
const SEVERITIES = ['medium', 'high', 'critical'];
const OPERATORS = [['Orange', /\b(?:orange|sosh)\b/], ['SFR', /\b(?:sfr|red by sfr)\b/], ['Bouygues Telecom', /\bbouygues\b/], ['Free', /\bfree\b/]];
/** Panne de réseau au titre : « panne » ou « coupure » avec réseau, internet, mobile, téléphone, fibre ou opérateur (dans un sens ou dans l'autre). */
const OUTAGE = /\b(?:panne|coupure|perturb\w*)\b.*\b(?:reseau|internet|mobile|telephon\w*|fibre|sms|appels|operateur)\b|\b(?:reseau|internet|mobile|telephon\w*|fibre|operateur)\b.*\b(?:panne|coupure|perturb\w*)\b|\bprives de reseau\b/;

/** Portée nationale dite par un titre : « panne nationale », « au niveau national », « toute la France », « panne géante ». */
const NATIONAL = /\b(?:national|nationale|toute la france|partout en france|geante|grande envergure)\b/;

const fold = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/['’]/g, ' ').toLowerCase();

/** Article retenu : titre de panne de réseau, infrastructure, medium ou plus, publié dans la fenêtre. */
export function isTelecomOutageItem(item, now) {
  const at = Date.parse(item.publishedAt ?? '');
  return item.category === 'infrastructure' && SEVERITIES.includes(item.severity) && Number.isFinite(at)
    && at <= now && now - at <= PRESS_WINDOW_MS && OUTAGE.test(fold(item.title ?? '')) && !SECURITY_FLAW.test(fold(item.title ?? ''));
}

/**
 * Signalements par opérateur, les plus graves puis les plus récents d'abord.
 * @param {Array<{ title: string, link: string, publishedAt: string | null, feedName: string | null, category: string | null, severity: string | null }>} items
 * @returns {import('../../src/types/index.ts').TelecomPressReport[]}
 */
export function telecomPressReports(items, now) {
  const groups = new Map();
  for (const item of items) {
    if (!isTelecomOutageItem(item, now)) continue;
    const title = fold(item.title);
    const named = OPERATORS.filter(([, re]) => re.test(title)).map(([name]) => name);
    for (const operator of named.length > 0 ? named : [null]) {
      const g = groups.get(operator) ?? { operator, items: [] };
      g.items.push(item);
      groups.set(operator, g);
    }
  }
  const rank = (s) => SEVERITIES.indexOf(s);
  return [...groups.values()].map(({ operator, items: list }) => {
    const sorted = [...list].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
    const latest = sorted[0];
    return {
      operator,
      severity: SEVERITIES[Math.max(...list.map((i) => rank(i.severity)))],
      articles: list.length,
      sources: new Set(list.map((i) => i.feedName ?? i.link)).size,
      firstAt: new Date(Math.min(...list.map((i) => Date.parse(i.publishedAt)))).toISOString(),
      lastAt: latest.publishedAt,
      title: latest.title,
      link: latest.link,
      national: list.some((i) => NATIONAL.test(fold(i.title))),
    };
  }).sort((a, b) => rank(b.severity) - rank(a.severity) || Date.parse(b.lastAt) - Date.parse(a.lastAt));
}

// ─── Tous les réseaux (21/10/2026, control room des pannes) ───
// Un réseau par article, dans cet ordre (le premier qui correspond) : un titre « 112 injoignable, panne du réseau Orange » est une
// panne des numéros d'urgence. Chaque réseau exige un mot du réseau ET un mot de panne : « fuite de gaz » ou « gaz de schiste » ne
// sont pas des coupures de gaz.
const DOWN = '(?:panne|pannes|coupure|coupures|coupe|coupee|coupees|prive|prives|privee|privees|injoignable|injoignables|inaccessible|inaccessibles|hors service|perturbe|perturbes|perturbee|perturbees|perturbation|perturbations|impossible|impropre|non potable)';
const both = (net) => new RegExp(`\\b${net}\\b.*\\b${DOWN}\\b|\\b${DOWN}\\b.*\\b${net}\\b`);
const NETWORK_RULES = [
  ['urgence', both('(?:112|numeros? d urgence|appels? d urgence|samu|centre 15)')],
  ['electricite', both('(?:electricite|courant|enedis|delestage|blackout)')],
  ['gaz', both('(?:gaz|grdf)')],
  ['eau', both('(?:eau|eau potable|robinet)')],
  ['paiement', both('(?:paiement|paiements|carte bancaire|cartes bancaires|terminaux de paiement|distributeurs? de billets)')],
  ['tv', both('(?:tnt|television|emetteur|emetteurs)')],
];
const NETWORK_OPERATORS = {
  electricite: [['Enedis', /\benedis\b/], ['RTE', /\brte\b/], ['EDF', /\bedf\b/]],
  gaz: [['GRDF', /\bgrdf\b/], ['GRTgaz', /\bgrtgaz\b/]],
  eau: [['Veolia', /\bveolia\b/], ['Suez', /\bsuez\b/], ['Saur', /\bsaur\b/], ['Eau de Paris', /\beau de paris\b/]],
  paiement: [['Cartes Bancaires', /\b(?:cb|carte bancaire|cartes bancaires)\b/], ['Visa', /\bvisa\b/], ['Mastercard', /\bmastercard\b/]],
  tv: [['TDF', /\btdf\b/]],
  urgence: [],
  mobile: OPERATORS,
};
const PRESS_SEVERITY_LEVEL = { medium: 'jaune', high: 'orange', critical: 'rouge' };

/** Faille logicielle (failles PHP du 21/10/2026 : « panne internet mondiale », sites inaccessibles) : jamais une panne de réseau. */
const SECURITY_FLAW = /\b(?:failles?|vulnerabilites?)\b/;

/** Réseau d'un titre déjà replié (premier réseau qui correspond), sinon null. */
export function networkOfTitle(folded) {
  if (SECURITY_FLAW.test(folded)) return null;
  for (const [network, re] of NETWORK_RULES) if (re.test(folded)) return network;
  return OUTAGE.test(folded) ? 'mobile' : null;
}

/**
 * Pannes signalées par la presse, tous réseaux : articles des dernières 24 h, medium ou plus (quelle que soit la catégorie), regroupés
 * par réseau et opérateur cité. Niveau = gravité la plus haute (urgences : toujours rouge).
 */
export function pressOutages(items, now) {
  const groups = new Map();
  for (const item of items) {
    const at = Date.parse(item.publishedAt ?? '');
    if (!SEVERITIES.includes(item.severity) || !Number.isFinite(at) || at > now || now - at > PRESS_WINDOW_MS) continue;
    const title = fold(item.title ?? '');
    const network = networkOfTitle(title);
    if (network === null) continue;
    const named = (NETWORK_OPERATORS[network] ?? []).filter(([, re]) => re.test(title)).map(([name]) => name);
    for (const operator of named.length > 0 ? named : [null]) {
      const key = `${network}|${operator ?? ''}`;
      const g = groups.get(key) ?? { network, operator, items: [] };
      g.items.push(item);
      groups.set(key, g);
    }
  }
  const rank = (s) => SEVERITIES.indexOf(s);
  return [...groups.values()].map(({ network, operator, items: list }) => {
    const latest = [...list].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))[0];
    const severity = SEVERITIES[Math.max(...list.map((i) => rank(i.severity)))];
    return {
      network, operator, severity, level: network === 'urgence' ? 'rouge' : PRESS_SEVERITY_LEVEL[severity],
      articles: list.length, sources: new Set(list.map((i) => i.feedName ?? i.link)).size,
      firstAt: new Date(Math.min(...list.map((i) => Date.parse(i.publishedAt)))).toISOString(), lastAt: latest.publishedAt,
      title: latest.title, link: latest.link, national: list.some((i) => NATIONAL.test(fold(i.title))),
    };
  });
}
