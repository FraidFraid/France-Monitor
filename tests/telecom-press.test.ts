// tests/telecom-press.test.ts : pannes télécoms signalées par la presse (api/_lib/telecom-press.js, 21/10/2026).
import { describe, expect, it } from 'vitest';
import { telecomPressReports } from '../api/_lib/telecom-press.js';

const NOW = Date.parse('2026-10-21T12:00:00Z');
const item = (title: string, at: string, over: Record<string, unknown> = {}) => ({
  title, link: `https://ex.fr/${encodeURIComponent(title)}`, publishedAt: at, feedName: 'BFM TV', category: 'infrastructure', severity: 'medium', ...over,
});

describe('pannes télécoms signalées par la presse', () => {
  it('regroupées par opérateur : gravité la plus haute, articles, sources, premier et dernier', () => {
    const r = telecomPressReports([
      item('Orange : panne «au niveau national» de l’opérateur et de sa filiale Sosh', '2026-10-21T10:45:00Z', { severity: 'high', feedName: 'Libération' }),
      item('Le réseau mobile d’Orange touché par une panne ce mercredi', '2026-10-21T10:52:00Z', { feedName: 'Le Figaro' }),
      item('Vous n’avez plus de réseau ? Sosh en panne', '2026-10-21T10:06:00Z'),
      item('Panne de réseau chez SFR dans le Gers', '2026-10-21T09:00:00Z'),
    ], NOW);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({
      operator: 'Orange', severity: 'high', articles: 3, sources: 3, firstAt: '2026-10-21T10:06:00.000Z', lastAt: '2026-10-21T10:52:00Z',
      title: 'Le réseau mobile d’Orange touché par une panne ce mercredi', national: true,
    });
    expect(r[1]?.national).toBe(false);
    expect(r[1]).toMatchObject({ operator: 'SFR', severity: 'medium', articles: 1 });
  });
  it('écartés : info ou low, autre catégorie, plus de 24 h, sans panne de réseau au titre ; aucun opérateur cité : null', () => {
    const r = telecomPressReports([
      item('Panne réseau chez Orange', '2026-10-21T10:00:00Z', { severity: 'info' }),
      item('Panne réseau chez Orange', '2026-10-21T10:00:00Z', { category: 'general' }),
      item('Panne réseau chez Orange', '2026-10-20T10:00:00Z'),
      item('Orange : un incendie au théâtre antique', '2026-10-21T10:00:00Z', { severity: 'high' }),
      item('Coupure internet géante dans le Grand Est', '2026-10-21T11:00:00Z'),
    ], NOW);
    expect(r).toEqual([expect.objectContaining({ operator: null, articles: 1 })]);
  });
});

describe('pannes de tous les réseaux signalées par la presse (21/10/2026)', () => {
  const at = '2026-10-21T10:00:00Z';
  it('un réseau par article, urgences d’abord ; opérateur cité ; urgences toujours en rouge', async () => {
    const { pressOutages } = await import('../api/_lib/telecom-press.js');
    const r = pressOutages([
      item('Le 112 injoignable, panne du réseau Orange', at, { severity: 'high' }),
      item('Panne de courant : 5 000 clients Enedis privés d’électricité', at, { category: 'energy', severity: 'high' }),
      item('Coupure de gaz GRDF dans un quartier de Lyon', at),
      item('Coupure d’eau : privés d’eau potable à Nîmes', at),
      item('Panne géante des terminaux de paiement', at, { severity: 'high' }),
      item('Panne de la TNT : privés de télévision', at),
      item('Panne réseau chez SFR', at),
    ], NOW);
    const by = (n: string) => r.filter((x: { network: string }) => x.network === n);
    expect(by('urgence')).toEqual([expect.objectContaining({ operator: null, level: 'rouge', articles: 1 })]);
    expect(by('electricite')).toEqual([expect.objectContaining({ operator: 'Enedis', level: 'orange' })]);
    expect(by('gaz')).toEqual([expect.objectContaining({ operator: 'GRDF', level: 'jaune' })]);
    expect(by('eau')).toHaveLength(1);
    expect(by('paiement')).toEqual([expect.objectContaining({ level: 'orange' })]);
    expect(by('tv')).toHaveLength(1);
    expect(by('mobile')).toEqual([expect.objectContaining({ operator: 'SFR' })]);
  });
  it('mots seuls sans panne : écartés (fuite de gaz, gaz de schiste, eau de pluie)', async () => {
    const { pressOutages } = await import('../api/_lib/telecom-press.js');
    expect(pressOutages([
      item('Fuite de gaz : un immeuble évacué', at, { severity: 'high' }),
      item('Le gaz de schiste fait débat', at),
      item('Eau de pluie : les nappes remontent', at),
    ], NOW)).toEqual([]);
  });
});

describe('pressOutages — faille de sécurité (22/10/2026)', () => {
  it('une faille logicielle n’est pas une panne de réseau, même « panne internet mondiale »', async () => {
    const { pressOutages } = await import('../api/_lib/telecom-press.js');
    expect(pressOutages([
      item('DÉCRYPTAGE. Panne internet mondiale : pourquoi des failles de sécurité perturbent des millions de sites web', '2026-10-21T10:31:00Z', { severity: 'critical', category: 'cyber' }),
      item('Vulnérabilité critique : sites des préfectures inaccessibles', '2026-10-21T10:00:00Z', { severity: 'critical', category: 'cyber' }),
    ], NOW)).toEqual([]);
  });
});

describe('pressOutages — panne finie (22/10/2026)', () => {
  it('récit après coup (temporalité passée) : écarté', async () => {
    const { pressOutages } = await import('../api/_lib/telecom-press.js');
    expect(pressOutages([
      item('Panne Orange/Sosh : voici pourquoi des millions d’abonnés ont été privés de réseau mobile', '2026-10-21T10:30:00Z', { temporality: 'passe' }),
    ], NOW)).toEqual([]);
  });
  it('dernier article : réseau rétabli → la panne n’est plus en cours', async () => {
    const { pressOutages } = await import('../api/_lib/telecom-press.js');
    expect(pressOutages([
      item('Panne nationale du réseau mobile Orange', '2026-10-21T09:00:00Z', { severity: 'critical' }),
      item('Panne Orange : le réseau mobile rétabli après dix heures', '2026-10-21T11:00:00Z'),
    ], NOW)).toEqual([]);
  });
  it('rétabli puis nouvelle coupure : en cours', async () => {
    const { pressOutages } = await import('../api/_lib/telecom-press.js');
    const r = pressOutages([
      item('Panne Orange : le réseau mobile rétabli', '2026-10-21T09:00:00Z'),
      item('Nouvelle panne du réseau mobile Orange', '2026-10-21T11:00:00Z', { severity: 'high' }),
    ], NOW);
    expect(r.map((p: { operator: string | null }) => p.operator)).toEqual(['Orange']);
  });
});

describe('pressOutages — rétablissement noté au passé', () => {
  it('un article de rétablissement classé « passé » clôt quand même la panne', async () => {
    const { pressOutages } = await import('../api/_lib/telecom-press.js');
    expect(pressOutages([
      item('Panne nationale du réseau mobile Orange', '2026-10-21T09:00:00Z', { severity: 'critical' }),
      item('Panne Orange et Sosh : le réseau revient après près de 10 heures', '2026-10-21T11:00:00Z', { severity: 'info', temporality: 'passe' }),
    ], NOW)).toEqual([]);
  });
});

describe('pressOutages — articles d’après-panne (22/10/2026)', () => {
  it('cause, excuses, dédommagement, « ont été privés » : la panne est finie', async () => {
    const { pressOutages } = await import('../api/_lib/telecom-press.js');
    for (const t of [
      'Panne Orange/Sosh : voici pourquoi des millions d’abonnés ont été privés de réseau mobile',
      'Panne Orange : l’opérateur confirme l’origine de la panne qui a privé des millions d’abonnés de réseau',
      'Panne Orange : voici comment l’opérateur va dédommager ses clients',
      'Panne géante chez Orange : après dix heures sans réseau, que s’est-il réellement passé ?',
    ]) {
      expect(pressOutages([
        item('Panne nationale du réseau mobile Orange', '2026-10-21T09:00:00Z', { severity: 'critical' }),
        item(t, '2026-10-21T11:00:00Z'),
      ], NOW), t).toEqual([]);
    }
  });
  it('« voici pourquoi vous n’avez plus de réseau » au présent : en cours', async () => {
    const { pressOutages } = await import('../api/_lib/telecom-press.js');
    expect(pressOutages([item('Panne Orange : voici pourquoi vous n’avez plus de réseau mobile', '2026-10-21T11:00:00Z', { severity: 'high' })], NOW)).toHaveLength(1);
  });
});
