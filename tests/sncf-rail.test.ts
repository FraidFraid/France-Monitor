import { describe, expect, it } from 'vitest';
import { AXIS_LABELS, EFFECTS, buildRailOverview, disruptionsUrl, stopDelayMin, toRailTrain, trainAxis, trainKind } from '../api/_lib/sncf-rail.js';
import { fixtureJson } from './helpers/traffic-fixtures.ts';

type Disruption = { id: string; status: string; severity: { effect: string }; impacted_objects: Array<{ pt_object: { id: string; trip?: { name: string } }; impacted_stops?: unknown[] }> };
const DISRUPTIONS = fixtureJson<{ disruptions: Disruption[] }>('sncf-disruptions.json').disruptions;
const TRIP = fixtureJson<{ vehicle_journeys: Array<{ stop_times: Array<{ stop_point: { name: string; coord: { lat: string; lon: string } } }> }> }>('sncf-trip-4762.json');
const TRIP_4762 = 'SNCF:2026-10-03:4762:1187:LongDistanceTrain';
const tripStops = new Map([[TRIP_4762, TRIP.vehicle_journeys[0].stop_times.map((s) => ({ name: s.stop_point.name, lat: Number(s.stop_point.coord.lat), lon: Number(s.stop_point.coord.lon), delayMin: null }))]]);
const byNumber = (n: string) => DISRUPTIONS.find((d) => d.impacted_objects[0].pt_object.trip?.name === n);

describe('fonctions pures', () => {
  it('axe par gare terminale : Gare de Lyon, Montparnasse (deux libellés), Bercy ; sinon province', () => {
    expect(trainAxis([{ name: 'Paris - Gare de Lyon - Hall 1 & 2' }, { name: 'Barcelona-Sants' }])).toBe('sud-est');
    expect(trainAxis([{ name: 'Quimper' }, { name: 'Paris-Montparnasse Point Rencontre Groupes' }])).toBe('atlantique');
    expect(trainAxis([{ name: "Paris Bercy Bourgogne - Pays d'Auvergne" }, { name: 'Nevers' }])).toBe('intercites-bercy');
    expect(trainAxis([{ name: 'Paris Austerlitz' }, { name: 'Toulouse Matabiau' }])).toBe('province');
    expect(trainAxis([{ name: 'Paris Estienne' }, { name: 'Lyon' }])).toBe('province');
  });
  it('nature du train, effets exacts (plus jamais « Travaux »)', () => {
    expect([trainKind('SNCF:x:LongDistanceTrain'), trainKind('SNCF:x:Train'), trainKind('SNCF:x:Coach')]).toEqual(['grandes-lignes', 'ter', 'autre']);
    expect(EFFECTS).toEqual({ SIGNIFICANT_DELAYS: 'retard', NO_SERVICE: 'supprime', REDUCED_SERVICE: 'service-reduit', DETOUR: 'detour', MODIFIED_SERVICE: 'modifie', ADDITIONAL_SERVICE: 'ajoute' });
  });
  it('retard d’un arrêt : plus grand écart à l’arrivée ou au départ ; passage de minuit', () => {
    expect(stopDelayMin({ base_arrival_time: '081200', amended_arrival_time: '081700', base_departure_time: '081200', amended_departure_time: '081700' })).toBe(5);
    expect(stopDelayMin({ base_arrival_time: '235500', amended_arrival_time: '001000' })).toBe(15);
    expect(stopDelayMin({})).toBeNull();
  });
  it('perturbations du jour à Paris (since et until), deux pages au plus', () => {
    const u = new URL(disruptionsUrl(Date.parse('2026-10-03T22:30:00Z'), 0));
    expect([u.searchParams.get('since'), u.searchParams.get('until'), u.searchParams.get('depth')]).toEqual(['20261004T000000', '20261004T235959', '2']);
  });
});

describe('trains (perturbations réelles du 03/10/2026, 15 h 10)', () => {
  it('Paris–Barcelone n° 9713 : Sud-Est, +140 min, en cours, date de mise à jour en UTC', () => {
    const t = toRailTrain(byNumber('9713'));
    expect(t).toMatchObject({
      number: '9713', kind: 'grandes-lignes', axis: 'sud-est', region: null, origin: 'Paris - Gare de Lyon - Hall 1 & 2', destination: 'Barcelona-Sants',
      effect: 'retard', delayMin: 140, status: 'en-cours', updatedAt: '2026-10-03T12:25:06.000Z',
    });
    expect(t?.stops[0]).toMatchObject({ name: 'Paris - Gare de Lyon - Hall 1 & 2', delayMin: expect.any(Number) });
  });
  it('train supprimé publié sans arrêt : itinéraire relu, axe déduit, pas de retard', () => {
    expect(toRailTrain(byNumber('4762'), tripStops.get(TRIP_4762))).toMatchObject({
      effect: 'supprime', axis: 'province', origin: 'Marseille Saint-Charles', destination: 'Bordeaux Saint-Jean', delayMin: null,
    });
    expect(toRailTrain(byNumber('4762'))).toMatchObject({ axis: null, origin: '', destination: '' });
  });
  it('TER : région du premier arrêt (polygones des régions) ; perturbation passée écartée', () => {
    expect(toRailTrain(byNumber('871654'))).toMatchObject({ kind: 'ter', region: 'Occitanie', axis: null });
    expect(toRailTrain(byNumber('50'))).toBeNull();
  });
});

describe('agrégats par axe et par région', () => {
  const o = buildRailOverview(DISRUPTIONS, tripStops);
  it('vérification du 03/10 : Sud-Est, 6 trains, +56,7 min en moyenne, +140 au plus', () => {
    expect(o.axes[0]).toEqual({ key: 'sud-est', label: AXIS_LABELS['sud-est'], trains: 6, avgDelayMin: 56.7, maxDelayMin: 140, cancelled: 0, reduced: 0, detour: 0 });
  });
  it('sept axes toujours présents, zéros compris ; province avec le train supprimé n° 4762 et le service modifié n° 9866', () => {
    expect(o.axes.map((a) => [a.key, a.trains])).toEqual([['sud-est', 6], ['atlantique', 2], ['nord', 1], ['est', 1], ['intercites-bercy', 1], ['normandie', 0], ['province', 4]]);
    expect(o.axes[5].avgDelayMin).toBeNull();
    expect(o.axes[6]).toMatchObject({ avgDelayMin: 60, maxDelayMin: 90, cancelled: 1, reduced: 1 });
  });
  it('régions TER : seulement celles qui ont des trains en cours, « Non rattaché » pour le TER supprimé sans itinéraire', () => {
    expect(o.regions.map((r) => [r.label, r.trains])).toEqual([
      ['Île-de-France', 2], ['Bretagne', 1], ['Hauts-de-France', 1], ['Non rattaché', 1], ['Occitanie', 1], ["Provence-Alpes-Côte d'Azur", 1],
    ]);
    expect(o.regions.find((r) => r.key === 'non-rattache')).toMatchObject({ cancelled: 1, avgDelayMin: null });
    expect(o.regions.find((r) => r.label === 'Hauts-de-France')).toMatchObject({ detour: 1, maxDelayMin: 90 });
  });
  it('grandes lignes : 15 en cours, 10 à 15 min ou plus ; en cours avant à venir ; plus gros retards', () => {
    expect(o.longDistance).toEqual({ active: 15, delayed15: 10 });
    expect(o.trains.map((t) => t.status)).toEqual([...Array(24).fill('en-cours'), 'a-venir', 'a-venir']);
    expect(o.topDelays.slice(0, 3).map((t) => [t.number, t.delayMin])).toEqual([['9713', 140], ['6204', 110], ['9866', 90]]);
    expect(o.updatedAt).toBe('2026-10-03T13:09:36.000Z');
  });
});
