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
  const SYN = { ira: 'IRA', bronchio: 'Bronchiolite', gastro: 'Gastro-entérite', asthme: 'Asthme', allergie: 'Allergie', grippe: 'Grippe', covid: 'COVID-19',
    pneumo: 'Pneumopathie', bronchite: 'Bronchite', orl: 'Pathologies ORL', trauma: 'Traumatismes' };
  const SYN_SHORT = { ira: 'IRA', bronchio: 'Bronchio', gastro: 'Gastro', asthme: 'Asthme', allergie: 'Allergie', grippe: 'Grippe', covid: 'COVID', pneumo: 'Pneumo', bronchite: 'Bronchite', orl: 'ORL', trauma: 'Trauma' };
  // Odissé (Santé publique France, API ouverte) : un jeu par syndrome, par département, semaine et classe d'âge, depuis 2022.
  const OD = 'https://odisse.santepubliquefrance.fr/api/explore/v2.1/catalog/datasets/';
  const OD_DS = { ira: ['infections-respiratoires-aigues-ira-passages-aux-urgences-et-actes-sos-medecins-departement', 'ira'],
    bronchio: ['bronchiolite-passages-aux-urgences-et-actes-sos-medecins-departement', 'bronchio'], gastro: ['gastro-enterite-aigue-passages-aux-urgences-et-actes-sos-medecins-departement', 'gastro'],
    grippe: ['grippe-passages-aux-urgences-et-actes-sos-medecins-departement', 'grippe'], covid: ['covid-19-passages-aux-urgences-et-actes-sos-medecins-departement', 'covid'],
    asthme: ['asthme-passages-aux-urgences-et-actes-sos-medecins-dep', 'asthme'], allergie: ['allergie-passages-aux-urgences-et-actes-sos-medecins-dep', 'allergie'],
    pneumo: ['pneumopathie-passages-aux-urgences-et-actes-sos-medecins-departement', 'pneumopathie'], bronchite: ['bronchite-passages-aux-urgences-et-actes-sos-medecins-departement', 'bronchite'],
    orl: ['pathologies-orl-passages-aux-urgences-et-actes-sos-medecins-departement', 'orl'], trauma: ['traumatisme-passages-aux-urgences-et-actes-sos-medecins-departement', 'trauma'] };
  const EXTRA_SYN = ['pneumo', 'bronchite', 'orl', 'trauma'];
  const odExport = (k, where) => { const [ds, f] = OD_DS[k];
    return getJson(`${OD}${ds}/exports/json?select=${encodeURIComponent(`dep,semaine,sursaud_cl_age_gene as age,taux_passages_${f}_sau as er,taux_hospit_${f}_sau as hosp,taux_actes_${f}_sos as sos`)}&where=${encodeURIComponent(where)}&order_by=semaine`)
      // Taux Odissé publiés pour 100 000 passages (ou actes) : convertis en pourcentage.
      .then((rows) => (Array.isArray(rows) ? rows.map((r) => ({ ...r, er: r.er == null ? null : r.er / 1000, hosp: r.hosp == null ? null : r.hosp / 1000, sos: r.sos == null ? null : r.sos / 1000 })) : rows)); };
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
  // EHPAD : anneau blanc cassé (établissement médico-social, pas un hôpital), jamais une alerte.
  const EHPAD_HEX = '#e7e5e4';
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
  const KEEP = new Set(['CHU', 'CHR', 'CH', 'CHI', 'CHIC', 'CHRU', 'CHG', 'GHU', 'GH', 'GHT', 'APHP', 'AP-HP', 'APHM', 'AP-HM', 'HCL', 'HIA', 'SUN', 'HEGP', 'GCS', 'HPGM', 'IGR', 'ICM', 'MCO', 'PSL', 'SSR', 'HP', 'CMC', 'CHT', 'HU', 'HNO', 'EHPAD', 'USLD', 'NUP', 'GHEM', 'UPS', 'CUP', 'HM', 'II', 'III', 'IV']);
  const ACC = { Hopital: 'Hôpital', Hopitaux: 'Hôpitaux', Prive: 'Privé', Privee: 'Privée', Medical: 'Médical', Medico: 'Médico', General: 'Général', Generale: 'Générale', Regional: 'Régional',
    Sante: 'Santé', Pediatrique: 'Pédiatrique', Specialise: 'Spécialisé', Etablissement: 'Établissement', Medecine: 'Médecine', Evangelique: 'Évangélique', Hotel: 'Hôtel' };
  const SMALL = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'sur', 'en', 'au', 'aux', 'a', 'à']);
  const nice = (s) => String(s ?? '').toLowerCase().split(/(\s+|-|')/).map((w, i) => {
    if (KEEP.has(w.toUpperCase())) return w.toUpperCase();
    if (i > 0 && SMALL.has(w)) return w;
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join('').replace(/\b([DL])[ ']+(?=[A-ZÉ])/g, (x, c) => `${c.toLowerCase()}’`).replace(/'/g, '’')
    .replace(/\b(Hopital|Hopitaux|Prive|Privee|Medical|Medico|Generale?|Universitaire|Regional|Intercommunal|Mutualiste|Sante|Pediatrique|Specialise|Etablissement|Medecine|Evangelique|Fondation|Hotel)\b/g, (w) => ACC[w] ?? w);
  const commune = (c) => nice(String(c ?? '').replace(/\s+(\d+)(E|ER)\s+ARRONDISSEMENT$/i, ' $1e')).replace(/ (\d+)E$/, ' $1e')
    .replace(/^(.*) \((le|la|les)\)$/i, (x, n, art) => `${art.charAt(0).toUpperCase()}${art.slice(1).toLowerCase()} ${n}`).replace(/^(.*) \(l’\)$/i, 'L’$1');
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
    for (const [k, rows] of Object.entries(d.extraSyn ?? {})) {
      if (!Array.isArray(rows)) continue;
      const wkId = syn?.week?.id; const byDep = new Map();
      for (const r of rows) { const o = byDep.get(r.dep) ?? {}; o[r.semaine] = r; byDep.set(r.dep, o); }
      for (const [dep, o] of byDep) { const cur = o[wkId]; if (!cur) continue; const a = touch(dep, dep);
        const refs = Object.entries(o).filter(([w]) => w !== wkId).map(([, r]) => r.er).filter((v) => Number.isFinite(v));
        a.syn[k] = { er: cur.er, hosp: cur.hosp, sos: cur.sos, refs, max: refs.length >= 2 ? Math.max(...refs) : null, level: seasonalLevel(cur.er, refs), ratio: ratio(cur.er, refs) }; }
    }
    for (const x of apl?.departments ?? []) { const a = touch(x.code, x.name); a.apl = x; }
    // Lot 2 : contexte de vulnérabilité et antécédents (déclarations obligatoires, couverture vaccinale), jamais une alerte.
    const arboLast = (d.arbo ?? []).reduce((m, r) => (r.mois > m ? r.mois : m), '');
    S.arboYear = arboLast.slice(0, 4); S.arboLast = arboLast;
    for (const r of Array.isArray(d.arbo) ? d.arbo : []) { if (!r.mois.startsWith(S.arboYear)) continue; const a = touch(r.dep, r.dep);
      a.arbo ??= {}; const o = a.arbo[r.arbo] ?? { autoch: 0, imp: 0, months: new Set() }; o.autoch += r.nbcas_autoch ?? 0; o.imp += r.nbcas_imp ?? 0; if (r.nbcas_autoch) o.months.add(r.mois); a.arbo[r.arbo] = o; }
    const vy = (Array.isArray(d.vacc) ? d.vacc : []).filter((r) => r.grip_65plus != null).reduce((m, r) => (r.an_mesure > m ? r.an_mesure : m), '');
    S.vaccYear = vy;
    for (const r of Array.isArray(d.vacc) ? d.vacc : []) if (r.an_mesure === vy && r.dep) touch(r.dep, r.dep).vacc = { grip: r.grip_65plus, covid: r.covid_65plus };
    const ly = (Array.isArray(d.legio) ? d.legio : []).reduce((m, r) => (r.annee > m ? r.annee : m), '');
    S.legioYear = ly;
    // Canicule (Santé publique France) : jours de canicule par été et excès de décès pendant les vagues de chaleur.
    for (const r of Array.isArray(d.heatDays) ? d.heatDays : []) if (r.dep) { const a = touch(r.dep, r.dep); (a.heat ??= { days: {}, deaths: {} }).days[r.annee] = r.nb_j_can; }
    for (const r of Array.isArray(d.heatDeaths) ? d.heatDeaths : []) if (r.dep) { const a = touch(r.dep, r.dep); ((a.heat ??= { days: {}, deaths: {} }).deaths[r.annee] ??= {})[r.classe_age] = r; }
    for (const r of Array.isArray(d.legio) ? d.legio : []) if (r.annee === ly && r.dep) touch(r.dep, r.dep).legio = { n: r.legio, taux: r.taux };
    for (const s of d.hosp?.sites ?? []) touch(s.dept, s.dept).hosp.push(s);
    for (const e of d.ehpad?.sites ?? []) { const a = touch(e.dept, e.dept); (a.ehpad ??= []).push(e); }
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
    // Eau du robinet (scripts/build-eau-potable.mjs, Hub'Eau) : niveau de la commune = pire prélèvement.
    // Restriction générale = orange ; restriction pour les publics sensibles ou bactériologie = jaune ; physico-chimie sans restriction = jaune creux.
    const WRANK = { restriction: 3, ciblee: 2, bact: 1, pc: 0 };
    const water = new Map();
    for (const c of d.water?.communes ?? []) {
      let v = 'pc';
      for (const sm of c.samples) { const x = sm.verdict === 'restriction' ? 'restriction' : sm.verdict === 'restriction ciblée' ? 'ciblee' : sm.kinds.includes('bact') ? 'bact' : 'pc'; if (WRANK[x] > WRANK[v]) v = x; }
      c.v = v;
      const w = water.get(c.dept) ?? { dept: c.dept, communes: [], last: '' }; water.set(c.dept, w);
      w.communes.push(c); for (const sm of c.samples) if (sm.date > w.last) w.last = sm.date;
    }
    S.water = water;
    // Eaux usées : niveau par station (même règle que l'indicateur national : ×1,5 en 2 semaines, au-dessus de l'an dernier).
    const slug = (x) => String(x).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const recs = [...(d.wwSt?.results ?? [])].sort((p, q) => p.semaine.localeCompare(q.semaine));
    S.stations = (d.wwMeta?.results ?? []).map((m) => { const key = slug(m.nom);
      const ser = recs.map((r) => ({ w: r.semaine, v: r[key] })).filter((x) => Number.isFinite(x.v));
      const last = ser.at(-1); if (!last) return { m, key, ser, level: 'nd' };
      const yy = Number(last.w.slice(0, 4)), nn = Number(last.w.slice(-2));
      const two = ser.find((x) => x.w === (nn > 2 ? `${yy}-S${pad(nn - 2)}` : `${yy - 1}-S${pad(52 + nn - 2)}`))?.v ?? null;
      const ly = ser.find((x) => x.w === `${yy - 1}-S${pad(nn)}`)?.v ?? null;
      const n = (two != null && last.v > two && last.v >= 1.5 * two ? 1 : 0) + (ly != null && last.v > ly ? 1 : 0);
      return { m, key, ser, last, two, ly, level: two == null && ly == null ? 'nd' : n === 2 ? 'orange' : n === 1 ? 'jaune' : 'vert', at: [m.centroide.lon, m.centroide.lat] };
    }).filter((x) => x.at);
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
  const setData = (id, data) => { const s = S.m.getSource(id); if (s) s.setData(data); else S.m.addSource(id, { type: 'geojson', data, ...(id === 'mqh-depts' ? { promoteId: 'code' } : {}) }); };
  const HIDE = ['health-alert-fill', 'health-alert-line', 'health-urg-fill', 'health-urg-line', 'health-apl-fill', 'health-apl-line', 'hospitals-sites'];

  const draw = async () => {
    const m = S.m;
    build();
    const d = S.data;
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
    setData('mqh-ww', fc(S.stations.map((x, i) => pt(x.at, { i, level: x.level, ring: RANK[x.level] >= 1 ? L1[x.level] : '#0a0a0f', pop: x.m.population ?? 0,
      label: `${commune(x.m.commune)}${x.last ? ` · ${x.two ? signed(x.last.v / x.two - 1) : 'n.d.'}` : ''}` }))));
    setData('mqh-water', fc((d.water?.communes ?? []).map((c, i) => pt([c.lon, c.lat], { i, v: c.v, r: { restriction: 3, ciblee: 2, bact: 1, pc: 0 }[c.v] }))));
    setData('mqh-ehpad', fc((d.ehpad?.sites ?? []).map((e, i) => pt([e.lon, e.lat], { i, places: e.places ?? 0, name: nice(e.name).replace(/^EHPAD /i, 'EHPAD ') }))));
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
      m.addLayer({ id: 'mqh-dept-hover', type: 'line', source: 'mqh-depts', paint: { 'line-color': '#ffffff', 'line-width': 1.6, 'line-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.9, 0] } });
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
      // Eaux usées : carré turquoise (famille Veille), taille = population raccordée, bord à la couleur d'état si hausse.
      m.addLayer({ id: 'mqh-ww', type: 'circle', source: 'mqh-ww', layout: { 'circle-sort-key': ['get', 'pop'] },
        paint: { 'circle-radius': ['interpolate', ['linear'], ['get', 'pop'], 50000, 3.5, 500000, 6, 2000000, 9], 'circle-color': SENTI_HEX, 'circle-opacity': 0.55,
          'circle-stroke-color': ['get', 'ring'], 'circle-stroke-width': ['case', ['==', ['get', 'ring'], '#0a0a0f'], 1.2, 3], 'circle-stroke-opacity': 1 } });
      m.addLayer({ id: 'mqh-ww-label', type: 'symbol', source: 'mqh-ww', layout: { 'text-field': ['get', 'label'], 'text-size': 10, 'text-font': ['Open Sans Semibold'],
        'text-variable-anchor': ['left', 'right', 'top', 'bottom'], 'text-radial-offset': 0.9, 'text-optional': true },
        paint: { 'text-color': SENTI_HEX, 'text-halo-color': '#0a0a0f', 'text-halo-width': 1.4, 'text-opacity': 1 } });
      // Eau du robinet : goutte jaune (non-conformité bactériologique observée), chiffre = communes concernées.
      const drop = (id, fill, stroke, w) => image(id, `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><path d="M20 4 C20 4 8 18 8 25 a12 12 0 0 0 24 0 C32 18 20 4 20 4 Z" fill="${fill}" stroke="${stroke}" stroke-width="${w}"/></svg>`, 40);
      await drop('mqh-drop-restriction', L1.orange, '#0a0a0f', 2.5); await drop('mqh-drop-ciblee', L1.jaune, '#0a0a0f', 2.5);
      await drop('mqh-drop-bact', L1.jaune, '#0a0a0f', 2.5); await drop('mqh-drop-pc', 'none', L1.jaune, 3.5);
      m.addLayer({ id: 'mqh-water', type: 'symbol', source: 'mqh-water', layout: { 'icon-image': ['concat', 'mqh-drop-', ['get', 'v']], 'symbol-sort-key': ['get', 'r'],
        'icon-size': ['interpolate', ['linear'], ['zoom'], 4, ['match', ['get', 'v'], 'restriction', 0.5, 0.36], 9, ['match', ['get', 'v'], 'restriction', 0.8, 0.6]], 'icon-allow-overlap': true, 'icon-ignore-placement': true },
        paint: { 'icon-opacity': 1 } });
      // EHPAD (FINESS) : anneau clair sans remplissage, taille = places installées ; au zoom seulement (7 400 sites).
      m.addLayer({ id: 'mqh-ehpad', type: 'circle', source: 'mqh-ehpad', minzoom: 8, layout: { 'circle-sort-key': ['get', 'places'] },
        paint: { 'circle-radius': ['interpolate', ['linear'], ['get', 'places'], 20, 2.5, 100, 4, 300, 6.5], 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': EHPAD_HEX, 'circle-stroke-width': 1.6, 'circle-stroke-opacity': 0.95 } });
      m.addLayer({ id: 'mqh-ehpad-label', type: 'symbol', source: 'mqh-ehpad', minzoom: 11, layout: { 'text-field': ['get', 'name'], 'text-size': 9.5, 'text-font': ['Open Sans Semibold'],
        'text-variable-anchor': ['top', 'bottom', 'right', 'left'], 'text-radial-offset': 0.8, 'text-optional': true, 'text-max-width': 12 },
        paint: { 'text-color': EHPAD_HEX, 'text-halo-color': '#0a0a0f', 'text-halo-width': 1.3, 'text-opacity': 1 } });
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
    health: ['mqh-reg-line', 'mqh-reg-alert', 'mqh-reg-label', 'mqh-reg-fill', 'mqh-reg-tint', 'mqh-senti', 'mqh-ww', 'mqh-ww-label', 'mqh-water'],
    healthOscour: ['mqh-urg-fill', 'mqh-urg-line', 'mqh-urg-label'],
    healthApl: ['mqh-apl-fill', 'mqh-apl-line', 'mqh-apl-label'],
    hospitals: ['mqh-hosp', 'mqh-ehpad', 'mqh-ehpad-label'],
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
    'mqh-ww': [['circle-opacity', 'circle-stroke-opacity'], () => 0.6],
    'mqh-ww-label': ['text-opacity', () => 1],
    'mqh-water': ['icon-opacity', () => 1],
    'mqh-hosp': [['icon-opacity', 'text-opacity'], () => 1],
    'mqh-ehpad': [['circle-stroke-opacity'], () => 0.95],
    'mqh-ehpad-label': ['text-opacity', () => 1],
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
    // Sans pastille : seulement les restrictions de consommation (générales ou pour les publics sensibles) ; tout le reste avec la pastille.
    F('mqh-water', pill('health') ? null : ['in', ['get', 'v'], ['literal', ['restriction', 'ciblee']]]);
    F('mqh-ww-label', pill('health') ? null : ['in', ['get', 'level'], ['literal', ['jaune', 'orange', 'rouge']]]);
    // Hôpitaux : avec la pastille, noms dès le zoom 6,5.
    L('mqh-hosp', 'text-field', ['step', ['zoom'], ['get', 'city'], pill('hospitals') ? 6.5 : 8, ['get', 'name']]);
    const k = pill('hospitals') ? 1.35 : 1;
    try { if (m.getLayer('mqh-ehpad') && m.getLayer('mqh-ehpad').minzoom !== (pill('hospitals') ? 6.5 : 8)) m.setLayerZoomRange('mqh-ehpad', pill('hospitals') ? 6.5 : 8, 24); } catch (e) { /* calque absent */ }
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
  const median = (xs) => { const v = xs.filter(Number.isFinite).sort((p, q) => p - q); return v.length ? v[Math.floor(v.length / 2)] : null; };
  const vaccLine = (a) => { const g = a.vacc?.grip; if (g == null) return null;
    const all = [...S.depts.values()].filter((x) => x.vacc?.grip != null).sort((x, y) => x.vacc.grip - y.vacc.grip); const i = all.findIndex((x) => x.code === a.code);
    return `grippe ${num(g, 1)}${NB}% (médiane des départements ${num(median(all.map((x) => x.vacc.grip)), 1)}${NB}%, ${nth(i + 1)} plus faible sur ${all.length})${a.vacc.covid != null ? ` ; COVID-19 ${num(a.vacc.covid, 1)}${NB}%` : ''}`; };
  const historyLine = (a) => { const parts = [];
    for (const [k, o] of Object.entries(a.arbo ?? {})) if (o.autoch || o.imp) parts.push(`${k.toLowerCase()} : ${o.autoch ? `${num(o.autoch)}${NB}cas autochtone${o.autoch > 1 ? 's' : ''} (${[...o.months].sort().map((m) => m.slice(5)).join(', ').replace(/(\d\d)/g, (x) => ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'][Number(x) - 1])}), ` : ''}${num(o.imp)}${NB}importé${o.imp > 1 ? 's' : ''}`);
    if (a.legio?.n != null) parts.push(`légionellose : ${num(a.legio.n)}${NB}cas (${num(a.legio.taux, 1)} pour 100${NB}000)`);
    return parts.length ? parts.join(' ; ') : null; };
  const rel = (x) => (x == null ? 'n.d.' : `${x >= 0 ? '+' : '−'}${num(Math.abs(x), 1)}${NB}%`);
  const heatLine = (a) => { const h = a.heat; if (!h) return null; const ys = Object.keys(h.days).sort(); if (!ys.length) return null;
    const last = ys.at(-1), prev = ys.slice(-6, -1).map((y) => h.days[y]).filter(Number.isFinite);
    const mean = prev.length ? prev.reduce((t, v) => t + v, 0) / prev.length : null;
    const dd = h.deaths[last] ?? {}; const all = dd['Tous Ages'], old = dd['Plus de 75 ans'];
    return `${num(h.days[last])}${NB}jour${h.days[last] > 1 ? 's' : ''} de canicule à l’été ${last}${mean != null ? ` (moyenne des ${prev.length} étés précédents : ${num(mean, 1)})` : ''}`
      + (all ? ` ; excès de décès pendant les vagues de chaleur : ${num(all.exces)} (${rel(all.exces_relatif)})${old ? `, dont ${num(old.exces)} chez les plus de 75 ans (${rel(old.exces_relatif)})` : ''}` : ''); };
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
    if (vaccLine(a)) rows.push([`Vaccination des 65 ans et plus (${S.vaccYear})`, vaccLine(a)]);
    if (historyLine(a)) rows.push([`Antécédents ${S.arboYear}`, historyLine(a)]);
    if (heatLine(a) && [5, 6, 7, 8].includes(new Date().getMonth())) rows.push(['Canicule', heatLine(a)]);
    if (S.water.get(a.code)) { const w = S.water.get(a.code); const r = w.communes.filter((x) => x.v === 'restriction').length;
      rows.push(['Eau du robinet', `${w.communes.length}${NB}commune${w.communes.length > 1 ? 's' : ''} non conforme${w.communes.length > 1 ? 's' : ''}${r ? `, dont ${r} avec restriction de consommation` : ''} (au ${day(w.last)})`]); }
    rows.push(['Capacité', reaLine(a)]);
    if (ehpadLine(a)) rows.push(['Personnes âgées dépendantes', ehpadLine(a)]);
    if (a.apl?.pop) rows.push(['Population', `${num(a.apl.pop)} hab.${passPer(a) != null ? ` · ${num(passPer(a))} passages aux urgences pour 1${NB}000 hab. par an` : ''}`]);
    return { gauges, dot: mode === 'apl' ? aplHex(a.aplR) : (L1[a.urg] ?? MUTE), title: `${a.nom} (${a.code})`, state: mode === 'apl' ? `Accès aux soins : ${a.aplR == null ? 'n.d.' : `${num(a.aplR, 2)}${NB}fois la moyenne nationale`}` : state,
      stateHex: mode === 'apl' ? '#93c5fd' : stateHex, rows,
      hint: `Ce qu’on ne sait pas : ${mode === 'apl' ? 'accès réel du jour (délais de rendez-vous) non publié' : 'petites parts = signal fragile ; saturation du jour non publiée'} · clic : fiche`,
      source: `${mode === 'apl' ? `${aplSrc()} · ${synSrc()}` : `${synSrc()} · ${aplSrc()}`}${vaccLine(a) || historyLine(a) ? ' · Santé publique France (couverture vaccinale, déclarations obligatoires)' : ''}${S.water.get(a.code) ? ' · Hub’Eau' : ''}` };
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
  const ehpadLine = (a) => { const xs = a.ehpad ?? []; if (!xs.length) return null; const pl = xs.reduce((t, e) => t + (e.places ?? 0), 0);
    const per = a.apl?.pop ? (pl / a.apl.pop) * 1000 : null;
    const all = [...S.depts.values()].filter((x) => x.apl?.pop && x.ehpad?.length).map((x) => [x.code, x.ehpad.reduce((t, e) => t + (e.places ?? 0), 0) / x.apl.pop * 1000]).sort((p, q) => p[1] - q[1]);
    const i = all.findIndex(([c]) => c === a.code);
    return `${num(xs.length)}${NB}EHPAD, ${num(pl)}${NB}places${per != null ? ` (${num(per, 1)} pour 1${NB}000 hab., ${nth(i + 1)} plus faible sur ${all.length})` : ''}`; };
  const ehpadCard = (e) => {
    const near = (S.data.hosp?.sites ?? []).map((h) => ({ h, d: km([e.lon, e.lat], [h.lon, h.lat]) })).sort((p, q) => p.d - q.d)[0];
    const a = S.depts.get(e.dept);
    return { dot: EHPAD_HEX, title: nice(e.name), state: `EHPAD · ${commune(e.commune)} (${e.dept})`, stateHex: INK,
      rows: [['Places installées', e.places == null ? 'n.d.' : `${num(e.places)} dont ${num(e.permanent ?? 0)} en hébergement permanent${e.dayCare ? `, ${num(e.dayCare)} en accueil de jour` : ''}`],
        ['Urgences les plus proches', near ? `${nice(near.h.name)}, ${num(near.d, near.d < 10 ? 1 : 0)}${NB}km à vol d’oiseau` : 'n.d.'],
        ['Département', a ? `${ehpadLine(a)} ; ${urgState(a)[0].charAt(0).toLowerCase()}${urgState(a)[0].slice(1)}` : 'n.d.']],
      hint: 'Ce qu’on ne sait pas : occupation, foyers épidémiques et canicule dans l’établissement (non publiés)', source: `FINESS du ${day(S.data.ehpad?.finessDate)}, équipements sociaux et médico-sociaux` };
  };
  const stationCard = (x) => {
    const rl = x.m.region ?? null;
    const spk = x.ser.slice(-26);
    return { dot: SENTI_HEX, title: `Eaux usées · ${x.m.nom.replace(/^STEU DE: /, '')}`, state: x.level === 'nd' ? 'Tendance non calculable' : x.level === 'vert' ? 'Pas de hausse (mesuré)' : `${WORD[x.level]} · SARS-CoV-2 en hausse`, stateHex: x.level === 'nd' ? MUTE : L1[x.level],
      rows: [['Commune', `${commune(x.m.commune)}, ${num(x.m.population)}${NB}habitants raccordés`],
        ['Dernière mesure', x.last ? `${num(x.last.v)} (${wk(x.last.w)}), indicateur de concentration virale` : 'n.d.'],
        ['Sur 2 semaines', x.two ? `${num(x.two)} → ${num(x.last.v)} (${signed(x.last.v / x.two - 1)})` : 'n.d.'],
        ['Même semaine l’an dernier', x.ly ? `${num(x.ly)} (${signed(x.last.v / x.ly - 1)})` : 'n.d.'],
        ['26 dernières semaines', spk.length ? `min ${num(Math.min(...spk.map((y) => y.v)))}, max ${num(Math.max(...spk.map((y) => y.v)))}` : 'n.d.']],
      hint: 'Ce qu’on ne sait pas : SARS-CoV-2 seulement (pas la grippe ni le VRS) ; précède les urgences de quelques jours, sans dire qui est malade', source: `Santé publique France, SUM’Eau, ${x.last ? wk(x.last.w) : 'n.d.'}` };
  };
  const W_WORD = { restriction: 'Restriction de consommation annoncée', ciblee: 'Consommation déconseillée aux publics sensibles', bact: 'Non conforme en bactériologie', pc: 'Limite physico-chimique dépassée, eau consommable ou non précisé' };
  const V_WORD = { restriction: 'restriction', 'restriction ciblée': 'déconseillée aux publics sensibles', consommable: 'consommable selon l’ARS', 'non précisé': 'consommation non précisée' };
  const waterSrc = () => `Ministère de la Santé, contrôle sanitaire (Hub’Eau), prélèvements du ${day(S.data.water?.from)} au ${day(S.data.water?.to)}`;
  const waterCard = (c) => {
    const a = S.depts.get(c.dept), w = S.water.get(c.dept);
    const sm = c.samples[0];
    return { dot: c.v === 'restriction' ? L1.orange : L1.jaune, title: `Eau du robinet · ${commune(c.nom)} (${c.dept})`, state: W_WORD[c.v], stateHex: c.v === 'restriction' ? L1.orange : L1.jaune,
      rows: [['Dernier prélèvement non conforme', `${day(sm.date)} · ${sm.kinds.map((k) => (k === 'bact' ? 'bactériologie' : 'physico-chimie')).join(' et ')} · ${V_WORD[sm.verdict]}`],
        ['Paramètres dépassés', sm.exceed.length ? sm.exceed.map((x) => `${x.p} ${x.v} (limite ${x.lim.replace('<=', '≤ ')})`).join(' ; ') : 'n.d.'],
        ['Réseau', [sm.network, sm.distributor].filter(Boolean).join(' · ') || 'n.d.'],
        ...(c.samples.length > 1 ? [['Sur la période', `${c.samples.length}${NB}prélèvements non conformes`]] : []),
        ['Département', w ? `${w.communes.length}${NB}communes concernées, dont ${w.communes.filter((x) => x.v === 'restriction').length} avec restriction` : 'n.d.'],
        ['Conclusion de l’ARS', sm.conclusion.length > 220 ? `${sm.conclusion.slice(0, 220)}…` : sm.conclusion || 'n.d.']],
      hint: 'Ce qu’on ne sait pas : levée éventuelle depuis (publication mensuelle, décalée d’environ six semaines)', source: waterSrc() };
  };
  const deptAt = (c) => { for (const f of S.geo.deptShapes) if (inGeom(c, f.geometry)) return S.depts.get(f.properties.code); return null; };
  // Arbitre : une seule cible ; hôpital > département ; la région répond seulement avec sa pastille ; un calque estompé ne répond jamais.
  const pick = (point) => {
    const act = new Set(S.focus); if (preview) act.add(preview);
    const live = (id) => !act.size || !Object.values(GROUPS).some((ls) => ls.includes(id)) || Object.entries(GROUPS).some(([g, ls]) => act.has(g) && ls.includes(id));
    const order = ['mqh-water', 'mqh-ww', 'mqh-hosp', 'mqh-ehpad', ...(pill('health') && !pill('healthOscour') && !pill('healthApl') ? ['mqh-reg-fill'] : []), 'mqh-dept-fill'];
    const layers = order.filter((id) => S.m.getLayer(id) && (id === 'mqh-reg-fill' || live(id)));
    const hits = S.m.queryRenderedFeatures(point, { layers });
    if (!hits.length) return null;
    hits.sort((a, b) => order.indexOf(a.layer.id) - order.indexOf(b.layer.id));
    const f = hits[0], p = f.properties, id = f.layer.id;
    if (id === 'mqh-hosp') { const g = S.hGroups[p.i]; return g && { key: `h:${p.i}`, kind: 'hosp', id: p.i, make: () => hospCard(g), at: [g[0].lon, g[0].lat] }; }
    if (id === 'mqh-ehpad') { const e = S.data.ehpad?.sites?.[p.i]; return e && { key: `eh:${p.i}`, kind: 'raw', id: p.i, make: () => ehpadCard(e), at: [e.lon, e.lat] }; }
    if (id === 'mqh-ww') { const x = S.stations[p.i]; return x && { key: `ww:${p.i}`, kind: 'raw', id: p.i, make: () => stationCard(x), at: x.at }; }
    if (id === 'mqh-water') { const c = S.data.water?.communes?.[p.i]; return c && { key: `wa:${c.code}`, kind: 'raw', id: c.code, make: () => waterCard(c), at: [c.lon, c.lat] }; }
    if (id === 'mqh-reg-fill') { const r = S.regions.get(p.code); return r && { key: `r:${r.code}`, kind: 'region', id: r.code, make: () => regionCard(r), at: null }; }
    if (id === 'mqh-dept-fill') { const a = S.depts.get(p.code); const mode = pill('healthApl') && !pill('healthOscour') ? 'apl' : 'urg';
      return a && { key: `d:${a.code}:${mode}`, kind: 'dept', id: a.code, make: () => deptCard(a, mode), at: null }; }
    return null;
  };
  let hovered = null;
  // Survol : état du département (instantané), jamais un changement de filtre qui ferait retraiter toute la source.
  const setHover = (code) => { if (code === hovered) return;
    if (hovered) S.m.setFeatureState({ source: 'mqh-depts', id: hovered }, { hover: false });
    if (code) S.m.setFeatureState({ source: 'mqh-depts', id: code }, { hover: true });
    hovered = code; };
  // Un seul calcul par image, quel que soit le nombre d'événements de souris.
  let moveRaf = 0, moveEv = null;
  const onMove = (e) => { moveEv = e; if (!moveRaf) moveRaf = requestAnimationFrame(() => { moveRaf = 0; doMove(moveEv); }); };
  const doMove = (e) => {
    if (!isHealth()) return;
    const hit = pick(e.point);
    const canvas = S.m.getCanvas();
    if (!hit) { pop.style.display = 'none'; popAt = null; S.hoverKey = null; setHover(null); canvas.style.cursor = ''; return; }
    canvas.style.cursor = 'pointer';
    setHover(hit.kind === 'dept' ? hit.id : null);
    popAt = hit.at ?? [e.lngLat.lng, e.lngLat.lat];
    if (S.hoverKey !== hit.key) { pop.innerHTML = card(hit.make()); S.hoverKey = hit.key; }
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
    rows.push(['FINESS (EHPAD et places)', d.ehpad?.finessDate ? `extraction du ${day(d.ehpad.finessDate)}, semestrielle` : 'indisponible', d.ehpad?.finessDate ? 'ok' : 'ko']);
    rows.push(['ANSM (médicaments)', d.drugs?.latestUpdate ? `mis à jour le ${day(d.drugs.latestUpdate)}` : 'indisponible', d.drugs?.latestUpdate ? 'ok' : 'ko']);
    rows.push(['RappelConso', d.recalls?.since ? `depuis le ${day(d.recalls.since)}` : 'indisponible', d.recalls?.since ? 'ok' : 'ko']);
    rows.push(['Odissé par département (11 syndromes, âges)', Object.values(d.extraSyn ?? {}).some(Array.isArray) ? `lu ${when(new Date().toISOString())}, semaine ${wk(d.syn?.week?.id)}` : 'indisponible', Object.values(d.extraSyn ?? {}).every(Array.isArray) ? 'ok' : 'part']);
    rows.push(['Eaux usées par station (SUM’Eau)', d.wwSt?.results?.length ? `${num(S.stations?.filter((x) => x.last).length ?? 0)} stations, dernière semaine ${wk(d.wwSt.results[0]?.semaine)}` : 'indisponible', d.wwSt?.results?.length ? 'ok' : 'ko']);
    rows.push(['Déclarations obligatoires (arboviroses, légionellose)', Array.isArray(d.arbo) ? `arboviroses jusqu’à ${S.arboLast || 'n.d.'}, légionellose ${S.legioYear || 'n.d.'}, consolidées une fois par an` : 'indisponible', Array.isArray(d.arbo) ? 'part' : 'ko']);
    rows.push(['Canicule (jours, excès de décès)', Array.isArray(d.heatDays) && d.heatDays.length ? `étés jusqu’à ${d.heatDays.reduce((m, r) => (r.annee > m ? r.annee : m), '')}, bilan annuel` : 'indisponible', Array.isArray(d.heatDays) && d.heatDays.length ? 'ok' : 'ko']);
    rows.push(['Couverture vaccinale (65 ans et plus)', S.vaccYear ? `campagne ${S.vaccYear}, annuelle` : 'indisponible', S.vaccYear ? 'ok' : 'ko']);
    rows.push(['Eau du robinet (Hub’Eau)', d.water?.to ? `prélèvements du ${day(d.water.from)} au ${day(d.water.to)}, mensuel, décalé d’environ six semaines` : 'indisponible', d.water?.to ? (ageDays(d.water.to) > 75 ? 'part' : 'ok') : 'ko']);
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
  const seasonChart = (k, ptsIn, scope = 'France') => {
    const pts = (ptsIn ?? (S.data.syn?.syndromes ?? []).find((x) => x.key === k)?.france ?? []).filter((p) => p.er != null);
    if (!pts.length) return '';
    const last = pts.reduce((a, b) => (a.week > b.week ? a : b)); const cur = seasonOf(last.week);
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
    return `<div class="mqh-chart"><div class="mqh-chart-t">${esc(scope)}, ${esc(k === 'ira' ? 'IRA' : SYN[k].toLowerCase())} aux urgences : saison ${cur.s}-${String(cur.s + 1).slice(2)} (blanc) et 3${NB}saisons précédentes (gris)</div>`
      + `<svg viewBox="0 0 ${w} ${h}" class="mqh-chart-svg">${ticks}${lines}${now}<circle cx="${X(cur.i)}" cy="${Y(last.er)}" r="3" fill="#fff"/></svg>`
      + `<div class="mqh-chart-c">${esc(`Cette semaine (${wk(last.week)}) : ${pct(last.er)} ; même semaine : ${sameWeek.join(', ') || 'n.d.'}.`)}<br>${esc(`Pics des saisons précédentes : ${peaks.join(' ; ') || 'n.d.'}.`)}</div></div>`;
  };
  // Classes d'âge (France, IRA seulement dans le flux) : part aux urgences, hospitalisations après passage, SOS Médecins, évolution sur 4 semaines.
  const AGE_HEX = { '0 an': '#f9a8d4', '00-04 ans': '#f9a8d4', '05-14 ans': '#fde68a', '15-64 ans': '#93c5fd', '65 ans ou plus': '#c4b5fd' };
  const agesChart = (k = 'ira', agesIn, scope = 'France') => {
    const ages = agesIn ?? (S.data.syn?.syndromes ?? []).find((x) => x.key === k)?.ages ?? {};
    const keys = Object.keys(ages).filter((a) => ages[a]?.length);
    if (!keys.length) return '';
    const w = 320, h = 90, pl = 30, max = Math.max(...keys.flatMap((a) => ages[a].map((p) => p.er ?? 0)), 0.01) * 1.1;
    const n = Math.max(...keys.map((a) => ages[a].length));
    const X = (i) => pl + (i / Math.max(1, n - 1)) * (w - pl - 4), Y = (v) => h - 6 - (v / max) * (h - 12);
    const svg = keys.map((a) => { const xs = [...ages[a]].sort((p, q) => p.week.localeCompare(q.week));
      return `<polyline points="${xs.map((p, i) => `${X(i).toFixed(1)},${Y(p.er ?? 0).toFixed(1)}`).join(' ')}" fill="none" stroke="${AGE_HEX[a] ?? INK}" stroke-width="1.8"/>`; }).join('')
      + [0, max / 2].map((v) => `<text x="0" y="${Y(v) + 3}" fill="#6e6e80" font-size="9">${num(v, 1)}${NB}%</text><line x1="${pl}" x2="${w}" y1="${Y(v)}" y2="${Y(v)}" stroke="#262a33"/>`).join('');
    const rows = keys.map((a) => { const xs = [...ages[a]].sort((p, q) => p.week.localeCompare(q.week)); const l = xs.at(-1), b = xs.at(-5);
      return `<tr><td><i class="mqh-age" style="background:${AGE_HEX[a] ?? INK}"></i>${esc(a.replace(/0(\d)/g, '$1').replace('-', ' à '))}</td><td>${esc(pct(l.er))}</td><td>${esc(pct(l.hosp))}</td><td>${esc(pct(l.sos))}</td><td>${esc(b?.er ? signed(l.er / b.er - 1) : 'n.d.')}</td></tr>`; }).join('');
    const first = [...ages[keys[0]]].sort((p, q) => p.week.localeCompare(q.week));
    return `<div class="mqh-chart"><div class="mqh-chart-t">${esc(scope)}, ${esc(k === 'ira' ? 'IRA' : SYN[k].toLowerCase())} par classe d’âge, ${wk(first[0].week)} à ${wk(first.at(-1).week)} (part des passages aux urgences)</div>`
      + `<svg viewBox="0 0 ${w} ${h}" class="mqh-chart-svg">${svg}</svg>`
      + `<table class="mqh-ages"><tr><th></th><th>Urgences</th><th>Hospit.</th><th>SOS</th><th>4${NB}sem.</th></tr>${rows}</table>`
      + `<div class="mqh-chart-c">Hospit. = part des passages suivis d’une hospitalisation pour ce syndrome ; SOS = part des actes SOS Médecins. </div></div>`;
  };
  const franceSeries = (k, n = 12) => (S.data.syn?.syndromes ?? []).find((s) => s.key === k)?.france?.filter((p) => p.er != null).sort((a, b) => a.start.localeCompare(b.start)).slice(-n).map((p) => ({ v: p.er, w: p.week })) ?? [];
  // Historique du département (Odissé) : chargé à l'ouverture de la fiche, gardé en mémoire.
  S.deptHist = new Map();
  const loadDeptHist = (code, k) => {
    const key = `${code}|${k}`; if (S.deptHist.has(key)) return;
    S.deptHist.set(key, 'loading');
    odExport(k, `dep="${code}"`).then((rows) => { S.deptHist.set(key, Array.isArray(rows) ? rows : 'error'); if (S.fiche?.kind === 'dept' && S.fiche.key === code) openFiche('dept', code, true); });
  };
  const histOf = (code, k) => { const h = S.deptHist.get(`${code}|${k}`); return Array.isArray(h) ? h : null; };
  const deptCharts = (a, k) => {
    const out = [];
    for (const key of [...new Set([k, 'ira'])]) {
      const h = histOf(a.code, key); loadDeptHist(a.code, key);
      if (!h) { out.push(`<div class="mqh-chart-c">${S.deptHist.get(`${a.code}|${key}`) === 'error' ? `Historique du département indisponible (${esc(SYN[key])}).` : `Chargement de l’historique du département (${esc(SYN[key])})…`}</div>`); continue; }
      const allAges = h.filter((r) => r.age === 'Tous âges' || (key === 'bronchio' && r.age === '0 an')).map((r) => ({ week: r.semaine, er: r.er, hosp: r.hosp, sos: r.sos }));
      // Petits effectifs : moyenne mobile sur 3 semaines (la valeur de la semaine reste celle publiée dans la bulle).
      const sm = allAges.sort((p, q) => p.week.localeCompare(q.week)).map((p, i, arr) => { const w3 = arr.slice(Math.max(0, i - 2), i + 1).map((x) => x.er).filter((v) => v != null); return { ...p, er: w3.length ? w3.reduce((t, v) => t + v, 0) / w3.length : null }; });
      out.push(seasonChart(key, sm, `${a.nom} (moyenne sur 3${NB}semaines)`));
      if (key !== 'bronchio') {
        const ages = {}; const weeks = [...new Set(h.map((r) => r.semaine))].sort().slice(-14);
        for (const r of h) if (weeks.includes(r.semaine) && ['00-04 ans', '05-14 ans', '15-64 ans', '65 ans ou plus'].includes(r.age)) (ages[r.age] ??= []).push({ week: r.semaine, er: r.er, hosp: r.hosp, sos: r.sos });
        out.push(agesChart(key, ages, a.nom));
      }
    }
    return out.join('');
  };
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
    const unknown = [
      'Une part faible (moins de 1 % des passages) donne un écart fragile : à confirmer la semaine suivante.',
      'Attente aux urgences, saturation et fermetures de lignes de garde : non publiées en données ouvertes.',
      ...(a.syn[k]?.sos == null ? ['SOS Médecins : pas d’association couverte dans le département.'] : [])];
    const bad = neighbours(a).filter((x) => x.driver);
    const bluf = [`${a.driver ? `${SYN[a.driver]} aux urgences ${signed(a.syn[a.driver].ratio - 1)} au-dessus du maximum des 3${NB}saisons (${WORD[a.urg].toLowerCase()}, ${synRank(a, a.driver)})` : 'Urgences dans les normales des saisons précédentes'}${bad.length ? ` ; ${bad.length}${NB}département${bad.length > 1 ? 's' : ''} voisin${bad.length > 1 ? 's' : ''} aussi en anomalie` : ''}.`,
      `Capacité : ${reaLine(a)} ; accès aux généralistes ${a.apl?.apl?.mg != null ? `${num(a.apl.apl.mg / S.data.apl.france.apl.mg, 2)}${NB}fois la moyenne` : 'n.d.'}.`];
    happen.push(`Départements voisins : ${neighLine(a)}.`);
    // Capacités : hôpitaux, personnes âgées, accès aux soins, vaccination.
    const hospB = [`Hôpitaux : ${hospLine(a)}.`, `Capacité : ${reaLine(a)}.`,
      ...(a.apl?.pop ? [`Population : ${num(a.apl.pop)} habitants${passPer(a) != null ? ` ; ${num(passPer(a))} passages aux urgences pour 1${NB}000 habitants par an` : ''}.`] : [])];
    const oldB = [ehpadLine(a) ? `${ehpadLine(a)}.` : 'Aucun EHPAD recensé dans le FINESS.', ...(vaccLine(a) ? [`Vaccination des 65 ans et plus (${S.vaccYear}) : ${vaccLine(a)}.`] : [])];
    const aplB = impact.filter((x) => /^Accès aux soins|population sous 2,5/.test(x)).map((x) => x.replace(/^Accès aux soins : g/, 'G'));
    // Environnement : eau du robinet, eaux usées, canicule, antécédents.
    const wa = S.water.get(a.code);
    const waterB = [];
    let envLevel = null;
    if (wa) { const byV = (v) => wa.communes.filter((c) => c.v === v).map((c) => commune(c.nom));
      if (byV('restriction').length) { waterB.push(`Restriction de consommation annoncée : ${byV('restriction').join(', ')}.`); envLevel = 'orange'; }
      if (byV('ciblee').length) { waterB.push(`Déconseillée aux publics sensibles : ${byV('ciblee').join(', ')}.`); envLevel ??= 'jaune'; }
      if (byV('bact').length) { waterB.push(`Non conforme en bactériologie : ${byV('bact').join(', ')}.`); envLevel ??= 'jaune'; }
      if (byV('pc').length) waterB.push(`Limites physico-chimiques dépassées, eau consommable ou non précisé : ${byV('pc').join(', ')}.`);
      waterB.push(`Prélèvements du ${day(S.data.water?.from)} au ${day(S.data.water?.to)} (publication mensuelle).`); }
    else waterB.push(`Aucun prélèvement non conforme du ${day(S.data.water?.from)} au ${day(S.data.water?.to)}.`);
    const st = S.stations.filter((x) => x.at && deptAt(x.at)?.code === a.code);
    const wwB = st.length ? st.map((x) => { if (RANK[x.level] >= 1) envLevel ??= 'jaune';
      return `${commune(x.m.commune)} (${num(x.m.population)} hab. raccordés) : ${x.last ? `${num(x.last.v)} en ${wk(x.last.w)}${x.two ? `, ${signed(x.last.v / x.two - 1)} sur 2 semaines` : ''}${x.ly ? `, ${signed(x.last.v / x.ly - 1)} sur un an` : ''}` : 'n.d.'}${RANK[x.level] >= 1 ? ' : en hausse' : ''}.`; })
      : ['Aucune station SUM’Eau dans le département.'];
    const heatB = heatLine(a) ? [`${heatLine(a)}.`, ...(ehpadLine(a) ? [`Population à protéger en été : ${ehpadLine(a)}.`] : [])] : ['n.d.'];
    const histB = historyLine(a) ? [`${historyLine(a)}.`] : ['Aucun cas déclaré.'];
    return { title: `${a.nom} (${a.code})`, sub: 'Santé · note de situation', level: RANK[a.urg] >= 1 ? a.urg : null, at: when(new Date().toISOString()),
      gauges: Object.keys(SYN).filter((k) => a.syn[k]).map((k) => synGauge(k, a.syn[k])),
      tabLevel: { Situation: RANK[a.urg] >= 1 ? a.urg : null, Environnement: envLevel },
      blocks: [['À retenir', bluf, 'Situation'], ['Ce qui se passe', happen, 'Situation'],
        ['Hôpitaux et réanimation', hospB, 'Capacités'], ['Personnes âgées', oldB, 'Capacités'], ['Accès aux soins', aplB, 'Capacités'],
        ['Eau du robinet', waterB, 'Environnement'], ['Eaux usées (SARS-CoV-2)', wwB, 'Environnement'], ['Canicule', heatB, 'Environnement'], [`Antécédents ${S.arboYear} (arboviroses, légionellose)`, histB, 'Environnement'],
        ['Évolution', evo, 'Évolution'], ['Ce qu’on ne sait pas', unknown, 'Sources']],
      charts: deptCharts(a, k),
      sources: ['OSCOUR', 'Odissé', 'DREES', 'Eau du robinet', 'Eaux usées', 'Déclarations', 'Couverture', 'FINESS', 'Canicule'] };
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
    // Onglets : chaque bloc porte le sien ; « Sources » regroupe ce qu'on ne sait pas et la table des sources.
    const tabs = n.blocks.some((b) => b[2]) ? [...new Set([...n.blocks.map((b) => b[2]).filter(Boolean), 'Sources'])] : null;
    if (tabs && !tabs.includes(S.ficheTab)) S.ficheTab = tabs[0];
    const shown = (tab) => !tabs || tab === S.ficheTab;
    panel.innerHTML = `<header><div><h3>${esc(n.title)}</h3><div class="mqh-sub">${lvl}${esc(n.sub)}</div><div class="mqh-at">Situation au ${n.at}</div></div>`
      + `<button class="mqh-x" aria-label="Fermer">×</button></header>`
      + (tabs ? `<nav class="mqh-tabs">${tabs.map((t) => `<button data-tab="${esc(t)}" aria-pressed="${t === S.ficheTab}">${n.tabLevel?.[t] ? `<i style="background:${L1[n.tabLevel[t]]}"></i>` : ''}${esc(t)}</button>`).join('')}</nav>` : '')
      + n.blocks.filter((b) => shown(b[2] ?? null)).map(([h, xs]) => sec(h, (h === 'Ce qui se passe' && n.gauges ? `<div class="mqh-gs">${n.gauges.map(gauge).join('')}</div><div class="mqh-g-cap">Barre = part des passages de la semaine ; trait blanc = maximum des 3${NB}saisons précédentes.</div>` : '') + li(xs.map(esc)) + (h === 'Évolution' && n.charts ? n.charts : ''))).join('')
      + (!shown('Sources') ? '' : sec('Sources et confiance', `<table>${sourcesOf(n).map(([k, v, st]) => `<tr><td><i class="mqh-src-${st}"></i>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>`
        + (n.link ? `<p><a href="${esc(n.link)}" target="_blank" rel="noopener">Fiche FINESS de l’établissement</a></p>` : '')))
      + `<footer><button class="mqh-copy">Copier pour la note</button><span class="mqh-copied"></span></footer>`;
    panel.style.display = 'flex';
    if (legend.dataset.open === 'true') { legend.dataset.open = 'false'; renderLegend(); }
    panel.querySelector('.mqh-x').onclick = closeFiche;
    panel.querySelectorAll('.mqh-tabs button').forEach((b) => { b.onclick = () => { S.ficheTab = b.dataset.tab; openFiche(kind, key, true); panel.scrollTop = 0; }; });
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
    const arb = [...S.depts.values()].filter((a) => Object.values(a.arbo ?? {}).some((o) => o.autoch));
    if (arb.length) items.push([null, `Arboviroses ${S.arboYear} : ${num(arb.reduce((t, a) => t + Object.values(a.arbo).reduce((u, o) => u + o.autoch, 0), 0))}${NB}cas autochtones dans ${arb.length}${NB}départements (${arb.sort((x, y) => Object.values(y.arbo).reduce((u, o) => u + o.autoch, 0) - Object.values(x.arbo).reduce((u, o) => u + o.autoch, 0)).slice(0, 3).map((a) => a.nom).join(', ')}…), données jusqu’à ${S.arboLast.slice(5)}/${S.arboYear}`]);
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
      <div class="mqh-row">${it(swatch(EHPAD_HEX, 'ring'), 'EHPAD, taille = places (au zoom, plus tôt avec la pastille Hôpitaux)')}</div>
      <div class="mqh-row mqh-note">Sites avec urgences ; taille = passages ${S.data.hosp?.vintage ?? ''} ; nom des villes de CHU, nom des sites au zoom.</div>
      <div class="mqh-row mqh-note">Accès aux soins, ${PROF[S.prof].toLowerCase()} (DREES, annuel, jamais une alerte), par rapport à la moyenne nationale :</div>
      <div class="mqh-ramp">${[...APL_RAMP].reverse().map(([, c, w]) => it(swatch(c, 'sq'), w)).join('')}</div>
      <div class="mqh-row">${it(swatch(REG_LINE, 'dash'), 'Limite de région')}</div>
      <div class="mqh-row">${it(`<svg width="13" height="13" viewBox="0 0 40 40"><circle cx="20" cy="20" r="15" fill="${SENTI_HEX}" fill-opacity=".55" stroke="${L1.jaune}" stroke-width="5"/></svg>`, 'Eaux usées (SARS-CoV-2), taille = population raccordée, bord coloré si hausse')}</div>
      <div class="mqh-row">Eau du robinet : ${it(`<svg width="12" height="13" viewBox="0 0 40 40"><path d="M20 4 C20 4 8 18 8 25 a12 12 0 0 0 24 0 C32 18 20 4 20 4 Z" fill="${L1.orange}" stroke="none" stroke-width="4"/></svg>`, 'restriction de consommation')}${it(`<svg width="12" height="13" viewBox="0 0 40 40"><path d="M20 4 C20 4 8 18 8 25 a12 12 0 0 0 24 0 C32 18 20 4 20 4 Z" fill="${L1.jaune}" stroke="none" stroke-width="4"/></svg>`, 'publics sensibles ou bactériologie (sans pastille : restrictions seulement)')}${it(`<svg width="12" height="13" viewBox="0 0 40 40"><path d="M20 4 C20 4 8 18 8 25 a12 12 0 0 0 24 0 C32 18 20 4 20 4 Z" fill="none" stroke="${L1.jaune}" stroke-width="4"/></svg>`, 'physico-chimie, consommable (avec la pastille)')}</div>
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
  .mqh-sw-ring { width: 11px; height: 11px; border-radius: 50%; border: 2px solid var(--c); background: transparent; }
  .mqh-sw-line { width: 22px; height: 0; border-top: 3px solid var(--c); } .mqh-sw-dash { width: 22px; height: 0; border-top: 3px dashed var(--c); }
  .mqh-ic { display: inline-flex; width: 18px; height: 18px; border-radius: 50%; background: #161a22; border: 1.5px solid #8a93a6; align-items: center; justify-content: center; }
  .mqh-ic svg { width: 11px; height: 11px; }
  .mqh-note { color: #9898a8; font-size: 11px; }
  .mqh-gs { display: flex; flex-direction: column; gap: 5px; margin: 6px 0 4px; }
  .mqh-g-h { display: flex; justify-content: space-between; gap: 8px; font-size: 11.5px; color: #aab0bc; } .mqh-g-h b { font-weight: 600; white-space: nowrap; }
  .mqh-g-t { position: relative; height: 6px; border-radius: 3px; background: #262a33; margin-top: 2px; }
  .mqh-g-f { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 3px; } .mqh-g-m { position: absolute; top: -3px; bottom: -3px; width: 2px; margin-left: -1px; background: #ffffff; }
  .mqh-tabs { display: flex; gap: 4px; flex-wrap: wrap; border-bottom: 1px solid #23262e; padding-bottom: 6px; position: sticky; top: -14px; background: #12141a; z-index: 1; padding-top: 4px; }
  .mqh-tabs button { background: none; border: 1px solid transparent; color: #9aa1ae; border-radius: 6px; padding: 3px 8px; cursor: pointer; font-size: 11.5px; display: inline-flex; align-items: center; gap: 5px; }
  .mqh-tabs button[aria-pressed="true"] { background: #1f232c; color: #e8e8ec; border-color: #2f3440; } .mqh-tabs i { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
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
      // Lot 1 (18/10/2026) : sources ouvertes lues directement (CORS ouvert) ; en production, elles passeront par /api/health.
      const wkId = syn?.week?.id, yy = Number(String(wkId).slice(0, 4)), nn = String(wkId).slice(-3);
      const weeksWhere = [0, 1, 2, 3].map((i) => `semaine="${yy - i}-${nn}"`).join(' or ');

      const odAll = (ds, select, where) => getJson(`${OD}${ds}/exports/json?select=${encodeURIComponent(select)}${where ? `&where=${encodeURIComponent(where)}` : ''}`);
      const [heatDays, heatDeaths] = await Promise.all([
        odAll('canicules-nombres-de-jours-de-canicule-departement', 'dep,annee,nb_j_can', `annee>="${new Date().getFullYear() - 7}"`),
        odAll('canicules-exces-de-deces-pendant-les-vagues-de-chaleur-departement', 'dep,annee,classe_age,exces,exces_relatif', `annee>="${new Date().getFullYear() - 3}"`)]);
      const [arbo, vacc, legio] = await Promise.all([
        odAll('arboviroses-donnees-declaration-obligatoire', 'dep,mois,arbo,nbcas_imp,nbcas_autoch', `mois>="${new Date().getFullYear() - 1}-01"`),
        odAll('couvertures-vaccinales-des-adolescent-et-adultes-departement', 'dep,libgeo,an_mesure,grip_65plus,covid_65plus', `an_mesure>="${new Date().getFullYear() - 2}"`),
        odAll('legionellose-donnees-declaration-obligatoire', 'dep,annee,legio,taux', `annee>="${new Date().getFullYear() - 2}"`)]);
      const [extra, wwMeta, wwSt, water] = await Promise.all([
        Promise.all(EXTRA_SYN.map((k) => odExport(k, `sursaud_cl_age_gene="Tous âges" and (${weeksWhere})`))),
        getJson(`${OD}sumeau_stations/records?limit=100`),
        getJson(`${OD}sum-eau-indicateurs/records?limit=60&order_by=${encodeURIComponent('semaine desc')}`),
        getJson('/data/eau-potable.json')]);
      const ehpad = await getJson('/data/ehpad.json');
      S.data = { syn, alerts, senti, ww, drugs, recalls, dgs, apl, hosp, ehpad, extraSyn: Object.fromEntries(EXTRA_SYN.map((k, i) => [k, extra[i]])), wwMeta, wwSt, water, arbo, vacc, legio, heatDays, heatDeaths };
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
      const c = hit.make();
      if (c?.url) { window.open(c.url, '_blank', 'noopener'); return; }
      openFiche(hit.kind, hit.id);
    }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isHealth()) { closeFiche(); pop.style.display = 'none'; } });
    window.__mqh = S;
    S.openFiche = openFiche; // contrôle (Playwright) : ouvrir une fiche sans viser la carte
    console.log('[maquette-sante] prête', { anomalies: [...S.depts.values()].filter((a) => a.driver).length });
  };
  start();
})();
