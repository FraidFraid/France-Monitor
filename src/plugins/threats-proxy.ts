/**
 * threats-proxy.ts — Plugin Vite pour l'endpoint /api/threats en développement.
 * Miroir dev du proxy Vercel api/threats.js.
 *
 * Agrège FrenchBreaches + HIBP France + RansomwareLive + CERT-FR RSS et normalise en ThreatEvent[].
 * Cache interne de 10 minutes pour ne pas spammer les APIs pendant le dev.
 *
 * Endpoint : GET /api/threats
 * Response  : ThreatEvent[] (JSON)
 */

import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'http';

interface CacheEntry {
  data: unknown[];
  fetchedAt: number;
}

interface HibpBreach {
  Name?: string;
  Title?: string;
  Domain?: string;
  BreachDate?: string;
  AddedDate?: string;
  ModifiedDate?: string;
  PwnCount?: number;
  Description?: string;
  LogoPath?: string;
  DisclosureUrl?: string | null;
  DataClasses?: string[];
  IsVerified?: boolean;
  IsSensitive?: boolean;
  IsRetired?: boolean;
  IsSpamList?: boolean;
}

let devCache: CacheEntry | null = null;
const CACHE_TTL = 10 * 60_000; // 10 min
const ENTREPRISE_SEARCH_URL = 'https://recherche-entreprises.api.gouv.fr/search';
const FRENCH_BREACHES_BASE_URL = 'https://frenchbreaches.com';
const FRENCH_BREACHES_ARCHIVES_URL = `${FRENCH_BREACHES_BASE_URL}/archives.php`;
const FRENCH_BREACHES_MAP_BASE_URL = 'https://map.frenchbreaches.com';
const FRENCH_BREACHES_MAP_CACHE_URL = `${FRENCH_BREACHES_MAP_BASE_URL}/api/cache?store=editable_entries`;
const FRENCH_BREACHES_DETAIL_LIMIT = Number(process.env.FRENCH_BREACHES_DETAIL_LIMIT || 80);
const SCRAPLING_PROXY_URL = process.env.SCRAPLING_PROXY_URL || process.env.VITE_SCRAPLING_PROXY_URL || 'http://localhost:8080';
const companyGeoCache = new Map<string, GeoResolution | null>();

interface GeoResolution {
  coordinates: [number, number];
  label: string;
  precision: string;
  address?: string;
  source?: string;
  organizationProfile?: OrganizationProfile;
}

interface OrganizationProfile {
  legalName?: string;
  siren?: string;
  siret?: string;
  category?: string;
  employeeRange?: string;
  activityCode?: string;
  activitySection?: string;
  createdAt?: string;
  openEstablishments?: number;
}

const KNOWN_COMPANY_LOCATIONS: Record<string, GeoResolution> = {
  legilog: {
    coordinates: [4.828884, 46.795851],
    label: 'Châtenoy-le-Royal',
    precision: 'hq',
    address: '10 Rue de la Guerlande 71880 Châtenoy-le-Royal',
    source: 'legilog.fr',
  },
  gauthiertissus: {
    coordinates: [5.501897, 45.694788],
    label: 'Saint-Victor-de-Morestel',
    precision: 'hq',
    address: '337 Grande Rue du Bourg 38510 Saint-Victor-de-Morestel',
    source: 'gauthier-tissus.com',
  },
};

const COMPANY_QUERY_ALIASES: Record<string, string> = {
  lamaisonducitron: 'la maison du citron',
  securitevolfeu: 'securite vol feu',
  meyzietp: 'meyzie tp',
};

const KNOWN_FRENCH_BREACH_LOCATIONS: Record<string, { label: string; coordinates: [number, number]; precision: string }> = {
  anps: { label: 'Pantin', coordinates: [2.4096, 48.8956], precision: 'hq' },
  passport: { label: 'Paris', coordinates: [2.3522, 48.8566], precision: 'hq' },
  passsport: { label: 'Paris', coordinates: [2.3522, 48.8566], precision: 'hq' },
  autosur: { label: 'Suresnes', coordinates: [2.2293, 48.8714], precision: 'hq' },
  eurofiber: { label: 'Paris', coordinates: [2.3522, 48.8566], precision: 'region' },
  cultura: { label: 'Mérignac', coordinates: [-0.6451, 44.8422], precision: 'hq' },
  bouyguestelecom: { label: 'Meudon', coordinates: [2.2350, 48.8120], precision: 'hq' },
  freemobile: { label: 'Paris', coordinates: [2.3508, 48.8738], precision: 'hq' },
  ffr: { label: 'Marcoussis', coordinates: [2.2261, 48.6417], precision: 'hq' },
  boulanger: { label: 'Lesquin', coordinates: [3.1138, 50.5880], precision: 'hq' },
  frenchcitizens: { label: 'France', coordinates: [2.2137, 46.2276], precision: 'country' },
  sport2000: { label: 'Égly', coordinates: [2.2246, 48.5780], precision: 'hq' },
  ldlc: { label: 'Limonest', coordinates: [4.7719, 45.8379], precision: 'hq' },
  shadow: { label: 'Paris', coordinates: [2.3522, 48.8566], precision: 'hq' },
  zadigvoltaire: { label: 'Paris', coordinates: [2.3522, 48.8566], precision: 'hq' },
  leslipfrancais: { label: 'Paris', coordinates: [2.3522, 48.8566], precision: 'hq' },
  lapostemobile: { label: 'Paris', coordinates: [2.3522, 48.8566], precision: 'hq' },
  boursedesvols: { label: 'Paris', coordinates: [2.3522, 48.8566], precision: 'hq' },
  macgeneration: { label: 'Lyon', coordinates: [4.8357, 45.7640], precision: 'hq' },
  shortedition: { label: 'Grenoble', coordinates: [5.7245, 45.1885], precision: 'hq' },
  wizishop: { label: 'Nice', coordinates: [7.2620, 43.7102], precision: 'hq' },
  artvalue: { label: 'Paris', coordinates: [2.3522, 48.8566], precision: 'hq' },
  appartoo: { label: 'Paris', coordinates: [2.3522, 48.8566], precision: 'hq' },
  pokebip: { label: 'France', coordinates: [2.2137, 46.2276], precision: 'country' },
  minefield: { label: 'France', coordinates: [2.2137, 46.2276], precision: 'country' },
  dominos: { label: 'France', coordinates: [2.2137, 46.2276], precision: 'country' },
  alltricks: { label: 'Montigny-le-Bretonneux', coordinates: [2.0327, 48.7825], precision: 'hq' },
};

interface FrenchBreachesArchiveEntry {
  title: string;
  date: string;
  sourceUrl: string;
}

interface FrenchBreachesDetail {
  volumeText?: string;
  records?: number;
  compromisedData: string[];
}

type UnknownRecord = Record<string, unknown>;

// ─── Helpers ───

function parseSeverity(title: string): string {
  const lower = title.toLowerCase();
  if (lower.includes('critique') || lower.includes('critical') || lower.includes('0-day')) return 'critical';
  if (lower.includes('-ale') || lower.includes('importante') || lower.includes('élevé')) return 'high';
  if (lower.includes('moyenne') || lower.includes('medium')) return 'medium';
  return 'low';
}

const FRENCH_CITIES: Record<string, [number, number]> = {
  paris: [2.3522, 48.8566], lyon: [4.8357, 45.764], marseille: [5.3698, 43.2965],
  toulouse: [1.4442, 43.6047], bordeaux: [-0.5792, 44.8378], lille: [3.0573, 50.6292],
  nantes: [-1.5534, 47.2184], strasbourg: [7.7521, 48.5734], rennes: [-1.6778, 48.1173],
  nice: [7.262, 43.7102],
};

function stripHtml(input: string | undefined): string {
  return String(input || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeHtml(input: string): string {
  return input
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function htmlToText(html: string): string {
  return decodeHtml(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|section|article)>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isCloudflareChallenge(html: string): boolean {
  return /cf-mitigated|challenges\.cloudflare\.com|attention required|just a moment/i.test(html);
}

function isLikelyJson(input: string): boolean {
  return /^[\s\n\r]*[{[]/.test(input);
}

function absoluteFrenchBreachesUrl(href: string): string {
  return new URL(decodeHtml(href), FRENCH_BREACHES_BASE_URL).toString();
}

function parseFrenchBreachesDate(raw: string): string {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw.trim());
  if (!match) return new Date().toISOString();
  return new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]), 12)).toISOString();
}

async function fetchFrenchBreachesHtml(url: string): Promise<string> {
  const headers = {
    'User-Agent': 'FranceMonitor/1.0 FrenchBreachesAdapter',
    Accept: 'text/html,application/xhtml+xml',
  };

  try {
    const resp = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
    const html = await resp.text();
    if (resp.ok && !isCloudflareChallenge(html)) return html;
  } catch {
    // Direct access is often blocked by Cloudflare; try Scrapling below.
  }

  if (!SCRAPLING_PROXY_URL) throw new Error('FrenchBreaches direct fetch blocked and no Scrapling proxy configured');
  const proxyUrl = `${SCRAPLING_PROXY_URL.replace(/\/$/, '')}/scrape?url=${encodeURIComponent(url)}`;
  const proxyResp = await fetch(proxyUrl, {
    headers: { Accept: 'text/html' },
    signal: AbortSignal.timeout(18_000),
  });
  if (!proxyResp.ok) throw new Error(`FrenchBreaches Scrapling HTTP ${proxyResp.status}`);
  const html = await proxyResp.text();
  if (isCloudflareChallenge(html)) throw new Error('FrenchBreaches Scrapling returned Cloudflare challenge');
  return html;
}

async function fetchFrenchBreachesJson(url: string): Promise<unknown> {
  const text = await fetchFrenchBreachesHtml(url);
  if (!isLikelyJson(text)) throw new Error(`FrenchBreaches JSON endpoint returned non-JSON for ${url}`);
  return JSON.parse(text);
}

function isInformativeRansomwareDescription(value: unknown): boolean {
  const text = stripHtml(String(value || ''));
  return Boolean(text && !/^\[?ai generated\]?\s*n\/?a$/i.test(text) && !/^n\/?a$/i.test(text));
}

function formatDateFr(value: unknown): string | undefined {
  const date = new Date(String(value || ''));
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('fr-FR') : undefined;
}

function formatEmployeeRange(code: unknown): string | undefined {
  const ranges: Record<string, string> = {
    '00': '0 salarié',
    '01': '1 à 2 salariés',
    '02': '3 à 5 salariés',
    '03': '6 à 9 salariés',
    '11': '10 à 19 salariés',
    '12': '20 à 49 salariés',
    '21': '50 à 99 salariés',
    '22': '100 à 199 salariés',
    '31': '200 à 249 salariés',
    '32': '250 à 499 salariés',
    '41': '500 à 999 salariés',
    '42': '1 000 à 1 999 salariés',
    '51': '2 000 à 4 999 salariés',
    '52': '5 000 à 9 999 salariés',
    '53': '10 000 salariés et plus',
  };
  return ranges[String(code || '')];
}

function buildCompanyProfile(result: Record<string, any>): OrganizationProfile | undefined {
  if (!result) return undefined;
  const siege = result.siege || {};
  const openEstablishments = Number(result.nombre_etablissements_ouverts);
  return {
    legalName: stripHtml(result.nom_complet || result.nom_raison_sociale) || undefined,
    siren: stripHtml(result.siren) || undefined,
    siret: stripHtml(siege.siret) || undefined,
    category: stripHtml(result.categorie_entreprise) || undefined,
    employeeRange: formatEmployeeRange(result.tranche_effectif_salarie || siege.tranche_effectif_salarie),
    activityCode: stripHtml(result.activite_principale || siege.activite_principale) || undefined,
    activitySection: stripHtml(result.section_activite_principale) || undefined,
    createdAt: formatDateFr(result.date_creation),
    openEstablishments: Number.isFinite(openEstablishments) ? openEstablishments : undefined,
  };
}

function buildRansomwareSummary(victim: any): string {
  if (isInformativeRansomwareDescription(victim.description)) {
    return stripHtml(victim.description).slice(0, 260);
  }

  return 'La source publique ne fournit pas de détail technique confirmé sur le vecteur, le chiffrement, le volume de données ou l’impact opérationnel.';
}

function isFranceBreach(breach: HibpBreach): boolean {
  const domain = String(breach.Domain || '').toLowerCase();
  const title = String(breach.Title || '').toLowerCase();
  const description = stripHtml(breach.Description).toLowerCase();
  return domain.endsWith('.fr')
    || description.includes('french ')
    || description.includes('france')
    || title.includes('france')
    || title.includes('zadig')
    || title.includes('shadow')
    || title.includes('ldlc')
    || title.includes('materiel.net');
}

function hashOffset(seed: string): [number, number] {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = ((hash << 5) - hash) + seed.charCodeAt(i);
  const a = ((hash % 1000) / 1000) * Math.PI * 2;
  const r = 0.25 + (Math.abs(hash) % 700) / 1000;
  return [Math.cos(a) * r, Math.sin(a) * r];
}

function severityFromRecords(records: number): string {
  if (records >= 50_000_000) return 'critical';
  if (records >= 5_000_000) return 'high';
  if (records >= 500_000) return 'medium';
  return 'low';
}

function parseApproxRecords(text: string): number | undefined {
  const match = /(\d+(?:[\s.,]\d+)*)\s*(milliards?|millions?|k|records?|lignes?|clients?|victimes?|personnes?|comptes?|adhérents?|licenciés?)/i.exec(text);
  if (!match) return undefined;
  const rawNumber = match[1].replace(/\s/g, '').replace(',', '.');
  const value = Number(rawNumber);
  if (!Number.isFinite(value)) return undefined;
  const unit = match[2].toLowerCase();
  if (unit.startsWith('milliard')) return Math.round(value * 1_000_000_000);
  if (unit.startsWith('million')) return Math.round(value * 1_000_000);
  if (unit === 'k') return Math.round(value * 1_000);
  return Math.round(value);
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = stripHtml(String(value || '')).trim();
    if (text && text !== 'undefined' && text !== 'null' && text !== 'N/A') return text;
  }
  return undefined;
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const parsed = Number(String(value || '').replace(',', '.'));
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function coerceStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => stripHtml(String(item))).filter(Boolean).slice(0, 12);
  if (typeof value === 'string') {
    return value
      .split(/[,;|•\n]/)
      .map((item) => stripHtml(item))
      .filter(Boolean)
      .slice(0, 12);
  }
  return [];
}

function parseAnyDate(...values: unknown[]): string {
  for (const value of values) {
    if (!value) continue;
    const direct = new Date(String(value));
    if (Number.isFinite(direct.getTime())) return direct.toISOString();

    const fr = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(value).trim());
    if (fr) return new Date(Date.UTC(Number(fr[3]), Number(fr[2]) - 1, Number(fr[1]), 12)).toISOString();
  }
  return new Date().toISOString();
}

function extractArrayPayload(payload: unknown): UnknownRecord[] {
  if (Array.isArray(payload)) return payload.filter((item): item is UnknownRecord => Boolean(item && typeof item === 'object' && !Array.isArray(item)));
  if (!payload || typeof payload !== 'object') return [];
  const obj = payload as UnknownRecord;
  const candidates = [
    obj.entries,
    obj.editable_entries,
    obj.incidents,
    obj.items,
    obj.records,
    obj.data,
    (obj.cache as UnknownRecord | undefined)?.entries,
    (obj.cache as UnknownRecord | undefined)?.items,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.filter((item): item is UnknownRecord => Boolean(item && typeof item === 'object' && !Array.isArray(item)));
  }
  if (Array.isArray((obj as any).features)) {
    return ((obj as any).features as unknown[])
      .map((feature: any) => ({ ...(feature.properties || {}), geometry: feature.geometry }))
      .filter((item): item is UnknownRecord => Boolean(item && typeof item === 'object'));
  }
  return [];
}

function extractCoordinates(raw: UnknownRecord): [number, number] | undefined {
  const geometry = raw.geometry as { coordinates?: unknown } | undefined;
  if (Array.isArray(geometry?.coordinates)) {
    const [lng, lat] = geometry.coordinates as unknown[];
    const lonNum = firstNumber(lng);
    const latNum = firstNumber(lat);
    if (lonNum != null && latNum != null) return [lonNum, latNum];
  }

  const lat = firstNumber(raw.lat, raw.latitude, raw.y);
  const lng = firstNumber(raw.lng, raw.lon, raw.longitude, raw.x);
  if (lat == null || lng == null) return undefined;
  return [lng, lat];
}

function normalizeCountryCode(country: string | undefined): string | undefined {
  if (!country) return undefined;
  const upper = country.trim().toUpperCase();
  const aliases: Record<string, string> = {
    FRANCE: 'FR',
    FRENCH: 'FR',
    UNITED_STATES: 'US',
    'UNITED STATES': 'US',
    USA: 'US',
    CANADA: 'CA',
    'UNITED KINGDOM': 'GB',
    UK: 'GB',
    GERMANY: 'DE',
    DEUTSCHLAND: 'DE',
    SWITZERLAND: 'CH',
    BELGIUM: 'BE',
    SPAIN: 'ES',
    ITALY: 'IT',
  };
  return aliases[upper] || (upper.length <= 3 ? upper : undefined);
}

function normalizeFrenchBreachesMapEvent(raw: UnknownRecord, index: number): unknown | null {
  const organizationName = firstString(
    raw.name,
    raw.title,
    raw.company,
    raw.victim,
    raw.organization,
    raw.organizationName,
    raw.domain,
  );
  if (!organizationName) return null;

  const coordinates = extractCoordinates(raw);
  if (!coordinates) return null;

  const sourceType = firstString(raw.type, raw.kind, raw.category, raw.attack_type, raw.attackType, raw.source_type);
  const ransomwareGroup = firstString(raw.group, raw.group_name, raw.ransomware_group, raw.ransomwareGroup, raw.actor);
  const type = ransomwareGroup || /ransom/i.test(sourceType || '') ? 'ransomware' : 'leak';
  const records = firstNumber(raw.records, raw.record_count, raw.recordCount, raw.count, raw.volume, raw.volume_records)
    ?? parseApproxRecords(firstString(raw.records_text, raw.volume_text, raw.description, raw.summary) || '');
  const countryName = firstString(raw.country, raw.country_name, raw.countryName);
  const countryCode = normalizeCountryCode(firstString(raw.country_code, raw.countryCode, countryName));
  const city = firstString(raw.city, raw.locality, raw.region, raw.state, raw.location);
  const compromisedData = [
    ...coerceStringArray(raw.compromisedData),
    ...coerceStringArray(raw.dataClasses),
    ...coerceStringArray(raw.data_types),
    ...coerceStringArray(raw.dataTypes),
    ...extractKnownDataClasses(firstString(raw.description, raw.summary) || ''),
  ].filter((value, idx, arr) => arr.indexOf(value) === idx).slice(0, 12);
  const date = parseAnyDate(raw.date, raw.publishedAt, raw.published_at, raw.discovered, raw.created_at, raw.createdAt);
  const sourceUrl = firstString(raw.url, raw.sourceUrl, raw.source_url, raw.link) || FRENCH_BREACHES_MAP_BASE_URL;

  return {
    id: `frenchbreaches-map-${firstString(raw.id, raw.uuid, raw.slug) || `${organizationName}-${date}-${index}`}`.replace(/\s+/g, '-').toLowerCase(),
    type,
    organizationName,
    domain: firstString(raw.domain, raw.website),
    countryCode,
    countryName,
    flagEmoji: countryCode === 'FR' ? '🇫🇷' : undefined,
    ransomwareGroup,
    sourceLabel: 'FrenchBreaches Map',
    location: {
      label: city || countryName || countryCode || 'Localisation OSINT',
      coordinates,
      precision: city ? 'city' : 'country',
      source: 'map.frenchbreaches.com',
    },
    severity: type === 'ransomware' ? 'high' : severityFromRecords(records || 0),
    confidence: 'medium',
    sector: firstString(raw.sector, raw.industry, raw.activity) || 'OSINT',
    date,
    summary: firstString(raw.summary, raw.description)
      || `${organizationName} est référencée dans la carte FrenchBreaches 30 jours.`,
    compromisedData,
    dataClasses: compromisedData,
    metrics: { records, sources: 1 },
    sources: [{ name: 'FrenchBreaches Map', url: sourceUrl, observedAt: new Date().toISOString() }],
  };
}

async function fetchFrenchBreachesMapEvents(): Promise<unknown[]> {
  const payload = await fetchFrenchBreachesJson(FRENCH_BREACHES_MAP_CACHE_URL);
  return extractArrayPayload(payload)
    .map((entry, index) => normalizeFrenchBreachesMapEvent(entry, index))
    .filter(Boolean);
}

function extractKnownDataClasses(text: string): string[] {
  const known = [
    'Adresse email',
    'Email',
    'Nom et prénom',
    'Nom',
    'Prénom',
    'Téléphone',
    'Numéro de téléphone',
    'Adresse postale',
    'Date de naissance',
    'Mot de passe',
    "Historique d'achat",
    'Historique de commandes',
    'Identifiant',
    'Adresse IP',
    "Documents d'identité",
    'IBAN',
    'Données bancaires',
    'Données de santé',
    'Données administratives',
  ];
  const found = new Set<string>();
  for (const label of known) {
    const re = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    if (re.test(text)) found.add(label.replace(/\\/g, ''));
  }
  return [...found].slice(0, 10);
}

function parseFrenchBreachesArchive(html: string): FrenchBreachesArchiveEntry[] {
  const alertBlock = html.split(/Articles de Blog/i)[0] || html;
  const entries: FrenchBreachesArchiveEntry[] = [];
  const seen = new Set<string>();
  const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let match: RegExpExecArray | null;

  while ((match = liRegex.exec(alertBlock)) !== null) {
    const li = match[1];
    if (!/alertes\//i.test(li)) continue;
    const date = /\[(\d{2}\/\d{2}\/\d{4})\]/.exec(htmlToText(li))?.[1];
    const anchor = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i.exec(li);
    if (!date || !anchor) continue;
    const sourceUrl = absoluteFrenchBreachesUrl(anchor[1]);
    const title = htmlToText(anchor[2]).trim();
    if (!title || seen.has(sourceUrl)) continue;
    seen.add(sourceUrl);
    entries.push({ title, date: parseFrenchBreachesDate(date), sourceUrl });
  }

  return entries;
}

function parseFrenchBreachesDetail(html: string): FrenchBreachesDetail {
  const text = htmlToText(html);
  const volumeText = /(Volume non chiffré[^.]*|(?:près de\s+|plus de\s+|environ\s+|jusqu'à\s+|jusqu’à\s+)?\d[\d\s.,]*(?:milliards?|millions?|k|records?|lignes?|clients?|victimes?|personnes?|comptes?|adhérents?|licenciés?)[^.]{0,180})/i.exec(text)?.[1]?.trim();
  const compromisedBlock = /Données compromises\s+([\s\S]*?)(?:A lire aussi|Retour aux alertes|Publicite|©)/i.exec(text)?.[1] || text;
  return {
    volumeText,
    records: volumeText ? parseApproxRecords(volumeText) : parseApproxRecords(text),
    compromisedData: extractKnownDataClasses(compromisedBlock),
  };
}

function shouldEnrichFrenchBreachesDetail(index: number): boolean {
  return index < Math.max(0, FRENCH_BREACHES_DETAIL_LIMIT);
}

async function resolveFrenchBreachesGeo(entry: FrenchBreachesArchiveEntry, index: number): Promise<GeoResolution> {
  const key = entry.title.toLowerCase().replace(/[^a-z0-9]/g, '');
  const known = KNOWN_FRENCH_BREACH_LOCATIONS[key];
  if (known) {
    return {
      label: known.label,
      coordinates: known.coordinates,
      precision: known.precision,
      source: 'FrenchBreachesAdapter known location',
    };
  }

  const companyGeo = await resolveCompanyGeo({ organization: entry.title, company: entry.title });
  if (companyGeo) return companyGeo;

  const offset = hashOffset(`frenchbreaches-${entry.title}-${index}`);
  return {
    label: 'France',
    coordinates: [2.2137 + offset[0], 46.2276 + offset[1]] as [number, number],
    precision: 'country',
    source: 'FrenchBreachesAdapter country fallback',
  };
}

function normalizeFrenchBreachesEvent(
  entry: FrenchBreachesArchiveEntry,
  detail: FrenchBreachesDetail | null,
  location: GeoResolution,
): unknown {
  const key = entry.title.toLowerCase().replace(/[^a-z0-9]/g, '');
  const records = detail?.records;
  const compromisedData = detail?.compromisedData || [];
  const volumeText = detail?.volumeText || 'volume non enrichi';

  return {
    id: `frenchbreaches-${entry.sourceUrl.split('/').pop() || key}`,
    type: 'leak',
    organizationName: entry.title,
    countryCode: 'FR',
    countryName: 'France',
    flagEmoji: '🇫🇷',
    sourceLabel: 'FrenchBreaches',
    location: {
      label: location.label,
      coordinates: location.coordinates,
      precision: location.precision,
      address: location.address,
      source: location.source,
    },
    severity: severityFromRecords(records || 0),
    confidence: detail ? 'high' : 'medium',
    sector: 'Data breach',
    date: entry.date,
    summary: `${entry.title} est référencée par FrenchBreaches comme fuite de données française. ${volumeText}.`,
    compromisedData,
    dataClasses: compromisedData,
    metrics: { records, sources: 1 },
    sources: [{ name: 'FrenchBreaches', url: entry.sourceUrl, observedAt: new Date().toISOString() }],
  };
}

function resolveHibpLocation(breach: HibpBreach, index: number): { label: string; coordinates: [number, number]; precision: string } {
  const key = String(breach.Name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const known = KNOWN_FRENCH_BREACH_LOCATIONS[key];
  if (known) return known;

  const offset = hashOffset(`${breach.Name}-${index}`);
  return {
    label: 'France',
    coordinates: [2.2137 + offset[0], 46.2276 + offset[1]],
    precision: 'country',
  };
}

function resolveGeo(city?: string, region?: string): GeoResolution {
  if (city) {
    const key = city.toLowerCase().split(/[\s,]+/)[0];
    if (FRENCH_CITIES[key]) return { coordinates: FRENCH_CITIES[key], label: city, precision: 'city' };
  }
  return { coordinates: [2.2137, 46.2276], label: region ?? 'France', precision: region ? 'region' : 'country' };
}

function normalizeCompanyQuery(input: unknown): string {
  let value = stripHtml(String(input || ''))
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\.(fr|com|net|org|eu|io|co|biz|info)(\/.*)?$/i, '')
    .replace(/[-_.]+/g, ' ')
    .replace(/\b(sas|sasu|sa|sarl|eurl|gmbh|ltd|llc|inc|corp|group|groupe|holding)\b/g, ' ')
    .replace(/[^a-z0-9àâäçéèêëîïôöùûüÿñæœ' ]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (value.includes('/')) value = value.split('/')[0].trim();
  return value.length >= 3 ? value : '';
}

function extractDomainName(website: unknown): string {
  if (!website) return '';
  try {
    const host = new URL(String(website).startsWith('http') ? String(website) : `https://${String(website)}`).hostname;
    return normalizeCompanyQuery(host);
  } catch {
    return normalizeCompanyQuery(website);
  }
}

function buildCompanyQueries(victim: Record<string, unknown>): string[] {
  const candidates = [
    victim.post_title,
    victim.company,
    victim.organization,
    extractDomainName(victim.website),
    extractDomainName(victim.domain),
  ];
  const seen = new Set<string>();
  const queries = candidates
    .map(normalizeCompanyQuery)
    .filter((query) => Boolean(query) && !seen.has(query) && Boolean(seen.add(query)))
    .slice(0, 4);
  for (const query of [...queries]) {
    const compact = query.replace(/\s+/g, '');
    const alias = COMPANY_QUERY_ALIASES[compact];
    if (alias && !seen.has(alias)) {
      seen.add(alias);
      queries.push(alias);
    }
  }
  return queries.slice(0, 6);
}

function parseSireneCoordinates(siege: Record<string, unknown> | undefined): [number, number] | null {
  const lat = Number(siege?.latitude);
  const lon = Number(siege?.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lon)) return [lon, lat];

  const raw = String(siege?.coordonnees || '');
  const [rawLat, rawLon] = raw.split(',').map((part) => Number(part.trim()));
  if (Number.isFinite(rawLat) && Number.isFinite(rawLon)) return [rawLon, rawLat];
  return null;
}

function scoreCompanyResult(result: Record<string, any>, query: string): number {
  const haystack = [
    result?.nom_complet,
    result?.nom_raison_sociale,
    result?.sigle,
    result?.siege?.enseigne,
    result?.siege?.nom_commercial,
  ].map(normalizeCompanyQuery).filter(Boolean).join(' ');
  const words = query.split(/\s+/).filter((word) => word.length >= 3);
  if (!words.length || !haystack) return 0;
  return words.filter((word) => haystack.includes(word)).length / words.length;
}

async function resolveCompanyGeo(victim: Record<string, any>): Promise<GeoResolution | null> {
  const queries = buildCompanyQueries(victim);
  for (const query of queries) {
    const known = KNOWN_COMPANY_LOCATIONS[query.replace(/\s+/g, '')];
    if (known) return known;
    if (companyGeoCache.has(query)) return companyGeoCache.get(query) ?? null;

    try {
      const url = `${ENTREPRISE_SEARCH_URL}?q=${encodeURIComponent(query)}&per_page=3`;
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'FranceMonitor/1.0 company-geocoder-dev', Accept: 'application/json' },
        signal: AbortSignal.timeout(5_000),
      });
      if (!resp.ok) continue;

      const data = await resp.json() as { results?: Record<string, any>[] };
      const results = Array.isArray(data.results) ? data.results : [];
      const match = results
        .map((result) => ({ result, coordinates: parseSireneCoordinates(result.siege), score: scoreCompanyResult(result, query) }))
        .filter((item): item is { result: Record<string, any>; coordinates: [number, number]; score: number } => Boolean(item.coordinates) && item.score >= 0.5)
        .sort((a, b) => b.score - a.score)[0];

      if (match) {
        const siege = match.result.siege || {};
        const geo: GeoResolution = {
          coordinates: match.coordinates,
          label: String(siege.libelle_commune || match.result.nom_raison_sociale || victim.city || 'France'),
          precision: 'hq',
          address: typeof siege.adresse === 'string' ? siege.adresse : undefined,
          source: 'recherche-entreprises.api.gouv.fr',
          organizationProfile: buildCompanyProfile(match.result),
        };
        companyGeoCache.set(query, geo);
        return geo;
      }

      companyGeoCache.set(query, null);
    } catch {
      // Best-effort enrichment: keep the event with the geographic fallback.
    }
  }
  return null;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

// ─── Source 0 : FrenchBreaches registry France ───

async function fetchFrenchBreachesLeaks(): Promise<unknown[]> {
  const archiveHtml = await fetchFrenchBreachesHtml(FRENCH_BREACHES_ARCHIVES_URL);
  const entries = parseFrenchBreachesArchive(archiveHtml).slice(0, 450);
  if (!entries.length) return [];

  return mapLimit(entries, 4, async (entry, index) => {
    let detail: FrenchBreachesDetail | null = null;
    if (shouldEnrichFrenchBreachesDetail(index)) {
      try {
        detail = parseFrenchBreachesDetail(await fetchFrenchBreachesHtml(entry.sourceUrl));
      } catch {
        detail = null;
      }
    }
    const geo = await resolveFrenchBreachesGeo(entry, index);
    return normalizeFrenchBreachesEvent(entry, detail, geo);
  });
}

// ─── Source 1 : HaveIBeenPwned breaches France ───

async function fetchHibpFranceBreaches(): Promise<unknown[]> {
  const resp = await fetch('https://haveibeenpwned.com/api/v3/breaches', {
    headers: { 'User-Agent': 'FranceMonitor/1.0 breach-map-dev', Accept: 'application/json' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!resp.ok) throw new Error(`HIBP HTTP ${resp.status}`);

  const raw = await resp.json() as HibpBreach[];
  return (Array.isArray(raw) ? raw : [])
    .filter((b) => !b.IsRetired && !b.IsSpamList && b.Name && b.Title && isFranceBreach(b))
    .sort((a, b) => new Date(b.AddedDate || b.ModifiedDate || b.BreachDate || 0).getTime() - new Date(a.AddedDate || a.ModifiedDate || a.BreachDate || 0).getTime())
    .slice(0, 304)
    .map((b, index) => {
      const location = resolveHibpLocation(b, index);
      const records = Number(b.PwnCount || 0);
      const dataClasses = Array.isArray(b.DataClasses) ? b.DataClasses.slice(0, 8) : [];
      return {
        id: `hibp-${b.Name}`,
        type: 'leak',
        organizationName: b.Title,
        domain: b.Domain || undefined,
        logoUrl: b.LogoPath || undefined,
        countryCode: 'FR',
        countryName: 'France',
        flagEmoji: '🇫🇷',
        sourceLabel: 'HIBP',
        location: {
          label: location.label,
          coordinates: location.coordinates,
          precision: location.precision,
        },
        severity: severityFromRecords(records),
        confidence: b.IsVerified ? 'high' : 'medium',
        sector: b.IsSensitive ? 'Sensitive' : 'Data breach',
        date: b.AddedDate || b.ModifiedDate || b.BreachDate,
        summary: stripHtml(b.Description).slice(0, 420),
        compromisedData: dataClasses,
        dataClasses,
        metrics: { records, sources: 1 },
        sources: [{
          name: 'Have I Been Pwned',
          url: b.DisclosureUrl || `https://haveibeenpwned.com/PwnedWebsites#${b.Name}`,
          observedAt: new Date().toISOString(),
        }],
      };
    });
}

// ─── Source 2 : RansomwareLive ───

async function fetchRansomware(): Promise<unknown[]> {
  const resp = await fetch('https://data.ransomware.live/posts.json', {
    headers: { 'User-Agent': 'FranceMonitor/1.0 (dev)', Accept: 'application/json' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!resp.ok) throw new Error(`RansomwareLive HTTP ${resp.status}`);

  const raw: any[] = await resp.json();
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

  const victims = (Array.isArray(raw) ? raw : [])
    .filter(v => {
      const c = (v.country || '').toLowerCase();
      return (c === 'france' || c === 'fr') && new Date(v.discovered).getTime() > thirtyDaysAgo;
    })
    .slice(0, 50);

  return mapLimit(victims, 4, async (v, i) => {
      const geo = await resolveCompanyGeo(v) || resolveGeo(v.city, v.region);
      let domain: string | undefined;
      if (v.website) {
        try { domain = new URL(v.website.startsWith('http') ? v.website : `https://${v.website}`).hostname; } catch { /* ignore */ }
      }
      const organizationProfile = geo.organizationProfile;
      return {
        id: `rl-${i}-${new Date(v.discovered).getTime()}`,
        type: 'ransomware',
        organizationName: v.post_title || 'Organisation inconnue',
        domain,
        location: {
          label: geo.label,
          coordinates: geo.coordinates,
          precision: geo.precision,
          address: geo.address,
          source: geo.source,
        },
        severity: 'high',
        confidence: 'high',
        sector: v.activity || 'Inconnu',
        organizationProfile,
        date: v.discovered,
        summary: buildRansomwareSummary(v),
        metrics: { sources: 1 },
        ransomwareGroup: v.group_name || undefined,
        sourceLabel: 'RansomwareLive',
        countryCode: 'FR',
        countryName: 'France',
        flagEmoji: '🇫🇷',
        sources: [{ name: 'RansomwareLive', url: v.post_url || 'https://ransomware.live', observedAt: new Date().toISOString() }],
      };
    });
}

// ─── Source 3 : CERT-FR RSS ───

async function fetchCertFr(): Promise<unknown[]> {
  const resp = await fetch('https://www.cert.ssi.gouv.fr/feed/', {
    headers: { 'User-Agent': 'FranceMonitor/1.0 (dev)', Accept: 'text/xml' },
    signal: AbortSignal.timeout(8_000),
  });
  if (!resp.ok) throw new Error(`CERT-FR HTTP ${resp.status}`);

  const xml = await resp.text();
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const items: unknown[] = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = re.exec(xml)) !== null && items.length < 15) {
    const block = match[1];
    const title = (/<title><!\[CDATA\[(.*?)\]\]><\/title>/.exec(block) || /<title>(.*?)<\/title>/.exec(block))?.[1]?.trim();
    const link  = (/<link>(.*?)<\/link>/.exec(block))?.[1]?.trim();
    const pub   = (/<pubDate>(.*?)<\/pubDate>/.exec(block))?.[1]?.trim();
    if (!title || !pub) { i++; continue; }

    const d = new Date(pub);
    if (d.getTime() < thirtyDaysAgo) { i++; continue; }

    items.push({
      id: `cf-${i}-${d.getTime()}`,
      type: 'vulnerability',
      organizationName: 'CERT-FR / ANSSI',
      domain: 'cert.ssi.gouv.fr',
      countryCode: 'FR',
      countryName: 'France',
      flagEmoji: '🇫🇷',
      sourceLabel: 'CERT-FR',
      location: { label: 'Paris', coordinates: [2.3522, 48.8566], precision: 'hq' },
      severity: parseSeverity(title),
      confidence: 'high',
      sector: 'Gouvernement',
      date: d.toISOString(),
      summary: title,
      sources: [{ name: 'CERT-FR', url: link || 'https://www.cert.ssi.gouv.fr', observedAt: new Date().toISOString() }],
    });
    i++;
  }
  return items;
}

// ─── Plugin ───

export function threatsProxyPlugin(): Plugin {
  return {
    name: 'threats-proxy',
    configureServer(server) {
      server.middlewares.use('/api/threats', async (_req: IncomingMessage, res: ServerResponse) => {
        const now = Date.now();

        // Serve from cache if fresh
        if (devCache && (now - devCache.fetchedAt) < CACHE_TTL) {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'public, max-age=600');
          res.end(JSON.stringify(devCache.data));
          return;
        }

        try {
          console.log('[threats-proxy] Fetching threat events from FrenchBreaches Map + Archives + HIBP + RansomwareLive + CERT-FR...');
          const [fbMapResult, fbResult, hibpResult, rl, cf] = await Promise.allSettled([
            fetchFrenchBreachesMapEvents(),
            fetchFrenchBreachesLeaks(),
            fetchHibpFranceBreaches(),
            fetchRansomware(),
            fetchCertFr(),
          ]);
          const frenchBreachesMap = fbMapResult.status === 'fulfilled' ? fbMapResult.value : [];
          const frenchBreaches = fbResult.status === 'fulfilled' ? fbResult.value : [];
          const hibp = hibpResult.status === 'fulfilled' ? hibpResult.value : [];
          const ransomware = rl.status === 'fulfilled' ? rl.value : [];
          const certFr    = cf.status === 'fulfilled' ? cf.value : [];

          // Dedup
          const seen = new Set<string>();
          const events = [...frenchBreachesMap, ...frenchBreaches, ...hibp, ...ransomware, ...certFr].filter((e: any) => {
            const key = `${(e.organizationName as string).toLowerCase()}-${e.type}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });

          devCache = { data: events, fetchedAt: now };
          console.log(`[threats-proxy] Returning ${events.length} threat events (${frenchBreachesMap.length} FrenchBreaches map + ${frenchBreaches.length} FrenchBreaches archive + ${hibp.length} HIBP leaks + ${ransomware.length} ransomware + ${certFr.length} cert-fr)`);

          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'public, max-age=600');
          res.end(JSON.stringify(events));
        } catch (err) {
          console.error('[threats-proxy] Error:', err);
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Aggregation failed' }));
        }
      });
    },
  };
}
