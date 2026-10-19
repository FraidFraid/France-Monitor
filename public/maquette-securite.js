// Carte « Sécurité et défense » (17/10/2026) : chargée par DeckGLMap, active seulement quand l'onglet Sécurité et défense est choisi.
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
  const dur = (sec) => { const m = Math.round((sec ?? 0) / 60); return m < 60 ? `${m}${NB}min` : `${Math.floor(m / 60)}${NB}h${m % 60 ? `${NB}${pad(m % 60)}` : ''}`; };
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
  // Pictos absents du jeu de l'app (tracé Lucide « server »).
  const EXTRA = { server: '<rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/>' };
  const glyph = (name, color) => EXTRA[name] ? `<g fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${EXTRA[name]}</g>` : fmIcon(name, { size: 24 }).replace(/^<svg[^>]*>/, `<g fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">`).replace('</svg>', '</g>');
  const disc = (name, ring, fill, dashed) => image(`mqs-${name}-${ring}-${fill}-${dashed ? 'd' : 'p'}`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44"><circle cx="22" cy="22" r="19" fill="${fill}" stroke="${ring}" stroke-width="2.5" ${dashed ? 'stroke-dasharray="5 4"' : ''}/>`
    + `<g transform="translate(11 11) scale(0.9167)">${glyph(name, ring === MUTE ? MUTE : LIGHT_FILL.has(fill) ? '#0b1020' : '#ffffff')}</g></svg>`, 44);
  // Aéronef : chevron orienté selon le cap (plein = français, creux = autre pays) ; sans cap : rond.
  // Aéronef : chevron orienté selon le cap, à la couleur de sa famille (France, autre pays, hors de France) ; sans cap : rond.
  const chevron = (k, color) => image(`mqs-chev-${k}`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><path d="M20 4 L32 34 L20 27 L8 34 Z" fill="${color}" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/></svg>`, 40);
  const SHAPE = { air: 'M14 3 L25 24 L3 24 Z', navy: 'M5 5 H23 V23 H5 Z', army: 'M14 2 L26 14 L14 26 L2 14 Z', joint: 'M14 3 A11 11 0 1 1 13.99 3 Z', other: 'M14 3 L25 11 L21 24 L7 24 L3 11 Z' };
  const shape = (t, solid, fill, stroke) => image(`mqs-shp-${t}-${solid ? 'p' : 'd'}-${fill}`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><path d="${SHAPE[t]}" fill="${fill}" stroke="${stroke}" stroke-width="2.2" stroke-linejoin="round" ${solid ? '' : 'stroke-dasharray="3.5 2.5"'}/></svg>`, 28);
  // Site mobile coupé : disque magenta plein, initiale de l'opérateur, anneau à la couleur d'état du département.
  const OP_LETTER = { Orange: 'O', SFR: 'S', 'Bouygues Telecom': 'B', Free: 'F' };
  const opDisc = (L, ring) => image(`mqs-op-${L}-${ring}`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44"><circle cx="22" cy="22" r="18.5" fill="#e879f9" stroke="${ring}" stroke-width="${ring === '#0b1020' ? 2 : 4}"/>`
    + `<text x="22" y="29.5" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="21" font-weight="700" fill="#0b1020">${L}</text></svg>`, 44);
  const noHeading = (k, color) => image(`mqs-nohd-${k}`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="11" fill="${color}" stroke="#ffffff" stroke-width="2"/></svg>`, 40);

  // ─── Couleurs de catégorie : franches, une par couche, jamais celles de l'échelle L1 (réservées aux états) ───
  // Sites de défense : une couleur par armée en plus de la forme (bleu ciel = air, bleu marine = mer, sable = terre, blanc = interarmées, ardoise = autres).
  const BASE_HEX = { air: '#7cc4ff', navy: '#2f6bff', army: '#c8a165', joint: '#f1f5f9', other: '#94a3b8' };
  const LIGHT_FILL = new Set(['#7cc4ff', '#c8a165', '#f1f5f9']);
  const CAT = { defense: '#4a9eff', defenseOther: '#b388ff', cables: '#22d3ee', telecom: '#e879f9', internet: '#2dd4bf', cloud: '#818cf8', dc: '#f472b6', hacktivist: '#bef264' };
  // Manifestations : rose = catégorie (annoncée en anneau, rapportée en plein), rouge L1 = heurts (anormal).
  const PROT = { annonce: '#f9a8d4', signale: '#ec4899' };
  // Criminalité : statistique annuelle, jamais les couleurs d'alerte ; rampe violette, plus clair = plus élevé que la moyenne nationale.
  const CRIME_RAMP = [[2, '#f5f3ff', '2 fois la moyenne ou plus'], [1.6, '#c4b5fd', '1,6 à 2 fois'], [1.25, '#8b5cf6', '1,25 à 1,6 fois'], [0.8, '#5b4a9e', 'proche de la moyenne'], [0, '#3a3456', 'sous la moyenne']];
  const crimeHex = (ratio) => (ratio == null ? '#2a2a33' : CRIME_RAMP.find(([t]) => ratio >= t)[1]);
  const fr2 = (x) => (x == null ? 'n.d.' : x.toFixed(x >= 10 ? 0 : 1).replace('.', ','));
  // ─── Calques d'origine : remplacés par ceux de la maquette ───
  const HIDE = ['out-telecom-long', 'out-telecom-recent', 'out-internet-fill', 'out-internet-line', 'sov-aircraft', 'sov-aircraft-label', 'sov-aircraft-abroad',
    'military-bases-circle', 'military-bases-label', 'submarine-cables-glow', 'submarine-cables-core', 'out-cloud-ref', 'out-cloud-zones', 'submarine-cables-landing',
    'protests', 'protests-label', 'crime-city', 'crime-city-label', 'crime-fill', 'crime-line'];
  // Calques de détail réservés à leur pastille.
  const PILL_ONLY = { 'mqs-cable-label': 'subseaCables', 'mqs-low-disc': 'outagesTelecom', 'mqs-low-count': 'outagesTelecom', 'mqs-inet-past': 'outagesInternet', 'mqs-inet-past-fill': 'outagesInternet', 'mqs-inet-disc': 'outagesInternet', 'mqs-inet-label': 'outagesInternet',
    'mqs-cz-fill': 'subseaCables', 'mqs-cz-line': 'subseaCables', 'mqs-anch-line': 'subseaCables', 'mqs-landings-label': ['subseaCables', 'cyber'],
    'mqs-dc-ref': ['outagesCloud', 'cyber'], 'mqs-bases-closed': 'military' };
  // Aucune pastille active : toutes les couches sont affichées ; une pastille active : sa couche en avant, le détail des autres retiré.
  const isSec = () => document.querySelector('button.tb-theme[data-theme="security"]')?.getAttribute('aria-pressed') === 'true';
  const allMode = () => S.focus.size === 0 && !preview;
  const isOn = (k) => allMode() || S.focus.has(k) || preview === k;
  const pill = (k) => S.focus.has(k) || preview === k;
  const calm = () => {
    const m = S.m;
    const P = (id, k, v) => { try { if (m.getLayer(id) && JSON.stringify(m.getPaintProperty(id, k)) !== JSON.stringify(v)) m.setPaintProperty(id, k, v); } catch (e) { /* calque d'un autre type */ } };
    const V = (id, on) => { if (m.getLayer(id) && m.getLayoutProperty(id, 'visibility') !== (on ? 'visible' : 'none')) m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); };
    const T_ = (id, v) => { if (m.getLayer(id) && JSON.stringify(m.getLayoutProperty(id, 'text-field')) !== JSON.stringify(v)) m.setLayoutProperty(id, 'text-field', v); };
    // Hors de l'onglet Sécurité : la carte de l'application reprend la main (calques, bulles, opacités).
    const sec = isSec();
    document.body.classList.toggle('mqs-on', sec);
    legend.style.display = sec ? '' : 'none'; cyber.style.display = sec ? '' : 'none';
    if (!sec) {
      if (S.wasSec) {
        for (const l of m.getStyle().layers) if (l.id.startsWith('mqs-')) V(l.id, false);
        pop.style.display = 'none'; popAt = null; closeFiche(); S.focus.clear(); preview = null;
        for (const [k, v] of baseOpacity) { const [id, prop] = k.split('|'); try { if (m.getLayer(id)) m.setPaintProperty(id, prop, v); } catch (e) { /* propriété absente */ } }
      }
      S.wasSec = false; return;
    }
    S.wasSec = true;
    for (const id of HIDE) V(id, false);
    // L'app masque les calques qu'elle ne connaît pas : ceux de la maquette sont remis visibles.
    // Hiérarchie : par défaut, l'anormal et les infrastructures ; le détail de chaque couche n'apparaît qu'avec sa pastille (clic ou survol).
    for (const l of m.getStyle().layers) if (l.id.startsWith('mqs-')) V(l.id, !PILL_ONLY[l.id] || [].concat(PILL_ONLY[l.id]).some(isOn));
    // Câbles : cyan franc (catégorie), sans halo néon ; ils passeraient à la couleur L1 sur alerte de la veille.
    if (!baseOpacity.size) {
      // Hors service selon le Shom : gris, jamais une alerte.
      P('submarine-cables-line', 'line-color', ['case', ['==', ['get', 'outOfService'], true], '#6e7585', CAT.cables]); P('submarine-cables-line', 'line-opacity', 0.85);
      P('submarine-cables-line', 'line-width', ['interpolate', ['linear'], ['zoom'], 4, 1.2, 8, 2.2]);
      P('submarine-cables-landing', 'circle-color', CAT.cables); P('submarine-cables-landing', 'circle-radius', ['interpolate', ['linear'], ['zoom'], 4, 2.5, 8, 4.5]);
      P('submarine-cables-landing', 'circle-stroke-width', 1); P('submarine-cables-landing', 'circle-stroke-color', '#05060a');
    }
    // Pression par département (score global) : contour toujours, remplissage quand sa pastille est allumée.
    // Pression par département (score global) : aplat léger en fond quand tout est affiché, plein avec sa pastille ; les symboles restent au-dessus.
    V('mqs-low-disc', false); V('mqs-low-count', false); V('mqs-inet-past', false);
    V('isnr-line', false); V('isnr-fill', isOn('stability'));
    // Manifestations : toujours (l'actualité du jour). Criminalité (statistique annuelle SSMSI) : villes par défaut, aplat des départements avec sa pastille seulement,
    // pour ne pas confondre son contour avec celui du niveau télécoms.
    // Sans pastille : toutes les couches, criminalité comprise (aplat des départements + villes à 2 fois la moyenne) ; le contour reste réservé à la pastille.
    V('mqs-crime-city', isOn('crime') && !pill('crime')); V('mqs-crime-c', pill('crime')); V('mqs-crime-c-label', pill('crime')); V('mqs-crime-d-fill', isOn('crime')); V('mqs-crime-d-line', pill('crime'));
    P('mqs-crime-d-fill', 'fill-opacity', pill('crime') ? ['get', 'op'] : 0.12);
    T_('mqs-ddos-label', pill('cyber') ? ['get', 'label'] : ['case', ['get', 'recent'], ['get', 'label'], '']);
    T_('mqs-prot-label', pill('protests') || pill('pedestrianFlows') ? ['get', 'label'] : ['case', ['any', ['>=', ['get', 'n'], 20], ['==', ['get', 'fc'], 1]], ['get', 'label'], '']);
    // Les points Foule estimée déjà portés par une annonce ne sont pas redessinés (un seul point par rassemblement) ; restent ceux dont l'annonce n'est plus dans la couche.
    const protFilter = null;
    const othersFilter = ['all', ['==', ['get', 'kind'], 'autre'], ['!', ['in', ['get', 'id'], ['literal', S.fluxMatched ?? []]]]];
    // Filtres posés seulement quand ils changent (calm tourne à chaque « idle » : un setFilter à chaque fois bouclerait).
    const key = JSON.stringify([protFilter, S.fluxMatched, Boolean(m.getLayer('mqs-prot')), Boolean(m.getLayer('flux-pietons-others'))]);
    if (S.fluxFilterKey !== key) {
      S.fluxFilterKey = key;
      try {
        for (const id of ['mqs-prot', 'mqs-prot-label']) if (m.getLayer(id)) m.setFilter(id, protFilter);
        for (const id of ['flux-pietons-others', 'flux-pietons-others-label']) if (m.getLayer(id)) m.setFilter(id, othersFilter);
      } catch (e) { /* calque absent */ }
    }
    P('isnr-fill', 'fill-opacity', S.focus.has('stability') || preview === 'stability' ? 0.65 : 0.2);
    // Détail porté au premier plan par une pastille : sites télécoms et référentiel cloud dès la vue France.
    const zr = (id, min) => { try { if (m.getLayer(id) && m.getLayer(id).minzoom !== min) m.setLayerZoomRange(id, min, 24); } catch (e) { /* calque absent */ } };
    zr('mqs-sites-recent', isOn('outagesTelecom') ? 0 : 7);
    zr('mqs-sites-long', isOn('outagesTelecom') ? 0 : 8);
    // Cloud : sans pastille, seuls les sites en incident ; avec Cloud ou Cyber, tous les sites et les centres de données, nommés.
    const cloudPill = pill('outagesCloud') || pill('cyber');
    if (m.getLayer('mqs-cloud-sym')) m.setFilter('mqs-cloud-sym', cloudPill ? null : ['!=', ['get', 'status'], 'vert']);
    T_('mqs-cloud-sym', cloudPill ? ['get', 'label'] : '');
    T_('mqs-dc-ref', cloudPill ? ['get', 'name'] : '');
    if (m.getLayer('mqs-bases-sym')) m.setLayoutProperty('mqs-bases-sym', 'text-field', isOn('military') ? ['get', 'name'] : ['step', ['zoom'], '', 8, ['get', 'name']]);
  };

  // ─── Vérification des sites de la liste interne (17/10/2026) ───
  // La liste interne porte désormais sa source publique, sa date de vérification et ses fermetures (relecture du 17/10/2026).
  const OSM_KINDS = new Set(['airfield', 'base', 'barracks', 'naval_base', 'range', 'training_area', 'office', 'school', 'yes']);
  const km = (a, b) => { const r = Math.PI / 180, dLat = (b[1] - a[1]) * r, dLon = (b[0] - a[0]) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };
  const audit = () => {
    S.audit = new Map();
    const osm = (S.osm?.items ?? []).filter((i) => OSM_KINDS.has(i.kind));
    for (const b of S.bases) {
      const id = b.properties.id, c = b.geometry.coordinates;
      let best = null, d = Infinity;
      for (const o of osm) { const x = km(c, [o.lon, o.lat]); if (x < d) { d = x; best = o; } }
      const db = b.properties;
      const status = db.status === 'closed' ? 'ferme' : db.source ? 'source' : 'seul';
      S.audit.set(id, { status, note: db.note ?? null, source: db.source ?? null, checkedAt: db.checkedAt ?? null, osm: d <= 3 ? best : null, osmKm: d, dept: deptCodeAt(c) });
    }
  };
  const ZONE_SEAT = { Paris: 'Paris', Nord: 'Lille', Est: 'Metz', Ouest: 'Rennes', 'Sud-Ouest': 'Bordeaux', Sud: 'Marseille', 'Sud-Est': 'Lyon' };
  const CARD = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  const cardinal = (t) => CARD[Math.round(((t % 360) + 360) % 360 / 45) % 8];
  const clock = (iso) => { if (!iso) return 'n.d.'; const p = Object.fromEntries(new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value])); return `${p.hour}${NB}h${NB}${p.minute}`; };
  const minsAgo = (iso) => { const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 1 ? 'à l’instant' : m < 60 ? `il y a ${m}${NB}min` : `il y a ${Math.round(m / 60)}${NB}h`; };
  const IMPACT = { minor: 'mineur', major: 'majeur', critical: 'critique', none: 'aucun' };
  // Atterrages regroupés par commune : la taille dit combien de câbles arrivent au même endroit (concentration du risque).
  const landingsByPlace = () => {
    const g = new Map();
    for (const c of S.cablesFile?.cables ?? []) for (const l of c.landings) {
      const k = `${l.commune}|${l.dept}`;
      const x = g.get(k) ?? { commune: l.commune, dept: l.dept, pts: [], cables: new Map() };
      x.pts.push([l.lon, l.lat]); x.cables.set(c.id, c); g.set(k, x);
    }
    const tg = (S.world?.landings ?? []).filter((l) => l.country === 'France');
    return [...g.values()].map((x) => { const at = [x.pts.reduce((s, p) => s + p[0], 0) / x.pts.length, x.pts.reduce((s, p) => s + p[1], 0) / x.pts.length];
      const near = tg.filter((l) => km(at, l.at) <= 20).flatMap((l) => l.cables);
      return { ...x, at, n: x.cables.size, tg: [...new Set(near)].map((id) => S.world.cables[id]).filter(Boolean) }; });
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
  const setData = (id, data) => { const s = S.m.getSource(id); if (s) s.setData(data); else S.m.addSource(id, { type: 'geojson', data, ...(id === 'mqs-depts' ? { promoteId: 'code' } : {}) }); };
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
      inet: (S.agg.get(f.properties.code)?.inet.length ?? 0) > 0, inetPast: (S.agg.get(f.properties.code)?.inetPast.length ?? 0) > 0,
      level: S.agg.get(f.properties.code)?.level ?? 'vert', color: L1[S.agg.get(f.properties.code)?.level ?? 'vert'] } }))));
    // Symboles agrégés : rien quand tout est normal
    setData('mqs-agg', fc([...S.agg.values()].filter((a) => a.level !== 'vert').map((a) => pt(a.at, { code: a.code, n: a.sites.length, level: a.level, color: L1[a.level] }))));
    // Sous le seuil : le compte reste lisible, à la couleur de la couche (information, pas alerte)
    setData('mqs-low', fc([...S.agg.values()].filter((a) => a.level === 'vert' && a.sites.length > 0).map((a) => pt(a.at, { code: a.code, n: a.sites.length }))));
    // Détail au zoom : sites récents (bord à la couleur du département), stock ancien en semis gris
    const tel = S.data.telecom?.sites ?? [];
    setData('mqs-sites', fc(tel.filter((s) => s.lat && s.lon).map((s) => pt([s.lon, s.lat], { id: s.id, cls: s.cls, op: OP_LETTER[s.operator] ?? 'X',
      ring: s.cls === 'recente' && (S.agg.get(s.dept)?.level ?? 'vert') !== 'vert' ? L1[S.agg.get(s.dept).level] : '#0b1020' }))));
    // Internet : un repère par département touché sur 7 jours (durée cumulée), orange plein si une coupure est en cours.
    setData('mqs-inet-pts', fc([...S.agg.values()].filter((a) => a.inet.length || a.inetPast.length).map((a) => { const sec = [...a.inet, ...a.inetPast].reduce((n, e) => n + (e.durationSec ?? 0), 0);
      return pt(a.at, { code: a.code, ongoing: a.inet.length > 0, label: a.inet.length ? 'en cours' : dur(sec) }); })));
    // Aéronefs au-dessus de la France : identité complète (O10)
    const mil = S.data.military;
    setData('mqs-air', fc([...(mil?.aircraft ?? []).map((a) => ({ ...a, abroad: false })), ...(mil?.abroad ?? []).map((a) => ({ ...a, abroad: true }))]
      .filter((a) => a.lat != null && a.lon != null).map((a) => pt([a.lon, a.lat], { hex: a.hex, fr: a.family === 'francais', abroad: a.abroad, track: a.track ?? 0,
        hasTrack: a.track !== null && a.track !== undefined, label: [a.callsign, a.registration].filter(Boolean).join(' · ') }))));
    // Sites de défense : forme = armée ; trait plein = source publique citée, pointillé = sans source ; fermés à part (gris).
    setData('mqs-bases', fc(S.bases.map((b) => { const au = S.audit.get(b.properties.id);
      const t = ['air', 'navy', 'army', 'joint'].includes(b.properties.type) ? b.properties.type : 'other';
      return pt(b.geometry.coordinates, { id: b.properties.id, name: b.properties.name, type: t, color: BASE_HEX[t], status: au?.status ?? 'seul', solid: au?.status === 'source' }); })));
    // Atterrages par commune, zones de protection des câbles et mouillages qui les recoupent (Shom)
    S.landings = landingsByPlace();
    // Manifestations : annoncée (agenda), rapportée sans heurts, heurts ; taille = articles de presse sur 24 h.
    S.prot = (S.data.protests?.items ?? []).filter((x) => x.lat != null && x.lon != null);
    // Fusion avec Flux piétons : l'annonce dont flux_osint a tiré une prévision porte un anneau blanc et sa foule estimée.
    const fluxEvents = S.data.flux?.evenements ?? [];
    const fluxOf = (x) => fluxEvents.find((e) => e.evenement === x.id || e.evenement.startsWith(`${x.id}:`)) ?? null;
    S.protFlux = new Map(S.prot.map((x) => [x.id, fluxOf(x)]).filter(([, e]) => e));
    S.fluxMatched = [...new Set([...S.protFlux.values()].map((e) => e.id))];
    setData('mqs-prot', fc(S.prot.map((x, i) => { const ev = S.protFlux.get(x.id);
      return pt([x.lon, x.lat], { i, kind: x.status === 'annonce' ? 'annonce' : x.violent ? 'heurts' : 'signale', n: x.articleCount ?? (x.articles ?? []).length, fc: ev ? 1 : 0,
        label: `${x.city ?? x.edition ?? ''}${x.participants ? ` · ${num(x.participants)}${NB}pers.` : ''}${ev ? ` · ≈${NB}${num(Math.round(ev.affluence.p50))} estimées` : ''}` }); })));
    // Cibles françaises des hacktivistes pro-russes (NoName057(16)) : lieu sûr seulement (préfecture d'après gouv.fr, commune au nom exact) ;
    // une cible publiée n'est pas une attaque réussie. Anneau jaune : site présent dans une liste de moins de 24 h.
    S.ddos = ddosPlaces();
    setData('mqs-ddos', fc(S.ddos.map((g, i) => pt(g.at, { i, recent: g.recent, ring: g.level ? L1[g.level] : CAT.hacktivist, n: g.hosts.length,
      label: `${g.name}${g.hosts.length > 1 ? ` · ${g.hosts.length}${NB}sites` : ''}` }))));
    // Criminalité : indicateur du panneau ; villes seulement pour les indicateurs communaux (sinon violences physiques hors famille).
    crimeCompute();
    setData('mqs-crime', fc((S.crime?.cities ?? []).map((c, i) => pt([c.city.lon, c.city.lat], { i, ratio: c.ratio ?? 0, sortKey: Math.round((c.ratio ?? 0) * 100), estimated: c.est,
      color: crimeHex(c.ratio), r: Math.min(15, 3 + 1.6 * Math.log2(Math.max(1, c.city.population / 20000))), label: c.ratio >= 1.6 || c.city.population >= 250000 ? `${c.city.name} · ${fr2(c.ratio)}${NB}×` : '' }))));
    setData('mqs-crime-d', fc((S.geo?.deptShapes ?? []).map((f) => { const d = S.crime?.depts.get(f.properties.code);
      return { ...f, properties: { code: f.properties.code, color: crimeHex(d?.ratio), op: d?.ratio == null ? 0 : d.ratio >= 1.25 ? 0.5 : d.ratio >= 0.8 ? 0.3 : 0.12 } }; })));
    // Départements : indicateur par défaut de la couche (homicides) tant que l'app n'a pas peint le sien.
    setData('mqs-landings', fc(S.landings.map((l, i) => pt(l.at, { i, n: l.n, name: l.n >= 3 ? `${l.commune} · ${l.n}` : '' }))));
    setData('mqs-world', S.world?.routes ? { ...S.world.routes, features: S.world.routes.features.map((f) => ({ ...f, properties: { id: f.properties.id, planned: S.world.cables[f.properties.id]?.planned ?? false } })) } : fc([]));
    // Suite des câbles du Shom au-delà des eaux françaises (OpenStreetMap) et bouts sans suite publiée.
    setData('mqs-suite', fc((S.suite?.features ?? []).map((f, i) => ({ ...f, properties: { ...f.properties, i, disused: f.properties.disused ?? false } }))));
    setData('mqs-world-lp', fc((S.world?.landings ?? []).filter((l) => l.country !== 'France').map((l) => pt(l.at, { id: l.id }))));
    setData('mqs-cz', fc((S.cablesFile?.cableZones ?? []).map((z, i) => ({ type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: z.polygons }, properties: { i } }))));
    setData('mqs-anch', fc((S.cablesFile?.anchorageZones ?? []).map((z, i) => ({ z, i })).filter(({ z }) => z.crossesCableZone)
      .map(({ z, i }) => ({ type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: z.polygons }, properties: { i } }))));
    // Cloud : seules les zones en incident en cours sont dessinées en couleur ; référentiel au zoom
    const cloud = S.data.cloud;
    const inc = new Map();
    for (const i of cloud?.incidents ?? []) if (i.state === 'en-cours') for (const z of i.zones) inc.set(`${i.provider}:${z}`, i);
    // Un symbole par site (Paris, Gravelines, Roubaix…) : les zones des fournisseurs y sont regroupées, l'état est le pire des zones.
    const RANK = { vert: 0, jaune: 1, orange: 2, rouge: 3 };
    const sites = new Map();
    for (const p of cloud?.providers ?? []) for (const z of p.zones ?? []) {
      if (z.lat == null || z.lon == null) continue;
      const k = `${z.lat.toFixed(1)},${z.lon.toFixed(1)}`;
      const s = sites.get(k) ?? { at: [z.lon, z.lat], name: z.label.replace(/\s*\(.*\)$/, '').replace(/^Région parisienne$/, 'Paris'), zones: [] };
      const i = inc.get(`${p.provider}:${z.id}`);
      const status = i ? (i.impact === 'critical' ? 'rouge' : i.impact === 'major' ? 'orange' : 'jaune') : z.status === 'degraded' ? 'jaune' : 'vert';
      s.zones.push({ provider: p.provider, plabel: p.label, z, i, status });
      sites.set(k, s);
    }
    S.cloudSites = [...sites.values()].map((s) => ({ ...s, status: s.zones.reduce((w, z) => (RANK[z.status] > RANK[w] ? z.status : w), 'vert'),
      providers: [...new Set(s.zones.map((z) => z.plabel))] }));
    setData('mqs-cloud', fc(S.cloudSites.map((s, i) => pt(s.at, { i, status: s.status, color: s.status === 'vert' ? '#c7d2fe' : L1[s.status],
      label: `${s.name} · ${s.providers.length > 2 ? `${s.providers.length}${NB}fournisseurs` : s.providers.join(', ')}` }))));
    S.dcDept = new Map((cloud?.reference?.datacenters ?? []).filter((x) => x.lat != null).map((x) => [x.id, deptCodeAt([x.lon, x.lat])]));
    // Centres de données : picto serveur ; trait pointillé = en projet ou en construction.
    setData('mqs-dc', fc((cloud?.reference?.datacenters ?? []).filter((x) => x.lat != null).map((x) => pt([x.lon, x.lat], { id: x.id, name: x.name,
      proj: /projet|construction|fast/i.test(x.stage ?? '') }))));

    if (!m.getLayer('mqs-zones-line')) {
      const ic = {
        air: await disc('plane', '#ffffff', BASE_HEX.air), navy: await disc('anchor', '#ffffff', BASE_HEX.navy), army: await disc('shield', '#ffffff', BASE_HEX.army),
        joint: await disc('swords', '#ffffff', BASE_HEX.joint), other: await disc('landmark', '#ffffff', BASE_HEX.other),
        cloudOk: await disc('cloud', '#ffffff', CAT.cloud), cloudJ: await disc('cloud', L1.jaune, CAT.cloud), cloudO: await disc('cloud', L1.orange, CAT.cloud), cloudR: await disc('cloud', L1.rouge, CAT.cloud),
        dc: await disc('server', '#ffffff', CAT.dc), dcProj: await disc('server', CAT.dc, DARK, true),
      };
      for (const t of Object.keys(SHAPE)) { await shape(t, true, BASE_HEX[t], '#ffffff'); await shape(t, false, BASE_HEX[t], '#ffffff'); await shape(t, false, 'none', '#8a93a6'); }
      const icd = { air: await disc('plane', '#ffffff', BASE_HEX.air, true), navy: await disc('anchor', '#ffffff', BASE_HEX.navy, true), army: await disc('shield', '#ffffff', BASE_HEX.army, true),
        joint: await disc('swords', '#ffffff', BASE_HEX.joint, true), other: await disc('landmark', '#ffffff', BASE_HEX.other, true) };
      for (const L of ['O', 'S', 'B', 'F', 'X']) for (const ring of ['#0b1020', L1.jaune, L1.orange, L1.rouge]) await opDisc(L, ring);
      await chevron('f', CAT.defense); await chevron('o', CAT.defenseOther); await chevron('a', '#8a93a6');
      await noHeading('f', CAT.defense); await noHeading('o', CAT.defenseOther); await noHeading('a', '#8a93a6');
      const b = before();
      m.addLayer({ id: 'mqs-dept-fill', type: 'fill', source: 'mqs-depts', paint: { 'fill-color': '#ffffff', 'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.06, 0] } }, b);
      // Département en anomalie : teinte légère à sa couleur d'état (le niveau reste lisible même quand les disques se touchent, en Île-de-France).
      m.addLayer({ id: 'mqs-dept-level', type: 'fill', source: 'mqs-depts', filter: ['!=', ['get', 'level'], 'vert'], paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0 } }, b);
      m.addLayer({ id: 'mqs-dept-level-line', type: 'line', source: 'mqs-depts', filter: ['!=', ['get', 'level'], 'vert'], paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1.2, 8, 2.4], 'line-opacity': 0.9 } }, b);
      // Tracé complet des câbles qui atterrissent en France (TeleGeography), sous les tracés précis du Shom ; pointillé = câble prévu.
      const under = m.getLayer('submarine-cables-line') ? 'submarine-cables-line' : b;
      m.addLayer({ id: 'mqs-world-line', type: 'line', source: 'mqs-world', filter: ['!', ['get', 'planned']],
        paint: { 'line-color': CAT.cables, 'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.9, 6, 1.4, 9, 2], 'line-opacity': 0.8 } }, under);
      m.addLayer({ id: 'mqs-world-planned', type: 'line', source: 'mqs-world', filter: ['get', 'planned'],
        paint: { 'line-color': CAT.cables, 'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.9, 6, 1.4, 9, 2], 'line-opacity': 0.8, 'line-dasharray': [3, 2.5] } }, under);
      m.addLayer({ id: 'mqs-suite-line', type: 'line', source: 'mqs-suite', filter: ['==', ['get', 'kind'], 'osm'],
        paint: { 'line-color': ['case', ['get', 'disused'], '#6e7585', CAT.cables], 'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.9, 6, 1.4, 9, 2], 'line-opacity': 0.8 } }, under);
      m.addLayer({ id: 'mqs-suite-hit', type: 'line', source: 'mqs-suite', filter: ['==', ['get', 'kind'], 'osm'], paint: { 'line-color': '#000000', 'line-opacity': 0, 'line-width': 10 } }, under);
      m.addLayer({ id: 'mqs-suite-end', type: 'circle', source: 'mqs-suite', filter: ['==', ['get', 'kind'], 'end'],
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 2, 9, 4], 'circle-color': '#05060a', 'circle-stroke-color': '#c7c7cc', 'circle-stroke-width': 1.2 } });
      m.addLayer({ id: 'mqs-world-hit', type: 'line', source: 'mqs-world', paint: { 'line-color': '#000000', 'line-opacity': 0, 'line-width': 10 } }, under);
      m.addLayer({ id: 'mqs-world-lp', type: 'circle', source: 'mqs-world-lp',
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 2, 8, 4], 'circle-color': '#05060a', 'circle-stroke-color': CAT.cables, 'circle-stroke-width': 1.4 } });
      m.addLayer({ id: 'mqs-cz-fill', type: 'fill', source: 'mqs-cz', paint: { 'fill-color': CAT.cables, 'fill-opacity': 0.14 } }, b);
      m.addLayer({ id: 'mqs-cz-line', type: 'line', source: 'mqs-cz', paint: { 'line-color': CAT.cables, 'line-width': 1, 'line-opacity': 0.7 } }, b);
      m.addLayer({ id: 'mqs-anch-line', type: 'line', source: 'mqs-anch', paint: { 'line-color': '#e8e8ec', 'line-width': 1.2, 'line-dasharray': [2, 2], 'line-opacity': 0.85 } }, b);
      m.addLayer({ id: 'mqs-dc-ref', type: 'symbol', source: 'mqs-dc',
        layout: { 'icon-image': ['case', ['get', 'proj'], ic.dcProj, ic.dc], 'icon-size': ['interpolate', ['linear'], ['zoom'], 4, 0.55, 7, 0.7, 11, 0.85], 'icon-allow-overlap': true, 'icon-ignore-placement': true,
          'text-field': '', 'text-size': 9.5, 'text-font': ['Open Sans Semibold'], 'text-variable-anchor': ['top', 'bottom', 'right', 'left'], 'text-radial-offset': 1, 'text-optional': true },
        paint: { 'icon-opacity': 1, 'text-color': CAT.dc, 'text-halo-color': '#0a0a0f', 'text-halo-width': 1.3 } }, b);
      m.addLayer({ id: 'mqs-dept-hover', type: 'line', source: 'mqs-depts', paint: { 'line-color': '#ffffff', 'line-width': 1.5, 'line-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.8, 0] } }, b);
      m.addLayer({ id: 'mqs-inet-past', type: 'line', source: 'mqs-depts', filter: ['all', ['==', ['get', 'inetPast'], true], ['==', ['get', 'inet'], false]],
        paint: { 'line-color': CAT.internet, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1.4, 8, 2.2], 'line-opacity': 0.9, 'line-dasharray': [2, 1.5] } }, b);
      m.addLayer({ id: 'mqs-cable-label', type: 'symbol', source: 'submarine-cables-src',
        layout: { 'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-size': 10, 'text-font': ['Open Sans Semibold'], 'symbol-spacing': 400 },
        paint: { 'text-color': CAT.cables, 'text-halo-color': '#05060a', 'text-halo-width': 1.4 } });
      m.addLayer({ id: 'mqs-inet', type: 'line', source: 'mqs-depts', filter: ['==', ['get', 'inet'], true], paint: { 'line-color': L1.orange, 'line-width': 2.5 } }, b);
      m.addLayer({ id: 'mqs-zones-line', type: 'line', source: 'mqs-zones', paint: { 'line-color': '#e8e8ec', 'line-opacity': 0.5, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1.1, 8, 2], 'line-dasharray': [4, 3] } }, b);
      m.addLayer({ id: 'mqs-zones-label', type: 'symbol', source: 'mqs-zone-labels', maxzoom: 7,
        layout: { 'text-field': ['get', 'name'], 'text-size': 10, 'text-font': ['Open Sans Semibold'], 'text-letter-spacing': 0.12, 'text-transform': 'uppercase', 'text-allow-overlap': false },
        paint: { 'text-color': '#8c93a1', 'text-halo-color': '#0a0a0f', 'text-halo-width': 1.4 } }, b);
      m.addLayer({ id: 'mqs-cloud-sym', type: 'symbol', source: 'mqs-cloud', filter: ['!=', ['get', 'status'], 'vert'],
        layout: { 'icon-image': ['match', ['get', 'status'], 'jaune', ic.cloudJ, 'orange', ic.cloudO, 'rouge', ic.cloudR, ic.cloudOk],
          'icon-size': ['match', ['get', 'status'], 'vert', 0.95, 1.05], 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'symbol-sort-key': ['match', ['get', 'status'], 'vert', 0, 1],
          'text-field': '', 'text-size': 12.5, 'text-font': ['Open Sans Semibold'], 'text-anchor': 'left', 'text-offset': [1.3, 0], 'text-allow-overlap': true },
        paint: { 'icon-opacity': 1, 'text-color': ['get', 'color'], 'text-halo-color': '#0a0a0f', 'text-halo-width': 1.5 } }, b);
      // Pannes anciennes (stock) : semis magenta pâle ; maintenances : gris clair. Jamais une alerte.
      m.addLayer({ id: 'mqs-sites-long', type: 'circle', source: 'mqs-sites', minzoom: 7, filter: ['!=', ['get', 'cls'], 'recente'],
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 1.5, 10, 3], 'circle-color': ['match', ['get', 'cls'], 'maintenance', '#c7c7cc', '#a855f7'], 'circle-opacity': 0.5 } }, b);
      m.addLayer({ id: 'mqs-sites-recent', type: 'symbol', source: 'mqs-sites', minzoom: 7, filter: ['==', ['get', 'cls'], 'recente'],
        layout: { 'icon-image': ['concat', 'mqs-op-', ['get', 'op'], '-', ['get', 'ring']], 'icon-size': ['interpolate', ['linear'], ['zoom'], 4, 0.55, 6, 0.65, 9, 0.75, 12, 0.85],
          'icon-allow-overlap': true, 'icon-ignore-placement': true }, paint: { 'icon-opacity': 1 } }, b);
      m.addLayer({ id: 'mqs-inet-past-fill', type: 'fill', source: 'mqs-depts', filter: ['all', ['==', ['get', 'inetPast'], true], ['==', ['get', 'inet'], false]],
        paint: { 'fill-color': CAT.internet, 'fill-opacity': 0.13 } }, b);
      m.addLayer({ id: 'mqs-landings', type: 'circle', source: 'mqs-landings',
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, ['+', 2.5, ['*', 1.6, ['sqrt', ['get', 'n']]]], 8, ['+', 4, ['*', 2.4, ['sqrt', ['get', 'n']]]]],
          'circle-color': CAT.cables, 'circle-opacity': 0.9, 'circle-stroke-color': '#05060a', 'circle-stroke-width': 1.2 } }, b);
      m.addLayer({ id: 'mqs-landings-label', type: 'symbol', source: 'mqs-landings', filter: ['!=', ['get', 'name'], ''],
        layout: { 'text-field': ['get', 'name'], 'text-size': 10.5, 'text-font': ['Open Sans Semibold'], 'text-offset': [0.9, 0], 'text-anchor': 'left', 'text-optional': true },
        paint: { 'text-color': CAT.cables, 'text-halo-color': '#05060a', 'text-halo-width': 1.4 } }, b);
      // Vue d'ensemble : seulement les villes à 2 fois la moyenne nationale ou plus, en anneau (une statistique annuelle, pas un événement : jamais un disque plein).
      m.addLayer({ id: 'mqs-crime-d-fill', type: 'fill', source: 'mqs-crime-d', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.12 } }, b);
      m.addLayer({ id: 'mqs-crime-d-line', type: 'line', source: 'mqs-crime-d', filter: ['>', ['get', 'op'], 0.2], paint: { 'line-color': ['get', 'color'], 'line-width': 1, 'line-opacity': 0.7 } }, b);
      m.addLayer({ id: 'mqs-crime-c', type: 'circle', source: 'mqs-crime', layout: { 'circle-sort-key': ['get', 'sortKey'] },
        paint: { 'circle-radius': ['get', 'r'], 'circle-color': ['get', 'color'], 'circle-opacity': ['case', ['get', 'estimated'], 0.35, 0.92],
          'circle-stroke-color': '#0a0a0f', 'circle-stroke-width': 1.2 } }, b);
      m.addLayer({ id: 'mqs-crime-c-label', type: 'symbol', source: 'mqs-crime', filter: ['!=', ['get', 'label'], ''], layout: { 'symbol-sort-key': ['-', 0, ['get', 'sortKey']],
        'text-field': ['get', 'label'], 'text-size': 10.5, 'text-font': ['Open Sans Semibold'], 'text-variable-anchor': ['left', 'right', 'top', 'bottom'], 'text-radial-offset': 0.9, 'text-optional': true },
        paint: { 'text-color': ['get', 'color'], 'text-halo-color': '#0a0a0f', 'text-halo-width': 1.4 } }, b);
      m.addLayer({ id: 'mqs-prot', type: 'circle', source: 'mqs-prot', layout: { 'circle-sort-key': ['get', 'n'] },
        paint: { 'circle-radius': ['interpolate', ['linear'], ['get', 'n'], 0, 5, 10, 7.5, 40, 11, 120, 16],
          'circle-color': ['match', ['get', 'kind'], 'heurts', L1.rouge, 'signale', PROT.signale, DARK],
          'circle-stroke-color': ['match', ['get', 'kind'], 'annonce', PROT.annonce, '#ffffff'], 'circle-stroke-width': ['match', ['get', 'kind'], 'annonce', 2, 1.5] } });
      m.addLayer({ id: 'mqs-prot-flux', type: 'circle', source: 'mqs-prot', filter: ['==', ['get', 'fc'], 1],
        paint: { 'circle-radius': ['+', 4, ['interpolate', ['linear'], ['get', 'n'], 0, 5, 10, 7.5, 40, 11, 120, 16]], 'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } });
      m.addLayer({ id: 'mqs-prot-label', type: 'symbol', source: 'mqs-prot', layout: { 'symbol-sort-key': ['-', 0, ['get', 'n']],
        'text-field': '', 'text-size': 10.5, 'text-font': ['Open Sans Semibold'], 'text-variable-anchor': ['top', 'bottom', 'right', 'left'], 'text-radial-offset': 1.2, 'text-optional': true },
        paint: { 'text-color': ['match', ['get', 'kind'], 'heurts', '#ff8a80', PROT.annonce], 'text-halo-color': '#0a0a0f', 'text-halo-width': 1.4 } });
      m.addLayer({ id: 'mqs-ddos', type: 'circle', source: 'mqs-ddos',
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 7, 8, 10], 'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-color': ['get', 'ring'], 'circle-stroke-width': 2.5 } });
      m.addLayer({ id: 'mqs-ddos-dot', type: 'circle', source: 'mqs-ddos',
        paint: { 'circle-radius': 2.6, 'circle-color': CAT.hacktivist, 'circle-stroke-color': '#0a0a0f', 'circle-stroke-width': 0.8 } });
      m.addLayer({ id: 'mqs-ddos-label', type: 'symbol', source: 'mqs-ddos',
        layout: { 'text-field': '', 'text-size': 10.5, 'text-font': ['Open Sans Semibold'], 'text-variable-anchor': ['right', 'left', 'top', 'bottom'],
          'text-radial-offset': 1.1, 'text-optional': true },
        paint: { 'text-color': ['get', 'ring'], 'text-halo-color': '#0a0a0f', 'text-halo-width': 1.4 } });
      m.addLayer({ id: 'mqs-crime-city', type: 'circle', source: 'mqs-crime', filter: ['all', ['>=', ['get', 'sortKey'], 200], ['!', ['get', 'estimated']]], layout: { 'circle-sort-key': ['get', 'sortKey'] },
        paint: { 'circle-color': 'rgba(0,0,0,0)', 'circle-radius': ['+', 2, ['get', 'r']], 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 2, 'circle-stroke-opacity': 0.95 } }, b);
      m.addLayer({ id: 'mqs-bases-closed', type: 'symbol', source: 'mqs-bases', filter: ['==', ['get', 'status'], 'ferme'],
        layout: { 'icon-image': ['concat', 'mqs-shp-', ['get', 'type'], '-d-none'], 'icon-size': 0.9, 'icon-allow-overlap': true,
          'text-field': ['concat', ['get', 'name'], ' (fermé)'], 'text-size': 9.5, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-font': ['Open Sans Semibold'], 'text-optional': true },
        paint: { 'text-color': '#8a93a6', 'text-halo-color': '#0a0a0f', 'text-halo-width': 1.2 } }, b);
      // Échelle de la France : forme géométrique (lisible à 12 px) ; au zoom : picto dans le disque.
      const pictoOf = (set) => ['match', ['get', 'type'], 'air', set.air, 'navy', set.navy, 'army', set.army, 'joint', set.joint, set.other];
      m.addLayer({ id: 'mqs-bases-sym', type: 'symbol', source: 'mqs-bases', filter: ['!=', ['get', 'status'], 'ferme'],
        layout: { 'icon-image': ['step', ['zoom'], ['concat', 'mqs-shp-', ['get', 'type'], ['case', ['get', 'solid'], '-p-', '-d-'], ['get', 'color']], 7,
            ['case', ['get', 'solid'], pictoOf(ic), pictoOf(icd)]],
          'icon-size': ['interpolate', ['linear'], ['zoom'], 4, 1.25, 6.99, 1.6, 7, 0.6, 10, 0.85], 'icon-allow-overlap': true,
          'text-field': ['step', ['zoom'], '', 8, ['get', 'name']], 'text-size': 10, 'text-variable-anchor': ['top', 'bottom', 'right', 'left', 'top-right', 'bottom-left'], 'text-radial-offset': 1.1,
          'text-justify': 'auto', 'text-font': ['Open Sans Semibold'], 'text-optional': true },
        paint: { 'icon-opacity': 1, 'text-color': ['get', 'color'], 'text-halo-color': '#0a0a0f', 'text-halo-width': 1.3 } }, b);
      m.addLayer({ id: 'mqs-low-disc', type: 'circle', source: 'mqs-low', maxzoom: 7,
        paint: { 'circle-radius': ['+', 5, ['*', 2, ['sqrt', ['get', 'n']]]], 'circle-color': '#05060a', 'circle-opacity': 0.85, 'circle-stroke-color': CAT.telecom, 'circle-stroke-width': 1.6 } });
      m.addLayer({ id: 'mqs-low-count', type: 'symbol', source: 'mqs-low', maxzoom: 7,
        layout: { 'text-field': ['to-string', ['get', 'n']], 'text-size': 10, 'text-font': ['Open Sans Semibold'], 'text-allow-overlap': true }, paint: { 'text-color': CAT.telecom } });
      m.addLayer({ id: 'mqs-agg-disc', type: 'circle', source: 'mqs-agg', maxzoom: 7,
        layout: { 'circle-sort-key': ['get', 'n'] },
        paint: { 'circle-radius': ['min', 22, ['+', 6, ['*', 2.5, ['sqrt', ['get', 'n']]]]], 'circle-color': ['get', 'color'], 'circle-opacity': 0.95,
          'circle-stroke-color': '#05060a', 'circle-stroke-width': 1.5 } });
      m.addLayer({ id: 'mqs-agg-count', type: 'symbol', source: 'mqs-agg', maxzoom: 7,
        layout: { 'text-field': ['to-string', ['get', 'n']], 'text-size': 11, 'text-font': ['Open Sans Semibold'], 'text-allow-overlap': true },
        paint: { 'text-color': ['match', ['get', 'level'], 'jaune', '#1a1a1a', '#ffffff'] } });
      m.addLayer({ id: 'mqs-inet-disc', type: 'circle', source: 'mqs-inet-pts',
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 5, 8, 8], 'circle-color': ['case', ['get', 'ongoing'], L1.orange, DARK], 'circle-stroke-color': ['case', ['get', 'ongoing'], '#ffffff', CAT.internet], 'circle-stroke-width': 2 } });
      m.addLayer({ id: 'mqs-inet-label', type: 'symbol', source: 'mqs-inet-pts',
        layout: { 'text-field': ['get', 'label'], 'text-size': 10.5, 'text-font': ['Open Sans Semibold'], 'text-anchor': 'left', 'text-offset': [0.9, 0], 'text-optional': true },
        paint: { 'text-color': ['case', ['get', 'ongoing'], L1.orange, CAT.internet], 'text-halo-color': '#0a0a0f', 'text-halo-width': 1.4 } });
      m.addLayer({ id: 'mqs-air-sym', type: 'symbol', source: 'mqs-air',
        layout: { 'icon-image': ['concat', ['case', ['get', 'hasTrack'], 'mqs-chev-', 'mqs-nohd-'], ['case', ['get', 'abroad'], 'a', ['get', 'fr'], 'f', 'o']],
          'icon-rotate': ['get', 'track'], 'icon-rotation-alignment': 'map', 'icon-size': 0.75, 'icon-allow-overlap': true,
          // Hors de France : ni étiquette ni premier plan (identité complète dans la bulle).
          'text-field': ['case', ['get', 'abroad'], '', ['get', 'label']], 'text-size': 10, 'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-font': ['Open Sans Semibold'], 'text-optional': true },
        paint: { 'icon-opacity': ['case', ['get', 'abroad'], 0.55, 1], 'text-color': '#e8e8ec', 'text-halo-color': '#0a0a0f', 'text-halo-width': 1.5 } });
    }
    calm();
    renderLegend(); renderCyber(); applyFocus();
    if (S.fiche) openFiche(S.fiche.kind, S.fiche.key, true);
  };

  // ─── Pastilles de l'application : mise en avant cumulable, le reste estompé (comme les pastilles Énergie) ───
  const GROUPS = {
    military: ['mqs-bases-sym', 'mqs-bases-closed', 'mqs-air-sym', 'sov-emergencies', 'sov-navy-reference', 'sov-navy-observed', 'sov-gnss-fill', 'sov-gnss-line'],
    subseaCables: ['mqs-world-line', 'mqs-world-planned', 'mqs-suite-line', 'mqs-suite-end', 'mqs-world-lp', 'submarine-cables-line', 'mqs-landings', 'mqs-landings-label', 'mqs-cable-label', 'mqs-cz-fill', 'mqs-cz-line', 'mqs-anch-line'],
    // Cyber : aucun incident localisé publiquement ; la pastille montre l'infrastructure numérique exposée (centres de données, zones cloud, atterrages).
    cyber: ['mqs-ddos', 'mqs-ddos-dot', 'mqs-ddos-label', 'mqs-dc-ref', 'mqs-cloud-sym', 'mqs-landings', 'mqs-landings-label', 'submarine-cables-line'],
    stability: [],
    // Manifestations et Flux piétons fusionnés : la pastille Manifestations montre aussi les rues du rassemblement choisi.
    protests: ['mqs-prot', 'mqs-prot-flux', 'mqs-prot-label', 'flux-pietons-lines', 'flux-pietons-iso', 'flux-pietons-point', 'flux-pietons-others', 'flux-pietons-others-label'],
    // Flux piétons : calques de l'application (rues chargées, isochrones, point de rassemblement), estompés comme les autres.
    pedestrianFlows: ['mqs-prot', 'mqs-prot-flux', 'mqs-prot-label', 'flux-pietons-lines', 'flux-pietons-iso', 'flux-pietons-point', 'flux-pietons-others', 'flux-pietons-others-label'],
    crime: ['mqs-crime-city', 'mqs-crime-c', 'mqs-crime-c-label', 'mqs-crime-d-fill', 'mqs-crime-d-line'],
    outagesTelecom: ['mqs-dept-level', 'mqs-dept-level-line', 'mqs-agg-disc', 'mqs-agg-count', 'mqs-low-disc', 'mqs-low-count', 'mqs-sites-recent', 'mqs-sites-long'],
    outagesInternet: ['mqs-inet', 'mqs-inet-past-fill', 'mqs-inet-disc', 'mqs-inet-label'],
    outagesCloud: ['mqs-cloud-sym', 'mqs-dc-ref'],
  };
  const OPACITY = { circle: ['circle-opacity', 'circle-stroke-opacity'], symbol: ['icon-opacity', 'text-opacity'], line: ['line-opacity'], fill: ['fill-opacity'] };
  const baseOpacity = new Map();
  let preview = null;
  const applyFocus = () => {
    const m = S.m;
    const on = new Set(S.focus); if (preview) on.add(preview);
    calm();
    const owners = new Map();
    for (const [g, layers] of Object.entries(GROUPS)) for (const id of layers) owners.set(id, [...(owners.get(id) ?? []), g]);
    for (const [id, gs] of owners) {
      const l = m.getLayer(id); if (!l) continue;
      for (const p of OPACITY[l.type] ?? []) {
        const k = `${id}|${p}`;
        if (!baseOpacity.has(k)) baseOpacity.set(k, m.getPaintProperty(id, p) ?? 1);
        const dim = on.size > 0 && !gs.some((g) => on.has(g));
        const base = baseOpacity.get(k);
        try { m.setPaintProperty(id, p, dim ? (typeof base === 'number' ? base * 0.07 : 0.06) : base); } catch (e) { /* propriété absente */ }
      }
    }
    cyber.classList.toggle('is-focus', on.has('cyber'));
    cyber.classList.toggle('is-dim', on.size > 0 && !on.has('cyber'));
    syncChips();
    renderFocusKey();
  };
  // Les pastilles de l'app gardent leur rôle (ouvrir le panneau) ; la maquette y ajoute la mise en avant sur la carte.
  const chipKey = (el) => el?.closest?.('.floating-panel-switcher__chip[data-panel-key]')?.dataset.panelKey;
  const syncChips = () => document.querySelectorAll('.floating-panel-switcher__chip[data-panel-key]').forEach((c) => {
    if (!(c.dataset.panelKey in GROUPS)) return;
    const pressed = S.focus.has(c.dataset.panelKey);
    if (c.classList.contains('is-active') !== pressed) c.classList.toggle('is-active', pressed);
    if (c.getAttribute('aria-pressed') !== String(pressed)) c.setAttribute('aria-pressed', String(pressed));
  });
  // Panneau de droite = celui de la dernière pastille allumée, aucun quand toutes sont éteintes (passerelle __fmPanels de l'app) :
  // la pastille surlignée et le panneau affiché ne se contredisent jamais.
  const followPanel = (k, wasOn) => {
    const P = window.__fmPanels;
    if (!P) return false;
    const last = [...S.focus].pop();
    if (last) { if (!P.isVisible(last)) P.show(last); } else if (wasOn && P.isVisible(k)) P.hide(k);
    return true;
  };
  const wireChips = () => {
    document.addEventListener('click', (e) => {
      if (!isSec()) return;
      const k = chipKey(e.target); if (!k || !(k in GROUPS)) return;
      const wasOn = S.focus.has(k);
      wasOn ? S.focus.delete(k) : S.focus.add(k);
      preview = null; applyFocus();
      if (followPanel(k, wasOn)) e.stopPropagation();
    }, true);
    document.addEventListener('mouseover', (e) => { const k = chipKey(e.target); const next = k in GROUPS ? k : null; if (next !== preview) { preview = next; applyFocus(); } });
    new MutationObserver(syncChips).observe(document.body, { subtree: true, childList: true });
  };

  // ─── Bulle unique ───
  const pop = document.createElement('div');
  pop.className = 'mqs-pop';
  let popAt = null;
  // Bulle toujours entière dans la carte : basculée à gauche ou au-dessus du point si elle déborde.
  const placePop = () => { if (!popAt) return; const p = S.m.project(popAt); const c = S.m.getCanvas(), W = c.clientWidth, H = c.clientHeight, w = pop.offsetWidth, h = pop.offsetHeight;
    const x = p.x + 14 + w > W - 8 ? p.x - 14 - w : p.x + 14, y = Math.min(Math.max(8, p.y + 14), Math.max(8, H - h - 8));
    pop.style.transform = `translate(${Math.round(Math.max(8, Math.min(x, W - w - 8)))}px, ${Math.round(y)}px)`; };
  const card = (c, next = null) => `<div class="et-card"><div class="et-head"><i class="et-dot" style="background:${c.dot}"></i><strong>${esc(c.title)}</strong></div>`
    + (c.state ? `<div class="et-state" style="color:${c.stateHex}">${esc(c.state)}</div>` : '')
    + c.rows.map(([k, v]) => `<div class="et-row"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')
    + (c.hint ? `<div class="et-hint">${esc(c.hint)}</div>` : '')
    + `<div class="et-src">Source : ${esc(c.source)}</div>`
    + (next ? `<div class="et-hint">${esc(next)}</div>` : '') + '</div>';

  const telecomSource = () => `ARCEP, fichier du ${when(S.data.telecom?.file?.publishedAt)}`;
  // Ce qui est exposé dans un département : sites de défense, atterrages de câbles, centres de données (inventaires, pas des alertes).
  const exposure = (code) => {
    const bases = S.bases.filter((b) => { const au = S.audit.get(b.properties.id); return au?.dept === code && au.status !== 'ferme'; });
    const land = (S.landings ?? []).filter((l) => l.dept === code);
    const dcs = (S.data.cloud?.reference?.datacenters ?? []).filter((x) => x.lat != null && S.dcDept?.get(x.id) === code);
    return { bases, land, cables: land.reduce((n, l) => n + l.n, 0), dcs };
  };
  const plural = (n, w) => `${num(n)}${NB}${w}${n > 1 ? 's' : ''}`;
  const deptCard = (a) => {
    if (!a) return null;
    const ops = Object.entries(a.ops).sort((x, y) => y[1] - x[1]).map(([o, n]) => `${o}${NB}${n}`).join(', ');
    const ranked = [...S.agg.values()].filter((x) => x.sites.length).sort((x, y) => y.sites.length - x.sites.length);
    const rank = a.sites.length ? ranked.findIndex((x) => x.code === a.code) + 1 : 0;
    const communes = [...new Set(a.sites.map((x) => x.commune).filter(Boolean))];
    const ex = exposure(a.code);
    const air = (S.data.military?.aircraft ?? []).filter((x) => x.dept === a.code);
    const rows = [
      ['Sites mobiles coupés < 24' + NB + 'h', a.sites.length ? `${num(a.sites.length)} (${rank === 1 ? '1er' : `${rank}e`} sur ${ranked.length} départements)` : 'aucun'],
      a.sites.length ? ['Voix · données coupées', `${num(a.voice)} · ${num(a.data)}`] : null,
      a.sites.length ? ['Opérateurs', ops] : null,
      communes.length ? ['Communes', communes.slice(0, 3).join(', ') + (communes.length > 3 ? ` +${communes.length - 3}` : '')] : null,
      ['Pannes plus anciennes', `${num(a.longCount)}${a.undated ? ` + ${num(a.undated)} sans date` : ''}`],
      ['Internet (IODA)', a.inet.length ? `coupure en cours ${ago(a.inet[0].start)}` : a.inetPast.length ? `aucune en cours · ${plural(a.inetPast.length, 'coupure')} sur 7${NB}j` : 'aucune coupure sur 7' + NB + 'j'],
      ['Exposé', [ex.bases.length ? plural(ex.bases.length, 'site') + ' de défense' : null, ex.land.length ? `${plural(ex.cables, 'câble')} atterrant` : null, ex.dcs.length ? plural(ex.dcs.length, 'centre') + ' de données' : null].filter(Boolean).join(' · ') || 'rien dans les inventaires'],
      air.length ? ['Aéronefs militaires au-dessus', air.map((x) => x.callsign || x.registration || x.hex).join(', ')] : null,
      ['Zone de défense', `${a.zone} (préfet de zone : ${ZONE_SEAT[a.zone] ?? 'n.d.'})`],
      ...targetsIn(a.code).slice(0, 3).map((h) => ['Cyber : site visé (NoName057(16))', `${h.host} · ${isRecentTarget(h) ? targetText(h) : `liste du ${when(h.last)}`}`]),
    ].filter(Boolean);
    return { dot: a.level === 'vert' ? CAT.telecom : L1[a.level], title: `${a.nom} (${a.code})`, state: a.level === 'vert' ? 'Normal · sous le seuil de vigilance' : `${WORD[a.level]} · communications`, stateHex: a.level === 'vert' ? '#c7c7cc' : L1[a.level],
      rows, hint: 'Clic : fiche du département', source: `${telecomSource()} · IODA · ADS-B` };
  };
  const airOf = (hex) => [...(S.data.military?.aircraft ?? []), ...(S.data.military?.abroad ?? []).map((a) => ({ ...a, abroadOnly: true }))].find((a) => a.hex === hex);
  const airCard = (a) => {
    const over = a.abroadOnly ? 'hors de France, jamais compté' : a.dept ? `au-dessus de ${S.agg.get(a.dept)?.nom ?? a.dept} (${a.dept})` : 'en mer, eaux françaises';
    return { dot: a.abroadOnly ? '#8a93a6' : a.family === 'francais' ? CAT.defense : CAT.defenseOther, title: `${[a.callsign, a.registration].filter(Boolean).join(' · ') || a.hex} · ${a.type ?? 'type n.d.'}`,
      state: `${a.family === 'francais' ? 'Militaire ou d’État, français' : `Militaire · ${a.country ?? 'pays non identifié (bloc OACI)'}`} · ${over}`, stateHex: '#c7c7cc',
      rows: [['Immatriculation', a.registration ?? 'n.d.'], ['Adresse OACI', a.hex], ['Pays', a.country ?? 'non identifié (bloc OACI)'],
        ['Altitude', a.altitudeFt != null ? `${num(a.altitudeFt)}${NB}ft (${num(Math.round(a.altitudeFt * 0.3048 / 10) * 10)}${NB}m)` : 'n.d.'],
        ['Vitesse', a.speedKt != null ? `${num(Math.round(a.speedKt))}${NB}kt (${num(Math.round(a.speedKt * 1.852))}${NB}km/h)` : 'n.d.'],
        ['Cap', a.track != null ? `${Math.round(a.track)}° (${cardinal(a.track)})` : 'n.d.'], ['Vu à', a.seenAt ? `${clock(a.seenAt)} (${minsAgo(a.seenAt)})` : 'n.d.']],
      hint: 'Un appareil absent du flux n’est pas absent du ciel · clic : fiche', source: 'adsb.lol (ODbL 1.0), positions publiques' };
  };
  const BASE_WORD = { air: 'air', navy: 'marine', army: 'terre', joint: 'interarmées', fortification: 'fortification', other: 'autre' };
  const CHECK = { source: 'source publique citée', seul: 'sans source publique, à vérifier', ferme: 'fermé' };
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; } };
  const baseCard = (p) => {
    const au = S.audit.get(p.id);
    const rows = [['Département', au?.dept ? `${S.agg.get(au.dept)?.nom ?? au.dept} (${au.dept})` : 'hors métropole'], ['Vérification', `${CHECK[au?.status ?? 'seul']}${au?.checkedAt ? `, le ${au.checkedAt.split('-').reverse().join('/')}` : ''}`]];
    if (au?.source) rows.push(['Source', host(au.source)]);
    if (au?.note) rows.push([au.status === 'ferme' ? 'Fermeture' : 'Correction', au.note]);
    if (au?.osm) rows.push(['Recoupé par OpenStreetMap', `${au.osm.name ?? 'sans nom'} (à ${num(Math.round(au.osmKm * 10) / 10)}${NB}km)`]);
    return { dot: au?.status === 'ferme' ? '#8a93a6' : BASE_HEX[p.type] ?? BASE_HEX.other, title: p.name, state: `Site ${BASE_WORD[p.type] ?? 'autre'}${au?.status === 'ferme' ? ' · fermé' : ''}`, stateHex: '#c7c7cc', rows,
      hint: au?.source ? 'Clic : ouvrir la source' : 'Aucune donnée en direct sur ce site (O13 : nom, catégorie et lien seulement)', source: `liste interne vérifiée le 17/10/2026 · OpenStreetMap (ODbL), fichier du ${when(S.osm?.generatedAt)}` };
  };
  const siteCard = (s) => {
    const a = S.agg.get(s.dept);
    const same = (S.data.telecom?.sites ?? []).filter((x) => x.insee === s.insee && x.id !== s.id && x.cls === 'recente');
    const since = s.since ? `depuis le ${when(s.since)} (${ago(s.since).replace('depuis ', '')})` : 'date de début non publiée';
    return { dot: s.cls === 'recente' && a?.level !== 'vert' ? L1[a.level] : CAT.telecom,
      title: `${s.operator} · ${s.commune ?? 'commune n.d.'} (${s.dept})`, state: `${s.cause === 'maintenance' ? 'En maintenance' : 'Hors service'} ${since}${s.cls === 'longue' ? ' · panne ancienne' : ''}`, stateHex: '#e8e8ec',
      rows: [['Voix', s.voice === 'HS' ? 'coupée' : s.voice === 'OK' ? 'disponible' : 'non publiée'], ['Données', s.data === 'HS' ? 'coupées' : s.data === 'OK' ? 'disponibles' : 'non publiées'],
        ['Technologies', (s.techs ?? []).join(', ') || 'n.d.'], ['Cause publiée', s.detail ?? (s.cause === 'maintenance' ? 'maintenance' : 'incident, sans détail')],
        ['Autres sites coupés dans la commune', same.length ? same.map((x) => x.operator).join(', ') : 'aucun'],
        ['Sites coupés à moins de 10' + NB + 'km', (() => { const n = (S.data.telecom?.sites ?? []).filter((x) => x.cls === 'recente' && x.id !== s.id && x.lat && km([s.lon, s.lat], [x.lon, x.lat]) <= 10); return n.length ? `${n.length} (${[...new Set(n.map((x) => x.operator))].join(', ')})` : 'aucun'; })()],
        ['Opérateur en France', (() => { const o = (S.data.telecom?.byOperator ?? []).find((x) => x.operator === s.operator); return o ? `${num(o.recent)} récentes, ${num(o.long)} anciennes, ${num(o.maintenance)} en maintenance` : 'n.d.'; })()],
        ['Département', a ? `${plural(a.sites.length, 'site')} coupé${a.sites.length > 1 ? 's' : ''} < 24${NB}h · ${WORD[a.level]}` : 'n.d.']],
      hint: 'Clic : fiche du département', source: telecomSource() };
  };
  // Internet : coupures du département sur 7 jours, coupures nationales ou d'opérateur (sans lieu), visibilité des grands réseaux.
  const SIGNAL = { 'ping-slash24': 'sonde ping', bgp: 'routes BGP', 'merit-nt': 'télescope réseau', gtr: 'trafic Google' };
  const evRow = (e) => `${when(e.start)} · ${e.ongoing ? `en cours ${ago(e.start)}` : dur(e.durationSec)} · ${SIGNAL[e.signal] ?? e.signal}`;
  const inetCard = (a) => {
    const d = S.data.internet;
    const evs = [...a.inet, ...a.inetPast].sort((x, y) => String(y.start).localeCompare(String(x.start)));
    const total = evs.reduce((n, e) => n + (e.durationSec ?? 0), 0);
    const wide = (d?.events ?? []).filter((e) => e.scope !== 'departement');
    const rows = [['Coupures sur 7' + NB + 'j', `${evs.length} · ${dur(total)} au total`],
      ...evs.slice(0, 5).map((e, i) => [i ? '' : 'Détail', evRow(e)]), evs.length > 5 ? ['', `+${evs.length - 5}${NB}autres`] : null,
      (() => { const t = evs[0]?.start; const same = t ? [...S.agg.values()].filter((x) => [...x.inet, ...x.inetPast].some((e) => e.start === t)).length : 0;
        return same > 3 ? ['Même créneau ailleurs', `${same} départements coupés le ${when(t)} : panne large ou artefact de mesure, pas locale`] : null; })(),
      ['Sites mobiles coupés < 24' + NB + 'h', a.sites.length ? `${num(a.sites.length)} (${WORD[a.level].toLowerCase()})` : 'aucun'],
      wide.length ? ['Coupures sans lieu (France, opérateurs)', wide.slice(0, 4).map((e) => `${e.label} ${dur(e.durationSec)} le ${when(e.start)}`).join(' ; ')] : null,
      (d?.ripe?.networks ?? []).length ? ['Visibilité des réseaux (RIPE)', d.ripe.networks.map((n) => `${n.name} ${String(n.visibilityPct).replace('.', ',')}${NB}%`).join(', ')] : null,
      ['Cloudflare Radar', d?.radar?.readAt ? `lu ${when(d.radar.readAt)}` : `indisponible${(d?.errors ?? []).length ? ` (${d.errors[0].replace(/^Cloudflare Radar : /, '')})` : ''}`],
    ].filter(Boolean);
    return { dot: a.inet.length ? L1.orange : CAT.internet, title: `${a.nom} (${a.code})`, state: a.inet.length ? `Coupure Internet en cours ${ago(a.inet[0].start)}` : 'Aucune coupure en cours · terminées sur 7 jours', stateHex: a.inet.length ? L1.orange : '#c7c7cc',
      rows, hint: 'Une absence d’anomalie n’est pas une absence de panne · clic : fiche du département', source: `IODA (Georgia Tech), lu ${when(d?.iodaReadAt)} · RIPE Stat, relevé du ${when(d?.ripe?.snapshotAt)}` };
  };
  // ─── Criminalité : calculs et bulles ───
  const crimeKey = () => { let k = null; try { k = JSON.parse(localStorage.getItem('fm.layer.tabs') || '{}')['crime.indicator']; } catch (e) { /* stockage refusé */ }
    return (S.crimeDs?.indicators ?? []).some((i) => i.key === k) ? k : 'homicides'; };
  const indOf = (k) => (S.crimeDs?.indicators ?? []).find((i) => i.key === k);
  const frRate = (k) => (S.crimeDs?.france?.[k] ?? []).find((x) => x.year === S.crimeDs.year)?.rate ?? null;
  const reading = (vals, k) => { const v = vals?.[k]; if (!v) return null; const [count, rate, prev] = v; const f = frRate(k);
    return { count, rate, prev, est: count === null && rate !== null, ratio: rate != null && f ? rate / f : null }; };
  const highOthers = (vals, skip) => (S.crimeDs?.indicators ?? []).filter((i) => i.key !== skip).map((i) => ({ i, r: reading(vals, i.key) })).filter((x) => x.r?.ratio >= 1.5)
    .sort((a, b) => b.r.ratio - a.r.ratio).slice(0, 4).map((x) => `${x.i.label} ${fr2(x.r.ratio)}${NB}×`).join(', ') || 'aucun à 1,5 fois la moyenne ou plus';
  const crimeCompute = () => {
    const ds = S.crimeDs; if (!ds?.cities) { S.crime = null; return; }
    const key = crimeKey(), ckey = indOf(key)?.communal ? key : 'violencesPhysiques';
    const cities = ds.cities.map((city) => ({ city, ...reading(city.values, ckey) })).filter((c) => c.rate != null);
    [...cities].sort((a, b) => b.rate - a.rate).forEach((c, i) => { c.rank = i + 1; });
    const depts = new Map(ds.departments.map((d) => [d.code, { d, ...reading(d.values, key) }]));
    [...depts.values()].filter((x) => x.rate != null).sort((a, b) => b.rate - a.rate).forEach((x, i) => { x.rank = i + 1; });
    S.crime = { key, ckey, cities, depts, nDepts: [...depts.values()].filter((x) => x.rate != null).length };
  };
  const per = (k) => `pour 1${NB}000 ${indOf(k)?.base === 'logements' ? 'logements' : 'habitants'}`;
  const evo = (c, prev) => (c == null || prev == null || prev === 0 ? 'n.d.' : `${c >= prev ? '+' : ''}${fr2(((c - prev) / prev) * 100)}${NB}% (${num(prev)} en ${S.crimeDs.previousYear})`);
  const crimeSrc = () => `SSMSI, ministère de l’Intérieur, données ${S.crimeDs?.year} publiées le ${(S.crimeDs?.publishedAt ?? '').split('-').reverse().join('/')}`;
  const crimeCityCard = (c) => {
    const C = S.crime, d = C.depts.get(c.city.dept);
    const rows = [['Indicateur', `${indOf(C.ckey)?.label}${C.ckey !== C.key ? ` (${indOf(C.key)?.label} : chiffre départemental seulement)` : ''}`],
      [`Faits ${S.crimeDs.year}`, c.est ? 'estimé (secret statistique)' : num(c.count)], ['Taux', `${fr2(c.rate)} ${per(C.ckey)}`],
      ['Rapport à la France', `${fr2(c.ratio)}${NB}×`], ['Rang', `${c.rank}e sur ${C.cities.length} villes de 20${NB}000 habitants et plus`],
      ['Évolution', c.est ? 'n.d.' : evo(c.count, c.prev)], ['Autres indicateurs élevés', highOthers(c.city.values, C.ckey)],
      ['Population', `${num(c.city.population)} habitants`],
      ['Département', d ? `${d.d.name} (${c.city.dept}) : ${indOf(C.key)?.label.toLowerCase()} ${fr2(d.ratio)}${NB}× la moyenne` : c.city.dept]];
    return { dot: crimeHex(c.ratio), title: c.city.name, state: `${fr2(c.ratio)}${NB}× la moyenne nationale`, stateHex: '#c7c7cc', rows,
      hint: 'Faits enregistrés par la police et la gendarmerie sur l’année : une statistique, pas un événement en cours', source: crimeSrc() };
  };
  const crimeDeptCard = (x) => {
    const C = S.crime;
    const hot = C.cities.filter((c) => c.city.dept === x.d.code && c.ratio >= 2).map((c) => c.city.name);
    const rows = [['Indicateur', indOf(C.key)?.label], [`Faits ${S.crimeDs.year}`, x.est ? 'estimé (secret statistique)' : num(x.count)], ['Taux', `${fr2(x.rate)} ${per(C.key)}`],
      ['Rapport à la France', `${fr2(x.ratio)}${NB}×`], ['Rang', x.rank ? `${x.rank}e sur ${C.nDepts} départements` : 'n.d.'], ['Évolution', evo(x.count, x.prev)],
      ['Autres indicateurs élevés', highOthers(x.d.values, C.key)], ['Villes à 2 fois la moyenne', hot.length ? `${hot.slice(0, 5).join(', ')}${hot.length > 5 ? ` +${hot.length - 5}` : ''} (${indOf(C.ckey)?.label.toLowerCase()})` : 'aucune'],
      ['Population', `${num(x.d.population)} habitants`]];
    return { dot: crimeHex(x.ratio), title: `${x.d.name} (${x.d.code})`, state: x.ratio == null ? 'Non publié' : `${fr2(x.ratio)}${NB}× la moyenne nationale`, stateHex: '#c7c7cc', rows,
      hint: 'Indicateur choisi dans le panneau Criminalité · statistique annuelle', source: crimeSrc() };
  };
  // ─── Cibles des hacktivistes (veille cyber élargie, /api/sovereignty/cyber-watch) ───
  const KIND_WORD = { 'préfecture': 'site de la préfecture', administration: 'site d’administration', 'collectivité': 'site de la collectivité', port: 'site portuaire', site: 'site' };
  const TARGET_WORD = { joignable: 'joignable', lent: 'lent', injoignable: 'injoignable' };
  const targetOf = (host) => (S.data.watch?.targets?.items ?? []).find((t) => t.host === host) ?? null;
  const isRecentTarget = (h) => Date.now() - Date.parse(h.last) < 864e5;
  // Visé en 24 h et lent ou injoignable à la dernière sonde : orange ; visé et joignable : jaune ; plus ancien : sans niveau.
  const targetLevel = (h) => (!isRecentTarget(h) ? null : ['lent', 'injoignable'].includes(targetOf(h.host)?.state) ? 'orange' : 'jaune');
  const targetText = (h) => {
    const t = targetOf(h.host);
    if (!isRecentTarget(h)) return 'liste de plus de 24 h';
    if (!t) return 'pas encore sondé';
    const since = t.since ? ` depuis ${when(t.since)}` : '';
    if (t.state === 'joignable') return `joignable${t.ms != null ? ` (${num(t.ms)}${NB}ms)` : ''}`;
    if (t.state === 'lent') return `lent${since} (${t.ms != null ? `${fr2(t.ms / 1000)}${NB}s` : 'n.d.'}, habituellement ${t.medianMs != null ? `${num(t.medianMs)}${NB}ms` : 'n.d.'})`;
    return `injoignable${since}`;
  };
  // Sites visés d'un département (lieu sûr seulement).
  const targetsIn = (code) => (S.data.watch?.ddosia?.hosts ?? []).filter((h) => h.place?.dept === code);
  const ddosPlaces = () => {
    const groups = new Map();
    const now = Date.now();
    for (const h of S.data.watch?.ddosia?.hosts ?? []) {
      const pl = h.place;
      if (!pl) continue;
      // Préfecture : point au centre du département (la préfecture n'est pas géocodée) ; commune : son centre.
      const at = pl.lon != null && pl.lat != null ? [pl.lon, pl.lat] : S.agg?.get(pl.dept)?.at ?? null;
      if (!at) continue;
      const key = `${pl.dept}:${pl.name}`;
      const g = groups.get(key) ?? { key, name: pl.name, dept: pl.dept, how: pl.how, at, hosts: [], recent: false, level: null };
      g.hosts.push(h);
      if (now - Date.parse(h.last) < 864e5) g.recent = true;
      const l = targetLevel(h);
      if (l === 'orange' || (l === 'jaune' && !g.level)) g.level = l;
      groups.set(key, g);
    }
    return [...groups.values()];
  };
  const ddosCard = (g) => {
    const w = S.data.watch?.ddosia;
    const hosts = [...g.hosts].sort((a, b) => String(b.last).localeCompare(String(a.last)));
    const rows = [...hosts.slice(0, 5).flatMap((h) => [[h.host, `${KIND_WORD[h.kind] ?? 'site'} · ${h.configs > 1 ? `${h.configs}${NB}listes, dernière le ${when(h.last)}` : `liste du ${when(h.last)}`}`],
      ['État du site (sonde 10 min)', targetText(h)]]),
      ['Lieu', g.how === 'préfecture' ? `${g.name} (${g.dept}) : point au centre du département` : `${g.name} (${g.dept}), déduit du nom de domaine`],
      ['Dernière liste du groupe', w?.lastConfig ? `${when(w.lastConfig.at)} · ${w.lastConfig.targets}${NB}sites, dont ${w.lastConfig.fr} en France` : 'n.d.'],
      ['Sites français sur 30 jours', `${(w?.hosts ?? []).length}`]];
    const hex = g.level ? L1[g.level] : CAT.hacktivist;
    return { dot: hex, title: g.name, state: g.level === 'orange' ? 'Visé par NoName057(16) en 24 h · site lent ou injoignable' : g.recent ? 'Visé par NoName057(16) en 24 h · site joignable' : 'Visé par NoName057(16) sur 30 jours',
      stateHex: hex, rows,
      hint: 'Liste de cibles publiée par le groupe pro-russe : une cible n’est pas une attaque réussie (site ralenti ou indisponible quelques heures, sans vol de données)',
      source: `witha.name (listes DDoSia), lu ${when(w?.readAt)}` };
  };
  // ─── Manifestations : bulle complète ───
  const PROT_WORD = { annonce: 'Annoncée (agenda militant), pas constatée', signale: 'Rapportée par la presse, sans heurts', heurts: 'Heurts ou tensions rapportés par la presse' };
  const protCard = (x) => {
    const kind = x.status === 'annonce' ? 'annonce' : x.violent ? 'heurts' : 'signale';
    const arts = [...(x.articles ?? [])].sort((a, b) => String(b.seenAt).localeCompare(String(a.seenAt)));
    const rows = [[x.status === 'annonce' ? 'Prévue' : 'Dernier article', x.status === 'annonce' ? (x.allDay ? `le ${day(x.startsAt)}, toute la journée` : when(x.startsAt)) : when(arts[0]?.seenAt ?? x.startsAt)],
      x.participants ? ['Plus haut chiffre cité', `${num(x.participants)} personnes (titre de presse)`] : null,
      x.status !== 'annonce' ? ['Articles sur 24' + NB + 'h', `${num(x.articleCount ?? arts.length)}, dont ${arts.filter((a) => a.violent).length} sur ${arts.length} lus parlant de heurts`] : null,
      ...arts.slice(0, 5).map((a) => [`${a.outlet ?? a.domain}${a.seenAt ? ` · ${clock(a.seenAt)}` : ''}${a.violent ? ' · heurts' : ''}`, a.title ?? a.url]),
      x.status === 'annonce' ? ['Rendez-vous', x.title] : null,
      x.arrete?.hours ? ['Heures de l’arrêté', x.arrete.hours.join(' à ')] : null,
      x.arrete?.excerpt ? ['Motif (arrêté)', x.arrete.excerpt] : null,
      ['Lieu', x.precision === 'departement' ? `${x.city ?? x.dept} : département seulement, point au chef-lieu` : `${x.city ?? 'n.d.'}${x.dept ? ` (${x.dept})` : ''}`]].filter(Boolean);
    return { dot: kind === 'heurts' ? L1.rouge : PROT[kind] ?? PROT.signale, title: x.city ?? x.edition ?? 'Manifestation', state: PROT_WORD[kind], stateHex: kind === 'heurts' ? L1.rouge : '#c7c7cc', rows, url: x.url,
      hint: `${x.status === 'annonce' ? 'Un rendez-vous annoncé n’est pas une manifestation constatée' : 'Classement d’après les titres de presse, à confirmer'} · clic : ouvrir ${x.status === 'annonce' ? 'l’annonce' : 'l’article'}`,
      source: x.source === 'demosphere' ? `Démosphère, édition ${x.edition ?? 'n.d.'}` : x.source === 'gdelt' ? 'GDELT (presse internationale)'
        : x.source === 'prefecture' ? `${x.edition ?? 'Préfecture'}, recueil des actes administratifs` : `presse française ingérée, relevé ${when(S.data.protests?.readAt)}` };
  };
  // Flux piétons : ce que le modèle dit du rassemblement, et l'annonce de la couche Manifestations dont il vient.
  const MOMENT = { encours: ['En cours', '#ffffff'], avenir: ['À venir', '#e8e8ec'], passe: ['Passé', '#8a8f98'] };
  const fluxMomentOf = (debut) => { const t = Date.parse(debut ?? ''); if (!Number.isFinite(t) || t > Date.now()) return 'avenir'; return Date.now() - t < 3 * 3600e3 ? 'encours' : 'passe'; };
  const fluxCard = (ev, selected) => {
    const a = ev.affluence, r = ev.resume, t = ev.temps;
    const [word, hex] = MOMENT[fluxMomentOf(ev.debut)];
    const src = (S.prot ?? []).find((x) => x.id && ev.evenement.startsWith(x.id));
    const top = r?.topRues?.[0];
    const rows = [['Début annoncé', ev.debut ? when(ev.debut) : 'n.d.'],
      ['Point de rassemblement', `${ev.lieu}${ev.lieuSuppose ? ' (lieu habituel supposé)' : ''}`],
      ['Affluence estimée', `≈${NB}${num(a.p50)} personnes`],
      a.p25 != null && a.p75 != null ? ['Fourchette probable', `${num(a.p25)} à ${num(a.p75)} (1 chance sur 2)`] : null,
      ['Fourchette large', `${num(a.p10)} à ${num(a.p90)} (8 chances sur 10)`],
      a.plafond ? ['Plafond du lieu', `${num(a.plafond)} personnes debout`] : null,
      r ? ['Rues à risque', r.satures ? `${num(r.satures)} rue${r.satures > 1 ? 's' : ''} saturée${r.satures > 1 ? 's' : ''} dans 1 tirage sur 10 au moins` : 'aucune saturation probable'] : null,
      top ? ['Rue la plus chargée', `${top.rue} (${num(top.chargeP90)} passages, haut)`] : null,
      ev.cortege ? ['Cortège', `oui${r?.goulots ? `, ${num(r.goulots)} goulot${r.goulots > 1 ? 's' : ''}` : ''}`] : null,
      t ? ['Rythme supposé', `arrivées sur ${t.arriveeMin}${NB}min, sur place ${t.dureeMin}${NB}min, dispersion sur ${t.departMin}${NB}min`] : null,
      ev.meteo ? ['Météo prévue', ev.meteo.replace(/_/g, ' ')] : null,
      src ? ['Annonce', `${src.title ?? 'rendez-vous'}${src.source === 'presse' ? ' (presse)' : src.source === 'prefecture' ? ' (préfecture)' : src.source === 'demosphere' ? ' (Démosphère)' : ''}`] : null].filter(Boolean);
    return { dot: hex, title: ev.ville, state: `${word} · estimation modélisée`, stateHex: hex, rows, url: null,
      hint: selected ? 'Rassemblement affiché : rues, phases et rejeu dans le panneau' : 'Clic : afficher ses rues et le rejeu',
      source: `flux_osint, calcul du ${when(ev.calculeLe)} · ${a.base}` };
  };
  // Fusion : bulle de l'annonce complétée par la prévision ; lignes déjà dites par l'annonce (date, lieu, annonce) non répétées.
  const protFluxCard = (x, ev) => {
    const base = protCard(x), f = fluxCard(ev, window.__fmFlux?.selectedId() === ev.id);
    const skip = new Set(['Début annoncé', 'Annonce']);
    return { ...base, rows: [...base.rows, ['Foule estimée (modèle)', f.rows.find(([k]) => k === 'Affluence estimée')?.[1] ?? 'n.d.'],
      ...f.rows.filter(([k]) => !skip.has(k) && k !== 'Affluence estimée')],
      hint: 'Rues, phases et rejeu dans le panneau Flux piétons',
      source: `${base.source} · ${f.source}` };
  };
  const cableWatch = () => (S.data.cablesWatch?.evaluated ? 'veille active' : `veille des navires coupée (${(S.data.cablesWatch?.errors ?? [])[0] ?? 'source injoignable'})`);
  // Cloud et centres de données : bulles complètes (état publié, incidents, maintenances, voisinage, sources).
  const PROV_OF = [['ovhcloud', /^ovh/i], ['scaleway', /scaleway|iliad|online/i], ['aws', /^aws|amazon/i], ['gcp', /^gcp|google/i], ['cloudflare', /cloudflare/i], ['outscale', /outscale|dassault/i], ['azure', /microsoft|azure/i]];
  const SRC_WORD = { 'static backbone': 'liste interne des grands sites cloud', 'uMap projets data centers France': 'carte uMap des projets de centres de données',
    'OpenStreetMap France datacenters snapshot': 'OpenStreetMap (ODbL)', 'DataCenterMap live browser snapshot': 'DataCenterMap' };
  const zoneShort = (z) => z.z.id;
  const cloudSiteCard = (s) => {
    const c = S.data.cloud;
    const rows = [];
    for (const prov of s.providers) {
      const zs = s.zones.filter((z) => z.plabel === prov);
      const ko = zs.filter((z) => z.status !== 'vert');
      rows.push([prov, `${plural(zs.length, 'zone')}${ko.length ? `, dont ${ko.length}${NB}dégradée${ko.length > 1 ? 's' : ''} (${ko.map(zoneShort).join(', ')})` : ', toutes opérationnelles'}`]);
    }
    const incs = [...new Map(s.zones.filter((z) => z.i).map((z) => [z.i.id, z])).values()];
    for (const z of incs) rows.push([`Incident ${z.plabel}`, `${z.i.title.replace(/^(\[[^\]]*\]\s*-?\s*)+/, '')} · impact ${IMPACT[z.i.impact] ?? z.i.impact} · ${ago(z.i.start)}`]);
    const deg = s.zones.filter((z) => !z.i && z.z.status === 'degraded');
    if (deg.length) rows.push(['Dégradé sans incident publié', deg.map(zoneShort).join(', ')]);
    const keys = new Set(s.zones.map((z) => `${z.provider}:${z.z.id}`));
    const mt = (c?.maintenances ?? []).filter((x) => x.inProgress && x.zones.some((z) => keys.has(`${x.provider}:${z}`)));
    for (const x of mt.slice(0, 3)) rows.push(['Maintenance en cours', `${x.title.replace(/^(\[[^\]]*\]\s*-?\s*)+/, '')}${x.end ? `, jusqu’au ${when(x.end)}` : ''}`]);
    if (mt.length > 3) rows.push(['', `+${mt.length - 3}${NB}autres maintenances`]);
    const provs = new Set(s.zones.map((z) => z.provider));
    const elsewhere = (c?.elsewhere ?? []).filter((x) => provs.has(x.provider) && x.state === 'en-cours');
    if (elsewhere.length) rows.push(['Incidents sans zone en France', `${elsewhere.length} (${[...new Set(elsewhere.map((x) => (c.providers.find((p) => p.provider === x.provider)?.label ?? x.provider)))].join(', ')})`]);
    const dcs = (c?.reference?.datacenters ?? []).filter((x) => x.lat != null && km(s.at, [x.lon, x.lat]) <= 25);
    rows.push(['Centres de données à moins de 25' + NB + 'km', dcs.length ? `${dcs.length} (${dcs.slice(0, 4).map((x) => x.name).join(', ')}${dcs.length > 4 ? ` +${dcs.length - 4}` : ''})` : 'aucun dans l’inventaire']);
    const ix = (c?.reference?.exchanges ?? []).filter((x) => x.city && x.city.toLowerCase() === s.name.toLowerCase());
    if (ix.length) rows.push(['Points d’échange Internet', `${ix.length} (${ix.slice(0, 4).map((x) => x.name).join(', ')}${ix.length > 4 ? ` +${ix.length - 4}` : ''})`]);
    const upd = s.zones.map((z) => z.z.updatedAt).filter(Boolean).sort().pop();
    rows.push(['Dernière mise à jour publiée', upd ? when(upd) : 'n.d.']);
    const url = incs[0]?.i.url ?? null;
    return { dot: s.status === 'vert' ? CAT.cloud : L1[s.status], title: `Cloud · ${s.name}`, url,
      state: incs.length ? `${WORD[s.status]} · ${plural(incs.length, 'incident')} en cours` : deg.length ? 'Vigilance · zone dégradée' : mt.length ? 'Opérationnel · maintenance en cours' : 'Opérationnel',
      stateHex: s.status === 'vert' ? '#c7c7cc' : L1[s.status], rows,
      hint: url ? 'Clic : ouvrir l’incident sur la page d’état' : 'Position : ville du site, pas l’adresse des bâtiments',
      source: `pages d’état ${s.providers.join(', ')}, lues ${when(c?.readAt)}` };
  };
  const dcCard = (x) => {
    const dcDot = CAT.dc;
    const c = S.data.cloud;
    const code = S.dcDept?.get(x.id);
    const near = (S.cloudSites ?? []).filter((s) => km(s.at, [x.lon, x.lat]) <= 25);
    const prov = PROV_OF.find(([, re]) => re.test(x.operator ?? x.name ?? ''))?.[0];
    const plab = prov && (c?.providers ?? []).find((p) => p.provider === prov)?.label;
    const incs = prov ? [...(c?.incidents ?? []), ...(c?.elsewhere ?? [])].filter((i) => i.provider === prov && i.state === 'en-cours') : [];
    const sameDept = (c?.reference?.datacenters ?? []).filter((d) => d.id !== x.id && code && S.dcDept?.get(d.id) === code).length;
    const city = x.city && !/^[a-z]+-[a-z]+-?\d/.test(x.city) ? x.city : / - ([^-]+)$/.exec(x.name ?? '')?.[1]?.trim() ?? null;
    const ix = city ? (c?.reference?.exchanges ?? []).filter((e) => e.city?.toLowerCase() === city.toLowerCase()) : [];
    const cy = (S.data.cyber?.certfr?.alerts ?? []).filter((a) => a.status === 'en-cours');
    const rows = [['Exploitant', x.operator ?? 'non publié'], ['Stade', x.stage ?? 'non précisé'], ['Puissance', x.power ? x.power.replace(/ MW/g, `${NB}MW`) : 'non publiée'],
      ['Commune', city ?? 'non publiée'], ['Département', code ? `${S.agg.get(code)?.nom ?? code} (${code})` : 'n.d.'],
      ['État publié', plab ? (incs.length ? `${plab} : ${plural(incs.length, 'incident')} en cours (${incs.slice(0, 2).map((i) => i.title.replace(/^(\[[^\]]*\]\s*-?\s*)+/, '')).join(' ; ')})` : `${plab} : aucun incident en cours`) : 'aucune page d’état pour cet exploitant'],
      near.length ? ['Site cloud proche', near.map((s) => `${s.name} (${WORD[s.status].toLowerCase()})`).join(', ')] : null,
      ix.length ? ['Points d’échange Internet', `${ix.length} à ${city} (${ix.slice(0, 3).map((e) => e.name).join(', ')}${ix.length > 3 ? ` +${ix.length - 3}` : ''})`] : null,
      ['Autres centres du département', sameDept ? num(sameDept) : 'aucun'],
      ['Vigilance cyber nationale', cy.length ? `${plural(cy.length, 'alerte')} CERT-FR en cours, aucune localisée` : 'aucune alerte CERT-FR en cours'],
      ['Position', `${x.lat.toFixed(3)}, ${x.lon.toFixed(3)}`]].filter(Boolean);
    return { dot: dcDot, title: x.name, state: `Centre de données · ${/projet|construction|fast/i.test(x.stage ?? '') ? 'projet, pas en service' : 'inventaire'}`, stateHex: '#c7c7cc', rows,
      hint: 'Inventaire : aucun état publié pour le bâtiment lui-même', source: `${SRC_WORD[x.source] ?? x.source}, inventaire du ${when(c?.reference?.generatedAt)}` };
  };
  const TG_SRC = 'TeleGeography, Submarine Cable Map (CC BY-NC-SA 3.0), lu le 17/10/2026';
  const placeName = (n) => n.replace(/, France$/, '');
  const worldCableCard = (c) => {
    const fr = c.landings.filter((l) => l.fr).map((l) => placeName(l.name));
    const countries = [...new Set(c.landings.filter((l) => !l.fr).map((l) => l.country))];
    const owners = (c.owners ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    return { dot: CAT.cables, title: c.name, state: c.planned ? `Câble prévu${c.rfs ? `, mise en service annoncée ${c.rfs}` : ''}` : `Câble en service${c.rfsYear ? ` depuis ${c.rfsYear}` : ''}`, stateHex: '#c7c7cc',
      rows: [['Longueur', c.length ? c.length.replace(/,/g, NB).replace(' km', `${NB}km`) : 'n.d.'], ['Atterrages en France', fr.join(', ') || 'n.d.'],
        ['Autres pays', countries.length ? `${countries.length} : ${countries.slice(0, 5).join(', ')}${countries.length > 5 ? ` +${countries.length - 5}` : ''}` : 'aucun'],
        ['Propriétaires', owners.length ? owners.slice(0, 5).join(', ') + (owners.length > 5 ? ` +${owners.length - 5}` : '') : 'n.d.'], ['Fournisseur', c.suppliers ?? 'n.d.'],
        ['Veille des navires', S.data.cablesWatch?.evaluated ? 'active' : 'coupée']],
      hint: 'Tracé schématique au large ; le tracé précis près des côtes est celui du Shom', source: TG_SRC };
  };
  const OSM_SRC = 'OpenStreetMap (contributeurs, ODbL), lu le 17/10/2026';
  const suiteCard = (f) => f.properties.kind === 'end'
    ? { dot: '#c7c7cc', title: 'Fin du relevé du Shom', state: 'Suite du câble non publiée', stateHex: '#c7c7cc',
      rows: [['Câble', `Shom ${f.properties.shom.split('/').pop()}`]], hint: 'Le Shom ne relève que les eaux sous juridiction française ; ni TeleGeography ni OpenStreetMap ne donnent la suite de ce câble', source: 'Shom, câbles sous-marins (CC BY-SA)' }
    : { dot: f.properties.disused ? '#6e7585' : CAT.cables, title: f.properties.name ?? 'Câble sans nom', state: f.properties.disused ? 'Hors service selon OpenStreetMap' : f.properties.power ? 'Câble électrique' : 'Câble de télécommunication',
      stateHex: '#c7c7cc', rows: [['Tracé', 'suite au large du relevé du Shom'], ['Objets OSM', f.properties.osm.join(', ')]],
      hint: 'Tracé d’après OpenStreetMap, non vérifié par une source officielle', source: OSM_SRC };
  const worldLandingCard = (l) => ({ dot: CAT.cables, title: l.name, state: `Atterrage hors de France · ${plural(l.cables.length, 'câble')} vers la France`, stateHex: '#c7c7cc',
    rows: [['Câbles', l.cables.map((id) => S.world.cables[id]?.name ?? id).join(', ')]], source: TG_SRC });
  // Bulles d'origine (câbles, Marine, urgences) : reprises en entier, au gabarit de la maquette.
  const parseBody = (html) => {
    const d = document.createElement('div'); d.innerHTML = html ?? '';
    return { title: d.querySelector('b')?.textContent ?? '', sub: d.querySelector('.hm-sub')?.textContent ?? '',
      rows: [...d.querySelectorAll('.hm-row')].map((r) => [...r.children].map((c) => c.textContent)), notes: [...d.querySelectorAll('.hm-note')].map((n) => n.textContent) };
  };
  const landingCard = (l) => {
    const cables = [...l.cables.values()];
    const named = cables.filter((c) => c.name).map((c) => c.name);
    const ops = [...new Set(cables.map((c) => c.operator).filter(Boolean))];
    const off = cables.filter((c) => c.outOfService).length;
    return { dot: CAT.cables, title: `${l.commune || 'atterrage'} (${l.dept})`, state: `Atterrage · ${plural(l.n, 'câble')}${off ? `, dont ${off} hors service` : ''}`, stateHex: '#c7c7cc',
      rows: [['Câbles internationaux', l.tg.length ? l.tg.map((c) => c.name).slice(0, 6).join(', ') + (l.tg.length > 6 ? ` +${l.tg.length - 6}` : '') : 'aucun (TeleGeography)'],
        named.length ? ['Autres câbles nommés', named.slice(0, 4).join(', ')] : null,
        ['Tracés du Shom', `${num(cables.length)}, dont ${num(cables.length - named.length)} sans nom`], ops.length ? ['Exploitants', ops.join(', ')] : null,
        ['Veille des navires', S.data.cablesWatch?.evaluated ? 'active' : 'coupée']].filter(Boolean),
      hint: S.data.cablesWatch?.evaluated ? 'Taille du rond = nombre de câbles au même atterrage' : cableWatch(), source: 'Shom (CC BY-SA, 2019) · OpenStreetMap (ODbL) · TeleGeography (CC BY-NC-SA 3.0)' };
  };
  const strong = (html) => { const d = document.createElement('div'); d.innerHTML = html ?? ''; return d.querySelector('strong, b, .hm-tip-title')?.textContent ?? d.textContent.slice(0, 60); };

  const deptCodeAt = (c) => { if (!c) return null; for (const f of S.geo.deptShapes) if (inGeom(c, f.geometry)) return f.properties.code; return null; };
  const deptAt = (c) => { if (!c) return null; for (const f of S.geo.deptShapes) if (inGeom(c, f.geometry)) return S.agg.get(f.properties.code); return null; };

  // Arbitre : une seule cible, la plus signifiante sous le pointeur.
  const PRIORITY = ['mqs-air-sym', 'sov-emergencies', 'mqs-ddos', 'flux-pietons-point', 'flux-pietons-others', 'mqs-prot', 'mqs-prot-flux', 'flux-pietons-lines', 'mqs-cloud-sym', 'mqs-inet-disc', 'mqs-sites-recent', 'mqs-agg-disc', 'mqs-low-disc', 'mqs-crime-c', 'mqs-crime-city', 'mqs-bases-sym', 'mqs-bases-closed', 'sov-navy-reference', 'sov-navy-observed', 'mqs-landings', 'mqs-world-lp', 'mqs-dc-ref', 'mqs-suite-end', 'mqs-world-hit', 'mqs-suite-hit', 'submarine-cables-hitarea', 'mqs-anch-line', 'mqs-cz-fill', 'mqs-sites-long', 'mqs-crime-d-fill', 'mqs-dept-fill'];
  const pick = (point) => {
    // Une pastille active : seuls ses calques (et les départements) répondent au survol ; un calque estompé ne donne jamais de bulle.
    const on = new Set(S.focus); if (preview) on.add(preview);
    // Les départements (état des pannes) ne répondent que sans pastille ou avec une pastille de pannes : jamais une bulle de pannes sous Flux piétons.
    const live = (id) => !on.size || (id === 'mqs-dept-fill' ? on.has('outagesTelecom') || on.has('outagesInternet')
      : !Object.values(GROUPS).some((ls) => ls.includes(id)) || Object.entries(GROUPS).some(([g, ls]) => on.has(g) && ls.includes(id)));
    const layers = PRIORITY.filter((id) => S.m.getLayer(id) && live(id));
    const hits = S.m.queryRenderedFeatures(point, { layers });
    if (!hits.length) return null;
    hits.sort((a, b) => PRIORITY.indexOf(a.layer.id) - PRIORITY.indexOf(b.layer.id));
    const f = hits[0], p = f.properties, id = f.layer.id;
    if (id === 'mqs-air-sym') { const a = airOf(p.hex); return a && { key: `air:${p.hex}`, kind: 'air', id: p.hex, card: airCard(a), at: [a.lon, a.lat] }; }
    if (id === 'mqs-agg-disc' || id === 'mqs-low-disc' || id === 'mqs-dept-fill') { const a = S.agg.get(p.code); return a && { key: `dept:${a.code}`, kind: 'dept', id: a.code, card: deptCard(a), at: id === 'mqs-dept-fill' ? null : a.at }; }
    if (id === 'mqs-inet-disc') { const a = S.agg.get(p.code); return a && { key: `inet:${a.code}`, kind: 'dept', id: a.code, card: inetCard(a), at: a.at }; }
    if (id === 'mqs-sites-recent' || id === 'mqs-sites-long') { const s = (S.data.telecom?.sites ?? []).find((x) => x.id === p.id); return s && { key: `site:${s.id}`, kind: 'site', id: s.id, card: siteCard(s), at: [s.lon, s.lat] }; }
    if (id === 'mqs-bases-sym') return { key: `base:${p.id}`, kind: 'base', id: p.id, card: baseCard(p), at: f.geometry.coordinates };
    if (id === 'mqs-cloud-sym') { const cs = S.cloudSites?.[p.i]; return cs && { key: `cloud:${p.i}`, kind: 'cloud', id: p.i, card: cloudSiteCard(cs), at: cs.at }; }
    if (id === 'mqs-suite-hit' || id === 'mqs-suite-end') { const f = S.suite?.features[p.i]; return f && { key: `su:${p.i}`, kind: 'suite', id: p.i, card: suiteCard(f), at: null }; }
    if (id === 'mqs-world-hit') { const c = S.world?.cables[p.id]; return c && { key: `wc:${c.id}`, kind: 'wcable', id: c.id, card: worldCableCard(c), at: null }; }
    if (id === 'mqs-world-lp') { const l = S.world.landings.find((x) => x.id === p.id); return l && { key: `wl:${l.id}`, kind: 'wland', id: l.id, card: worldLandingCard(l), at: l.at }; }
    if (id === 'mqs-landings') { const l = S.landings[p.i]; return l && { key: `land:${p.i}`, kind: 'landing', id: p.i, card: landingCard(l), at: l.at }; }
    if (id === 'mqs-dc-ref') { const x = (S.data.cloud?.reference?.datacenters ?? []).find((d) => d.id === p.id); return x && { key: `dc:${x.id}`, kind: 'dc', id: x.id, card: dcCard(x), at: [x.lon, x.lat] }; }
    if (id === 'mqs-cz-fill') { const z = S.cablesFile.cableZones[p.i]; return { key: `cz:${p.i}`, kind: 'cz', id: p.i, at: null,
      card: { dot: CAT.cables, title: z.name ?? 'Zone de protection de câbles', state: `Réglementation de navigation · câbles ${z.cableCategory === 'power' ? 'd’énergie' : z.cableCategory === 'telecom' ? 'de télécommunication' : 'sous-marins'}`, stateHex: '#c7c7cc',
        rows: [['Prescription', z.info ?? 'non précisée']], hint: 'Mouillage et chalutage réglementés au-dessus des câbles', source: 'Shom, Réglementation navigation (Licence ouverte 2.0, 2021)' } }; }
    if (id === 'mqs-anch-line') { const z = S.cablesFile.anchorageZones[p.i]; return z && { key: `an:${p.i}`, kind: 'anch', id: p.i, at: null,
      card: { dot: '#e8e8ec', title: z.name ?? 'Zone de mouillage', state: 'Mouillage qui recoupe une zone de câbles', stateHex: '#c7c7cc',
        rows: [['Usage', z.info ?? 'n.d.'], ['Mouillage interdit', z.anchoringProhibited ? 'oui' : 'non']], hint: 'Point d’attention : une ancre qui chasse peut sectionner un câble', source: 'Shom, Réglementation navigation (Licence ouverte 2.0, 2021)' } }; }
    if (id === 'submarine-cables-hitarea') {
      const o = parseBody(p.body);
      return { key: `cable:${p.id}`, kind: 'cable', id: p.id, at: null,
        card: { dot: p.outOfService ? '#6e7585' : CAT.cables, title: o.title || 'câble sous-marin', state: o.sub, stateHex: '#c7c7cc',
          rows: [...o.rows, ['Veille des navires', S.data.cablesWatch?.evaluated ? 'active' : 'coupée']], hint: o.notes.join(' '), source: 'Shom · OpenStreetMap' } };
    }
    if (id === 'mqs-ddos') { const g = S.ddos?.[p.i]; return g && { key: `dd:${g.key}`, kind: 'raw', id: g.key, at: g.at, card: ddosCard(g) }; }
    if (id === 'flux-pietons-others' || id === 'flux-pietons-point') {
      const F = window.__fmFlux; const evId = id === 'flux-pietons-point' ? F?.selectedId() : p.id; const ev = evId && F?.event(evId);
      return ev && { key: `flux:${ev.id}`, kind: 'flux', id: ev.id, at: ev.point, card: fluxCard(ev, evId === F.selectedId()) };
    }
    if (id === 'flux-pietons-lines') {
      const o = parseBody(p.body);
      return { key: `fluxr:${o.title}:${o.sub}`, kind: 'raw', id: o.title, at: null,
        card: { dot: p.color ?? '#22d3ee', title: o.title || 'rue', state: o.sub, stateHex: '#c7c7cc', rows: o.rows, hint: o.notes.join(' '), source: 'flux_osint (estimation modélisée) · OpenStreetMap' } };
    }
    if (id === 'mqs-prot' || id === 'mqs-prot-flux') {
      const x = S.prot?.[p.i]; if (!x) return null;
      const ev = S.protFlux?.get(x.id);
      // Annonce prévue : une seule bulle (l'annonce, puis la foule estimée) ; le clic choisit aussi le rassemblement (rues, rejeu).
      // Bulle au point de rassemblement : la carte s'y cadre au clic.
      return ev ? { key: `pr:${x.id}`, kind: 'flux', id: ev.id, at: ev.point, card: protFluxCard(x, ev) }
        : { key: `pr:${x.id}`, kind: 'raw', id: x.id, at: [x.lon, x.lat], card: protCard(x) };
    }
    if (id === 'mqs-crime-c' || id === 'mqs-crime-city') { const c = S.crime?.cities[p.i]; return c && { key: `cr:${c.city.code}`, kind: 'raw', id: c.city.code, at: [c.city.lon, c.city.lat], card: crimeCityCard(c) }; }
    if (id === 'mqs-crime-d-fill') { const d = S.crime?.depts.get(p.code); return d && { key: `crd:${p.code}`, kind: 'raw', id: p.code, at: null, card: crimeDeptCard(d) }; }
    if (id === 'sov-emergencies' || id.startsWith('sov-navy')) return { key: `${id}:${p.id}`, kind: 'raw', id: p.id, at: f.geometry.coordinates,
      card: { dot: p.color ?? '#8a93a6', title: strong(p.body), state: parseBody(p.body).sub || (id === 'sov-emergencies' ? 'Code d’urgence transpondeur' : 'Bâtiment de la Marine · port base (référence)'), stateHex: p.color ?? '#c7c7cc',
        rows: parseBody(p.body).rows, hint: id === 'sov-emergencies' ? null : 'Position de référence, pas une observation', source: id === 'sov-emergencies' ? 'ADS-B' : 'liste publique, AIS coupé' } };
    return null;
  };

  let hoveredDept = null;
  const setDeptHover = (code) => {
    if (code === hoveredDept) return;
    // État du département (instantané) plutôt qu'un filtre, qui ferait retraiter toute la source à chaque changement.
    if (hoveredDept) S.m.setFeatureState({ source: 'mqs-depts', id: hoveredDept }, { hover: false });
    if (code) S.m.setFeatureState({ source: 'mqs-depts', id: code }, { hover: true });
    hoveredDept = code;
  };
  // Un seul calcul par image, quel que soit le nombre d'événements de souris.
  let moveRaf = 0, moveEv = null;
  const onMove = (e) => { moveEv = e; if (!moveRaf) moveRaf = requestAnimationFrame(() => { moveRaf = 0; doMove(moveEv); }); };
  const doMove = (e) => {
    if (!isSec()) return;
    const hit = pick(e.point);
    const canvas = S.m.getCanvas();
    // Survol : contour du département et curseur seulement ; la bulle s'ouvre au clic.
    if (!hit) { setDeptHover(null); canvas.style.cursor = ''; return; }
    canvas.style.cursor = 'pointer';
    setDeptHover(hit.kind === 'dept' ? hit.id : null);
  };

  // ─── Fiche au format note de situation ───
  const panel = document.createElement('aside');
  panel.className = 'mqs-fiche';
  const sec = (title, body) => `<section><h4>${esc(title)}</h4>${body}</section>`;
  const li = (items) => `<ul>${items.map((x) => `<li>${x}</li>`).join('')}</ul>`;
  const spark = (hist, key = 'recent', cap) => {
    if (!hist?.length) return '';
    const w = 300, h = 44, max = Math.max(...hist.map((x) => x[key]), 1);
    const pts = hist.map((x, i) => `${Math.round((i / (hist.length - 1)) * w)},${Math.round(h - (x[key] / max) * (h - 6) - 3)}`).join(' ');
    const last = hist[hist.length - 1];
    return `<svg class="mqs-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="#8a93a6" stroke-width="1.5"/>`
      + `<circle cx="${w}" cy="${Math.round(h - (last[key] / max) * (h - 6) - 3)}" r="3" fill="#e8e8ec"/></svg>`
      + `<div class="mqs-spark-cap">${cap ?? `Sites récents, France entière, ${hist.length}${NB}derniers fichiers`} (max ${num(max)})</div>`;
  };
  const freshness = () => {
    const d = S.data, rows = [];
    rows.push(['ARCEP (sites mobiles)', d.telecom?.file ? `fichier du ${when(d.telecom.file.publishedAt)}, quotidien` : 'indisponible', d.telecom?.file ? 'ok' : 'ko']);
    rows.push(['IODA (Internet)', d.internet?.iodaReadAt ? `lu ${when(d.internet.iodaReadAt)}` : 'indisponible', d.internet?.iodaReadAt ? 'ok' : 'ko']);
    rows.push(['Cloudflare Radar', d.internet?.radar?.readAt ? `lu ${when(d.internet.radar.readAt)}` : `jamais lu${(d.internet?.errors ?? []).find((x) => /Radar/.test(x)) ? ` (${(d.internet.errors.find((x) => /Radar/.test(x))).replace(/^Cloudflare Radar : /, '')})` : ''}`, d.internet?.radar?.readAt ? 'ok' : 'ko']);
    rows.push(['ADS-B (aéronefs)', d.military?.readAt ? `lu ${when(d.military.readAt)}` : 'indisponible', d.military?.readAt ? 'ok' : 'ko']);
    rows.push(['AIS (navires, câbles)', d.cablesWatch?.evaluated ? `lu ${when(d.cablesWatch.readAt)}` : `coupé${(d.cablesWatch?.errors ?? [])[0] ? ` (${d.cablesWatch.errors[0]})` : ', aucun message reçu'}`, d.cablesWatch?.evaluated ? 'ok' : 'ko']);
    rows.push(['GNSS (brouillage)', d.gnss?.readAt ? `lu ${when(d.gnss.readAt)}${(d.gnss.errors ?? []).length ? ` · ${d.gnss.errors[0]}` : ''}` : 'indisponible', d.gnss?.readAt && !(d.gnss.errors ?? []).length ? 'ok' : 'part']);
    rows.push(['CERT-FR (alertes)', d.cyber?.certfr?.readAt ? `lu ${when(d.cyber.certfr.readAt)}` : 'indisponible', d.cyber?.certfr?.readAt ? 'ok' : 'ko']);
    rows.push(['CISA KEV (failles exploitées)', d.cyber?.kev?.readAt ? `catalogue ${d.cyber.kev.catalogVersion}, lu ${when(d.cyber.kev.readAt)}` : 'indisponible', d.cyber?.kev?.readAt ? 'ok' : 'ko']);
    rows.push(['Ransomware.live (revendications)', d.cyber?.ransomware?.checkedAt ? `lu ${when(d.cyber.ransomware.checkedAt)}` : 'indisponible', d.cyber?.ransomware?.checkedAt ? 'ok' : 'ko']);
    rows.push(['Pages d’état cloud', d.cloud?.readAt ? `lu ${when(d.cloud.readAt)}` : 'indisponible', d.cloud?.readAt ? 'ok' : 'ko']);
    return rows;
  };
  const deptNote = (a) => {
    const d = S.data, tel = d.telecom;
    const ops = Object.entries(a.ops).sort((x, y) => y[1] - x[1]);
    const communes = [...new Set(a.sites.map((s) => s.commune).filter(Boolean))];
    const inDept = (c) => deptAt(c)?.code === a.code;
    const ex = exposure(a.code);
    const bases = ex.bases.map((b) => b.properties.name + (S.audit.get(b.properties.id)?.status === 'source' ? '' : ' (sans source)'));
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
      ex.land.length ? `Atterrages de câbles : ${ex.land.map((l) => `${l.commune} (${plural(l.n, 'câble')})`).join(', ')}.` : 'Aucun atterrage de câble sous-marin.',
      ex.dcs.length ? `Centres de données : ${ex.dcs.map((x) => x.name).slice(0, 6).join(', ')}${ex.dcs.length > 6 ? ` et ${ex.dcs.length - 6}${NB}autres` : ''}.` : 'Aucun centre de données inventorié.',
      air.length ? `Aéronefs militaires au-dessus du département : ${air.map((x) => [x.callsign, x.registration].filter(Boolean).join(' · ')).join(' ; ')}.` : 'Aucun aéronef militaire relevé au-dessus du département au dernier relevé.',
      ...targetsIn(a.code).map((h) => `Cyber : ${h.host} (${KIND_WORD[h.kind] ?? 'site'}) dans les listes de cibles du groupe pro-russe NoName057(16), dernière le ${when(h.last)} ; site ${targetText(h)}. Une cible publiée n’est pas une attaque réussie ; contact : CSIRT régional, ou CERT-FR pour un service de l’État.`),
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

  // Fiche cyber : national, jamais critique (plafond vigilance) ; la carte montre ce qui est exposé, pas des incidents localisés.
  const day = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : 'n.d.');
  const SECTOR = { Technology: 'technologie', Healthcare: 'santé', 'Professional Services': 'services aux entreprises', 'Agriculture and Food Production': 'agriculture et agroalimentaire',
    'Energy & Utilities': 'énergie et réseaux', 'Financial Services': 'finance', Manufacturing: 'industrie', 'Retail & E-Commerce': 'commerce', 'Public Sector': 'secteur public', Education: 'éducation',
    'Transportation/Logistics': 'transport et logistique', Construction: 'construction', Telecommunication: 'télécoms', Government: 'administration', 'Hospitality and Tourism': 'tourisme' };
  // Niveau de la menace, mêmes règles que la pastille du panneau Vigilance cyber (cyberLevel) : rouge si deux alertes CERT-FR en cours
  // publiées depuis moins de 7 jours, orange pour une, jaune pour une alerte plus ancienne en cours. L'indice national, lui, plafonne le cyber.
  const parisDay = (ms) => new Date(ms).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
  const ageDays = (d) => Math.round((Date.parse(`${parisDay(Date.now())}T00:00:00Z`) - Date.parse(`${String(d).slice(0, 10)}T00:00:00Z`)) / 864e5);
  const cyberThreat = () => {
    const alerts = (S.data.cyber?.certfr?.alerts ?? []).filter((x) => x.status === 'en-cours');
    const recent = alerts.filter((x) => ageDays(x.firstVersion) < 7);
    if (!S.data.cyber?.certfr?.readAt) return { level: null, word: 'non évalué' };
    if (recent.length >= 2) return { level: 'rouge', word: `rouge (${recent.length}${NB}alertes CERT-FR en cours publiées depuis moins de 7${NB}jours)` };
    if (recent.length === 1) return { level: 'orange', word: `orange (alerte CERT-FR en cours publiée le ${day(recent[0].firstVersion)})` };
    if (alerts.length) return { level: 'jaune', word: `jaune (${plural(alerts.length, 'alerte')} CERT-FR en cours)` };
    const avis = (S.data.cyber?.certfr?.avis ?? []).find((a) => ageDays(a.lastVersion ?? a.firstVersion) < 7 && (a.kevCves ?? []).length);
    if (avis) return { level: 'jaune', word: `jaune (${avis.ref} : avis citant une vulnérabilité exploitée du catalogue KEV)` };
    const ratio = S.data.cyber?.ransomware?.ratio;
    if (ratio != null && ratio > 1.5) return { level: 'jaune', word: `jaune (revendications à ${fr2(ratio)}${NB}fois la moyenne, non confirmées)` };
    return { level: 'vert', word: 'vert (aucune alerte CERT-FR en cours)' };
  };
  // Sites visés en 24 h, par nature (lieu quand il est sûr) ; état des sites lents ou injoignables seulement.
  const hackedSummary = (hacked) => {
    const KIND_PL = { 'préfecture': 'préfectures', administration: 'administrations', 'collectivité': 'collectivités', port: 'ports', site: 'autres sites' };
    const parts = Object.keys(KIND_PL).map((k) => { const hs = hacked.filter((h) => h.kind === k); if (!hs.length) return null;
      const names = [...new Set(hs.map((h) => (h.place && k !== 'site' ? h.place.name.replace(/^Préfecture /, '') : h.host)))];
      return `${hs.length}${NB}${hs.length > 1 ? KIND_PL[k] : KIND_PL[k].replace(/s$/, '').replace('autre site', 'autre site')} (${names.join(', ')})`; }).filter(Boolean);
    const bad = hacked.filter((h) => targetLevel(h) === 'orange');
    return `${plural(hacked.length, 'site')} français dans les listes de cibles du groupe pro-russe NoName057(16) en 24${NB}h : ${parts.join(' ; ')}. `
      + (bad.length ? `Lents ou injoignables à la dernière sonde : ${bad.map((h) => `${h.host} (${targetText(h)})`).join(', ')}.` : 'Tous joignables à la dernière sonde (toutes les 10 min).');
  };
  const cyberNote = () => {
    const c = S.data.cyber ?? {}, cert = c.certfr ?? {}, kev = c.kev ?? {}, rw = c.ransomware ?? {};
    const open = (cert.alerts ?? []).filter((x) => x.status === 'en-cours');
    const closed = (cert.alerts ?? []).filter((x) => x.status !== 'en-cours').slice(0, 3);
    const week = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
    const kev7 = (kev.recent ?? []).filter((x) => x.dateAdded >= week);
    const kw = kev.weeks ?? [], kevAvg = kw.length > 1 ? kw.slice(0, -1).reduce((n, x) => n + x.added, 0) / (kw.length - 1) : null;
    const avis7 = (cert.avis ?? []).filter((x) => (x.lastVersion ?? x.firstVersion) >= week).length;
    const dcs = (S.data.cloud?.reference?.datacenters ?? []).filter((x) => x.lat != null);
    const dcTop = [...dcs.reduce((g, x) => g.set(S.agg.get(S.dcDept?.get(x.id))?.nom ?? 'n.d.', (g.get(S.agg.get(S.dcDept?.get(x.id))?.nom ?? 'n.d.') ?? 0) + 1), new Map())].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const land = [...(S.landings ?? [])].sort((a, b) => b.n - a.n);
    const zonesKo = Object.values(S.data.cloud?.providers ?? {}).flatMap((p) => p.zones ?? []).filter((z) => z.status && z.status !== 'vert');
    const pct = (r) => `${r >= 1 ? '+' : ''}${Math.round((r - 1) * 100)}${NB}%`;
    const threat = cyberThreat();
    const hacked = (S.data.watch?.ddosia?.hosts ?? []).filter(isRecentTarget);
    return { sources: ['CERT-FR', 'CISA', 'Ransomware', 'Pages'], title: 'Vigilance cyber',
      sub: `France entière · niveau de la menace : ${threat.word} · dans l’indice national : situation « élevée » au plus, jamais critique`, level: threat.level, at: when(new Date().toISOString()),
      blocks: [
        ['Ce qui se passe', [
          hacked.length ? hackedSummary(hacked) : 'Aucun site français dans les listes de cibles de NoName057(16) en 24' + NB + 'h.',
          open.length ? `${open.length}${NB}alertes CERT-FR en cours, dont ${open.filter((x) => x.exploited).length}${NB}exploitées :` : 'Aucune alerte CERT-FR en cours.',
          ...open.map((x) => `${x.title} (${x.ref}, depuis le ${day(x.firstVersion)}${x.lastVersion !== x.firstVersion ? `, mise à jour le ${day(x.lastVersion)}` : ''})${x.exploitedQuote ? ` : « ${x.exploitedQuote} »` : ''}`),
          closed.length ? `Clôturées récemment : ${closed.map((x) => `${x.title} (${x.closedAt ? `le ${day(x.closedAt)}` : 'date n.d.'})`).join(' ; ')}.` : null,
          `${avis7}${NB}avis CERT-FR publiés ou mis à jour en 7${NB}jours.`,
        ].filter(Boolean)],
        ['Failles exploitées (CISA KEV)', [
          `${kev7.length}${NB}faille${kev7.length > 1 ? 's' : ''} ajoutée${kev7.length > 1 ? 's' : ''} en 7${NB}jours${kevAvg != null ? ` (moyenne ${num(Math.round(kevAvg * 10) / 10)}${NB}par semaine sur ${kw.length - 1}${NB}semaines)` : ''} ; ${num(kev.count ?? 0)}${NB}au catalogue.`,
          ...kev7.slice(0, 6).map((x) => `${x.vendor} ${x.product} (${x.cve}), ajoutée le ${day(x.dateAdded)}, correctif exigé avant le ${day(x.dueDate)}${x.ransomware ? ', utilisée par des rançongiciels' : ''}${x.certfrRefs?.length ? `, reprise par le CERT-FR (${x.certfrRefs.join(', ')})` : ''}.`),
        ]],
        ['Rançongiciels (revendications visant la France)', [
          `${rw.last30 ?? 'n.d.'}${NB}revendications en 30${NB}jours, pour ${num(Math.round(rw.baseline30 ?? 0))}${NB}en moyenne${rw.baseline30 ? ` (${pct(rw.last30 / rw.baseline30)})` : ''} ; ${rw.weekCount ?? 'n.d.'}${NB}cette semaine.`,
          (rw.sectors30 ?? []).length ? `Secteurs : ${rw.sectors30.filter((x) => !/Other|Not Found/.test(x.label)).slice(0, 5).map((x) => `${SECTOR[x.label] ?? x.label} ${x.count}`).join(', ')}.` : null,
          (rw.groups30 ?? []).length ? `Groupes : ${rw.groups30.slice(0, 5).map((x) => `${x.label} ${x.count}`).join(', ')}.` : null,
        ].filter(Boolean)],
        ['Exposition (sur la carte avec la pastille)', [
          `${dcs.length}${NB}centres de données inventoriés, surtout ${dcTop.map(([k, n]) => `${k} ${n}`).join(', ')}.`,
          `${land.length}${NB}points d’atterrage de câbles sous-marins, les plus concentrés : ${land.slice(0, 3).map((l) => `${l.commune} (${plural(l.n, 'câble')})`).join(', ')}.`,
          zonesKo.length ? `${zonesKo.length}${NB}zone${zonesKo.length > 1 ? 's' : ''} cloud dégradée${zonesKo.length > 1 ? 's' : ''} selon les pages d’état.` : 'Zones cloud en France : aucune dégradation déclarée sur les pages d’état.',
        ]],
        ['Évolution', [`Revendications de rançongiciels par semaine, ${(rw.weeks ?? []).length}${NB}semaines.`]],
        ['Ce qu’on ne sait pas', [
          'Lieu des incidents : ni le CERT-FR ni les revendications ne donnent de localisation publique ; aucune victime n’est placée sur la carte.',
          'Revendications non confirmées par les victimes (Ransomware.live).',
          'Exposition réelle des équipements français aux failles citées : non mesurée (pas de balayage).',
        ]]], spark: rw.weeks, sparkKey: 'count', sparkCap: 'Revendications par semaine visant la France' };
  };
  // Sources propres à la fiche : un aéronef ne dépend que de l'ADS-B, un site de la liste interne.
  const sourcesOf = (n) => (n.sources ? freshness().filter(([k]) => n.sources.some((x) => k.startsWith(x))) : freshness());
  const noteText = (n) => [`${n.title} · ${n.sub}`, `Situation au ${n.at}`, ...n.blocks.map(([h, xs]) => `${h} : ${xs.join(' ')}`),
    `Sources : ${sourcesOf(n).map(([k, v]) => `${k} ${v}`).join(' ; ') || 'liste interne de sites publics, sans date par site'}.`].join('\n');

  const openFiche = (kind, key, silent) => {
    let n = null;
    if (kind === 'dept') { const a = S.agg.get(key); if (a) n = deptNote(a); }
    if (kind === 'air') { const a = airOf(key); if (a) n = airNote(a); }
    if (kind === 'base') { const b = S.bases.find((x) => x.properties.id === key); if (b) n = baseNote(b); }
    if (kind === 'cyber') n = cyberNote();
    if (!n) { if (!silent) closeFiche(); return; }
    S.fiche = { kind, key };
    const lvl = n.level ? `<span class="mqs-lvl" style="background:${L1[n.level]};color:${n.level === 'jaune' ? '#1a1a1a' : '#fff'}">${WORD[n.level]}</span>` : '';
    panel.innerHTML = `<header><div><h3>${esc(n.title)}</h3><div class="mqs-sub">${lvl}${esc(n.sub)}</div><div class="mqs-at">Situation au ${n.at}</div></div>`
      + `<button class="mqs-x" aria-label="Fermer">×</button></header>`
      + n.blocks.map(([h, xs]) => sec(h, li(xs.map(esc)) + (h === 'Évolution' && n.spark ? spark(n.spark, n.sparkKey, n.sparkCap) : ''))).join('')
      + sec('Sources et confiance', sourcesOf(n).length === 0 ? '<ul><li>Liste interne de sites publics, sans date par site.</li></ul>' : `<table>${sourcesOf(n).map(([k, v, st]) => `<tr><td><i class="mqs-src-${st}"></i>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>`)
      + `<footer><button class="mqs-copy">Copier pour la note</button><span class="mqs-copied"></span></footer>`;
    panel.style.display = 'flex';
    if (legend.dataset.open === 'true') { legend.dataset.open = 'false'; renderLegend(); }
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
  const icon = (name, color, bg) => `<span class="mqs-ic"${bg ? ` style="background:${bg};border-color:${bg}"` : ''}>${EXTRA[name] ? `<svg width="14" height="14" viewBox="0 0 24 24" style="color:${color ?? INK}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${EXTRA[name]}</svg>` : fmIcon(name, { size: 14 }).replace('<svg', `<svg style="color:${color ?? INK}"`)}</span>`;
  // Remplace le bouton « Légende » de l'app (un seul point d'entrée), fermée par défaut comme les autres thèmes.
  const shapeSw = (t, solid) => `<svg width="13" height="13" viewBox="0 0 28 28" style="flex:0 0 13px"><path d="${SHAPE[t]}" fill="${BASE_HEX[t]}" stroke="#fff" stroke-width="2.5" ${solid ? '' : 'stroke-dasharray="3.5 2.5"'}/></svg>`;
  const renderLegend = () => {
    const open = legend.dataset.open === 'true';
    const src = freshness(), ko = src.filter((r) => r[2] !== 'ok').length;
    legend.classList.toggle('is-open', open);
    legend.innerHTML = !open ? `<button class="mqs-leg-toggle">${icon('circle-help')}Légende${ko ? `<em>${ko}${NB}source${ko > 1 ? 's' : ''} en défaut</em>` : ''}</button>` : `
      <header><h4>Lire la carte</h4><button class="mqs-x mqs-leg-toggle" aria-label="Fermer">×</button></header>
      <h5>État : seulement ce qui est anormal</h5>
      <div class="mqs-row">${swatch(L1.jaune, 'disc')}Vigilance ${swatch(L1.orange, 'disc')}Alerte ${swatch(L1.rouge, 'disc')}Crise</div>
      <div class="mqs-row mqs-note">Disque = sites mobiles coupés depuis moins de 24${NB}h dans le département (seuils ${T.join(' / ')}), taille selon le nombre ; contour du département à son état ; orange aussi pour une coupure Internet en cours.</div>
      <div class="mqs-row mqs-note">Aplat léger du département = pression globale (score), plein avec sa pastille.</div>
      <h5>Couche : une couleur par catégorie</h5>
      <div class="mqs-row">${['air', 'navy', 'army', 'joint', 'other'].map((t) => `${shapeSw(t, true)}${BASE_WORD[t] ?? 'autre'}`).join(' ')}</div>
      <div class="mqs-row mqs-note">${shapeSw('air', false)}Site de défense : la forme dit l’armée ; trait plein = source publique citée, pointillé = sans source ; fermés en gris.</div>
      <div class="mqs-row"><span class="mqs-chev" style="color:${CAT.defense}">➤</span>aéronef militaire français <span class="mqs-chev" style="color:${CAT.defenseOther}">➤</span>autre pays, orienté selon le cap</div>
      <div class="mqs-row">${swatch(CAT.cables, 'line')}Câble sous-marin, tracé complet ${swatch(CAT.cables, 'dash')}prévu ${swatch('#6e7585', 'line')}hors service</div>
      <div class="mqs-row mqs-note">Au large, suite du tracé d’après TeleGeography ou OpenStreetMap ; ${swatch('#c7c7cc', 'ring')}fin du relevé du Shom sans suite publiée.</div>
      <div class="mqs-row">${swatch(CAT.cables, 'disc')}Atterrage : taille = nombre de câbles au même endroit</div>
      <div class="mqs-row mqs-note">Avec la pastille : zones de protection des câbles (aplat cyan) et mouillages qui les recoupent (pointillé blanc).</div>
      <div class="mqs-row">${swatch(CAT.telecom, 'disc')}Site mobile coupé depuis moins de 24${NB}h, lettre = opérateur (O, S, B, F), anneau = état du département ${swatch('#a855f7', 'disc')}panne plus ancienne ${swatch('#c7c7cc', 'disc')}maintenance</div>
      <div class="mqs-row">${swatch(CAT.internet, 'ring')}Coupure Internet terminée sur 7${NB}jours (durée cumulée, département teinté) ${swatch(L1.orange, 'disc')}coupure en cours</div>
      <div class="mqs-row">${icon('cloud', '#fff', CAT.cloud)}Site cloud (pages d’état, zones regroupées ; couleur d’état si incident) ${icon('server', '#fff', CAT.dc)}centre de données en service ${icon('server', CAT.dc, DARK)}en projet (avec la pastille)</div>
      <div class="mqs-row">${swatch(PROT.annonce, 'ring')}Manifestation annoncée ${swatch(PROT.signale, 'disc')}rapportée sans heurts ${swatch(L1.rouge, 'disc')}heurts ou tensions ; taille = articles sur 24${NB}h</div>
      <div class="mqs-row mqs-note">Criminalité (SSMSI, annuelle, jamais une alerte) : ${CRIME_RAMP.slice(0, 4).map(([, c, w]) => `${swatch(c, 'disc')}${w}`).join(' ')} la moyenne nationale. Sans pastille, villes à 2 fois ou plus en anneau ; avec la pastille, toutes les villes de 20${NB}000 habitants et plus et les départements, pour l’indicateur du panneau.</div>
      <div class="mqs-row">${swatch('#22d3ee', 'line')}Flux piétons (estimations modélisées) : rue chargée, ${swatch(L1.jaune, 'line')}${swatch(L1.orange, 'line')}${swatch(L1.rouge, 'line')}saturation possible, probable, très probable</div>
      <div class="mqs-row mqs-note">Totaux de la phase : couleur = part des tirages où la rue sature, épaisseur = personnes passées. Rejeu (curseur du panneau) : couleur = débit rapporté à la capacité de la rue (jaune dès la moitié, rouge au-delà), épaisseur = débit. ${swatch('#e5e7eb', 'dash')}5, 10 et 20${NB}min à pied ; ${swatch('#ffffff', 'ring')}anneau blanc autour d’une manifestation : foule estimée par le modèle (clic : ses rues et le rejeu) ; prévision dont l’annonce a quitté la couche : ${swatch('#ffffff', 'disc')}en cours, ${swatch('#ffffff', 'ring')}à venir, ${swatch('#6b7280', 'ring')}passé.</div>
      <div class="mqs-row">${swatch('#e8e8ec', 'dash')}Zone de défense et de sécurité</div>
      <div class="mqs-row mqs-note">Sans pastille active, toutes les couches sont affichées. Une pastille met sa couche en avant et estompe les autres (clic, cumulable ; survol pour un aperçu).</div>
      <details${ko ? ' open' : ''}><summary>Sources · ${src.length - ko}${NB}à jour, ${ko}${NB}en défaut</summary>${src.map(([k, v, st]) => `<div class="mqs-row mqs-src"><i class="mqs-src-${st}"></i><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</details>`;
    legend.querySelectorAll('.mqs-leg-toggle').forEach((b) => { b.onclick = () => { legend.dataset.open = String(!open); renderLegend(); }; });
  };

  // ─── Légende courte des pastilles allumées ou survolée, sous la barre (comme les pastilles Énergie) ───
  const FOCUS_KEY = {
    military: () => ['Défense', [...['air', 'navy', 'army', 'joint'].map((t) => [shapeSw(t, true), `Site ${BASE_WORD[t] ?? 'autre'}`]),
      [shapeSw('air', false), 'Pointillé : site sans source publique'],
      [`<span class="mqs-chev" style="color:${CAT.defense}">➤</span>`, 'Aéronef militaire français, orienté selon le cap'],
      [`<span class="mqs-chev" style="color:${CAT.defenseOther}">➤</span>`, 'Aéronef militaire d’un autre pays']]],
    subseaCables: () => ['Câbles sous-marins', [[swatch(CAT.cables, 'line'), 'Câble en service'], [swatch(CAT.cables, 'dash'), 'Câble prévu'],
      [swatch('#6e7585', 'line'), 'Hors service'], [swatch(CAT.cables, 'disc'), 'Atterrage, taille = nombre de câbles'],
      [swatch('#ffffff', 'dash'), 'Mouillage qui recoupe une zone de protection']]],
    cyber: () => ['Vigilance cyber', [[swatch(CAT.hacktivist, 'disc'), 'Site visé par NoName057(16), anneau = état du site'],
      [icon('server', '#fff', CAT.dc), 'Centre de données'], [icon('cloud', '#fff', CAT.cloud), 'Site cloud'], [swatch(CAT.cables, 'disc'), 'Atterrage de câbles']]],
    stability: () => ['Pression par département', [[swatch(L1.jaune, 'disc'), 'Vigilance'], [swatch(L1.orange, 'disc'), 'Alerte'], [swatch(L1.rouge, 'disc'), 'Crise'],
      [swatch('#8a93a6', 'none'), 'Aplat du département = score global']]],
    outagesTelecom: () => ['Télécoms mobiles', [[swatch(CAT.telecom, 'disc'), `Site coupé depuis moins de 24${NB}h, lettre = opérateur`],
      [swatch('#a855f7', 'disc'), 'Panne plus ancienne'], [swatch('#c7c7cc', 'disc'), 'Maintenance'],
      [swatch(L1.orange, 'disc'), 'Département : disque et contour à son état']]],
    outagesInternet: () => ['Internet', [[swatch(L1.orange, 'disc'), 'Coupure en cours (IODA)'], [swatch(CAT.internet, 'ring'), `Coupure terminée sur 7${NB}jours`]]],
    outagesCloud: () => ['Cloud et hébergement', [[icon('cloud', '#fff', CAT.cloud), 'Site cloud, couleur d’état si incident'],
      [icon('server', '#fff', CAT.dc), 'Centre de données en service'], [icon('server', CAT.dc, DARK), 'Centre de données en projet']]],
    protests: () => ['Manifestations', [[swatch(PROT.annonce, 'ring'), 'Annoncée, non confirmée'], [swatch(PROT.signale, 'disc'), 'Rapportée sans heurts'],
      [swatch(L1.rouge, 'disc'), 'Heurts ou tensions'], [swatch('#ffffff', 'ring'), 'Anneau blanc autour : foule estimée (clic : rues et rejeu)'],
      [swatch('#8a93a6', 'none'), `Taille = articles sur 24${NB}h`],
      // Rues du rassemblement choisi (foule estimée, mêmes mots que flux-pietons-legend.ts).
      [swatch('#22d3ee', 'line'), 'Rue fluide (estimation)'], [swatch(L1.jaune, 'line'), 'Saturation possible'],
      [swatch(L1.orange, 'line'), 'Saturation probable'], [swatch(L1.rouge, 'line'), 'Saturation très probable']]],
    crime: () => ['Criminalité (annuelle)', CRIME_RAMP.slice(0, 4).map(([, c, w]) => [swatch(c, 'disc'), `${w.charAt(0).toUpperCase()}${w.slice(1)}${/moyenne/.test(w) ? '' : ' la moyenne'}`])],
    // Mêmes mots que la légende de la couche (flux-pietons-legend.ts) : totaux de la phase, ou instant du rejeu (curseur du panneau).
    pedestrianFlows: () => ['Flux piétons (estimations)', [[swatch('#22d3ee', 'line'), 'Rue fluide ; épaisseur = personnes passées, ou débit au rejeu'],
      [swatch(L1.jaune, 'line'), 'Saturation possible ; au rejeu, débit dès la moitié de la capacité'],
      [swatch(L1.orange, 'line'), 'Saturation probable ; au rejeu, débit proche de la capacité'],
      [swatch(L1.rouge, 'line'), 'Saturation très probable ; au rejeu, rue saturée'],
      [swatch('#e5e7eb', 'dash'), `Isochrones 5, 10 et 20${NB}min à pied`], [swatch('#ffffff', 'ring'), 'Manifestation prévue : anneau blanc, foule estimée dans l’étiquette'],
      [swatch('#6b7280', 'ring'), 'Prévision sans annonce en cours (gris = passé)'], [swatch('#8a93a6', 'none'), 'Clic sur un point : ses rues et le rejeu']]],
  };
  const focusKey = document.createElement('div');
  focusKey.id = 'mqs-focus-key';
  document.body.appendChild(focusKey);
  const renderFocusKey = () => {
    const keys = [...S.focus]; if (preview && !keys.includes(preview)) keys.push(preview);
    const bar = document.querySelector('.floating-panel-switcher');
    const html = isSec() && bar && !bar.hidden ? keys.filter((k) => FOCUS_KEY[k]).map((k) => {
      const [title, rows] = FOCUS_KEY[k]();
      return `<div class="ef-key"><div class="ef-title">${esc(title)}</div>${rows.map(([sw, t]) => `<div class="ef-row">${sw}<span>${esc(t)}</span></div>`).join('')}</div>`;
    }).join('') : '';
    focusKey.innerHTML = html;
    focusKey.style.display = html ? 'flex' : 'none';
    if (!html) return;
    const r = bar.getBoundingClientRect();
    focusKey.style.left = `${Math.round(r.left)}px`; focusKey.style.top = `${Math.round(r.bottom + 6)}px`;
  };

  // ─── Encart cyber : jamais critique, jamais sur la carte ───
  const cyber = document.createElement('div');
  cyber.className = 'mqs-cyber';
  // Veille élargie dans l'encart : cibles d'hacktivistes en 24 h, DDoS du dernier jour, services publics injoignables.
  const watchLines = () => {
    const w = S.data.watch;
    if (!w) return '';
    const now = Date.now();
    const recent = (w.ddosia?.hosts ?? []).filter((h) => now - Date.parse(h.last) < 864e5);
    const degraded = recent.filter((h) => targetLevel(h) === 'orange');
    const ratio = w.radar ? Math.max(w.radar.l7Ratio ?? 0, w.radar.l3Ratio ?? 0) : null;
    const down = (w.services?.items ?? []).filter((x) => !x.ok);
    const line = (hex, text) => `<div class="mqs-cy-w"><i style="background:${hex}"></i>${esc(text)}</div>`;
    return line(degraded.length ? L1.orange : recent.length ? L1.jaune : CAT.hacktivist, recent.length ? `Hacktivistes : ${plural(recent.length, 'site')} français visé${recent.length > 1 ? 's' : ''} en 24${NB}h (NoName057(16))${degraded.length ? `, ${degraded.length} lent${degraded.length > 1 ? 's' : ''} ou injoignable${degraded.length > 1 ? 's' : ''}` : ', tous joignables'}` : 'Hacktivistes : aucun site français visé en 24 h')
      + (ratio !== null ? line(ratio >= 4 ? L1.orange : ratio >= 2 ? L1.jaune : '#f472b6', `DDoS vers la France : ${fr2(ratio)}${NB}× la médiane (Cloudflare)`) : '')
      + (w.services ? line(down.length ? L1.rouge : L1.vert, down.length ? `Injoignable : ${down.map((x) => x.name).join(', ')}` : `${w.services.items.length} services publics en ligne`) : '');
  };
  const renderCyber = () => {
    const c = S.data.cyber?.certfr;
    const open = (c?.alerts ?? []).filter((x) => x.status === 'en-cours');
    const exploited = open.filter((x) => x.exploited).length;
    const threat = cyberThreat();
    cyber.innerHTML = `<div class="mqs-cy-h">${icon('shield', threat.level && threat.level !== 'vert' ? L1[threat.level] : MUTE)}<b>Cyber</b><span>${open.length ? `${open.length}${NB}alertes CERT-FR en cours, dont ${exploited}${NB}exploitées` : 'aucune alerte CERT-FR en cours'}</span></div>`
      + (open.length ? `<div class="mqs-cy-l">${open.slice(0, 3).map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener" title="${esc(x.title)}">${esc(x.title)}</a>`).join('')}</div>` : '')
      + watchLines()
      + `<div class="mqs-cy-s">Niveau de la menace : ${esc(threat.word)} · l’indice national plafonne le cyber (jamais critique) · <a href="#" class="mqs-cy-more">fiche détaillée</a></div>`;
    const more = cyber.querySelector('.mqs-cy-more'); if (more) more.onclick = (e) => { e.preventDefault(); openFiche('cyber', 'fr'); };
  };

  const css = `
  body.mqs-on .maplibregl-popup, body.mqs-on .military-tooltip, body.mqs-on .wm-popup, body.mqs-on .deck-tooltip { display: none !important; }
  .mqs-pop .et-card { max-width: 400px; } .mqs-pop .et-row b { white-space: normal; text-align: right; } .mqs-pop .et-row span { flex: 0 0 auto; max-width: 45%; }
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
  .map-key-btn, .map-key { display: none !important; }
  .mqs-legend { position: absolute; right: 60px; bottom: 34px; z-index: 29; color: #d9dde5; font-size: 11.5px; }
  .mqs-legend.is-open { bottom: 52px; width: 290px; max-height: calc(100% - 330px); overflow-y: auto; background: rgba(18,20,26,.97); border: 1px solid #2a2e37; border-radius: 10px; padding: 10px 12px; }
  .mqs-legend header { display: flex; justify-content: space-between; align-items: center; } .mqs-legend h4 { margin: 0; font-size: 13px; }
  .mqs-legend details { margin-top: 8px; } .mqs-legend summary { cursor: pointer; color: #9aa1ae; font-size: 11px; font-weight: 600; }
  .mqs-legend:not(.is-open) .mqs-leg-toggle { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 999px; background: rgba(18,20,26,.95); }
  .mqs-leg-toggle em { font-style: normal; color: #ffcc00; font-size: 10.5px; margin-left: 2px; }
  .mqs-legend h5 { margin: 10px 0 4px; font-size: 11px; color: #9aa1ae; font-weight: 600; } .mqs-row { display: flex; align-items: center; gap: 6px; margin: 3px 0; }
  .mqs-leg-toggle { background: #1c2029; color: #e8e8ec; border: 1px solid #2a2e37; border-radius: 6px; padding: 3px 10px; cursor: pointer; font-size: 11.5px; }
  #mqs-focus-key { position: fixed; z-index: 3000; pointer-events: none; display: none; flex-direction: column; gap: 6px; }
  #mqs-focus-key .ef-row { gap: 8px; } #mqs-focus-key .mqs-ic { width: 16px; height: 16px; }
  .mqs-sw { display: inline-block; flex: 0 0 auto; } .mqs-sw-disc { width: 12px; height: 12px; border-radius: 50%; background: var(--c); box-shadow: 0 0 0 1.5px #05060a; }
  .mqs-sw-none { width: 12px; height: 12px; border-radius: 50%; border: 1px dashed #4a4f5c; }
  .mqs-sw-line { width: 22px; height: 0; border-top: 2px solid var(--c); } .mqs-sw-dash { width: 22px; height: 0; border-top: 2px dashed var(--c); }
  .mqs-ic { display: inline-flex; width: 18px; height: 18px; border-radius: 50%; background: #161a22; border: 1.5px solid #8a93a6; align-items: center; justify-content: center; }
  .mqs-ic svg { width: 11px; height: 11px; }
  .mqs-chev { color: #fff; font-size: 11px; } .mqs-chev-o { color: transparent; -webkit-text-stroke: 1px #fff; }
  .mqs-src { align-items: flex-start; } .mqs-src i { margin-top: 4px; } .mqs-src span { color: #9898a8; flex: 0 0 auto; white-space: nowrap; } .mqs-src b { font-weight: 500; margin-left: auto; text-align: right; flex: 1; }
  [class^="mqs-src-"] { display: inline-block; width: 8px; height: 8px; border-radius: 50%; flex: 0 0 8px; margin-right: 4px; }
  .mqs-src-ok { background: #6e7585; } .mqs-src-part { background: transparent; border: 1.5px solid #9aa1ae; } .mqs-src-ko { background: repeating-linear-gradient(45deg, #9aa1ae 0 2px, transparent 2px 4px); border: 1px solid #9aa1ae; }
  .mqs-cyber { position: absolute; right: 12px; top: 110px; z-index: 29; width: 270px; background: rgba(18,20,26,.96); border: 1px solid #2a2e37; border-radius: 10px; padding: 8px 12px; color: #d9dde5; font-size: 11.5px; }
  .mqs-cy-h { display: flex; align-items: center; gap: 6px; } .mqs-cy-h span { color: #aab0bc; }
  .mqs-cy-l a { display: block; color: #d9dde5; text-decoration: none; margin: 4px 0 0 24px; line-height: 1.3; } .mqs-cy-l a:hover { text-decoration: underline; }
  .mqs-cy-s { color: #6e6e80; font-size: 10.5px; margin-top: 4px; }
  .mqs-sw-ring { width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--c); background: #05060a; }
  .mqs-note { color: #9898a8; font-size: 11px; }
  .mqs-cy-w { display: flex; align-items: center; gap: 6px; margin-top: 4px; font-size: 11px; color: #c7cbd4; }
  .mqs-cy-w i { width: 7px; height: 7px; border-radius: 50%; flex: none; }
  .mqs-cyber.is-focus { border-color: #ffcc00; box-shadow: 0 0 0 2px rgba(255,204,0,.35); } .mqs-cyber.is-dim { display: none; }
  .mqs-chip { display: inline-flex; align-items: center; gap: 5px; background: #1c2029; color: #d9dde5; border: 1px solid #2a2e37; border-radius: 999px; padding: 2px 10px 2px 3px; cursor: pointer; font-size: 11.5px; }
  .mqs-chip[aria-pressed="true"] { background: #e8e8ec; color: #111; } .mqs-chip[aria-pressed="true"] .mqs-ic { border-color: #111; }
  .mqs-chip-h { color: #6e6e80; font-size: 10.5px; padding: 0 4px; }
  `;

  const start = async () => {
    for (let i = 0; i < 200 && !window._franceMonitorMap; i += 1) await wait(100);
    S.m = window._franceMonitorMap;
    const lib = window.__fmMaquette ?? {};
    fmIcon = lib.fmIcon ?? (await import('/src/components/shared/icons.ts')).fmIcon;
    // Rien n'est chargé tant que l'onglet Sécurité et défense n'a pas été ouvert.
    while (!isSec()) await wait(1000);
    for (let i = 0; i < 120 && !S.m.getLayer('military-bases-circle'); i += 1) await wait(250);
    const [geo, deptShapes] = await Promise.all([getJson('/maquette-securite-geo.json'), getJson('/data/departements.geojson')]);
    S.geo = { zones: geo.zones, deptShapes: deptShapes.features };
    S.depts = geo.depts;
    const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
    const host = S.m.getContainer();
    host.append(pop, panel, legend, cyber);
    wireChips();
    // Sites de défense : liste interne complète, fermés compris (affichés en gris), avec source et date de vérification.
    const ALL_MILITARY_INSTALLATIONS = lib.ALL_MILITARY_INSTALLATIONS ?? (await import('/src/config/military-bases-db.ts')).ALL_MILITARY_INSTALLATIONS;
    S.bases = ALL_MILITARY_INSTALLATIONS.map((b) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: b.coordinates }, properties: { ...b } }));
    S.bases ??= [];
    [S.cablesFile, S.osm, S.world, S.suite] = await Promise.all([getJson('/data/subsea-cables.json'), getJson('/data/defense-osm-works.json'), getJson('/maquette-cables-monde.json'), getJson('/maquette-cables-suite.json')]);
    // Criminalité en vue d'ensemble : un indicateur communal fixe (violences physiques hors famille), l'indicateur du panneau s'applique avec la pastille.
    // Manifestations et Criminalité : données lues par la maquette elle-même, car l'app ne les charge que si la couche est cochée (un état enregistré plus ancien ne la coche pas).
    S.crimeDs = await getJson('/data/crime.json');
    // Indicateur changé dans le panneau Criminalité : la carte suit.
    document.addEventListener('change', (e) => { if (e.target?.matches?.('select[data-crime-indicator]')) setTimeout(draw, 50); });
    audit();
    const load = async () => {
      const [telecom, internet, military, cablesWatch, gnss, cyberData, cloud, protests, watch, flux] = await Promise.all(['/api/outages/telecom', '/api/outages/internet', '/api/sovereignty/military',
        '/api/sovereignty/cables-watch', '/api/sovereignty/gnss', '/api/sovereignty/cyber', '/api/outages/cloud', '/api/social/protests', '/api/sovereignty/cyber-watch', '/data/flux-pietons/index.json'].map(getJson));
      S.data = { telecom, internet, military, cablesWatch, gnss, cyber: cyberData, cloud, protests, watch, flux };
      await draw();
    };
    await load();
    setInterval(load, 5 * 60 * 1000);
    S.m.on('idle', calm);
    // Changement d'onglet : la carte Sécurité se retire ou revient sans attendre un mouvement de la carte.
    setInterval(() => { if (isSec() !== Boolean(S.wasSec)) applyFocus(); }, 700);
    S.m.on('move', placePop);
    S.m.on('mousemove', onMove);
    S.m.getCanvas().addEventListener('mouseleave', () => setDeptHover(null));
    // Clic : premier clic = bulle de l'objet ; second clic sur le même objet = sa fiche ou sa source
    // (la fiche de la maquette remplace les fenêtres et déplacements de l'app, capturé avant MapLibre).
    host.addEventListener('click', (e) => {
      if (e.target !== S.m.getCanvas() || !isSec()) return;
      e.stopPropagation();
      const r = S.m.getCanvas().getBoundingClientRect();
      const hit = pick([e.clientX - r.left, e.clientY - r.top]);
      if (!hit) { closeFiche(); pop.style.display = 'none'; popAt = null; S.hoverKey = null; return; }
      if (hit.kind === 'flux' && window.__fmFlux && window.__fmFlux.selectedId() !== hit.id) window.__fmFlux.select(hit.id);
      const linked = hit.kind === 'base' && S.audit.get(hit.id)?.source;
      const next = linked || hit.card?.url ? 'Cliquer à nouveau pour ouvrir la source'
        : ['dept', 'air', 'base', 'site'].includes(hit.kind) ? 'Cliquer à nouveau pour ouvrir la fiche' : null;
      if (S.hoverKey !== hit.key || pop.style.display === 'none' || !next) {
        const at = S.m.unproject([e.clientX - r.left, e.clientY - r.top]);
        popAt = hit.at ?? [at.lng, at.lat];
        pop.innerHTML = card(hit.card, next); S.hoverKey = hit.key;
        pop.style.display = 'block'; placePop();
        return;
      }
      pop.style.display = 'none'; popAt = null; S.hoverKey = null;
      if (hit.kind === 'base' && S.audit.get(hit.id)?.source) { window.open(S.audit.get(hit.id).source, '_blank', 'noopener'); return; }
      if (hit.card?.url) { window.open(hit.card.url, '_blank', 'noopener'); return; }
      if (hit.kind === 'dept' || hit.kind === 'air' || hit.kind === 'base') openFiche(hit.kind, hit.id);
      else if (hit.kind === 'site') { const s = (S.data.telecom?.sites ?? []).find((x) => x.id === hit.id); if (s) openFiche('dept', s.dept); }
    }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeFiche(); pop.style.display = 'none'; } });
    window.__mqs = S;
    console.log('[maquette-securite] prête', { seuils: T, depts: [...S.agg.values()].filter((a) => a.level !== 'vert').length });
  };
  start();
})();
