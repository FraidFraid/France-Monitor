// src/services/fiche-sections-store.ts — mémoire de l'ouverture des sections repliables de la fiche
// (spec 2026-10-01 § 3.3) : clé « <fiche>:<section> » → ouverte. Commodité par navigateur ; toute
// lecture ou écriture du stockage est protégée (navigation privée, quota, données corrompues).

export const SECTIONS_STORAGE_KEY = 'fm.v2.sections';

export type SectionStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function loadSectionState(storage: SectionStorage | null): Map<string, boolean> {
  const state = new Map<string, boolean>();
  if (!storage) return state;
  try {
    const raw = storage.getItem(SECTIONS_STORAGE_KEY);
    if (!raw) return state;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return state;
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'boolean') state.set(key, value);
    }
  } catch {
    return new Map();
  }
  return state;
}

export function saveSectionState(storage: SectionStorage | null, state: ReadonlyMap<string, boolean>): void {
  if (!storage) return;
  try {
    storage.setItem(SECTIONS_STORAGE_KEY, JSON.stringify(Object.fromEntries(state)));
  } catch {
    // Stockage refusé ou plein : la mémoire reste en session.
  }
}

/** Ouvertures d'une fiche, clés sans le préfixe « <fiche>: ». */
export function sectionsOf(state: ReadonlyMap<string, boolean>, ficheKey: string): Map<string, boolean> {
  const prefix = `${ficheKey}:`;
  const out = new Map<string, boolean>();
  for (const [key, open] of state) {
    if (key.startsWith(prefix)) out.set(key.slice(prefix.length), open);
  }
  return out;
}

/** « <type>:<…>:<section> » → « <type>:<section> » : une section ouverte l'est pour toutes les fiches du même type. */
export function sectionMemoryKey(sectionKey: string): string {
  const first = sectionKey.indexOf(':');
  const last = sectionKey.lastIndexOf(':');
  if (first < 0) return sectionKey;
  return `${sectionKey.slice(0, first)}:${sectionKey.slice(last + 1)}`;
}
