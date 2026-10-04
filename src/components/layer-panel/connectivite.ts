// src/components/layer-panel/connectivite.ts : vue pure du panneau Connectivité (couche `subseaCables`, spec 2026-10-04 souveraineté
// § 2.2 ; contrats § 4.1) ; aucun accès réseau ni DOM. Câbles télécom sous-marins tirés d'OpenStreetMap (fichier daté, ODbL 1.0) et
// leurs atterrages en France ; navires lents à moins de 500 m d'un tracé, confirmés sur deux relevés AIS du serveur : « à vérifier »,
// jamais une menace. Flux AIS muet (T3) : « non évalué », alertes gardées en gris, jamais « aucun navire ». Chaque partie porte la date
// de sa donnée (S1) ; une panne se voit (S3).
import type { CableAlert, CableLanding, CablesWatchResponse, SubseaCable, SubseaCablesFile } from '../../types/index.ts';
import { cableAlertLevel, cablesLevel, isSovereigntyDataLate } from '../../services/sovereignty-levels.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { absoluteTime, kvRow } from '../fiche/kit.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { NBSP } from './format.ts';
import { emptyLine, listRow, loadingBody, sourceErrorCallout, sourceLinkHtml, type LayerHeadModel, type LayerView } from './frame.ts';
import { departementName } from './health-format.ts';
import {
  SOVEREIGNTY_THEME, cablesUnevaluatedWhy, capitalize, clockOf, dataMs, dateOf, formatCount, formatKnots, formatMeters, glueSovUnits, note, plural,
  readErrors, shortDate, sourceDown, stamp,
} from './sovereignty-format.ts';

export type OpenFn = (sectionId: string, byDefault: boolean) => boolean;

export const CONNECTIVITE_TITLE = 'Connectivité';

/** Entrée de la vue ; la phase B y ajoute la visibilité des grands réseaux (B26). */
export interface ConnectiviteViewInput {
  watch: CablesWatchResponse | null; watchError: string | null;
  file: SubseaCablesFile | null; fileError: string | null;
  canFocus: boolean; now: number; open: OpenFn;
}

const OSM_URL = 'https://www.openstreetmap.org/copyright';
const SHOM_URL = 'https://www.data.gouv.fr/datasets/conduites-et-cables-sous-marins-repertories-par-le-shom/';
const SHOM_REGLEMENTATION_URL = 'https://www.data.gouv.fr/datasets/reglementation-navigation-1/';
const LANDING_COLOR = 'var(--cat-landing)';

/** Compte suivi de son nom, insécables (R1) : « 39 câbles », « 50 atterrages ». */
function counted(n: number, word: string): string {
  return glueSovUnits(plural(n, word));
}
const CABLE_COLOR = 'var(--cat-cable)';
const NEVER_A_THREAT = `Navires à moins de 500${NBSP}m d’un tracé et à moins de 2${NBSP}nœuds, confirmés sur deux relevés espacés d’au moins 5 minutes : `
  + '« à vérifier », jamais une menace ; seule la préfecture maritime qualifie une infraction.';
const MUTED_ZONE = 'non évaluée (flux de la zone muet)';
const OFFSHORE = 'tronçon au large';

/** Câble du Shom : identifiant « shom/FR… » (le Shom ne publie aucun nom). */
function isShom(c: SubseaCable): boolean {
  return c.source === 'Shom';
}

/** Nom lu : le nom OpenStreetMap, « câble sans nom » sinon ; un câble du Shom (sans nom) : « câble télécom (Shom) », ou « tronçon au large » sans atterrage. */
function cableName(c: SubseaCable): string {
  if (c.name !== null) return c.name;
  if (!isShom(c)) return 'câble sans nom';
  return c.landings.length === 0 ? OFFSHORE : 'câble télécom (Shom)';
}

/** Source et licence d'un câble, par objet : « Shom, CC BY-SA », « OpenStreetMap, ODbL 1.0 ». */
function cableSource(c: SubseaCable): string {
  return `${c.source}, ${c.licence}`;
}

/** Édition d'une source du fichier : « 2019-01-07 » devient « 07/01/2019 », « 2021-07 » devient « 07/2021 » ; null si non publiée. */
function editionText(edition: string | null): string | null {
  if (edition === null) return null;
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(edition);
  return m === null ? null : m[3] !== undefined ? `${m[3]}/${m[2]}/${m[1]}` : `${m[2]}/${m[1]}`;
}

/** Édition des câbles du Shom (couche des câbles), sinon null. */
function shomCablesEdition(file: SubseaCablesFile): string | null {
  const s = file.sources.find((x) => x.source === 'Shom' && x.layer.includes('cblsub'));
  return editionText(s?.edition ?? null);
}

/** Lieu d'un atterrage : la commune nommée par le script, sinon le département (« Finistère (29) »). */
export function landingPlace(l: CableLanding): string {
  return l.commune !== '' ? `${l.commune} (${l.dept})` : `${departementName(l.dept)} (${l.dept})`;
}

function landingCount(file: SubseaCablesFile): number {
  return file.cables.reduce((n, c) => n + c.landings.length, 0);
}

interface LandingGroup { place: string; cables: SubseaCable[]; first: string }

/** Câbles d'un lieu, noms répétés comptés (« BARMAR, 3 câbles télécom (Shom) »). */
function cableNames(cables: readonly SubseaCable[]): string {
  const counts = new Map<string, number>();
  const label = (c: SubseaCable): string => (c.outOfService ? `${cableName(c)} hors service` : cableName(c));
  for (const c of cables) counts.set(label(c), (counts.get(label(c)) ?? 0) + 1);
  return [...counts].map(([name, n]) => (n > 1 && name.startsWith('câble ') ? `${counted(n, 'câble')} ${name.slice('câble '.length)}` : name)).join(', ');
}

/** Atterrages regroupés par lieu, chaque câble compté une fois par lieu ; les lieux qui reçoivent le plus de câbles d'abord. */
function landingGroups(file: SubseaCablesFile): LandingGroup[] {
  const groups = new Map<string, LandingGroup>();
  for (const c of file.cables) {
    c.landings.forEach((l, i) => {
      const place = landingPlace(l);
      const group = groups.get(place) ?? { place, cables: [], first: `${c.id}:${i}` };
      if (!group.cables.includes(c)) group.cables.push(c);
      groups.set(place, group);
    });
  }
  return [...groups.values()].sort((a, b) => b.cables.length - a.cables.length || a.place.localeCompare(b.place, 'fr'));
}

function aisFrozen(w: CablesWatchResponse): boolean {
  return !w.evaluated;
}

function aisLate(w: CablesWatchResponse, now: number): boolean {
  return isSovereigntyDataLate('ais-cables', w.aisLastMessageAt, now);
}

// ─── En-tête ───

function stamps(w: CablesWatchResponse, file: SubseaCablesFile | null, now: number): string {
  return `${stamp('AIS', w.aisLastMessageAt, w.evaluated && aisLate(w, now), now)} · câbles ${file ? `du ${shortDate(file.generatedAt, now)}` : 'n.d.'}`;
}

function leadOf(file: SubseaCablesFile | null): string | null {
  if (file === null) return null;
  const n = file.cables.length;
  return `${counted(n, 'câble')} télécom ${n > 1 ? 'sous-marins' : 'sous-marin'} dans les eaux françaises, ${counted(landingCount(file), 'atterrage')} en France, `
    + 'd’après le Shom et OpenStreetMap.';
}

function headOf(w: CablesWatchResponse, file: SubseaCablesFile | null, now: number): LayerHeadModel {
  const base = { theme: SOVEREIGNTY_THEME, title: CONNECTIVITE_TITLE, lead: leadOf(file) };
  if (w.readAt === null) {
    return {
      ...base, level: 'nd', figure: { value: 'n.d.', caption: 'navires lents sur un câble : veille des câbles indisponible', level: null },
      status: ['veille des câbles indisponible'],
    };
  }
  const since = clockOf(w.aisLastMessageAt, now);
  if (aisFrozen(w)) {
    // Cause dite (tâche A5) : AIS muet, fichier des câbles illisible, relais injoignable ou relevé interrompu.
    const why = cablesUnevaluatedWhy(w, now);
    return {
      ...base, level: 'nd', figure: { value: 'n.d.', caption: `navires lents sur un câble : non évalué · ${why}`, level: null },
      status: [`non évalué · ${why}`, stamps(w, file, now)],
    };
  }
  const isLate = aisLate(w, now);
  const n = w.alerts.filter((a) => a.zoneMuted !== true).length;   // les alertes de zone muette ne sont pas dans le relevé
  const verdict = cablesLevel(w, now);
  return {
    ...base,
    figure: {
      value: formatCount(n),
      caption: `${n > 1 ? 'navires lents' : 'navire lent'} à moins de 500${NBSP}m d’un câble · AIS à jour ${since}${isLate ? ' (en retard)' : ''}`,
      ...(isLate ? { level: null } : {}),
    },
    level: isLate ? 'nd' : verdict.level,
    status: [isLate ? 'niveau suspendu : relevé AIS en retard' : glueSovUnits(verdict.reason), stamps(w, file, now)],
  };
}

// ─── Câbles et atterrages ───

function fileNote(file: SubseaCablesFile, now: number): string {
  const base = dataMs(file.osmBase);
  const shom = shomCablesEdition(file);
  const hasShom = file.cables.some(isShom);
  const hasOsm = file.cables.some((c) => !isShom(c));
  const parts = [
    ...(hasShom ? [`du Shom (CC BY-SA${shom === null ? '' : `, édition du ${shom}`})`] : []),
    ...(hasOsm ? [`d’OpenStreetMap (ODbL 1.0, base OSM du ${base === null ? 'n.d.' : absoluteTime(base, now, 'fr', { withDate: true })})`] : []),
  ];
  return note(`Tracés ${parts.length > 0 ? parts.join(' et ') : 'du Shom et d’OpenStreetMap'}, fichier du ${dateOf(file.generatedAt)} ; `
    + 'précision non garantie ; câbles électriques non retenus ; source et licence de chaque câble en infobulle de sa ligne.');
}

function cablesSection(input: ConnectiviteViewInput): FicheSection {
  const { file, fileError, canFocus, now, open } = input;
  const base = { id: 'cables', title: 'Câbles et atterrages', collapsible: true, open: open('cables', true) };
  if (file === null) {
    return fileError !== null
      ? { ...base, summary: 'n.d.', html: sourceDown('fichier des câbles (Shom, OpenStreetMap)') }
      : { ...base, summary: 'chargement…', html: emptyLine('Chargement du fichier des câbles…') };
  }
  if (file.cables.length === 0) return { ...base, summary: 'aucun', html: emptyLine('Aucun câble télécom sous-marin dans le fichier (Shom, OpenStreetMap).') + fileNote(file, now) };
  const places = landingGroups(file).map((g) => listRow({
    text: g.place, value: counted(g.cables.length, 'câble'), color: LANDING_COLOR, note: cableNames(g.cables),
    ...(canFocus ? { data: { landing: g.first }, link: true } : {}),
  })).join('');
  const cables = [...file.cables].sort((a, b) => cableName(a).localeCompare(cableName(b), 'fr') || a.id.localeCompare(b.id)).map((c) => listRow({
    text: cableName(c), color: c.outOfService ? null : CABLE_COLOR, level: c.outOfService ? 'gris' : null, title: cableSource(c),
    ...(c.landings.length > 0 ? { value: counted(c.landings.length, 'atterrage') } : {}),
    note: [
      isShom(c) && c.name === null && c.landings.length === 0 ? 'câble télécom (Shom), sans atterrage en France' : null,
      c.outOfService ? 'hors service (Shom)' : null, c.operator,
      [...new Set(c.landings.map(landingPlace))].join(', '),
    ].filter((x): x is string => x !== null && x !== '').join(' · '),
    ...(canFocus ? { data: { cable: c.id }, link: true } : {}),
  })).join('');
  return {
    ...base,
    summary: escapeHtml(`${counted(file.cables.length, 'câble')} · ${counted(landingCount(file), 'atterrage')}`),
    html: places
      + `<details class="lp-more"><summary>${escapeHtml(`Liste des ${counted(file.cables.length, 'câble')}`)}</summary>${cables}</details>`
      + fileNote(file, now)
      + (canFocus ? note('Clic sur un lieu ou un câble : son tracé sur la carte.') : ''),
  };
}

// ─── Navires près d'un câble ───

/** Câble d'une alerte : son nom, « câble télécom (Shom) » pour un câble du Shom sans nom, sinon « câble sans nom ». */
function alertCableLabel(a: CableAlert): string {
  return a.cableName ?? (a.cableId.startsWith('shom/') ? 'câble télécom (Shom)' : 'câble sans nom');
}

function vesselRow(a: CableAlert, evaluated: boolean, isLate: boolean, canFocus: boolean, now: number): string {
  const muted = a.zoneMuted === true;
  const seen = a.confirmed
    ? `confirmé sur deux relevés, vu de ${clockOf(a.firstSeen, now)} à ${clockOf(a.lastSeen, now)}`
    : `vu une fois à ${clockOf(a.firstSeen, now)}, à confirmer`;
  const parts = [alertCableLabel(a), formatKnots(a.speedKn, 1), a.navStatus === 1 ? 'au mouillage' : null, seen, muted ? MUTED_ZONE : null];
  return listRow({
    text: `${a.name ?? `MMSI ${a.mmsi}`} · ${a.vesselType ?? 'type n.d.'}`, value: formatMeters(a.distanceM),
    level: isLate || muted ? 'gris' : cableAlertLevel(a, evaluated), note: parts.filter((p): p is string => p !== null).join(' · '),
    ...(canFocus ? { data: { vessel: a.id }, link: true } : {}),
  });
}

function vesselsSection(input: ConnectiviteViewInput): FicheSection {
  const { watch: w, canFocus, now, open } = input;
  const alerts = w !== null && w.readAt !== null ? w.alerts : [];
  const base = { id: 'navires', title: 'Navires près d’un câble', collapsible: true, open: open('navires', alerts.length > 0) };
  if (w === null || w.readAt === null) return { ...base, summary: 'n.d.', html: sourceDown('veille AIS des câbles') };
  const frozen = aisFrozen(w);
  const isLate = !frozen && aisLate(w, now);
  const why = capitalize(cablesUnevaluatedWhy(w, now));
  const callout = frozen ? `<p class="fmk-callout lp-callout">${escapeHtml(`${why} : alertes gardées, non évaluées.`)}</p>` : '';
  // Jamais « aucun navire » quand le compte n'est pas évalué (slowVessels null) : le dénominateur est dit ou le défaut nommé.
  const empty = frozen ? emptyLine(`${why} : alertes non évaluées.`)
    : w.slowVessels === null ? emptyLine('Aucune alerte dans le relevé ; compte des navires lents non évalué.')
    : emptyLine(`Aucun navire lent à moins de 500${NBSP}m d’un câble parmi ${counted(w.slowVessels, 'navire')} de moins de 2${NBSP}nœuds du relevé AIS.`);
  const rows = alerts.length > 0 ? alerts.map((a) => vesselRow(a, w.evaluated, isLate, canFocus, now)).join('') : empty;
  const muted = alerts.filter((a) => a.zoneMuted === true).length;
  const evaluatedCount = alerts.length - muted;
  const mutedSummary = `${counted(muted, 'alerte')} ${MUTED_ZONE}`;
  const summary = frozen ? 'non évalué'
    : alerts.length === 0 ? (w.slowVessels === null ? 'non évalué' : 'aucun')
    : [evaluatedCount > 0 ? `${formatCount(evaluatedCount)} à vérifier${isLate ? ' (en retard)' : ''}` : null, muted > 0 ? mutedSummary : null]
      .filter((x): x is string => x !== null).join(' · ');
  return {
    ...base, summary: escapeHtml(summary),
    html: callout + rows + note(NEVER_A_THREAT)
      + (muted > 0 && !frozen ? note(`${mutedSummary} : gardée telle quelle, ni confirmée ni retirée, sans couleur ; elle ne colore pas la pastille.`) : '')
      + (canFocus && alerts.length > 0 ? note('Clic sur un navire : sa position sur la carte.') : ''),
  };
}

// ─── Méthode et sources ───

function methodSection(input: ConnectiviteViewInput): FicheSection {
  const { watch: w, watchError, file, fileError, now, open } = input;
  const fileState = file !== null ? `fichier du ${dateOf(file.generatedAt)}` : fileError !== null ? 'fichier illisible' : 'chargement…';
  const aisState = w === null || w.readAt === null ? (watchError !== null || w !== null ? 'veille indisponible' : 'chargement…')
    : w.evaluated ? `AIS à jour ${clockOf(w.aisLastMessageAt, now)}` : cablesUnevaluatedWhy(w, now);
  const html = kvRow('Tracés', `${sourceLinkHtml('Shom', SHOM_URL)} (CC BY-SA), ${sourceLinkHtml('OpenStreetMap', OSM_URL)} (ODbL), `
    + `${sourceLinkHtml('Shom réglementation', SHOM_REGLEMENTATION_URL)} (Licence ouverte 2.0) · ${escapeHtml(fileState)}`)
    + kvRow('Navires', escapeHtml(`aisstream.io via le relais · ${aisState}`))
    + note('Câbles : le Shom (répertoire des câbles sous-marins, édition de 2019) fait référence, sans nom publié ; les câbles plus récents absents du Shom '
      + 'viennent d’OpenStreetMap par un script (requête Overpass, chemins communication=line ou telecom=line), chacun avec sa source et sa licence. '
      + 'Câbles électriques et câbles sans nature non retenus. Les fichiers de TeleGeography sont réservés à ses abonnés : non utilisés.')
    + note('Couverture OpenStreetMap gardée autour des atterrages français : les tronçons au large de quatre câbles anciens '
      + '(ARIANE 2, ARTEMIS, TAGIDE, F-LYBIE) ne sont pas tracés. Un tronçon du Shom sans atterrage se lit « tronçon au large » ; '
      + 'un câble du Shom hors service est gardé en gris, jamais une alerte.')
    + note(`Atterrage : extrémité d’un tracé située dans un département français ou à moins de 2${NBSP}km de sa côte, nommée par la commune la plus proche.`)
    + note('Limites maritimes approchées (Menton, Hendaye) : une alerte près d’une frontière se lit comme approchée.')
    + note(`${NEVER_A_THREAT} Écartés : vitesse inconnue, navires amarrés, bâtiments militaires français ; un navire au mouillage reste compté. `
      + 'Un navire dans une zone de mouillage du Shom qui ne recoupe pas une zone de câbles n’est pas signalé.')
    + note('Veille non évaluée (flux AIS muet depuis plus de 5 minutes, relais injoignable ou fichier des câbles illisible) : alertes gardées, '
      + 'ni confirmées ni retirées ; la pastille passe à n.d. Zone muette d’un seul lot amont : ses alertes gardées sont « non évaluées (flux de la zone muet) », sans couleur. '
      + 'Dernier message AIS de plus de 15 minutes : en retard, couleurs retirées.')
    + readErrors(w !== null ? w.errors.map(glueSovUnits) : []);
  return { id: 'methode', title: 'Méthode et sources', collapsible: true, open: open('methode', false), tone: 'reference', html, summary: escapeHtml('4 sources') };
}

// ─── Assemblage ───

export function buildConnectiviteView(input: ConnectiviteViewInput): LayerView {
  const { watch: w, watchError, file, now } = input;
  if (w === null && watchError === null) {
    return { head: { theme: SOVEREIGNTY_THEME, title: CONNECTIVITE_TITLE, status: ['chargement…'] }, sections: [], bodyHtml: loadingBody() };
  }
  const sections = [cablesSection(input), vesselsSection(input), methodSection(input)];
  if (w === null) {
    return {
      head: {
        theme: SOVEREIGNTY_THEME, title: CONNECTIVITE_TITLE, level: 'nd', lead: leadOf(file),
        figure: { value: 'n.d.', caption: 'navires lents sur un câble : veille des câbles injoignable', level: null },
        status: ['veille des câbles injoignable'],
      },
      sections, bodyHtml: sourceErrorCallout(null, now),
    };
  }
  return { head: headOf(w, file, now), sections, bodyHtml: watchError !== null ? sourceErrorCallout(dataMs(w.readAt), now) : undefined };
}
