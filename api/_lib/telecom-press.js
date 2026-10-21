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
    && at <= now && now - at <= PRESS_WINDOW_MS && OUTAGE.test(fold(item.title ?? ''));
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
