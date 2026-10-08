// src/components/layer-panel/radar.ts : vue pure du panneau Radar météo (spec 2026-10-04 environnement § 2.3) ; aucun accès réseau
// ni DOM. Mosaïque de réflectivité Météo-France (DPRadar, 1 km, une image toutes les 5 min) produite par le worker du serveur. C'est
// une observation, pas un niveau : aucune pastille, gros chiffre = heure de la dernière image (S1), jamais coloré. Échelle des dBZ
// avec la pluie équivalente (Marshall-Palmer), sommets d'écho (option partagée avec le panneau Feux), profil vertical en un point
// (démonstration, daté), méthode et sources.
import type { RadarColumnResult } from '../../types/index.ts';
import { isEnvironmentDataLate } from '../../services/environment-levels.ts';
import type { RadarProfileState } from '../../services/environment-radar.ts';
import type { Radar2dManifest } from '../../services/radar-2d.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { absoluteTime, kvRow } from '../fiche/kit.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { profileObservationLabel, radarProfileErrorHtml, radarProfileHtml, radarProfileLoadingHtml } from '../radar-profile-view.ts';
import { ENVIRONMENT_THEME, clockOf, formatDbz, formatRainRate, marshallPalmerMmH, note, stamp } from './environment-format.ts';
import { ECHO_TOP_CLASSES, RADAR_DBZ_CLASSES } from './environment-legend.ts';
import { NBSP } from './format.ts';
import { emptyLine, listRow, loadingBody, sourceErrorCallout, sourceLinkHtml, type LayerHeadModel, type LayerView } from './frame.ts';
import { coordText } from './traffic-format.ts';

export const RADAR_TITLE = 'Radar météo';

export interface RadarViewInput {
  manifest: Radar2dManifest | null;
  /** Faux : variable METEO_FRANCE_RADAR_MANIFEST_URL absente (aucun worker configuré). */
  configured: boolean;
  manifestError: string | null;
  /** Option « Sommets d'écho » (état unique App.echoTopsEnabled, partagé avec le panneau Feux). */
  echoTops: boolean;
  /** Le manifeste publie une image des sommets d'écho. */
  echoTopsAvailable: boolean;
  /** Point cliqué sur la carte (couche active) et son profil. */
  profile: RadarProfileState | null;
  now: number;
  open: (sectionId: string, byDefault: boolean) => boolean;
}
type OpenFn = RadarViewInput['open'];

const DPRADAR_URL = 'https://portail-api.meteofrance.fr/web/fr/api/DPRadar';
const CAPTION = `dernière image Météo-France · mosaïque 1${NBSP}km · une image toutes les 5${NBSP}min`;
const NOT_CONFIGURED = 'Worker radar non configuré : aucune image ni profil (variable METEO_FRANCE_RADAR_MANIFEST_URL absente).';

function late(m: Radar2dManifest, now: number): boolean {
  return isEnvironmentDataLate('radar', m.observedAt, now);
}

// ─── En-tête ───

function headOf(input: RadarViewInput): LayerHeadModel {
  const { manifest: m, manifestError, configured, now } = input;
  const base = { theme: ENVIRONMENT_THEME, title: RADAR_TITLE };
  if (!configured) {
    return { ...base, figure: { value: 'n.d.', caption: CAPTION, level: null }, status: ['worker radar non configuré'] };
  }
  if (m === null) {
    return { ...base, figure: { value: 'n.d.', caption: CAPTION, level: null }, status: ['Radar Météo-France injoignable'] };
  }
  const isLate = late(m, now);
  const ms = Date.parse(m.observedAt);
  return {
    ...base,
    // Observation, pas un niveau : jamais de couleur, même à l'heure (level: null explicite).
    figure: { value: Number.isFinite(ms) ? absoluteTime(ms, now, 'fr') : 'n.d.', caption: `${CAPTION}${isLate ? ' (en retard)' : ''}${manifestError !== null ? ' (dernière image gardée)' : ''}`, level: null },
    status: [stamp('Radar Météo-France', m.observedAt, isLate, now), ...(manifestError !== null ? ['dernière image gardée (lecture en échec)'] : [])],
    lead: 'Observation de la réflectivité, pas un niveau de vigilance : à lire avec la vigilance Météo-France.',
  };
}

// ─── Échelle des réflectivités ───

function scaleSection(open: OpenFn): FicheSection {
  const rows = RADAR_DBZ_CLASSES.map((c, i) => listRow({
    text: `${formatDbz(c.dbz)} et plus`, value: formatRainRate(marshallPalmerMmH(c.dbz)), color: `var(--radar-dbz-${i + 1})`,
  })).join('');
  return {
    id: 'echelle', title: 'Échelle des réflectivités', collapsible: true, open: open('echelle', true),
    summary: 'dBZ et pluie équivalente',
    html: rows
      + note('Pluie équivalente par la relation de Marshall-Palmer : Z = 200 R^1,6, soit R = (10^(dBZ/10) / 200)^(1/1,6) en mm/h.')
      + note(`Au-delà de 50${NBSP}dBZ, grêle possible : la relation surestime alors la pluie. Les couleurs sont celles de l’image du worker radar.`),
  };
}

// ─── Sommets d'écho ───

function echoTopsSection(input: RadarViewInput): FicheSection {
  const { echoTops, echoTopsAvailable, open } = input;
  const base = { id: 'sommets', title: 'Sommets d’écho', collapsible: true, open: open('sommets', false) };
  if (!echoTopsAvailable) {
    return { ...base, summary: 'non publiés', html: emptyLine('Sommets d’écho non publiés par ce manifeste.') };
  }
  const button = `<button type="button" class="lp-toggle" data-echo-tops="${echoTops ? 'on' : 'off'}" aria-pressed="${echoTops}">`
    + `${echoTops ? 'Sommets d’écho affichés sur la carte' : 'Afficher les sommets d’écho sur la carte'}</button>`;
  const rows = ECHO_TOP_CLASSES.map((c, i) => {
    const next = ECHO_TOP_CLASSES[i + 1];
    return listRow({ text: next ? `${c.km} à ${next.km}${NBSP}km` : `${c.km}${NBSP}km et plus`, color: `var(--echo-top-${i + 1})` });
  }).join('');
  return {
    ...base, summary: echoTops ? 'affichés' : 'masqués',
    html: `<div class="lp-toolbar">${button}</div>` + rows
      + note(`Altitude du plus haut écho significatif. Au-delà de 8${NBSP}km, sommet orageux ou pyroconvection possible (panache d’un grand feu).`)
      + note('Option partagée avec le panneau Feux de forêt (module « Hauteur du panache »).'),
  };
}

// ─── Profil vertical en un point (démonstration) ───

/** Résumé de la section : station et heure d'observation avec la date. */
function profileSummary(result: RadarColumnResult, now: number): string {
  if (result.kind === 'hors-couverture') return 'hors de portée';
  const label = profileObservationLabel(result.profile.observedAt, now);
  return `${result.profile.station.name} · ${label.replace(/^observation du /, '')}`;
}

function profileSection(input: RadarViewInput): FicheSection {
  const { profile, configured, now, open } = input;
  const base = { id: 'profil', title: 'Profil vertical en un point', collapsible: true, open: open('profil', false) };
  if (!configured) return { ...base, summary: 'n.d.', html: emptyLine(NOT_CONFIGURED) };
  if (profile === null) {
    return {
      ...base, summary: 'aucun point',
      html: emptyLine('Cliquer sur la carte pour lire le profil vertical de réflectivité au radar le plus proche (démonstration).'),
    };
  }
  const where = note(`Point ${coordText(profile.lat, profile.lon)}`);
  if (profile.result === 'loading') return { ...base, summary: 'chargement…', html: where + radarProfileLoadingHtml() };
  if (profile.result === 'error') return { ...base, summary: 'indisponible', html: where + radarProfileErrorHtml() };
  return {
    ...base, summary: escapeHtml(profileSummary(profile.result, now)),
    html: where + radarProfileHtml(profile.result, now),
  };
}

// ─── Méthode et sources ───

function methodSection(input: RadarViewInput): FicheSection {
  const { manifest: m, configured, manifestError, now, open } = input;
  const state = !configured
    ? 'worker radar non configuré'
    : m === null
      ? (manifestError !== null ? 'source injoignable' : 'chargement…')
      : `image du ${Number.isFinite(Date.parse(m.observedAt)) ? absoluteTime(Date.parse(m.observedAt), now, 'fr', { withDate: true }) : 'n.d.'}${late(m, now) ? ' (en retard)' : ''}, générée à ${clockOf(m.generatedAt, now)}`;
  const html = kvRow('Mosaïque', `${sourceLinkHtml('Météo-France, DPRadar', DPRADAR_URL)} · ${escapeHtml(state)}`)
    + kvRow('Licence', escapeHtml('Licence Ouverte 2.0'))
    + note(`Image produite par le worker radar du serveur à partir de la mosaïque de réflectivité de Météo-France : 1${NBSP}km, métropole et Corse avec leurs marges, une image toutes les 5${NBSP}min, latence de 5 à 10${NBSP}min après l’observation.`)
    + note(`Retard : au-delà de 15${NBSP}min après l’observation, l’heure porte « (en retard) ». Pas de niveau : c’est une observation, pas une vigilance.`)
    + note('Profil vertical : colonne de réflectivité brute (PAM) au radar le plus proche du point, échos fixes non corrigés, sans diagnostic automatique ; démonstration.')
    + (manifestError !== null ? note(`Incident de lecture : ${manifestError}.`) : '');
  return {
    id: 'methode', title: 'Méthode et sources', collapsible: true, open: open('methode', false), tone: 'reference', html,
    summary: escapeHtml(!configured ? 'non configuré' : m === null && manifestError !== null ? '1 source · indisponible' : '1 source'),
  };
}

// ─── Assemblage ───

export function buildRadarView(input: RadarViewInput): LayerView {
  const { manifest: m, manifestError, configured, now, open } = input;
  if (configured && m === null && manifestError === null) {
    return { head: { theme: ENVIRONMENT_THEME, title: RADAR_TITLE, status: ['chargement…'] }, sections: [], bodyHtml: loadingBody() };
  }
  const sections = [scaleSection(open), echoTopsSection(input), profileSection(input), methodSection(input)];
  const bodyHtml = !configured
    ? emptyLine(NOT_CONFIGURED)
    : m === null
      ? sourceErrorCallout(null, now)
      : manifestError !== null ? sourceErrorCallout(Date.parse(m.observedAt), now) : undefined;
  return { head: headOf(input), sections, bodyHtml };
}
