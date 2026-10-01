# Panneau « État de la France » — style de référence : plan de mise en œuvre

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** réagencer et redessiner l'onglet « État de la France » de la v2 (en-tête « Instrument », sections repliables avec résumé et chevron, indicateurs redessinés) et poser le kit de style `fmk-` qui servira de référence aux autres panneaux.

**Architecture:** le modèle commun de fiche (`src/components/fiche/parts.ts`) gagne un en-tête « score » facultatif et des sections identifiées (résumé, repliable, ouverte) ; seule la fiche France les renseigne, les autres fiches gardent leur rendu. Les indicateurs v2 sont des fonctions pures nouvelles (`france-indicators.ts`) qui partagent leurs calculs avec les blocs v1 (extraits, sortie v1 identique). L'état ouvert/fermé des sections est tenu par `PosteSituation`, en mémoire et dans `localStorage`.

**Tech Stack:** TypeScript strict, DOM natif, Vite, Vitest (happy-dom pour les tests DOM), CSS dans `src/styles/main.css`.

**Spec:** `docs/superpowers/specs/2026-10-01-panneau-etat-reference-design.md`

## Global Constraints

- v2 seulement (`?ui=v2`) ; la v1 (`?view=app`) ne change pas, ni visuellement ni dans son HTML.
- Aucune donnée ajoutée ni retirée, aucune fonctionnalité retirée (courbe 7 jours, variation 24 h des piliers, courbe des prix 30 jours, bouton « National n/100 » de la ligne cyber conservés).
- Interface en français, apostrophe typographique (’), guillemets « » ; libellés anglais quand `lang === 'en'`.
- TypeScript strict : aucun `any`, aucun `!` non justifié ; DOM natif, aucune dépendance ajoutée.
- Tout texte tiers échappé (`escapeHtml` de `src/components/france-intel-events.ts`) ; seuls les paramètres nommés `*Html` passent tels quels.
- Couleurs de niveau uniquement pour exprimer un niveau (`levelColorVar`, `--sev-*`) ; vert de marque `--v2-brand` (#4bfc94) uniquement pour l'interactif.
- `localStorage` toujours sous `try/catch` ; rendu correct sans stockage.
- Avant chaque commit : `npm run typecheck`, `npx vitest run` (suite complète), `npm run build`. Commits `feat(v2): …` / `refactor(v2): …` / `test(v2): …` en français, terminés par :
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_016CCTVuVKLioWAncSRysDPG
  ```
- Branche de travail : `feat/ui-disposition-a1` (ne jamais créer de branche « ui2 ») ; rien n'est poussé.

## Review Focus

1. **Re-rendu toutes les quelques secondes** : la fiche est reconstruite à chaque donnée ; une section ouverte par l'analyste doit le rester, et le focus clavier sur un titre de section doit survivre (tâche 6, test FichePanel).
2. **Données absentes au démarrage** : baromètre pas encore reçu, énergie `null`, chronologie vide, brief absent — jamais « indisponible », jamais d'erreur, résumé lisible (« en attente », « données partielles », « calme », « en préparation ») (tâches 4 et 5).
3. **`localStorage` refusé ou corrompu** (navigation privée, JSON invalide, valeurs non booléennes) : valeurs par défaut, aucune exception (tâche 6, tests du store).
4. **v1 inchangée** : les blocs v1 et le baromètre v1 gardent exactement leur HTML (tâche 3, instantané de caractérisation ; tâche 2, scores nucléaire et éolien identiques).
5. **Avant le premier calcul (`ready: false`)** : ni score, ni échelle, ni piliers ; « Calcul du niveau national… » (tâches 1 et 5).

---

## Fichiers

| Fichier | Rôle |
|---|---|
| `src/components/fiche/kit.ts` (nouveau) | Briques HTML pures du kit : ligne de mesure, point de niveau, clé · valeur, comptes par niveau, chevron |
| `src/components/fiche/parts.ts` | `FicheScore`, `FichePillar`, champs de `FicheSection`, en-tête « Instrument », sections `fmk`, `renderSourceChips` exporté |
| `src/services/infra-continuity.ts` (nouveau) | Lignes du baromètre des infrastructures (scores nucléaire et éolien compris), pures |
| `src/components/BarometerWidget.ts` | Utilise les scores nucléaire et éolien partagés (rendu v1 identique) |
| `src/components/france-intel-blocks.ts` | Extraction des données partagées (tuiles de domaines, étiquettes, mix, pétrole, intensité) ; rendu v1 identique |
| `src/components/fiche/france-indicators.ts` (nouveau) | Sections v2 Infrastructures, Domaines, Énergie, Carburants, Chronologie (titre, résumé, HTML) |
| `src/components/france-intel-score.ts` | Exporte `PILLAR_UI`, `pillarLevel`, `formatDelta`, `renderSparkline` |
| `src/components/fiche/france.ts` | Fiche France : en-tête score, sections ordonnées et résumées, note restructurée, sources en section |
| `src/services/fiche-sections-store.ts` (nouveau) | Lecture/écriture de l'état des sections (`localStorage`) |
| `src/components/poste/FichePanel.ts` | Remonte l'ouverture/fermeture des sections, garde le focus sur un titre de section |
| `src/components/poste/PosteSituation.ts` | Tient l'état des sections, passe `infra` et l'état à la fiche France, action « open-cyber » |
| `src/App.ts` | Garde le dernier résultat du baromètre, le passe à la v2, retire l'emplacement du widget |
| `src/styles/main.css` | Kit `fmk-` sous `#app.ui-v2` |
| `docs/design/panneau-v2.md` (nouveau) | Référence écrite du kit |

---

### Task 1: Kit de rendu commun, en-tête « Instrument » et sections `fmk`

**Files:**
- Create: `src/components/fiche/kit.ts`
- Create: `src/components/fiche/kit.test.ts`
- Modify: `src/components/fiche/parts.ts` (interfaces l. 116-148, `renderSources` l. 175-186, `renderFiche` l. 189-221)
- Test: `src/components/fiche/parts.test.ts` (ajout d'un `describe`)

**Interfaces:**
- Consumes: `escapeHtml` (`../france-intel-events.ts`), `levelColorVar`, `levelLabel`, `VigilanceLevel` (`../../services/vigilance.ts`), `renderVigilancePill` (`../shared/vigilancePill.ts`).
- Produces (kit.ts) : `CHEVRON_SVG: string` ; `levelDot(level: VigilanceLevel | null): string` ; `interface MeterRow { label: string; value: number | null; level: VigilanceLevel | null; display?: string; extra?: readonly string[]; noteHtml?: string }` ; `meterRow(row: MeterRow): string` ; `kvRow(label: string, valueHtml: string): string` ; `levelCounts(levels: readonly VigilanceLevel[], lang: 'fr' | 'en'): string`.
- Produces (parts.ts) : `interface FichePillar { label: string; value: number; level: VigilanceLevel; delta: string; deduction: string }` ; `interface FicheScore { value: number; level: VigilanceLevel; baseline: number; delta24h: string; sparkline: string; pillars: FichePillar[]; factor: string | null; cap: number | null }` ; `FicheSection` gagne `id?: string; summary?: string; collapsible?: boolean; open?: boolean` ; `FicheModel` gagne `score?: FicheScore | 'pending'` ; `renderSourceChips(sources: readonly FicheSource[]): string` ; attribut `data-section="<clé de fiche>:<id>"` sur chaque section `fmk` ; classe `fiche fmk` sur l'`<article>` quand `score` est présent.

- [ ] **Step 1: Écrire les tests du kit (échouent)**

`src/components/fiche/kit.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { CHEVRON_SVG, kvRow, levelCounts, levelDot, meterRow } from './kit.ts';

describe('kit fmk (spec 2026-10-01 § 5)', () => {
  it('ligne de mesure : libellé échappé, barre à la valeur, colonnes en plus', () => {
    const html = meterRow({ label: 'Continuité <b>', value: 51, level: 'jaune', extra: ['—', '−14,7'] });
    expect(html).toContain('<span class="fmk-meter-label">Continuité &lt;b&gt;</span>');
    expect(html).toContain('width:51%;background:var(--sev-yellow)');
    expect(html).toContain('>51</span>');
    expect(html).toContain('<span class="fmk-meter-x fmk-num">−14,7</span>');
  });

  it('ligne de mesure indisponible : « — », sans barre remplie', () => {
    const html = meterRow({ label: 'Nucléaire (RTE)', value: null, level: null });
    expect(html).toContain('>—</span>');
    expect(html).not.toContain('<i style');
  });

  it('valeur bornée à 0–100 et texte de valeur imposé', () => {
    expect(meterRow({ label: 'x', value: 140, level: 'vert', display: '140 / 100' })).toContain('width:100%');
    expect(meterRow({ label: 'x', value: 140, level: 'vert', display: '140 / 100' })).toContain('>140 / 100</span>');
  });

  it('note sous la ligne passée telle quelle (HTML déjà échappé)', () => {
    expect(meterRow({ label: 'x', value: 43, level: 'rouge', noteHtml: '<button data-action="open-cyber">National 51/100</button>' }))
      .toContain('<div class="fmk-meter-note"><button data-action="open-cyber">National 51/100</button></div>');
  });

  it('point de niveau, clé · valeur, chevron', () => {
    expect(levelDot('orange')).toBe('<span class="fmk-dot fmk-dot--orange" aria-hidden="true"></span>');
    expect(levelDot(null)).toBe('<span class="fmk-dot" aria-hidden="true"></span>');
    expect(kvRow('Stocks <nationaux>', '<b>46 j</b>')).toBe('<div class="fmk-kv"><span class="fmk-kv-k">Stocks &lt;nationaux&gt;</span><span class="fmk-kv-v fmk-num"><b>46 j</b></span></div>');
    expect(CHEVRON_SVG).toContain('class="fmk-chev"');
    expect(CHEVRON_SVG).toContain('aria-hidden="true"');
  });

  it('comptes par niveau : ordre rouge → vert, zéros omis, mot lisible par lecteur d’écran', () => {
    const html = levelCounts(['vert', 'orange', 'orange', 'jaune'], 'fr');
    expect(html.indexOf('fmk-dot--orange')).toBeLessThan(html.indexOf('fmk-dot--jaune'));
    expect(html.indexOf('fmk-dot--jaune')).toBeLessThan(html.indexOf('fmk-dot--vert'));
    expect(html).not.toContain('fmk-dot--rouge');
    expect(html).toContain('<span class="fmk-sr">Orange</span><span class="fmk-num">2</span>');
    expect(levelCounts([], 'fr')).toBe('');
  });
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `npx vitest run src/components/fiche/kit.test.ts`
Expected: FAIL (« Failed to resolve import "./kit.ts" »).

- [ ] **Step 3: Écrire `kit.ts`**

```ts
// src/components/fiche/kit.ts — briques HTML pures du kit de panneau v2 « fmk » (spec 2026-10-01
// § 5) : ligne de mesure, point de niveau, clé · valeur, comptes par niveau, chevron. Tout texte
// reçu est échappé ici ; seuls les paramètres nommés *Html passent tels quels.

import { levelColorVar, levelLabel, type VigilanceLevel } from '../../services/vigilance.ts';
import { escapeHtml } from '../france-intel-events.ts';

/** Chevron des sections repliables : pointe à droite, pivoté de 90° à l'ouverture (CSS). */
export const CHEVRON_SVG = '<svg class="fmk-chev" viewBox="0 0 16 16" aria-hidden="true" focusable="false">'
  + '<path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function levelDot(level: VigilanceLevel | null): string {
  return `<span class="fmk-dot${level ? ` fmk-dot--${level}` : ''}" aria-hidden="true"></span>`;
}

export interface MeterRow {
  label: string;
  /** 0–100 ; null : indisponible (« — », barre vide). */
  value: number | null;
  level: VigilanceLevel | null;
  /** Texte de la valeur ; défaut : la valeur, ou « — ». */
  display?: string;
  /** Colonnes supplémentaires (variation, points retirés), texte brut. */
  extra?: readonly string[];
  /** HTML déjà échappé affiché sous la ligne (note, bouton). */
  noteHtml?: string;
}

/** Ligne de mesure unique du kit : libellé · barre · valeur · colonnes en plus · note. */
export function meterRow(row: MeterRow): string {
  const width = row.value === null ? 0 : Math.max(0, Math.min(100, row.value));
  const fill = row.value === null || row.level === null
    ? ''
    : `<i style="width:${width}%;background:${levelColorVar(row.level)}"></i>`;
  const display = escapeHtml(row.display ?? (row.value === null ? '—' : String(row.value)));
  const extra = (row.extra ?? []).map((x) => `<span class="fmk-meter-x fmk-num">${escapeHtml(x)}</span>`).join('');
  const note = row.noteHtml ? `<div class="fmk-meter-note">${row.noteHtml}</div>` : '';
  return `<div class="fmk-meter"><span class="fmk-meter-label">${escapeHtml(row.label)}</span>`
    + `<span class="fmk-bar">${fill}</span><span class="fmk-meter-v fmk-num">${display}</span>${extra}${note}</div>`;
}

export function kvRow(label: string, valueHtml: string): string {
  return `<div class="fmk-kv"><span class="fmk-kv-k">${escapeHtml(label)}</span><span class="fmk-kv-v fmk-num">${valueHtml}</span></div>`;
}

const LEVEL_ORDER: readonly VigilanceLevel[] = ['rouge', 'orange', 'jaune', 'vert'];

/** « ● 2 ● 1 ● 1 » pour un résumé de section : rouge → vert, niveaux absents omis. */
export function levelCounts(levels: readonly VigilanceLevel[], lang: 'fr' | 'en'): string {
  return LEVEL_ORDER
    .map((level) => ({ level, n: levels.filter((l) => l === level).length }))
    .filter((c) => c.n > 0)
    .map((c) => `<span class="fmk-count">${levelDot(c.level)}<span class="fmk-sr">${levelLabel(c.level, lang)}</span><span class="fmk-num">${c.n}</span></span>`)
    .join(' ');
}
```

Note : `levelColorVar('jaune')` vaut `var(--sev-yellow)` (vérifier dans `src/services/vigilance.ts` ; adapter l'attendu du test s'il diffère, pas la fonction).

- [ ] **Step 4: Lancer, vérifier le succès**

Run: `npx vitest run src/components/fiche/kit.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Écrire les tests de rendu de fiche (échouent)**

Ajouter à la fin de `src/components/fiche/parts.test.ts` (et `type FicheScore` à l'import de `./parts.ts`) :

```ts
describe('kit fmk dans la fiche (spec 2026-10-01)', () => {
  const score: FicheScore = {
    value: 55, level: 'orange', baseline: 95, delta24h: '—', sparkline: '<svg class="frintel-spark"></svg>',
    pillars: [
      { label: 'Continuité', value: 51, level: 'jaune', delta: '—', deduction: '−14,7' },
      { label: 'Sécurité', value: 34, level: 'vert', delta: '+2 ▲', deduction: '−6,8' },
    ],
    factor: 'Continuité — Carburants &amp; pétrole 100', cap: 55,
  };

  it('section repliable fermée : <details> sans open, titre, résumé et chevron', () => {
    const html = renderFiche(model({ key: 'france', sections: [{ id: 'infra', title: 'Infrastructures', summary: '96/100', html: '<p>x</p>', collapsible: true }] }), 'fr');
    expect(html).toContain('<details class="fiche-part fmk-sec" data-section="france:infra"><summary class="fmk-sec-h">');
    expect(html).toContain('<h3 class="fiche-part-title fmk-eyebrow">Infrastructures</h3><span class="fmk-sum">96/100</span>');
    expect(html).toContain('class="fmk-chev"');
    expect(html).toContain('<div class="fmk-sec-body"><p>x</p></div></details>');
  });

  it('section repliable ouverte : attribut open', () => {
    const html = renderFiche(model({ key: 'france', sections: [{ id: 'note', title: 'Note', html: '', collapsible: true, open: true }] }), 'fr');
    expect(html).toContain('data-section="france:note" open>');
  });

  it('section non repliable : même titre, pas de <details> ni de chevron', () => {
    const html = renderFiche(model({ key: 'france', sections: [{ id: 'situations', title: 'Situations actives', summary: '5', html: '<ul></ul>' }] }), 'fr');
    expect(html).toContain('<section class="fiche-part fmk-sec" data-section="france:situations"><div class="fmk-sec-h">');
    expect(html).not.toContain('<details class="fiche-part fmk-sec"');
    expect(html).not.toContain('fmk-chev');
  });

  it('section sans id : rendu historique inchangé', () => {
    const html = renderFiche(model({ sections: [{ title: 'Facteurs', html: '<ul><li>f</li></ul>' }] }), 'fr');
    expect(html).toContain('<section class="fiche-part fiche-extra"><h3 class="fiche-part-title">Facteurs</h3><ul><li>f</li></ul></section>');
    expect(html).toContain('<article class="fiche" data-fiche="event:42">');
  });

  it('en-tête Instrument : score coloré, pastille, échelle, piliers, facteur, plafond', () => {
    const html = renderFiche(model({ key: 'france', kind: 'État de la France', driver: 'tirée par l’énergie', freshness: '5 situations actives · MAJ 16:23', score }), 'fr');
    expect(html).toContain('<article class="fiche fmk" data-fiche="france">');
    expect(html).toContain('<h2 class="fiche-name fmk-eyebrow" tabindex="-1">État de la France</h2>');
    expect(html).toContain('<span class="fmk-score-value fmk-num" style="color:var(--sev-orange)">55</span>');
    expect(html).toContain('fm-vig--orange');
    expect(html).toContain('tirée par l’énergie');
    expect(html).toContain('class="fmk-scale-marker" style="left:55%"');
    for (const tick of ['>0<', '>55<', '>70<', '>85<', '>100<']) expect(html).toContain(tick);
    expect(html).toContain('5 situations actives · MAJ 16:23 · 24 h : —');
    expect(html).toContain('<svg class="frintel-spark"></svg>');
    expect(html).toContain('Ce qui retire des points (base 95)');
    expect(html.match(/class="fmk-meter"/g)).toHaveLength(2);
    expect(html).toContain('<span class="fmk-meter-x fmk-num">−14,7</span>');
    expect(html).toContain('Continuité — Carburants &amp; pétrole 100');
    expect(html).toContain('Plafonné à <b>55</b> tant qu’une situation corrélée est active.');
    expect(html).not.toContain('fiche-why');
  });

  it('en-tête Instrument sans plafond ni facteur : ni encart ni ligne', () => {
    const html = renderFiche(model({ key: 'france', score: { ...score, cap: null, factor: null } }), 'fr');
    expect(html).not.toContain('fmk-callout');
    expect(html).not.toContain('fmk-factor');
  });

  it('avant le calcul : « Calcul du niveau national… », ni score ni échelle', () => {
    const html = renderFiche(model({ key: 'france', kind: 'État de la France', score: 'pending' }), 'fr');
    expect(html).toContain('Calcul du niveau national…');
    expect(html).not.toContain('fmk-scale');
    expect(html).not.toContain('fmk-score-value');
  });
});
```

- [ ] **Step 6: Lancer, vérifier l'échec**

Run: `npx vitest run src/components/fiche/parts.test.ts`
Expected: FAIL (erreurs de type sur `score`, `id`… puis assertions non satisfaites).

- [ ] **Step 7: Modifier `parts.ts`**

1. Imports : ajouter `levelColorVar` à l'import de `../../services/vigilance.ts` et `import { CHEVRON_SVG, meterRow } from './kit.ts';`.
2. Remplacer `interface FicheSection` (l. 116-120) par :

```ts
export interface FicheSection {
  title: string;
  /** HTML déjà échappé par le rendu du type. */
  html: string;
  /** Kit fmk (spec 2026-10-01) : identifiant stable dans la fiche ; absent → rendu historique. */
  id?: string;
  /** HTML échappé affiché à droite du titre. */
  summary?: string;
  /** Section repliable (<details>) ; sinon titre simple au même style. */
  collapsible?: boolean;
  /** Ouverture d'une section repliable (défaut : fermée). */
  open?: boolean;
}

export interface FichePillar {
  label: string;
  /** Pression du pilier 0–100 (plus haut = pire). */
  value: number;
  level: VigilanceLevel;
  /** Variation 24 h déjà formatée (« +2 ▲ », « — »). */
  delta: string;
  /** Points retirés déjà formatés (« −14,7 »). */
  deduction: string;
}

/** En-tête « Instrument » (spec 2026-10-01 § 3.1). */
export interface FicheScore {
  value: number;
  level: VigilanceLevel;
  baseline: number;
  /** Variation 24 h du score déjà formatée. */
  delta24h: string;
  /** SVG de la courbe 7 jours, '' si trop peu de points. */
  sparkline: string;
  pillars: FichePillar[];
  /** « Facteur principal » déjà échappé ; null si aucun pilier ne pèse. */
  factor: string | null;
  cap: number | null;
}
```

3. Dans `interface FicheModel`, après `actions: FicheAction[];` :

```ts
  /** En-tête « Instrument » du kit fmk : remplace l'en-tête simple ; 'pending' avant le premier calcul. */
  score?: FicheScore | 'pending';
```

4. Remplacer `renderSources` (l. 175-186) par :

```ts
/** Étiquettes de sources et de preuves (liens http(s), sélections internes, texte). */
export function renderSourceChips(sources: readonly FicheSource[]): string {
  const chips = sources.map((s) => {
    const label = escapeHtml(s.label);
    const href = s.href ? safeHref(s.href) : null;
    if (href) return `<a class="fiche-source" href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    if (s.select) return `<button type="button" class="fiche-source fiche-link" data-select="${escapeHtml(s.select)}">${label}</button>`;
    return `<span class="fiche-source">${label}</span>`;
  }).join('');
  return `<div class="fiche-chips">${chips}</div>`;
}

function renderSources(model: FicheModel, lang: Lang): string {
  if (model.sources.length === 0) return '';
  const title = model.sourcesTitle || t(lang, 'Preuves et sources', 'Evidence and sources');
  return part('fiche-sources', escapeHtml(title), renderSourceChips(model.sources));
}

const SCALE_ZONES: ReadonlyArray<{ level: VigilanceLevel; width: number }> = [
  { level: 'rouge', width: 55 }, { level: 'orange', width: 15 }, { level: 'jaune', width: 15 }, { level: 'vert', width: 15 },
];
const SCALE_TICKS: readonly number[] = [0, 55, 70, 85, 100];

/** En-tête « Instrument » (spec 2026-10-01 § 3.1) : score, échelle, fraîcheur, piliers, facteur, plafond. */
function renderScoreHead(model: FicheModel, score: FicheScore | 'pending', lang: Lang): string {
  const title = `<h2 class="fiche-name fmk-eyebrow" tabindex="-1">${escapeHtml(model.kind)}</h2>`;
  const fresh = model.freshness ? escapeHtml(model.freshness) : '';
  if (score === 'pending') {
    return `<header class="fiche-head fmk-head">${title}`
      + `<p class="fmk-pending">${t(lang, 'Calcul du niveau national…', 'Computing the national level…')}</p>`
      + (fresh ? `<div class="fmk-fresh"><span>${fresh}</span></div>` : '')
      + `</header>`;
  }
  const driver = model.driver ? `<span class="fmk-driver">${escapeHtml(model.driver)}</span>` : '';
  const zones = SCALE_ZONES.map((z) => `<i style="flex:${z.width};background:${levelColorVar(z.level)}"></i>`).join('');
  const ticks = SCALE_TICKS.map((v) => `<span style="left:${v}%">${v}</span>`).join('');
  const marker = Math.max(0, Math.min(100, score.value));
  const pillars = score.pillars
    .map((p) => meterRow({ label: p.label, value: p.value, level: p.level, extra: [p.delta, p.deduction] }))
    .join('');
  const scaleLabel = t(lang, `Indice ${score.value} sur 100 ; seuils 55, 70 et 85`, `Index ${score.value} out of 100; thresholds 55, 70 and 85`);
  return `<header class="fiche-head fmk-head">${title}`
    + `<div class="fmk-score"><span class="fmk-score-value fmk-num" style="color:${levelColorVar(score.level)}">${score.value}</span>`
    + `<span class="fmk-score-max fmk-num">/100</span>`
    + `<span class="fmk-score-level">${renderVigilancePill(score.level, lang)}${driver}</span></div>`
    + `<div class="fmk-scale" role="img" aria-label="${escapeHtml(scaleLabel)}">`
    + `<div class="fmk-scale-zones">${zones}</div><span class="fmk-scale-marker" style="left:${marker}%"></span>`
    + `<div class="fmk-scale-ticks fmk-num" aria-hidden="true">${ticks}</div></div>`
    + `<div class="fmk-fresh"><span>${fresh ? `${fresh} · ` : ''}${t(lang, '24 h : ', '24 h: ')}${escapeHtml(score.delta24h)}</span>${score.sparkline}</div>`
    + `<div class="fmk-sub fmk-eyebrow">${t(lang, `Ce qui retire des points (base ${score.baseline})`, `What takes points off (baseline ${score.baseline})`)}</div>`
    + `<div class="fmk-meters fmk-meters--pillars">${pillars}</div>`
    + (score.factor ? `<p class="fmk-factor"><span class="fmk-muted">${t(lang, 'Facteur principal :', 'Main factor:')}</span> ${score.factor}</p>` : '')
    + (score.cap !== null
      ? `<p class="fmk-callout">${t(lang, `Plafonné à <b>${score.cap}</b> tant qu’une situation corrélée est active.`, `Capped at <b>${score.cap}</b> while a correlated situation is active.`)}</p>`
      : '')
    + `</header>`;
}

/** Section du kit (id présent) : repliable en <details>, sinon titre simple ; sans id : rendu historique. */
function renderSection(model: FicheModel, s: FicheSection): string {
  if (s.id === undefined) return part('fiche-extra', escapeHtml(s.title), s.html);
  const title = `<h3 class="fiche-part-title fmk-eyebrow">${escapeHtml(s.title)}</h3>`;
  const summary = s.summary ? `<span class="fmk-sum">${s.summary}</span>` : '';
  const key = escapeHtml(`${model.key}:${s.id}`);
  if (s.collapsible) {
    return `<details class="fiche-part fmk-sec" data-section="${key}"${s.open ? ' open' : ''}>`
      + `<summary class="fmk-sec-h">${title}${summary}${CHEVRON_SVG}</summary><div class="fmk-sec-body">${s.html}</div></details>`;
  }
  return `<section class="fiche-part fmk-sec" data-section="${key}"><div class="fmk-sec-h">${title}${summary}</div>`
    + `<div class="fmk-sec-body">${s.html}</div></section>`;
}
```

5. Dans `renderFiche` : remplacer la construction de `head` par

```ts
  const head = model.score !== undefined
    ? renderScoreHead(model, model.score, lang)
    : `<header class="fiche-head">`
      + `<div class="fiche-kind">${escapeHtml(model.kind)}</div>`
      + `<h2 class="fiche-name" tabindex="-1">${escapeHtml(model.name)}</h2>`
      + (pill || driver ? `<div class="fiche-level">${pill}${driver}</div>` : '')
      + (model.freshness ? `<div class="fiche-fresh">${escapeHtml(model.freshness)}</div>` : '')
      + `</header>`;
```

remplacer `const sections = model.sections.map((s) => part('fiche-extra', escapeHtml(s.title), s.html)).join('');` par `const sections = model.sections.map((s) => renderSection(model, s)).join('');`, et dans le `return` final `<article class="fiche" ` par `<article class="fiche${model.score !== undefined ? ' fmk' : ''}" `.

- [ ] **Step 8: Lancer, vérifier le succès**

Run: `npx vitest run src/components/fiche/`
Expected: PASS (tests existants inchangés compris).

- [ ] **Step 9: Vérifications et commit**

Run: `npm run typecheck && npx vitest run && npm run build`
Expected: aucune erreur.

```bash
git add src/components/fiche/kit.ts src/components/fiche/kit.test.ts src/components/fiche/parts.ts src/components/fiche/parts.test.ts
git commit -m "feat(v2): kit fmk — en-tête Instrument et sections repliables de la fiche

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016CCTVuVKLioWAncSRysDPG"
```

---

### Task 2: Lignes du baromètre des infrastructures, pures et partagées

**Files:**
- Create: `src/services/infra-continuity.ts`
- Create: `src/services/infra-continuity.test.ts`
- Modify: `src/components/BarometerWidget.ts` (`updateNuclear` l. 332-363, début de `_renderTooltip` l. 420-428)

**Interfaces:**
- Consumes: `NetworkBarometerResult` (`./network-barometer.ts`), `NuclearState` (`../types/index.ts`), `EolienLive` (`./eolien/types.ts`), `VigilanceLevel` (`./vigilance.ts`).
- Produces: `interface InfraInput { result: NetworkBarometerResult | null; nuclear: NuclearState | null; eolien: EolienLive | null }` ; `type InfraKey = 'bgp' | 'elec' | 'nuclear' | 'wind' | 'telecom' | 'cloud' | 'space' | 'cyber'` ; `interface InfraRow { key: InfraKey; label: string; value: number | null; note: string | null }` ; `nuclearInfraScore(state: NuclearState | null): { score: number | null; note: string | null } | null` ; `windInfraScore(live: EolienLive | null, fallback: number | null): number | null` ; `infraValueLevel(value: number | null): VigilanceLevel | null` ; `infraRows(input: InfraInput, lang: 'fr' | 'en'): InfraRow[]` ; `INFRA_NOTE: Record<'fr' | 'en', string>`.

- [ ] **Step 1: Écrire les tests (échouent)**

`src/services/infra-continuity.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { INFRA_NOTE, infraRows, infraValueLevel, nuclearInfraScore, windInfraScore, type InfraInput } from './infra-continuity.ts';
import type { NetworkBarometerResult } from './network-barometer.ts';
import type { NuclearState } from '../types/index.ts';
import type { EolienLive } from './eolien/types.ts';

function nuclear(over: Partial<NuclearState> = {}, stress: Partial<NonNullable<NuclearState['stress']>> = {}): NuclearState {
  return {
    unavailabilities: [], remitSignals: [], unconfirmedSignals: [], rteAvailable: true, remitAvailable: true,
    remitStatus: 'ok', fetchedAt: new Date(0),
    stress: {
      installedCapacityMW: 61_370, availableCapacityMW: 51_550, stressRatio: 0.16, level: 'TENSION',
      gridTensionRisk: false, updatedAt: new Date(0), freshness: 'quasi-realtime', ...stress,
    },
    ...over,
  };
}

function eolien(alertLevel: EolienLive['alertLevel']): EolienLive {
  return { production: 2600, production_gw: 2.6, puissance_installee: 23_000, facteur_charge: 13, parcs_actifs: 2000, timestamp: new Date(0), alertLevel };
}

function result(details: Record<string, number | null>): NetworkBarometerResult {
  return { score: 96, status: 'nominal', details, computedAt: new Date(0), reliable: true };
}

describe('baromètre des infrastructures (spec 2026-10-01 § 3.2)', () => {
  it('score nucléaire = disponible / installé, note REMIT ou tension', () => {
    expect(nuclearInfraScore(nuclear())).toEqual({ score: 84, note: null });
    expect(nuclearInfraScore(nuclear({}, { gridTensionRisk: true }))).toEqual({ score: 84, note: 'sous tension' });
    expect(nuclearInfraScore(nuclear({ rteAvailable: false }))).toEqual({ score: null, note: 'Indisponible' });
    expect(nuclearInfraScore(nuclear({ stress: null }))).toBeNull();
    expect(nuclearInfraScore(null)).toBeNull();
  });

  it('score éolien : alerte en direct, sinon valeur du baromètre', () => {
    expect(windInfraScore(eolien('normal'), 12)).toBe(100);
    expect(windInfraScore(eolien('watch'), 12)).toBe(70);
    expect(windInfraScore(eolien('low-production'), 12)).toBe(40);
    expect(windInfraScore(null, 12)).toBe(12);
    expect(windInfraScore(null, null)).toBeNull();
  });

  it('niveau d’une ligne : ≥ 85 vert, ≥ 60 jaune, sinon rouge', () => {
    expect(infraValueLevel(85)).toBe('vert');
    expect(infraValueLevel(84)).toBe('jaune');
    expect(infraValueLevel(60)).toBe('jaune');
    expect(infraValueLevel(59)).toBe('rouge');
    expect(infraValueLevel(null)).toBeNull();
  });

  it('8 lignes dans l’ordre du baromètre, résilience cyber en dernier', () => {
    const input: InfraInput = {
      result: result({ bgp: 100, elec: 100, telecom: 93, cloud: 99, space: 100, cyber: 43, wind: 55 }),
      nuclear: nuclear(), eolien: null,
    };
    const rows = infraRows(input, 'fr');
    expect(rows.map((r) => r.key)).toEqual(['bgp', 'elec', 'nuclear', 'wind', 'telecom', 'cloud', 'space', 'cyber']);
    expect(rows.map((r) => r.value)).toEqual([100, 100, 84, 55, 93, 99, 100, 43]);
    expect(rows[0]?.label).toBe('BGP / Internet');
    expect(rows[7]?.label).toBe('Résilience cyber infra');
  });

  it('sans résultat : aucune ligne ; source absente : valeur null', () => {
    expect(infraRows({ result: null, nuclear: null, eolien: null }, 'fr')).toEqual([]);
    const rows = infraRows({ result: result({}), nuclear: null, eolien: null }, 'fr');
    expect(rows.every((r) => r.value === null)).toBe(true);
  });

  it('libellés anglais et note d’explication', () => {
    expect(infraRows({ result: result({ bgp: 100 }), nuclear: null, eolien: null }, 'en')[1]?.label).toBe('Electricity (Ecowatt)');
    expect(INFRA_NOTE.fr).toBe('Score de continuité borné. La ligne cyber mesure la résilience infra, pas la pression cyber nationale.');
  });
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `npx vitest run src/services/infra-continuity.test.ts`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Écrire `infra-continuity.ts`**

```ts
// src/services/infra-continuity.ts — lignes du baromètre « Continuité infrastructure France »,
// en données pures : partagées entre l'infobulle v1 (BarometerWidget) et la section
// Infrastructures de la fiche France v2 (spec 2026-10-01 § 3.2). Mêmes seuils que le widget.

import type { NuclearState } from '../types/index.ts';
import type { EolienLive } from './eolien/types.ts';
import type { NetworkBarometerResult } from './network-barometer.ts';
import type { VigilanceLevel } from './vigilance.ts';

export interface InfraInput {
  result: NetworkBarometerResult | null;
  nuclear: NuclearState | null;
  eolien: EolienLive | null;
}

export type InfraKey = 'bgp' | 'elec' | 'nuclear' | 'wind' | 'telecom' | 'cloud' | 'space' | 'cyber';

export interface InfraRow {
  key: InfraKey;
  label: string;
  /** 0–100 ; null : source indisponible. */
  value: number | null;
  /** Précision (« écart REMIT », « sous tension », « Indisponible »), sinon null. */
  note: string | null;
}

export const INFRA_NOTE: Record<'fr' | 'en', string> = {
  fr: 'Score de continuité borné. La ligne cyber mesure la résilience infra, pas la pression cyber nationale.',
  en: 'Bounded continuity score. The cyber line measures infrastructure resilience, not national cyber pressure.',
};

const LABELS: Record<InfraKey, Record<'fr' | 'en', string>> = {
  bgp: { fr: 'BGP / Internet', en: 'BGP / Internet' },
  elec: { fr: 'Électricité (Écowatt)', en: 'Electricity (Ecowatt)' },
  nuclear: { fr: 'Nucléaire (RTE)', en: 'Nuclear (RTE)' },
  wind: { fr: 'Éolien (éCO2mix)', en: 'Wind (éCO2mix)' },
  telecom: { fr: 'Télécom (ARCEP)', en: 'Telecom (ARCEP)' },
  cloud: { fr: 'Cloud / Web', en: 'Cloud / Web' },
  space: { fr: 'Météo spatiale', en: 'Space weather' },
  cyber: { fr: 'Résilience cyber infra', en: 'Infra cyber resilience' },
};

/** Disponible / installé (RTE) ; null sans état ; score null si RTE est indisponible. */
export function nuclearInfraScore(state: NuclearState | null): { score: number | null; note: string | null } | null {
  if (!state || !state.stress) return null;
  if (!state.rteAvailable) return { score: null, note: 'Indisponible' };
  const installed = state.stress.installedCapacityMW;
  const available = state.stress.availableCapacityMW;
  const ratio = installed > 0 ? available / installed : 0;
  const score = Math.max(0, Math.min(100, Math.round(ratio * 100)));
  const note = state.unconfirmedSignals.length > 0 ? 'écart REMIT' : state.stress.gridTensionRisk ? 'sous tension' : null;
  return { score, note };
}

/** Éolien calculé sur l'alerte en direct (évite le retard du cache du baromètre), sinon valeur du baromètre. */
export function windInfraScore(live: EolienLive | null, fallback: number | null): number | null {
  if (live) return live.alertLevel === 'normal' ? 100 : live.alertLevel === 'watch' ? 70 : 40;
  return fallback;
}

/** Seuils du baromètre : ≥ 85 vert, ≥ 60 jaune, sinon rouge. */
export function infraValueLevel(value: number | null): VigilanceLevel | null {
  if (value === null) return null;
  if (value >= 85) return 'vert';
  if (value >= 60) return 'jaune';
  return 'rouge';
}

export function infraRows(input: InfraInput, lang: 'fr' | 'en'): InfraRow[] {
  if (!input.result) return [];
  const d = input.result.details;
  const nuclear = nuclearInfraScore(input.nuclear);
  const values: Array<[InfraKey, number | null, string | null]> = [
    ['bgp', d.bgp ?? null, null],
    ['elec', d.elec ?? null, null],
    ['nuclear', nuclear?.score ?? null, nuclear?.note ?? null],
    ['wind', windInfraScore(input.eolien, d.wind ?? null), null],
    ['telecom', d.telecom ?? null, null],
    ['cloud', d.cloud ?? null, null],
    ['space', d.space ?? null, null],
    ['cyber', d.cyber ?? null, null],
  ];
  return values.map(([key, value, note]) => ({ key, label: LABELS[key][lang], value, note }));
}
```

- [ ] **Step 4: Lancer, vérifier le succès**

Run: `npx vitest run src/services/infra-continuity.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Brancher le widget v1 sur les scores partagés (rendu identique)**

Dans `src/components/BarometerWidget.ts` :
- ajouter `import { nuclearInfraScore, windInfraScore } from '../services/infra-continuity.ts';`
- remplacer le corps de `updateNuclear` par :

```ts
  updateNuclear(state: NuclearState | null): void {
    const nuclear = nuclearInfraScore(state);
    if (!nuclear) {
      this.currentNuclear = null;
    } else if (nuclear.score === null) {
      this.currentNuclear = { label: 'Indisponible', score: null, color: 'var(--text-muted)' };
    } else {
      const score = nuclear.score;
      const color = score >= 85 ? '#34c759' : score >= 60 ? '#ffcc00' : '#ff2d55';
      const label = nuclear.note ? `${score} / 100 · ${nuclear.note}` : `${score} / 100`;
      this.currentNuclear = { label, score, color };
    }
    this._refreshTooltip();
  }
```

- dans `_renderTooltip`, remplacer les lignes 421-425 (calcul de `windScore`) par :

```ts
    // Éolien calculé sur l'alerte en direct (évite le retard du cache du baromètre).
    const windScore = windInfraScore(this.currentEolienLive, details.wind ?? null);
```

et supprimer la ligne `const eolien = this.currentEolienLive;` devenue inutile. Le reste de l'infobulle ne change pas.

- [ ] **Step 6: Vérifications et commit**

Run: `npm run typecheck && npx vitest run && npm run build`
Expected: aucune erreur.

```bash
git add src/services/infra-continuity.ts src/services/infra-continuity.test.ts src/components/BarometerWidget.ts
git commit -m "refactor(v2): lignes du baromètre des infrastructures en fonctions pures partagées

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016CCTVuVKLioWAncSRysDPG"
```

---

### Task 3: Données partagées des blocs Domaines, Énergie et Chronologie (v1 identique)

**Files:**
- Modify: `src/components/france-intel-blocks.ts`
- Test: `src/components/france-intel-blocks.test.ts` (ajouts) ; instantané créé dans `src/components/__snapshots__/france-intel-blocks.test.ts.snap`

**Interfaces:**
- Consumes: types existants (`FranceCountrySignals`, `FranceCountrySnapshot`, `FranceIntelEnergySummary`, `OilVigilanceStatus`), `levelColorVar`, `VigilanceLevel`.
- Produces: `type DomainLevel = 'low' | 'medium' | 'high'` ; `interface DomainTile { label: string; value: number; meta: string; level: DomainLevel }` ; `DOMAIN_LEVEL: Record<DomainLevel, VigilanceLevel>` (`low → vert`, `medium → jaune`, `high → orange`) ; `domainTiles(signals: FranceCountrySignals, lang: Lang): DomainTile[]` ; `interface DomainChip { text: string; tone: 'warn' | 'crit' }` ; `domainChips(snapshot: Pick<FranceCountrySnapshot, 'signals' | 'meteo'>, lang: Lang): DomainChip[]` ; `type EnergyKey = 'nuclear' | 'gas' | 'hydro' | 'wind' | 'solar' | 'other'` ; `interface EnergySegment { key: EnergyKey; color: string; value: number }` ; `energySegments(energy: FranceIntelEnergySummary): EnergySegment[]` (segments > 0 seulement) ; `oilStatusInfo(status: OilVigilanceStatus | null, lang: Lang): { level: VigilanceLevel | null; label: string }` ; `timelineIntensity(count: number): number`.

- [ ] **Step 1: Figer le rendu v1 actuel (instantané de caractérisation)**

Ajouter à la fin de `src/components/france-intel-blocks.test.ts` :

```ts
describe('rendu v1 figé avant extraction (spec 2026-10-01, v1 inchangée)', () => {
  const rich = {
    signals: signals({
      cyberAlerts: 24, cyberCritical: 20, railDisruptions: 215, railSevere: 159, militaryFlights: 36,
      powerOutages: 6, telecomOutages: 1333, meteoAlerts: 10, fireDetections: 29, marketStress: 7, criticalNews: 2,
      jammingSignals: 1,
    }),
    meteo: [
      { department: 'Var', departmentCode: '83', level: 'yellow' as const, risks: ['thunderstorm'] },
      { department: 'Gard', departmentCode: '30', level: 'orange' as const, risks: ['thunderstorm', 'rain-flood'] },
    ],
  };
  const history = {
    provider: 'carbu' as const, generatedAt: '2026-10-01T00:00:00Z', sourceLabel: 'test',
    rangeStart: '2026-09-01T00:00:00Z', rangeEnd: '2026-10-01T00:00:00Z',
    series: [{
      fuelType: 'gazole' as const, label: 'Gazole (B7)', color: '#f59e0b', latestPrice: 2.337, delta7dCents: -6.3, delta30dCents: -1,
      points: [{ timestamp: '2026-09-20T00:00:00Z', price: 2.4 }, { timestamp: '2026-10-01T00:00:00Z', price: 2.337 }],
    }],
  };

  it('domaines', () => {
    expect(renderDomainsBlock(rich, 'fr')).toMatchSnapshot();
    expect(renderDomainsBlock(rich, 'en')).toMatchSnapshot();
  });

  it('énergie et carburants', () => {
    expect(renderEnergyBlock(energy({ fuelPriceHistory: history }), 'fr')).toMatchSnapshot();
    expect(renderEnergyBlock(energy({ oilVigilanceStatus: 'unknown', fuelTensionLevel: null, ecowattSignal: null }), 'en')).toMatchSnapshot();
    expect(renderEnergyBlock(null, 'fr')).toMatchSnapshot();
  });

  it('chronologie', () => {
    expect(renderTimelineBlock({
      days: ['25 sept.', '26 sept.'],
      lanes: [{ key: 'weather', label: 'Météo', color: '#eab308', counts: [0, 10] }],
    }, 'fr')).toMatchSnapshot();
  });
});
```

Run: `npx vitest run src/components/france-intel-blocks.test.ts`
Expected: PASS, « 6 snapshots written ». Ajouter le fichier `.snap` créé au commit de cette tâche.

- [ ] **Step 2: Écrire les tests des fonctions extraites (échouent)**

Ajouter au même fichier (et ces noms à l'import de `./france-intel-blocks.ts`) :

```ts
describe('données partagées des blocs (spec 2026-10-01)', () => {
  it('tuiles de domaines : 8, dans l’ordre, avec niveau', () => {
    const tiles = domainTiles(signals({ cyberAlerts: 24, cyberCritical: 20, militaryFlights: 36 }), 'fr');
    expect(tiles.map((t) => t.label)).toEqual(['Cyber', 'Rail', 'Militaire', 'Maritime', 'Pannes', 'Défense', 'Météo', 'Finance']);
    expect(tiles[0]).toEqual({ label: 'Cyber', value: 24, meta: 'alertes 30j · 20 CVE', level: 'high' });
    expect(tiles[2]?.level).toBe('medium');
    expect(DOMAIN_LEVEL).toEqual({ low: 'vert', medium: 'jaune', high: 'orange' });
  });

  it('étiquettes : risques météo cumulés, SNCF fortes, titres critiques', () => {
    const chips = domainChips({
      signals: signals({ railSevere: 3, criticalNews: 2 }),
      meteo: [
        { department: 'Var', departmentCode: '83', level: 'yellow', risks: ['thunderstorm'] },
        { department: 'Gard', departmentCode: '30', level: 'yellow', risks: ['thunderstorm'] },
      ],
    }, 'fr');
    expect(chips).toEqual([
      { text: 'Orages · Jaune ×2', tone: 'warn' },
      { text: '3 SNCF fortes', tone: 'warn' },
      { text: '2 titres critiques', tone: 'crit' },
    ]);
  });

  it('mix énergétique : segments non nuls seulement', () => {
    expect(energySegments(energy({ shares: { nuclear: 70, gas: 0, hydro: 10, wind: 8, solar: 4, other: 8 } })).map((s) => s.key))
      .toEqual(['nuclear', 'hydro', 'wind', 'solar', 'other']);
  });

  it('statut pétrolier : jamais vert si inconnu', () => {
    expect(oilStatusInfo('tense', 'fr')).toEqual({ level: 'orange', label: 'Sous tension' });
    expect(oilStatusInfo('critical', 'fr')).toEqual({ level: 'rouge', label: 'Critique' });
    expect(oilStatusInfo('normal', 'en')).toEqual({ level: 'vert', label: 'Normal' });
    expect(oilStatusInfo('unknown', 'fr')).toEqual({ level: null, label: 'Inconnu' });
    expect(oilStatusInfo(null, 'fr')).toEqual({ level: null, label: 'Inconnu' });
  });

  it('intensité de la chronologie', () => {
    expect([0, 1, 2, 3, 9].map(timelineIntensity)).toEqual([0.08, 0.25, 0.45, 0.65, 0.9]);
  });
});
```

Run: `npx vitest run src/components/france-intel-blocks.test.ts`
Expected: FAIL (exports manquants).

- [ ] **Step 3: Extraire sans changer le rendu**

Dans `src/components/france-intel-blocks.ts` :

1. Imports : ajouter `FranceCountrySignals`, `OilVigilanceStatus` à l'import de types ; ajouter `type VigilanceLevel` à l'import de `../services/vigilance.ts`.
2. Renommer `function intensity` en `export function timelineIntensity` et mettre à jour son appel dans `renderTimelineLane`.
3. Ajouter, avant `renderDomainsBlock` :

```ts
export type DomainLevel = 'low' | 'medium' | 'high';

export interface DomainTile {
  label: string;
  value: number;
  meta: string;
  level: DomainLevel;
}

/** Niveau L1 d'une tuile de domaine (couleurs du point, inchangées depuis le tiroir v1). */
export const DOMAIN_LEVEL: Record<DomainLevel, VigilanceLevel> = { low: 'vert', medium: 'jaune', high: 'orange' };

export function domainTiles(s: FranceCountrySignals, lang: Lang): DomainTile[] {
  const outages = s.powerOutages + s.telecomOutages;
  const meteoTotal = s.meteoAlerts + s.floodAlerts + s.fireDetections;
  return [
    {
      label: 'Cyber', value: s.cyberAlerts,
      meta: `${t(lang, 'alertes 30j', '30d alerts')} · ${s.cyberCritical} CVE`,
      level: s.cyberCritical > 0 ? 'high' : s.cyberAlerts > 5 ? 'medium' : 'low',
    },
    {
      label: 'Rail', value: s.railDisruptions,
      meta: `${s.railSevere} ${t(lang, 'fortes', 'severe')}`,
      level: s.railSevere > 0 ? 'high' : s.railDisruptions > 10 ? 'medium' : 'low',
    },
    {
      label: t(lang, 'Militaire', 'Military'), value: s.militaryFlights,
      meta: t(lang, 'vols actifs', 'active flights'),
      level: s.militaryFlights > 10 ? 'medium' : 'low',
    },
    {
      label: 'Maritime', value: s.maritimeTrafficFrance,
      meta: t(lang, 'navires zone FR', 'ships FR waters'),
      level: 'low',
    },
    {
      label: t(lang, 'Pannes', 'Outages'), value: outages,
      meta: `${t(lang, 'élec', 'power')} ${s.powerOutages} · ${t(lang, 'télécom', 'telecom')} ${s.telecomOutages}`,
      level: outages > 5 ? 'high' : outages > 0 ? 'medium' : 'low',
    },
    {
      label: t(lang, 'Défense', 'Defense'), value: s.defenseAlerts + s.jammingSignals,
      meta: `${t(lang, 'câbles', 'cables')} ${s.defenseAlerts} · GPS ${s.jammingSignals}`,
      level: s.defenseHigh > 0 || s.jammingSignals > 0 ? 'high' : s.defenseAlerts > 0 ? 'medium' : 'low',
    },
    {
      label: t(lang, 'Météo', 'Weather'), value: meteoTotal,
      meta: `${t(lang, 'vigies', 'watches')} ${s.meteoAlerts} · ${t(lang, 'crues', 'floods')} ${s.floodAlerts} · ${t(lang, 'feux', 'fires')} ${s.fireDetections}`,
      level: s.meteoAlerts > 3 || s.floodAlerts > 2 ? 'high' : meteoTotal > 0 ? 'medium' : 'low',
    },
    {
      label: 'Finance', value: s.marketStress,
      meta: t(lang, 'lignes sous tension', 'stressed lines'),
      level: s.marketStress > 2 ? 'medium' : 'low',
    },
  ];
}

export interface DomainChip {
  text: string;
  tone: 'warn' | 'crit';
}

/** Étiquettes sous les domaines : risques météo actifs, SNCF fortes, titres critiques. */
export function domainChips(snapshot: Pick<FranceCountrySnapshot, 'signals' | 'meteo'>, lang: Lang): DomainChip[] {
  const s = snapshot.signals;
  const riskMap = new Map<string, { level: MeteoVigilanceLevel; count: number }>();
  for (const alert of snapshot.meteo.filter((item) => item.level !== 'green')) {
    for (const risk of alert.risks) {
      const prev = riskMap.get(risk);
      riskMap.set(risk, {
        level: prev && (prev.level === 'red' || prev.level === 'violet') ? prev.level : alert.level,
        count: (prev?.count ?? 0) + 1,
      });
    }
  }
  const chips: DomainChip[] = [];
  for (const [risk, item] of riskMap.entries()) {
    chips.push({ text: `${RISK_LABELS[risk] ?? risk} · ${VIGILANCE_LABELS[item.level]}${item.count > 1 ? ` ×${item.count}` : ''}`, tone: 'warn' });
  }
  if (s.railSevere > 0) chips.push({ text: `${s.railSevere} SNCF ${t(lang, 'fortes', 'severe')}`, tone: 'warn' });
  if (s.criticalNews > 0) chips.push({ text: `${s.criticalNews} ${t(lang, 'titres critiques', 'critical headlines')}`, tone: 'crit' });
  return chips;
}

export type EnergyKey = 'nuclear' | 'gas' | 'hydro' | 'wind' | 'solar' | 'other';

export interface EnergySegment {
  key: EnergyKey;
  color: string;
  value: number;
}

/** Mix de production (couleurs du tiroir v1), segments non nuls. */
export function energySegments(energy: FranceIntelEnergySummary): EnergySegment[] {
  const all: EnergySegment[] = [
    { key: 'nuclear', color: '#7c3aed', value: energy.shares.nuclear },
    { key: 'gas', color: '#2563eb', value: energy.shares.gas },
    { key: 'hydro', color: '#38bdf8', value: energy.shares.hydro },
    { key: 'wind', color: '#60a5fa', value: energy.shares.wind },
    { key: 'solar', color: '#facc15', value: energy.shares.solar },
    { key: 'other', color: '#34c759', value: energy.shares.other },
  ];
  return all.filter((segment) => segment.value > 0);
}

/** Statut des stocks pétroliers : jamais vert pour un statut inconnu. */
export function oilStatusInfo(status: OilVigilanceStatus | null, lang: Lang): { level: VigilanceLevel | null; label: string } {
  if (status === 'critical') return { level: 'rouge', label: t(lang, 'Critique', 'Critical') };
  if (status === 'tense') return { level: 'orange', label: t(lang, 'Sous tension', 'Tense') };
  if (status === 'normal') return { level: 'vert', label: t(lang, 'Normal', 'Normal') };
  return { level: null, label: t(lang, 'Inconnu', 'Unknown') };
}
```

Ces 8 objets sont ceux du tableau `tiles` actuel de `renderDomainsBlock`, déplacés tels quels (le type `Level` local disparaît au profit de `DomainLevel`) ; l'instantané de l'étape 1 garantit qu'aucun n'a changé.

4. Réécrire les blocs v1 sur ces fonctions, sans changer leur HTML :
   - `renderDomainsBlock` : `const tiles = domainTiles(snapshot.signals, lang);` ; `levelColor` devient `(level: DomainLevel) => levelColorVar(DOMAIN_LEVEL[level])` ; les étiquettes deviennent `domainChips(snapshot, lang).map((c) => \`<span class="frintel-chip frintel-chip-${c.tone}">${escapeHtml(c.text)}</span>\`)`.
   - `renderEnergyBlock` : `const V1_ENERGY_LABEL: Record<EnergyKey, string> = { nuclear: 'Nuclear', gas: 'Gas', hydro: 'Hydro', wind: 'Wind', solar: 'Solar', other: '' };` puis `energy ? energySegments(energy).map((s) => ({ label: s.key === 'other' ? t(lang, 'Autre', 'Other') : V1_ENERGY_LABEL[s.key], color: s.color, value: s.value })) : []` ; `oilColor` / `oilLabel` deviennent `const oil = oilStatusInfo(oilStatus, lang); const oilColor = oil.level ? levelColorVar(oil.level) : 'var(--text-secondary)'; const oilLabel = oil.label;`.

- [ ] **Step 4: Lancer, vérifier le succès (instantanés identiques)**

Run: `npx vitest run src/components/france-intel-blocks.test.ts`
Expected: PASS, aucun instantané réécrit (« 6 passed » côté snapshots). Un instantané en échec = le rendu v1 a changé : corriger l'extraction, jamais l'instantané.

- [ ] **Step 5: Vérifications et commit**

Run: `npm run typecheck && npx vitest run && npm run build`

```bash
git add src/components/france-intel-blocks.ts src/components/france-intel-blocks.test.ts src/components/__snapshots__/france-intel-blocks.test.ts.snap
git commit -m "refactor(v2): données des blocs Domaines, Énergie et Chronologie partagées, rendu v1 figé

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016CCTVuVKLioWAncSRysDPG"
```

---

### Task 4: Sections d'indicateurs v2

**Files:**
- Create: `src/components/fiche/france-indicators.ts`
- Create: `src/components/fiche/france-indicators.test.ts`

**Interfaces:**
- Consumes: tâche 1 (`kit.ts` : `meterRow`, `levelDot`, `kvRow`, `levelCounts`) ; tâche 2 (`infraRows`, `infraValueLevel`, `INFRA_NOTE`, `InfraInput`) ; tâche 3 (`domainTiles`, `domainChips`, `DOMAIN_LEVEL`, `energySegments`, `EnergyKey`, `oilStatusInfo`, `timelineIntensity`) ; `infraStatusLevel`, `officialLevel`, `levelLabel`, `fuelTensionLevel` (`src/services/vigilance.ts`) ; `renderVigilancePill` ; `filterFuelPriceSeries`, `formatFuelPrice`, `formatFuelDeltaCents`, `renderFuelPriceChartSvg` (`src/utils/fuelPriceChart.ts`) ; `formatNumber` (`./parts.ts`).
- Produces: `type IndicatorId = 'infra' | 'domains' | 'energy' | 'fuel' | 'timeline'` ; `interface IndicatorSection { id: IndicatorId; title: string; summary: string; html: string }` ; `infraSection(infra: InfraInput | null, lang: Lang): IndicatorSection` ; `domainsSection(snapshot: Pick<FranceCountrySnapshot, 'signals' | 'meteo'>, lang: Lang): IndicatorSection` ; `energySection(energy: FranceIntelEnergySummary | null, lang: Lang): IndicatorSection` ; `fuelSection(energy: FranceIntelEnergySummary | null, lang: Lang): IndicatorSection | null` ; `timelineSection(timeline: FranceCountrySnapshot['timeline'], lang: Lang): IndicatorSection`.

- [ ] **Step 1: Écrire les tests (échouent)**

`src/components/fiche/france-indicators.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { domainsSection, energySection, fuelSection, infraSection, timelineSection } from './france-indicators.ts';
import { formatFuelDeltaCents } from '../../utils/fuelPriceChart.ts';
import type { FranceCountrySignals, FranceIntelEnergySummary } from '../../types/index.ts';
import type { NetworkBarometerResult } from '../../services/network-barometer.ts';

function signals(over: Partial<FranceCountrySignals> = {}): FranceCountrySignals {
  return {
    criticalNews: 0, highNews: 0, topNewsCount: 0, meteoAlerts: 0, floodAlerts: 0, fireDetections: 0,
    railDisruptions: 0, railSevere: 0, roadIncidents: 0, powerOutages: 0, telecomOutages: 0,
    cyberAlerts: 0, cyberCritical: 0, militaryFlights: 0, maritimeTrafficFrance: 0,
    defenseAlerts: 0, defenseHigh: 0, jammingSignals: 0, marketStress: 0, ...over,
  };
}

function energy(over: Partial<FranceIntelEnergySummary> = {}): FranceIntelEnergySummary {
  return {
    ecowattSignal: 'green', totalMw: 49305, shares: { nuclear: 62, gas: 5, hydro: 7, wind: 5, solar: 18, other: 2 },
    nuclearStress: null, windGw: 2.6, windLoadFactor: 13, oilStocksDays: 46, oilVigilanceStatus: 'tense',
    fuelTensionLevel: 'CRITICAL', fuelTensionAnomalyShare: 87.6, fuelPriceHistory: null, ...over,
  };
}

const barometer = (details: Record<string, number | null>): NetworkBarometerResult =>
  ({ score: 96, status: 'nominal', details, computedAt: new Date(0), reliable: true });

describe('Infrastructures (spec 2026-10-01 § 3.2)', () => {
  it('résumé : score et lignes sous 85 ; une ligne par source, note, bouton cyber national', () => {
    const s = infraSection({ result: barometer({ bgp: 100, elec: 100, telecom: 93, cloud: 99, space: 100, cyber: 43, wind: 40, cyberNational: 51 }), nuclear: null, eolien: null }, 'fr');
    expect(s.id).toBe('infra');
    expect(s.title).toBe('Infrastructures');
    expect(s.summary).toContain('fmk-dot--vert');
    expect(s.summary).toContain('<span class="fmk-num">96</span>/100 · 2 à surveiller');
    expect(s.html.match(/class="fmk-meter"/g)).toHaveLength(8);
    expect(s.html).toContain('Score de continuité borné.');
    expect(s.html).toContain('data-action="open-cyber"');
    expect(s.html).toContain('National 51/100');
  });

  it('nucléaire avec note : « 84 / 100 · écart REMIT »', () => {
    const s = infraSection({
      result: barometer({}), eolien: null,
      nuclear: {
        unavailabilities: [], remitSignals: [], unconfirmedSignals: [{ id: 'x' } as never], rteAvailable: true, remitAvailable: true,
        remitStatus: 'ok', fetchedAt: new Date(0),
        stress: { installedCapacityMW: 100, availableCapacityMW: 84, stressRatio: 0.16, level: 'TENSION', gridTensionRisk: false, updatedAt: new Date(0), freshness: 'quasi-realtime' },
      },
    }, 'fr');
    expect(s.html).toContain('>84 / 100 · écart REMIT</span>');
  });

  it('baromètre pas encore reçu : « en attente », jamais « indisponible »', () => {
    const s = infraSection({ result: null, nuclear: null, eolien: null }, 'fr');
    expect(s.summary).toBe('en attente');
    expect(s.html).toContain('Chargement du baromètre des infrastructures…');
    expect(s.html + s.summary).not.toContain('indisponible');
    expect(infraSection(null, 'fr').summary).toBe('en attente');
  });
});

describe('Domaines', () => {
  it('résumé par niveau, grille de 8 domaines, étiquettes', () => {
    const s = domainsSection({
      signals: signals({ cyberAlerts: 24, cyberCritical: 20, railDisruptions: 215, railSevere: 159, militaryFlights: 36 }),
      meteo: [{ department: 'Var', departmentCode: '83', level: 'yellow', risks: ['thunderstorm'] }],
    }, 'fr');
    expect(s.summary).toContain('fmk-dot--orange');
    expect(s.summary).toContain('fmk-dot--jaune');
    expect(s.summary).toContain('fmk-dot--vert');
    expect(s.html.match(/class="fmk-domain"/g)).toHaveLength(8);
    expect(s.html).toContain('alertes 30j · 20 CVE');
    expect(s.html).toContain('<span class="fmk-tag fmk-tag--warn">Orages · Jaune</span>');
    expect(s.html).toContain('<span class="fmk-tag fmk-tag--warn">159 SNCF fortes</span>');
  });
});

describe('Énergie', () => {
  it('résumé Écowatt et production ; mix, légende française, production, éolien', () => {
    const s = energySection(energy(), 'fr');
    expect(s.summary).toBe('Écowatt vert · 49 305 MW');
    expect(s.html).toContain('class="fmk-mix"');
    expect(s.html).toContain('Nucléaire 62 % · Gaz 5 % · Hydraulique 7 % · Éolien 5 % · Solaire 18 % · Autre 2 %');
    expect(s.html).toContain('Production totale');
    expect(s.html).toContain('2,6 GW · charge 13 %');
  });

  it('sans profil : « données partielles », message sobre', () => {
    const s = energySection(null, 'fr');
    expect(s.summary).toBe('données partielles');
    expect(s.html).toContain('Aucun profil énergie disponible.');
  });

  it('données manquantes : « — »', () => {
    expect(energySection(energy({ totalMw: null, windGw: null, windLoadFactor: null, ecowattSignal: null }), 'fr').summary).toBe('données partielles');
    expect(energySection(energy({ windGw: null }), 'fr').html).toContain('—');
  });
});

describe('Carburants', () => {
  it('résumé : tension et stocks ; stocks colorés, tension, anomalies', () => {
    const s = fuelSection(energy(), 'fr');
    expect(s).not.toBeNull();
    expect(s?.summary).toContain('fm-vig--rouge');
    expect(s?.summary).toContain('stocks 46 j');
    expect(s?.html).toContain('46 j · Sous tension');
    expect(s?.html).toContain('87,6 % d’anomalies');
  });

  it('prix et courbe 30 jours quand l’historique existe', () => {
    const s = fuelSection(energy({
      fuelPriceHistory: {
        provider: 'carbu', generatedAt: '2026-10-01T00:00:00Z', sourceLabel: 'test', rangeStart: '2026-09-01T00:00:00Z', rangeEnd: '2026-10-01T00:00:00Z',
        series: [{
          fuelType: 'gazole', label: 'Gazole (B7)', color: '#f59e0b', latestPrice: 2.337, delta7dCents: -6.3, delta30dCents: -1,
          points: [{ timestamp: '2026-09-20T00:00:00Z', price: 2.4 }, { timestamp: '2026-10-01T00:00:00Z', price: 2.337 }],
        }],
      },
    }), 'fr');
    expect(s?.html).toContain('Gazole (B7)');
    expect(s?.html).toContain('2,337 €/L');
    expect(s?.html).toContain(`7 j ${formatFuelDeltaCents(-6.3)}`);
    expect(s?.html).toContain('<svg');
    expect(s?.html).toContain('Prix moyens · 30 jours');
  });

  it('aucune donnée carburant : pas de section', () => {
    expect(fuelSection(energy({ oilStocksDays: null, fuelTensionLevel: null, fuelPriceHistory: null }), 'fr')).toBeNull();
    expect(fuelSection(null, 'fr')).toBeNull();
  });
});

describe('Chronologie 7 jours', () => {
  it('résumé : pic du domaine et du jour ; cases avec valeur', () => {
    const s = timelineSection({
      days: ['30 sept.', '1 oct.'],
      lanes: [
        { key: 'weather', label: 'Météo', color: '#eab308', counts: [0, 10] },
        { key: 'transport', label: 'Transport', color: '#3b82f6', counts: [3, 215] },
      ],
    }, 'fr');
    expect(s.summary).toBe('pic transport le 1 oct.');
    expect(s.html).toContain('class="fmk-heat"');
    expect(s.html).toContain('>215<');
  });

  it('rien sur 7 jours : « calme » et message', () => {
    const s = timelineSection({ days: [], lanes: [] }, 'fr');
    expect(s.summary).toBe('calme');
    expect(s.html).toContain('Aucun signal sur 7 jours.');
  });
});
```

Note : `unconfirmedSignals: [{ id: 'x' } as never]` est le seul raccourci de type (seule la longueur est lue) ; si le type `UnconfirmedRemitSignal` est simple à construire, le construire complètement à la place.

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `npx vitest run src/components/fiche/france-indicators.test.ts`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Écrire `france-indicators.ts`**

```ts
// src/components/fiche/france-indicators.ts — sections d'indicateurs de la fiche France v2 (spec
// 2026-10-01 § 3.2) dans le kit fmk : Infrastructures, Domaines, Énergie, Carburants, Chronologie.
// Pures (aucun DOM) ; mêmes données et mêmes calculs que les blocs v1, partagés avec eux.

import type { FranceCountrySnapshot, FranceIntelEnergySummary } from '../../types/index.ts';
import { INFRA_NOTE, infraRows, infraValueLevel, type InfraInput } from '../../services/infra-continuity.ts';
import { fuelTensionLevel, infraStatusLevel, levelColorVar, levelLabel, officialLevel } from '../../services/vigilance.ts';
import {
  DOMAIN_LEVEL,
  domainChips,
  domainTiles,
  energySegments,
  oilStatusInfo,
  timelineIntensity,
  type EnergyKey,
} from '../france-intel-blocks.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { renderVigilancePill } from '../shared/vigilancePill.ts';
import {
  filterFuelPriceSeries,
  formatFuelDeltaCents,
  formatFuelPrice,
  renderFuelPriceChartSvg,
} from '../../utils/fuelPriceChart.ts';
import { kvRow, levelCounts, levelDot, meterRow } from './kit.ts';
import { formatNumber, t, type Lang } from './parts.ts';

export type IndicatorId = 'infra' | 'domains' | 'energy' | 'fuel' | 'timeline';

export interface IndicatorSection {
  id: IndicatorId;
  title: string;
  /** HTML échappé du résumé de la ligne de titre. */
  summary: string;
  html: string;
}

const ENERGY_LABEL: Record<EnergyKey, Record<Lang, string>> = {
  nuclear: { fr: 'Nucléaire', en: 'Nuclear' },
  gas: { fr: 'Gaz', en: 'Gas' },
  hydro: { fr: 'Hydraulique', en: 'Hydro' },
  wind: { fr: 'Éolien', en: 'Wind' },
  solar: { fr: 'Solaire', en: 'Solar' },
  other: { fr: 'Autre', en: 'Other' },
};

const percent = (value: number, lang: Lang): string => (lang === 'fr' ? `${value} %` : `${value}%`);

export function infraSection(infra: InfraInput | null, lang: Lang): IndicatorSection {
  const title = t(lang, 'Infrastructures', 'Infrastructure');
  const result = infra?.result ?? null;
  if (!infra || !result) {
    return {
      id: 'infra', title, summary: escapeHtml(t(lang, 'en attente', 'pending')),
      html: `<p class="fmk-muted">${t(lang, 'Chargement du baromètre des infrastructures…', 'Loading the infrastructure barometer…')}</p>`,
    };
  }
  const rows = infraRows(infra, lang);
  const watched = rows.filter((r) => r.value !== null && r.value < 85).length;
  const summary = `${levelDot(infraStatusLevel(result.status))}<span class="fmk-num">${result.score}</span>/100`
    + (watched > 0 ? escapeHtml(t(lang, ` · ${watched} à surveiller`, ` · ${watched} to watch`)) : '');
  const cyberNational = result.details.cyberNational ?? null;
  const meters = rows.map((r) => meterRow({
    label: r.label,
    value: r.value,
    level: infraValueLevel(r.value),
    display: r.value === null ? (r.note ?? '—') : r.note ? `${r.value} / 100 · ${r.note}` : `${r.value} / 100`,
    noteHtml: r.key === 'cyber' && cyberNational !== null
      ? `<button type="button" class="fmk-link" data-action="open-cyber">${t(lang, `National ${cyberNational}/100`, `National ${cyberNational}/100`)}</button>`
      : undefined,
  })).join('');
  return {
    id: 'infra', title, summary,
    html: `<div class="fmk-meters fmk-meters--infra">${meters}</div><p class="fmk-note">${escapeHtml(INFRA_NOTE[lang])}</p>`,
  };
}

export function domainsSection(snapshot: Pick<FranceCountrySnapshot, 'signals' | 'meteo'>, lang: Lang): IndicatorSection {
  const tiles = domainTiles(snapshot.signals, lang);
  const grid = tiles.map((tile) => `<div class="fmk-domain">`
    + `<span class="fmk-domain-name">${levelDot(DOMAIN_LEVEL[tile.level])}${escapeHtml(tile.label)}</span>`
    + `<b class="fmk-num">${formatNumber(tile.value, lang)}</b><small>${escapeHtml(tile.meta)}</small></div>`).join('');
  const chips = domainChips(snapshot, lang)
    .map((c) => `<span class="fmk-tag fmk-tag--${c.tone}">${escapeHtml(c.text)}</span>`).join('');
  return {
    id: 'domains',
    title: t(lang, 'Domaines', 'Domains'),
    summary: levelCounts(tiles.map((tile) => DOMAIN_LEVEL[tile.level]), lang),
    html: `<div class="fmk-domains">${grid}</div>${chips ? `<div class="fmk-tags">${chips}</div>` : ''}`,
  };
}

export function energySection(energy: FranceIntelEnergySummary | null, lang: Lang): IndicatorSection {
  const title = t(lang, 'Énergie', 'Energy');
  if (!energy) {
    return {
      id: 'energy', title, summary: escapeHtml(t(lang, 'données partielles', 'partial data')),
      html: `<p class="fmk-muted">${t(lang, 'Aucun profil énergie disponible.', 'No energy profile available.')}</p>`,
    };
  }
  const parts: string[] = [];
  if (energy.ecowattSignal) parts.push(`Écowatt ${levelLabel(officialLevel(energy.ecowattSignal), lang).toLowerCase()}`);
  if (energy.totalMw != null) parts.push(`${formatNumber(energy.totalMw, lang)} MW`);
  const summary = escapeHtml(parts.length === 2 ? parts.join(' · ') : t(lang, 'données partielles', 'partial data'));
  const segments = energySegments(energy);
  const bar = segments.map((s) => `<i style="flex:${s.value};background:${s.color}"></i>`).join('');
  const legend = segments.map((s) => `${ENERGY_LABEL[s.key][lang]} ${percent(s.value, lang)}`).join(' · ');
  const wind = energy.windGw != null
    ? `${formatNumber(Math.round(energy.windGw * 10) / 10, lang)} GW${energy.windLoadFactor != null ? ` · ${t(lang, 'charge', 'load')} ${percent(energy.windLoadFactor, lang)}` : ''}`
    : '—';
  return {
    id: 'energy', title, summary,
    html: `<div class="fmk-mix" role="img" aria-label="${escapeHtml(legend)}">${bar}</div>`
      + `<p class="fmk-legend">${escapeHtml(legend)}</p>`
      + kvRow(t(lang, 'Production totale', 'Total production'), energy.totalMw != null ? `${formatNumber(energy.totalMw, lang)} MW` : '—')
      + kvRow(t(lang, 'Éolien en direct', 'Live wind'), escapeHtml(wind)),
  };
}

export function fuelSection(energy: FranceIntelEnergySummary | null, lang: Lang): IndicatorSection | null {
  if (!energy) return null;
  const { oilStocksDays: oilDays, fuelTensionLevel: fuelLevel, fuelTensionAnomalyShare: anomaly, fuelPriceHistory: history } = energy;
  const hasHistory = !!history && history.series.length > 0;
  if (oilDays == null && fuelLevel == null && !hasHistory) return null;
  const oil = oilStatusInfo(energy.oilVigilanceStatus, lang);
  const summaryParts: string[] = [];
  if (fuelLevel != null) summaryParts.push(renderVigilancePill(fuelTensionLevel(fuelLevel), lang));
  if (oilDays != null) summaryParts.push(escapeHtml(t(lang, `stocks ${oilDays} j`, `stocks ${oilDays} d`)));
  const rows: string[] = [];
  if (oilDays != null) {
    const color = oil.level ? levelColorVar(oil.level) : 'var(--text-secondary)';
    rows.push(kvRow(t(lang, 'Stocks nationaux', 'National stocks'), `<span style="color:${color}">${escapeHtml(t(lang, `${oilDays} j · ${oil.label}`, `${oilDays} d · ${oil.label}`))}</span>`));
  }
  if (fuelLevel != null) {
    const share = anomaly != null ? ` ${escapeHtml(t(lang, `${formatNumber(Math.round(anomaly * 10) / 10, lang)} % d’anomalies`, `${anomaly.toFixed(1)}% anomalies`))}` : '';
    rows.push(kvRow(t(lang, 'Tension carburants', 'Fuel tension'), `${renderVigilancePill(fuelTensionLevel(fuelLevel), lang)}${share}`));
  }
  const series = hasHistory ? filterFuelPriceSeries(history, '1m') : [];
  const prices = series.map((s) => kvRow(s.label, `${escapeHtml(formatFuelPrice(s.latestPrice))} <span class="fmk-muted">· ${escapeHtml(t(lang, '7 j', '7 d'))} ${escapeHtml(formatFuelDeltaCents(s.delta7dCents))}</span>`)).join('');
  const chart = series.length > 0 ? renderFuelPriceChartSvg(series, { width: 320, height: 92, showAxes: false }) : '';
  return {
    id: 'fuel',
    title: t(lang, 'Carburants', 'Fuels'),
    summary: summaryParts.join(' '),
    html: rows.join('') + prices
      + (chart ? `<div class="fmk-sub fmk-eyebrow">${t(lang, 'Prix moyens · 30 jours', 'Average prices · 30 days')}</div><div class="fmk-chart">${chart}</div>` : ''),
  };
}

export function timelineSection(timeline: FranceCountrySnapshot['timeline'], lang: Lang): IndicatorSection {
  const title = t(lang, 'Chronologie 7 jours', '7-day timeline');
  let peak: { lane: string; day: string; count: number } | null = null;
  for (const lane of timeline.lanes) {
    lane.counts.forEach((count, i) => {
      if (count > 0 && (!peak || count > peak.count)) peak = { lane: lane.label, day: timeline.days[i] ?? '', count };
    });
  }
  const top = peak as { lane: string; day: string; count: number } | null;
  const summary = escapeHtml(top
    ? t(lang, `pic ${top.lane.toLowerCase()} le ${top.day}`, `peak ${top.lane.toLowerCase()} on ${top.day}`)
    : t(lang, 'calme', 'calm'));
  if (timeline.lanes.length === 0) {
    return { id: 'timeline', title, summary, html: `<p class="fmk-muted">${t(lang, 'Aucun signal sur 7 jours.', 'No signal over 7 days.')}</p>` };
  }
  const columns = `grid-template-columns:5.5rem repeat(${timeline.days.length}, minmax(0, 1fr))`;
  const head = `<span></span>${timeline.days.map((d) => `<span class="fmk-heat-day">${escapeHtml(d)}</span>`).join('')}`;
  const lanes = timeline.lanes.map((lane) => `<span class="fmk-heat-label">${escapeHtml(lane.label)}</span>`
    + lane.counts.map((count) => `<span class="fmk-heat-cell fmk-num" title="${escapeHtml(`${lane.label} : ${count}`)}" style="--c:${lane.color};--a:${timelineIntensity(count)}">${count > 0 ? count : ''}</span>`).join('')).join('');
  return { id: 'timeline', title, summary, html: `<div class="fmk-heat" style="${columns}">${head}${lanes}</div>` };
}
```

Note : le `let peak` muté dans un `forEach` est réduit par TypeScript à `null` ; la conversion `peak as … | null` est nécessaire. Variante sans conversion acceptée : remplacer le `forEach` par une boucle `for (let i = 0; …)`.

- [ ] **Step 4: Lancer, vérifier le succès**

Run: `npx vitest run src/components/fiche/france-indicators.test.ts`
Expected: PASS. Si `formatNumber(49305, 'fr')` produit une espace insécable fine (U+202F), adapter l'attendu du test à cette espace (`'Écowatt vert · 49 305 MW'`), pas la fonction.

- [ ] **Step 5: Vérifications et commit**

Run: `npm run typecheck && npx vitest run && npm run build`

```bash
git add src/components/fiche/france-indicators.ts src/components/fiche/france-indicators.test.ts
git commit -m "feat(v2): sections d'indicateurs de la fiche France dans le kit fmk

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016CCTVuVKLioWAncSRysDPG"
```

---

### Task 5: Fiche France réagencée

**Files:**
- Modify: `src/components/france-intel-score.ts` (export de `PILLAR_UI` l. 25, `pillarLevel` l. 78, `formatDelta` l. 84, `renderSparkline` l. 91)
- Modify: `src/components/fiche/france.ts`
- Test: `src/components/fiche/france.test.ts` (réécriture des tests du `describe` « onglet État de la France »)
- Modify: `src/components/poste/PosteSituation.ts` (seulement `franceFiche`, l. 400-418, pour compiler : `whyOpen` retiré, `infra: null`, `sectionOpen: new Map()` — le câblage réel vient en tâche 6)

**Interfaces:**
- Consumes: tâches 1, 2 et 4.
- Produces: `FranceFicheInput` sans `whyOpen`, avec `infra: InfraInput | null` et `sectionOpen: ReadonlyMap<string, boolean>` (clés = id de section : `note`, `changes`, `infra`, `domains`, `energy`, `fuel`, `timeline`, `sources`) ; `buildFranceFiche` produit `score`, des sections à `id` et plus de volet `why`.

- [ ] **Step 1: Exporter les aides du score**

Dans `src/components/france-intel-score.ts`, ajouter `export` devant `const PILLAR_UI`, `function pillarLevel`, `function formatDelta`, `function renderSparkline`. Aucun autre changement.

- [ ] **Step 2: Réécrire les tests de la fiche France (échouent)**

Dans `src/components/fiche/france.test.ts` :
- dans `input()`, remplacer `whyOpen: false,` par `infra: null, sectionOpen: new Map(),` ;
- remplacer `sectionTitles` par :

```ts
const sectionTitles = (html: string): string[] => [...html.matchAll(/<h3 class="fiche-part-title fmk-eyebrow">([^<]*)<\/h3>/g)].map((m) => m[1] ?? '');
const section = (id: string) => (over: Partial<FranceFicheInput> = {}) => buildFranceFiche(input(over)).sections.find((s) => s.id === id);
```

- remplacer les tests « Pourquoi replié en tête… », « les graphiques sont visibles… », « note : évaluation… », « avant les couches critiques… » et « note périmée… » par :

```ts
  it('en-tête Instrument, puis Situations, Note, Depuis votre visite, indicateurs, Preuves et sources', () => {
    const model = buildFranceFiche(input());
    expect(model.score).not.toBe('pending');
    expect(model.why).toBe('');
    expect(sectionTitles(renderFiche(model, 'fr'))).toEqual([
      'Situations actives', 'Note de situation', 'Depuis votre dernière visite',
      'Infrastructures', 'Domaines', 'Énergie', 'Chronologie 7 jours', 'Preuves et sources',
    ]);
  });

  it('ouvertures par défaut : situations et note ouvertes, le reste replié ; situations non repliable', () => {
    const byId = new Map(buildFranceFiche(input()).sections.map((s) => [s.id, s]));
    expect(byId.get('situations')?.collapsible).toBe(false);
    expect(byId.get('note')).toMatchObject({ collapsible: true, open: true });
    for (const id of ['changes', 'infra', 'domains', 'energy', 'timeline', 'sources']) expect(byId.get(id)).toMatchObject({ collapsible: true, open: false });
  });

  it('état retenu par section : remplace la valeur par défaut', () => {
    const byId = new Map(buildFranceFiche(input({ sectionOpen: new Map([['note', false], ['infra', true]]) })).sections.map((s) => [s.id, s]));
    expect(byId.get('note')?.open).toBe(false);
    expect(byId.get('infra')?.open).toBe(true);
  });

  it('score : valeur, niveau, piliers dans l’ordre, écart formaté, facteur, plafond', () => {
    const score = buildFranceFiche(input()).score;
    if (score === undefined || score === 'pending') throw new Error('score attendu');
    expect(score).toMatchObject({ value: 43, level: 'rouge', baseline: 95, delta24h: '−4 ▼', cap: 55 });
    expect(score.pillars.map((p) => p.label)).toEqual(['Continuité', 'Sécurité', 'Signal', 'Défense']);
    expect(score.pillars[0]).toMatchObject({ value: 61, level: 'orange', delta: '—', deduction: '−18,9' });
    expect(score.factor).toContain('Continuité — Carburants &amp; pétrole 100');
    expect(score.sparkline).toContain('frintel-spark');
  });

  it('avant les couches critiques : score en attente, ni indice ni piliers', () => {
    const model = buildFranceFiche(input({ ready: false, snapshot: snapshot({ score: 95, scoreBreakdown: breakdown(95), situations: [] }) }));
    expect(model.score).toBe('pending');
    const html = renderFiche(model, 'fr');
    expect(html).toContain('Calcul du niveau national…');
    for (const part of ['fmk-scale', 'fmk-meters--pillars', '95/100']) expect(html).not.toContain(part);
  });

  it('note : « En bref », jugements avec preuves cliquables, à surveiller ; résumé IA, heure, niveau de rédaction', () => {
    const note = section('note')();
    expect(note?.html).toContain('<b>En bref :</b> France en vigilance rouge, en dégradation sur 24 h.');
    expect(note?.html).toContain('data-select="event:42"');
    expect(note?.html).toContain('6 h');
    expect(note?.html).not.toContain('Rédigée à');
    expect(note?.html).not.toContain('Brief : IA');
    expect(note?.summary).toMatch(/^IA · rédigée \d{2}:\d{2} · au niveau orange$/);
  });

  it('note : en cache, synthèse automatique, même niveau, en préparation', () => {
    const cached = section('note')({ brief: { brief: BRIEF, freshness: 'cached' } });
    expect(cached?.summary).toMatch(/^IA, en cache · rédigée/);
    const auto = section('note')({ brief: { brief: { ...BRIEF, origin: 'deterministic' }, freshness: 'fresh' } });
    expect(auto?.summary).toMatch(/^Synthèse automatique · rédigée/);
    expect(section('note')({ briefMeta: { at: NOW - 30 * 60_000, level: 'rouge' } })?.summary).not.toContain('au niveau');
    const none = section('note')({ brief: null, briefMeta: null });
    expect(none?.summary).toBe('en préparation');
    expect(none?.html).toContain('Synthèse nationale en cours de préparation…');
    expect((none?.html ?? '') + (none?.summary ?? '')).not.toContain('indisponible');
  });

  it('note périmée (plus de 12 h) : contenu grisé avec sa date, résumé grisé', () => {
    const note = section('note')({ briefMeta: { at: NOW - 13 * H, level: 'orange' } });
    expect(note?.html).toContain('fiche-stale');
    expect(note?.html).toContain('données du');
    expect(note?.summary).toContain('<span class="fmk-stale">');
  });

  it('depuis la visite : résumé du nombre de changements, chargement, aucun', () => {
    expect(section('changes')({ events: null })?.summary).toBe('chargement…');
    const events = Array.from({ length: 2 }, (_, i) => event({ id: 100 + i, title: `Événement ${i}`, severity: 'high' }));
    const digest: ChangeDigestItem[] = events.map((e) => ({ event: e, kinds: ['created'], latestAt: '2026-09-24T07:40:00Z', severityFrom: null, independentFrom: null }));
    expect(section('changes')({ events: eventsState({ events, digest }) })?.summary).toBe('3 changements orange ou rouges');
    expect(section('changes')({ snapshot: snapshot({ situations: [] }), events: eventsState({ events: [], digest: [] }) })?.summary).toBe('aucun changement orange ou rouge');
  });

  it('situations : nombre en résumé ; aucune : message', () => {
    expect(section('situations')()?.summary).toBe('1');
    const none = section('situations')({ snapshot: snapshot({ situations: [] }) });
    expect(none?.summary).toBe('0');
    expect(none?.html).toContain('Aucune situation active.');
  });

  it('preuves et sources : section repliable, résumé compté, plus de partie séparée', () => {
    const model = buildFranceFiche(input());
    expect(model.sources).toEqual([]);
    const sources = model.sections.find((s) => s.id === 'sources');
    expect(sources?.summary).toBe('2 preuves · 1 source');
    expect(sources?.html).toContain('E42 · Explosion dans une usine chimique');
    expect(sources?.html).toContain('SDES');
    expect(buildFranceFiche(input({ brief: null })).sections.find((s) => s.id === 'sources')).toBeUndefined();
  });

  it('carburants seulement quand l’énergie en porte', () => {
    expect(buildFranceFiche(input()).sections.find((s) => s.id === 'fuel')).toBeUndefined();
  });
```

Note sur l'attendu « 3 changements » : 2 événements `high` du fil + la situation active nouvelle (`high` → orange) ; si le compte diffère, vérifier `franceChangeDigest(input).rows.length` dans le test plutôt que de deviner, et aligner l'attendu sur cette valeur.

- [ ] **Step 3: Lancer, vérifier l'échec**

Run: `npx vitest run src/components/fiche/france.test.ts`
Expected: FAIL (types et assertions).

- [ ] **Step 4: Réécrire `buildFranceFiche` et ses aides**

Dans `src/components/fiche/france.ts` :

1. Imports : retirer `renderWhyBody` et l'import de `france-intel-blocks.ts` ; ajouter

```ts
import { PILLAR_UI, dominantFactorText, formatDelta, pillarLevel, renderSparkline } from '../france-intel-score.ts';
import type { InfraInput } from '../../services/infra-continuity.ts';
import { domainsSection, energySection, fuelSection, infraSection, timelineSection, type IndicatorSection } from './france-indicators.ts';
import { renderSourceChips, type FicheScore, type FicheSection } from './parts.ts';
```

(`renderSourceChips`, `FicheScore`, `FicheSection` s'ajoutent à l'import existant de `./parts.ts`.)

2. Dans `FranceFicheInput` : supprimer `whyOpen: boolean;` et ajouter

```ts
  /** Baromètre des infrastructures (null tant qu'App ne l'a pas reçu). */
  infra: InfraInput | null;
  /** Ouverture retenue par id de section (« note », « infra »…) ; absente → valeur par défaut. */
  sectionOpen: ReadonlyMap<string, boolean>;
```

3. Remplacer `briefOrigin` par `noteSummary`, et `noteHtml` par la version sans lignes de méta :

```ts
/** Résumé de la note : origine, heure de rédaction, niveau de rédaction s'il diffère ; grisé si périmée. */
function noteSummary(input: FranceFicheInput): string {
  const { lang } = input;
  if (!input.brief) return escapeHtml(t(lang, 'en préparation', 'in preparation'));
  const origin = input.brief.brief.origin === 'llm'
    ? (input.brief.freshness === 'fresh' ? t(lang, 'IA', 'AI') : t(lang, 'IA, en cache', 'AI, cached'))
    : t(lang, 'Synthèse automatique', 'Automatic synthesis');
  const parts = [origin];
  const meta = input.briefMeta;
  if (meta) parts.push(t(lang, `rédigée ${formatClock(meta.at, lang)}`, `written ${formatClock(meta.at, lang)}`));
  if (meta && input.ready && meta.level !== scoreLevel(input.snapshot.score)) {
    parts.push(t(lang, `au niveau ${levelLabel(meta.level, lang).toLowerCase()}`, `at ${levelLabel(meta.level, lang).toLowerCase()} level`));
  }
  const text = escapeHtml(parts.join(' · '));
  return freshnessOf(meta?.at ?? null, 'brief', input.now) === 'fresh' ? text : `<span class="fmk-stale">${text}</span>`;
}

function noteHtml(input: FranceFicheInput): string {
  const { lang } = input;
  const brief = input.brief?.brief ?? null;
  if (!brief) return `<p>${t(lang, 'Synthèse nationale en cours de préparation…', 'National summary being prepared…')}</p>`;
  const watch = brief.watch.length > 0
    ? `<div class="fmk-sub fmk-eyebrow">${t(lang, 'À surveiller', 'Watch')}</div><ul class="fiche-list fmk-watch">${brief.watch
      .map((w) => `<li><span class="fiche-horizon">${escapeHtml(w.horizon.replace('h', ' h'))}</span> ${escapeHtml(w.text)}</li>`).join('')}</ul>`
    : '';
  const judgments = brief.judgments.length > 0 ? judgmentsHtml(brief, input) : '';
  const body = `<p class="fmk-bluf"><b>${t(lang, 'En bref :', 'Bottom line:')}</b> ${escapeHtml(brief.bluf)}</p>${judgments}${watch}`;
  const at = input.briefMeta?.at ?? null;
  if (freshnessOf(at, 'brief', input.now) === 'fresh') return body;
  return `<div class="fiche-stale"><p class="fiche-meta">${escapeHtml(dataDateLabel(at, lang))}</p>${body}</div>`;
}
```

4. Ajouter :

```ts
function changesSummary(input: FranceFicheInput): string {
  const { lang } = input;
  if (input.events === null) return escapeHtml(t(lang, 'chargement…', 'loading…'));
  const n = franceChangeDigest(input).rows.length;
  if (n === 0) return escapeHtml(t(lang, 'aucun changement orange ou rouge', 'no orange or red change'));
  return escapeHtml(lang === 'fr'
    ? `${n} changement${n > 1 ? 's' : ''} orange ou rouge${n > 1 ? 's' : ''}`
    : `${n} orange or red change${n > 1 ? 's' : ''}`);
}

function sourcesSummary(sources: readonly FicheSource[], lang: Lang): string {
  const evidence = sources.filter((s) => s.select !== null).length;
  const named = sources.length - evidence;
  const parts: string[] = [];
  if (evidence > 0) parts.push(lang === 'fr' ? `${evidence} preuve${evidence > 1 ? 's' : ''}` : `${evidence} evidence`);
  if (named > 0) parts.push(lang === 'fr' ? `${named} source${named > 1 ? 's' : ''}` : `${named} source${named > 1 ? 's' : ''}`);
  return escapeHtml(parts.join(' · '));
}

function formatDeduction(value: number, lang: Lang): string {
  return `−${value.toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
}

function franceScore(input: FranceFicheInput): FicheScore {
  const { snapshot, lang } = input;
  const bd = snapshot.scoreBreakdown;
  const level = scoreLevel(snapshot.score);
  const pillars = PILLAR_UI.flatMap((ui) => {
    const p = bd.pillars.find((x) => x.key === ui.key);
    if (!p) return [];
    const delta = input.score.pillarDeltas ? input.score.pillarDeltas[ui.key] : null;
    return [{ label: t(lang, ui.fr, ui.en), value: p.value, level: pillarLevel(p.value), delta: formatDelta(delta), deduction: formatDeduction(p.deduction, lang) }];
  });
  return {
    value: snapshot.score, level, baseline: bd.baseline, delta24h: formatDelta(input.score.delta24h),
    sparkline: renderSparkline(input.score.series, level, lang), pillars,
    factor: dominantFactorText(bd, lang), cap: bd.situationCap,
  };
}
```

5. Remplacer `buildFranceFiche` par :

```ts
export function buildFranceFiche(input: FranceFicheInput): FicheModel {
  const { snapshot, lang } = input;
  const brief = input.brief?.brief ?? null;
  const n = snapshot.situations.length;
  const count = lang === 'fr' ? `${n} situation${n > 1 ? 's' : ''} active${n > 1 ? 's' : ''}` : `${n} active situation${n === 1 ? '' : 's'}`;
  const open = (id: string, byDefault: boolean): boolean => input.sectionOpen.get(id) ?? byDefault;
  const situations = situationsHtml(input);
  const indicators = [
    infraSection(input.infra, lang),
    domainsSection(snapshot, lang),
    energySection(snapshot.energy, lang),
    fuelSection(snapshot.energy, lang),
    timelineSection(snapshot.timeline, lang),
  ].filter((s): s is IndicatorSection => s !== null);
  const sources = brief ? franceSources(brief, input) : [];
  const sections: FicheSection[] = [
    {
      id: 'situations', title: t(lang, 'Situations actives', 'Active situations'), summary: String(n), collapsible: false,
      html: situations ? `<ul class="fiche-list">${situations}</ul>` : `<p class="fmk-muted">${t(lang, 'Aucune situation active.', 'No active situation.')}</p>`,
    },
    { id: 'note', title: t(lang, 'Note de situation', 'Situation note'), summary: noteSummary(input), html: noteHtml(input), collapsible: true, open: open('note', true) },
    {
      id: 'changes', title: t(lang, 'Depuis votre dernière visite', 'Since your last visit'), summary: changesSummary(input),
      html: changesHtml(input), collapsible: true, open: open('changes', false),
    },
    ...indicators.map((s) => ({ ...s, collapsible: true, open: open(s.id, false) })),
    ...(sources.length > 0
      ? [{ id: 'sources', title: t(lang, 'Preuves et sources', 'Evidence and sources'), summary: sourcesSummary(sources, lang), html: renderSourceChips(sources), collapsible: true, open: open('sources', false) }]
      : []),
  ];
  return {
    key: 'france',
    kind: t(lang, 'État de la France', 'State of France'),
    name: 'France',
    level: scoreLevel(snapshot.score),
    driver: drivenByText(input.drivers, lang),
    freshness: [count, `MAJ ${formatClock(input.now, lang)}`, input.freshness].filter(Boolean).join(' · '),
    essentiel: [],
    changesMeta: '',
    changes: [],
    sections,
    figures: [],
    watch: [],
    sourcesTitle: t(lang, 'Preuves et sources', 'Evidence and sources'),
    sources: [],
    why: '',
    whyOpen: false,
    score: input.ready ? franceScore(input) : 'pending',
    actions: [
      { id: 'show-france', label: t(lang, 'Voir sur la carte', 'Show on map') },
      { id: 'report', label: t(lang, 'Note de situation', 'Situation report') },
    ],
  };
}
```

Mettre à jour le commentaire d'en-tête du fichier (fiche « Instrument », sections du kit fmk, spec 2026-10-01).

6. Dans `src/components/poste/PosteSituation.ts`, `franceFiche` : remplacer `whyOpen: this.whyOpen.has('france'),` par `infra: null, sectionOpen: new Map(),`.

- [ ] **Step 5: Lancer, vérifier le succès**

Run: `npx vitest run src/components/fiche/ src/components/poste/`
Expected: PASS. Corriger les tests de `PosteSituation.test.ts` ou `FichePanel.test.ts` qui lisaient le volet « Pourquoi » de la fiche France (s'il y en a) en les alignant sur l'en-tête score.

- [ ] **Step 6: Vérifications et commit**

Run: `npm run typecheck && npx vitest run && npm run build`

```bash
git add src/components/france-intel-score.ts src/components/fiche/france.ts src/components/fiche/france.test.ts src/components/poste/PosteSituation.ts
git commit -m "feat(v2): fiche France réagencée — en-tête Instrument, sections résumées et repliables

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016CCTVuVKLioWAncSRysDPG"
```

---

### Task 6: Mémoire des sections, baromètre et action cyber câblés

**Files:**
- Create: `src/services/fiche-sections-store.ts`
- Create: `src/services/fiche-sections-store.test.ts`
- Modify: `src/components/poste/FichePanel.ts` (constructeur l. 44-50, `focusTarget`)
- Test: `src/components/poste/FichePanel.test.ts` (ajouts)
- Modify: `src/components/poste/PosteSituation.ts` (`PosteData`, `PosteCallbacks.onFicheRendered`, `PosteOptions`, constructeur, `franceFiche`, `runAction`, appel de `onFicheRendered` l. 378)
- Test: `src/components/poste/PosteSituation.test.ts` (ajouts ; `onFicheRendered` retiré du harnais)
- Modify: `src/App.ts` (champ du baromètre, `refreshNetworkBarometerWidget` l. 7777-7784, `updatePoste` l. 8060-8076, création du poste l. 7984-7988)

**Interfaces:**
- Consumes: tâche 5 (`FranceFicheInput.infra`, `FranceFicheInput.sectionOpen`) ; tâche 2 (`InfraInput`).
- Produces: `SECTIONS_STORAGE_KEY = 'fm.v2.sections'` ; `type SectionStorage = Pick<Storage, 'getItem' | 'setItem'>` ; `loadSectionState(storage: SectionStorage | null): Map<string, boolean>` ; `saveSectionState(storage: SectionStorage | null, state: ReadonlyMap<string, boolean>): void` ; `sectionsOf(state: ReadonlyMap<string, boolean>, ficheKey: string): Map<string, boolean>` ; `FichePanel.setOnSectionToggle(handler: (sectionKey: string, open: boolean) => void): void` ; `PosteData.infra?: InfraInput | null` ; `PosteOptions.storage?: SectionStorage | null` ; action de fiche `open-cyber`.

- [ ] **Step 1: Tests du store (échouent)**

`src/services/fiche-sections-store.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { SECTIONS_STORAGE_KEY, loadSectionState, saveSectionState, sectionsOf, type SectionStorage } from './fiche-sections-store.ts';

function memory(initial: string | null = null): SectionStorage & { value: string | null } {
  return {
    value: initial,
    getItem(key: string) { return key === SECTIONS_STORAGE_KEY ? this.value : null; },
    setItem(key: string, value: string) { if (key === SECTIONS_STORAGE_KEY) this.value = value; },
  };
}

const throwing: SectionStorage = {
  getItem() { throw new Error('SecurityError'); },
  setItem() { throw new Error('QuotaExceededError'); },
};

describe('mémoire des sections (spec 2026-10-01 § 3.3)', () => {
  it('aller-retour', () => {
    const store = memory();
    saveSectionState(store, new Map([['france:infra', true], ['france:note', false]]));
    expect(loadSectionState(store)).toEqual(new Map([['france:infra', true], ['france:note', false]]));
  });

  it('vide, absent, JSON invalide, valeurs non booléennes, stockage refusé : jamais d’exception', () => {
    expect(loadSectionState(null)).toEqual(new Map());
    expect(loadSectionState(memory())).toEqual(new Map());
    expect(loadSectionState(memory('{pas du json'))).toEqual(new Map());
    expect(loadSectionState(memory('[1,2]'))).toEqual(new Map());
    expect(loadSectionState(memory('{"france:infra":"oui","france:note":true}'))).toEqual(new Map([['france:note', true]]));
    expect(loadSectionState(throwing)).toEqual(new Map());
    expect(() => saveSectionState(throwing, new Map([['france:infra', true]]))).not.toThrow();
    expect(() => saveSectionState(null, new Map())).not.toThrow();
  });

  it('sections d’une fiche, clés sans préfixe', () => {
    const state = new Map([['france:infra', true], ['theme:energy:x', false], ['france:note', false]]);
    expect(sectionsOf(state, 'france')).toEqual(new Map([['infra', true], ['note', false]]));
  });
});
```

Run: `npx vitest run src/services/fiche-sections-store.test.ts` → FAIL (module introuvable).

- [ ] **Step 2: Écrire le store**

`src/services/fiche-sections-store.ts` :

```ts
// src/services/fiche-sections-store.ts — mémoire de l'ouverture des sections repliables de la fiche
// (spec 2026-10-01 § 3.3) : clé « <fiche>:<section> » → ouverte. Commodité par navigateur ; toute
// lecture ou écriture du stockage est protégée (navigation privée, quota, données corrompues).

export const SECTIONS_STORAGE_KEY = 'fm.v2.sections';

export type SectionStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function loadSectionState(storage: SectionStorage | null): Map<string, boolean> {
  const state = new Map<string, boolean>();
  if (!storage) return state;
  try {
    const raw = storage.getItem(SECTIONS_STORAGE_KEY);
    if (!raw) return state;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return state;
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'boolean') state.set(key, value);
    }
  } catch {
    return new Map();
  }
  return state;
}

export function saveSectionState(storage: SectionStorage | null, state: ReadonlyMap<string, boolean>): void {
  if (!storage) return;
  try {
    storage.setItem(SECTIONS_STORAGE_KEY, JSON.stringify(Object.fromEntries(state)));
  } catch {
    // Stockage refusé ou plein : la mémoire reste en session.
  }
}

/** Ouvertures d'une fiche, clés sans le préfixe « <fiche>: ». */
export function sectionsOf(state: ReadonlyMap<string, boolean>, ficheKey: string): Map<string, boolean> {
  const prefix = `${ficheKey}:`;
  const out = new Map<string, boolean>();
  for (const [key, open] of state) {
    if (key.startsWith(prefix)) out.set(key.slice(prefix.length), open);
  }
  return out;
}
```

Run: `npx vitest run src/services/fiche-sections-store.test.ts` → PASS.

- [ ] **Step 3: Tests FichePanel (échouent)**

Ajouter au `describe('FichePanel')` de `src/components/poste/FichePanel.test.ts` :

```ts
  it('remonte l’ouverture et la fermeture d’une section du kit', async () => {
    const { root, panel } = mount();
    const onSection = vi.fn();
    panel.setOnSectionToggle(onSection);
    panel.render(model({ sections: [{ id: 'infra', title: 'Infrastructures', html: '<p>x</p>', collapsible: true }] }), 'fr', false);
    const details = root.querySelector<HTMLDetailsElement>('details[data-section="france:infra"]');
    if (!details) throw new Error('section absente');
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    expect(onSection).toHaveBeenLastCalledWith('france:infra', true);
    details.open = false;
    details.dispatchEvent(new Event('toggle'));
    expect(onSection).toHaveBeenLastCalledWith('france:infra', false);
  });

  it('le focus sur un titre de section survit à une reconstruction', () => {
    const { root, panel } = mount();
    const sections = [{ id: 'infra', title: 'Infrastructures', summary: '96/100', html: '<p>x</p>', collapsible: true }];
    panel.render(model({ sections }), 'fr', false);
    root.querySelector<HTMLElement>('details[data-section="france:infra"] > summary')?.focus();
    panel.render(model({ sections: [{ ...sections[0], summary: '95/100' }] }), 'fr', false);
    expect(document.activeElement?.closest('details')?.getAttribute('data-section')).toBe('france:infra');
  });
```

Run: `npx vitest run src/components/poste/FichePanel.test.ts` → FAIL (`setOnSectionToggle` absent).

Si happy-dom ne rend pas `<summary>` focalisable (le second test échoue sur `activeElement` alors que la restauration est écrite), vérifier d'abord avec `document.activeElement` juste après le premier `focus()` ; en dernier recours seulement, ajouter `tabindex="0"` au `<summary>` dans `renderSection` (tâche 1) — sans effet dans les navigateurs, où il est déjà focalisable.

- [ ] **Step 4: FichePanel**

Dans `src/components/poste/FichePanel.ts` :
- champ `private onSectionToggle: ((sectionKey: string, open: boolean) => void) | null = null;` et méthode

```ts
  setOnSectionToggle(handler: (sectionKey: string, open: boolean) => void): void {
    this.onSectionToggle = handler;
  }
```

- dans l'écouteur `toggle` (capture), après le test `details.fiche-why` :

```ts
      if (target instanceof HTMLElement && target.matches('details[data-section]')) {
        this.onSectionToggle?.(target.dataset.section ?? '', target.hasAttribute('open'));
      }
```

- dans `focusTarget`, après la ligne `.fiche-why > summary` :

```ts
    if (el.matches('details[data-section] > summary')) {
      const section = el.parentElement?.dataset.section;
      if (section !== undefined) {
        return () => [...this.body.querySelectorAll<HTMLElement>('details[data-section]')]
          .find((d) => d.dataset.section === section)?.querySelector<HTMLElement>(':scope > summary') ?? null;
      }
    }
```

Run: `npx vitest run src/components/poste/FichePanel.test.ts` → PASS.

- [ ] **Step 5: Tests PosteSituation (échouent)**

Dans `src/components/poste/PosteSituation.test.ts` : retirer `onFicheRendered: vi.fn(),` du harnais `setup` ; ajouter un paramètre facultatif `storage` à `setup` passé à `new PosteSituation(roots, cb, { viewportWidth: () => width, storage })` (défaut `null`) ; puis ajouter :

```ts
describe('sections de la fiche France (spec 2026-10-01 § 3.3)', () => {
  function memoryStorage(initial: Record<string, boolean> = {}): Pick<Storage, 'getItem' | 'setItem'> & { saved: () => Record<string, boolean> } {
    let value = JSON.stringify(initial);
    return {
      getItem: () => value,
      setItem: (_key: string, next: string) => { value = next; },
      saved: () => JSON.parse(value) as Record<string, boolean>,
    };
  }

  it('l’ouverture d’une section est retenue, enregistrée, et survit au rafraîchissement', () => {
    const storage = memoryStorage();
    const { roots, poste } = setup(1440, storage);
    const infra = roots.fiche.querySelector<HTMLDetailsElement>('details[data-section="france:infra"]');
    if (!infra) throw new Error('section Infrastructures absente');
    infra.open = true;
    infra.dispatchEvent(new Event('toggle'));
    expect(storage.saved()).toEqual({ 'france:infra': true });
    poste.update(data());
    expect(roots.fiche.querySelector('details[data-section="france:infra"]')?.hasAttribute('open')).toBe(true);
  });

  it('état enregistré relu au démarrage', () => {
    const { roots } = setup(1440, memoryStorage({ 'france:note': false }));
    expect(roots.fiche.querySelector('details[data-section="france:note"]')?.hasAttribute('open')).toBe(false);
  });

  it('« National n/100 » ouvre le panneau cyber', () => {
    const { roots, poste } = setup();
    const listener = vi.fn();
    document.addEventListener('open-cyber-panel', listener);
    poste.update(data({
      infra: { result: { score: 96, status: 'nominal', details: { cyber: 43, cyberNational: 51 }, computedAt: new Date(0), reliable: true }, nuclear: null, eolien: null },
    }));
    roots.fiche.querySelector<HTMLElement>('[data-action="open-cyber"]')?.click();
    expect(listener).toHaveBeenCalledTimes(1);
    document.removeEventListener('open-cyber-panel', listener);
  });
});
```

Adapter l'appel `setup(width = 1440)` en `setup(width = 1440, storage: Pick<Storage, 'getItem' | 'setItem'> | null = null)` ; vérifier que `data()` accepte un `Partial<PosteData>` (sinon l'ajouter, comme les autres fabriques du fichier).

Run: `npx vitest run src/components/poste/PosteSituation.test.ts` → FAIL.

- [ ] **Step 6: PosteSituation**

Dans `src/components/poste/PosteSituation.ts` :
- imports : `import type { InfraInput } from '../../services/infra-continuity.ts';` et `import { loadSectionState, saveSectionState, sectionsOf, type SectionStorage } from '../../services/fiche-sections-store.ts';`
- `PosteData` : ajouter `/** Baromètre des infrastructures (section Infrastructures de l'État). */ infra?: InfraInput | null;`
- `PosteCallbacks` : supprimer `onFicheRendered` ; supprimer son appel (l. 378, `this.callbacks.onFicheRendered(this.fichePanel.getBody());`).
- `PosteOptions` : ajouter `/** Stockage de la mémoire des sections ; défaut : localStorage s'il est accessible. */ storage?: SectionStorage | null;`
- champs : `private readonly storage: SectionStorage | null;` et `private readonly sectionOpen: Map<string, boolean>;`
- constructeur, avant les `set…` du `fichePanel` :

```ts
    this.storage = options.storage !== undefined ? options.storage : defaultStorage();
    this.sectionOpen = loadSectionState(this.storage);
```

et après `setOnWhyToggle(...)` :

```ts
    this.fichePanel.setOnSectionToggle((sectionKey, open) => {
      if (this.sectionOpen.get(sectionKey) === open) return;
      this.sectionOpen.set(sectionKey, open);
      saveSectionState(this.storage, this.sectionOpen);
    });
```

- fonction de module :

```ts
/** localStorage s'il est accessible (navigation privée, iframe sans stockage : null). */
function defaultStorage(): SectionStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
```

- `franceFiche` : remplacer `infra: null, sectionOpen: new Map(),` (tâche 5) par `infra: data.infra ?? null, sectionOpen: sectionsOf(this.sectionOpen, 'france'),`.
- `runAction`, en tête après `if (!data) return;` :

```ts
    if (action === 'open-cyber') {
      document.dispatchEvent(new CustomEvent('open-cyber-panel'));
      return;
    }
```

Run: `npx vitest run src/components/poste/` → PASS.

- [ ] **Step 7: App**

Dans `src/App.ts` :
- import de type : `import type { NetworkBarometerResult } from './services/network-barometer.ts';` (s'il n'est pas déjà importé).
- champ, près de `currentEolienLive` (l. 1581) : `private currentNetworkBarometer: NetworkBarometerResult | null = null;`
- `refreshNetworkBarometerWidget` : juste après `const result = await fetchNetworkBarometer();`, ajouter `this.currentNetworkBarometer = result;` ; et remplacer `if (this.uiV2) return;` par

```ts
    if (this.uiV2) {
      // Section Infrastructures de l'onglet État (spec 2026-10-01) : repeinte avec le nouveau résultat.
      this.repaintPoste();
      return;
    }
```

- `updatePoste` : ajouter, après `sources: …,` :

```ts
      infra: { result: this.currentNetworkBarometer, nuclear: this.currentNuclearState, eolien: this.currentEolienLive },
```

- création du poste (l. 7984-7988) : supprimer le bloc `onFicheRendered: (body) => { … },` (l'emplacement `.fiche-infra-slot` n'existe plus ; le widget reste créé pour la v1).

- [ ] **Step 8: Vérifications et commit**

Run: `npm run typecheck && npx vitest run && npm run build`
Expected: aucune erreur.

```bash
git add src/services/fiche-sections-store.ts src/services/fiche-sections-store.test.ts src/components/poste/FichePanel.ts src/components/poste/FichePanel.test.ts src/components/poste/PosteSituation.ts src/components/poste/PosteSituation.test.ts src/App.ts
git commit -m "feat(v2): sections de l'État mémorisées, baromètre et panneau cyber câblés

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016CCTVuVKLioWAncSRysDPG"
```

---

### Task 7: Kit de style `fmk-`, référence écrite et contrôle visuel

**Files:**
- Modify: `src/styles/main.css` (nouveau bloc après les règles `.fiche-*`, vers la l. 8555)
- Create: `docs/design/panneau-v2.md`
- Create (jetable, non commité) : `.superpowers/sdd/panneau-etat/shots.mjs`

**Interfaces:**
- Consumes: toutes les classes produites par les tâches 1, 4, 5 et 6.
- Produces: le rendu visuel validé à l'écran ; la référence écrite.

- [ ] **Step 1: Écrire le bloc CSS du kit**

Ajouter dans `src/styles/main.css`, après la règle `.fiche-why > summary:focus-visible { … }` :

```css
/* ── Kit de panneau v2 « fmk » (spec 2026-10-01) — référence pour restyler les autres panneaux ──
   Fond et filets du panneau ; chiffres tabulaires, jamais de police à chasse fixe ; couleurs de
   niveau pour un niveau seulement, vert de marque pour l'interactif ; aucun cadre dans un cadre. */
#app.ui-v2 .fiche.fmk { --fmk-rule: var(--border-color); --fmk-track: var(--bg-surface-hover); --fmk-muted: var(--text-secondary); --fmk-faint: var(--text-muted); font-size: 13px; line-height: 1.45; color: var(--text-primary); }
#app.ui-v2 .fmk .fmk-num { font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; }
#app.ui-v2 .fmk .fmk-eyebrow { margin: 0; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--fmk-faint); }
#app.ui-v2 .fmk .fmk-muted { color: var(--fmk-muted); }
#app.ui-v2 .fmk .fmk-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

/* En-tête « Instrument » */
#app.ui-v2 .fmk .fmk-head { padding-bottom: 14px; }
#app.ui-v2 .fmk .fmk-score { display: flex; align-items: flex-end; gap: 8px; margin-top: 6px; }
#app.ui-v2 .fmk .fmk-score-value { font-size: 46px; font-weight: 650; line-height: 0.9; }
#app.ui-v2 .fmk .fmk-score-max { padding-bottom: 4px; color: var(--fmk-muted); }
#app.ui-v2 .fmk .fmk-score-level { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; margin-left: auto; padding-bottom: 2px; text-align: right; }
#app.ui-v2 .fmk .fmk-driver { font-size: 12.5px; color: var(--fmk-muted); }
#app.ui-v2 .fmk .fmk-scale { position: relative; margin-top: 14px; }
#app.ui-v2 .fmk .fmk-scale-zones { display: flex; height: 6px; overflow: hidden; border-radius: 3px; }
#app.ui-v2 .fmk .fmk-scale-zones > i { opacity: 0.85; }
#app.ui-v2 .fmk .fmk-scale-marker { position: absolute; top: -4px; width: 2px; height: 14px; border-radius: 1px; background: var(--text-primary); transform: translateX(-1px); }
#app.ui-v2 .fmk .fmk-scale-ticks { position: relative; height: 16px; margin-top: 4px; font-size: 11px; color: var(--fmk-faint); }
#app.ui-v2 .fmk .fmk-scale-ticks > span { position: absolute; transform: translateX(-50%); }
#app.ui-v2 .fmk .fmk-scale-ticks > span:first-child { transform: none; }
#app.ui-v2 .fmk .fmk-scale-ticks > span:last-child { transform: translateX(-100%); }
#app.ui-v2 .fmk .fmk-fresh { display: flex; align-items: center; gap: 10px; margin-top: 6px; font-size: 12px; color: var(--fmk-muted); }
#app.ui-v2 .fmk .fmk-fresh .frintel-spark { flex: 0 0 80px; width: 80px; height: 18px; margin-left: auto; }
#app.ui-v2 .fmk .fmk-fresh .frintel-spark-caption { font-size: 11px; color: var(--fmk-faint); }
#app.ui-v2 .fmk .fmk-pending { margin: 8px 0 0; color: var(--fmk-muted); }
#app.ui-v2 .fmk .fmk-sub { margin: 14px 0 6px; padding-top: 14px; border-top: 1px solid var(--fmk-rule); }
#app.ui-v2 .fmk .fmk-factor { margin: 8px 0 0; font-size: 12.5px; }
#app.ui-v2 .fmk .fmk-callout { margin: 10px 0 0; padding: 7px 10px; border-left: 3px solid var(--sev-orange); border-radius: 0 6px 6px 0; background: rgba(255, 149, 0, 0.08); font-size: 12.5px; }

/* Lignes de mesure : une seule forme (libellé · barre · valeur · colonnes en plus) */
#app.ui-v2 .fmk .fmk-meters { display: flex; flex-direction: column; gap: 2px; }
#app.ui-v2 .fmk .fmk-meter { display: grid; align-items: center; gap: 4px 10px; padding: 3px 0; }
#app.ui-v2 .fmk .fmk-meters--pillars .fmk-meter { grid-template-columns: 5.5rem minmax(0, 1fr) 2rem 3.4rem 3rem; }
#app.ui-v2 .fmk .fmk-meters--infra .fmk-meter { grid-template-columns: 9.5rem minmax(0, 1fr) 7.5rem; }
#app.ui-v2 .fmk .fmk-bar { position: relative; height: 6px; overflow: hidden; border-radius: 3px; background: var(--fmk-track); }
#app.ui-v2 .fmk .fmk-bar > i { position: absolute; inset: 0 auto 0 0; border-radius: 3px; }
#app.ui-v2 .fmk .fmk-meter-v, #app.ui-v2 .fmk .fmk-meter-x { text-align: right; white-space: nowrap; }
#app.ui-v2 .fmk .fmk-meter-x:last-child { color: #ff9f6b; }
#app.ui-v2 .fmk .fmk-meter-note { grid-column: 1 / -1; font-size: 11.5px; color: var(--fmk-faint); }
#app.ui-v2 .fmk .fmk-note { margin: 8px 0 0; font-size: 11.5px; color: var(--fmk-faint); }

/* Sections : titre, résumé à droite, chevron ; séparées par des filets */
#app.ui-v2 .fmk .fmk-sec { margin-top: 0; padding: 12px 0; border-top: 1px solid var(--fmk-rule); }
#app.ui-v2 .fmk .fmk-sec-h { display: flex; align-items: center; gap: 8px; min-height: 22px; list-style: none; }
#app.ui-v2 .fmk summary.fmk-sec-h { cursor: pointer; border-radius: 4px; }
#app.ui-v2 .fmk summary.fmk-sec-h::-webkit-details-marker { display: none; }
#app.ui-v2 .fmk .fmk-sum { display: inline-flex; align-items: center; gap: 4px; margin-left: auto; font-size: 12px; color: var(--fmk-muted); text-align: right; }
#app.ui-v2 .fmk .fmk-chev { flex: 0 0 16px; width: 16px; height: 16px; color: var(--fmk-faint); transition: transform 0.15s ease, color 0.15s ease; }
#app.ui-v2 .fmk details[open] > summary .fmk-chev { transform: rotate(90deg); }
#app.ui-v2 .fmk summary.fmk-sec-h:hover .fmk-chev,
#app.ui-v2 .fmk summary.fmk-sec-h:hover .fmk-eyebrow { color: var(--v2-brand); }
#app.ui-v2 .fmk summary.fmk-sec-h:focus-visible { outline: 2px solid var(--v2-brand); outline-offset: 2px; }
#app.ui-v2 .fmk .fmk-sec-body { margin-top: 8px; }
#app.ui-v2 .fmk .fmk-stale { opacity: 0.6; }
@media (prefers-reduced-motion: reduce) { #app.ui-v2 .fmk .fmk-chev { transition: none; } }

/* Contenus */
#app.ui-v2 .fmk .fmk-dot { display: inline-block; flex: 0 0 8px; width: 8px; height: 8px; margin-right: 6px; border-radius: 50%; background: var(--fmk-faint); vertical-align: 1px; }
#app.ui-v2 .fmk .fmk-dot--vert { background: var(--sev-green); }
#app.ui-v2 .fmk .fmk-dot--jaune { background: var(--sev-yellow); }
#app.ui-v2 .fmk .fmk-dot--orange { background: var(--sev-orange); }
#app.ui-v2 .fmk .fmk-dot--rouge { background: var(--sev-red); }
#app.ui-v2 .fmk .fmk-count { display: inline-flex; align-items: center; }
#app.ui-v2 .fmk .fm-vig { min-width: 3.6rem; text-align: center; }
#app.ui-v2 .fmk .fiche-situation { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: baseline; gap: 8px; }
#app.ui-v2 .fmk .fiche-situation .fiche-link { display: flex; align-items: baseline; gap: 8px; color: var(--text-primary); }
#app.ui-v2 .fmk .fiche-situation .fiche-link:hover { color: var(--v2-brand); }
#app.ui-v2 .fmk .fmk-bluf { font-size: 14px; line-height: 1.5; }
#app.ui-v2 .fmk .fiche-judgment { margin: 8px 0; padding: 4px 0 4px 10px; border-left: 2px solid var(--fmk-rule); }
#app.ui-v2 .fmk .fiche-ref { display: inline-block; padding: 0 5px; border: 1px solid var(--border-color-light); border-radius: 4px; font-size: 11px; color: var(--v2-brand); }
#app.ui-v2 .fmk .fmk-watch li { display: grid; grid-template-columns: 2.6rem minmax(0, 1fr); gap: 6px; }
#app.ui-v2 .fmk .fmk-kv { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; padding: 3px 0; }
#app.ui-v2 .fmk .fmk-kv-k { color: var(--fmk-muted); }
#app.ui-v2 .fmk .fmk-domains { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 18px; }
#app.ui-v2 .fmk .fmk-domain { display: grid; grid-template-columns: minmax(0, 1fr) auto; padding: 5px 0; border-bottom: 1px solid var(--fmk-rule); }
#app.ui-v2 .fmk .fmk-domain small { grid-column: 1 / -1; font-size: 11.5px; color: var(--fmk-faint); }
#app.ui-v2 .fmk .fmk-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
#app.ui-v2 .fmk .fmk-tag { padding: 1px 7px; border-radius: 5px; font-size: 11.5px; background: var(--bg-surface); color: var(--text-secondary); }
#app.ui-v2 .fmk .fmk-tag--crit { color: var(--sev-red); }
#app.ui-v2 .fmk .fmk-mix { display: flex; height: 8px; overflow: hidden; border-radius: 4px; }
#app.ui-v2 .fmk .fmk-legend { margin: 4px 0 6px; font-size: 11.5px; color: var(--fmk-faint); }
#app.ui-v2 .fmk .fmk-chart svg { display: block; width: 100%; height: auto; }
#app.ui-v2 .fmk .fmk-heat { display: grid; gap: 2px; font-size: 11px; }
#app.ui-v2 .fmk .fmk-heat-day { text-align: center; color: var(--fmk-faint); }
#app.ui-v2 .fmk .fmk-heat-label { color: var(--fmk-muted); }
#app.ui-v2 .fmk .fmk-heat-cell { min-height: 14px; border-radius: 2px; background: color-mix(in srgb, var(--c) calc(var(--a) * 100%), var(--bg-surface)); color: #04220f; text-align: center; line-height: 14px; }
#app.ui-v2 .fmk .fiche-chips { gap: 4px; }
#app.ui-v2 .fmk .fiche-source { border: 0; background: var(--bg-surface); color: var(--text-secondary); }
#app.ui-v2 .fmk .fiche-source.fiche-link { color: var(--v2-brand); }
#app.ui-v2 .fmk .fmk-link { padding: 0; border: 0; background: none; color: var(--v2-brand); font: inherit; cursor: pointer; }
#app.ui-v2 .fmk .fiche-actions { margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--fmk-rule); }
#app.ui-v2 .fmk .fiche-action { border: 1px solid rgba(var(--v2-brand-rgb), 0.45); background: transparent; color: var(--v2-brand); font-weight: 600; }
#app.ui-v2 .fmk .fiche-action:hover { background: rgba(var(--v2-brand-rgb), 0.12); }
#app.ui-v2 .fmk .fiche-link:focus-visible,
#app.ui-v2 .fmk .fiche-action:focus-visible,
#app.ui-v2 .fmk .fmk-link:focus-visible { outline: 2px solid var(--v2-brand); outline-offset: 2px; }
```

Vérifier dans `main.css` que `--v2-brand` et `--v2-brand-rgb` sont définis sur `#app.ui-v2` (bloc des puces, vers la l. 8683) et `--border-color-light` sur `:root` ; sinon utiliser les valeurs `#4bfc94` / `75, 252, 148` / `#3a3a4e`.

- [ ] **Step 2: Contrôle visuel**

Lancer `npm run dev` en arrière-plan, puis écrire `.superpowers/sdd/panneau-etat/shots.mjs` (Playwright : `PLAYWRIGHT_MODULE=/Users/fraid/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs`, Chrome `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, sans interface) qui, pour chaque largeur 1600 × 1000, 1280 × 900 et 390 × 844 (onglet « Fiche » au téléphone), ouvre `http://localhost:3001/?ui=v2`, attend 25 s, capture `.fm-v2-fiche` puis :
1. vérifie qu'à 1600 × 1000 l'en-tête (score, échelle, piliers) et la section Situations tiennent sans défiler (`getBoundingClientRect().bottom` de `[data-section="france:situations"]` ≤ hauteur de `.fiche-body`) ;
2. clique le titre « Infrastructures », attend 5 s (un rafraîchissement), vérifie que `details[data-section="france:infra"]` est toujours `open`, recharge la page, vérifie qu'il l'est encore ;
3. ouvre `?view=app` et capture : la v1 n'a pas changé (comparer à l'œil avec une capture de `main`).

Lire chaque capture (outil Read sur l'image) et corriger le CSS jusqu'à : aucun débordement horizontal, chevrons alignés, aucun cadre dans un cadre, chiffres alignés à droite dans les tableaux.

- [ ] **Step 3: Écrire la référence**

`docs/design/panneau-v2.md` (dépôt PUBLIC : aucun chemin personnel, aucune citation) :

```markdown
# Panneau v2 — kit de style « fmk »

Référence de style des panneaux de la v2, établie sur l'onglet « État de la France » (spec
`docs/superpowers/specs/2026-10-01-panneau-etat-reference-design.md`). Tout panneau restylé
reprend ces jetons, ces composants et ces règles.

## Jetons
| Rôle | Valeur |
|---|---|
| Fond de panneau | `--bg-secondary` (#12121a) |
| Filet | `--border-color` (#2a2a3e) |
| Piste de barre | `--bg-surface-hover` (#22223a) |
| Texte principal / secondaire / discret | `--text-primary` / `--text-secondary` / `--text-muted` |
| Niveaux | `--sev-green`, `--sev-yellow`, `--sev-orange`, `--sev-red` (via `levelColorVar`) |
| Interactif | `--v2-brand` (#4bfc94) |

## Typographie
- Texte : police système. Chiffres : `font-variant-numeric: tabular-nums` (classe `fmk-num`) ; pas de police à chasse fixe.
- Sur-titres et titres de section : `fmk-eyebrow` (11 px, capitales, interlettrage 0,06 em).
- Chiffre héros : 46 px, graisse 650, couleur du niveau.

## Composants (`src/components/fiche/kit.ts`, `src/components/fiche/parts.ts`)
| Composant | Rendu | Usage |
|---|---|---|
| En-tête Instrument | `FicheModel.score` | score, échelle 0–55–70–85–100, fraîcheur, piliers, facteur, plafond |
| Section | `FicheSection` avec `id`, `summary`, `collapsible`, `open` | titre + résumé à droite + chevron ; mémoire par `data-section` |
| Ligne de mesure | `meterRow()` | libellé · barre · valeur · colonnes en plus ; une seule forme |
| Point de niveau | `levelDot()` | domaine, résumé |
| Comptes par niveau | `levelCounts()` | résumé d'une section à plusieurs niveaux |
| Clé · valeur | `kvRow()` | chiffre isolé (production, stocks, prix) |
| Encart | `fmk-callout` | une condition qui change la lecture (plafond) |
| Pastille de niveau | `renderVigilancePill()` | niveau d'une ligne ; largeur fixe |

## Règles
1. Aucun cadre dans un cadre : séparer par des filets.
2. Les couleurs de niveau disent un niveau, rien d'autre ; le vert de marque désigne ce qui est cliquable.
3. Chaque section repliée dit l'essentiel sur sa ligne de titre (« 96/100 · 2 à surveiller »).
4. L'essentiel tient dans la première hauteur d'écran ; le détail se déplie.
5. Jamais « indisponible » pour une donnée qui charge : « en attente », « chargement… », « en préparation ».
6. Même rendu en colonne de 420 px et en pleine largeur.

## Restyler un autre panneau
1. Construire son modèle en `FicheModel` (ou ses blocs avec `kit.ts`).
2. Donner un `id` et un résumé à chaque section ; choisir ce qui est ouvert par défaut.
3. Remplacer cadres et polices à chasse fixe par filets, `fmk-num` et `meterRow`.
4. Vérifier à 1600, 1280 et 390 px.
```

- [ ] **Step 4: Vérifications et commit**

Run: `npm run typecheck && npx vitest run && npm run build`

```bash
git add src/styles/main.css docs/design/panneau-v2.md
git commit -m "feat(v2): kit de style fmk et référence écrite du panneau État

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016CCTVuVKLioWAncSRysDPG"
```

Montrer ensuite le résultat à l'utilisateur en local (`http://localhost:3001/?ui=v2`) pour validation à l'écran ; ne pas pousser.
