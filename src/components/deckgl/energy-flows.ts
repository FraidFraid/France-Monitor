// src/components/deckgl/energy-flows.ts
/**
 * energy-flows.ts : flèches d'échange avec l'étranger (spec 2026-10-16 § 4). Électricité et gaz : segment court depuis la
 * frontière ; pétrole importé : route maritime entière jusqu'au port. Couleur = filière et sens, épaisseur = volume (pétrole).
 */
import { ENERGY_FLOW_COLORS, ENERGY_FLOW_KIND_LABEL, type EnergyFlowKind } from '../../services/energy-state.ts';
import { OIL_CHOKEPOINTS, seaRoute, type ChokeId } from '../../config/oil-sea-routes.ts';

type Pt = [number, number];
const NBSP = ' ';
export const FLOW_STUB_KM = 110;

export interface FlowArc {
  kind: EnergyFlowKind;
  coordinates: Pt[];
  isImport: boolean;
  country: string;
  name: string;
  hubName: string;
  flowValue: number | null;
  flowUnit: string;
  lineWidth: number;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function flowArcFromFeature(kind: EnergyFlowKind, f: GeoJSON.Feature): FlowArc | null {
  if (f.geometry.type !== 'LineString') return null;
  const p = f.properties ?? {};
  return {
    kind,
    coordinates: f.geometry.coordinates.map((c) => [c[0], c[1]] as Pt),
    isImport: p.isImport === true || p.isImport === 'true',
    country: str(p.country), name: str(p.name), hubName: str(p.hubName),
    flowValue: num(p.flowValue), flowUnit: str(p.flowUnit), lineWidth: num(p.lineWidth) ?? 3,
  };
}

export function kmBetween(a: Pt, b: Pt): number {
  const r = Math.PI / 180;
  const x = (b[0] - a[0]) * Math.cos(((a[1] + b[1]) / 2) * r);
  const y = b[1] - a[1];
  return Math.sqrt(x * x + y * y) * 111;
}

/** Segment d'environ `km` depuis la frontière (premier point côté étranger), orienté dans le sens du flux. */
export function stubFromBorder(coords: readonly Pt[], isImport: boolean, km = FLOW_STUB_KM): Pt[] {
  const fromBorder = isImport ? [...coords] : [...coords].reverse();
  const part: Pt[] = [fromBorder[0]];
  let acc = 0;
  for (let i = 1; i < fromBorder.length && acc < km; i += 1) {
    acc += kmBetween(fromBorder[i - 1], fromBorder[i]);
    part.push(fromBorder[i]);
  }
  return isImport ? part : part.reverse();
}

export function formatFlowValue(value: number | null, unit: string): string {
  if (value === null) return 'n.d.';
  return `${Math.round(Math.abs(value)).toLocaleString('fr-FR')}${NBSP}${unit}`;
}

/** Cap géographique (nord = 0, sens horaire) pour `icon-rotate` avec `icon-rotation-alignment: map`. */
function bearing(a: Pt, b: Pt): number {
  const r = Math.PI / 180;
  const y = Math.sin((b[0] - a[0]) * r) * Math.cos(b[1] * r);
  const x = Math.cos(a[1] * r) * Math.sin(b[1] * r) - Math.sin(a[1] * r) * Math.cos(b[1] * r) * Math.cos((b[0] - a[0]) * r);
  return Math.atan2(y, x) / r;
}

const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features });
const point = (c: Pt, properties: Record<string, unknown>): GeoJSON.Feature => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties });

export function buildFlowFeatures(arcs: readonly FlowArc[]): {
  lines: GeoJSON.FeatureCollection; heads: GeoJSON.FeatureCollection; labels: GeoJSON.FeatureCollection; chokes: GeoJSON.FeatureCollection;
} {
  const lines: GeoJSON.Feature[] = [];
  const heads: GeoJSON.Feature[] = [];
  const labels: GeoJSON.Feature[] = [];
  const through = new Map<ChokeId, Array<{ who: string; value: number | null; unit: string }>>();
  for (const a of arcs) {
    if (a.coordinates.length < 2) continue;
    const who = a.country || a.name;
    const color = a.isImport ? ENERGY_FLOW_COLORS[a.kind].import : ENERGY_FLOW_COLORS[a.kind].export;
    const route = a.kind === 'petrole' && a.isImport ? seaRoute(a.name || a.country, a.coordinates[a.coordinates.length - 1]) : null;
    const seg = route ? route.coordinates : stubFromBorder(a.coordinates, a.isImport);
    const sea = a.kind === 'petrole' && a.flowValue !== null;
    const w = sea ? Math.min(10, Math.max(2.5, 2 + Math.abs(a.flowValue ?? 0) / 40)) : Math.min(9, Math.max(3, a.lineWidth * 1.4));
    const via = route ? route.via : [];
    for (const id of via) through.set(id, [...(through.get(id) ?? []), { who, value: a.flowValue, unit: a.flowUnit }]);
    lines.push({
      type: 'Feature', geometry: { type: 'LineString', coordinates: seg },
      properties: { color, w, kind: a.kind, isImport: a.isImport, who, flowValue: a.flowValue, flowUnit: a.flowUnit, hubName: a.hubName, via: via.join(',') },
    });
    const tip = seg[seg.length - 1];
    const prev = seg[Math.max(0, seg.length - 3)];
    heads.push(point(tip, { color, rot: bearing(prev, tip), size: w / 6, kind: a.kind }));
    // Étiquette côté étranger : départ d'un import, arrivée d'un export.
    const foreign = a.isImport ? seg[0] : tip;
    const hub = a.kind === 'petrole' && a.hubName ? ` ${a.isImport ? 'vers' : 'depuis'} ${a.hubName}` : '';
    const text = `${who} · ${ENERGY_FLOW_KIND_LABEL[a.kind]}\n${a.isImport ? 'import' : 'export'} ${formatFlowValue(a.flowValue, a.flowUnit)}${hub}`;
    labels.push(point(foreign, { text, color, kind: a.kind }));
  }
  const chokes = OIL_CHOKEPOINTS.filter((c) => through.has(c.id))
    .map((c) => point(c.coordinates, { id: c.id, name: c.name, flows: JSON.stringify(through.get(c.id)), kind: 'petrole' }));
  return { lines: fc(lines), heads: fc(heads), labels: fc(labels), chokes: fc(chokes) };
}
