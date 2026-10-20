// src/services/webcam-wall.test.ts : mur de webcams : état gardé (relecture stricte), ajout plafonné, ordre, fenêtre gardée à l'écran,
// rendu (image seulement sous licence ouverte, jamais d'iframe, échappement), boutons du panneau et chiffre en pourcentage.
import { describe, expect, it } from 'vitest';
import { CAM, DS } from './webcams.fixture.ts';
import {
  DEFAULT_WALL, WALL_MAX_TILES, addToWall, clampRect, loadWallState, moveOnWall, parseWallState, refreshedImageUrl, removeFromWall,
  saveWallState, toggleOnWall, wallCandidates, wallColumns, wallTiles, type WallState,
} from './webcam-wall.ts';
import { renderWebcamWall } from '../components/layer-panel/webcam-wall.ts';
import { activeShare, buildWebcamsView, webcamFicheHtml } from '../components/layer-panel/webcams.ts';
import { embedPlayerUrl, webcamCounts, webcamEmbedUrl } from './webcams.ts';

const base = (): WallState => ({ ...DEFAULT_WALL, ids: [] });
const view = (state: WallState, columns = 2): string => renderWebcamWall({ data: DS, state, columns, refreshedMs: 1_700_000_000_000, refreshedLabel: null });

describe('état du mur', () => {
  it('relecture stricte : JSON abîmé, doublons, plafond, disposition inconnue, focus orphelin', () => {
    expect(parseWallState(null)).toEqual(base());
    expect(parseWallState('{oops')).toEqual(base());
    const many = Array.from({ length: 20 }, (_, i) => `c${i}`);
    const s = parseWallState(JSON.stringify({ ids: ['a', 'a', 3, ...many], layout: 7, focusId: 'zz', open: true, rect: { x: 1, y: 2, w: 10, h: 10 } }));
    expect(s.ids).toHaveLength(WALL_MAX_TILES);
    expect(s.ids[0]).toBe('a');
    expect(s.ids.filter((x) => x === 'a')).toHaveLength(1);
    expect(s.layout).toBe(0);
    expect(s.focusId).toBeNull();
    expect(s.open).toBe(true);
    expect(s.rect).toEqual({ x: 1, y: 2, w: 280, h: 200 });
  });
  it('aller-retour par le stockage, stockage en panne toléré', () => {
    const mem = new Map<string, string>();
    const st = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } };
    const s = addToWall(base(), 'x');
    saveWallState(st, s);
    expect(loadWallState(st)).toEqual(s);
    const broken = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    expect(() => saveWallState(broken, s)).not.toThrow();
    expect(loadWallState(broken)).toEqual(base());
  });
  it('ajout (ouvre le mur), pas de doublon, plafond, retrait, bascule, ordre', () => {
    let s = addToWall({ ...base(), minimized: true }, 'a');
    expect(s).toMatchObject({ ids: ['a'], open: true, minimized: false });
    s = addToWall(addToWall(s, 'b'), 'a');
    expect(s.ids).toEqual(['a', 'b']);
    const full = { ...base(), ids: Array.from({ length: WALL_MAX_TILES }, (_, i) => `c${i}`) };
    expect(addToWall(full, 'new')).toBe(full);
    expect(moveOnWall(s, 'b', -1).ids).toEqual(['b', 'a']);
    expect(moveOnWall(s, 'a', -1)).toBe(s);
    expect(removeFromWall({ ...s, focusId: 'a' }, 'a')).toMatchObject({ ids: ['b'], focusId: null });
    expect(toggleOnWall(s, 'b').ids).toEqual(['a']);
    expect(toggleOnWall(s, 'c').ids).toEqual(['a', 'b', 'c']);
  });
  it('fenêtre gardée à l’écran, colonnes automatiques selon la largeur', () => {
    expect(clampRect({ x: -50, y: 5000, w: 5000, h: 50 }, 1200, 800)).toEqual({ x: 0, y: 760, w: 1184, h: 200 });
    // Sous le bandeau de l'application (56 px) : la barre de titre reste attrapable.
    expect(clampRect({ x: 10, y: 20, w: 560, h: 420 }, 1200, 800, 56)).toEqual({ x: 10, y: 56, w: 560, h: 420 });
    expect(wallColumns(0, 1, 2000)).toBe(1);
    expect(wallColumns(0, 6, 560)).toBe(2);
    expect(wallColumns(0, 6, 2000)).toBe(4);
    expect(wallColumns(3, 2, 560)).toBe(2);
    expect(wallColumns(0, 3, 100)).toBe(1);
  });
  it('tuiles : image seulement sous licence ouverte ; candidats = images affichables hors mur', () => {
    const s = { ...base(), ids: [CAM.id, 'osm:node/1', 'disparue'] };
    const t = wallTiles(DS, s);
    expect(t.map((x) => x.imageUrl)).toEqual([CAM.imageUrl, null, null]);
    expect(t[2].webcam).toBeNull();
    expect(wallCandidates(DS, base()).map((w) => w.id)).toEqual([CAM.id]);
    expect(wallCandidates(DS, s)).toEqual([]);
  });
  it('URL rafraîchie sans casser une requête existante', () => {
    expect(refreshedImageUrl('https://a/x.jpg', 61_000)).toBe('https://a/x.jpg?fm_t=61');
    expect(refreshedImageUrl('https://a/x?y=1', 61_000)).toBe('https://a/x?y=1&fm_t=61');
  });
});

describe('rendu du mur', () => {
  it('images sous licence ouverte sans référent, lien seulement sinon, jamais d’iframe', () => {
    const html = view({ ...base(), ids: [CAM.id, 'osm:node/1'], open: true });
    expect(html).toContain(`<img src="${CAM.imageUrl}?fm_t=1700000000"`);
    expect(html).toContain('referrerpolicy="no-referrer"');
    expect(html).toContain('Pas d’image affichable ici');
    expect(html).toContain('href="https://example.org/cam" target="_blank" rel="noopener noreferrer"');
    expect(html).not.toContain('<iframe');
    expect(html).toContain('--wcw-cols:2');
    expect(html).toContain('Licence Ouverte 2.0');
  });
  it('vide, replié, agrandi', () => {
    expect(view(base())).toContain('Aucune webcam sur le mur');
    const min = view({ ...base(), ids: [CAM.id], minimized: true });
    expect(min).not.toContain('<img');
    expect(min).toContain('Déplier');
    const focus = view({ ...base(), ids: [CAM.id, 'osm:node/1'], focusId: CAM.id });
    expect(focus).toContain('--wcw-cols:1');
    expect(focus).not.toContain('Col du Lautaret');
    expect(focus).toContain('Revenir à la mosaïque');
  });
  it('textes échappés', () => {
    const ds = { ...DS, webcams: [{ ...CAM, name: '<b>x</b>' }] };
    const html = renderWebcamWall({ data: ds, state: { ...base(), ids: [CAM.id] }, columns: 1, refreshedMs: 0, refreshedLabel: null });
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).not.toContain('<b>x</b>');
  });
});

describe('panneau Webcams', () => {
  const open = (_id: string, byDefault: boolean): boolean => byDefault;
  it('chiffre en pourcentage (et non « 404 »), accès au mur, bouton de la fiche', () => {
    expect(activeShare(404, 457)).toBe('88 %');
    expect(activeShare(0, 0)).toBe('n.d.');
    const v = buildWebcamsView({ data: DS, error: null, selectedId: null, open, wallIds: [CAM.id] });
    expect(v.bodyHtml).toContain('data-wall-open');
    expect(v.bodyHtml).toContain('Mur de webcams (1)');
    expect(webcamFicheHtml(CAM, DS, [CAM.id])).toContain('Retirer du mur');
    expect(webcamFicheHtml(CAM, DS, [])).toContain('Ajouter au mur');
    expect(webcamFicheHtml(CAM, DS)).not.toContain('data-wall-toggle');
  });
});

describe('vidéos en direct (YouTube)', () => {
  const VID = {
    ...CAM, id: 'youtube:z6BNMoj9Pyo', name: 'Cannes · Boulevard du Midi', source: 'osm', imageUrl: null, countable: false,
    pageUrl: 'https://www.youtube.com/watch?v=z6BNMoj9Pyo', streamUrl: 'https://www.youtube-nocookie.com/embed/z6BNMoj9Pyo',
    license: 'Lecteur YouTube intégré', attribution: '© Mairie (YouTube)', contentType: 'text/html',
  };
  const ds = { ...DS, webcams: [...DS.webcams, VID] };
  it('lecteur youtube-nocookie seulement, muet et lancé seul ; aucune autre iframe', () => {
    expect(webcamEmbedUrl(VID)).toBe(VID.streamUrl);
    expect(webcamEmbedUrl({ ...VID, status: 'down' })).toBeNull();
    expect(webcamEmbedUrl({ ...VID, streamUrl: 'https://evil.example/embed/z6BNMoj9Pyo' })).toBeNull();
    expect(webcamEmbedUrl({ ...VID, streamUrl: 'https://www.youtube-nocookie.com/embed/x"><script>' })).toBeNull();
    expect(embedPlayerUrl(VID.streamUrl)).toBe(`${VID.streamUrl}?autoplay=1&mute=1&playsinline=1&rel=0`);
    expect(webcamCounts(ds.webcams).video).toBe(1);
  });
  it('tuile vidéo : iframe du lecteur avec référent d’origine (exigé par YouTube), candidats groupés', () => {
    const s = { ...base(), ids: [VID.id] };
    expect(wallTiles(ds, s)[0]).toMatchObject({ embedUrl: VID.streamUrl, imageUrl: null });
    const html = renderWebcamWall({ data: ds, state: s, columns: 1, refreshedMs: 0, refreshedLabel: null });
    expect(html).toContain(`<iframe src="${VID.streamUrl}?autoplay=1&amp;mute=1&amp;playsinline=1&amp;rel=0"`);
    expect(html).toContain('referrerpolicy="strict-origin-when-cross-origin"');
    expect(html).toContain('allowfullscreen');
    expect(html).toContain('Agrandir');
    expect(html).toContain('data-wall-action="fullscreen"');
    const pick = renderWebcamWall({ data: ds, state: base(), columns: 1, refreshedMs: 0, refreshedLabel: null });
    expect(pick).toContain('<optgroup label="Vidéos en direct (1)">');
    expect(pick).toContain('<optgroup label="Images rafraîchies chaque minute (1)">');
    expect(wallCandidates(ds, base()).map((w) => w.id).sort()).toEqual([CAM.id, VID.id].sort());
    // Webcam OSM sans image ni vidéo : jamais d'iframe.
    expect(renderWebcamWall({ data: ds, state: { ...base(), ids: ['osm:node/1'] }, columns: 1, refreshedMs: 0, refreshedLabel: null })).not.toContain('<iframe');
  });
});
