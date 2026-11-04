// src/components/anticipation/anticipation-controller.ts : pilote de l'onglet Anticipation (04/11/2026), chargé à la demande par App pour
// garder le chunk App sous 1 Mio. Dans l'onglet seulement : salle montée sur la carte, relève de /api/anticipation/now toutes les
// 60 s, départements des scénarios du jour choisi colorés par mot, sur le calque des départements de la salle des pannes. Hors de
// l'onglet : rien n'est relevé ni affiché. Les scénarios nationaux (sans département) ne colorent pas la carte.
import type { AnticipationNowResponse, AnticipationScenario, AnticipationWord } from '../../types/index.ts';
import { DEPARTEMENT_CENTERS } from '../../config/departement-centers.ts';
import { fetchAnticipationNow } from '../../services/anticipation.ts';
import { ALL_WORDS, WORD_COLOR_VAR } from '../../services/anticipation-words.ts';
import { loadDepartementsGeojson } from '../../services/departements-geojson.ts';
import { AnticipationRoom } from './AnticipationRoom.ts';

/** Relève dans l'onglet Anticipation. */
export const ANTICIPATION_POLL_MS = 60_000;

/** Teintes de repli des jetons --sev-* (main.css), si la feuille de style n'est pas lisible. */
const SEV_FALLBACK: Readonly<Record<string, string>> = {
  '--sev-red': '#ff3b30', '--sev-orange': '#ff9500', '--sev-yellow': '#ffcc00', '--sev-blue': '#5ac8fa',
};

/** Couleur hexadécimale d'un jeton CSS (MapLibre ne lit pas les variables CSS). */
export function cssColor(variable: string): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
    if (v) return v;
  } catch {
    /* hors navigateur : repli */
  }
  return SEV_FALLBACK[variable] ?? '#8a8a9a';
}

export interface AnticipationMap {
  setOutagesRoom(state: { depts: GeoJSON.FeatureCollection; services?: GeoJSON.FeatureCollection } | null): void;
  flyTo(lon: number, lat: number, zoom: number): void;
  refitFrance(): void;
}

export interface AnticipationControllerOptions<T> {
  mapEl: HTMLElement;
  map: AnticipationMap;
  /** Lecture de /api/anticipation/now (défaut : fetchAnticipationNow, la précédente resservie en cas d'échec). */
  read?: () => Promise<AnticipationNowResponse>;
  /** Géométrie des départements (défaut : loadDepartementsGeojson, mémorisée). */
  loadDepts?: () => Promise<GeoJSON.FeatureCollection | null>;
  /** Jeton CSS → teinte (défaut : cssColor). */
  colorOf?: (variable: string) => string;
  schedule: (fn: () => void, ms: number) => T;
  unschedule: (timer: T | null) => void;
}

const rank = (w: AnticipationWord | ''): number => (w === '' ? -1 : ALL_WORDS.indexOf(w));

/**
 * Pur : départements des scénarios retenus (`ids` null : tous), au mot le plus haut ; propriétés `code`, `word` et `color` (teinte
 * résolue, lue par le calque de la salle). Mot sans couleur (hors v1, crise manquée) et scénario national : hors carte.
 */
export function anticipationDeptFeatures(
  scenarios: readonly AnticipationScenario[],
  ids: ReadonlySet<string> | null,
  depts: GeoJSON.FeatureCollection,
  colorOf: (variable: string) => string,
): GeoJSON.FeatureCollection {
  const byDept = new Map<string, AnticipationWord>();
  for (const s of scenarios) {
    if (ids !== null && !ids.has(s.id)) continue;
    if (s.word === '' || WORD_COLOR_VAR[s.word] === undefined) continue;
    for (const code of s.zone.dept) {
      const before = byDept.get(code);
      if (before === undefined || rank(s.word) > rank(before)) byDept.set(code, s.word);
    }
  }
  const features = depts.features.flatMap((f) => {
    const code = String(f.properties?.code ?? '');
    const word = byDept.get(code);
    const variable = word === undefined ? undefined : WORD_COLOR_VAR[word];
    return word === undefined || variable === undefined ? [] : [{ ...f, properties: { code, word, color: colorOf(variable) } }];
  });
  return { type: 'FeatureCollection', features };
}

export class AnticipationController<T = unknown> {
  private room: AnticipationRoom | null = null;
  private data: AnticipationNowResponse | null = null;
  private timer: T | null = null;
  private depts: GeoJSON.FeatureCollection | null = null;
  private readonly read: () => Promise<AnticipationNowResponse>;
  private readonly colorOf: (variable: string) => string;
  private readonly opts: AnticipationControllerOptions<T>;

  constructor(opts: AnticipationControllerOptions<T>) {
    this.opts = opts;
    this.read = opts.read ?? fetchAnticipationNow;
    this.colorOf = opts.colorOf ?? cssColor;
  }

  /** Entrée ou sortie de l'onglet Anticipation. */
  async setActive(active: boolean): Promise<void> {
    if (active === (this.room !== null)) return;
    if (active) {
      const room = new AnticipationRoom(this.opts.mapEl);
      this.room = room;
      room.onFocus((s) => this.focus(s));
      room.onDay(() => this.paintMap());
      this.depts ??= await (this.opts.loadDepts ?? loadDepartementsGeojson)();
      // Onglet quitté pendant le chargement : la sortie a déjà tout remis en place.
      if (this.room !== room) return;
      this.opts.unschedule(this.timer);
      this.timer = this.opts.schedule(() => { void this.refresh(); }, ANTICIPATION_POLL_MS);
      await this.refresh();
    } else {
      this.room?.destroy();
      this.room = null;
      this.opts.unschedule(this.timer);
      this.timer = null;
      this.opts.map.setOutagesRoom(null);
    }
  }

  destroy(): void {
    this.opts.unschedule(this.timer);
    this.timer = null;
    if (this.room) this.opts.map.setOutagesRoom(null);
    this.room?.destroy();
    this.room = null;
  }

  private async refresh(): Promise<void> {
    try {
      this.data = await this.read();
    } catch (err) {
      // Aucune réponse lisible et rien en mémoire : la salle reste sur « Chargement », nouvel essai à la relève suivante.
      console.warn('[Anticipation] lecture impossible', err);
      if (!this.data) this.room?.setUnavailable();
      return;
    }
    if (!this.room) return;
    this.room.setData(this.data);
    this.paintMap();
  }

  private paintMap(): void {
    if (!this.room) return;
    const day = this.room.currentDay();
    const ids = day === null ? null : new Set(this.data?.agenda.find((a) => a.day === day)?.scenarioIds ?? []);
    this.opts.map.setOutagesRoom({
      depts: this.depts ? anticipationDeptFeatures(this.data?.scenarios ?? [], ids, this.depts, this.colorOf) : { type: 'FeatureCollection', features: [] },
      services: { type: 'FeatureCollection', features: [] },
    });
  }

  private focus(s: AnticipationScenario): void {
    const code = s.zone.dept[0];
    const center = code === undefined ? undefined : Object.values(DEPARTEMENT_CENTERS).find((d) => d.code === code)?.center;
    if (center) this.opts.map.flyTo(center[0], center[1], 7);
    else this.opts.map.refitFrance();
  }
}
