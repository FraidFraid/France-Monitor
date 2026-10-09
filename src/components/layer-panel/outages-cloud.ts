// src/components/layer-panel/outages-cloud.ts : vue pure du panneau Cloud (spec 2026-10-08 panneaux pannes § 2.4) ; aucun accès réseau ni DOM.
// Incidents en cours touchant la France (chacun compté une fois : cloudLive) en gros chiffre ; « surveillé » listé sans être compté ; état
// daté par zone et par fournisseur (Azure : aucun état par région France publié) ; maintenances ; incidents hors France ou non localisés
// repliés et jamais comptés (un statut mondial n'est pas un statut France) ; référentiel de centres de données et de points d'échange en
// inventaire neutre (jamais un état).
// Un fournisseur en retard (dernière lecture + 2 h) ou muet : ses lignes sont grisées, il n'entre ni au gros chiffre ni à la pastille.
import type { CloudIncident, CloudMaintenance, CloudOutagesResponse, CloudProvider, CloudProviderState, CloudStatus, CloudZone } from '../../types/index.ts';
import { parisDayOf } from '../../services/environment-levels.ts';
import { CLOUD_PENDING_NOTE, isCloudReferenceError } from '../../services/outages-cloud.ts';
import {
  CLOUD_IMPACT_LEVEL, CLOUD_NO_INCIDENT_TEXT, CLOUD_PROVIDER_LABEL, CLOUD_STATUS_WORD, CLOUD_ZONE_LEVEL, cloudLevel, cloudLive, isDeducedZone, isOutagesDataLate,
} from '../../services/outages-levels.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { kvRow } from '../fiche/kit.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { NBSP, frNumber } from './format.ts';
import { emptyLine, listRow, loadingBody, sourceErrorCallout, sourceLinkHtml, type LayerView } from './frame.ts';
import { OUTAGES_THEME, OUT_MAINT_VAR, countText, moreNote, note, parisClock, sinceText, when } from './outages-format.ts';

export const CLOUD_TITLE = 'Cloud et hébergement';
/** Au-delà de ce nombre de zones, un fournisseur est résumé (comptes par statut) et seules ses zones non opérationnelles sont listées. */
export const CLOUD_ZONE_ROWS = 8;
export const CLOUD_EXCHANGE_ROWS = 20;
const FIGURE_CAPTION = 'incidents ouverts touchant la France';
const PAGES = [
  ['OVHcloud', 'https://public-cloud.status-ovhcloud.com'], ['Scaleway', 'https://status.scaleway.com'], ['Cloudflare', 'https://www.cloudflarestatus.com'],
  ['Google Cloud', 'https://status.cloud.google.com'], ['AWS', 'https://health.aws.amazon.com/health/status'], ['Outscale', 'https://status.outscale.com'],
] as const;

export { CLOUD_STATUS_WORD };
/** Mot d'un compte de zones dans la synthèse d'un fournisseur (singulier, pluriel), dans l'ordre d'affichage. */
const COUNT_WORD: ReadonlyArray<readonly [CloudStatus, string, string]> = [
  ['operational', 'opérationnelle', 'opérationnelles'], ['maintenance', 'en maintenance', 'en maintenance'], ['degraded', 'en performances dégradées', 'en performances dégradées'],
  ['partial', 'en panne partielle', 'en panne partielle'], ['major', 'en panne majeure', 'en panne majeure'], ['unknown', 'd’état inconnu', 'd’état inconnu'],
];
/** Gravité décroissante : les zones non opérationnelles sont listées de la pire à la moins grave. */
const SEVERITY: ReadonlyArray<CloudStatus> = ['major', 'partial', 'degraded', 'maintenance', 'unknown'];
const PROVIDER_ORDER = Object.keys(CLOUD_PROVIDER_LABEL);

type OpenFn = (sectionId: string, byDefault: boolean) => boolean;
/** `canFocus` : zones à coordonnées cliquables (recentrage de la carte). */
export interface CloudViewInput { cloud: CloudOutagesResponse | null; error: string | null; canFocus: boolean; now: number; open: OpenFn }

/** Fournisseurs à jour (lecture + 2 h) : seuls leurs incidents et leurs zones se comptent et se colorent. */
interface Context { input: CloudViewInput; r: CloudOutagesResponse; fresh: ReadonlySet<CloudProvider> }

function dateOf(iso: string): number {
  return Date.parse(iso);
}
/** « 03/03 à 11 h 46 » ; l'année s'ajoute quand la date n'est pas de l'année en cours (« 13/05/2024 à 14 h 07 »). */
function zoneDate(iso: string, now: number): string {
  const t = dateOf(iso);
  if (!Number.isFinite(t)) return 'n.d.';
  const day = parisDayOf(t);
  return day.slice(0, 4) === parisDayOf(now).slice(0, 4) ? when(iso) : `${day.slice(8)}/${day.slice(5, 7)}/${day.slice(0, 4)} à ${parisClock(t)}`;
}
/** « Paris (CDG) », « Roubaix (RBX4) », « fr-par-1 » : le code s'ajoute au libellé sauf s'il y figure déjà. */
function zoneLabel(z: CloudZone): string {
  return z.label === z.id || z.label.includes(`(${z.id})`) ? z.label : `${z.label} (${z.id})`;
}
function zonesText(zones: readonly string[], empty: string): string {
  return zones.length > 0 ? zones.join(', ') : empty;
}

/** Ligne d'incident : en cours (couleur d'impact), surveillé ou hors France (couleur de maintenance, non comptés), fournisseur en retard (gris). */
function incidentRow(i: CloudIncident, ctx: Context, elsewhere: boolean): string {
  const late = !ctx.fresh.has(i.provider);
  const state = elsewhere ? 'hors France ou non localisé, non compté' : i.state === 'en-cours' ? 'en cours' : 'surveillé (non compté)';
  const parts = [
    ...(elsewhere ? [] : [zonesText(i.zones, 'zone non précisée')]), state,
    ...(i.updatedAt === null ? [] : [`mis à jour le ${when(i.updatedAt)}`]), ...(late ? ['(en retard)'] : []),
  ];
  const countedNow = !elsewhere && i.state === 'en-cours' && !late;
  return listRow({
    text: `${CLOUD_PROVIDER_LABEL[i.provider]} · ${i.title}`, value: sinceText(i.start, ctx.input.now),
    ...(late ? { level: 'gris' as const } : countedNow ? { level: CLOUD_IMPACT_LEVEL[i.impact] } : { color: OUT_MAINT_VAR }),
    noteHtml: escapeHtml(parts.join(' · ')) + (i.url === null ? '' : ` · ${sourceLinkHtml('page d’état', i.url)}`),
  });
}

function zoneRow(z: CloudZone, p: CloudProviderState, late: boolean, ctx: Context): string {
  const deduced = isDeducedZone(p.provider, z);
  const marker = late ? { level: 'gris' as const }
    : z.status === 'maintenance' ? { color: OUT_MAINT_VAR }
    : z.status === 'unknown' ? { level: 'gris' as const }
    : { level: z.status === 'operational' ? 'vert' as const : CLOUD_ZONE_LEVEL[z.status] ?? ('gris' as const) };
  const parts = [...(z.updatedAt === null ? [] : [`mis à jour le ${zoneDate(z.updatedAt, ctx.input.now)}`]), ...(late ? ['(en retard)'] : [])];
  const focus = ctx.input.canFocus && z.lat !== null && z.lon !== null;
  return listRow({
    text: zoneLabel(z), value: deduced ? CLOUD_NO_INCIDENT_TEXT : CLOUD_STATUS_WORD[z.status], ...marker, ...(parts.length > 0 ? { note: parts.join(' · ') } : {}),
    ...(focus ? { data: { zone: `${z.lat},${z.lon}` }, link: true } : {}),
  });
}

/** « 28 zones suivies : 28 opérationnelles, 1 en panne partielle ». */
function zoneSummary(zones: readonly CloudZone[]): string {
  const counts = COUNT_WORD.map(([status, one, many]) => ({ n: zones.filter((z) => z.status === status).length, one, many })).filter((c) => c.n > 0);
  return note(`${countText(zones.length, 'zone suivie', 'zones suivies')} : ${counts.map((c) => countText(c.n, c.one, c.many)).join(', ')}`);
}

function providerBlock(p: CloudProviderState, ctx: Context): string {
  const late = isOutagesDataLate('cloud', p.readAt, ctx.input.now);
  const read = p.readAt === null ? 'n.d.' : `lu à ${parisClock(dateOf(p.readAt))}${late ? ' (en retard)' : ''}`;
  const head = kvRow(p.label, escapeHtml(p.note !== null ? '' : read));
  const lines = (p.note === null ? '' : note(p.note)) + (p.error === null ? '' : note(p.error));
  const listed = p.zones.length <= CLOUD_ZONE_ROWS
    ? p.zones
    : [...p.zones].filter((z) => z.status !== 'operational').sort((a, b) => SEVERITY.indexOf(a.status) - SEVERITY.indexOf(b.status));
  const rows = listed.slice(0, CLOUD_ZONE_ROWS).map((z) => zoneRow(z, p, late, ctx)).join('');
  return head + lines + (p.zones.length > CLOUD_ZONE_ROWS ? zoneSummary(p.zones) : '') + rows
    + (p.zones.length > CLOUD_ZONE_ROWS ? moreNote(listed.length, CLOUD_ZONE_ROWS) : '');
}

function providersSection(ctx: Context): string {
  return [...ctx.r.providers]
    .sort((a, b) => PROVIDER_ORDER.indexOf(a.provider) - PROVIDER_ORDER.indexOf(b.provider))
    .map((p) => providerBlock(p, ctx)).join('');
}

function maintenanceRow(m: CloudMaintenance, ctx: Context): string {
  const late = !ctx.fresh.has(m.provider);
  const parts = [zonesText(m.zones, 'zones non précisées'), ...(m.end === null ? [] : [`fin ${when(m.end)}`]), ...(late ? ['(en retard)'] : [])];
  return listRow({
    text: `${CLOUD_PROVIDER_LABEL[m.provider]} · ${m.title}`, value: m.inProgress ? 'en cours' : when(m.start),
    ...(late ? { level: 'gris' as const } : { color: OUT_MAINT_VAR }), note: parts.join(' · '),
  });
}

/** Panne nommée du jeu DRIEAT (« Référentiel (DRIEAT) : … »), null s'il a été lu. */
function drieatError(r: CloudOutagesResponse): string | null {
  return r.errors.find((e) => e.startsWith('Référentiel (DRIEAT)')) ?? null;
}

/** Référentiel daté par la dernière lecture réussie d'une de ses sources ; chaque source en panne nommée (jamais sous la pastille). */
function referenceSection(r: CloudOutagesResponse): string {
  const ref = r.reference;
  const read = ref.generatedAt === null ? 'n.d.' : when(ref.generatedAt);
  const exchanges = ref.exchanges.slice(0, CLOUD_EXCHANGE_ROWS).map((x) => listRow({
    text: x.name, noteHtml: (x.city === null ? '' : `${escapeHtml(x.city)} · `) + sourceLinkHtml('PeeringDB', x.url),
  })).join('') + moreNote(ref.exchanges.length, CLOUD_EXCHANGE_ROWS);
  return kvRow('Centres de données', escapeHtml(countText(ref.datacenters.length, 'centre', 'centres')))
    + kvRow('Points d’échange', escapeHtml(countText(ref.exchanges.length, 'point d’échange', 'points d’échange')))
    + note(`Référentiel relu le ${read} (dernière lecture réussie de ses sources ; instantané OpenStreetMap sans date publiée).`)
    + r.errors.filter(isCloudReferenceError).map(note).join('')
    + note('Inventaire, pas un état : un site n’est coloré que si son fournisseur publie un état propre.')
    + exchanges;
}

function methodSection(r: CloudOutagesResponse): string {
  const drieat = drieatError(r);
  return note('Un statut mondial d’un fournisseur n’est pas un statut France : il ne colore rien et n’est pas compté. Seuls comptent les incidents qui touchent une zone française suivie.')
    + note('Un incident est compté une fois, quel que soit le nombre de zones qu’il touche.')
    + note('« En cours » : incident en investigation ou identifié, compté. « Surveillé » : correctif posé, en observation, listé et non compté.')
    + note(`Un fournisseur dont la dernière lecture date de plus de 2${NBSP}h est grisé, marqué « (en retard) » et n’est plus compté.`)
    + note('Azure ne publie aucun état par région France : il n’apparaît qu’en note.')
    + note('Equinix ne publie pas de page d’état lisible (HTTP 403) : non suivi.')
    + note(`Référentiel : centres de données d’Île-de-France du jeu DRIEAT (data.gouv.fr), projets uMap et points d’échange PeeringDB, chacun relu au plus toutes les 6${NBSP}h.`)
    + (drieat === null ? '' : note(`Lecture DRIEAT en échec (${drieat}) : retentée au plus toutes les 6${NBSP}h ; ses centres d’Île-de-France ne viennent que d’une lecture réussie.`))
    + `<p class="fmk-note">${PAGES.map(([label, href]) => sourceLinkHtml(label, href)).join(' · ')}</p>`;
}

function sections(ctx: Context, lateAll: boolean): FicheSection[] {
  const { r, input } = ctx;
  const { open, now } = input;
  const live = cloudLive(r, now);
  const sorted = [...r.incidents].sort((a, b) => (a.state === 'en-cours' ? 0 : 1) - (b.state === 'en-cours' ? 0 : 1));
  const unreadable = r.providers.some((p) => p.note === null && !ctx.fresh.has(p.provider));
  const none = lateAll ? emptyLine('Incidents en cours n.d. : pages d’état en retard.')
    : emptyLine(unreadable ? 'Aucun incident ouvert chez les fournisseurs à jour.' : 'Aucun incident ouvert touchant une zone française suivie.');
  const maintenances = [...r.maintenances].sort((a, b) => (a.inProgress ? 0 : 1) - (b.inProgress ? 0 : 1) || a.start.localeCompare(b.start));
  const count = (n: number): string => escapeHtml(lateAll ? 'n.d.' : frNumber(n, 0));
  return [
    { id: 'incidents', title: 'Incidents touchant la France', collapsible: true, open: open('incidents', true), summary: count(live.incidents.length), html: sorted.map((i) => incidentRow(i, ctx, false)).join('') || none },
    { id: 'fournisseurs', title: 'État par fournisseur', collapsible: true, open: open('fournisseurs', true), html: providersSection(ctx) },
    {
      id: 'maintenances', title: 'Maintenances', collapsible: true, open: open('maintenances', maintenances.length > 0), summary: count(maintenances.length),
      html: maintenances.map((m) => maintenanceRow(m, ctx)).join('') || emptyLine('Aucune maintenance annoncée sur une zone française suivie.'),
    },
    {
      id: 'ailleurs', title: 'Hors France ou non localisés', collapsible: true, open: open('ailleurs', false), summary: count(r.elsewhere.length),
      html: r.elsewhere.map((i) => incidentRow(i, ctx, true)).join('') || emptyLine('Aucun incident hors France ou non localisé.'),
    },
    {
      id: 'referentiel', title: 'Référentiel : centres de données et points d’échange', collapsible: true, open: open('referentiel', false), tone: 'reference',
      html: referenceSection(r),
    },
    { id: 'methode', title: 'Méthode et sources', collapsible: true, open: open('methode', false), html: methodSection(r) },
  ];
}

export function buildCloudView(input: CloudViewInput): LayerView {
  const { cloud: r, error, now } = input;
  if (r === null && error === null) {
    return { head: { theme: OUTAGES_THEME, title: CLOUD_TITLE, status: ['chargement…'] }, sections: [], bodyHtml: loadingBody() };
  }
  if (r === null || r.providers.every((p) => p.readAt === null)) {
    const reasons = [error, ...(r?.errors ?? [])].filter((x): x is string => x !== null && x.length > 0);
    const named = reasons.filter((x) => x !== CLOUD_PENDING_NOTE);
    // Première collecte pas finie : un avancement, pas une panne (aucun encadré « Source injoignable »).
    const pending = named.length === 0 && reasons.length > 0;
    return {
      head: {
        theme: OUTAGES_THEME, title: CLOUD_TITLE, level: 'nd', figure: { value: 'n.d.', caption: FIGURE_CAPTION, level: null },
        status: [pending ? 'pages d’état : collecte en cours' : 'pages d’état injoignables'],
      },
      sections: [], bodyHtml: (pending ? '' : sourceErrorCallout(null, now)) + (pending ? reasons : named).map(note).join(''),
    };
  }
  const live = cloudLive(r, now);
  const ctx: Context = { input: { ...input, cloud: r }, r, fresh: new Set(live.freshProviders) };
  const lateAll = live.freshProviders.length === 0;
  const newest = r.providers.map((p) => p.readAt).filter((at): at is string => at !== null).sort().at(-1) ?? null;
  const figure = lateAll ? { value: 'n.d.', caption: FIGURE_CAPTION, level: null } : { value: frNumber(live.incidents.length, 0), caption: FIGURE_CAPTION };
  const level = cloudLevel(r, now) ?? 'nd';
  const muted = r.providers.filter((p) => p.note === null && !ctx.fresh.has(p.provider))
    .map((p) => `${p.label} (${p.readAt === null ? 'n.d.' : 'en retard'})`);
  const status = [
    `pages d’état lues à ${newest === null ? 'n.d.' : parisClock(dateOf(newest))}${lateAll ? ' (en retard)' : ''}`,
    ...(lateAll || muted.length === 0 ? [] : [`non comptés : ${muted.join(', ')}`]),
  ];
  // Erreurs nommées : celle de la lecture client (encadré daté), puis celles du serveur que la ligne d'un fournisseur ne dit pas déjà ;
  // celles du référentiel (inventaire, jamais un état) sont dites dans sa section et dans la méthode, pas sous la pastille.
  const shown = new Set(r.providers.flatMap((p) => (p.error === null ? [] : p.error.split(' ; '))));
  const body = (error !== null ? sourceErrorCallout(newest === null ? null : dateOf(newest), now) : '')
    + r.errors.filter((e) => e !== CLOUD_PENDING_NOTE && !shown.has(e) && !isCloudReferenceError(e)).map(note).join('');
  return {
    head: { theme: OUTAGES_THEME, title: CLOUD_TITLE, figure, level, status },
    sections: sections(ctx, lateAll),
    ...(body !== '' ? { bodyHtml: body } : {}),
  };
}
