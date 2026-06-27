import { getSourcesQualityDashboardData } from './services/sources-quality-dashboard.ts';
import type { QualitySourceRow, SourcesQualityDashboardData } from './services/qualityMeta.ts';

export function renderSourcesQualityPage(container: HTMLElement): void {
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
      <td>${escapeHtml(scoreLabel(quality.confidenceScore ?? quality.reliabilityScore))}</td>
      <td>${escapeHtml(source.lastCollectionLabel)}</td>
      <td>${escapeHtml(source.limitsLabel)}</td>
    </tr>
  `;
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
        <h2>Comment lire les scores</h2>
        <p>Les scores orientent la lecture et ne produisent pas une vérité automatique.</p>
      </div>
      <div class="sources-quality-method-grid">
        <article><strong>Fraîcheur</strong><span>Mesure l’âge ou la récence du signal.</span></article>
        <article><strong>Fiabilité source</strong><span>Estime la confiance accordée à l’origine.</span></article>
        <article><strong>Confiance signal</strong><span>Combine qualité, fraîcheur, localisation, classification ou score métier quand disponible.</span></article>
        <article><strong>Criticité</strong><span>Indique l’importance métier ou opérationnelle.</span></article>
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
