// src/components/layer-panel/cyber-watch.ts : sections de la veille cyber élargie dans le panneau Vigilance cyber (18/10/2026) ; vue
// pure, aucun accès réseau ni DOM. Attaques DDoS visant la France (Cloudflare Radar), cibles françaises du groupe pro-russe
// NoName057(16) (listes DDoSia relevées par witha.name), routage Internet (détournements et fuites BGP), serveurs malveillants hébergés en
// France (abuse.ch), domaines imitant un service public ou une marque, disponibilité des services publics en ligne, violations de
// données notifiées à la CNIL, vulnérabilités exploitées de la base européenne (ENISA). Chaque section porte sa source et sa date ;
// aucune n'entre dans la pastille ni dans l'indice (informations d'appui). Une cible publiée n'est jamais présentée comme une attaque
// réussie ; un domaine imitateur n'est jamais un lien cliquable (écrit « [.] »).
import type {
  CyberResponse, CyberWatchCount, CyberWatchResponse, CyberWatchService, DdosiaHost, RadarAs,
} from '../../types/index.ts';
import type { VigilanceLevel } from '../../services/vigilance.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { kvRow } from '../fiche/kit.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { lineChart, stackedDayBars, type ChartPoint, type DayStack } from './chart.ts';
import { NBSP, frNumber } from './format.ts';
import { barRow, emptyLine as plainEmptyLine, listRow, sourceLinkHtml, valueHtml } from './frame.ts';
import { clockOf, dataMs, formatCount, glueSovUnits, note as plainNote, plural, shortDate, sourceDown } from './sovereignty-format.ts';

type OpenFn = (sectionId: string, byDefault: boolean) => boolean;

const note = (text: string): string => plainNote(glueSovUnits(text));
const emptyLine = (text: string): string => plainEmptyLine(glueSovUnits(text));
const summaryText = (text: string): string => escapeHtml(glueSovUnits(text));

const DAY_MS = 86_400_000;
export const DDOS_COLOR = 'var(--cat-ddos)';
export const DDOS_L3_COLOR = 'var(--cat-ddos-l3)';
export const HACKTIVIST_COLOR = 'var(--cat-hacktiviste)';
const MALWARE_COLOR = 'var(--cat-malware)';
const LOOKALIKE_COLOR = 'var(--cat-imitation)';
const CNIL_COLOR = 'var(--cat-cnil)';
const BGP_COLOR = 'var(--cat-bgp)';

const RADAR_URL = 'https://radar.cloudflare.com/fr-fr/security/fr';
const RADAR_BGP_URL = 'https://radar.cloudflare.com/fr-fr/routing/fr';
const WITHA_URL = 'https://witha.name/';
const URLHAUS_URL = 'https://urlhaus.abuse.ch/browse/country/FR/';
const FEODO_URL = 'https://feodotracker.abuse.ch/';
const WHOISDS_URL = 'https://www.whoisds.com/newly-registered-domains';
const CNIL_URL = 'https://www.data.gouv.fr/fr/datasets/notifications-a-la-cnil-de-violations-de-donnees-a-caractere-personnel/';
const EUVD_URL = 'https://euvd.enisa.europa.eu/';
const EPSS_URL = 'https://www.first.org/epss/';
const EUROPOL_URL = 'https://www.europol.europa.eu/media-press/newsroom/news/global-operation-targets-noname05716-pro-russian-cybercrime-network';
const SIGNAL_URL = 'https://www.internet-signalement.gouv.fr/';

/** « à 16:30 » le jour même, « le 03/10 à 14:00 » sinon (heure de Paris). */
function atText(iso: string | null | undefined, now: number): string {
  if (dataMs(iso) === null) return 'à une heure n.d.';
  const [first, second] = clockOf(iso, now).split(' ');
  return second === undefined ? `à ${first}` : `le ${first} à ${second}`;
}

const pct = (v: number | null, digits = 0): string => (v === null ? 'n.d.' : `${frNumber(v, digits)}${NBSP}%`);

/** Nom de domaine rendu inoffensif (jamais cliquable, jamais lu comme un lien) : « exemple[.]com ». */
export function defang(domain: string): string {
  return domain.replace(/\./g, '[.]');
}

// ─── Attaques DDoS (Cloudflare Radar) ───

const INDUSTRY_FR: Readonly<Record<string, string>> = {
  other: 'autres', Retail: 'commerce de détail', 'Computer Software': 'logiciels', Internet: 'internet', 'Information Services': 'services d’information',
  'Information Technology and Services': 'services informatiques', 'Marketing and Advertising': 'marketing et publicité', 'Gambling & Casinos': 'jeux d’argent',
  'Financial Services': 'services financiers', Banking: 'banque', 'Government Administration': 'administration publique', Telecommunications: 'télécommunications',
  'Online Media': 'médias en ligne', 'Media Production': 'médias', 'Hospital & Health Care': 'santé', 'Higher Education': 'enseignement supérieur',
  'Education Management': 'éducation', 'Consumer Electronics': 'électronique grand public', 'Computer Games': 'jeux vidéo', Airlines: 'transport aérien',
  'Transportation/Trucking/Railroad': 'transport', 'Civic & Social Organization': 'associations', 'Non-profit Organization Management': 'associations',
  'Cryptocurrency': 'cryptoactifs', Insurance: 'assurance', 'Government Relations': 'relations publiques',
};

/** Écart du dernier jour à la médiane : jaune au-delà de 2 fois, orange au-delà de 4 fois (jamais rouge : mesure relative de Cloudflare). */
export function ddosLevel(ratio: number | null): VigilanceLevel | null {
  if (ratio === null) return null;
  if (ratio >= 4) return 'orange';
  if (ratio >= 2) return 'jaune';
  return null;
}

function ratioText(ratio: number | null): string {
  return ratio === null ? 'n.d.' : `${frNumber(ratio, 1)} fois la médiane`;
}

function radarChart(points: { day: string; value: number }[], color: string, label: string, now: number): string {
  const pts: ChartPoint[] = points.flatMap((p) => {
    const at = dataMs(`${p.day}T12:00:00Z`);
    return at === null ? [] : [{ at, value: p.value * 100 }];
  });
  if (pts.length < 2) return '';
  return lineChart(pts, {
    label, from: pts[0].at, to: pts[pts.length - 1].at, stroke: color, markPeak: true,
    value: (v) => `${frNumber(v, 0)}`, tick: (ms) => shortDate(new Date(ms).toISOString(), now),
  });
}

function ddosSection(w: CyberWatchResponse, now: number, open: OpenFn): FicheSection {
  const base = { id: 'ddos', title: 'Attaques DDoS visant la France', collapsible: true, open: open('ddos', true) };
  const r = w.radar;
  if (r === null) return { ...base, summary: 'n.d.', html: sourceDown('Cloudflare Radar') };
  const level = ddosLevel(Math.max(r.l7Ratio ?? 0, r.l3Ratio ?? 0) || null);
  const top = r.industries.filter((i) => i.label !== 'other').slice(0, 5);
  const max = Math.max(1, ...top.map((i) => i.pct));
  const html = kvRow('Applicatives (couche 7), dernier jour', valueHtml(ratioText(r.l7Ratio), ddosLevel(r.l7Ratio)))
    + kvRow('Réseau (couches 3 et 4), dernier jour', valueHtml(ratioText(r.l3Ratio), ddosLevel(r.l3Ratio)))
    + kvRow('Rang de la France parmi les pays visés (7 jours)', valueHtml(r.targetRank === null ? 'hors des 50 premiers'
      : `${r.targetRank}e · ${pct(r.targetShare, 1)} des attaques applicatives`))
    + `<div class="lp-legend"><span class="lp-key"><i style="background:${DDOS_COLOR}"></i>applicatives</span>`
    + `<span class="lp-key"><i style="background:${DDOS_L3_COLOR}"></i>réseau</span></div>`
    + radarChart(r.l7, DDOS_COLOR, 'Attaques DDoS applicatives visant la France par jour sur 28 jours, en pourcentage du maximum de la période', now)
    + radarChart(r.l3, DDOS_L3_COLOR, 'Attaques DDoS réseau visant la France par jour sur 28 jours, en pourcentage du maximum de la période', now)
    + note('Secteurs visés en France sur 7 jours (attaques applicatives)')
    + (top.length > 0
      ? top.map((i) => barRow({ label: INDUSTRY_FR[i.label] ?? i.label, pct: (i.pct / max) * 100, value: pct(i.pct, 1), color: DDOS_COLOR })).join('')
      : emptyLine('Secteurs non publiés.'))
    + note('Mesure de Cloudflare sur le trafic qu’il protège (une part importante des sites français, pas tous) : volumes relatifs (100 = jour le '
      + 'plus attaqué des 28 jours), jamais un nombre d’attaques. Jaune au-delà de 2 fois la médiane des jours précédents, orange au-delà de 4 fois.')
    + `<p class="fmk-note">${sourceLinkHtml('Cloudflare Radar, France', RADAR_URL)}${escapeHtml(` · CC BY-NC 4.0 · données jusqu’au ${shortDate(r.dataUntil, now)}, lues ${atText(r.readAt, now)}`)}</p>`;
  void level;
  return {
    ...base,
    summary: summaryText(`applicatives ${ratioText(r.l7Ratio)} · ${r.targetRank === null ? 'rang n.d.' : `${r.targetRank}e pays visé`}`), html,
  };
}

// ─── Hacktivistes (NoName057(16), DDoSia) ───

const KIND_ORDER: readonly string[] = ['préfecture', 'administration', 'collectivité', 'port', 'site'];

/** Cible relevée dans une liste de moins de 24 h : jaune (une cible publiée n'est pas une attaque réussie). */
export function hacktivistLevel(h: DdosiaHost, now: number): VigilanceLevel | null {
  const last = dataMs(h.last);
  return last !== null && now - last < DAY_MS ? 'jaune' : null;
}

function placeText(h: DdosiaHost): string {
  if (h.place === null) return 'lieu non déduit du domaine';
  return h.place.how === 'préfecture' ? `${h.place.name} (${h.place.dept})` : `${h.place.name} (${h.place.dept}), lieu déduit du nom de domaine`;
}

function hostRow(h: DdosiaHost, now: number): string {
  const seen = h.configs > 1 ? `${h.configs} listes, du ${shortDate(h.first, now)} au ${shortDate(h.last, now)}` : `liste du ${shortDate(h.last, now)}`;
  return listRow({
    text: h.host, value: h.kind, level: hacktivistLevel(h, now), color: HACKTIVIST_COLOR,
    note: `${placeText(h)} · ${seen}`,
  });
}

function hacktivistSection(w: CyberWatchResponse, now: number, open: OpenFn): FicheSection {
  const base = { id: 'hacktivistes', title: 'Cibles des hacktivistes pro-russes (NoName057(16))', collapsible: true, open: open('hacktivistes', true) };
  const d = w.ddosia;
  if (d === null) return { ...base, summary: 'n.d.', html: sourceDown('witha.name') };
  const recent = d.hosts.filter((h) => hacktivistLevel(h, now) !== null);
  const hosts = [...d.hosts].sort((a, b) => (hacktivistLevel(b, now) ? 1 : 0) - (hacktivistLevel(a, now) ? 1 : 0)
    || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || b.last.localeCompare(a.last));
  const days: DayStack[] = d.days.flatMap((x) => {
    const at = dataMs(`${x.day}T12:00:00Z`);
    return at === null ? [] : [{ day: at, parts: [{ value: x.fr, color: HACKTIVIST_COLOR, label: 'sites français' }] }];
  });
  const chart = stackedDayBars(days, {
    label: 'Sites français distincts dans les listes de cibles de NoName057(16), par jour', value: (v) => formatCount(v),
    tick: (ms) => shortDate(new Date(ms).toISOString(), now),
  });
  const lc = d.lastConfig;
  const latest = lc === null ? emptyLine('Aucune liste relevée.')
    : kvRow('Dernière liste relevée', valueHtml(`${shortDate(lc.at, now)} · ${plural(lc.targets, 'site visé', 'sites visés')}, dont ${lc.fr} en France`, lc.fr > 0 ? 'jaune' : null))
      + kvRow('Pays les plus visés (domaines)', valueHtml(lc.tlds.slice(0, 4).map((t) => `.${t.label} ${t.count}`).join(' · ') || 'n.d.'));
  const shown = hosts.slice(0, 15);
  const more = hosts.slice(15);
  return {
    ...base,
    summary: summaryText(recent.length > 0 ? `${plural(recent.length, 'site français', 'sites français')} visés en 24 h · ${d.hosts.length} sur 30 jours`
      : `${plural(d.hosts.length, 'site français', 'sites français')} sur 30 jours`),
    html: latest
      + (shown.length > 0 ? shown.map((h) => hostRow(h, now)).join('') : emptyLine('Aucun site français dans les listes depuis 30 jours.'))
      + (more.length > 0 ? `<details class="lp-more"><summary>${summaryText(`${more.length} sites de plus`)}</summary>${more.map((h) => hostRow(h, now)).join('')}</details>` : '')
      + (chart ? `<div class="lp-legend"><span class="lp-key"><i style="background:${HACKTIVIST_COLOR}"></i>sites français par jour</span></div>${chart}` : '')
      + note('Listes de cibles que le groupe distribue à ses volontaires (logiciel DDoSia), relevées et publiées par le chercheur witha.name. '
        + 'Une cible publiée n’est pas une attaque réussie : ces attaques visent surtout à rendre un site lent ou indisponible quelques heures, '
        + 'sans vol de données. Jaune : site présent dans une liste de moins de 24 heures.')
      + note('Lieu : préfecture d’après le domaine en gouv.fr, sinon commune de 5 000 habitants et plus dont le nom est exactement celui du domaine ; '
        + 'sinon aucun lieu.')
      + `<p class="fmk-note">${sourceLinkHtml('witha.name (listes DDoSia)', WITHA_URL)} · ${sourceLinkHtml('opération Eastwood d’Europol contre le groupe', EUROPOL_URL)}`
      + `${escapeHtml(` · lu ${atText(d.readAt, now)}`)}</p>`,
  };
}

// ─── Routage Internet (BGP) ───

function asText(a: RadarAs): string {
  const name = a.name ?? 'réseau n.d.';
  return `${name}${a.asn !== null ? ` (AS${a.asn}` : ' ('}${a.cc ? `, ${a.cc}` : ''})`;
}

function bgpSection(w: CyberWatchResponse, now: number, open: OpenFn): FicheSection {
  const base = { id: 'bgp', title: 'Routage Internet : détournements et fuites', collapsible: true, open: open('bgp', false) };
  const r = w.radar;
  if (r === null) return { ...base, summary: 'n.d.', html: sourceDown('Cloudflare Radar') };
  const frVictim = r.hijacks.filter((h) => h.victims.some((v) => v.cc === 'FR'));
  const hijackRows = r.hijacks.map((h) => listRow({
    text: `${asText(h.hijacker)} → ${h.victims.map(asText).join(', ') || 'n.d.'}`,
    value: shortDate(h.start, now),
    level: h.victims.some((v) => v.cc === 'FR') && h.ongoing ? 'jaune' : null,
    color: BGP_COLOR,
    note: `${plural(h.prefixes, 'préfixe annoncé', 'préfixes annoncés')} · confiance ${h.confidence ?? 'n.d.'} sur 10 · ${h.ongoing ? 'en cours' : 'terminé'}`,
  }));
  const leakRows = r.leaks.map((l) => listRow({
    text: asText(l.leaker), value: shortDate(l.start, now), color: BGP_COLOR,
    note: `${l.prefixes === null ? 'préfixes n.d.' : plural(l.prefixes, 'préfixe')} · pays concernés : ${l.countries.join(', ') || 'n.d.'} · ${l.finished ? 'terminée' : 'en cours'}`,
  }));
  return {
    ...base,
    summary: summaryText(`${plural(r.hijackCount, 'détournement')} · ${plural(r.leakCount, 'fuite')} sur 7 jours`),
    html: kvRow('Détournements impliquant la France (7 jours)', valueHtml(`${r.hijackCount}, dont ${frVictim.length} visant un réseau français`))
      + (hijackRows.length > 0 ? hijackRows.slice(0, 6).join('') : emptyLine('Aucun détournement détecté.'))
      + kvRow('Fuites de routes impliquant la France (7 jours)', valueHtml(formatCount(r.leakCount)))
      + (leakRows.length > 0 ? `<details class="lp-more"><summary>${summaryText(`${leakRows.length} fuites`)}</summary>${leakRows.join('')}</details>` : '')
      + note('Détournement : un réseau annonce des adresses qui appartiennent à un autre (« réseau qui annonce → réseau victime »), par erreur ou pour '
        + 'intercepter du trafic. Fuite : un réseau relaie des routes qu’il ne devrait pas, ce qui peut ralentir ou couper l’accès. Détection '
        + 'automatique de Cloudflare, avec son indice de confiance ; jaune : réseau français victime d’un détournement en cours.')
      + `<p class="fmk-note">${sourceLinkHtml('Cloudflare Radar, routage', RADAR_BGP_URL)}${escapeHtml(` · lu ${atText(r.readAt, now)}`)}</p>`,
  };
}

// ─── Serveurs malveillants hébergés en France (abuse.ch) ───

const THREAT_FR: Readonly<Record<string, string>> = { malware_download: 'distribution de logiciel malveillant' };

function abuseSection(w: CyberWatchResponse, now: number, open: OpenFn): FicheSection {
  const base = { id: 'malveillants', title: 'Serveurs malveillants hébergés en France', collapsible: true, open: open('malveillants', false) };
  const a = w.abuse;
  if (a === null) return { ...base, summary: 'n.d.', html: sourceDown('abuse.ch') };
  const u = a.urlhaus;
  const maxAs = Math.max(1, ...u.asns.map((x) => x.count));
  const days: DayStack[] = u.weeks.map((wk) => ({
    day: now - wk.weeksAgo * 7 * DAY_MS, parts: [{ value: wk.count, color: MALWARE_COLOR, label: 'adresses signalées' }],
  }));
  const chart = stackedDayBars(days, {
    label: 'Adresses de logiciels malveillants hébergées en France signalées à URLhaus, par semaine sur 12 semaines', value: (v) => formatCount(v),
    tick: (ms) => shortDate(new Date(ms).toISOString(), now),
  });
  const latest = u.latest.map((x) => listRow({
    text: defang(x.host), value: shortDate(x.added, now), color: MALWARE_COLOR,
    note: `${THREAT_FR[x.threat] ?? x.threat} · en ligne · ${x.asn !== null ? `AS${x.asn}` : 'réseau n.d.'}`,
  }));
  const feodo = a.feodo.servers.map((s) => listRow({
    text: `${s.ip.replace(/\./g, '[.]')}:${s.port ?? '?'}`, value: s.status === 'online' ? 'en ligne' : 'hors ligne', color: MALWARE_COLOR,
    note: `${s.malware ?? 'logiciel n.d.'} · ${s.asName ?? 'hébergeur n.d.'} · vu le ${s.lastOnline ?? 'n.d.'}`,
  }));
  return {
    ...base,
    summary: summaryText(`${formatCount(u.last30)} adresses sur 30 jours · ${u.online} en ligne`),
    html: kvRow('Adresses signalées sur 30 jours', valueHtml(`${formatCount(u.last30)} · ${u.online} encore en ligne`))
      + kvRow('Serveurs de commande (botnets) en France', valueHtml(`${a.feodo.fr} · ${a.feodo.frOnline} en ligne`))
      + note('Hébergeurs les plus utilisés (30 jours)')
      + (u.asns.length > 0
        ? u.asns.map((x) => barRow({ label: `${x.name ?? 'réseau'} (AS${x.asn})`, pct: (x.count / maxAs) * 100, value: formatCount(x.count), color: MALWARE_COLOR })).join('')
        : emptyLine('Aucune adresse sur 30 jours.'))
      + (chart ? `<div class="lp-legend"><span class="lp-key"><i style="background:${MALWARE_COLOR}"></i>adresses signalées par semaine</span></div>${chart}` : '')
      + (latest.length > 0 ? `<details class="lp-more"><summary>${summaryText(`${latest.length} adresses encore en ligne`)}</summary>${latest.join('')}</details>` : '')
      + (feodo.length > 0 ? `<details class="lp-more"><summary>${summaryText(`${feodo.length} serveurs de commande`)}</summary>${feodo.join('')}</details>` : '')
      + note('Adresses de téléchargement de logiciels malveillants et serveurs de commande de réseaux de machines piratées situés en France, '
        + 'signalés par la communauté d’abuse.ch. Noms écrits avec « [.] » : ne pas les ouvrir. Un serveur loué en France n’indique pas un '
        + 'attaquant français : il signale un hébergeur à prévenir.')
      + `<p class="fmk-note">${sourceLinkHtml('URLhaus', URLHAUS_URL)} · ${sourceLinkHtml('Feodo Tracker', FEODO_URL)}`
      + `${escapeHtml(` (abuse.ch, CC0) · lus ${atText(a.readAt, now)} · signaler : `)}${sourceLinkHtml('Pharos', SIGNAL_URL)}</p>`,
  };
}

// ─── Domaines imitateurs ───

function brandCounts(domains: { brand: string }[]): CyberWatchCount[] {
  const m = new Map<string, number>();
  for (const d of domains) m.set(d.brand, (m.get(d.brand) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }));
}

function lookalikeSection(w: CyberWatchResponse, now: number, open: OpenFn): FicheSection {
  const base = { id: 'imitations', title: 'Domaines imitant un service public ou une marque', collapsible: true, open: open('imitations', false) };
  const l = w.lookalikes;
  if (l === null) return { ...base, summary: 'n.d.', html: sourceDown('whoisds') };
  const brands = brandCounts(l.domains).slice(0, 8);
  const max = Math.max(1, ...brands.map((b) => b.count));
  const rows = l.domains.map((d) => listRow({ text: defang(d.domain), value: shortDate(d.day, now), color: LOOKALIKE_COLOR, note: `imite : ${d.brand}` }));
  const lastDay = l.perDay.at(-1);
  return {
    ...base,
    summary: summaryText(`${plural(l.domains.length, 'domaine')} sur 30 jours`),
    html: (lastDay ? kvRow(`Enregistrés le ${shortDate(lastDay.day, now)}`, valueHtml(`${lastDay.matched} sur ${formatCount(lastDay.total)} domaines lus`)) : '')
      + (brands.length > 0
        ? brands.map((b) => barRow({ label: b.label, pct: (b.count / max) * 100, value: formatCount(b.count), color: LOOKALIKE_COLOR })).join('')
        : emptyLine('Aucun domaine imitateur relevé.'))
      + (rows.length > 0 ? `<details class="lp-more"><summary>${summaryText(`${rows.length} domaines`)}</summary>${rows.join('')}</details>` : '')
      + note('Domaines enregistrés la veille dont le nom reprend celui d’un service public (ameli, impots, ANTAI, CAF…) ou d’une marque très '
        + 'imitée (banques, transporteurs, Vinted) : signal d’hameçonnage à venir, pas une preuve. Liste gratuite et partielle de whoisds (environ '
        + '70 000 domaines par jour, une partie des créations mondiales) ; un domaine n’est pas toujours actif.')
      + `<p class="fmk-note">${sourceLinkHtml('whoisds, nouveaux domaines', WHOISDS_URL)}${escapeHtml(` · lu ${atText(l.readAt, now)} · signaler : `)}`
      + `${sourceLinkHtml('Pharos', SIGNAL_URL)}</p>`,
  };
}

// ─── Services publics en ligne ───

/** Vert seulement mesuré en ligne ; rouge hors ligne depuis 15 minutes ou plus, orange avant. */
export function serviceLevel(s: CyberWatchService, now: number): VigilanceLevel {
  if (s.ok) return 'vert';
  const since = dataMs(s.downSince);
  return since !== null && now - since >= 15 * 60_000 ? 'rouge' : 'orange';
}

function serviceRow(s: CyberWatchService, now: number): string {
  const state = s.ok ? `en ligne · ${s.ms === null ? 'n.d.' : `${formatCount(s.ms)}${NBSP}ms`}` : `injoignable${s.error ? ` (${s.error})` : ''}`;
  const parts = [
    s.downSince ? `hors ligne depuis ${atText(s.downSince, now).replace(/^à /, '')}` : null,
    `disponible ${pct(s.uptime24)} du temps sur 24 h`,
    s.medianMs !== null ? `réponse médiane ${formatCount(s.medianMs)}${NBSP}ms` : null,
    s.status !== null && s.status >= 400 ? `HTTP ${s.status} (le site répond mais filtre les robots)` : null,
  ].filter((p): p is string => p !== null);
  return listRow({ text: s.name, value: state, level: serviceLevel(s, now), noteHtml: `${escapeHtml(parts.join(' · '))} · ${sourceLinkHtml('ouvrir', s.url)}` });
}

function servicesSection(w: CyberWatchResponse, now: number, open: OpenFn): FicheSection {
  const base = { id: 'services', title: 'Disponibilité des services publics en ligne', collapsible: true, open: open('services', true) };
  const s = w.services;
  if (s === null) return { ...base, summary: 'n.d.', html: sourceDown('sondes de France Monitor') };
  const down = s.items.filter((i) => !i.ok);
  return {
    ...base,
    summary: summaryText(down.length === 0 ? `${s.items.length} services en ligne` : `${plural(down.length, 'service injoignable', 'services injoignables')} sur ${s.items.length}`),
    html: s.items.map((i) => serviceRow(i, now)).join('')
      + note(`Sondés toutes les 5 minutes par le serveur de France Monitor (Paris), dernière sonde ${atText(s.readAt, now)}. Injoignable : pas de réponse en `
        + '15 secondes, ou erreur du serveur (HTTP 500 et plus). Une panne vue d’un seul point peut être locale : à confirmer avant toute conclusion ; '
        + 'rapprocher d’un DDoS revendiqué ou d’une alerte CERT-FR.'),
  };
}

// ─── Violations de données notifiées à la CNIL ───

function cnilSection(w: CyberWatchResponse, now: number, open: OpenFn): FicheSection {
  const base = { id: 'cnil', title: 'Violations de données notifiées à la CNIL', collapsible: true, open: open('cnil', false) };
  const c = w.cnil;
  if (c === null) return { ...base, summary: 'n.d.', html: sourceDown('CNIL') };
  const quarters: DayStack[] = c.quarters.flatMap((q) => {
    const m = /^(\d{4})-T([1-4])$/.exec(q.q);
    if (!m) return [];
    return [{ day: Date.UTC(Number(m[1]), (Number(m[2]) - 1) * 3 + 1, 15), parts: [{ value: q.count, color: CNIL_COLOR, label: 'notifications' }] }];
  });
  const chart = stackedDayBars(quarters, {
    label: 'Violations de données personnelles notifiées à la CNIL par trimestre', value: (v) => formatCount(v),
    tick: (ms) => { const d = new Date(ms); return `T${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`; },
  });
  const max = Math.max(1, ...c.sectors.map((x) => x.count));
  const last = c.quarters.at(-1);
  return {
    ...base,
    summary: summaryText(`${formatCount(c.last4)} sur 4 trimestres · ${pct(c.hackingPct)} par piratage`),
    html: kvRow('4 derniers trimestres', valueHtml(`${formatCount(c.last4)} notifications`))
      + (last ? kvRow(`Dernier trimestre publié (${last.q.replace('-', ' ')})`, valueHtml(formatCount(last.count))) : '')
      + kvRow('Origine : piratage, logiciel malveillant ou hameçonnage', valueHtml(pct(c.hackingPct)))
      + kvRow('Cause : acte externe malveillant', valueHtml(pct(c.externalPct)))
      + (chart ? `<div class="lp-legend"><span class="lp-key"><i style="background:${CNIL_COLOR}"></i>notifications par trimestre</span></div>${chart}` : '')
      + note('Secteurs sur 4 trimestres')
      + c.sectors.map((x) => barRow({ label: x.label, pct: (x.count / max) * 100, value: formatCount(x.count), color: CNIL_COLOR })).join('')
      + note(`Note de la CNIL : « ${c.note} »`)
      + note('Notifications reçues par la CNIL (obligation du RGPD sous 72 heures), publiées chaque trimestre avec plusieurs mois de recul : un bilan, '
        + 'pas une alerte. Un pic peut venir d’un seul incident chez un sous-traitant commun à de nombreux organismes.')
      + `<p class="fmk-note">${sourceLinkHtml('CNIL, open data', CNIL_URL)}${escapeHtml(` · Licence ouverte · fichier du ${shortDate(c.fileDate, now)}, lu ${atText(c.readAt, now)}`)}</p>`,
  };
}

// ─── Base européenne des vulnérabilités exploitées (ENISA) ───

function euvdSection(w: CyberWatchResponse, cyber: CyberResponse | null, now: number, open: OpenFn): FicheSection {
  const base = { id: 'euvd', title: 'Vulnérabilités exploitées : base européenne (ENISA)', collapsible: true, open: open('euvd', false) };
  const e = w.euvd;
  if (e === null) return { ...base, summary: 'n.d.', html: sourceDown('EUVD (ENISA)') };
  const kev = new Set((cyber?.kev.recent ?? []).map((k) => k.cve));
  const notInKev = e.items.filter((i) => i.cve === null || !kev.has(i.cve));
  const rows = e.items.slice(0, 12).map((i) => listRow({
    text: `${i.vendor ?? ''} ${i.product ?? ''}`.trim() || i.id, value: i.exploitedSince ? shortDate(i.exploitedSince, now) : 'n.d.',
    color: 'var(--cat-kev)',
    note: [i.cve ?? i.id, i.score !== null ? `gravité ${frNumber(i.score, 1)} sur 10` : null,
      i.cve !== null && kev.has(i.cve) ? 'aussi au catalogue KEV' : 'absente du catalogue KEV de la CISA sur 30 jours'].filter(Boolean).join(' · '),
  }));
  return {
    ...base,
    summary: summaryText(`${e.last7} sur 7 jours · ${e.total30} sur 30 jours`),
    html: kvRow('Exploitées depuis 7 jours', valueHtml(formatCount(e.last7)))
      + kvRow('Sur 30 jours, absentes du catalogue américain', valueHtml(formatCount(notInKev.length)))
      + (rows.length > 0 ? rows.join('') : emptyLine('Aucune vulnérabilité exploitée publiée depuis 30 jours.'))
      + note('Base européenne des vulnérabilités de l’ENISA (EUVD, prévue par la directive NIS 2) : point de vue européen, à côté du catalogue KEV '
        + 'américain. Date : début d’exploitation connu.')
      + `<p class="fmk-note">${sourceLinkHtml('EUVD, ENISA', EUVD_URL)}${escapeHtml(` · lu ${atText(e.readAt, now)}`)}</p>`,
  };
}

// ─── EPSS (utilisé par la section KEV) ───

/** Probabilité d'exploitation à 30 jours (EPSS) d'un CVE, en texte (« EPSS 94 % ») ; null si inconnue. */
export function epssText(w: CyberWatchResponse | null, cve: string): string | null {
  const s = w?.epss?.scores.find((x) => x.cve === cve);
  if (!s || s.epss === null) return null;
  return `EPSS ${frNumber(s.epss * 100, s.epss < 0.1 ? 1 : 0)}${NBSP}%`;
}

export const EPSS_NOTE = 'EPSS (FIRST) : probabilité qu’une vulnérabilité soit exploitée dans les 30 jours, calculée chaque jour ; aide à choisir quoi corriger d’abord.';
export { EPSS_URL };

// ─── Assemblage et méthode ───

/** Sections de la veille élargie, dans l'ordre du panneau ; `null` (jamais lue) : aucune section (les sources apparaissent en méthode). */
export function cyberWatchSections(w: CyberWatchResponse | null, cyber: CyberResponse | null, now: number, open: OpenFn): { early: FicheSection[]; late: FicheSection[] } {
  if (w === null) return { early: [], late: [] };
  return {
    early: [servicesSection(w, now, open), hacktivistSection(w, now, open), ddosSection(w, now, open)],
    late: [bgpSection(w, now, open), abuseSection(w, now, open), lookalikeSection(w, now, open), euvdSection(w, cyber, now, open), cnilSection(w, now, open)],
  };
}

/** Lignes de la section Méthode et sources pour les sources de la veille élargie. */
export function cyberWatchMethodRows(w: CyberWatchResponse | null, now: number): string {
  const state = (iso: string | null | undefined): string => (w === null ? 'chargement…' : iso ? `lu ${atText(iso, now)}` : 'source indisponible');
  return kvRow('Attaques DDoS, routage', `${sourceLinkHtml('Cloudflare Radar', RADAR_URL)} · ${escapeHtml(`CC BY-NC 4.0 · ${state(w?.radar?.readAt)}`)}`)
    + kvRow('Cibles hacktivistes', `${sourceLinkHtml('witha.name', WITHA_URL)} · ${escapeHtml(state(w?.ddosia?.readAt))}`)
    + kvRow('Serveurs malveillants', `${sourceLinkHtml('abuse.ch', URLHAUS_URL)} · ${escapeHtml(`CC0 · ${state(w?.abuse?.readAt)}`)}`)
    + kvRow('Domaines imitateurs', `${sourceLinkHtml('whoisds', WHOISDS_URL)} · ${escapeHtml(state(w?.lookalikes?.readAt))}`)
    + kvRow('Probabilité d’exploitation', `${sourceLinkHtml('EPSS (FIRST)', EPSS_URL)} · ${escapeHtml(state(w?.epss?.readAt))}`)
    + kvRow('Base européenne', `${sourceLinkHtml('EUVD (ENISA)', EUVD_URL)} · ${escapeHtml(state(w?.euvd?.readAt))}`)
    + kvRow('Violations notifiées', `${sourceLinkHtml('CNIL', CNIL_URL)} · ${escapeHtml(`Licence ouverte · ${state(w?.cnil?.readAt)}`)}`)
    + kvRow('Services publics', escapeHtml(`sondes de France Monitor · ${state(w?.services?.readAt)}`))
    + note('Veille élargie : informations d’appui, hors de la pastille et de l’indice de stabilité.')
    + (w !== null && w.errors.length > 0 ? note(`Erreurs : ${w.errors.join(' ; ')}`) : '');
}
