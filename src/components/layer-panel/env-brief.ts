// src/components/layer-panel/env-brief.ts : vue pure du panneau « En bref » de l'onglet Environnement (spec 2026-10-20 § 3, lot 2).
// Aucun accès réseau ni DOM. Répond aux cinq questions d'un poste de permanence : quoi et où, quelle gravité et dans quel sens,
// qu'est-ce qui est exposé, est-ce frais, puis-je le voir. Tout vient des sources déjà lues par l'onglet (aucun calcul de niveau
// parallèle : les niveaux sont ceux des pastilles) et du croisement d'environment-exposure.ts. Hors score.
import type {
  EarthquakesResponse, EmsResponse, FiresResponse, FloodsResponse, MapLayers, VigilanceResponse, WebcamsDataset,
} from '../../types/index.ts';
import { LEVEL_RANK, levelLabel, type VigilanceLevel } from '../../services/vigilance.ts';
import { OFFICIAL_COLOR_LEVEL, PHENOMENON_WORD, foyerLevel } from '../../services/environment-levels.ts';
import { ASSET_KIND_ORDER, FIRE_RADIUS_KM, FLOOD_BUFFER_KM, type ExposureAssetKind, type ExposureResult, type Hazard } from '../../services/environment-exposure.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { emptyLine, listRow, loadingBody, type LayerView } from './frame.ts';
import { NBSP, frNumber } from './format.ts';
import { readForecast } from '../../services/flood-forecast.ts';
import { ENVIRONMENT_THEME, formatAge, note } from './environment-format.ts';
import { departementName } from './health-format.ts';
import type { WatchLevel } from './watch.ts';

export const ENV_BRIEF_TITLE = 'En bref';
type OpenFn = (sectionId: string, byDefault: boolean) => boolean;

/** Passage de niveau d'une pastille de l'onglet (journal de la session). */
export interface EnvBriefChange { key: keyof MapLayers; label: string; from: VigilanceLevel; to: VigilanceLevel; at: number }
/** Fraîcheur d'une source : heure de la donnée (lecture, ou observation pour le radar) et niveau de sa pastille. */
export interface EnvBriefSource { key: keyof MapLayers; label: string; at: number | null; verb: string; level: WatchLevel | null }

export interface EnvBriefInput {
  /** Niveau de chaque pastille de l'onglet (celui de son panneau) ; absente : source pas encore lue. */
  levels: ReadonlyMap<keyof MapLayers, WatchLevel>;
  labels: Readonly<Partial<Record<keyof MapLayers, string>>>;
  vigilance: VigilanceResponse | null;
  floods: FloodsResponse | null;
  fires: FiresResponse | null;
  earthquakes: EarthquakesResponse | null;
  ems: EmsResponse | null;
  exposure: ExposureResult | null;
  /** Enjeux en cours de lecture (premier allumage) ; fichiers illisibles. */
  assetsLoading: boolean;
  assetsMissing: readonly string[];
  webcams: WebcamsDataset | null;
  changes: readonly EnvBriefChange[];
  sources: readonly EnvBriefSource[];
  now: number;
  open: OpenFn;
}

const MAX_HAZARD_ROWS = 10;
const MAX_NEARBY_ROWS = 15;
const MAX_DEPT_ROWS = 10;
const MAX_WEBCAMS = 8;
const DAY_MS = 24 * 3600_000;
/** Station Vigicrues « en hausse » : plus de 5 cm sur la dernière heure. */
const RISING_M = 0.05;

const KIND_WORD: Readonly<Record<ExposureAssetKind, [string, string]>> = {
  nucleaire: ['centrale nucléaire', 'centrales nucléaires'],
  'seveso-haut': ['site Seveso seuil haut', 'sites Seveso seuil haut'],
  hopital: ['service d’urgences', 'services d’urgences'],
  'seveso-bas': ['site Seveso seuil bas', 'sites Seveso seuil bas'],
  ehpad: ['EHPAD', 'EHPAD'],
};
const kindCount = (k: ExposureAssetKind, n: number): string => `${frNumber(n, 0)}${NBSP}${KIND_WORD[k][n > 1 ? 1 : 0]}`;
/** « 1 centrale nucléaire, 3 sites Seveso seuil haut, 12 services d'urgences », dans l'ordre des types d'enjeux. */
const countsText = (counts: Partial<Record<ExposureAssetKind, number>>): string =>
  ASSET_KIND_ORDER.filter((k) => (counts[k] ?? 0) > 0).map((k) => kindCount(k, counts[k] ?? 0)).join(', ');
const km = (d: number): string => d === 0 ? 'dans la zone' : `à ${frNumber(d, d < 10 ? 1 : 0)}${NBSP}km`;
const deptList = (codes: readonly string[], max = 3): string => {
  const names = codes.slice(0, max).map(departementName);
  const rest = codes.length - max;
  return rest > 0 ? `${names.join(', ')} et ${rest > 1 ? `${rest} autres` : 'un autre'}` : names.join(', ');
};
const ORDER: Record<WatchLevel, number> = { rouge: 0, orange: 1, jaune: 2, nd: 3, vert: 4 };

/** Pire niveau connu des pastilles (n.d. seulement si aucune n'est lisible). */
export function envOverallLevel(levels: ReadonlyMap<keyof MapLayers, WatchLevel>): WatchLevel | null {
  let best: WatchLevel | null = null;
  let anyNd = false;
  for (const l of levels.values()) {
    if (l === 'nd') { anyNd = true; continue; }
    if (best === null || ORDER[l] < ORDER[best]) best = l;
  }
  return best ?? (anyNd ? 'nd' : null);
}

/** Ligne d'un phénomène : où il est. */
function hazardWhere(h: Hazard, input: EnvBriefInput): string {
  if (h.depts.length > 0) return deptList(h.depts);
  if (h.kind === 'feu') {
    const f = input.fires?.foyers.find((x) => `feu-${x.id}` === h.id);
    return f ? `${departementName(f.dept)} · ${frNumber(f.frpTotalMw, 0)}${NBSP}MW` : '';
  }
  if (h.kind === 'seisme') {
    const q = input.earthquakes?.quakes.find((x) => `seisme-${x.id}` === h.id);
    return q?.dept ? departementName(q.dept) : (q?.description ?? '');
  }
  return '';
}

/** Pastilles sans zone localisée (stock ou épisode régional) : comptées dans « attention » à partir de l'orange. */
const AREA_PASTILLES: ReadonlyArray<[keyof MapLayers, string]> = [
  ['drought', 'arrêtés de restriction d’eau, VigiEau'],
  ['airQuality', 'épisode de pollution, Atmo'],
  ['disasters', 'alerte GDACS ou activation Copernicus sur le territoire français'],
];

interface AttentionItem { text: string; where: string; level: VigilanceLevel; hazardId: string | null }

/** Phénomènes localisés et pastilles orange ou rouges sans zone, du plus grave au moins grave. */
export function envAttention(input: EnvBriefInput): AttentionItem[] {
  const items: AttentionItem[] = (input.exposure?.hazards ?? []).map((h) => ({ text: h.label, where: hazardWhere(h, input), level: h.level, hazardId: h.id }));
  for (const [key, what] of AREA_PASTILLES) {
    const l = input.levels.get(key);
    if (l !== 'orange' && l !== 'rouge') continue;
    items.push({ text: `${input.labels[key] ?? key} ${l}`, where: what, level: l, hazardId: null });
  }
  // Tri stable : le plus grave d'abord, l'ordre des phénomènes gardé à niveau égal.
  return items.map((x, i) => ({ x, i })).sort((a, b) => LEVEL_RANK[b.x.level] - LEVEL_RANK[a.x.level] || a.i - b.i).map(({ x }) => x);
}

function attentionSection(input: EnvBriefInput): FicheSection {
  const items = envAttention(input);
  const html = items.length === 0
    ? emptyLine('Aucun phénomène orange ou rouge en cours, ni crue en vigilance, ni feu confirmé, ni séisme notable.')
    : items.slice(0, MAX_HAZARD_ROWS).map((h) => listRow({
      text: h.text, value: h.where || null, level: h.level, data: h.hazardId ? { hazard: h.hazardId } : undefined,
    })).join('') + (items.length > MAX_HAZARD_ROWS ? note(`Et ${items.length - MAX_HAZARD_ROWS} autres : voir les pastilles.`) : '');
  return { id: 'attention', title: 'Ce qui demande attention', collapsible: true, open: input.open('attention', true), summary: String(items.length), html };
}

/** Ce qui a changé : passages de niveau des pastilles, stations en hausse, foyers, séismes et activations des dernières 24 h. */
export function envChanges(input: EnvBriefInput): Array<{ text: string; level: VigilanceLevel | null; at: number }> {
  const { now } = input;
  const out: Array<{ text: string; level: VigilanceLevel | null; at: number }> = [];
  for (const c of input.changes) {
    if (now - c.at > DAY_MS) continue;
    const up = LEVEL_RANK[c.to] > LEVEL_RANK[c.from];
    out.push({ text: `${c.label} : ${up ? 'passe' : 'redescend'} de ${levelLabel(c.from).toLowerCase()} à ${levelLabel(c.to).toLowerCase()}`, level: c.to, at: c.at });
  }
  for (const s of input.floods?.sections ?? []) {
    const rising = s.stations.filter((st) => st.change1hM !== null && st.change1hM > RISING_M);
    if (rising.length === 0) continue;
    const top = rising.reduce((m, st) => ((st.change1hM ?? 0) > (m.change1hM ?? 0) ? st : m));
    const at = top.lastAt ? Date.parse(top.lastAt) : now;
    out.push({
      text: `${s.name} : ${rising.length > 1 ? `${rising.length} stations en hausse` : 'station en hausse'}, ${top.name} +${frNumber((top.change1hM ?? 0) * 100, 0)}${NBSP}cm en 1${NBSP}h`,
      level: OFFICIAL_COLOR_LEVEL[s.level], at: Number.isFinite(at) ? at : now,
    });
  }
  for (const f of input.fires?.foyers ?? []) {
    const lvl = foyerLevel(f);
    const first = Date.parse(f.firstAt);
    if ((lvl !== 'orange' && lvl !== 'rouge') || !Number.isFinite(first) || now - first > DAY_MS) continue;
    out.push({ text: `Nouveau feu confirmé : ${departementName(f.dept)}, ${frNumber(f.frpTotalMw, 0)}${NBSP}MW`, level: lvl, at: first });
  }
  for (const q of input.earthquakes?.quakes ?? []) {
    const at = Date.parse(q.at);
    if (!q.inFrance || q.magnitude < 3 || !Number.isFinite(at) || now - at > DAY_MS) continue;
    out.push({ text: `Séisme de magnitude ${frNumber(q.magnitude, 1)}${q.dept ? ` (${departementName(q.dept)})` : ''}`, level: q.magnitude >= 4 ? 'orange' : 'jaune', at });
  }
  for (const a of input.ems?.active ?? []) {
    const at = Date.parse(a.activationTime);
    if (!Number.isFinite(at) || now - at > DAY_MS) continue;
    out.push({ text: `Cartographie d’urgence Copernicus activée : ${a.place} (${a.code})`, level: 'orange', at });
  }
  return out.sort((a, b) => b.at - a.at);
}

function changesSection(input: EnvBriefInput): FicheSection {
  const list = envChanges(input);
  const html = list.length === 0
    ? emptyLine('Rien de nouveau depuis 24 h (niveaux des pastilles, stations Vigicrues, feux, séismes, activations Copernicus).')
    : list.slice(0, 12).map((c) => listRow({ text: c.text, value: formatAge(c.at, input.now), level: c.level })).join('');
  return { id: 'changes', title: 'Ce qui change (24 h)', collapsible: true, open: input.open('changes', true), summary: String(list.length), html };
}

/** Départements orange ou rouge à l'échéance suivante, avec leur évolution par rapport à aujourd'hui. */
export function envTomorrow(v: VigilanceResponse | null): Array<{ dept: string; level: VigilanceLevel; today: VigilanceLevel; phenomena: string }> {
  const j = v?.periods.find((p) => p.echeance === 'J');
  const j1 = v?.periods.find((p) => p.echeance === 'J1');
  if (!j1) return [];
  const todayOf = (code: string): VigilanceLevel => {
    const d = j?.departments.find((x) => x.code === code);
    return d ? OFFICIAL_COLOR_LEVEL[d.color] : 'vert';
  };
  return j1.departments
    .filter((d) => d.color >= 3)
    .map((d) => ({
      dept: d.code, level: OFFICIAL_COLOR_LEVEL[d.color], today: todayOf(d.code),
      phenomena: d.phenomena.filter((p) => p.color >= 3).map((p) => PHENOMENON_WORD[p.id]).join(', '),
    }))
    // Le plus grave d'abord ; à niveau égal, ce qui s'aggrave avant ce qui reste.
    .sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level]
      || (LEVEL_RANK[b.level] - LEVEL_RANK[b.today]) - (LEVEL_RANK[a.level] - LEVEL_RANK[a.today]));
}

/**
 * Stations dont Vigicrues prévoit une hausse : une par tronçon, celle de la plus forte hausse attendue (mesure → pic prévu) ;
 * tronçons du plus grave au moins grave, puis de la plus forte hausse.
 */
export function envRisingForecasts(input: EnvBriefInput): Array<{ section: string; station: string; text: string; level: VigilanceLevel; rise: number }> {
  const out: Array<{ section: string; station: string; text: string; level: VigilanceLevel; rise: number }> = [];
  for (const s of input.floods?.sections ?? []) {
    let best: { station: string; text: string; rise: number } | null = null;
    for (const st of s.stations) {
      const r = readForecast(st, input.now);
      if (!r || r.trend !== 'hausse') continue;
      const from = st.heightM ?? r.key.mean;
      const rise = r.key.mean - from;
      if (!best || rise > best.rise) {
        const when = r.inHours <= 0 ? 'maintenant' : `dans ${r.inHours}${NBSP}h`;
        const text = st.heightM !== null ? `${frNumber(st.heightM, 2)} → ${frNumber(r.key.mean, 2)}${NBSP}m ${when}` : `${frNumber(r.key.mean, 2)}${NBSP}m ${when}`;
        best = { station: st.name, rise, text };
      }
    }
    if (best) out.push({ section: s.name, ...best, level: OFFICIAL_COLOR_LEVEL[s.level] });
  }
  return out.sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level] || b.rise - a.rise);
}

function tomorrowSection(input: EnvBriefInput): FicheSection {
  const hasJ1 = input.vigilance?.periods.some((p) => p.echeance === 'J1') ?? false;
  const list = envTomorrow(input.vigilance);
  const rising = envRisingForecasts(input);
  const risingHtml = rising.length === 0 ? '' : `<p class="fmk-sub">Hausse prévue par Vigicrues</p>`
    + rising.map((r) => listRow({ text: `${r.section} · ${r.station}`, value: r.text, level: r.level })).join('');
  const j1Html = !hasJ1 ? emptyLine('Échéance de demain non publiée par Météo-France.')
    : list.length === 0 ? emptyLine('Aucun département en orange ou en rouge demain.')
    : list.map((t) => listRow({
      text: departementName(t.dept),
      value: LEVEL_RANK[t.level] > LEVEL_RANK[t.today] ? `passe en ${t.level}` : LEVEL_RANK[t.level] < LEVEL_RANK[t.today] ? `redescend en ${t.level}` : `reste en ${t.level}`,
      level: t.level, note: t.phenomena,
    })).join('');
  const html = risingHtml + (rising.length > 0 ? '<p class="fmk-sub">Vigilance météo de demain</p>' : '') + j1Html;
  return { id: 'tomorrow', title: 'À venir', collapsible: true, open: input.open('tomorrow', true), summary: String(list.length + rising.length), html };
}

function exposedSection(input: EnvBriefInput): FicheSection {
  const ex = input.exposure;
  const missing = input.assetsMissing.length > 0 ? note(`Enjeux non lus : ${input.assetsMissing.join(', ')}.`) : '';
  const method = note(`Proches d’un phénomène : à moins de ${FLOOD_BUFFER_KM}${NBSP}km d’un tronçon de crue en vigilance, à moins de ${FIRE_RADIUS_KM}${NBSP}km d’un feu confirmé, `
    + `de 10 à 50${NBSP}km d’un séisme selon sa magnitude, dans une zone Copernicus. Vigilance orange ou rouge : enjeux du département, selon le phénomène. `
    + 'Sources : Géorisques (Seveso), SAE et FINESS (urgences, EHPAD), EDF (centrales).');
  if (input.assetsLoading && ex === null) {
    return { id: 'exposed', title: 'Enjeux exposés', collapsible: true, open: input.open('exposed', true), summary: '…', html: loadingBody() };
  }
  const nearby = ex?.nearby ?? [];
  const dept = ex?.departmental ?? [];
  const nearbyHtml = nearby.slice(0, MAX_NEARBY_ROWS).map((e) => listRow({
    text: e.asset.name,
    value: e.distanceKm !== null ? km(e.distanceKm) : null,
    level: e.hazard.level,
    note: [e.asset.detail, e.asset.commune, e.hazard.label].filter((s): s is string => s !== null && s !== '').join(' · '),
    data: { lon: String(e.asset.lon), lat: String(e.asset.lat) }, link: true,
  })).join('') + (nearby.length > MAX_NEARBY_ROWS ? note(`Et ${nearby.length - MAX_NEARBY_ROWS} autres enjeux proches, sur la carte.`) : '');
  const deptHtml = dept.slice(0, MAX_DEPT_ROWS).map((d) => {
    const counts = countsText(d.counts);
    const named = d.named.length > 0 ? ` (${d.named.map((a) => a.name).join(', ')})` : '';
    return listRow({ text: `${departementName(d.dept)} · ${d.hazard.label}`, level: d.hazard.level, note: `${counts}${named}` });
  }).join('') + (dept.length > MAX_DEPT_ROWS ? note(`Et ${dept.length - MAX_DEPT_ROWS} autres départements.`) : '');
  const body = nearby.length === 0 && dept.length === 0
    ? emptyLine('Aucun enjeu dans la zone d’un phénomène en cours.')
    : (nearby.length > 0 ? `<p class="fmk-sub">Proches d’un phénomène</p>${nearbyHtml}` : '')
      + (dept.length > 0 ? `<p class="fmk-sub">Dans un département en vigilance orange ou rouge</p>${deptHtml}` : '');
  return {
    id: 'exposed', title: 'Enjeux exposés', collapsible: true, open: input.open('exposed', true),
    summary: String(nearby.length + dept.length), html: body + missing + method,
  };
}

/** Webcams actives (image vivante) dans les départements touchés par un phénomène orange ou rouge. */
export function envWebcams(input: EnvBriefInput): Array<{ id: string; name: string; dept: string }> {
  const depts = new Set<string>();
  for (const h of input.exposure?.hazards ?? []) {
    if (LEVEL_RANK[h.level] < LEVEL_RANK.orange) continue;
    for (const d of h.depts) depts.add(d);
  }
  for (const e of input.exposure?.nearby ?? []) depts.add(e.asset.dept);
  for (const f of input.fires?.foyers ?? []) {
    const l = foyerLevel(f);
    if (l === 'orange' || l === 'rouge') depts.add(f.dept);
  }
  return (input.webcams?.webcams ?? [])
    .filter((w) => w.status === 'ok' && w.dept !== null && depts.has(w.dept))
    .map((w) => ({ id: w.id, name: w.name, dept: w.dept ?? '' }));
}

function webcamsSection(input: EnvBriefInput): FicheSection {
  const list = envWebcams(input);
  const html = input.webcams === null ? emptyLine('Recensement des webcams non lu.')
    : list.length === 0 ? emptyLine('Aucune webcam publique active dans les départements touchés.')
    : list.slice(0, MAX_WEBCAMS).map((w) => listRow({ text: w.name, value: departementName(w.dept), data: { webcam: w.id }, link: true })).join('')
      + (list.length > MAX_WEBCAMS ? note(`Et ${list.length - MAX_WEBCAMS} autres, pastille Webcams.`) : '');
  return { id: 'webcams', title: 'Voir sur place', collapsible: true, open: input.open('webcams', false), summary: String(list.length), html };
}

function sourcesSection(input: EnvBriefInput): FicheSection {
  const html = input.sources.map((s) => listRow({
    text: s.label,
    value: s.at !== null ? `${s.verb} ${formatAge(s.at, input.now)}` : 'n.d.',
    level: s.level === 'nd' ? 'gris' : s.level,
    note: s.level === 'nd' ? 'Source indisponible ou en retard' : null,
  })).join('');
  return { id: 'sources', title: 'Fraîcheur des sources', collapsible: true, open: input.open('sources', false), tone: 'reference', html };
}

/** Phrase d'en-tête : les phénomènes les plus graves, en une ligne. */
function lead(input: EnvBriefInput): string | null {
  const items = envAttention(input);
  if (items.length === 0) return null;
  const top = items[0].level;
  const same = items.filter((h) => h.level === top);
  const words = same.slice(0, 3).map((h) => {
    const hz = h.hazardId ? input.exposure?.hazards.find((x) => x.id === h.hazardId) : undefined;
    return hz && hz.depts.length > 0 ? `${h.text} (${deptList(hz.depts, 2)})` : h.where ? `${h.text} (${h.where})` : h.text;
  });
  return `${words.join(' · ')}${same.length > 3 ? ` et ${same.length - 3} autres` : ''}.`;
}

export function buildEnvBriefView(input: EnvBriefInput): LayerView {
  const level = envOverallLevel(input.levels);
  const ex = input.exposure;
  // Chiffre : enjeux à portée d'un phénomène orange ou rouge (le jaune reste listé, il ne fait pas le chiffre).
  const exposedCount = ex ? ex.nearby.filter((e) => LEVEL_RANK[e.hazard.level] >= LEVEL_RANK.orange).length : null;
  const sections = [attentionSection(input), changesSection(input), tomorrowSection(input), exposedSection(input), webcamsSection(input), sourcesSection(input)];
  const copy = '<div class="fiche-actions eb-actions"><button type="button" class="fiche-action" data-copy-note>Copier pour une note</button>'
    + '<span class="eb-copied" aria-live="polite"></span></div>';
  return {
    head: {
      theme: ENVIRONMENT_THEME, title: ENV_BRIEF_TITLE, level,
      figure: exposedCount === null ? null : {
        value: frNumber(exposedCount, 0),
        caption: exposedCount > 1 ? 'enjeux à portée d’un phénomène orange ou rouge' : 'enjeu à portée d’un phénomène orange ou rouge',
        level: exposedCount > 0 ? (ex?.nearby[0]?.hazard.level ?? null) : null,
      },
      status: [],
      lead: lead(input),
    },
    sections,
    bodyHtml: copy,
  };
}

/** Texte brut pour une note de situation (presse-papiers) : phénomènes, changements, demain, enjeux. Jamais de HTML. */
export function envBriefNoteText(input: EnvBriefInput): string {
  const lines: string[] = [];
  const at = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' }).format(new Date(input.now));
  lines.push(`Environnement, point de situation du ${at}`);
  const level = envOverallLevel(input.levels);
  if (level && level !== 'nd') lines.push(`Niveau de l’onglet : ${levelLabel(level).toLowerCase()}.`);
  const attention = envAttention(input);
  lines.push('', 'Phénomènes en cours :');
  if (attention.length === 0) lines.push('- aucun phénomène orange ou rouge.');
  for (const h of attention.slice(0, MAX_HAZARD_ROWS)) lines.push(`- ${h.text}${h.where ? ` : ${h.where}` : ''}.`);
  const changes = envChanges(input);
  if (changes.length > 0) {
    lines.push('', 'Évolutions (24 h) :');
    for (const c of changes.slice(0, 8)) lines.push(`- ${c.text} (${formatAge(c.at, input.now)}).`);
  }
  const rising = envRisingForecasts(input);
  if (rising.length > 0) {
    lines.push('', 'Hausse prévue par Vigicrues :');
    for (const r of rising) lines.push(`- ${r.section}, ${r.station} : ${r.text}.`);
  }
  const tomorrow = envTomorrow(input.vigilance);
  if (tomorrow.length > 0) {
    lines.push('', 'Demain :');
    for (const t of tomorrow) lines.push(`- ${departementName(t.dept)} : ${t.level} (${t.phenomena}).`);
  }
  const ex = input.exposure;
  if (ex && (ex.nearby.length > 0 || ex.departmental.length > 0)) {
    lines.push('', 'Enjeux exposés :');
    for (const e of ex.nearby.slice(0, MAX_NEARBY_ROWS)) {
      lines.push(`- ${e.asset.name}${e.asset.commune ? ` (${e.asset.commune})` : ''}, ${e.distanceKm !== null ? km(e.distanceKm) : 'dans le département'} : ${e.hazard.label}.`);
    }
    for (const d of ex.departmental.slice(0, MAX_DEPT_ROWS)) {
      lines.push(`- ${departementName(d.dept)}, ${d.hazard.label} : ${countsText(d.counts)}.`);
    }
  }
  lines.push('', 'Sources : Météo-France, Vigicrues, Hub’Eau, NASA FIRMS, BCSF-RéNaSS, Copernicus EMS, Géorisques, FINESS. Source France Monitor.');
  return lines.join('\n').replace(/\u00a0/g, ' ');
}

