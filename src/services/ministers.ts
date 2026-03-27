/**
 * ministers.ts — Enrichissement async des fiches ministres.
 * Sources : Wikidata (biographie, photo HD), RSS agenda ministère.
 * Tout est mis en cache (Wikidata 24h, RSS 30min).
 */

import { getMinistersForCategories, GOUVERNEMENT, type Minister } from '../config/government.ts';
import type { EventCategory } from '../types/index.ts';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MinisterEnriched extends Minister {
  bioShort?: string;          // Description FR Wikidata (~2 phrases)
  photoHd?: string;           // URL image HD Wikidata
  wikipediaUrl?: string;
  agendaItems?: AgendaItem[]; // 3 derniers communiqués RSS
  wikidataLoaded?: boolean;
  appointmentLabel?: string;
  osintDatasets?: OpenDataDataset[];
}

export interface AgendaItem {
  title: string;
  date: string;
  location?: string;
  sourceLabel?: string;
  url?: string;
}

export interface OpenDataResource {
  id?: string;
  title?: string;
  type?: string;
  format?: string;
  url?: string;
  latest?: string;
  lastModified?: string;
}

export interface OpenDataDataset {
  id?: string;
  title?: string;
  url?: string;
  description?: string;
  organization?: string;
  lastUpdate?: string;
  createdAt?: string;
  license?: string;
  resourceCount?: number;
  resources?: OpenDataResource[];
}

// ─── Cache ────────────────────────────────────────────────────────────────────

const wikidataCache = new Map<string, { data: Partial<MinisterEnriched>; ts: number }>();
const rssCache = new Map<string, { items: AgendaItem[]; ts: number }>();
const TTL_WIKIDATA = 24 * 60 * 60 * 1000;
const TTL_RSS = 30 * 60 * 1000;
const TTL_DIRECTORY = 6 * 60 * 60 * 1000;

let primeMinisterCache: { data: Partial<MinisterEnriched>; ts: number } | null = null;
let governmentCache: { data: MinisterEnriched[]; ts: number } | null = null;
const osintCache = new Map<string, { data: OpenDataDataset[]; ts: number }>();

const TTL_GOVERNMENT = 6 * 60 * 60 * 1000;

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function slugifyId(value: string): string {
  return normalizeText(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function searchWikidataId(minister: Minister): Promise<Partial<MinisterEnriched>> {
  const query = `${minister.prenom} ${minister.nom}`.trim();
  if (!query) return {};

  try {
    const res = await fetch(`/api/ministers/wikidata-search?name=${encodeURIComponent(query)}`);
    if (!res.ok) return {};
    const result = await res.json() as { id?: string; description?: string };
    if (!result.id) return {};
    const entityRes = await fetch(`/api/ministers/wikidata?id=${result.id}`);
    if (!entityRes.ok) return { wikidataId: result.id };
    const entity = await entityRes.json();
    const claims = entity?.claims ?? {};
    const imageClaim = claims?.P18?.[0]?.mainsnak?.datavalue?.value;
    const photoUrl = imageClaim
      ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(String(imageClaim).replace(/ /g, '_'))}?width=240`
      : undefined;
    return {
      wikidataId: result.id,
      bioShort: typeof result.description === 'string' ? result.description : undefined,
      photoUrl,
    };
  } catch {
    return {};
  }
}

async function fetchOfficialProfileMeta(minister: Minister): Promise<Partial<MinisterEnriched>> {
  try {
    const res = await fetch(`/api/ministers/profile-meta?prenom=${encodeURIComponent(minister.prenom)}&nom=${encodeURIComponent(minister.nom)}`);
    if (!res.ok) return {};
    const data = await res.json() as { photoUrl?: string; profileUrl?: string; bioShort?: string; sourceLabel?: string; agendaUrl?: string };
    return {
      photoUrl: data.photoUrl,
      bioShort: data.bioShort,
      agendaUrl: data.agendaUrl ?? minister.agendaUrl,
      sourceLabel: data.sourceLabel ?? minister.sourceLabel,
      sourceUrl: data.profileUrl ?? minister.sourceUrl,
    };
  } catch {
    return {};
  }
}

function categoriesFromTitle(title: string): EventCategory[] {
  const normalized = normalizeText(title);
  const categories = new Set<EventCategory>();
  if (normalized.includes('interieur') || normalized.includes('armees') || normalized.includes('justice') || normalized.includes('affaires etrangeres')) {
    categories.add('security');
  }
  if (normalized.includes('transports')) categories.add('transport');
  if (normalized.includes('sante') || normalized.includes('autonomie') || normalized.includes('handicap')) categories.add('health');
  if (normalized.includes('travail') || normalized.includes('solidarites') || normalized.includes('ville') || normalized.includes('logement')) categories.add('social');
  if (normalized.includes('economie') || normalized.includes('finances') || normalized.includes('comptes publics') || normalized.includes('commerce')) categories.add('finance');
  if (normalized.includes('numerique') || normalized.includes('intelligence artificielle')) categories.add('cyber');
  if (normalized.includes('transition ecologique') || normalized.includes('climat') || normalized.includes('biodiversite')) {
    categories.add('weather');
    categories.add('floods');
    categories.add('fires');
    categories.add('energy');
  }
  if (normalized.includes('energie')) categories.add('energy');
  if (normalized.includes('premier ministre') || normalized.includes('president')) {
    categories.add('security');
    categories.add('transport');
    categories.add('social');
    categories.add('health');
    categories.add('finance');
    categories.add('cyber');
    categories.add('energy');
    categories.add('weather');
    categories.add('floods');
    categories.add('fires');
  }
  return Array.from(categories);
}

function portfoliosFromTitle(title: string): string[] {
  const normalized = normalizeText(title);
  const segments = title
    .replace(/^Ministre(?: délégué(?:e)?)?(?: chargé(?:e)?| auprès de [^,]+)?,?\s*/i, '')
    .split(/,| et /i)
    .map((part) => part.trim())
    .filter(Boolean);
  const extra = new Set<string>(segments.map((part) => part.toLowerCase()));
  if (normalized.includes('premier ministre')) extra.add('gouvernement');
  if (normalized.includes('interieur')) extra.add('sécurité');
  if (normalized.includes('armees')) extra.add('défense');
  if (normalized.includes('numerique')) extra.add('numérique');
  if (normalized.includes('intelligence artificielle')) extra.add('ia');
  return Array.from(extra);
}

function fallbackById(id: string): Minister | undefined {
  return GOUVERNEMENT.find((minister) => minister.id === id);
}

function mergeMinister(base: Minister, override: Partial<MinisterEnriched>): MinisterEnriched {
  return {
    ...base,
    ...override,
    categories: override.categories ?? base.categories,
    portefeuilles: override.portefeuilles ?? base.portefeuilles,
  };
}

function buildOpenDataQuery(minister: Minister): string {
  const normalizedTitle = normalizeText(minister.titre);
  if (minister.isPresident) return 'president republique deplacements agenda';
  if (minister.isPM) return 'premier ministre deplacements gouvernement';
  if (normalizedTitle.includes('transports')) return 'agenda public transports mobilites';
  if (normalizedTitle.includes('sante')) return 'agenda public sante';
  if (normalizedTitle.includes('numerique')) return 'intelligence artificielle numerique open data';
  if (normalizedTitle.includes('economie')) return 'ministere economie finances open data';
  if (normalizedTitle.includes('affaires etrangeres')) return 'francophonie commerce exterieur open data';
  if (normalizedTitle.includes('transition ecologique')) return 'transition ecologique climat biodiversite open data';
  return minister.titre;
}

async function fetchMinisterOpenData(minister: Minister): Promise<OpenDataDataset[]> {
  const query = buildOpenDataQuery(minister);
  const cached = osintCache.get(query);
  if (cached && Date.now() - cached.ts < TTL_DIRECTORY) return cached.data;

  try {
    const res = await fetch(`/api/ministers/opendata?query=${encodeURIComponent(query)}`);
    if (!res.ok) return [];
    const datasets = await res.json() as OpenDataDataset[];
    osintCache.set(query, { data: datasets, ts: Date.now() });
    return datasets;
  } catch {
    return [];
  }
}

// ─── Wikidata enrichissement ──────────────────────────────────────────────────

export async function enrichMinisterFromWikidata(minister: Minister): Promise<Partial<MinisterEnriched>> {
  const resolvedId = minister.wikidataId;
  if (!resolvedId) {
    return searchWikidataId(minister);
  }
  const cached = wikidataCache.get(resolvedId);
  if (cached && Date.now() - cached.ts < TTL_WIKIDATA) return cached.data;

  try {
    const url = `/api/ministers/wikidata?id=${resolvedId}`;
    const res = await fetch(url);
    if (!res.ok) return {};
    const entity = await res.json();
    const claims = entity?.claims ?? {};
    const descriptions = entity?.descriptions ?? {};
    const sitelinks = entity?.sitelinks ?? {};

    const bioShort = descriptions?.fr?.value ?? descriptions?.en?.value;

    // Image P18
    let photoHd: string | undefined;
    const imageClaim = claims?.P18?.[0]?.mainsnak?.datavalue?.value;
    if (imageClaim) {
      const filename = encodeURIComponent(imageClaim.replace(/ /g, '_'));
      photoHd = `https://commons.wikimedia.org/wiki/Special:FilePath/${filename}?width=200`;
    }

    const wikipediaTitle = sitelinks?.frwiki?.title ?? sitelinks?.enwiki?.title;
    const wikipediaUrl = wikipediaTitle
      ? `https://fr.wikipedia.org/wiki/${encodeURIComponent(wikipediaTitle.replace(/ /g, '_'))}`
      : undefined;

    const data: Partial<MinisterEnriched> = {
      bioShort,
      photoHd,
      photoUrl: photoHd,
      wikipediaUrl,
      wikidataLoaded: true,
      wikidataId: resolvedId,
    };
    wikidataCache.set(resolvedId, { data, ts: Date.now() });
    return data;
  } catch {
    return {};
  }
}

// ─── RSS agenda ───────────────────────────────────────────────────────────────

export async function fetchMinisterAgenda(minister: Minister): Promise<AgendaItem[]> {
  const cached = rssCache.get(minister.id);
  if (cached && Date.now() - cached.ts < TTL_RSS) return cached.items;

  try {
    const url = `/api/ministers/agenda?id=${minister.id}`;
    const res = await fetch(url);
    if (!res.ok) {
      return minister.agendaUrl
        ? [{
            title: `Consulter l'agenda officiel de ${minister.prenom} ${minister.nom}`,
            date: 'Agenda officiel',
            sourceLabel: minister.sourceLabel ?? 'Source officielle',
            url: minister.agendaUrl,
          }]
        : [];
    }
    const items: AgendaItem[] = await res.json();
    const resolvedItems = items.length === 0 && minister.agendaUrl
      ? [{
          title: `Consulter l'agenda officiel de ${minister.prenom} ${minister.nom}`,
          date: 'Agenda officiel',
          sourceLabel: minister.sourceLabel ?? 'Source officielle',
          url: minister.agendaUrl,
        }]
      : items;
    rssCache.set(minister.id, { items: resolvedItems, ts: Date.now() });
    return resolvedItems;
  } catch {
    return minister.agendaUrl
      ? [{
          title: `Consulter l'agenda officiel de ${minister.prenom} ${minister.nom}`,
          date: 'Agenda officiel',
          sourceLabel: minister.sourceLabel ?? 'Source officielle',
          url: minister.agendaUrl,
        }]
      : [];
  }
}

// ─── API publique ─────────────────────────────────────────────────────────────

export { getMinistersForCategories, GOUVERNEMENT };

async function fetchPrimeMinisterOverride(): Promise<Partial<MinisterEnriched>> {
  if (primeMinisterCache && Date.now() - primeMinisterCache.ts < TTL_DIRECTORY) {
    return primeMinisterCache.data;
  }

  try {
    const res = await fetch('/api/ministers/prime-minister');
    if (!res.ok) return {};
    const data = await res.json() as Partial<MinisterEnriched>;
    primeMinisterCache = { data, ts: Date.now() };
    return data;
  } catch {
    return primeMinisterCache?.data ?? {};
  }
}

async function fetchGovernmentComposition(): Promise<MinisterEnriched[]> {
  if (governmentCache && Date.now() - governmentCache.ts < TTL_GOVERNMENT) {
    return governmentCache.data;
  }

  try {
    const res = await fetch('/api/ministers/composition');
    if (!res.ok) return GOUVERNEMENT.map((minister) => ({ ...minister }));
    const live = await res.json() as Array<Partial<MinisterEnriched>>;
    const president = GOUVERNEMENT.find((minister) => minister.isPresident);
    const seed = live.length > 0 ? live : GOUVERNEMENT.map((minister) => ({ ...minister }));
    const merged = seed.map((minister) => {
      const normalizedId = typeof minister.id === 'string' ? minister.id : slugifyId(minister.titre ?? '');
      const fallback =
        fallbackById(normalizedId) ??
        GOUVERNEMENT.find((item) => normalizeText(item.titre) === normalizeText(minister.titre ?? ''));

      const base: Minister = fallback ?? {
        id: normalizedId,
        prenom: minister.prenom ?? '',
        nom: minister.nom ?? '',
        titre: minister.titre ?? '',
        titreShort: minister.titreShort ?? minister.titre ?? '',
        isPM: minister.isPM,
        isPresident: minister.isPresident,
        categories: categoriesFromTitle(minister.titre ?? ''),
        portefeuilles: portfoliosFromTitle(minister.titre ?? ''),
      };

      return mergeMinister(base, {
        ...minister,
        id: base.id,
        categories: base.categories,
        portefeuilles: base.portefeuilles,
      });
    });

    const withPhotos = await Promise.all(merged.map(async (minister) => {
      const [officialMeta, wk] = await Promise.all([
        fetchOfficialProfileMeta(minister),
        enrichMinisterFromWikidata(minister),
      ]);
      return {
        ...minister,
        ...officialMeta,
        ...wk,
        photoUrl: officialMeta.photoUrl ?? wk.photoUrl ?? minister.photoUrl,
      };
    }));

    const deduped = withPhotos.filter((minister, index, array) =>
      array.findIndex((item) => item.id === minister.id) === index
    );
    const result = president && !deduped.some((minister) => minister.id === president.id)
      ? [president, ...deduped]
      : deduped;
    governmentCache = { data: result, ts: Date.now() };
    return result;
  } catch {
    return GOUVERNEMENT.map((minister) => ({ ...minister }));
  }
}

export async function resolveMinister(minister: Minister): Promise<MinisterEnriched> {
  const base = minister.isPM ? mergeMinister(minister, await fetchPrimeMinisterOverride()) : { ...minister };
  const [officialMeta, wikidata] = await Promise.all([
    fetchOfficialProfileMeta(base),
    enrichMinisterFromWikidata(base),
  ]);
  return {
    ...base,
    ...officialMeta,
    ...wikidata,
    photoUrl: officialMeta.photoUrl ?? wikidata.photoUrl ?? base.photoUrl,
  };
}

export async function getMinistersForCategoriesLive(categories: EventCategory[]): Promise<Minister[]> {
  const liveGovernment = await fetchGovernmentComposition();
  const pmIndex = liveGovernment.findIndex((minister) => minister.isPM);
  if (pmIndex !== -1) {
    liveGovernment[pmIndex] = mergeMinister(liveGovernment[pmIndex], await fetchPrimeMinisterOverride());
  }

  if (categories.length === 0) return liveGovernment;

  const seen = new Set<string>();
  const result: MinisterEnriched[] = [];
  for (const minister of liveGovernment) {
    const include = minister.isPresident || minister.isPM || minister.categories.some((category) => categories.includes(category));
    if (include && !seen.has(minister.id)) {
      seen.add(minister.id);
      result.push(minister);
    }
  }
  return result;
}

export async function getMinistersEnrichedForContext(categories: EventCategory[]): Promise<MinisterEnriched[]> {
  const ministers = await getMinistersForCategoriesLive(categories);
  return ministers.map(m => ({ ...m }));
}

export async function getFullMinisterProfile(minister: Minister): Promise<MinisterEnriched> {
  const resolved = await resolveMinister(minister);
  const [wikidata, agenda, osint] = await Promise.allSettled([
    enrichMinisterFromWikidata(resolved),
    fetchMinisterAgenda(resolved),
    fetchMinisterOpenData(resolved),
  ]);
  const agendaItems = agenda.status === 'fulfilled' ? agenda.value : [];
  const fallbackAgenda = agendaItems.length === 0 && resolved.agendaUrl
    ? [{
        title: `Consulter l'agenda officiel de ${resolved.prenom} ${resolved.nom}`,
        date: 'Agenda officiel',
        sourceLabel: resolved.sourceLabel ?? 'Source officielle',
        url: resolved.agendaUrl,
      }]
    : agendaItems;
  return {
    ...resolved,
    ...(wikidata.status === 'fulfilled' ? wikidata.value : {}),
    agendaItems: fallbackAgenda,
    osintDatasets: osint.status === 'fulfilled' ? osint.value : [],
  };
}
