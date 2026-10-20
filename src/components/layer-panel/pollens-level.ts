// src/components/layer-panel/pollens-level.ts : niveau de la pastille Pollens et jours d'échéance (20/10/2026). Pur et léger : l'app
// l'importe pour le voyant et la synthèse sans charger la vue entière du panneau (layer-panel/pollens.ts).
import type { PollenDay, PollenDept, PollenDeptDay, PollenResponse, PollenTaxon } from '../../types/index.ts';
import { POLLEN_WORD } from './pollens-legend.ts';
import { isEnvironmentDataLate, nextDayOf, parisDayOf } from '../../services/environment-levels.ts';
import type { VigilanceLevel } from '../../services/vigilance.ts';

/** Seuil « élevé » de l'indice pollen Atmo (code 4). */
export const POLLEN_HIGH = 4;
const HIGH = POLLEN_HIGH;

/** Jour civil d'une échéance (calendrier de Paris, jamais + 24 h). */
export function pollenDate(day: PollenDay, now: number): string {
  const today = parisDayOf(now);
  return day === 'J' ? today : day === 'J1' ? nextDayOf(today) : nextDayOf(nextDayOf(today));
}

export function pollenLate(p: PollenResponse, now: number): boolean {
  return isEnvironmentDataLate('pollen', p.updatedAt, now);
}

export function pollenDeptDayOf(d: PollenDept | undefined, date: string): PollenDeptDay | null {
  return d?.days.find((x) => x.date === date) ?? null;
}

/** Niveau FranceMonitor de la pastille et du chiffre : rouge dès 6, orange à 5, jaune à 4, vert sinon (mesuré). */
export function pollenLevelOf(maxCode: number): VigilanceLevel {
  if (maxCode >= 6) return 'rouge';
  if (maxCode >= 5) return 'orange';
  if (maxCode >= HIGH) return 'jaune';
  return 'vert';
}

/** Départements publiés pour un jour, avec leur détail. */
export function pollenDayRows(p: PollenResponse, date: string): Array<{ dept: PollenDept; d: PollenDeptDay }> {
  return p.departments.flatMap((dept) => {
    const d = pollenDeptDayOf(dept, date);
    return d === null ? [] : [{ dept, d }];
  });
}

/** Niveau de la pastille : n.d. sans donnée, en retard ou sans prévision du jour ; sinon selon le plus haut code du jour. */
export function pollensHeadLevel(p: PollenResponse | null, now: number): VigilanceLevel | 'nd' {
  if (p === null || pollenLate(p, now)) return 'nd';
  const today = pollenDayRows(p, parisDayOf(now));
  if (today.length === 0) return 'nd';
  return pollenLevelOf(today.reduce((m, r) => Math.max(m, r.d.maxCode), 0));
}


// ─── Taxons ───

export const POLLEN_TAXA_INFO: Readonly<Record<PollenTaxon, { label: string; feminine: boolean; plural: boolean }>> = {
  aulne: { label: 'aulne', feminine: false, plural: false },
  bouleau: { label: 'bouleau', feminine: false, plural: false },
  olivier: { label: 'olivier', feminine: false, plural: false },
  graminees: { label: 'graminées', feminine: true, plural: true },
  armoise: { label: 'armoise', feminine: true, plural: false },
  ambroisie: { label: 'ambroisie', feminine: true, plural: false },
};
export const POLLEN_TAXA_ORDER: readonly PollenTaxon[] = ['aulne', 'bouleau', 'olivier', 'graminees', 'armoise', 'ambroisie'];

/** Niveau accordé au taxon : « élevée » pour l'ambroisie, « élevées » pour les graminées. */
export function pollenWordFor(code: number, taxon: PollenTaxon): string {
  const base = POLLEN_WORD[code] ?? 'n.d.';
  const info = POLLEN_TAXA_INFO[taxon];
  return `${base}${info.feminine && base.endsWith('é') ? 'e' : ''}${info.plural && base !== 'n.d.' ? 's' : ''}`;
}
