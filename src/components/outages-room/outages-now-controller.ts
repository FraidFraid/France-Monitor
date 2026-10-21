// src/components/outages-room/outages-now-controller.ts : pilote des pannes en cours (21/10/2026), chargé à la demande par App pour
// garder le chunk App sous 1 Mio. Relève /api/outages/now (toutes les 2 min, 60 s dans l'onglet Pannes), bandeau hors de l'onglet,
// salle de contrôle et calques de carte dans l'onglet.
import type { OutageNetwork, OutagesNowResponse, OutageNow } from '../../types/index.ts';
import type { SourceSlot } from '../../services/environment-source.ts';
import { DEPARTEMENT_CENTERS } from '../../config/departement-centers.ts';
import { loadDepartementsGeojson } from '../../services/departements-geojson.ts';
import { fetchOutagesNow, OUTAGES_NOW_POLL_MS } from '../../services/outages-now.ts';
import type { VigilanceLevel } from '../../services/vigilance.ts';
import { OutagesNowBanner } from '../OutagesNowBanner.ts';
import { roomDeptFeatures } from '../deckgl/outages-room-map.ts';
import { OutagesRoom } from './OutagesRoom.ts';

/** Relève dans l'onglet Pannes. */
export const ROOM_POLL_MS = 60_000;
const RANK: Readonly<Record<VigilanceLevel, number>> = { vert: 0, jaune: 1, orange: 2, rouge: 3 };

export interface RoomMap {
  setOutagesRoom(state: { depts: GeoJSON.FeatureCollection } | null): void;
  flyTo(lon: number, lat: number, zoom: number): void;
  refitFrance(): void;
}

export interface OutagesNowControllerOptions<T> {
  mapEl: HTMLElement;
  map: RoomMap;
  /** Lecture de /api/outages/now (défaut : fetchOutagesNow, la précédente gardée en cas d'échec). */
  read?: () => Promise<OutagesNowResponse | null>;
  /** Géométrie des départements (défaut : loadDepartementsGeojson, mémorisée). */
  loadDepts?: () => Promise<GeoJSON.FeatureCollection | null>;
  schedule: (fn: () => void, ms: number) => T;
  unschedule: (timer: T | null) => void;
  /** Niveau de la panne la plus grave changé (voyant de l'onglet Pannes, repeint par App). */
  onLevelChange?: (level: VigilanceLevel | null) => void;
}

export class OutagesNowController<T = unknown> {
  private readonly banner: OutagesNowBanner;
  private room: OutagesRoom | null = null;
  private data: OutagesNowResponse | null = null;
  private slot: SourceSlot<OutagesNowResponse> | undefined;
  private timer: T | null = null;
  private filter: OutageNetwork | null = null;
  private depts: GeoJSON.FeatureCollection | null = null;
  private readonly read: () => Promise<OutagesNowResponse | null>;
  private readonly opts: OutagesNowControllerOptions<T>;

  constructor(opts: OutagesNowControllerOptions<T>) {
    this.opts = opts;
    this.banner = new OutagesNowBanner(opts.mapEl);
    this.banner.setOnFlyTo((lon, lat, zoom) => opts.map.flyTo(lon, lat, zoom));
    this.read = opts.read ?? (async () => {
      this.slot = await fetchOutagesNow(this.slot);
      return this.slot.data;
    });
  }

  /** Première lecture et relève toutes les 2 min. */
  async start(): Promise<void> {
    await this.refresh();
    this.reschedule(OUTAGES_NOW_POLL_MS);
  }

  /** Panne en cours la plus grave (niveau de l'onglet Pannes) ; null sans réponse. */
  level(): VigilanceLevel | null {
    if (!this.data) return null;
    return this.data.outages.reduce<VigilanceLevel>((m, o) => (RANK[o.level] > RANK[m] ? o.level : m), 'vert');
  }

  /** Entrée ou sortie de l'onglet Pannes. */
  async setRoomActive(active: boolean): Promise<void> {
    if (active === (this.room !== null)) return;
    if (active) {
      this.room = new OutagesRoom(this.opts.mapEl);
      this.room.setOnFocus((o) => this.focus(o));
      this.room.setOnFilter((n) => {
        this.filter = n;
        this.paintMap();
      });
      const room = this.room;
      this.depts ??= await (this.opts.loadDepts ?? loadDepartementsGeojson)();
      // Onglet quitté pendant le chargement : la sortie a déjà tout remis en place.
      if (this.room !== room) return;
      this.reschedule(ROOM_POLL_MS);
      await this.refresh();
    } else {
      this.room?.destroy();
      this.room = null;
      this.filter = null;
      this.opts.map.setOutagesRoom(null);
      this.reschedule(OUTAGES_NOW_POLL_MS);
      this.render();
    }
  }

  destroy(): void {
    this.opts.unschedule(this.timer);
    this.room?.destroy();
    this.banner.destroy();
  }

  private reschedule(ms: number): void {
    this.opts.unschedule(this.timer);
    this.timer = this.opts.schedule(() => { void this.refresh(); }, ms);
  }

  private lastLevel: VigilanceLevel | null = null;

  private async refresh(): Promise<void> {
    this.data = await this.read();
    this.render();
    const level = this.level();
    if (level !== this.lastLevel) {
      this.lastLevel = level;
      this.opts.onLevelChange?.(level);
    }
  }

  private render(): void {
    this.banner.update(this.room ? null : this.data);
    this.room?.update(this.data);
    if (this.room) this.paintMap();
  }

  private paintMap(): void {
    const outages = this.data?.outages ?? [];
    this.opts.map.setOutagesRoom({
      depts: this.depts ? roomDeptFeatures(outages, this.filter, this.depts) : { type: 'FeatureCollection', features: [] },
    });
  }

  private focus(o: OutageNow): void {
    const center = o.dept === null ? undefined : Object.values(DEPARTEMENT_CENTERS).find((d) => d.code === o.dept)?.center;
    if (center) this.opts.map.flyTo(center[0], center[1], 8);
    else this.opts.map.refitFrance();
  }
}
