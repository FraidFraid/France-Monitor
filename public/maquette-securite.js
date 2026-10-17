// Maquette de la carte « Sécurité et défense » (17/10/2026), développement seulement (?maquette=securite).
// Lecture décisionnelle : le département est l'unité, la carte est calme par défaut, une seule bulle, fiche au format note.
// Seuils des communications réglables pour la revue : ?maquette=securite&seuils=3,10,25
(function () {
  const NB = ' ';
  const L1 = { vert: '#34c759', jaune: '#ffcc00', orange: '#ff9500', rouge: '#ff3b30' };
  const WORD = { vert: 'Normal', jaune: 'Vigilance', orange: 'Alerte', rouge: 'Crise' };
  const INK = '#d9dde5', DARK = '#161a22', MUTE = '#7d8595';
  const q = new URLSearchParams(location.search);
  const T = (q.get('seuils') || '3,10,25').split(',').map(Number);
  const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const num = (n) => Number(n).toLocaleString('fr-FR').replace(/\s/g, NB);
  const pad = (n) => String(n).padStart(2, '0');
  const when = (iso) => {
    if (!iso) return 'n.d.';
    const d = new Date(iso);
    const p = Object.fromEntries(new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(d).map((x) => [x.type, x.value]));
    return `${p.day}/${p.month} à ${p.hour}${NB}h${NB}${p.minute}`;
  };
  const ago = (iso) => {
    if (!iso) return 'n.d.';
    const h = (Date.now() - new Date(iso).getTime()) / 3.6e6;
    return h < 1 ? `depuis ${Math.max(1, Math.round(h * 60))}${NB}min` : h < 48 ? `depuis ${Math.round(h)}${NB}h` : `depuis ${Math.round(h / 24)}${NB}j`;
  };
  const getJson = async (url) => { try { const r = await fetch(url); return r.ok ? await r.json() : { error: `HTTP ${r.status}` }; } catch (e) { return { error: String(e) }; } };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // ─── Géométrie : point dans un polygone (départements) ───
  const inRing = (pt, ring) => { let ins = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) ins = !ins; } return ins; };
  const inGeom = (pt, g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).some((p) => inRing(pt, p[0]) && !p.slice(1).some((h) => inRing(pt, h)));

  const S = { m: null, geo: null, depts: null, deptByCode: new Map(), data: {}, agg: new Map(), focus: new Set(), fiche: null, hoverKey: null };

  // ─── Pictos : Lucide sur disque sombre cerclé (gabarit des disques Énergie) ───
  let fmIcon = null;
  const image = (id, svg, size) => new Promise((res) => {
    if (S.m.hasImage(id)) return res(id);
    const img = new Image(size, size);
    img.onload = () => { const c = document.createElement('canvas'); c.width = size; c.height = size; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
      if (!S.m.hasImage(id)) S.m.addImage(id, x.getImageData(0, 0, size, size), { pixelRatio: 2 }); res(id); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
  const glyph = (name, color) => fmIcon(name, { size: 24 }).replace(/^<svg[^>]*>/, `<g fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">`).replace('</svg>', '</g>');
  const disc = (name, ring, fill, dashed) => image(`mqs-${name}-${ring}-${fill}-${dashed ? 'd' : 'p'}`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44"><circle cx="22" cy="22" r="19" fill="${fill}" stroke="${ring}" stroke-width="2.5" ${dashed ? 'stroke-dasharray="5 4"' : ''}/>`
    + `<g transform="translate(11 11) scale(0.9167)">${glyph(name, ring === MUTE ? MUTE : '#ffffff')}</g></svg>`, 44);
  // Aéronef : chevron orienté selon le cap (plein = français, creux = autre pays) ; sans cap : rond.
  // Aéronef : chevron orienté selon le cap, à la couleur de sa famille (France, autre pays, hors de France) ; sans cap : rond.
  const chevron = (k, color) => image(`mqs-chev-${k}`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><path d="M20 4 L32 34 L20 27 L8 34 Z" fill="${color}" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/></svg>`, 40);
  const noHeading = (k, color) => image(`mqs-nohd-${k}`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="11" fill="${color}" stroke="#ffffff" stroke-width="2"/></svg>`, 40);

  // ─── Couleurs de catégorie : franches, une par couche, jamais celles de l'échelle L1 (réservées aux états) ───
  const CAT = { defense: '#4a9eff', defenseOther: '#b388ff', cables: '#22d3ee', telecom: '#e879f9', internet: '#2dd4bf', cloud: '#818cf8' };
  // ─── Calques d'origine : remplacés par ceux de la maquette ───
  const HIDE = ['out-telecom-long', 'out-telecom-recent', 'out-internet-fill', 'out-internet-line', 'sov-aircraft', 'sov-aircraft-label', 'sov-aircraft-abroad',
    'military-bases-circle', 'military-bases-label', 'submarine-cables-glow', 'submarine-cables-core', 'out-cloud-ref', 'out-cloud-zones'];
  const calm = () => {
    const m = S.m;
    const P = (id, k, v) => { try { if (m.getLayer(id) && JSON.stringify(m.getPaintProperty(id, k)) !== JSON.stringify(v)) m.setPaintProperty(id, k, v); } catch (e) { /* calque d'un autre type */ } };
    const V = (id, on) => { if (m.getLayer(id) && m.getLayoutProperty(id, 'visibility') !== (on ? 'visible' : 'none')) m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); };
    for (const id of HIDE) V(id, false);
    // L'app masque les calques qu'elle ne connaît pas : ceux de la maquette sont remis visibles.
    for (const l of m.getStyle().layers) if (l.id.startsWith('mqs-')) V(l.id, l.id !== 'mqs-cable-label' || S.focus.has('subseaCables'));
    // Câbles : cyan franc (catégorie), sans halo néon ; ils passeraient à la couleur L1 sur alerte de la veille.
    if (!baseOpacity.size) {
      P('submarine-cables-line', 'line-color', CAT.cables); P('submarine-cables-line', 'line-opacity', 0.85);
      P('submarine-cables-line', 'line-width', ['interpolate', ['linear'], ['zoom'], 4, 1.2, 8, 2.2]);
      P('submarine-cables-landing', 'circle-color', CAT.cables); P('submarine-cables-landing', 'circle-radius', ['interpolate', ['linear'], ['zoom'], 4, 2.5, 8, 4.5]);
      P('submarine-cables-landing', 'circle-stroke-width', 1); P('submarine-cables-landing', 'circle-stroke-color', '#05060a');
    }
    // Pression par département (score global) : contour toujours, remplissage quand sa pastille est allumée.
    V('isnr-line', true); V('isnr-fill', S.focus.has('stability'));
    // Détail porté au premier plan par une pastille : sites télécoms et référentiel cloud dès la vue France.
    const zr = (id, min) => { try { if (m.getLayer(id) && m.getLayer(id).minzoom !== min) m.setLayerZoomRange(id, min, 24); } catch (e) { /* calque absent */ } };
    zr('mqs-sites-recent', S.focus.has('outagesTelecom') ? 0 : 7);
    zr('mqs-sites-long', S.focus.has('outagesTelecom') ? 0 : 7);
    if (m.getLayer('mqs-cloud-sym')) m.setFilter('mqs-cloud-sym', S.focus.has('outagesCloud') ? null : ['any', ['!=', ['get', 'status'], 'vert'], ['>=', ['zoom'], 6]]);
    if (m.getLayer('mqs-bases-sym')) m.setLayoutProperty('mqs-bases-sym', 'text-field', S.focus.has('military') ? ['get', 'name'] : ['step', ['zoom'], '', 8, ['get', 'name']]);
  };

  // ─── Agrégation par département ───
  const levelOf = (n, inet) => (n >= T[2] ? 'rouge' : n >= T[1] || inet ? 'orange' : n >= T[0] ? 'jaune' : 'vert');
  const aggregate = () => {
    const tel = S.data.telecom, inet = S.data.internet;
    const agg = new Map();
    for (const d of S.depts) agg.set(d.code, { code: d.code, nom: d.nom, zone: d.zone, at: d.at, sites: [], ops: {}, voice: 0, data: 0, undated: 0, longCount: 0, inet: [], inetPast: [] });
    for (const s of tel?.sites ?? []) {
      const a = agg.get(s.dept); if (!a) continue;
      if (s.cls === 'recente') { a.sites.push(s); a.ops[s.operator] = (a.ops[s.operator] ?? 0) + 1; if (s.voice === 'HS') a.voice += 1; if (s.data === 'HS') a.data += 1; }
      else if (s.cls === 'sans-date') a.undated += 1;
      else if (s.cls === 'longue') a.longCount += 1;
    }
    for (const e of inet?.events ?? []) { const a = e.dept && agg.get(e.dept); if (!a) continue; (e.ongoing ? a.inet : a.inetPast).push(e); }
    for (const a of agg.values()) a.level = levelOf(a.sites.length, a.inet.length > 0);
    S.agg = agg;
  };

  // ─── Sources et calques de la maquette ───
  const fc = (features) => ({ type: 'FeatureCollection', features });
  const pt = (c, properties) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties });
  const setData = (id, data) => { const s = S.m.getSource(id); if (s) s.setData(data); else S.m.addSource(id, { type: 'geojson', data }); };
  const before = () => (S.m.getLayer('sov-emergencies') ? 'sov-emergencies' : undefined);

  const draw = async () => {
    const m = S.m;
    aggregate();
    // Contours des 7 zones de défense et de sécurité + noms
    setData('mqs-zones', S.geo.zones);
    const zoneAt = {};
    for (const d of S.depts) { (zoneAt[d.zone] ??= []).push(d.at); }
    setData('mqs-zone-labels', fc(Object.entries(zoneAt).map(([z, pts]) => pt([pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length], { name: `Zone ${z}` }))));
    // Départements (survol, clic, coupure Internet en cours)
    setData('mqs-depts', fc(S.geo.deptShapes.map((f) => ({ ...f, properties: { code: f.properties.code, nom: f.properties.nom,
      inet: (S.agg.get(f.properties.code)?.inet.length ?? 0) > 0, inetPast: (S.agg.get(f.properties.code)?.inetPast.length ?? 0) > 0 } }))));
    // Symboles agrégés : rien quand tout est normal
    setData('mqs-agg', fc([...S.agg.values()].filter((a) => a.level !== 'vert').map((a) => pt(a.at, { code: a.code, n: a.sites.length, level: a.level, color: L1[a.level] }))));
    // Sous le seuil : le compte reste lisible, à la couleur de la couche (information, pas alerte)
    setData('mqs-low', fc([...S.agg.values()].filter((a) => a.level === 'vert' && a.sites.length > 0).map((a) => pt(a.at, { code: a.code, n: a.sites.length }))));
    // Détail au zoom : sites récents (bord à la couleur du département), stock ancien en semis gris
    const tel = S.data.telecom?.sites ?? [];
    setData('mqs-sites', fc(tel.filter((s) => s.lat && s.lon).map((s) => pt([s.lon, s.lat], { id: s.id, cls: s.cls,
      ring: s.cls === 'recente' ? L1[S.agg.get(s.dept)?.level ?? 'vert'] === L1.vert ? CAT.telecom : L1[S.agg.get(s.dept).level] : CAT.telecom }))));
    // Aéronefs au-dessus de la France : identité complète (O10)
    const mil = S.data.military;
    setData('mqs-air', fc([...(mil?.aircraft ?? []).map((a) => ({ ...a, abroad: false })), ...(mil?.abroad ?? []).map((a) => ({ ...a, abroad: true }))]
      .filter((a) => a.lat != null && a.lon != null).map((a) => pt([a.lon, a.lat], { hex: a.hex, fr: a.family === 'francais', abroad: a.abroad, track: a.track ?? 0,
        hasTrack: a.track !== null && a.track !== undefined, label: [a.callsign, a.registration].filter(Boolean).join(' · ') }))));
    // Sites de défense : forme = armée, aucune couleur (rien d'anormal à signaler sur un site)
    setData('mqs-bases', fc(S.bases.map((b) => pt(b.geometry.coordinates, { id: b.properties.id, name: b.properties.name, type: b.properties.type }))));
    // Cloud : seules les zones en incident en cours sont dessinées en couleur ; référentiel au zoom
    const cloud = S.data.cloud;
    const inc = new Map();
    for (const i of cloud?.incidents ?? []) if (i.state === 'en-cours') for (const z of i.zones) inc.set(`${i.provider}:${z}`, i);
    const zones = [];
    for (const p of cloud?.providers ?? []) for (const z of p.zones ?? []) {
      if (z.lat === undefined || z.lon === undefined) continue;
      const i = inc.get(`${p.provider}:${z.id}`);
      zones.push(pt([z.lon, z.lat], { id: `${p.provider}:${z.id}`, provider: p.label, label: z.label, status: i ? (i.impact === 'critical' ? 'rouge' : i.impact === 'major' ? 'orange' : 'jaune') : 'vert' }));
    }
    setData('mqs-cloud', fc(zones));

    if (!m.getLayer('mqs-zones-line')) {
      const ic = {
        air: await disc('plane', '#ffffff', CAT.defense), navy: await disc('anchor', '#ffffff', CAT.defense), army: await disc('shield', '#ffffff', CAT.defense),
        joint: await disc('swords', '#ffffff', CAT.defense), other: await disc('landmark', '#ffffff', CAT.defense),
        cloudOk: await disc('cloud', '#ffffff', CAT.cloud), cloudJ: await disc('cloud', L1.jaune, DARK), cloudO: await disc('cloud', L1.orange, DARK), cloudR: await disc('cloud', L1.rouge, DARK),
      };
      await chevron('f', CAT.defense); await chevron('o', CAT.defenseOther); await chevron('a', '#8a93a6');
      await noHeading('f', CAT.defense); await noHeading('o', CAT.defenseOther); await noHeading('a', '#8a93a6');
      const b = before();
      m.addLayer({ id: 'mqs-dept-fill', type: 'fill', source: 'mqs-depts', paint: { 'fill-color': '#ffffff', 'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.06, 0] } }, b);
      m.addLayer({ id: 'mqs-dept-hover', type: 'line', source: 'mqs-depts', filter: ['==', ['get', 'code'], ''], paint: { 'line-color': '#ffffff', 'line-width': 1.5, 'line-opacity': 0.8 } }, b);
      m.addLayer({ id: 'mqs-inet-past', type: 'line', source: 'mqs-depts', filter: ['all', ['==', ['get', 'inetPast'], true], ['==', ['get', 'inet'], false]],
        paint: { 'line-color': CAT.internet, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1.1, 8, 2], 'line-opacity': 0.8 } }, b);
      m.addLayer({ id: 'mqs-cable-label', type: 'symbol', source: 'submarine-cables-src',
        layout: { 'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-size': 10, 'text-font': ['Open Sans Semibold'], 'symbol-spacing': 400 },
        paint: { 'text-color': CAT.cables, 'text-halo-color': '#05060a', 'text-halo-width': 1.4 } });
      m.addLayer({ id: 'mqs-inet', type: 'line', source: 'mqs-depts', filter: ['==', ['get', 'inet'], true], paint: { 'line-color': L1.orange, 'line-width': 2.5 } }, b);
      m.addLayer({ id: 'mqs-zones-line', type: 'line', source: 'mqs-zones', paint: { 'line-color': '#e8e8ec', 'line-opacity': 0.75, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1.6, 8, 2.6], 'line-dasharray': [3, 2] } }, b);
      m.addLayer({ id: 'mqs-zones-label', type: 'symbol', source: 'mqs-zone-labels', maxzoom: 7,
        layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-font': ['Open Sans Semibold'], 'text-letter-spacing': 0.04, 'text-allow-overlap': false },
        paint: { 'text-color': '#9aa1ae', 'text-halo-color': '#0a0a0f', 'text-halo-width': 1.4 } }, b);
      m.addLayer({ id: 'mqs-cloud-sym', type: 'symbol', source: 'mqs-cloud', filter: ['any', ['!=', ['get', 'status'], 'vert'], ['>=', ['zoom'], 8]],
        layout: { 'icon-image': ['match', ['get', 'status'], 'jaune', ic.cloudJ, 'orange', ic.cloudO, 'rouge', ic.cloudR, ic.cloudOk],
          'icon-size': ['match', ['get', 'status'], 'vert', 0.5, 0.7], 'icon-allow-overlap': true } }, b);
      m.addLayer({ id: 'mqs-sites-long', type: 'circle', source: 'mqs-sites', minzoom: 7, filter: ['!=', ['get', 'cls'], 'recente'],
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 1.6, 10, 3], 'circle-color': CAT.telecom, 'circle-opacity': 0.55 } }, b);
      m.addLayer({ id: 'mqs-sites-recent', type: 'circle', source: 'mqs-sites', minzoom: 7, filter: ['==', ['get', 'cls'], 'recente'],
        paint: { 'circle-radius': 4.5, 'circle-color': DARK, 'circle-stroke-color': ['get', 'ring'], 'circle-stroke-width': 2 } }, b);
      m.addLayer({ id: 'mqs-bases-sym', type: 'symbol', source: 'mqs-bases',
        layout: { 'icon-image': ['match', ['get', 'type'], 'air', ic.air, 'navy', ic.navy, 'army', ic.army, 'joint', ic.joint, ic.other],
          'icon-size': ['interpolate', ['linear'], ['zoom'], 4, 0.42, 7, 0.6, 10, 0.85], 'icon-allow-overlap': true,
          'text-field': ['step', ['zoom'], '', 8, ['get', 'name']], 'text-size': 10, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-font': ['Open Sans Semibold'], 'text-optional': true },
        paint: { 'icon-opacity': 1, 'text-color': '#bcd8ff', 'text-halo-color': '#0a0a0f', 'text-halo-width': 1.3 } }, b);
      m.addLayer({ id: 'mqs-low-disc', type: 'circle', source: 'mqs-low', maxzoom: 7,
        paint: { 'circle-radius': ['+', 6, ['*', 2, ['sqrt', ['get', 'n']]]], 'circle-color': '#05060a', 'circle-opacity': 0.85, 'circle-stroke-color': CAT.telecom, 'circle-stroke-width': 1.6 } });
      m.addLayer({ id: 'mqs-low-count', type: 'symbol', source: 'mqs-low', maxzoom: 7,
        layout: { 'text-field': ['to-string', ['get', 'n']], 'text-size': 10, 'text-font': ['Open Sans Semibold'], 'text-allow-overlap': true }, paint: { 'text-color': CAT.telecom } });
      m.addLayer({ id: 'mqs-agg-disc', type: 'circle', source: 'mqs-agg', maxzoom: 7,
        paint: { 'circle-radius': ['min', 26, ['+', 7, ['*', 3, ['sqrt', ['get', 'n']]]]], 'circle-color': ['get', 'color'], 'circle-opacity': 0.92,
          'circle-stroke-color': '#05060a', 'circle-stroke-width': 1.5 } });
      m.addLayer({ id: 'mqs-agg-count', type: 'symbol', source: 'mqs-agg', maxzoom: 7,
        layout: { 'text-field': ['to-string', ['get', 'n']], 'text-size': 11, 'text-font': ['Open Sans Semibold'], 'text-allow-overlap': true },
        paint: { 'text-color': ['match', ['get', 'level'], 'jaune', '#1a1a1a', '#ffffff'] } });
      m.addLayer({ id: 'mqs-air-sym', type: 'symbol', source: 'mqs-air',
        layout: { 'icon-image': ['concat', ['case', ['get', 'hasTrack'], 'mqs-chev-', 'mqs-nohd-'], ['case', ['get', 'abroad'], 'a', ['get', 'fr'], 'f', 'o']],
          'icon-rotate': ['get', 'track'], 'icon-rotation-alignment': 'map', 'icon-size': 0.75, 'icon-allow-overlap': true,
          'text-field': ['get', 'label'], 'text-size': 10, 'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-font': ['Open Sans Semibold'], 'text-optional': true },
        paint: { 'text-color': '#e8e8ec', 'text-halo-color': '#0a0a0f', 'text-halo-width': 1.5 } });
    }
    calm();
    renderLegend(); renderCyber(); applyFocus();
    if (S.fiche) openFiche(S.fiche.kind, S.fiche.key, true);
  };

  // ─── Pastilles de l'application : mise en avant cumulable, le reste estompé (comme les pastilles Énergie) ───
  const GROUPS = {
    military: ['mqs-bases-sym', 'mqs-air-sym', 'sov-emergencies', 'sov-navy-reference', 'sov-navy-observed', 'sov-gnss-fill', 'sov-gnss-line'],
    subseaCables: ['submarine-cables-line', 'submarine-cables-landing', 'mqs-cable-label'],
    cyber: [],
    stability: ['isnr-line', 'isnr-fill'],
    outagesTelecom: ['mqs-agg-disc', 'mqs-agg-count', 'mqs-low-disc', 'mqs-low-count', 'mqs-sites-recent', 'mqs-sites-long'],
    outagesInternet: ['mqs-inet', 'mqs-inet-past'],
    outagesCloud: ['mqs-cloud-sym'],
  };
  const OPACITY = { circle: ['circle-opacity', 'circle-stroke-opacity'], symbol: ['icon-opacity', 'text-opacity'], line: ['line-opacity'], fill: ['fill-opacity'] };
  const baseOpacity = new Map();
  let preview = null;
  const applyFocus = () => {
    const m = S.m;
    const on = new Set(S.focus); if (preview) on.add(preview);
    calm();
    for (const [g, layers] of Object.entries(GROUPS)) for (const id of layers) {
      const l = m.getLayer(id); if (!l) continue;
      for (const p of OPACITY[l.type] ?? []) {
        const k = `${id}|${p}`;
        if (!baseOpacity.has(k)) baseOpacity.set(k, m.getPaintProperty(id, p) ?? 1);
        const dim = on.size > 0 && !on.has(g);
        const base = baseOpacity.get(k);
        try { m.setPaintProperty(id, p, dim ? (typeof base === 'number' ? base * 0.15 : 0.12) : base); } catch (e) { /* propriété absente */ }
      }
    }
    cyber.classList.toggle('is-focus', on.has('cyber'));
    cyber.classList.toggle('is-dim', on.size > 0 && !on.has('cyber'));
    syncChips();
  };
  // Les pastilles de l'app gardent leur rôle (ouvrir le panneau) ; la maquette y ajoute la mise en avant sur la carte.
  const chipKey = (el) => el?.closest?.('.floating-panel-switcher__chip[data-panel-key]')?.dataset.panelKey;
  const syncChips = () => document.querySelectorAll('.floating-panel-switcher__chip[data-panel-key]').forEach((c) => {
    if (!(c.dataset.panelKey in GROUPS)) return;
    const pressed = S.focus.has(c.dataset.panelKey);
    if (c.classList.contains('is-active') !== pressed) c.classList.toggle('is-active', pressed);
    if (c.getAttribute('aria-pressed') !== String(pressed)) c.setAttribute('aria-pressed', String(pressed));
  });
  const wireChips = () => {
    document.addEventListener('click', (e) => {
      const k = chipKey(e.target); if (!k || !(k in GROUPS)) return;
      S.focus.has(k) ? S.focus.delete(k) : S.focus.add(k);
      preview = null; applyFocus();
    }, true);
    document.addEventListener('mouseover', (e) => { const k = chipKey(e.target); const next = k in GROUPS ? k : null; if (next !== preview) { preview = next; applyFocus(); } });
    new MutationObserver(syncChips).observe(document.body, { subtree: true, childList: true });
  };

  // ─── Bulle unique ───
  const pop = document.createElement('div');
  pop.className = 'mqs-pop';
  let popAt = null;
  const placePop = () => { if (!popAt) return; const p = S.m.project(popAt); pop.style.transform = `translate(${Math.round(p.x + 14)}px, ${Math.round(p.y + 14)}px)`; };
  const card = (c) => `<div class="et-card"><div class="et-head"><i class="et-dot" style="background:${c.dot}"></i><strong>${esc(c.title)}</strong></div>`
    + (c.state ? `<div class="et-state" style="color:${c.stateHex}">${esc(c.state)}</div>` : '')
    + c.rows.map(([k, v]) => `<div class="et-row"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')
    + (c.hint ? `<div class="et-hint">${esc(c.hint)}</div>` : '')
    + `<div class="et-src">Source : ${esc(c.source)}</div></div>`;

  const telecomSource = () => `ARCEP, fichier du ${when(S.data.telecom?.file?.publishedAt)}`;
  const deptCard = (a) => {
    if (!a) return null;
    const ops = Object.entries(a.ops).sort((x, y) => y[1] - x[1]).map(([o, n]) => `${o} ${n}`).join(', ');
    return { dot: a.level === 'vert' ? CAT.telecom : L1[a.level], title: `${a.nom} (${a.code})`, state: a.level === 'vert' ? 'Normal · sous le seuil' : `${WORD[a.level]} · communications`, stateHex: a.level === 'vert' ? '#c7c7cc' : L1[a.level],
      rows: [['Sites mobiles coupés < 24' + NB + 'h', String(a.sites.length)], ['Opérateurs', ops || 'aucun'], ['Coupure Internet en cours', a.inet.length ? 'oui (IODA)' : 'non'],
        ['Zone de défense', a.zone]],
      hint: 'Clic : fiche du département', source: telecomSource() };
  };
  const airOf = (hex) => [...(S.data.military?.aircraft ?? []), ...(S.data.military?.abroad ?? []).map((a) => ({ ...a, abroadOnly: true }))].find((a) => a.hex === hex);
  const airCard = (a) => ({ dot: a.family === 'francais' ? CAT.defense : CAT.defenseOther, title: [a.callsign, a.registration].filter(Boolean).join(' · ') || a.hex,
    state: `${a.family === 'francais' ? 'Aéronef militaire français' : `Aéronef militaire · ${a.country ?? 'pays n.d.'}`}${a.abroadOnly ? ' · hors de France' : ''}`, stateHex: '#c7c7cc',
    rows: [['Type', a.type ?? 'n.d.'], ['Altitude', a.altitudeFt != null ? `${num(a.altitudeFt)}${NB}ft` : 'n.d.'], ['Vitesse', a.speedKt != null ? `${num(Math.round(a.speedKt))}${NB}kt` : 'n.d.'],
      ['Cap', a.track != null ? `${Math.round(a.track)}${NB}°` : 'n.d.'], ['Vu', when(a.seenAt)]],
    hint: 'Clic : fiche', source: 'ADS-B (adsb.lol), positions publiques' });
  const BASE_WORD = { air: 'air', navy: 'marine', army: 'terre', joint: 'interarmées', fortification: 'fortification', other: 'autre' };
  const baseCard = (p) => ({ dot: CAT.defense, title: p.name, state: `Site ${BASE_WORD[p.type] ?? 'autre'} · contexte`, stateHex: '#c7c7cc',
    rows: [['Département', deptAt(S.bases.find((b) => b.properties.id === p.id)?.geometry.coordinates)?.nom ?? 'n.d.']],
    hint: 'Aucune donnée en direct sur ce site', source: 'liste interne de sites publics, sans date par site' });
  const siteCard = (s) => ({ dot: s.cls === 'recente' && S.agg.get(s.dept)?.level !== 'vert' ? L1[S.agg.get(s.dept).level] : CAT.telecom,
    title: `${s.operator} · ${s.commune ?? 'commune n.d.'}`, state: s.cls === 'recente' ? `Hors service ${ago(s.since)}` : s.cls === 'sans-date' ? 'Hors service · date de début non publiée' : `Hors service ${ago(s.since)} (stock ancien)`,
    stateHex: '#e8e8ec', rows: [['Données', s.data === 'HS' ? 'coupées' : s.data ?? 'n.d.'], ['Voix', s.voice === 'HS' ? 'coupée' : s.voice ?? 'non publiée'], ['Technologies', (s.techs ?? []).join(', ') || 'n.d.'],
      ['Cause', s.cause ?? 'n.d.']], source: telecomSource() });
  const cableWatch = () => (S.data.cablesWatch?.evaluated ? 'veille active' : `veille des navires coupée (${(S.data.cablesWatch?.errors ?? [])[0] ?? 'source injoignable'})`);
  const cloudCard = (p) => {
    const i = (S.data.cloud?.incidents ?? []).find((x) => x.state === 'en-cours' && x.zones.some((z) => `${x.provider}:${z}` === p.id));
    return { dot: p.status === 'vert' ? CAT.cloud : L1[p.status], title: `${p.provider} · ${p.label}`, state: i ? `Incident en cours ${ago(i.start)}` : 'Opérationnel', stateHex: i ? L1[p.status] : '#c7c7cc',
      rows: i ? [['Incident', i.title], ['Impact déclaré', i.impact]] : [], source: `page d'état ${p.provider}` };
  };
  const strong = (html) => { const d = document.createElement('div'); d.innerHTML = html ?? ''; return d.querySelector('strong, b, .hm-tip-title')?.textContent ?? d.textContent.slice(0, 60); };

  const deptAt = (c) => { if (!c) return null; for (const f of S.geo.deptShapes) if (inGeom(c, f.geometry)) return S.agg.get(f.properties.code); return null; };

  // Arbitre : une seule cible, la plus signifiante sous le pointeur.
  const PRIORITY = ['mqs-air-sym', 'sov-emergencies', 'mqs-cloud-sym', 'mqs-sites-recent', 'mqs-agg-disc', 'mqs-low-disc', 'mqs-bases-sym', 'sov-navy-reference', 'sov-navy-observed', 'submarine-cables-landing', 'submarine-cables-hitarea', 'mqs-sites-long', 'mqs-dept-fill'];
  const pick = (point) => {
    const layers = PRIORITY.filter((id) => S.m.getLayer(id));
    const hits = S.m.queryRenderedFeatures(point, { layers });
    if (!hits.length) return null;
    hits.sort((a, b) => PRIORITY.indexOf(a.layer.id) - PRIORITY.indexOf(b.layer.id));
    const f = hits[0], p = f.properties, id = f.layer.id;
    if (id === 'mqs-air-sym') { const a = airOf(p.hex); return a && { key: `air:${p.hex}`, kind: 'air', id: p.hex, card: airCard(a), at: [a.lon, a.lat] }; }
    if (id === 'mqs-agg-disc' || id === 'mqs-low-disc' || id === 'mqs-dept-fill') { const a = S.agg.get(p.code); return a && { key: `dept:${a.code}`, kind: 'dept', id: a.code, card: deptCard(a), at: id === 'mqs-dept-fill' ? null : a.at }; }
    if (id === 'mqs-sites-recent' || id === 'mqs-sites-long') { const s = (S.data.telecom?.sites ?? []).find((x) => x.id === p.id); return s && { key: `site:${s.id}`, kind: 'site', id: s.id, card: siteCard(s), at: [s.lon, s.lat] }; }
    if (id === 'mqs-bases-sym') return { key: `base:${p.id}`, kind: 'base', id: p.id, card: baseCard(p), at: f.geometry.coordinates };
    if (id === 'mqs-cloud-sym') return { key: `cloud:${p.id}`, kind: 'cloud', id: p.id, card: cloudCard(p), at: f.geometry.coordinates };
    if (id === 'submarine-cables-hitarea' || id === 'submarine-cables-landing') {
      const title = id === 'submarine-cables-landing' ? strong(p.body) : p.name || 'câble sous-marin';
      return { key: `cable:${p.id ?? title}`, kind: 'cable', id: title, at: null,
        card: { dot: CAT.cables, title, state: id === 'submarine-cables-landing' ? 'Atterrage · contexte' : 'Câble sous-marin · contexte', stateHex: '#c7c7cc',
          rows: [['Veille des navires', S.data.cablesWatch?.evaluated ? 'active' : 'coupée']], hint: S.data.cablesWatch?.evaluated ? null : cableWatch(), source: 'OpenStreetMap, TeleGeography' } };
    }
    if (id === 'sov-emergencies' || id.startsWith('sov-navy')) return { key: `${id}:${p.id}`, kind: 'raw', id: p.id, at: f.geometry.coordinates,
      card: { dot: p.color ?? '#8a93a6', title: strong(p.body), state: id === 'sov-emergencies' ? 'Code d’urgence transpondeur' : 'Bâtiment de la Marine · port base (référence)', stateHex: p.color ?? '#c7c7cc',
        rows: [], hint: id === 'sov-emergencies' ? null : 'Position de référence, pas une observation', source: id === 'sov-emergencies' ? 'ADS-B' : 'liste publique, AIS coupé' } };
    return null;
  };

  let hoveredDept = null;
  const setDeptHover = (code) => {
    if (code === hoveredDept) return;
    S.m.setFilter('mqs-dept-hover', ['==', ['get', 'code'], code ?? '']);
    hoveredDept = code;
  };
  const onMove = (e) => {
    const hit = pick(e.point);
    const canvas = S.m.getCanvas();
    if (!hit) { pop.style.display = 'none'; popAt = null; S.hoverKey = null; setDeptHover(null); canvas.style.cursor = ''; return; }
    canvas.style.cursor = 'pointer';
    setDeptHover(hit.kind === 'dept' ? hit.id : null);
    popAt = hit.at ?? [e.lngLat.lng, e.lngLat.lat];
    if (S.hoverKey !== hit.key) { pop.innerHTML = card(hit.card); S.hoverKey = hit.key; }
    pop.style.display = 'block'; placePop();
  };

  // ─── Fiche au format note de situation ───
  const panel = document.createElement('aside');
  panel.className = 'mqs-fiche';
  const sec = (title, body) => `<section><h4>${esc(title)}</h4>${body}</section>`;
  const li = (items) => `<ul>${items.map((x) => `<li>${x}</li>`).join('')}</ul>`;
  const spark = (hist) => {
    if (!hist?.length) return '';
    const w = 300, h = 44, max = Math.max(...hist.map((x) => x.recent), 1);
    const pts = hist.map((x, i) => `${Math.round((i / (hist.length - 1)) * w)},${Math.round(h - (x.recent / max) * (h - 6) - 3)}`).join(' ');
    const last = hist[hist.length - 1];
    return `<svg class="mqs-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="#8a93a6" stroke-width="1.5"/>`
      + `<circle cx="${w}" cy="${Math.round(h - (last.recent / max) * (h - 6) - 3)}" r="3" fill="#e8e8ec"/></svg>`
      + `<div class="mqs-spark-cap">Sites récents, France entière, ${hist.length}${NB}derniers fichiers (max ${num(max)})</div>`;
  };
  const freshness = () => {
    const d = S.data, rows = [];
    rows.push(['ARCEP (sites mobiles)', d.telecom?.file ? `fichier du ${when(d.telecom.file.publishedAt)}, quotidien` : 'indisponible', d.telecom?.file ? 'ok' : 'ko']);
    rows.push(['IODA (Internet)', d.internet?.iodaReadAt ? `lu ${when(d.internet.iodaReadAt)}` : 'indisponible', d.internet?.iodaReadAt ? 'ok' : 'ko']);
    rows.push(['Cloudflare Radar', d.internet?.radar?.readAt ? `lu ${when(d.internet.radar.readAt)}` : `jamais lu${(d.internet?.errors ?? []).find((x) => /Radar/.test(x)) ? ` (${(d.internet.errors.find((x) => /Radar/.test(x))).replace(/^Cloudflare Radar : /, '')})` : ''}`, d.internet?.radar?.readAt ? 'ok' : 'ko']);
    rows.push(['ADS-B (aéronefs)', d.military?.readAt ? `lu ${when(d.military.readAt)}` : 'indisponible', d.military?.readAt ? 'ok' : 'ko']);
    rows.push(['AIS (navires, câbles)', d.cablesWatch?.evaluated ? `lu ${when(d.cablesWatch.readAt)}` : `coupé${(d.cablesWatch?.errors ?? [])[0] ? ` (${d.cablesWatch.errors[0]})` : ', aucun message reçu'}`, d.cablesWatch?.evaluated ? 'ok' : 'ko']);
    rows.push(['GNSS (brouillage)', d.gnss?.readAt ? `lu ${when(d.gnss.readAt)}${(d.gnss.errors ?? []).length ? ` · ${d.gnss.errors[0]}` : ''}` : 'indisponible', d.gnss?.readAt && !(d.gnss.errors ?? []).length ? 'ok' : 'part']);
    rows.push(['Pages d’état cloud', d.cloud?.readAt ? `lu ${when(d.cloud.readAt)}` : 'indisponible', d.cloud?.readAt ? 'ok' : 'ko']);
    return rows;
  };
  const deptNote = (a) => {
    const d = S.data, tel = d.telecom;
    const ops = Object.entries(a.ops).sort((x, y) => y[1] - x[1]);
    const communes = [...new Set(a.sites.map((s) => s.commune).filter(Boolean))];
    const inDept = (c) => deptAt(c)?.code === a.code;
    const bases = S.bases.filter((b) => inDept(b.geometry.coordinates)).map((b) => b.properties.name);
    const air = (d.military?.aircraft ?? []).filter((x) => x.dept === a.code);
    const now = when(new Date().toISOString());
    const what = a.sites.length
      ? `${a.sites.length}${NB}site${a.sites.length > 1 ? 's' : ''} mobile${a.sites.length > 1 ? 's' : ''} hors service depuis moins de 24${NB}h (${ops.map(([o, n]) => `${o} ${n}`).join(', ')}).`
        + (a.voice ? ` Voix coupée sur ${a.voice}${NB}site${a.voice > 1 ? 's' : ''}.` : '')
      : 'Aucun site mobile hors service depuis moins de 24' + NB + 'h.';
    const inet = a.inet.length ? `Coupure Internet en cours (IODA, ${a.inet.map((e) => ago(e.start)).join(', ')}).`
      : a.inetPast.length ? `Pas de coupure Internet en cours ; dernière terminée le ${when(a.inetPast.map((e) => e.end).sort().pop())} (IODA).` : 'Pas de coupure Internet relevée sur 7' + NB + 'jours (IODA).';
    const impact = [
      communes.length ? `Communes touchées : ${communes.slice(0, 8).join(', ')}${communes.length > 8 ? ` et ${communes.length - 8}${NB}autres` : ''}.` : 'Aucune commune touchée par une panne récente.',
      `Sites de défense dans le département : ${bases.length ? bases.join(', ') : 'aucun dans la liste'} (aucune donnée en direct sur ces sites).`,
      air.length ? `Aéronefs militaires au-dessus du département : ${air.map((x) => [x.callsign, x.registration].filter(Boolean).join(' · ')).join(' ; ')}.` : 'Aucun aéronef militaire relevé au-dessus du département au dernier relevé.',
    ];
    const evo = `France entière : ${num(tel?.summary?.recent ?? 0)}${NB}sites récents ; ${num(tel?.summary?.newSincePrevious ?? 0)}${NB}nouveaux et ${num(tel?.summary?.resolvedSincePrevious ?? 0)}${NB}rétablis depuis le fichier précédent.`;
    const unknown = [
      'Tendance par département : n.d. (l’ARCEP publie un fichier par jour, pas d’historique départemental).',
      'Nombre d’abonnés touchés : non publié par les opérateurs.',
      a.undated ? `${a.undated}${NB}site${a.undated > 1 ? 's' : ''} hors service sans date de début (non publiée par l’opérateur), comptés à part.` : null,
      a.sites.some((s) => !s.detail) ? 'Cause détaillée non publiée pour une partie des sites.' : null,
      d.cablesWatch?.evaluated ? null : `Navires près des câbles : non surveillés, ${cableWatch()}.`,
    ].filter(Boolean);
    return { title: `${a.nom} (${a.code})`, sub: `Zone de défense et de sécurité ${a.zone} · ${WORD[a.level]}`, level: a.level, at: now,
      blocks: [['Ce qui se passe', [what, inet]], ['Impact', impact], ['Évolution', [evo]], ['Ce qu’on ne sait pas', unknown]], spark: tel?.history };
  };
  const airNote = (a) => ({ sources: ['ADS-B'], title: [a.callsign, a.registration].filter(Boolean).join(' · ') || a.hex, sub: `${a.family === 'francais' ? 'Aéronef militaire français' : `Aéronef militaire · ${a.country ?? 'pays n.d.'}`}`,
    level: null, at: when(new Date().toISOString()),
    blocks: [['Ce qui se passe', [`${a.type ?? 'type n.d.'} vu le ${when(a.seenAt)} au-dessus du département ${S.agg.get(a.dept) ? `${S.agg.get(a.dept).nom} (${a.dept})` : 'n.d.'}, altitude ${a.altitudeFt != null ? `${num(a.altitudeFt)}${NB}ft` : 'n.d.'}, cap ${a.track != null ? `${Math.round(a.track)}${NB}°` : 'n.d.'}, vitesse ${a.speedKt != null ? `${num(Math.round(a.speedKt))}${NB}kt` : 'n.d.'}.`,
      `Identité : indicatif ${a.callsign ?? 'n.d.'}, immatriculation ${a.registration ?? 'n.d.'}, code ${a.hex}.`]],
    ['Évolution', [`Aéronefs militaires au-dessus de la France au dernier relevé : ${(S.data.military?.aircraft ?? []).length}.`]],
    ['Ce qu’on ne sait pas', ['Mission, origine et destination : non publiées.', 'Trajectoire : un seul relevé (pas de trace conservée dans la maquette).']]] });
  const baseNote = (b) => ({ sources: [], title: b.properties.name, sub: `Site ${BASE_WORD[b.properties.type] ?? 'autre'} · contexte`, level: null, at: when(new Date().toISOString()),
    blocks: [['Ce qui se passe', ['Aucune donnée en direct sur ce site.']], ['Impact', [`Département : ${deptAt(b.geometry.coordinates)?.nom ?? 'n.d.'}.`]],
      ['Ce qu’on ne sait pas', ['Statut actuel du site non vérifié sur une source officielle (liste interne sans date par site).', 'Unités, aéronefs et effectifs : non affichés (amendement O13).']]] });

  // Sources propres à la fiche : un aéronef ne dépend que de l'ADS-B, un site de la liste interne.
  const sourcesOf = (n) => (n.sources ? freshness().filter(([k]) => n.sources.some((x) => k.startsWith(x))) : freshness());
  const noteText = (n) => [`${n.title} · ${n.sub}`, `Situation au ${n.at}`, ...n.blocks.map(([h, xs]) => `${h} : ${xs.join(' ')}`),
    `Sources : ${sourcesOf(n).map(([k, v]) => `${k} ${v}`).join(' ; ') || 'liste interne de sites publics, sans date par site'}.`].join('\n');

  const openFiche = (kind, key, silent) => {
    let n = null;
    if (kind === 'dept') { const a = S.agg.get(key); if (a) n = deptNote(a); }
    if (kind === 'air') { const a = airOf(key); if (a) n = airNote(a); }
    if (kind === 'base') { const b = S.bases.find((x) => x.properties.id === key); if (b) n = baseNote(b); }
    if (!n) { if (!silent) closeFiche(); return; }
    S.fiche = { kind, key };
    const lvl = n.level ? `<span class="mqs-lvl" style="background:${L1[n.level]};color:${n.level === 'jaune' ? '#1a1a1a' : '#fff'}">${WORD[n.level]}</span>` : '';
    panel.innerHTML = `<header><div><h3>${esc(n.title)}</h3><div class="mqs-sub">${lvl}${esc(n.sub)}</div><div class="mqs-at">Situation au ${n.at}</div></div>`
      + `<button class="mqs-x" aria-label="Fermer">×</button></header>`
      + n.blocks.map(([h, xs]) => sec(h, li(xs.map(esc)) + (h === 'Évolution' && n.spark ? spark(n.spark) : ''))).join('')
      + sec('Sources et confiance', sourcesOf(n).length === 0 ? '<ul><li>Liste interne de sites publics, sans date par site.</li></ul>' : `<table>${sourcesOf(n).map(([k, v, st]) => `<tr><td><i class="mqs-src-${st}"></i>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>`)
      + `<footer><button class="mqs-copy">Copier pour la note</button><span class="mqs-copied"></span></footer>`;
    panel.style.display = 'flex';
    panel.querySelector('.mqs-x').onclick = closeFiche;
    panel.querySelector('.mqs-copy').onclick = async () => {
      try { await navigator.clipboard.writeText(noteText(n)); panel.querySelector('.mqs-copied').textContent = 'Copié'; } catch (e) { panel.querySelector('.mqs-copied').textContent = 'Copie refusée par le navigateur'; }
    };
  };
  const closeFiche = () => { panel.style.display = 'none'; S.fiche = null; };

  // ─── Légende « Lire la carte » ───
  const legend = document.createElement('div');
  legend.className = 'mqs-legend';
  const swatch = (color, shape) => `<i class="mqs-sw mqs-sw-${shape}" style="--c:${color}"></i>`;
  const icon = (name, color, bg) => `<span class="mqs-ic"${bg ? ` style="background:${bg};border-color:${bg}"` : ''}>${fmIcon(name, { size: 14 }).replace('<svg', `<svg style="color:${color ?? INK}"`)}</span>`;
  const renderLegend = () => {
    const open = legend.dataset.open !== 'false';
    legend.innerHTML = `<button class="mqs-leg-toggle">${open ? 'Masquer la légende' : 'Lire la carte'}</button>` + (open ? `
      <h5>Couleur de la couche = catégorie</h5>
      <div class="mqs-row">${icon('shield', '#fff', CAT.defense)}Défense : sites, aéronefs français ${swatch(CAT.defenseOther, 'disc')} autres pays</div>
      <div class="mqs-row">${swatch(CAT.cables, 'line')}Connectivité : câbles sous-marins et atterrages</div>
      <div class="mqs-row">${swatch(CAT.telecom, 'ring')}Télécoms mobiles : sites coupés, compte par département</div>
      <div class="mqs-row">${swatch(CAT.internet, 'line')}Internet : coupure terminée depuis moins de 7${NB}jours</div>
      <div class="mqs-row">${icon('cloud', '#fff', CAT.cloud)}Cloud et hébergement : centres de données</div>
      <h5>Rouge, orange, jaune = état anormal, sur toute couche</h5>
      <div class="mqs-row">${swatch(L1.jaune, 'disc')}Vigilance · ${swatch(L1.orange, 'disc')}Alerte · ${swatch(L1.rouge, 'disc')}Crise</div>
      <div class="mqs-row mqs-note">Télécoms : ${T.join(' / ')} sites coupés depuis moins de 24${NB}h dans le département ; orange aussi pour une coupure Internet en cours.</div>
      <h5>Taille = nombre ; orientation = cap</h5>
      <div class="mqs-row"><span class="mqs-chev" style="color:${CAT.defense}">▲</span>Aéronef militaire orienté selon son cap, nom et immatriculation affichés</div>
      <h5>Trait blanc pointillé = zone de défense et de sécurité</h5>
      <div class="mqs-row mqs-note">Pastilles en haut : un clic met la couche en avant (cumulable), le survol la montre un instant.</div>
      <h5>Sources</h5>${freshness().map(([k, v, st]) => `<div class="mqs-row mqs-src"><i class="mqs-src-${st}"></i><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}` : '');
    legend.querySelector('.mqs-leg-toggle').onclick = () => { legend.dataset.open = String(!open); renderLegend(); };
  };

  // ─── Encart cyber : jamais critique, jamais sur la carte ───
  const cyber = document.createElement('div');
  cyber.className = 'mqs-cyber';
  const renderCyber = () => {
    const c = S.data.cyber?.certfr;
    const open = (c?.alerts ?? []).filter((x) => x.status === 'en-cours');
    const exploited = open.filter((x) => x.exploited).length;
    cyber.innerHTML = `<div class="mqs-cy-h">${icon('shield', open.length ? L1.jaune : MUTE)}<b>Cyber</b><span>${open.length ? `${open.length}${NB}alertes CERT-FR en cours, dont ${exploited}${NB}exploitées` : 'aucune alerte CERT-FR en cours'}</span></div>`
      + (open.length ? `<div class="mqs-cy-l">${open.slice(0, 3).map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a>`).join('')}</div>` : '')
      + `<div class="mqs-cy-s">Hors carte : une alerte nationale n’a pas de lieu. Plafond : vigilance (jaune).</div>`;
  };

  const css = `
  .maplibregl-popup, .military-tooltip, .wm-popup, .deck-tooltip { display: none !important; }
  .mqs-pop { position: absolute; left: 0; top: 0; z-index: 30; pointer-events: none; display: none; background: var(--bg-surface, #14161c); border: 1px solid var(--border-color, #2a2e37);
    border-radius: 8px; padding: 10px 12px; box-shadow: 0 8px 24px rgba(0,0,0,.5); }
  .mqs-fiche { position: absolute; right: 12px; top: 110px; bottom: 64px; width: 370px; z-index: 31; display: none; flex-direction: column; gap: 10px; overflow-y: auto;
    background: #12141a; border: 1px solid #2a2e37; border-radius: 10px; padding: 14px 16px; color: #e8e8ec; font-size: 12.5px; line-height: 1.45; box-shadow: 0 10px 30px rgba(0,0,0,.55); }
  .mqs-fiche header { display: flex; justify-content: space-between; gap: 8px; } .mqs-fiche h3 { margin: 0; font-size: 16px; }
  .mqs-sub { color: #aab0bc; margin-top: 3px; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; } .mqs-at { color: #6e6e80; font-size: 11px; margin-top: 2px; }
  .mqs-lvl { border-radius: 4px; padding: 0 6px; font-weight: 600; font-size: 11px; }
  .mqs-x { background: none; border: 0; color: #9898a8; font-size: 20px; cursor: pointer; line-height: 1; }
  .mqs-fiche h4 { margin: 0 0 4px; font-size: 11px; color: #9aa1ae; font-weight: 600; letter-spacing: .03em; }
  .mqs-fiche ul { margin: 0; padding-left: 16px; } .mqs-fiche li { margin: 2px 0; }
  .mqs-fiche table { width: 100%; border-collapse: collapse; } .mqs-fiche td { padding: 2px 0; vertical-align: top; } .mqs-fiche td:first-child { color: #9898a8; white-space: nowrap; padding-right: 10px; }
  .mqs-fiche footer { margin-top: auto; display: flex; align-items: center; gap: 10px; padding-top: 8px; border-top: 1px solid #23262e; }
  .mqs-copy { background: #e8e8ec; color: #111; border: 0; border-radius: 6px; padding: 6px 12px; font-weight: 600; cursor: pointer; } .mqs-copied { color: #9898a8; }
  .mqs-spark { width: 100%; height: 44px; margin-top: 6px; } .mqs-spark-cap { color: #6e6e80; font-size: 11px; }
  .mqs-legend { position: absolute; left: 12px; bottom: 28px; z-index: 29; width: 300px; max-height: calc(100% - 140px); overflow-y: auto; background: rgba(18,20,26,.96); border: 1px solid #2a2e37;
    border-radius: 10px; padding: 10px 12px; color: #d9dde5; font-size: 11.5px; }
  .mqs-legend h5 { margin: 10px 0 4px; font-size: 11px; color: #9aa1ae; font-weight: 600; } .mqs-row { display: flex; align-items: center; gap: 6px; margin: 3px 0; }
  .mqs-leg-toggle { background: #1c2029; color: #e8e8ec; border: 1px solid #2a2e37; border-radius: 6px; padding: 3px 10px; cursor: pointer; font-size: 11.5px; }
  .mqs-sw { display: inline-block; flex: 0 0 auto; } .mqs-sw-disc { width: 12px; height: 12px; border-radius: 50%; background: var(--c); box-shadow: 0 0 0 1.5px #05060a; }
  .mqs-sw-none { width: 12px; height: 12px; border-radius: 50%; border: 1px dashed #4a4f5c; }
  .mqs-sw-line { width: 22px; height: 0; border-top: 2px solid var(--c); } .mqs-sw-dash { width: 22px; height: 0; border-top: 2px dashed var(--c); }
  .mqs-ic { display: inline-flex; width: 18px; height: 18px; border-radius: 50%; background: #161a22; border: 1.5px solid #8a93a6; align-items: center; justify-content: center; }
  .mqs-ic svg { width: 11px; height: 11px; }
  .mqs-chev { color: #fff; font-size: 11px; } .mqs-chev-o { color: transparent; -webkit-text-stroke: 1px #fff; }
  .mqs-src span { color: #9898a8; flex: 0 0 auto; } .mqs-src b { font-weight: 500; margin-left: auto; text-align: right; }
  [class^="mqs-src-"] { display: inline-block; width: 8px; height: 8px; border-radius: 50%; flex: 0 0 8px; margin-right: 4px; }
  .mqs-src-ok { background: #6e7585; } .mqs-src-part { background: transparent; border: 1.5px solid #9aa1ae; } .mqs-src-ko { background: repeating-linear-gradient(45deg, #9aa1ae 0 2px, transparent 2px 4px); border: 1px solid #9aa1ae; }
  .mqs-cyber { position: absolute; right: 12px; top: 110px; z-index: 29; width: 300px; background: rgba(18,20,26,.96); border: 1px solid #2a2e37; border-radius: 10px; padding: 8px 12px; color: #d9dde5; font-size: 11.5px; }
  .mqs-cy-h { display: flex; align-items: center; gap: 6px; } .mqs-cy-h span { color: #aab0bc; }
  .mqs-cy-l a { display: block; color: #d9dde5; text-decoration: none; margin: 3px 0 0 24px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } .mqs-cy-l a:hover { text-decoration: underline; }
  .mqs-cy-s { color: #6e6e80; font-size: 10.5px; margin-top: 4px; }
  .mqs-sw-ring { width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--c); background: #05060a; }
  .mqs-note { color: #9898a8; font-size: 11px; }
  .mqs-cyber.is-focus { border-color: #ffcc00; box-shadow: 0 0 0 2px rgba(255,204,0,.35); } .mqs-cyber.is-dim { opacity: .35; }
  .mqs-chip { display: inline-flex; align-items: center; gap: 5px; background: #1c2029; color: #d9dde5; border: 1px solid #2a2e37; border-radius: 999px; padding: 2px 10px 2px 3px; cursor: pointer; font-size: 11.5px; }
  .mqs-chip[aria-pressed="true"] { background: #e8e8ec; color: #111; } .mqs-chip[aria-pressed="true"] .mqs-ic { border-color: #111; }
  .mqs-chip-h { color: #6e6e80; font-size: 10.5px; padding: 0 4px; }
  `;

  const start = async () => {
    for (let i = 0; i < 200 && !window._franceMonitorMap; i += 1) await wait(100);
    S.m = window._franceMonitorMap;
    ({ fmIcon } = await import('/src/components/shared/icons.ts'));
    // Thème Sécurité et défense
    for (let i = 0; i < 60; i += 1) {
      const b = document.querySelector('button.tb-theme[data-theme="security"]');
      if (b && b.getAttribute('aria-pressed') === 'true') break;
      if (b) b.click();
      await wait(500);
    }
    for (let i = 0; i < 120 && !S.m.getLayer('military-bases-circle'); i += 1) await wait(250);
    const [geo, deptShapes] = await Promise.all([getJson('/maquette-securite-geo.json'), getJson('/data/departements.geojson')]);
    S.geo = { zones: geo.zones, deptShapes: deptShapes.features };
    S.depts = geo.depts;
    const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
    const host = S.m.getContainer();
    host.append(pop, panel, legend, cyber);
    wireChips();
    // Sites de défense : lus dans la source de la carte (liste interne)
    for (let i = 0; i < 40; i += 1) {
      const src = S.m.getSource('military-bases-src');
      const data = src && (await src.getData());
      if (data?.features?.length) { S.bases = data.features; break; }
      await wait(500);
    }
    S.bases ??= [];
    const load = async () => {
      const [telecom, internet, military, cablesWatch, gnss, cyberData, cloud] = await Promise.all(['/api/outages/telecom', '/api/outages/internet', '/api/sovereignty/military',
        '/api/sovereignty/cables-watch', '/api/sovereignty/gnss', '/api/sovereignty/cyber', '/api/outages/cloud'].map(getJson));
      S.data = { telecom, internet, military, cablesWatch, gnss, cyber: cyberData, cloud };
      await draw();
    };
    await load();
    setInterval(load, 5 * 60 * 1000);
    S.m.on('idle', calm);
    S.m.on('move', placePop);
    S.m.on('mousemove', onMove);
    S.m.getCanvas().addEventListener('mouseleave', () => { pop.style.display = 'none'; popAt = null; S.hoverKey = null; setDeptHover(null); });
    // Clic : la fiche de la maquette remplace les fenêtres et déplacements de l'app (capturé avant MapLibre).
    host.addEventListener('click', (e) => {
      if (e.target !== S.m.getCanvas()) return;
      e.stopPropagation();
      const r = S.m.getCanvas().getBoundingClientRect();
      const hit = pick([e.clientX - r.left, e.clientY - r.top]);
      if (!hit) { closeFiche(); return; }
      pop.style.display = 'none'; popAt = null; S.hoverKey = null;
      if (hit.kind === 'dept' || hit.kind === 'air' || hit.kind === 'base') openFiche(hit.kind, hit.id);
      else if (hit.kind === 'site') { const s = (S.data.telecom?.sites ?? []).find((x) => x.id === hit.id); if (s) openFiche('dept', s.dept); }
    }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeFiche(); pop.style.display = 'none'; } });
    window.__mqs = S;
    console.log('[maquette-securite] prête', { seuils: T, depts: [...S.agg.values()].filter((a) => a.level !== 'vert').length });
  };
  start();
})();
