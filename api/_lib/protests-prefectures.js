// api/_lib/protests-prefectures.js : arrêtés préfectoraux liés aux rassemblements (relevé de scripts/build-arretes.mjs, minuteur
// fm-arretes) changés en rendez-vous de la couche Manifestations : un par arrêté, jour et commune, dans la fenêtre (6 h passées,
// 7 jours à venir). Commune retrouvée dans le référentiel geo.api.gouv.fr du département de la préfecture (nom exact) ; arrêté
// sans commune lisible gardé sans position. La préfecture dit qu'elle attend du monde : ce n'est pas un chiffre.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { deptCommunes, icsTime, indexCommunes, normalizeName } from './protests-demosphere.js';

/** Fichier du relevé : production (minuteur, hors de la release), sinon la copie du dépôt (développement). */
export const ARRETES_FILES = Object.freeze([
  process.env.ARRETES_FILE,
  '/var/lib/francemonitor/data/arretes-prefectoraux.json',
  fileURLToPath(new URL('../../public/data/arretes-prefectoraux.json', import.meta.url)),
].filter(Boolean));

export const PAST_WINDOW_MS = 6 * 3_600_000;
export const FUTURE_WINDOW_MS = 7 * 86_400_000;

const KIND_TITLE = {
  drone: 'Drones de surveillance autorisés par la préfecture',
  interdiction: 'Manifestation interdite par la préfecture',
  mesures: 'Mesures de police pour une manifestation (préfecture)',
};

async function readFirst(files) {
  for (const f of files) {
    try { return JSON.parse(await readFile(f, 'utf8')); } catch { /* fichier suivant */ }
  }
  return null;
}

/** Début (ms, heure de Paris) d'un jour « AAAA-MM-JJ » à l'heure « HH:MM », ou minuit si l'heure est inconnue. */
const startOf = (day, hour) => icsTime(`${day.replace(/-/g, '')}T${(hour ?? '00:00').replace(':', '')}00`);

/**
 * Rendez-vous des arrêtés : `relevé` = contenu du fichier, `index(dept)` = index des communes du département (indexCommunes).
 * Rend `{ items, acts, unplaced }` ; même arrêté publié deux fois (plusieurs recueils) compté une fois.
 */
export async function prefectureItems(releve, now, index) {
  const items = new Map();
  let acts = 0;
  let unplaced = 0;
  for (const r of releve?.recueils ?? []) {
    for (const a of r.acts ?? []) {
      const days = (a.days ?? []).filter((d) => {
        const start = startOf(d, a.hours?.[0]);
        const end = a.hours ? startOf(d, a.hours[1]) : start + 86_400_000;
        return end + (a.hours ? PAST_WINDOW_MS : 0) >= now && start <= now + FUTURE_WINDOW_MS;
      });
      if (days.length === 0) continue;
      acts += 1;
      const idx = await index(r.dept).catch(() => null);
      const communes = (a.communes ?? []).map((n) => {
        const found = idx?.byName.get(normalizeName(n)) ?? [];
        return found.length === 1 ? found[0] : null;
      });
      const placed = communes.filter(Boolean);
      if (placed.length === 0) unplaced += 1;
      for (const day of days) {
        for (const c of placed.length > 0 ? placed : [null]) {
          const id = `prefecture:${a.act}:${day}:${c ? normalizeName(c.name) : 'sans-lieu'}`;
          if (items.has(id)) continue;
          items.set(id, {
            id, source: 'prefecture', status: 'annonce', title: KIND_TITLE[a.kind] ?? 'Arrêté préfectoral',
            startsAt: new Date(startOf(day, a.hours?.[0])).toISOString(), allDay: !a.hours,
            city: c?.name ?? null, dept: c?.dept || r.dept, lat: c?.lat ?? null, lon: c?.lon ?? null,
            url: r.url, edition: `Préfecture ${r.prefecture === 'Gironde' ? 'de la' : 'du'} ${r.prefecture}`,
            place: c && a.place ? `${a.place}, ${c.name}` : null,
            violent: false, participants: null, precision: c ? 'commune' : null,
            articles: [], articleCount: 0,
            arrete: { kind: a.kind, act: a.act, hours: a.hours ?? null, excerpt: a.excerpt ?? null, publishedOn: r.publishedOn ?? null },
          });
        }
      }
    }
  }
  return { items: [...items.values()], acts, unplaced };
}

/** Arrêtés du relevé : `{ items, acts, unplaced, readAt }` ; lève si aucun relevé n'est lisible (minuteur jamais passé). */
export async function loadPrefectures(now) {
  const releve = await readFirst(ARRETES_FILES);
  if (!releve) throw new Error('relevé des arrêtés absent');
  const cache = new Map();
  const index = (dept) => {
    if (!cache.has(dept)) cache.set(dept, deptCommunes(dept).then(indexCommunes));
    return cache.get(dept);
  };
  return { ...(await prefectureItems(releve, now, index)), readAt: releve.generatedAt ?? null };
}
