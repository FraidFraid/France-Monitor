// api/_lib/protests.js : couche Manifestations (spec 2026-10-17 manifestations). Trois sources lues en parallèle, chacune pouvant
// tomber sans les autres : Démosphère (rendez-vous annoncés, localisés à la commune), la presse française déjà ingérée (titres qui
// nomment la ville) et GDELT (presse mondiale, lieu rarement plus précis que « Paris » ou « France »). Un lieu GDELT déjà relevé par
// la presse française n'est pas répété. Aucun effet sur le score ni sur les situations.
import { loadDemosphere } from './protests-demosphere.js';
import { loadGdelt } from './protests-gdelt.js';
import { loadPress } from './protests-press.js';
import { loadPressAnnouncements } from './protests-press-annonces.js';
import { loadPrefectures } from './protests-prefectures.js';
import { loadGiletsJaunes } from './protests-giletsjaunes.js';
import { sourceError } from './source-http.js';

/** Réponse vide, avec les pannes nommées. */
export function emptyProtests(errors = []) {
  return {
    readAt: null,
    items: [],
    demosphere: { readAt: null, editions: 0, failedEditions: [], scanned: 0 },
    gdelt: { readAt: null, files: 0, missingFiles: 0 },
    presse: { readAt: null, scanned: 0, matched: 0, unplaced: 0 },
    errors,
  };
}

/** Signalés d'abord (plus récent d'abord), puis annonces par heure de début. */
export function sortProtests(items) {
  const at = (i) => (i.startsAt ? Date.parse(i.startsAt) : 0);
  return [...items].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'signale' ? -1 : 1;
    return a.status === 'signale' ? at(b) - at(a) : at(a) - at(b);
  });
}

const cityKey = (city) => String(city ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export async function loadProtests(now) {
  const [demo, gdelt, press, announced, prefectures, giletsJaunes] = await Promise.allSettled([
    loadDemosphere(now), loadGdelt(now), loadPress(now), loadPressAnnouncements(now), loadPrefectures(now), loadGiletsJaunes(now),
  ]);
  const body = emptyProtests();
  const readAt = new Date(now).toISOString();
  if (demo.status === 'fulfilled') {
    body.items.push(...demo.value.items);
    body.demosphere = { readAt, editions: demo.value.editions, failedEditions: demo.value.failedEditions, scanned: demo.value.scanned };
    body.errors.push(...demo.value.errors);
  } else {
    body.errors.push(sourceError('Démosphère', demo.reason));
  }
  const pressCities = new Set();
  if (press.status === 'fulfilled') {
    body.items.push(...press.value.items);
    for (const x of press.value.items) pressCities.add(cityKey(x.city));
    body.presse = { readAt, scanned: press.value.scanned, matched: press.value.matched, unplaced: press.value.unplaced };
  } else {
    body.errors.push(sourceError('Presse française', press.reason));
  }
  // Rassemblements annoncés par la presse (hors des relevés : ils ne masquent pas GDELT).
  if (announced.status === 'fulfilled') body.items.push(...announced.value.items);
  else body.errors.push(sourceError('Presse française (annonces)', announced.reason));
  // Arrêtés préfectoraux (drones, interdictions, encadrement) : la préfecture attend du monde ; relevé horaire par minuteur.
  if (prefectures.status === 'fulfilled') body.items.push(...prefectures.value.items);
  else body.errors.push(sourceError('Arrêtés préfectoraux', prefectures.reason));
  // Carte participative des gilets jaunes (17octobregiletjaune.net) : actions annoncées, lieu exact.
  if (giletsJaunes.status === 'fulfilled') body.items.push(...giletsJaunes.value.items);
  else body.errors.push(sourceError('Carte des gilets jaunes', giletsJaunes.reason));
  if (gdelt.status === 'fulfilled') {
    body.items.push(...gdelt.value.items.filter((x) => x.lat === null || !pressCities.has(cityKey(x.city))));
    body.gdelt = { readAt, files: gdelt.value.files, missingFiles: gdelt.value.missingFiles };
  } else {
    body.errors.push(sourceError('GDELT', gdelt.reason));
  }
  body.items = sortProtests(body.items);
  body.readAt = [demo, gdelt, press, announced, prefectures, giletsJaunes].some((r) => r.status === 'fulfilled') ? readAt : null;
  return body;
}
