# Refonte UI, étape 1 : langage commun — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Appliquer l'échelle de vigilance L1 (vert, jaune, orange, rouge), des libellés en français clair et des marchés neutres aux surfaces toujours visibles (tiroir Intelligence, alertes, convergences, brief, marchés, flux d'actualités), et corriger les deux bugs de production (brief 81 contre indice 43 ; entités HTML brutes).

**Architecture:** Un module pur `src/services/vigilance.ts` devient la source unique des niveaux, libellés, couleurs et seuils ; une pastille partagée `renderVigilancePill` l'affiche. Les rendus du tiroir qui changent sont extraits en fonctions pures testables (`src/components/france-intel-score.ts`), les composants existants les appellent. La disposition ne change pas : aucune fonction n'est retirée.

**Tech Stack:** TypeScript strict (vanilla DOM), Vite 7, vitest 4 (Node, happy-dom pour les composants), handlers Vercel en JavaScript + JSDoc.

**Spec:** `docs/superpowers/specs/2026-09-24-refonte-ui-poste-de-situation-design.md` (dépôt principal ; §4 langage commun, §11 étape 1, §14 aucune fonctionnalité retirée).

**Branche :** `feat/ui-langage-commun`, créée depuis `main` après la fusion de `feat/audit-2026-09-hobby-perf` puis de `feat/socle-intelligence-france`. Si ces fusions ne sont pas faites, la créer depuis `feat/socle-intelligence-france` (même code). Le plan est écrit contre ce code.

```bash
cd /Users/fraid/Desktop/FranceMonitor
git switch main && git pull --ff-only   # après les fusions
git worktree add -b feat/ui-langage-commun .worktrees/ui-langage-commun main
cd .worktrees/ui-langage-commun && npm ci
```

## Global Constraints

- TypeScript `strict: true`, aucun `any`, aucun `!` non justifié ; vanilla DOM, pas de JSX.
- Commentaires et libellés en français ; les libellés anglais n'existent que pour la bascule EN.
- Échelle L1 : `vert`, `jaune`, `orange`, `rouge`. Couleurs = jetons existants `--sev-green` (#34c759), `--sev-yellow` (#ffcc00), `--sev-orange` (#ff9500), `--sev-red` (#ff3b30). Texte **noir** sur les quatre pastilles (contraste AA).
- Phrases officielles : vert « pas de vigilance particulière », jaune « soyez attentif », orange « soyez très vigilant », rouge « vigilance absolue ».
- Seuils du score v3 inchangés (85/70/55) ; fixtures de `src/services/france-country-intel.test.ts` intouchées.
- Conversions : situation `critical`→rouge, `high`→orange, `medium`/`watch`→jaune ; événement `critical`→rouge, `high`→orange, `medium`→jaune, `low`/`info`→vert ; signal officiel `violet`→rouge.
- Confiance en mots : ≥ 0,75 « élevée », ≥ 0,55 « moyenne », sinon « faible ».
- Marchés : couleur neutre ; jaune seulement au-delà de ±3 % sur la journée pour un indice, ±5 % pour le pétrole ou le gaz.
- Le nombre (indice, piliers, plafond) n'apparaît que dans le volet « Pourquoi ce niveau ? ».
- Couleurs officielles des couches de carte (Écowatt, Météo-France, Vigicrues) : inchangées.
- Aucune fonctionnalité retirée (spec §14) : cette étape change des libellés et des couleurs, elle ne supprime aucun élément.
- Tout texte tiers passe par un échappement HTML ; seuls les liens http(s) sont cliquables.
- `api/_lib/*.js` et `api/_handlers/**/*.js` restent en JavaScript avec JSDoc.
- Clôture de chaque tâche : `npm run typecheck` et `npx vitest run` ; en plus `npm run lint` et `npm run build` quand `src/` change.
- Commits sur la branche uniquement ; pousser `main` déploie la production (décision de l'utilisateur).

## Review Focus

- **Score qui oscille autour d'un seuil (54 ↔ 56)** : le brief ne doit pas être redemandé à chaque passage, au plus une fois par tranche de 10 min. Test dans la tâche 2.
- **Valeurs manquantes** (score `NaN`, variation de marché `NaN` ou absente) : jamais « vert » pour un score inconnu, marché neutre. Tests dans les tâches 1 et 5.
- **Entités HTML hostiles ou doublement encodées** (`&amp;#039;`, `&#0;`, `&#99999999;`) : décodées sans exception ni caractère NUL. Test dans la tâche 6.
- **Tiroir reconstruit une vingtaine de fois au démarrage** : le volet « Pourquoi ce niveau ? » ouvert et le focus clavier sur son titre survivent. Test unitaire dans la tâche 3, vérification navigateur dans la tâche 7.
- **Bascule EN** : tous les nouveaux libellés passent en anglais (Red, Yellow…, « Why this level? »). Tests dans les tâches 1 et 3.

## Hors périmètre de ce plan

Tranché à l'écriture du plan, à confirmer par l'utilisateur :
- Les panneaux par source (Écowatt, pétrole, gaz, nucléaire, hydraulique, éolien, énergie DROM, maritime, feux, cyber, santé…) : l'étape 3 les transforme en fiches de thème ; les réétiqueter maintenant serait du travail jeté.
- Les infobulles et cartes de la carte (`DeckGLMap`, `MapPopup`) : étape 3 (carte).
- Les pastilles de gravité et catégories du flux d'actualités (page Modules, future « Tableaux ») : inchangées, sauf la confiance en mots et « Règles » → « Mots-clés ».
- Le nombre au centre de l'anneau du baromètre des infrastructures : seules sa couleur et son libellé changent ici.

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `src/services/vigilance.ts` (créé) | Niveaux L1, conversions, libellés, couleurs, confiance en mots, seuils de marché |
| `src/services/vigilance.test.ts` (créé) | Tests des conversions et libellés |
| `src/components/shared/vigilancePill.ts` (créé) | Pastille HTML de niveau |
| `src/components/france-intel-score.ts` (créé) | Rendu pur : carte du niveau national, lignes de situation |
| `src/components/france-intel-score.test.ts` (créé) | Tests du rendu |
| `src/components/FranceIntelPanel.ts` | Branche les rendus extraits, libellés, état du volet |
| `src/components/france-intel-events.ts` (+ test) | Libellés L1 des événements |
| `src/components/BarometerWidget.ts` | Libellé et couleur L1 |
| `src/components/AlertMonitor.ts`, `SituationMonitor.ts`, `SituationBrief.ts` (+ tests) | Pastilles L1, confiance en mots |
| `src/services/situation-brief.ts` (+ test) | Libellés L1 des convergences |
| `src/services/france-intel-brief.ts` (+ test), `api/_handlers/intelligence/v1/france-intel-brief.js`, `tests/france-intel-brief-api.test.ts`, `src/App.ts` | Brief v15 en L1, brief redemandé quand la couleur change |
| `src/utils/market-sparkline.ts` (+ test), `src/components/MarketStrip.ts`, `src/components/CommodityStrip.ts` | Marchés neutres, seuils |
| `api/_lib/parse-rss.js`, `api/_handlers/news.js`, `src/plugins/rss-json-proxy.ts`, `tests/ingest.test.ts`, `tests/news-api.test.ts` | Entités HTML |
| `src/components/UnderMapNewsFeed.ts`, `src/locales/fr.ts`, `src/locales/en.ts` | Confiance en mots dans le flux |
| `src/styles/main.css` | Pastille, carte de niveau, marchés, casse normale |

---

### Task 1: Module `vigilance` et pastille de niveau

**Files:**
- Create: `src/services/vigilance.ts`
- Create: `src/components/shared/vigilancePill.ts`
- Test: `src/services/vigilance.test.ts`
- Modify: `src/styles/main.css` (ajout en fin de fichier)

**Interfaces:**
- Produces : `type VigilanceLevel = 'vert' | 'jaune' | 'orange' | 'rouge'` ; `type OfficialColor = 'green' | 'yellow' | 'orange' | 'red' | 'violet'` ; `LEVEL_RANK` ; `scoreLevel(score: number): VigilanceLevel` ; `situationLevel(severity: SituationSeverity)` ; `eventLevel(level: ThreatLevel)` ; `officialLevel(color: OfficialColor)` ; `infraStatusLevel(status: 'nominal' | 'degraded' | 'critical')` ; `maxLevel(levels: readonly VigilanceLevel[]): VigilanceLevel` ; `levelLabel(level, lang?)` ; `levelPhrase(level, lang?)` ; `levelVigilanceWord(level, lang?)` ; `levelColorVar(level)` ; `levelHex(level)` ; `confidenceBand(confidence: number): BriefConfidence` ; `confidenceLabel(confidence: number, lang?)` ; `briefConfidenceLabel(c: BriefConfidence, lang?)` ; `renderVigilancePill(level, lang?)`. `lang` vaut `'fr' | 'en'`, `'fr'` par défaut.

- [ ] **Step 1: Write the failing test**

Créer `src/services/vigilance.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import {
  briefConfidenceLabel,
  confidenceBand,
  confidenceLabel,
  eventLevel,
  infraStatusLevel,
  levelColorVar,
  levelHex,
  levelLabel,
  levelPhrase,
  levelVigilanceWord,
  maxLevel,
  officialLevel,
  scoreLevel,
  situationLevel,
} from './vigilance.ts';
import { renderVigilancePill } from '../components/shared/vigilancePill.ts';

describe('scoreLevel (seuils du score v3 85/70/55)', () => {
  it('convertit l’indice national aux bornes exactes', () => {
    expect(scoreLevel(100)).toBe('vert');
    expect(scoreLevel(85)).toBe('vert');
    expect(scoreLevel(84)).toBe('jaune');
    expect(scoreLevel(70)).toBe('jaune');
    expect(scoreLevel(69)).toBe('orange');
    expect(scoreLevel(55)).toBe('orange');
    expect(scoreLevel(54)).toBe('rouge');
    expect(scoreLevel(0)).toBe('rouge');
  });

  it('ne rassure jamais sur une donnée manquante', () => {
    expect(scoreLevel(Number.NaN)).toBe('jaune');
    expect(scoreLevel(Number.POSITIVE_INFINITY)).toBe('jaune');
  });
});

describe('conversions', () => {
  it('situations du moteur', () => {
    expect(situationLevel('critical')).toBe('rouge');
    expect(situationLevel('high')).toBe('orange');
    expect(situationLevel('medium')).toBe('jaune');
    expect(situationLevel('watch')).toBe('jaune');
  });

  it('événements consolidés', () => {
    expect(eventLevel('critical')).toBe('rouge');
    expect(eventLevel('high')).toBe('orange');
    expect(eventLevel('medium')).toBe('jaune');
    expect(eventLevel('low')).toBe('vert');
    expect(eventLevel('info')).toBe('vert');
  });

  it('signaux officiels, violet Météo compris', () => {
    expect(officialLevel('green')).toBe('vert');
    expect(officialLevel('yellow')).toBe('jaune');
    expect(officialLevel('orange')).toBe('orange');
    expect(officialLevel('red')).toBe('rouge');
    expect(officialLevel('violet')).toBe('rouge');
  });

  it('baromètre des infrastructures', () => {
    expect(infraStatusLevel('nominal')).toBe('vert');
    expect(infraStatusLevel('degraded')).toBe('jaune');
    expect(infraStatusLevel('critical')).toBe('rouge');
  });

  it('maxLevel garde le plus grave, vert sur une liste vide', () => {
    expect(maxLevel(['jaune', 'rouge', 'orange'])).toBe('rouge');
    expect(maxLevel([])).toBe('vert');
  });
});

describe('libellés', () => {
  it('mots, phrases officielles et vigilance, en français et en anglais', () => {
    expect(levelLabel('rouge')).toBe('Rouge');
    expect(levelLabel('jaune', 'en')).toBe('Yellow');
    expect(levelPhrase('vert')).toBe('pas de vigilance particulière');
    expect(levelPhrase('rouge')).toBe('vigilance absolue');
    expect(levelPhrase('orange', 'en')).toBe('be very vigilant');
    expect(levelVigilanceWord('orange')).toBe('vigilance orange');
    expect(levelVigilanceWord('vert')).toBe('vigilance verte');
    expect(levelVigilanceWord('rouge', 'en')).toBe('red vigilance');
  });

  it('couleurs : jetons CSS et hexadécimaux officiels', () => {
    expect(levelColorVar('rouge')).toBe('var(--sev-red)');
    expect(levelColorVar('vert')).toBe('var(--sev-green)');
    expect(levelHex('jaune')).toBe('#ffcc00');
    expect(levelHex('rouge')).toBe('#ff3b30');
  });

  it('confiance en mots, seuils 0,75 et 0,55', () => {
    expect(confidenceBand(0.75)).toBe('high');
    expect(confidenceBand(0.74)).toBe('moderate');
    expect(confidenceBand(0.55)).toBe('moderate');
    expect(confidenceBand(0.54)).toBe('low');
    expect(confidenceLabel(0.93)).toBe('confiance élevée');
    expect(confidenceLabel(0.6, 'en')).toBe('moderate confidence');
    expect(briefConfidenceLabel('low')).toBe('confiance faible');
  });
});

describe('renderVigilancePill', () => {
  it('affiche le mot dans une pastille de la couleur du niveau', () => {
    expect(renderVigilancePill('rouge')).toBe('<span class="fm-vig fm-vig--rouge">Rouge</span>');
    expect(renderVigilancePill('vert', 'en')).toBe('<span class="fm-vig fm-vig--vert">Green</span>');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/vigilance.test.ts`
Expected: FAIL, `Cannot find module './vigilance.ts'`.

- [ ] **Step 3: Write the implementation**

Créer `src/services/vigilance.ts` :

```ts
// src/services/vigilance.ts — langage commun de gravité (échelle L1 : les quatre couleurs de
// vigilance officielles, celles de Météo-France, Vigicrues et Écowatt). Source unique des
// niveaux, libellés, couleurs et seuils affichés dans le tiroir, les alertes, les listes et
// les fiches. Spec : docs/superpowers/specs/2026-09-24-refonte-ui-poste-de-situation-design.md §4.
//
// Les couches officielles de la carte ne passent PAS par ici : elles gardent leurs couleurs
// d'origine, violet Météo compris.

import type { BriefConfidence, SituationSeverity, ThreatLevel } from '../types/index.ts';

export type VigilanceLevel = 'vert' | 'jaune' | 'orange' | 'rouge';
export type OfficialColor = 'green' | 'yellow' | 'orange' | 'red' | 'violet';
type Lang = 'fr' | 'en';

export const LEVEL_RANK: Record<VigilanceLevel, number> = { vert: 0, jaune: 1, orange: 2, rouge: 3 };

/** Indice national 0–100. Seuils du score v3 (85/70/55) ; « dégradé » et « critique » fusionnent en rouge. */
export function scoreLevel(score: number): VigilanceLevel {
  // Donnée manquante : jamais « vert », qui rassurerait à tort.
  if (!Number.isFinite(score)) return 'jaune';
  if (score >= 85) return 'vert';
  if (score >= 70) return 'jaune';
  if (score >= 55) return 'orange';
  return 'rouge';
}

export function situationLevel(severity: SituationSeverity): VigilanceLevel {
  if (severity === 'critical') return 'rouge';
  if (severity === 'high') return 'orange';
  return 'jaune';
}

export function eventLevel(level: ThreatLevel): VigilanceLevel {
  if (level === 'critical') return 'rouge';
  if (level === 'high') return 'orange';
  if (level === 'medium') return 'jaune';
  return 'vert';
}

export function officialLevel(color: OfficialColor): VigilanceLevel {
  if (color === 'red' || color === 'violet') return 'rouge';
  if (color === 'orange') return 'orange';
  if (color === 'yellow') return 'jaune';
  return 'vert';
}

export function infraStatusLevel(status: 'nominal' | 'degraded' | 'critical'): VigilanceLevel {
  if (status === 'critical') return 'rouge';
  if (status === 'degraded') return 'jaune';
  return 'vert';
}

export function maxLevel(levels: readonly VigilanceLevel[]): VigilanceLevel {
  return levels.reduce<VigilanceLevel>((worst, l) => (LEVEL_RANK[l] > LEVEL_RANK[worst] ? l : worst), 'vert');
}

const LABEL: Record<VigilanceLevel, Record<Lang, string>> = {
  vert: { fr: 'Vert', en: 'Green' },
  jaune: { fr: 'Jaune', en: 'Yellow' },
  orange: { fr: 'Orange', en: 'Orange' },
  rouge: { fr: 'Rouge', en: 'Red' },
};

const PHRASE: Record<VigilanceLevel, Record<Lang, string>> = {
  vert: { fr: 'pas de vigilance particulière', en: 'no particular vigilance' },
  jaune: { fr: 'soyez attentif', en: 'be aware' },
  orange: { fr: 'soyez très vigilant', en: 'be very vigilant' },
  rouge: { fr: 'vigilance absolue', en: 'absolute vigilance' },
};

const VIGILANCE_WORD: Record<VigilanceLevel, Record<Lang, string>> = {
  vert: { fr: 'vigilance verte', en: 'green vigilance' },
  jaune: { fr: 'vigilance jaune', en: 'yellow vigilance' },
  orange: { fr: 'vigilance orange', en: 'orange vigilance' },
  rouge: { fr: 'vigilance rouge', en: 'red vigilance' },
};

const COLOR_VAR: Record<VigilanceLevel, string> = {
  vert: 'var(--sev-green)',
  jaune: 'var(--sev-yellow)',
  orange: 'var(--sev-orange)',
  rouge: 'var(--sev-red)',
};

// Mêmes teintes que les jetons --sev-* ; pour les attributs SVG et le canvas, qui n'acceptent pas var().
const HEX: Record<VigilanceLevel, string> = {
  vert: '#34c759',
  jaune: '#ffcc00',
  orange: '#ff9500',
  rouge: '#ff3b30',
};

export function levelLabel(level: VigilanceLevel, lang: Lang = 'fr'): string {
  return LABEL[level][lang];
}

export function levelPhrase(level: VigilanceLevel, lang: Lang = 'fr'): string {
  return PHRASE[level][lang];
}

export function levelVigilanceWord(level: VigilanceLevel, lang: Lang = 'fr'): string {
  return VIGILANCE_WORD[level][lang];
}

export function levelColorVar(level: VigilanceLevel): string {
  return COLOR_VAR[level];
}

export function levelHex(level: VigilanceLevel): string {
  return HEX[level];
}

/** Confiance 0–1 → bande, seuils 0,75 et 0,55 (ceux du brief). */
export function confidenceBand(confidence: number): BriefConfidence {
  if (confidence >= 0.75) return 'high';
  if (confidence >= 0.55) return 'moderate';
  return 'low';
}

const CONFIDENCE: Record<BriefConfidence, Record<Lang, string>> = {
  high: { fr: 'confiance élevée', en: 'high confidence' },
  moderate: { fr: 'confiance moyenne', en: 'moderate confidence' },
  low: { fr: 'confiance faible', en: 'low confidence' },
};

export function briefConfidenceLabel(c: BriefConfidence, lang: Lang = 'fr'): string {
  return CONFIDENCE[c][lang];
}

export function confidenceLabel(confidence: number, lang: Lang = 'fr'): string {
  return briefConfidenceLabel(confidenceBand(confidence), lang);
}
```

Créer `src/components/shared/vigilancePill.ts` :

```ts
// src/components/shared/vigilancePill.ts — pastille de niveau L1 : le mot, sur la couleur du
// niveau, texte noir (seul choix qui passe le contraste AA sur les quatre teintes).
import { levelLabel, type VigilanceLevel } from '../../services/vigilance.ts';

export function renderVigilancePill(level: VigilanceLevel, lang: 'fr' | 'en' = 'fr'): string {
  return `<span class="fm-vig fm-vig--${level}">${levelLabel(level, lang)}</span>`;
}
```

Ajouter à la fin de `src/styles/main.css` :

```css

/* ─── Langage commun L1 : pastille de niveau (refonte UI, spec §4) ─── */
.fm-vig {
  display: inline-block;
  padding: 0 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.6;
  letter-spacing: 0;
  text-transform: none;
  color: #111;
}
.fm-vig--vert { background: var(--sev-green); }
.fm-vig--jaune { background: var(--sev-yellow); }
.fm-vig--orange { background: var(--sev-orange); }
.fm-vig--rouge { background: var(--sev-red); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/vigilance.test.ts && npm run typecheck`
Expected: PASS (11 tests), typecheck sans erreur.

- [ ] **Step 5: Commit**

```bash
git add src/services/vigilance.ts src/services/vigilance.test.ts src/components/shared/vigilancePill.ts src/styles/main.css
git commit -m "feat: langage commun L1 (niveaux, libellés, couleurs, confiance)"
```

---

### Task 2: Brief en L1 (v15) et brief redemandé quand la couleur change

**Files:**
- Modify: `api/_handlers/intelligence/v1/france-intel-brief.js` (`describeStability`, version d'invite)
- Test: `tests/france-intel-brief-api.test.ts`
- Modify: `src/services/france-intel-brief.ts` (`bandLabel`, `buildDeterministicBrief`, `shouldRefreshBrief`, version)
- Test: `src/services/france-intel-brief.test.ts`
- Modify: `src/App.ts` (`requestFranceIntelBrief`, `refreshFranceIntelPanel`)

**Interfaces:**
- Consumes : `scoreLevel`, `levelVigilanceWord`, `type VigilanceLevel` (tâche 1).
- Produces : `describeStability(score, lang)` exporté par le handler ; `BRIEF_LEVEL_REFRESH_MIN_MS = 600000` ; `interface BriefLevelMark { level: VigilanceLevel; lastLevelRefreshAt: number | null }` ; `shouldRefreshBrief(mark: BriefLevelMark | null, score: number, now: number): boolean`.

- [ ] **Step 1: Write the failing tests**

Dans `tests/france-intel-brief-api.test.ts`, remplacer la ligne d'import du handler :

```ts
import handler, { validateBriefShape, buildPrompt } from '../api/_handlers/intelligence/v1/france-intel-brief.js';
```

par :

```ts
import handler, { validateBriefShape, buildPrompt, describeStability } from '../api/_handlers/intelligence/v1/france-intel-brief.js';
import { levelVigilanceWord, scoreLevel } from '../src/services/vigilance.ts';
```

et ajouter à la fin du fichier :

```ts
describe('describeStability v15 (échelle L1)', () => {
  it('suit scoreLevel pour chaque score de 0 à 100, en français et en anglais', () => {
    for (let s = 0; s <= 100; s += 1) {
      expect(describeStability(s, 'fr')).toBe(levelVigilanceWord(scoreLevel(s), 'fr'));
      expect(describeStability(s, 'en')).toBe(levelVigilanceWord(scoreLevel(s), 'en'));
    }
  });
});
```

Dans `src/services/france-intel-brief.test.ts`, remplacer l'import :

```ts
import { briefSituationIds, buildDeterministicBrief, compactSituations, parseStructuredBrief } from './france-intel-brief.ts';
```

par :

```ts
import { briefSituationIds, buildDeterministicBrief, compactSituations, parseStructuredBrief, shouldRefreshBrief } from './france-intel-brief.ts';
```

remplacer les deux assertions du test « produit un brief complet depuis les situations » :

```ts
    assert.ok(brief.bluf.includes('61/100'));
    assert.ok(brief.bluf.includes('−2') || brief.bluf.includes('-2'));
```

par :

```ts
    assert.ok(brief.bluf.includes('vigilance orange'));
    assert.ok(brief.bluf.includes('en dégradation sur 24 h'));
    assert.ok(!brief.bluf.includes('/100'), 'le nombre ne figure que dans « Pourquoi ce niveau ? »');
```

et ajouter à la fin du fichier :

```ts
describe('shouldRefreshBrief (bug brief 81 / indice 43)', () => {
  const T = 10_000_000;

  it('redemande le brief quand la couleur nationale a changé', () => {
    assert.equal(shouldRefreshBrief({ level: 'jaune', lastLevelRefreshAt: null }, 43, T), true);
  });

  it('ne redemande rien quand la couleur est la même', () => {
    assert.equal(shouldRefreshBrief({ level: 'rouge', lastLevelRefreshAt: null }, 50, T), false);
  });

  it('ne redemande rien avant la première demande', () => {
    assert.equal(shouldRefreshBrief(null, 43, T), false);
  });

  it('un score qui oscille autour d’un seuil ne relance le brief qu’une fois par tranche de 10 min', () => {
    assert.equal(shouldRefreshBrief({ level: 'orange', lastLevelRefreshAt: T - 60_000 }, 54, T), false);
    assert.equal(shouldRefreshBrief({ level: 'orange', lastLevelRefreshAt: T - 600_000 }, 54, T), true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/france-intel-brief-api.test.ts src/services/france-intel-brief.test.ts`
Expected: FAIL. `describeStability is not a function` (non exporté) ; `shouldRefreshBrief is not a function` ; l'assertion `vigilance orange` échoue sur le BLUF actuel « Situation nationale sous tension (61/100, −2 sur 24 h)… ».

- [ ] **Step 3: Passer le handler en v15**

Dans `api/_handlers/intelligence/v1/france-intel-brief.js`, remplacer :

```js
const BRIEF_PROMPT_VERSION = 'v14';

function describeStability(score, lang) {
  if (score >= 85) return 'stable';
  if (score >= 70) return lang === 'fr' ? 'en vigilance' : 'under watch';
  if (score >= 55) return lang === 'fr' ? 'sous tension' : 'under pressure';
  if (score >= 40) return lang === 'fr' ? 'dégradée' : 'degraded';
  return lang === 'fr' ? 'critique' : 'critical';
}
```

par :

```js
const BRIEF_PROMPT_VERSION = 'v15';

// Échelle L1 (quatre couleurs de vigilance officielles), seuils du score v3 85/70/55.
// Alignée sur src/services/vigilance.ts#scoreLevel : test d'alignement dans
// tests/france-intel-brief-api.test.ts.
export function describeStability(score, lang) {
  const fr = lang === 'fr';
  if (!Number.isFinite(score)) return fr ? 'vigilance jaune' : 'yellow vigilance';
  if (score >= 85) return fr ? 'vigilance verte' : 'green vigilance';
  if (score >= 70) return fr ? 'vigilance jaune' : 'yellow vigilance';
  if (score >= 55) return fr ? 'vigilance orange' : 'orange vigilance';
  return fr ? 'vigilance rouge' : 'red vigilance';
}
```

Et, dans le même fichier, remplacer la ligne de commentaire :

```js
// Vercel Edge Function — generates the national intelligence brief via Groq (contract v14).
```

par :

```js
// Vercel Edge Function — generates the national intelligence brief via Groq (contract v14, prompt v15 : posture en échelle L1).
```

- [ ] **Step 4: Passer le client en v15 et ajouter `shouldRefreshBrief`**

Dans `src/services/france-intel-brief.ts` :

1. Ajouter aux imports :

```ts
import { levelVigilanceWord, scoreLevel, type VigilanceLevel } from './vigilance.ts';
```

2. Remplacer `const PROMPT_VERSION = 'v14';` par `const PROMPT_VERSION = 'v15';`.

3. Supprimer entièrement la fonction `bandLabel` :

```ts
function bandLabel(score: number, lang: 'fr' | 'en'): string {
  if (score >= 85) return 'stable';
  if (score >= 70) return lang === 'fr' ? 'en vigilance' : 'under watch';
  if (score >= 55) return lang === 'fr' ? 'sous tension' : 'under pressure';
  if (score >= 40) return lang === 'fr' ? 'dégradée' : 'degraded';
  return lang === 'fr' ? 'critique' : 'critical';
}
```

4. Dans `buildDeterministicBrief`, remplacer :

```ts
  const deltaText = delta24h == null
    ? ''
    : lang === 'fr'
      ? `, ${delta24h >= 0 ? '+' : '−'}${Math.abs(delta24h)} sur 24 h`
      : `, ${delta24h >= 0 ? '+' : '−'}${Math.abs(delta24h)} over 24h`;

  const bluf = lang === 'fr'
    ? `Situation nationale ${bandLabel(score, lang)} (${score}/100${deltaText}). Pression dominante : ${pillarLabel}. ${situations.length} situation(s) corrélée(s) active(s).`
    : `National situation ${bandLabel(score, lang)} (${score}/100${deltaText}). Dominant pressure: ${pillarLabel}. ${situations.length} active correlated situation(s).`;
```

par :

```ts
  // Mot d'abord, sans nombre : l'indice chiffré reste dans « Pourquoi ce niveau ? ».
  const trend = delta24h == null || delta24h === 0
    ? ''
    : lang === 'fr'
      ? (delta24h < 0 ? ', en dégradation sur 24 h' : ', en amélioration sur 24 h')
      : (delta24h < 0 ? ', worsening over 24h' : ', improving over 24h');
  const word = levelVigilanceWord(scoreLevel(score), lang);
  const count = situations.length;
  const countText = lang === 'fr'
    ? (count === 0 ? 'Aucune situation active' : count === 1 ? '1 situation active' : `${count} situations actives`)
    : (count === 0 ? 'No active situation' : count === 1 ? '1 active situation' : `${count} active situations`);

  const bluf = lang === 'fr'
    ? `France en ${word}${trend}. Pression dominante : ${pillarLabel}. ${countText}.`
    : `France under ${word}${trend}. Dominant pressure: ${pillarLabel}. ${countText}.`;
```

5. Ajouter après la fonction `briefSituationIds` :

```ts
/** Au plus un brief redemandé pour changement de couleur par tranche de 10 min (anti-rafale). */
export const BRIEF_LEVEL_REFRESH_MIN_MS = 10 * 60 * 1000;

export interface BriefLevelMark {
  /** Couleur nationale au moment de la dernière demande de brief. */
  level: VigilanceLevel;
  /** Dernière demande déclenchée par un changement de couleur, null si aucune. */
  lastLevelRefreshAt: number | null;
}

/**
 * Faut-il redemander le brief ? Oui quand la couleur nationale n'est plus celle de la dernière
 * demande : sinon le brief garde le niveau de l'ouverture (constaté : « 81 » face à un indice
 * de 43). Anti-rafale : un score qui oscille autour d'un seuil ne relance qu'une fois par 10 min.
 */
export function shouldRefreshBrief(mark: BriefLevelMark | null, score: number, now: number): boolean {
  if (mark === null || scoreLevel(score) === mark.level) return false;
  return mark.lastLevelRefreshAt === null || now - mark.lastLevelRefreshAt >= BRIEF_LEVEL_REFRESH_MIN_MS;
}
```

- [ ] **Step 5: Brancher dans `App.ts`**

1. Remplacer l'import :

```ts
import { briefSituationIds, fetchFranceIntelBrief } from './services/france-intel-brief.ts';
```

par :

```ts
import { briefSituationIds, fetchFranceIntelBrief, shouldRefreshBrief, type BriefLevelMark } from './services/france-intel-brief.ts';
import { scoreLevel } from './services/vigilance.ts';
```

2. Après la ligne `private franceIntelBriefRefreshTimer: ReturnType<typeof setInterval> | null = null;`, ajouter :

```ts
  /** Couleur nationale du dernier brief demandé : un changement de couleur redemande le brief. */
  private franceIntelBriefMark: BriefLevelMark | null = null;
```

3. Dans `requestFranceIntelBrief`, remplacer :

```ts
    const requestId = ++this.franceIntelBriefRequestId;
```

par :

```ts
    const requestId = ++this.franceIntelBriefRequestId;
    this.franceIntelBriefMark = {
      level: scoreLevel(snapshot.score),
      lastLevelRefreshAt: this.franceIntelBriefMark?.lastLevelRefreshAt ?? null,
    };
```

4. À la fin de `refreshFranceIntelPanel`, remplacer :

```ts
    if (!this.franceIntelPanel?.isVisible()) return;
    this.franceIntelPanel.show(snapshot);
  }

  /** Assemble l'état courant (caches, aucun fetch) pour la note de situation. */
```

par :

```ts
    if (!this.franceIntelPanel?.isVisible()) return;
    this.franceIntelPanel.show(snapshot);
    const now = Date.now();
    if (shouldRefreshBrief(this.franceIntelBriefMark, snapshot.score, now)) {
      this.requestFranceIntelBrief(snapshot, lang, { showLoading: false });
      if (this.franceIntelBriefMark) this.franceIntelBriefMark.lastLevelRefreshAt = now;
    }
  }

  /** Assemble l'état courant (caches, aucun fetch) pour la note de situation. */
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/france-intel-brief-api.test.ts tests/france-intel-brief-cache.test.ts src/services/france-intel-brief.test.ts && npm run typecheck`
Expected: PASS, typecheck sans erreur.

- [ ] **Step 7: Commit**

```bash
git add api/_handlers/intelligence/v1/france-intel-brief.js tests/france-intel-brief-api.test.ts src/services/france-intel-brief.ts src/services/france-intel-brief.test.ts src/App.ts
git commit -m "fix: brief en vigilance L1 (v15), redemandé quand la couleur nationale change"
```

---

### Task 3: Tiroir Intelligence — carte du niveau national et situations en L1

**Files:**
- Create: `src/components/france-intel-score.ts`
- Test: `src/components/france-intel-score.test.ts`
- Modify: `src/components/FranceIntelPanel.ts`
- Modify: `src/components/france-intel-events.ts`, test `src/components/france-intel-events.test.ts`
- Modify: `src/components/BarometerWidget.ts`
- Modify: `src/styles/main.css`

**Interfaces:**
- Consumes : tâche 1 (`scoreLevel`, `situationLevel`, `eventLevel`, `officialLevel`, `infraStatusLevel`, `levelLabel`, `levelPhrase`, `levelColorVar`, `levelHex`, `confidenceLabel`, `briefConfidenceLabel`, `renderVigilancePill`) ; `escapeHtml` de `france-intel-events.ts` ; `StabilityPillarValues` de `src/utils/stability-history.ts`.
- Produces : `interface ScoreCardInput { breakdown: FranceScoreBreakdown; delta24h: number | null; pillarDeltas: StabilityPillarValues | null; series: number[]; lang: 'fr' | 'en'; whyOpen: boolean }` ; `renderScoreCard(input: ScoreCardInput): string` ; `scoreDriverText(breakdown, lang): string` (HTML échappé) ; `renderSituationRow(s: DetectedSituation, lang, expanded: boolean): string`.

- [ ] **Step 1: Write the failing tests**

Créer `src/components/france-intel-score.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { renderScoreCard, renderSituationRow, scoreDriverText } from './france-intel-score.ts';
import type { DetectedSituation, FranceScoreBreakdown } from '../types/index.ts';

function breakdown(score = 43): FranceScoreBreakdown {
  return {
    score,
    baseline: 95,
    pillars: [
      { key: 'continuity', value: 61, deduction: 18.9, components: [{ label: 'Carburants & pétrole', value: 100 }, { label: 'Pression électrique', value: 75 }] },
      { key: 'security', value: 57, deduction: 14.7, components: [] },
      { key: 'signal', value: 28, deduction: 3.4, components: [] },
      { key: 'defense', value: 65, deduction: 8.8, components: [] },
    ],
    shockValue: 55,
    shockExtra: 1.3,
    situationCap: 55,
  };
}

function situation(over: Partial<DetectedSituation> = {}): DetectedSituation {
  return {
    id: 'energy-stress',
    type: 'ENERGY_STRESS',
    severity: 'critical',
    confidence: 0.95,
    title: 'Tension énergétique nationale',
    summary: 'Signal Écowatt orange confirmé.',
    affectedZones: ['AURA'],
    drivers: ['Écowatt orange — 2 régions'],
    recommendedActions: [{ label: 'Surveiller Écowatt J+1', ownerHint: 'Analyste', actionType: 'monitor' }],
    sourceRefs: ['Écowatt RTE'],
    updatedAt: new Date(0),
    ...over,
  };
}

const base = { delta24h: -4, pillarDeltas: null, series: [81, 70, 43], lang: 'fr' as const, whyOpen: false };

describe('renderScoreCard', () => {
  it('affiche le niveau en mot et en couleur, le nombre seulement dans « Pourquoi ce niveau ? »', () => {
    const html = renderScoreCard({ ...base, breakdown: breakdown(43) });
    const visible = html.slice(0, html.indexOf('<details'));
    expect(visible).toContain('<span class="fm-vig fm-vig--rouge">Rouge</span>');
    expect(visible).toContain('vigilance absolue');
    expect(visible).toContain('tirée par Carburants &amp; pétrole, Pression électrique');
    expect(visible).toContain('en dégradation sur 24 h');
    expect(visible).not.toContain('43');
    expect(html).toContain('Indice de stabilité 43/100');
    expect(html).toContain('Indice plafonné à 55');
  });

  it('garde le volet ouvert quand il l’était (le tiroir est reconstruit en continu)', () => {
    expect(renderScoreCard({ ...base, breakdown: breakdown(), whyOpen: false })).toContain('<details class="frintel-why">');
    expect(renderScoreCard({ ...base, breakdown: breakdown(), whyOpen: true })).toContain('<details class="frintel-why" open>');
  });

  it('passe en anglais avec la bascule EN', () => {
    const html = renderScoreCard({ ...base, breakdown: breakdown(90), lang: 'en', delta24h: 2 });
    expect(html).toContain('>Green</span>');
    expect(html).toContain('no particular vigilance');
    expect(html).toContain('improving over 24 h');
    expect(html).toContain('Why this level?');
  });
});

describe('scoreDriverText', () => {
  it('dit « sans pression dominante » quand aucun pilier ne pèse', () => {
    const bd = breakdown(92);
    bd.pillars = bd.pillars.map((p) => ({ ...p, deduction: 0.4 }));
    expect(scoreDriverText(bd, 'fr')).toBe('sans pression dominante');
  });

  it('retombe sur le nom du pilier sans composante détaillée', () => {
    const bd = breakdown();
    bd.pillars = [{ key: 'security', value: 57, deduction: 14.7, components: [] }];
    expect(scoreDriverText(bd, 'fr')).toBe('tirée par sécurité');
  });
});

describe('renderSituationRow', () => {
  it('n’affiche aucun code du moteur, niveau et confiance en mots', () => {
    const html = renderSituationRow(situation(), 'fr', false);
    expect(html).not.toContain('SIT-');
    expect(html).not.toContain('ENERGY_STRESS');
    expect(html).not.toContain('CONF');
    expect(html).toContain('<span class="fm-vig fm-vig--rouge">Rouge</span>');
    expect(html).toContain('confiance élevée');
  });

  it('échappe le titre et l’identifiant, déplie le détail sur demande', () => {
    const html = renderSituationRow(situation({ id: 'x"y', title: '<img src=x onerror=alert(1)>' }), 'fr', true);
    expect(html).not.toContain('<img');
    expect(html).toContain('data-sit-id="x&quot;y"');
    expect(html).toContain('frintel-sit-detail');
    expect(html).toContain('Action : Surveiller Écowatt J+1');
  });
});
```

Dans `src/components/france-intel-events.test.ts`, remplacer les attentes du test « distingue source unique, même groupe et corroboration indépendante » :

```ts
    expect(renderEventRow(event({ sourceCount: 1, independentCount: 1 }), 'fr', NOW, undefined)).toContain('SOURCE UNIQUE');
```

par :

```ts
    expect(renderEventRow(event({ sourceCount: 1, independentCount: 1 }), 'fr', NOW, undefined)).toContain('Source unique');
```

et, dans le test « journal : libellés au singulier, gravités traduites » :

```ts
    expect(html).toContain('aggravé MOYEN → ÉLEVÉ');
    expect(html).toContain('créé · MOYEN');
```

par :

```ts
    expect(html).toContain('aggravé jaune → orange');
    expect(html).toContain('créé · jaune');
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/france-intel-score.test.ts src/components/france-intel-events.test.ts`
Expected: FAIL, `Cannot find module './france-intel-score.ts'` ; dans `france-intel-events.test.ts`, `expected … to contain 'Source unique'` et `'aggravé jaune → orange'`.

- [ ] **Step 3: Écrire le module de rendu**

Créer `src/components/france-intel-score.ts` :

```ts
// src/components/france-intel-score.ts — rendu HTML pur de la carte « niveau national » et des
// lignes de situation du tiroir Intelligence France, dans le langage commun L1 (refonte UI,
// spec §4). Aucun accès au DOM : testable sous Node. L'indice chiffré, les piliers et le
// plafond ne sont visibles que dans le volet replié « Pourquoi ce niveau ? ».

import type { DetectedSituation, FranceScoreBreakdown } from '../types/index.ts';
import type { StabilityPillarValues } from '../utils/stability-history.ts';
import { escapeHtml } from './france-intel-events.ts';
import { renderVigilancePill } from './shared/vigilancePill.ts';
import {
  confidenceLabel,
  levelColorVar,
  levelPhrase,
  scoreLevel,
  situationLevel,
  type VigilanceLevel,
} from '../services/vigilance.ts';

type Lang = 'fr' | 'en';

function t(lang: Lang, fr: string, en: string): string {
  return lang === 'fr' ? fr : en;
}

const PILLAR_UI: ReadonlyArray<{ key: FranceScoreBreakdown['pillars'][number]['key']; fr: string; en: string }> = [
  { key: 'continuity', fr: 'Continuité', en: 'Continuity' },
  { key: 'security', fr: 'Sécurité', en: 'Security' },
  { key: 'signal', fr: 'Signal', en: 'Signal' },
  { key: 'defense', fr: 'Défense', en: 'Defense' },
];

export interface ScoreCardInput {
  breakdown: FranceScoreBreakdown;
  delta24h: number | null;
  pillarDeltas: StabilityPillarValues | null;
  series: number[];
  lang: Lang;
  whyOpen: boolean;
}

/** « tirée par … » : les deux premières composantes du pilier qui retire le plus de points. HTML échappé. */
export function scoreDriverText(breakdown: FranceScoreBreakdown, lang: Lang): string {
  const dominant = [...breakdown.pillars].sort((a, b) => b.deduction - a.deduction)[0];
  if (!dominant || dominant.deduction < 1) return t(lang, 'sans pression dominante', 'no dominant pressure');
  const parts = dominant.components.slice(0, 2).map((c) => escapeHtml(c.label));
  if (parts.length > 0) return `${t(lang, 'tirée par', 'driven by')} ${parts.join(', ')}`;
  const ui = PILLAR_UI.find((p) => p.key === dominant.key);
  const name = ui ? t(lang, ui.fr, ui.en).toLowerCase() : escapeHtml(dominant.key);
  return `${t(lang, 'tirée par', 'driven by')} ${name}`;
}

function trendText(delta: number | null, lang: Lang): string {
  if (delta == null || delta === 0) return '';
  return delta < 0
    ? t(lang, 'en dégradation sur 24 h', 'worsening over 24 h')
    : t(lang, 'en amélioration sur 24 h', 'improving over 24 h');
}

/** Pilier = pression 0–100 (plus haut = pire) ; mêmes seuils que l'ancien affichage. */
function pillarLevel(value: number): VigilanceLevel {
  if (value >= 55) return 'orange';
  if (value >= 35) return 'jaune';
  return 'vert';
}

function formatDelta(delta: number | null | undefined): string {
  if (delta == null) return '—';
  if (delta > 0) return `+${delta} ▲`;
  if (delta < 0) return `−${Math.abs(delta)} ▼`;
  return '0 ·';
}

function renderSparkline(series: number[], level: VigilanceLevel, lang: Lang): string {
  if (series.length < 2) return '';
  const W = 200;
  const H = 26;
  const min = Math.min(...series) - 2;
  const max = Math.max(...series) + 2;
  const range = max - min || 1;
  const toX = (i: number): number => (i / (series.length - 1)) * W;
  const toY = (v: number): number => H - ((v - min) / range) * H;
  const pts = series.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ');
  const last = series[series.length - 1];
  return `
    <svg class="frintel-spark" viewBox="0 0 ${W} ${H}" role="img"
      aria-label="${t(lang, 'Historique de l’indice sur 7 jours', '7-day index history')}">
      <polyline points="${pts}" fill="none" stroke="var(--text-accent)" stroke-width="1.5"/>
      <circle cx="${toX(series.length - 1).toFixed(1)}" cy="${toY(last).toFixed(1)}" r="2" fill="${levelColorVar(level)}"/>
    </svg>
    <div class="frintel-spark-caption">${t(lang, '7 jours', '7 days')}</div>
  `;
}

export function renderScoreCard(input: ScoreCardInput): string {
  const { breakdown: bd, lang } = input;
  const level = scoreLevel(bd.score);
  const trend = trendText(input.delta24h, lang);

  const pillarRows = PILLAR_UI.map(({ key, fr, en }) => {
    const pillar = bd.pillars.find((p) => p.key === key);
    if (!pillar) return '';
    const delta = input.pillarDeltas ? input.pillarDeltas[key] : null;
    return `
      <div class="frintel-pillar-label">${t(lang, fr, en)}</div>
      <div class="frintel-pillar-track"><span class="frintel-pillar-fill" style="width:${Math.min(100, pillar.value)}%;background:${levelColorVar(pillarLevel(pillar.value))};"></span></div>
      <div class="frintel-pillar-val">${pillar.value}</div>
      <div class="frintel-pillar-delta">${formatDelta(delta)}</div>
      <div class="frintel-pillar-ded">−${pillar.deduction.toFixed(1)}</div>
    `;
  }).join('');

  const capLine = bd.situationCap != null
    ? `<div class="frintel-score-cap">${t(lang, `Indice plafonné à ${bd.situationCap} tant qu'une situation corrélée est active`, `Index capped at ${bd.situationCap} while a correlated situation is active`)}</div>`
    : '';

  return `
    <section class="frintel-card frintel-level-card">
      <div class="frintel-level-row">
        ${renderVigilancePill(level, lang)}
        <span class="frintel-level-phrase">${levelPhrase(level, lang)}</span>
      </div>
      <div class="frintel-level-driver">${scoreDriverText(bd, lang)}${trend ? ` · ${trend}` : ''}</div>
      <details class="frintel-why"${input.whyOpen ? ' open' : ''}>
        <summary>${t(lang, 'Pourquoi ce niveau ?', 'Why this level?')}</summary>
        <div class="frintel-why-body">
          <div class="frintel-why-index">${t(lang, `Indice de stabilité ${bd.score}/100 (base ${bd.baseline}, moins la pression en temps réel)`, `Stability index ${bd.score}/100 (baseline ${bd.baseline}, minus live pressure)`)}</div>
          <div class="frintel-gauge" role="img" aria-label="${t(lang, `Indice ${bd.score} sur 100`, `Index ${bd.score} out of 100`)}">
            <span class="frintel-gauge-zone" style="width:55%;background:${levelColorVar('rouge')};"></span>
            <span class="frintel-gauge-zone" style="width:15%;background:${levelColorVar('orange')};"></span>
            <span class="frintel-gauge-zone" style="width:15%;background:${levelColorVar('jaune')};"></span>
            <span class="frintel-gauge-zone" style="width:15%;background:${levelColorVar('vert')};"></span>
            <span class="frintel-gauge-marker" style="left:${bd.score}%;"></span>
          </div>
          <div class="frintel-gauge-scale"><span>0</span><span>100</span></div>
          ${renderSparkline(input.series, level, lang)}
          <div class="frintel-pillars">${pillarRows}</div>
          ${capLine}
        </div>
      </details>
    </section>
  `;
}

export function renderSituationRow(s: DetectedSituation, lang: Lang, expanded: boolean): string {
  const level = situationLevel(s.severity);
  const id = escapeHtml(s.id);
  const detailId = `frintel-sit-detail-${id}`;
  const drivers = s.drivers.map((d, i) => `
    <div class="frintel-sit-driver">${i === s.drivers.length - 1 ? '└─' : '├─'} ${escapeHtml(d)}</div>
  `).join('');
  const zoneChips = s.affectedZones.slice(0, 4).map((z) => `<span class="frintel-chip frintel-chip-zone">${escapeHtml(z)}</span>`).join('');
  const sourceChips = s.sourceRefs.slice(0, 5).map((r) => `<span class="frintel-chip">${escapeHtml(r)}</span>`).join('');
  const actionChips = s.recommendedActions.slice(0, 3).map((a) => `<span class="frintel-chip">${t(lang, 'Action', 'Action')} : ${escapeHtml(a.label)}</span>`).join('');
  return `
    <article class="frintel-sit${expanded ? ' is-expanded' : ''}" data-sit-id="${id}">
      <span class="frintel-sit-rail" style="background:${levelColorVar(level)};"></span>
      <div class="frintel-sit-body">
        <button type="button" class="frintel-sit-head" aria-expanded="${expanded ? 'true' : 'false'}"${expanded ? ` aria-controls="${detailId}"` : ''}>
          ${renderVigilancePill(level, lang)}
          <span class="frintel-sit-conf">${confidenceLabel(s.confidence, lang)}</span>
        </button>
        <div class="frintel-sit-title">${escapeHtml(s.title)}</div>
        ${expanded ? `
          <div class="frintel-sit-detail" id="${detailId}">
            <p class="frintel-sit-summary">${escapeHtml(s.summary)}</p>
            <div class="frintel-sit-drivers">${drivers}</div>
            <div class="frintel-sit-tags">${zoneChips}${sourceChips}${actionChips}</div>
          </div>
        ` : ''}
      </div>
    </article>
  `;
}
```

- [ ] **Step 4: Libellés L1 des événements**

Dans `src/components/france-intel-events.ts` :

1. Ajouter aux imports :

```ts
import { eventLevel, levelColorVar, levelLabel } from '../services/vigilance.ts';
```

2. Supprimer les constantes `SEVERITY_COLOR` et `SEVERITY_LABEL` (deux blocs `const … : Record<ThreatLevel, …> = { … };`).

3. Remplacer `STATUS_LABEL` par :

```ts
const STATUS_LABEL: Record<NewsEventStatus, { fr: string; en: string }> = {
  active: { fr: 'actif', en: 'active' },
  cooling: { fr: 'refroidit', en: 'cooling' },
  closed: { fr: 'clos', en: 'closed' },
};
```

4. Remplacer la fonction `severityLabel` par :

```ts
function severityLabel(value: string | null, lang: Lang): string {
  const known = SEVERITIES.find((s) => s === value);
  return known ? levelLabel(eventLevel(known), lang).toLowerCase() : escapeHtml(value ?? '?');
}
```

5. Remplacer le corps de `kindChip` par :

```ts
  switch (kind) {
    case 'escalated':
      return chip(`${t(lang, 'Aggravé', 'Escalated')} ${severityLabel(item.severityFrom, lang)} → ${severityLabel(item.event.severity, lang)}`, 'crit');
    case 'created':
      return chip(t(lang, 'Nouveau', 'New'), 'warn');
    case 'corroborated':
      return chip(`${t(lang, 'Corroboré', 'Corroborated')} ${item.independentFrom ?? '?'} → ${item.event.independentCount}`, 'zone');
    case 'reopened':
      return chip(t(lang, 'Rouvert', 'Reopened'), 'warn');
    case 'deescalated':
      return chip(t(lang, 'Atténué', 'De-escalated'));
    case 'closed':
      return chip(t(lang, 'Clos', 'Closed'));
    case 'cooling':
      return chip(t(lang, 'Refroidit', 'Cooling'));
  }
```

6. Dans `corroborationChip`, remplacer `chip(t(lang, 'SOURCE UNIQUE', 'SINGLE SOURCE'), 'warn')` par `chip(t(lang, 'Source unique', 'Single source'), 'warn')`.

7. Dans `renderEventRow`, remplacer `style="background:${SEVERITY_COLOR[e.severity]}"` par `style="background:${levelColorVar(eventLevel(e.severity))}"`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/components/france-intel-score.test.ts src/components/france-intel-events.test.ts`
Expected: PASS (7 + 8 tests).

- [ ] **Step 6: Brancher le tiroir**

Dans `src/components/FranceIntelPanel.ts` :

1. Ajouter aux imports :

```ts
import { renderScoreCard, renderSituationRow } from './france-intel-score.ts';
import { briefConfidenceLabel, levelColorVar, levelLabel, officialLevel } from '../services/vigilance.ts';
```

2. Supprimer les fonctions et constantes devenues inutiles : `scoreBandLabel`, `scoreBandColor`, `SEVERITY_COLORS`, `SIT_CODES`, `sitCode`, `PILLAR_UI`, `pillarBarColor`, `formatDelta`, `deltaColor`, ainsi que le commentaire `// ─── Bandes du score v3 (spec §4.3) ───…` et la méthode `renderScoreSparkline`. Garder `intensity` (chronologie). Retirer aussi `FranceScoreBreakdown` et `SituationSeverity` de l'`import type { … } from '../types/index.ts'` en tête de fichier : ils ne servaient qu'à ces constantes (`noUnusedLocals` les signalerait).

3. Dans le gabarit du constructeur, remplacer :

```html
            <h2 class="frintel-title">FRANCE</h2>
            <div class="frintel-subtitle">Country Intelligence · <span class="frintel-subtitle-live fi-active-count"></span></div>
```

par :

```html
            <h2 class="frintel-title">France</h2>
            <div class="frintel-subtitle"><span class="frintel-subtitle-live fi-active-count"></span></div>
```

4. Ajouter le champ, après `private briefSituationIds: string[] = [];` :

```ts
  /** Volet « Pourquoi ce niveau ? » ouvert ; état hors du DOM, le contenu est reconstruit en continu. */
  private scoreWhyOpen = false;
```

5. Dans le constructeur, après `this.contentEl?.addEventListener('click', (e) => this.handleEventsClick(e));`, ajouter :

```ts
    // `toggle` ne remonte pas : écoute en capture sur le conteneur.
    this.contentEl?.addEventListener('toggle', (e) => {
      const target = e.target;
      if (target instanceof HTMLDetailsElement && target.classList.contains('frintel-why')) {
        this.scoreWhyOpen = target.open;
      }
    }, true);
```

6. Dans `focusedSelector`, après `if (!(el instanceof HTMLElement) || !this.contentEl?.contains(el)) return null;`, ajouter :

```ts
    if (el.matches('.frintel-why > summary')) return '.frintel-why > summary';
```

7. Dans `renderContentNow`, remplacer `: t(lang, 'surveillance nominale', 'nominal watch');` par `: t(lang, 'aucune situation active', 'no active situation');`.

8. Remplacer toute la méthode `renderScoreBlock` par :

```ts
  private renderScoreBlock(snapshot: FranceCountrySnapshot, lang: 'fr' | 'en'): string {
    return renderScoreCard({
      breakdown: snapshot.scoreBreakdown,
      delta24h: getDelta24h(),
      pillarDeltas: getPillarDeltas24h(),
      series: getSparklineSeries(),
      lang,
      whyOpen: this.scoreWhyOpen,
    });
  }
```

9. Dans `renderSituationsBlock`, remplacer tout le calcul de `rows` (de `const rows = situations.map((s) => {` jusqu'au `}).join('');` correspondant) par :

```ts
    const rows = situations
      .map((s) => renderSituationRow(s, lang, this.expandedSituations.has(s.id)))
      .join('');
```

et, dans le gabarit renvoyé, remplacer :

```ts
            ? `${situations.length} ${t(lang, 'actives · moteur 10 règles', 'active · 10-rule engine')}`
            : t(lang, 'moteur 10 règles', '10-rule engine')}</div>
```

par :

```ts
            ? `${situations.length} ${t(lang, situations.length > 1 ? 'actives' : 'active', 'active')}`
            : ''}</div>
```

et `t(lang, 'Surveillance nominale — aucune corrélation active.', 'Nominal watch — no active correlation.')` par `t(lang, 'Aucune situation corrélée active.', 'No active correlated situation.')`.

10. Dans `renderDomainsBlock`, remplacer les libellés `'CYBER'`, `'RAIL'`, `t(lang, 'MILITAIRE', 'MILITARY')`, `'MARITIME'`, `t(lang, 'PANNES', 'OUTAGES')`, `t(lang, 'DÉFENSE', 'DEFENSE')`, `t(lang, 'MÉTÉO', 'WEATHER')`, `'FINANCE'` par `'Cyber'`, `'Rail'`, `t(lang, 'Militaire', 'Military')`, `'Maritime'`, `t(lang, 'Pannes', 'Outages')`, `t(lang, 'Défense', 'Defense')`, `t(lang, 'Météo', 'Weather')`, `'Finance'`, et remplacer :

```ts
    const levelColor: Record<Level, string> = {
      low: 'var(--threat-low)', medium: 'var(--threat-medium)', high: 'var(--threat-high)',
    };
```

par :

```ts
    const levelColor: Record<Level, string> = {
      low: levelColorVar('vert'), medium: levelColorVar('jaune'), high: levelColorVar('orange'),
    };
```

11. Dans `renderEnergyBlock`, remplacer :

```ts
          <div class="frintel-card-meta">${energy?.ecowattSignal ? `Ecowatt ${escapeHtml(energy.ecowattSignal.toUpperCase())}` : t(lang, 'Données partielles', 'Partial data')}</div>
```

par :

```ts
          <div class="frintel-card-meta">${energy?.ecowattSignal ? `${t(lang, 'Écowatt : signal', 'Ecowatt: signal')} ${levelLabel(officialLevel(energy.ecowattSignal), lang).toLowerCase()}` : t(lang, 'Données partielles', 'Partial data')}</div>
```

12. Dans `renderBriefSection`, remplacer :

```ts
    meta.textContent = brief.origin === 'llm'
      ? `${t(lang, 'IA + MOTEUR', 'AI + ENGINE')} · ${freshness === 'fresh' ? 'FRESH' : 'CACHED'} ${renderedAt}`
      : `${t(lang, 'SYNTHÈSE MOTEUR', 'ENGINE SYNTHESIS')} ${renderedAt}`;

    const confidenceLabel: Record<StructuredBrief['judgments'][number]['confidence'], string> = {
      high: t(lang, 'ÉLEVÉE', 'HIGH'),
      moderate: t(lang, 'MODÉRÉE', 'MODERATE'),
      low: t(lang, 'FAIBLE', 'LOW'),
    };
```

par :

```ts
    meta.textContent = brief.origin === 'llm'
      ? `${t(lang, 'IA', 'AI')} · ${freshness === 'fresh' ? t(lang, 'à jour', 'fresh') : t(lang, 'en cache', 'cached')} ${renderedAt}`
      : `${t(lang, 'Synthèse automatique', 'Automatic synthesis')} ${renderedAt}`;
```

et, plus bas :

```ts
              ${j.unsupported ? `<span class="frintel-jd-unsupported">${t(lang, 'NON ÉTAYÉ', 'UNSUPPORTED')}</span> ` : ''}
              <span class="frintel-jd-conf frintel-jd-conf-${j.confidence}">${t(lang, 'CONFIANCE', 'CONFIDENCE')} ${confidenceLabel[j.confidence]}</span>
```

par :

```ts
              ${j.unsupported ? `<span class="frintel-jd-unsupported">${t(lang, 'Non étayé', 'Unsupported')}</span> ` : ''}
              <span class="frintel-jd-conf frintel-jd-conf-${j.confidence}">${briefConfidenceLabel(j.confidence, lang)}</span>
```

- [ ] **Step 7: Baromètre des infrastructures**

Dans `src/components/BarometerWidget.ts` :

1. Ajouter l'import :

```ts
import { infraStatusLevel, levelHex, levelLabel } from '../services/vigilance.ts';
```

2. Dans `update`, remplacer :

```ts
    const color = status === 'nominal'  ? '#34c759'
                : status === 'degraded' ? '#ffcc00'
                :                         '#ff2d55';
```

par :

```ts
    const level = infraStatusLevel(status);
    const color = levelHex(level);
```

et :

```ts
    this.statusLabelEl.textContent =
      status === 'nominal'  ? 'Nominal'  :
      status === 'degraded' ? 'Dégradé'  : 'Critique';
```

par :

```ts
    this.statusLabelEl.textContent = levelLabel(level);
```

3. Remplacer `title.textContent = 'INFRASTRUCTURES FRANCE';` par `title.textContent = 'Infrastructures France';`, et retirer les majuscules forcées des deux styles en ligne :

```ts
    title.style.cssText = 'font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-primary);line-height:1.3;white-space:nowrap;';
```

par :

```ts
    title.style.cssText = 'font-size:11px;font-weight:700;color:var(--text-primary);line-height:1.3;white-space:nowrap;';
```

et :

```ts
    this.statusLabelEl.style.cssText = 'font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em;';
```

par :

```ts
    this.statusLabelEl.style.cssText = 'font-size:10px;color:var(--text-muted);';
```

- [ ] **Step 8: Styles du tiroir**

Ajouter à la fin de `src/styles/main.css` :

```css

/* ─── Tiroir Intelligence : carte du niveau national (refonte UI, étape 1) ─── */
.frintel-level-card { padding-top: 12px; }
.frintel-level-row { display: flex; align-items: center; gap: 8px; }
.frintel-level-row .fm-vig { font-size: 13px; padding: 1px 8px; }
.frintel-level-phrase { font-size: 13px; color: var(--text-primary); }
.frintel-level-driver { margin-top: 6px; font-size: 12px; color: var(--text-secondary); }
.frintel-why { margin-top: 10px; }
.frintel-why > summary { cursor: pointer; font-size: 12px; color: var(--text-secondary); }
.frintel-why > summary:focus-visible { outline: 1px solid var(--text-accent); outline-offset: 2px; }
.frintel-why-body { margin-top: 8px; }
.frintel-why-index { font-size: 12px; color: var(--text-secondary); margin-bottom: 6px; }
.frintel-sit-conf { font-size: 11px; color: var(--text-secondary); margin-left: 6px; }
.frintel-sit-head { display: flex; align-items: center; }
```

Puis retirer la casse forcée en majuscules des titres du tiroir :

```bash
python3 - <<'EOF'
import re
path = 'src/styles/main.css'
targets = {'.frintel-subtitle', '.frintel-card-title', '.frintel-bluf-kicker', '.frintel-jd-kicker',
           '.frintel-oil-title', '.frintel-fuel-history-title', '.frintel-timeline-label'}
lines = open(path, encoding='utf-8').read().split('\n')
out, sel, removed = [], None, 0
for line in lines:
    m = re.match(r'^([^\s{][^{]*)\{', line)
    if m:
        sel = m.group(1).strip()
    if sel in targets and re.search(r'text-transform:\s*uppercase;?', line):
        stripped = re.sub(r'\s*text-transform:\s*uppercase;?', '', line)
        removed += 1
        if stripped.strip() == '':
            continue
        line = stripped
    out.append(line)
open(path, 'w', encoding='utf-8').write('\n'.join(out))
print('déclarations retirées :', removed)
EOF
```

Expected : `déclarations retirées : 7`.

- [ ] **Step 9: Run the task gate**

Run: `npx vitest run && npm run typecheck && npm run lint && npm run build`
Expected: tout vert. `noUnusedLocals` signalerait un reste des fonctions supprimées à l'étape 6.

- [ ] **Step 10: Commit**

```bash
git add src/components/france-intel-score.ts src/components/france-intel-score.test.ts src/components/FranceIntelPanel.ts src/components/france-intel-events.ts src/components/france-intel-events.test.ts src/components/BarometerWidget.ts src/styles/main.css
git commit -m "feat: tiroir Intelligence en langage commun L1, chiffres dans « Pourquoi ce niveau ? »"
```

---

### Task 4: Alertes, situations et convergences en L1

**Files:**
- Modify: `src/components/AlertMonitor.ts`, test `src/components/AlertMonitor.test.ts`
- Modify: `src/components/SituationMonitor.ts`, test `src/components/SituationMonitor.test.ts`
- Modify: `src/components/SituationBrief.ts`
- Modify: `src/services/situation-brief.ts`, test `src/services/situation-brief.test.ts`
- Modify: `src/styles/main.css`

**Interfaces:**
- Consumes : `situationLevel`, `maxLevel`, `levelColorVar`, `levelLabel`, `confidenceLabel`, `renderVigilancePill` (tâche 1).

- [ ] **Step 1: Write the failing tests**

Ajouter à la fin de `src/components/AlertMonitor.test.ts` :

```ts
describe('AlertMonitor — langage commun L1', () => {
  it('affiche le niveau en couleur de vigilance et la confiance en mots, sans pourcentage', () => {
    const container = document.createElement('div');
    const monitor = new AlertMonitor(container);
    monitor.update([situation({ severity: 'critical', confidence: 0.93 })]);

    const item = container.querySelector('.sit-mon__item');
    expect(item?.querySelector('.fm-vig--rouge')?.textContent).toBe('Rouge');
    expect(item?.querySelector('.sit-mon__item-conf')?.textContent).toBe('confiance élevée');
    expect(item?.textContent).not.toContain('CRIT');
    expect(item?.textContent).not.toMatch(/\d+\s?%/);

    openDetail(container);
    const detail = document.querySelector('.sit-mon__detail');
    expect(detail?.querySelector('.fm-vig--rouge')).not.toBeNull();
    expect(detail?.textContent).not.toMatch(/\d+\s?%/);
    monitor.destroy();
  });
});
```

Ajouter à la fin de `src/components/SituationMonitor.test.ts` (le fichier définit déjà la fabrique `situation(over)`) :

```ts
describe('SituationMonitor — langage commun L1', () => {
  it('affiche le niveau en couleur de vigilance et la confiance en mots', () => {
    const container = document.createElement('div');
    const monitor = new SituationMonitor(container);
    monitor.update([situation({ severity: 'high', confidence: 0.6 })]);

    const item = container.querySelector('.sit-mon__item');
    expect(item?.querySelector('.fm-vig--orange')?.textContent).toBe('Orange');
    expect(item?.querySelector('.sit-mon__item-conf')?.textContent).toBe('confiance moyenne');
    expect(item?.textContent).not.toContain('ÉLEVÉ');
    monitor.destroy();
  });
});
```

Dans `src/services/situation-brief.test.ts`, remplacer les cas du test « mappe la sévérité vers le libellé français attendu » :

```ts
      ['critical', 'Critique'],
      ['high', 'Élevé'],
      ['medium', 'Moyen'],
      ['watch', 'Veille'],
```

par :

```ts
      ['critical', 'Rouge'],
      ['high', 'Orange'],
      ['medium', 'Jaune'],
      ['watch', 'Jaune'],
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/AlertMonitor.test.ts src/components/SituationMonitor.test.ts src/services/situation-brief.test.ts`
Expected: FAIL. Pastille `.fm-vig--rouge` absente (`null`), confiance « 93% » ; libellé « Critique » au lieu de « Rouge ».

- [ ] **Step 3: `AlertMonitor.ts`**

1. Ajouter les imports :

```ts
import { confidenceLabel, levelColorVar, maxLevel, situationLevel } from '../services/vigilance.ts';
import { renderVigilancePill } from './shared/vigilancePill.ts';
```

2. Supprimer les constantes `SEV_COLOR`, `SEV_LABEL_FR` et `SEV_LABEL_EN`.

3. Dans le rendu de l'en-tête, remplacer :

```ts
    const worstColor = critCount > 0 ? SEV_COLOR.critical : highCount > 0 ? SEV_COLOR.high : SEV_COLOR.medium;
```

par :

```ts
    const worstColor = total > 0
      ? levelColorVar(maxLevel(this.allAlerts.map((s) => situationLevel(s.severity))))
      : 'rgba(255,255,255,0.15)';
```

puis supprimer les lignes `const critCount = …` et `const highCount = …` si elles ne servent plus (le typecheck `noUnusedLocals` le signale).

4. Dans `renderItem`, remplacer :

```ts
    const color = SEV_COLOR[s.severity];
    const sevLabel = this.lang === 'fr' ? SEV_LABEL_FR[s.severity] : SEV_LABEL_EN[s.severity];
    const icon = TYPE_ICON[s.type] ?? fmIcon('triangle-alert');
    const pct = Math.round(s.confidence * 100);
```

par :

```ts
    const level = situationLevel(s.severity);
    const color = levelColorVar(level);
    const icon = TYPE_ICON[s.type] ?? fmIcon('triangle-alert');
```

et :

```ts
            <span class="sit-mon__item-badge" style="color:${color};">${sevLabel}</span>
            <span class="sit-mon__item-conf">${pct}%</span>
```

par :

```ts
            <span class="sit-mon__item-badge">${renderVigilancePill(level, this.lang)}</span>
            <span class="sit-mon__item-conf">${confidenceLabel(s.confidence, this.lang)}</span>
```

5. Dans `showDetail`, remplacer :

```ts
    const color = SEV_COLOR[s.severity];
    const icon = TYPE_ICON[s.type] ?? fmIcon('triangle-alert');
    const sevLabel = this.lang === 'fr' ? SEV_LABEL_FR[s.severity] : SEV_LABEL_EN[s.severity];
    const pct = Math.round(s.confidence * 100);
```

par :

```ts
    const level = situationLevel(s.severity);
    const color = levelColorVar(level);
    const icon = TYPE_ICON[s.type] ?? fmIcon('triangle-alert');
```

et :

```ts
          <span class="sit-mon__detail-badge" style="background:${color};">${sevLabel} · ${pct}%</span>
```

par :

```ts
          <span class="sit-mon__detail-level">${renderVigilancePill(level, this.lang)} <span class="sit-mon__detail-conf">${confidenceLabel(s.confidence, this.lang)}</span></span>
```

- [ ] **Step 4: `SituationMonitor.ts`**

Appliquer les mêmes changements qu'à l'étape 3, dans ce fichier :

1. Mêmes deux imports que ci-dessus.
2. Supprimer `SEV_COLOR`, `SEV_LABEL_FR`, `SEV_LABEL_EN`.
3. Remplacer :

```ts
    const worstColor = critCount > 0 ? SEV_COLOR.critical
      : highCount > 0 ? SEV_COLOR.high
        : total > 0 ? SEV_COLOR.medium
          : 'rgba(255,255,255,0.15)';
```

par :

```ts
    const worstColor = total > 0
      ? levelColorVar(maxLevel(this.allSituations.map((s) => situationLevel(s.severity))))
      : 'rgba(255,255,255,0.15)';
```

et supprimer `critCount` et `highCount` s'ils ne servent plus.

4. Dans `renderItem`, remplacer :

```ts
    const color = SEV_COLOR[s.severity];
    const sevLabel = this.lang === 'fr' ? SEV_LABEL_FR[s.severity] : SEV_LABEL_EN[s.severity];
```

par :

```ts
    const level = situationLevel(s.severity);
    const color = levelColorVar(level);
```

supprimer la ligne `const pct = Math.round(s.confidence * 100);`, et remplacer :

```ts
            <span class="sit-mon__item-badge" style="color:${color};">${sevLabel}</span>
            <span class="sit-mon__item-conf">${pct}%</span>
```

par :

```ts
            <span class="sit-mon__item-badge">${renderVigilancePill(level, this.lang)}</span>
            <span class="sit-mon__item-conf">${confidenceLabel(s.confidence, this.lang)}</span>
```

5. Dans la méthode de détail, remplacer de même `const color = SEV_COLOR[s.severity];` et `const sevLabel = …` par les deux lignes `const level = situationLevel(s.severity);` / `const color = levelColorVar(level);`, supprimer `const pct = …`, et remplacer :

```ts
          <span class="sit-mon__detail-badge" style="background:${color};">${sevLabel} · ${pct}%</span>
```

par :

```ts
          <span class="sit-mon__detail-level">${renderVigilancePill(level, this.lang)} <span class="sit-mon__detail-conf">${confidenceLabel(s.confidence, this.lang)}</span></span>
```

- [ ] **Step 5: Convergences**

Dans `src/services/situation-brief.ts`, ajouter l'import :

```ts
import { levelLabel, situationLevel } from './vigilance.ts';
```

supprimer la constante `SEVERITY_LABEL_FR`, et dans `toBriefItem` remplacer `severityLabel: SEVERITY_LABEL_FR[source.severity],` par `severityLabel: levelLabel(situationLevel(source.severity)),`.

Dans `src/components/SituationBrief.ts`, ajouter l'import :

```ts
import { levelColorVar, situationLevel } from '../services/vigilance.ts';
```

supprimer la constante `SEV_VAR`, et dans `renderItem` remplacer `const color = SEV_VAR[item.severity];` par `const color = levelColorVar(situationLevel(item.severity));`.

- [ ] **Step 6: Styles**

Ajouter à la fin de `src/styles/main.css` :

```css

/* ─── Alertes et situations : niveau L1 et confiance en mots (refonte UI, étape 1) ─── */
.sit-mon__item-badge .fm-vig { font-size: 10px; padding: 0 5px; }
.sit-mon__item-conf { font-size: 10px; color: var(--text-secondary); }
.sit-mon__detail-level { display: inline-flex; align-items: center; gap: 6px; }
.sit-mon__detail-conf { font-size: 11px; color: var(--text-secondary); }
```

Puis retirer les majuscules forcées :

```bash
python3 - <<'EOF'
import re
path = 'src/styles/main.css'
targets = {'.sit-brief__title', '.sit-brief__details', '.sit-brief__chip', '.sit-brief__item-resolved',
           '.sit-mon__title', '.sit-mon__detail-col-title'}
lines = open(path, encoding='utf-8').read().split('\n')
out, sel, removed = [], None, 0
for line in lines:
    m = re.match(r'^([^\s{][^{]*)\{', line)
    if m:
        sel = m.group(1).strip()
    if sel in targets and re.search(r'text-transform:\s*uppercase;?', line):
        stripped = re.sub(r'\s*text-transform:\s*uppercase;?', '', line)
        removed += 1
        if stripped.strip() == '':
            continue
        line = stripped
    out.append(line)
open(path, 'w', encoding='utf-8').write('\n'.join(out))
print('déclarations retirées :', removed)
EOF
```

Expected : `déclarations retirées : 6`.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run && npm run typecheck && npm run lint && npm run build`
Expected: tout vert.

- [ ] **Step 8: Commit**

```bash
git add src/components/AlertMonitor.ts src/components/AlertMonitor.test.ts src/components/SituationMonitor.ts src/components/SituationMonitor.test.ts src/components/SituationBrief.ts src/services/situation-brief.ts src/services/situation-brief.test.ts src/styles/main.css
git commit -m "feat: alertes, situations et convergences en langage commun L1"
```

---

### Task 5: Marchés neutres, jaune au-delà des seuils

**Files:**
- Modify: `src/services/vigilance.ts`, test `src/services/vigilance.test.ts`
- Modify: `src/utils/market-sparkline.ts`
- Create: `src/utils/market-sparkline.test.ts`
- Modify: `src/components/MarketStrip.ts`, `src/components/CommodityStrip.ts`
- Modify: `src/styles/main.css`

**Interfaces:**
- Consumes : tâche 1.
- Produces : `type MarketKind = 'index' | 'energy' | 'other'` ; `type MarketTone = 'neutral' | 'alert'` ; `MARKET_ALERT_THRESHOLD = { index: 3, energy: 5 }` ; `marketTone(changePercent: number, kind: MarketKind): MarketTone` ; `interface MarketMove { name: string; changePercent: number; kind: MarketKind }` ; `marketBarometer(moves: readonly MarketMove[]): { tone: MarketTone; text: string }` ; `buildMarketSparkline(history: number[] | undefined, tone: MarketTone): string`.

- [ ] **Step 1: Write the failing tests**

Ajouter à la fin de `src/services/vigilance.test.ts` (et `marketBarometer, marketTone` à l'import depuis `./vigilance.ts`) :

```ts
describe('marchés (spec §4.4)', () => {
  it('jaune au-delà de ±3 % pour un indice, ±5 % pour le pétrole ou le gaz', () => {
    expect(marketTone(-3, 'index')).toBe('alert');
    expect(marketTone(2.9, 'index')).toBe('neutral');
    expect(marketTone(5.1, 'energy')).toBe('alert');
    expect(marketTone(-4.9, 'energy')).toBe('neutral');
  });

  it('jamais coloré pour les autres lignes ni pour une variation manquante', () => {
    expect(marketTone(12, 'other')).toBe('neutral');
    expect(marketTone(Number.NaN, 'index')).toBe('neutral');
  });

  it('baromètre : neutre en temps normal, exceptionnel au-delà d’un seuil', () => {
    expect(marketBarometer([{ name: 'CAC 40', changePercent: -0.31, kind: 'index' }, { name: 'DAX', changePercent: -0.13, kind: 'index' }]))
      .toEqual({ tone: 'neutral', text: 'Variation moyenne : −0,22 %' });
    expect(marketBarometer([{ name: 'CAC 40', changePercent: -3.42, kind: 'index' }, { name: 'DAX', changePercent: 0.1, kind: 'index' }]))
      .toEqual({ tone: 'alert', text: 'Mouvement exceptionnel : CAC 40 −3,42 %' });
    expect(marketBarometer([])).toEqual({ tone: 'neutral', text: 'Marchés : données indisponibles' });
  });
});
```

Créer `src/utils/market-sparkline.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { buildMarketSparkline } from './market-sparkline.ts';

describe('buildMarketSparkline (marchés neutres, spec §4.4)', () => {
  it('trace en gris par défaut, quel que soit le sens', () => {
    expect(buildMarketSparkline([1, 2, 3], 'neutral')).toContain('stroke="var(--text-muted)"');
  });

  it('trace en jaune un mouvement exceptionnel', () => {
    expect(buildMarketSparkline([3, 2, 1], 'alert')).toContain('stroke="var(--sev-yellow)"');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/vigilance.test.ts src/utils/market-sparkline.test.ts`
Expected: FAIL. `marketTone is not a function` ; le second test de la courbe échoue (`stroke="var(--text-muted)"` au lieu du jaune). Le premier test de la courbe passe déjà : il fige le comportement neutre voulu.

- [ ] **Step 3: Write the implementation**

Ajouter à la fin de `src/services/vigilance.ts` :

```ts
// ─── Marchés (spec §4.4) : neutres, jaune seulement au-delà d'un seuil exceptionnel ─────────

export type MarketKind = 'index' | 'energy' | 'other';
export type MarketTone = 'neutral' | 'alert';

export const MARKET_ALERT_THRESHOLD: Record<Exclude<MarketKind, 'other'>, number> = { index: 3, energy: 5 };

export function marketTone(changePercent: number, kind: MarketKind): MarketTone {
  if (kind === 'other' || !Number.isFinite(changePercent)) return 'neutral';
  return Math.abs(changePercent) >= MARKET_ALERT_THRESHOLD[kind] ? 'alert' : 'neutral';
}

export interface MarketMove {
  name: string;
  changePercent: number;
  kind: MarketKind;
}

function formatSignedPct(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${Math.abs(value).toFixed(2).replace('.', ',')} %`;
}

/** Ligne de synthèse des marchés : le plus fort mouvement exceptionnel, sinon la variation moyenne. */
export function marketBarometer(moves: readonly MarketMove[]): { tone: MarketTone; text: string } {
  const alerts = moves
    .filter((m) => marketTone(m.changePercent, m.kind) === 'alert')
    .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));
  if (alerts.length > 0) {
    const top = alerts[0];
    const more = alerts.length > 1 ? ` (+${alerts.length - 1})` : '';
    return { tone: 'alert', text: `Mouvement exceptionnel : ${top.name} ${formatSignedPct(top.changePercent)}${more}` };
  }
  const finite = moves.filter((m) => Number.isFinite(m.changePercent));
  if (finite.length === 0) return { tone: 'neutral', text: 'Marchés : données indisponibles' };
  const avg = finite.reduce((sum, m) => sum + m.changePercent, 0) / finite.length;
  return { tone: 'neutral', text: `Variation moyenne : ${formatSignedPct(avg)}` };
}
```

Dans `src/utils/market-sparkline.ts`, remplacer :

```ts
import type { CommodityData, MarketData } from '../types/index.ts';

type Trend = MarketData['trend'] | CommodityData['trend'];

export function buildMarketSparkline(history: number[] | undefined, trend: Trend): string {
```

par :

```ts
import type { MarketTone } from '../services/vigilance.ts';

/** Courbe neutre ; jaune seulement pour un mouvement exceptionnel (spec refonte UI §4.4). */
export function buildMarketSparkline(history: number[] | undefined, tone: MarketTone): string {
```

et :

```ts
  const stroke =
    trend === 'up' ? 'var(--threat-low)' :
    trend === 'down' ? 'var(--threat-high)' :
    'var(--text-muted)';
```

par :

```ts
  const stroke = tone === 'alert' ? 'var(--sev-yellow)' : 'var(--text-muted)';
```

Dans `src/components/MarketStrip.ts` :

1. Ajouter l'import :

```ts
import { marketBarometer, marketTone, type MarketKind } from '../services/vigilance.ts';
```

2. Ajouter, avant la classe :

```ts
/** Seuls les indices ont un seuil exceptionnel ; devises et actions restent toujours neutres. */
function marketKindForSection(section: string): MarketKind {
  return section === 'indices' ? 'index' : 'other';
}
```

3. Dans `update`, remplacer le bloc `const avgChange = …` jusqu'à la fin du `if (this.barometerDotEl && this.barometerTextEl) { … }` par :

```ts
    const barometer = marketBarometer(items.map((item) => ({
      name: item.name,
      changePercent: item.changePercent,
      kind: marketKindForSection(item.category ?? CATEGORY_FALLBACK),
    })));
    if (this.barometerDotEl && this.barometerTextEl) {
      const color = barometer.tone === 'alert' ? 'var(--sev-yellow)' : 'var(--text-muted)';
      this.barometerDotEl.style.background = color;
      this.barometerDotEl.style.boxShadow = 'none';
      this.barometerTextEl.textContent = barometer.text;
      this.barometerTextEl.style.color = color;
    }
```

4. Dans la boucle des tuiles, remplacer :

```ts
        const trendClass =
          item.trend === 'up' ? 'is-up' :
          item.trend === 'down' ? 'is-down' :
          'is-flat';

        const card = document.createElement('article');
        card.className = `market-strip__item ${trendClass}`;
```

par :

```ts
        const tone = marketTone(item.changePercent, marketKindForSection(item.category ?? CATEGORY_FALLBACK));

        const card = document.createElement('article');
        card.className = `market-strip__item is-${tone}`;
```

et `${buildMarketSparkline(item.history, item.trend)}` par `${buildMarketSparkline(item.history, tone)}`.

Dans `src/components/CommodityStrip.ts` :

1. Ajouter l'import :

```ts
import { marketTone } from '../services/vigilance.ts';
```

2. Remplacer :

```ts
      const trendClass =
        item.trend === 'up'   ? 'is-up' :
        item.trend === 'down' ? 'is-down' :
        'is-flat';

      const card = document.createElement('article');
      card.className = `market-strip__item ${trendClass}`;
```

par :

```ts
      // Pétrole et gaz : seuil de ±5 % ; métaux et produits agricoles toujours neutres.
      const tone = marketTone(item.changePercent, item.category === 'energy' ? 'energy' : 'other');

      const card = document.createElement('article');
      card.className = `market-strip__item is-${tone}`;
```

et `${buildMarketSparkline(item.history, item.trend)}` par `${buildMarketSparkline(item.history, tone)}`.

Dans `src/styles/main.css`, retirer les règles de tendance colorées et ajouter les nouvelles :

```bash
python3 - <<'EOF'
import re
path = 'src/styles/main.css'
css = open(path, encoding='utf-8').read()
css, n = re.subn(r'\.market-strip__item\.is-(?:up|down|flat)(?:\s+\.market-strip__delta)?\s*\{[^}]*\}\n?', '', css)
css = css.rstrip('\n') + '''

/* ─── Marchés neutres (refonte UI, spec §4.4) : jaune seulement au-delà d'un seuil ─── */
.market-strip__item.is-neutral .market-strip__delta { color: var(--text-secondary); }
.market-strip__item.is-alert { border-color: rgba(255, 204, 0, 0.35); }
.market-strip__item.is-alert .market-strip__delta { color: var(--sev-yellow); }
'''
open(path, 'w', encoding='utf-8').write(css)
print('règles de tendance retirées :', n)
EOF
```

Expected : `règles de tendance retirées : 5`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run && npm run typecheck && npm run lint && npm run build`
Expected: tout vert.

- [ ] **Step 5: Commit**

```bash
git add src/services/vigilance.ts src/services/vigilance.test.ts src/utils/market-sparkline.ts src/utils/market-sparkline.test.ts src/components/MarketStrip.ts src/components/CommodityStrip.ts src/styles/main.css
git commit -m "feat: marchés neutres, jaune seulement au-delà de ±3 % (indices) et ±5 % (énergie)"
```

---

### Task 6: Entités HTML du flux d'actualités et confiance en mots

**Files:**
- Modify: `api/_lib/parse-rss.js` (`decodeHtmlEntities`)
- Test: `tests/ingest.test.ts`
- Modify: `api/_handlers/news.js` (`mapNewsRow`)
- Test: `tests/news-api.test.ts`
- Modify: `src/plugins/rss-json-proxy.ts` (copie de dev de `decodeHtmlEntities`)
- Modify: `src/components/UnderMapNewsFeed.ts`, `src/locales/fr.ts`, `src/locales/en.ts`

**Interfaces:**
- Consumes : `confidenceBand` (tâche 1).
- Produces : `decodeHtmlEntities(text: string): string` qui décode aussi les entités numériques, y compris doublement encodées.

- [ ] **Step 1: Write the failing tests**

Dans `tests/ingest.test.ts`, remplacer l'import :

```ts
import { parseRssXml, detectSourceFormat } from '../api/_lib/parse-rss.js';
```

par :

```ts
import { parseRssXml, detectSourceFormat, decodeHtmlEntities } from '../api/_lib/parse-rss.js';
```

et ajouter à la fin du fichier :

```ts
describe('decodeHtmlEntities (bug « d&#039;anciennes », refonte UI étape 1)', () => {
  it('décode les entités numériques, y compris doublement encodées', () => {
    assert.equal(decodeHtmlEntities('la famille et d&amp;#039;anciennes petites amies'), "la famille et d'anciennes petites amies");
    assert.equal(decodeHtmlEntities('Proc&#xE8;s &#224; Lyon'), 'Procès à Lyon');
  });

  it('remplace une entité hors plage sans lever ni produire de caractère NUL', () => {
    assert.equal(decodeHtmlEntities('a&#0;b&#99999999;c'), 'a�b�c');
  });
});
```

Ajouter à la fin de `tests/news-api.test.ts` :

```ts
describe('mapNewsRow — entités restées dans les lignes déjà stockées', () => {
  it('décode le titre et le résumé', () => {
    const item = mapNewsRow({
      id: 1, feed_id: 'la-depeche', feed_name: 'La Dépêche', feed_region: null, tier: 3,
      title: 'Proc&#xE8;s en appel', link: 'https://example.fr/a',
      description: 'la famille et d&#039;anciennes petites amies',
      published_at: '2026-09-22T06:00:00Z', collected_at: '2026-09-22T06:05:00Z',
      category: 'security', severity: 'high', confidence: 0.9, lat: null, lon: null, classifier_version: 'kw-1',
    });
    expect(item.title).toBe('Procès en appel');
    expect(item.description).toBe("la famille et d'anciennes petites amies");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/ingest.test.ts tests/news-api.test.ts`
Expected: FAIL. `d&#039;anciennes` reste tel quel, `Proc&#xE8;s` n'est pas décodé.

- [ ] **Step 3: Write the implementation**

Dans `api/_lib/parse-rss.js`, remplacer :

```js
export function decodeHtmlEntities(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/<[^>]+>/g, '');
}
```

par :

```js
export function decodeHtmlEntities(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // Entités numériques APRÈS &amp; : les flux doublement encodés (&amp;#039;) sont décodés.
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(Number(dec)))
    .replace(/<[^>]+>/g, '');
}

/**
 * Caractère d'une entité numérique. Hors plage (0, demi-substituts, > U+10FFFF) → U+FFFD :
 * fromCodePoint lèverait, et Postgres refuse le NUL.
 * @param {number} code
 * @returns {string}
 */
function safeCodePoint(code) {
  if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '�';
  return String.fromCodePoint(code);
}
```

Dans `api/_handlers/news.js`, ajouter l'import juste après `import { neon } from '@neondatabase/serverless';` :

```js
import { decodeHtmlEntities } from '../_lib/parse-rss.js';
```

ajouter après la fonction `toStringOrNull` :

```js
/**
 * Texte d'article : décode les entités restées dans les lignes stockées avant la correction de
 * decodeHtmlEntities (rétention 90 jours).
 * @param {unknown} value
 * @returns {string | null}
 */
function toDecodedTextOrNull(value) {
  if (value === null || value === undefined) return null;
  return decodeHtmlEntities(String(value));
}
```

et, dans `mapNewsRow`, remplacer :

```js
    title: toStringOrNull(row.title),
```

par :

```js
    title: toDecodedTextOrNull(row.title),
```

et :

```js
    description: toStringOrNull(row.description),
```

par :

```js
    description: toDecodedTextOrNull(row.description),
```

Dans `src/plugins/rss-json-proxy.ts` (copie de dev), remplacer le corps de `decodeHtmlEntities` par le même traitement :

```ts
function decodeHtmlEntities(text: string): string {
  const safeCodePoint = (code: number): string =>
    (!Number.isInteger(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))
      ? '�'
      : String.fromCodePoint(code);
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => safeCodePoint(Number(dec)))
    .replace(/<[^>]+>/g, '');
}
```

Dans `src/locales/fr.ts`, dans le bloc `newsFeed`, remplacer :

```ts
    sourceLabels: {
      llm: 'LLM',
      ml: 'IA',
      keyword: 'Règles',
    },
```

par :

```ts
    sourceLabels: {
      llm: 'LLM',
      ml: 'IA',
      keyword: 'Mots-clés',
    },
    confidenceLabels: {
      high: 'confiance élevée',
      moderate: 'confiance moyenne',
      low: 'confiance faible',
    },
```

Dans `src/locales/en.ts`, bloc `newsFeed`, remplacer :

```ts
    sourceLabels: {
      llm: 'LLM',
      ml: 'AI',
      keyword: 'Rules',
    },
```

par :

```ts
    sourceLabels: {
      llm: 'LLM',
      ml: 'AI',
      keyword: 'Keywords',
    },
    confidenceLabels: {
      high: 'high confidence',
      moderate: 'moderate confidence',
      low: 'low confidence',
    },
```

Dans `src/components/UnderMapNewsFeed.ts`, ajouter l'import :

```ts
import { confidenceBand } from '../services/vigilance.ts';
```

et remplacer :

```ts
    const confidenceLabel = item.threat?.confidence != null
      ? `${Math.round(item.threat.confidence * 100)}%`
      : null;
```

par :

```ts
    const confidenceLabel = item.threat?.confidence != null
      ? t(`newsFeed.confidenceLabels.${confidenceBand(item.threat.confidence)}`)
      : null;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run && npm run typecheck && npm run lint && npm run build && node scripts/check-generated.mjs`
Expected: tout vert ; `check-generated` confirme qu'aucun fichier généré n'est périmé (`parse-rss.js` n'est pas généré).

- [ ] **Step 5: Commit**

```bash
git add api/_lib/parse-rss.js tests/ingest.test.ts api/_handlers/news.js tests/news-api.test.ts src/plugins/rss-json-proxy.ts src/components/UnderMapNewsFeed.ts src/locales/fr.ts src/locales/en.ts
git commit -m "fix: entités HTML numériques décodées dans le flux d'actualités, confiance en mots"
```

---

### Task 7: Vérification navigateur et critères de la spec

**Files:**
- Aucun fichier du dépôt. Script dans le dossier de travail de la session (non versionné).

- [ ] **Step 1: Écrire le script de contrôle**

Créer `$SCRATCH/cdp-langage.mjs` (`$SCRATCH` = dossier temporaire de la session) :

```js
// cdp-langage.mjs — contrôle navigateur de l'étape 1 (langage commun). Chrome sans interface.
// Usage : node cdp-langage.mjs <largeur> <hauteur> <tag>   (vite doit tourner sur :3017)
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const [,, W = '1440', H = '900', TAG = 'desk'] = process.argv;
const PORT = 9371;
const profile = `/tmp/fm-langage-${TAG}`;
rmSync(profile, { recursive: true, force: true });
mkdirSync(profile, { recursive: true });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--window-size=${W},${H}`, 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 100; i += 1) {
  try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch { /* Chrome démarre */ }
  await sleep(150);
}
const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((ok) => { ws.onopen = ok; });
let seq = 0;
const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
const shot = async (name) => { const s = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(name, Buffer.from(s.result.data, 'base64')); };

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: +W, height: +H, deviceScaleFactor: 1, mobile: +W < 600 });
await send('Page.navigate', { url: 'http://localhost:3017/?view=app#live' });
await sleep(20000);
await evaluate(`document.dispatchEvent(new CustomEvent('open-france-intel')); true`);
await sleep(25000);

console.log('état', await evaluate(`(() => {
  const text = (document.querySelector('.frintel-drawer')?.innerText ?? '') + (document.querySelector('.sit-mon')?.innerText ?? '');
  const forbidden = ['SIT-0', 'SIT-1', 'CONF 0', 'moteur 10 règles', 'Country Intelligence', 'SOUS TENSION', 'DÉGRADÉ', 'CRIT '].filter((s) => text.includes(s));
  const missing = ['.fi-changes-body', '.fi-brief-body', '.fi-events-body', '.fi-infra-widget-slot', '.frintel-dom-grid', '.frintel-timeline-row', '.frintel-why'].filter((s) => !document.querySelector(s));
  return JSON.stringify({
    forbidden,
    missing,
    pills: document.querySelectorAll('.fm-vig').length,
    whyOpen: !!document.querySelector('.frintel-why[open]'),
    percentInAlerts: /\\d+\\s?%/.test([...document.querySelectorAll('.sit-mon__item-conf')].map((n) => n.textContent).join(' ')),
  });
})()`));

await evaluate(`(() => { const s = document.querySelector('.frintel-why > summary'); s?.focus(); s?.click(); return true; })()`);
await sleep(3000);
console.log('volet après 3 s', await evaluate(`JSON.stringify({ open: !!document.querySelector('.frintel-why[open]'), focusOnSummary: document.activeElement?.matches?.('.frintel-why > summary') ?? false })`));
await shot(`langage-${TAG}.png`);

await evaluate(`[...document.querySelectorAll('button')].find((b) => /modules/i.test(b.textContent ?? ''))?.click(); true`);
await sleep(8000);
console.log('marchés', await evaluate(`JSON.stringify({
  oldTrend: document.querySelectorAll('.market-strip__item.is-up, .market-strip__item.is-down').length,
  tiles: document.querySelectorAll('.market-strip__item').length,
  alert: document.querySelectorAll('.market-strip__item.is-alert').length,
  barometer: document.querySelector('.market-barometer-text')?.textContent ?? null,
})`));

chrome.kill();
process.exit(0);
```

- [ ] **Step 2: Lancer le dev et les contrôles**

```bash
(DATABASE_URL= GROQ_API_KEY= nohup npx vite --port 3017 --strictPort > "$SCRATCH/vite-langage.log" 2>&1 &)
for i in $(seq 1 60); do curl -s -o /dev/null http://localhost:3017/ && break; sleep 1; done
cd "$SCRATCH" && node cdp-langage.mjs 1440 900 desk && node cdp-langage.mjs 390 844 mob
pkill -f "vite --port 3017"
```

Expected, pour chaque largeur :
- `forbidden: []` et `missing: []` : aucun code du moteur, et aucune section du tiroir retirée (spec §14) ;
- `pills` > 0, `whyOpen: false` à l'ouverture, `percentInAlerts: false` ;
- `volet après 3 s` : `{"open":true,"focusOnSummary":true}` malgré les reconstructions ;
- `marchés` : `oldTrend: 0` ; si `tiles` > 0, `barometer` commence par « Variation moyenne », « Mouvement exceptionnel » ou « Marchés ».

Si le brief n'est pas encore affiché au moment de la capture, relancer : le chargement à froid en dev peut dépasser 25 s sur une machine chargée.

- [ ] **Step 3: Regarder les captures**

Ouvrir `langage-desk.png` et `langage-mob.png`. Attendu : pastille de niveau en tête du tiroir avec sa phrase et « tirée par … », aucun nombre hors du volet, pastilles L1 dans les alertes, aucun texte qui déborde à 390 px.

- [ ] **Step 4: Gate final**

Run: `npx vitest run && npm run typecheck && npm run lint && npm run build && node scripts/check-generated.mjs`
Expected: tout vert.

Aucun commit dans cette tâche : elle vérifie les tâches 1 à 6.
