// Carte « Santé » (18/10/2026) : chargée par DeckGLMap, active seulement quand l'onglet Santé est choisi.
// Lecture décisionnelle : le département est l'unité, une couche par canal visuel (trait = urgences, aplat = accès aux soins,
// formes = hôpitaux, pointillé = régions), une seule bulle, fiche au format note de situation.
(function () {
  const NB = ' ';
  const L1 = { vert: '#34c759', jaune: '#ffcc00', orange: '#ff9500', rouge: '#ff3b30' };
  const WORD = { vert: 'Normal', jaune: 'Vigilance', orange: 'Alerte', rouge: 'Crise' };
  const RANK = { nd: -1, vert: 0, jaune: 1, orange: 2, rouge: 3 };
  const INK = '#d9dde5', MUTE = '#8a93a6';
  const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const num = (n, d = 0) => (n == null || !Number.isFinite(Number(n)) ? 'n.d.' : Number(n).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }).replace(/\s/g, NB));
  const pct = (x) => (x == null ? 'n.d.' : `${num(x, x < 1 ? 2 : 1)}${NB}%`);
  const signed = (r) => (r == null || !Number.isFinite(r) ? 'n.d.' : `${r >= 0 ? '+' : '−'}${num(Math.abs(r) * 100)}${NB}%`);
  const pad = (n) => String(n).padStart(2, '0');
  const day = (iso) => { if (!iso) return 'n.d.'; const d = new Date(iso); return Number.isNaN(d.getTime()) ? 'n.d.' : `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; };
  const when = (iso) => {
    if (!iso) return 'n.d.';
    const p = Object.fromEntries(new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
    return `${p.day}/${p.month} à ${p.hour}${NB}h${NB}${p.minute}`;
  };
  const wk = (id) => (id ? id.replace(/^\d{4}-S0?/, 'S') : 'n.d.');
  const nth = (n) => (n === 1 ? '1er' : `${n}e`);
  const getJson = async (url) => { try { const r = await fetch(url); return r.ok ? await r.json() : { error: `HTTP ${r.status}` }; } catch (e) { return { error: String(e) }; } };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const km = (a, b) => { const r = Math.PI / 180, dLat = (b[1] - a[1]) * r, dLon = (b[0] - a[0]) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };
  const inRing = (pt, ring) => { let ins = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) ins = !ins; } return ins; };
  const inGeom = (pt, g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).some((p) => inRing(pt, p[0]) && !p.slice(1).some((h) => inRing(pt, h)));

  const S = { m: null, data: {}, depts: new Map(), regions: new Map(), focus: new Set(), fiche: null, hoverKey: null, syndrome: null, prof: 'mg' };
  let fmIcon = null;

  // ─── Lecture des niveaux (mêmes règles que src/services/health-levels.ts) ───
  // Urgences : part des passages de la semaine comparée au maximum des 3 saisons précédentes à la même semaine.
  const seasonalLevel = (v, refs) => { const u = (refs ?? []).filter((r) => Number.isFinite(r)); if (v == null || !Number.isFinite(v) || u.length < 2) return 'nd';
    const max = Math.max(...u); if (v <= max) return 'vert'; if (max <= 0) return 'jaune'; return v >= 1.5 * max ? 'rouge' : v >= 1.15 * max ? 'orange' : 'jaune'; };
  // Grippe et COVID-19 sont comptées dans les IRA : seuls IRA, bronchiolite et gastro-entérite fixent la couleur du département (règle de la pastille de l'app).
  const MAIN = ['ira', 'bronchio', 'gastro'];
  const SYN = { ira: 'IRA', bronchio: 'Bronchiolite', gastro: 'Gastro-entérite', asthme: 'Asthme', allergie: 'Allergie', grippe: 'Grippe', covid: 'COVID-19' };
  const SYN_SHORT = { ira: 'IRA', bronchio: 'Bronchio', gastro: 'Gastro', asthme: 'Asthme', allergie: 'Allergie', grippe: 'Grippe', covid: 'COVID' };
  // Phases Odissé : 1 pas d'alerte, 2 pré-épidémie, 3 épidémie, 4 post-épidémie ; une ligne compte si sa semaine date de moins de 4 semaines.
  const PHASE_LEVEL = { 1: 'vert', 2: 'jaune', 3: 'orange', 4: 'jaune' };
  const PHASE_WORD = { 1: 'pas d’alerte', 2: 'pré-épidémie', 3: 'épidémie', 4: 'post-épidémie' };
  const PATHO = { grippe: 'Grippe', bronchiolite: 'Bronchiolite', covid: 'COVID-19' };
  const inSeason = (l) => { const t = Date.parse(`${l.start}T00:00:00Z`); return Number.isFinite(t) && t + 28 * 864e5 >= Date.now(); };

  // ─── Couleurs : L1 réservé à l'anormal ; une couleur franche par couche ───
  // Accès aux soins (DREES, annuel) : rampe bleue, plus clair = accès plus faible ; jamais les couleurs d'alerte.
  const APL_RAMP = [[1.25, '#123a63', '1,25 fois la France ou plus'], [1, '#0b5f9e', '1 à 1,25 fois'], [0.75, '#0a84d0', '0,75 à 1 fois'], [0.5, '#38bdf8', '0,5 à 0,75 fois'], [0, '#a5e4ff', 'moins de la moitié']];
  const aplHex = (r) => (r == null ? '#2a2a33' : APL_RAMP.find(([t]) => r >= t)[1]);
  const PROF = { mg: 'Généralistes', inf: 'Infirmiers', kine: 'Kinésithérapeutes', sf: 'Sages-femmes', dent: 'Dentistes' };
  const PROF_UNIT = { mg: 'consultations par an et par habitant', inf: `ETP pour 100${NB}000 hab.`, kine: `ETP pour 100${NB}000 hab.`, sf: `ETP pour 100${NB}000 femmes`, dent: `ETP pour 100${NB}000 hab.` };
  const PROF_DIG = { mg: 2, inf: 1, kine: 1, sf: 1, dent: 1 };
  // Hôpitaux : forme et couleur = catégorie (blanc à croix = CHU, magenta = centre hospitalier, losange violet = privé, carré sable = autres).
  const HOSP = { chu: '#ffffff', ch: '#e879f9', private: '#a78bfa', other: '#d9b36c' };
  const HOSP_WORD = { chu: 'CHU ou CHR', ch: 'Centre hospitalier', private: 'Clinique privée', gcs: 'Groupement de coopération (GCS)', army: 'Hôpital des armées', other: 'Autre établissement' };
  const hcat = (c) => (c === 'chu' || c === 'ch' || c === 'private' ? c : 'other');
  const REG_LINE = '#c9cdd6';
  // Sentinelles (médecins généralistes) : turquoise, une couleur de couche, jamais une alerte.
  const SENTI_HEX = '#2dd4bf';

  // ─── Pictos des hôpitaux ───
  const image = (id, svg, size) => new Promise((res) => {
    if (S.m.hasImage(id)) return res(id);
    const img = new Image(size, size);
    img.onload = () => { const c = document.createElement('canvas'); c.width = size; c.height = size; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
      if (!S.m.hasImage(id)) S.m.addImage(id, x.getImageData(0, 0, size, size), { pixelRatio: 2 }); res(id); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
  const HSHAPE = {
    chu: `<circle cx="20" cy="20" r="16" fill="${HOSP.chu}" stroke="#0b1020" stroke-width="2.5"/><path d="M17 10h6v7h7v6h-7v7h-6v-7h-7v-6h7z" fill="#0b1020"/>`,
    ch: `<circle cx="20" cy="20" r="15" fill="${HOSP.ch}" stroke="#0b1020" stroke-width="2.5"/>`,
    private: `<path d="M20 4 L36 20 L20 36 L4 20 Z" fill="${HOSP.private}" stroke="#0b1020" stroke-width="2.5" stroke-linejoin="round"/>`,
    other: `<rect x="7" y="7" width="26" height="26" fill="${HOSP.other}" stroke="#0b1020" stroke-width="2.5"/>`,
  };
  const hospImages = async () => { for (const [k, body] of Object.entries(HSHAPE)) await image(`mqh-h-${k}`, `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">${body}</svg>`, 40); };

  // ─── Noms lisibles (le fichier FINESS est en capitales) ───
  const KEEP = new Set(['CHU', 'CHR', 'CH', 'CHI', 'CHIC', 'CHRU', 'CHG', 'GHU', 'GH', 'GHT', 'APHP', 'AP-HP', 'APHM', 'AP-HM', 'HCL', 'HIA', 'SUN', 'HEGP', 'GCS', 'HPGM', 'IGR', 'ICM', 'MCO', 'PSL', 'SSR', 'HP', 'CMC', 'CHT', 'HU', 'NUP', 'GHEM', 'UPS', 'CUP', 'HM', 'II', 'III', 'IV']);
  const ACC = { Hopital: 'Hôpital', Hopitaux: 'Hôpitaux', Prive: 'Privé', Privee: 'Privée', Medical: 'Médical', Medico: 'Médico', General: 'Général', Generale: 'Générale', Regional: 'Régional',
    Sante: 'Santé', Pediatrique: 'Pédiatrique', Specialise: 'Spécialisé', Etablissement: 'Établissement', Medecine: 'Médecine', Evangelique: 'Évangélique', Hotel: 'Hôtel' };
  const SMALL = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'sur', 'en', 'au', 'aux', 'a', 'à']);
  const nice = (s) => String(s ?? '').toLowerCase().split(/(\s+|-|')/).map((w, i) => {
    if (KEEP.has(w.toUpperCase())) return w.toUpperCase();
    if (i > 0 && SMALL.has(w)) return w;
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join('').replace(/\b([DL])[ ']+(?=[A-ZÉ])/g, (x, c) => `${c.toLowerCase()}’`).replace(/'/g, '’')
    .replace(/\b(Hopital|Hopitaux|Prive|Privee|Medical|Medico|Generale?|Universitaire|Regional|Intercommunal|Mutualiste|Sante|Pediatrique|Specialise|Etablissement|Medecine|Evangelique|Fondation|Hotel)\b/g, (w) => ACC[w] ?? w);
  const commune = (c) => nice(String(c ?? '').replace(/\s+(\d+)(E|ER)\s+ARRONDISSEMENT$/i, ' $1e')).replace(/ (\d+)E$/, ' $1e');
  const cityRoot = (c) => nice(String(c ?? '').replace(/\s+\d+(E|ER)\s+ARRONDISSEMENT$/i, ''));

  // ─── Agrégation par département ───
  const ratio = (v, refs) => { const u = (refs ?? []).filter((r) => Number.isFinite(r)); const max = u.length >= 2 ? Math.max(...u) : null; return max && v != null ? v / max : null; };
  const build = () => {
    const d = S.data, syn = d.syn, apl = d.apl;
    const shapes = new Map((S.geo.deptShapes ?? []).map((f) => [f.properties.code, f]));
    const atOf = new Map((S.geo.depts ?? []).map((x) => [x.code, x.at]));
    const regOf = (at) => { if (!at) return null; for (const f of S.geo.regions) if (inGeom(at, f.geometry)) return f.properties.code; return null; };
    const out = new Map();
    const touch = (code, name) => { if (!out.has(code)) out.set(code, { code, nom: name, at: atOf.get(code) ?? null, inMap: shapes.has(code), reg: regOf(atOf.get(code)), syn: {}, apl: null, hosp: [] }); return out.get(code); };
    for (const f of S.geo.deptShapes) touch(f.properties.code, f.properties.nom);
    for (const x of syn?.departments ?? []) {
      const a = touch(x.code, x.name);
      for (const [k, v] of Object.entries(x.values ?? {})) {
        const refs = v?.refEr ?? [];
        a.syn[k] = { er: v?.er ?? null, hosp: v?.hosp ?? null, sos: v?.sos ?? null, refs, max: refs.length >= 2 ? Math.max(...refs.filter(Number.isFinite)) : null, level: seasonalLevel(v?.er ?? null, refs), ratio: ratio(v?.er ?? null, refs) };
      }
    }
    for (const x of apl?.departments ?? []) { const a = touch(x.code, x.name); a.apl = x; }
    for (const s of d.hosp?.sites ?? []) touch(s.dept, s.dept).hosp.push(s);
    for (const a of out.values()) {
      // Niveau des urgences : le pire des trois syndromes principaux, ou le syndrome choisi dans le panneau.
      const keys = S.syndrome ? [S.syndrome] : MAIN;
      let best = null;
      for (const k of keys) { const r = a.syn[k]; if (!r || r.level === 'nd') continue; if (!best || RANK[r.level] > RANK[best.level] || (r.level === best.level && (r.ratio ?? 0) > (best.ratio ?? 0))) best = { ...r, key: k }; }
      a.urg = best ? best.level : 'nd'; a.driver = best && best.level !== 'vert' ? best.key : null;
      a.others = Object.entries(a.syn).filter(([k, r]) => !keys.includes(k) && RANK[r.level] >= 1).map(([k, r]) => ({ key: k, ...r }));
      const nat = apl?.france?.apl?.[S.prof];
      a.aplV = a.apl?.apl?.[S.prof] ?? null; a.aplR = a.aplV != null && nat ? a.aplV / nat : null;
    }
    S.depts = out;
    // Régions : phases Odissé en saison.
    const regs = new Map();
    for (const f of S.geo.regions) regs.set(f.properties.code, { code: f.properties.code, nom: f.properties.nom, lines: [], level: 'hors' });
    for (const l of d.alerts?.levels ?? []) { const r = regs.get(l.region) ?? { code: l.region, nom: l.regionName, lines: [], level: 'hors' }; r.nom = l.regionName ?? r.nom; r.lines.push(l); regs.set(l.region, r); }
    for (const r of regs.values()) {
      const live = r.lines.filter(inSeason);
      r.level = live.length ? live.reduce((w, l) => (RANK[PHASE_LEVEL[l.phase]] > RANK[w] ? PHASE_LEVEL[l.phase] : w), 'vert') : 'hors';
      r.live = live; r.at = null;
      const pts = [...out.values()].filter((a) => a.reg === r.code && a.at).map((a) => a.at);
      if (pts.length) r.at = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
    }
    // Sentinelles : régions les plus touchées par indicateur (bulletin hebdomadaire), comparées au taux national.
    const norm = (x) => String(x ?? '').replace(/[’']/g, "'").toLowerCase();
    const SENTI = { ira: 'IRA', diarrhee: 'Diarrhée aiguë', varicelle: 'Varicelle', grippe: 'Grippe', covid: 'COVID-19', bronchiolite: 'Bronchiolite' };
    for (const r of regs.values()) r.senti = [];
    for (const t of d.senti?.topRegions ?? []) {
      const r = [...regs.values()].find((x) => norm(x.nom) === norm(t.region)); if (!r) continue;
      const nat = (d.senti.indicators ?? []).find((i) => i.key === t.indicator)?.rate ?? null;
      r.senti.push({ ...t, label: SENTI[t.indicator] ?? t.indicator, nat, ratio: nat ? t.rate / nat : null });
    }
    S.regions = regs;
    // Hôpitaux : sites à moins de 300 m regroupés en un symbole.
    const sites = (d.hosp?.sites ?? []).filter((s) => s.lat != null && s.lon != null);
    const byPass = [...sites].sort((x, y) => (y.passages ?? 0) - (x.passages ?? 0));
    S.hRank = new Map(byPass.map((s, i) => [s.finess, i + 1]));
    const med = {};
    for (const c of ['chu', 'ch', 'private', 'other']) { const v = sites.filter((s) => hcat(s.category) === c && s.passages).map((s) => s.passages).sort((x, y) => x - y); med[c] = v.length ? v[Math.floor(v.length / 2)] : null; }
    S.hMed = med;
    const groups = new Map();
    for (const s of byPass) { const k = `${(s.lat / 0.003).toFixed(0)}|${(s.lon / 0.003).toFixed(0)}`; const g = groups.get(k) ?? []; g.push(s); groups.set(k, g); }
    // Étiquette à l'échelle de la France : une par ville de CHU (le plus grand site), avec le nombre de sites de CHU de la ville.
    const chuCity = new Map();
    for (const s of byPass) if (s.category === 'chu') { const k = cityRoot(s.commune); const c = chuCity.get(k) ?? { lead: s, n: 0 }; c.n += 1; chuCity.set(k, c); }
    const lead = new Map([...chuCity.entries()].map(([k, c]) => [c.lead.finess, c.n > 1 ? `${k} · ${c.n}${NB}sites` : k]));
    S.hLead = lead;
    S.hGroups = [...groups.values()];
    S.maxPass = byPass[0]?.passages ?? 1;
  };

  // ─── Sources et calques ───
  const fc = (features) => ({ type: 'FeatureCollection', features });
  const pt = (c, properties) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties });
  const setData = (id, data) => { const s = S.m.getSource(id); if (s) s.setData(data); else S.m.addSource(id, { type: 'geojson', data }); };
  const HIDE = ['health-alert-fill', 'health-alert-line', 'health-urg-fill', 'health-urg-line', 'health-apl-fill', 'health-apl-line', 'hospitals-sites'];

  const draw = async () => {
    const m = S.m;
    build();
    setData('mqh-depts', fc(S.geo.deptShapes.map((f) => { const a = S.depts.get(f.properties.code);
      return { ...f, properties: { code: f.properties.code, urg: a?.urg ?? 'nd', ucolor: L1[a?.urg] ?? '#000000', aplR: a?.aplR ?? -1, acolor: aplHex(a?.aplR) } }; })));
    setData('mqh-dept-pts', fc([...S.depts.values()].filter((a) => a.inMap && a.at).map((a) => pt(a.at, { code: a.code, urg: a.urg, color: L1[a.urg] ?? MUTE,
      ulabel: a.driver ? `${SYN_SHORT[a.driver]} ${signed((a.syn[a.driver].ratio ?? 1) - 1)}` : '',
      alabel: a.aplV != null ? num(a.aplV, PROF_DIG[S.prof]) : '' }))));
    setData('mqh-regions', fc(S.geo.regions.map((f) => { const r = S.regions.get(f.properties.code);
      return { ...f, properties: { code: f.properties.code, level: r?.level ?? 'hors', color: L1[r?.level] ?? MUTE } }; })));
    setData('mqh-reg-pts', fc([...S.regions.values()].filter((r) => r.at).map((r) => {
      const worst = r.live.filter((l) => l.phase !== 1).map((l) => `${PATHO[l.pathology] ?? l.pathology} : ${PHASE_WORD[l.phase]}`);
      const phase = worst.length ? worst.join(', ') : r.level === 'hors' ? 'hors saison' : `pas d’alerte (${wk(r.live[0]?.week)})`;
      const senti = r.senti.map((x) => `${x.label} ${num(x.rate)}${x.ratio ? ` · ${num(x.ratio, 1)}${NB}× France` : ''}`);
      return pt(r.at, { code: r.code, level: r.level, color: r.level === 'hors' || r.level === 'vert' ? INK : L1[r.level], alert: worst.length > 0,
        senti: r.senti.length > 0, sr: Math.max(0, ...r.senti.map((x) => x.ratio ?? 1)),
        label: [r.nom, phase, ...senti].join('\n'), short: `${r.nom}${NB}· ${phase}` }); })));
    setData('mqh-hosp', fc(S.hGroups.map((g, i) => { const s = g[0];
      const chuLead = g.find((x) => x.category === 'chu' && S.hLead?.get(x.finess));
      return pt([s.lon, s.lat], { i, cat: hcat(s.category), n: g.length, sort: s.passages ?? 0,
        sz: 0.3 + 0.7 * Math.sqrt((g.reduce((t, x) => t + (x.passages ?? 0), 0)) / S.maxPass),
        city: chuLead ? S.hLead.get(chuLead.finess) : '', name: `${nice(s.name)}${g.length > 1 ? ` (+${g.length - 1})` : ''}` }); })));

    if (!m.getLayer('mqh-dept-fill')) {
      await hospImages();
      const b = m.getLayer('hospitals-sites') ? 'hospitals-sites' : undefined;
      // Accès aux soins : aplat bleu, sous tous les autres canaux.
      m.addLayer({ id: 'mqh-apl-fill', type: 'fill', source: 'mqh-depts', paint: { 'fill-color': ['get', 'acolor'], 'fill-opacity': 0.4 } }, b);
      m.addLayer({ id: 'mqh-apl-line', type: 'line', source: 'mqh-depts', paint: { 'line-color': '#0b1020', 'line-width': 0.6, 'line-opacity': 0.8 } }, b);
      m.addLayer({ id: 'mqh-dept-fill', type: 'fill', source: 'mqh-depts', paint: { 'fill-color': '#ffffff', 'fill-opacity': 0 } }, b);
      // Urgences : département en anomalie = trait à sa couleur d'état ; teinte légère seulement avec la pastille.
      m.addLayer({ id: 'mqh-urg-fill', type: 'fill', source: 'mqh-depts', filter: ['in', ['get', 'urg'], ['literal', ['jaune', 'orange', 'rouge']]], paint: { 'fill-color': ['get', 'ucolor'], 'fill-opacity': 0.3 } }, b);
      m.addLayer({ id: 'mqh-urg-line', type: 'line', source: 'mqh-depts', filter: ['in', ['get', 'urg'], ['literal', ['jaune', 'orange', 'rouge']]],
        paint: { 'line-color': ['get', 'ucolor'], 'line-width': ['interpolate', ['linear'], ['zoom'], 4, ['match', ['get', 'urg'], 'rouge', 2.8, 'orange', 2, 1.2], 8, ['match', ['get', 'urg'], 'jaune', 2, 3.4]], 'line-opacity': 1 } }, b);
      // Régions : limites en pointillé clair ; une région en pré-épidémie ou épidémie prend un pointillé épais à sa couleur.
      m.addLayer({ id: 'mqh-reg-line', type: 'line', source: 'mqh-regions', paint: { 'line-color': REG_LINE, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.9, 8, 1.6], 'line-dasharray': [3, 2.5], 'line-opacity': 0.45 } }, b);
      m.addLayer({ id: 'mqh-reg-alert', type: 'line', source: 'mqh-regions', filter: ['in', ['get', 'level'], ['literal', ['jaune', 'orange', 'rouge']]],
        paint: { 'line-color': ['get', 'color'], 'line-width': 3.5, 'line-dasharray': [2, 1.5], 'line-opacity': 1 } }, b);
      m.addLayer({ id: 'mqh-reg-fill', type: 'fill', source: 'mqh-regions', paint: { 'fill-color': '#ffffff', 'fill-opacity': 0 } }, b);
      // Phase Odissé mesurée : vert léger « pas d'alerte » (mesuré, en saison), couleur d'état sinon ; rien hors saison. Avec la pastille seulement.
      m.addLayer({ id: 'mqh-reg-tint', type: 'fill', source: 'mqh-regions', filter: ['!=', ['get', 'level'], 'hors'],
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['match', ['get', 'level'], 'vert', 0.2, 0.35] } }, b);
      m.addLayer({ id: 'mqh-dept-hover', type: 'line', source: 'mqh-depts', filter: ['==', ['get', 'code'], ''], paint: { 'line-color': '#ffffff', 'line-width': 1.6, 'line-opacity': 0.9 } });
      // Sentinelles : disque turquoise, taille = écart au taux national (régions les plus touchées du bulletin).
      m.addLayer({ id: 'mqh-senti', type: 'circle', source: 'mqh-reg-pts', filter: ['get', 'senti'],
        paint: { 'circle-radius': ['interpolate', ['linear'], ['get', 'sr'], 1, 6, 2, 12, 3, 16], 'circle-color': SENTI_HEX, 'circle-opacity': 0.9, 'circle-stroke-color': '#0a0a0f', 'circle-stroke-width': 1.5 } });
      m.addLayer({ id: 'mqh-reg-label', type: 'symbol', source: 'mqh-reg-pts', filter: ['get', 'alert'],
        layout: { 'text-field': ['get', 'short'], 'text-size': 11, 'text-font': ['Open Sans Semibold'], 'text-max-width': 30, 'text-line-height': 1.25,
          'text-variable-anchor': ['top', 'bottom', 'left', 'right'], 'text-radial-offset': 1.3, 'text-allow-overlap': false, 'text-optional': true },
        paint: { 'text-color': ['get', 'color'], 'text-halo-color': '#0a0a0f', 'text-halo-width': 1.5, 'text-opacity': 1 } });
      m.addLayer({ id: 'mqh-apl-label', type: 'symbol', source: 'mqh-dept-pts',
        layout: { 'text-field': ['get', 'alabel'], 'text-size': 10.5, 'text-font': ['Open Sans Semibold'], 'text-allow-overlap': false, 'text-optional': true },
        paint: { 'text-color': '#e8f0ff', 'text-halo-color': '#0a1530', 'text-halo-width': 1.6, 'text-opacity': 1 } });
      m.addLayer({ id: 'mqh-urg-label', type: 'symbol', source: 'mqh-dept-pts', filter: ['!=', ['get', 'ulabel'], ''],
        layout: { 'text-field': ['get', 'ulabel'], 'text-size': 11, 'text-font': ['Open Sans Semibold'], 'symbol-sort-key': ['match', ['get', 'urg'], 'rouge', 0, 'orange', 1, 2], 'text-optional': true },
        paint: { 'text-color': ['get', 'color'], 'text-halo-color': '#0a0a0f', 'text-halo-width': 1.6, 'text-opacity': 1 } });
      // Hôpitaux : forme = catégorie, taille = passages aux urgences 2025 ; les plus grands dessinés au-dessus.
      m.addLayer({ id: 'mqh-hosp', type: 'symbol', source: 'mqh-hosp',
        layout: { 'icon-image': ['concat', 'mqh-h-', ['get', 'cat']], 'icon-size': ['interpolate', ['linear'], ['zoom'], 4, ['*', 0.55, ['get', 'sz']], 7, ['*', 0.85, ['get', 'sz']], 10, ['*', 1.3, ['get', 'sz']]],
          'icon-allow-overlap': true, 'icon-ignore-placement': true, 'symbol-sort-key': ['get', 'sort'],
          'text-field': ['step', ['zoom'], ['get', 'city'], 8, ['get', 'name']], 'text-size': 10.5, 'text-font': ['Open Sans Semibold'],
          'text-variable-anchor': ['right', 'left', 'top', 'bottom'], 'text-radial-offset': 0.9, 'text-justify': 'auto', 'text-optional': true, 'text-max-width': 14 },
        paint: { 'icon-opacity': 1, 'text-color': ['match', ['get', 'cat'], 'chu', '#ffffff', 'ch', HOSP.ch, 'private', HOSP.private, HOSP.other], 'text-halo-color': '#0a0a0f', 'text-halo-width': 1.5, 'text-opacity': 1 } });
    }
    applyFocus();
    renderLegend(); renderWatch();
    if (S.fiche) openFiche(S.fiche.kind, S.fiche.key, true);
  };

  // ─── Pastilles : mise en avant cumulable, le reste estompé ───
  const GROUPS = {
    health: ['mqh-reg-line', 'mqh-reg-alert', 'mqh-reg-label', 'mqh-reg-fill', 'mqh-reg-tint', 'mqh-senti'],
    healthOscour: ['mqh-urg-fill', 'mqh-urg-line', 'mqh-urg-label'],
    healthApl: ['mqh-apl-fill', 'mqh-apl-line', 'mqh-apl-label'],
    hospitals: ['mqh-hosp'],
  };
  const isHealth = () => document.querySelector('button.tb-theme[data-theme="health"]')?.getAttribute('aria-pressed') === 'true';
  let preview = null;
  const allMode = () => S.focus.size === 0 && !preview;
  const isOn = (k) => allMode() || S.focus.has(k) || preview === k;
  const pill = (k) => S.focus.has(k) || preview === k;
  // Opacité de chaque calque selon l'état (sans pastille / avec sa pastille), puis estompée à 7 % si une autre pastille est active.
  const OPAC = {
    'mqh-apl-fill': ['fill-opacity', () => (pill('healthApl') ? 0.85 : 0.45)],
    'mqh-apl-line': ['line-opacity', () => 0.8],
    'mqh-apl-label': ['text-opacity', () => 1],
    'mqh-urg-fill': ['fill-opacity', () => (pill('healthOscour') ? 0.35 : 0)],
    'mqh-urg-line': ['line-opacity', () => 1],
    'mqh-urg-label': ['text-opacity', () => 1],
    'mqh-reg-line': ['line-opacity', () => (pill('health') ? 0.9 : 0.4)],
    'mqh-reg-alert': ['line-opacity', () => 1],
    'mqh-reg-label': ['text-opacity', () => 1],
    'mqh-senti': [['circle-opacity', 'circle-stroke-opacity'], () => 0.9],
    'mqh-hosp': [['icon-opacity', 'text-opacity'], () => 1],
  };
  const calm = () => {
    const m = S.m;
    const P = (id, k, v) => { try { if (m.getLayer(id) && JSON.stringify(m.getPaintProperty(id, k)) !== JSON.stringify(v)) m.setPaintProperty(id, k, v); } catch (e) { /* propriété absente */ } };
    const V = (id, on) => { if (m.getLayer(id) && m.getLayoutProperty(id, 'visibility') !== (on ? 'visible' : 'none')) m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); };
    const L = (id, k, v) => { if (m.getLayer(id) && JSON.stringify(m.getLayoutProperty(id, k)) !== JSON.stringify(v)) m.setLayoutProperty(id, k, v); };
    const F = (id, v) => { if (m.getLayer(id) && JSON.stringify(m.getFilter(id)) !== JSON.stringify(v)) m.setFilter(id, v); };
    const on = isHealth();
    document.body.classList.toggle('mqh-on', on);
    legend.style.display = on ? '' : 'none'; watch.style.display = on ? '' : 'none';
    if (!on) {
      if (S.was) { for (const l of m.getStyle().layers) if (l.id.startsWith('mqh-')) V(l.id, false); pop.style.display = 'none'; popAt = null; closeFiche(); S.focus.clear(); preview = null; syncChips(); }
      S.was = false; return;
    }
    S.was = true;
    for (const id of HIDE) V(id, false);
    for (const l of m.getStyle().layers) if (l.id.startsWith('mqh-')) V(l.id, true);
    // Accès aux soins : tous les départements ; chiffre au centre avec la pastille.
    F('mqh-apl-fill', ['>=', ['get', 'aplR'], 0]);
    V('mqh-apl-line', pill('healthApl')); V('mqh-apl-label', pill('healthApl'));
    // Urgences : chiffre au centre pour les rouges, pour tous les départements en anomalie avec la pastille.
    F('mqh-urg-label', pill('healthOscour') ? ['!=', ['get', 'ulabel'], ''] : ['all', ['!=', ['get', 'ulabel'], ''], ['in', ['get', 'urg'], ['literal', ['orange', 'rouge']]]]);
    // Régions : avec la pastille, toutes nommées avec leur état ; sans, seulement celles en alerte.
    // Veille sanitaire sans pastille : régions en alerte et régions les plus touchées selon Sentinelles, nommées ; toutes avec la pastille, teinte de phase en plus.
    F('mqh-reg-label', pill('health') ? null : ['any', ['get', 'alert'], ['get', 'senti']]);
    L('mqh-reg-label', 'text-field', ['get', 'label']);
    V('mqh-reg-tint', pill('health')); V('mqh-senti', isOn('health'));
    // Hôpitaux : avec la pastille, noms dès le zoom 6,5.
    L('mqh-hosp', 'text-field', ['step', ['zoom'], ['get', 'city'], pill('hospitals') ? 6.5 : 8, ['get', 'name']]);
    const k = pill('hospitals') ? 1.35 : 1;
    L('mqh-hosp', 'icon-size', ['interpolate', ['linear'], ['zoom'], 4, ['*', 0.55 * k, ['get', 'sz']], 7, ['*', 0.85 * k, ['get', 'sz']], 10, ['*', 1.3 * k, ['get', 'sz']]]);
    const act = new Set(S.focus); if (preview) act.add(preview);
    for (const [id, [props, f]] of Object.entries(OPAC)) {
      const g = Object.entries(GROUPS).find(([, ls]) => ls.includes(id))?.[0];
      const dim = act.size > 0 && !act.has(g);
      for (const p of [].concat(props)) P(id, p, Math.round(f() * (dim ? 0.07 : 1) * 1000) / 1000);
    }
  };
  const applyFocus = () => { calm(); syncChips(); watch.classList.toggle('is-focus', pill('health')); watch.classList.toggle('is-dim', !allMode() && !pill('health')); };
  const chipKey = (el) => el?.closest?.('.floating-panel-switcher__chip[data-panel-key]')?.dataset.panelKey;
  const syncChips = () => document.querySelectorAll('.floating-panel-switcher__chip[data-panel-key]').forEach((c) => {
    if (!(c.dataset.panelKey in GROUPS) || !isHealth()) return;
    const pressed = S.focus.has(c.dataset.panelKey);
    if (c.classList.contains('is-active') !== pressed) c.classList.toggle('is-active', pressed);
    if (c.getAttribute('aria-pressed') !== String(pressed)) c.setAttribute('aria-pressed', String(pressed));
  });
  const wireChips = () => {
    document.addEventListener('click', (e) => {
      if (!isHealth()) return;
      const k = chipKey(e.target);
      if (k && k in GROUPS) { S.focus.has(k) ? S.focus.delete(k) : S.focus.add(k); preview = null; applyFocus(); return; }
      // Choix du syndrome ou de la profession dans les panneaux : la carte suit.
      const syn = e.target?.closest?.('[data-urg-syndrome]')?.dataset.urgSyndrome;
      if (syn && syn !== S.syndrome) { S.syndrome = syn; setTimeout(draw, 30); }
      const prof = e.target?.closest?.('[data-apl-profession]')?.dataset.aplProfession;
      if (prof && prof !== S.prof) { S.prof = prof; setTimeout(draw, 30); }
    }, true);
    document.addEventListener('mouseover', (e) => { if (!isHealth()) return; const k = chipKey(e.target); const next = k in GROUPS ? k : null; if (next !== preview) { preview = next; applyFocus(); } });
    new MutationObserver(syncChips).observe(document.body, { subtree: true, childList: true });
  };

  // ─── Bulle unique ───
  const pop = document.createElement('div');
  pop.className = 'mqh-pop';
  let popAt = null;
  const placePop = () => { if (!popAt) return; const p = S.m.project(popAt); const c = S.m.getCanvas(), W = c.clientWidth, H = c.clientHeight, w = pop.offsetWidth, h = pop.offsetHeight;
    const x = p.x + 14 + w > W - 8 ? p.x - 14 - w : p.x + 14, y = Math.min(Math.max(8, p.y + 14), Math.max(8, H - h - 8));
    pop.style.transform = `translate(${Math.round(Math.max(8, x))}px, ${Math.round(y)}px)`; };
  // Baromètre : barre = part de la semaine, trait blanc = maximum des saisons précédentes à la même semaine ; couleur = niveau (vert seulement si mesuré).
  const gauge = (g) => { const top = Math.max(g.v ?? 0, g.max ?? 0) * 1.15 || 1; const c = g.level === 'nd' || g.v == null ? MUTE : L1[g.level];
    return `<div class="mqh-g"><div class="mqh-g-h"><span>${esc(g.label)}</span><b style="color:${g.level === 'vert' || g.level === 'nd' ? INK : c}">${esc(g.right)}</b></div>`
      + `<div class="mqh-g-t"><i class="mqh-g-f" style="width:${Math.min(100, ((g.v ?? 0) / top) * 100).toFixed(1)}%;background:${c}"></i>`
      + (g.max != null ? `<i class="mqh-g-m" style="left:${Math.min(100, (g.max / top) * 100).toFixed(1)}%"></i>` : '') + '</div></div>'; };
  const synGauge = (k, r) => ({ label: SYN[k], v: r.er, max: r.max, level: r.level,
    right: r.er == null ? 'n.d.' : `${pct(r.er)}${r.max != null ? ` · max ${pct(r.max)}` : ''}${r.ratio && r.level !== 'vert' ? ` · ${signed(r.ratio - 1)}` : ''}` });
  const card = (c) => `<div class="et-card"><div class="et-head"><i class="et-dot" style="background:${c.dot}"></i><strong>${esc(c.title)}</strong></div>`
    + (c.state ? `<div class="et-state" style="color:${c.stateHex}">${esc(c.state)}</div>` : '')
    + (c.gauges?.length ? `<div class="mqh-gs">${c.gauges.map(gauge).join('')}</div>` : '')
    + c.rows.map(([k, v]) => `<div class="et-row"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')
    + (c.hint ? `<div class="et-hint">${esc(c.hint)}</div>` : '')
    + `<div class="et-src">Source : ${esc(c.source)}</div></div>`;

  const synSrc = () => `Santé publique France, OSCOUR et SOS Médecins, semaine ${wk(S.data.syn?.week?.id)} publiée le ${day(S.data.syn?.publishedAt)}`;
  const aplSrc = () => `DREES, APL ${S.data.apl?.vintage ?? 'n.d.'} publiée le ${day(S.data.apl?.publishedAt)}`;
  const hospSrc = () => `DREES, SAE ${S.data.hosp?.vintage ?? 'n.d.'} · FINESS du ${day(S.data.hosp?.finessDate)}`;
  const synRow = (k, r) => `${pct(r.er)} des passages (maximum des 3${NB}saisons : ${pct(r.max)}${r.ratio ? `, ${signed(r.ratio - 1)}` : ''})`;
  // Rang du département pour un syndrome : écart au maximum des saisons précédentes, du plus fort au plus faible.
  const synRank = (a, k) => { const all = [...S.depts.values()].filter((x) => x.syn[k]?.ratio != null).sort((x, y) => y.syn[k].ratio - x.syn[k].ratio); const i = all.findIndex((x) => x.code === a.code); return i < 0 ? 'n.d.' : `${nth(i + 1)} sur ${all.length}`; };
  const aplRank = (a, p = S.prof) => { const all = [...S.depts.values()].filter((x) => x.apl?.apl?.[p] != null).sort((x, y) => x.apl.apl[p] - y.apl.apl[p]); const i = all.findIndex((x) => x.code === a.code); return i < 0 ? 'n.d.' : `${nth(i + 1)} plus faible sur ${all.length}`; };
  const regLine = (a) => { const r = S.regions.get(a.reg); if (!r) return 'n.d.';
    return r.live.length ? `${r.nom} : ${r.live.map((l) => `${(PATHO[l.pathology] ?? l.pathology).toLowerCase()} ${PHASE_WORD[l.phase]}`).join(', ')} (${wk(r.live[0].week)})` : `${r.nom} : hors saison`; };
  const aplLine = (a, p = S.prof) => { const v = a.apl?.apl?.[p], nat = S.data.apl?.france?.apl?.[p]; return v == null ? 'n.d.' : `${num(v, PROF_DIG[p])} (France ${num(nat, PROF_DIG[p])}, ${num(v / nat, 2)}${NB}×)`; };
  const hospLine = (a) => { if (!a.hosp.length) return 'aucun site d’urgences';
    return `${a.hosp.length}${NB}site${a.hosp.length > 1 ? 's' : ''}, ${num(a.hosp.reduce((t, s) => t + (s.passages ?? 0), 0))}${NB}passages en ${S.data.hosp?.vintage ?? 'n.d.'}, ${num(a.hosp.reduce((t, s) => t + (s.bedsIcu ?? 0), 0))}${NB}lits de réanimation`; };
  const reaPer = (a) => { const pop = a.apl?.pop; if (!pop || !a.hosp.length) return null; return (a.hosp.reduce((t, s) => t + (s.bedsIcu ?? 0), 0) / pop) * 1e5; };
  const reaFrance = () => { let b = 0, p = 0; for (const a of S.depts.values()) if (a.apl?.pop) { p += a.apl.pop; b += a.hosp.reduce((t, s) => t + (s.bedsIcu ?? 0), 0); } return p ? (b / p) * 1e5 : null; };
  const reaLine = (a) => { const v = reaPer(a); if (v == null) return 'n.d.';
    const all = [...S.depts.values()].map((x) => [x.code, reaPer(x)]).filter(([, x]) => x != null).sort((x, y) => x[1] - y[1]); const i = all.findIndex(([c]) => c === a.code);
    return `${num(v, 1)} lits de réanimation pour 100${NB}000 hab. (France ${num(reaFrance(), 1)}, ${nth(i + 1)} plus faible sur ${all.length})`; };
  const passPer = (a) => { const pop = a.apl?.pop; return pop ? a.hosp.reduce((t, s) => t + (s.passages ?? 0), 0) / pop * 1000 : null; };
  const neighbours = (a) => [...(S.neigh?.get(a.code) ?? [])].map((c) => S.depts.get(c)).filter(Boolean);
  const neighLine = (a) => { const ns = neighbours(a); if (!ns.length) return 'n.d.';
    const bad = ns.filter((x) => x.driver).sort((x, y) => RANK[y.urg] - RANK[x.urg]);
    return bad.length ? `${bad.map((x) => `${x.nom} (${SYN_SHORT[x.driver]}, ${WORD[x.urg].toLowerCase()})`).join(', ')}${ns.length > bad.length ? ` ; ${ns.length - bad.length} autre${ns.length - bad.length > 1 ? 's' : ''} normal${ns.length - bad.length > 1 ? 'aux' : ''}` : ''}`
      : `${ns.length} voisins, tous dans les normales`; };
  const urgState = (a) => {
    if (a.urg === 'nd') return ['Urgences : données insuffisantes cette semaine', MUTE];
    if (!a.driver) return [`Urgences : dans les normales des 3${NB}saisons précédentes (${wk(S.data.syn?.week?.id)})`, L1.vert];
    const r = a.syn[a.driver];
    return [`${WORD[a.urg]} · ${SYN[a.driver]} ${signed(r.ratio - 1)} au-dessus du maximum des 3${NB}saisons`, L1[a.urg]];
  };
  const deptCard = (a, mode) => {
    const [state, stateHex] = urgState(a);
    const rows = [], gauges = [];
    const urgRows = () => {
      const keys = S.syndrome ? [S.syndrome] : MAIN;
      for (const k of keys) { const r = a.syn[k]; if (r) gauges.push(synGauge(k, r)); }
      if (a.driver) { rows.push(['Rang', `${synRank(a, a.driver)} pour ${SYN[a.driver].toLowerCase()}`]); if (a.syn[a.driver].sos != null) rows.push(['SOS Médecins', pct(a.syn[a.driver].sos)]); }
      if (a.others.length) rows.push(['Autres signaux', a.others.map((o) => `${SYN[o.key]} ${pct(o.er)} (max ${pct(o.max)})`).join(', ')]);
    };
    const aplRows = () => {
      rows.push([`${PROF[S.prof]} (${PROF_UNIT[S.prof]})`, aplLine(a)]);
      rows.push(['Rang', aplRank(a)]);
      const v23 = a.apl?.apl2023?.[S.prof]; if (v23 != null && a.aplV != null) rows.push(['Évolution 2023 → 2024', `${num(v23, PROF_DIG[S.prof])} → ${num(a.aplV, PROF_DIG[S.prof])} (${signed(a.aplV / v23 - 1)})`]);
      if (a.apl?.shareUnder25 != null) rows.push(['Population sous 2,5 consultations', `${num(a.apl.shareUnder25)}${NB}% (France ${num(S.data.apl?.france?.byYear?.at(-1)?.shareUnder25, 1)}${NB}%)`]);
      const weak = Object.keys(PROF).filter((p) => p !== S.prof && a.apl?.apl?.[p] != null && a.apl.apl[p] / S.data.apl.france.apl[p] < 0.75);
      if (weak.length) rows.push(['Autres professions sous 0,75×', weak.map((p) => PROF[p].toLowerCase()).join(', ')]);
    };
    if (mode === 'apl') { aplRows(); rows.push(['Urgences', state]); }
    else { urgRows(); rows.push([`${PROF[S.prof]} (APL)`, aplLine(a)]); }
    rows.push(['Alerte de la région', regLine(a)]);
    rows.push(['Départements voisins', neighLine(a)]);
    rows.push(['Hôpitaux', hospLine(a)]);
    rows.push(['Capacité', reaLine(a)]);
    if (a.apl?.pop) rows.push(['Population', `${num(a.apl.pop)} hab.${passPer(a) != null ? ` · ${num(passPer(a))} passages aux urgences pour 1${NB}000 hab. par an` : ''}`]);
    return { gauges, dot: mode === 'apl' ? aplHex(a.aplR) : (L1[a.urg] ?? MUTE), title: `${a.nom} (${a.code})`, state: mode === 'apl' ? `Accès aux soins : ${a.aplR == null ? 'n.d.' : `${num(a.aplR, 2)}${NB}fois la moyenne nationale`}` : state,
      stateHex: mode === 'apl' ? '#93c5fd' : stateHex, rows,
      hint: `Ce qu’on ne sait pas : ${mode === 'apl' ? 'accès réel du jour (délais de rendez-vous) non publié' : 'pas d’historique par département dans le flux ; petites parts = signal fragile'} · clic : fiche`,
      source: mode === 'apl' ? `${aplSrc()} · ${synSrc()}` : `${synSrc()} · ${aplSrc()}` };
  };
  const regionCard = (r) => ({ dot: r.level === 'hors' ? MUTE : L1[r.level], title: r.nom, state: r.live.length ? (r.level === 'vert' ? 'Pas d’alerte épidémique (mesuré)' : `${WORD[r.level]} · phase épidémique`) : 'Hors saison de surveillance', stateHex: r.level === 'hors' ? MUTE : L1[r.level],
    rows: [...r.lines.map((l) => [PATHO[l.pathology] ?? l.pathology, `${PHASE_WORD[l.phase]}${l.phase === 1 ? '' : ` depuis ${wk(l.week)}`} (semaine ${wk(l.week)}${inSeason(l) ? '' : ', hors saison'})`]),
      ...r.senti.map((x) => [`Sentinelles, ${x.indicator === 'ira' ? 'IRA' : x.label.toLowerCase()}`, `${num(x.rate)} cas pour 100${NB}000 (IC ${num(x.ciLow)} à ${num(x.ciHigh)}), France ${num(x.nat)}, ${x.ratio ? `${num(x.ratio, 1)}${NB}×` : 'n.d.'}`]),
      ['Départements en anomalie aux urgences', (() => { const xs = [...S.depts.values()].filter((a) => a.reg === r.code && a.driver); return xs.length ? xs.map((a) => `${a.nom} (${SYN_SHORT[a.driver]})`).join(', ') : 'aucun'; })()]],
    hint: 'Clic : bulletin Odissé (Santé publique France)', url: 'https://odisse.santepubliquefrance.fr', source: `Santé publique France, Odissé, semaine ${wk(S.data.alerts?.latestWeek?.id)}${r.senti.length ? ` · Sentinelles, ${wk(S.data.senti?.week?.id)}${S.data.senti?.provisional ? ' provisoire' : ''}` : ''}` });
  const hospCard = (g) => {
    const s = g[0], a = S.depts.get(s.dept), c = hcat(s.category), med = S.hMed[c];
    const near = (S.data.hosp?.sites ?? []).filter((x) => !g.includes(x) && x.lat != null).map((x) => ({ x, d: km([s.lon, s.lat], [x.lon, x.lat]) })).filter((o) => o.d <= 30).sort((p, q) => p.d - q.d);
    const svc = [s.general && 'générales', s.pediatric && 'pédiatriques', s.seasonal && 'saisonnières', s.antenna && 'antenne'].filter(Boolean).join(', ') || 'n.d.';
    const inDept = a?.hosp.filter((x) => x.passages != null).sort((p, q) => q.passages - p.passages) ?? [];
    return { dot: HOSP[c], title: nice(s.name), state: `${HOSP_WORD[s.category] ?? 'Autre'} · ${commune(s.commune)} (${s.dept})`, stateHex: HOSP[c] === '#ffffff' ? INK : HOSP[c],
      rows: [
        [`Passages aux urgences ${S.data.hosp?.vintage ?? ''}`.trim(), `${num(s.passages)} · ${nth(S.hRank.get(s.finess) ?? 0)} sur ${num(S.hRank.size)} en France, ${nth(inDept.findIndex((x) => x.finess === s.finess) + 1)} du département`],
        [`Par rapport à la médiane (${HOSP_WORD[s.category] ?? 'autres'})`, med && s.passages != null ? `${signed(s.passages / med - 1)} (médiane ${num(med)})` : 'n.d.'],
        ['Urgences', svc],
        ['Lits', `MCO ${num(s.bedsMco)} · réanimation ${num(s.bedsIcu)} · soins intensifs ${num(s.bedsIntensive)} · UHCD ${num(s.bedsUhcd)}`],
        ...(g.length > 1 ? [['Même site', g.slice(1).map((x) => nice(x.name)).join(', ')]] : []),
        ['À moins de 30' + NB + 'km', near.length ? `${near.length}${NB}autre${near.length > 1 ? 's' : ''} site${near.length > 1 ? 's' : ''} (le plus proche : ${nice(near[0].x.name)}, ${num(near[0].d, near[0].d < 10 ? 1 : 0)}${NB}km)` : 'aucun autre site'],
        ['Département cette semaine', a ? urgState(a)[0] : 'n.d.'],
      ],
      hint: 'Ce qu’on ne sait pas : attente et saturation du jour non publiées en données ouvertes · clic : fiche', source: hospSrc() };
  };
  const deptAt = (c) => { for (const f of S.geo.deptShapes) if (inGeom(c, f.geometry)) return S.depts.get(f.properties.code); return null; };
  // Arbitre : une seule cible ; hôpital > département ; la région répond seulement avec sa pastille ; un calque estompé ne répond jamais.
  const pick = (point) => {
    const act = new Set(S.focus); if (preview) act.add(preview);
    const live = (id) => !act.size || !Object.values(GROUPS).some((ls) => ls.includes(id)) || Object.entries(GROUPS).some(([g, ls]) => act.has(g) && ls.includes(id));
    const order = ['mqh-hosp', ...(pill('health') && !pill('healthOscour') && !pill('healthApl') ? ['mqh-reg-fill'] : []), 'mqh-dept-fill'];
    const layers = order.filter((id) => S.m.getLayer(id) && (id === 'mqh-reg-fill' || live(id)));
    const hits = S.m.queryRenderedFeatures(point, { layers });
    if (!hits.length) return null;
    hits.sort((a, b) => order.indexOf(a.layer.id) - order.indexOf(b.layer.id));
    const f = hits[0], p = f.properties, id = f.layer.id;
    if (id === 'mqh-hosp') { const g = S.hGroups[p.i]; return g && { key: `h:${p.i}`, kind: 'hosp', id: p.i, card: hospCard(g), at: [g[0].lon, g[0].lat] }; }
    if (id === 'mqh-reg-fill') { const r = S.regions.get(p.code); return r && { key: `r:${r.code}`, kind: 'region', id: r.code, card: regionCard(r), at: null }; }
    if (id === 'mqh-dept-fill') { const a = S.depts.get(p.code); const mode = pill('healthApl') && !pill('healthOscour') ? 'apl' : 'urg';
      return a && { key: `d:${a.code}:${mode}`, kind: 'dept', id: a.code, card: deptCard(a, mode), at: null }; }
    return null;
  };
  let hovered = null;
  const setHover = (code) => { if (code === hovered) return; S.m.setFilter('mqh-dept-hover', ['==', ['get', 'code'], code ?? '']); hovered = code; };
  const onMove = (e) => {
    if (!isHealth()) return;
    const hit = pick(e.point);
    const canvas = S.m.getCanvas();
    if (!hit) { pop.style.display = 'none'; popAt = null; S.hoverKey = null; setHover(null); canvas.style.cursor = ''; return; }
    canvas.style.cursor = 'pointer';
    setHover(hit.kind === 'dept' ? hit.id : null);
    popAt = hit.at ?? [e.lngLat.lng, e.lngLat.lat];
    if (S.hoverKey !== hit.key) { pop.innerHTML = card(hit.card); S.hoverKey = hit.key; }
    pop.style.display = 'block'; placePop();
  };

  // ─── Sources et fraîcheur ───
  const ageDays = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / 864e5 : Infinity);
  const freshness = () => {
    const d = S.data, rows = [];
    rows.push(['OSCOUR et SOS Médecins', d.syn?.week ? `semaine ${wk(d.syn.week.id)}, publiée le ${day(d.syn.publishedAt)}, hebdomadaire` : 'indisponible', d.syn?.week ? (ageDays(d.syn.publishedAt) > 10 ? 'part' : 'ok') : 'ko']);
    rows.push(['Odissé (phases épidémiques)', d.alerts?.latestWeek ? `semaine ${wk(d.alerts.latestWeek.id)}, hebdomadaire` : 'indisponible', d.alerts?.latestWeek ? 'ok' : 'ko']);
    rows.push(['Sentinelles (médecins généralistes)', d.senti?.week ? `semaine ${wk(d.senti.week.id)}${d.senti.provisional ? ', provisoire' : ''}` : 'indisponible', d.senti?.week ? (d.senti.provisional ? 'part' : 'ok') : 'ko']);
    rows.push(['Eaux usées (SUM’Eau)', d.ww?.publishedAt ? `publié le ${day(d.ww.publishedAt)}, ${num(d.ww.stationsReporting)}/${num(d.ww.stationsTotal)} stations` : 'indisponible', d.ww?.publishedAt ? 'ok' : 'ko']);
    rows.push(['DREES APL (accès aux soins)', d.apl?.vintage ? `données ${d.apl.vintage}, publiées le ${day(d.apl.publishedAt)}, annuelle` : 'indisponible', d.apl?.vintage ? 'ok' : 'ko']);
    rows.push(['DREES SAE et FINESS (hôpitaux)', d.hosp?.vintage ? `activité ${d.hosp.vintage}, FINESS du ${day(d.hosp.finessDate)}, annuelle` : 'indisponible', d.hosp?.vintage ? 'ok' : 'ko']);
    rows.push(['ANSM (médicaments)', d.drugs?.latestUpdate ? `mis à jour le ${day(d.drugs.latestUpdate)}` : 'indisponible', d.drugs?.latestUpdate ? 'ok' : 'ko']);
    rows.push(['RappelConso', d.recalls?.since ? `depuis le ${day(d.recalls.since)}` : 'indisponible', d.recalls?.since ? 'ok' : 'ko']);
    rows.push(['DGS-Urgent (PEPS)', (d.dgs?.errors ?? []).length ? `injoignable (${d.dgs.errors[0].replace(/^[^:]*: /, '')})` : `${(d.dgs?.messages ?? []).length}${NB}message(s)`, (d.dgs?.errors ?? []).length ? 'ko' : 'ok']);
    return rows;
  };

  // ─── Fiche au format note de situation ───
  const panel = document.createElement('aside');
  panel.className = 'mqh-fiche';
  const sec = (title, body) => `<section><h4>${esc(title)}</h4>${body}</section>`;
  const li = (items) => `<ul>${items.map((x) => `<li>${x}</li>`).join('')}</ul>`;
  const spark = (pts, cap) => {
    if (!pts?.length || pts.length < 2) return '';
    const w = 300, h = 44, max = Math.max(...pts.map((x) => x.v), 0.0001);
    const xy = pts.map((x, i) => `${Math.round((i / (pts.length - 1)) * w)},${Math.round(h - (x.v / max) * (h - 6) - 3)}`).join(' ');
    return `<svg class="mqh-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${xy}" fill="none" stroke="#8a93a6" stroke-width="1.5"/>`
      + `<circle cx="${w}" cy="${Math.round(h - (pts.at(-1).v / max) * (h - 6) - 3)}" r="3" fill="#e8e8ec"/></svg><div class="mqh-spark-cap">${esc(cap)}</div>`;
  };
  // Semaine épidémiologique → rang dans la saison (début en S27, juillet) et année de début de saison.
  const seasonOf = (id) => { const y = Number(id.slice(0, 4)), w = Number(id.slice(-2)); return w >= 27 ? { s: y, i: w - 27 } : { s: y - 1, i: w + 25 }; };
  const SEASON_TICKS = [[0, 'juil.'], [13, 'oct.'], [26, 'janv.'], [39, 'avr.']];
  const seasonChart = (k) => {
    const pts = (S.data.syn?.syndromes ?? []).find((x) => x.key === k)?.france?.filter((p) => p.er != null) ?? [];
    if (!pts.length) return '';
    const last = pts.reduce((a, b) => (a.start > b.start ? a : b)); const cur = seasonOf(last.week);
    const seasons = new Map();
    for (const p of pts) { const o = seasonOf(p.week); if (o.s < cur.s - 3) continue; (seasons.get(o.s) ?? seasons.set(o.s, []).get(o.s)).push([o.i, p.er, p.week]); }
    const w = 320, h = 120, pl = 30, pb = 16, max = Math.max(...[...seasons.values()].flat().map((x) => x[1]), 0.01) * 1.08;
    const X = (i) => pl + (i / 51) * (w - pl - 4), Y = (v) => h - pb - (v / max) * (h - pb - 6);
    const GREYS = ['#5b6170', '#7d8595', '#a3a9b6'];
    const lines = [...seasons.entries()].sort((a, b) => a[0] - b[0]).map(([sy, xs], j, arr) => {
      xs.sort((a, b) => a[0] - b[0]); const isCur = sy === cur.s;
      const color = isCur ? '#ffffff' : GREYS[j] ?? '#7d8595';
      return `<polyline points="${xs.map(([i, v]) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="${isCur ? 2.2 : 1.2}" stroke-opacity="${isCur ? 1 : 0.9}"/>`; }).join('');
    const ticks = SEASON_TICKS.map(([i, t]) => `<text x="${X(i)}" y="${h - 3}" fill="#6e6e80" font-size="9">${t}</text>`).join('')
      + [0, max / 2].map((v) => `<text x="0" y="${Y(v) + 3}" fill="#6e6e80" font-size="9">${num(v, v < 1 ? 1 : 0)}${NB}%</text><line x1="${pl}" x2="${w}" y1="${Y(v)}" y2="${Y(v)}" stroke="#262a33"/>`).join('');
    const now = `<line x1="${X(cur.i)}" x2="${X(cur.i)}" y1="4" y2="${h - pb}" stroke="#ffffff" stroke-dasharray="2 2" stroke-opacity="0.5"/>`;
    // Ce qui suit habituellement : pic de chaque saison précédente.
    const peaks = [...seasons.entries()].filter(([sy]) => sy !== cur.s).sort((a, b) => b[0] - a[0]).map(([sy, xs]) => { const m = xs.reduce((a, b) => (b[1] > a[1] ? b : a)); return `${sy}-${String(sy + 1).slice(2)} : ${pct(m[1])} en ${wk(m[2])}`; });
    const sameWeek = [...seasons.entries()].filter(([sy]) => sy !== cur.s).sort((a, b) => b[0] - a[0]).map(([sy, xs]) => { const m = xs.find((x) => x[0] === cur.i); return m ? `${sy}-${String(sy + 1).slice(2)} ${pct(m[1])}` : null; }).filter(Boolean);
    return `<div class="mqh-chart"><div class="mqh-chart-t">France, ${esc(k === 'ira' ? 'IRA' : SYN[k].toLowerCase())} aux urgences : saison ${cur.s}-${String(cur.s + 1).slice(2)} (blanc) et 3${NB}saisons précédentes (gris)</div>`
      + `<svg viewBox="0 0 ${w} ${h}" class="mqh-chart-svg">${ticks}${lines}${now}<circle cx="${X(cur.i)}" cy="${Y(last.er)}" r="3" fill="#fff"/></svg>`
      + `<div class="mqh-chart-c">${esc(`Cette semaine (${wk(last.week)}) : ${pct(last.er)} ; même semaine : ${sameWeek.join(', ') || 'n.d.'}.`)}<br>${esc(`Pics des saisons précédentes : ${peaks.join(' ; ') || 'n.d.'}.`)}</div></div>`;
  };
  // Classes d'âge (France, IRA seulement dans le flux) : part aux urgences, hospitalisations après passage, SOS Médecins, évolution sur 4 semaines.
  const AGE_HEX = { '00-04 ans': '#f9a8d4', '05-14 ans': '#fde68a', '15-64 ans': '#93c5fd', '65 ans ou plus': '#c4b5fd' };
  const agesChart = (k = 'ira') => {
    const ages = (S.data.syn?.syndromes ?? []).find((x) => x.key === k)?.ages ?? {};
    const keys = Object.keys(ages).filter((a) => ages[a]?.length);
    if (!keys.length) return '';
    const w = 320, h = 90, pl = 30, max = Math.max(...keys.flatMap((a) => ages[a].map((p) => p.er ?? 0)), 0.01) * 1.1;
    const n = Math.max(...keys.map((a) => ages[a].length));
    const X = (i) => pl + (i / Math.max(1, n - 1)) * (w - pl - 4), Y = (v) => h - 6 - (v / max) * (h - 12);
    const svg = keys.map((a) => { const xs = [...ages[a]].sort((p, q) => p.start.localeCompare(q.start));
      return `<polyline points="${xs.map((p, i) => `${X(i).toFixed(1)},${Y(p.er ?? 0).toFixed(1)}`).join(' ')}" fill="none" stroke="${AGE_HEX[a] ?? INK}" stroke-width="1.8"/>`; }).join('')
      + [0, max / 2].map((v) => `<text x="0" y="${Y(v) + 3}" fill="#6e6e80" font-size="9">${num(v, 1)}${NB}%</text><line x1="${pl}" x2="${w}" y1="${Y(v)}" y2="${Y(v)}" stroke="#262a33"/>`).join('');
    const rows = keys.map((a) => { const xs = [...ages[a]].sort((p, q) => p.start.localeCompare(q.start)); const l = xs.at(-1), b = xs.at(-5);
      return `<tr><td><i class="mqh-age" style="background:${AGE_HEX[a] ?? INK}"></i>${esc(a.replace(/0(\d)/g, '$1').replace('-', ' à '))}</td><td>${esc(pct(l.er))}</td><td>${esc(pct(l.hosp))}</td><td>${esc(pct(l.sos))}</td><td>${esc(b?.er ? signed(l.er / b.er - 1) : 'n.d.')}</td></tr>`; }).join('');
    const first = [...ages[keys[0]]].sort((p, q) => p.start.localeCompare(q.start));
    return `<div class="mqh-chart"><div class="mqh-chart-t">France, ${esc(k === 'ira' ? 'IRA' : SYN[k].toLowerCase())} par classe d’âge, ${wk(first[0].week)} à ${wk(first.at(-1).week)} (part des passages aux urgences)</div>`
      + `<svg viewBox="0 0 ${w} ${h}" class="mqh-chart-svg">${svg}</svg>`
      + `<table class="mqh-ages"><tr><th></th><th>Urgences</th><th>Hospit.</th><th>SOS</th><th>4${NB}sem.</th></tr>${rows}</table>`
      + `<div class="mqh-chart-c">Hospit. = part des passages suivis d’une hospitalisation pour ce syndrome ; SOS = part des actes SOS Médecins. Pas de série par âge pour les autres syndromes dans le flux.</div></div>`;
  };
  const franceSeries = (k, n = 12) => (S.data.syn?.syndromes ?? []).find((s) => s.key === k)?.france?.filter((p) => p.er != null).sort((a, b) => a.start.localeCompare(b.start)).slice(-n).map((p) => ({ v: p.er, w: p.week })) ?? [];
  const deptNote = (a) => {
    const [state] = urgState(a);
    const k = a.driver ?? 'ira';
    const fr = franceSeries(k);
    const happen = a.driver ? [] : [state + '.'];
    for (const key of Object.keys(SYN)) { const r = a.syn[key]; if (r && RANK[r.level] >= 1) happen.push(`${SYN[key]} : ${synRow(key, r)}, ${WORD[r.level].toLowerCase()}.`); }
    happen.push(`Alerte de la région : ${regLine(a)}.`);
    const weak = Object.keys(PROF).filter((p) => a.apl?.apl?.[p] != null && a.apl.apl[p] / S.data.apl.france.apl[p] < 0.75);
    const impact = [`Hôpitaux : ${hospLine(a)}.`,
      `Accès aux soins : généralistes ${aplLine(a, 'mg')}, ${aplRank(a, 'mg')}${weak.length ? ` ; sous 0,75 fois la moyenne : ${weak.map((p) => PROF[p].toLowerCase()).join(', ')}` : ''}.`,
      ...(a.apl?.shareUnder25 != null ? [`${num(a.apl.shareUnder25)}${NB}% de la population sous 2,5${NB}consultations de généraliste par an.`] : [])];
    const evo = [fr.length >= 2 ? `France, ${SYN[k].toLowerCase()} : ${pct(fr.at(-2).v)} en ${wk(fr.at(-2).w)}, ${pct(fr.at(-1).v)} en ${wk(fr.at(-1).w)}.` : 'Tendance nationale : n.d.',
      ...(a.apl?.apl2023?.mg != null ? [`Généralistes : ${num(a.apl.apl2023.mg, 2)} en 2023, ${num(a.apl.apl.mg, 2)} en 2024 (${signed(a.apl.apl.mg / a.apl.apl2023.mg - 1)}).`] : [])];
    const unknown = ['Pas d’historique par département dans le flux hebdomadaire : l’évolution locale n’est pas mesurable ici.',
      'Une part faible (moins de 1 % des passages) donne un écart fragile : à confirmer la semaine suivante.',
      'Attente aux urgences, saturation et fermetures de lignes de garde : non publiées en données ouvertes.',
      ...(a.syn[k]?.sos == null ? ['SOS Médecins : pas d’association couverte dans le département.'] : [])];
    const bad = neighbours(a).filter((x) => x.driver);
    const bluf = [`${a.driver ? `${SYN[a.driver]} aux urgences ${signed(a.syn[a.driver].ratio - 1)} au-dessus du maximum des 3${NB}saisons (${WORD[a.urg].toLowerCase()}, ${synRank(a, a.driver)})` : 'Urgences dans les normales des saisons précédentes'}${bad.length ? ` ; ${bad.length}${NB}département${bad.length > 1 ? 's' : ''} voisin${bad.length > 1 ? 's' : ''} aussi en anomalie` : ''}.`,
      `Capacité : ${reaLine(a)} ; accès aux généralistes ${a.apl?.apl?.mg != null ? `${num(a.apl.apl.mg / S.data.apl.france.apl.mg, 2)}${NB}fois la moyenne` : 'n.d.'}.`];
    impact.push(`Départements voisins : ${neighLine(a)}.`);
    if (a.apl?.pop) impact.push(`Population : ${num(a.apl.pop)} habitants${passPer(a) != null ? ` ; ${num(passPer(a))} passages aux urgences pour 1${NB}000 habitants par an` : ''}.`);
    impact.splice(1, 0, `Capacité : ${reaLine(a)}.`);
    return { title: `${a.nom} (${a.code})`, sub: 'Santé · note de situation', level: RANK[a.urg] >= 1 ? a.urg : null, at: when(new Date().toISOString()),
      gauges: Object.keys(SYN).filter((k) => a.syn[k]).map((k) => synGauge(k, a.syn[k])),
      blocks: [['À retenir', bluf], ['Ce qui se passe', happen], ['Impact et capacités', impact], ['Évolution', evo], ['Ce qu’on ne sait pas', unknown]],
      charts: seasonChart(k) + agesChart('ira'),
      sources: ['OSCOUR', 'Odissé', 'DREES'] };
  };
  const hospNote = (g) => {
    const s = g[0], a = S.depts.get(s.dept), c = hospCard(g);
    return { title: nice(s.name), sub: c.state, level: null, at: when(new Date().toISOString()),
      blocks: [['Ce qui se passe', [a ? `${urgState(a)[0]}.` : 'Département : n.d.', `Alerte de la région : ${a ? regLine(a) : 'n.d.'}.`]],
        ['Impact et capacités', c.rows.filter(([k]) => !/Département/.test(k)).map(([k, v]) => `${k} : ${v}.`)],
        ['Évolution', [`Activité annuelle seulement (SAE ${S.data.hosp?.vintage ?? 'n.d.'}) : pas de série hebdomadaire par établissement.`]],
        ['Ce qu’on ne sait pas', ['Attente, saturation, plan blanc et fermetures de lignes de garde : non publiés en données ouvertes.', 'Lits disponibles du jour : non publiés.']]],
      link: `https://finess.esante.gouv.fr/fininter/jsp/actionDetailEtablissement.do?noFiness=${s.finess}`, sources: ['DREES SAE', 'OSCOUR'] };
  };
  const franceNote = () => {
    const d = S.data, g = natGauges(), bad = g.filter((x) => RANK[x.level] >= 1);
    const depts = [...S.depts.values()].filter((a) => a.driver);
    const byLvl = (l) => depts.filter((a) => a.urg === l).length;
    const ira = (d.senti?.indicators ?? []).find((x) => x.key === 'ira');
    return { title: 'France', sub: 'Santé · urgences et médecine de ville', level: bad.length ? bad.reduce((w, x) => (RANK[x.level] > RANK[w] ? x.level : w), 'jaune') : null, at: when(new Date().toISOString()),
      gauges: Object.keys(SYN).map((k) => natGauge(k)),
      blocks: [['À retenir', [`${bad.length ? `Au-dessus des saisons précédentes en France : ${bad.map((x) => x.label.toLowerCase()).join(', ')}` : 'Urgences en France dans les normales des 3 saisons précédentes'} ; ${depts.length}${NB}départements en anomalie (${byLvl('rouge')} en crise, ${byLvl('orange')} en alerte, ${byLvl('jaune')} en vigilance).`,
          ...(ira ? [`Médecine de ville (Sentinelles) : IRA ${num(ira.rate)} cas pour 100${NB}000, ${ira.trend}, activité ${ira.activity}.`] : [])]],
        ['Ce qui se passe', [...renderWatchItems().map(([, t]) => `${t}.`)]],
        ['Évolution', ['Courbes : saison en cours contre les trois précédentes, puis classes d’âge.']],
        ['Ce qu’on ne sait pas', ['Séries par classe d’âge publiées seulement pour les IRA et le COVID-19 (65 ans ou plus).', 'Saturation des urgences et lits disponibles du jour : non publiés en données ouvertes.']]],
      charts: MAIN.map(seasonChart).join('') + agesChart('ira'), sources: ['OSCOUR', 'Odissé', 'Sentinelles', 'Eaux usées', 'ANSM', 'RappelConso', 'DGS'] };
  };
  const sourcesOf = (n) => freshness().filter(([k]) => n.sources.some((x) => k.startsWith(x)));
  const noteText = (n) => [`${n.title} · ${n.sub}`, `Situation au ${n.at}`, ...n.blocks.map(([h, xs]) => `${h} : ${xs.join(' ')}`),
    `Sources : ${sourcesOf(n).map(([k, v]) => `${k} ${v}`).join(' ; ')}.`].join('\n');
  const openFiche = (kind, key, silent) => {
    let n = null;
    if (kind === 'dept') { const a = S.depts.get(key); if (a) n = deptNote(a); }
    if (kind === 'hosp') { const g = S.hGroups[key]; if (g) n = hospNote(g); }
    if (kind === 'france') n = franceNote();
    if (!n) { if (!silent) closeFiche(); return; }
    S.fiche = { kind, key };
    const lvl = n.level ? `<span class="mqh-lvl" style="background:${L1[n.level]};color:${n.level === 'jaune' ? '#1a1a1a' : '#fff'}">${WORD[n.level]}</span>` : '';
    panel.innerHTML = `<header><div><h3>${esc(n.title)}</h3><div class="mqh-sub">${lvl}${esc(n.sub)}</div><div class="mqh-at">Situation au ${n.at}</div></div>`
      + `<button class="mqh-x" aria-label="Fermer">×</button></header>`
      + n.blocks.map(([h, xs]) => sec(h, (h === 'Ce qui se passe' && n.gauges ? `<div class="mqh-gs">${n.gauges.map(gauge).join('')}</div><div class="mqh-g-cap">Barre = part des passages de la semaine ; trait blanc = maximum des 3${NB}saisons précédentes.</div>` : '') + li(xs.map(esc)) + (h === 'Évolution' && n.charts ? n.charts : ''))).join('')
      + sec('Sources et confiance', `<table>${sourcesOf(n).map(([k, v, st]) => `<tr><td><i class="mqh-src-${st}"></i>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>`
        + (n.link ? `<p><a href="${esc(n.link)}" target="_blank" rel="noopener">Fiche FINESS de l’établissement</a></p>` : ''))
      + `<footer><button class="mqh-copy">Copier pour la note</button><span class="mqh-copied"></span></footer>`;
    panel.style.display = 'flex';
    if (legend.dataset.open === 'true') { legend.dataset.open = 'false'; renderLegend(); }
    panel.querySelector('.mqh-x').onclick = closeFiche;
    panel.querySelector('.mqh-copy').onclick = async () => {
      try { await navigator.clipboard.writeText(noteText(n)); panel.querySelector('.mqh-copied').textContent = 'Copié'; } catch (e) { panel.querySelector('.mqh-copied').textContent = 'Copie refusée par le navigateur'; }
    };
  };
  const closeFiche = () => { panel.style.display = 'none'; S.fiche = null; };

  // ─── Encart « Veille nationale » : ce qui n'a pas de lieu sur la carte (outre-mer, réseaux nationaux, produits) ───
  const watch = document.createElement('div');
  watch.className = 'mqh-watch';
  const wwLevel = () => { const pts = S.data.ww?.points ?? []; const last = pts.at(-1); if (!last || last.national54 == null) return null;
    const t = Date.parse(`${last.start}T00:00:00Z`) - 14 * 864e5; const a = pts.find((p) => Date.parse(`${p.start}T00:00:00Z`) === t)?.national54 ?? null; const b = S.data.ww?.lastYear?.national54 ?? null;
    const n = (a != null && last.national54 > a && last.national54 >= 1.5 * a ? 1 : 0) + (b != null && last.national54 > b ? 1 : 0);
    return { level: n === 2 ? 'orange' : n === 1 ? 'jaune' : 'vert', v: last.national54, a, b, week: last.week }; };
  const natGauge = (k) => { const wkId = S.data.syn?.week?.id; const pts = (S.data.syn?.syndromes ?? []).find((x) => x.key === k)?.france ?? []; const cur = pts.find((p) => p.week === wkId)?.er ?? null;
    const n = Number(String(wkId ?? '').slice(-2)), y = Number(String(wkId ?? '').slice(0, 4));
    const refs = [1, 2, 3].map((i) => pts.find((p) => p.week === `${y - i}-S${pad(n)}`)?.er).filter((x) => Number.isFinite(x));
    return synGauge(k, { er: cur, max: refs.length >= 2 ? Math.max(...refs) : null, level: seasonalLevel(cur, refs), ratio: ratio(cur, refs) }); };
  const natGauges = () => MAIN.map(natGauge);
  const renderWatch = () => {
    const d = S.data, items = renderWatchItems();
    watchBody(d, items);
  };
  const renderWatchItems = () => {
    const d = S.data, items = [];
    // Outre-mer : hors du cadre de la carte, toujours listé ici.
    const dom = [...S.regions.values()].filter((r) => Number(r.code) < 11 && r.live.some((l) => l.phase !== 1));
    for (const r of dom) for (const l of r.live.filter((x) => x.phase !== 1)) items.push([PHASE_LEVEL[l.phase], `${r.nom} : ${(PATHO[l.pathology] ?? l.pathology).toLowerCase()} en ${PHASE_WORD[l.phase]} (${wk(l.week)})`]);
    const domUrg = [...S.depts.values()].filter((a) => !a.inMap && a.driver);
    if (domUrg.length) items.push([domUrg.reduce((w, a) => (RANK[a.urg] > RANK[w] ? a.urg : w), 'jaune'), `Urgences outre-mer : ${domUrg.map((a) => `${a.nom} (${SYN_SHORT[a.driver]})`).join(', ')}`]);
    const ira = (d.senti?.indicators ?? []).find((x) => x.key === 'ira');
    if (ira) items.push([null, `Sentinelles, IRA : ${num(ira.rate)} cas pour 100${NB}000 (${wk(d.senti.week.id)}), ${ira.trend}, activité ${ira.activity}`]);
    const ww = wwLevel(); if (ww) items.push([ww.level === 'vert' ? null : ww.level, `Eaux usées, SARS-CoV-2 : ${ww.level === 'vert' ? 'pas de hausse' : ww.level === 'orange' ? 'hausse forte et au-dessus de l’an dernier' : 'en hausse'} (${wk(ww.week)})`]);
    if (d.drugs?.counts) items.push([null, `Médicaments (ANSM) : ${num(d.drugs.counts.rupture)} ruptures, ${num(d.drugs.counts.tension)} tensions`]);
    if (d.recalls?.healthRisk != null) items.push([null, `Rappels de produits avec risque sanitaire : ${num(d.recalls.healthRisk)} depuis le ${day(d.recalls.since)}`]);
    return items;
  };
  const watchBody = (d, items) => {
    const ko = freshness().filter((r) => r[2] === 'ko').map((r) => r[0]);
    const wkId = d.syn?.week?.id;
    const natG = natGauges();
    watch.innerHTML = `<div class="mqh-w-h">${icon('activity', items.some(([l]) => l) ? L1.jaune : MUTE)}<b>Baromètre national · urgences ${wk(wkId)}</b></div>`
      + `<div class="mqh-gs">${natG.map(gauge).join('')}</div>`
      + `<div class="mqh-w-h mqh-w-h2"><b>Veille nationale et outre-mer</b></div>`
      + items.map(([l, t]) => `<div class="mqh-w-r"><i style="background:${l ? L1[l] : '#3a3f4b'}"></i><span>${esc(t)}</span></div>`).join('')
      + (ko.length ? `<div class="mqh-w-s">Indisponible : ${esc(ko.join(', '))}</div>` : '')
      + '<div class="mqh-w-s"><a href="#" class="mqh-w-more">Fiche nationale : saisons et classes d’âge</a></div>';
    const more = watch.querySelector('.mqh-w-more'); if (more) more.onclick = (e) => { e.preventDefault(); openFiche('france', 'fr'); };
  };

  // ─── Légende « Lire la carte » ───
  const legend = document.createElement('div');
  legend.className = 'mqh-legend';
  const swatch = (color, shape) => `<i class="mqh-sw mqh-sw-${shape}" style="--c:${color}"></i>`;
  const icon = (name, color) => `<span class="mqh-ic">${fmIcon(name, { size: 14 }).replace('<svg', `<svg style="color:${color ?? INK}"`)}</span>`;
  const it = (sw, label) => `<span class="mqh-it">${sw}${esc(label)}</span>`;
  const hsw = (k) => `<svg width="14" height="14" viewBox="0 0 40 40" style="flex:0 0 14px">${HSHAPE[k]}</svg>`;
  const renderLegend = () => {
    const open = legend.dataset.open === 'true';
    const src = freshness(), ko = src.filter((r) => r[2] !== 'ok').length;
    legend.classList.toggle('is-open', open);
    legend.innerHTML = !open ? `<button class="mqh-leg-toggle">${icon('circle-help')}Légende${ko ? `<em>${ko}${NB}source${ko > 1 ? 's' : ''} en défaut</em>` : ''}</button>` : `
      <header><h4>Lire la carte</h4><button class="mqh-x mqh-leg-toggle" aria-label="Fermer">×</button></header>
      <h5>État : seulement ce qui est anormal</h5>
      <div class="mqh-row">${it(swatch(L1.jaune, 'line'), 'Vigilance')}${it(swatch(L1.orange, 'line'), 'Alerte')}${it(swatch(L1.rouge, 'line'), 'Crise')}</div>
      <div class="mqh-row mqh-note">Contour du département : urgences de la semaine au-dessus du maximum des 3${NB}saisons précédentes (${S.syndrome ? SYN[S.syndrome].toLowerCase() : 'pire de IRA, bronchiolite et gastro-entérite'}) ; chiffre = écart. Teinte avec la pastille.</div>
      <div class="mqh-row">${it(swatch(L1.orange, 'dash'), 'Région en pré-épidémie ou épidémie (Odissé)')}</div>
      <h5>Couche : une couleur par catégorie</h5>
      <div class="mqh-row">${it(hsw('chu'), 'CHU')}${it(hsw('ch'), 'centre hospitalier')}${it(hsw('private'), 'clinique privée')}${it(hsw('other'), 'autres')}</div>
      <div class="mqh-row mqh-note">Sites avec urgences ; taille = passages ${S.data.hosp?.vintage ?? ''} ; nom des villes de CHU, nom des sites au zoom.</div>
      <div class="mqh-row mqh-note">Accès aux soins, ${PROF[S.prof].toLowerCase()} (DREES, annuel, jamais une alerte), par rapport à la moyenne nationale :</div>
      <div class="mqh-ramp">${[...APL_RAMP].reverse().map(([, c, w]) => it(swatch(c, 'sq'), w)).join('')}</div>
      <div class="mqh-row">${it(swatch(REG_LINE, 'dash'), 'Limite de région')}</div>
      <div class="mqh-row mqh-note">Avec la pastille Veille sanitaire : ${it(swatch(L1.vert, 'sq'), 'pas d’alerte épidémique (mesuré)')} ${it(swatch(SENTI_HEX, 'disc'), 'région parmi les plus touchées (Sentinelles), taille = écart au taux national')}</div>
      <div class="mqh-row mqh-note">Sans pastille active, toutes les couches sont affichées. Une pastille met sa couche en avant et estompe les autres (clic, cumulable ; survol pour un aperçu). Le syndrome et la profession choisis dans les panneaux s’appliquent à la carte.</div>
      <details${ko ? ' open' : ''}><summary>Sources · ${src.length - ko}${NB}à jour, ${ko}${NB}en défaut</summary>${src.map(([k, v, st]) => `<div class="mqh-row mqh-src"><i class="mqh-src-${st}"></i><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</details>`;
    legend.querySelectorAll('.mqh-leg-toggle').forEach((b) => { b.onclick = () => { legend.dataset.open = String(!open); renderLegend(); }; });
  };

  const css = `
  body.mqh-on .maplibregl-popup, body.mqh-on .deck-tooltip { display: none !important; }
  body.mqh-on .map-key-btn, body.mqh-on .map-key { display: none !important; }
  body.mqh-on { --cat-hosp-chu: #ffffff; --cat-hosp-ch: #e879f9; --cat-hosp-private: #a78bfa; --cat-hosp-gcs: #d9b36c; --cat-hosp-army: #d9b36c; }
  .mqh-pop .et-card { max-width: 410px; } .mqh-pop .et-row b { white-space: normal; text-align: right; } .mqh-pop .et-row span { flex: 0 0 auto; max-width: 42%; }
  .mqh-pop { position: absolute; left: 0; top: 0; z-index: 30; pointer-events: none; display: none; background: var(--bg-surface, #14161c); border: 1px solid var(--border-color, #2a2e37);
    border-radius: 8px; padding: 10px 12px; box-shadow: 0 8px 24px rgba(0,0,0,.5); }
  .mqh-fiche { position: absolute; right: 12px; top: 110px; bottom: 64px; width: 370px; z-index: 31; display: none; flex-direction: column; gap: 10px; overflow-y: auto;
    background: #12141a; border: 1px solid #2a2e37; border-radius: 10px; padding: 14px 16px; color: #e8e8ec; font-size: 12.5px; line-height: 1.45; box-shadow: 0 10px 30px rgba(0,0,0,.55); }
  .mqh-fiche header { display: flex; justify-content: space-between; gap: 8px; } .mqh-fiche h3 { margin: 0; font-size: 16px; }
  .mqh-fiche a { color: #93c5fd; }
  .mqh-sub { color: #aab0bc; margin-top: 3px; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; } .mqh-at { color: #6e6e80; font-size: 11px; margin-top: 2px; }
  .mqh-lvl { border-radius: 4px; padding: 0 6px; font-weight: 600; font-size: 11px; }
  .mqh-x { background: none; border: 0; color: #9898a8; font-size: 20px; cursor: pointer; line-height: 1; }
  .mqh-fiche h4 { margin: 0 0 4px; font-size: 11px; color: #9aa1ae; font-weight: 600; letter-spacing: .03em; }
  .mqh-fiche ul { margin: 0; padding-left: 16px; } .mqh-fiche li { margin: 2px 0; }
  .mqh-fiche table { width: 100%; border-collapse: collapse; } .mqh-fiche td { padding: 2px 0; vertical-align: top; } .mqh-fiche td:first-child { color: #9898a8; padding-right: 10px; }
  .mqh-fiche footer { margin-top: auto; display: flex; align-items: center; gap: 10px; padding-top: 8px; border-top: 1px solid #23262e; }
  .mqh-copy { background: #e8e8ec; color: #111; border: 0; border-radius: 6px; padding: 6px 12px; font-weight: 600; cursor: pointer; } .mqh-copied { color: #9898a8; }
  .mqh-spark { width: 100%; height: 44px; margin-top: 6px; } .mqh-spark-cap { color: #6e6e80; font-size: 11px; }
  .mqh-legend { position: absolute; right: 60px; bottom: 34px; z-index: 29; color: #d9dde5; font-size: 11.5px; }
  .mqh-legend.is-open { bottom: 52px; width: 300px; max-height: calc(100% - 330px); overflow-y: auto; background: rgba(18,20,26,.97); border: 1px solid #2a2e37; border-radius: 10px; padding: 10px 12px; }
  .mqh-legend header { display: flex; justify-content: space-between; align-items: center; } .mqh-legend h4 { margin: 0; font-size: 13px; }
  .mqh-legend details { margin-top: 8px; } .mqh-legend summary { cursor: pointer; color: #9aa1ae; font-size: 11px; font-weight: 600; }
  .mqh-legend:not(.is-open) .mqh-leg-toggle { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 999px; background: rgba(18,20,26,.95); }
  .mqh-leg-toggle { background: #1c2029; color: #e8e8ec; border: 1px solid #2a2e37; border-radius: 6px; padding: 3px 10px; cursor: pointer; font-size: 11.5px; }
  .mqh-leg-toggle em { font-style: normal; color: #ffcc00; font-size: 10.5px; margin-left: 2px; }
  .mqh-legend h5 { margin: 10px 0 4px; font-size: 11px; color: #9aa1ae; font-weight: 600; } .mqh-row { display: flex; align-items: center; gap: 6px; margin: 3px 0; flex-wrap: wrap; }
  .mqh-sw { display: inline-block; flex: 0 0 auto; } .mqh-sw-disc { width: 12px; height: 12px; border-radius: 50%; background: var(--c); box-shadow: 0 0 0 1.5px #05060a; }
  .mqh-sw-line { width: 22px; height: 0; border-top: 3px solid var(--c); } .mqh-sw-dash { width: 22px; height: 0; border-top: 3px dashed var(--c); }
  .mqh-ic { display: inline-flex; width: 18px; height: 18px; border-radius: 50%; background: #161a22; border: 1.5px solid #8a93a6; align-items: center; justify-content: center; }
  .mqh-ic svg { width: 11px; height: 11px; }
  .mqh-note { color: #9898a8; font-size: 11px; }
  .mqh-gs { display: flex; flex-direction: column; gap: 5px; margin: 6px 0 4px; }
  .mqh-g-h { display: flex; justify-content: space-between; gap: 8px; font-size: 11.5px; color: #aab0bc; } .mqh-g-h b { font-weight: 600; white-space: nowrap; }
  .mqh-g-t { position: relative; height: 6px; border-radius: 3px; background: #262a33; margin-top: 2px; }
  .mqh-g-f { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 3px; } .mqh-g-m { position: absolute; top: -3px; bottom: -3px; width: 2px; margin-left: -1px; background: #ffffff; }
  .mqh-chart { margin-top: 8px; } .mqh-chart-t { color: #aab0bc; font-size: 11px; margin-bottom: 3px; } .mqh-chart-svg { width: 100%; height: auto; display: block; }
  .mqh-chart-c { color: #8a8f9c; font-size: 10.5px; margin-top: 3px; line-height: 1.4; }
  .mqh-ages { width: 100%; font-size: 11px; margin-top: 4px; } .mqh-ages th { color: #6e6e80; font-weight: 500; text-align: right; } .mqh-ages td { text-align: right; white-space: nowrap; }
  .mqh-ages td:first-child { text-align: left; } .mqh-age { display: inline-block; width: 10px; height: 3px; margin-right: 5px; vertical-align: middle; }
  .mqh-w-more { color: #93c5fd; }
  .mqh-g-cap { color: #6e6e80; font-size: 10.5px; margin-bottom: 4px; } .mqh-w-h2 { margin-top: 8px; }
  .mqh-it { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; margin-right: 8px; }
  .mqh-ramp { display: flex; flex-direction: column; gap: 3px; margin: 3px 0 3px 4px; } .mqh-sw-sq { width: 14px; height: 10px; border-radius: 2px; background: var(--c); }
  .mqh-src { align-items: flex-start; flex-wrap: nowrap; } .mqh-src i { margin-top: 4px; } .mqh-src span { color: #9898a8; flex: 0 0 auto; } .mqh-src b { font-weight: 500; margin-left: auto; text-align: right; flex: 1; }
  [class^="mqh-src-"] { display: inline-block; width: 8px; height: 8px; border-radius: 50%; flex: 0 0 8px; margin-right: 4px; }
  .mqh-src-ok { background: #6e7585; } .mqh-src-part { background: transparent; border: 1.5px solid #9aa1ae; } .mqh-src-ko { background: repeating-linear-gradient(45deg, #9aa1ae 0 2px, transparent 2px 4px); border: 1px solid #9aa1ae; }
  .mqh-watch { position: absolute; left: 12px; bottom: 64px; z-index: 29; width: 290px; background: rgba(18,20,26,.96); border: 1px solid #2a2e37; border-radius: 10px; padding: 8px 12px; color: #d9dde5; font-size: 11.5px; }
  .mqh-w-h { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
  .mqh-w-r { display: flex; gap: 7px; align-items: flex-start; margin: 3px 0; line-height: 1.35; } .mqh-w-r i { flex: 0 0 8px; height: 8px; border-radius: 50%; margin-top: 4px; }
  .mqh-w-s { color: #6e6e80; font-size: 10.5px; margin-top: 4px; }
  .mqh-watch.is-focus { border-color: #c9cdd6; box-shadow: 0 0 0 2px rgba(201,205,214,.3); } .mqh-watch.is-dim { display: none; }
  `;

  const start = async () => {
    for (let i = 0; i < 200 && !window._franceMonitorMap; i += 1) await wait(100);
    S.m = window._franceMonitorMap;
    const lib = window.__fmMaquette ?? {};
    fmIcon = lib.fmIcon ?? (await import('/src/components/shared/icons.ts')).fmIcon;
    // Rien n'est chargé tant que l'onglet Santé n'a pas été ouvert.
    while (!isHealth()) await wait(1000);
    for (let i = 0; i < 120 && !S.m.getLayer('hospitals-sites'); i += 1) await wait(250);
    const [geo, deptShapes, regions] = await Promise.all([getJson('/maquette-securite-geo.json'), getJson('/data/departements.geojson'), getJson('/data/regions.geojson')]);
    S.geo = { depts: geo.depts ?? [], deptShapes: deptShapes.features ?? [], regions: regions.features ?? [] };
    // Départements voisins : contours qui partagent au moins deux sommets.
    const owners = new Map();
    for (const f of S.geo.deptShapes) { const g = f.geometry; for (const poly of (g.type === 'Polygon' ? [g.coordinates] : g.coordinates)) for (const [x, y] of poly[0]) {
      const k = `${x.toFixed(3)},${y.toFixed(3)}`; const o = owners.get(k) ?? new Set(); o.add(f.properties.code); owners.set(k, o); } }
    const shared = new Map();
    for (const o of owners.values()) if (o.size > 1) for (const a of o) for (const b of o) if (a !== b) { const k = `${a}|${b}`; shared.set(k, (shared.get(k) ?? 0) + 1); }
    S.neigh = new Map();
    for (const [k, n] of shared) if (n >= 2) { const [a, b] = k.split('|'); (S.neigh.get(a) ?? S.neigh.set(a, new Set()).get(a)).add(b); }
    const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
    const host = S.m.getContainer();
    host.append(pop, panel, legend, watch);
    wireChips();
    const load = async () => {
      const [syn, alerts, senti, ww, drugs, recalls, dgs, apl, hosp] = await Promise.all(['/api/health/syndromic', '/api/health/alert-levels', '/api/health/sentinelles-national',
        '/api/health/wastewater', '/api/health/drug-shortages', '/api/health/recalls', '/api/health/dgs-messages', '/data/apl-2024.json', '/data/hospitals-urgences.json'].map(getJson));
      S.data = { syn, alerts, senti, ww, drugs, recalls, dgs, apl, hosp };
      await draw();
    };
    await load();
    setInterval(load, 15 * 60 * 1000);
    S.m.on('idle', calm);
    // Changement d'onglet : la carte Santé se retire ou revient sans attendre un mouvement de la carte.
    setInterval(() => { if (isHealth() !== Boolean(S.was)) applyFocus(); }, 700);
    S.m.on('move', placePop);
    S.m.on('mousemove', onMove);
    S.m.getCanvas().addEventListener('mouseleave', () => { pop.style.display = 'none'; popAt = null; S.hoverKey = null; setHover(null); });
    // Clic : la fiche de la maquette remplace les fenêtres de l'app (capturé avant MapLibre).
    host.addEventListener('click', (e) => {
      if (e.target !== S.m.getCanvas() || !isHealth()) return;
      e.stopPropagation();
      const r = S.m.getCanvas().getBoundingClientRect();
      const hit = pick([e.clientX - r.left, e.clientY - r.top]);
      if (!hit) { closeFiche(); return; }
      pop.style.display = 'none'; popAt = null; S.hoverKey = null;
      if (hit.card?.url) { window.open(hit.card.url, '_blank', 'noopener'); return; }
      openFiche(hit.kind, hit.id);
    }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isHealth()) { closeFiche(); pop.style.display = 'none'; } });
    window.__mqh = S;
    console.log('[maquette-sante] prête', { anomalies: [...S.depts.values()].filter((a) => a.driver).length });
  };
  start();
})();
