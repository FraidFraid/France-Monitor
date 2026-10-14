/**
 * events-key.ts : bloc « Événements en cours » et « Autres articles » de la légende (spec 2026-10-14).
 * Règles : symboles identiques à la carte (mêmes constantes), une variable par rôle (couleur = niveau,
 * taille = sources, rond vide = à confirmer), cercles emboîtés pour la taille, seulement ce qui est à
 * l'écran, jamais la couleur seule (libellé et signification écrits).
 */
import { categoryIcon, categoryLabel, drawnRadius, NEWS_INFO_HEX, type EventMapPoint } from '../../services/v2-map.ts';
import { LEVEL_RANK, levelHex, levelLabel, levelPhrase, type VigilanceLevel } from '../../services/vigilance.ts';
import { fmIcon } from '../shared/icons.ts';

export interface EventsKeyModel {
  eventsVisible: boolean;
  newsVisible: boolean;
  /** Événements de la carte AVANT le masquage par niveau : les comptes restent visibles pour un niveau masqué. */
  points: readonly EventMapPoint[];
  hiddenLevels: ReadonlySet<VigilanceLevel>;
}

const LEVELS: readonly VigilanceLevel[] = ['rouge', 'orange', 'jaune', 'vert'];
const NBSP = ' ';
const LABEL_GAP = 15;

function dot(color: string, r: number, hollow = false): string {
  const d = r * 2 + 4;
  const fill = hollow ? 'rgba(10,10,15,0.55)' : color;
  const stroke = hollow ? color : 'rgba(10,10,18,0.9)';
  return `<svg width="${d}" height="${d}" viewBox="0 0 ${d} ${d}" aria-hidden="true">`
    + `<circle cx="${d / 2}" cy="${d / 2}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${hollow ? 2 : 1}"/></svg>`;
}

/** Cercles emboîtés alignés par le bas ; libellés écartés d'au moins 15 px, reliés au sommet de leur cercle. */
export function nestedCirclesSvg(radii: readonly number[], labels: readonly string[], unit: string): string {
  const pad = 8;
  const max = Math.max(...radii);
  const cx = max + 2;
  const base = pad + max * 2 + 2;
  const tops = radii.map((r) => base - 2 * r);
  const ys: number[] = [];
  tops.forEach((t, k) => { ys.push(k === 0 ? Math.max(t, 12) : Math.max(t, ys[k - 1] + LABEL_GAP)); });
  const lx = cx + max + 22;
  const height = Math.max(base, ys[ys.length - 1]) + 8;
  const width = lx + 120;
  const circles = radii.map((r) => `<circle cx="${cx}" cy="${base - r}" r="${r}" fill="none" stroke="#c8c8d4" stroke-width="1"/>`).join('');
  const leaders = radii.map((_, k) => `<polyline points="${cx},${tops[k]} ${cx + max + 8},${tops[k]} ${lx - 4},${ys[k]}" fill="none" stroke="#6e6e80" stroke-width="1"/>`).join('');
  const texts = labels.map((l, k) => `<text x="${lx}" y="${ys[k]}" dominant-baseline="middle" fill="#e8e8ec" font-size="12">${l}</text>`).join('');
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${unit} : ${labels.join(', ')}">${circles}${leaders}${texts}</svg>`;
}

function eventsBlock(m: EventsKeyModel): string {
  const counts = new Map<VigilanceLevel, number>();
  for (const p of m.points) counts.set(p.level, (counts.get(p.level) ?? 0) + 1);
  const rows = LEVELS.filter((l) => (counts.get(l) ?? 0) > 0).map((l) => {
    const on = !m.hiddenLevels.has(l);
    return `<button type="button" class="mk-row${on ? '' : ' mk-row--off'}" data-key-action="level:${l}" aria-pressed="${on}" title="Afficher ou masquer ce niveau">`
      + `<span class="mk-sym">${dot(levelHex(l), 7)}</span><span class="mk-lbl"><b>${levelLabel(l)}</b> · ${levelPhrase(l)}</span>`
      + `<span class="mk-n">${counts.get(l) ?? 0}</span></button>`;
  }).join('');
  const unconfirmed = m.points.filter((p) => p.hollow).length;
  const hollowRow = unconfirmed > 0
    ? `<div class="mk-row mk-row--static"><span class="mk-sym">${dot(levelHex('rouge'), 7, true)}</span>`
      + '<span class="mk-lbl"><b>Rond vide</b> · à confirmer : gravité signalée par une seule source (contour à la couleur du niveau)</span>'
      + `<span class="mk-n">${unconfirmed}</span></div>`
    : '';
  const sizes = nestedCirclesSvg([12, 8, 5], [`5${NBSP}sources et plus`, `2 à 4${NBSP}sources`, `1${NBSP}source`], 'Sources indépendantes');
  const alerts = m.points.filter((p) => p.alert).sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level]);
  const domains = [...new Set(alerts.map((p) => p.category))];
  const icons = domains.length > 0
    ? `<div class="mk-sub">Pictogramme : domaine (rouge et orange seulement)</div><div class="mk-icons">${domains.map((c) =>
      `<span><i class="mk-pic" style="--r:${drawnRadius({ radius: 5, alert: true })}px">${fmIcon(categoryIcon(c), { size: 11 })}</i>${categoryLabel(c)}</span>`).join('')}</div>`
    : '';
  const empty = rows === '' ? '<p class="mk-sub">Aucun événement sur la carte.</p>' : '';
  return '<section class="mk" aria-label="Événements en cours"><h3>Événements en cours <small>points</small></h3>'
    + `<div class="mk-sub">Couleur : niveau de vigilance retenu</div>${rows}${empty}${hollowRow}`
    + `<div class="mk-sub">Taille : sources indépendantes</div><div class="mk-key">${sizes}</div>${icons}</section>`;
}

function newsBlock(): string {
  const cluster = `<svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><circle cx="13" cy="13" r="12" fill="${levelHex('vert')}" stroke="rgba(10,10,18,0.9)"/>`
    + '<text x="13" y="13" dominant-baseline="middle" text-anchor="middle" font-size="11" font-weight="700" fill="#0a0a0f">4</text></svg>';
  return '<section class="mk" aria-label="Autres articles"><h3>Autres articles <small>hors événement</small></h3>'
    + `<div class="mk-row mk-row--static"><span class="mk-sym">${dot('#9898a8', 4.5)}</span><span class="mk-lbl">Article isolé, à la couleur de son niveau</span><span class="mk-n"></span></div>`
    + `<div class="mk-row mk-row--static"><span class="mk-sym">${dot(NEWS_INFO_HEX, 4.5)}</span><span class="mk-lbl"><b>Bleu</b> · Information sans gravité</span><span class="mk-n"></span></div>`
    + `<div class="mk-row mk-row--static"><span class="mk-sym">${cluster}</span><span class="mk-lbl">Groupe d’articles proches : le chiffre donne leur nombre</span><span class="mk-n"></span></div>`
    + '<div class="mk-sub">Les articles d’un événement ne sont pas redessinés : ils sont dans son aperçu.</div></section>';
}

export function buildEventsKeyHtml(m: EventsKeyModel): string {
  return `${m.eventsVisible ? eventsBlock(m) : ''}${m.newsVisible ? newsBlock() : ''}`;
}
