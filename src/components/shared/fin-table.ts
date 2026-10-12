// src/components/shared/fin-table.ts : ligne de tableau commune aux blocs « Stabilité financière » et « Matières premières »
// (refonte du 12/10/2026, style terminal) : nom avec unité et date dessous, valeur alignée à droite en chiffres à chasse fixe,
// note (mot du niveau ou variation du jour), courbe de largeur fixe. Une ligne en alerte (jaune et plus) porte un liseré et un
// fond teintés à la couleur du niveau. Module pur : HTML en chaîne.
import { LEVEL_RANK, levelColorVar, type VigilanceLevel } from '../../services/vigilance.ts';

export interface FinTableNote {
  text: string;
  /** Mot d'un niveau L1 (couleur du niveau). */
  level?: VigilanceLevel;
  /** Variation du jour : sens (neutre), ou alerte (mouvement exceptionnel, jaune). */
  tone?: 'up' | 'down' | 'flat' | 'alert';
}

export interface FinTableRow {
  id: string;
  name: string;
  unit?: string;
  /** Date de valeur ou fraîcheur, sous le nom. */
  meta?: string;
  value: string;
  note?: FinTableNote;
  /** Courbe SVG déjà construite (chaîne vide : pas de courbe). */
  curve: string;
  /** Niveau de la ligne : jaune et plus = ligne en alerte. */
  level?: VigilanceLevel | null;
  help?: string;
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function finTableRowHTML(r: FinTableRow): string {
  const alert = r.level != null && LEVEL_RANK[r.level] >= LEVEL_RANK.jaune;
  const cls = alert ? 'fin-row is-alert' : 'fin-row';
  const style = alert && r.level ? ` style="--fin-lvl:${levelColorVar(r.level)}"` : '';
  const title = r.help ? ` title="${esc(r.help)}"` : '';
  const unit = r.unit ? `<span class="fin-row__unit">${esc(r.unit)}</span>` : '';
  const meta = r.meta ? `<span class="fin-row__meta">${esc(r.meta)}</span>` : '';
  const note = r.note
    ? r.note.level
      ? `<span class="fin-row__note is-level" style="--fin-note:${levelColorVar(r.note.level)}">${esc(r.note.text)}</span>`
      : `<span class="fin-row__note is-${r.note.tone ?? 'flat'}">${esc(r.note.text)}</span>`
    : '<span class="fin-row__note"></span>';
  return `<div class="${cls}" data-id="${esc(r.id)}"${style}${title}>`
    + `<span class="fin-row__label"><span class="fin-row__name">${esc(r.name)}</span>${unit}${meta}</span>`
    + `<span class="fin-row__value">${esc(r.value)}</span>`
    + note
    + `<span class="fin-row__curve">${r.curve}</span>`
    + '</div>';
}
