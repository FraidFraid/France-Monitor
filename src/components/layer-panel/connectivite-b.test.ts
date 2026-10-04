// src/components/layer-panel/connectivite-b.test.ts : panneau Connectivité, phase B (spec 2026-10-04 souveraineté § 3.3 ; contrats
// § 4.1, arbitrage 31, S8) : gros chiffre des grands réseaux vus par au moins 99 % des routeurs témoins RIPE, pastille au plus haut des
// câbles et des réseaux, barres par réseau, réseaux non lus en gris, courbe de 30 jours, série interrompue, règle de baisse des
// préfixes (note sans couleur), points d'échange sans état en direct ; R1, échappement, aucun tiret cadratin.
import { describe, expect, it } from 'vitest';
import type { ConnectivityResponse, NetworkVisibility, PrefixSample } from '../../types/index.ts';
import { connectivityLevel } from '../../services/sovereignty-levels.ts';
import { CABLES_FILE_FIXTURE, CABLES_WATCH_FIXTURE, CONNECTIVITY_FIXTURE, SOV_FIXTURE_NOW } from './sovereignty.fixture.ts';
import { buildConnectiviteView, type ConnectiviteViewInput } from './connectivite.ts';
import { connectiviteMethodB, echangesSection, prefixTrend, reseauxSection } from './connectivite-b.ts';
import { breakableValue, visibleText } from './format.ts';
import { renderLayerView } from './frame.ts';
import { glueSovUnits, sovBreakable } from './sovereignty-format.ts';

const NOW = SOV_FIXTURE_NOW;
const NBSP = '\u00A0';
const DAY = 86_400_000;

function input(over: Partial<ConnectiviteViewInput> = {}): ConnectiviteViewInput {
  return {
    watch: CABLES_WATCH_FIXTURE(), watchError: null, file: CABLES_FILE_FIXTURE(), fileError: null, connectivity: CONNECTIVITY_FIXTURE(),
    connectivityError: null, canFocus: true, now: NOW, open: (_id: string, byDefault: boolean) => byDefault, ...over,
  };
}
function withNetwork(asn: NetworkVisibility['asn'], v4Seeing: number): ConnectivityResponse {
  const c = CONNECTIVITY_FIXTURE();
  return { ...c, networks: c.networks.map((n) => (n.asn === asn ? { ...n, v4Seeing, visibilityPct: Math.round((v4Seeing / 325) * 10_000) / 100 } : n)) };
}
const LATE = { ...CONNECTIVITY_FIXTURE(), snapshotAt: '2026-10-04T04:00:00.000Z' };
const html = (i: ConnectiviteViewInput): string => renderLayerView('subseaCables', buildConnectiviteView(i));
const section = (i: ConnectiviteViewInput, id: string) => buildConnectiviteView(i).sections.find((s) => s.id === id);
const text = (i: ConnectiviteViewInput, id: string): string => visibleText(section(i, id)?.html ?? '');

/** Échantillons de préfixes sur `days` jours (un toutes les 8 h), valeurs données par `value(asn)`. */
function prefixSamples(days: number, value: number): PrefixSample[] {
  const out: PrefixSample[] = [];
  for (let t = Date.parse('2026-10-04T08:00:00.000Z') - days * DAY; t < Date.parse('2026-10-04T08:00:00.000Z'); t += DAY / 3) {
    out.push({ at: new Date(t).toISOString(), prefixes: { 3215: value, 15557: 159, 5410: 22, 12322: 1065, 2200: 79, 16276: 752 } });
  }
  return out;
}
function withPrefixes(samples: PrefixSample[], orange: number): ConnectivityResponse {
  const c = CONNECTIVITY_FIXTURE();
  return {
    ...c,
    networks: c.networks.map((n) => (n.asn === 3215 ? { ...n, v4Prefixes: orange - n.v6Prefixes } : n)),
    history: { ...c.history, prefixSamples: [...samples, { at: c.snapshotAt ?? '', prefixes: { 3215: orange, 15557: 159, 5410: 22, 12322: 1065, 2200: 79, 16276: 752 } }] },
  };
}

describe('tête : grands réseaux', () => {
  it('04/10 : 6 / 6 vus par au moins 99 % des routeurs témoins à l’instantané RIPE de 10:00, vert ; pastille au plus haut des câbles et des réseaux', () => {
    const view = buildConnectiviteView(input());
    expect(view.head.figure).toMatchObject({
      value: `6${NBSP}/${NBSP}6`, caption: `grands réseaux français vus par au moins 99${NBSP}% des routeurs témoins RIPE · instantané RIPE de 10:00`, level: 'vert',
    });
    const verdict = connectivityLevel(CABLES_WATCH_FIXTURE(), CONNECTIVITY_FIXTURE(), NOW);
    expect(view.head.level).toBe(verdict.level);
    expect(view.head.status[0]).toBe(glueSovUnits(verdict.reason));
    expect(view.head.status[1]).toMatch(/^AIS\u00A0\d\d:\d\d · câbles du \d\d\/\d\d$/);
    expect(visibleText(html(input()))).not.toContain('pleinement');
  });
  it('Free sous 90 % : 5 / 6, orange ; RENATER sous 50 % : rouge', () => {
    const free = buildConnectiviteView(input({ connectivity: withNetwork(12322, 276) }));
    expect([free.head.figure?.value, free.head.figure?.level, free.head.level]).toEqual([`5${NBSP}/${NBSP}6`, 'orange', 'orange']);
    expect(free.head.status.join(' ')).toContain(`Free sous 90${NBSP}% de visibilité (84,9${NBSP}%)`);
    const renater = buildConnectiviteView(input({ connectivity: withNetwork(2200, 130) }));
    expect([renater.head.figure?.level, renater.head.level]).toEqual(['rouge', 'rouge']);
  });
  it('instantané de plus de 10 h : « (en retard) », sans couleur ; lignes grises, ni barre ni courbe ; dit à côté de la raison de la pastille', () => {
    const i = input({ connectivity: LATE });
    const late = buildConnectiviteView(i);
    expect(late.head.figure?.caption).toContain('(en retard)');
    expect(late.head.figure?.level).toBeNull();
    expect(late.head.level).toBe('vert');
    expect(late.head.status[0]).toContain('instantané RIPEstat en retard (06:00)');
    expect(late.head.status[0]).toContain('aucun navire lent');
    const h = section(i, 'reseaux')?.html ?? '';
    expect(h).not.toContain('lp-bar-row');
    expect(h).not.toContain('<svg');
    expect(h).not.toMatch(/fmk-dot--(?:vert|jaune|orange|rouge)/);
    expect(h).toContain('data-network="3215"');
    expect(section(i, 'reseaux')?.summary).toContain('(en retard)');
  });
  it('RIPEstat en panne : n.d., panne nommée, pastille des câbles ; pas encore chargé : chargement, jamais « indisponible »', () => {
    const down = input({ connectivity: { ...CONNECTIVITY_FIXTURE(), snapshotAt: null, networks: [], errors: ['RIPEstat, AS3215 : HTTP 503'] } });
    expect(buildConnectiviteView(down).head.figure?.value).toBe('n.d.');
    expect(text(down, 'reseaux')).toContain('Source indisponible : RIPEstat : RIPEstat, AS3215 : HTTP 503.');
    expect(buildConnectiviteView(down).head.level).toBe('vert');
    expect(buildConnectiviteView(down).head.status[0]).toContain('RIPEstat indisponible');
    const loading = buildConnectiviteView(input({ connectivity: null }));
    expect(loading.head.figure?.caption).toContain('chargement');
    expect(loading.head.figure?.caption).not.toContain('indisponible');
    expect(loading.head.status.join(' ')).not.toContain('indisponible');
    expect(section(input({ connectivity: null }), 'reseaux')?.summary).toBe('chargement…');
    expect(section(input({ connectivity: null }), 'echanges')?.summary).toBe('chargement…');
  });
  it('lecture de RIPEstat refusée par le client : n.d. avec la panne nommée', () => {
    const i = input({ connectivity: null, connectivityError: 'HTTP 502' });
    expect(buildConnectiviteView(i).head.figure?.caption).toContain('RIPEstat indisponible');
    expect(text(i, 'reseaux')).toContain('Source indisponible : RIPEstat (HTTP 502).');
  });
  it('veille des câbles en retard (AIS) : la pastille ne suit plus les câbles, seulement les réseaux', () => {
    const i = input({ watch: { ...CABLES_WATCH_FIXTURE(), aisLastMessageAt: '2026-10-04T14:00:00.000Z' }, connectivity: withNetwork(12322, 276) });
    const v = buildConnectiviteView(i);
    expect(v.head.level).toBe('orange');
    expect(v.head.status[0]).toContain('niveau des câbles suspendu');
  });
  it('le compte des navires lents passe dans sa section, avec la couleur de la pastille de la phase A', () => {
    const t = visibleText(html(input()));
    expect(t).toContain('Navires lents sur un tracé');
    expect(section(input(), 'navires')?.html).toContain('lp-lvl lp-lvl--vert">0<');
  });
});

describe('sections', () => {
  it('réseaux en tête (ouverte), points d’échange juste avant la méthode (repliée)', () => {
    const ids = buildConnectiviteView(input()).sections.map((s) => s.id);
    expect(ids[0]).toBe('reseaux');
    expect(ids.indexOf('echanges')).toBe(ids.indexOf('methode') - 1);
    expect([section(input(), 'reseaux')?.open, section(input(), 'echanges')?.open]).toEqual([true, false]);
  });
  it('une barre par réseau ; Free 323 routeurs sur 325, 99,4 % ; quatre réseaux à 100 % ; préfixes annoncés', () => {
    const h = section(input(), 'reseaux')?.html ?? '';
    expect([...h.matchAll(/data-network="(\d+)"/g)].map((m) => m[1])).toEqual(['3215', '15557', '5410', '12322', '2200', '16276']);
    expect([...h.matchAll(/lp-bar-row/g)]).toHaveLength(6);
    const t = visibleText(h);
    expect(t).toContain(`Free (AS12322)323${NBSP}/${NBSP}325`);
    expect(t).toContain(`visibilité 99,4${NBSP}%`);
    expect([...t.matchAll(/visibilité 100\u00A0%/g)]).toHaveLength(4);
    expect(t).toContain(`968${NBSP}préfixes annoncés (923 IPv4, 45 IPv6)`);
    expect(section(input(), 'reseaux')?.summary).toBe(`6${NBSP}/${NBSP}6 vus à au moins 99${NBSP}% · instantané de 10:00`);
  });
  it('réseau non lu : ligne grise nommée avec sa panne, jamais une barre à 0 ; « lecture en cours » sans panne ; le gros chiffre ne le compte pas', () => {
    const c = CONNECTIVITY_FIXTURE();
    const partial: ConnectivityResponse = {
      ...c, networks: c.networks.filter((n) => n.asn !== 15557 && n.asn !== 5410),
      unread: [{ asn: 15557, name: 'SFR', error: 'RIPEstat, AS15557 : HTTP 503' }, { asn: 5410, name: 'Bouygues Telecom', error: null }],
    };
    const i = input({ connectivity: partial });
    const h = section(i, 'reseaux')?.html ?? '';
    expect([...h.matchAll(/data-network="(\d+)"/g)].map((m) => m[1])).toEqual(['3215', '15557', '5410', '12322', '2200', '16276']);
    expect([...h.matchAll(/lp-bar-row/g)]).toHaveLength(4);
    const t = visibleText(h);
    expect(t).toContain('SFR (AS15557)');
    expect(t).toContain('non lu · RIPEstat, AS15557 : HTTP 503');
    expect(t).toContain('non lu · lecture en cours');
    const sfr = h.match(/<div class="lp-row" data-network="15557">[^]*?<\/div>/)?.[0] ?? '';
    expect(sfr).toContain('fmk-dot"');
    expect(sfr).not.toContain('<i style');
    const fig = buildConnectiviteView(i).head.figure;
    expect(fig?.value).toBe(`4${NBSP}/${NBSP}6`);
    expect(fig?.caption).toContain(`2${NBSP}non lus`);
    expect(section(i, 'reseaux')?.summary).toContain(`2${NBSP}non lus`);
    expect(t).not.toContain('Incidents de lecture');
  });
  it('courbe de la visibilité minimale sur 30 jours, référence en construction depuis 7 jours', () => {
    const h = section(input(), 'reseaux')?.html ?? '';
    expect(h).toContain('aria-label="Visibilité minimale des six grands réseaux, par instantané RIPE, sur 30 jours"');
    expect(h).toContain('stroke="var(--sev-green)"');
    expect(visibleText(h)).toContain(`Courbe : référence en construction (7${NBSP}jours).`);
    expect(visibleText(h)).not.toContain('Série interrompue');
  });
  it('série interrompue : dernier échantillon de plus de 9 h, dite avec la date, jamais une courbe d’air normal', () => {
    const c = CONNECTIVITY_FIXTURE();
    const stale = { ...c, history: { ...c.history, samples: c.history.samples.filter((s) => s.at < '2026-10-03T00:00:00.000Z') } };
    const t = text(input({ connectivity: stale }), 'reseaux');
    expect(t).toContain('Série interrompue depuis le 02/10 à 18:00');
    const none = text(input({ connectivity: { ...c, history: { ...c.history, samples: [] } } }), 'reseaux');
    expect(none).toContain('Courbe : historique n.d.');
    expect(text(input({ connectivity: { ...LATE, history: stale.history } }), 'reseaux')).toContain('Série interrompue depuis le 02/10 à 18:00');
  });
  it('points d’échange : 27, ville, lien vers la fiche, date de mise à jour ; annuaire sans état en direct', () => {
    const s = section(input(), 'echanges');
    expect(s?.summary).toBe('27 en France (PeeringDB)');
    expect([...(s?.html ?? '').matchAll(/data-exchange="/g)]).toHaveLength(27);
    expect(s?.html).toContain('href="https://www.peeringdb.com/ix/34"');
    const t = visibleText(s?.html ?? '');
    expect(t).toContain('SFINX');
    expect(t).toContain('mise à jour le 23/07/2021');
    expect(t).toContain('sans état en direct');
  });
  it('points d’échange : annuaire absent, panne nommée', () => {
    const t = text(input({ connectivity: { ...CONNECTIVITY_FIXTURE(), exchanges: null, errors: ['PeeringDB : HTTP 503'] } }), 'echanges');
    expect(t).toContain('Source indisponible : annuaire PeeringDB : PeeringDB : HTTP 503.');
  });
  it('méthode : RIPEstat et PeeringDB, au moins 99 %, règle des préfixes, hors score', () => {
    const t = text(input(), 'methode');
    for (const x of ['RIPEstat', 'PeeringDB', `au moins 99${NBSP}%`, 'Hors score', `10${NBSP}% ou plus sous la médiane`]) expect(t).toContain(x);
  });
});

describe('règle de baisse des préfixes annoncés (S8)', () => {
  const at = (v: ConnectivityResponse) => prefixTrend(v.history.prefixSamples, 3215, 968, NOW, v.snapshotAt);
  it('moins de 7 jours d’échantillons : référence en construction, aucune note de baisse', () => {
    const c = withPrefixes(prefixSamples(5, 1000), 800);
    expect(prefixTrend(c.history.prefixSamples, 3215, 800, NOW, c.snapshotAt)).toEqual({ kind: 'building', days: 5 });
    const t = text(input({ connectivity: c }), 'reseaux');
    expect(t).not.toContain('baisse des préfixes');
    expect(t).toContain(`Préfixes annoncés : référence en construction (5${NBSP}jours)`);
    expect(at(CONNECTIVITY_FIXTURE())).toEqual({ kind: 'building', days: 0 });
    expect(prefixTrend(undefined, 3215, 968, NOW, null)).toEqual({ kind: 'building', days: 0 });
  });
  it('baisse de 10 % ou plus sous la médiane de 30 jours : note « à vérifier (−N %) » sur la ligne, aucune couleur ni pastille', () => {
    const c = withPrefixes(prefixSamples(10, 1000), 800);
    expect(prefixTrend(c.history.prefixSamples, 3215, 800, NOW, c.snapshotAt)).toEqual({ kind: 'drop', pct: 20 });
    const i = input({ connectivity: c });
    const t = text(i, 'reseaux');
    expect(t).toContain(`baisse des préfixes annoncés à vérifier (\u221220${NBSP}%)`);
    const row = (section(i, 'reseaux')?.html ?? '').match(/<div class="lp-bar-row" data-network="3215">[^]*?<\/div>/)?.[0] ?? '';
    expect(row).toContain('fmk-dot--vert');
    expect(buildConnectiviteView(i).head.level).toBe(buildConnectiviteView(input()).head.level);
    expect(buildConnectiviteView(i).head.figure?.level).toBe('vert');
  });
  it('baisse de moins de 10 % ou hausse : rien ; médiane (une valeur aberrante isolée ne la déplace pas)', () => {
    const base = prefixSamples(10, 1000);
    expect(prefixTrend(base, 3215, 920, NOW, null)).toEqual({ kind: 'steady' });
    expect(prefixTrend(base, 3215, 1500, NOW, null)).toEqual({ kind: 'steady' });
    const spiky = base.map((s, i) => (i === 3 ? { ...s, prefixes: { ...s.prefixes, 3215: 100 } } : s));
    expect(prefixTrend(spiky, 3215, 950, NOW, null)).toEqual({ kind: 'steady' });
    expect(prefixTrend(base, 3215, 899, NOW, null)).toMatchObject({ kind: 'drop' });
  });
  it('instantané en retard : pas de note de baisse (donnée suspendue)', () => {
    const c = { ...withPrefixes(prefixSamples(10, 1000), 800), snapshotAt: '2026-10-04T04:00:00.000Z' };
    expect(text(input({ connectivity: c }), 'reseaux')).not.toContain('baisse des préfixes annoncés à vérifier');
  });
  it('courbes des préfixes par réseau (repliées) dès deux échantillons', () => {
    const h = section(input({ connectivity: withPrefixes(prefixSamples(10, 1000), 1000) }), 'reseaux')?.html ?? '';
    expect(h).toContain('<details class="lp-more">');
    expect(h).toContain('aria-label="Préfixes annoncés par Orange (AS3215), sur 30 jours"');
    expect(section(input(), 'reseaux')?.html).not.toContain('Courbes des préfixes');
  });
});

describe('contrôles transverses', () => {
  it('R1 sur les parties de la phase B ; aucun tiret cadratin ; textes tiers échappés', () => {
    const c = CONNECTIVITY_FIXTURE();
    const i = input({
      connectivity: {
        ...c, errors: ['PeeringDB : HTTP 503 <img src=x>', 'RIPEstat, AS1 : <script>x</script>'],
        networks: c.networks.map((n) => (n.asn === 3215 ? { ...n, name: 'Orange <b>x</b>' } : n)),
        unread: [], exchanges: c.exchanges && { ...c.exchanges, items: c.exchanges.items.map((x, k) => (k === 0 ? { ...x, name: '<img src=y>', city: '<i>z</i>' } : x)) },
      },
    });
    const partB = [reseauxSection(i), echangesSection(i)].map((s) => `${s.summary ?? ''}${s.html}`).join('') + connectiviteMethodB()
      + (buildConnectiviteView(i).head.figure?.caption ?? '');
    expect(sovBreakable(visibleText(partB))).toBeNull();
    expect(breakableValue(visibleText(partB))).toBeNull();
    const h = html(i);
    expect(h).not.toContain('\u2014');
    for (const bad of ['<img src=x>', '<img src=y>', '<script>', '<b>x</b>', '<i>z</i>']) expect(h).not.toContain(bad);
    expect(visibleText(h).toLowerCase()).not.toContain('temps réel');
    expect(visibleText(html(input({ connectivity: LATE })))).not.toContain('\u2014');
  });
});
