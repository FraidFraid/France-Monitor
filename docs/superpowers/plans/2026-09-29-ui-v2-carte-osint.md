# Refonte v2 « carte d'abord » — plan d'implémentation

> **Pour les agents :** sous-compétence REQUISE : superpowers:subagent-driven-development (recommandé) ou superpowers:executing-plans pour exécuter ce plan tâche par tâche. Les étapes utilisent des cases (`- [ ]`) pour le suivi.

**Objectif :** faire de la v2 (`?ui=v2`) un outil OSINT propre et clair : fil à gauche, carte au centre (événements + vigilances), onglet État de la France à droite par défaut, rien d'ouvert d'office, rien de périmé présenté comme actuel.

**Architecture :** on garde la structure v2 existante (`PosteSituation` + `WorkList` + `FichePanel` + carte d'`App`). Les règles nouvelles vivent dans de petits modules purs testés (`v2-map.ts`, `departement-lookup.ts`, `freshness.ts`, ajouts à `ui-mode.ts`, `layer-presets.ts`, `work-queue.ts`, `fiche/france.ts`) ; `App.ts`, `DeckGLMap.ts` et `main.css` ne reçoivent que le câblage, toujours conditionné à la v2.

**Pile :** TypeScript strict, DOM natif, Vite, MapLibre + Deck.gl, Vitest (happy-dom pour les composants).

**Spec :** `docs/superpowers/specs/2026-09-29-ui-v2-carte-osint-design.md` (à lire avant de commencer).

## Contraintes globales

- TypeScript strict, aucun `any`, DOM natif (pas de framework), aucune nouvelle dépendance npm.
- Tout changement de comportement est conditionné à la v2 (`this.uiV2` dans `App.ts`, `#app.ui-v2` en CSS) ; la v1 ne change pas, sauf mention explicite.
- Interface en français ; libellés anglais fournis quand le code a déjà une bascule `lang`.
- Couleurs de niveau uniquement par `src/services/vigilance.ts` (`levelHex`, `renderVigilancePill`) ; aucune autre couleur vive.
- Ne jamais modifier les fixtures du score (`france-country-intel.test.ts`).
- Branche `feat/ui-disposition-a1`. Messages de commit `feat(v2): …` ou `fix(v2): …`, terminés par une ligne vide puis les lignes `Co-Authored-By:` et `Claude-Session:` données par l'environnement.
- Fin de chaque tâche : `npm run typecheck`, `npx vitest run`, `npm run build`, puis contrôle visuel (étape dédiée) avant le commit.
- Contrôle visuel : `npm run dev` (port 3001) puis `PLAYWRIGHT_MODULE=<chemin d'un playwright du poste, cache npx> node scripts/ui-screenshots.mjs` ; lire les deux captures produites dans `.superpowers/screens/` et vérifier la grille du § 3 de la spec : rien de superposé, rien d'ouvert d'office, un seul indicateur de niveau, rien de périmé présenté comme actuel, aucun texte coupé.

## Points de vigilance (non couverts par la spec, tests ajoutés aux tâches)

1. **Événement sans coordonnées ou en outre-mer** (hors des 96 polygones métropolitains) : aucun point sur la carte, lieu « France » sans coordonnées, aucun lieu (jamais « undefined ») hors polygones — tests en tâches 2, 5 et 6.
2. **Première visite** (ancre `default`) : aucune étiquette sur aucune ligne — test en tâche 6.
3. **Stockage de session inaccessible** (navigation privée stricte) : pas d'exception, la carte démarre sur les couches de démarrage — test en tâche 3.
4. **Note absente, déterministe ou périmée** : « en cours de préparation », jamais « indisponible » ; une note périmée est grisée avec sa date — tests en tâches 7 et 8.
5. **Panneau Santé demandé avant l'arrivée des données** : il affiche le chargement puis se remplit (le rafraîchissement d'un panneau déjà visible compte comme explicite) — test du prédicat en tâche 1, vérifié à l'écran à l'étape visuelle de la tâche 1.

## Fichiers

| Fichier | Rôle | Tâches |
|---|---|---|
| `src/services/ui-mode.ts` (+ test) | `opensModulePanel`, `layerStateStorage`, `legendStatusLabel`, bascule par défaut | 1, 3, 8, 10 |
| `src/config/layer-presets.ts` (+ test) | `v2StartupLayers`, `themeLayers` | 3 |
| `src/services/v2-map.ts` (+ test, nouveau) | points d'événements, tronçons Vigicrues, opacités des vigilances | 2, 4 |
| `src/services/departement-lookup.ts` (+ test, nouveau) | département d'un point, nom d'un code | 5 |
| `src/services/work-queue.ts` (+ test) | étranger, étiquettes, tri, lieu, heure | 2, 6, 8 |
| `src/components/poste/WorkList.ts` (+ test) | ligne à trois éléments, une étiquette, « Hors de France » | 6 |
| `src/components/poste/PosteSituation.ts` (+ test) | Échap partout, État par défaut, départements, méta de la note | 1, 6, 7 |
| `src/components/fiche/parts.ts` (+ test) | `whyFirst`, `renderChangeRows` | 7 |
| `src/components/fiche/france.ts` (+ test) | onglet État de la France | 7, 8 |
| `src/services/freshness.ts` (+ test, nouveau) | délais, `freshnessOf`, `partitionByFreshness`, `dataDateLabel` | 8 |
| `src/components/NationalHealthPanel.ts` | « Alertes du moment » sans les alertes périmées | 8 |
| `src/components/BarometerWidget.ts` | option `briefing: false` | 7 |
| `src/components/DeckGLMap.ts`, `src/components/MapContainer.ts` | couche Événements, vigilances allégées, bouton explicite | 1, 2, 4 |
| `src/types/index.ts` | clé `events` de `MapLayers` | 2 |
| `src/components/LayerPanel.ts` | entrée « Événements en cours » | 2 |
| `src/App.ts` | câblage (tout conditionné à `uiV2`) | 1–4, 6–10 |
| `src/styles/main.css` | largeurs, panneaux dans la zone carte, en-tête, fil | 1, 6, 9 |
| `scripts/ui-screenshots.mjs` (nouveau) | captures de contrôle | 1 |

---

### Tâche 1 : rien ne s'ouvre d'office, panneaux dans la zone carte, Échap partout

**Fichiers :**
- Modifier : `src/services/ui-mode.ts`, `src/services/ui-mode.test.ts`
- Modifier : `src/App.ts` (écouteur `open-national-health`, `showFloatingPanel`, branche santé de `_handlePanelVisibility`, fin de `loadHealth`)
- Modifier : `src/components/DeckGLMap.ts` (bouton « Voir les indicateurs nationaux »)
- Modifier : `src/components/poste/PosteSituation.ts`, `src/components/poste/PosteSituation.test.ts`
- Modifier : `src/styles/main.css`
- Créer : `scripts/ui-screenshots.mjs`

**Interfaces :**
- Produit : `opensModulePanel(uiV2: boolean, detail: unknown): boolean` ; variables CSS `--v2-list-w` (320px) et `--v2-fiche-w` (420px) sur `#app.ui-v2`.

- [ ] **Étape 1 : test du prédicat**

Ajouter à `src/services/ui-mode.test.ts` (compléter l'import : `opensModulePanel`) :

```ts
describe('opensModulePanel (spec 2026-09-29 § 4)', () => {
  it('v1 : tout déclencheur ouvre le panneau, comme avant', () => {
    expect(opensModulePanel(false, undefined)).toBe(true);
    expect(opensModulePanel(false, { explicit: false })).toBe(true);
  });

  it('v2 : seule une demande explicite de l’analyste ouvre le panneau', () => {
    expect(opensModulePanel(true, { explicit: true })).toBe(true);
    expect(opensModulePanel(true, { explicit: false })).toBe(false);
    expect(opensModulePanel(true, undefined)).toBe(false);
    expect(opensModulePanel(true, null)).toBe(false);
    expect(opensModulePanel(true, 'explicit')).toBe(false);
  });
});
```

- [ ] **Étape 2 : vérifier l'échec** — `npx vitest run src/services/ui-mode.test.ts` → échec (`opensModulePanel` n'existe pas).

- [ ] **Étape 3 : implémenter** — ajouter à la fin de `src/services/ui-mode.ts` :

```ts
/**
 * v2 (spec 2026-09-29 § 4) : un panneau de module ne s'ouvre que sur une demande explicite de
 * l'analyste (sélecteur de panneaux, « Voir les indicateurs » d'une bulle de la carte), jamais au
 * chargement ni à l'activation d'une couche. Le déclencheur le dit par `detail.explicit === true`.
 * v1 : inchangé, tout déclencheur ouvre le panneau.
 */
export function opensModulePanel(uiV2: boolean, detail: unknown): boolean {
  if (!uiV2) return true;
  return typeof detail === 'object' && detail !== null && (detail as { explicit?: unknown }).explicit === true;
}
```

- [ ] **Étape 4 : vérifier le succès** — `npx vitest run src/services/ui-mode.test.ts` → tout passe.

- [ ] **Étape 5 : câbler `App.ts`**

1. Importer `opensModulePanel` depuis `./services/ui-mode.ts` (à côté des imports existants de ce module).
2. Ajouter le champ, près de `currentFloatingPanelId` :

```ts
  /** Vrai pendant une ouverture demandée par l'analyste (sélecteur de panneaux) — spec 2026-09-29 § 4. */
  private explicitPanelRequest = false;
```

3. Écouteur (chercher `this.addGlobalListener(document, 'open-national-health', () => {`) : remplacer la première ligne par

```ts
    this.addGlobalListener(document, 'open-national-health', (e) => {
      // v2 : jamais d'ouverture d'office (chargement, activation de couche), seulement à la demande.
      if (!opensModulePanel(this.uiV2, (e as CustomEvent<unknown>).detail)) return;
```

4. `showFloatingPanel` (chercher `private showFloatingPanel(id: keyof MapLayers): void {`) : entourer l'appel à `_handlePanelVisibility` :

```ts
  private showFloatingPanel(id: keyof MapLayers): void {
    this.hideAllFloatingPanels(id);
    this.explicitPanelRequest = true;
    try {
      this._handlePanelVisibility(id, true);
    } finally {
      this.explicitPanelRequest = false;
    }
    this.currentFloatingPanelId = id;
    this.refreshFloatingPanelSwitcher();
  }
```

5. Branche santé de `_handlePanelVisibility` (chercher `if (enabled && anyHealthActive) {` suivi de `document.dispatchEvent(new CustomEvent('open-national-health'));`) : remplacer l'émission par

```ts
        document.dispatchEvent(new CustomEvent('open-national-health', { detail: { explicit: this.explicitPanelRequest } }));
```

6. Fin de `loadHealth` (chercher `if (hasData && anyHealthActive) {`) : remplacer l'émission par

```ts
      // Un panneau déjà ouvert à la demande (chargement affiché) se remplit : c'est la même demande.
      document.dispatchEvent(new CustomEvent('open-national-health', { detail: { explicit: this.nationalHealthPanel?.isVisible() === true } }));
```

L'émission de `ensureHealthPanels()` (sans `detail`) reste telle quelle : en v2 elle est ignorée, en v1 inchangée.

- [ ] **Étape 6 : bouton explicite de la carte** — dans `src/components/DeckGLMap.ts`, chercher `onclick="document.dispatchEvent(new CustomEvent('open-national-health'))"` et remplacer l'attribut par

```html
onclick="document.dispatchEvent(new CustomEvent('open-national-health', { detail: { explicit: true } }))"
```

- [ ] **Étape 7 : test Échap partout**

Ajouter à `src/components/poste/PosteSituation.test.ts` :

```ts
describe('Échap partout (spec 2026-09-29 § 4)', () => {
  it('ramène à l’État même quand le focus est sur la carte', () => {
    const { roots, poste } = setup();
    poste.select('event:42');
    expect(ficheKey(roots)).toBe('event:42');
    const map = document.createElement('div');
    map.tabIndex = 0;
    document.body.appendChild(map);
    map.focus();
    map.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(ficheKey(roots)).toBe('france');
  });

  it('laisse Échap aux champs de saisie', () => {
    const { roots, poste } = setup();
    poste.select('event:42');
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(ficheKey(roots)).toBe('event:42');
  });
});
```

- [ ] **Étape 8 : vérifier l'échec** — `npx vitest run src/components/poste/PosteSituation.test.ts` → le premier test échoue (Échap depuis la carte ne ferme rien).

- [ ] **Étape 9 : implémenter** — dans `PosteSituation.ts`, ajouter avant la classe :

```ts
/** Champ de saisie : Échap y garde son sens (effacer, fermer une liste déroulante). */
function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
}
```

et remplacer, dans le constructeur, le bloc `// Échap referme la fiche (spec §9)…` jusqu'à `roots.fiche.addEventListener('keydown', onEscape);` par

```ts
    // Échap ramène à l'État où que soit le focus — liste, fiche ou carte (spec 2026-09-29 § 4) —,
    // sauf dans un champ de saisie.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || this.selection === null || isTypingTarget(e.target)) return;
      e.preventDefault();
      this.close();
    });
```

- [ ] **Étape 10 : vérifier le succès** — `npx vitest run src/components/poste/` → tout passe.

- [ ] **Étape 11 : CSS** — ajouter à la FIN de `src/styles/main.css` :

```css
/* ═══ Refonte v2 « carte d'abord » (spec 2026-09-29) ═══ */
#app.ui-v2 { --v2-list-w: 320px; --v2-fiche-w: 420px; }
@media (min-width: 1101px) {
  #app.ui-v2 .fm-v2-list { flex: 0 0 var(--v2-list-w); min-width: 0; max-width: none; }
  #app.ui-v2 .fm-v2-fiche { flex: 0 0 var(--v2-fiche-w); min-width: 0; max-width: none; }
  /* Panneaux de module : dans la zone de la carte, jamais sur le fil ni sur l'État (§ 4). */
  #app.ui-v2 .cyber-panel-modal,
  #app.ui-v2 .defense-panel-modal,
  #app.ui-v2 .energy-panel-modal,
  #app.ui-v2 .environment-panel-modal,
  #app.ui-v2 .fires-panel-modal,
  #app.ui-v2 .gas-panel-modal,
  #app.ui-v2 .nuclear-panel-modal,
  #app.ui-v2 .oil-panel-modal,
  #app.ui-v2 .fm-floating-panel {
    left: auto !important;
    right: calc(var(--v2-fiche-w) + 16px) !important;
    max-width: calc(100vw - var(--v2-list-w) - var(--v2-fiche-w) - 32px) !important;
  }
  /* Tiroir Couches : par-dessus la carte seulement, contre le fil (§ 4). */
  #app.ui-v2 .sidebar {
    position: absolute; top: 0; bottom: 0; left: var(--v2-list-w); z-index: 20;
    box-shadow: 4px 0 16px rgba(0, 0, 0, 0.35);
  }
}
```

- [ ] **Étape 12 : script de captures** — créer `scripts/ui-screenshots.mjs` :

```js
#!/usr/bin/env node
// scripts/ui-screenshots.mjs — captures de contrôle de la v2 (spec 2026-09-29 § 9) : Chrome sans
// interface, 1 600 × 1 000 et 390 × 844, après 25 s de chargement, dans un contexte neuf (nouvelle
// visite). Playwright n'est pas une dépendance du projet : PLAYWRIGHT_MODULE désigne un playwright
// déjà présent sur le poste, CHROME_PATH le Chrome installé.
//   PLAYWRIGHT_MODULE=/…/node_modules/playwright/index.mjs node scripts/ui-screenshots.mjs [url] [dossier]
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const url = process.argv[2] ?? 'http://localhost:3001/?ui=v2';
const outDir = process.argv[3] ?? '.superpowers/screens';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const executablePath = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T-]/g, '');
const browser = await chromium.launch({ executablePath, headless: true });
try {
  for (const [name, width, height] of [['bureau', 1600, 1000], ['telephone', 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(25_000);
    const file = path.join(outDir, `${stamp}-${name}.png`);
    await page.screenshot({ path: file });
    console.log(file);
    await page.close();
  }
} finally {
  await browser.close();
}
```

- [ ] **Étape 13 : vérifications** — `npm run typecheck`, `npx vitest run`, `npm run build` → tout passe.

- [ ] **Étape 14 : contrôle visuel** — captures (voir Contraintes globales). Attendu : aucun panneau Santé ouvert au chargement. Le bouton Couches ouvre le tiroir par-dessus la carte, contre le fil, sans déplacer le fil ni l'État. Puis, dans un navigateur, activer la couche Santé depuis Couches (aucun panneau ne s'ouvre), ouvrir le panneau par le sélecteur de panneaux (il s'ouvre dans la zone carte, à gauche de l'État, affiche le chargement puis se remplit), cliquer une ligne du fil puis cliquer sur la carte et taper Échap (retour à l'État).

- [ ] **Étape 15 : commit**

```bash
git add src/services/ui-mode.ts src/services/ui-mode.test.ts src/App.ts src/components/DeckGLMap.ts \
  src/components/poste/PosteSituation.ts src/components/poste/PosteSituation.test.ts src/styles/main.css scripts/ui-screenshots.mjs
git commit -m "fix(v2): rien ne s'ouvre d'office, panneaux dans la zone carte, Échap partout"
```

---

### Tâche 2 : couche Événements

**Fichiers :**
- Modifier : `src/types/index.ts` (`MapLayers`), `src/App.ts` (`DEFAULT_LAYERS`, `LAYER_CONFIGS`, `normalizeLayerState`, `_syncGroupFlags`, câblage), `src/components/LayerPanel.ts`
- Modifier : `src/services/work-queue.ts` (exporter `eventEnters`)
- Créer : `src/services/v2-map.ts`, `src/services/v2-map.test.ts`
- Modifier : `src/components/DeckGLMap.ts`, `src/components/MapContainer.ts`

**Interfaces :**
- Consomme : `eventEnters(e: NewsEvent): boolean` (work-queue, exporté ici), `eventDisplayLevel`, `unconfirmedPeakLevel`, `levelHex` (vigilance), `categoryTheme`, `inTheme` (themes).
- Produit : `interface EventMapPoint { id: number; title: string; lon: number; lat: number; level: VigilanceLevel; radius: 5 | 8 | 12; hollow: boolean; color: [number, number, number] }` ; `eventMapPoints(events: readonly NewsEvent[], theme: ThemeId): EventMapPoint[]` ; `sourcesRadius(n: number): 5 | 8 | 12` ; `MapContainer.setEventPoints(points)`, `MapContainer.setOnEventPointClick(handler)` ; clé `events` de `MapLayers`.

- [ ] **Étape 1 : tests**

Créer `src/services/v2-map.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { eventMapPoints, sourcesRadius } from './v2-map.ts';
import type { NewsEvent } from '../types/index.ts';

function event(over: Partial<NewsEvent> = {}): NewsEvent {
  const id = over.id ?? 1;
  return {
    id, evidenceId: `E${id}`, title: 'Grève dans les transports lyonnais', category: 'social', severity: 'medium',
    status: 'active', firstSeen: '2026-09-29T06:00:00Z', lastSeen: '2026-09-29T07:00:00Z', articleCount: 4,
    sourceCount: 4, independentCount: 3, sourceNames: [], lat: 45.76, lon: 4.84, zone: 'france', ...over,
  };
}

describe('eventMapPoints (spec 2026-09-29 § 5)', () => {
  it('un point par événement de la liste : couleur du niveau, taille selon les sources', () => {
    const [p] = eventMapPoints([event()], 'general');
    expect(p).toMatchObject({ id: 1, level: 'jaune', radius: 8, hollow: false, lon: 4.84, lat: 45.76 });
    expect(p.color).toEqual([255, 204, 0]);
  });

  it('ni sans coordonnées, ni à l’étranger, ni clos, ni hors de la liste', () => {
    expect(eventMapPoints([
      event({ id: 2, lat: null, lon: null }),
      event({ id: 3, zone: 'etranger' }),
      event({ id: 4, status: 'closed' }),
      event({ id: 5, independentCount: 1 }), // jaune d'une seule source : hors de la liste
      event({ id: 6, severity: 'low' }),
    ], 'general')).toEqual([]);
  });

  it('« à confirmer » : anneau vide', () => {
    const [p] = eventMapPoints([event({ severity: 'medium', peakSeverity: 'high', independentCount: 1 })], 'general');
    expect(p.hollow).toBe(true);
  });

  it('filtré par le thème choisi', () => {
    expect(eventMapPoints([event({ category: 'energy' })], 'security')).toEqual([]);
    expect(eventMapPoints([event({ category: 'energy' })], 'energy')).toHaveLength(1);
  });

  it('trois tailles : 1 source, 2 à 4, 5 et plus', () => {
    expect([1, 2, 4, 5, 12].map(sourcesRadius)).toEqual([5, 8, 8, 12, 12]);
  });
});
```

- [ ] **Étape 2 : vérifier l'échec** — `npx vitest run src/services/v2-map.test.ts` → échec (module absent).

- [ ] **Étape 3 : exporter `eventEnters`** — dans `src/services/work-queue.ts`, remplacer `function eventEnters(e: NewsEvent): boolean {` par

```ts
/** Événement qui entre dans « À traiter » (et donc sur la carte v2 : spec 2026-09-29 § 5). */
export function eventEnters(e: NewsEvent): boolean {
```

- [ ] **Étape 4 : implémenter** — créer `src/services/v2-map.ts` :

```ts
// src/services/v2-map.ts — ce que la carte de la v2 dessine (spec 2026-09-29 § 5). Pur : App.ts
// passe les données en cache, DeckGLMap dessine le résultat.

import type { NewsEvent } from '../types/index.ts';
import { eventDisplayLevel, levelHex, unconfirmedPeakLevel, type VigilanceLevel } from './vigilance.ts';
import { categoryTheme, inTheme, type ThemeId } from './themes.ts';
import { eventEnters } from './work-queue.ts';

export interface EventMapPoint {
  id: number;
  title: string;
  lon: number;
  lat: number;
  level: VigilanceLevel;
  /** Rayon en pixels : 1 source indépendante, 2 à 4, 5 et plus. */
  radius: 5 | 8 | 12;
  /** « À confirmer » (gravité signalée par une seule source) : anneau vide. */
  hollow: boolean;
  color: [number, number, number];
}

export function sourcesRadius(independentCount: number): EventMapPoint['radius'] {
  if (independentCount >= 5) return 12;
  if (independentCount >= 2) return 8;
  return 5;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Un point par événement de la liste « À traiter » (mêmes règles d'entrée : tout point de la carte
 * est une ligne du fil), localisé, hors étranger, du thème choisi.
 */
export function eventMapPoints(events: readonly NewsEvent[], theme: ThemeId): EventMapPoint[] {
  const out: EventMapPoint[] = [];
  for (const e of events) {
    if (e.lon === null || e.lat === null || e.zone === 'etranger' || !eventEnters(e)) continue;
    if (!inTheme(categoryTheme(e.category), theme)) continue;
    const level = eventDisplayLevel(e.severity, e.peakSeverity);
    out.push({
      id: e.id, title: e.title, lon: e.lon, lat: e.lat, level,
      radius: sourcesRadius(e.independentCount),
      hollow: unconfirmedPeakLevel(e.severity, e.peakSeverity) !== null,
      color: hexToRgb(levelHex(level)),
    });
  }
  return out;
}
```

- [ ] **Étape 5 : vérifier le succès** — `npx vitest run src/services/v2-map.test.ts src/services/work-queue.test.ts` → tout passe.

- [ ] **Étape 6 : clé de couche**
1. `src/types/index.ts`, `interface MapLayers` : ajouter après `news: boolean;`

```ts
  /** Événements consolidés en cours (v2, spec 2026-09-29 § 5). */
  events: boolean;
```

2. `src/App.ts`, `DEFAULT_LAYERS` : ajouter `events: false,` après `news: false,`.
3. `LAYER_CONFIGS` : ajouter après l'entrée `id: 'news'` :

```ts
  {
    id: 'events',
    groupId: 'news',
    role: 'child',
    // Jamais masquée par le maître du groupe Actualités : c'est la couche de base de la v2.
    dependsOnGroup: false,
    label: 'Evenements',
  },
```

4. `normalizeLayerState` : `normalized.newsGroup = normalized.news || normalized.stability || normalized.events;`
5. `_syncGroupFlags` : remplacer le bloc `if (key === 'news' || key === 'stability') {…}` par

```ts
    if (key === 'news' || key === 'stability' || key === 'events') {
      this.activeLayers.newsGroup = this.activeLayers.news || this.activeLayers.stability || this.activeLayers.events;
    }
```

6. `src/components/LayerPanel.ts` : ajouter avant l'entrée `{ key: 'news', … }`

```ts
  { key: 'events', label: 'ÉVÉNEMENTS EN COURS', icon: fmIcon('map-pin'), sublayerOf: 'newsGroup' },
```

7. `npm run typecheck` : ajouter `events` à tout autre objet typé `MapLayers` que le compilateur signale. `events` n'entre PAS dans `ALL_PRESETABLE_LAYER_KEYS` ni dans les vues : les thèmes ne l'allument ni ne l'éteignent, ils filtrent ses points.

- [ ] **Étape 7 : dessin Deck.gl** — dans `src/components/DeckGLMap.ts` :
1. Importer `import type { EventMapPoint } from '../services/v2-map.ts';`
2. Champs, près de `private roadTrafficVisible = false;` :

```ts
  /** Événements consolidés de la v2 (spec 2026-09-29 § 5), déjà filtrés par App (v2-map.ts). */
  private eventPoints: EventMapPoint[] = [];
  private eventPointsVisible = false;
  private onEventPointClick: ((id: number) => void) | null = null;
```

3. Méthodes publiques, près de `updateTrafficIncidents` :

```ts
  setEventPoints(points: EventMapPoint[]): void {
    this.eventPoints = points;
    this.scheduleOverlayUpdate();
  }

  setOnEventPointClick(handler: ((id: number) => void) | null): void {
    this.onEventPointClick = handler;
  }
```

4. `setLayerVisibility(layers: MapLayers)` : juste après `this.currentLayers = layers;`

```ts
    const eventsVisible = layers.events === true;
    if (eventsVisible !== this.eventPointsVisible) {
      this.eventPointsVisible = eventsVisible;
      this.scheduleOverlayUpdate();
    }
```

5. `buildAisLayers()` : ajouter en DERNIER élément du tableau retourné (dessiné au-dessus des autres) :

```ts
      new ScatterplotLayer<EventMapPoint>({
        id: 'deck-news-events',
        data: this.eventPoints,
        visible: this.eventPointsVisible,
        coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
        getPosition: (d: EventMapPoint) => [d.lon, d.lat],
        radiusUnits: 'pixels',
        getRadius: (d: EventMapPoint) => d.radius,
        filled: true,
        getFillColor: (d: EventMapPoint) => (d.hollow ? [0, 0, 0, 0] : [...d.color, 220]) as [number, number, number, number],
        stroked: true,
        lineWidthUnits: 'pixels',
        getLineWidth: (d: EventMapPoint) => (d.hollow ? 2 : 1),
        getLineColor: (d: EventMapPoint) => (d.hollow ? [...d.color, 255] : [10, 12, 18, 230]) as [number, number, number, number],
        pickable: true,
        onHover: (info) => {
          const point = info.object as EventMapPoint | undefined;
          const canvas = this.map?.getCanvas();
          if (canvas) canvas.title = point ? point.title : '';
        },
        onClick: (info) => {
          const point = info.object as EventMapPoint | undefined;
          if (point) this.onEventPointClick?.(point.id);
        },
        updateTriggers: {
          getFillColor: this.eventPoints,
          getLineColor: this.eventPoints,
          getLineWidth: this.eventPoints,
          getRadius: this.eventPoints,
        },
      }),
```

- [ ] **Étape 8 : relais `MapContainer`** — ajouter à `src/components/MapContainer.ts` (import de type `EventMapPoint`) :

```ts
  setEventPoints(points: EventMapPoint[]): void {
    this.deckMap?.setEventPoints(points);
  }

  setOnEventPointClick(handler: ((id: number) => void) | null): void {
    this.deckMap?.setOnEventPointClick(handler);
  }
```

- [ ] **Étape 9 : câblage `App.ts`**
1. Importer `eventMapPoints` depuis `./services/v2-map.ts` et le type `ThemeId` depuis `./services/themes.ts` s'il ne l'est pas.
2. Champs, près de `v2IntelStarted` :

```ts
  /** Thème choisi dans la v2 : filtre les points d'événements (spec 2026-09-29 § 5). */
  private v2Theme: ThemeId = 'general';
  private v2EventsState: IntelEventsState | null = null;
```

3. Méthode, près de `deliverV2Events` :

```ts
  /** Couche Événements de la v2 : les événements du fil, du thème choisi (spec 2026-09-29 § 5). */
  private refreshEventPoints(): void {
    if (!this.uiV2) return;
    this.mapContainer?.setEventPoints(eventMapPoints(this.v2EventsState?.events ?? [], this.v2Theme));
  }
```

4. `deliverV2Events` : après `poste.setEvents(state);` ajouter `this.v2EventsState = state;` puis `this.refreshEventPoints();`.
5. `ensurePoste`, rappel `onThemeChange` : remplacer par

```ts
        onThemeChange: (theme) => {
          this.v2Theme = theme;
          this.applyLayerPreset(theme);
          this.refreshEventPoints();
        },
```

6. `startV2Intel` : après `poste.setBaseline(this.v2BaselineSession.baseline);` ajouter

```ts
    this.mapContainer?.setOnEventPointClick((id) => poste.select(`event:${id}`));
```

- [ ] **Étape 10 : vérifications** — `npm run typecheck`, `npx vitest run`, `npm run build`.

- [ ] **Étape 11 : contrôle visuel** — activer « Événements en cours » dans Couches si besoin (la tâche 3 l'allumera au démarrage) : points jaunes/orange sur la France, aucun à l'étranger ; survol = titre ; clic = fiche de l'événement ; thème Énergie = seulement les événements d'énergie.

- [ ] **Étape 12 : commit** — `git commit -m "feat(v2): couche Événements — un point par événement du fil"` (fichiers de la tâche).

---

### Tâche 3 : couches de démarrage et mémoire de session

**Fichiers :**
- Modifier : `src/config/layer-presets.ts`, `src/config/layer-presets.test.ts`
- Modifier : `src/services/ui-mode.ts`, `src/services/ui-mode.test.ts`
- Modifier : `src/App.ts` (`init`, `readStoredActiveLayers`, écriture de l'état des couches, `applyLayerPreset`)

**Interfaces :**
- Consomme : clé `events` (tâche 2).
- Produit : `v2StartupLayers(): Partial<MapLayers>` ; `themeLayers(uiV2: boolean, id: LayerPresetId): Partial<MapLayers>` ; `layerStateStorage(uiV2: boolean, win: Pick<Window, 'localStorage' | 'sessionStorage'>): Storage | null`.

- [ ] **Étape 1 : tests** — ajouter à `src/config/layer-presets.test.ts` (import : `v2StartupLayers`, `themeLayers` ; le fichier utilise `assert`) :

```ts
describe('couches v2 (spec 2026-09-29 § 5)', () => {
  it('une nouvelle visite v2 démarre avec les événements et les vigilances, rien d’autre', () => {
    assert.deepEqual(v2StartupLayers(), { events: true, environmental: true });
  });

  it('v2 : « Vue générale » ne garde que les vigilances parmi les couches des thèmes', () => {
    const general = themeLayers(true, 'general');
    assert.equal(general.environmental, true);
    for (const key of ['news', 'powerGrid', 'military', 'health'] as const) assert.equal(general[key], false, key);
    assert.equal('events' in general, false); // les thèmes ne touchent pas la couche Événements
  });

  it('les autres thèmes, et la v1, gardent leurs vues', () => {
    assert.deepEqual(themeLayers(true, 'energy'), layersForPreset('energy'));
    assert.deepEqual(themeLayers(false, 'general'), layersForPreset('general'));
  });
});
```

et à `src/services/ui-mode.test.ts` (import : `layerStateStorage`) :

```ts
describe('layerStateStorage (spec 2026-09-29 § 5)', () => {
  const local = { kind: 'local' } as unknown as Storage;
  const session = { kind: 'session' } as unknown as Storage;

  it('v2 : la session ; v1 : localStorage', () => {
    expect(layerStateStorage(true, { localStorage: local, sessionStorage: session })).toBe(session);
    expect(layerStateStorage(false, { localStorage: local, sessionStorage: session })).toBe(local);
  });

  it('stockage inaccessible (navigation privée) : null, sans exception', () => {
    const win = { localStorage: local } as Pick<Window, 'localStorage' | 'sessionStorage'>;
    Object.defineProperty(win, 'sessionStorage', { get() { throw new Error('SecurityError'); } });
    expect(layerStateStorage(true, win)).toBeNull();
  });
});
```

- [ ] **Étape 2 : vérifier l'échec** — `npx vitest run src/config/layer-presets.test.ts src/services/ui-mode.test.ts`.

- [ ] **Étape 3 : implémenter** — à la fin de `src/config/layer-presets.ts` :

```ts
/** v2 (spec 2026-09-29 § 5) : couches d'une nouvelle visite — les événements et les vigilances. */
export function v2StartupLayers(): Partial<MapLayers> {
  return { events: true, environmental: true };
}

/**
 * Couches d'un thème. v2 : « Vue générale » revient aux vigilances seules (la couche Événements,
 * hors des vues, n'est pas touchée) ; les autres thèmes gardent toutes leurs couches (décision du
 * 25/09/2026). v1 : les vues ci-dessus.
 */
export function themeLayers(uiV2: boolean, id: LayerPresetId): Partial<MapLayers> {
  if (!uiV2 || id !== 'general') return layersForPreset(id);
  const off = Object.fromEntries(ALL_PRESETABLE_LAYER_KEYS.map((key) => [key, false])) as Partial<MapLayers>;
  return { ...off, environmental: true };
}
```

(`MapLayers` est déjà importé par ce fichier ; sinon l'importer en type depuis `../types/index.ts`.)

À la fin de `src/services/ui-mode.ts` :

```ts
/**
 * Stockage de l'état des couches. v2 : la session — un rechargement le garde, une nouvelle visite
 * repart des couches de démarrage (spec 2026-09-29 § 5). v1 : localStorage, comme avant. null si
 * le stockage est inaccessible (navigation privée stricte) : rien n'est gardé.
 */
export function layerStateStorage(uiV2: boolean, win: Pick<Window, 'localStorage' | 'sessionStorage'>): Storage | null {
  try {
    return uiV2 ? win.sessionStorage : win.localStorage;
  } catch {
    return null;
  }
}
```

- [ ] **Étape 4 : vérifier le succès** — mêmes tests → tout passe.

- [ ] **Étape 5 : câbler `App.ts`**
1. Imports : `v2StartupLayers`, `themeLayers` depuis `./config/layer-presets.ts` ; `layerStateStorage` depuis `./services/ui-mode.ts`.
2. `readStoredActiveLayers` : remplacer `const raw = localStorage.getItem(ACTIVE_LAYERS_STORAGE_KEY);` par `const raw = layerStateStorage(this.uiV2, window)?.getItem(ACTIVE_LAYERS_STORAGE_KEY);`.
3. Écriture (chercher `localStorage.setItem(ACTIVE_LAYERS_STORAGE_KEY, JSON.stringify(this.activeLayers));`) : remplacer par `layerStateStorage(this.uiV2, window)?.setItem(ACTIVE_LAYERS_STORAGE_KEY, JSON.stringify(this.activeLayers));`.
4. `init`, branche « premier chargement » : remplacer `layersForPreset(DEFAULT_PRESET_ID)` par `(this.uiV2 ? v2StartupLayers() : layersForPreset(DEFAULT_PRESET_ID))`.
5. `applyLayerPreset` : remplacer `const target = layersForPreset(id);` par `const target = themeLayers(this.uiV2, id);`.

- [ ] **Étape 6 : vérifications** — `npm run typecheck`, `npx vitest run`, `npm run build`.

- [ ] **Étape 7 : contrôle visuel** — captures (contexte neuf = nouvelle visite) : seulement les points d'événements et les vigilances ; ni arcs, ni bulles d'articles, ni étiquette « Baromètre Santé ». Dans un navigateur : allumer une couche, recharger (elle reste), ouvrir un nouvel onglet sans paramètre de couches (retour aux deux couches).

- [ ] **Étape 8 : commit** — `git commit -m "feat(v2): couches de démarrage (événements + vigilances) et mémoire de session"`.

---

### Tâche 4 : vigilances allégées et Vigicrues orange/rouge

**Fichiers :**
- Modifier : `src/services/v2-map.ts`, `src/services/v2-map.test.ts`
- Modifier : `src/components/DeckGLMap.ts`, `src/components/MapContainer.ts`, `src/App.ts`

**Interfaces :**
- Produit : `v2FloodSegments(segments: readonly FloodSegment[]): FloodSegment[]` ; `LIGHT_VIGILANCE` ; `MapContainer.setLightVigilance(o: LightVigilance)`.

- [ ] **Étape 1 : test** — ajouter à `src/services/v2-map.test.ts` (import : `v2FloodSegments` ; type `FloodSegment`) :

```ts
describe('v2FloodSegments', () => {
  const line = { type: 'LineString' as const, coordinates: [] };
  const flood = (name: string, level: FloodSegment['level']): FloodSegment => ({
    id: name, name, level, dataSource: 'live', geometryFidelity: 'raw', matchConfidence: 1,
    rawVertexCount: 0, displayVertexCount: 0, geometry: line, rawGeometry: line, displayGeometry: line,
  });

  it('ne garde que les tronçons orange et rouges', () => {
    const kept = v2FloodSegments([flood('a', 'green'), flood('b', 'yellow'), flood('c', 'orange'), flood('d', 'red')]);
    expect(kept.map((s) => s.name)).toEqual(['c', 'd']);
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**, puis **implémenter** dans `src/services/v2-map.ts` (import de type `FloodSegment`) :

```ts
/** Vigicrues sur la carte v2 : tronçons orange et rouges seulement (spec 2026-09-29 § 5). */
export function v2FloodSegments(segments: readonly FloodSegment[]): FloodSegment[] {
  return segments.filter((s) => s.level === 'orange' || s.level === 'red');
}

/** Aplat Météo-France de la v2 : léger, le jaune à peine teinté et sans bordure. */
export const LIGHT_VIGILANCE = { violet: 0.22, red: 0.2, orange: 0.15, yellow: 0.07, highlight: 0.45 } as const;
export type LightVigilance = typeof LIGHT_VIGILANCE;
```

- [ ] **Étape 3 : `DeckGLMap`** (import de type `LightVigilance`) :
1. Champ : `private lightVigilance: LightVigilance | null = null;`
2. Méthodes :

```ts
  /** v2 (spec 2026-09-29 § 5) : vigilances en aplat léger ; appliqué dès que les couches météo existent. */
  setLightVigilance(o: LightVigilance): void {
    this.lightVigilance = o;
    this.applyLightVigilance();
  }

  private applyLightVigilance(): void {
    const o = this.lightVigilance;
    if (!o || !this.map?.getLayer(LYR_WEATHER_FILL)) return;
    this.map.setPaintProperty(LYR_WEATHER_FILL, 'fill-opacity', [
      'case', ['boolean', ['get', 'hasAlert'], false],
      ['case', WEATHER_HIGHLIGHT_STATE, o.highlight,
        ['match', ['get', 'level'], 'violet', o.violet, 'red', o.red, 'orange', o.orange, 'yellow', o.yellow, 0]],
      0,
    ]);
    // Jaune sans bordure (sauf survol) ; orange, rouge et violet gardent la leur.
    this.map.setPaintProperty(LYR_WEATHER_LINE_YELLOW, 'line-opacity', ['case', WEATHER_HIGHLIGHT_STATE, 1, 0]);
  }
```

3. Après l'ajout de `LYR_WEATHER_LINE_VIOLET` (juste avant le commentaire `// NOTE: Weather icons layer is added later`), ajouter `this.applyLightVigilance();`.

- [ ] **Étape 4 : relais et câblage**
1. `MapContainer` : `setLightVigilance(o: LightVigilance): void { this.deckMap?.setLightVigilance(o); }`.
2. `App.ts`, `startV2Intel`, après la ligne `setOnEventPointClick` de la tâche 2 : `this.mapContainer?.setLightVigilance(LIGHT_VIGILANCE);`.
3. `App.ts`, chercher `this.mapContainer?.updateFloods(segments);` et remplacer par `this.mapContainer?.updateFloods(this.uiV2 ? v2FloodSegments(segments) : segments);` (imports depuis `./services/v2-map.ts`).

- [ ] **Étape 5 : vérifications** — `npm run typecheck`, `npx vitest run`, `npm run build`.

- [ ] **Étape 6 : contrôle visuel** — départements en vigilance jaune à peine teintés et sans bordure, orange et rouges bordés ; seuls les cours d'eau orange ou rouges tracés.

- [ ] **Étape 7 : commit** — `git commit -m "feat(v2): vigilances en aplat léger, Vigicrues orange et rouge seulement"`.

---

### Tâche 5 : lieu par département

**Fichiers :**
- Créer : `src/services/departement-lookup.ts`, `src/services/departement-lookup.test.ts`

**Interfaces :**
- Produit : `interface DepartementIndex { at(lon: number, lat: number): { code: string; nom: string } | null; nameOf(code: string): string | null }` ; `buildDepartementIndex(features: readonly GeoFeature[]): DepartementIndex` ; `loadDepartementIndex(fetchImpl?: typeof fetch): Promise<DepartementIndex | null>`.

- [ ] **Étape 1 : tests** — créer `src/services/departement-lookup.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildDepartementIndex } from './departement-lookup.ts';

const square = (x0: number, y0: number, x1: number, y1: number): number[][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];

describe('buildDepartementIndex (spec 2026-09-29 § 6)', () => {
  const index = buildDepartementIndex([
    { properties: { code: '01', nom: 'Ain' }, geometry: { type: 'Polygon', coordinates: [square(4, 45, 5, 46)] } },
    { properties: { code: '69', nom: 'Rhône' }, geometry: { type: 'MultiPolygon', coordinates: [[square(6, 45, 8, 47), square(6.5, 45.5, 7, 46)]] } },
  ]);

  it('trouve le département qui contient le point', () => {
    expect(index.at(4.5, 45.5)).toEqual({ code: '01', nom: 'Ain' });
    expect(index.at(7.5, 46.5)).toEqual({ code: '69', nom: 'Rhône' });
  });

  it('hors de tout département, ou dans un trou : null', () => {
    expect(index.at(0, 0)).toBeNull();
    expect(index.at(6.7, 45.7)).toBeNull();
  });

  it('nom d’un code', () => {
    expect(index.nameOf('01')).toBe('Ain');
    expect(index.nameOf('99')).toBeNull();
  });

  it('sur la géométrie réelle : Lyon, Paris, et La Réunion hors des 96 départements métropolitains', () => {
    const file = path.resolve(import.meta.dirname, '../../public/data/departements.geojson');
    const real = buildDepartementIndex(JSON.parse(readFileSync(file, 'utf8')).features);
    expect(real.at(4.84, 45.76)?.nom).toBe('Rhône');
    expect(real.at(2.35, 48.86)?.nom).toBe('Paris');
    expect(real.at(55.45, -20.9)).toBeNull();
  });
});
```

- [ ] **Étape 2 : vérifier l'échec** — `npx vitest run src/services/departement-lookup.test.ts`.

- [ ] **Étape 3 : implémenter** — créer `src/services/departement-lookup.ts` :

```ts
// src/services/departement-lookup.ts — département d'un point (spec 2026-09-29 § 6) : lieu d'une
// ligne du fil déduit des coordonnées d'un événement, nom d'un code (« 01 » → « Ain »). Même
// géométrie que la carte (/data/departements.geojson : 96 départements métropolitains). Pur, sauf
// loadDepartementIndex.

type Ring = ReadonlyArray<readonly [number, number]>;

interface Shape {
  code: string;
  nom: string;
  /** minLon, minLat, maxLon, maxLat. */
  bbox: [number, number, number, number];
  /** Chaque polygone : anneau extérieur, puis trous. */
  polygons: Ring[][];
}

export interface GeoFeature {
  properties: { code?: unknown; nom?: unknown } | null;
  geometry:
    | { type: 'Polygon'; coordinates: number[][][] }
    | { type: 'MultiPolygon'; coordinates: number[][][][] }
    | null;
}

export interface DepartementIndex {
  at(lon: number, lat: number): { code: string; nom: string } | null;
  nameOf(code: string): string | null;
}

function inRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inPolygon(lon: number, lat: number, rings: Ring[]): boolean {
  if (rings.length === 0 || !inRing(lon, lat, rings[0])) return false;
  return !rings.slice(1).some((hole) => inRing(lon, lat, hole));
}

export function buildDepartementIndex(features: readonly GeoFeature[]): DepartementIndex {
  const shapes: Shape[] = [];
  for (const f of features) {
    const code = typeof f.properties?.code === 'string' ? f.properties.code : null;
    const nom = typeof f.properties?.nom === 'string' ? f.properties.nom : null;
    if (!code || !nom || !f.geometry) continue;
    const raw = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    const polygons: Ring[][] = raw.map((poly) => poly.map((ring) => ring.map(([x, y]) => [x, y] as const)));
    const bbox: Shape['bbox'] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const poly of polygons) {
      for (const [x, y] of poly[0] ?? []) {
        bbox[0] = Math.min(bbox[0], x);
        bbox[1] = Math.min(bbox[1], y);
        bbox[2] = Math.max(bbox[2], x);
        bbox[3] = Math.max(bbox[3], y);
      }
    }
    shapes.push({ code, nom, bbox, polygons });
  }
  const names = new Map(shapes.map((s) => [s.code, s.nom]));
  return {
    at(lon, lat) {
      for (const s of shapes) {
        const [minLon, minLat, maxLon, maxLat] = s.bbox;
        if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) continue;
        if (s.polygons.some((rings) => inPolygon(lon, lat, rings))) return { code: s.code, nom: s.nom };
      }
      return null;
    },
    nameOf(code) {
      return names.get(code) ?? null;
    },
  };
}

export async function loadDepartementIndex(fetchImpl: typeof fetch = fetch): Promise<DepartementIndex | null> {
  try {
    const res = await fetchImpl('/data/departements.geojson');
    if (!res.ok) return null;
    const body = (await res.json()) as { features?: unknown };
    return Array.isArray(body.features) ? buildDepartementIndex(body.features as GeoFeature[]) : null;
  } catch {
    return null;
  }
}
```

- [ ] **Étape 4 : vérifier le succès**, puis `npm run typecheck`.

- [ ] **Étape 5 : commit** — `git commit -m "feat(v2): département d'un point et nom d'un code"`.

---

### Tâche 6 : fil « À traiter »

**Fichiers :**
- Modifier : `src/services/work-queue.ts`, `src/services/work-queue.test.ts`
- Modifier : `src/components/poste/WorkList.ts`, `src/components/poste/WorkList.test.ts`
- Modifier : `src/components/poste/PosteSituation.ts`, `src/App.ts`, `src/styles/main.css`

**Interfaces :**
- Consomme : `DepartementIndex`, `loadDepartementIndex` (tâche 5).
- Produit : `WorkQueueInput.departements?: DepartementIndex | null` ; `WorkQueue.foreign: WorkItem[]` ; `WorkQueueView.foreign: WorkItem[]` ; `PosteSituation.setDepartements(index: DepartementIndex): void`.

- [ ] **Étape 1 : tests** — ajouter à `src/services/work-queue.test.ts` (import : type `DepartementIndex` depuis `./departement-lookup.ts`) :

```ts
describe('fil de la refonte 29/09 (spec 2026-09-29 § 6)', () => {
  const index: DepartementIndex = {
    at: (lon, lat) => (lon > 0 && lon < 2 && lat > 49 && lat < 50 ? { code: '76', nom: 'Seine-Maritime' } : null),
    nameOf: (code) => (code === '01' ? 'Ain' : null),
  };

  it('un événement étranger sort de la liste et va dans « Hors de France »', () => {
    const q = buildWorkQueue(input({ events: eventsState({ events: [event({ id: 1, zone: 'etranger' }), event({ id: 2, zone: 'france' })] }) }));
    expect(keys(q)).toEqual(['event:2']);
    expect(q.foreign.map((i) => i.key)).toEqual(['event:1']);
    expect(viewWorkQueue(q, 'general', false).foreign.map((i) => i.key)).toEqual(['event:1']);
  });

  it('première visite : aucune étiquette, même pour un événement créé dans les 24 h', () => {
    const e = event();
    const digest: ChangeDigestItem[] = [{ event: e, kinds: ['created'], latestAt: '2026-09-24T07:40:00Z', severityFrom: null, independentFrom: null }];
    const q = buildWorkQueue(input({ events: eventsState({ events: [e], digest, anchor: { since: NOW - 24 * H, kind: 'default' } }) }));
    expect(q.items[0].badge).toBeNull();
  });

  it('tri : gravité puis dernier article ; une étiquette ne remonte plus une ligne', () => {
    const recent = event({ id: 1, severity: 'high', lastSeen: '2026-09-24T07:55:00Z' });
    const older = event({ id: 2, severity: 'high', lastSeen: '2026-09-24T06:00:00Z' });
    const digest: ChangeDigestItem[] = [{ event: older, kinds: ['created'], latestAt: '2026-09-24T06:00:00Z', severityFrom: null, independentFrom: null }];
    const q = buildWorkQueue(input({ events: eventsState({ events: [older, recent], digest }) }));
    expect(keys(q)).toEqual(['event:1', 'event:2']);
    expect(q.items[0].since).toBe(Date.parse('2026-09-24T07:55:00Z'));
  });

  it('lieu : département des coordonnées, « France » sans coordonnées, rien hors des départements, nom d’un code', () => {
    const q = buildWorkQueue(input({
      departements: index,
      situations: [situation({ affectedZones: ['01'] })],
      events: eventsState({ events: [
        event({ id: 1, lat: 49.4, lon: 1.1 }),
        event({ id: 2, lat: null, lon: null }),
        event({ id: 3, lat: -20.9, lon: 55.45 }),
      ] }),
    }));
    const place = (key: string): string | null | undefined => q.items.find((i) => i.key === key)?.place;
    expect(place('event:1')).toBe('Seine-Maritime');
    expect(place('event:2')).toBe('France');
    expect(place('event:3')).toBeNull();
    expect(place('situation:energy-stress')).toBe('Ain');
  });
});
```

- [ ] **Étape 2 : vérifier l'échec** — `npx vitest run src/services/work-queue.test.ts`.

- [ ] **Étape 3 : implémenter dans `work-queue.ts`**
1. Import de type : `import type { DepartementIndex } from './departement-lookup.ts';`
2. `WorkQueueInput` : ajouter

```ts
  /** Départements (lieu des événements, nom des codes) ; null tant que la géométrie n'est pas chargée. */
  departements?: DepartementIndex | null;
```

3. `WorkQueue` : ajouter `/** Événements recoupés hors de France : groupe replié « Hors de France » (spec 2026-09-29 § 6). */ foreign: WorkItem[];`
4. Ajouter avant `buildWorkQueue` :

```ts
const DEPARTEMENT_CODE = /^(\d{2}|2[AB]|97\d)$/;

/** Un lieu qui est un code de département (« 01 ») prend son nom (« Ain »). */
function placeName(place: string | null, departements: DepartementIndex | null): string | null {
  if (place === null || !DEPARTEMENT_CODE.test(place)) return place;
  return departements?.nameOf(place) ?? place;
}

/** Lieu d'un événement : son département ; « France » sans coordonnées (sujet national) ; rien hors des départements. */
function eventPlace(e: NewsEvent, departements: DepartementIndex | null): string | null {
  if (e.lon === null || e.lat === null) return 'France';
  return departements?.at(e.lon, e.lat)?.nom ?? null;
}
```

5. `eventBadge` : première ligne du corps

```ts
  // Première visite : l'ancre est une date fictive (24 h), rien n'est « nouveau » pour l'analyste.
  if (events.anchor.kind === 'default') return null;
```

6. `compareWorkItems` : remplacer le commentaire et le corps par

```ts
/** Tri (spec 2026-09-29 § 6) : gravité, puis fraîcheur, puis clé. */
export function compareWorkItems(a: WorkItem, b: WorkItem): number {
  return LEVEL_RANK[b.level] - LEVEL_RANK[a.level]
    || (b.since ?? 0) - (a.since ?? 0)
    || a.key.localeCompare(b.key);
}
```

7. `buildWorkQueue` : `const departements = input.departements ?? null;` puis
   - situations et alertes : `place: placeName(firstZone(…affectedZones), departements)` ;
   - boucle des événements : déclarer `const foreign: WorkItem[] = [];` avant la boucle et remplacer le `items.push({ key: \`event:${e.id}\`, … })` par

```ts
      const item: WorkItem = {
        key: `event:${e.id}`, level: eventDisplayLevel(e.severity, e.peakSeverity), title: e.title,
        place: eventPlace(e, departements), since: parseTime(e.lastSeen),
        ...(unconfirmedPeak ? { unconfirmedPeak } : {}),
        independentSources: e.independentCount, theme: categoryTheme(e.category), badge: eventBadge(e, events),
        ref: { kind: 'event', event: e },
      };
      if (e.zone === 'etranger') foreign.push(item);
      else items.push(item);
```

   - après `items.sort(compareWorkItems);` : `foreign.sort(compareWorkItems);` et `foreign` dans l'objet retourné.
8. `WorkQueueView` : ajouter `foreign: WorkItem[];` et, dans `viewWorkQueue`, `foreign: queue.foreign.filter((i) => inTheme(i.theme, theme)),`.

- [ ] **Étape 4 : vérifier le succès** — `npx vitest run src/services/work-queue.test.ts`. Adapter les tests existants qui décrivent l'ancien comportement : tri « étiquetés d'abord » (chercher `nouveau ou aggravé` / `badge` dans les descriptions), `since` des événements (valait `firstSeen`), étiquette d'événement à la première visite. Garder leur intention, mettre les nouvelles valeurs attendues.

- [ ] **Étape 5 : tests `WorkList`** — ajouter à `src/components/poste/WorkList.test.ts` (import de type `ChangeDigestItem` ; les aides `model`, `events`, `event` du fichier construisent la vue par `buildWorkQueue`) :

```ts
describe('ligne de la refonte 29/09 (spec 2026-09-29 § 6)', () => {
  it('lieu · heure du dernier article · sources ; le niveau seulement pour les lecteurs d’écran', () => {
    const html = renderWorkList(model({ events: events({ events: [event({ severity: 'high', lastSeen: '2026-09-24T06:00:00Z', independentCount: 5 })] }) }));
    expect(html).toContain('France · il y a 2 h · 5 sources');
    expect(html).toContain('<span class="visually-hidden">Orange · </span>');
  });

  it('une seule étiquette : À CONFIRMER passe avant AGGRAVÉ', () => {
    const e = event({ severity: 'medium', peakSeverity: 'critical', independentCount: 1 });
    const digest: ChangeDigestItem[] = [{ event: e, kinds: ['escalated'], latestAt: '2026-09-24T07:50:00Z', severityFrom: 'low', independentFrom: null }];
    const html = renderWorkList(model({ events: events({ events: [e], digest }) }));
    expect(html).toContain('À CONFIRMER');
    expect(html).not.toContain('AGGRAVÉ');
  });

  it('groupe replié « Hors de France »', () => {
    const html = renderWorkList(model({ events: events({ events: [event({ id: 9, title: 'Inondations à Bangkok', zone: 'etranger' })] }) }));
    expect(html).toContain('<details class="wl-foreign">');
    expect(html).toContain('Hors de France : 1');
    expect(html).toContain('data-key="event:9"');
  });
});
```

Adapter ensuite les tests existants du fichier qui attendent le mot du niveau dans la méta visible (« Rouge · … »), « sources indép. » ou deux étiquettes à la fois.

- [ ] **Étape 6 : vérifier l'échec**, puis **implémenter dans `WorkList.ts`**
1. `rowMeta` :

```ts
/** « Haut-Rhin · il y a 2 h · 5 sources » (spec 2026-09-29 § 6), texte brut ; le niveau est dit par la barre. */
export function rowMeta(item: WorkItem, lang: Lang, now: number): string {
  const parts: string[] = [];
  if (item.place) parts.push(item.place);
  if (item.since !== null) {
    // Un événement ou une alerte datent d'un instant (« il y a ») ; une situation dure (« depuis »).
    const ongoing = item.ref.kind !== 'event' && item.ref.kind !== 'alert';
    parts.push(relative(item.since, now, lang, ongoing));
  }
  if (item.independentSources !== null) {
    parts.push(item.independentSources >= 2
      ? (lang === 'fr' ? `${item.independentSources} sources` : `${item.independentSources} sources`)
      : (lang === 'fr' ? 'source unique' : 'single source'));
  }
  return parts.join(' · ');
}
```

2. `badgeHtml` : une seule étiquette

```ts
function badgeHtml(item: WorkItem, lang: Lang): string {
  const fr = lang === 'fr';
  const label = item.unconfirmedPeak ? (fr ? 'À CONFIRMER' : 'UNCONFIRMED')
    : item.badge === 'aggrave' ? (fr ? 'AGGRAVÉ' : 'ESCALATED')
      : item.badge === 'nouveau' ? (fr ? 'NOUVEAU' : 'NEW')
        : null;
  return label ? ` <span class="wl-badge">${label}</span>` : '';
}
```

3. Extraire le rendu d'une ligne dans `function rowHtml(item: WorkItem, model: WorkListModel): string` (le corps actuel du `map`), en ajoutant le mot du niveau pour les lecteurs d'écran au début de la méta : `<span class="wl-meta"><span class="visually-hidden">${levelLabel(item.level, model.lang)} · </span>${escapeHtml(rowMeta(item, model.lang, model.now))}</span>`.
4. Dans `renderWorkList`, après `guard` :

```ts
  const foreign = view.foreign.length > 0
    ? `<details class="wl-foreign"><summary class="wl-foreign-title">${escapeHtml(fr ? `Hors de France : ${view.foreign.length}` : `Outside France: ${view.foreign.length}`)}</summary>`
      + `<ul class="wl-list">${view.foreign.map((item) => rowHtml(item, model)).join('')}</ul></details>`
    : '';
```

   et l'ajouter en fin de chaîne retournée (`…${more}${guard}${foreign}`).

- [ ] **Étape 7 : `PosteSituation`**
1. Champ `private departements: DepartementIndex | null = null;` et méthode

```ts
  setDepartements(index: DepartementIndex): void {
    this.departements = index;
    this.rebuild();
  }
```

2. `rebuild` : passer `departements: this.departements,` à `buildWorkQueue`.

- [ ] **Étape 8 : `App.ts`** — dans `startV2Intel`, après la ligne `setOnEventPointClick` :

```ts
    void loadDepartementIndex().then((index) => {
      if (index) poste.setDepartements(index);
    });
```

(import de `loadDepartementIndex` depuis `./services/departement-lookup.ts`).

- [ ] **Étape 9 : CSS** — ajouter à la fin de `main.css` :

```css
#app.ui-v2 .wl-foreign { border-top: 1px solid var(--border-color); }
#app.ui-v2 .wl-foreign-title { padding: 8px 12px; font-size: 12px; color: var(--text-secondary); cursor: pointer; }
#app.ui-v2 .wl-item-title { white-space: normal; overflow: visible; text-overflow: clip; }
```

- [ ] **Étape 10 : vérifications** — `npm run typecheck`, `npx vitest run`, `npm run build`.

- [ ] **Étape 11 : contrôle visuel** — pas de Bangkok ni d'Ormuz dans la liste, ligne repliée « Hors de France : n » en bas ; lignes « département · il y a … · n sources » ; aucune étiquette (contexte neuf = première visite) ; titres entiers.

- [ ] **Étape 12 : commit** — `git commit -m "feat(v2): fil — étranger à part, une étiquette, lieu et heure du dernier article"`.

---

### Tâche 7 : onglet État de la France

**Fichiers :**
- Modifier : `src/components/fiche/parts.ts`, `src/components/fiche/parts.test.ts`
- Modifier : `src/components/fiche/france.ts`, `src/components/fiche/france.test.ts`
- Modifier : `src/components/poste/PosteSituation.ts`, `src/components/poste/PosteSituation.test.ts`
- Modifier : `src/components/BarometerWidget.ts`, `src/App.ts`

**Interfaces :**
- Produit : `FicheModel.whyFirst?: boolean` ; `renderChangeRows(changes: FicheChange[], lang: Lang): string` ; `FranceFicheInput.briefMeta: { at: number; level: VigilanceLevel } | null` ; `franceChangeDigest(input): { meta: string; rows: FicheChange[] }` ; `PosteSituation.setBrief(brief, freshness, situationIds, meta: { at: number; level: VigilanceLevel })` ; `BarometerWidget.mount({ attach?: boolean; briefing?: boolean })`.

- [ ] **Étape 1 : `parts.ts` — tests** — ajouter à `src/components/fiche/parts.test.ts` (aide `model()` du fichier) :

```ts
describe('whyFirst (spec 2026-09-29 § 7)', () => {
  it('le volet « Pourquoi ce niveau ? » suit l’en-tête quand whyFirst est vrai', () => {
    const html = renderFiche(model({ why: '<p>Indice</p>', whyFirst: true, sections: [{ title: 'Situations', html: '<p>S</p>' }] }), 'fr');
    expect(html.indexOf('fiche-why')).toBeLessThan(html.indexOf('Situations'));
  });
});
```

- [ ] **Étape 2 : `parts.ts` — implémenter**
1. `FicheModel` : `/** Volet « Pourquoi ce niveau ? » juste sous l'en-tête (onglet État). */ whyFirst?: boolean;`
2. Extraire la liste des changements :

```ts
/** Lignes de changements (heure, texte, lien) ; '' si aucune. */
export function renderChangeRows(changes: readonly FicheChange[], lang: Lang): string {
  const rows = changes.map((c) => {
    const time = `<span class="fiche-time">${c.at === null ? '—' : formatClock(c.at, lang)}</span>`;
    const text = escapeHtml(c.text);
    const body = c.select
      ? `<button type="button" class="fiche-link" data-select="${escapeHtml(c.select)}">${text}</button>`
      : `<span>${text}</span>`;
    return `<li class="fiche-change">${time} ${body}</li>`;
  }).join('');
  return rows ? `<ul class="fiche-list">${rows}</ul>` : '';
}
```

   et réécrire `renderChanges` pour l'utiliser (même rendu qu'avant).
3. `renderFiche` : `const whyFirst = model.whyFirst === true;` puis `…${head}${whyFirst ? why : ''}${essentiel}…${renderSources(model, lang)}${whyFirst ? '' : why}${actions}…`.

- [ ] **Étape 3 : `france.ts` — tests** — dans `src/components/fiche/france.test.ts`, compléter l'import (`franceChangeDigest`), ajouter `briefMeta: { at: NOW - 30 * 60_000, level: 'orange' },` à l'objet retourné par `input()`, puis REMPLACER le `describe` existant par :

```ts
const sectionTitles = (html: string): string[] => [...html.matchAll(/<h3 class="fiche-part-title">([^<]*)<\/h3>/g)].map((m) => m[1]);

describe('onglet État de la France (spec 2026-09-29 § 7)', () => {
  it('Pourquoi replié en tête, puis Situations, Note, Depuis votre visite, Indicateurs', () => {
    const model = buildFranceFiche(input());
    expect(model.whyFirst).toBe(true);
    expect(sectionTitles(renderFiche(model, 'fr'))).toEqual(['Situations (1)', 'Note de situation', 'Depuis votre dernière visite', 'Indicateurs']);
  });

  it('les graphiques sont visibles, plus cachés dans le volet ; ni événements consolidés, ni chiffres clés', () => {
    const model = buildFranceFiche(input());
    for (const part of ['frintel-dom-grid', 'frintel-timeline', 'fiche-infra-slot']) {
      expect(model.why).not.toContain(part);
      expect(model.sections.find((s) => s.title === 'Indicateurs')?.html).toContain(part);
    }
    expect(model.why).toContain('Indice de stabilité 43/100');
    expect(renderFiche(model, 'fr')).not.toContain('Événements consolidés ouverts');
    expect(model.figures).toEqual([]);
  });

  it('note : évaluation, jugements avec preuves cliquables, à surveiller, heure et niveau de rédaction', () => {
    const note = buildFranceFiche(input()).sections.find((s) => s.title === 'Note de situation')?.html ?? '';
    expect(note).toContain('France en vigilance rouge, en dégradation sur 24 h.');
    expect(note).toContain('data-select="event:42"');
    expect(note).toContain('6 h');
    expect(note).toContain('Rédigée à');
    expect(note).toContain('niveau orange');
  });

  it('note en attente : « en cours de préparation », jamais « indisponible »', () => {
    const note = buildFranceFiche(input({ brief: null, briefMeta: null })).sections.find((s) => s.title === 'Note de situation')?.html ?? '';
    expect(note).toContain('Synthèse nationale en cours de préparation…');
    expect(note).not.toContain('indisponible');
  });

  it('en-tête : situations actives, heure de mise à jour, sources', () => {
    expect(buildFranceFiche(input()).freshness).toMatch(/^1 situation active · MAJ \d{2}:\d{2} · 33 sources sur 35 à jour$/);
  });

  it('depuis la visite : totaux, puis 5 changements orange ou rouges au plus, résolues comprises', () => {
    const events = Array.from({ length: 7 }, (_, i) => event({ id: 100 + i, title: `Événement ${i}`, severity: 'high' }));
    const digest: ChangeDigestItem[] = events.map((e) => ({ event: e, kinds: ['created'], latestAt: '2026-09-24T07:40:00Z', severityFrom: null, independentFrom: null }));
    const low = event({ id: 200, title: 'Fait mineur', severity: 'low' });
    digest.push({ event: low, kinds: ['created'], latestAt: '2026-09-24T07:45:00Z', severityFrom: null, independentFrom: null });
    const { meta, rows } = franceChangeDigest(input({ events: eventsState({ events: [...events, low], digest }) }));
    expect(meta).toContain('Depuis votre visite de');
    expect(meta).toContain('9 nouveaux');
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.text)).not.toContain('Nouveau : Fait mineur');
  });

  it('S<n> désigne la situation figée au moment du brief, pas l’instantané courant', () => {
    const html = renderFiche(buildFranceFiche(input({ briefSituationIds: ['cyber-pressure'] })), 'fr');
    expect(html).toContain('data-select="situation:cyber-pressure">S1');
  });

  it('avant les couches critiques : ni indice ni piliers dans le volet', () => {
    const html = renderFiche(buildFranceFiche(input({ ready: false, snapshot: snapshot({ score: 95, scoreBreakdown: breakdown(95), situations: [] }) })), 'fr');
    expect(html).toContain('Calcul du niveau national…');
    for (const part of ['Indice de stabilité', 'frintel-pillars', '95/100']) expect(html).not.toContain(part);
  });

  it('actions : voir sur la carte et note de situation ; bascule EN', () => {
    const model = buildFranceFiche(input({ lang: 'en' }));
    expect(model.actions.map((a) => a.id)).toEqual(['show-france', 'report']);
    expect(model.kind).toBe('State of France');
    expect(model.driver).toBe('driven by energy');
  });
});
```

(« 9 nouveaux » = 7 + 1 événements créés + la situation `energy-stress`, nouvelle car absente de `baseline: {}`.)

- [ ] **Étape 4 : vérifier l'échec** — `npx vitest run src/components/fiche/`.

- [ ] **Étape 5 : `france.ts` — implémenter**
1. Imports : `LEVEL_RANK`, `confidenceLabel`, `situationLevel`, `type VigilanceLevel` depuis `vigilance.ts` ; `renderVigilancePill` depuis `../shared/vigilancePill.ts` ; `renderChangeRows` depuis `./parts.ts`. Retirer `allEventsHtml` et `MAX_CHANGES`.
2. `FranceFicheInput` : ajouter

```ts
  /** Heure de réception et niveau national au moment de la note ; null tant qu'aucune note n'est arrivée. */
  briefMeta: { at: number; level: VigilanceLevel } | null;
```

3. Remplacer `franceChanges` par :

```ts
const MAX_ETAT_CHANGES = 5;

interface EtatChange extends FicheChange {
  kind: 'nouveau' | 'aggrave' | 'resolu' | 'autre';
  /** Orange ou rouge, ou situation résolue : affiché dans l'onglet État. */
  important: boolean;
}

function allChanges(input: FranceFicheInput): EtatChange[] {
  const { lang } = input;
  const out: EtatChange[] = [];
  for (const item of input.queue.items) {
    if (item.badge === null || item.ref.kind === 'event') continue;
    const text = item.badge === 'nouveau'
      ? labelled(lang, 'Nouveau', 'New', item.title)
      : labelled(lang, 'Aggravé', 'Escalated', item.title);
    out.push({
      at: input.changeTimes.get(item.key) ?? null, text, select: item.key,
      kind: item.badge, important: LEVEL_RANK[item.level] >= LEVEL_RANK.orange,
    });
  }
  for (const d of input.events?.digest ?? []) {
    const kind = d.kinds.includes('created') ? 'nouveau'
      : d.kinds.includes('escalated') || d.kinds.includes('reopened') ? 'aggrave' : 'autre';
    out.push({
      at: parseTime(d.latestAt), text: digestChangeText(d, lang), select: `event:${d.event.id}`,
      kind, important: LEVEL_RANK[eventLevel(d.event.severity)] >= LEVEL_RANK.orange,
    });
  }
  const active = new Set(input.snapshot.situations.map((s) => s.id));
  for (const r of input.resolved) {
    if (active.has(r.id)) continue;
    out.push({ at: r.since, text: labelled(lang, 'Résolue', 'Resolved', r.title), select: null, kind: 'resolu', important: true });
  }
  const rank = (at: number | null): number => at ?? Number.MAX_SAFE_INTEGER;
  return out.sort((a, b) => rank(b.at) - rank(a.at));
}

function totalsText(changes: readonly EtatChange[], lang: Lang): string {
  const count = (kind: EtatChange['kind']): number => changes.filter((c) => c.kind === kind).length;
  const parts: string[] = [];
  const n = count('nouveau');
  const a = count('aggrave');
  const r = count('resolu');
  if (n > 0) parts.push(lang === 'fr' ? `${n} nouveau${n > 1 ? 'x' : ''}` : `${n} new`);
  if (a > 0) parts.push(lang === 'fr' ? `${a} aggravé${a > 1 ? 's' : ''}` : `${a} escalated`);
  if (r > 0) parts.push(lang === 'fr' ? `${r} résolu${r > 1 ? 's' : ''}` : `${r} resolved`);
  return parts.join(' · ');
}

/** « Depuis votre dernière visite » : ancre et totaux, puis 5 changements orange ou rouges au plus. */
export function franceChangeDigest(input: FranceFicheInput): { meta: string; rows: FicheChange[] } {
  const all = allChanges(input);
  const totals = totalsText(all, input.lang);
  const meta = totals ? `${changesMeta(input)} — ${totals}` : changesMeta(input);
  const rows = all.filter((c) => c.important).slice(0, MAX_ETAT_CHANGES).map(({ at, text, select }) => ({ at, text, select }));
  return { meta, rows };
}
```

4. Ajouter :

```ts
function situationsHtml(input: FranceFicheInput): string {
  const { lang } = input;
  return input.snapshot.situations.map((s) => `<li class="fiche-situation">`
    + `<button type="button" class="fiche-link" data-select="situation:${escapeHtml(s.id)}">${renderVigilancePill(situationLevel(s.severity), lang)} ${escapeHtml(s.title)}</button>`
    + ` <span class="fiche-meta">${confidenceLabel(s.confidence, lang)}</span></li>`).join('');
}

function noteHtml(input: FranceFicheInput): string {
  const { lang } = input;
  const brief = input.brief?.brief ?? null;
  if (!brief) return `<p>${t(lang, 'Synthèse nationale en cours de préparation…', 'National summary being prepared…')}</p>`;
  const watch = brief.watch.length > 0
    ? `<h4 class="fiche-why-title">${t(lang, 'À surveiller', 'Watch')}</h4><ul class="fiche-list">${brief.watch
      .map((w) => `<li><span class="fiche-horizon">${escapeHtml(w.horizon.replace('h', ' h'))}</span> ${escapeHtml(w.text)}</li>`).join('')}</ul>`
    : '';
  const meta = input.briefMeta
    ? `<p class="fiche-meta">${t(lang,
      `Rédigée à ${formatClock(input.briefMeta.at, lang)}, niveau ${levelLabel(input.briefMeta.level, lang).toLowerCase()}`,
      `Written at ${formatClock(input.briefMeta.at, lang)}, level ${levelLabel(input.briefMeta.level, lang).toLowerCase()}`)}</p>`
    : '';
  const judgments = brief.judgments.length > 0 ? judgmentsHtml(brief, input) : '';
  return `<p>${escapeHtml(brief.bluf)}</p>${judgments}${watch}${meta}${briefOrigin(input.brief, lang)}`;
}

function changesHtml(input: FranceFicheInput): string {
  const { meta, rows } = franceChangeDigest(input);
  const list = renderChangeRows(rows, input.lang);
  return `<div class="fiche-meta">${escapeHtml(meta)}</div>${list || `<p class="fiche-empty">${t(input.lang, 'Aucun changement orange ou rouge.', 'No orange or red change.')}</p>`}`;
}
```

5. Réécrire `buildFranceFiche` :

```ts
export function buildFranceFiche(input: FranceFicheInput): FicheModel {
  const { snapshot, lang } = input;
  const brief = input.brief?.brief ?? null;
  const n = snapshot.situations.length;
  const count = lang === 'fr' ? `${n} situation${n > 1 ? 's' : ''} active${n > 1 ? 's' : ''}` : `${n} active situation${n === 1 ? '' : 's'}`;
  const situations = situationsHtml(input);
  const indicators = [
    // Le baromètre des infrastructures est un composant vivant : App.ts l'y rattache (onFicheRendered).
    '<div class="fiche-infra-slot"></div>',
    renderDomainsBlock(snapshot, lang),
    renderEnergyBlock(snapshot.energy, lang),
    renderTimelineBlock(snapshot.timeline, lang),
  ].join('');
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
    sections: [
      ...(situations ? [{ title: `Situations (${n})`, html: `<ul class="fiche-list">${situations}</ul>` }] : []),
      { title: t(lang, 'Note de situation', 'Situation note'), html: noteHtml(input) },
      { title: t(lang, 'Depuis votre dernière visite', 'Since your last visit'), html: changesHtml(input) },
      { title: t(lang, 'Indicateurs', 'Indicators'), html: indicators },
    ],
    figures: [],
    watch: [],
    sourcesTitle: t(lang, 'Preuves et sources', 'Evidence and sources'),
    sources: brief ? franceSources(brief, input) : [],
    why: input.ready
      ? renderWhyBody({
          breakdown: snapshot.scoreBreakdown,
          delta24h: input.score.delta24h,
          pillarDeltas: input.score.pillarDeltas,
          series: input.score.series,
          lang,
        })
      : `<p class="fiche-meta">${t(lang, 'Calcul du niveau national…', 'Computing the national level…')}</p>`,
    whyFirst: true,
    whyOpen: input.whyOpen,
    actions: [
      { id: 'show-france', label: t(lang, 'Voir sur la carte', 'Show on map') },
      { id: 'report', label: t(lang, 'Note de situation', 'Situation report') },
    ],
  };
}
```

- [ ] **Étape 6 : vérifier le succès** — `npx vitest run src/components/fiche/`.

- [ ] **Étape 7 : `PosteSituation`**
1. Champ `private briefMeta: { at: number; level: VigilanceLevel } | null = null;` (import de type `VigilanceLevel`).
2. `setBrief(brief, freshness, situationIds, meta: { at: number; level: VigilanceLevel })` : ajouter `this.briefMeta = meta;` ; `setBriefPending` : `this.briefMeta = null;`.
3. `franceFiche` : passer `briefMeta: this.briefMeta,`.
4. `setTheme` : commentaire `this.selection = null; // l'État reste affiché (spec 2026-09-29 § 7)`.
5. `chooseTheme` :

```ts
  private chooseTheme(theme: ThemeId): void {
    // Second clic sur le thème actif : sa fiche (spec 2026-09-29 § 7). Hors ordinateur, choisir un
    // thème ouvre aussi sa fiche (la fiche n'y est visible qu'en volet).
    if (theme === this.theme && theme !== 'general') {
      this.select(`theme:${theme}`);
      return;
    }
    this.setTheme(theme);
    if (theme !== 'general' && this.layout() !== 'desktop') this.select(`theme:${theme}`);
  }
```

6. `defaultFiche` : toujours l'État —

```ts
  /** Fiche par défaut : l'onglet État de la France, quel que soit le thème (spec 2026-09-29 § 7). */
  private defaultFiche(data: PosteData, queue: WorkQueue, drivers: readonly ThemeId[]): FicheModel {
    return this.franceFiche(data, queue, drivers);
  }
```

7. `renderTabs` : `const ficheLabel = lang === 'fr' ? 'État' : 'State';`.
8. Tests `PosteSituation.test.ts` : mettre à jour les appels `setBrief(…)` (quatrième argument `{ at: NOW, level: 'orange' }`), les attentes « un thème affiche sa fiche » (désormais : l'État reste, et un second clic sur le thème ouvre `theme:<id>`), et ajouter :

```ts
  it('un thème ne remplace pas l’État ; un second clic sur le thème ouvre sa fiche', () => {
    const { roots } = setup();
    const energy = (): HTMLElement | null => roots.themes.querySelector<HTMLElement>('[data-theme="energy"]');
    energy()?.click();
    expect(ficheKey(roots)).toBe('france');
    energy()?.click();
    expect(ficheKey(roots)).toBe('theme:energy');
  });
```

(`ThemeBar.ts` rend chaque thème en `<button data-theme="…">` ; le clic passe par `setOnSelect`).

- [ ] **Étape 8 : second briefing retiré (v2)**
1. `BarometerWidget.mount(options?: { attach?: boolean; briefing?: boolean })` : remplacer `this.el.appendChild(this._buildBriefing());` par

```ts
    // v2 : pas de second briefing IA ni de « stabilité systémique », qui contredisaient le niveau national.
    if (options?.briefing !== false) this.el.appendChild(this._buildBriefing());
```

2. `App.ts` : `this.networkBarometerWidget.mount({ attach: false, briefing: !this.uiV2 });`.
3. `refreshNetworkBarometerWidget` : après `this.networkBarometerWidget?.updateEolien(this.currentEolienLive);` ajouter

```ts
    // v2 (spec 2026-09-29 § 7) : pas d'appel à la synthèse ISNR (Groq), son bloc n'est plus affiché.
    if (this.uiV2) return;
```

4. `requestFranceIntelBrief` : `this.poste?.setBrief(result.brief, result.freshness, situationIds, { at: Date.now(), level: scoreLevel(snapshot.score) });` (importer `scoreLevel` depuis `./services/vigilance.ts` s'il ne l'est pas).
5. Commentaire de `onFicheRendered` : « le baromètre des infrastructures vit dans « Indicateurs » de l'onglet État ».

- [ ] **Étape 9 : vérifications** — `npm run typecheck`, `npx vitest run`, `npm run build`.

- [ ] **Étape 10 : contrôle visuel** — colonne de droite : « État de la France », « Pourquoi ce niveau ? » replié en tête, Situations, Note de situation, Depuis votre dernière visite (au plus 5 lignes), Indicateurs (jauge, Domaines, Énergie, carburants, Chronologie) ; plus de « AI BRIEFING », « CACHE FIGÉ » ni « Stabilité systémique ».

- [ ] **Étape 11 : commit** — `git commit -m "feat(v2): onglet État de la France par défaut, repris de la version en ligne et nettoyé"`.

---

### Tâche 8 : fraîcheur des données

**Fichiers :**
- Créer : `src/services/freshness.ts`, `src/services/freshness.test.ts`
- Modifier : `src/components/NationalHealthPanel.ts`
- Modifier : `src/components/fiche/france.ts`, `src/components/fiche/france.test.ts`
- Modifier : `src/services/work-queue.ts`, `src/services/work-queue.test.ts`
- Modifier : `src/services/ui-mode.ts`, `src/services/ui-mode.test.ts`, `src/App.ts`

Limite à signaler à l'utilisateur à la revue : l'instantané national ne porte pas la date de ses données d'énergie, de domaines ni de chronologie ; ces graphiques ne sont donc pas grisés dans cette tâche. Sont datés et contrôlés : la note de situation, les alertes sanitaires, les vigilances Météo-France (fin de validité) et la légende.

**Interfaces :**
- Produit : `FreshnessSource`, `FRESHNESS_MAX_AGE_MS`, `freshnessOf(dataAt: number | null, source, now): 'fresh' | 'stale'`, `parseDataDate(value): number | null`, `partitionByFreshness<T>(items, dateOf, source, now): { current: T[]; older: T[] }`, `dataDateLabel(dataAt, lang): string` ; `legendStatusLabel(uiV2: boolean, status: 'ok' | 'stale' | 'error'): string`.

- [ ] **Étape 1 : tests** — créer `src/services/freshness.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { dataDateLabel, freshnessOf, parseDataDate, partitionByFreshness } from './freshness.ts';

const NOW = Date.parse('2026-09-29T12:00:00Z');
const H = 3_600_000;

describe('freshness (spec 2026-09-29 § 8)', () => {
  it('au-delà du délai de sa source, une donnée est périmée', () => {
    expect(freshnessOf(NOW - 5 * H, 'meteo', NOW)).toBe('fresh');
    expect(freshnessOf(NOW - 7 * H, 'meteo', NOW)).toBe('stale');
    expect(freshnessOf(NOW - 13 * 24 * H, 'healthAlerts', NOW)).toBe('fresh');
    expect(freshnessOf(NOW - 15 * 24 * H, 'healthAlerts', NOW)).toBe('stale');
  });

  it('une donnée sans date est périmée', () => {
    expect(freshnessOf(null, 'brief', NOW)).toBe('stale');
    expect(parseDataDate('')).toBeNull();
    expect(parseDataDate('2026-05-03')).toBe(Date.parse('2026-05-03'));
  });

  it('sépare le courant du plus ancien', () => {
    const items = [{ d: '2026-09-28' }, { d: '2026-05-03' }, { d: '' }];
    const { current, older } = partitionByFreshness(items, (i) => parseDataDate(i.d), 'healthAlerts', NOW);
    expect(current).toEqual([{ d: '2026-09-28' }]);
    expect(older).toEqual([{ d: '2026-05-03' }, { d: '' }]);
  });

  it('« données du 28/09 à 16:00 » (heure de Paris), « date inconnue »', () => {
    expect(dataDateLabel(Date.parse('2026-09-28T14:00:00Z'), 'fr')).toBe('données du 28/09 à 16:00');
    expect(dataDateLabel(null, 'fr')).toBe('date inconnue');
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**, puis **implémenter** `src/services/freshness.ts` :

```ts
// src/services/freshness.ts — fraîcheur des données (spec 2026-09-29 § 8) : chaque donnée affichée
// porte sa propre date ; au-delà du délai de sa source elle est périmée (grisée, hors des listes
// « du moment »). Une donnée sans date est traitée comme périmée. Pur.

export type FreshnessSource =
  | 'meteo' | 'vigicrues' | 'ecowatt' | 'fuel' | 'sentinelles' | 'healthAlerts' | 'brief' | 'networkBarometer' | 'markets';

const H = 3_600_000;
const D = 24 * H;

export const FRESHNESS_MAX_AGE_MS: Record<FreshnessSource, number> = {
  meteo: 6 * H,
  vigicrues: 2 * H,
  ecowatt: 24 * H,
  fuel: 2 * D,
  sentinelles: 10 * D,
  healthAlerts: 14 * D,
  brief: 12 * H,
  networkBarometer: H,
  // « 1 jour ouvré » : 72 h couvrent le week-end (cours du vendredi lus le lundi matin).
  markets: 3 * D,
};

export type Freshness = 'fresh' | 'stale';

export function freshnessOf(dataAt: number | null, source: FreshnessSource, now: number): Freshness {
  if (dataAt === null || !Number.isFinite(dataAt)) return 'stale';
  return now - dataAt <= FRESHNESS_MAX_AGE_MS[source] ? 'fresh' : 'stale';
}

export function parseDataDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function partitionByFreshness<T>(
  items: readonly T[],
  dateOf: (item: T) => number | null,
  source: FreshnessSource,
  now: number,
): { current: T[]; older: T[] } {
  const current: T[] = [];
  const older: T[] = [];
  for (const item of items) (freshnessOf(dateOf(item), source, now) === 'fresh' ? current : older).push(item);
  return { current, older };
}

/** « données du 28/09 à 16:00 » (heure de Paris) ; « date inconnue ». */
export function dataDateLabel(dataAt: number | null, lang: 'fr' | 'en'): string {
  if (dataAt === null) return lang === 'fr' ? 'date inconnue' : 'unknown date';
  const locale = lang === 'fr' ? 'fr-FR' : 'en-GB';
  const d = new Date(dataAt);
  const date = d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', timeZone: 'Europe/Paris' });
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
  return lang === 'fr' ? `données du ${date} à ${time}` : `data from ${date} at ${time}`;
}
```

- [ ] **Étape 3 : « Alertes du moment »** — dans `NationalHealthPanel.renderAlertesDuMoment` (import `parseDataDate`, `partitionByFreshness` depuis `../services/freshness.ts`) :
1. Juste après la construction des trois `buckets` (avant le test `epidemicAlertsLoading`), séparer les alertes périmées :

```ts
    // Spec 2026-09-29 § 8 : au-delà de 14 jours, une alerte n'est plus « du moment ».
    const now = Date.now();
    const older: AlertItem[] = [];
    for (const bucket of ['rouge', 'orange', 'jaune'] as const) {
      const split = partitionByFreshness(buckets[bucket], (i) => parseDataDate(i.date), 'healthAlerts', now);
      buckets[bucket] = split.current;
      older.push(...split.older);
    }
    const olderGroup = older.length > 0
      ? `<details style="margin-bottom:6px; opacity:0.7;"><summary style="cursor:pointer; padding:7px 10px; color:#9898a8; font-size:11px;">Plus anciennes (${older.length})</summary>`
        + `<div style="padding:8px 0 2px;">${older.sort((a, b) => b.date.localeCompare(a.date)).map((i) => i.html).join('')}</div></details>`
      : '';
```

2. Ajouter `${olderGroup}` à la fin des deux rendus (« Aucune alerte active à ce stade. » et le rendu des groupes).

- [ ] **Étape 4 : note périmée** — test à ajouter à `france.test.ts` :

```ts
  it('note périmée (plus de 12 h) : grisée, avec sa date', () => {
    const note = buildFranceFiche(input({ briefMeta: { at: NOW - 13 * H, level: 'orange' } })).sections
      .find((s) => s.title === 'Note de situation')?.html ?? '';
    expect(note).toContain('fiche-stale');
    expect(note).toContain('données du');
  });
```

puis, dans `noteHtml` (import `dataDateLabel`, `freshnessOf`), remplacer le `return` final par

```ts
  const body = `<p>${escapeHtml(brief.bluf)}</p>${judgments}${watch}${meta}${briefOrigin(input.brief, lang)}`;
  const at = input.briefMeta?.at ?? null;
  if (freshnessOf(at, 'brief', input.now) === 'fresh') return body;
  return `<div class="fiche-stale"><p class="fiche-meta">${escapeHtml(dataDateLabel(at, lang))}</p>${body}</div>`;
```

et ajouter à `main.css` : `#app.ui-v2 .fiche-stale { opacity: 0.6; }`.

- [ ] **Étape 5 : vigilance échue hors du fil** — test à ajouter à `work-queue.test.ts` :

```ts
  it('une vigilance Météo-France échue sort du fil', () => {
    const ended = { ...meteo('Var', 'orange'), endDate: new Date(NOW - H) };
    expect(officialAlertGroups(null, [ended], [], NOW)).toEqual([]);
  });
```

puis, dans `officialEntries` (boucle `for (const alert of meteo)`), en première ligne : `if (alert.endDate && alert.endDate.getTime() < nowMs) continue; // vigilance échue (spec 2026-09-29 § 8)`.

- [ ] **Étape 6 : légende sans « TEMPS RÉEL » (v2)** — test à ajouter à `ui-mode.test.ts` :

```ts
describe('legendStatusLabel (spec 2026-09-29 § 8)', () => {
  it('v2 : l’état de récupération, pas une promesse de temps réel', () => {
    expect(['ok', 'stale', 'error'].map((s) => legendStatusLabel(true, s as 'ok' | 'stale' | 'error'))).toEqual(['À JOUR', 'EN RETARD', 'INDISPONIBLE']);
  });
  it('v1 : inchangé', () => {
    expect(legendStatusLabel(false, 'ok')).toBe('TEMPS RÉEL');
    expect(legendStatusLabel(false, 'stale')).toBe('CACHE FIGÉ');
  });
});
```

puis ajouter à `ui-mode.ts` :

```ts
/** Libellé d'état d'une source dans la légende ; v2 : l'état de la récupération, jamais « temps réel ». */
export function legendStatusLabel(uiV2: boolean, status: 'ok' | 'stale' | 'error'): string {
  if (status === 'ok') return uiV2 ? 'À JOUR' : 'TEMPS RÉEL';
  if (status === 'stale') return uiV2 ? 'EN RETARD' : 'CACHE FIGÉ';
  return 'INDISPONIBLE';
}
```

et remplacer le corps de `formatLegendSourceStatus` dans `App.ts` par `return legendStatusLabel(this.uiV2, status);`.

- [ ] **Étape 7 : vérifications** — `npm run typecheck`, `npx vitest run`, `npm run build`.

- [ ] **Étape 8 : contrôle visuel** — panneau Santé ouvert à la demande : les alertes hantavirus de mai sous « Plus anciennes », plus sous « Alertes du moment » ; légende sans « TEMPS RÉEL ».

- [ ] **Étape 9 : commit** — `git commit -m "feat(v2): fraîcheur des données — dates, délais par source, rien de périmé présenté comme actuel"`.

---

### Tâche 9 : en-tête sur deux lignes

**Fichiers :**
- Modifier : `src/App.ts` (`renderShell`, construction de `v2Roots`), `src/styles/main.css`

Choix d'implémentation à signaler à l'utilisateur à la revue : le détail des sources reste la liste déroulante « SOURCES » de la ligne 1 (elle affiche déjà les sources indisponibles) au lieu d'être déplacé dans ⋯ ; l'heure de mise à jour est dans l'en-tête de l'onglet État (tâche 7) ; l'horloge et le voyant « live » sont masqués en v2.

- [ ] **Étape 1 : déplacements (v2)** — dans `renderShell`, remplacer l'`innerHTML` de `v2Bar` par `'<div class="fm-v2-themes"></div><div class="fm-v2-tools"></div>'`, puis ajouter JUSTE APRÈS `this.bindSidebarToggle(header);` :

```ts
    if (this.uiV2 && v2Bar) {
      // En-tête sur deux lignes (spec 2026-09-29 § 4) : l'état national dans l'en-tête, à la place des
      // régions ; régions et bouton Couches sur la ligne des thèmes ; « Sources & qualité » dans ⋯.
      const status = document.createElement('div');
      status.className = 'fm-v2-status';
      const tools = v2Bar.querySelector<HTMLElement>('.fm-v2-tools');
      const regions = header.querySelector<HTMLElement>('#region-presets');
      const layersToggle = header.querySelector<HTMLElement>('[data-sidebar-toggle]');
      if (regions && tools) {
        regions.replaceWith(status);
        tools.append(regions);
      }
      if (layersToggle && tools) tools.append(layersToggle);
      header.querySelector('a.header-quality-link')?.remove();
      header.querySelector('[data-overflow-menu]')?.insertAdjacentHTML('afterbegin',
        '<a class="header-overflow-menu__item" role="menuitem" href="/sources-quality">Sources & qualité</a>');
    }
```

Vérifier par `grep -n "region-presets" src/` que les régions sont rendues via `document.getElementById('region-presets')` (déplacer l'élément ne casse alors rien) ; sinon adapter l'appel pour chercher dans `document`.

- [ ] **Étape 2 : racines v2** — chercher `const status = v2Bar.querySelector<HTMLElement>('.fm-v2-status');` et remplacer par `const status = this.container.querySelector<HTMLElement>('.fm-v2-status');`.

- [ ] **Étape 3 : CSS** — ajouter à la fin de `main.css` :

```css
#app.ui-v2 .header-clock, #app.ui-v2 .header-live-dot { display: none; }
#app.ui-v2 .header .fm-v2-status { min-width: 0; overflow: hidden; }
#app.ui-v2 .fm-v2-bar { flex-direction: row; align-items: center; gap: 12px; padding: 6px 14px; }
#app.ui-v2 .fm-v2-themes { flex: 1 1 auto; min-width: 0; }
#app.ui-v2 .fm-v2-tools { display: flex; align-items: center; gap: 8px; flex: none; }
#app.ui-v2 .sb-fresh { display: none; } /* la liste « SOURCES » de l'en-tête le dit déjà */
@media (min-width: 1101px) {
  #app.ui-v2 .header { grid-template-columns: auto minmax(0, 1fr) auto; }
}
```

- [ ] **Étape 4 : vérifications** — `npm run typecheck`, `npx vitest run`, `npm run build`.

- [ ] **Étape 5 : contrôle visuel** — bureau : ligne 1 = logo, niveau national et « tirée par », SOURCES, FR/EN, ⋯ ; ligne 2 = thèmes, Régions, Couches ; aucun chevauchement, rien de coupé. Téléphone (390 px) : rien ne déborde. Menu ⋯ : « Sources & qualité », « Note de situation », « Export », navigables au clavier.

- [ ] **Étape 6 : commit** — `git commit -m "feat(v2): en-tête sur deux lignes"`.

---

### Tâche 10 : la v2 devient l'interface par défaut

**À n'exécuter qu'après l'accord explicite de l'utilisateur, donné sur écran après les tâches 1 à 9.**

**Fichiers :**
- Modifier : `src/services/ui-mode.ts`, `src/services/ui-mode.test.ts`

- [ ] **Étape 1 : tests** — remplacer, dans `ui-mode.test.ts`, les attentes d'`isUiV2` par :

```ts
describe('isUiV2 (spec 2026-09-29 § 10)', () => {
  it('la v2 par défaut ; l’ancienne interface par ?ui=v1', () => {
    expect(isUiV2('')).toBe(true);
    expect(isUiV2('?view=app')).toBe(true);
    expect(isUiV2('?ui=v2')).toBe(true);
    expect(isUiV2('?ui=v1')).toBe(false);
  });
});
```

- [ ] **Étape 2 : implémenter**

```ts
/** v2 par défaut depuis la validation de la refonte (spec 2026-09-29 § 10) ; ?ui=v1 garde l'ancienne interface. */
export function isUiV2(search: string): boolean {
  return new URLSearchParams(search).get('ui') !== 'v1';
}
```

Mettre à jour le commentaire d'en-tête du fichier. Vérifier par `grep -rn "ui=v2\|isUiV2" src/` qu'aucun autre code ne suppose la v1 par défaut.

- [ ] **Étape 3 : vérifications** — `npm run typecheck`, `npx vitest run`, `npm run build` ; captures sur `http://localhost:3001/?view=app` (v2) et `?view=app&ui=v1` (ancienne interface intacte).

- [ ] **Étape 4 : commit** — `git commit -m "feat: la v2 « carte d'abord » devient l'interface par défaut (?ui=v1 pour l'ancienne)"`.

---

## Après les tâches

- Revue finale de la branche (méthode choisie), PR vers `main`, fusion par l'utilisateur ; le déploiement VM part de la fusion.
- Mettre à jour la mémoire du projet (refonte UI, étape 3) et `docs/` si une procédure change.
