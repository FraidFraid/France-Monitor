import { getSourcesQualityDashboardData } from './services/sources-quality-dashboard.ts';
import { startQualityHistoryTracking } from './services/source-quality-history.ts';
import type { QualityMeta, QualitySourceRow, SourcesQualityDashboardData } from './services/qualityMeta.ts';

export function renderSourcesQualityPage(container: HTMLElement): void {
  // Démarre l'historisation (idempotent) : alimente les scores observés au fil des sessions.
  startQualityHistoryTracking();
  const data = getSourcesQualityDashboardData();
  container.innerHTML = '';
  document.documentElement.classList.remove('fm-landing-mode');
  document.body.classList.remove('fm-landing-mode');
  container.appendChild(buildPage(data));
}

function buildPage(data: SourcesQualityDashboardData): HTMLElement {
  const page = document.createElement('div');
  page.className = 'sources-quality-page';
  page.innerHTML = `
    <header class="sources-quality-header">
      <a class="sources-quality-brand" href="/?view=app#live" aria-label="Retour à la carte France Monitor">
        <img class="header-logo" src="/icon.svg" alt="France Monitor logo" />
        <span class="sources-quality-brand__text"><strong>France</strong> Monitor</span>
      </a>
      <nav class="sources-quality-nav" aria-label="Navigation Sources & qualité">
        <a href="/?view=app#live">Carte</a>
        <a href="/">Accueil</a>
      </nav>
    </header>
    <main class="sources-quality-main">
      <section class="sources-quality-intro">
        <div>
          <p class="sources-quality-kicker">Gouvernance des signaux publics</p>
          <h1>Sources & qualité</h1>
          <p class="sources-quality-subtitle">Cette page rend visibles les indicateurs utilisés par France Monitor pour évaluer l’origine, la fraîcheur, la disponibilité et le niveau de confiance des signaux publics.</p>
          <p class="sources-quality-prudence">France Monitor ne remplace pas les sources officielles ni l’analyse humaine. Il agrège, qualifie et rend vérifiables des signaux publics.</p>
        </div>
        <a class="sources-quality-return" href="/?view=app#live">Retour carte</a>
      </section>
      ${renderProofChain()}
      ${renderSummary(data)}
      ${renderSourcesTable(data.sources)}
      ${renderModuleMatrix(data)}
      ${renderSignalsToReview(data)}
      ${renderMethod(data)}
      ${renderLimits(data)}
    </main>
  `;
  return page;
}

function renderProofChain(): string {
  const steps = ['Source', 'Fraîcheur', 'Confiance', 'Action'];
  return `
    <section class="sources-quality-proof" aria-label="Chaîne de lecture qualité">
      ${steps.map((step, index) => `
        <div class="sources-quality-proof__step">
          <span>${String(index + 1).padStart(2, '0')}</span>
          <strong>${escapeHtml(step)}</strong>
        </div>
      `).join('')}
    </section>
  `;
}

function renderSummary(data: SourcesQualityDashboardData): string {
  return `
    <section class="sources-quality-summary" aria-label="Synthèse qualité">
      ${Object.values(data.summary).map((metric) => `
        <article class="sources-quality-card sources-quality-card--${escapeAttr(metric.tone)}">
          <span>${escapeHtml(metric.label)}</span>
          <strong>${escapeHtml(metric.value)}</strong>
          <small>${escapeHtml(metric.detail)}</small>
        </article>
      `).join('')}
    </section>
  `;
}

function renderSourcesTable(sources: QualitySourceRow[]): string {
  return `
    <section class="sources-quality-section">
      <div class="sources-quality-section__header">
        <h2>Sources suivies</h2>
        <p>Sources réelles du projet et indicateurs disponibles sans inventer les valeurs absentes.</p>
      </div>
      <div class="sources-quality-table-wrap">
        <table class="sources-quality-table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Domaine</th>
              <th>Type</th>
              <th>Statut</th>
              <th>Fraîcheur</th>
              <th>Confiance / fiabilité</th>
              <th>Dernière collecte</th>
              <th>Limites connues</th>
            </tr>
          </thead>
          <tbody>${sources.map(renderSourceRow).join('')}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderSourceRow(source: QualitySourceRow): string {
  const quality = source.quality;
  return `
    <tr>
      <td>
        <strong>${escapeHtml(source.name)}</strong>
        ${quality.sourceUrl ? `<a href="${escapeAttr(quality.sourceUrl)}" target="_blank" rel="noopener noreferrer">Source primaire</a>` : ''}
      </td>
      <td>${escapeHtml(source.domain)}</td>
      <td>${escapeHtml(source.typeLabel)}</td>
      <td>${badge(statusLabel(quality.status), quality.status ?? 'unknown')}</td>
      <td>${escapeHtml(freshnessLabel(quality.freshnessLabel, quality.freshnessScore))}</td>
      <td>${renderReliabilityCell(quality)}</td>
      <td>${escapeHtml(source.lastCollectionLabel)}</td>
      <td>${escapeHtml(source.limitsLabel)}</td>
    </tr>
  `;
}

function renderReliabilityCell(quality: QualityMeta): string {
  const score = scoreLabel(quality.confidenceScore ?? quality.reliabilityScore);
  const provisional = quality.qualityProvisional
    ? ` ${badge('provisoire', 'provisional')}`
    : '';
  const observed = quality.observed;
  const detail = observed && observed.samples > 0
    ? `<small class="sources-quality-observed">observé sur ${observed.observationDays} j · ${observed.samples} mesures · dispo ${Math.round(observed.uptimeRate * 100)} %</small>`
    : '';
  return `<div class="sources-quality-score"><span>${escapeHtml(score)}</span>${provisional}</div>${detail}`;
}

function renderModuleMatrix(data: SourcesQualityDashboardData): string {
  return `
    <section class="sources-quality-section">
      <div class="sources-quality-section__header">
        <h2>Briques déjà qualifiées par module</h2>
        <p>Vue d’harmonisation des indicateurs déjà présents dans les modules.</p>
      </div>
      <div class="sources-quality-table-wrap">
        <table class="sources-quality-table">
          <thead>
            <tr>
              <th>Module</th>
              <th>Indicateurs déjà disponibles</th>
              <th>Données mappées</th>
              <th>Statut d’harmonisation</th>
              <th>Commentaire</th>
            </tr>
          </thead>
          <tbody>
            ${data.moduleMatrix.map((row) => `
              <tr>
                <td><strong>${escapeHtml(row.module)}</strong></td>
                <td>${escapeHtml(row.availableIndicators.join(', '))}</td>
                <td>${escapeHtml(row.mappedFields.join(', '))}</td>
                <td>${badge(row.harmonizationStatus, harmonizationTone(row.harmonizationStatus))}</td>
                <td>${escapeHtml(row.comment)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderSignalsToReview(data: SourcesQualityDashboardData): string {
  const body = data.signalsToReview.length === 0
    ? '<div class="sources-quality-empty">Aucun signal à vérifier actuellement.</div>'
    : `
      <div class="sources-quality-table-wrap">
        <table class="sources-quality-table">
          <thead>
            <tr>
              <th>Signal</th>
              <th>Domaine</th>
              <th>Source</th>
              <th>Score / confiance</th>
              <th>Raison</th>
              <th>Action recommandée</th>
            </tr>
          </thead>
          <tbody>
            ${data.signalsToReview.map((signal) => `
              <tr>
                <td><strong>${escapeHtml(signal.signal)}</strong></td>
                <td>${escapeHtml(signal.domain)}</td>
                <td>${escapeHtml(signal.source)}</td>
                <td>${escapeHtml(signal.scoreLabel)}</td>
                <td>${escapeHtml(signal.reason)}</td>
                <td>${escapeHtml(signal.action)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

  return `
    <section class="sources-quality-section">
      <div class="sources-quality-section__header">
        <h2>Signaux à vérifier</h2>
        <p>Sources ou signaux qui nécessitent une lecture humaine.</p>
      </div>
      ${body}
    </section>
  `;
}

function renderMethod(data: SourcesQualityDashboardData): string {
  return `
    <section class="sources-quality-section sources-quality-method">
      <div class="sources-quality-section__header">
        <h2>Comment le score de fiabilité est calculé</h2>
        <p>Le score n’est plus figé : il combine la nature de la source et son comportement réellement observé, et reste auditable.</p>
      </div>
      <div class="sources-quality-formula">
        <p><strong>Score = 40 % socle de nature + 60 % comportement observé.</strong></p>
        <p>Le socle de nature reflète le type de source (~90 API officielle avec clé, ~80 API publique, ~65 flux RSS, ~50 scraping ou communautaire).</p>
        <p>Le comportement observé = 100 × (0,5 · taux de succès + 0,35 · disponibilité + 0,15 · (1 − taux de fallback)), mesuré sur une fenêtre glissante de 14 jours historisée localement.</p>
        <p>Tant qu’une source compte moins de 10 mesures, son score reste égal au socle de nature et porte la mention <em>provisoire</em>.</p>
      </div>
      <div class="sources-quality-method-grid">
        <article><strong>Socle de nature</strong><span>Confiance de base liée au type de source (officielle, publique, RSS, scraping).</span></article>
        <article><strong>Taux de succès</strong><span>Part des collectes abouties sur la fenêtre observée.</span></article>
        <article><strong>Disponibilité</strong><span>Part des mesures où la source répondait sans cache figé ni erreur.</span></article>
        <article><strong>Taux de fallback</strong><span>Fréquence de recours à une source de secours ; le pénalise.</span></article>
        <article><strong>Statut</strong><span>Indique si la source est active, issue du cache, dégradée ou en erreur.</span></article>
      </div>
      <div class="sources-quality-scale">
        ${data.methodScale.map((row) => `
          <div>
            <strong>${escapeHtml(row.range)}</strong>
            <span>${escapeHtml(row.label)}</span>
            <small>${escapeHtml(row.description)}</small>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}

function renderLimits(data: SourcesQualityDashboardData): string {
  return `
    <section class="sources-quality-section sources-quality-limits">
      <div class="sources-quality-section__header">
        <h2>Limites</h2>
      </div>
      <ul>${data.limits.map((limit) => `<li>${escapeHtml(limit)}</li>`).join('')}</ul>
    </section>
  `;
}

function badge(label: string, tone: string): string {
  return `<span class="sources-quality-badge sources-quality-badge--${escapeAttr(tone)}">${escapeHtml(label)}</span>`;
}

function statusLabel(status: string | undefined): string {
  if (status === 'active') return 'Actif';
  if (status === 'cached') return 'Cache';
  if (status === 'degraded') return 'Dégradé';
  if (status === 'error') return 'Erreur';
  return 'Inconnu';
}

function harmonizationTone(status: string): string {
  if (status === 'mappé') return 'active';
  if (status === 'partiel') return 'cached';
  return 'unknown';
}

function freshnessLabel(label: string | undefined, score: number | undefined): string {
  if (!label || label === 'unknown') return 'N/D';
  const labels: Record<string, string> = {
    fresh: 'Fraîche',
    acceptable: 'Acceptable',
    stale: 'Ancienne',
  };
  return `${labels[label] ?? label}${score != null ? ` · ${score}/100` : ''}`;
}

function scoreLabel(score: number | undefined): string {
  return score == null ? 'N/D' : `${score}/100`;
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
