// src/components/layer-panel/webcams.ts : vue pure du panneau Webcams ; aucun accès réseau ni DOM. Recensement statique des webcams
// publiques (OpenStreetMap, jeux ouverts data.gouv.fr), état des liens vérifié au recensement. Fiche de la webcam cliquée : lien
// « Ouvrir la webcam » (nouvel onglet) et vignette seulement pour une image directe réutilisable (countable), jamais d'iframe.
// Aucun effet sur l'indice de stabilité. Textes du fichier échappés.
import type { Webcam, WebcamsDataset } from '../../types/index.ts';
import {
  WEBCAM_STATUS_HEX, WEBCAM_STATUS_WORD, frDateTime, isVideoWebcam, sourceOf, webcamCounts, webcamEmbedUrl, webcamOpenUrl, webcamPlace,
  webcamThumbnailUrl,
} from '../../services/webcams.ts';
import { escapeHtml, safeHref } from '../france-intel-events.ts';
import { kvRow } from '../fiche/kit.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { emptyLine, listRow, loadingBody, sourceLinkHtml, type LayerView } from './frame.ts';
import { NBSP, frNumber } from './format.ts';
import { note } from './traffic-format.ts';

export const WEBCAMS_THEME = 'Environnement';
export const WEBCAMS_TITLE = 'Webcams';
type OpenFn = (sectionId: string, byDefault: boolean) => boolean;

export interface WebcamsViewInput {
  data: WebcamsDataset | null; error: string | null; selectedId: string | null; open: OpenFn;
  /** Webcams épinglées sur le mur (ordre du mur) ; absent = mur non proposé. */
  wallIds?: readonly string[];
}

const count = (n: number, one: string, many = `${one}s`): string => `${frNumber(n, 0)}${NBSP}${n > 1 ? many : one}`;

/** Lien externe : nouvel onglet, sans référent ni accès à la page d'origine. */
export function openLinkHtml(label: string, href: string | null): string {
  const safe = href ? safeHref(href) : null;
  return safe ? `<a class="lp-link wc-open" href="${safe}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>` : escapeHtml('n.d.');
}

/** Vignette : <img> paresseuse sans référent, seulement si la webcam est « countable » (image directe réutilisable et vivante). */
export function thumbnailHtml(w: Webcam): string {
  const url = webcamThumbnailUrl(w);
  const safe = url ? safeHref(url) : null;
  if (!safe) return '';
  return `<figure class="wc-thumb"><img src="${safe}" alt="${escapeHtml(`Image de la webcam ${w.name}`)}" loading="lazy" referrerpolicy="no-referrer" decoding="async">`
    + `<figcaption>${escapeHtml(w.attribution ?? 'Attribution n.d.')}${w.license ? ` · ${escapeHtml(w.license)}` : ''}</figcaption></figure>`;
}

/** Bouton « Ajouter au mur » / « Retirer du mur » de la fiche. */
export function wallToggleHtml(w: Webcam, onWall: boolean): string {
  return `<button type="button" class="wc-wall-btn${onWall ? ' is-on' : ''}" data-wall-toggle="${escapeHtml(w.id)}" aria-pressed="${onWall}">`
    + `${onWall ? 'Retirer du mur' : 'Ajouter au mur'}</button>`;
}

/** Fiche de la webcam choisie sur la carte. */
export function webcamFicheHtml(w: Webcam, ds: WebcamsDataset, wallIds?: readonly string[]): string {
  const source = sourceOf(ds, w.source);
  const state = `${WEBCAM_STATUS_WORD[w.status]}${w.httpStatus !== null ? ` (HTTP${NBSP}${w.httpStatus})` : ''}`;
  return `<p class="wc-name"><span class="lp-swatch" style="background:${WEBCAM_STATUS_HEX[w.status]}" aria-hidden="true"></span>${escapeHtml(w.name)}</p>`
    + (isVideoWebcam(w) ? kvRow('Type', 'Vidéo en direct (YouTube)') : '')
    + kvRow('Commune', escapeHtml(webcamPlace(w)))
    + kvRow('Source', source ? sourceLinkHtml(source.name, source.url) : escapeHtml(w.source))
    + kvRow('État', escapeHtml(state))
    + kvRow('Vérifiée le', escapeHtml(frDateTime(w.checkedAt) ?? 'n.d.'))
    + kvRow('Licence', escapeHtml(w.license ?? 'inconnue'))
    + kvRow('Attribution', escapeHtml(w.attribution ?? 'n.d.'))
    + `<p class="wc-actions">${openLinkHtml('Ouvrir la webcam', webcamOpenUrl(w))}${wallIds ? wallToggleHtml(w, wallIds.includes(w.id)) : ''}</p>`
    + thumbnailHtml(w)
    + (w.status !== 'ok' ? note('Le lien ne répondait pas au recensement : la webcam peut être arrêtée ou déplacée.') : '')
    + (webcamEmbedUrl(w) !== null ? note('Vidéo lisible sur le mur de webcams (« Ajouter au mur »). Position : site filmé ou, à défaut, centre de la commune.') : '')
    + (webcamThumbnailUrl(w) === null && !isVideoWebcam(w) ? note('Pas de vignette : seule une image directe sous licence ouverte est affichée ici ; le lien ouvre le site d’origine.') : '');
}

function ficheSection(ds: WebcamsDataset, selectedId: string | null, open: OpenFn, wallIds?: readonly string[]): FicheSection {
  const w = selectedId ? ds.webcams.find((x) => x.id === selectedId) ?? null : null;
  return {
    id: 'fiche', title: 'Webcam choisie', collapsible: true, open: open('fiche', true), summary: w ? escapeHtml(w.name) : undefined,
    html: w ? webcamFicheHtml(w, ds, wallIds) : emptyLine('Cliquer une webcam sur la carte pour afficher sa fiche.'),
  };
}

function statusSection(ds: WebcamsDataset, open: OpenFn): FicheSection {
  const c = webcamCounts(ds.webcams);
  const rows = (['ok', 'down', 'unknown'] as const).map((s) => listRow({
    text: WEBCAM_STATUS_WORD[s], color: WEBCAM_STATUS_HEX[s], value: count(c[s], 'webcam'),
  })).join('');
  return {
    id: 'etats', title: 'État des liens', collapsible: true, open: open('etats', true), summary: escapeHtml(`${frNumber(c.ok, 0)}${NBSP}actifs`),
    html: rows + listRow({ text: 'Vidéo en direct (YouTube)', value: count(c.video, 'webcam') })
      + listRow({ text: 'Image directe sous licence ouverte', value: count(c.countable, 'webcam') })
      + note('Vert : le lien répondait au recensement. Gris : lien mort, ou serveur qui refuse la vérification (non vérifiable).'),
  };
}

function sourcesSection(ds: WebcamsDataset, open: OpenFn): FicheSection {
  const rows = ds.sources.map((s) => listRow({
    text: s.name, value: count(s.count, 'webcam'), note: s.license ? `Licence : ${s.license}` : 'Licence n.d.',
  })).join('');
  return {
    id: 'sources', title: 'Par source', collapsible: true, open: open('sources', false), summary: count(ds.sources.length, 'source'),
    html: ds.sources.length === 0 ? emptyLine('Aucune source lue.') : rows,
  };
}

function methodSection(ds: WebcamsDataset, open: OpenFn): FicheSection {
  const links = ds.sources.map((s) => sourceLinkHtml(s.name, s.url)).join(' · ');
  const html = kvRow('Sources', links || 'n.d.')
    + kvRow('Recensement', escapeHtml(frDateTime(ds.generatedAt) ?? 'n.d.'))
    + note('Recensement des webcams publiques citées par OpenStreetMap (contributeurs OpenStreetMap, ODbL) et par les jeux ouverts de data.gouv.fr (Orléans Métropole, Loire-Atlantique, Anglet, Métropole de Lyon).')
    + note('Vidéos : directs YouTube de webcams françaises choisis à la main, lus dans le lecteur officiel (youtube-nocookie) ; l’intégration est vérifiée au recensement par l’oEmbed de YouTube. Un direct qui redémarre change d’adresse : il passe alors en lien mort jusqu’à la mise à jour de la liste.')
    + note('Chaque lien est vérifié une fois au recensement par une requête limitée ; aucune image n’est enregistrée. Un site peut refuser la vérification sans être hors service.')
    + note('Les images restent la propriété de leur diffuseur : la vignette n’est affichée que pour une image directe sous licence ouverte, sinon le lien ouvre le site d’origine.')
    + note('Fichier statique, régénéré à la main (npm run build:webcams).')
    + note('Cette couche n’a aucun effet sur l’indice de stabilité, les situations ni la synthèse.');
  return { id: 'methode', title: 'Méthode et sources', collapsible: true, open: open('methode', false), tone: 'reference', summary: 'OSM · data.gouv.fr', html };
}

/** Part des liens actifs, « 88 % » (un nombre seul comme 404 se lisait comme un code d'erreur). */
export function activeShare(ok: number, total: number): string {
  return total > 0 ? `${frNumber(Math.round((ok / total) * 100), 0)}${NBSP}%` : 'n.d.';
}

/** Accès au mur de webcams : images sous licence ouverte côte à côte, rafraîchies chaque minute. */
export function wallBarHtml(onWall: number, displayable: number, videos = 0): string {
  const label = onWall > 0 ? `Mur de webcams (${frNumber(onWall, 0)})` : 'Mur de webcams';
  return `<div class="wc-wall-bar"><button type="button" class="wc-wall-open" data-wall-open>${escapeHtml(label)}</button>`
    + `<span>${escapeHtml(`${frNumber(videos, 0)} vidéos en direct et ${frNumber(displayable, 0)} images sous licence ouverte`)}</span></div>`;
}

export function buildWebcamsView(input: WebcamsViewInput): LayerView {
  const { data, error, selectedId, open, wallIds } = input;
  if (data === null && error === null) {
    return { head: { theme: WEBCAMS_THEME, title: WEBCAMS_TITLE, status: ['chargement…'] }, sections: [], bodyHtml: loadingBody() };
  }
  if (data === null) {
    return {
      head: { theme: WEBCAMS_THEME, title: WEBCAMS_TITLE, level: null, figure: { value: 'n.d.', caption: 'webcams', level: null }, status: ['fichier indisponible'] },
      sections: [], bodyHtml: '<p class="fmk-callout lp-callout">Recensement des webcams indisponible. Réessayer en rouvrant la couche.</p>',
    };
  }
  const c = webcamCounts(data.webcams);
  const when = frDateTime(data.generatedAt);
  const wall = wallIds ? wallBarHtml(wallIds.length, c.countable, c.video) : '';
  const stale = error !== null ? '<p class="fmk-callout lp-callout">Relecture impossible : données précédentes conservées.</p>' : '';
  return {
    head: {
      theme: WEBCAMS_THEME, title: WEBCAMS_TITLE, level: null,
      figure: { value: activeShare(c.ok, c.total), caption: `liens actifs · ${frNumber(c.ok, 0)} sur ${frNumber(c.total, 0)}${NBSP}webcams`, level: null },
      status: [when ? `recensement du ${when}` : 'recensement n.d.'],
    },
    sections: [ficheSection(data, selectedId, open, wallIds), statusSection(data, open), sourcesSection(data, open), methodSection(data, open)],
    bodyHtml: stale + wall || undefined,
  };
}
