// api/_lib/protests.js : couche Manifestations (spec 2026-10-17 manifestations). Deux sources lues en parallèle, chacune pouvant
// tomber sans l'autre : Démosphère (rendez-vous annoncés, localisés à la commune) et GDELT (presse mondiale, lieu rarement plus
// précis que « Paris » ou « France »). Aucun effet sur le score ni sur les situations.
import { loadDemosphere } from './protests-demosphere.js';
import { loadGdelt } from './protests-gdelt.js';
import { sourceError } from './source-http.js';

/** Réponse vide, avec les pannes nommées. */
export function emptyProtests(errors = []) {
  return {
    readAt: null,
    items: [],
    demosphere: { readAt: null, editions: 0, failedEditions: [], scanned: 0 },
    gdelt: { readAt: null, files: 0, missingFiles: 0 },
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

export async function loadProtests(now) {
  const [demo, gdelt] = await Promise.allSettled([loadDemosphere(now), loadGdelt(now)]);
  const body = emptyProtests();
  const readAt = new Date(now).toISOString();
  if (demo.status === 'fulfilled') {
    body.items.push(...demo.value.items);
    body.demosphere = { readAt, editions: demo.value.editions, failedEditions: demo.value.failedEditions, scanned: demo.value.scanned };
    body.errors.push(...demo.value.errors);
  } else {
    body.errors.push(sourceError('Démosphère', demo.reason));
  }
  if (gdelt.status === 'fulfilled') {
    body.items.push(...gdelt.value.items);
    body.gdelt = { readAt, files: gdelt.value.files, missingFiles: gdelt.value.missingFiles };
  } else {
    body.errors.push(sourceError('GDELT', gdelt.reason));
  }
  body.items = sortProtests(body.items);
  body.readAt = demo.status === 'fulfilled' || gdelt.status === 'fulfilled' ? readAt : null;
  return body;
}
