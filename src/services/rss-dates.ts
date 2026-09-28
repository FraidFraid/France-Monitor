/**
 * Dates « zéro » des flux RSS (01/01/1970) côté client — miroir de dropPlaceholderDrafts
 * (api/_lib/parse-rss.js), pour le chemin XML brut + DOMParser qui ne passe pas par le serveur.
 */

/** Toute date antérieure est une date « zéro » de CMS (01/01/1970), pas une vraie publication. */
export const PLACEHOLDER_DATE_BEFORE_MS = Date.UTC(1971, 0, 1);

export function isPlaceholderDate(date: Date): boolean {
  const time = date.getTime();
  return !Number.isNaN(time) && time < PLACEHOLDER_DATE_BEFORE_MS;
}

/**
 * Écarte les versions provisoires datées 1970 d'un flux dont d'autres items sont datés (elles
 * reviennent plus tard avec leur vraie date) ; si aucun item n'est daté, les garde à l'heure de
 * collecte.
 */
export function dropPlaceholderDrafts<T extends { pubDate: Date }>(items: T[], now: Date = new Date()): T[] {
  const placeholderCount = items.filter((item) => isPlaceholderDate(item.pubDate)).length;
  if (placeholderCount === 0) return items;
  if (placeholderCount < items.length) return items.filter((item) => !isPlaceholderDate(item.pubDate));
  return items.map((item) => ({ ...item, pubDate: new Date(now.getTime()) }));
}
