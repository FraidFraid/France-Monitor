// src/components/layer-panel/theme-brief.ts : vue pure du panneau « En bref » des onglets autres qu'Environnement (20/10/2026).
// Aucun accès réseau ni DOM. Même lecture décideur que l'En bref de l'Environnement : ce qui demande attention, ce qui est à
// traiter, ce qui a changé, l'état des pastilles de l'onglet, une note à copier. Tout vient de ce que l'app a déjà calculé : les
// niveaux des pastilles (fonctions *HeadLevel, jamais un calcul parallèle) et la liste « À traiter » du poste (situations,
// événements recoupés, alertes officielles). Hors score.
import type { MapLayers } from '../../types/index.ts';
import { LEVEL_RANK, levelLabel, type VigilanceLevel } from '../../services/vigilance.ts';
import type { EventsStatus, WorkItem } from '../../services/work-queue.ts';
import { rowMeta } from '../poste/WorkList.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { emptyLine, listRow, valueHtml, type LayerHeadModel, type LayerView } from './frame.ts';
import { formatAge } from './environment-format.ts';
import type { WatchLevel } from './watch.ts';

export const THEME_BRIEF_TITLE = 'En bref';
type OpenFn = (sectionId: string, byDefault: boolean) => boolean;

/** Pastille de l'onglet : niveau (fonctions *HeadLevel) et en-tête de son panneau (dernière vue retenue par le cadre), null si pas lu. */
export interface ThemeBriefPastille { key: keyof MapLayers; label: string; level: WatchLevel | null; head?: LayerHeadModel | null }
export interface ThemeBriefChange { label: string; from: VigilanceLevel; to: VigilanceLevel; at: number }

export interface ThemeBriefInput {
  themeName: string;
  /** Pastilles de l'onglet, dans l'ordre de la barre, avec leur niveau (null : source pas encore lue). */
  pastilles: readonly ThemeBriefPastille[];
  /** Éléments « À traiter » de l'onglet, déjà triés (liste du poste). */
  items: readonly WorkItem[];
  /** Niveau de l'onglet calculé par le poste (signaux officiels et éléments à traiter) ; null : pas encore connu. */
  themeLevel: VigilanceLevel | null;
  /** Passages de niveau des pastilles de l'onglet pendant la session. */
  changes: readonly ThemeBriefChange[];
  eventsStatus: EventsStatus | null;
  now: number;
  open: OpenFn;
}

const MAX_ATTENTION = 10;
const MAX_ITEMS = 12;
const DAY_MS = 24 * 3_600_000;
const BADGE: Readonly<Record<'nouveau' | 'aggrave', string>> = { nouveau: 'nouveau', aggrave: 'aggravé' };

const isHot = (l: VigilanceLevel | WatchLevel | null): boolean => l === 'orange' || l === 'rouge';
const levelWord = (l: WatchLevel | null): string => (l === null ? 'non lu' : l === 'nd' ? 'n.d.' : levelLabel(l).toLowerCase());

/** Niveau de l'onglet : le pire entre le niveau du poste et celui des pastilles lisibles ; null si rien n'est connu. */
export function themeBriefLevel(input: Pick<ThemeBriefInput, 'pastilles' | 'themeLevel'>): WatchLevel | null {
  let best: VigilanceLevel | null = input.themeLevel;
  let anyNd = false;
  for (const p of input.pastilles) {
    if (p.level === null) continue;
    if (p.level === 'nd') { anyNd = true; continue; }
    if (best === null || LEVEL_RANK[p.level] > LEVEL_RANK[best]) best = p.level;
  }
  return best ?? (anyNd ? 'nd' : null);
}

interface AttentionRow { text: string; where: string | null; level: VigilanceLevel; workKey: string | null }

/** Pastilles orange ou rouges, puis éléments à traiter orange ou rouges ; le plus grave d'abord, ordre gardé à niveau égal. */
export function themeAttention(input: ThemeBriefInput): AttentionRow[] {
  const rows: AttentionRow[] = [];
  // Une pastille dont un élément à traiter parle déjà (« Vigilance météo rouge : 1 département ») n'est pas répétée.
  const hotTitles = input.items.filter((it) => isHot(it.level)).map((it) => it.title.toLowerCase());
  for (const p of input.pastilles) {
    if (p.level !== 'orange' && p.level !== 'rouge') continue;
    if (hotTitles.some((t) => t.startsWith(p.label.toLowerCase()))) continue;
    rows.push({ text: `${p.label} ${p.level}`, where: 'niveau de la pastille', level: p.level, workKey: null });
  }
  for (const it of input.items) {
    if (isHot(it.level)) rows.push({ text: it.title, where: it.place, level: it.level, workKey: it.key });
  }
  return rows.map((r, i) => ({ r, i })).sort((a, b) => LEVEL_RANK[b.r.level] - LEVEL_RANK[a.r.level] || a.i - b.i).map(({ r }) => r);
}

function attentionSection(input: ThemeBriefInput): FicheSection {
  const rows = themeAttention(input);
  const html = rows.length === 0
    ? emptyLine('Rien en orange ni en rouge dans cet onglet.')
    : rows.slice(0, MAX_ATTENTION).map((r) => listRow({
      text: r.text, value: r.where, level: r.level, ...(r.workKey ? { data: { work: r.workKey }, link: true } : {}),
    })).join('');
  return { id: 'attention', title: 'Ce qui demande attention', collapsible: true, open: input.open('attention', true), summary: String(rows.length), html };
}

/** Éléments à traiter sous l'orange (les orange et rouges sont déjà dans « Ce qui demande attention »). */
function itemsSection(input: ThemeBriefInput): FicheSection {
  const rest = input.items.filter((it) => !isHot(it.level));
  const loading = input.eventsStatus === 'loading' && input.items.length === 0;
  const html = loading ? emptyLine('Liste en cours de chargement.')
    : rest.length === 0 ? emptyLine(input.items.length > 0 ? 'Aucun autre élément : tout est dans « Ce qui demande attention ».' : 'Rien à traiter dans cet onglet pour le moment.')
    : rest.slice(0, MAX_ITEMS).map((it) => listRow({
      text: it.title, value: it.badge ? BADGE[it.badge] : null, level: it.level,
      note: rowMeta(it, 'fr', input.now) || null, data: { work: it.key }, link: true,
    })).join('') + (rest.length > MAX_ITEMS ? emptyLine(`Et ${rest.length - MAX_ITEMS} autres dans la liste « À traiter ».`) : '');
  return { id: 'items', title: 'Autres éléments à traiter', collapsible: true, open: input.open('items', true), summary: String(rest.length), html };
}

/** Ce qui a changé : passages de niveau des pastilles (24 h) et éléments nouveaux ou aggravés. */
export function themeChanges(input: ThemeBriefInput): Array<{ text: string; level: VigilanceLevel; at: number | null }> {
  const out: Array<{ text: string; level: VigilanceLevel; at: number | null }> = [];
  for (const c of input.changes) {
    if (input.now - c.at > DAY_MS) continue;
    const up = LEVEL_RANK[c.to] > LEVEL_RANK[c.from];
    out.push({ text: `${c.label} : ${up ? 'passe' : 'redescend'} de ${levelLabel(c.from).toLowerCase()} à ${levelLabel(c.to).toLowerCase()}`, level: c.to, at: c.at });
  }
  for (const it of input.items) {
    if (it.badge) out.push({ text: `${it.badge === 'nouveau' ? 'Nouveau' : 'Aggravé'} : ${it.title}`, level: it.level, at: it.since });
  }
  return out.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
}

function changesSection(input: ThemeBriefInput): FicheSection {
  const list = themeChanges(input);
  const html = list.length === 0
    ? emptyLine('Rien de nouveau depuis la dernière visite ni changement de niveau des pastilles depuis 24 h.')
    : list.slice(0, 12).map((c) => listRow({ text: c.text, value: c.at !== null ? formatAge(c.at, input.now) : null, level: c.level })).join('');
  return { id: 'changes', title: 'Ce qui change', collapsible: true, open: input.open('changes', true), summary: String(list.length), html };
}

const LEAD_MAX = 160;
const clip = (s: string): string => (s.length > LEAD_MAX ? `${s.slice(0, LEAD_MAX - 1).trimEnd()}…` : s);

/** Chiffre nul (« 0 », « 0,0 ») : un compte de problèmes à zéro, dit « RAS » plutôt qu'un 0 qui se lit comme un score. */
export function isZeroFigure(value: string): boolean {
  return /^0(?:[,.]0+)?$/.test(value.trim());
}

/** Ligne de synthèse d'une pastille : chiffre clé de son panneau, niveau, légende du chiffre, phrase de tête, état de la source. */
export function pastilleSynthesisRow(p: ThemeBriefPastille): string {
  const h = p.head ?? null;
  const fig = h?.figure ?? null;
  const dot: VigilanceLevel | 'gris' | null = p.level === null || p.level === 'nd' ? 'gris' : p.level;
  const figLevel = fig && fig.value !== 'n.d.' ? (fig.level ?? (p.level && p.level !== 'nd' ? p.level : null)) : null;
  const zero = fig !== null && isZeroFigure(fig.value);
  const value = !fig ? valueHtml(levelWord(p.level)) : zero ? valueHtml('RAS') : valueHtml(fig.value, figLevel);
  const parts = [
    // Compte à zéro : la légende du chiffre (« aéronef en urgence ») n'a plus de sens seule, la phrase du panneau le dit.
    fig && !zero ? fig.caption : null,
    h?.lead ? clip(h.lead) : null,
    ...(h?.status ?? []).filter((s) => s.length > 0),
    p.level === 'nd' ? 'source indisponible ou en retard' : null,
    h === null ? 'panneau pas encore lu' : null,
  ].filter((s): s is string => s !== null && s !== '');
  return listRow({ text: p.label, valueHtml: value, level: dot, note: parts.join(' · ') || null, data: { pastille: p.key }, link: true });
}

/** Synthèse des pastilles de l'onglet (commune aux En bref) : le plus grave d'abord, ordre de la barre à niveau égal. */
export function pastillesSynthesisSection(pastilles: readonly ThemeBriefPastille[], open: OpenFn): FicheSection {
  const rank = (l: WatchLevel | null): number => (l === null ? -1 : l === 'nd' ? 0.5 : LEVEL_RANK[l] + 1);
  const sorted = pastilles.map((p, i) => ({ p, i })).sort((a, b) => rank(b.p.level) - rank(a.p.level) || a.i - b.i).map(({ p }) => p);
  const html = sorted.length === 0 ? emptyLine('Aucune pastille dans cet onglet.') : sorted.map(pastilleSynthesisRow).join('');
  return { id: 'pastilles', title: 'Synthèse des pastilles', collapsible: true, open: open('pastilles', true), summary: String(sorted.length), html };
}

/** Sans rien d'orange ni de rouge : l'état des pastilles en une phrase (jaunes nommées, vertes comptées, indisponibles). */
function calmLead(pastilles: readonly ThemeBriefPastille[], items: readonly WorkItem[]): string {
  const yellow = pastilles.filter((p) => p.level === 'jaune').map((p) => p.label);
  const yellowItems = items.filter((it) => it.level === 'jaune').length;
  const green = pastilles.filter((p) => p.level === 'vert').length;
  const nd = pastilles.filter((p) => p.level === 'nd').map((p) => p.label);
  const parts = ['Aucun signal orange ou rouge'];
  if (yellow.length > 0) parts.push(`en jaune : ${yellow.join(', ')}`);
  if (yellowItems > 0) parts.push(yellowItems > 1 ? `${yellowItems} éléments jaunes à traiter` : '1 élément jaune à traiter');
  if (green > 0) parts.push(green > 1 ? `${green} pastilles au vert` : '1 pastille au vert');
  if (nd.length > 0) parts.push(`indisponible : ${nd.join(', ')}`);
  return `${parts.join(' · ')}.`;
}

function lead(input: ThemeBriefInput): string | null {
  const rows = themeAttention(input);
  if (rows.length === 0) return calmLead(input.pastilles, input.items);
  const top = rows[0].level;
  const same = rows.filter((r) => r.level === top);
  const words = same.slice(0, 3).map((r) => (r.where && r.workKey ? `${r.text} (${r.where})` : r.text));
  const rest = same.length - 3;
  return `${words.join(' · ')}${rest > 0 ? ` et ${rest > 1 ? `${rest} autres` : 'un autre'}` : ''}.`;
}

export function buildThemeBriefView(input: ThemeBriefInput): LayerView {
  const hot = input.items.filter((it) => isHot(it.level)).length;
  const level = themeBriefLevel(input);
  const copy = '<div class="fiche-actions eb-actions"><button type="button" class="fiche-action" data-copy-note>Copier pour une note</button>'
    + '<span class="eb-copied" aria-live="polite"></span></div>';
  return {
    head: {
      theme: input.themeName, kind: 'Synthèse', title: THEME_BRIEF_TITLE, level,
      // Pas de gros « 0 » (lu comme un score) : sans élément orange ou rouge, la phrase de tête dit l'état des pastilles.
      figure: hot === 0 ? null : { value: String(hot), caption: hot > 1 ? 'éléments orange ou rouges à traiter' : 'élément orange ou rouge à traiter', level: input.items.find((it) => isHot(it.level))?.level ?? null },
      status: [], lead: lead(input),
    },
    sections: [attentionSection(input), pastillesSynthesisSection(input.pastilles, input.open), itemsSection(input), changesSection(input)],
    bodyHtml: copy,
  };
}

/** Texte brut pour une note de situation (presse-papiers). Jamais de HTML ni d'espace insécable. */
export function themeBriefNoteText(input: ThemeBriefInput): string {
  const at = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' }).format(new Date(input.now));
  const lines = [`${input.themeName}, point de situation du ${at}`];
  const level = themeBriefLevel(input);
  if (level && level !== 'nd') lines.push(`Niveau de l’onglet : ${levelLabel(level).toLowerCase()}.`);
  const rows = themeAttention(input);
  lines.push('', 'Ce qui demande attention :');
  if (rows.length === 0) lines.push('- rien en orange ni en rouge.');
  for (const r of rows.slice(0, MAX_ATTENTION)) lines.push(`- ${r.text}${r.where && r.workKey ? ` : ${r.where}` : ''}.`);
  if (input.pastilles.length > 0) {
    lines.push('', 'Pastilles :');
    for (const p of input.pastilles) {
      const fig = p.head?.figure;
      lines.push(`- ${p.label} : ${fig ? `${fig.value} ${fig.caption}` : levelWord(p.level)}${p.level && p.level !== 'nd' ? ` (${levelLabel(p.level).toLowerCase()})` : ''}.`);
    }
  }
  const items = input.items.filter((it) => !isHot(it.level)).slice(0, 6);
  if (items.length > 0) {
    lines.push('', 'Autres éléments à traiter :');
    for (const it of items) lines.push(`- ${it.title}${it.place ? ` (${it.place})` : ''}.`);
  }
  const changes = themeChanges(input);
  if (changes.length > 0) {
    lines.push('', 'Évolutions :');
    for (const c of changes.slice(0, 8)) lines.push(`- ${c.text}${c.at !== null ? ` (${formatAge(c.at, input.now)})` : ''}.`);
  }
  lines.push('', 'Source France Monitor.');
  return lines.join('\n').replace(/[\u00a0\u202f]/g, ' ');
}
