/**
 * WildfireDossierModal.ts — Dossier d'incident « grand feu ».
 *
 * Suit la forme de SentinelModal : overlay, clic extérieur, Escape, destroy().
 *
 * Règles de rendu non négociables (§6.2) :
 *   1. aucun chiffre sans provenance
 *   2. aucun chiffre sans niveau de source ni ses deux notes
 *   3. aucune valeur agrégée — on affiche des séries
 *   4. escapeHtml sur TOUT texte tiers
 *
 * §12.5 : les blocs observé (FIRMS) et déclaré (impacts) restent séparés,
 * sans aucun indicateur qui les agrège — l'intensité satellite et le dommage
 * humain sont décorrélés (voir le cas de référence en tête du design doc).
 */

import type {
  FireIncident, ImpactFact, ImpactFactKind, SituationSeverity, WildfireDossier,
} from '../types/index.ts';
import { fmIcon } from './shared/icons.ts';

/**
 * Échappement HTML pour tout texte tiers (§6.2 règle 4) — les cinq
 * métacaractères usuels, y compris les guillemets (une source malveillante
 * placée dans un attribut comme `href` doit ne jamais pouvoir en sortir).
 *
 * Ceci neutralise le HTML actif (`<script>`, un attribut injecté via un
 * guillemet non échappé), PAS le schéma d'une URL : `javascript:…` ne
 * contient aucun de ces cinq caractères et traverserait cet échappement
 * inchangé. C'est un problème différent, réglé séparément par
 * `isSafeSourceUrl` (round 1, Finding 1) — les deux mécanismes sont
 * complémentaires, ni l'un ni l'autre ne suffit seul.
 */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * N'autorise `sourceUrl` en lien cliquable que pour les schémas http(s).
 * `escapeHtml` protège des métacaractères HTML, pas du schéma d'une URL :
 * `javascript:alert(document.cookie)` ou `data:text/html,<script>…</script>`
 * ne contiennent aucun caractère échappé et atterriraient inchangés dans
 * `href`, où ils s'exécutent au clic malgré `target="_blank"` (qui protège
 * du tabnabbing, pas de l'exécution d'URI). `new URL(...)` lève sur une URL
 * relative ou malformée — capturé, traité comme non sûr plutôt que de
 * planter le rendu (round 1, Finding 1).
 */
function isSafeSourceUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Un fait dont le `kind` sort de l'énumération connue (donnée non validée
 * à l'exécution — `App.ts` fait un simple cast sur la réponse de
 * `/api/fires/impacts`, à venir en Task 4). `renderFactRow` indexerait
 * `KIND_LABEL` avec `undefined` et lèverait — ce garde permet à
 * `renderDeclaredBlock` d'isoler un fait malformé sans faire tomber ses
 * voisins (round 1, Finding 2).
 */
function isKnownFactKind(kind: string): kind is ImpactFactKind {
  return kind in KIND_LABEL;
}

const KIND_LABEL: Record<ImpactFactKind, string> = {
  area_ha: 'Surface brûlée',
  evacuated: 'Personnes évacuées',
  dwellings_destroyed: 'Habitations détruites',
  injured: 'Blessés',
  evacuation_order: 'Ordre d\'évacuation',
  road_closed: 'Route coupée',
  rail_disrupted: 'Trafic ferroviaire interrompu',
};

const LEVEL_LABEL: Record<ImpactFact['sourceLevel'], string> = {
  primary: 'source primaire',
  secondary: 'source secondaire',
  tertiary: 'source tertiaire',
};

const SEV_LABEL: Record<SituationSeverity, string> = {
  critical: 'CRITIQUE',
  high: 'ÉLEVÉE',
  medium: 'MOYENNE',
  watch: 'VEILLE',
};

const SEV_COLOR: Record<SituationSeverity, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  watch: '#3b82f6',
};

/**
 * Formate un nombre à la française avec un espace normal comme séparateur
 * de milliers. `toLocaleString('fr-FR')` produit un espace fine insécable
 * (U+202F, parfois U+00A0 selon l'ICU) — les deux sont normalisés ici en
 * espace ASCII : la valeur doit rester recherchable en clair dans le DOM
 * (copier-coller, tests, recherche navigateur), et rien dans le design ne
 * demande explicitement une insécabilité pour ce champ.
 */
function formatFr(value: number): string {
  return value.toLocaleString('fr-FR').replace(/[\u202f\u00a0]/g, ' ');
}

/**
 * Une ligne de fait déclaré. Export pur pour test.
 * La note combinée `D4` = fiabilité source + crédibilité information (§12.1).
 */
export function renderFactRow(fact: ImpactFact): string {
  const value =
    fact.value === null
      ? ''
      : `<strong>${escapeHtml(formatFr(fact.value))}${fact.unit ? ' ' + escapeHtml(fact.unit) : ''}</strong>`;
  const grade = `${escapeHtml(fact.reliability)}${fact.credibility ?? ''}`;
  const flags = [
    fact.provisional ? '<span class="wf-flag">provisoire</span>' : '',
    fact.hedged ? '<span class="wf-flag">approximatif</span>' : '',
  ].join('');
  // Schéma non http(s) (javascript:, data:, relatif…) → le fait reste visible
  // avec sa provenance textuelle (§3.3), mais sans lien cliquable. Jamais de
  // href="#" trompeur qui ferait croire à un lien fonctionnel (round 1, Finding 1).
  const sourceRef = isSafeSourceUrl(fact.sourceUrl)
    ? `<a href="${escapeHtml(fact.sourceUrl)}" target="_blank" rel="noopener noreferrer"
        >${escapeHtml(fact.sourceName)}</a>`
    : `<span class="wf-fact__source-name">${escapeHtml(fact.sourceName)}</span>`;

  return `
    <li class="wf-fact" data-kind="${escapeHtml(fact.kind)}">
      <div class="wf-fact__head">
        <span class="wf-fact__label">${escapeHtml(KIND_LABEL[fact.kind])}</span>
        ${value}
        <span class="wf-fact__grade" title="fiabilité source / crédibilité information">${grade}</span>
        ${flags}
      </div>
      <div class="wf-fact__meta">
        ${sourceRef}
        <span class="wf-fact__level">${escapeHtml(LEVEL_LABEL[fact.sourceLevel])}</span>
        <time datetime="${escapeHtml(fact.observedAt)}">${escapeHtml(
          new Date(fact.observedAt).toLocaleString('fr-FR'),
        )}</time>
      </div>
      <details class="wf-fact__quote">
        <summary>phrase source</summary>
        <blockquote>${escapeHtml(fact.quote)}</blockquote>
      </details>
    </li>`;
}

/** Une ligne de la chronologie des révisions area_ha — condensée, jamais réconciliée (§12.4). */
function renderAreaTimelineRow(fact: ImpactFact): string {
  const value = fact.value === null ? '?' : `${escapeHtml(formatFr(fact.value))}${fact.unit ? ' ' + escapeHtml(fact.unit) : ''}`;
  const grade = `${escapeHtml(fact.reliability)}${fact.credibility ?? ''}`;
  const when = escapeHtml(new Date(fact.observedAt).toLocaleString('fr-FR'));
  return `
    <li class="wf-timeline__row">
      <time datetime="${escapeHtml(fact.observedAt)}">${when}</time>
      <strong>${value}</strong>
      <span class="wf-timeline__source">${escapeHtml(fact.sourceName)} · ${grade}</span>
    </li>`;
}

/** Formate une durée en minutes en « Xh Ymin » (ou « Ymin » si < 1h). */
function formatDurationMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

/** Âge de l'observation la plus récente, relatif à maintenant. */
function formatAge(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 'inconnu';
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `il y a ${hours} h`;
  return `il y a ${Math.floor(hours / 24)} j`;
}

/**
 * Bloc « observé » (FIRMS) — détections, FRP, emprise, persistance, satellites.
 * Mesure instrumentale : aucun texte tiers ici (labels + nombres uniquement),
 * hormis la liste des satellites — échappée par précaution.
 */
function renderObservedBlock(incident: FireIncident): string {
  const extent = `${incident.bboxMinLat.toFixed(2)}–${incident.bboxMaxLat.toFixed(2)}° N ·
    ${incident.bboxMinLon.toFixed(2)}–${incident.bboxMaxLon.toFixed(2)}° E`;
  const labels = incident.score.labels.map(l => `<span class="wf-badge">${escapeHtml(l)}</span>`).join('');

  return `
    <h3 class="wf-modal__section-title">${fmIcon('satellite')} Observé — NASA FIRMS</h3>
    <div class="wf-observed__grid">
      <div class="wf-metric"><span class="wf-metric__label">Détections</span><strong>${incident.detectionsCount}</strong></div>
      <div class="wf-metric"><span class="wf-metric__label">FRP total</span><strong>${formatFr(Math.round(incident.frpTotal))} MW</strong></div>
      <div class="wf-metric"><span class="wf-metric__label">FRP max</span><strong>${formatFr(Math.round(incident.frpMax))} MW</strong></div>
      <div class="wf-metric"><span class="wf-metric__label">Persistance</span><strong>${formatDurationMinutes(incident.durationMinutes)}</strong></div>
      <div class="wf-metric"><span class="wf-metric__label">Confiance max</span><strong>${escapeHtml(incident.confidenceMax)}</strong></div>
      <div class="wf-metric"><span class="wf-metric__label">Détection de nuit</span><strong>${incident.hasNightDetection ? 'oui' : 'non'}</strong></div>
      <div class="wf-metric"><span class="wf-metric__label">Proche zone urbaine</span><strong>${incident.nearUrban ? 'oui' : 'non'}</strong></div>
      <div class="wf-metric wf-metric--wide"><span class="wf-metric__label">Satellites</span><strong>${escapeHtml(incident.satellites.join(', '))}</strong></div>
      <div class="wf-metric wf-metric--wide"><span class="wf-metric__label">Emprise</span><strong>${extent}</strong></div>
    </div>
    ${labels ? `<div class="wf-observed__labels">${labels}</div>` : ''}
  `;
}

/**
 * Rend un fait isolément, ou renvoie `null` s'il est malformé. `isKnownFactKind`
 * reste un chemin rapide pour rejeter tôt le cas connu (kind hors énumération) ;
 * le `try/catch` est le filet qui rend la garantie vraie pour toute AUTRE forme
 * de malformation (champ requis absent/mal typé sur un JSON tronqué, etc.) —
 * round 2, Finding 4 : couvrir `kind` seul laissait passer deux effondrements
 * collectifs (`sourceName` undefined, objet quasi vide `{id, kind}`). Ce qui
 * est écarté laisse une trace, comme pour la troncature du plafond de
 * situations (§7 — une donnée manquante s'affiche comme manquante).
 */
function renderKnownFact(fact: ImpactFact): string | null {
  try {
    if (!isKnownFactKind(fact.kind)) {
      console.warn(`[WildfireDossierModal] fait ignoré (kind inconnu) — id=${fact?.id ?? '?'}`);
      return null;
    }
    return renderFactRow(fact);
  } catch (error) {
    console.warn(`[WildfireDossierModal] fait ignoré (rendu invalide) — id=${fact?.id ?? '?'}`, error);
    return null;
  }
}

/**
 * Bloc « déclaré » — une ligne par ImpactFact, ou la mention explicite
 * d'absence (§7) : jamais un zéro, jamais un chiffre supposé. Export pur
 * pour test (round 1, Finding 2 ; round 2, Finding 4 ; round 3, Finding 5).
 *
 * Un fait écarté par `renderKnownFact` ne disparaît pas sans trace VISIBLE :
 * `console.warn` seul n'est vu que par qui ouvre les devtools. La mention
 * n'apparaît que s'il y a effectivement quelque chose à signaler (round 3).
 */
export function renderDeclaredBlock(facts: ImpactFact[]): string {
  const rendered = facts
    .map(renderKnownFact)
    .filter((html): html is string => html !== null);
  const discardedCount = facts.length - rendered.length;

  if (rendered.length === 0) {
    return `
      <h3 class="wf-modal__section-title">${fmIcon('megaphone')} Déclaré — impact humain et matériel</h3>
      <p class="wf-modal__empty">Impacts non renseignés.</p>
    `;
  }

  const noticeText = discardedCount === 1
    ? '1 fait ignoré — donnée invalide'
    : `${discardedCount} faits ignorés — donnée invalide`;
  const notice = discardedCount > 0
    ? `<p class="wf-modal__notice">${escapeHtml(noticeText)}</p>`
    : '';

  return `
    <h3 class="wf-modal__section-title">${fmIcon('megaphone')} Déclaré — impact humain et matériel</h3>
    <ul class="wf-facts">${rendered.join('')}</ul>
    ${notice}
  `;
}

/**
 * Chronologie des révisions de la surface brûlée : TOUTES les valeurs, dans
 * l'ordre chronologique, divergences incluses (§12.4) — jamais de moyenne,
 * de max ou de « dernier connu ». Section omise si aucune valeur (§6.2).
 */
function renderTimelineBlock(areaHaSeries: ImpactFact[]): string {
  if (areaHaSeries.length === 0) return '';
  return `
    <h3 class="wf-modal__section-title">${fmIcon('trending-up')} Chronologie des révisions — surface brûlée</h3>
    <ul class="wf-timeline">${areaHaSeries.map(renderAreaTimelineRow).join('')}</ul>
  `;
}

export class WildfireDossierModal {
  private overlayEl: HTMLElement;
  private panelEl: HTMLElement;
  private titleEl: HTMLElement;
  private subtitleEl: HTMLElement;
  private closeBtn: HTMLButtonElement;
  private observedEl: HTMLElement;
  private declaredEl: HTMLElement;
  private timelineEl: HTMLElement;
  private isVisible = false;

  constructor(container: HTMLElement) {
    this.overlayEl = document.createElement('div');
    this.overlayEl.className = 'wf-modal-overlay';
    this.overlayEl.style.display = 'none';

    this.panelEl = document.createElement('div');
    this.panelEl.className = 'wf-modal';
    this.panelEl.setAttribute('role', 'dialog');
    this.panelEl.setAttribute('aria-modal', 'true');
    this.panelEl.setAttribute('aria-label', 'Dossier d\'incident grand feu');

    const headerEl = document.createElement('div');
    headerEl.className = 'wf-modal__header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'wf-modal__title-wrap';

    this.titleEl = document.createElement('div');
    this.titleEl.className = 'wf-modal__title';

    this.subtitleEl = document.createElement('div');
    this.subtitleEl.className = 'wf-modal__subtitle';

    titleWrap.append(this.titleEl, this.subtitleEl);

    this.closeBtn = document.createElement('button');
    this.closeBtn.type = 'button';
    this.closeBtn.className = 'wf-modal__close';
    this.closeBtn.setAttribute('aria-label', 'Fermer');
    this.closeBtn.innerHTML = fmIcon('x');
    this.closeBtn.addEventListener('click', () => this.hide());

    headerEl.append(titleWrap, this.closeBtn);

    this.observedEl = document.createElement('section');
    this.observedEl.className = 'wf-modal__observed';

    this.declaredEl = document.createElement('section');
    this.declaredEl.className = 'wf-modal__declared';

    this.timelineEl = document.createElement('section');
    this.timelineEl.className = 'wf-modal__timeline';

    this.panelEl.append(headerEl, this.observedEl, this.declaredEl, this.timelineEl);
    this.overlayEl.appendChild(this.panelEl);
    container.appendChild(this.overlayEl);

    this.overlayEl.addEventListener('click', (event) => {
      if (event.target === this.overlayEl) this.hide();
    });

    document.addEventListener('keydown', this.handleKeydown);
  }

  private readonly handleKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.isVisible) this.hide();
  };

  show(dossier: WildfireDossier): void {
    this.isVisible = true;
    this.overlayEl.style.display = 'flex';

    const sevLabel = SEV_LABEL[dossier.severity];
    const sevColor = SEV_COLOR[dossier.severity];
    const depts = dossier.deptCodes.length > 0 ? dossier.deptCodes.join(', ') : 'département non résolu';
    const communesLabel = dossier.communes.length > 0 ? ` · ${dossier.communes.join(', ')}` : '';

    this.titleEl.innerHTML = `${fmIcon('flame')} Dossier grand feu — <span style="color:${sevColor}">${sevLabel}</span>`;
    this.subtitleEl.textContent =
      `${depts}${communesLabel} · dernière détection ${formatAge(dossier.incident.endDatetime)}`;

    this.observedEl.innerHTML = renderObservedBlock(dossier.incident);
    this.declaredEl.innerHTML = renderDeclaredBlock(dossier.facts);
    this.timelineEl.innerHTML = renderTimelineBlock(dossier.series.area_ha);
  }

  hide(): void {
    this.isVisible = false;
    this.overlayEl.style.display = 'none';
  }

  destroy(): void {
    document.removeEventListener('keydown', this.handleKeydown);
    this.overlayEl.remove();
  }
}
