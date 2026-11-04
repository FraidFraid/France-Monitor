// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FIXTURE } from './fixture.test-data.ts';

const send = vi.fn<(id: string, vote: string) => Promise<'ok' | 'deja' | 'erreur'>>();
const readVote = vi.fn<(id: string) => string | null>();
vi.mock('../../services/anticipation.ts', () => ({
  sendAnticipationFeedback: (id: string, vote: string) => send(id, vote),
  readAnticipationVote: (id: string) => readVote(id),
}));

const { AnticipationRoom } = await import('./AnticipationRoom.ts');

const flush = async (): Promise<void> => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); };

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  send.mockReset();
  readVote.mockReset().mockReturnValue(null);
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse('2026-11-04T12:30:00Z'));
});
afterEach(() => { vi.useRealTimers(); });

describe('AnticipationRoom', () => {
  it('bandeau BÊTA, agenda, fiche du premier scénario du jour, curseur de 7 jours', () => {
    const host = document.createElement('div');
    const room = new AnticipationRoom(host);
    room.setData(FIXTURE);
    expect(host.querySelector('.anr-beta')?.textContent).toBe('BÊTA · hypothèses à vérifier, pas des prévisions');
    expect(host.querySelector('.anr-card h3')?.textContent).toBe(FIXTURE.scenarios[0].title);
    const days = [...host.querySelectorAll('[data-day]')];
    expect(days).toHaveLength(7);
    expect(days[0].textContent).toBe('Auj.');
    expect(days[0].getAttribute('aria-pressed')).toBe('true');
    room.destroy();
    expect(host.children).toHaveLength(0);
  });

  it('clic sur un scénario : fiche et onFocus ; clic sur un jour : onDay et fiche du jour', () => {
    const host = document.createElement('div');
    const room = new AnticipationRoom(host);
    const focused: string[] = [];
    const days: string[] = [];
    room.onFocus((s) => focused.push(s.id));
    room.onDay((d) => days.push(d));
    room.setData(FIXTURE);
    (host.querySelector('.anr-agenda [data-scenario="sc-carburant"]') as HTMLElement).click();
    expect(focused).toEqual(['sc-carburant']);
    expect(host.querySelector('.anr-card h3')?.textContent).toBe('Tensions sur le carburant');
    expect(days).toEqual(['2026-11-05']);
    (host.querySelector('[data-day="2026-11-04"]') as HTMLElement).click();
    expect(days).toEqual(['2026-11-05', '2026-11-04']);
    expect(host.querySelector('.anr-card h3')?.textContent).toBe(FIXTURE.scenarios[0].title);
    room.setDay('2026-11-05');
    expect(host.querySelector('[data-day="2026-11-05"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('.anr-maptitle')?.textContent).toContain('1 scénario');
    room.destroy();
  });

  it('feedback buttons call service once', async () => {
    send.mockResolvedValue('ok');
    const host = document.createElement('div');
    const room = new AnticipationRoom(host);
    room.setData(FIXTURE);
    const utile = host.querySelector('.anr-card button[data-vote="utile"]') as HTMLButtonElement;
    utile.click();
    utile.click();
    (host.querySelector('.anr-card button[data-vote="faux"]') as HTMLButtonElement).click();
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('sc-lyon', 'utile');
    expect(host.querySelector('.anr-fb-state')?.textContent).toBe('Merci');
    (host.querySelector('.anr-card button[data-vote="faux"]') as HTMLButtonElement).click();
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
    // Rafraîchissement : l'état du vote reste.
    room.setData(FIXTURE);
    expect(host.querySelector('.anr-fb-state')?.textContent).toBe('Merci');
    room.destroy();
  });

  it('vote déjà donné dans ce navigateur : « Déjà noté », boutons désactivés, aucun envoi', () => {
    readVote.mockReturnValue('utile');
    const host = document.createElement('div');
    const room = new AnticipationRoom(host);
    room.setData(FIXTURE);
    expect(host.querySelector('.anr-fb-state')?.textContent).toBe('Déjà noté');
    (host.querySelector('.anr-card button[data-vote="faux"]') as HTMLButtonElement).click();
    expect(send).not.toHaveBeenCalled();
    room.destroy();
  });

  it('depuis la dernière visite : marques relues de la visite précédente', () => {
    localStorage.setItem('fm:anticipation:last-seen', JSON.stringify({ at: Date.parse('2026-11-04T08:00:00Z'), words: { 'sc-carburant': 'chance_infime' } }));
    const host = document.createElement('div');
    const room = new AnticipationRoom(host);
    room.setData(FIXTURE);
    expect(host.querySelector('.anr-agenda [data-scenario="sc-lyon"]')?.textContent).toContain('nouveau');
    expect(host.querySelector('.anr-agenda [data-scenario="sc-carburant"]')?.textContent).toContain('monté');
    // La visite est notée : mots vus enregistrés pour la prochaine fois.
    const saved = JSON.parse(localStorage.getItem('fm:anticipation:last-seen') ?? '{}') as { words?: Record<string, string> };
    expect(saved.words).toEqual({ 'sc-lyon': 'probable', 'sc-carburant': 'peu_probable' });
    room.destroy();
  });

  it('colonnes v2 : agenda à la place de la liste, fiche à la place de l’État, carte dégagée ; sortie : colonnes rendues', () => {
    const main = document.createElement('div');
    main.className = 'main-container';
    const list = document.createElement('aside');
    list.className = 'fm-v2-list';
    const mapEl = document.createElement('div');
    const fiche = document.createElement('aside');
    fiche.className = 'fm-v2-fiche';
    main.append(list, mapEl, fiche);
    const room = new AnticipationRoom(mapEl, { list, fiche });
    const reveals: string[] = [];
    room.onReveal((w) => reveals.push(w));
    room.setData(FIXTURE);
    expect(main.classList.contains('anr-active')).toBe(true);
    expect(list.nextElementSibling?.classList.contains('anr-agenda')).toBe(true);
    expect(list.nextElementSibling?.classList.contains('fm-v2-list')).toBe(true);
    expect(fiche.nextElementSibling?.classList.contains('anr-side')).toBe(true);
    expect(fiche.nextElementSibling?.classList.contains('fm-v2-fiche')).toBe(true);
    // Sur la carte : titre, BÊTA, légende, curseur ; ni agenda ni fiche.
    expect(mapEl.querySelector('.anr-agenda, .anr-side')).toBeNull();
    expect(mapEl.querySelector('.anr-maptitle')).not.toBeNull();
    expect(mapEl.querySelector('.anr-legend')).not.toBeNull();
    (main.querySelector('.anr-agenda [data-scenario="sc-lyon"]') as HTMLElement).click();
    (main.querySelector('.anr-side [data-fly]') as HTMLElement).click();
    expect(reveals).toEqual(['card', 'map']);
    room.destroy();
    expect(main.classList.contains('anr-active')).toBe(false);
    expect([...main.children]).toEqual([list, mapEl, fiche]);
  });

  it('relève sans changement : rien n’est redessiné (le focus reste), visite non réécrite', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const room = new AnticipationRoom(host);
    room.setData(FIXTURE);
    const item = host.querySelector<HTMLElement>('.anr-agenda [data-scenario="sc-lyon"]');
    item?.focus();
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    room.setData({ ...FIXTURE, generatedAt: '2026-11-04T12:31:00Z' });
    expect(host.querySelector('.anr-agenda [data-scenario="sc-lyon"]')).toBe(item);
    expect(document.activeElement).toBe(item);
    expect(setItem).not.toHaveBeenCalled();
    room.setData({ ...FIXTURE, scenarios: [{ ...FIXTURE.scenarios[0], revisedAt: '2026-11-04T12:40:00Z' }, FIXTURE.scenarios[1]] });
    expect(host.querySelector('.anr-agenda [data-scenario="sc-lyon"]')).not.toBe(item);
    setItem.mockRestore();
    room.destroy();
    host.remove();
  });

  it('no em dash in rendered HTML', () => {
    const host = document.createElement('div');
    const room = new AnticipationRoom(host);
    room.setData(FIXTURE);
    expect(host.innerHTML).not.toContain('\u2014');
    room.destroy();
  });
});
