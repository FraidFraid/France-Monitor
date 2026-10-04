// src/components/layer-panel/feux-dossier.ts : onglet « Dossier d'un feu » du panneau Feux de forêt (spec 2026-10-04 environnement
// § 2.4 ; contrats § 4.1). Reprend le dossier OSINT d'un grand feu (ancienne fenêtre « Dossier grand feu », retirée) dans le cadre des
// panneaux de couches, règles inchangées (docs/design-alertes-grands-feux-2026-07.md § 6.2, § 12) : aucun chiffre sans provenance ni
// sans ses deux notes, aucune valeur agrégée (séries), observé et déclaré côte à côte jamais fusionnés, échappement de tout texte
// tiers, lien de source en http(s) seulement. Ajoute les communes à moins de 10 km du centre (geo.api.gouv.fr, /api/fires/impacts)
// et le rapport Géorisques de la plus proche ; aucune estimation de maisons menacées ni d'évacués : l'impact humain ne se déduit
// pas de la puissance radiative. Pur : aucun réseau ni DOM.
import type {
  FireImpactsResponse, ImpactFact, ImpactFactKind, LocatedFireIncident, SituationSeverity, WildfireDossier,
} from '../../types/index.ts';
import { situationLevel } from '../../services/vigilance.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { absoluteTime, kvRow } from '../fiche/kit.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { departementName } from './health-format.ts';
import { NBSP, frNumber } from './format.ts';
import { emptyLine, listRow, sourceLinkHtml, valueHtml } from './frame.ts';
import { formatAge, formatFrp, formatKm, note, plural, sourceDown } from './environment-format.ts';

/** Ouverture d'une section (état mémorisé, sinon `byDefault`), partagée par la vue Feux de forêt. */
export type OpenFn = (sectionId: string, byDefault: boolean) => boolean;

/** Incident DBSCAN ouvert dans l'onglet, son dossier assemblé (buildDossier) et les communes autour de son centre. */
export interface FeuxDossierInput {
  incident: LocatedFireIncident;
  dossier: WildfireDossier;
  impacts: FireImpactsResponse | null;
  impactsError: string | null;
}

const KIND_LABEL: Readonly<Record<ImpactFactKind, string>> = {
  area_ha: 'Surface brûlée',
  evacuated: 'Personnes évacuées',
  dwellings_destroyed: 'Habitations détruites',
  injured: 'Blessés',
  evacuation_order: 'Ordre d’évacuation',
  road_closed: 'Route coupée',
  rail_disrupted: 'Trafic ferroviaire interrompu',
};

const LEVEL_LABEL: Readonly<Record<ImpactFact['sourceLevel'], string>> = {
  primary: 'source primaire', secondary: 'source secondaire', tertiary: 'source tertiaire',
};

/** Sévérité du dossier en mots (couleur : situationLevel, échelle L1). */
export const SEVERITY_WORD: Readonly<Record<SituationSeverity, string>> = {
  critical: 'critique', high: 'élevée', medium: 'moyenne', watch: 'veille',
};

const CONFIDENCE_WORD: Readonly<Record<'high' | 'nominal' | 'low', string>> = { high: 'haute', nominal: 'nominale', low: 'faible' };

const GEORISQUES_LABEL = 'rapport Géorisques de la commune (PDF)';
/** Rayon de /api/fires/impacts : centre de commune à moins de 10 km du centre de l'incident. */
const IMPACT_RADIUS_KM = 10;
const NO_ESTIMATE = 'Aucune estimation de maisons menacées ni d’évacués : l’impact humain ne se déduit pas de la puissance radiative.';

/** Lien de source cliquable en http(s) seulement : `javascript:`, `data:` ou une adresse relative restent du texte. */
function isSafeSourceUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isKnownFactKind(kind: string): kind is ImpactFactKind {
  return Object.hasOwn(KIND_LABEL, kind);
}

/** Heure de Paris d'un fait avec sa date (« 26/07 10:00 »). */
function factTime(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return 'date illisible';
  return new Date(ms).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/**
 * Une ligne de fait déclaré (reprise de l'ancienne fenêtre du dossier) : valeur et unité insécables (R1), source et son niveau,
 * note combinée « fiabilité de la source + crédibilité de l'information » (D4), provisoire, approximatif, phrase source verbatim.
 */
export function renderFactRow(fact: ImpactFact): string {
  const value = fact.value === null
    ? ''
    : `<strong class="lp-val fmk-num">${escapeHtml(`${frNumber(fact.value, 0)}${fact.unit ? `${NBSP}${fact.unit}` : ''}`)}</strong>`;
  const grade = `${escapeHtml(fact.reliability)}${fact.credibility ?? ''}`;
  const flags = [
    fact.provisional ? '<span class="wf-flag">provisoire</span>' : '',
    fact.hedged ? '<span class="wf-flag">approximatif</span>' : '',
  ].join('');
  const sourceRef = isSafeSourceUrl(fact.sourceUrl)
    ? `<a class="lp-link" href="${escapeHtml(fact.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(fact.sourceName)}</a>`
    : `<span class="wf-fact__source-name">${escapeHtml(fact.sourceName)}</span>`;
  return `<li class="wf-fact" data-kind="${escapeHtml(fact.kind)}">`
    + `<div class="wf-fact__head"><span class="wf-fact__label">${escapeHtml(KIND_LABEL[fact.kind])}</span>${value}`
    + `<span class="wf-fact__grade" title="fiabilité de la source / crédibilité de l’information">${grade}</span>${flags}</div>`
    + `<div class="wf-fact__meta">${sourceRef} · <span class="wf-fact__level">${escapeHtml(LEVEL_LABEL[fact.sourceLevel])}</span> · `
    + `<time datetime="${escapeHtml(fact.observedAt)}">${escapeHtml(factTime(fact.observedAt))}</time></div>`
    + `<details class="wf-fact__quote"><summary>phrase source</summary><blockquote>${escapeHtml(fact.quote)}</blockquote></details></li>`;
}

/** Un fait isolément, ou null s'il est malformé (kind inconnu, champ requis absent) : jamais un voisin emporté. */
function renderKnownFact(fact: ImpactFact): string | null {
  try {
    if (!isKnownFactKind(fact.kind)) {
      console.warn(`[feux-dossier] fait ignoré (kind inconnu) : id=${fact?.id ?? '?'}`);
      return null;
    }
    return renderFactRow(fact);
  } catch (error) {
    console.warn(`[feux-dossier] fait ignoré (rendu invalide) : id=${fact?.id ?? '?'}`, error);
    return null;
  }
}

/**
 * Bloc « déclaré » (repris de l'ancienne fenêtre du dossier), trois états jamais confondus : aucun fait (« Impacts non
 * renseignés. », silence de la source) ; tous les faits rejetés (donnée reçue mais corrompue) ; certains rejetés (liste et mention).
 */
export function renderDeclaredBlock(facts: ImpactFact[]): string {
  const rendered = facts.map(renderKnownFact).filter((html): html is string => html !== null);
  const discarded = facts.length - rendered.length;
  if (rendered.length === 0) {
    if (facts.length === 0) return emptyLine('Impacts non renseignés.');
    const text = discarded === 1 ? '1 fait reçu mais invalide : donnée corrompue.' : `${discarded} faits reçus mais invalides : donnée corrompue.`;
    return `<p class="fmk-callout lp-callout wf-declared-error">${escapeHtml(text)}</p>`;
  }
  const notice = discarded === 0 ? '' : note(discarded === 1 ? '1 fait ignoré : donnée invalide.' : `${discarded} faits ignorés : donnée invalide.`);
  return `<ul class="wf-facts">${rendered.join('')}</ul>${notice}`;
}

/** « 1 h 40 », « 25 min » : minutes totales arrondies avant d'être découpées (jamais « 1 h 60 »). */
function duration(minutes: number): string {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}${NBSP}h${NBSP}${String(m).padStart(2, '0')}` : `${m}${NBSP}min`;
}

/**
 * Bornes d'un axe, chacune avec le sens tiré de son propre signe : « 44,85 à 44,90 N » quand elles sont du même côté, sinon
 * « 0,10 O à 0,20 E » (emprise à cheval sur le méridien de Greenwich).
 */
function bounds(min: number, max: number, positive: string, negative: string): string {
  const side = (v: number): string => (v >= 0 ? positive : negative);
  const abs = (v: number): string => frNumber(Math.abs(v), 2);
  return side(min) === side(max)
    ? `${abs(min)} à ${abs(max)}${NBSP}${side(min)}`
    : `${abs(min)}${NBSP}${side(min)} à ${abs(max)}${NBSP}${side(max)}`;
}

/** « 44,85 à 44,90 N · 1,15 à 1,05 O » (emprise de l'incident, jamais de tiret). */
function extent(i: LocatedFireIncident): string {
  return `${bounds(i.bboxMinLat, i.bboxMaxLat, 'N', 'S')} · ${bounds(i.bboxMinLon, i.bboxMaxLon, 'E', 'O')}`;
}

/** Lieu d'un incident : départements nommés, puis communes résolues ; à défaut, ses coordonnées. */
export function incidentPlace(i: LocatedFireIncident): string {
  const depts = i.deptCodes.map((c) => `${departementName(c)} (${c})`).join(', ');
  const communes = i.communes.slice(0, 3).join(', ');
  if (depts && communes) return `${depts} · ${communes}`;
  return depts || communes || `${frNumber(i.centroidLat, 3)}${NBSP}N ${frNumber(Math.abs(i.centroidLon), 3)}${NBSP}${i.centroidLon >= 0 ? 'E' : 'O'}`;
}

function observedSection(input: FeuxDossierInput, now: number, open: OpenFn): FicheSection {
  const i = input.incident;
  const level = situationLevel(input.dossier.severity);
  const last = Date.parse(i.endDatetime);
  const rows = [
    kvRow('Sévérité', valueHtml(SEVERITY_WORD[input.dossier.severity], level)),
    kvRow('Détections', valueHtml(frNumber(i.detectionsCount, 0))),
    kvRow('Puissance cumulée', valueHtml(formatFrp(i.frpTotal))),
    kvRow('Puissance maximale', valueHtml(formatFrp(i.frpMax))),
    kvRow('Persistance', valueHtml(duration(i.durationMinutes))),
    kvRow('Dernière détection', escapeHtml(Number.isFinite(last) ? `${absoluteTime(last, now, 'fr', { withDate: true })} (${formatAge(last, now)})` : 'n.d.')),
    kvRow('Confiance maximale', escapeHtml(CONFIDENCE_WORD[i.confidenceMax])),
    kvRow('Détection de nuit', escapeHtml(i.hasNightDetection ? 'oui' : 'non')),
    kvRow('Satellites', escapeHtml(i.satellites.join(', '))),
    kvRow('Emprise', escapeHtml(extent(i))),
  ].join('');
  return {
    id: 'dossier-observe', title: 'Observé : NASA FIRMS', collapsible: true, open: open('dossier-observe', true),
    summary: escapeHtml(`${plural(i.detectionsCount, 'détection')} · ${formatFrp(i.frpTotal)}`),
    html: rows + note('Mesure satellitaire de la chaleur : elle ne dit ni la surface brûlée ni le dommage humain, déclarés à part.'),
  };
}

function declaredSection(input: FeuxDossierInput, open: OpenFn): FicheSection {
  const facts = input.dossier.facts;
  return {
    id: 'dossier-declare', title: 'Déclaré : impact humain et matériel', collapsible: true, open: open('dossier-declare', true),
    summary: facts.length === 0 ? 'non renseigné' : escapeHtml(plural(facts.length, 'fait')),
    html: renderDeclaredBlock(facts)
      + note('Chaque fait garde sa source, son niveau et sa note (fiabilité de la source, crédibilité de l’information) ; aucune valeur n’est moyennée ni choisie.'),
  };
}

function timelineSection(input: FeuxDossierInput, open: OpenFn): FicheSection | null {
  const series = input.dossier.series.area_ha;
  if (series.length === 0) return null;
  const rows = series.map((f) => listRow({
    text: factTime(f.observedAt),
    value: f.value === null ? 'n.d.' : `${frNumber(f.value, 0)}${f.unit ? `${NBSP}${f.unit}` : ''}`,
    note: `${f.sourceName} · ${f.reliability}${f.credibility ?? ''}`,
  })).join('');
  return {
    id: 'dossier-chronologie', title: 'Chronologie des révisions : surface brûlée', collapsible: true, open: open('dossier-chronologie', false),
    summary: escapeHtml(plural(series.length, 'valeur')),
    html: rows + note('Toutes les valeurs publiées, dans l’ordre, divergences comprises : jamais une moyenne ni un dernier chiffre retenu.'),
  };
}

function communesSection(input: FeuxDossierInput, now: number, open: OpenFn): FicheSection {
  const base = { id: 'dossier-communes', title: `Communes à moins de 10${NBSP}km`, collapsible: true, open: open('dossier-communes', true) };
  const { impacts, impactsError } = input;
  if (impacts === null) {
    return impactsError !== null
      ? { ...base, summary: 'n.d.', html: sourceDown('communes de geo.api.gouv.fr') + note(NO_ESTIMATE) }
      : { ...base, summary: 'chargement…', html: emptyLine('Chargement des communes…') };
  }
  const rows = impacts.communes.map((c) => listRow({
    text: `${c.name} (${departementName(c.dept)})`,
    value: formatKm(c.distanceKm),
    note: c.population === null ? 'population non publiée' : `${frNumber(c.population, 0)}${NBSP}habitants`,
  })).join('');
  const nearest = impacts.nearest;
  // La commune la plus proche peut être au-delà de 10 km (point isolé ou en lisière de côte) : dit, jamais présentée comme voisine.
  const beyond = nearest !== null && nearest.distanceKm > IMPACT_RADIUS_KM;
  const none = nearest !== null && beyond
    ? `Aucune commune dont le centre est à moins de 10${NBSP}km ; la plus proche, ${nearest.name} (${departementName(nearest.dept)}), est à ${formatKm(nearest.distanceKm)}.`
    : `Aucune commune dont le centre est à moins de 10${NBSP}km.`;
  // Liste vide alors qu'un département voisin n'a pas été lu : panne nommée (S3), jamais « aucune commune ».
  const list = impacts.communes.length > 0 ? rows : impacts.errors.length > 0 ? sourceDown('communes de geo.api.gouv.fr') : emptyLine(none);
  const link = nearest !== null && impacts.georisquesUrl !== null
    ? `<p class="fmk-note">${escapeHtml(`Zonage des risques de ${nearest.name}, commune la plus proche${beyond ? `, au-delà de 10${NBSP}km` : ''} (${formatKm(nearest.distanceKm)}) : `)}${sourceLinkHtml(GEORISQUES_LABEL, impacts.georisquesUrl)}.</p>`
    : note('Rapport Géorisques indisponible : aucune commune lue près du foyer.');
  const read = Date.parse(impacts.readAt);
  return {
    ...base, summary: impacts.communes.length === 0 && impacts.errors.length > 0 ? 'n.d.' : escapeHtml(plural(impacts.communes.length, 'commune')),
    html: list + link + note(NO_ESTIMATE)
      + note(`Centre de commune à moins de 10${NBSP}km du centre de l’incident (geo.api.gouv.fr${Number.isFinite(read) ? `, lu à ${absoluteTime(read, now, 'fr')}` : ''}).`)
      + (impacts.errors.length > 0 ? note(`Incidents de lecture : ${impacts.errors.join(' ; ')}.`) : ''),
  };
}

/** Sections du dossier d'un feu : observé, déclaré, communes, chronologie de la surface (si publiée). */
export function dossierSections(input: FeuxDossierInput, now: number, open: OpenFn): FicheSection[] {
  const timeline = timelineSection(input, open);
  return [observedSection(input, now, open), declaredSection(input, open), communesSection(input, now, open), ...(timeline ? [timeline] : [])];
}
