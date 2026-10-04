// src/components/layer-panel/feux.test.ts
import { describe, expect, it } from 'vitest';
import type { FireObservationFeedState, FiresResponse, LocatedFireIncident } from '../../types/index.ts';
import { firesLevel } from '../../services/environment-levels.ts';
import { buildDossier } from '../../services/wildfire-dossier.ts';
import { ENV_FIXTURE_NOW, FIRES_FIXTURE, FIRE_IMPACTS_FIXTURE, RADAR_COLUMN_FIXTURE } from './environment.fixture.ts';
import { envBreakable, glueEnvUnits } from './environment-format.ts';
import { NBSP, breakableValue, visibleText } from './format.ts';
import { renderLayerView } from './frame.ts';
import { FEUX_TABS, FEUX_TITLE, buildFeuxView, mtgFrpState, type FeuxViewInput } from './feux.ts';

const NOW = ENV_FIXTURE_NOW;
const open = (_: string, d: boolean): boolean => d;
const OPTIONS: FeuxViewInput['options'] = { gibs: false, mtgFrp: false, echoTops: false, echoTopsAvailable: true, forestDangerFill: false };
const input = (over: Partial<FeuxViewInput> = {}): FeuxViewInput => ({
  fires: FIRES_FIXTURE(), firesError: null, mtgFrp: null, options: OPTIONS, plume: new Map(), tab: 'veille', majorIncidents: [], dossier: null,
  canFocus: true, now: NOW, open, ...over,
});
const view = (over: Partial<FeuxViewInput> = {}) => buildFeuxView(input(over));
const html = (over: Partial<FeuxViewInput> = {}): string => renderLayerView('fires', view(over));
const sectionOf = (id: string, over: Partial<FeuxViewInput> = {}) => view(over).sections.find((s) => s.id === id);
const fires = (edit: (f: FiresResponse) => void): FiresResponse => {
  const f = FIRES_FIXTURE();
  edit(f);
  return f;
};

/** Grand incident fictif construit pour l'onglet Dossier (aucun ne franchit la porte le 04/10) : au Porge (Gironde). */
const PORGE: LocatedFireIncident = {
  id: 'porge-1', centroidLat: 44.88, centroidLon: -1.12, bboxMinLat: 44.85, bboxMaxLat: 44.9, bboxMinLon: -1.15, bboxMaxLon: -1.05,
  detectionsCount: 48, frpMean: 6.2, frpMax: 21.4, frpTotal: 297.6 + 10, confidenceMax: 'nominal', startDatetime: '2026-10-04T01:20:00Z',
  endDatetime: '2026-10-04T03:00:00Z', durationMinutes: 100, satellites: ['Suomi NPP', 'NOAA-20'], hasNightDetection: true, nearUrban: false,
  clusterMethod: 'dbscan', epsKm: 3, minPoints: 2, score: { severityScore: 40, impactScore: 20, labels: [] }, detectionIds: [],
  deptCodes: ['33'], communes: ['Le Porge'],
};

describe('vue Feux de forêt (spec 2026-10-04 environnement § 2.4)', () => {
  it('en-tête du 04/10 : 10 départements en danger modéré aujourd’hui (jaune) ; pastille jaune (trois foyers confirmés de moins de 10 MW, arbitrage 14) ; sources datées', () => {
    const v = view();
    const reason = '3 foyers confirmés de moins de 10 MW en France ; danger modéré aujourd’hui : 10 départements';
    expect(firesLevel(FIRES_FIXTURE(), NOW)).toEqual({ level: 'jaune', reason });
    expect(v.head).toMatchObject({ theme: 'Environnement', title: FEUX_TITLE, level: 'jaune' });
    expect(v.head.figure).toEqual({ value: '10', caption: 'départements en danger modéré aujourd’hui (météo des forêts) · 0 élevé ou très élevé', level: 'jaune' });
    expect(v.head.status).toEqual([glueEnvUnits(reason), `FIRMS${NBSP}05:34 · météo des forêts${NBSP}03/10${NBSP}16:50`]);
    expect(v.head.lead).toBe('3 foyers confirmés en France, le plus puissant : Ille-et-Vilaine (35), 3,9\u00a0MW. 2 sources récurrentes à vérifier, '
      + 'probablement industrielles (Nord, Bouches-du-Rhône). 158 détections hors de France, non comptées.');
    expect(html()).toContain('<b class="fmk-num lp-lvl lp-lvl--jaune">10</b>');
    expect(html()).toContain('fm-vig--jaune');
    expect(html()).not.toContain('fm-vig--orange');
  });
  it('onglets Veille et Dossier d’un feu (compte des grands incidents) ; sections et ouverture ; méthode en ton de référence', () => {
    const v = view();
    expect(FEUX_TABS).toEqual(['veille', 'dossier']);
    expect(v.tabs).toEqual([{ id: 'veille', label: 'Veille', count: null }, { id: 'dossier', label: 'Dossier d’un feu', count: 0 }]);
    expect(v.activeTab).toBe('veille');
    expect(v.sections.map((s) => [s.id, s.open ?? false])).toEqual([['meteo-forets', true], ['detections', true], ['jour-aeronautique', false], ['methode', false]]);
    expect(v.sections.at(-1)?.tone).toBe('reference');
  });
  it('météo des forêts : répartition J1 et J2 par niveau (jauges colorées), départements nommés, publication, courbe de la saison, option de remplissage', () => {
    const s = sectionOf('meteo-forets');
    expect(s?.summary).toBe('10 en danger modéré aujourd’hui');
    const h = s?.html ?? '';
    expect(h).toContain('<span class="lp-bar-label">Modéré</span><span class="fmk-bar"><i style="width:10.4%;background:var(--sev-yellow)"></i></span><span class="lp-val fmk-num">10</span>');
    expect(h).toContain('<span class="lp-bar-label">Faible</span><span class="fmk-bar"><i style="width:89.6%;background:var(--sev-green)"></i></span><span class="lp-val fmk-num">86</span>');
    const t = visibleText(h);
    expect(t).toContain('Danger modéré aujourd’hui : Alpes-de-Haute-Provence, Alpes-Maritimes, Bouches-du-Rhône, Corse-du-Sud, Haute-Corse, Haute-Garonne, Loire-Atlantique, Marne, Var, Vaucluse.');
    expect(t).toContain('Danger modéré demain : Alpes-Maritimes, Corse-du-Sud, Haute-Corse, Marne, Var.');
    expect(t).toContain('Publication Météo-France du 03/10 à 16:50 ; niveau officiel par département, repris tel quel.');
    expect(h).toContain('aria-label="Départements par niveau de danger de la météo des forêts, par jour de la saison"');
    expect(t).toContain('Saison 2026 : 129 jours publiés, du 29/05 au 04/10 ; chaque barre est datée par le jour de validité J1');
    expect(h).toContain('<title>23/09 · modéré : ');
    expect(h).toContain('data-forest-fill aria-pressed="false">Colorer les départements sur la carte</button>');
    expect(sectionOf('meteo-forets', { options: { ...OPTIONS, forestDangerFill: true } })?.html).toContain('data-forest-fill aria-pressed="true">Masquer le remplissage de la carte</button>');
  });
  it('détections en France : foyers par niveau (confirmé de moins de 10 MW jaune comme un isolé, arbitrage 14 ; récurrent gris « à vérifier »), satellites, confiance, FRP, âge, clic vers la carte', () => {
    const s = sectionOf('detections');
    expect(s?.summary).toBe('3 confirmés · 5 isolés · 2 récurrents');
    const h = s?.html ?? '';
    expect(h).toContain('<div class="lp-row is-link" tabindex="0" role="button" data-foyer="48.5627_-1.7717_2026-10-04_0300_Suomi NPP"><span class="fmk-dot fmk-dot--jaune" aria-hidden="true"></span>'
      + `<span>Ille-et-Vilaine (35) · foyer confirmé</span><span class="lp-val fmk-num">3,9${NBSP}MW</span>`);
    expect(visibleText(h)).toContain(`Suomi NPP (VIIRS), NOAA-20 (VIIRS) · confiance nominale · 3 détections, 2 passages · dernière à 05:19 (il y a 4${NBSP}h${NBSP}51)`);
    expect(h).toMatch(/fmk-dot--jaune[^]*Yonne \(89\) · détection isolée[^]*11,7.MW/);
    expect(h).toMatch(/<span class="fmk-dot" aria-hidden="true"><\/span><span>Nord \(59\) · source récurrente<\/span><span class="lp-val fmk-num">194,1.MW<\/span><small>[^<]*récurrent, à vérifier, probablement industriel<\/small>/);
    expect(h).toContain(`<span>Détections hors de France (non comptées)</span><span class="lp-val fmk-num">158</span>`);
    expect(visibleText(h)).toContain(`Dernière acquisition sur la zone : 05:34 (il y a 4${NBSP}h${NBSP}36).`);
    expect(visibleText(h)).toContain('Prochains passages attendus (estimés d’après ceux de la veille) : Terra (MODIS) vers 10:48, Suomi NPP (VIIRS) vers 13:25, NOAA-20 (VIIRS) vers 13:45, NOAA-21 (VIIRS) vers 14:27.');
    expect(sectionOf('detections', { canFocus: false })?.html).not.toContain('data-foyer');
  });
  it('détections par jour : non récurrentes et récurrentes empilées (récurrentes en gris de catégorie), référence en construction', () => {
    const h = sectionOf('detections')?.html ?? '';
    expect(h).toContain('aria-label="Détections en France par jour, récurrentes à part"');
    expect(h).toContain('<title>03/10 · en France, non récurrentes : 37</title>');
    expect(h).toContain('<title>04/10 · récurrentes, à vérifier : 90</title>');
    expect(h).toContain('fill="var(--cat-feu-recurrent)"');
    expect(visibleText(h)).toContain('Référence en construction (2 jours sur 10).');
  });
  it('observation complémentaire : imagerie GIBS et MTG-FRP en options, état de MTG-FRP tiré de sa lecture (jamais « ACTIF » codé)', () => {
    const h = sectionOf('detections')?.html ?? '';
    expect(h).toContain('data-gibs aria-pressed="false">Afficher</button>');
    expect(h).toContain('data-mtg aria-pressed="false">Afficher</button>');
    const feed: FireObservationFeedState = { status: 'ok', observedAt: Date.parse('2026-10-04T07:50:00Z'), fetchedAt: NOW, source: 'EUMETSAT LSA SAF' };
    expect(mtgFrpState(feed, NOW)).toBe(`observation 09:50 (il y a 20${NBSP}min)`);
    expect(mtgFrpState({ ...feed, status: 'stale' }, NOW)).toBe(`observation 09:50 (il y a 20${NBSP}min), dernière valide gardée`);
    expect(mtgFrpState({ ...feed, status: 'not-configured', observedAt: null }, NOW)).toBe('non configuré');
    expect(mtgFrpState({ ...feed, status: 'error', observedAt: null }, NOW)).toBe('source indisponible');
    expect(mtgFrpState(null, NOW)).toBe('non lu');
    expect(html({ mtgFrp: feed, options: { ...OPTIONS, gibs: true, mtgFrp: true } })).not.toMatch(/\bACTIF\b/);
  });
  it('hauteur du panache : module gardé dans chaque foyer, replié tant qu’il n’est pas demandé ; chargement, panne, profil daté (démonstration)', () => {
    const id = '48.5627_-1.7717_2026-10-04_0300_Suomi NPP';
    const closed = sectionOf('detections')?.html ?? '';
    expect(closed.match(/data-plume-foyer=/g)).toHaveLength(10);
    expect(closed).toContain(`<details class="lp-plume" data-plume-foyer="${id}"><summary>Hauteur du panache (démonstration)</summary>`);
    expect(closed).toContain('data-echo-tops aria-pressed="false">Sommets d’écho sur la carte</button>');
    expect(visibleText(closed)).toContain('Pyroconvection : un panache très développé');
    const loading = sectionOf('detections', { plume: new Map([[id, 'loading']]) })?.html ?? '';
    expect(loading).toContain(`<details class="lp-plume" data-plume-foyer="${id}" open>`);
    expect(loading).toContain('Chargement du profil radar');
    expect(sectionOf('detections', { plume: new Map([[id, 'error']]) })?.html).toContain('Profil radar indisponible');
    const profile = sectionOf('detections', { plume: new Map([[id, RADAR_COLUMN_FIXTURE()]]) })?.html ?? '';
    expect(profile).toContain('DÉMONSTRATION');
    expect(profile).toContain('NIMES');
    expect(profile).toContain('04/10');
    expect(sectionOf('detections', { options: { ...OPTIONS, echoTopsAvailable: false } })?.html).toContain('Sommets d’écho indisponibles : le manifeste radar n’en publie pas.');
    expect(sectionOf('detections', { options: { ...OPTIONS, echoTops: true } })?.html).toContain('data-echo-tops aria-pressed="true">Masquer les sommets d’écho</button>');
  });
  it('jour aéronautique : une ligne par département avec un foyer non récurrent ou un danger élevé, heures de Paris', () => {
    const s = sectionOf('jour-aeronautique');
    expect(s?.summary).toBe('7 départements');
    const t = visibleText(s?.html ?? '');
    expect(t).toContain('Allier (03)lever 07:50 · coucher 19:22 · fin du jour aéronautique 19:52');
    expect(t).toContain('Ille-et-Vilaine (35)lever 08:10 · coucher 19:40 · fin du jour aéronautique 20:10');
    expect(t).not.toContain('Nord (59)');
  });
  it('méthode et sources : produits lus en clair, publication datée, MTG-FRP et radar en démonstration, règles dites', () => {
    const t = visibleText(sectionOf('methode')?.html ?? '');
    expect(t).toContain('NASA FIRMS · dernière acquisition 04/10 à 05:34 · collecte du serveur 04/10 à 10:10');
    expect(t).toContain('Suomi NPP lu, NOAA-20 lu, NOAA-21 lu, MODIS (Terra, Aqua) lu');
    expect(t).toContain('Météo-France, météo des forêts · publication du 03/10 à 16:50');
    expect(t).toContain('Périmètre : départements français seulement (point dans le polygone du département)');
    expect(t).toContain('apparu depuis 7 jours au plus n’est jamais récurrent');
  });
});

describe('pannes, retards, hors saison (S1 à S3)', () => {
  it('FIRMS en panne, météo des forêts lue : niveau sur le danger, panne nommée, jamais « aucune détection »', () => {
    const f = fires((x) => { x.readAt = null; x.lastAcquisitionAt = null; x.detections = []; x.foyers = []; x.abroad = []; x.abroadCount = 0; x.errors = ['FIRMS, Suomi NPP : HTTP 503']; });
    const v = view({ fires: f });
    expect(v.head.level).toBe('jaune');
    // Décision du contrôleur : la panne d'une source est nommée dans la raison même quand l'autre colore la pastille (S3).
    expect(v.head.status).toEqual([glueEnvUnits('danger modéré aujourd’hui : 10 départements ; détections FIRMS indisponibles'), `FIRMS injoignable · météo des forêts${NBSP}03/10${NBSP}16:50`]);
    expect(visibleText(sectionOf('detections', { fires: f })?.html ?? '')).toContain('Source indisponible : détections NASA FIRMS.');
    expect(visibleText(sectionOf('methode', { fires: f })?.html ?? '')).toContain('Incidents de lecture : FIRMS, Suomi NPP : HTTP 503.');
  });
  it('météo des forêts en panne : gros chiffre n.d., section nommée en panne, pastille sur les foyers', () => {
    const f = fires((x) => { x.forestDanger = null; x.errors = ['Météo des forêts : HTTP 503']; });
    const v = view({ fires: f });
    expect(v.head.figure).toEqual({ value: 'n.d.', caption: 'départements par niveau de danger : météo des forêts indisponible', level: null });
    // Pastille sur les seuls foyers : trois foyers confirmés de moins de 10 MW, jaunes (arbitrage 14 du contrôleur).
    expect(v.head.level).toBe('jaune');
    expect(v.head.status[0]).toBe(glueEnvUnits('3 foyers confirmés de moins de 10 MW en France ; météo des forêts indisponible'));
    expect(v.head.status[1]).toBe(`FIRMS${NBSP}05:34 · météo des forêts injoignable`);
    expect(visibleText(sectionOf('meteo-forets', { fires: f })?.html ?? '')).toBe('Source indisponible : météo des forêts.');
  });
  it('les deux en panne (route injoignable) : n.d., « source injoignable », sections nommées ; chargement avant la première lecture', () => {
    const v = view({ fires: null, firesError: 'HTTP 502' });
    expect(v.head).toMatchObject({ level: 'nd', status: ['FIRMS et météo des forêts injoignables'] });
    expect(v.bodyHtml).toContain('Source injoignable. Aucune donnée reçue.');
    expect(visibleText(v.sections.map((s) => s.html).join(''))).toContain('Source indisponible : détections NASA FIRMS.');
    const loading = view({ fires: null, firesError: null });
    expect(loading.head.status).toEqual(['chargement…']);
    expect(loading.bodyHtml).toContain('Chargement des données');
    const stale = view({ firesError: 'HTTP 502' });
    expect(stale.bodyHtml).toContain('Source injoignable. Dernières données : 10:10.');
  });
  it('FIRMS en retard (14 h après la dernière acquisition) : pastille suspendue, foyers sans couleur, « (en retard) »', () => {
    const late = Date.parse('2026-10-04T17:35:00Z');
    const v = view({ now: late });
    expect(v.head.level).toBe('nd');
    expect(v.head.status[0]).toBe('niveau suspendu : détections FIRMS en retard');
    expect(v.head.status[1]).toContain(`FIRMS${NBSP}05:34${NBSP}(en retard)`);
    const s = v.sections.find((x) => x.id === 'detections');
    expect(s?.summary).toContain('(en retard)');
    expect(s?.html).not.toMatch(/fmk-dot--(?:orange|jaune|rouge)/);
  });
  it('météo des forêts en retard (publication + 30 h) : gros chiffre et jauges sans couleur', () => {
    const late = Date.parse('2026-10-04T20:51:00Z');
    const v = view({ now: late });
    expect(v.head.figure).toMatchObject({ value: '10', level: null });
    expect(v.head.figure?.caption).toContain('(en retard)');
    const h = v.sections.find((x) => x.id === 'meteo-forets')?.html ?? '';
    expect(h).not.toContain('var(--sev-yellow)');
    expect(h).toContain('fmk-dot');
  });
  it('hors saison (lecture du 15/10) : niveaux échus sans couleur, dernière publication dite, jamais « (en retard) » pour la météo des forêts', () => {
    const later = Date.parse('2026-10-15T10:00:00+02:00');
    const v = view({ now: later });
    expect(v.head.figure).toEqual({ value: 'n.d.', caption: 'météo des forêts hors saison, dernière publication le 03/10 à 16:50', level: null });
    expect(v.head.status[1]).toContain('météo des forêts hors saison');
    const s = v.sections.find((x) => x.id === 'meteo-forets');
    expect(s?.summary).toBe('hors saison');
    expect(visibleText(s?.html ?? '')).toContain('Hors saison, dernière publication le 03/10 à 16:50 : niveaux échus, sans couleur.');
    expect(s?.html).not.toMatch(/var\(--sev-|\(en retard\)/);
  });
});

describe('onglet Dossier d’un feu', () => {
  it('aucun incident ne franchit la porte (cas du 04/10) : dit', () => {
    const v = view({ tab: 'dossier' });
    expect(v.activeTab).toBe('dossier');
    expect(v.sections.map((s) => s.id)).toEqual(['incidents']);
    expect(visibleText(v.sections[0].html)).toBe(`Aucun incident ne franchit la porte du dossier (40 détections et 300${NBSP}MW).`);
  });
  it('grand incident listé (clic : son dossier) puis dossier ouvert : observé, déclaré, communes', () => {
    const dossier = { incident: PORGE, dossier: buildDossier(PORGE, [], ['33']), impacts: FIRE_IMPACTS_FIXTURE(), impactsError: null };
    const v = view({ tab: 'dossier', majorIncidents: [PORGE], dossier });
    expect(v.tabs?.[1]).toEqual({ id: 'dossier', label: 'Dossier d’un feu', count: 1 });
    expect(v.sections.map((s) => s.id)).toEqual(['incidents', 'dossier-observe', 'dossier-declare', 'dossier-communes']);
    expect(v.sections[0].html).toContain(`data-incident="porge-1"><span class="fmk-dot fmk-dot--jaune" aria-hidden="true"></span><span>Gironde (33) · Le Porge</span><span class="lp-val fmk-num">307,6${NBSP}MW</span>`);
    expect(visibleText(v.sections[3].html)).toContain(`Le Porge (Gironde)2,1${NBSP}km`);
  });
});

describe('hygiène du rendu', () => {
  const variants: Array<Partial<FeuxViewInput>> = [
    {}, { tab: 'dossier' }, { fires: null, firesError: 'HTTP 502' }, { now: Date.parse('2026-10-15T10:00:00+02:00') }, { now: Date.parse('2026-10-04T20:51:00Z') },
    { tab: 'dossier', majorIncidents: [PORGE], dossier: { incident: PORGE, dossier: buildDossier(PORGE, [], ['33']), impacts: FIRE_IMPACTS_FIXTURE(), impactsError: null } },
    { tab: 'dossier', majorIncidents: [PORGE], dossier: { incident: PORGE, dossier: buildDossier(PORGE, [], ['33']), impacts: { ...FIRE_IMPACTS_FIXTURE(), communes: [], nearest: null, georisquesUrl: null }, impactsError: null } },
  ];
  it('aucun tiret cadratin, aucune police à chasse fixe, aucune couleur brute, jamais « temps réel » ni « LIVE »', () => {
    for (const over of variants) {
      const h = html(over);
      expect(h).not.toMatch(/\u2014|&mdash;|monospace|#[0-9a-fA-F]{6}\b|rgba?\(/);
      expect(visibleText(h)).not.toMatch(/temps réel|TEMPS RÉEL|\bLIVE\b/i);
    }
  });
  it('R1 : aucune valeur coupée entre nombre et unité', () => {
    for (const over of variants) {
      const v = view(over);
      const texts = [v.head.figure?.caption ?? '', ...v.head.status, v.head.lead ?? '', ...v.sections.map((s) => visibleText(`${s.summary ?? ''} ${s.html}`))];
      for (const t of texts) {
        expect(breakableValue(t), t.slice(0, 80)).toBeNull();
        expect(envBreakable(t), t.slice(0, 80)).toBeNull();
      }
    }
  });
  it('textes tiers échappés (nom de département publié par la météo des forêts)', () => {
    const f = fires((x) => { if (x.forestDanger) x.forestDanger.departments[3].name = '<img src=x onerror=alert(1)>'; });
    const h = html({ fires: f });
    expect(h).not.toContain('<img src=x');
    expect(h).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('décisions du contrôleur postérieures à la brief', () => {
  const ILLE = '48.5627_-1.7717_2026-10-04_0300_Suomi NPP';
  const foyerDot = (h: string): string => /data-foyer="48\.5627_-1\.7717_2026-10-04_0300_Suomi NPP"><span class="fmk-dot( fmk-dot--\w+)?"/.exec(h)?.[1] ?? '';
  const dangerAt = (dept: string, level: 1 | 2 | 3 | 4) => fires((x) => {
    const d = x.forestDanger?.departments.find((y) => y.dept === dept);
    if (d) d.j1 = level;
  });

  it('pastille orange seulement pour un foyer confirmé non récurrent d’au moins 10 MW cumulés (arbitrage 14) ; jaune juste en dessous', () => {
    const ten = fires((x) => { x.foyers[0].frpTotalMw = 10; });
    expect(view({ fires: ten }).head).toMatchObject({ level: 'orange', status: ['un foyer confirmé en France', expect.any(String)] });
    expect(foyerDot(sectionOf('detections', { fires: ten })?.html ?? '')).toBe(' fmk-dot--orange');
    const below = fires((x) => { x.foyers[0].frpTotalMw = 9.99; });
    expect(view({ fires: below }).head.level).toBe('jaune');
    // Détection isolée de 11,7 MW (Yonne) et source récurrente de 194 MW (Nord) : jamais orange, d'où le jaune du 04/10.
    expect(view().head.level).toBe('jaune');
    expect(foyerDot(sectionOf('detections')?.html ?? '')).toBe(' fmk-dot--jaune');
  });

  it('pastille rouge dès 100 MW (jamais pour une confiance faible) ou au danger très élevé (niveau 4)', () => {
    const major = fires((x) => { x.foyers[0].frpTotalMw = 120; });
    expect(view({ fires: major }).head).toMatchObject({ level: 'rouge', status: [glueEnvUnits('foyer confirmé de 120 MW'), expect.any(String)] });
    expect(foyerDot(sectionOf('detections', { fires: major })?.html ?? '')).toBe(' fmk-dot--rouge');
    const weak = fires((x) => { x.foyers[0].frpTotalMw = 120; x.foyers[0].confidenceMax = 'faible'; });
    expect(view({ fires: weak }).head.level).toBe('orange');
    const v = view({ fires: dangerAt('83', 4) });
    expect(v.head).toMatchObject({ level: 'rouge', status: ['danger très élevé aujourd’hui : Var', expect.any(String)] });
    expect(v.head.figure).toEqual({ value: '1', caption: 'départements en danger très élevé aujourd’hui (météo des forêts) · 1 élevé ou très élevé', level: 'rouge' });
    expect(sectionOf('meteo-forets', { fires: dangerAt('83', 4) })?.html).toContain('<span class="lp-bar-label">Très élevé</span><span class="fmk-bar"><i style="width:1%;background:var(--sev-red)"></i>');
  });

  it('panne d’une source nommée dans la raison même quand l’autre colore la pastille, au danger comme aux foyers', () => {
    const fd = fires((x) => { x.forestDanger = null; x.foyers[0].frpTotalMw = 10; x.errors = ['Météo des forêts : HTTP 503']; });
    expect(view({ fires: fd }).head.status[0]).toBe('un foyer confirmé en France ; météo des forêts indisponible');
    const firms = fires((x) => { x.readAt = null; x.lastAcquisitionAt = null; x.foyers = []; x.detections = []; x.errors = ['FIRMS, Suomi NPP : HTTP 503']; });
    const reason = view({ fires: firms }).head.status[0];
    expect(reason).toContain('danger modéré');
    expect(reason).toContain('détections FIRMS indisponibles');
  });

  it('prochains passages : seulement ceux encore à venir (une réponse gardée par le CDN peut en porter de passés)', () => {
    const t = visibleText(sectionOf('detections', { now: Date.parse('2026-10-04T11:30:00Z') })?.html ?? '');
    expect(t).toContain('Prochains passages attendus (estimés d’après ceux de la veille) : NOAA-20 (VIIRS) vers 13:45, NOAA-21 (VIIRS) vers 14:27, '
      + 'Suomi NPP (VIIRS) vers 15:04, NOAA-20 (VIIRS) vers 15:25.');
    expect(t).not.toContain('vers 10:48');
    expect(t).not.toContain('vers 13:25');
    expect(visibleText(sectionOf('detections', { now: Date.parse('2026-10-04T14:00:00Z') })?.html ?? '')).not.toContain('Prochains passages');
  });

  it('notes d’avancement (isProgressNote) et « collecte en cours » : dites comme notes, jamais comme incidents ni pannes', () => {
    const progress = fires((x) => { x.errors = ['FIRMS : relevé précédent servi (lecture en cours)']; });
    const method = visibleText(sectionOf('methode', { fires: progress })?.html ?? '');
    expect(method).toContain('Note : FIRMS : relevé précédent servi (lecture en cours).');
    expect(method).not.toContain('Incidents de lecture');
    expect(view({ fires: progress }).head.level).toBe('jaune');
    const collecting = fires((x) => { x.errors = ['FIRMS : collecte en cours']; });
    const det = visibleText(sectionOf('detections', { fires: collecting })?.html ?? '');
    expect(det).toContain('Note : FIRMS : collecte en cours (la nouvelle collecte sera servie à la prochaine lecture).');
    expect(det).not.toMatch(/Source indisponible|Lecture FIRMS incomplète/);
    expect(visibleText(sectionOf('methode', { fires: collecting })?.html ?? '')).not.toContain('Incidents de lecture');
    // Première collecte en cours, sans aucune collecte servie : jamais « injoignable » ni « source indisponible ».
    const first = fires((x) => {
      x.readAt = null; x.lastAcquisitionAt = null; x.sources = []; x.detections = []; x.foyers = []; x.abroad = []; x.abroadCount = 0; x.nextPasses = [];
      x.errors = ['FIRMS : collecte en cours'];
    });
    const v = view({ fires: first });
    expect(v.head.status[1]).toBe(`FIRMS : collecte en cours · météo des forêts${NBSP}03/10${NBSP}16:50`);
    const s = v.sections.find((x) => x.id === 'detections');
    expect(s?.summary).toBe('collecte en cours');
    expect(visibleText(s?.html ?? '')).toContain('Collecte FIRMS en cours : détections à la prochaine lecture.');
    expect(visibleText(s?.html ?? '')).not.toContain('Source indisponible');
  });

  it('lignes FIRMS illisibles : nommées dans la section et dans la méthode, données gardées', () => {
    const f = fires((x) => { x.errors = ['FIRMS, NOAA-20 : 3 lignes illisibles']; });
    expect(view({ fires: f }).head.level).toBe('jaune');
    expect(visibleText(sectionOf('detections', { fires: f })?.html ?? '')).toContain('Lecture FIRMS incomplète : FIRMS, NOAA-20 : 3 lignes illisibles.');
    expect(visibleText(sectionOf('methode', { fires: f })?.html ?? '')).toContain('Incidents de lecture : FIRMS, NOAA-20 : 3 lignes illisibles.');
  });

  it('lignes de la météo des forêts illisibles ou en double : nommées dans la section, niveaux gardés', () => {
    const f = fires((x) => { x.errors = ['Météo des forêts : 2 lignes illisibles', 'Météo des forêts : 1 ligne en double']; });
    expect(view({ fires: f }).head.figure?.level).toBe('jaune');
    expect(visibleText(sectionOf('meteo-forets', { fires: f })?.html ?? ''))
      .toContain('Lecture incomplète : Météo des forêts : 2 lignes illisibles ; Météo des forêts : 1 ligne en double.');
    expect(visibleText(sectionOf('meteo-forets')?.html ?? '')).not.toContain('Lecture incomplète');
  });

  it('dernière collecte de plus de 2 jours : panne nommée avec sa cause, jamais « aucune détection » ; en 502, dernières données datées', () => {
    const f = fires((x) => {
      x.readAt = null; x.lastAcquisitionAt = null; x.sources = []; x.detections = []; x.foyers = []; x.abroad = []; x.abroadCount = 0; x.nextPasses = [];
      x.daily = { days: [], since: null };
      x.errors = ['FIRMS, Suomi NPP : HTTP 503', 'FIRMS, NOAA-20 : HTTP 503', 'FIRMS : dernière collecte de plus de 2 jours'];
    });
    const v = view({ fires: f });
    expect(v.head.level).toBe('jaune');
    expect(v.head.status[1]).toContain('FIRMS injoignable');
    const t = visibleText(v.sections.find((x) => x.id === 'detections')?.html ?? '');
    expect(t).toContain('Source indisponible : détections NASA FIRMS.');
    expect(t).toContain('Dernière collecte FIRMS de plus de 2 jours : plus servie, aucune détection comptée.');
    expect(t).toContain('Cause : FIRMS, Suomi NPP : HTTP 503 ; FIRMS, NOAA-20 : HTTP 503.');
    expect(t).not.toContain('Aucune détection en France');
    // 502 (météo des forêts en panne aussi) : la dernière réponse reçue reste servie avec sa date, et son retard compte.
    const late = view({ firesError: 'HTTP 502', now: Date.parse('2026-10-04T17:35:00Z') });
    expect(late.bodyHtml).toContain('Source injoignable. Dernières données : 10:10.');
    expect(late.head).toMatchObject({ level: 'nd', status: ['niveau suspendu : détections FIRMS en retard', expect.stringContaining('(en retard)')] });
  });

  it('collecte gardée servie après un cycle en échec : sa propre date, panne nommée, règles du retard appliquées', () => {
    const f = fires((x) => {
      x.sources = x.sources.map((s) => ({ ...s, ok: false }));
      x.nextPasses = [];
      x.errors = ['FIRMS, Suomi NPP : HTTP 503', 'FIRMS, NOAA-20 : HTTP 503', 'FIRMS, NOAA-21 : HTTP 503', 'FIRMS, MODIS : HTTP 503'];
    });
    const v = view({ fires: f });
    expect(v.head.level).toBe('jaune');
    expect(v.head.status[1]).toBe(`FIRMS${NBSP}05:34 · météo des forêts${NBSP}03/10${NBSP}16:50`);
    const t = visibleText(v.sections.find((x) => x.id === 'detections')?.html ?? '');
    // Panne nommée AVANT la liste (correction 1 de la revue), avec les erreurs du dernier essai.
    expect(t.startsWith('Collecte du 04/10 à 10:10 servie avec sa date : aucun produit FIRMS lu au dernier essai '
      + '(FIRMS, Suomi NPP : HTTP 503 ; FIRMS, NOAA-20 : HTTP 503 ; FIRMS, NOAA-21 : HTTP 503 ; FIRMS, MODIS : HTTP 503).')).toBe(true);
    expect(v.head.status[2]).toBe('dernier essai FIRMS en échec : collecte du 04/10 à 10:10 servie');
    expect(visibleText(sectionOf('methode', { fires: f })?.html ?? '')).toContain('Suomi NPP en panne, NOAA-20 en panne, NOAA-21 en panne, MODIS (Terra, Aqua) en panne');
    const late = view({ fires: f, now: Date.parse('2026-10-04T17:35:00Z') });
    expect(late.head.level).toBe('nd');
    expect(late.head.status[0]).toBe('niveau suspendu : détections FIRMS en retard');
  });

  it('courbe de la saison : titre « aucun département en danger sur la période » quand aucun département n’est au niveau 2 ou plus', () => {
    const label = 'Départements par niveau de danger de la météo des forêts, par jour de la saison';
    // Tous les départements au niveau 1 (faible), non tracé : la courbe est vide et le dit.
    const zero = fires((x) => { if (x.forestDanger) x.forestDanger.history = x.forestDanger.history.map((h) => ({ ...h, n1: 96, n2: 0, n3: 0, n4: 0 })); });
    expect(sectionOf('meteo-forets', { fires: zero })?.html).toContain(`aria-label="${label} : aucun département en danger sur la période"`);
    expect(sectionOf('meteo-forets')?.html).toContain(`aria-label="${label}"`);
  });

  it('hauteur du panache : module gardé dans chaque foyer (profil radar daté en démonstration, sommets d’écho, pyroconvection)', () => {
    // Lecture à 12:00, après le balayage de 11:30 du jeu d'essai : profil daté avec sa date.
    const h = sectionOf('detections', { plume: new Map([[ILLE, RADAR_COLUMN_FIXTURE()]]), now: Date.parse('2026-10-04T12:00:00+02:00') })?.html ?? '';
    const block = h.slice(h.indexOf(`data-plume-foyer="${ILLE}"`));
    const one = block.slice(0, block.indexOf('</details>'));
    expect(one).toContain('DÉMONSTRATION');
    expect(one).toContain('Radar NIMES');
    expect(one).toContain('observation du 04/10 11:30');
    expect(one).toContain('data-echo-tops');
    expect(visibleText(one)).toContain('Pyroconvection');
  });

  it('jour aéronautique : fin 30 min après le coucher (règle française), départements de métropole seulement', () => {
    const t = visibleText(sectionOf('jour-aeronautique')?.html ?? '');
    expect(t).toContain('coucher 19:22 · fin du jour aéronautique 19:52');
    const drom = fires((x) => { x.foyers[0].dept = '971'; x.foyers[0].depts = ['971']; });
    const s = sectionOf('jour-aeronautique', { fires: drom });
    expect(visibleText(s?.html ?? '')).not.toContain('(971)');
    expect(s?.summary).toBe('6 départements');
  });
});

describe('correction 1 de la revue', () => {
  const ILLE = '48.5627_-1.7717_2026-10-04_0300_Suomi NPP';
  const noaa21Down = (x: FiresResponse): void => {
    x.sources = x.sources.map((s) => (s.id === 'VIIRS_NOAA21_NRT' ? { ...s, ok: false } : s));
    x.errors = ['FIRMS, NOAA-21 : HTTP 503'];
  };

  it('lecture FIRMS incomplète sans foyer : « Aucune détection lue », panne nommée (produit, erreur) AVANT la liste ; lecture complète : le calme', () => {
    const rows = fires((x) => { x.foyers = []; x.errors = ['FIRMS, NOAA-20 : 3 lignes illisibles']; });
    const h = sectionOf('detections', { fires: rows })?.html ?? '';
    expect(h.startsWith('<p class="fmk-callout lp-callout">Lecture FIRMS incomplète : FIRMS, NOAA-20 : 3 lignes illisibles.</p>')).toBe(true);
    const t = visibleText(h);
    expect(t).toContain('Aucune détection lue en France sur les 24 dernières heures.');
    expect(t).not.toContain('Aucune détection en France sur les 24 dernières heures.');
    expect(t.indexOf('Lecture FIRMS incomplète')).toBeLessThan(t.indexOf('Aucune détection lue'));

    const down = fires((x) => { noaa21Down(x); x.foyers = []; });
    const d = visibleText(sectionOf('detections', { fires: down })?.html ?? '');
    expect(d.startsWith('Lecture FIRMS incomplète : FIRMS, NOAA-21 : HTTP 503.Aucune détection lue en France')).toBe(true);
    // Produit marqué en panne sans message : nommé par son produit.
    const silent = fires((x) => { noaa21Down(x); x.errors = []; x.foyers = []; });
    expect(visibleText(sectionOf('detections', { fires: silent })?.html ?? '')).toContain('Lecture FIRMS incomplète : NOAA-21 non lu.');

    const calm = fires((x) => { x.foyers = []; });
    const c = sectionOf('detections', { fires: calm })?.html ?? '';
    expect(visibleText(c)).toContain('Aucune détection en France sur les 24 dernières heures.');
    expect(c).not.toContain('fmk-callout');
    expect(visibleText(c)).not.toContain('lecture incomplète');
  });

  it('panne partielle de FIRMS (1 produit sur 4) : nommée dans le résumé de la section et en tête, pastille inchangée', () => {
    const f = fires(noaa21Down);
    const v = view({ fires: f });
    expect(v.head.level).toBe(view().head.level);
    expect(v.head.status).toEqual([view().head.status[0], view().head.status[1], 'lecture FIRMS incomplète : NOAA-21 non lu']);
    expect(v.sections.find((s) => s.id === 'detections')?.summary).toBe('3 confirmés · 5 isolés · 2 récurrents · lecture incomplète');
    // Données servies : la liste des foyers reste, après la panne nommée.
    const h = sectionOf('detections', { fires: f })?.html ?? '';
    expect(h.indexOf('Lecture FIRMS incomplète')).toBeLessThan(h.indexOf(`data-foyer="${ILLE}"`));
    // Lignes illisibles seules : tous les produits lus, mention sans produit.
    const rows = view({ fires: fires((x) => { x.errors = ['FIRMS, NOAA-20 : 3 lignes illisibles']; }) });
    expect(rows.head.status[2]).toBe('lecture FIRMS incomplète');
    // Lecture complète : aucune mention ; note d'avancement : jamais « incomplète ».
    expect(view().head.status).toHaveLength(2);
    expect(view({ fires: fires((x) => { x.errors = ['FIRMS : collecte en cours']; }) }).head.status).toHaveLength(2);
  });

  it('courbe de la saison : niveaux 2 à 4 seulement, le niveau faible n’est pas tracé et la note le dit', () => {
    const h = sectionOf('meteo-forets')?.html ?? '';
    expect(h).toContain('<title>04/10 · modéré : 10</title>');
    expect(h).not.toContain(' · faible : ');
    expect(h).not.toMatch(/<rect[^>]*fill="var\(--sev-green\)"/);
    expect(visibleText(h)).toContain('danger modéré ou plus, le niveau faible n’est pas tracé.');
  });
});
