// src/components/shared/vigilancePill.ts — pastille de niveau L1 : le mot, sur la couleur du
// niveau, texte noir (seul choix qui passe le contraste AA sur les quatre teintes).
import { levelLabel, type VigilanceLevel } from '../../services/vigilance.ts';

export function renderVigilancePill(level: VigilanceLevel, lang: 'fr' | 'en' = 'fr'): string {
  return `<span class="fm-vig fm-vig--${level}">${levelLabel(level, lang)}</span>`;
}
