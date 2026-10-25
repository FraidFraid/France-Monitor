// src/components/map-key/transport-key.ts
/**
 * transport-key.ts : bloc Transports de la légende « Lire la carte » (onglet Transports, lots 1 et 2, 25/10/2026). La grille de lecture
 * commune aux quatre couches, avec les éléments comptés à l'écran : numéros pulsants = points de vigilance ; jaune, orange et rouge
 * réservés aux perturbations ; chaque mode garde sa teinte propre (roses de la route, avions bleu ciel, navires par type). Les
 * cartes de chaque couche suivent. Pur.
 */
import type { RoadEventKind } from '../../types/index.ts';
import { levelHex } from '../../services/vigilance.ts';
import { ROAD_EVENT_STYLE, roadBadgeSvg } from '../layer-panel/traffic-legend.ts';
import { TRANSPORT_MODE_ICON } from '../deckgl/transport-callouts.ts';
import { fmIcon } from '../shared/icons.ts';
import type { TransportVigilancePoint } from '../layer-panel/transport-vigilance.ts';

export interface TransportKeyModel {
  visible: boolean;
  points: readonly TransportVigilancePoint[];
  /** Événements DIR en cours dessinés, par nature (couche Route allumée), null sinon. */
  roadKinds: Partial<Record<RoadEventKind, number>> | null;
  /** Gares colorées (orange ou rouge) dessinées (couche Rail allumée), null sinon. */
  stations: { orange: number; rouge: number } | null;
}

function row(sym: string, label: string, n: number | null = null): string {
  return `<div class="mk-row mk-row--static"><span class="mk-sym">${sym}</span><span class="mk-lbl">${label}</span><span class="mk-n">${n ?? ''}</span></div>`;
}

function pointSym(level: 'orange' | 'rouge', icon: string): string {
  return `<span class="mk-tv" style="background:${levelHex(level)}" aria-hidden="true">${icon}</span>`;
}

const MODE_WORD: Readonly<Record<TransportVigilancePoint['mode'], string>> = {
  trafficRail: 'Étiquette : train', trafficRoad: 'Étiquette : route', trafficAir: 'Étiquette : avion', trafficMaritime: 'Étiquette : navire',
};

const ROAD_ORDER: readonly RoadEventKind[] = ['weather', 'closure', 'queue', 'accident', 'obstruction', 'lane', 'works', 'info'];

export function buildTransportKeyHtml(m: TransportKeyModel): string {
  if (!m.visible) return '';
  const rouge = m.points.filter((p) => p.level === 'rouge').length;
  const orange = m.points.length - rouge;
  const dot = (level: 'orange' | 'rouge'): string => `<svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="${levelHex(level)}" stroke="#0a0a0f" stroke-width="1.5"/></svg>`;
  const modes = [...new Set(m.points.map((p) => p.mode))];
  const points = m.points.length === 0 ? '<p class="mk-sub">Aucun point de vigilance à l’écran.</p>'
    : (rouge > 0 ? row(dot('rouge'), 'Point de vigilance rouge', rouge) : '')
      + (orange > 0 ? row(dot('orange'), 'Point de vigilance orange', orange) : '')
      + modes.map((mode) => row(pointSym(m.points.find((p) => p.mode === mode)?.level ?? 'orange', fmIcon(TRANSPORT_MODE_ICON[mode], { size: 11 })), MODE_WORD[mode])).join('')
      + '<div class="mk-sub">Point pulsant sur le lieu, relié à son étiquette ; l’icône de l’étiquette dit le mode, le numéro renvoie à l’En bref.</div>';
  const road = m.roadKinds === null ? '' : '<div class="mk-sub">Route : pastille à pictogramme selon la nature</div>'
    + ROAD_ORDER.filter((k) => (m.roadKinds?.[k] ?? 0) > 0).map((k) => row(roadBadgeSvg(k, 14), ROAD_EVENT_STYLE[k].label, m.roadKinds?.[k] ?? 0)).join('');
  const st = m.stations;
  const rail = st === null || st.orange + st.rouge === 0 ? ''
    : '<div class="mk-sub">Rail : pastille train pleine à partir de 45\u00a0min, anneau jaune de 15 à 44\u00a0min</div>'
      + (st.rouge > 0 ? row(`<svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="6" fill="${levelHex('rouge')}"/></svg>`, 'Gare : 90\u00a0min ou plus, ou train supprimé', st.rouge) : '')
      + (st.orange > 0 ? row(`<svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="5" fill="${levelHex('orange')}"/></svg>`, 'Gare : 45 à 89\u00a0min', st.orange) : '');
  return '<section class="mk" aria-label="Transports"><h3>Transports <small>points pulsants = points de vigilance</small></h3>'
    + '<div class="mk-sub">Jaune, orange, rouge : perturbations seulement. Chaque mode garde sa teinte : pastilles à pictogramme pour les incidents routiers, avions bleu ciel (plus grands et plus discrets en altitude), navires par type. Vert : mesuré seulement (tronçons fluides). Gris : donnée en retard.</div>'
    + points + road + rail + '</section>';
}
