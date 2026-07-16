import type { MtgFrpMetadata } from '../types/index.ts';

export type { MtgFrpMetadata } from '../types/index.ts';

export interface MtgMapRequestInput {
  bbox: string | null;
  width: string | null;
  height: string | null;
  time?: string | null;
}

export interface ValidatedMtgMapRequest {
  bbox: string;
  width: number;
  height: number;
  time?: string;
}

const API_PATH = '/api/fire-observations/mtg-frp';
const CACHE_TTL_MS = 120_000;
const FETCH_TIMEOUT_MS = 10_000;
const WEB_MERCATOR_LIMIT = 20_037_508.342789244;
const ISO_INSTANT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;

let metadataCache: MtgFrpMetadata | null = null;
let metadataCachedAt = 0;

function isIsoInstant(value: string): boolean {
  const match = ISO_INSTANT_PATTERN.exec(value);
  if (!match) return false;

  const [, year, month, day, hour, minute, second, fraction = ''] = match;
  const instant = new Date(0);
  instant.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  instant.setUTCHours(Number(hour), Number(minute), Number(second), Number(fraction.padEnd(3, '0')));

  return instant.getUTCFullYear() === Number(year)
    && instant.getUTCMonth() === Number(month) - 1
    && instant.getUTCDate() === Number(day)
    && instant.getUTCHours() === Number(hour)
    && instant.getUTCMinutes() === Number(minute)
    && instant.getUTCSeconds() === Number(second)
    && instant.getUTCMilliseconds() === Number(fraction.padEnd(3, '0'));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readAttribute(attributes: string, name: string): string | null {
  const match = attributes.match(new RegExp(`\\b${escapeRegExp(name)}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
  return match?.[2]?.trim() ?? null;
}

export function parseMtgCapabilities(xml: string): Pick<MtgFrpMetadata, 'observedAt'> {
  const frpLayer = xml.match(
    /<Layer\b[^>]*>(?:(?!<Layer\b)[\s\S])*?<Name\b[^>]*>\s*FRP\s*<\/Name>(?:(?!<Layer\b)[\s\S])*?<\/Layer>/i,
  )?.[0];
  if (!frpLayer) {
    throw new Error('MTG-FRP capabilities do not expose the FRP layer');
  }

  const dimensions = frpLayer.matchAll(/<Dimension\b([^>]*)>/gi);
  for (const dimension of dimensions) {
    const attributes = dimension[1] ?? '';
    if (readAttribute(attributes, 'name')?.toLowerCase() !== 'time') continue;
    const observedAt = readAttribute(attributes, 'default');
    if (observedAt && isIsoInstant(observedAt)) return { observedAt };
  }

  throw new Error('MTG-FRP capabilities do not contain a default ISO time');
}

function parseDimension(value: string | null, name: string): number {
  if (value === null || !/^\d+$/.test(value)) {
    throw new Error(`${name} must be an integer between 1 and 1024`);
  }
  const parsed = Number(value);
  if (parsed < 1 || parsed > 1024) {
    throw new Error(`${name} must be an integer between 1 and 1024`);
  }
  return parsed;
}

export function validateMtgMapRequest(input: MtgMapRequestInput): ValidatedMtgMapRequest {
  if (!input.bbox) throw new Error('bbox is required');

  const parts = input.bbox.split(',');
  if (parts.length !== 4 || parts.some((part) => part.trim() === '')) {
    throw new Error('bbox must contain four EPSG:3857 coordinates');
  }
  const coordinates = parts.map(Number);
  if (coordinates.some((coordinate) => !Number.isFinite(coordinate))) {
    throw new Error('bbox must contain four finite EPSG:3857 coordinates');
  }
  if (coordinates.some((coordinate) => Math.abs(coordinate) > WEB_MERCATOR_LIMIT)) {
    throw new Error('bbox is outside EPSG:3857 bounds');
  }
  const [minX, minY, maxX, maxY] = coordinates;
  if (minX >= maxX || minY >= maxY) {
    throw new Error('bbox minimums must be lower than maximums');
  }

  const width = parseDimension(input.width, 'width');
  const height = parseDimension(input.height, 'height');
  const time = input.time?.trim();
  if (time && !isIsoInstant(time)) throw new Error('time must be an ISO UTC instant');

  return {
    bbox: coordinates.join(','),
    width,
    height,
    ...(time ? { time } : {}),
  };
}

function isMtgFrpMetadata(value: unknown): value is MtgFrpMetadata {
  if (!value || typeof value !== 'object') return false;
  const metadata = value as Record<string, unknown>;
  return typeof metadata.observedAt === 'string'
    && isIsoInstant(metadata.observedAt)
    && typeof metadata.fetchedAt === 'number'
    && Number.isFinite(metadata.fetchedAt)
    && metadata.cadenceMinutes === 10
    && metadata.attribution === 'EUMETSAT LSA SAF · CC BY 4.0'
    && metadata.demonstration === true;
}

async function requestMetadata(): Promise<MtgFrpMetadata> {
  const response = await fetch(`${API_PATH}?operation=metadata`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`MTG-FRP metadata HTTP ${response.status}`);
  const payload: unknown = await response.json();
  if (!isMtgFrpMetadata(payload)) throw new Error('Invalid MTG-FRP metadata response');
  return payload;
}

export async function fetchMtgFrpMetadata(force = false): Promise<MtgFrpMetadata> {
  const now = Date.now();
  if (!force && metadataCache && now - metadataCachedAt < CACHE_TTL_MS) {
    return metadataCache;
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      metadataCache = await requestMetadata();
      metadataCachedAt = Date.now();
      return metadataCache;
    } catch (error) {
      lastError = error;
    }
  }

  if (metadataCache) return metadataCache;
  throw lastError instanceof Error ? lastError : new Error('MTG-FRP metadata unavailable');
}

export function getMtgFrpTileTemplate(): string {
  return `${API_PATH}?operation=map&bbox={bbox-epsg-3857}&width=256&height=256`;
}
