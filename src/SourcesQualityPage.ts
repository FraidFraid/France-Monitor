// src/SourcesQualityPage.ts : page séparée Sources & qualité (/sources-quality). Refonte du 03/11/2026 (maquette A validée) :
// ligne d'état aux couleurs L1, puces de filtre, sources groupées par thème (problèmes d'abord, limite en clair), méthode,
// limites et détail technique repliés. Les colonnes de la liste ont une largeur fixe : elle ne bouge pas d'un filtre à l'autre.
import { getSourcesQualityDashboardData } from './services/sources-quality-dashboard.ts';
import { startQualityHistoryTracking } from './services/source-quality-history.ts';
import type { QualitySourceRow, QualityStatus, SourcesQualityDashboardData } from './services/qualityMeta.ts';
import { readSourcesSnapshot, type SourcesSnapshot } from './services/sources-snapshot.ts';

export function renderSourcesQualityPage(container: HTMLElement): void {
  // Démarre l'historisation (idempotent) : alimente les scores observés au fil des sessions.
  startQualityHistoryTracking();
  // État des flux : relevé daté laissé par la carte dans ce navigateur (03/11/2026) ; cette page ne charge aucune donnée.
  let storage: Storage | null = null;
  try { storage = typeof localStorage === 'undefined' ? null : localStorage; } catch { storage = null; }
  const now = Date.now();
  const snapshot = readSourcesSnapshot(storage, now);
  const data = getSourcesQualityDashboardData(snapshot ? { statuses: snapshot.sources } : {});
  container.innerHTML = '';
  document.documentElement.classList.remove('fm-landing-mode');
  document.body.classList.remove('fm-landing-mode');
  container.appendChild(buildPage(data, snapshot, now));
}

/** « 03/11 à 11:35 (il y a 4 min) ». */
export function snapshotWhen(at: number, now: number): string {
  const d = new Date(at);
  const date = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Paris' });
  const clock = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
  return `${date} à ${clock} (${agoLabel(now - at)})`;
}

/** « à l'instant », « il y a 4 min », « il y a 1 h 15 », « il y a 2 j ». */
export function agoLabel(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 1) return 'à l’instant';
  if (min < 60) return `il y a ${min}\u00a0min`;
  if (min < 48 * 60) return `il y a ${Math.floor(min / 60)}\u00a0h${min % 60 ? `\u00a0${String(min % 60).padStart(2, '0')}` : ''}`;
  return `il y a ${Math.floor(min / 1440)}\u00a0j`;
}

/** Familles de la liste, dans l'ordre d'affichage ; un domaine absent tombe dans « Autres ». */
export const SOURCE_FAMILIES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['Énergie', ['Énergie']],
  ['Météo et environnement', ['Météo', 'Crues', 'Hydrométrie', 'Environnement', 'Sécheresse', 'Qualité de l’air', 'Séismes', 'Catastrophes', 'Submersion marine', 'Météo spatiale']],
  ['Transports', ['Transport', 'Maritime', 'Aviation']],
  ['Réseaux et numérique', ['Infrastructures', 'Connectivité']],
  ['Défense, cyber et sanctions', ['Défense', 'Cyber', 'Sanctions']],
  ['Finance', ['Finance']],
  ['Santé et actualités', ['Santé', 'Actualités']],
];
const OTHER_FAMILY = 'Autres';

export function sourceFamily(domain: string): string {
  return SOURCE_FAMILIES.find(([, domains]) => domains.includes(domain))?.[0] ?? OTHER_FAMILY;
}

interface StatusView { label: string; color: string; /** Rang « problèmes d'abord » : erreur, dégradée, cache, à jour, non relevée. */ rank: number }
const STATUS_VIEW: Record<QualityStatus, StatusView> = {
  error: { label: 'En erreur', color: 'rouge', rank: 0 },
  degraded: { label: 'Dégradée', color: 'orange', rank: 1 },
  cached: { label: 'En cache', color: 'jaune', rank: 2 },
  active: { label: 'À jour', color: 'vert', rank: 3 },
  unknown: { label: 'Non relevée', color: 'gris', rank: 4 },
};
const statusOf = (row: QualitySourceRow): QualityStatus => row.quality.status ?? 'unknown';
const isIssue = (row: QualitySourceRow): boolean => STATUS_VIEW[statusOf(row)].rank < 3;

/** Filtre courant : « all », « issue », « official » ou le nom d'une famille. */
export type SourceFilter = string;

export function filterSources(rows: readonly QualitySourceRow[], filter: SourceFilter): QualitySourceRow[] {
  if (filter === 'all') return [...rows];
  if (filter === 'issue') return rows.filter(isIssue);
  if (filter === 'official') return rows.filter((r) => r.quality.sourceType === 'official');
  return rows.filter((r) => sourceFamily(r.domain) === filter);
}

/** Groupes par famille (ordre fixe), problèmes d'abord dans chaque groupe quand l'état est mesuré, sinon ordre alphabétique. */
export function groupSources(rows: readonly QualitySourceRow[], measured: boolean): Array<[string, QualitySourceRow[]]> {
  const order = [...SOURCE_FAMILIES.map(([f]) => f), OTHER_FAMILY];
  return order
    .map((family): [string, QualitySourceRow[]] => [family, rows.filter((r) => sourceFamily(r.domain) === family)])
    .filter(([, list]) => list.length > 0)
    .map(([family, list]) => [family, [...list].sort((a, b) =>
      (measured ? STATUS_VIEW[statusOf(a)].rank - STATUS_VIEW[statusOf(b)].rank : 0) || a.name.localeCompare(b.name, 'fr'))]);
}

/**
 * Encadré d'origine de l'état. Sans relevé : la page dit qu'il n'est pas mesuré ; avec : les deux comptes (sources documentées ici,
 * flux techniques lus par la carte).
 */
export function measureNote(snapshot: SourcesSnapshot | null, documented: number): string {
  if (!snapshot) {
    return `<p class="sq-unmeasured" role="note"><strong>État des flux non mesuré.</strong> L’état se mesure pendant que la carte charge ses données. `
      + `<a href="/?view=app#live">Ouvrez la carte</a> puis revenez : la page affichera le relevé, daté. La fiche de chaque source (origine, fiabilité, limites) reste lisible ci-dessous.</p>`;
  }
  const flows = snapshot.sources.length;
  const fresh = snapshot.sources.filter((s) => s.status === 'ok').length;
  return `<p class="sq-scope"><strong>${documented}\u00a0sources documentées</strong> ici. Le voyant de la carte compte <strong>${flows}\u00a0flux techniques</strong> (${fresh}\u00a0à jour) : une source peut en alimenter plusieurs, et certains flux ne sont pas encore documentés ici.</p>`;
}

function stateLine(rows: readonly QualitySourceRow[]): string {
  const count = (s: QualityStatus): number => rows.filter((r) => statusOf(r) === s).length;
  const parts: Array<[QualityStatus, string]> = [['active', 'sources à jour'], ['cached', 'en cache'], ['degraded', 'dégradées'], ['error', 'en erreur'], ['unknown', 'non relevées']];
  return `<div class="sq-state">${parts
    .filter(([s]) => s === 'active' || count(s) > 0)
    .map(([s, label]) => `<span class="sq-fig"><span class="sq-dot sq-dot--ring sq-c-${STATUS_VIEW[s].color}"></span><b>${count(s)}</b><span>${label}</span></span>`)
    .join('')}</div>`;
}

function chips(rows: readonly QualitySourceRow[], measured: boolean, current: SourceFilter): string {
  const opts: Array<[SourceFilter, string]> = [['all', 'Toutes'], ...(measured ? [['issue', 'À surveiller'] as [SourceFilter, string]] : []), ['official', 'Officielles'],
    ...[...SOURCE_FAMILIES.map(([f]) => f), OTHER_FAMILY].map((f): [SourceFilter, string] => [f, f])];
  return opts
    .map(([key, label]) => [key, label, filterSources(rows, key).length] as const)
    .filter(([key, , n]) => n > 0 || key === 'all')
    .map(([key, label, n]) => `<button type="button" class="sq-chip" data-sq-filter="${escapeAttr(key)}" aria-pressed="${key === current}">${escapeHtml(label)}<em>${n}</em></button>`)
    .join('');
}

function stateCell(row: QualitySourceRow, measured: boolean, now: number): string {
  if (!measured) return `<span class="sq-dot sq-c-gris"></span><span class="sq-muted">non mesuré</span>`;
  const view = STATUS_VIEW[statusOf(row)];
  const at = row.quality.collectedAt ? Date.parse(row.quality.collectedAt) : Number.NaN;
  const age = Number.isFinite(at) && statusOf(row) !== 'unknown' ? `<span class="sq-muted"> · ${agoLabel(now - at)}</span>` : '';
  return `<span class="sq-dot sq-c-${view.color}"></span><b>${view.label}</b>${age}`;
}

function scoreCell(row: QualitySourceRow): string {
  const score = row.quality.confidenceScore ?? row.quality.reliabilityScore;
  if (score == null) return '<span class="sq-muted">n.d.</span>';
  const o = row.quality.observed;
  const title = row.quality.qualityProvisional
    ? 'Moins de 10 mesures : le score reste égal au socle de nature de la source.'
    : o ? `Observé sur ${o.observationDays}\u00a0j · ${o.samples}\u00a0mesures · disponibilité ${Math.round(o.uptimeRate * 100)}\u00a0%` : '';
  return `<b>${score}</b>/100${row.quality.qualityProvisional ? `<span class="sq-prov" title="${escapeAttr(title)}">provisoire</span>` : ''}`;
}

function sourceRow(row: QualitySourceRow, measured: boolean, now: number): string {
  const link = row.quality.sourceUrl
    ? ` · <a href="${escapeAttr(row.quality.sourceUrl)}" target="_blank" rel="noopener noreferrer">source primaire</a>` : '';
  return `<div class="sq-row" role="row">
    <div class="sq-name" role="cell">${escapeHtml(row.name)}<small>${escapeHtml(row.domain)} · ${escapeHtml(row.typeLabel)}${link}</small></div>
    <div class="sq-st" role="cell">${stateCell(row, measured, now)}</div>
    <div class="sq-score" role="cell">${scoreCell(row)}</div>
    <div class="sq-lim" role="cell"><span class="sq-lim__k">Limite · </span>${escapeHtml(row.limitsLabel)}</div>
  </div>`;
}

export function renderSourceList(rows: readonly QualitySourceRow[], filter: SourceFilter, measured: boolean, now: number): string {
  const groups = groupSources(filterSources(rows, filter), measured);
  if (groups.length === 0) return '<p class="sq-empty">Aucune source dans ce filtre.</p>';
  return groups.map(([family, list]) => `<section class="sq-group" role="rowgroup" aria-label="${escapeAttr(family)}">
    <h2>${escapeHtml(family)}<em>${list.length}</em></h2>
    ${list.map((r) => sourceRow(r, measured, now)).join('')}
  </section>`).join('');
}

function methodFold(data: SourcesQualityDashboardData): string {
  const tone = (range: string): string => range.startsWith('70') ? 'vert' : range.startsWith('40') ? 'jaune' : range.startsWith('0') ? 'rouge' : 'gris';
  return `<details class="sq-fold"><summary>Comment le score de fiabilité est calculé<span>40\u00a0% nature · 60\u00a0% observé</span></summary><div class="sq-fold__body">
    <p class="sq-formula">Score = 40\u00a0% nature de la source + 60\u00a0% comportement observé</p>
    <p><strong>Nature</strong> : environ 90 pour une API officielle avec clé, 80 pour une API publique, 65 pour un flux RSS, 50 pour du scraping ou une source communautaire.</p>
    <p><strong>Comportement observé</strong> sur 14\u00a0jours glissants, historisé dans ce navigateur : taux de succès (50\u00a0%), disponibilité sans cache figé ni erreur (35\u00a0%), recours à une source de secours (15\u00a0%, pénalisé).</p>
    <p>Tant qu’une source compte moins de 10\u00a0mesures, son score reste égal au socle de nature et porte la mention <em>provisoire</em>.</p>
    <ul class="sq-scale">${data.methodScale.map((s) => `<li><span class="sq-dot sq-c-${tone(s.range)}"></span><b>${escapeHtml(s.range)}</b> · ${escapeHtml(s.label)}<small>${escapeHtml(s.description)}</small></li>`).join('')}</ul>
  </div></details>`;
}

function reviewFold(data: SourcesQualityDashboardData): string {
  if (data.signalsToReview.length === 0) return '';
  return `<details class="sq-fold"><summary>Signaux à vérifier<span>${data.signalsToReview.length}\u00a0à lire par un humain</span></summary><div class="sq-fold__body">
    <ul class="sq-review">${data.signalsToReview.map((s) => `<li><strong>${escapeHtml(s.signal)}</strong> · ${escapeHtml(s.reason)}<small>${escapeHtml(s.action)}</small></li>`).join('')}</ul>
  </div></details>`;
}

function limitsFold(data: SourcesQualityDashboardData): string {
  return `<details class="sq-fold"><summary>Ce que France Monitor ne remplace pas</summary><div class="sq-fold__body">
    <ul class="sq-bullets">${data.limits.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>
  </div></details>`;
}

function techFold(data: SourcesQualityDashboardData): string {
  return `<details class="sq-fold"><summary>Détail technique par module<span>pour l’équipe</span></summary><div class="sq-fold__body">
    <div class="sq-tech-wrap"><table class="sq-tech">
      <thead><tr><th>Module</th><th>Indicateurs disponibles</th><th>Champs mappés</th><th>Harmonisation</th><th>Commentaire</th></tr></thead>
      <tbody>${data.moduleMatrix.map((r) => `<tr><td><strong>${escapeHtml(r.module)}</strong></td><td>${escapeHtml(r.availableIndicators.join(', '))}</td><td><code>${escapeHtml(r.mappedFields.join(', '))}</code></td><td>${escapeHtml(r.harmonizationStatus)}</td><td>${escapeHtml(r.comment)}</td></tr>`).join('')}</tbody>
    </table></div>
  </div></details>`;
}

function buildPage(data: SourcesQualityDashboardData, snapshot: SourcesSnapshot | null, now: number): HTMLElement {
  const measured = snapshot !== null;
  let filter: SourceFilter = 'all';
  const page = document.createElement('div');
  page.className = 'sources-quality-page';
  page.innerHTML = `
    <header class="sq-top">
      <a class="sq-brand" href="/?view=app#live" aria-label="Retour à la carte France Monitor">
        <img class="header-logo" src="/icon.svg" alt="" />
        <span><strong>France</strong> Monitor</span>
      </a>
      <a class="sq-back" href="/?view=app#live">← Retour à la carte</a>
    </header>
    <main class="sq-main">
      <div class="sq-head">
        <div>
          <p class="sq-kicker">Gouvernance des signaux publics</p>
          <h1>Sources & qualité</h1>
        </div>
        ${snapshot ? `<p class="sq-when">État relevé par la carte le <b>${escapeHtml(snapshotWhen(snapshot.at, now))}</b>, sur ce navigateur</p>` : ''}
      </div>
      ${measured ? stateLine(data.sources) : ''}
      ${measureNote(snapshot, data.sources.length)}
      <div class="sq-chips" role="toolbar" aria-label="Filtrer les sources">${chips(data.sources, measured, filter)}</div>
      <div class="sq-list" role="table" aria-label="Sources documentées">
        <div class="sq-cols" role="row"><span role="columnheader">Source</span><span role="columnheader">État</span><span role="columnheader">Fiabilité</span><span role="columnheader">Limite connue</span></div>
        <div class="sq-rows">${renderSourceList(data.sources, filter, measured, now)}</div>
      </div>
      <p class="sq-anticipation"><a href="/anticipation/bilan">Bilan public de l’anticipation (bêta)</a> : les mots de probabilité tiennent-ils parole ?</p>
      <div class="sq-folds">
        ${methodFold(data)}
        ${reviewFold(data)}
        ${limitsFold(data)}
        ${techFold(data)}
      </div>
    </main>
  `;
  const chipBar = page.querySelector<HTMLElement>('.sq-chips');
  const list = page.querySelector<HTMLElement>('.sq-rows');
  chipBar?.addEventListener('click', (e) => {
    const btn = (e.target as Element | null)?.closest<HTMLButtonElement>('[data-sq-filter]');
    if (!btn || !list) return;
    filter = btn.dataset.sqFilter ?? 'all';
    chipBar.querySelectorAll('[data-sq-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    list.innerHTML = renderSourceList(data.sources, filter, measured, now);
  });
  return page;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  })[char] ?? char);
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
