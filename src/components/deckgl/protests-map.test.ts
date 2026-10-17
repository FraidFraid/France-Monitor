// src/components/deckgl/protests-map.test.ts : regroupement, couleur, rayon et infobulle de la couche Manifestations.
import { describe, expect, it } from 'vitest';
import type { ProtestItem, ProtestsResponse } from '../../types/index.ts';
import { levelHex } from '../../services/vigilance.ts';
import {
  PROTEST_ANNOUNCED_HEX, PROTEST_LAYERS, groupProtests, protestFeatures, protestLabel, protestRadius,
} from './protests-map.ts';

const ann = (over: Partial<ProtestItem> = {}): ProtestItem => ({
  id: 'd1', source: 'demosphere', status: 'annonce', title: 'Rassemblement', startsAt: '2026-10-17T13:00:00.000Z', allDay: false,
  city: 'Toulouse', dept: '31', lat: 43.6, lon: 1.44, url: null, edition: null, violent: false, participants: null, precision: 'commune', articles: [], articleCount: 0, ...over,
});
const sig = (over: Partial<ProtestItem> = {}): ProtestItem => ann({ id: 'g1', source: 'gdelt', status: 'signale', city: 'Paris', lat: 48.85, lon: 2.35, ...over });
const response = (items: ProtestItem[]): ProtestsResponse => ({
  readAt: '2026-10-17T09:00:00.000Z', items,
  demosphere: { readAt: null, editions: 19, failedEditions: [], scanned: 0 }, gdelt: { readAt: null, files: 0, missingFiles: 0 }, presse: { readAt: null, scanned: 0, matched: 0, unplaced: 0 }, errors: [],
});

describe('groupProtests', () => {
  it('regroupe les items de même position en un seul point', () => {
    const groups = groupProtests([ann({ id: 'a' }), ann({ id: 'b' }), ann({ id: 'c', lat: 45, lon: 4.8, city: 'Lyon' })]);
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.city === 'Toulouse')?.items).toHaveLength(2);
  });
  it('ignore les items sans coordonnées', () => {
    expect(groupProtests([ann({ lat: null, lon: null }), sig({ lat: null, lon: null })])).toEqual([]);
  });
  it('couleur du groupe = statut le plus fort : heurts > signalé > annonce', () => {
    const same = { lat: 48.85, lon: 2.35 };
    expect(groupProtests([ann(same), sig({ ...same })])[0]?.kind).toBe('signale');
    expect(groupProtests([ann(same), sig({ ...same }), sig({ ...same, id: 'g2', violent: true })])[0]?.kind).toBe('heurts');
    expect(groupProtests([ann(same)])[0]?.kind).toBe('annonce');
  });
});

describe('protestFeatures', () => {
  it('une entité par position, coordonnées [lng, lat], couleurs L1 et rose franc pour l’annonce', () => {
    const fc = protestFeatures(response([ann(), sig({ violent: true }), sig({ id: 'g2', lat: 45, lon: 4.8, city: 'Lyon' })]));
    expect(fc.features).toHaveLength(3);
    const byCity = Object.fromEntries(fc.features.map((f) => [String(f.properties?.['label']), f]));
    expect(byCity['Toulouse']?.geometry.coordinates).toEqual([1.44, 43.6]);
    expect(byCity['Toulouse']?.properties?.['color']).toBe(PROTEST_ANNOUNCED_HEX);
    expect(byCity['Paris']?.properties?.['color']).toBe(levelHex('rouge'));
    expect(byCity['Lyon']?.properties?.['color']).toBe(levelHex('orange'));
  });
  it('« Ville · n » quand plusieurs items partagent le point, ville seule sinon', () => {
    expect(protestLabel({ city: 'Toulouse', items: [ann()] })).toBe('Toulouse');
    expect(protestLabel({ city: 'Toulouse', items: [ann(), ann()] })).toBe('Toulouse · 2');
    const fc = protestFeatures(response([ann({ id: 'a' }), ann({ id: 'b' }), ann({ id: 'c' })]));
    expect(fc.features[0]?.properties?.['label']).toBe('Toulouse · 3');
    expect(fc.features[0]?.properties?.['count']).toBe(3);
  });
  it('réponse absente ou sans lieu : aucune entité', () => {
    expect(protestFeatures(null).features).toEqual([]);
    expect(protestFeatures(response([sig({ lat: null, lon: null })])).features).toEqual([]);
  });
  it('le rayon croît avec le nombre mais reste plafonné', () => {
    expect(protestRadius(1)).toBeLessThan(protestRadius(4));
    expect(protestRadius(1000)).toBe(16);
  });
  it('texte tiers échappé dans l’infobulle, aucun tiret cadratin', () => {
    const fc = protestFeatures(response([ann({ title: '<img src=x onerror=alert(1)>', city: '<b>Ville</b>' })]));
    const html = String(fc.features[0]?.properties?.['body']);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>Ville</b>');
    expect(html).toContain('&lt;img');
    expect(html).not.toContain(String.fromCharCode(0x2014));
  });
});

describe('couches MapLibre', () => {
  it('deux couches masquées au départ (ronds puis étiquettes)', () => {
    expect(PROTEST_LAYERS.map((l) => l.type)).toEqual(['circle', 'symbol']);
    expect(PROTEST_LAYERS.every((l) => l.layout?.visibility === 'none')).toBe(true);
  });
});
