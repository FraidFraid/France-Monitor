// tests/outages-status.test.ts : pages d'état élargies (Google Workspace, Statuspage), control room des pannes (21/10/2026).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetStatusForTests, ensureStatusFresh, statusOutages, statuspageIncidents, workspaceIncidents } from '../api/_lib/outages-status.js';
import { respond, stubFetch } from './helpers/traffic-fixtures.ts';

const NOW = Date.parse('2026-10-21T12:00:00Z');

describe('pages d’état élargies', () => {
  it('Statuspage : incidents majeurs et critiques ; mineurs ignorés', () => {
    const json = { incidents: [
      { name: 'Delays for Pull Requests', impact: 'minor', status: 'investigating', started_at: '2026-10-21T11:00:00Z', shortlink: 'https://stspg.io/a' },
      { name: 'Git operations down', impact: 'major', status: 'identified', started_at: '2026-10-21T11:30:00Z', shortlink: 'https://stspg.io/b' },
      { name: 'Total outage', impact: 'critical', status: 'investigating', started_at: '2026-10-21T11:40:00Z', shortlink: 'javascript:x' },
    ] };
    expect(statuspageIncidents(json, 'GitHub')).toEqual([
      { operator: 'GitHub', level: 'orange', title: 'Git operations down', since: '2026-10-21T11:30:00Z', link: 'https://stspg.io/b' },
      { operator: 'GitHub', level: 'rouge', title: 'Total outage', since: '2026-10-21T11:40:00Z', link: null },
    ]);
  });
  it('Google Workspace : en cours seulement ; perturbation jaune, coupure rouge, information ignorée', () => {
    const list = [
      { begin: '2026-10-21T10:00:00+00:00', end: null, severity: 'high', status_impact: 'SERVICE_OUTAGE', service_name: 'Gmail', external_desc: '**Summary:**\nGmail down', uri: 'incidents/a' },
      { begin: '2026-10-21T10:30:00+00:00', end: null, severity: 'medium', status_impact: 'SERVICE_DISRUPTION', service_name: 'Google Meet', external_desc: 'x', uri: 'incidents/b' },
      { begin: '2026-10-21T09:00:00+00:00', end: null, severity: 'low', status_impact: 'SERVICE_INFORMATION', service_name: 'Docs', external_desc: 'x', uri: 'incidents/c' },
      { begin: '2026-10-20T09:00:00+00:00', end: '2026-10-20T10:00:00+00:00', severity: 'high', status_impact: 'SERVICE_OUTAGE', service_name: 'Drive', external_desc: 'x', uri: 'incidents/d' },
    ];
    expect(workspaceIncidents(list)).toEqual([
      { operator: 'Google Workspace', level: 'rouge', title: 'Gmail : coupure de service', since: '2026-10-21T10:00:00+00:00', link: 'https://www.google.com/appsstatus/dashboard/incidents/a' },
      { operator: 'Google Workspace', level: 'jaune', title: 'Google Meet : perturbation', since: '2026-10-21T10:30:00+00:00', link: 'https://www.google.com/appsstatus/dashboard/incidents/b' },
    ]);
  });
});

describe('relève des pages d’état', () => {
  beforeEach(() => { __resetStatusForTests(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  it('toutes les pages lues, une en panne nommée sans bloquer les autres ; au plus toutes les 5 min', async () => {
    const log = stubFetch((url) => (url.includes('githubstatus')
      ? respond({ incidents: [{ name: 'Git down', impact: 'major', status: 'identified', started_at: '2026-10-21T11:30:00Z', shortlink: 'https://stspg.io/b' }] })
      : url.includes('discordstatus') ? respond('down', 503) : url.includes('appsstatus') ? respond([]) : respond({ incidents: [] })));
    await ensureStatusFresh(NOW);
    expect(statusOutages(NOW).outages).toEqual([expect.objectContaining({ operator: 'GitHub', level: 'orange' })]);
    expect(statusOutages(NOW).errors).toEqual([expect.stringContaining('Discord')]);
    const n = log.urls.length;
    await ensureStatusFresh(NOW + 60_000);
    expect(log.urls.length).toBe(n);
  });
});
