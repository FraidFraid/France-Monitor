// src/components/outages-room/room-view.ts : vue pure de la control room des pannes (spec 2026-10-21 § 5.1) : barre des réseaux,
// encart « national et sans lieu », fil des changements, détail d'une panne. Aucun accès réseau ni DOM ; tout texte venu d'une
// source est échappé.
import type { OutageJournalEntry, OutageNetwork, OutageNow, OutageNowSource, OutagesNowResponse } from '../../types/index.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { departementName } from '../layer-panel/health-format.ts';
import { NBSP } from '../layer-panel/format.ts';
import { parisClock } from '../layer-panel/outages-format.ts';
import { NETWORK_LABEL, outageProof, RUNG_LABEL, SOURCE_LABEL } from '../../services/outages-now.ts';
import { outageSince, outageTitle } from '../OutagesNowBanner.ts';

const RANK = { jaune: 1, orange: 2, rouge: 3 } as const;
const LEVEL_WORD = { jaune: 'Vigilance', orange: 'Alerte', rouge: 'Crise' } as const;
const NETWORKS: readonly OutageNetwork[] = ['mobile', 'internet', 'electricite', 'cloud'];
/** Réseaux sans source temps réel (recherche du 21/10/2026) : la case dit le manque. */
const NO_SOURCE: readonly string[] = ['Gaz', 'Eau', 'Numéros d’urgence', 'Paiement'];
/** Sources qui mesurent chaque réseau : un réseau sans panne n'est vert que si l'une d'elles est fraîche. */
export const NETWORK_SOURCES: Readonly<Record<OutageNetwork, readonly OutageNowSource[]>> = {
  mobile: ['presse', 'arcep'], internet: ['ioda', 'radar'], electricite: ['rte', 'edf'], cloud: ['statut'],
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

/** Huit cases : les quatre réseaux suivis, puis ceux sans source temps réel. */
export function networkStrip(r: OutagesNowResponse | null, filter: OutageNetwork | null, now: number): string {
  void now;
  const cells = NETWORKS.map((n) => {
    const outs = (r?.outages ?? []).filter((o) => o.network === n);
    const worst = outs.reduce<OutageNow['level'] | null>((m, o) => (m === null || RANK[o.level] > RANK[m] ? o.level : m), null);
    const fresh = (r?.sources ?? []).filter((s) => NETWORK_SOURCES[n].includes(s.source) && s.ok);
    const cls = worst ?? (fresh.length > 0 ? 'vert' : 'nd');
    const state = r === null ? 'chargement…' : fresh.length > 0 ? fresh.map((s) => SOURCE_LABEL[s.source]).join(', ') : 'sources n.d.';
    return `<button type="button" class="orm-net" data-net="${n}" aria-pressed="${filter === n}">${dot(cls)}<span class="orm-net-name">${NETWORK_LABEL[n]}</span>`
      + `<b class="orm-net-n">${r === null ? 'n.d.' : outs.length}</b><small>${escapeHtml(state)}</small></button>`;
  });
  const none = NO_SOURCE.map((name) => `<div class="orm-net is-none">${dot('nd')}<span class="orm-net-name">${name}</span><b class="orm-net-n">n.d.</b><small>pas de source temps réel</small></div>`);
  return [...cells, ...none].join('');
}

function outageRow(o: OutageNow, now: number): string {
  return `<button type="button" class="orm-item" data-outage="${escapeHtml(o.id)}">${dot(o.level)}<span><b>${escapeHtml(outageTitle(o))}</b>`
    + `<small>${escapeHtml(outageSince(o.since, now))} · ${escapeHtml(outageProof(o))}</small></span></button>`;
}

/** Pannes sans département (opérateur, pays, ouvrage) : elles n'ont pas de lieu sur la carte. */
export function nationalBox(r: OutagesNowResponse | null, filter: OutageNetwork | null, now: number): string {
  const rows = (r?.outages ?? []).filter((o) => o.dept === null).filter(keep(filter)).map((o) => outageRow(o, now)).join('');
  return `<h3>National et sans lieu</h3>${rows || '<p class="orm-empty">aucune</p>'}`;
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
  return `<h3>Fil en direct</h3>${rows || '<p class="orm-empty">Aucun changement enregistré sur 7 jours.</p>'}`;
}

/** Détail d'une panne : niveau, échelon, depuis, preuves, chronologie. */
export function detailHtml(o: OutageNow, journal: readonly OutageJournalEntry[], now: number): string {
  const proofs = o.evidence.map((e) => {
    const t = escapeHtml(e.text);
    return `<li><b>${escapeHtml(SOURCE_LABEL[e.source])}</b>${NBSP}: ${e.link ? `<a href="${escapeHtml(e.link)}" target="_blank" rel="noopener noreferrer">${t}</a>` : t}</li>`;
  }).join('');
  const story = journal.filter((e) => e.id === o.id).map((e) => `<li>${clock(e.at)} · ${VERB[e.kind]} (${LEVEL_WORD[e.level]})</li>`).join('');
  return `<div class="orm-detail"><button type="button" class="orm-back" data-back>← fil</button>`
    + `<h3>${escapeHtml(outageTitle(o))}</h3><p>${dot(o.level)} ${LEVEL_WORD[o.level]} · ${RUNG_LABEL[o.rung]} · ${escapeHtml(outageSince(o.since, now))}</p>`
    + `<h4>Preuves</h4><ul>${proofs || '<li>aucune</li>'}</ul><h4>Chronologie</h4><ul>${story || '<li>aucun changement depuis le premier relevé</li>'}</ul></div>`;
}
