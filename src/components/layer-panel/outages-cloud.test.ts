// src/components/layer-panel/outages-cloud.test.ts
// Vue pure du panneau Cloud (spec 2026-10-08 panneaux pannes § 2.4) sur le jeu d'essai réel du 08/10/2026 : incidents comptés une fois,
// statut mondial jamais France, zones datées, Azure sans état France, synthèse OVHcloud, référentiel en inventaire, fournisseur en retard
// ou muet (n.d., aucune couleur), erreurs nommées, hygiène du rendu.
import { describe, expect, it } from 'vitest';
import type { CloudOutagesResponse, CloudProvider, CloudStatus } from '../../types/index.ts';
import { renderLayerView } from './frame.ts';
import { NBSP, breakableValue, visibleText } from './format.ts';
import { buildCloudView, CLOUD_STATUS_WORD, CLOUD_TITLE, type CloudViewInput } from './outages-cloud.ts';
import { CLOUD_FIXTURE_NOW, cloudFixtureResponse } from './outages.fixture.ts';

const open = (): boolean => true;
const view = (over: Partial<CloudViewInput> = {}) => buildCloudView({
  cloud: cloudFixtureResponse(), error: null, canFocus: true, now: CLOUD_FIXTURE_NOW, open, ...over,
});
const html = (over: Partial<CloudViewInput> = {}): string => renderLayerView('outagesCloud', view(over));
const text = (over: Partial<CloudViewInput> = {}): string => visibleText(html(over));
const section = (over: Partial<CloudViewInput>, id: string): string => view(over).sections.find((s) => s.id === id)?.html ?? '';
const sectionText = (over: Partial<CloudViewInput>, id: string): string => visibleText(section(over, id));
const withData = (patch: (r: CloudOutagesResponse) => void): Partial<CloudViewInput> => {
  const r = cloudFixtureResponse();
  patch(r);
  return { cloud: r };
};
const providerOf = (r: CloudOutagesResponse, p: CloudProvider) => {
  const found = r.providers.find((x) => x.provider === p);
  if (!found) throw new Error(`fournisseur ${p} absent`);
  return found;
};
/** Bloc HTML d'un fournisseur dans la section « fournisseurs » : de son en-tête au suivant. */
const providerBlock = (over: Partial<CloudViewInput>, label: string): string => {
  const h = section(over, 'fournisseurs');
  const start = h.indexOf(`>${label}</span>`);
  const next = h.indexOf('class="fmk-kv"', start + 1);
  return h.slice(start, next === -1 ? undefined : next);
};
const HOURS_3 = 3 * 3_600_000;

describe('vue Cloud (jeu d’essai du 08/10)', () => {
  it('en-tête : 2 incidents comptés une fois, jaune, lecture datée', () => {
    const v = view();
    expect(v.head.title).toBe(CLOUD_TITLE);
    expect(v.head.figure).toMatchObject({ value: '2', caption: 'incidents ouverts touchant la France' });
    expect(v.head.figure?.level).toBeUndefined();
    expect(v.head.level).toBe('jaune');
    expect(v.head.status).toEqual([`pages d’état lues à 21${NBSP}h${NBSP}50`]);
    expect(html()).toContain('lp-lvl--jaune');
  });
  it('méthode : Equinix nommé, sans remplaçant (page d’état illisible, HTTP 403), non suivi (spec § 3.3)', () => {
    expect(sectionText({}, 'methode')).toContain('Equinix ne publie pas de page d’état lisible (HTTP 403) : non suivi.');
  });
  it('sections dans l’ordre, avec leur contenu', () => {
    expect(view().sections.map((s) => s.id)).toEqual(['incidents', 'fournisseurs', 'maintenances', 'ailleurs', 'referentiel', 'methode']);
    const inc = sectionText({}, 'incidents');
    expect(inc).toContain('Scaleway · [Container Registry]');
    expect(inc).toContain('Scaleway · [Generative APIs]');
    expect(inc).toContain('OVHcloud · [EU-WEST-PAR][Storage]');
    expect(inc).toContain('surveillé');
    expect(inc).toContain('zone non précisée');
    expect(section({}, 'incidents')).toContain('href="https://stspg.io/kdv5ytj12rjq"');
    const prov = sectionText({}, 'fournisseurs');
    expect(prov).toContain('Azure ne publie pas d’état par région France.');
    expect(prov).toContain('Paris (CDG)');
    expect(prov).toContain('03/03');
    const maint = sectionText({}, 'maintenances');
    expect(maint).toContain('[RBX4]');
    expect(maint).toContain('09/10');
    expect(maint).toContain('[DEDIRACK][DC1]');
    expect(maint).toContain('en cours');
    const elsewhere = view().sections.find((s) => s.id === 'ailleurs');
    expect(view({ open: (id, byDefault) => (id === 'ailleurs' ? byDefault : true) }).sections.find((s) => s.id === 'ailleurs')?.open).toBe(false);
    expect(visibleText(elsewhere?.html ?? '')).toContain('[Support]');
    expect(visibleText(elsewhere?.html ?? '')).toContain('it-mil');
    expect(visibleText(elsewhere?.html ?? '')).toContain('.MG');
    expect(visibleText(elsewhere?.html ?? '')).toContain('non compté');
    const ref = sectionText({}, 'referentiel');
    expect(ref).toContain(`2${NBSP}centres`);
    expect(ref).toContain(`2${NBSP}points d’échange`);
    expect(ref).toContain('Inventaire, pas un état');
    expect(ref).toContain('Point d’échange d’essai 1');
    expect(section({}, 'referentiel')).toContain('href="https://www.peeringdb.com/ix/1"');
    expect(view().sections.find((s) => s.id === 'referentiel')?.tone).toBe('reference');
    expect(text()).not.toMatch(/temps r[ée]el|\u2014/i);
  });
  it('un statut mondial n’est pas un statut France : incidents hors France repliés, jamais au gros chiffre', () => {
    expect(view().head.figure?.value).toBe('2');
    expect(view().sections.find((s) => s.id === 'ailleurs')?.summary).toBe('5');
    expect(sectionText({}, 'incidents')).not.toContain('[Support]');
  });
  it('synthèse OVHcloud : 28 zones suivies, aucune ligne opérationnelle ; une zone en panne partielle apparaît, orange, et la pastille passe à orange', () => {
    const prov = sectionText({}, 'fournisseurs');
    expect(prov).toContain(`28${NBSP}zones suivies : 28${NBSP}opérationnelles`);
    expect(prov).not.toContain('Roubaix (RBX4)');
    const over = withData((r) => {
      const z = providerOf(r, 'ovhcloud').zones.find((x) => x.id === 'RBX4');
      if (z) z.status = 'partial';
    });
    const block = providerBlock(over, 'OVHcloud');
    expect(visibleText(block)).toContain('Roubaix (RBX4)');
    expect(visibleText(block)).toContain(`27${NBSP}opérationnelles, 1${NBSP}en panne partielle`);
    expect(block).toContain('fmk-dot--orange');
    expect(view(over).head.level).toBe('orange');
    expect(view(over).head.figure?.value).toBe('2');
  });
  it('plus de 8 zones non opérationnelles : les 8 premières puis « et n autres »', () => {
    const over = withData((r) => { for (const z of providerOf(r, 'ovhcloud').zones.slice(0, 12)) z.status = 'degraded'; });
    expect(visibleText(providerBlock(over, 'OVHcloud'))).toContain(`et 4${NBSP}autres.`);
  });
  it('jusqu’à 8 zones, toutes listées (Scaleway : DC1 en maintenance, hors couleur de niveau)', () => {
    const block = providerBlock({}, 'Scaleway');
    expect(visibleText(block)).toContain('fr-par-1');
    expect(visibleText(block)).toContain('DC5');
    expect(visibleText(block)).not.toContain('zones suivies');
    expect(visibleText(block)).toContain(CLOUD_STATUS_WORD.maintenance);
    expect(block).toContain('var(--cat-out-maint)');
  });
  it('GCP et AWS sans date de zone : « aucun incident publié », jamais « opérationnel » ; Cloudflare daté', () => {
    for (const label of ['Google Cloud', 'AWS']) {
      const t = visibleText(providerBlock({}, label));
      expect(t).toContain('aucun incident publié');
      expect(t).not.toContain('opérationnel');
    }
    expect(visibleText(providerBlock({}, 'Cloudflare'))).toContain('opérationnel');
  });
  it('une date de zone d’une autre année porte son année', () => {
    expect(visibleText(providerBlock({}, 'Outscale'))).toContain('13/05/2024');
    expect(visibleText(providerBlock({}, 'Cloudflare'))).not.toContain('/2026');
  });
  it('zones à coordonnées cliquables seulement avec canFocus', () => {
    expect(html()).toContain('data-zone="48.86,2.35"');
    expect(html({ canFocus: false })).not.toContain('data-zone=');
  });
  it('fournisseur en panne : sa ligne dit l’erreur, aucune zone verte inventée, non compté', () => {
    const over = withData((r) => {
      const p = providerOf(r, 'scaleway');
      p.error = 'Scaleway : HTTP 503'; p.zones = []; p.readAt = null;
      r.incidents = [];
    });
    const block = providerBlock(over, 'Scaleway');
    expect(visibleText(block)).toContain('Scaleway : HTTP 503');
    expect(visibleText(block)).toContain('n.d.');
    expect(block).not.toContain('lp-lvl--vert');
    expect(block).not.toContain('fmk-dot--vert');
    expect(view(over).head.figure?.value).toBe('0');
    expect(view(over).head.status.join(' ')).toContain('Scaleway (n.d.)');
    expect(sectionText(over, 'incidents')).toContain('Aucun incident ouvert chez les fournisseurs à jour.');
  });
  it('un fournisseur en retard : lignes grisées « (en retard) », ni gros chiffre ni pastille, les autres gardent leur couleur', () => {
    const over = withData((r) => { providerOf(r, 'scaleway').readAt = new Date(CLOUD_FIXTURE_NOW - HOURS_3).toISOString(); });
    const v = view(over);
    expect(v.head.figure?.value).toBe('0');
    expect(v.head.level).toBe('vert');
    expect(v.head.status.join(' ')).toContain('Scaleway (en retard)');
    const block = providerBlock(over, 'Scaleway');
    expect(visibleText(block)).toContain('(en retard)');
    expect(block).not.toMatch(/fmk-dot--(vert|jaune|orange|rouge)|lp-lvl--|var\(--cat-out/);
    const inc = section(over, 'incidents');
    const row = inc.slice(inc.indexOf('[Container Registry]') - 200, inc.indexOf('[Container Registry]'));
    expect(row).not.toMatch(/fmk-dot--(jaune|orange|rouge)/);
    expect(visibleText(inc)).toContain('(en retard)');
    expect(providerBlock(over, 'Cloudflare')).toContain('fmk-dot--vert');
  });
  it('tous les fournisseurs lus il y a 3 h : « (en retard) », n.d., aucune couleur', () => {
    const over = withData((r) => { for (const p of r.providers) if (p.readAt !== null) p.readAt = new Date(CLOUD_FIXTURE_NOW - HOURS_3).toISOString(); });
    const v = view(over);
    expect(v.head.status[0]).toContain('(en retard)');
    expect(v.head.level).toBe('nd');
    expect(v.head.figure).toMatchObject({ value: 'n.d.', level: null });
    for (const id of ['incidents', 'maintenances', 'ailleurs']) expect(visibleText(v.sections.find((s) => s.id === id)?.summary ?? '')).toBe('n.d.');
    const all = renderLayerView('x', { ...v, sections: v.sections.filter((s) => s.id !== 'referentiel' && s.id !== 'methode') });
    expect(all).not.toMatch(/fmk-dot--(vert|jaune|orange|rouge)|lp-lvl--(vert|jaune|orange|rouge)|var\(--sev-|var\(--cat-out/);
  });
  it('tous les fournisseurs en retard et aucun incident : « n.d. », jamais « aucun incident »', () => {
    const over = withData((r) => {
      r.incidents = [];
      for (const p of r.providers) if (p.readAt !== null) p.readAt = new Date(CLOUD_FIXTURE_NOW - HOURS_3).toISOString();
    });
    expect(sectionText(over, 'incidents')).toContain('n.d.');
    expect(sectionText(over, 'incidents')).not.toMatch(/aucun incident/i);
  });
  it('jamais lu : n.d., chaque erreur affichée, jamais « aucun incident »', () => {
    const errors = ['OVHcloud (network) : HTTP 503', 'Scaleway : HTTP 503'];
    const over = { cloud: { ...cloudFixtureResponse(), readAt: null, providers: [], incidents: [], maintenances: [], elsewhere: [], errors }, error: null };
    const v = view(over);
    expect(v.head.figure).toMatchObject({ value: 'n.d.', level: null });
    expect(v.head.level).toBe('nd');
    expect(v.head.status).toEqual(['pages d’état injoignables']);
    expect(v.sections).toEqual([]);
    for (const e of errors) expect(text(over)).toContain(e);
    expect(text(over)).not.toMatch(/aucun incident/i);
    expect(text({ cloud: null, error: 'source injoignable' })).toContain('source injoignable');
    expect(text({ cloud: null, error: 'source injoignable' })).toContain('Source injoignable');
  });
  it('collecte en cours (première lecture) : dite, sans encadré de panne', () => {
    const over = { cloud: { ...cloudFixtureResponse(), readAt: null, providers: [], incidents: [], maintenances: [], elsewhere: [], errors: ['Cloud : collecte en cours'] }, error: null };
    const v = view(over);
    expect(v.head.status).toEqual(['pages d’état : collecte en cours']);
    expect(v.bodyHtml).not.toContain('Source injoignable');
    expect(v.head.figure?.value).toBe('n.d.');
  });
  it('erreurs du serveur nommées sous l’en-tête, sauf la note de collecte et celles déjà dites par la ligne du fournisseur', () => {
    const v = view(withData((r) => {
      providerOf(r, 'ovhcloud').error = 'OVHcloud (network) : HTTP 503';
      r.errors = ['OVHcloud (network) : HTTP 503', 'PeeringDB : HTTP 500', 'Cloud : collecte en cours'];
    }));
    const body = visibleText(v.bodyHtml ?? '');
    expect(body).toContain('PeeringDB : HTTP 500');
    expect(body).not.toContain('collecte en cours');
    expect(body).not.toContain('OVHcloud (network)');
    expect(visibleText(providerBlock(withData((r) => { providerOf(r, 'ovhcloud').error = 'OVHcloud (network) : HTTP 503'; }), 'OVHcloud'))).toContain('OVHcloud (network) : HTTP 503');
    expect(v.sections).toHaveLength(6);
  });
  it('relève en échec avec des données gardées : sections gardées, encadré daté', () => {
    const v = view({ error: 'Scaleway : HTTP 503' });
    expect(v.sections).toHaveLength(6);
    expect(visibleText(v.bodyHtml ?? '')).toContain('Source injoignable. Dernières données :');
  });
  it('référentiel : daté « relu le », jamais « généré », aucune couleur ni statut de site', () => {
    const t = sectionText({}, 'referentiel');
    expect(t).toContain(`relu le 08/10 à 21${NBSP}h${NBSP}50`);
    expect(t).toContain('instantané OpenStreetMap sans date publiée');
    expect(t).not.toMatch(/généré|Non qualifié|Site existant|opérationnel/i);
    expect(section({}, 'referentiel')).not.toMatch(/fmk-dot--|lp-lvl--|var\(--sev-/);
    expect(sectionText(withData((r) => { r.reference.generatedAt = null; }), 'referentiel')).toContain('relu le n.d.');
  });
  it('référentiel vide : « aucun point d’échange » n’est pas inventé, comptes à zéro dits', () => {
    const over = withData((r) => { r.reference = { generatedAt: null, datacenters: [], exchanges: [] }; });
    const t = sectionText(over, 'referentiel');
    expect(t).toContain(`0${NBSP}centre`);
    expect(t).toContain(`0${NBSP}point d’échange`);
  });
  it('maintenances vides : section repliée par défaut, ligne dite', () => {
    const over = withData((r) => { r.maintenances = []; });
    expect(sectionText(over, 'maintenances')).toContain('Aucune maintenance');
    expect(view({ ...over, open: (_id, byDefault) => byDefault }).sections.find((s) => s.id === 'maintenances')?.open).toBe(false);
  });
  it('statuts en mots', () => {
    const words: Record<CloudStatus, string> = {
      operational: 'opérationnel', maintenance: 'maintenance', degraded: 'performances dégradées', partial: 'panne partielle', major: 'panne majeure', unknown: 'inconnu',
    };
    expect(CLOUD_STATUS_WORD).toEqual(words);
  });
  it('chargement : corps de chargement, aucune section', () => {
    const v = view({ cloud: null, error: null });
    expect(v.sections).toEqual([]);
    expect(v.bodyHtml).toContain('Chargement');
  });
});

describe('hygiène du rendu', () => {
  const hostile = (): CloudOutagesResponse => {
    const r = cloudFixtureResponse();
    r.incidents[0] = { ...r.incidents[0], title: '<script>x</script>', url: 'javascript:alert(1)', zones: ['<b>Z</b>'] };
    r.elsewhere[0] = { ...r.elsewhere[0], title: '<img src=x onerror=alert(1)>' };
    r.maintenances[0] = { ...r.maintenances[0], title: '<u>M</u>', zones: ['<i>Q</i>'] };
    providerOf(r, 'cloudflare').zones[0] = { ...providerOf(r, 'cloudflare').zones[0], label: '<s>L</s>' };
    r.reference.exchanges[0] = { ...r.reference.exchanges[0], name: '<em>IX</em>', city: '<big>V</big>', url: 'javascript:alert(2)' };
    r.errors = ['<strong>Y</strong>'];
    return r;
  };
  const variants: Array<Partial<CloudViewInput>> = [
    {}, { canFocus: false }, { cloud: hostile() }, { error: 'Scaleway : HTTP 503' }, { cloud: null, error: 'Scaleway : HTTP 503' }, { cloud: null },
    { now: Date.parse('2026-10-09T09:00:00Z') }, { now: Date.parse('2026-10-08T22:00:00Z') },
    withData((r) => { r.incidents = []; r.elsewhere = []; r.maintenances = []; }),
    withData((r) => { providerOf(r, 'ovhcloud').error = 'OVHcloud (network) : HTTP 503'; providerOf(r, 'scaleway').readAt = null; }),
    withData((r) => { for (const z of providerOf(r, 'ovhcloud').zones.slice(0, 11)) z.status = 'major'; }),
    withData((r) => { r.reference.exchanges = []; r.reference.datacenters = []; }),
  ];
  it('aucun tiret cadratin, aucune couleur brute, jamais « temps réel » ni « LIVE »', () => {
    for (const over of variants) {
      const h = html(over);
      expect(h).not.toMatch(/\u2014|&mdash;|#[0-9a-fA-F]{6}\b|rgba?\(/);
      expect(visibleText(h)).not.toMatch(/temps réel|TEMPS RÉEL|\bLIVE\b/i);
    }
  });
  it('R1 : aucune valeur coupée entre nombre et unité', () => {
    for (const over of variants) {
      const v = view(over);
      const texts = [v.head.figure?.caption ?? '', ...v.head.status, v.head.lead ?? '', visibleText(v.bodyHtml ?? ''),
        ...v.sections.map((s) => visibleText(`${s.summary ?? ''} ${s.html}`))];
      for (const t of texts) expect(breakableValue(t), t.slice(0, 80)).toBeNull();
    }
  });
  it('textes tiers échappés (titre d’incident, zone, maintenance, libellé de zone, point d’échange, erreur), lien dangereux écarté', () => {
    const h = html({ cloud: hostile() });
    for (const raw of ['<script>', '<img src=x', '<u>M</u>', '<s>L</s>', '<em>IX</em>', '<big>', '<strong>Y</strong>', '<b>Z</b>', '<i>Q</i>']) expect(h).not.toContain(raw);
    expect(h).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(h).not.toContain('javascript:');
  });
});
