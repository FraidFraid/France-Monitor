// src/components/layer-panel/webcams.test.ts : panneau, légende et carte de la couche Webcams : fiche, lien sûr (nouvel onglet, sans
// référent), vignette réservée aux images countable (jamais d'iframe), couleurs par état, échappement.
import { describe, expect, it } from 'vitest';
import { CAM, DS } from '../../services/webcams.fixture.ts';
import { WEBCAM_STATUS_HEX } from '../../services/webcams.ts';
import { WEBCAM_LAYERS, WEBCAM_VIDEO_STROKE, webcamFeatures, webcamTipBody } from '../deckgl/webcams-map.ts';
import { buildWebcamsView, thumbnailHtml, webcamFicheHtml } from './webcams.ts';
import { WEBCAMS_LEGEND, webcamsLegend } from './webcams-legend.ts';

const open = (_id: string, byDefault: boolean): boolean => byDefault;
const allHtml = (v: ReturnType<typeof buildWebcamsView>): string => v.sections.map((s) => s.html).join('') + (v.bodyHtml ?? '');

describe('fiche de la webcam', () => {
  it('lien « Ouvrir la webcam » en nouvel onglet, sans référent', () => {
    const html = webcamFicheHtml(DS.webcams[1], DS);
    expect(html).toContain('href="https://example.org/cam" target="_blank" rel="noopener noreferrer"');
    expect(html).toContain('Ouvrir la webcam');
    expect(html).toContain('Lien mort');
    expect(html).not.toContain('<img');
  });
  it('vignette paresseuse sans référent seulement si countable ; jamais d’iframe', () => {
    const html = webcamFicheHtml(CAM, DS);
    expect(html).toContain(`<img src="${CAM.imageUrl}"`);
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('referrerpolicy="no-referrer"');
    expect(html).toContain('Licence Ouverte 2.0');
    expect(html).not.toContain('<iframe');
    expect(thumbnailHtml({ ...CAM, countable: false })).toBe('');
    expect(thumbnailHtml({ ...CAM, imageUrl: 'javascript:alert(1)' })).toBe('');
  });
  it('textes du fichier échappés', () => {
    const html = webcamFicheHtml({ ...CAM, name: '<b>x</b>', attribution: '"a" & b' }, DS);
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).not.toContain('<b>x</b>');
  });
});

describe('vue du panneau', () => {
  it('chargement, fichier indisponible, puis comptes et fiche choisie', () => {
    expect(buildWebcamsView({ data: null, error: null, selectedId: null, open }).head.status).toEqual(['chargement…']);
    expect(buildWebcamsView({ data: null, error: 'x', selectedId: null, open }).head.figure?.value).toBe('n.d.');
    const v = buildWebcamsView({ data: DS, error: null, selectedId: CAM.id, open });
    expect(v.head.figure?.value).toBe('50\u00a0%');
    expect(v.head.figure?.caption).toBe('liens actifs · 1 sur 2\u00a0webcams');
    expect(allHtml(v)).toContain('referrerpolicy="no-referrer"');
    const none = buildWebcamsView({ data: DS, error: null, selectedId: null, open });
    expect(allHtml(none)).toContain('Cliquer une webcam sur la carte');
  });
  it('aucun tiret cadratin', () => {
    const v = buildWebcamsView({ data: DS, error: null, selectedId: CAM.id, open });
    expect(allHtml(v)).not.toContain('\u2014');
    expect(JSON.stringify(WEBCAMS_LEGEND)).not.toContain('\u2014');
  });
});

describe('carte et légende', () => {
  it('un point par webcam, couleur de son état, liens actifs dessinés au-dessus', () => {
    const fc = webcamFeatures(DS);
    expect(fc.features).toHaveLength(2);
    expect(fc.features[0].properties?.['color']).toBe(WEBCAM_STATUS_HEX.ok);
    expect(fc.features[1].properties?.['color']).toBe(WEBCAM_STATUS_HEX.down);
    expect(Number(fc.features[0].properties?.['sortKey'])).toBeGreaterThan(Number(fc.features[1].properties?.['sortKey']));
    expect(fc.features[0].geometry.coordinates).toEqual([CAM.lon, CAM.lat]);
    expect(webcamFeatures(null).features).toHaveLength(0);
  });
  it('infobulle : nom, commune, source, état, vérifiée le', () => {
    const tip = webcamTipBody(CAM, DS);
    for (const part of ['La Soie', 'Vaulx-en-Velin (69)', 'Métropole de Lyon', 'Lien actif (HTTP\u00a0200)', '18/10/2026 à 19:00']) expect(tip).toContain(part);
  });
  it('couches masquées au départ ; légende aux couleurs des états, datée', () => {
    for (const l of WEBCAM_LAYERS) expect((l.layout as Record<string, unknown> | undefined)?.['visibility']).toBe('none');
    expect(WEBCAMS_LEGEND.items.map((i) => i.color)).toEqual([WEBCAM_STATUS_HEX.ok, WEBCAM_STATUS_HEX.down, WEBCAM_STATUS_HEX.unknown, WEBCAM_VIDEO_STROKE]);
    expect(webcamsLegend(DS).notes?.[0]).toContain('Liens actifs : 1 sur 2\u00a0webcams');
    expect(webcamsLegend(null).notes?.[0]).toContain('indisponible');
  });
});
