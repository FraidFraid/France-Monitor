/**
 * situation-report.ts — Rendu HTML autonome d'une « Note de situation » A4.
 *
 * Module PUR : aucun accès DOM ni réseau. Il reçoit un `SituationReportData`
 * déjà assemblé (par `collectSituationReportData` côté composant) et retourne
 * le document HTML complet, prêt à imprimer, avec son CSS inline.
 *
 * Print-first : fond blanc, texte noir, typographie institutionnelle sobre.
 * Testable en isolation (voir situation-report.test.ts).
 */

// ─── Types partagés (données de la note) ─────────────────────────────────────

/** Sévérité normalisée pour l'affichage de la note. */
export type ReportSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/** État d'une source instrumentée (miroir de DataSourceStatus.status). */
export type ReportSourceState = 'ok' | 'stale' | 'error' | 'loading';

export interface ReportSituation {
  title: string;
  severity: ReportSeverity;
  /** Libellé pré-formaté, ex. « détectée à 14:32 ». */
  since: string;
  /** Zone/région principale concernée. */
  zone: string;
  summary?: string;
}

export interface ReportStabilityDept {
  code: string;
  name: string;
  score: number;
}

export interface ReportStability {
  nationalScore: number;
  /** STABLE / VEILLE / TENSION / ÉLEVÉ / CRITIQUE. */
  statusLabel: string;
  topDepartments: ReportStabilityDept[];
}

export interface ReportDomainSignal {
  /** Nom du domaine, ex. « Écowatt », « Vigilance météo ». */
  domain: string;
  /** Niveau lisible propre au domaine, ex. « Rouge », « Perturbé ». */
  levelLabel: string;
  severity: ReportSeverity;
  detail: string;
}

export interface ReportEvent {
  /** Heure pré-formatée, ex. « 14:32 ». */
  time: string;
  place?: string;
  title: string;
  source: string;
  severity: ReportSeverity;
}

export interface ReportSource {
  label: string;
  state: ReportSourceState;
  /** Âge pré-formaté de la donnée, ex. « 3 min », « — ». */
  ageLabel: string;
}

export interface SituationReportData {
  /** Date/heure de génération pré-formatée (Europe/Paris). */
  generatedAtLabel: string;
  /** Période couverte, ex. « dernières 24 h ». */
  periodLabel: string;
  permalink: string;
  situations: ReportSituation[];
  /** Situations au-delà du plafond d'affichage (résumé en une ligne). */
  moreSituationsCount: number;
  stability: ReportStability | null;
  /** Uniquement les domaines en état NON nominal. */
  domainSignals: ReportDomainSignal[];
  events: ReportEvent[];
  /** false si le cache de presse est totalement vide (→ « non disponible »). */
  newsCacheAvailable: boolean;
  sources: ReportSource[];
  version: string | null;
}

// ─── Styles de sévérité (couleurs sobres imprimables, sans fond sombre) ──────

interface SeverityStyle {
  label: string;
  fg: string;
  bg: string;
  border: string;
}

const SEVERITY_STYLE: Record<ReportSeverity, SeverityStyle> = {
  critical: { label: 'Critique', fg: '#991b1b', bg: '#fdecec', border: '#e6a5a5' },
  high: { label: 'Élevée', fg: '#9a3412', bg: '#fdeee0', border: '#eabf94' },
  medium: { label: 'Modérée', fg: '#854d0e', bg: '#fbf3dd', border: '#e0cf94' },
  low: { label: 'Faible', fg: '#1e40af', bg: '#eaf0fd', border: '#adc2ee' },
  info: { label: 'Info', fg: '#475569', bg: '#eef1f5', border: '#c7d0dc' },
};

interface SourceStateStyle {
  label: string;
  dot: string;
}

const SOURCE_STATE_STYLE: Record<ReportSourceState, SourceStateStyle> = {
  ok: { label: 'OK', dot: '#15803d' },
  stale: { label: 'Différé', dot: '#a16207' },
  error: { label: 'Indisponible', dot: '#b91c1c' },
  loading: { label: 'Chargement', dot: '#64748b' },
};

// ─── Échappement HTML (string-based : pas de dépendance au DOM) ───────────────

/** Échappe tout contenu externe interpolé dans le HTML de la note. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Fragments de rendu ───────────────────────────────────────────────────────

function severityBadge(severity: ReportSeverity): string {
  const s = SEVERITY_STYLE[severity];
  return `<span class="badge" style="color:${s.fg};background:${s.bg};border-color:${s.border};">${escapeHtml(s.label)}</span>`;
}

function renderSituations(data: SituationReportData): string {
  if (data.situations.length === 0) {
    return `<p class="nominal">Aucune situation critique détectée. Situation nominale.</p>`;
  }

  const rows = data.situations
    .map((s) => {
      const summary = s.summary ? `<div class="sit-summary">${escapeHtml(s.summary)}</div>` : '';
      return `
        <li class="sit-item" style="border-left-color:${SEVERITY_STYLE[s.severity].fg};">
          <div class="sit-head">
            ${severityBadge(s.severity)}
            <span class="sit-title">${escapeHtml(s.title)}</span>
          </div>
          <div class="sit-meta">${escapeHtml(s.zone)} · ${escapeHtml(s.since)}</div>
          ${summary}
        </li>`;
    })
    .join('');

  const more =
    data.moreSituationsCount > 0
      ? `<p class="more">+ ${data.moreSituationsCount} situation(s) complémentaire(s) non détaillée(s).</p>`
      : '';

  return `<ul class="sit-list">${rows}</ul>${more}`;
}

function renderStability(stability: ReportStability | null): string {
  if (!stability) {
    return `<p class="unavailable">Indice de stabilité nationale : non disponible au moment de la génération.</p>`;
  }

  const depts =
    stability.topDepartments.length > 0
      ? `<div class="isnr-depts">Départements en tête : ${stability.topDepartments
          .map((d) => `${escapeHtml(d.name)} (${d.score})`)
          .join(' · ')}</div>`
      : '';

  return `
    <div class="isnr">
      <div class="isnr-score">
        <span class="isnr-value">${stability.nationalScore}</span><span class="isnr-max">/100</span>
      </div>
      <div class="isnr-body">
        <div class="isnr-label">Indice de stabilité nationale — <strong>${escapeHtml(stability.statusLabel)}</strong></div>
        ${depts}
      </div>
    </div>`;
}

function renderDomains(signals: ReportDomainSignal[]): string {
  if (signals.length === 0) {
    return `<p class="nominal">Tous les domaines suivis (énergie, météo, crues, transport, réseaux) sont à un niveau nominal.</p>`;
  }

  const rows = signals
    .map(
      (d) => `
      <li class="dom-item" style="border-left-color:${SEVERITY_STYLE[d.severity].fg};">
        <div class="dom-head">
          <span class="dom-name">${escapeHtml(d.domain)}</span>
          ${severityBadge(d.severity)}
          <span class="dom-level">${escapeHtml(d.levelLabel)}</span>
        </div>
        <div class="dom-detail">${escapeHtml(d.detail)}</div>
      </li>`,
    )
    .join('');

  return `<ul class="dom-list">${rows}</ul>`;
}

function renderEvents(data: SituationReportData): string {
  if (!data.newsCacheAvailable) {
    return `<p class="unavailable">Flux de presse non disponible au moment de la génération.</p>`;
  }
  if (data.events.length === 0) {
    return `<p class="nominal">Aucun événement à sévérité élevée ou critique sur la période.</p>`;
  }

  const rows = data.events
    .map((e) => {
      const place = e.place ? escapeHtml(e.place) : '—';
      return `
        <tr>
          <td class="ev-time">${escapeHtml(e.time)}</td>
          <td class="ev-place">${place}</td>
          <td class="ev-title">${severityBadge(e.severity)} ${escapeHtml(e.title)}</td>
          <td class="ev-source">${escapeHtml(e.source)}</td>
        </tr>`;
    })
    .join('');

  return `
    <table class="ev-table">
      <thead>
        <tr><th>Heure</th><th>Lieu</th><th>Événement</th><th>Source</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderSources(sources: ReportSource[]): string {
  if (sources.length === 0) {
    return `<p class="unavailable">Aucune source instrumentée disponible.</p>`;
  }

  const cells = sources
    .map((s) => {
      const style = SOURCE_STATE_STYLE[s.state];
      return `
        <div class="src-item">
          <span class="src-dot" style="background:${style.dot};"></span>
          <span class="src-label">${escapeHtml(s.label)}</span>
          <span class="src-state" style="color:${style.dot};">${escapeHtml(style.label)}</span>
          <span class="src-age">${escapeHtml(s.ageLabel)}</span>
        </div>`;
    })
    .join('');

  return `<div class="src-grid">${cells}</div>`;
}

// ─── Document complet ─────────────────────────────────────────────────────────

const STYLES = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    background: #f1f3f6;
    color: #1a1a1a;
    font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
    font-size: 12px;
    line-height: 1.45;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .toolbar {
    position: fixed; top: 0; left: 0; right: 0;
    display: flex; justify-content: flex-end; gap: 8px;
    padding: 10px 14px; background: #ffffff; border-bottom: 1px solid #d7dce3;
  }
  .print-btn {
    font: inherit; font-weight: 700; font-size: 12px;
    padding: 7px 14px; border: 1px solid #1a3a6b; border-radius: 6px;
    background: #1a3a6b; color: #ffffff; cursor: pointer;
  }
  .print-btn:hover { background: #22488a; }
  .sheet {
    max-width: 820px; margin: 58px auto 40px; padding: 26px 30px 22px;
    background: #ffffff; border: 1px solid #d7dce3;
  }
  .classif {
    font-size: 10px; font-weight: 800; letter-spacing: 0.14em;
    color: #64748b; text-transform: uppercase; text-align: center;
    padding: 4px; border: 1px dashed #c7d0dc; border-radius: 4px; margin-bottom: 16px;
  }
  .doc-head { border-bottom: 2px solid #1a1a1a; padding-bottom: 12px; margin-bottom: 16px; }
  .doc-title { font-size: 19px; font-weight: 800; letter-spacing: 0.01em; margin: 0 0 6px; }
  .doc-meta { font-size: 11px; color: #475569; display: flex; flex-wrap: wrap; gap: 4px 16px; }
  .doc-meta .permalink { word-break: break-all; }
  section { margin-bottom: 16px; break-inside: avoid; page-break-inside: avoid; }
  h2 {
    font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em;
    color: #1a3a6b; margin: 0 0 8px; padding-bottom: 3px; border-bottom: 1px solid #e2e6ec;
  }
  .badge {
    display: inline-block; font-size: 9px; font-weight: 800; letter-spacing: 0.04em;
    text-transform: uppercase; padding: 1px 6px; border: 1px solid; border-radius: 3px;
    vertical-align: middle;
  }
  .nominal { margin: 0; color: #15803d; font-weight: 600; }
  .unavailable { margin: 0; color: #64748b; font-style: italic; }
  .more { margin: 8px 0 0; font-size: 11px; color: #64748b; }
  ul.sit-list, ul.dom-list { list-style: none; margin: 0; padding: 0; }
  .sit-item, .dom-item {
    border-left: 3px solid #999; padding: 6px 10px; margin-bottom: 7px; background: #fafbfc;
  }
  .sit-head, .dom-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .sit-title { font-weight: 700; font-size: 12.5px; }
  .sit-meta { font-size: 10.5px; color: #64748b; margin-top: 2px; }
  .sit-summary { font-size: 11px; color: #33383f; margin-top: 3px; }
  .dom-name { font-weight: 700; }
  .dom-level { font-size: 11px; color: #475569; }
  .dom-detail { font-size: 11px; color: #33383f; margin-top: 2px; }
  .isnr { display: flex; align-items: center; gap: 14px; margin-top: 10px;
    padding: 8px 12px; background: #f6f8fb; border: 1px solid #e2e6ec; border-radius: 6px; }
  .isnr-value { font-size: 26px; font-weight: 800; color: #1a3a6b; }
  .isnr-max { font-size: 12px; color: #64748b; }
  .isnr-label { font-size: 12px; }
  .isnr-depts { font-size: 10.5px; color: #475569; margin-top: 2px; }
  table.ev-table { width: 100%; border-collapse: collapse; font-size: 11px; }
  .ev-table th {
    text-align: left; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.04em;
    color: #64748b; border-bottom: 1px solid #d7dce3; padding: 4px 6px;
  }
  .ev-table td { border-bottom: 1px solid #eef1f5; padding: 5px 6px; vertical-align: top; }
  .ev-time { white-space: nowrap; color: #475569; }
  .ev-place { white-space: nowrap; color: #475569; }
  .ev-source { white-space: nowrap; color: #64748b; }
  .src-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 3px 18px; }
  .src-item { display: flex; align-items: center; gap: 6px; font-size: 10.5px; padding: 2px 0; }
  .src-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .src-label { flex: 1; color: #33383f; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .src-state { font-weight: 700; white-space: nowrap; }
  .src-age { color: #94a3b8; white-space: nowrap; min-width: 46px; text-align: right; }
  .doc-foot {
    margin-top: 18px; padding-top: 10px; border-top: 1px solid #d7dce3;
    font-size: 10px; color: #64748b; line-height: 1.5;
  }
  .doc-foot .version { margin-top: 4px; color: #94a3b8; }
  @page { size: A4; margin: 12mm; }
  @media print {
    body { background: #ffffff; }
    .toolbar { display: none !important; }
    .sheet { max-width: none; margin: 0; padding: 0; border: none; }
  }
`;

/**
 * Rend le document HTML complet de la note de situation.
 * Autonome (CSS inline), prêt à être écrit dans une fenêtre puis imprimé.
 */
export function buildSituationReportHtml(data: SituationReportData): string {
  const version = data.version
    ? `<div class="version">Version ${escapeHtml(data.version)}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Note de situation — France Monitor</title>
  <style>${STYLES}</style>
</head>
<body>
  <div class="toolbar no-print">
    <button type="button" class="print-btn" onclick="window.print()">Imprimer / PDF</button>
  </div>
  <div class="sheet">
    <div class="classif">Diffusion libre — Sources ouvertes</div>

    <header class="doc-head">
      <h1 class="doc-title">NOTE DE SITUATION — France Monitor</h1>
      <div class="doc-meta">
        <span>Généré le ${escapeHtml(data.generatedAtLabel)}</span>
        <span>Période : ${escapeHtml(data.periodLabel)}</span>
        <span class="permalink">Vue : <a href="${escapeHtml(data.permalink)}">${escapeHtml(data.permalink)}</a></span>
      </div>
    </header>

    <section>
      <h2>Synthèse</h2>
      ${renderSituations(data)}
      ${renderStability(data.stability)}
    </section>

    <section>
      <h2>Signaux par domaine</h2>
      ${renderDomains(data.domainSignals)}
    </section>

    <section>
      <h2>Événements marquants (24 h)</h2>
      ${renderEvents(data)}
    </section>

    <section>
      <h2>Annexe — Sources auditables</h2>
      ${renderSources(data.sources)}
    </section>

    <footer class="doc-foot">
      Généré automatiquement par France Monitor — signaux issus de sources ouvertes, non vérifiés
      humainement. Distinguer signal ≠ fait confirmé.
      ${version}
    </footer>
  </div>
</body>
</html>`;
}
