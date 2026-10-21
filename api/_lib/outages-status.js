// api/_lib/outages-status.js : pages d'état élargies (control room des pannes, 21/10/2026), en plus des sept fournisseurs cloud du
// panneau Cloud : Google Workspace (Gmail, Meet, Drive) et des services publiés au format Statuspage (GitHub, Discord, DigitalOcean).
// Incidents mondiaux (ces pages ne disent pas la France) : seuls les incidents majeurs ou critiques comptent (Statuspage), les
// perturbations et coupures de service (Workspace). Échelon « confirmée » : c'est le fournisseur qui le publie. Relève toutes les 5 min.
import { fetchStrictJson, sourceError } from './source-http.js';

export const STATUS_INTERVAL_MS = 5 * 60_000;
/** Une relève plus vieille que 20 min ne signale plus rien. */
export const STATUS_MAX_AGE_MS = 20 * 60_000;
const WORKSPACE_URL = 'https://www.google.com/appsstatus/dashboard/incidents.json';
const WORKSPACE_PAGE = 'https://www.google.com/appsstatus/dashboard/';
/** Pages Statuspage (incidents non résolus). OpenAI ne publie plus cette route (404, 21/10/2026). */
export const STATUSPAGES = [
  { operator: 'GitHub', url: 'https://www.githubstatus.com/api/v2/incidents/unresolved.json' },
  { operator: 'Discord', url: 'https://discordstatus.com/api/v2/incidents/unresolved.json' },
  { operator: 'DigitalOcean', url: 'https://status.digitalocean.com/api/v2/incidents/unresolved.json' },
];
const STATUSPAGE_LEVEL = { major: 'orange', critical: 'rouge' };
const WORKSPACE_LEVEL = { SERVICE_OUTAGE: ['rouge', 'coupure de service'], SERVICE_DISRUPTION: ['jaune', 'perturbation'] };
const httpOnly = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null);

/** Incidents majeurs et critiques d'une page Statuspage. */
export function statuspageIncidents(json, operator) {
  const list = Array.isArray(json?.incidents) ? json.incidents : [];
  return list.flatMap((i) => {
    const level = STATUSPAGE_LEVEL[i?.impact];
    if (!level || i?.status === 'resolved' || i?.status === 'postmortem') return [];
    return [{ operator, level, title: String(i.name ?? 'incident'), since: i.started_at ?? i.created_at ?? null, link: httpOnly(i.shortlink) }];
  });
}

/** Incidents Google Workspace en cours (sans fin), perturbation ou coupure de service. */
export function workspaceIncidents(list) {
  if (!Array.isArray(list)) return [];
  return list.flatMap((i) => {
    const rule = WORKSPACE_LEVEL[i?.status_impact];
    if (!rule || i?.end) return [];
    return [{
      operator: 'Google Workspace', level: rule[0], title: `${i.service_name ?? 'Google Workspace'} : ${rule[1]}`,
      since: i.begin ?? null, link: typeof i.uri === 'string' ? `${WORKSPACE_PAGE}${i.uri}` : WORKSPACE_PAGE,
    }];
  });
}

/** @type {{ at: number, outages: ReturnType<typeof statuspageIncidents>, errors: string[] } | null} */
let last = null;
/** @type {Promise<void> | null} */
let running = null;

/** Réservé aux tests. */
export function __resetStatusForTests() {
  last = null;
  running = null;
}

async function collect(now) {
  const outages = [];
  const errors = [];
  try {
    outages.push(...workspaceIncidents(await fetchStrictJson(WORKSPACE_URL, { timeoutMs: 15_000 })));
  } catch (err) {
    errors.push(sourceError('Google Workspace', err));
  }
  for (const page of STATUSPAGES) {
    try {
      outages.push(...statuspageIncidents(await fetchStrictJson(page.url, { timeoutMs: 10_000 }), page.operator));
    } catch (err) {
      errors.push(sourceError(page.operator, err));
    }
  }
  last = { at: now, outages, errors };
}

/** Relève au plus toutes les 5 min, une seule à la fois. Ne lève jamais. */
export async function ensureStatusFresh(now = Date.now()) {
  if (last !== null && now - last.at < STATUS_INTERVAL_MS) return;
  running ??= collect(now).catch((err) => console.warn('[outages-status] relève en échec :', err instanceof Error ? err.message : err))
    .finally(() => { running = null; });
  await running;
}

/** Incidents en cours (relève de moins de 20 min) et erreurs nommées de la dernière relève. */
export function statusOutages(now = Date.now()) {
  if (last === null || now - last.at > STATUS_MAX_AGE_MS) return { outages: [], errors: last?.errors ?? [], readAt: null };
  return { outages: last.outages, errors: last.errors, readAt: new Date(last.at).toISOString() };
}
