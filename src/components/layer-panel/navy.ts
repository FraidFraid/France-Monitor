// src/components/layer-panel/navy.ts : lignes de la Marine nationale partagées par les panneaux Trafic maritime et Défense (spec
// 2026-10-04 souveraineté § 2.1 ; contrats § 3.7, arbitrage 7). Logique reprise de maritime-tabs.ts sans changement : flux figé
// (isTrafficDataLate('ais'), même seuil que l'en-tête), homonymes, ligne d'un navire. Ajouts : un sous-marin (SNLE, SNA) n'est jamais
// observé et retiré de la liste affichée (O11) ; les bâtiments vus en AIS passent d'abord. Panneau Défense : « port base » (S2). Pur, sans réseau ni DOM.
import type { AisConnectionStatus } from '../../services/ais-connection.ts';
import { isTrafficDataLate } from '../../services/traffic-levels.ts';
import type { MilitaryShip, RiskLevel } from '../../services/military-ships.ts';
import type { VigilanceLevel } from '../../services/vigilance.ts';
import { absoluteTime } from '../fiche/kit.ts';
import { listRow } from './frame.ts';
import { fold, formatKm, formatKnots } from './traffic-format.ts';

/** Risque d'un navire (critères de military-ships.ts) dans la palette des niveaux : aucun vert, faible jaune, modéré orange, élevé et critique rouge. */
export const RISK_LEVEL: Readonly<Record<RiskLevel, VigilanceLevel>> = { none: 'vert', low: 'jaune', medium: 'orange', high: 'rouge', critical: 'rouge' };

/** Positions lues dans le WebSocket du navigateur (getMilitaryShips, getAisConnectionState), à chaque rendu. */
export interface NavyLiveInput { status: AisConnectionStatus; lastMessageAt: number | null; ships: readonly MilitaryShip[] }
/** `frozen` : flux figé (T3) ; `headDown` : l'en-tête du panneau dit lui-même « AIS indisponible ». */
export interface NavyLiveState { frozen: boolean; headDown: boolean }

/**
 * Flux figé : même seuil que l'en-tête et la Veille du Trafic maritime (isTrafficDataLate('ais'), 5 min sans message) ; sans aucun
 * message, seulement après l'attente initiale ou la coupure de la liaison.
 */
export function navyLiveState(live: Pick<NavyLiveInput, 'status' | 'lastMessageAt'>, headDown: boolean, now: number): NavyLiveState {
  const frozen = live.lastMessageAt === null ? live.status === 'stale' || live.status === 'disconnected'
    : isTrafficDataLate('ais', new Date(live.lastMessageAt).toISOString(), now);
  return { frozen, headDown };
}

/** « AIS indisponible » seulement quand l'en-tête le dit ; sinon « Liaison directe interrompue ». */
export function frozenWord(state: NavyLiveState): string {
  return state.headDown ? 'AIS indisponible' : 'Liaison directe interrompue';
}

/** Nom du pavillon (« FR|France » : « France ») ; vide sans pavillon connu. */
export function flagName(s: MilitaryShip): string {
  return (s.country ?? '').split('|')[1] ?? '';
}

/** Noms portés par plusieurs navires (comparés sans accents ni casse). */
export function homonymKeys(ships: readonly MilitaryShip[]): Set<string> {
  const counts = new Map<string, number>();
  for (const s of ships) {
    const key = fold(s.name);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k));
}

/**
 * Ligne d'un navire (reprise de maritime-tabs.ts) : vitesse, ou « port base » (Défense) ou « port d'attache » (Trafic maritime, inchangé) pour une position de référence ; type, rôle,
 * pavillon, territoire, port le plus proche, heure vue ou « position de référence », raisons du risque. `stale` : puce grise (flux
 * figé, ou position de référence dans le panneau Défense). `dataKey` : attribut de clic (`data-mar-ship` du Trafic maritime,
 * `data-navy` du panneau Défense).
 */
export function shipRow(s: MilitaryShip, homonyms: ReadonlySet<string>, stale: boolean, now: number, dataKey: 'mar-ship' | 'navy' = 'mar-ship'): string {
  const dup = homonyms.has(fold(s.name)) && s.mmsi !== undefined;
  const country = flagName(s);
  const seen = s.lastSeen !== undefined ? `vu à ${absoluteTime(s.lastSeen, now, 'fr')}`
    : s.isLive === false && s.port ? `position de référence : ${s.port}` : null;
  const role = s.role && s.role !== 'Civil/Inconnu' ? s.role : null;
  const noteText = [s.type, role, country ? `pavillon ${country}` : null, s.maritimeTerritory?.name ?? null,
    s.nearestPort ? `${s.nearestPort.name} à ${formatKm(s.nearestPort.distanceKm, 0)}` : null, seen, ...(s.riskReasons ?? [])]
    .filter((x): x is string => x !== null && x !== '').join(' · ');
  return listRow({
    text: dup ? `${s.name} · MMSI …${s.mmsi?.slice(-4) ?? ''}` : s.name,
    value: s.isLive === false ? (dataKey === 'navy' ? 'port base' : 'port d’attache') : s.speed !== undefined ? formatKnots(s.speed) : 'n.d.',
    level: stale ? 'gris' : RISK_LEVEL[s.riskLevel ?? 'none'], note: noteText, data: { [dataKey]: s.mmsi ?? s.id }, link: true,
  });
}

/** SNLE ou SNA : jamais observé (aucun MMSI publié, aucune émission AIS), et retiré de la liste affichée de la Marine nationale (O11). */
export function isSubmarine(s: Pick<MilitaryShip, 'type'>): boolean {
  return s.type === 'SNLE' || s.type === 'SNA';
}

/** Bâtiments vus en AIS (isLive) d'abord, puis positions de référence au port base ; chacun par nom ; sous-marins (SNLE, SNA) écartés (O11). */
export function splitNavy(ships: readonly MilitaryShip[]): { observed: MilitaryShip[]; reference: MilitaryShip[] } {
  const byName = (a: MilitaryShip, b: MilitaryShip): number => a.name.localeCompare(b.name, 'fr');
  const shown = ships.filter((s) => !isSubmarine(s));
  const observed = shown.filter((s) => s.isLive === true).sort(byName);
  const reference = shown.filter((s) => s.isLive !== true).sort(byName);
  return { observed, reference };
}

/**
 * Navire d'une clé de marqueur ou de ligne (`mmsi ?? id`, comme `data-mar-ship`) dans les listes données, par ordre. Un navire sans MMSI
 * reconnu (O12) n'est trouvé que par son identifiant : jamais `undefined === undefined`.
 */
export function findShipByKey<T extends { id: string; mmsi?: string }>(key: string, ...pools: readonly (readonly T[])[]): T | undefined {
  for (const pool of pools) {
    const hit = pool.find((s) => s.id === key || (s.mmsi !== undefined && s.mmsi === key));
    if (hit) return hit;
  }
  return undefined;
}
