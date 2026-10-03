// src/components/layer-panel/maritime.ts : vue pure de l'onglet Veille du panneau Trafic maritime (spec 2026-10-03 trafics § 3.4)
// et éléments communs aux trois onglets (en-tête, « Méthode et sources ») ; aucun accès réseau ni DOM. Instantané du relais AIS :
// signalements croisés (T3), zones, ports et files au mouillage, navires sensibles ; périmètre : eaux côtières couvertes (T1).
import type { MaritimePortStats, MaritimeSnapshot } from '../../types/index.ts';
import { RISK_FLAGS_VINTAGE } from '../../config/risk-flags.ts';
import { isTrafficDataLate, maritimeLevel } from '../../services/traffic-levels.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { kvRow } from '../fiche/kit.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { NBSP, frNumber } from './format.ts';
import { barRow, listRow, sourceLinkHtml, valueHtml, type LayerHeadModel } from './frame.ts';
import {
  CAT_PORT, TRAFFIC_THEME, clockOf, coordText, emptyOrDown, formatNm, glueUnits, note, plural, readErrors, sourceDown, stamp,
} from './traffic-format.ts';

export type MaritimeTab = 'veille' | 'marine' | 'alertes';
export const MARITIME_TABS: readonly MaritimeTab[] = ['veille', 'marine', 'alertes'];
export const MARITIME_TITLE = 'Trafic maritime';

export interface MaritimeVeilleInput {
  snapshot: MaritimeSnapshot | null;
  error: string | null;
  now: number;
  open: (sectionId: string, byDefault: boolean) => boolean;
}

const AIS_URL = 'https://aisstream.io';
const SNAPSHOT_DOWN = 'instantané AIS du relais';
const MAX_SENSITIVE = 5;
const PARTIAL_OUTAGE = /^flux AIS partiel/i;
const PORT_FLOOR_NOTE = 'Les comptes des ports sont des planchers liés à la couverture des récepteurs AIS bénévoles : un port est une zone à plusieurs terminaux '
  + '(Dunkerque Est et Ouest ; Bordeaux, de Bassens au Verdon ; Marseille, Lavéra et Fos ; Saint-Nazaire avec Donges-Montoir ; Le Havre avec Port-Jérôme).';
const PERIMETER_NOTE = 'Les navires d’outre-mer apparaissent sur la carte (flux direct) mais pas dans ces comptes, limités aux eaux métropolitaines.';

/** Pannes partielles du flux amont nommées par le relais (« flux AIS partiel : lot 2 sur 3 coupé (…) »). */
export function partialOutages(errors: readonly string[]): string[] {
  return errors.filter((e) => PARTIAL_OUTAGE.test(e));
}
const T3_NOTE = `Signalement retenu seulement hors zone portuaire, à moins de 0,5${NBSP}nœud, constant sur 30${NBSP}min et sur au moins deux positions `
  + '(statuts « non maître de sa manœuvre » et « échoué ») ; « manœuvrabilité restreinte », « contraint par son tirant d’eau » et « en pêche » '
  + 'sont de l’information.';

/** S2 : AIS en retard quand le dernier message reçu par le relais a plus de 5 min. */
export function aisLate(s: MaritimeSnapshot, now: number): boolean {
  return isTrafficDataLate('ais', s.lastMessageAt, now);
}

function lead(s: MaritimeSnapshot): string {
  const parts = [s.signals.length === 0 ? 'Aucun navire en difficulté confirmé.'
    : `${plural(s.signals.length, 'navire')} en difficulté confirmée : ${s.signals.slice(0, 3).map((x) => `${x.name ?? `MMSI ${x.mmsi}`} (${x.statusLabel})`).join(', ')}.`];
  const queue = [...s.ports].filter((p) => p.atAnchor > 0).sort((a, b) => b.atAnchor - a.atAnchor)[0];
  if (queue) parts.push(`${queue.port} : ${plural(queue.atAnchor, 'navire')} au mouillage.`);
  if (partialOutages(s.errors).length > 0) parts.push('Flux AIS partiel : des zones ne sont pas couvertes.');
  return parts.join(' ');
}

/** En-tête commun aux trois onglets ; « AIS indisponible depuis hh:mm » en retard ou en panne, jamais « aucun navire ». */
export function maritimeHead(s: MaritimeSnapshot | null, error: string | null, now: number): LayerHeadModel {
  const caption = 'navires suivis dans les eaux françaises';
  if (s === null) {
    return {
      theme: TRAFFIC_THEME, title: MARITIME_TITLE, level: error !== null ? 'nd' : undefined,
      figure: error !== null ? { value: 'n.d.', caption, level: null } : null,
      status: [error !== null ? 'AIS indisponible' : 'chargement…'],
    };
  }
  const late = aisLate(s, now);
  const never = s.lastMessageAt === null;
  const partial = partialOutages(s.errors).length > 0;
  const verdict = maritimeLevel(s);
  return {
    theme: TRAFFIC_THEME, title: MARITIME_TITLE,
    figure: {
      value: frNumber(s.vessels, 0),
      caption: `${caption} · dont ${frNumber(s.frenchFlag, 0)} sous pavillon français · ${never ? 'AIS : aucun message reçu' : `AIS, ${clockOf(s.lastMessageAt, now)}${late ? ' (en retard)' : ''}`}`,
      level: null,
    },
    level: late ? 'nd' : verdict.level,
    status: [late ? (never ? 'AIS indisponible (aucun message reçu)' : `AIS indisponible depuis ${clockOf(s.lastMessageAt, now)}`)
        : glueUnits(partial ? `${verdict.reason} (flux partiel)` : verdict.reason), ...(never ? [] : [stamp('AIS', s.lastMessageAt, late, now)])],
    lead: late ? null : lead(s),
  };
}

// ─── Signalements (T3) ───

function signalsSection(input: MaritimeVeilleInput): FicheSection {
  const { snapshot: s, now, open } = input;
  const base = { id: 'signals', title: 'Signalements', collapsible: true, open: open('signals', true) };
  if (!s) return { ...base, summary: 'n.d.', html: sourceDown(SNAPSHOT_DOWN) };
  const late = aisLate(s, now);
  const confirmed = s.signals.filter((x) => x.confirmed);
  const rows = confirmed.length > 0 ? confirmed.map((x) => listRow({
    text: `${x.name ?? `MMSI ${x.mmsi}`} · ${x.statusLabel}`, value: clockOf(x.since, now), level: late ? 'gris' : x.sensitive ? 'rouge' : 'orange',
    note: [x.type ?? 'type inconnu', coordText(x.lat, x.lon), `constant depuis ${clockOf(x.since, now)}`, x.sensitive ? 'pétrolier ou navire à passagers' : null]
      .filter((v): v is string => v !== null).join(' · '),
  })).join('')
    : late ? listRow({ text: 'Signalements suspendus', value: clockOf(s.lastMessageAt, now), level: 'gris',
      note: 'AIS en retard : pas de croisement sur des positions figées' })
    : listRow({ text: 'Aucun navire en difficulté confirmé', value: clockOf(s.at, now), level: 'vert',
      note: `non maître de sa manœuvre : 0 · échoué hors port, à l’arrêt depuis 30${NBSP}min : 0${partialOutages(s.errors).length > 0 ? ' · sur les zones couvertes seulement (flux AIS partiel)' : ''}` });
  const info = listRow({ text: 'Manœuvrabilité restreinte', value: frNumber(s.info.restricted, 0), level: 'gris',
    note: 'dragues, remorqueurs, câbliers, pilotes : information, pas une alerte' })
    + listRow({ text: 'Contraint par son tirant d’eau', value: frNumber(s.info.draught, 0), level: 'gris', note: 'information' })
    + listRow({ text: 'En pêche', value: frNumber(s.info.fishing, 0), level: 'gris', note: 'information' });
  const head = confirmed.length === 0 ? 'aucun confirmé' : `${confirmed.length} confirmé${confirmed.length > 1 ? 's' : ''}`;
  return {
    ...base, summary: escapeHtml(`${head} · ${frNumber(s.info.restricted, 0)} manœuvre restreinte${late ? ' (en retard)' : ''}`),
    html: rows + info + note(T3_NOTE),
  };
}

// ─── Par zone ───

function zonesSection(input: MaritimeVeilleInput): FicheSection {
  const { snapshot: s, open } = input;
  const base = { id: 'zones', title: 'Par zone', collapsible: true, open: open('zones', true) };
  if (!s) return { ...base, summary: 'n.d.', html: sourceDown(SNAPSHOT_DOWN) };
  const zones = [...s.zones].sort((a, b) => b.vessels - a.vessels);
  const outages = partialOutages(s.errors);
  const outage = outages.length > 0
    ? `<p class="fmk-callout lp-callout">${escapeHtml(`${outages.join(' ; ')}. Les zones concernées ne se lisent pas comme calmes : leurs comptes sont des minimums.`)}</p>` : '';
  const top = zones[0];
  if (!top) return { ...base, summary: 'n.d.', html: outage + emptyOrDown(s.errors, 'Aucun navire dans les eaux couvertes.', 'zones (instantané AIS)') };
  const rows = zones.map((z) => `<tr><th scope="row">${escapeHtml(z.label)}</th><td>${valueHtml(frNumber(z.vessels, 0))}</td>`
    + `<td>${valueHtml(frNumber(z.atAnchor, 0))}</td><td>${valueHtml(frNumber(z.underWay, 0))}</td></tr>`).join('');
  return {
    ...base, summary: escapeHtml(`${top.label} ${frNumber(top.vessels, 0)}${outages.length > 0 ? ' · flux partiel' : ''}`),
    html: outage + '<table class="lp-tbl"><thead><tr><th scope="col">Zone</th><th scope="col">Navires</th><th scope="col">Mouillage</th>'
      + `<th scope="col">En route</th></tr></thead><tbody>${rows}</tbody></table>`
      + note('Statuts (mouillage, amarré, en route) : classe A seulement ; la classe B (plaisance, petits navires) ne transmet pas de statut.')
      + note(PERIMETER_NOTE),
  };
}

// ─── Ports ───

function portsSection(input: MaritimeVeilleInput): FicheSection {
  const { snapshot: s, now, open } = input;
  const base = { id: 'ports', title: 'Ports', collapsible: true, open: open('ports', true) };
  if (!s) return { ...base, summary: 'n.d.', html: sourceDown(SNAPSHOT_DOWN) };
  const outages = partialOutages(s.errors);
  const partialNote = outages.length > 0 ? note(`${outages.join(' ; ')} : les comptes des ports concernés sont des minimums.`) : '';
  const received = (p: MaritimePortStats): boolean => p.lastSeenAt !== null;
  const ports = [...s.ports].sort((a, b) => Number(received(b)) - Number(received(a)) || b.vessels - a.vessels || a.port.localeCompare(b.port, 'fr'));
  const top = ports.find(received);
  if (ports.length === 0) return { ...base, summary: 'n.d.', html: partialNote + emptyOrDown(s.errors, 'Aucun port renseigné.', 'ports (instantané AIS)') };
  const rows = ports.map((p) => {
    // Aucune réception en 24 h : couverture absente, jamais un 0 factuel ni une jauge.
    if (p.lastSeenAt === null) return listRow({ text: p.port, value: 'n.d.', level: 'gris', note: 'aucune réception AIS depuis 24 h' });
    const quiet = p.vessels === 0 ? ` · dernière réception ${clockOf(p.lastSeenAt, now)}` : '';
    return barRow({
      label: p.port, pct: top && top.vessels > 0 ? (p.vessels / top.vessels) * 100 : 0, value: frNumber(p.vessels, 0), color: CAT_PORT, dot: false,
      note: `au mouillage ${frNumber(p.atAnchor, 0)} · amarrés ${frNumber(p.moored, 0)} · en route ${frNumber(p.underWay, 0)}${quiet}`,
    });
  }).join('');
  const summary = top ? `${top.port} ${frNumber(top.vessels, 0)}${top.atAnchor > 0 ? ` · ${frNumber(top.atAnchor, 0)} au mouillage` : ''}` : 'aucune réception AIS depuis 24 h';
  return {
    ...base, summary: escapeHtml(summary),
    html: partialNote + rows + note(`Présents : à moins de 25${NBSP}km du port ; au mouillage : à moins de 40${NBSP}km. Dunkerque, Calais et la Gironde sont couverts par le relais depuis cette version.`)
      + note(PORT_FLOOR_NOTE),
  };
}

// ─── Navires sensibles ───

function sensitiveSection(input: MaritimeVeilleInput): FicheSection {
  const { snapshot: s, open } = input;
  const base = { id: 'sensitive', title: 'Navires sensibles', collapsible: true, open: open('sensitive', true) };
  if (!s) return { ...base, summary: 'n.d.', html: sourceDown(SNAPSHOT_DOWN) };
  const list = [...s.sensitive.list].sort((a, b) => a.distanceNm - b.distanceNm);
  const rows = list.slice(0, MAX_SENSITIVE).map((v) => listRow({
    text: v.name ?? `MMSI ${v.mmsi}`, value: formatNm(v.distanceNm),
    note: `${v.type === 'petrolier' ? 'pétrolier' : 'navire à passagers'} · ${coordText(v.lat, v.lon)}`,
  })).join('');
  const html = kvRow(`Pétroliers à moins de 12${NBSP}milles des côtes`, valueHtml(frNumber(s.sensitive.tankers, 0)))
    + kvRow(`Navires à passagers à moins de 12${NBSP}milles`, valueHtml(frNumber(s.sensitive.passenger, 0)))
    + (rows ? `<h4 class="fmk-eyebrow">Les plus proches des côtes</h4>${rows}` : '')
    + note(`Type connu par le serveur (mémoire des messages statiques, plusieurs jours) : ${frNumber(s.typedShare, 0)}${NBSP}% des navires suivis ont un type connu ; les comptes sous-estiment.`);
  return { ...base, summary: escapeHtml(`${plural(s.sensitive.tankers, 'pétrolier')} · ${plural(s.sensitive.passenger, 'passager')}`), html };
}

export function veilleSections(input: MaritimeVeilleInput): FicheSection[] {
  return [signalsSection(input), zonesSection(input), portsSection(input), sensitiveSection(input)];
}

// ─── Méthode et sources (trois onglets) ───

export function maritimeMethodSection(input: MaritimeVeilleInput): FicheSection {
  const { snapshot: s, error, now, open } = input;
  const late = s ? aisLate(s, now) : false;
  const outages = partialOutages(s?.errors ?? []);
  const state = (text: string): string => (s ? text : error !== null ? 'source indisponible' : 'chargement…');
  const html = kvRow('Positions', `${sourceLinkHtml('AIS (aisstream, relais du projet)', AIS_URL)} · ${escapeHtml(state(`dernier message de ${clockOf(s?.lastMessageAt, now)}${late ? ' (en retard)' : ''}`))}`)
    + kvRow('Synthèse', escapeHtml(state(`instantané de ${clockOf(s?.at, now)}, relu toutes les 2 minutes`)))
    + note('Périmètre : eaux côtières couvertes par les récepteurs AIS (métropole, Corse ; Royaume-Uni, Espagne et Seine en amont de Rouen exclus) ; '
      + 'les navires sans AIS ou hors de portée sont invisibles. Pavillon français : MMSI 226 à 228.')
    + note(PERIMETER_NOTE)
    + note(PORT_FLOOR_NOTE)
    + note('Pastille : rouge si un pétrolier ou un navire à passagers est en difficulté confirmée ; orange si un autre navire l’est ; vert sinon ; n.d. si l’AIS est indisponible.')
    + note(T3_NOTE)
    + note(`Zones : Pas-de-Calais (rail de navigation), Manche, Atlantique, Méditerranée. Ports : présents à 25${NBSP}km, au mouillage à 40${NBSP}km.`)
    + note(`Retard : AIS au-delà de 5${NBSP}min sans message ; la pastille passe à n.d. et les couleurs disparaissent.`)
    + note(`Listes de pavillons à risque (onglet Alertes) : listes noire et grise du ${RISK_FLAGS_VINTAGE.parisMou} ; registres sous sanctions (${RISK_FLAGS_VINTAGE.sanctions}).`)
    + note('Carte : navires par type quand il est connu, signalements mis en avant, files au mouillage devant les ports.')
    + (outages.length > 0 ? note(`Flux AIS partiel : ${outages.map((o) => o.replace(/^flux AIS partiel\s*:\s*/i, '')).join(' ; ')}. Les zones et les ports concernés ne se lisent pas comme calmes : leurs comptes sont des minimums.`) : '')
    + readErrors((s?.errors ?? []).filter((e) => !PARTIAL_OUTAGE.test(e)));
  return {
    id: 'method', title: 'Méthode et sources', collapsible: true, open: open('method', false), tone: 'reference', html,
    summary: escapeHtml(s === null && error !== null ? 'AIS (aisstream, relais) · indisponible' : 'AIS (aisstream, relais)'),
  };
}
