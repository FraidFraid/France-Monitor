// src/components/layer-panel/veille-tabs.test.ts
import { describe, expect, it } from 'vitest';
import type { HealthSurveillanceState } from '../../services/health-surveillance.ts';
import { HEALTH_NOW, surveillanceFixture } from './health.fixture.ts';
import { renderLayerView } from './frame.ts';
import { NBSP, breakableValue, visibleText } from './format.ts';
import { buildVeilleView, bulletinsFor } from './veille-tabs.ts';
import { buildVeilleFranceView, type VeilleTab, type VeilleViewInput } from './veille.ts';

const open = (_: string, d: boolean): boolean => d;
const input = (over: Partial<VeilleViewInput> = {}): VeilleViewInput => ({ state: surveillanceFixture(), tab: 'outremer', now: HEALTH_NOW, open, ...over });
const view = (over: Partial<VeilleViewInput> = {}) => buildVeilleView(input(over));
const sectionOf = (tab: VeilleTab, id: string, state?: HealthSurveillanceState) =>
  view({ tab, ...(state ? { state } : {}) }).sections.find((s) => s.id === id);
function withState(edit: (s: HealthSurveillanceState) => void): HealthSurveillanceState {
  const s = surveillanceFixture();
  edit(s);
  return s;
}

describe('vue Veille sanitaire : onglets Outre-mer, International, Produits (spec 2026-10-03 § 3.1)', () => {
  it('aiguillage : France = vue de l’onglet France ; les autres onglets gardent l’en-tête, finissent par « Méthode et sources »', () => {
    expect(view({ tab: 'france' })).toEqual(buildVeilleFranceView(input({ tab: 'france' })));
    for (const tab of ['outremer', 'international', 'produits'] as const) {
      const v = view({ tab });
      expect(v.head).toEqual(view({ tab: 'france' }).head);
      expect(v.activeTab).toBe(tab);
      expect(v.tabs?.map((t) => t.id)).toEqual(['france', 'outremer', 'international', 'produits']);
      expect(v.sections.at(-1)?.id).toBe('method');
    }
    expect(view({ state: null, tab: 'produits' }).bodyHtml).toContain('Chargement des données…');
    expect(view({ state: null, tab: 'produits' }).activeTab).toBe('produits');
  });
  it('Outre-mer : cinq territoires, ouverts quand un signal atteint le jaune, résumé du signal', () => {
    expect(view({ tab: 'outremer' }).sections.map((s) => [s.id, s.title, s.open ?? false])).toEqual([
      ['drom-971', 'Guadeloupe', false], ['drom-972', 'Martinique', false], ['drom-973', 'Guyane', false],
      ['drom-974', 'La Réunion', true], ['drom-976', 'Mayotte', true], ['method', 'Méthode et sources', false],
    ]);
    expect(sectionOf('outremer', 'drom-974')?.summary).toBe(`IRA 5,7${NBSP}% · grippe 3,9${NBSP}%`);
    expect(sectionOf('outremer', 'drom-976')?.summary).toBe(`grippe en pré-épidémie · IRA 3,9${NBSP}%`);
    expect(sectionOf('outremer', 'drom-971')?.summary).toBe('pas de signal au-dessus des saisons précédentes');
  });
  it('Outre-mer : niveaux d’alerte en puces ou « hors saison » (S4), parts aux urgences avec niveau saisonnier, SOS absent dit', () => {
    const may = sectionOf('outremer', 'drom-976')?.html ?? '';
    expect(may).toMatch(/fmk-dot--jaune[^]*Grippe[^]*pré-épidémie[^]*semaine S39/);
    expect(may).toMatch(/Bronchiolite<\/span>[^]*hors saison[^]*dernière publication le 13\/04 : post-épidémie/);
    expect(may).toMatch(new RegExp(`fmk-dot--orange[^]*IRA[^]*3,9${NBSP}%[^]*des passages aux urgences · pas d’association SOS Médecins`));
    expect(may).toMatch(/Bronchiolite \(moins de 1 an\)[^]*n\.d\.[^]*pas de donnée publiée/);
    const mq = sectionOf('outremer', 'drom-972')?.html ?? '';
    expect(mq).toContain('dernière publication le 06/04 : épidémie');
    expect(mq).not.toContain('fmk-dot--orange');
  });
  it('Outre-mer : bulletins régionaux réels (titre et date), puce du niveau d’alerte quand il existe, neutre sinon', () => {
    const fixture = surveillanceFixture().alerts.data?.bulletins ?? [];
    expect(bulletinsFor('04', fixture).map((b) => b.territory)).toEqual(['Océan Indien']);
    expect(bulletinsFor('06', fixture).map((b) => b.territory)).toEqual(['Océan Indien']);
    expect(bulletinsFor('01', fixture).map((b) => b.territory)).toEqual(['Antilles']);
    expect(bulletinsFor('03', fixture).map((b) => b.territory)).toEqual(['Guyane']);
    const may = sectionOf('outremer', 'drom-976')?.html ?? '';
    expect(may).toMatch(/fmk-dot--jaune" aria-hidden="true"><\/span><span>Surveillance sanitaire à La Réunion et à Mayotte : point au 2 octobre[^]*02\/10/);
    expect(may).toContain('bulletin Santé publique France');
    expect(may).not.toContain('Épidémie saisonnière');
    const gp = sectionOf('outremer', 'drom-971')?.html ?? '';
    expect(gp).toContain('<span class="fmk-dot" aria-hidden="true"></span><span>Dengue aux Antilles : situation au 10 septembre</span>');
  });
  it('International : alertes OMS regroupées par épidémie (l’épisode hantavirus y figure), titre original en infobulle, lien officiel', () => {
    const s = sectionOf('international', 'who');
    expect(s?.summary).toBe('6 messages en 90 jours · dernier le 25/09');
    const h = s?.html ?? '';
    expect(h.match(/class="lp-row"/g)).toHaveLength(4);
    expect(h).toMatch(/title="Ebola disease caused by Bundibugyo virus - Democratic Republic of the Congo"[^]*Ebola \(virus Bundibugyo\), République démocratique du Congo[^]*25\/09[^]*OMS, DON618[^]*7 messages depuis le 03\/07/);
    expect(h).toMatch(/Hantavirus lié à une croisière, plusieurs pays[^]*02\/07[^]*OMS, DON611/);
    expect(h).toContain('href="https://www.who.int/emergencies/disease-outbreak-news/item/2026-DON618"');
    expect(h.indexOf('Hantavirus')).toBeLessThan(h.indexOf('Virus Nipah'));
    expect(h.indexOf('Virus Nipah')).toBeLessThan(h.indexOf('Fièvre jaune'));
  });
  it('International : même maladie dans deux pays sans pays commun, deux lignes (aucun pays masqué) ; la série Ebola reste groupée', () => {
    const h5 = (n: number, date: string, country: string, fr: string) => ({
      id: `2026-DON${n}`, title: `Grippe aviaire A(H5N1), ${fr}`, originalTitle: `Avian Influenza A(H5N1) - ${country}`, date,
      url: `https://www.who.int/emergencies/disease-outbreak-news/item/2026-DON${n}`, summary: '',
    });
    const state = withState((s) => {
      if (s.international.data) s.international.data.who.push(h5(620, '2026-09-30', 'Mexico', 'Mexique'), h5(619, '2026-09-20', 'Cambodia', 'Cambodge'));
    });
    const h = sectionOf('international', 'who', state)?.html ?? '';
    expect(h).toMatch(/Grippe aviaire A\(H5N1\), Mexique[^]*30\/09[^]*OMS, DON620<\/a><\/small>/);
    expect(h).toMatch(/Grippe aviaire A\(H5N1\), Cambodge[^]*20\/09[^]*OMS, DON619<\/a><\/small>/);
    expect(h).not.toContain('2 messages depuis le 20/09');
    expect(h).toMatch(/Ebola \(virus Bundibugyo\), République démocratique du Congo<[^]*7 messages depuis le 03\/07/);
  });
  it('International : trois rapports hebdomadaires de l’ECDC, semaine et sujets', () => {
    const s = sectionOf('international', 'ecdc');
    expect(s?.summary).toBe('semaine 40 · 02/10');
    const h = s?.html ?? '';
    expect(h).toMatch(/Semaine 40[^]*02\/10[^]*Ebola, grippe aviaire, virus du Nil occidental/);
    expect(h).toContain('Semaine 38');
    expect(h).toContain('title="Communicable disease threats report, 26 September - 2 October, week 40"');
  });
  it('Produits : médicaments, barre ruptures rouge et tensions orange, domaines, dernières entrées, remises et arrêts, MITM', () => {
    const s = sectionOf('produits', 'drugs');
    expect(s?.summary).toBe('180 situations actives · 47 ruptures');
    const h = s?.html ?? '';
    expect(h).toContain('<div class="lp-mix" role="img" aria-label="47 ruptures et 133 tensions"><i style="width:26.1%;background:var(--sev-red)"></i><i style="width:73.9%;background:var(--sev-orange)"></i></div>');
    expect(h).toMatch(/fmk-dot--rouge[^]*Ruptures[^]*47[^]*fmk-dot--orange[^]*Tensions[^]*133/);
    expect(h).toMatch(/Infectiologie[^]*25[^]*Psychiatrie[^]*22[^]*Cardiologie[^]*21/);
    expect(h).toMatch(/fmk-dot--rouge[^]*Plerixafor Arrow 20 mg\/mL[^]*02\/10[^]*rupture depuis le 23\/09 · Hématologie/);
    expect(h.indexOf('Mytélase')).toBeLessThan(h.indexOf('Kétoprofène Pharmy II'));
    expect(h).toMatch(/Remises à disposition[^]*99/);
    expect(h).toMatch(/Arrêts de commercialisation[^]*17/);
    expect(h).toContain('Médicaments d’intérêt thérapeutique majeur en difficulté (ANSM)');
    expect(h).toContain('href="https://ansm.sante.fr/documents/reference/medicaments-dinteret-therapeutique-majeur-mitm"');
  });
  it('Produits : rappels sur 14 jours, comptes par risque en puces de gravité, dix derniers à risque avec lien', () => {
    const s = sectionOf('produits', 'recalls');
    expect(s?.summary).toBe('56 à risque sanitaire en 14 jours');
    const h = s?.html ?? '';
    expect(h).toMatch(/Rappels publiés \(14 jours\)[^]*88[^]*dont risque infectieux ou allergène[^]*56/);
    expect(h).toMatch(/fmk-dot--rouge[^]*Salmonelles[^]*26[^]*fmk-dot--rouge[^]*Listeria[^]*21[^]*fmk-dot--orange[^]*E\. coli STEC[^]*6[^]*fmk-dot--jaune[^]*Allergènes non déclarés[^]*3/);
    expect(h.match(/class="lp-row"/g)).toHaveLength(10);
    expect(h).toMatch(/Haché de veau façon bouchère[^]*02\/10[^]*salmonelles · carrefour le marché · France entière/);
    expect(h).toContain('href="https://rappel.conso.gouv.fr/fiche-rappel/23689/interne"');
    expect(h).toMatch(/Saucisson sec[^]*salmonelles, listeria/);
  });
  it('ANSM et RappelConso en retard : barre retirée (jamais grise), puces grises, « (en retard) »', () => {
    const state = withState((s) => {
      if (s.drugs.data) s.drugs.data.latestUpdate = '2026-09-20';
      if (s.recalls.data) {
        for (const r of s.recalls.data.latest) r.date = '2026-09-25T08:00:00Z';
        s.recalls.data.byDay = [];
      }
    });
    const d = sectionOf('produits', 'drugs', state);
    expect(d?.summary).toBe('180 situations actives · 47 ruptures (en retard)');
    expect(d?.html).not.toContain('lp-mix');
    expect(d?.html).not.toMatch(/fmk-dot--(rouge|orange)/);
    const r = sectionOf('produits', 'recalls', state);
    expect(r?.summary).toBe('56 à risque sanitaire en 14 jours (en retard)');
    expect(r?.html).not.toMatch(/fmk-dot--(rouge|orange|jaune)/);
  });
  it('sources en échec sans donnée : sections dites indisponibles (S3), compteurs n.d.', () => {
    const state = withState((s) => {
      s.international = { data: null, error: 'HTTP 500', fetchedAt: null };
      s.drugs = { data: null, error: 'HTTP 502', fetchedAt: null };
      s.syndromic = { data: null, error: 'HTTP 500', fetchedAt: null };
    });
    expect(sectionOf('international', 'who', state)?.html).toContain('Source indisponible : OMS, Disease Outbreak News.');
    expect(sectionOf('international', 'ecdc', state)?.html).toContain('Source indisponible : ECDC, rapport hebdomadaire des menaces.');
    expect(sectionOf('produits', 'drugs', state)?.html).toContain('Source indisponible : ANSM, disponibilité des médicaments.');
    expect(sectionOf('outremer', 'drom-974', state)?.html).toContain('Source indisponible : surveillance des urgences (Odissé).');
    expect(view({ tab: 'international', state }).tabs?.find((t) => t.id === 'international')?.count ?? null).toBeNull();
    expect(view({ tab: 'produits', state }).tabs?.find((t) => t.id === 'produits')?.count ?? null).toBeNull();
  });
  it('panne partielle, OMS en échec et ECDC lu : section OMS indisponible (jamais « aucun message »), compteur n.d., ECDC listé', () => {
    const state = withState((s) => {
      if (s.international.data) s.international.data = { ...s.international.data, who: [], errors: ['OMS, Disease Outbreak News : HTTP 503'] };
    });
    const who = sectionOf('international', 'who', state);
    expect(who?.summary).toBe('n.d.');
    expect(who?.html).toContain('Source indisponible : OMS, Disease Outbreak News.');
    expect(who?.html).not.toContain('Aucun message');
    expect(sectionOf('international', 'ecdc', state)?.html).toContain('Semaine 40');
    expect(view({ tab: 'international', state }).tabs?.find((t) => t.id === 'international')?.count ?? null).toBeNull();
  });
  it('panne partielle, ECDC en échec et OMS lu : section ECDC indisponible', () => {
    const state = withState((s) => {
      if (s.international.data) s.international.data = { ...s.international.data, ecdc: [], errors: ['ECDC, rapport hebdomadaire des menaces : HTTP 500'] };
    });
    expect(sectionOf('international', 'ecdc', state)?.html).toContain('Source indisponible : ECDC, rapport hebdomadaire des menaces.');
    expect(sectionOf('international', 'ecdc', state)?.html).not.toContain('Aucun rapport');
    expect(sectionOf('international', 'who', state)?.html).toContain('OMS, DON618');
  });
  it('panne partielle outre-mer : alertes Odissé, page régionale d’un bassin, valeurs départementales d’un syndrome dites indisponibles', () => {
    const state = withState((s) => {
      if (s.alerts.data) {
        s.alerts.data = {
          ...s.alerts.data, levels: [], latestWeek: null, bulletins: s.alerts.data.bulletins.filter((b) => b.territory !== 'Océan Indien'),
          errors: ['Odissé, niveaux d’alerte : HTTP 429', 'Santé publique France, page Océan Indien : HTTP 503'],
        };
      }
      const syn = s.syndromic.data;
      if (syn) {
        syn.errors = ['Odissé, Grippe départements : HTTP 500'];
        for (const dep of syn.departments) delete dep.values.grippe;
      }
    });
    const reunion = sectionOf('outremer', 'drom-974', state)?.html ?? '';
    expect(reunion).toContain('Source indisponible : niveaux d’alerte Odissé.');
    expect(reunion).toContain('Source indisponible : bulletins Santé publique France (Océan Indien).');
    expect(reunion).not.toContain('Aucun bulletin régional');
    expect(reunion).toMatch(/<span>Grippe<\/span>[^]*n\.d\.[^]*source indisponible/);
    expect(reunion).not.toContain('aucune publication');
    const guadeloupe = sectionOf('outremer', 'drom-971', state)?.html ?? '';
    expect(guadeloupe).toContain('Dengue aux Antilles : situation au 10 septembre');
    expect(guadeloupe).not.toContain('bulletins Santé publique France (');
  });
  it('panne partielle produits : ANSM ou RappelConso nommés en échec, section indisponible, compteur n.d.', () => {
    const state = withState((s) => {
      if (s.drugs.data) {
        s.drugs.data = { ...s.drugs.data, items: [], counts: { rupture: 0, tension: 0, remise: 0, arret: 0 }, latestUpdate: null,
          errors: ['ANSM, disponibilités des médicaments : aucun statut reconnu'] };
      }
      if (s.recalls.data) s.recalls.data = { ...s.recalls.data, total: 0, healthRisk: 0, byRisk: {}, latest: [], errors: ['RappelConso : HTTP 500'] };
    });
    expect(sectionOf('produits', 'drugs', state)?.html).toContain('Source indisponible : ANSM, disponibilité des médicaments.');
    expect(sectionOf('produits', 'recalls', state)?.html).toContain('Source indisponible : RappelConso.');
    expect(sectionOf('produits', 'recalls', state)?.html).not.toContain('Aucun rappel');
    expect(view({ tab: 'produits', state }).tabs?.find((t) => t.id === 'produits')?.count ?? null).toBeNull();
  });
  it('textes hostiles échappés ; R1 ; aucun tiret cadratin, aucune police à chasse fixe, aucune couleur brute', () => {
    const evil = '<img src=x onerror=1>';
    const state = withState((s) => {
      if (s.international.data) {
        s.international.data.who[0].title = evil;
        s.international.data.ecdc[0].topics = [evil];
      }
      if (s.drugs.data) s.drugs.data.items[0].name = evil;
      if (s.recalls.data) s.recalls.data.latest[0].brand = evil;
      if (s.alerts.data) s.alerts.data.bulletins[0].title = evil;
      // Champs tiers affichés en note ou en infobulle : titre original OMS (attribut), domaines ANSM, zone et risques RappelConso,
      // résumé d'un bulletin régional.
      if (s.international.data) s.international.data.who[0].originalTitle = `"${evil}`;
      if (s.drugs.data) s.drugs.data.items[0].domains = [evil, `"${evil}`];
      if (s.recalls.data) {
        s.recalls.data.latest[0].zone = evil;
        s.recalls.data.latest[1].risks = [];
        s.recalls.data.latest[1].riskText = evil;
      }
      if (s.alerts.data) s.alerts.data.bulletins[1].summary = evil;
    });
    const intl = renderLayerView('health', view({ tab: 'international', state }));
    expect(intl).toContain('title="&quot;&lt;img src=x onerror=1&gt;"');
    const produits = renderLayerView('health', view({ tab: 'produits', state }));
    expect(produits).toContain('<small>&lt;img src=x onerror=1&gt; · maitre coq · France entière · ');
    expect(produits).toContain('salmonelles · &lt;img src=x onerror=1&gt; · &lt;img src=x onerror=1&gt; · ');
    expect(produits).toContain('rupture depuis le 23/09 · &lt;img src=x onerror=1&gt; · &quot;&lt;img src=x onerror=1&gt;</small>');
    expect(renderLayerView('health', view({ tab: 'outremer', state }))).toContain('&lt;img src=x onerror=1&gt; · <a class="lp-link"');
    for (const tab of ['outremer', 'international', 'produits'] as const) {
      expect(renderLayerView('health', view({ tab, state }))).not.toContain('<img');
      const h = renderLayerView('health', view({ tab }));
      expect(breakableValue(visibleText(h))).toBeNull();
      expect(h).not.toMatch(/\u2014|&mdash;|monospace|#[0-9a-fA-F]{6}\b|rgba?\(/);
    }
  });
});
