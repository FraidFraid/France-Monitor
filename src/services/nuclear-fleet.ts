// src/services/nuclear-fleet.ts : parc nucléaire vu par tranche (spec 2026-10-02 § 6.1). Fonctions pures,
// « maintenant » injecté. Depuis le 08/10/2026, le score de tension (NuclearStressScore) reprend fleetLevel et les arrêts imprévus.

import type { NuclearUnavailability, NuclearUnitReference } from '../types/index.ts';
import type { VigilanceLevel } from './vigilance.ts';

const DAY_MS = 86_400_000;
export type OutageKind = 'fortuit' | 'reduit' | 'programme';
export interface UnitOutage { unit: NuclearUnitReference; kind: OutageKind; lostMw: number; start: number; end: number | null }

const KIND_RANK: Record<OutageKind, number> = { fortuit: 0, reduit: 1, programme: 2 };

function normalizeKey(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}

function matches(ref: NuclearUnitReference, unitName: string): boolean {
  const key = normalizeKey(unitName);
  return normalizeKey(ref.unitName) === key || (ref.aliases ?? []).some((a) => normalizeKey(a) === key);
}

export function unitLabel(ref: NuclearUnitReference): string {
  const n = /(\d+)\s*$/.exec(ref.unitName)?.[1];
  return n ? `${ref.plantName} ${n}` : ref.plantName;
}

/** Libellé court pour les espaces étroits (calendrier) : « St-Laurent 1 », « Belleville 1 ». */
export function shortLabel(ref: NuclearUnitReference): string {
  const n = /(\d+)\s*$/.exec(ref.unitName)?.[1];
  const site = ref.plantName.replace(/^Saint-/, 'St-').replace(/-(sur|en|des|Meysse)\b.*$/i, '');
  return n ? `${site} ${n}` : site;
}

export function outageKind(u: NuclearUnavailability): OutageKind {
  if (u.type === 'UNPLANNED' || u.type === 'FORCE_MAJEURE' || u.status === 'OUTAGE_UNPLANNED') return 'fortuit';
  if (u.availablePowerMW > 0 || u.status === 'REDUCED') return 'reduit';
  return 'programme';
}

function isActive(u: NuclearUnavailability, now: number): boolean {
  return u.startDate.getTime() <= now && (u.endDate === null || u.endDate.getTime() > now);
}

function toOutage(ref: NuclearUnitReference, u: NuclearUnavailability): UnitOutage {
  const nominal = Math.max(ref.nominalPowerMW, u.nominalPowerMW);
  return {
    unit: ref, kind: outageKind(u), lostMw: Math.max(0, nominal - Math.max(0, u.availablePowerMW)),
    start: u.startDate.getTime(), end: u.endDate ? u.endDate.getTime() : null,
  };
}

/** Pire de deux indisponibilités d'une même tranche : nature la plus grave, puis plus forte puissance perdue. */
function worse(a: UnitOutage, b: UnitOutage): UnitOutage {
  if (KIND_RANK[a.kind] !== KIND_RANK[b.kind]) return KIND_RANK[a.kind] < KIND_RANK[b.kind] ? a : b;
  return a.lostMw >= b.lostMw ? a : b;
}

function byGravity(a: UnitOutage, b: UnitOutage): number {
  return KIND_RANK[a.kind] - KIND_RANK[b.kind] || b.lostMw - a.lostMw || unitLabel(a.unit).localeCompare(unitLabel(b.unit), 'fr');
}

export function activeOutages(unavailabilities: readonly NuclearUnavailability[], units: readonly NuclearUnitReference[], now: number): UnitOutage[] {
  const perUnit = new Map<string, UnitOutage>();
  for (const u of unavailabilities) {
    if (!isActive(u, now)) continue;
    const ref = units.find((r) => matches(r, u.unitName));
    if (!ref) continue;
    const outage = toOutage(ref, u);
    const prev = perUnit.get(ref.id);
    perUnit.set(ref.id, prev ? worse(prev, outage) : outage);
  }
  return [...perUnit.values()].sort(byGravity);
}

export interface FleetSummary {
  installedMw: number; availableMw: number; ratio: number;
  byKind: Record<OutageKind, { count: number; lostMw: number }>;
  outages: UnitOutage[];
}

export function fleetSummary(units: readonly NuclearUnitReference[], outages: readonly UnitOutage[]): FleetSummary {
  const installedMw = units.reduce((s, r) => s + r.nominalPowerMW, 0);
  const byKind: FleetSummary['byKind'] = { fortuit: { count: 0, lostMw: 0 }, reduit: { count: 0, lostMw: 0 }, programme: { count: 0, lostMw: 0 } };
  for (const o of outages) { byKind[o.kind].count += 1; byKind[o.kind].lostMw += o.lostMw; }
  const lost = outages.reduce((s, o) => s + o.lostMw, 0);
  const availableMw = Math.max(0, installedMw - lost);
  return { installedMw, availableMw, ratio: installedMw > 0 ? availableMw / installedMw : 0, byKind, outages: [...outages].sort(byGravity) };
}

/** Niveau du parc : puissance perdue en arrêts fortuits (décision du 02/10/2026). */
/** Couleur de la jauge « Disponible » : part de la puissance installée disponible (85, 70 et 55 %). */
export function availabilityLevel(ratio: number): VigilanceLevel {
  if (ratio >= 0.85) return 'vert';
  if (ratio >= 0.7) return 'jaune';
  if (ratio >= 0.55) return 'orange';
  return 'rouge';
}

export function fleetLevel(lostUnplannedMw: number): VigilanceLevel {
  if (lostUnplannedMw >= 6000) return 'rouge';
  if (lostUnplannedMw >= 3000) return 'orange';
  if (lostUnplannedMw >= 1000) return 'jaune';
  return 'vert';
}

export interface CalendarSegment { kind: OutageKind; start: number; end: number | null; upcoming: boolean }
/** Une ligne par tranche, avec un segment par indisponibilité dans la fenêtre. */
export interface CalendarRow { unit: NuclearUnitReference; segments: CalendarSegment[] }
export interface FleetCalendar {
  from: number; to: number; rows: CalendarRow[];
  returns: Array<{ unit: NuclearUnitReference; at: number; gainMw: number }>;
  upcoming: Array<{ unit: NuclearUnitReference; at: number; lostMw: number }>;
}

export function fleetCalendar(unavailabilities: readonly NuclearUnavailability[], units: readonly NuclearUnitReference[], now: number): FleetCalendar {
  const from = now - 3 * DAY_MS;
  const to = now + 14 * DAY_MS;
  const perUnit = new Map<string, CalendarRow>();
  const nextStart = new Map<string, { unit: NuclearUnitReference; at: number; lostMw: number }>();
  for (const u of unavailabilities) {
    const start = u.startDate.getTime();
    const end = u.endDate ? u.endDate.getTime() : null;
    if (start > to || (end !== null && end < from)) continue;
    const ref = units.find((r) => matches(r, u.unitName));
    if (!ref) continue;
    const o = toOutage(ref, u);
    const row = perUnit.get(ref.id) ?? { unit: ref, segments: [] };
    row.segments.push({ kind: o.kind, start, end, upcoming: start > now });
    perUnit.set(ref.id, row);
    if (start > now) {
      const prev = nextStart.get(ref.id);
      if (!prev || start < prev.at) nextStart.set(ref.id, { unit: ref, at: start, lostMw: o.lostMw });
    }
  }
  // Tri : arrêts en cours d'abord (plus grave en tête), puis tranches n'ayant que des arrêts à venir.
  const rank = (r: CalendarRow): number => {
    const current = r.segments.filter((x) => !x.upcoming);
    const pool = current.length > 0 ? current : r.segments;
    return Math.min(...pool.map((x) => KIND_RANK[x.kind])) + (current.length > 0 ? 0 : 3);
  };
  const rows = [...perUnit.values()];
  for (const r of rows) r.segments.sort((a, b) => a.start - b.start);
  rows.sort((a, b) => rank(a) - rank(b) || a.segments[0].start - b.segments[0].start);
  // Retours : fin de l'indisponibilité en cours seulement (jamais la fin d'un arrêt pas encore commencé).
  const returns = activeOutages(unavailabilities, units, now)
    .filter((o) => o.end !== null && o.end > now && o.end <= to)
    .map((o) => ({ unit: o.unit, at: o.end as number, gainMw: o.lostMw }))
    .sort((a, b) => a.at - b.at);
  const upcoming = [...nextStart.values()].sort((a, b) => a.at - b.at);
  return { from, to, rows, returns, upcoming };
}

export interface PlantRow { name: string; worst: OutageKind | null; unitsTotal: number; unitsAvailable: number; availableMw: number; installedMw: number }

export function plantRows(units: readonly NuclearUnitReference[], outages: readonly UnitOutage[]): PlantRow[] {
  const rows = new Map<string, PlantRow>();
  for (const ref of units) {
    const row = rows.get(ref.plantName) ?? { name: ref.plantName, worst: null, unitsTotal: 0, unitsAvailable: 0, availableMw: 0, installedMw: 0 };
    const o = outages.find((x) => x.unit.id === ref.id);
    row.unitsTotal += 1;
    row.installedMw += ref.nominalPowerMW;
    row.availableMw += Math.max(0, ref.nominalPowerMW - (o?.lostMw ?? 0));
    // Une tranche en puissance réduite produit : elle compte comme disponible.
    if (!o || o.kind === 'reduit') row.unitsAvailable += 1;
    if (o && (row.worst === null || KIND_RANK[o.kind] < KIND_RANK[row.worst])) row.worst = o.kind;
    rows.set(ref.plantName, row);
  }
  return [...rows.values()].sort((a, b) =>
    (a.worst === null ? 3 : KIND_RANK[a.worst]) - (b.worst === null ? 3 : KIND_RANK[b.worst]) || a.name.localeCompare(b.name, 'fr'));
}

export function remitMatchWords(confidence: number): string {
  if (confidence >= 0.8) return 'correspondance probable';
  if (confidence >= 0.5) return 'correspondance incertaine';
  return 'correspondance faible';
}
