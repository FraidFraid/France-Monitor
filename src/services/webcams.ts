// src/services/webcams.ts : lecture client de la couche Webcams : recensement statique /data/webcams.json produit par
// scripts/build-webcams.mjs (OpenStreetMap, jeux ouverts data.gouv.fr). Contrat partagé avec flux_osint (docs/webcams_format.md).
// Aucune relève : lu une fois, gardé en mémoire. Fonctions pures d'état, de couleur et de lien partagées par le panneau, la carte
// et la légende. Aucun effet sur l'indice de stabilité.
import type { Webcam, WebcamSource, WebcamStatus, WebcamsDataset } from '../types/index.ts';
import { levelHex } from './vigilance.ts';

export const WEBCAMS_URL = '/data/webcams.json';

export const WEBCAM_STATUSES: readonly WebcamStatus[] = ['ok', 'down', 'unknown'];

/** Couleur franche : vert = lien vivant au recensement ; gris = lien mort ou non vérifiable. */
export const WEBCAM_STATUS_HEX: Readonly<Record<WebcamStatus, string>> = {
  ok: levelHex('vert'),
  down: '#6b7280',
  unknown: '#9ca3af',
};

export const WEBCAM_STATUS_WORD: Readonly<Record<WebcamStatus, string>> = {
  ok: 'Lien actif',
  down: 'Lien mort',
  unknown: 'Non vérifiable',
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStrOrNull = (v: unknown): boolean => v === null || isStr(v);
const isNumOrNull = (v: unknown): boolean => v === null || isNum(v);

export function isWebcamStatus(v: unknown): v is WebcamStatus {
  return typeof v === 'string' && (WEBCAM_STATUSES as readonly string[]).includes(v);
}

function isSource(v: unknown): v is WebcamSource {
  return isRecord(v) && isNonEmpty(v['id']) && isStr(v['name']) && isStrOrNull(v['license']) && isStr(v['url']) && isNum(v['count']);
}

function isWebcam(v: unknown): v is Webcam {
  return isRecord(v) && isNonEmpty(v['id']) && isNonEmpty(v['name']) && isNum(v['lat']) && isNum(v['lon'])
    && Math.abs(v['lat']) <= 90 && Math.abs(v['lon']) <= 180
    && isStrOrNull(v['commune']) && isStrOrNull(v['dept']) && isNonEmpty(v['source'])
    && isStrOrNull(v['pageUrl']) && isStrOrNull(v['imageUrl']) && isStrOrNull(v['streamUrl'])
    && isStrOrNull(v['license']) && isStrOrNull(v['attribution']) && isWebcamStatus(v['status'])
    && isNumOrNull(v['httpStatus']) && isStrOrNull(v['contentType']) && isStrOrNull(v['checkedAt'])
    && typeof v['countable'] === 'boolean';
}

/** Garde stricte du contrat : tout fichier mal formé est rejeté (le panneau le dit, la carte reste vide). Une webcam doit citer
 *  une source déclarée. */
export function isWebcamsDataset(v: unknown): v is WebcamsDataset {
  if (!isRecord(v) || !isStr(v['generatedAt']) || !Array.isArray(v['sources']) || !Array.isArray(v['webcams'])) return false;
  if (!v['sources'].every(isSource) || !v['webcams'].every(isWebcam)) return false;
  const ids = new Set(v['sources'].map((s) => s.id));
  return v['webcams'].every((w) => ids.has(w.source));
}

let cached: Promise<WebcamsDataset> | null = null;

/** Lecture unique : le résultat est mémorisé, un échec ne l'est pas (la lecture suivante réessaie). */
export function fetchWebcamsDataset(fetchImpl: typeof fetch = fetch): Promise<WebcamsDataset> {
  cached ??= fetchImpl(WEBCAMS_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`Webcams : HTTP ${res.status}`);
      return res.json() as Promise<unknown>;
    })
    .then((body) => {
      if (!isWebcamsDataset(body)) throw new Error('Webcams : fichier mal formé');
      return body;
    })
    .catch((error: unknown) => {
      cached = null;
      throw error instanceof Error ? error : new Error('Webcams : lecture impossible');
    });
  return cached;
}

/** Tests : repart d'un cache vide. */
export function resetWebcamsCache(): void {
  cached = null;
}

// ─── Lecture ───

export function webcamColor(w: Pick<Webcam, 'status'>): string {
  return WEBCAM_STATUS_HEX[w.status];
}

/** Lien « Ouvrir la webcam » : la page publique, sinon l'image, sinon le flux ; null si aucun. */
export function webcamOpenUrl(w: Pick<Webcam, 'pageUrl' | 'imageUrl' | 'streamUrl'>): string | null {
  return w.pageUrl ?? w.imageUrl ?? w.streamUrl;
}

/** Vignette autorisée seulement pour une image directe réutilisable et vivante (countable). */
export function webcamThumbnailUrl(w: Pick<Webcam, 'countable' | 'imageUrl'>): string | null {
  return w.countable && w.imageUrl !== null ? w.imageUrl : null;
}

export function sourceOf(ds: WebcamsDataset, id: string): WebcamSource | null {
  return ds.sources.find((s) => s.id === id) ?? null;
}

export function findWebcam(ds: WebcamsDataset | null, id: string): Webcam | null {
  return ds?.webcams.find((w) => w.id === id) ?? null;
}

export interface WebcamCounts { total: number; ok: number; down: number; unknown: number; countable: number }

export function webcamCounts(list: readonly Webcam[]): WebcamCounts {
  const c: WebcamCounts = { total: list.length, ok: 0, down: 0, unknown: 0, countable: 0 };
  for (const w of list) {
    c[w.status] += 1;
    if (w.countable) c.countable += 1;
  }
  return c;
}

/** « 18/10/2026 à 19:02 » (heure de Paris) ; null si la date est illisible. */
export function frDateTime(iso: string | null): string | null {
  const ms = iso === null ? Number.NaN : Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (t: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')} à ${get('hour')}:${get('minute')}`;
}

/** Commune et département lisibles : « Lyon (69) », « Lyon », « (69) » ou « Lieu n.d. ». */
export function webcamPlace(w: Pick<Webcam, 'commune' | 'dept'>): string {
  if (w.commune && w.dept) return `${w.commune} (${w.dept})`;
  if (w.commune) return w.commune;
  if (w.dept) return `Département ${w.dept}`;
  return 'Lieu n.d.';
}
