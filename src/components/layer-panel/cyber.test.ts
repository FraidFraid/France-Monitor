// src/components/layer-panel/cyber.test.ts
// Vue Vigilance cyber (spec 2026-10-04 souveraineté § 2.3 ; contrats § 4.1 ; amendement 7 : O1 à O5, S10 à S13) sur la collecte du
// 04/10 : statut officiel des alertes CERT-FR repris tel quel, exploitation signalée par le CERT-FR citée telle quelle, vulnérabilités
// du catalogue KEV de la CISA, revendications agrégées et non confirmées (V3, jaune au plus), fuites en compte et lien seulement,
// rapports Menaces et incidents de l'ANSSI, contacts en cas d'incident.
import { describe, expect, it } from 'vitest';
import type { CertFrItem, CyberResponse } from '../../types/index.ts';
import { certfrAgeDays, cyberLevel, isCertFrAlertOpen } from '../../services/sovereignty-levels.ts';
import { CYBER_FIXTURE, SOV_FIXTURE_NOW } from './sovereignty.fixture.ts';
import { NBSP, breakableValue, visibleText } from './format.ts';
import { renderLayerView } from './frame.ts';
import { trafficBreakable } from './traffic-format.ts';
import { glueSovUnits, sovBreakable } from './sovereignty-format.ts';
import { CYBER_TITLE, buildCyberView, kevAgeDays, type CyberViewInput } from './cyber.ts';

const NOW = SOV_FIXTURE_NOW;
const HOUR = 3_600_000;
const open = (_: string, d: boolean): boolean => d;
const input = (over: Partial<CyberViewInput> = {}): CyberViewInput => ({ cyber: CYBER_FIXTURE(), cyberError: null, now: NOW, open, ...over });
const view = (over: Partial<CyberViewInput> = {}) => buildCyberView(input(over));
const html = (over: Partial<CyberViewInput> = {}): string => renderLayerView('cyber', view(over));
const sectionOf = (id: string, over: Partial<CyberViewInput> = {}) => view(over).sections.find((s) => s.id === id);
const cyber = (edit: (c: CyberResponse) => void): CyberResponse => {
  const c = CYBER_FIXTURE();
  edit(c);
  return c;
};
const alertOf = (c: CyberResponse, ref: string): CertFrItem => {
  const found = c.certfr.alerts.find((a) => a.ref === ref);
  if (!found) throw new Error(`${ref} absente du jeu d’essai`);
  return found;
};
const ale011 = (c: CyberResponse): CertFrItem => alertOf(c, 'CERTFR-2026-ALE-011');

describe('vue Vigilance cyber (spec 2026-10-04 souveraineté § 2.3, amendement 7)', () => {
  it('O1, O2 : en-tête du 04/10 : 3 alertes CERT-FR en cours (statut officiel), la plus récente nommée ; pastille orange reprise de cyberLevel (ALE-011)', () => {
    const c = CYBER_FIXTURE();
    expect(c.certfr.alerts.filter(isCertFrAlertOpen).map((a) => a.ref).sort()).toEqual([
      'CERTFR-2026-ALE-009', 'CERTFR-2026-ALE-010', 'CERTFR-2026-ALE-011',
    ]);
    expect(cyberLevel(c, NOW).level).toBe('orange');
    const v = view();
    expect(v.head).toMatchObject({ theme: 'Souveraineté', title: CYBER_TITLE, level: 'orange' });
    expect(v.head.figure).toEqual({
      value: '3', caption: 'alertes CERT-FR en cours · la plus récente : Citrix NetScaler ADC et Gateway, publiée le 28/09 · 24 avis sur 7 jours',
    });
    expect(v.head.status[0]).toBe(glueSovUnits(cyberLevel(c, NOW).reason));
    expect(v.head.status[0]).toContain('CERTFR-2026-ALE-011 en cours, publiée le 28/09 : exploitation signalée par le CERT-FR');
    expect(v.head.status[1]).toMatch(/^CERT-FR\u00A0\d\d:\d\d · CISA KEV\u00A0\d\d:\d\d · Ransomware\.live\u00A0\d\d:\d\d$/);
    // Les chiffres des revendications sont datés par la publication du fichier (lastModified 14:30:09Z), pas par la lecture.
    expect(v.head.status[1]).toContain('Ransomware.live\u00A016:30');
    expect(v.head.lead).toBe('5 vulnérabilités exploitées ajoutées au catalogue KEV de la CISA en 7 jours, dont 3 citées par le CERT-FR : '
      + 'Fortinet FortiMail, Cisco Catalyst SD-WAN Manager, Apple (plusieurs produits).');
    expect(html()).toContain('<b class="fmk-num lp-lvl lp-lvl--orange">3</b>');
  });
  it('O2 : la pastille est toujours celle de cyberLevel, jamais recalculée (variantes)', () => {
    const variants: Array<Partial<CyberViewInput>> = [
      {}, { now: NOW + 7 * HOUR },
      { cyber: cyber((x) => { x.certfr.alerts = x.certfr.alerts.filter((a) => a.ref !== 'CERTFR-2026-ALE-011'); }) },
      { cyber: cyber((x) => { x.certfr.alerts = []; }) },
      { cyber: cyber((x) => { ale011(x).status = null; }) },
      { cyber: cyber((x) => { x.certfr = { readAt: null, alerts: [], avis: [], reports: [] }; }) },
    ];
    for (const over of variants) {
      const i = input(over);
      if (i.cyber === null) throw new Error('variante sans réponse');
      expect(buildCyberView(i).head.level).toBe(cyberLevel(i.cyber, i.now).level);
      expect(buildCyberView(i).head.status[0]).toBe(glueSovUnits(cyberLevel(i.cyber, i.now).reason));
    }
  });
  it('sections et ouverture du contrat (rapports de l’ANSSI ajoutés, S12) ; méthode en ton de référence', () => {
    expect(view().sections.map((s) => [s.id, s.open ?? false])).toEqual([
      ['certfr', true], ['kev', true], ['revendications', true], ['rapports', false], ['fuites', false], ['cybermalveillance', false], ['methode', false],
    ]);
    expect(view().sections.at(-1)?.tone).toBe('reference');
    expect(view().sections.find((s) => s.id === 'kev')?.title).toBe('Vulnérabilités exploitées (catalogue KEV de la CISA)');
  });
  it('O1, O3 : alertes du plus récent au plus ancien (publication) ; statut officiel ; exploitation citée telle quelle ; KEV en appui ; puces des seuils de la pastille', () => {
    const s = sectionOf('certfr');
    expect(s?.summary).toBe('6 alertes sur 90 jours, dont 3 en cours · 24 avis sur 7 jours');
    const h = s?.html ?? '';
    const refs = [...h.matchAll(/CERTFR-2026-ALE-0(\d\d)/g)].map((m) => m[1]);
    expect([...new Set(refs)]).toEqual(['11', '10', '09', '08', '07', '06']);
    // Alerte en cours publiée depuis moins de 7 jours : orange (règle de la pastille, O2).
    expect(h).toContain('<span class="fmk-dot fmk-dot--orange" aria-hidden="true"></span><span>Alerte : Citrix NetScaler ADC et Gateway</span>'
      + '<span class="lp-val fmk-num">en cours</span><small>CERTFR-2026-ALE-011 · publiée le 28/09 · dernière version le 30/09 · '
      + 'exploitation signalée par le CERT-FR : « Ces vulnérabilités sont activement exploitées et les exploitations ont commencé avant la disponibilité des correctifs. » · '
      + 'inscrites au catalogue KEV de la CISA le 27/09 : CVE-2026-88771, CVE-2026-88772 · ');
    expect(h).toContain('href="https://www.cert.ssi.gouv.fr/alerte/CERTFR-2026-ALE-011/"');
    // En cours depuis 7 jours ou plus : jaune ; phrases des pages lues le 04/10 citées telles quelles (compromissions connues pour ALE-010,
    // exploitation dite par l'éditeur pour ALE-009) ; sans vulnérabilité du catalogue : « non inscrite au catalogue KEV ».
    expect(h).toContain('<span class="fmk-dot fmk-dot--jaune" aria-hidden="true"></span><span>Alerte : Metabase</span><span class="lp-val fmk-num">en cours</span>'
      + '<small>CERTFR-2026-ALE-010 · publiée le 10/09 · exploitation signalée par le CERT-FR : '
      + '« Le CERT-FR a connaissance de nombreuses compromissions de Metabase vulnérables. » · non inscrite au catalogue KEV · ');
    expect(h).toContain('<span class="fmk-dot fmk-dot--jaune" aria-hidden="true"></span><span>Alerte : SonicWall Secure Mobile Access</span>'
      + '<span class="lp-val fmk-num">en cours</span><small>CERTFR-2026-ALE-009 · publiée le 02/09 · exploitation signalée par le CERT-FR : '
      + '« L&#39;éditeur indique que ces deux vulnérabilités sont activement exploitées, sans préciser s&#39;il est possible pour un attaquant non '
      + 'authentifié de chaîner l&#39;exploitation de ces deux vulnérabilités pour prendre la main sur l&#39;équipement. » · '
      + 'inscrite au catalogue KEV de la CISA : CVE-2026-83548 · ');
    // Close : grise, « clôturée le JJ/MM » ; la phrase qui attribue l'exploitation à l'éditeur est citée telle quelle.
    expect(h).toContain('<span class="fmk-dot" aria-hidden="true"></span><span>Alerte : Microsoft Sharepoint</span><span class="lp-val fmk-num">clôturée le 22/09</span>'
      + '<small>CERTFR-2026-ALE-008 · publiée le 22/07 · dernière version le 22/09 · exploitation signalée par le CERT-FR : '
      + '« Dans son avis du 14 juillet 2026, Microsoft a indiqué que la vulnérabilité CVE-2026-58644 est activement exploitée. » · ');
    const t = visibleText(h);
    expect(t).toContain('Statut repris du CERT-FR : en cours, ou clôturée le JJ/MM. Une clôture « ne signifie pas la fin d’une menace » (CERT-FR).');
    expect(t).not.toMatch(/ne publie pas de statut|pas d’exploitation connue|pas d'exploitation connue|exploitée \(CISA/);
  });
  it('O3 : alerte sans exploitation dite ni vulnérabilité du catalogue : « non inscrite au catalogue KEV » ; page non lue : dite', () => {
    const quiet = cyber((x) => { Object.assign(alertOf(x, 'CERTFR-2026-ALE-010'), { exploited: false, exploitedQuote: null }); });
    expect(sectionOf('certfr', { cyber: quiet })?.html).toContain('<small>CERTFR-2026-ALE-010 · publiée le 10/09 · non inscrite au catalogue KEV · <a ');
    const unread = cyber((x) => { Object.assign(alertOf(x, 'CERTFR-2026-ALE-010'), { exploited: null, exploitedQuote: null }); });
    expect(sectionOf('certfr', { cyber: unread })?.html).toContain('<small>CERTFR-2026-ALE-010 · publiée le 10/09 · page non lue · non inscrite au catalogue KEV · <a ');
  });
  it('O1 : statut non lu : « statut non lu », puce grise, pastille n.d. de cyberLevel, compte dit dans la légende du chiffre', () => {
    const c = cyber((x) => { ale011(x).status = null; });
    const v = view({ cyber: c });
    expect(v.head.level).toBe('nd');
    expect(v.head.status[0]).toBe('non évalué · statut de CERTFR-2026-ALE-011 non lu');
    expect(v.head.figure).toEqual({
      value: '2', caption: 'alertes CERT-FR en cours · la plus récente : Metabase, publiée le 10/09 · 24 avis sur 7 jours · 1 alerte au statut non lu',
    });
    expect(sectionOf('certfr', { cyber: c })?.html).toContain('<span class="fmk-dot" aria-hidden="true"></span><span>Alerte : Citrix NetScaler ADC et Gateway</span>'
      + '<span class="lp-val fmk-num">statut non lu</span>');
    expect(html({ cyber: c })).not.toMatch(/lp-lvl--\w+">2<\/b>/);
  });
  it('avis : AVI-1257 (FortiMail, 02/10) jaune, vulnérabilité au catalogue KEV le 01/10 ; 12 avis affichés, les autres repliés', () => {
    const h = sectionOf('certfr')?.html ?? '';
    expect(h).toContain('<span class="fmk-dot fmk-dot--jaune" aria-hidden="true"></span><span>Avis : Fortinet FortiMail</span><span class="lp-val fmk-num">02/10</span>'
      + '<small>CERTFR-2026-AVI-1257 · inscrite au catalogue KEV de la CISA le 01/10 : CVE-2026-104286 · ');
    // Arbitrage du contrôleur : un avis hors catalogue ne porte aucune mention ; la section le dit une fois.
    expect(h).toContain('<span aria-hidden="true"></span><span>Avis : les produits IBM</span><span class="lp-val fmk-num">02/10</span><small>CERTFR-2026-AVI-1256 · <a ');
    const t = visibleText(h);
    expect(t).toContain('Avis des 30 derniers jours ; sans mention : non inscrite au catalogue KEV.');
    expect(t.match(/non inscrite au catalogue KEV/g)).toHaveLength(2);   // ALE-010 et la note des avis
    expect(t).not.toMatch(/pas d’exploitation connue|pas d'exploitation connue/);
    expect(h).toContain('<details class="lp-more"><summary>26 avis de plus</summary>');
    expect(h.match(/<span>Avis : /g)).toHaveLength(38);
  });
  it('S13 : contacts en cas d’incident, liés, même quand le CERT-FR est en panne', () => {
    const line = 'En cas d’incident : CERT-FR (administrations, OIV, OSE), CSIRT territorial de la région, 17Cyber.';
    const h = sectionOf('certfr')?.html ?? '';
    expect(visibleText(h)).toContain(line);
    expect(h).toContain('href="https://www.cert.ssi.gouv.fr/contact/"');
    expect(h).toContain('href="https://www.cert.ssi.gouv.fr/csirt/csirt-territoriaux/"');
    expect(h).toContain('href="https://17cyber.gouv.fr/"');
    const down = cyber((x) => { x.certfr = { readAt: null, alerts: [], avis: [], reports: [] }; });
    expect(visibleText(sectionOf('certfr', { cyber: down })?.html ?? '')).toContain(line);
  });
  it('S10 : vulnérabilités exploitées : 7 et 30 jours, citées par le CERT-FR d’abord, campagne de rançongiciel dite ; courbe hebdomadaire sur 12 semaines', () => {
    const c = CYBER_FIXTURE();
    expect(c.kev.recent.filter((k) => kevAgeDays(k, NOW) < 7).map((k) => k.cve).sort()).toEqual([
      'CVE-2026-102489', 'CVE-2026-102490', 'CVE-2026-104286', 'CVE-2026-76504', 'CVE-2026-86950',
    ]);
    const s = sectionOf('kev');
    expect(s?.summary).toBe(`5 sur 7 jours · ${c.kev.recent.length} sur 30 jours`);
    const h = s?.html ?? '';
    expect(h).toMatch(/var\(--cat-kev-cite\)" aria-hidden="true"><\/span><span>Citrix NetScaler<\/span><span class="lp-val fmk-num">27\/09<\/span><small>CVE-2026-88771 · citée par le CERT-FR \([^)]*ALE-011[^)]*\)<\/small>/);
    expect(h).toMatch(/var\(--cat-kev\)" aria-hidden="true"><\/span><span>Zammad GmbH Zammad<\/span><span class="lp-val fmk-num">02\/10<\/span><small>CVE-2026-10248\d · catalogue mondial, non citée par le CERT-FR<\/small>/);
    expect(h).toContain('<span>Apple (plusieurs produits)</span>');
    expect(h.indexOf('citée par le CERT-FR (')).toBeLessThan(h.indexOf('catalogue mondial'));
    expect(h).toContain('aria-label="Vulnérabilités ajoutées au catalogue KEV de la CISA par semaine, sur 12 semaines, celles citées par le CERT-FR en couleur foncée"');
    expect(h).toContain('fill="var(--cat-kev-cite)"');
    expect(visibleText(h)).toContain('version 2026.10.02 du 02/10/2026, 1\u202F733 vulnérabilités');
    const marked = cyber((x) => { x.kev.recent[0] = { ...x.kev.recent[0], ransomware: true }; });
    expect(visibleText(sectionOf('kev', { cyber: marked })?.html ?? '')).toContain('CVE-2026-104286 · citée par le CERT-FR (AVI-1257) · campagne de rançongiciel connue');
  });
  it('S10 : « vulnérabilité » partout, jamais « faille » dans les textes de la vue (titres de tiers mis à part)', () => {
    // Titres publiés par des tiers retirés : Cybermalveillance.gouv.fr et le rapport CERTFR-2024-CTI-005 (« Failles sur les équipements… »).
    const own = cyber((x) => { x.cybermalveillance = null; x.certfr.reports = x.certfr.reports.filter((r) => !/faille/i.test(r.title)); });
    expect(visibleText(html({ cyber: own }))).not.toMatch(/faille/i);
    expect(visibleText(html({ cyber: own, now: NOW + 7 * HOUR }))).not.toMatch(/faille/i);
  });
  it('S11, O4 : revendications en France : courbe, moyenne en tirets, rapport, écart des 30 jours, secteurs traduits, groupes cybercriminels, contexte de l’ANSSI, lien renommé et source liée', () => {
    const s = sectionOf('revendications');
    expect(s?.summary).toBe('7 en 7 jours · 25 en 30 jours');
    const h = s?.html ?? '';
    const t = visibleText(h);
    expect(h).toContain('aria-label="Revendications de rançongiciels en France par semaine, sur 12 semaines ; moyenne des 90 jours précédents en tirets"');
    expect(h).toContain('stroke-dasharray="4 3"');
    expect(h).toContain('stroke="var(--cat-revendication)"');
    expect(t).toContain('Fichier publié par ransomware.live à 16:30, lu à 16:48 : comptes de ce fichier.');
    expect(t).toContain('Cette semaine7 · 1,29 fois la moyenne');
    expect(t).toContain('Moyenne hebdomadaire (90 jours précédents)5,4');
    expect(t).toContain(`30 derniers jours25 · +21${NBSP}% par rapport à la moyenne`);
    expect(t).toContain('autre secteur');
    expect(t).toContain('santé');
    expect(t).not.toMatch(/Healthcare|Technology|Not Found|\bOther\b/);
    expect(t).toContain('Groupes cybercriminels sur 30 jours');
    expect(t).toContain('ZaWoo');
    expect(t).toContain('Annonces publiées par des groupes cybercriminels : revendiquées par le groupe, non confirmées.');
    expect(t).not.toMatch(/groupes? criminels?/);
    expect(t).toContain('En 2025, 128 compromissions par rançongiciel ont été portées à la connaissance de l’ANSSI (Panorama de la cybermenace 2025) : '
      + 'les revendications ne sont pas ce décompte.');
    expect(h).toContain('href="https://www.cert.ssi.gouv.fr/uploads/CERTFR-2026-CTI-002.pdf"');
    expect(h).toContain('<a class="lp-link" href="https://www.ransomware.live/country/FR" target="_blank" rel="noopener noreferrer">'
      + 'liste publique des revendications (ransomware.live), non confirmées</a>');
    expect(h).not.toContain('détail sur ransomware.live');
    expect(h).toContain('<a class="lp-link" href="https://www.ransomware.live" target="_blank" rel="noopener noreferrer">Source : Ransomware.live</a>');
    expect(html()).not.toMatch(/victime-\d|\.onion/);
  });
  it('fichier de ransomware.live en retard (24 h après sa publication) : dit, sans couleur', () => {
    const late = cyber((x) => { if (x.ransomware) x.ransomware = { ...x.ransomware, lastModified: '2026-10-03T12:00:00Z', ratio: 2.1 }; });
    const s = sectionOf('revendications', { cyber: late });
    expect(s?.summary).toBe('7 en 7 jours · 25 en 30 jours (en retard)');
    expect(visibleText(s?.html ?? '')).toContain('Fichier publié par ransomware.live le 03/10 à 14:00 (en retard), lu à 16:48 : comptes de ce fichier.');
    expect(s?.html).not.toMatch(/lp-lvl--/);
    // La pastille suit cyberLevel : l'alerte en cours garde l'orange ; seules, les revendications d'un fichier en retard ne colorent pas.
    expect(view({ cyber: late }).head.level).toBe('orange');
    const alone = cyber((x) => {
      if (x.ransomware) x.ransomware = { ...x.ransomware, lastModified: '2026-10-03T12:00:00Z', ratio: 2.1 };
      x.certfr.alerts = [];
      x.certfr.avis = x.certfr.avis.map((a) => ({ ...a, kevCves: [] }));
    });
    const v = view({ cyber: alone });
    expect(v.head.level).toBe('vert');
    expect(v.head.status[0]).toBe(glueSovUnits(cyberLevel(alone, NOW).reason));
    expect(v.head.status[0]).toContain('hausse des revendications non retenue : fichier de ransomware.live en retard');
    expect(html({ cyber: alone })).not.toMatch(/lp-lvl--(?:jaune|orange|rouge)/);
  });
  it('catalogue KEV en retard (26 h) : la phrase d’appui de l’en-tête est datée et dite en retard', () => {
    const late = cyber((x) => { x.kev.readAt = '2026-10-03T12:00:00Z'; });
    expect(view({ cyber: late }).head.lead).toBe('5 vulnérabilités exploitées ajoutées au catalogue KEV de la CISA en 7 jours, dont 3 citées par le CERT-FR : '
      + 'Fortinet FortiMail, Cisco Catalyst SD-WAN Manager, Apple (plusieurs produits) (catalogue lu le 03/10 à 14:00, en retard).');
    expect(view().head.lead).not.toContain('en retard');
  });
  it('date d’ajout au catalogue dans le futur : âge négatif, jamais comptée « sur 7 jours »', () => {
    const future = cyber((x) => { x.kev.recent.push({ ...x.kev.recent[0], cve: 'CVE-2026-999999', dateAdded: '2026-10-06', certfrRefs: [] }); });
    expect(kevAgeDays({ dateAdded: '2026-10-06' }, NOW)).toBe(-2);
    expect(sectionOf('kev', { cyber: future })?.summary).toBe(`5 sur 7 jours · ${future.kev.recent.length} sur 30 jours`);
    expect(view({ cyber: future }).head.lead).toMatch(/^5 vulnérabilités exploitées ajoutées/);
  });
  it('S12 : rapports Menaces et incidents de l’ANSSI : titre, date et lien ; 6 affichés, les autres repliés ; langue dite', () => {
    const s = sectionOf('rapports');
    expect(s?.title).toBe('Rapports Menaces et incidents (ANSSI)');
    expect(s?.summary).toBe('40 rapports · dernier le 02/10');
    const h = s?.html ?? '';
    expect(visibleText(h)).toContain('Vulnérabilités de produits du secteur santé : Retour d\'expérience du CERT Santé et du CERT-FR02/10CERTFR-2026-CTI-007 · lire le rapport');
    expect(h).toContain('href="https://www.cert.ssi.gouv.fr/cti/CERTFR-2026-CTI-007/"');
    expect(h).toContain('<details class="lp-more"><summary>34 rapports de plus</summary>');
    expect(visibleText(h)).toContain('CERTFR-2026-CTI-003 · en anglais');
    expect(visibleText(h)).toContain('Panorama de la cybermenace 2025');
    const down = cyber((x) => { x.certfr = { ...x.certfr, reports: [] }; x.errors = ['CERT-FR, rapports Menaces et incidents : HTTP 503']; });
    expect(visibleText(sectionOf('rapports', { cyber: down })?.html ?? '')).toContain('Source indisponible : rapports Menaces et incidents du CERT-FR.');
  });
  it('V1 : liste HIBP en retard (26 h) : « non évalué », jamais « aucune fuite » ; un compte lu reste dit comme celui de la dernière lecture', () => {
    const hibp = (count: number): CyberResponse => cyber((x) => {
      x.hibp = { readAt: '2026-10-03T10:00:00Z', count, newestAddedDate: count > 0 ? '2026-09-29T08:00:00Z' : null, url: 'https://haveibeenpwned.com/PwnedWebsites' };
    });
    const none = sectionOf('fuites', { cyber: hibp(0) });
    expect(none?.summary).toBe('non évalué (en retard)');
    expect(visibleText(none?.html ?? '')).toContain('Non évalué · Have I Been Pwned non relu depuis le 03/10 à 12:00.');
    expect(visibleText(none?.html ?? '')).not.toMatch(/Aucune fuite|aucune en \.fr/);
    const two = sectionOf('fuites', { cyber: hibp(2) });
    expect(two?.summary).toBe('2 fuites en .fr sur 30 jours (en retard)');
    expect(visibleText(two?.html ?? '')).toContain('Non évalué · Have I Been Pwned non relu depuis le 03/10 à 12:00 : comptes de la dernière lecture.'
      + 'Fuites de domaines en .fr ajoutées depuis 30 jours2');
  });
  it('O5 : fuites publiées : un compte et un lien seulement, jamais un titre ni un domaine', () => {
    expect(sectionOf('fuites')?.summary).toBe('aucune en .fr sur 30 jours');
    const empty = sectionOf('fuites')?.html ?? '';
    expect(visibleText(empty)).toContain('Aucune fuite de domaine en .fr ajoutée à Have I Been Pwned depuis 30 jours.');
    expect(empty).toContain('href="https://haveibeenpwned.com/PwnedWebsites"');
    const two = cyber((c) => { c.hibp = { readAt: '2026-10-04T14:48:14Z', count: 2, newestAddedDate: '2026-09-29T08:00:00Z', url: 'https://haveibeenpwned.com/PwnedWebsites' }; });
    const s = sectionOf('fuites', { cyber: two });
    expect(s?.summary).toBe('2 fuites en .fr sur 30 jours');
    const t = visibleText(s?.html ?? '');
    expect(t).toContain('Fuites de domaines en .fr ajoutées depuis 30 jours2');
    expect(t).toContain('Ajout le plus récent29/09');
    expect(t).toContain('liste publique des fuites sur Have I Been Pwned');
    expect(t).toContain('Compte et lien seulement, sans titre ni domaine');
    expect(t).toContain('REACTIV');
    expect(t).toContain('Have I Been Pwned, CC BY 4.0');
    expect(t).toContain('Liste lue à 16:48.');
  });
  it('Cybermalveillance.gouv.fr : alerte datée, titre et lien ; actualités repliées ; en retard d’après readAt', () => {
    const s = sectionOf('cybermalveillance');
    expect(s?.summary).toBe('1 alerte · dernière le 30/09');
    expect(s?.html).toContain('<span>Cybermois 2026</span><span class="lp-val fmk-num">30/09</span>');
    expect(s?.html).toContain('href="https://www.cybermalveillance.gouv.fr/tous-nos-contenus/alertes/le-cybermois-arrive-preparez-vous"');
    expect(visibleText(s?.html ?? '')).toContain('Flux lus à 16:48.');
    const late = cyber((x) => { if (x.cybermalveillance) x.cybermalveillance.readAt = '2026-10-04T08:00:00Z'; });
    const l = sectionOf('cybermalveillance', { cyber: late });
    expect(l?.summary).toBe('1 alerte · dernière le 30/09 (en retard)');
    expect(visibleText(l?.html ?? '')).toContain('Flux lus à 10:00 (en retard).');
  });
  it('méthode et sources : licences, définitions du CERT-FR, règles de la pastille (revendications jaune au plus), carte sans lieu, sources retirées', () => {
    const h = sectionOf('methode')?.html ?? '';
    const t = visibleText(h);
    expect(t).toContain('Licence ouverte 2.0');
    expect(t).toContain('domaine public');
    expect(t).toContain('Les alertes de sécurité sont des documents destinés à prévenir d’un danger immédiat.');
    expect(t).toContain('Les avis de sécurité sont des documents faisant état de vulnérabilités et des moyens de s’en prémunir.');
    expect(t).toContain('revendications de la semaine dépassent 1,5 fois la moyenne (jaune au plus');
    expect(t).not.toMatch(/3 fois la moyenne/);
    expect(t).toContain('pas de lieu publié : voir le panneau');
    expect(t).toContain('Retirés : exposition Shodan et Censys, FrenchBreaches, fuites de plus de 30 jours, titres et domaines des fuites, CVE mondiales hors catalogue KEV.');
    expect(h).toContain('href="https://www.ransomware.live/t&amp;c"');
  });
});

describe('variantes de la pastille, pannes et retards (S1 à S3)', () => {
  it('rouge : deux alertes en cours publiées depuis moins de 7 jours', () => {
    const c = cyber((x) => {
      const a = ale011(x);
      x.certfr.alerts = [{ ...a, firstVersion: '2026-10-02', lastVersion: '2026-10-02' }, { ...a, ref: 'CERTFR-2026-ALE-012', firstVersion: '2026-10-03', lastVersion: null }];
    });
    expect(view({ cyber: c }).head.level).toBe('rouge');
    expect(html({ cyber: c })).toContain('<b class="fmk-num lp-lvl lp-lvl--rouge">2</b>');
  });
  it('O4 : revendications à 3,2 fois la moyenne : jaune au plus (pastille et valeur), jamais rouge ; l’alerte en cours garde l’orange', () => {
    const claims = (x: CyberResponse): void => { if (x.ransomware) x.ransomware = { ...x.ransomware, weekCount: 17, ratio: 3.2 }; };
    expect(view({ cyber: cyber(claims) }).head.level).toBe('orange');
    const only = cyber((x) => { claims(x); x.certfr.alerts = []; x.certfr.avis = x.certfr.avis.map((a) => ({ ...a, kevCves: [] })); });
    const v = view({ cyber: only });
    expect(v.head.level).toBe('jaune');
    expect(v.head.status[0]).toContain('hausse des revendications, non confirmées');
    const h = sectionOf('revendications', { cyber: only })?.html ?? '';
    expect(visibleText(h)).toContain('Cette semaine17 · 3,20 fois la moyenne');
    expect(h).toContain('<span class="lp-val fmk-num lp-lvl lp-lvl--jaune">17 · 3,20 fois la moyenne</span>');
    expect(html({ cyber: only })).not.toMatch(/lp-lvl--(?:rouge|orange)|fmk-dot--(?:rouge|orange)/);
  });
  it('jaune : alertes en cours publiées depuis 7 jours ou plus ; jaune : un avis récent avec vulnérabilité KEV, aucune alerte en cours (zéro sans couleur)', () => {
    const older = view({ cyber: cyber((x) => { x.certfr.alerts = x.certfr.alerts.filter((a) => a.ref !== 'CERTFR-2026-ALE-011'); }) });
    expect(older.head.level).toBe('jaune');
    expect(older.head.figure).toEqual({ value: '2', caption: 'alertes CERT-FR en cours · la plus récente : Metabase, publiée le 10/09 · 24 avis sur 7 jours' });
    const yellow = cyber((x) => { x.certfr.alerts = x.certfr.alerts.filter((a) => a.status === 'cloturee'); });
    expect(yellow.certfr.alerts.filter((a) => certfrAgeDays(a, NOW) < 30)).toHaveLength(1);
    const v = view({ cyber: yellow });
    expect(v.head.level).toBe('jaune');
    expect(v.head.figure).toEqual({ value: '0', caption: 'alerte CERT-FR en cours · 24 avis sur 7 jours', level: null });
  });
  it('CERT-FR en panne : n.d., sections du CERT-FR nommées, autres sources gardées avec leur date', () => {
    const v = view({ cyber: cyber((x) => { x.certfr = { readAt: null, alerts: [], avis: [], reports: [] }; x.errors = ['CERT-FR, alerte : HTTP 503', 'CERT-FR, avis : HTTP 503']; }) });
    expect(v.head.level).toBe('nd');
    expect(v.head.status[0]).toBe('CERT-FR indisponible');
    expect(v.head.figure).toEqual({ value: 'n.d.', caption: 'alertes CERT-FR en cours : CERT-FR indisponible', level: null });
    expect(visibleText(v.sections.find((s) => s.id === 'certfr')?.html ?? '')).toMatch(/^Source indisponible : alertes et avis CERT-FR\.En cas d’incident/);
    expect(visibleText(v.sections.find((s) => s.id === 'rapports')?.html ?? '')).toBe('Source indisponible : rapports Menaces et incidents du CERT-FR.');
    expect(v.sections.find((s) => s.id === 'revendications')?.summary).toBe('7 en 7 jours · 25 en 30 jours');
    expect(visibleText(v.sections.find((s) => s.id === 'methode')?.html ?? '')).toContain('Incidents de lecture : CERT-FR, alerte : HTTP 503 ; CERT-FR, avis : HTTP 503.');
  });
  it('lecture du CERT-FR en retard (6 h) : pastille n.d. de cyberLevel, gros chiffre gardé sans couleur, puces grises', () => {
    const late = NOW + 6 * HOUR + 10 * 60_000;
    const v = view({ now: late });
    expect(v.head.level).toBe('nd');
    expect(v.head.status[0]).toBe(glueSovUnits(cyberLevel(CYBER_FIXTURE(), late).reason));
    expect(v.head.status[0]).toContain('CERT-FR non relu depuis 16:48');
    expect(v.head.figure?.level).toBeNull();
    expect(v.head.figure?.caption).toContain('(en retard)');
    expect(v.sections.find((s) => s.id === 'certfr')?.summary).toContain('(en retard)');
    expect(v.sections.find((s) => s.id === 'certfr')?.html).not.toMatch(/fmk-dot--(?:orange|jaune|rouge)/);
    expect(visibleText(v.sections.find((s) => s.id === 'certfr')?.html ?? '')).toMatch(/^Statuts et avis lus à 16:48 \(en retard\) : à revérifier sur le site du CERT-FR\.Alerte : /);
    const yesterday = view({ cyber: cyber((x) => { x.certfr.readAt = '2026-10-03T20:00:00Z'; }) });
    expect(visibleText(yesterday.sections.find((s) => s.id === 'certfr')?.html ?? '')).toContain('Statuts et avis lus le 03/10 à 22:00 (en retard)');
    expect(visibleText(sectionOf('certfr')?.html ?? '')).not.toContain('en retard');
  });
  it('route injoignable : n.d. ; chargement ; collecte servie avec la panne de la route : appel daté', () => {
    const v = view({ cyber: null, cyberError: 'HTTP 502' });
    expect(v.head).toMatchObject({ level: 'nd', status: ['sources cyber injoignables'] });
    expect(v.bodyHtml).toContain('Source injoignable. Aucune donnée reçue.');
    expect(view({ cyber: null, cyberError: null }).head.status).toEqual(['chargement…']);
    expect(view({ cyberError: 'HTTP 502' }).bodyHtml).toMatch(/Source injoignable\. Dernières données : \d\d:\d\d\./);
  });
});

describe('hygiène du rendu', () => {
  const variants: Array<Partial<CyberViewInput>> = [
    {}, { now: SOV_FIXTURE_NOW + 7 * HOUR }, { cyber: null, cyberError: 'HTTP 502' },
    { cyber: cyber((x) => { x.ransomware = null; x.hibp = null; x.cybermalveillance = null; }) },
    { cyber: cyber((x) => { x.hibp = { readAt: '2026-10-04T14:48:14Z', count: 3, newestAddedDate: '2026-09-29T08:00:00Z', url: 'https://haveibeenpwned.com/PwnedWebsites' }; }) },
    {
      cyber: cyber((x) => {
        x.kev.readAt = '2026-10-03T12:00:00Z';
        x.hibp = { readAt: '2026-10-03T10:00:00Z', count: 0, newestAddedDate: null, url: 'https://haveibeenpwned.com/PwnedWebsites' };
        if (x.ransomware) x.ransomware = { ...x.ransomware, lastModified: '2026-10-03T12:00:00Z', ratio: 2.1 };
        if (x.cybermalveillance) x.cybermalveillance.readAt = '2026-10-04T08:00:00Z';
      }),
    },
  ];
  it('aucun tiret cadratin, aucune police à chasse fixe, aucune couleur brute, jamais « temps réel », « LIVE », Shodan, Censys ni NVD', () => {
    for (const over of variants) {
      const h = html(over);
      expect(h).not.toMatch(/\u2014|&mdash;|monospace|#[0-9a-fA-F]{6}\b|rgba?\(/);
      expect(visibleText(h).replace('Retirés : exposition Shodan et Censys', '')).not.toMatch(/temps réel|CACHE FIGÉ/i);
      // Casse respectée : « Ransomware.live » est le nom de la source, pas un badge « LIVE ».
      expect(visibleText(h).replace('Retirés : exposition Shodan et Censys', '')).not.toMatch(/\bLIVE\b|Shodan|Censys|\bNVD\b/);
    }
  });
  it('R1 : aucune valeur coupée entre nombre et unité', () => {
    for (const over of variants) {
      const v = view(over);
      const texts = [v.head.figure?.caption ?? '', ...v.head.status, v.head.lead ?? '', ...v.sections.map((s) => visibleText(`${s.summary ?? ''} ${s.html}`))];
      for (const t of texts) {
        expect(breakableValue(t), t.slice(0, 80)).toBeNull();
        expect(trafficBreakable(t), t.slice(0, 80)).toBeNull();
        expect(sovBreakable(t), t.slice(0, 80)).toBeNull();
      }
    }
  });
  it('textes tiers échappés (produit CERT-FR, phrase citée, nom de groupe, titre de rapport)', () => {
    const h = html({ cyber: cyber((x) => {
      x.certfr.alerts = [{ ...ale011(x), product: '<img src=x onerror=alert(1)>', exploitedQuote: '<script>q</script>' }];
      x.certfr.reports = [{ ...x.certfr.reports[0], title: '<b onmouseover=x>r</b>' }];
      if (x.ransomware) x.ransomware = { ...x.ransomware, groups30: [{ label: '<script>g</script>', count: 2 }] };
    }) });
    expect(h).not.toMatch(/<img src=x|<script>|<b onmouseover/);
    expect(h).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});
