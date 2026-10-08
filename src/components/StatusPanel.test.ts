// @vitest-environment happy-dom
import { beforeAll, describe, it, expect } from 'vitest';
import { StatusPanel } from './StatusPanel.ts';
import { initI18n } from '../services/i18n.ts';

beforeAll(async () => { await initI18n(); });

describe('StatusPanel.getSources (voyant de fraîcheur de la v2)', () => {
  it('expose les sources suivies dans leur état courant', () => {
    const panel = new StatusPanel(document.createElement('div'));
    panel.updateSource('Écowatt RTE', { status: 'ok', lastUpdate: new Date(0) });
    panel.updateSource('Vigicrues', { status: 'error' });
    panel.updateSource('Écowatt RTE', { status: 'stale' });
    expect(panel.getSources().map((s) => [s.name, s.status])).toEqual([['Écowatt RTE', 'stale'], ['Vigicrues', 'error']]);
  });
});

/** Ligne affichée d'une source : texte de la ligne et infobulle de sa pastille d'état. */
function row(host: HTMLElement, name: string): { text: string; title: string | null } {
  const rows = Array.from(host.querySelector('[data-panel="status"]')?.children[1]?.children ?? []);
  const found = rows.find((r) => r.textContent?.includes(name));
  // La pastille d'état est le dernier élément à infobulle de la ligne (après le détail et l'erreur éventuels).
  const titled = Array.from(found?.querySelectorAll('[title]') ?? []);
  return { text: found?.textContent ?? '', title: titled.at(-1)?.getAttribute('title') ?? null };
}

describe('StatusPanel : sources hebdomadaires ou annuelles datées par leur période (spec 2026-10-03 S1)', () => {
  it('la période remplace l’âge relatif et le libellé « temps réel »', () => {
    const host = document.createElement('div');
    const panel = new StatusPanel(host);
    panel.mount();
    panel.updateSource('Sentinelles', { status: 'ok', lastUpdate: new Date('2026-09-27T12:00:00Z'), period: 'S39 provisoire' });
    const r = row(host, 'Sentinelles');
    expect(r.text).toContain('S39 provisoire');
    expect(r.text).not.toMatch(/il y a/);
    expect(r.title).toBe('À JOUR · S39 provisoire');
    expect(`${r.text} ${r.title ?? ''}`).not.toMatch(/temps réel/i);
  });
  it('source sans période (flux continu) : âge relatif et libellé inchangés', () => {
    const host = document.createElement('div');
    const panel = new StatusPanel(host);
    panel.mount();
    panel.updateSource('Vigicrues', { status: 'ok', lastUpdate: new Date(Date.now() - 3 * 60_000) });
    const r = row(host, 'Vigicrues');
    expect(r.text).toContain('il y a 3min');
    expect(r.title).toBe('TEMPS RÉEL');
  });
  it('source datée en retard : « EN RETARD », jamais « CACHE FIGÉ » ; panne partielle : lecture incomplète, partie nommée', () => {
    const host = document.createElement('div');
    const panel = new StatusPanel(host);
    panel.mount();
    panel.updateSource('Sentinelles', { status: 'stale', lastUpdate: new Date('2026-09-27T12:00:00Z'), period: 'S39 provisoire (en retard)' });
    expect(row(host, 'Sentinelles').title).toBe('EN RETARD · S39 provisoire');
    panel.updateSource('OMS / ECDC', {
      status: 'stale', lastUpdate: new Date('2026-10-02T12:00:00Z'), period: 'message du 02/10', error: 'OMS, Disease Outbreak News : HTTP 503',
    });
    expect(row(host, 'OMS / ECDC').title).toBe('LECTURE INCOMPLÈTE · message du 02/10 · OMS, Disease Outbreak News : HTTP 503');
    panel.updateSource('Vigicrues', { status: 'stale', lastUpdate: new Date(Date.now() - 3 * 60_000) });
    expect(row(host, 'Vigicrues').title).toBe('CACHE FIGÉ');
  });
  it('période retirée quand la source perd sa donnée', () => {
    const host = document.createElement('div');
    const panel = new StatusPanel(host);
    panel.mount();
    panel.updateSource('Sentinelles', { status: 'ok', lastUpdate: new Date('2026-09-27T12:00:00Z'), period: 'S39' });
    panel.updateSource('Sentinelles', { status: 'loading', lastUpdate: null, period: undefined });
    expect(row(host, 'Sentinelles').text).not.toContain('S39');
  });
});

describe('StatusPanel : lignes Souveraineté (spec 2026-10-04 souveraineté S1 ; amendement 7, A15)', () => {
  it('lignes datées présentes dès le chargement, chacune avec sa source nommée et liée ; jamais adsb.fi', () => {
    const host = document.createElement('div');
    const panel = new StatusPanel(host);
    panel.mount();
    const names = ['Vols militaires', 'Vigipirate (page du SGDSN)', 'Câbles et AIS', 'CERT-FR', 'CISA KEV', 'Ransomware.live', 'Have I Been Pwned',
      'Cybermalveillance.gouv.fr'];
    for (const name of names) expect(panel.getSources().find((s) => s.name === name)?.status).toBe('loading');
    expect(host.textContent).not.toMatch(/adsb\.fi|airplanes\.live|LIVE/);
    const rows = Array.from(host.querySelector('[data-panel="status"]')?.children[1]?.children ?? []);
    const ransom = rows.find((r) => r.textContent?.startsWith('Ransomware.live'));
    const link = ransom?.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://www.ransomware.live/t&c');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link?.textContent).toBe('Source : Ransomware.live · revendications non confirmées, conditions d’utilisation');
    const vigipirate = rows.find((r) => r.textContent?.startsWith('Vigipirate (page du SGDSN)'))?.querySelector('a');
    expect(vigipirate?.getAttribute('href')).toBe('https://www.sgdsn.gouv.fr/vigipirate');
    // Une ligne hors Souveraineté garde son détail en texte, sans lien.
    expect(rows.find((r) => r.textContent?.startsWith('Vigicrues'))?.querySelector('a')).toBeNull();
  });
  it('le lien ouvre la source sans ouvrir le panneau de la ligne', () => {
    const host = document.createElement('div');
    const panel = new StatusPanel(host);
    const opened: string[] = [];
    panel.setOnSourceClick((name) => opened.push(name));
    panel.mount();
    const rows = Array.from(host.querySelector('[data-panel="status"]')?.children[1]?.children ?? []);
    const cert = rows.find((r) => r.textContent?.startsWith('CERT-FR'));
    const link = cert?.querySelector('a');
    link?.addEventListener('click', (e) => e.preventDefault());
    link?.click();
    expect(opened).toEqual([]);
    (cert as HTMLElement | undefined)?.click();
    expect(opened).toEqual(['CERT-FR']);
  });
});
