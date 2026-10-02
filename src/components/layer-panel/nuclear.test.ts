// src/components/layer-panel/nuclear.test.ts
import { describe, expect, it } from 'vitest';
import type { EcowattResponse, NuclearRemitSignal, NuclearState, NuclearUnavailability } from '../../types/index.ts';
import { NUCLEAR_UNITS } from '../../config/infrastructure.ts';
import { buildNuclearView, kindLevel, kindWord } from './nuclear.ts';
import { renderLayerView } from './frame.ts';
import { formatGw } from './grid.ts';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-02T05:00:00Z');
const open = (_: string, d: boolean): boolean => d;
const ref = NUCLEAR_UNITS[0];
const u = (over: Partial<NuclearUnavailability> = {}): NuclearUnavailability => ({
  id: 'a', plantName: ref.plantName, unitName: ref.unitName, nominalPowerMW: ref.nominalPowerMW, availablePowerMW: 0,
  status: 'OUTAGE_UNPLANNED', startDate: new Date(NOW - 2 * DAY), endDate: new Date(NOW + 3 * DAY), type: 'UNPLANNED',
  updatedAt: new Date(NOW - 3600_000), ...over,
});
function state(over: Partial<NuclearState> = {}): NuclearState {
  return {
    unavailabilities: [u()], remitSignals: [], unconfirmedSignals: [], stress: null,
    rteAvailable: true, remitAvailable: true, remitStatus: 'ok', fetchedAt: new Date(NOW - 10 * 60_000), ...over,
  };
}
const view = (s: NuclearState | null, tab: 'overview' | 'calendar' | 'remit' = 'overview') =>
  buildNuclearView({ state: s, ecowatt: null, tab, now: NOW, open });

describe('vue Parc nucléaire', () => {
  it('mots et niveaux de nature', () => {
    expect(kindWord('fortuit')).toBe('fortuit');
    expect(kindWord('reduit')).toBe('puissance réduite');
    expect(kindWord('programme')).toBe('programmé');
    expect([kindLevel('fortuit'), kindLevel('reduit'), kindLevel('programme')]).toEqual(['orange', 'jaune', null]);
  });
  it('en-tête : GW disponibles, niveau des fortuits, compte des arrêts, heure RTE', () => {
    const v = view(state());
    expect(v.head.title).toBe('Parc nucléaire');
    expect(v.head.figure?.caption).toMatch(/^GW disponibles sur \d+,\d GW · \d+ %$/);
    expect(v.head.level).toBe(ref.nominalPowerMW >= 1000 ? 'jaune' : 'vert');
    expect(v.head.status[0]).toMatch(/^1 arrêt fortuit \(\d+,\d GW\)$/);
    expect(v.head.status).toContain('aucun arrêt programmé');
    expect(v.head.status[v.head.status.length - 1]).toBe('RTE lu à 06:50');
  });
  it('onglets : Vue d’ensemble, Calendrier, Signaux REMIT avec compteur', () => {
    const v = view(state({ unconfirmedSignals: [{ remitSignal: {
      id: 'r', plantName: 'Blayais', unitName: null, classifiedAs: 'UNPLANNED_OUTAGE', capacityMW: 900,
      publishedAt: new Date(NOW - 3600_000), title: 'Blayais 3', link: 'https://example.org/r', confirmedByRTE: false, matchConfidence: 0.85,
    }, reason: 'x', confidence: 0.85 }] }));
    expect(v.tabs?.map((t) => [t.id, t.label, t.count ?? null])).toEqual([
      ['overview', 'Vue d’ensemble', null], ['calendar', 'Calendrier', null], ['remit', 'Signaux REMIT', 1],
    ]);
  });
  it('vue d’ensemble : production, arrêts en cours avec retour prévu, sites, méthode', () => {
    const v = view(state());
    expect(v.sections.map((s) => s.id)).toEqual(['production', 'outages', 'sites', 'method']);
    const h = renderLayerView('nuclearFleet', v);
    expect(h).toMatch(/fortuit[^]*retour prévu le \d\d\/\d\d à \d\d:\d\d/);
    expect(h).toContain('fmk-dot--orange');
    expect(h).toContain('vert sous 1 GW');
  });
  it('arrêt sans fin connue : « fin non communiquée »', () => {
    expect(renderLayerView('nuclearFleet', view(state({ unavailabilities: [u({ endDate: null })] })))).toContain('fin non communiquée');
  });
  it('RTE injoignable : pas de pastille, n.d., message', () => {
    const v = view(state({ rteAvailable: false, unavailabilities: [] }));
    expect(v.head.level).toBeNull();
    expect(v.head.figure?.value).toBe('n.d.');
    expect(v.head.status[0]).toBe('Données RTE indisponibles');
  });
  it('Flamanville 3 fait partie du parc', () => {
    expect(NUCLEAR_UNITS.some((r) => r.unitName === 'FLAMANVILLE 3')).toBe(true);
  });
  it('heure RTE : celle de la lecture serveur, « (en retard) » au-delà de 30 min', () => {
    const fresh = view(state({ rteFetchedAt: new Date(NOW - 5 * 60_000), fetchedAt: new Date(NOW) }));
    expect(fresh.head.status[fresh.head.status.length - 1]).toBe('RTE lu à 06:55');
    const late = view(state({ rteFetchedAt: new Date(NOW - 45 * 60_000), fetchedAt: new Date(NOW) }));
    expect(late.head.status[late.head.status.length - 1]).toBe('RTE lu à 06:15 (en retard)');
  });
  it('REMIT : « lu à » est l\'heure IIP, pas celle de la construction de l\'état', () => {
    const h = renderLayerView('nuclearFleet', view(state({ remitFetchedAt: new Date(NOW - 20 * 60_000), fetchedAt: new Date(NOW) }), 'remit'));
    expect(h).toContain('Flux REMIT lu à 06:40.');
  });
  it('en-tête : arrêts programmés et puissance réduite comptés séparément', () => {
    const [a, b, c] = NUCLEAR_UNITS;
    const v = view(state({ unavailabilities: [
      u({ id: '1', unitName: a.unitName, plantName: a.plantName, type: 'PLANNED', status: 'OUTAGE_PLANNED' }),
      u({ id: '2', unitName: b.unitName, plantName: b.plantName, type: 'PLANNED', status: 'REDUCED', availablePowerMW: 300 }),
      u({ id: '3', unitName: c.unitName, plantName: c.plantName, type: 'PLANNED', status: 'OUTAGE_PLANNED' }),
    ] }));
    expect(v.head.status).toContain('2 arrêts programmés');
    expect(v.head.status).toContain('1 en puissance réduite');
  });
  it('RTE injoignable : la production et la méthode restent affichées, disponible n.d.', () => {
    const v = view(state({ rteAvailable: false, unavailabilities: [] }));
    expect(v.sections.map((s) => s.id)).toEqual(['production', 'method']);
    const h = renderLayerView('nuclearFleet', v);
    expect(h).toContain('Source injoignable');
    expect(h).toMatch(/Disponible[^]*?n\.d\./);
    expect(h).toContain('Installé');
  });
  it('calendrier : une ligne par tranche, libellé complet en infobulle, libellés courts bornés', () => {
    const [a, b] = NUCLEAR_UNITS;
    const long = NUCLEAR_UNITS.find((r) => r.plantName === 'Saint-Laurent-des-Eaux') ?? b;
    const h = renderLayerView('nuclearFleet', view(state({ unavailabilities: [
      u({ id: '1', unitName: a.unitName, plantName: a.plantName }),
      u({ id: '2', unitName: a.unitName, plantName: a.plantName, startDate: new Date(NOW + 5 * DAY), endDate: new Date(NOW + 6 * DAY), type: 'PLANNED', status: 'OUTAGE_PLANNED' }),
      u({ id: '3', unitName: long.unitName, plantName: long.plantName }),
    ] }), 'calendar'));
    expect(h.match(/<g><title>/g)).toHaveLength(2);
    expect(h).toContain(`<title>${long.plantName} ${/(\d+)$/.exec(long.unitName)?.[1]}</title>`);
    const labels = [...h.matchAll(/<text x="0"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
    expect(labels).toContain('St-Laurent 1');
    expect(labels.every((l) => l.length <= 14)).toBe(true);
  });
  it('retours et arrêts à venir : 8 lignes puis « n autres »', () => {
    const units = NUCLEAR_UNITS.slice(0, 11);
    const list = units.map((r, i) => u({ id: `x${i}`, unitName: r.unitName, plantName: r.plantName, endDate: new Date(NOW + (i + 1) * 3600_000) }));
    const h = renderLayerView('nuclearFleet', view(state({ unavailabilities: list }), 'calendar'));
    expect(h).toContain('3 autres');
  });
  it('calendrier : diagramme accessible, retours, vide dit', () => {
    const h = renderLayerView('nuclearFleet', view(state(), 'calendar'));
    expect(h).toContain('role="img"');
    expect(h).toContain('Retours prévus');
    expect(renderLayerView('nuclearFleet', view(state({ unavailabilities: [] }), 'calendar'))).toContain('Aucune indisponibilité sur la période.');
  });
  it('REMIT : lien sûr seulement, titre échappé, états du flux en phrases', () => {
    const sig = (link: string, title: string) => ({ remitSignal: {
      id: 'r', plantName: 'Blayais', unitName: null, classifiedAs: 'UNPLANNED_OUTAGE' as const, capacityMW: null,
      publishedAt: new Date(NOW - 3600_000), title, link, confirmedByRTE: false, matchConfidence: 0.6,
    }, reason: 'x', confidence: 0.6 });
    const h = renderLayerView('nuclearFleet', view(state({ unconfirmedSignals: [sig('javascript:alert(1)', '<img src=x onerror=1>')] }), 'remit'));
    expect(h).not.toContain('javascript:');
    expect(h).not.toContain('<img');
    expect(h).toContain('correspondance incertaine');
    expect(h).toContain('n.d.');
    expect(renderLayerView('nuclearFleet', view(state({ remitStatus: 'unavailable', remitAvailable: false }), 'remit')))
      .toContain('Flux REMIT injoignable');
  });
  it('aucun code anglais, aucun tiret cadratin', () => {
    const all = (['overview', 'calendar', 'remit'] as const).map((t) => renderLayerView('nuclearFleet', view(state({
      stress: { installedCapacityMW: 61000, availableCapacityMW: 20000, stressRatio: 0.67, level: 'CRITIQUE', gridTensionRisk: true, updatedAt: new Date(NOW), freshness: 'quasi-realtime' },
    }), t))).join('');
    expect(all).not.toMatch(/GRID_TENSION_RISK|UNPLANNED|OUTAGE|STATUS|TIMELINE|—|&mdash;|monospace/);
    expect(all).toContain('Le nucléaire fournit moins de 35 % de la production nationale.');
  });
  it('sans état : chargement', () => {
    expect(view(null).bodyHtml).toContain('Chargement des données…');
  });

  describe('texte hostile affiché', () => {
    const hostile = '<img src=x onerror=1>';
    const remit = (over: Partial<NuclearRemitSignal> = {}): NuclearRemitSignal => ({
      id: 'r', plantName: hostile, unitName: null, classifiedAs: 'UNPLANNED_OUTAGE', capacityMW: 900,
      publishedAt: new Date(NOW - 3600_000), title: 't', link: 'https://example.org/r', confirmedByRTE: false, matchConfidence: 0.6, ...over,
    });
    it('signal en attente : nom de site échappé', () => {
      const h = renderLayerView('nuclearFleet', view(state({ unconfirmedSignals: [{ remitSignal: remit(), reason: 'x', confidence: 0.6 }] }), 'remit'));
      expect(h).toContain('&lt;img');
      expect(h).not.toContain('<img');
    });
    it('signal confirmé : nom de site échappé', () => {
      const h = renderLayerView('nuclearFleet', view(state({ remitSignals: [remit({ confirmedByRTE: true })] }), 'remit'));
      expect(h).toContain('&lt;img');
      expect(h).not.toContain('<img');
    });
  });

  describe('production réelle (Écowatt)', () => {
    const installed = NUCLEAR_UNITS.reduce((s, r) => s + r.nominalPowerMW, 0);
    const mixOf = (nuclear: number | null) => ({ nuclear, hydro: 0, wind: 0, solar: 0, thermal: 0, bio: 0 });
    const eco = (gridNuclear: number | null | 'nogrid', nationalNuclear = 0): EcowattResponse => ({
      official: null, mixes: {}, interconnections: [],
      national: { timestamp: new Date(NOW), nuclear: nationalNuclear, wind: 0, solar: 0, hydro: 0, gas: 0, other: 0, total: nationalNuclear },
      grid: gridNuclear === 'nogrid' ? null : { dataTime: NOW, consumptionMw: null, forecastMw: null, co2gPerKwh: null, netImportMw: null, mix: mixOf(gridNuclear), day: [] },
    });
    const overview = (e: EcowattResponse): string => renderLayerView('nuclearFleet', buildNuclearView({
      state: state({ unavailabilities: [] }), ecowatt: e, tab: 'overview', now: NOW, open }));
    const NOTE = 'Le parc produit en dessous du disponible';

    it('jauges Produit / Disponible / Installé en GW', () => {
      const h = overview(eco(40_000));
      expect(h).toMatch(new RegExp(`Produit[^]*?${formatGw(40_000)}`));
      expect(h).toMatch(new RegExp(`Disponible[^]*?${formatGw(installed)}`));
      expect(h).toMatch(new RegExp(`Installé[^]*?${formatGw(installed)}`));
      expect(h).toContain(`${formatGw(40_000)} · ${Math.round((40_000 / installed) * 100)} % du disponible`);
    });
    it('note de modulation sous 80 % du disponible seulement', () => {
      expect(overview(eco(Math.round(installed * 0.7)))).toContain(NOTE);
      expect(overview(eco(Math.round(installed * 0.9)))).not.toContain(NOTE);
    });
    it('repli sur le national quand grid est null', () => {
      expect(overview(eco('nogrid', 45_000))).toContain(formatGw(45_000));
    });
    it('production 0 : n.d. au résumé, pas de note de modulation', () => {
      const h = overview(eco(0));
      expect(h).toMatch(/Production<[^]*?n\.d\./);
      expect(h).not.toContain(NOTE);
      expect(h).not.toContain('NaN');
    });
  });

  it('signe des puissances REMIT : « + » pour un redémarrage, « − » sinon', () => {
    const sig = (classifiedAs: NuclearRemitSignal['classifiedAs']) => ({ remitSignal: {
      id: classifiedAs, plantName: 'Blayais', unitName: null, classifiedAs, capacityMW: 900,
      publishedAt: new Date(NOW - 3600_000), title: 't', link: 'https://example.org/r', confirmedByRTE: false, matchConfidence: 0.9,
    }, reason: 'x', confidence: 0.9 });
    const h = (c: NuclearRemitSignal['classifiedAs']): string =>
      renderLayerView('nuclearFleet', view(state({ unconfirmedSignals: [sig(c)] }), 'remit'));
    expect(h('RESTART')).toContain('+0,9 GW');
    expect(h('RESTART')).not.toContain('−0,9 GW');
    expect(h('UNPLANNED_OUTAGE')).toContain('−0,9 GW');
    expect(h('PLANNED_MAINTENANCE')).toContain('−0,9 GW');
  });
});
