// src/components/outages-room/room-view.ts : vue pure de la control room des pannes (spec 2026-10-21 § 5.1) : barre des réseaux,
// encart « national et sans lieu », fil des changements, détail d'une panne. Aucun accès réseau ni DOM ; tout texte venu d'une
// source est échappé.
import type { OutageExposure, OutageJournalEntry, OutageNetwork, OutageNow, OutageNowSource, OutagesNowResponse, PublicServiceType } from '../../types/index.ts';
import { escapeHtml, safeHref } from '../france-intel-events.ts';
import { departementName } from '../layer-panel/health-format.ts';
import { NBSP, frNumber } from '../layer-panel/format.ts';
import { parisClock } from '../layer-panel/outages-format.ts';
import { NETWORK_LABEL, outageProof, RUNG_LABEL, SOURCE_LABEL } from '../../services/outages-now.ts';
import { outageSince, outageTitle } from '../OutagesNowBanner.ts';

const RANK = { jaune: 1, orange: 2, rouge: 3 } as const;
const LEVEL_WORD = { jaune: 'Vigilance', orange: 'Alerte', rouge: 'Crise' } as const;
const NETWORKS: readonly OutageNetwork[] = ['mobile', 'internet', 'electricite', 'cloud', 'gaz', 'eau', 'urgence', 'paiement', 'tv'];
/**
 * Sources qui mesurent chaque réseau : un réseau sans panne n'est vert que si l'une d'elles est fraîche. La presse n'y figure pas :
 * l'absence d'article ne mesure rien (spec § 3).
 */
export const NETWORK_SOURCES: Readonly<Record<OutageNetwork, readonly OutageNowSource[]>> = {
  // Le fichier ARCEP (un par jour) ne mesure pas l'instant : il fait le bulletin, jamais le vert du téléphone mobile (22/10/2026).
  mobile: [], internet: ['ioda', 'radar', 'atlas'], electricite: ['rte', 'edf'], cloud: ['statut'],
  // Aucune mesure ouverte (recherche du 21/10/2026) : la presse seule, jamais verte.
  gaz: [], eau: [], urgence: [], paiement: [], tv: [],
};
const VERB: Readonly<Record<OutageJournalEntry['kind'], string>> = {
  nouvelle: 'nouvelle panne', aggravee: 'aggravée', attenuee: 'atténuée', confirmee: 'confirmée', retablie: 'rétablie',
};

const dot = (cls: string): string => `<span class="orm-dot orm-dot--${cls}" aria-hidden="true"></span>`;
const keep = (filter: OutageNetwork | null) => (o: { network: OutageNetwork }): boolean => filter === null || o.network === filter;
const clock = (iso: string): string => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? parisClock(t) : 'n.d.';
};

/** Neuf cases : les réseaux mesurés, puis ceux que seule la presse signale. */
export function networkStrip(r: OutagesNowResponse | null, filter: OutageNetwork | null, now: number): string {
  void now;
  const cells = NETWORKS.map((n) => {
    const outs = (r?.outages ?? []).filter((o) => o.network === n);
    const worst = outs.reduce<OutageNow['level'] | null>((m, o) => (m === null || RANK[o.level] > RANK[m] ? o.level : m), null);
    const fresh = (r?.sources ?? []).filter((s) => NETWORK_SOURCES[n].includes(s.source) && s.ok);
    const cls = worst ?? (fresh.length > 0 ? 'vert' : 'nd');
    const state = r === null ? 'chargement…' : NETWORK_SOURCES[n].length === 0 ? (n === 'mobile' ? 'presse et usagers' : 'presse seule')
      : fresh.length > 0 ? fresh.map((s) => SOURCE_LABEL[s.source]).join(', ') : 'sources n.d.';
    return `<button type="button" class="orm-net" data-net="${n}" aria-pressed="${filter === n}">${dot(cls)}<span class="orm-net-name">${NETWORK_LABEL[n]}</span>`
      + `<b class="orm-net-n">${r === null ? 'n.d.' : outs.length}</b><small>${escapeHtml(state)}</small></button>`;
  });
  return cells.join('');
}

/** Libellés des services, au singulier et au pluriel. */
const SERVICE_WORD: Readonly<Record<PublicServiceType, readonly [string, string]>> = {
  prefecture: ['préfecture', 'préfectures'], sous_pref: ['sous-préfecture', 'sous-préfectures'], police: ['commissariat', 'commissariats'],
  gendarmerie: ['brigade de gendarmerie', 'brigades de gendarmerie'], sdis: ['SDIS', 'SDIS'], hopital: ['hôpital avec urgences', 'hôpitaux avec urgences'],
};
const SERVICE_ORDER: readonly PublicServiceType[] = ['prefecture', 'sous_pref', 'police', 'gendarmerie', 'sdis', 'hopital'];
const BASIS_TEXT: Readonly<Record<OutageExposure['basis'], string>> = {
  departement: 'Services du département touché.',
  communes: 'Services des communes où ses antennes sont coupées (fichier ARCEP), hôpitaux à moins de 3\u00a0km.',
  national: 'Panne nationale : tous les services publics peuvent être touchés.',
};

/** « 1 commissariat, 2 brigades de gendarmerie » dans l'ordre de l'État. */
function exposureCounts(e: OutageExposure): string {
  return SERVICE_ORDER.flatMap((t) => {
    const n = e.byType[t] ?? 0;
    return n > 0 ? [`${frNumber(n, 0)}${NBSP}${SERVICE_WORD[t][n > 1 ? 1 : 0]}`] : [];
  }).join(', ');
}

/** Section du détail : services exposés, jamais dits coupés (rien ne dit qu'ils dépendent de ce réseau). */
function exposureHtml(e: OutageExposure | undefined): string {
  if (!e) return '';
  if (e.total === 0) return `<h4>Services publics exposés</h4><p class="orm-empty">Aucun service public recensé dans la zone.</p>`;
  const list = e.sample.map((s) => `<li>${escapeHtml(s.name)}</li>`).join('');
  const more = e.total > e.sample.length && e.sample.length > 0 ? `<li>et ${frNumber(e.total - e.sample.length, 0)}${NBSP}autres</li>` : '';
  return `<h4>Services publics exposés</h4><p>${escapeHtml(exposureCounts(e))}</p><p class="orm-note">${BASIS_TEXT[e.basis]} Exposés, pas forcément coupés.</p>`
    + (list ? `<ul>${list}${more}</ul>` : '');
}

function outageRow(o: OutageNow, now: number): string {
  const exposed = o.exposed && o.exposed.total > 0 ? ` · ${frNumber(o.exposed.total, 0)}${NBSP}services publics exposés` : '';
  return `<button type="button" class="orm-item" data-outage="${escapeHtml(o.id)}">${dot(o.level)}<span><b>${escapeHtml(outageTitle(o))}</b>`
    + `<small>${escapeHtml(outageSince(o.since, now))} · ${escapeHtml(outageProof(o))}${exposed}</small></span></button>`;
}

/** Pannes sans département (opérateur, pays, ouvrage) : elles n'ont pas de lieu sur la carte. */
export function nationalBox(r: OutagesNowResponse | null, filter: OutageNetwork | null, now: number): string {
  const rows = (r?.outages ?? []).filter((o) => o.dept === null).filter(keep(filter)).map((o) => outageRow(o, now)).join('');
  // Clé des pictos de services exposés, dès qu'une panne affichée en place sur la carte.
  const placed = (r?.outages ?? []).filter(keep(filter)).some((o) => (o.exposed?.points?.length ?? 0) > 0);
  const key = placed ? '<p class="orm-note">Carte : P préfecture, S sous-préfecture, C commissariat, G gendarmerie, I SDIS, H hôpital (services exposés, pas forcément coupés).</p>' : '';
  return `<h3>National et sans lieu</h3>${rows || '<p class="orm-empty">aucune</p>'}${key}`;
}

/**
 * Bulletin ARCEP (22/10/2026) : pannes vues par le seul fichier du jour, à part des pannes en cours. Le fichier compte les antennes
 * coupées depuis moins de 24 h au moment du relevé : il est en retard sur un rétablissement.
 */
export function bulletinBox(r: OutagesNowResponse | null, filter: OutageNetwork | null, now: number): string {
  const rows = (r?.bulletin ?? []).filter(keep(filter)).map((o) => outageRow(o, now)).join('');
  if (rows === '') return '';
  const at = r?.sources.find((s) => s.source === 'arcep')?.readAt ?? null;
  const when = at === null ? '' : ` <small>publié à ${clock(at)}</small>`;
  return `<h3>Bulletin ARCEP du jour${when}</h3>${rows}`
    + '<p class="orm-note">Antennes coupées depuis moins de 24\u00a0h au relevé du fichier quotidien, pas forcément encore en panne.</p>';
}

function entryName(e: OutageJournalEntry): string {
  return e.dept !== null ? `${departementName(e.dept)} (${e.dept})` : e.name;
}

/** Fil des changements, plus récent d'abord. */
export function feedHtml(journal: readonly OutageJournalEntry[], filter: OutageNetwork | null, now: number): string {
  void now;
  const rows = journal.filter(keep(filter)).map((e) => `<button type="button" class="orm-item" data-outage="${escapeHtml(e.id)}">${dot(e.kind === 'retablie' ? 'vert' : e.level)}`
    + `<span><b>${clock(e.at)} · ${VERB[e.kind]} · ${escapeHtml(`${NETWORK_LABEL[e.network]} · ${entryName(e)}`)}</b>`
    + `<small>${e.kind === 'retablie' ? 'rétablie' : LEVEL_WORD[e.level]} · ${RUNG_LABEL[e.rung]}</small></span></button>`).join('');
  return `<h3>Fil en direct</h3>${rows || `<p class="orm-empty">Aucun changement enregistré sur 7${NBSP}jours.</p>`}`;
}

/** Détail d'une panne : niveau, échelon, depuis, preuves, chronologie. */
export function detailHtml(o: OutageNow, journal: readonly OutageJournalEntry[], now: number): string {
  const proofs = o.evidence.map((e) => {
    const t = escapeHtml(e.text);
    const href = e.link === null ? null : safeHref(e.link);
    return `<li><b>${escapeHtml(SOURCE_LABEL[e.source])}</b>${NBSP}: ${href ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${t}</a>` : t}</li>`;
  }).join('');
  const story = journal.filter((e) => e.id === o.id).map((e) => `<li>${clock(e.at)} · ${VERB[e.kind]} (${LEVEL_WORD[e.level]})</li>`).join('');
  return `<div class="orm-detail"><button type="button" class="orm-back" data-back>← fil</button>`
    + `<h3>${escapeHtml(outageTitle(o))}</h3><p>${dot(o.level)} ${LEVEL_WORD[o.level]} · ${RUNG_LABEL[o.rung]} · ${escapeHtml(outageSince(o.since, now))}</p>`
    + `<h4>Preuves</h4><ul>${proofs || '<li>aucune</li>'}</ul>${exposureHtml(o.exposed)}<h4>Chronologie</h4><ul>${story || '<li>aucun changement depuis le premier relevé</li>'}</ul></div>`;
}
