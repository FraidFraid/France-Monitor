# Refonte UI, étape 2 : disposition A1 derrière `?ui=v2` — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer, derrière le paramètre d'URL `?ui=v2`, l'écran « poste de situation » A1 : bandeau d'état, barre de thèmes, liste « À traiter » avec garde hors thème, fiche unique (France, thème, événement, et aussi situation, alerte, alerte officielle, marché), mobile en trois onglets et tablette en volet ; retirer de la v2 `AlertMonitor`, la pastille convergences, `SituationBrief`, `SituationMonitor` et le tiroir, sans retirer aucune fonction (spec §14). L'interface actuelle reste celle par défaut.

**Architecture:** Des modules purs décident (`themes.ts`, `work-queue.ts`, `situation-text.ts`, `components/fiche/*.ts`), des composants DOM minces affichent (`components/poste/StatusBar.ts`, `ThemeBar.ts`, `WorkList.ts`, `FichePanel.ts`), un contrôleur `PosteSituation.ts` garde tout l'état d'interface dans des objets. `App.ts` charge ce contrôleur par `import()` seulement quand `?ui=v2` est présent, et lui passe à chaque rafraîchissement les données déjà en cache ; en v2, il ne crée ni `AlertMonitor`, ni `SituationMonitor`, ni `SituationBrief`, ni le tiroir, et lance le brief, les événements et la ligne de base de visite dès que les couches critiques sont chargées.

**Tech Stack:** TypeScript strict (vanilla DOM), Vite 7, vitest 4 (Node ; happy-dom pour les composants), handlers Vercel en JavaScript (aucun modifié).

**Spec:** `docs/superpowers/specs/2026-09-24-refonte-ui-poste-de-situation-design.md` (§3, §5, §6, §7, §9, §10, §11 étape 2, §12, §14). Plan de référence pour le format : `docs/superpowers/plans/2026-09-24-ui-etape1-langage-commun.md` (exécuté, en production).

**Branche :** `feat/ui-disposition-a1`, créée depuis `main` (474755ae, en production). Ne jamais pousser `main` : l'utilisateur décide de la fusion.

```bash
cd /Users/fraid/Desktop/FranceMonitor
git switch main && git pull --ff-only
git worktree add -b feat/ui-disposition-a1 .worktrees/ui-disposition-a1 main
cd .worktrees/ui-disposition-a1 && npm ci
```

## Global Constraints

- Aucune fonctionnalité retirée (spec §14) : la v2 est optionnelle, activée par `?ui=v2` ; l'interface actuelle reste l'interface par défaut jusqu'à la fin de l'étape 3 ; les deux doivent fonctionner à chaque commit.
- TypeScript `strict: true`, aucun `any`, aucun `!` non justifié ; `erasableSyntaxOnly` (pas de propriétés de paramètre de constructeur, pas d'`enum`) ; vanilla DOM, pas de JSX.
- Commentaires et libellés en français ; l'anglais n'existe que pour la bascule EN.
- Modules de rendu et de sélection purs, sans DOM ni réseau, testés sous vitest (Node) ; composants testés sous happy-dom (`// @vitest-environment happy-dom`) quand il le faut ; tout nouveau module est chargé par `import()` depuis `App.ts`, hors du chunk critique (seul `src/services/ui-mode.ts`, trois lignes, est importé statiquement, par `main.ts` et `App.ts`).
- Le tiroir et les panneaux sont reconstruits par `innerHTML` une vingtaine de fois au démarrage : tout l'état d'interface (sélection, thème, volets ouverts, onglet mobile, ligne focalisée) vit dans des objets, jamais dans le DOM ; le focus clavier survit aux reconstructions.
- Fixtures de calibration du score v3 (`src/services/france-country-intel.test.ts`) intouchées ; couleurs officielles Écowatt, Météo-France et Vigicrues de la carte intouchées.
- Paliers gratuits seulement ; aucun service payant ; aucun nouveau fichier de fonction Vercel (la limite Hobby est gardée par `tests/api-router.test.ts`) ; ce plan ne touche pas `api/`.
- Tout texte tiers est échappé ; seuls les liens http(s) sont cliquables.
- Échelle L1 et libellés : ceux de `src/services/vigilance.ts` (étape 1) ; le mot accompagne toujours la couleur.
- Clôture de chaque tâche : `npx vitest run`, `npm run typecheck`, `npm run lint`, `npm run build`. La tâche 12 vérifie dans Chrome sans interface, à 1 440, 1 280, 820 et 390 px (première visite, rien à traiter, historique indisponible, données factices), et parcourt la table §14 en v2.
- Un commit par tâche, sur `feat/ui-disposition-a1` uniquement. Ne pas lancer le serveur de développement contre la base : `DATABASE_URL` des fichiers d'environnement pointe sur la production (toujours `DATABASE_URL= GROQ_API_KEY= npx vite …`).

## Arbitrages pris à l'écriture du plan (à confirmer par l'utilisateur)

| # | Arbitrage | Coût s'il est faux |
|---|---|---|
| A1 | **Conflit §11 / §14.** Le §11 ne livre à l'étape 2 que les fiches France, thème et événement, mais l'étape 2 retire `AlertMonitor` et `SituationMonitor` de la v2, alors que le §14 exige que le détail d'alerte, le lien source, le dossier grands feux, le détail de situation et le centrage carte restent accessibles à chaque étape. **Décision : l'étape 2 livre aussi les fiches situation et alerte** (même rendu, contenu repris des détails existants : résumé, facteurs, zones, actions, sources, lien http(s), dossier, « Voir sur la carte »), ainsi que deux fiches minimales, alerte officielle et marché, pour que toute ligne de la liste s'ouvre en un clic (§2). L'étape 3 garde les fiches région et navire/aéronef. | Une tâche de plus (tâche 8, ≈ 300 lignes et leurs tests). Si l'utilisateur préfère les reporter, la v2 de l'étape 2 perd le détail des alertes et des situations, donc enfreint le §14. |
| A2 | Les alertes `WEATHER_ALERT` du panneau d'alertes (deux départements au plus, durée de vie 30 min) sont couvertes par les lignes officielles « Vigilance météo orange/rouge », regroupées par niveau, qui listent **tous** les départements et leurs risques dans la fiche. | Présentation différente de l'ancien panneau (une ligne par niveau, pas par département). |
| A3 | Les alertes presse (`NEWS_ALERT`) restent dans la liste, dédoublonnées d'un événement consolidé de même titre (titres normalisés, préfixe commun d'au moins 20 caractères) ; les incendies majeurs (`WILDFIRE_ESCALATION`) sont dédoublonnés par identifiant avec la situation du moteur. | Au pire une ligne en double quand les titres diffèrent. |
| A4 | Badges « NOUVEAU » / « AGGRAVÉ » : les événements utilisent le fil serveur (`digest`) ; les autres éléments comparent à une **ligne de base de niveaux** enregistrée en même temps que l'ancre de visite (`localStorage`, figée par onglet, 300 clés au plus). Première visite : pas de badge pour les situations. Les majuscules des badges suivent le §7.2 (exception explicite au §4.3). | Une clé `localStorage` de plus ; aucun badge de situation à la toute première visite en v2. |
| A5 | En étape 2, choisir un thème filtre la liste et la fiche et **applique la vue de couches existante** (`applyLayerPreset`) ; la carte « limitée à l'essentiel » reste à l'étape 3. Le choix d'une vue dans « Couches » met aussi le thème à jour. | La carte montre toutes les couches de la vue, pas seulement les lieux de la liste. |
| A6 | Les 35 couches restent dans la barre latérale existante, repliée par défaut en v2 et ouverte par le bouton d'en-tête existant, libellé « Couches » à toutes les largeurs. Les panneaux par source restent des panneaux flottants jusqu'à l'étape 3 : le critère §2 « aucun panneau ne recouvre la carte » n'est pas encore atteint à l'étape 2. | Un clic de plus pour les couches en v2 jusqu'à l'étape 3. |
| A7 | Les sous-scores du moteur (« Score cyber consolidé : 63/100 », « Ransomware : 25/25 », phrases chiffrées des résumés) passent dans « Pourquoi ce niveau ? » **de la fiche situation v2** ; le tiroir et les moniteurs v1, retirés à l'étape 3, ne changent pas. Les valeurs anglaises du moteur carburant (`HIGH`, `tense`, `CRITICAL`) sont traduites à la source, et le brief de repli déterministe ne recopie plus les phrases chiffrées des résumés (v1 et v2). | La v1 garde ces sous-scores dans le tiroir et les moniteurs jusqu'à l'étape 3. |
| A8 | Note de situation en L1 : badges Rouge/Orange/Jaune/Vert sur les teintes officielles, texte noir ; l'indice ISNR (plus haut = pire) passe en L1 par `isnrLevel` en gardant ses bornes 20/40/60, « élevé » et « critique » fusionnant en rouge comme l'indice national. | Libellé de l'ISNR différent si l'utilisateur voulait d'autres bornes. |
| A9 | `TELECOM_DISRUPTION` est rattaché à « Environnement et transports » (catégorie `infrastructure` du tableau §7.3), bien que la vue « Sécurité et défense » affiche les couches de pannes télécom. | Une situation télécom n'apparaît pas sous « Sécurité et défense ». |
| A10 | « <n> éléments suivis sont au vert » compte les événements ouverts au vert, les sources officielles entièrement au vert et les lignes de marché sous leur seuil, par thème. | Définition à ajuster si l'utilisateur en attend une autre. |
| A11 | En v2, le brief est demandé dès le chargement des couches critiques (et non à l'ouverture du tiroir), puis toutes les 6 h et à chaque changement de couleur stabilisé ; les événements sont relus toutes les 5 min (cache CDN `s-maxage=60`). | Deux requêtes `/api/events*` par client toutes les 5 min, dans le palier gratuit. |
| A12 | Le mot du niveau est ajouté aussi dans les lignes v1 qui n'avaient que la couleur (lignes d'événements du tiroir, lignes du bandeau de convergences). | Aucun. |
| A13 | Tant que les couches critiques ne sont pas chargées (plus de 30 s à froid), la v2 n'affiche aucun niveau national ni de thème (« Calcul du niveau national… ») : l'indice calculé sur des données absentes sort « vert ». | Une trentaine de secondes sans niveau au premier chargement. |
| A14 | En v2, l'en-tête garde ses éléments et gagne le bouton « Couches » : quatre colonnes au-delà de 1 100 px, flux replié sous 769 px (sans ces règles, le titre chevauche l'état à 390 px). La réorganisation de l'en-tête du §5.1 reste à l'étape 3. | Aucun sur l'interface par défaut (règles préfixées). |

## Review Focus

- **Ligne de base figée après un enregistrement** : si `recordVisitBaseline` passait avant `beginVisitBaseline` dans l'onglet, la ligne de base serait l'état courant et aucun badge « NOUVEAU » n'apparaîtrait jamais. Test dans la tâche 1 ; ordre imposé dans `startV2Intel` (tâche 11).
- **Focus clavier pendant les ~20 reconstructions du démarrage** : la ligne focalisée garde le focus quand ses données changent, et si elle disparaît, le focus va à la première ligne, jamais au `body`. Test dans la tâche 9.
- **Élément sélectionné qui disparaît** (alerte expirée, situation résolue) : la fiche revient à la fiche par défaut sans exception, la sélection est effacée, et le focus qui était dans la fiche va sur son titre. Test dans la tâche 10.
- **Chaînes hostiles** : titres d'événement avec balises, identifiants de situation avec guillemets dans `data-select`/`data-key`, liens d'articles ou d'alertes en `javascript:`. Tests dans les tâches 7 et 8.
- **Vert rassurant au démarrage** : avant le chargement des couches critiques (plus de 30 s à froid), l'indice national est calculé sur des données absentes et sort « vert » ; la v2, toujours visible, l'afficherait (constaté lors de la vérification du plan). Tant que `ready` est faux : « Calcul du niveau national… », aucune pastille de thème, fiche France sans niveau, liste vide dite « Chargement des données… ». Tests dans les tâches 9 et 10. (La garde hors thème d'un rouge « Vue générale » seulement reste testée dans la tâche 3.)

## Hors périmètre de ce plan (étape 3)

- Carte limitée aux lieux de la liste, boutons « Couches » et « Légende » posés sur la carte, légendes derrière un bouton.
- Conversion des panneaux par source (Écowatt, pétrole, gaz, nucléaire, éolien, maritime, feux, santé, cyber, défense…) en fiches de thème : en étape 2 ils restent des panneaux flottants, accessibles comme aujourd'hui.
- Fiches région et navire/aéronef ; un clic sur un point de carte qui ouvre une fiche (onglet « Carte » du mobile).
- En-tête du §5.1 (« Note de situation », « Tableaux » dans l'en-tête), page « Modules » renommée « Tableaux » : l'étape 2 garde le menu « ⋯ » et la page actuelle.
- Heure « depuis » des éléments déjà présents au chargement : l'étape 2 ne la connaît que pour ceux apparus pendant la session (après 2 min de chauffe).
- Retrait de l'interface v1 et du paramètre `?ui=v2`.

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `src/services/ui-mode.ts` (créé) | `isUiV2(search)` |
| `src/services/themes.ts` (créé, + test) | Thèmes, libellés, rattachement des catégories et des situations, « tirée par » |
| `src/services/intel-last-visit.ts` (+ test) | Ligne de base des niveaux de la visite |
| `src/services/work-queue.ts` (créé, + test) | Liste « À traiter » : entrées, niveaux, badges, tri, vue par thème, garde, thèmes qui tirent |
| `src/services/situation-text.ts` (créé, + test) | Sépare les sous-scores chiffrés du moteur |
| `src/services/france-intel-brief.ts` (+ test) | Jugements du brief de repli sans phrase chiffrée |
| `src/services/situation-engine.ts` (+ test) | Valeurs carburant en français |
| `src/services/vigilance.ts` (+ test) | `formatSignedPct` exporté, `isnrLevel` |
| `src/services/situation-report.ts` (+ test), `src/components/SituationReport.ts` (+ test créé) | Note de situation en L1 |
| `src/components/france-intel-events.ts` (+ test), `src/components/SituationBrief.ts` (+ test) | Mot du niveau dans les lignes |
| `src/components/france-intel-blocks.ts` (créé, + test) | Blocs Domaines, Énergie, Chronologie en rendus purs |
| `src/components/france-intel-score.ts` (+ test) | `renderWhyBody`, `trendText` exportés |
| `src/components/FranceIntelPanel.ts` | Délègue aux blocs extraits |
| `src/components/fiche/parts.ts`, `france.ts`, `items.ts` (créés, + tests) | Modèle et rendu de la fiche unique, par type |
| `src/components/poste/StatusBar.ts`, `ThemeBar.ts`, `WorkList.ts`, `FichePanel.ts`, `PosteSituation.ts` (créés, + tests) | Composants et contrôleur de la v2 |
| `src/components/StatusPanel.ts` (+ test créé) | `getSources()` |
| `src/types/index.ts` | `DetectedSituation.category` (optionnel) |
| `src/App.ts`, `src/main.ts` | Bascule v2, intégration |
| `src/styles/main.css`, `tests/css-ui-v2.test.ts` (créé) | Styles, tous préfixés par `#app.ui-v2` pour la mise en page |

---

### Task 1: Bascule `?ui=v2`, thèmes et ligne de base de visite

**Files:**
- Create: `src/services/ui-mode.ts`
- Create: `src/services/themes.ts`
- Test: `src/services/themes.test.ts`
- Modify: `src/services/intel-last-visit.ts`, test `src/services/intel-last-visit.test.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes : `LayerPresetId`, `LAYER_PRESETS` (`src/config/layer-presets.ts`) ; `SituationType` ; `VigilanceLevel` (étape 1).
- Produces : `isUiV2(search: string): boolean` ; `type ThemeId = LayerPresetId` ; `type SpecificThemeId = Exclude<ThemeId, 'general'>` ; `THEMES` ; `SPECIFIC_THEMES` ; `themeLabel(id, lang?)` ; `drivenByText(themes, lang?)` ; `categoryTheme(category: string): ThemeId` ; `situationTheme(type: SituationType, category?: string): ThemeId` ; `inTheme(itemTheme, selected): boolean` ; `type VisitBaseline = Readonly<Record<string, VigilanceLevel>>` ; `parseVisitBaseline(raw)` ; `beginVisitBaseline(stores?)` ; `recordVisitBaseline(levels, stores?)`.

- [ ] **Step 1: Write the failing tests**

Créer `src/services/themes.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { THEMES, categoryTheme, drivenByText, inTheme, situationTheme, themeLabel } from './themes.ts';
import { LAYER_PRESETS } from '../config/layer-presets.ts';
import { isUiV2 } from './ui-mode.ts';

describe('isUiV2', () => {
  it('n’active la nouvelle interface que sur ?ui=v2', () => {
    expect(isUiV2('?ui=v2')).toBe(true);
    expect(isUiV2('?view=app&ui=v2')).toBe(true);
    expect(isUiV2('')).toBe(false);
    expect(isUiV2('?ui=v1')).toBe(false);
    expect(isUiV2('?ui=V2')).toBe(false);
  });
});

describe('thèmes (spec §5.3, §7.3)', () => {
  it('reprennent les cinq vues de layer-presets, dans le même ordre, avec les libellés de la spec', () => {
    expect(THEMES.map((th) => th.id)).toEqual(LAYER_PRESETS.map((p) => p.id));
    expect(themeLabel('security')).toBe('Sécurité et défense');
    expect(themeLabel('environment')).toBe('Environnement et transports');
    expect(themeLabel('general', 'en')).toBe('Overview');
  });

  it('rattachent les catégories selon le tableau §7.3', () => {
    expect(categoryTheme('energy')).toBe('energy');
    for (const c of ['security', 'cyber', 'social']) expect(categoryTheme(c)).toBe('security');
    expect(categoryTheme('health')).toBe('health');
    for (const c of ['weather', 'floods', 'fires', 'transport', 'infrastructure']) expect(categoryTheme(c)).toBe('environment');
    for (const c of ['finance', 'general', 'inconnue']) expect(categoryTheme(c)).toBe('general');
  });

  it('rattachent situations et alertes ; une alerte presse suit la catégorie de son article', () => {
    expect(situationTheme('FUEL_SUPPLY_RISK')).toBe('energy');
    expect(situationTheme('DEFENSE_ALERT')).toBe('security');
    expect(situationTheme('TELECOM_DISRUPTION')).toBe('environment');
    expect(situationTheme('NEWS_ALERT')).toBe('general');
    expect(situationTheme('NEWS_ALERT', 'cyber')).toBe('security');
  });

  it('« Vue générale » montre tout, un thème ne montre que les siens', () => {
    expect(inTheme('energy', 'general')).toBe(true);
    expect(inTheme('general', 'energy')).toBe(false);
    expect(inTheme('energy', 'energy')).toBe(true);
  });

  it('« tirée par » : deux thèmes au plus, sinon « sans pression dominante »', () => {
    expect(drivenByText(['energy'])).toBe('tirée par l’énergie');
    expect(drivenByText(['energy', 'health'])).toBe('tirée par l’énergie et la santé');
    expect(drivenByText([])).toBe('sans pression dominante');
    expect(drivenByText(['security'], 'en')).toBe('driven by security and defence');
  });
});
```

Dans `src/services/intel-last-visit.test.ts`, remplacer la ligne d'import :

```ts
import { beginIntelVisit, recordIntelVisitSeen, resolveVisitAnchor, type VisitStorage } from './intel-last-visit.ts';
```

par :

```ts
import {
  beginIntelVisit,
  beginVisitBaseline,
  parseVisitBaseline,
  recordIntelVisitSeen,
  recordVisitBaseline,
  resolveVisitAnchor,
  type VisitStorage,
} from './intel-last-visit.ts';
```

et ajouter à la fin du fichier :

```ts
describe('ligne de base des niveaux (badges nouveau/aggravé, refonte UI étape 2)', () => {
  it('fige pour l’onglet les niveaux de la visite précédente, même après un nouvel enregistrement', () => {
    const local = memory();
    const tab = { local, session: memory() };
    expect(beginVisitBaseline(tab)).toBeNull(); // première visite : aucun badge de situation
    recordVisitBaseline({ 'situation:energy-stress': 'orange' }, tab);
    // Revue : si l'enregistrement remplaçait la ligne de base de l'onglet, aucun badge n'apparaîtrait jamais.
    expect(beginVisitBaseline(tab)).toBeNull();
    expect(beginVisitBaseline({ local, session: memory() })).toEqual({ 'situation:energy-stress': 'orange' });
  });

  it('ignore une valeur illisible et les niveaux inconnus', () => {
    expect(parseVisitBaseline('{')).toBeNull();
    expect(parseVisitBaseline('[1]')).toBeNull();
    expect(parseVisitBaseline('null')).toBeNull();
    expect(parseVisitBaseline('{"a":"rouge","b":"violet","c":3}')).toEqual({ a: 'rouge' });
  });

  it('borne le nombre de clés enregistrées et fonctionne sans stockage', () => {
    const local = memory();
    const levels = Object.fromEntries(Array.from({ length: 400 }, (_, i): [string, 'jaune'] => [`k${i}`, 'jaune']));
    recordVisitBaseline(levels, { local, session: memory() });
    expect(Object.keys(JSON.parse(local.data.get('fm:intel:last-seen-levels') ?? '{}')).length).toBe(300);
    expect(beginVisitBaseline({ local: null, session: null })).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/themes.test.ts src/services/intel-last-visit.test.ts`
Expected: FAIL, `Cannot find module './themes.ts'` ; `beginVisitBaseline is not a function`.

- [ ] **Step 3: Write the implementation**

Créer `src/services/ui-mode.ts` :

```ts
// src/services/ui-mode.ts — bascule de la nouvelle interface « poste de situation » (refonte UI,
// spec §10) : `?ui=v2` active la disposition A1 pendant les étapes 2 et 3. Sans ce paramètre,
// l'interface actuelle reste celle par défaut. Module minuscule : main.ts et App.ts l'importent
// statiquement sans alourdir le chemin critique.

export function isUiV2(search: string): boolean {
  return new URLSearchParams(search).get('ui') === 'v2';
}
```

Créer `src/services/themes.ts` :

```ts
// src/services/themes.ts — thèmes de la barre de thèmes (refonte UI, spec §5.3 et §7.3). Les cinq
// thèmes reprennent les cinq vues de src/config/layer-presets.ts (mêmes identifiants) ; ce module
// dit à quel thème appartient chaque élément de la liste « À traiter ». Pur, sans DOM.

import type { SituationType } from '../types/index.ts';
import type { LayerPresetId } from '../config/layer-presets.ts';

export type ThemeId = LayerPresetId;
export type SpecificThemeId = Exclude<ThemeId, 'general'>;
type Lang = 'fr' | 'en';

interface ThemeDef {
  id: ThemeId;
  fr: string;
  en: string;
  /** Complément de « tirée par … ». */
  driverFr: string;
  driverEn: string;
}

export const THEMES: ReadonlyArray<ThemeDef> = [
  { id: 'general', fr: 'Vue générale', en: 'Overview', driverFr: 'l’ensemble', driverEn: 'overall' },
  { id: 'energy', fr: 'Énergie', en: 'Energy', driverFr: 'l’énergie', driverEn: 'energy' },
  { id: 'security', fr: 'Sécurité et défense', en: 'Security and defence', driverFr: 'la sécurité et la défense', driverEn: 'security and defence' },
  { id: 'health', fr: 'Santé', en: 'Health', driverFr: 'la santé', driverEn: 'health' },
  { id: 'environment', fr: 'Environnement et transports', en: 'Environment and transport', driverFr: 'l’environnement et les transports', driverEn: 'environment and transport' },
];

/** Thèmes proprement dits : « Vue générale » les montre tous. */
export const SPECIFIC_THEMES: ReadonlyArray<SpecificThemeId> = ['energy', 'security', 'health', 'environment'];

function def(id: ThemeId): ThemeDef {
  return THEMES.find((th) => th.id === id) ?? THEMES[0];
}

export function themeLabel(id: ThemeId, lang: Lang = 'fr'): string {
  const d = def(id);
  return lang === 'fr' ? d.fr : d.en;
}

/** « tirée par l'énergie et la santé » ; « sans pression dominante » quand aucun thème ne tire. */
export function drivenByText(themes: readonly ThemeId[], lang: Lang = 'fr'): string {
  if (themes.length === 0) return lang === 'fr' ? 'sans pression dominante' : 'no dominant pressure';
  const parts = themes.map((id) => (lang === 'fr' ? def(id).driverFr : def(id).driverEn));
  return lang === 'fr' ? `tirée par ${parts.join(' et ')}` : `driven by ${parts.join(' and ')}`;
}

/** Catégorie d'article ou d'événement → thème (tableau §7.3) ; finance, general et l'inconnu → Vue générale. */
export function categoryTheme(category: string): ThemeId {
  switch (category) {
    case 'energy':
      return 'energy';
    case 'security':
    case 'cyber':
    case 'social':
      return 'security';
    case 'health':
      return 'health';
    case 'weather':
    case 'floods':
    case 'fires':
    case 'transport':
    case 'infrastructure':
      return 'environment';
    default:
      return 'general';
  }
}

const SITUATION_THEME: Record<SituationType, ThemeId> = {
  ENERGY_STRESS: 'energy',
  IMPORT_DEPENDENCY_RISK: 'energy',
  FUEL_SUPPLY_RISK: 'energy',
  CYBER_PRESSURE: 'security',
  SOCIAL_ESCALATION: 'security',
  MARITIME_ANOMALY: 'security',
  DEFENSE_SIGNAL_ELEVATED: 'security',
  MILITARY_SURGE_ALERT: 'security',
  AIS_ANOMALY_ALERT: 'security',
  DEFENSE_ALERT: 'security',
  GPS_JAMMING_ALERT: 'security',
  FLOOD_CRISIS: 'environment',
  WILDFIRE_ESCALATION: 'environment',
  WEATHER_ALERT: 'environment',
  // Catégorie « infrastructure » du tableau §7.3 (arbitrage A9).
  TELECOM_DISRUPTION: 'environment',
  NEWS_ALERT: 'general',
};

/** Thème d'une situation du moteur ou d'une alerte ; une alerte presse suit la catégorie de son article. */
export function situationTheme(type: SituationType, category?: string): ThemeId {
  if (type === 'NEWS_ALERT' && category !== undefined) return categoryTheme(category);
  return SITUATION_THEME[type];
}

/** « Vue générale » montre tout ; un thème ne montre que ses éléments. */
export function inTheme(itemTheme: ThemeId, selected: ThemeId): boolean {
  return selected === 'general' || itemTheme === selected;
}
```

Dans `src/services/intel-last-visit.ts`, remplacer :

```ts
import type { IntelVisitAnchor } from '../types/index.ts';

const LAST_SEEN_KEY = 'fm:intel:last-seen';
const ANCHOR_KEY = 'fm:intel:visit-anchor';
```

par :

```ts
import type { IntelVisitAnchor } from '../types/index.ts';
import type { VigilanceLevel } from './vigilance.ts';

const LAST_SEEN_KEY = 'fm:intel:last-seen';
const ANCHOR_KEY = 'fm:intel:visit-anchor';
const LEVELS_KEY = 'fm:intel:last-seen-levels';
const BASELINE_KEY = 'fm:intel:visit-baseline';
const MAX_BASELINE_KEYS = 300;
```

et ajouter à la fin du fichier :

```ts
// ─── Ligne de base des niveaux (refonte UI étape 2, arbitrage A4) ──────────────────────────
// Les événements ont leur fil de changements serveur ; les autres éléments « À traiter »
// (situations, alertes, alertes officielles, marchés) sont comparés aux niveaux vus à la visite
// précédente pour les badges « nouveau » et « aggravé ». Même principe que l'ancre : la valeur
// de localStorage est figée pour l'onglet dans sessionStorage à la première lecture.

/** Niveau de chaque élément « À traiter » (clé de liste → couleur L1) vu à la dernière visite. */
export type VisitBaseline = Readonly<Record<string, VigilanceLevel>>;

const LEVEL_VALUES: readonly VigilanceLevel[] = ['vert', 'jaune', 'orange', 'rouge'];

/** Pur : relit une ligne de base stockée ; toute valeur illisible donne null (aucun badge plutôt qu'un faux). */
export function parseVisitBaseline(raw: string | null): VisitBaseline | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const out: Record<string, VigilanceLevel> = {};
    for (const [key, level] of Object.entries(value)) {
      const known = LEVEL_VALUES.find((l) => l === level);
      if (known) out[key] = known;
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Ligne de base de l'onglet, figée à la première lecture. DOIT précéder tout recordVisitBaseline
 * de l'onglet : sinon elle serait l'état courant et aucun badge « nouveau » n'apparaîtrait.
 */
export function beginVisitBaseline(stores: VisitStores = browserStores()): VisitBaseline | null {
  const frozen = read(stores.session, BASELINE_KEY);
  if (frozen !== null) return parseVisitBaseline(frozen);
  const stored = read(stores.local, LEVELS_KEY);
  write(stores.session, BASELINE_KEY, stored ?? 'null');
  return parseVisitBaseline(stored);
}

/** Enregistre les niveaux affichés, au même moment que recordIntelVisitSeen ; 300 clés au plus. */
export function recordVisitBaseline(levels: VisitBaseline, stores: VisitStores = browserStores()): void {
  const entries = Object.entries(levels).slice(0, MAX_BASELINE_KEYS);
  write(stores.local, LEVELS_KEY, JSON.stringify(Object.fromEntries(entries)));
}
```

Dans `src/main.ts`, remplacer :

```ts
import { initI18n } from './services/i18n.ts';
```

par :

```ts
import { initI18n } from './services/i18n.ts';
import { isUiV2 } from './services/ui-mode.ts';
```

et :

```ts
function shouldRenderLanding(): boolean {
  const { pathname, searchParams, hash } = new URL(window.location.href);
  if (searchParams.get('view') === 'app') {
    return false;
  }
```

par :

```ts
function shouldRenderLanding(): boolean {
  const { pathname, searchParams, hash, search } = new URL(window.location.href);
  // ?ui=v2 désigne le tableau de bord (nouvelle interface) : jamais la page d'accueil.
  if (searchParams.get('view') === 'app' || isUiV2(search)) {
    return false;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/themes.test.ts src/services/intel-last-visit.test.ts && npm run typecheck && npm run lint`
Expected: PASS (6 + 7 tests), typecheck et lint sans erreur.

- [ ] **Step 5: Run the task gate**

Run: `npx vitest run && npm run build`
Expected: tout vert.

- [ ] **Step 6: Commit**

```bash
git add src/services/ui-mode.ts src/services/themes.ts src/services/themes.test.ts src/services/intel-last-visit.ts src/services/intel-last-visit.test.ts src/main.ts
git commit -m "feat: bascule ?ui=v2, thèmes et ligne de base des niveaux de la visite"
```

---

### Task 2: Liste « À traiter » : entrées, niveaux et badges

**Files:**
- Create: `src/services/work-queue.ts`
- Test: `src/services/work-queue.test.ts`
- Modify: `src/services/vigilance.ts` (export de `formatSignedPct`)
- Modify: `src/types/index.ts` (`DetectedSituation.category`)

**Interfaces:**
- Consumes : tâche 1 (`categoryTheme`, `situationTheme`, `ThemeId`, `SpecificThemeId`, `VisitBaseline`) ; étape 1 (`LEVEL_RANK`, `eventLevel`, `situationLevel`, `officialLevel`, `maxLevel`, `levelLabel`, `levelVigilanceWord`, `marketTone`) ; `RISK_LABELS` (`src/types/index.ts`).
- Produces : `type WorkBadge = 'nouveau' | 'aggrave' | null` ; `type OfficialSource = 'ecowatt' | 'meteo' | 'vigicrues'` ; `type EventsStatus = 'loading' | 'ok' | 'unavailable'` ; `interface OfficialAlertGroup { source; level; places: string[]; details: string[] }` ; `interface OfficialSignal { source; level; places: number }` ; `interface MarketLine { symbol; name; price; changePercent; kind: 'index' | 'energy' }` ; `type WorkRef` ; `interface WorkItem { key; level; title; place; since; independentSources; theme; badge; ref }` ; `interface WorkQueueInput` ; `interface WorkQueue { items; official; themeLevels; greenTracked; eventsStatus }` ; `officialTheme(source)` ; `officialSourceName(source)` ; `officialAlertGroups(ecowatt, meteo, floods)` ; `officialSignals(…)` ; `officialTitle(group, lang)` ; `marketLines(markets, commodities)` ; `compareWorkItems(a, b)` ; `buildWorkQueue(input): WorkQueue` ; `levelsForBaseline(queue): VisitBaseline` ; `formatSignedPct(value)` exporté par `vigilance.ts` ; `DetectedSituation.category?: EventCategory`.

- [ ] **Step 1: Write the failing test**

Créer `src/services/work-queue.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import {
  buildWorkQueue,
  levelsForBaseline,
  marketLines,
  officialAlertGroups,
  type MarketLine,
  type WorkQueueInput,
} from './work-queue.ts';
import type {
  ChangeDigestItem,
  CommodityData,
  DetectedSituation,
  EcowattResponse,
  FloodSegment,
  IntelEventsState,
  MarketData,
  MeteoAlert,
  NewsEvent,
} from '../types/index.ts';

const NOW = Date.parse('2026-09-24T08:00:00Z');
const H = 3600_000;

function situation(over: Partial<DetectedSituation> = {}): DetectedSituation {
  return {
    id: 'energy-stress', type: 'ENERGY_STRESS', severity: 'high', confidence: 0.8, title: 'Tension énergétique nationale',
    summary: 'Signal Écowatt orange confirmé.', affectedZones: ['Bretagne'], drivers: [], recommendedActions: [],
    sourceRefs: ['Ecowatt RTE'], updatedAt: new Date(NOW), ...over,
  };
}

function event(over: Partial<NewsEvent> = {}): NewsEvent {
  const id = over.id ?? 42;
  return {
    id, evidenceId: `E${id}`, title: 'Explosion dans une usine chimique de Seine-Maritime', category: 'security',
    severity: 'critical', status: 'active', firstSeen: '2026-09-24T07:30:00Z', lastSeen: '2026-09-24T07:50:00Z',
    articleCount: 3, sourceCount: 3, independentCount: 3, sourceNames: ['France Info'], lat: 49.4, lon: 1.1, ...over,
  };
}

function eventsState(over: Partial<IntelEventsState> = {}): IntelEventsState {
  return { events: [], digest: [], totals: {}, anchor: { since: NOW - 3 * H, kind: 'last-visit' }, fetchedAt: NOW, unavailable: false, ...over };
}

function ecowatt(signals: EcowattResponse['signals']): EcowattResponse {
  const mix = { timestamp: new Date(0), nuclear: 0, wind: 0, solar: 0, hydro: 0, gas: 0, other: 0, total: 0 };
  return { signals, mixes: {}, national: mix, interconnections: [] };
}

function meteo(department: string, level: MeteoAlert['level'], risks: MeteoAlert['risks'] = []): MeteoAlert {
  return { department, departmentCode: department.slice(0, 2), level, risks };
}

function flood(name: string, level: FloodSegment['level']): FloodSegment {
  const line = { type: 'LineString' as const, coordinates: [] };
  return {
    id: name, name, level, dataSource: 'live', geometryFidelity: 'raw', matchConfidence: 1,
    rawVertexCount: 0, displayVertexCount: 0, geometry: line, rawGeometry: line, displayGeometry: line,
  };
}

function market(over: Partial<MarketLine> = {}): MarketLine {
  return { symbol: 'CAC40', name: 'CAC 40', price: 7500, changePercent: -0.4, kind: 'index', ...over };
}

function input(over: Partial<WorkQueueInput> = {}): WorkQueueInput {
  return {
    situations: [], alerts: [], events: eventsState(), ecowatt: null, meteo: [], floods: [], markets: [],
    baseline: null, firstSeen: new Map(), lang: 'fr', ...over,
  };
}

const keys = (q: ReturnType<typeof buildWorkQueue>): string[] => q.items.map((i) => i.key);

describe('buildWorkQueue — ce qui entre (spec §7.1)', () => {
  it('toutes les situations du moteur entrent, au niveau L1, sous le thème de leur type', () => {
    const q = buildWorkQueue(input({
      situations: [situation({ severity: 'watch' }), situation({ id: 'cyber-pressure', type: 'CYBER_PRESSURE', severity: 'critical' })],
    }));
    expect(q.items.map((i) => [i.key, i.level, i.theme])).toEqual([
      ['situation:cyber-pressure', 'rouge', 'security'],
      ['situation:energy-stress', 'jaune', 'energy'],
    ]);
  });

  it('alertes : météo couverte par la ligne officielle, incendie par la situation, presse dédoublonnée (A2, A3)', () => {
    const q = buildWorkQueue(input({
      situations: [situation({ id: 'wildfire-7', type: 'WILDFIRE_ESCALATION', severity: 'critical', title: 'Incendie majeur en cours' })],
      alerts: [
        situation({ id: 'weather-alert-83-red-heat', type: 'WEATHER_ALERT', severity: 'critical', title: 'Vigilance rouge Var' }),
        situation({ id: 'wildfire-7', type: 'WILDFIRE_ESCALATION', severity: 'critical' }),
        situation({ id: 'news-alert-1', type: 'NEWS_ALERT', severity: 'critical', title: 'Explosion dans une usine chimique de Seine-Mar...', category: 'security' }),
        situation({ id: 'news-alert-2', type: 'NEWS_ALERT', severity: 'high', title: 'Cyberattaque contre un hôpital', category: 'cyber' }),
        situation({ id: 'defense-alert-1', type: 'DEFENSE_ALERT', severity: 'high', title: 'Navire près du câble' }),
      ],
      events: eventsState({ events: [event()] }),
    }));
    expect(keys(q)).toEqual(['event:42', 'situation:wildfire-7', 'alert:defense-alert-1', 'alert:news-alert-2']);
    expect(q.items.find((i) => i.key === 'alert:news-alert-2')?.theme).toBe('security');
  });

  it('alertes officielles orange ou rouges regroupées par source et niveau, violet compté rouge', () => {
    const groups = officialAlertGroups(
      ecowatt({ '53': 'red', '11': 'orange', '84': 'green' }),
      [meteo('Var', 'violet', ['heat', 'thunderstorm']), meteo('Gard', 'red'), meteo('Isère', 'yellow')],
      [flood('Loire amont', 'orange')],
    );
    // Object.entries range les clés numériques par ordre croissant : '11' avant '53'.
    expect(groups.map((g) => [g.source, g.level, g.places])).toEqual([
      ['ecowatt', 'orange', ['Île-de-France']],
      ['ecowatt', 'rouge', ['Bretagne']],
      ['meteo', 'rouge', ['Var', 'Gard']],
      ['vigicrues', 'orange', ['Loire amont']],
    ]);
    expect(groups[2].details[0]).toBe('Var : Canicule, Orages');
  });

  it('le jaune officiel n’entre pas dans la liste mais colore son thème', () => {
    const q = buildWorkQueue(input({ ecowatt: ecowatt({ '53': 'red' }), meteo: [meteo('Isère', 'yellow')] }));
    expect(q.items.map((i) => i.title)).toEqual(['Écowatt : signal rouge sur 1 région']);
    expect(q.themeLevels.energy).toBe('rouge');
    expect(q.themeLevels.environment).toBe('jaune');
  });

  it('événements : au moins jaunes, corroborés par deux groupes ou orange/rouges ; jamais clos ni verts', () => {
    const q = buildWorkQueue(input({ events: eventsState({ events: [
      event({ id: 1, severity: 'medium', independentCount: 2 }),
      event({ id: 2, severity: 'medium', independentCount: 1 }),
      event({ id: 3, severity: 'high', independentCount: 1 }),
      event({ id: 4, severity: 'low', independentCount: 5 }),
      event({ id: 5, severity: 'critical', status: 'closed' }),
    ] }) }));
    expect(keys(q).sort()).toEqual(['event:1', 'event:3']);
  });

  it('marchés : jaune au-delà de ±3 % (indice) ou ±5 % (énergie), jamais sur une valeur manquante', () => {
    const q = buildWorkQueue(input({ markets: [
      market({ changePercent: -3.42 }),
      market({ symbol: 'BRENT', name: 'Brent', changePercent: 4.9, kind: 'energy' }),
      market({ symbol: 'NATGAS', name: 'Gaz naturel', changePercent: 6.1, kind: 'energy' }),
      market({ symbol: 'DAX', name: 'DAX', changePercent: Number.NaN }),
    ] }));
    expect(q.items.map((i) => [i.key, i.level, i.theme, i.title])).toEqual([
      ['market:CAC40', 'jaune', 'general', 'CAC 40 : −3,42 % sur la journée'],
      ['market:NATGAS', 'jaune', 'energy', 'Gaz naturel : +6,10 % sur la journée'],
    ]);
  });

  it('marketLines garde les indices boursiers et l’énergie, rien d’autre', () => {
    const markets = [
      { symbol: 'CAC40', name: 'CAC 40', price: 1, changePercent: 1, trend: 'up', lastUpdated: new Date(0), category: 'indices' },
      { symbol: 'EURUSD', name: 'EUR/USD', price: 1, changePercent: 1, trend: 'up', lastUpdated: new Date(0), category: 'devises' },
    ] satisfies MarketData[];
    const commodities = [
      { symbol: 'BRENT', name: 'Brent', price: 80, changePercent: 1, trend: 'up', lastUpdated: new Date(0), history: [], category: 'energy', unit: '$/bbl' },
      { symbol: 'GOLD', name: 'Or', price: 1, changePercent: 1, trend: 'up', lastUpdated: new Date(0), history: [], category: 'metals', unit: '$/oz' },
    ] satisfies CommodityData[];
    expect(marketLines(markets, commodities).map((l) => [l.symbol, l.kind])).toEqual([['CAC40', 'index'], ['BRENT', 'energy']]);
  });
});

describe('buildWorkQueue — tri et badges (spec §7.2)', () => {
  it('rouge d’abord, puis nouveau ou aggravé, puis le plus récent', () => {
    const q = buildWorkQueue(input({
      situations: [situation({ id: 'a' }), situation({ id: 'b' }), situation({ id: 'c', severity: 'critical' })],
      baseline: { 'situation:a': 'orange', 'situation:c': 'rouge' },
      firstSeen: new Map([['situation:a', NOW - H]]),
    }));
    expect(keys(q)).toEqual(['situation:c', 'situation:b', 'situation:a']);
    expect(q.items.map((i) => i.badge)).toEqual([null, 'nouveau', null]);
    expect(q.items[2].since).toBe(NOW - H);
  });

  it('aggravé quand la couleur monte depuis la visite ; aucun badge sans ligne de base', () => {
    const escalated = buildWorkQueue(input({ situations: [situation({ severity: 'critical' })], baseline: { 'situation:energy-stress': 'orange' } }));
    expect(escalated.items[0].badge).toBe('aggrave');
    expect(buildWorkQueue(input({ situations: [situation()] })).items[0].badge).toBeNull();
  });

  it('événements : badge tiré du fil serveur (créé → nouveau ; aggravé ou rouvert → aggravé)', () => {
    const digest = (id: number, kinds: ChangeDigestItem['kinds']): ChangeDigestItem => ({
      event: event({ id }), kinds, latestAt: '2026-09-24T07:40:00Z', severityFrom: 'high', independentFrom: null,
    });
    const q = buildWorkQueue(input({ events: eventsState({
      events: [event({ id: 1 }), event({ id: 2 }), event({ id: 3 })],
      digest: [digest(1, ['created']), digest(2, ['escalated'])],
    }) }));
    expect(q.items.map((i) => [i.key, i.badge])).toEqual([['event:1', 'nouveau'], ['event:2', 'aggrave'], ['event:3', null]]);
  });
});

describe('buildWorkQueue — états (spec §7.4)', () => {
  it('événements en chargement, indisponibles ou disponibles', () => {
    expect(buildWorkQueue(input({ events: null })).eventsStatus).toBe('loading');
    expect(buildWorkQueue(input({ events: eventsState({ unavailable: true }) })).eventsStatus).toBe('unavailable');
    expect(buildWorkQueue(input({ events: eventsState({ unavailable: true, events: [event()] }) })).eventsStatus).toBe('ok');
  });

  it('compte les éléments suivis restés au vert, par thème (A10)', () => {
    const q = buildWorkQueue(input({
      ecowatt: ecowatt({ '53': 'green' }),
      events: eventsState({ events: [event({ id: 1, severity: 'low', category: 'health' }), event({ id: 2, severity: 'info', category: 'finance' })] }),
      markets: [market()],
    }));
    expect(q.greenTracked).toEqual({ general: 4, energy: 1, security: 0, health: 1, environment: 0 });
  });

  it('ligne de base à enregistrer : niveaux des éléments, sans les événements', () => {
    const q = buildWorkQueue(input({ situations: [situation()], events: eventsState({ events: [event()] }) }));
    expect(levelsForBaseline(q)).toEqual({ 'situation:energy-stress': 'orange' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/work-queue.test.ts`
Expected: FAIL, `Cannot find module './work-queue.ts'`.

- [ ] **Step 3: Write the implementation**

Dans `src/services/vigilance.ts`, remplacer `function formatSignedPct(value: number): string {` par :

```ts
/** Variation signée à la française (« −3,42 % », « +6,10 % ») ; partagée avec la liste « À traiter ». */
export function formatSignedPct(value: number): string {
```

Dans `src/types/index.ts`, dans `interface DetectedSituation`, remplacer :

```ts
  linkUrl?: string;
  linkLabel?: string;
```

par :

```ts
  linkUrl?: string;
  linkLabel?: string;
  /** Catégorie de l'article d'origine (alertes presse) : rattache l'alerte à son thème. */
  category?: EventCategory;
```

Créer `src/services/work-queue.ts` :

```ts
// src/services/work-queue.ts — liste « À traiter » de la disposition A1 (refonte UI, spec §7).
// Pur (aucun DOM, aucun réseau) : App.ts fournit les données déjà en cache ; ce module décide ce
// qui entre dans la liste, à quel niveau L1, sous quel thème et avec quel badge depuis la visite.
// Rien de vert n'entre.

import {
  RISK_LABELS,
  type CommodityData,
  type DetectedSituation,
  type EcowattResponse,
  type EcowattSignal,
  type FloodSegment,
  type IntelEventsState,
  type MarketData,
  type MeteoAlert,
  type NewsEvent,
} from '../types/index.ts';
import {
  LEVEL_RANK,
  eventLevel,
  formatSignedPct,
  levelLabel,
  levelVigilanceWord,
  marketTone,
  maxLevel,
  officialLevel,
  situationLevel,
  type VigilanceLevel,
} from './vigilance.ts';
import { categoryTheme, situationTheme, type SpecificThemeId, type ThemeId } from './themes.ts';
import type { VisitBaseline } from './intel-last-visit.ts';

type Lang = 'fr' | 'en';

export type WorkBadge = 'nouveau' | 'aggrave' | null;
export type OfficialSource = 'ecowatt' | 'meteo' | 'vigicrues';
export type EventsStatus = 'loading' | 'ok' | 'unavailable';

/** Alertes officielles d'une même source et d'un même niveau (orange ou rouge), en une ligne. */
export interface OfficialAlertGroup {
  source: OfficialSource;
  level: VigilanceLevel;
  places: string[];
  /** Une ligne par lieu (« Var : Canicule, Orages »). */
  details: string[];
}

/** Niveau le plus élevé d'une source officielle, vert compris : sert au niveau des thèmes. */
export interface OfficialSignal {
  source: OfficialSource;
  level: VigilanceLevel;
  /** Nombre de lieux à ce niveau. */
  places: number;
}

/** Ligne de marché suivie : indice boursier (seuil ±3 %) ou énergie (pétrole, gaz : ±5 %). */
export interface MarketLine {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
  kind: 'index' | 'energy';
}

export type WorkRef =
  | { kind: 'situation'; situation: DetectedSituation }
  | { kind: 'alert'; situation: DetectedSituation }
  | { kind: 'official'; group: OfficialAlertGroup }
  | { kind: 'event'; event: NewsEvent }
  | { kind: 'market'; line: MarketLine };

export interface WorkItem {
  /** Clé stable : « situation:<id> », « alert:<id> », « event:<id> », « official:<source>:<niveau> », « market:<symbole> ». */
  key: string;
  level: VigilanceLevel;
  title: string;
  place: string | null;
  /** Début connu (ms epoch), null si inconnu. */
  since: number | null;
  independentSources: number | null;
  theme: ThemeId;
  badge: WorkBadge;
  ref: WorkRef;
}

export interface WorkQueueInput {
  situations: readonly DetectedSituation[];
  alerts: readonly DetectedSituation[];
  /** null tant que le premier chargement des événements n'a pas abouti. */
  events: IntelEventsState | null;
  ecowatt: EcowattResponse | null;
  meteo: readonly MeteoAlert[];
  floods: readonly FloodSegment[];
  markets: readonly MarketLine[];
  /** Niveaux vus à la dernière visite ; null à la première visite. */
  baseline: VisitBaseline | null;
  /** Heure d'apparition pendant la session, par clé (après la chauffe du démarrage). */
  firstSeen: ReadonlyMap<string, number>;
  lang: Lang;
}

export interface WorkQueue {
  /** Tous thèmes confondus, triés (§7.2). */
  items: WorkItem[];
  official: OfficialSignal[];
  /** Niveau de chaque thème : ses signaux officiels (jaune compris) et ses éléments « À traiter ». */
  themeLevels: Record<SpecificThemeId, VigilanceLevel>;
  /** Éléments suivis restés au vert, par thème (arbitrage A10). */
  greenTracked: Record<ThemeId, number>;
  eventsStatus: EventsStatus;
}

// Même table que situation-engine.ts et SituationReport.ts (codes INSEE des régions Écowatt).
const ECOWATT_REGION_NAMES: Record<string, string> = {
  '11': 'Île-de-France',
  '24': 'Centre-Val de Loire',
  '27': 'Bourgogne-Franche-Comté',
  '28': 'Normandie',
  '32': 'Hauts-de-France',
  '44': 'Grand Est',
  '52': 'Pays de la Loire',
  '53': 'Bretagne',
  '75': 'Nouvelle-Aquitaine',
  '76': 'Occitanie',
  '84': 'Auvergne-Rhône-Alpes',
  '93': 'PACA',
  '94': 'Corse',
};

const OFFICIAL_THEME: Record<OfficialSource, SpecificThemeId> = {
  ecowatt: 'energy',
  meteo: 'environment',
  vigicrues: 'environment',
};

const OFFICIAL_SOURCE_NAME: Record<OfficialSource, string> = {
  ecowatt: 'RTE Écowatt',
  meteo: 'Météo-France',
  vigicrues: 'Vigicrues',
};

const OFFICIAL_SOURCES: readonly OfficialSource[] = ['ecowatt', 'meteo', 'vigicrues'];

export function officialTheme(source: OfficialSource): SpecificThemeId {
  return OFFICIAL_THEME[source];
}

export function officialSourceName(source: OfficialSource): string {
  return OFFICIAL_SOURCE_NAME[source];
}

interface OfficialEntry {
  source: OfficialSource;
  level: VigilanceLevel;
  place: string;
  detail: string;
}

function officialEntries(ecowatt: EcowattResponse | null, meteo: readonly MeteoAlert[], floods: readonly FloodSegment[]): OfficialEntry[] {
  const out: OfficialEntry[] = [];
  const signals: Record<string, EcowattSignal> = ecowatt?.signals ?? {};
  for (const [code, signal] of Object.entries(signals)) {
    const place = ECOWATT_REGION_NAMES[code] ?? `Région ${code}`;
    out.push({ source: 'ecowatt', level: officialLevel(signal), place, detail: place });
  }
  for (const alert of meteo) {
    const risks = alert.risks.map((risk) => RISK_LABELS[risk] ?? risk).join(', ');
    out.push({
      source: 'meteo',
      level: officialLevel(alert.level),
      place: alert.department,
      detail: risks ? `${alert.department} : ${risks}` : alert.department,
    });
  }
  for (const segment of floods) {
    out.push({ source: 'vigicrues', level: officialLevel(segment.level), place: segment.name, detail: segment.name });
  }
  return out;
}

/** Alertes officielles orange ou rouges, regroupées par source et par niveau ; violet Météo = rouge. */
export function officialAlertGroups(
  ecowatt: EcowattResponse | null,
  meteo: readonly MeteoAlert[],
  floods: readonly FloodSegment[],
): OfficialAlertGroup[] {
  const groups = new Map<string, OfficialAlertGroup>();
  for (const entry of officialEntries(ecowatt, meteo, floods)) {
    if (LEVEL_RANK[entry.level] < LEVEL_RANK.orange) continue;
    const key = `${entry.source}:${entry.level}`;
    const group = groups.get(key) ?? { source: entry.source, level: entry.level, places: [], details: [] };
    if (!group.places.includes(entry.place)) {
      group.places.push(entry.place);
      group.details.push(entry.detail);
    }
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Niveau maximal de chaque source officielle présente (vert compris). */
export function officialSignals(
  ecowatt: EcowattResponse | null,
  meteo: readonly MeteoAlert[],
  floods: readonly FloodSegment[],
): OfficialSignal[] {
  const entries = officialEntries(ecowatt, meteo, floods);
  return OFFICIAL_SOURCES.flatMap((source) => {
    const own = entries.filter((e) => e.source === source);
    if (own.length === 0) return [];
    const level = maxLevel(own.map((e) => e.level));
    return [{ source, level, places: own.filter((e) => e.level === level).length }];
  });
}

export function officialTitle(group: OfficialAlertGroup, lang: Lang): string {
  const n = group.places.length;
  const s = n > 1 ? 's' : '';
  const word = levelLabel(group.level, lang).toLowerCase();
  if (lang === 'en') {
    if (group.source === 'ecowatt') return `Ecowatt: ${word} signal in ${n} region${s}`;
    if (group.source === 'meteo') return `Weather ${levelVigilanceWord(group.level, 'en')}: ${n} department${s}`;
    return `Vigicrues ${word}: ${n} river section${s}`;
  }
  if (group.source === 'ecowatt') return `Écowatt : signal ${word} sur ${n} région${s}`;
  if (group.source === 'meteo') return `Vigilance météo ${word} : ${n} département${s}`;
  return `Vigicrues ${word} : ${n} tronçon${s}`;
}

/** Lignes de marché suivies : indices (catégorie « indices ») et énergie des matières premières. */
export function marketLines(markets: readonly MarketData[], commodities: readonly CommodityData[]): MarketLine[] {
  return [
    ...markets
      .filter((m) => m.category === 'indices')
      .map((m) => ({ symbol: m.symbol, name: m.name, price: m.price, changePercent: m.changePercent, kind: 'index' as const })),
    ...commodities
      .filter((c) => c.category === 'energy')
      .map((c) => ({ symbol: c.symbol, name: c.name, price: c.price, changePercent: c.changePercent, kind: 'energy' as const })),
  ];
}

function marketTitle(line: MarketLine, lang: Lang): string {
  return lang === 'fr'
    ? `${line.name} : ${formatSignedPct(line.changePercent)} sur la journée`
    : `${line.name}: ${formatSignedPct(line.changePercent)} today`;
}

function placesLabel(places: readonly string[]): string | null {
  if (places.length === 0) return null;
  if (places.length <= 2) return places.join(', ');
  return `${places.slice(0, 2).join(', ')} +${places.length - 2}`;
}

function parseTime(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function normalizeTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Même histoire qu'un événement consolidé : titres égaux, ou préfixe commun d'au moins 20 caractères (titres d'alerte tronqués). */
function sameStory(alertTitle: string, eventTitles: readonly string[]): boolean {
  const a = normalizeTitle(alertTitle);
  return eventTitles.some((e) => e === a || (a.length >= 20 && e.length >= 20 && (e.startsWith(a) || a.startsWith(e))));
}

function eventEnters(e: NewsEvent): boolean {
  if (e.status === 'closed') return false;
  const rank = LEVEL_RANK[eventLevel(e.severity)];
  if (rank < LEVEL_RANK.jaune) return false;
  return e.independentCount >= 2 || rank >= LEVEL_RANK.orange;
}

function baselineBadge(key: string, level: VigilanceLevel, baseline: VisitBaseline | null): WorkBadge {
  if (baseline === null) return null;
  const before: VigilanceLevel | undefined = baseline[key];
  if (before === undefined) return 'nouveau';
  return LEVEL_RANK[level] > LEVEL_RANK[before] ? 'aggrave' : null;
}

function eventBadge(event: NewsEvent, events: IntelEventsState): WorkBadge {
  const item = events.digest.find((d) => d.event.id === event.id);
  if (!item) return null;
  if (item.kinds.includes('created')) return 'nouveau';
  return item.kinds.includes('escalated') || item.kinds.includes('reopened') ? 'aggrave' : null;
}

/** Tri §7.2 : rouge d'abord, puis nouveau ou aggravé, puis le plus récent ; la clé départage. */
export function compareWorkItems(a: WorkItem, b: WorkItem): number {
  return LEVEL_RANK[b.level] - LEVEL_RANK[a.level]
    || Number(b.badge !== null) - Number(a.badge !== null)
    || (b.since ?? 0) - (a.since ?? 0)
    || a.key.localeCompare(b.key);
}

export function buildWorkQueue(input: WorkQueueInput): WorkQueue {
  const { baseline, firstSeen, lang } = input;
  const seenAt = (key: string): number | null => firstSeen.get(key) ?? null;
  const items: WorkItem[] = [];

  for (const s of input.situations) {
    const key = `situation:${s.id}`;
    const level = situationLevel(s.severity);
    items.push({
      key, level, title: s.title, place: s.affectedZones[0] ?? null, since: seenAt(key), independentSources: null,
      theme: situationTheme(s.type), badge: baselineBadge(key, level, baseline), ref: { kind: 'situation', situation: s },
    });
  }

  const situationIds = new Set(input.situations.map((s) => s.id));
  const eventTitles = (input.events?.events ?? []).map((e) => normalizeTitle(e.title));
  for (const a of input.alerts) {
    // Arbitrages A2 et A3 : la météo est couverte par les lignes officielles, un incendie par la
    // situation du moteur de même identifiant, une alerte presse par l'événement de même titre.
    if (a.type === 'WEATHER_ALERT' || situationIds.has(a.id)) continue;
    if (a.type === 'NEWS_ALERT' && sameStory(a.title, eventTitles)) continue;
    const key = `alert:${a.id}`;
    const level = situationLevel(a.severity);
    const since = a.updatedAt.getTime();
    items.push({
      key, level, title: a.title, place: a.affectedZones[0] ?? null, since: Number.isFinite(since) ? since : null,
      independentSources: null, theme: situationTheme(a.type, a.category), badge: baselineBadge(key, level, baseline),
      ref: { kind: 'alert', situation: a },
    });
  }

  for (const group of officialAlertGroups(input.ecowatt, input.meteo, input.floods)) {
    const key = `official:${group.source}:${group.level}`;
    items.push({
      key, level: group.level, title: officialTitle(group, lang), place: placesLabel(group.places), since: seenAt(key),
      independentSources: null, theme: OFFICIAL_THEME[group.source], badge: baselineBadge(key, group.level, baseline),
      ref: { kind: 'official', group },
    });
  }

  const events = input.events;
  if (events) {
    for (const e of events.events) {
      if (!eventEnters(e)) continue;
      items.push({
        key: `event:${e.id}`, level: eventLevel(e.severity), title: e.title, place: null, since: parseTime(e.firstSeen),
        independentSources: e.independentCount, theme: categoryTheme(e.category), badge: eventBadge(e, events),
        ref: { kind: 'event', event: e },
      });
    }
  }

  for (const line of input.markets) {
    if (marketTone(line.changePercent, line.kind) !== 'alert') continue;
    const key = `market:${line.symbol}`;
    items.push({
      key, level: 'jaune', title: marketTitle(line, lang), place: null, since: seenAt(key), independentSources: null,
      theme: line.kind === 'energy' ? 'energy' : 'general', badge: baselineBadge(key, 'jaune', baseline),
      ref: { kind: 'market', line },
    });
  }

  items.sort(compareWorkItems);

  const official = officialSignals(input.ecowatt, input.meteo, input.floods);
  const themeLevel = (theme: SpecificThemeId): VigilanceLevel => maxLevel([
    ...official.filter((o) => OFFICIAL_THEME[o.source] === theme).map((o) => o.level),
    ...items.filter((i) => i.theme === theme).map((i) => i.level),
  ]);
  const themeLevels: Record<SpecificThemeId, VigilanceLevel> = {
    energy: themeLevel('energy'),
    security: themeLevel('security'),
    health: themeLevel('health'),
    environment: themeLevel('environment'),
  };

  const greenTracked: Record<ThemeId, number> = { general: 0, energy: 0, security: 0, health: 0, environment: 0 };
  const countGreen = (theme: ThemeId): void => {
    greenTracked.general += 1;
    if (theme !== 'general') greenTracked[theme] += 1;
  };
  for (const o of official) if (o.level === 'vert') countGreen(OFFICIAL_THEME[o.source]);
  for (const e of events?.events ?? []) {
    if (e.status !== 'closed' && eventLevel(e.severity) === 'vert') countGreen(categoryTheme(e.category));
  }
  for (const line of input.markets) {
    if (Number.isFinite(line.changePercent) && marketTone(line.changePercent, line.kind) === 'neutral') {
      countGreen(line.kind === 'energy' ? 'energy' : 'general');
    }
  }

  const eventsStatus: EventsStatus = events === null
    ? 'loading'
    : events.unavailable && events.events.length === 0 ? 'unavailable' : 'ok';

  return { items, official, themeLevels, greenTracked, eventsStatus };
}

/** Niveaux à enregistrer comme ligne de base de la visite (les événements ont leur fil serveur). */
export function levelsForBaseline(queue: WorkQueue): VisitBaseline {
  return Object.fromEntries(
    queue.items
      .filter((i) => i.ref.kind !== 'event')
      .map((i): [string, VigilanceLevel] => [i.key, i.level]),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/work-queue.test.ts src/services/vigilance.test.ts && npm run typecheck`
Expected: PASS (13 tests pour `work-queue`), typecheck sans erreur.

- [ ] **Step 5: Run the task gate**

Run: `npx vitest run && npm run lint && npm run build`
Expected: tout vert.

- [ ] **Step 6: Commit**

```bash
git add src/services/work-queue.ts src/services/work-queue.test.ts src/services/vigilance.ts src/types/index.ts
git commit -m "feat: liste « À traiter » — entrées, niveaux L1, thèmes et badges depuis la visite"
```

---

### Task 3: Liste « À traiter » : vue par thème, garde et thèmes qui tirent le niveau

**Files:**
- Modify: `src/services/work-queue.ts`
- Test: `src/services/work-queue.test.ts`

**Interfaces:**
- Consumes : tâche 2 (`WorkQueue`, `WorkItem`, `EventsStatus`) ; tâche 1 (`THEMES`, `SPECIFIC_THEMES`, `inTheme`).
- Produces : `WORK_LIST_CAP = 12` ; `interface WorkGuard { reds: number; themes: ThemeId[]; target: ThemeId }` ; `interface WorkQueueView { theme; rows; total; hiddenCount; guard; greenTracked; eventsStatus }` ; `viewWorkQueue(queue, theme, showAll): WorkQueueView` ; `drivingThemes(themeLevels, national): SpecificThemeId[]` ; `visitCounts(queue): { nouveaux: number; aggravations: number }`.

- [ ] **Step 1: Write the failing test**

Dans `src/services/work-queue.test.ts`, remplacer le bloc d'import :

```ts
import {
  buildWorkQueue,
  levelsForBaseline,
  marketLines,
  officialAlertGroups,
  type MarketLine,
  type WorkQueueInput,
} from './work-queue.ts';
```

par :

```ts
import {
  buildWorkQueue,
  drivingThemes,
  levelsForBaseline,
  marketLines,
  officialAlertGroups,
  viewWorkQueue,
  visitCounts,
  type MarketLine,
  type WorkQueueInput,
} from './work-queue.ts';
import type { SpecificThemeId } from './themes.ts';
import type { VigilanceLevel } from './vigilance.ts';
```

et ajouter à la fin du fichier :

```ts
describe('viewWorkQueue (spec §7.2, §7.3)', () => {
  it('au plus 12 lignes, puis « voir les autres »', () => {
    const situations = Array.from({ length: 15 }, (_, i) => situation({ id: `s${i}` }));
    const q = buildWorkQueue(input({ situations }));
    const view = viewWorkQueue(q, 'general', false);
    expect(view.rows).toHaveLength(12);
    expect(view.total).toBe(15);
    expect(view.hiddenCount).toBe(3);
    expect(viewWorkQueue(q, 'general', true).rows).toHaveLength(15);
  });

  it('un thème ne garde que ses éléments ; la garde compte les rouges hors thème et vise le thème qui en a le plus', () => {
    const q = buildWorkQueue(input({
      situations: [
        situation({ id: 'e', severity: 'critical' }),
        situation({ id: 'c1', type: 'CYBER_PRESSURE', severity: 'critical' }),
        situation({ id: 'c2', type: 'MARITIME_ANOMALY', severity: 'critical' }),
      ],
      alerts: [situation({ id: 'n', type: 'NEWS_ALERT', severity: 'critical', title: 'Fait divers national', category: 'general' })],
    }));
    const health = viewWorkQueue(q, 'health', false);
    expect(health.total).toBe(0);
    expect(health.guard).toEqual({ reds: 4, themes: ['general', 'energy', 'security'], target: 'security' });
    const energy = viewWorkQueue(q, 'energy', false);
    expect(energy.rows.map((r) => r.key)).toEqual(['situation:e']);
    expect(energy.guard).toEqual({ reds: 3, themes: ['general', 'security'], target: 'security' });
    expect(viewWorkQueue(q, 'general', false).guard).toBeNull();
  });

  it('un rouge rattaché à « Vue générale » seulement déclenche la garde et y bascule (revue)', () => {
    const q = buildWorkQueue(input({
      alerts: [situation({ id: 'n', type: 'NEWS_ALERT', severity: 'critical', title: 'Fait divers national', category: 'general' })],
    }));
    expect(viewWorkQueue(q, 'energy', false).guard).toEqual({ reds: 1, themes: ['general'], target: 'general' });
  });

  it('rien à traiter : compte des éléments suivis au vert et état des événements', () => {
    const q = buildWorkQueue(input({ ecowatt: ecowatt({ '53': 'green' }), events: eventsState({ unavailable: true }) }));
    const view = viewWorkQueue(q, 'energy', false);
    expect(view.total).toBe(0);
    expect(view.greenTracked).toBe(1);
    expect(view.eventsStatus).toBe('unavailable');
  });
});

describe('drivingThemes (spec §5.2)', () => {
  const levels = (over: Partial<Record<SpecificThemeId, VigilanceLevel>>): Record<SpecificThemeId, VigilanceLevel> => ({
    energy: 'vert', security: 'vert', health: 'vert', environment: 'vert', ...over,
  });

  it('les thèmes au niveau national, deux au plus', () => {
    expect(drivingThemes(levels({ energy: 'rouge', security: 'rouge', environment: 'rouge' }), 'rouge')).toEqual(['energy', 'security']);
  });

  it('sinon le thème au niveau le plus élevé', () => {
    expect(drivingThemes(levels({ security: 'orange', health: 'jaune' }), 'rouge')).toEqual(['security']);
    expect(drivingThemes(levels({ health: 'jaune' }), 'vert')).toEqual(['health']);
  });

  it('aucun si tous les thèmes sont verts', () => {
    expect(drivingThemes(levels({}), 'jaune')).toEqual([]);
  });
});

describe('visitCounts', () => {
  it('compte nouveaux et aggravations sur toute la liste', () => {
    const q = buildWorkQueue(input({
      situations: [situation({ id: 'a', severity: 'critical' }), situation({ id: 'b' })],
      baseline: { 'situation:a': 'orange' },
    }));
    expect(visitCounts(q)).toEqual({ nouveaux: 1, aggravations: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/work-queue.test.ts`
Expected: FAIL, `viewWorkQueue is not a function` (et `drivingThemes`, `visitCounts`).

- [ ] **Step 3: Write the implementation**

Dans `src/services/work-queue.ts`, remplacer :

```ts
import { categoryTheme, situationTheme, type SpecificThemeId, type ThemeId } from './themes.ts';
```

par :

```ts
import { SPECIFIC_THEMES, THEMES, categoryTheme, inTheme, situationTheme, type SpecificThemeId, type ThemeId } from './themes.ts';
```

et ajouter à la fin du fichier :

```ts
// ─── Vue par thème, garde et thèmes qui tirent le niveau (spec §5.2, §7.2, §7.3) ─────────────

export const WORK_LIST_CAP = 12;

export interface WorkGuard {
  reds: number;
  /** Thèmes des rouges hors du thème courant, dans l'ordre de la barre de thèmes. */
  themes: ThemeId[];
  /** Thème vers lequel bascule un clic : celui qui a le plus de rouges hors du thème courant. */
  target: ThemeId;
}

export interface WorkQueueView {
  theme: ThemeId;
  rows: WorkItem[];
  total: number;
  hiddenCount: number;
  guard: WorkGuard | null;
  greenTracked: number;
  eventsStatus: EventsStatus;
}

export function viewWorkQueue(queue: WorkQueue, theme: ThemeId, showAll: boolean): WorkQueueView {
  const inside = queue.items.filter((i) => inTheme(i.theme, theme));
  const rows = showAll ? inside : inside.slice(0, WORK_LIST_CAP);
  const outsideReds = queue.items.filter((i) => i.level === 'rouge' && !inTheme(i.theme, theme));
  let guard: WorkGuard | null = null;
  if (outsideReds.length > 0) {
    const counts = new Map<ThemeId, number>();
    for (const i of outsideReds) counts.set(i.theme, (counts.get(i.theme) ?? 0) + 1);
    const themes = THEMES.map((th) => th.id).filter((id) => counts.has(id));
    // Tri stable : à égalité, l'ordre de la barre de thèmes départage.
    const target = [...themes].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))[0];
    guard = { reds: outsideReds.length, themes, target };
  }
  return {
    theme,
    rows,
    total: inside.length,
    hiddenCount: inside.length - rows.length,
    guard,
    greenTracked: queue.greenTracked[theme],
    eventsStatus: queue.eventsStatus,
  };
}

/**
 * Thèmes qui tirent le niveau national (spec §5.2) : ceux qui sont au niveau national, deux au
 * plus ; s'il n'y en a aucun, le thème au niveau le plus élevé ; aucun si tous sont verts.
 */
export function drivingThemes(themeLevels: Record<SpecificThemeId, VigilanceLevel>, national: VigilanceLevel): SpecificThemeId[] {
  const top = maxLevel(SPECIFIC_THEMES.map((th) => themeLevels[th]));
  if (top === 'vert') return [];
  const equal: SpecificThemeId[] = national === 'vert' ? [] : SPECIFIC_THEMES.filter((th) => themeLevels[th] === national);
  if (equal.length > 0) return equal.slice(0, 2);
  return SPECIFIC_THEMES.filter((th) => themeLevels[th] === top).slice(0, 1);
}

/** Changements depuis la visite, toute la liste (bandeau d'état). */
export function visitCounts(queue: WorkQueue): { nouveaux: number; aggravations: number } {
  return {
    nouveaux: queue.items.filter((i) => i.badge === 'nouveau').length,
    aggravations: queue.items.filter((i) => i.badge === 'aggrave').length,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/work-queue.test.ts && npm run typecheck`
Expected: PASS (21 tests), typecheck sans erreur.

- [ ] **Step 5: Run the task gate**

Run: `npx vitest run && npm run lint && npm run build`
Expected: tout vert.

- [ ] **Step 6: Commit**

```bash
git add src/services/work-queue.ts src/services/work-queue.test.ts
git commit -m "feat: liste « À traiter » — vue par thème, garde hors thème, thèmes qui tirent le niveau"
```

---

### Task 4: Sous-scores du moteur, valeurs carburant en français, mot du niveau dans les lignes

Reprend deux points reportés par l'étape 1 : les sous-scores chiffrés des facteurs de situation (« Score cyber consolidé : 63/100 », « Ransomware : 25/25 ») doivent rejoindre « Pourquoi ce niveau ? » (utilisé par la fiche situation, tâche 8, arbitrage A7), et le mot du niveau doit toujours accompagner la couleur dans les lignes de liste (§9, arbitrage A12). La vérification du plan dans le navigateur a montré une troisième fuite : le brief de repli déterministe recopie le résumé des situations (« Baromètre cyber consolidé à 63/100 ») dans les « Jugements » de la fiche France ; le brief IA, lui, a déjà la consigne de ne citer aucune valeur /100.

**Files:**
- Create: `src/services/situation-text.ts`
- Test: `src/services/situation-text.test.ts`
- Modify: `src/services/situation-engine.ts`, test `src/services/situation-engine.test.ts`
- Modify: `src/components/france-intel-events.ts`, test `src/components/france-intel-events.test.ts`
- Modify: `src/components/SituationBrief.ts`, test `src/components/SituationBrief.test.ts`
- Modify: `src/services/france-intel-brief.ts`, test `src/services/france-intel-brief.test.ts`
- Modify: `src/styles/main.css`

**Interfaces:**
- Produces : `isScoreText(text): boolean` ; `splitScoreLines(lines): { plain: string[]; scored: string[] }` ; `splitScoreSentences(text): { plain: string[]; scored: string[] }` ; jugements du brief déterministe sans phrase chiffrée.

- [ ] **Step 1: Write the failing tests**

Créer `src/services/situation-text.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { isScoreText, splitScoreLines, splitScoreSentences } from './situation-text.ts';

describe('sous-scores du moteur (refonte UI étape 2, arbitrage A7)', () => {
  it('reconnaît un sous-score « x/y », pas un pourcentage ni une puissance', () => {
    expect(isScoreText('Score cyber consolidé : 63/100 (tendance stable)')).toBe(true);
    expect(isScoreText('Ransomware : 25/25')).toBe(true);
    expect(isScoreText('Parc nucléaire dégradé (ratio 85%)')).toBe(false);
    expect(isScoreText('Import net actuel : +2300 MW')).toBe(false);
  });

  it('sépare les facteurs en clair des sous-scores', () => {
    expect(splitScoreLines(['Score cyber consolidé : 63/100', '2 alerte(s) critique(s) CERT-FR', 'Fuites : 10/20'])).toEqual({
      plain: ['2 alerte(s) critique(s) CERT-FR'],
      scored: ['Score cyber consolidé : 63/100', 'Fuites : 10/20'],
    });
  });

  it('coupe un résumé en phrases et range les phrases chiffrées à part', () => {
    expect(splitScoreSentences('3 département(s) avec tensions. Score national ISNR : 41/100.')).toEqual({
      plain: ['3 département(s) avec tensions.'],
      scored: ['Score national ISNR : 41/100.'],
    });
    expect(splitScoreSentences('')).toEqual({ plain: [], scored: [] });
  });
});
```

Ajouter à la fin de `src/services/situation-engine.test.ts` :

```ts
describe('situation-engine · textes en français (refonte UI étape 2, arbitrage A7)', () => {
  it('la situation carburant n’affiche aucune valeur anglaise du moteur', () => {
    const fuel = detectSituations(fuelFixture()).find((s) => s.type === 'FUEL_SUPPLY_RISK');
    assert.ok(fuel);
    const text = [fuel.summary, ...fuel.drivers, ...fuel.recommendedActions.map((a) => a.label)].join(' ');
    assert.ok(!/\b(LOW|MEDIUM|HIGH|CRITICAL|tense)\b/.test(text), text);
    assert.ok(text.includes('Tension carburant forte'), text);
    assert.ok(text.includes('stocks pétroliers sous tension'), text);
  });
});
```

Dans `src/components/france-intel-events.test.ts`, ajouter à la fin du bloc `describe('rendu des événements', () => {` (avant sa parenthèse fermante `});`) :

```ts
  it('le mot du niveau accompagne la couleur de la ligne (§9)', () => {
    expect(renderEventRow(event({ severity: 'critical' }), 'fr', NOW, undefined)).toContain('<span class="frintel-ev-level">Rouge</span>');
    expect(renderEventRow(event({ severity: 'medium' }), 'en', NOW, undefined)).toContain('<span class="frintel-ev-level">Yellow</span>');
  });
```

Ajouter à la fin de `src/services/france-intel-brief.test.ts` :

```ts
describe('buildDeterministicBrief — sous-scores hors des jugements (refonte UI étape 2)', () => {
  it('ne recopie pas les phrases chiffrées du résumé d’une situation', () => {
    const cyber = situation({
      id: 'cyber-pressure', title: 'Pression cyber multi-source',
      summary: 'Baromètre cyber consolidé à 63/100, dominé par ransomware.',
    });
    const social = situation({
      id: 'social-escalation', title: 'Escalade sociale localisée',
      summary: '4 département(s) avec tensions sociales ou sécuritaires élevées. Score national ISNR : 41/100.',
    });
    const brief = buildDeterministicBrief({ score: 61, scoreBreakdown: breakdown(), situations: [cyber, social] }, 'fr');
    const texts = brief.judgments.map((j) => j.text);
    assert.ok(texts.every((text) => !/\d+\s*\/\s*\d+/.test(text)), texts.join(' | '));
    assert.ok(texts.includes('Pression cyber multi-source'));
    assert.ok(texts.includes('Escalade sociale localisée — 4 département(s) avec tensions sociales ou sécuritaires élevées.'));
  });
});
```

Ajouter à la fin de `src/components/SituationBrief.test.ts` :

```ts
describe('SituationBrief — le mot du niveau accompagne la couleur (§9)', () => {
  it('affiche « Rouge » à côté de la pastille de couleur', () => {
    const container = document.createElement('div');
    const brief = new SituationBrief(container);
    brief.update([situation({ severity: 'critical' })]);
    expect(container.querySelector('.sit-brief__item-level')?.textContent).toBe('Rouge');
    brief.destroy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/situation-text.test.ts src/services/situation-engine.test.ts src/components/france-intel-events.test.ts src/components/SituationBrief.test.ts src/services/france-intel-brief.test.ts`
Expected: FAIL. `Cannot find module './situation-text.ts'` ; texte carburant « Tension carburant HIGH » ; `frintel-ev-level` et `.sit-brief__item-level` absents ; jugement « Pression cyber multi-source — Baromètre cyber consolidé à 63/100… ».

- [ ] **Step 3: Write the implementation**

Créer `src/services/situation-text.ts` :

```ts
// src/services/situation-text.ts — sépare, dans les textes du moteur de situations, les sous-scores
// chiffrés (« Score cyber consolidé : 63/100 », « Ransomware : 25/25 ») du reste. Dans la fiche
// situation, les premiers rejoignent « Pourquoi ce niveau ? » (spec §4.3 : le nombre seulement
// dans ce volet ; arbitrage A7). Pur.

const SCORE_PATTERN = /\d+(?:[.,]\d+)?\s*\/\s*\d+/;

export function isScoreText(text: string): boolean {
  return SCORE_PATTERN.test(text);
}

export function splitScoreLines(lines: readonly string[]): { plain: string[]; scored: string[] } {
  return {
    plain: lines.filter((line) => !isScoreText(line)),
    scored: lines.filter((line) => isScoreText(line)),
  };
}

/** Coupe un résumé en phrases ; les phrases chiffrées rejoignent « Pourquoi ce niveau ? ». */
export function splitScoreSentences(text: string): { plain: string[]; scored: string[] } {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
  return splitScoreLines(sentences);
}
```

Dans `src/services/situation-engine.ts` :

1. Remplacer :

```ts
import type {
  DetectedSituation,
  SituationAction,
  SituationActionType,
  SituationSeverity,
  SituationType,
} from '../types/index.ts';
```

par :

```ts
import type {
  DetectedSituation,
  FuelTensionLevel,
  OilVigilanceStatus,
  SituationAction,
  SituationActionType,
  SituationSeverity,
  SituationType,
} from '../types/index.ts';
```

2. Remplacer :

```ts
// ─── Règle 10 : FUEL_SUPPLY_RISK ─────────────────────────────────────────────
```

par :

```ts
// ─── Règle 10 : FUEL_SUPPLY_RISK ─────────────────────────────────────────────

// Valeurs du tableau de bord carburant et pétrole en français : aucune valeur anglaise du moteur
// à l'écran (spec §4.3). Les règles et les seuils ne changent pas.
const FUEL_TENSION_FR: Record<FuelTensionLevel, string> = {
  LOW: 'faible',
  MEDIUM: 'modérée',
  HIGH: 'forte',
  CRITICAL: 'critique',
};

const OIL_STATUS_FR: Record<OilVigilanceStatus, string> = {
  normal: 'normaux',
  tense: 'sous tension',
  critical: 'critiques',
  unknown: 'non renseignés',
};
```

3. Dans `detectFuelSupplyRisk`, remplacer :

```ts
  const topDepts = (raw.fuelTensionDashboard?.national.topDepartments ?? [])
    .slice(0, 3)
    .map(d => d.departmentName);
```

par :

```ts
  const topDepts = (raw.fuelTensionDashboard?.national.topDepartments ?? [])
    .slice(0, 3)
    .map(d => d.departmentName);
  const fuelWord = fuelLevel ? FUEL_TENSION_FR[fuelLevel] : 'inconnue';
  const oilWord = oilStatus ? OIL_STATUS_FR[oilStatus] : null;
```

puis remplacer :

```ts
    `Tension carburant ${fuelLevel}${oilStatus ? ` — stocks pétroliers ${oilStatus}` : ''}. ${Math.round(anomalyShare)}% des stations en anomalie de prix.`,
```

par :

```ts
    `Tension carburant ${fuelWord}${oilWord ? ` — stocks pétroliers ${oilWord}` : ''}. ${Math.round(anomalyShare)}% des stations en anomalie de prix.`,
```

puis :

```ts
      `Tension carburant nationale : ${fuelLevel}`,
      ...(oilTense ? [`Vigilance stocks pétroliers : ${oilStatus} (score ${oilVigilance}/100)`] : []),
```

par :

```ts
      `Tension carburant nationale : ${fuelWord}`,
      ...(oilTense && oilWord ? [`Vigilance stocks pétroliers : ${oilWord} (score ${oilVigilance}/100)`] : []),
```

et enfin :

```ts
      action('Identifier les départements à tension CRITICAL pour anticiper les blocages', 'IA + analyste territorial', 'cross-check', true),
```

par :

```ts
      action('Identifier les départements en tension critique pour anticiper les blocages', 'IA + analyste territorial', 'cross-check', true),
```

Dans `src/services/france-intel-brief.ts` :

1. Remplacer :

```ts
import { levelVigilanceWord, scoreLevel, type VigilanceLevel } from './vigilance.ts';
```

par :

```ts
import { levelVigilanceWord, scoreLevel, type VigilanceLevel } from './vigilance.ts';
import { splitScoreSentences } from './situation-text.ts';
```

2. Remplacer :

```ts
export function buildDeterministicBrief(
```

par :

```ts
/** Jugement de repli d'une situation : son titre et son résumé sans phrase chiffrée (sous-scores du moteur, spec §4.3). */
function situationJudgmentText(s: DetectedSituation): string {
  const plain = splitScoreSentences(s.summary).plain.join(' ');
  return plain ? `${s.title} — ${plain}` : s.title;
}

export function buildDeterministicBrief(
```

3. Dans `buildDeterministicBrief`, remplacer :

```ts
    text: `${s.title} — ${s.summary}`.slice(0, JUDGMENT_TEXT_MAX),
```

par :

```ts
    text: situationJudgmentText(s).slice(0, JUDGMENT_TEXT_MAX),
```

Dans `src/components/france-intel-events.ts`, dans `renderEventRow`, remplacer :

```ts
        <span class="frintel-ev-dot" style="background:${levelColorVar(eventLevel(e.severity))}"></span>
        <span class="frintel-ev-title">${escapeHtml(e.title)}</span>
```

par :

```ts
        <span class="frintel-ev-dot" style="background:${levelColorVar(eventLevel(e.severity))}"></span>
        <span class="frintel-ev-level">${levelLabel(eventLevel(e.severity), lang)}</span>
        <span class="frintel-ev-title">${escapeHtml(e.title)}</span>
```

Dans `src/components/SituationBrief.ts`, dans `renderItem`, remplacer :

```ts
        <span class="sit-brief__dot" style="background:${color};"></span>
```

par :

```ts
        <span class="sit-brief__dot" style="background:${color};"></span>
        <span class="sit-brief__item-level">${escapeHtml(item.severityLabel)}</span>
```

Ajouter à la fin de `src/styles/main.css` :

```css

/* ─── Le mot du niveau accompagne la couleur dans les lignes (refonte UI étape 2, §9) ─── */
.frintel-ev-level,
.sit-brief__item-level {
  flex: none;
  font-size: 10px;
  font-weight: 700;
  color: var(--text-secondary);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/situation-text.test.ts src/services/situation-engine.test.ts src/components/france-intel-events.test.ts src/components/SituationBrief.test.ts src/services/france-intel-brief.test.ts && npm run typecheck`
Expected: PASS, typecheck sans erreur.

- [ ] **Step 5: Run the task gate**

Run: `npx vitest run && npm run lint && npm run build`
Expected: tout vert (le brief compacte les facteurs du moteur : aucun test ne fige « HIGH »).

- [ ] **Step 6: Commit**

```bash
git add src/services/situation-text.ts src/services/situation-text.test.ts src/services/situation-engine.ts src/services/situation-engine.test.ts src/services/france-intel-brief.ts src/services/france-intel-brief.test.ts src/components/france-intel-events.ts src/components/france-intel-events.test.ts src/components/SituationBrief.ts src/components/SituationBrief.test.ts src/styles/main.css
git commit -m "feat: sous-scores du moteur hors des textes visibles, carburant en français, mot du niveau dans les lignes"
```

---

### Task 5: Note de situation en langage L1

Reporté par l'étape 1 : la note de situation (`SituationReport.ts`, `situation-report.ts`) adopte les libellés L1 ; sa mise en page ne change pas (spec §13).

**Files:**
- Modify: `src/services/vigilance.ts`, test `src/services/vigilance.test.ts`
- Modify: `src/services/situation-report.ts`, test `src/services/situation-report.test.ts`
- Modify: `src/components/SituationReport.ts`
- Create: `src/components/SituationReport.test.ts`

**Interfaces:**
- Consumes : `levelHex`, `levelLabel`, `levelVigilanceWord`, `situationLevel`, `eventLevel` (étape 1).
- Produces : `isnrLevel(score: number): VigilanceLevel` ; `ReportSituation.level`, `ReportDomainSignal.level`, `ReportEvent.level` (type `VigilanceLevel`, remplacent `severity: ReportSeverity`, type supprimé).

- [ ] **Step 1: Write the failing tests**

Dans `src/services/vigilance.test.ts`, ajouter `isnrLevel,` à la liste importée depuis `./vigilance.ts` (après `infraStatusLevel,`) et ajouter à la fin du fichier :

```ts
describe('isnrLevel (note de situation, arbitrage A8)', () => {
  it('bornes 20/40/60 ; « élevé » et « critique » fusionnent en rouge', () => {
    expect(isnrLevel(19)).toBe('vert');
    expect(isnrLevel(20)).toBe('jaune');
    expect(isnrLevel(39)).toBe('jaune');
    expect(isnrLevel(40)).toBe('orange');
    expect(isnrLevel(59)).toBe('orange');
    expect(isnrLevel(60)).toBe('rouge');
    expect(isnrLevel(95)).toBe('rouge');
    expect(isnrLevel(Number.NaN)).toBe('jaune');
  });
});
```

Dans `src/services/situation-report.test.ts`, passer les fixtures au champ `level` :

```bash
python3 - <<'EOF'
path = 'src/services/situation-report.test.ts'
src = open(path, encoding='utf-8').read()
n_crit = src.count("severity: 'critical'")
n_high = src.count("severity: 'high'")
src = src.replace("severity: 'critical'", "level: 'rouge'").replace("severity: 'high'", "level: 'orange'")
src = src.replace("statusLabel: 'TENSION'", "statusLabel: 'vigilance orange'")
src = src.replace("assert.ok(html.includes('TENSION'));", "assert.ok(html.includes('vigilance orange'));")
src = src.replace("Aucune situation critique détectée. Situation nominale.", "Aucune situation active : pas de vigilance particulière.")
open(path, 'w', encoding='utf-8').write(src)
print('critical →', n_crit, '; high →', n_high)
EOF
```

Expected : `critical → 2 ; high → 3`.

Puis ajouter à la fin de `src/services/situation-report.test.ts` :

```ts
describe('buildSituationReportHtml — langage commun L1 (refonte UI étape 2)', () => {
  it('le mot du niveau sur la teinte officielle, texte noir, sans ancien libellé', () => {
    const html = buildSituationReportHtml(
      baseData({
        situations: [{ title: 'Tension énergétique nationale', level: 'rouge', since: 'constatée à 14:30', zone: 'PACA' }],
      }),
    );
    assert.ok(html.includes('background:#ff3b30;'));
    assert.ok(html.includes('color:#111;'));
    assert.ok(html.includes('>Rouge</span>'));
    assert.ok(!html.includes('>Critique</span>'));
  });
});
```

Créer `src/components/SituationReport.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { collectSituationReportData, type SituationReportContext } from './SituationReport.ts';
import type { DetectedSituation } from '../types/index.ts';

function situation(over: Partial<DetectedSituation> = {}): DetectedSituation {
  return {
    id: 'defense-signal-elevated', type: 'DEFENSE_SIGNAL_ELEVATED', severity: 'watch', confidence: 0.6,
    title: 'Signal défense / renseignement élevé', summary: '12 vols militaires actifs.', affectedZones: ['France'],
    drivers: [], recommendedActions: [], sourceRefs: [], updatedAt: new Date('2026-09-24T07:00:00Z'), ...over,
  };
}

function ctx(over: Partial<SituationReportContext> = {}): SituationReportContext {
  const mix = { timestamp: new Date(0), nuclear: 0, wind: 0, solar: 0, hydro: 0, gas: 0, other: 0, total: 0 };
  return {
    generatedAt: new Date('2026-09-24T08:00:00Z'),
    permalink: 'https://example.org/?view=app&ui=v2',
    situations: [situation()],
    stability: { scores: [], nationalScore: 47, timestamp: new Date(0) },
    meteoAlerts: [{ department: 'Var', departmentCode: '83', level: 'violet', risks: ['heat'] }],
    floodSegments: [],
    ecowatt: { signals: { '53': 'red' }, mixes: {}, national: mix, interconnections: [] },
    sncfDisruptions: [],
    trafficIncidents: [],
    powerOutages: [],
    telecomOutages: [],
    newsItems: [],
    sources: [],
    version: null,
    ...over,
  };
}

describe('collectSituationReportData — langage commun L1 (refonte UI étape 2)', () => {
  it('une situation « veille » est jaune, jamais verte', () => {
    expect(collectSituationReportData(ctx()).situations[0].level).toBe('jaune');
  });

  it('l’indice de stabilité est dit en mot L1 (A8)', () => {
    expect(collectSituationReportData(ctx()).stability?.statusLabel).toBe('vigilance orange');
    expect(collectSituationReportData(ctx({ stability: { scores: [], nationalScore: 85, timestamp: new Date(0) } })).stability?.statusLabel)
      .toBe('vigilance rouge');
  });

  it('les signaux officiels rouges sont rouges, violet Météo compris', () => {
    const data = collectSituationReportData(ctx());
    expect(data.domainSignals.find((d) => d.domain.startsWith('Écowatt'))?.level).toBe('rouge');
    expect(data.domainSignals.find((d) => d.domain === 'Vigilance météo')?.level).toBe('rouge');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/vigilance.test.ts src/services/situation-report.test.ts src/components/SituationReport.test.ts`
Expected: FAIL. `isnrLevel is not a function` ; badges encore « Critique » sur fond clair ; `level` indéfini dans les données collectées.

- [ ] **Step 3: Write the implementation**

Ajouter à la fin de `src/services/vigilance.ts` :

```ts

/**
 * Indice ISNR (0–100, plus haut = pire) pour la note de situation : bornes existantes 20/40/60 ;
 * « élevé » (60–79) et « critique » (≥ 80) fusionnent en rouge, comme l'indice national (A8).
 */
export function isnrLevel(score: number): VigilanceLevel {
  if (!Number.isFinite(score)) return 'jaune';
  if (score >= 60) return 'rouge';
  if (score >= 40) return 'orange';
  if (score >= 20) return 'jaune';
  return 'vert';
}
```

Dans `src/services/situation-report.ts` :

1. Remplacer :

```ts
// ─── Types partagés (données de la note) ─────────────────────────────────────

/** Sévérité normalisée pour l'affichage de la note. */
export type ReportSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
```

par :

```ts
import { levelHex, levelLabel, type VigilanceLevel } from './vigilance.ts';

// ─── Types partagés (données de la note) ─────────────────────────────────────
// Niveaux en langage commun L1 (refonte UI, étape 2) : Rouge, Orange, Jaune, Vert.
```

2. Remplacer les trois lignes `  severity: ReportSeverity;` (dans `ReportSituation`, `ReportDomainSignal` et `ReportEvent`) par `  level: VigilanceLevel;`, et le commentaire `  /** STABLE / VEILLE / TENSION / ÉLEVÉ / CRITIQUE. */` de `ReportStability` par `  /** Mot L1 de l'indice (« vigilance orange »). */`.

3. Remplacer tout le bloc :

```ts
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
```

par rien (bloc supprimé).

4. Remplacer :

```ts
function severityBadge(severity: ReportSeverity): string {
  const s = SEVERITY_STYLE[severity];
  return `<span class="badge" style="color:${s.fg};background:${s.bg};border-color:${s.border};">${escapeHtml(s.label)}</span>`;
}
```

par :

```ts
/** Pastille L1 : le mot sur la teinte officielle, texte noir (contraste AA, spec §4.1). */
function levelBadge(level: VigilanceLevel): string {
  const hex = levelHex(level);
  return `<span class="badge" style="color:#111;background:${hex};border-color:${hex};">${escapeHtml(levelLabel(level))}</span>`;
}
```

5. Dans `renderSituations`, remplacer :

```ts
    return `<p class="nominal">Aucune situation critique détectée. Situation nominale.</p>`;
```

par :

```ts
    return `<p class="nominal">Aucune situation active : pas de vigilance particulière.</p>`;
```

et :

```ts
        <li class="sit-item" style="border-left-color:${SEVERITY_STYLE[s.severity].fg};">
          <div class="sit-head">
            ${severityBadge(s.severity)}
```

par :

```ts
        <li class="sit-item" style="border-left-color:${levelHex(s.level)};">
          <div class="sit-head">
            ${levelBadge(s.level)}
```

6. Dans `renderDomains`, remplacer :

```ts
      <li class="dom-item" style="border-left-color:${SEVERITY_STYLE[d.severity].fg};">
        <div class="dom-head">
          <span class="dom-name">${escapeHtml(d.domain)}</span>
          ${severityBadge(d.severity)}
```

par :

```ts
      <li class="dom-item" style="border-left-color:${levelHex(d.level)};">
        <div class="dom-head">
          <span class="dom-name">${escapeHtml(d.domain)}</span>
          ${levelBadge(d.level)}
```

7. Dans `renderEvents`, remplacer `<td class="ev-title">${severityBadge(e.severity)} ${escapeHtml(e.title)}</td>` par `<td class="ev-title">${levelBadge(e.level)} ${escapeHtml(e.title)}</td>`.

8. Dans `STYLES`, remplacer :

```css
  .badge {
    display: inline-block; font-size: 9px; font-weight: 800; letter-spacing: 0.04em;
    text-transform: uppercase; padding: 1px 6px; border: 1px solid; border-radius: 3px;
    vertical-align: middle;
  }
```

par :

```css
  .badge {
    display: inline-block; font-size: 9.5px; font-weight: 800;
    padding: 1px 6px; border: 1px solid; border-radius: 3px;
    vertical-align: middle;
  }
```

Dans `src/components/SituationReport.ts` :

1. Dans `import type { … } from '../types/index.ts';`, retirer `SituationSeverity,` et `ThreatLevel,`.

2. Remplacer :

```ts
import {
  buildSituationReportHtml,
  type ReportDomainSignal,
  type ReportEvent,
  type ReportSeverity,
  type ReportSituation,
```

par :

```ts
import { eventLevel, isnrLevel, levelVigilanceWord, situationLevel } from '../services/vigilance.ts';
import {
  buildSituationReportHtml,
  type ReportDomainSignal,
  type ReportEvent,
  type ReportSituation,
```

3. Supprimer toute la section `// ─── Mappings de sévérité ───…` : les fonctions `mapSituationSeverity`, `mapThreatLevel` et `stabilityStatusLabel`.

4. Dans `buildDomainSignals`, remplacer les cinq lignes de sévérité :

| Remplacer | par |
|---|---|
| `severity: red.length > 0 ? 'high' : 'medium',` | `level: red.length > 0 ? 'rouge' : 'orange',` |
| `severity: meteoRed.length > 0 ? 'critical' : 'medium',` | `level: meteoRed.length > 0 ? 'rouge' : 'orange',` |
| `severity: floodRed.length > 0 ? 'critical' : 'medium',` | `level: floodRed.length > 0 ? 'rouge' : 'orange',` |
| `severity: hasCritical ? 'high' : 'medium',` | `level: hasCritical ? 'orange' : 'jaune',` |
| `severity: totalOff >= 5000 \|\| telecomActive.length >= 5 ? 'high' : 'medium',` | `level: totalOff >= 5000 \|\| telecomActive.length >= 5 ? 'orange' : 'jaune',` |

5. Dans `collectSituationReportData`, remplacer `severity: mapSituationSeverity(s.severity),` par `level: situationLevel(s.severity),`, `statusLabel: stabilityStatusLabel(ctx.stability.nationalScore),` par `statusLabel: levelVigilanceWord(isnrLevel(ctx.stability.nationalScore)),`, et `severity: mapThreatLevel(n.threat?.level),` par `level: eventLevel(n.threat?.level ?? 'info'),`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/vigilance.test.ts src/services/situation-report.test.ts src/components/SituationReport.test.ts && npm run typecheck`
Expected: PASS, typecheck sans erreur (`noUnusedLocals` signalerait un reste de `ReportSeverity` ou des anciens mappings).

- [ ] **Step 5: Run the task gate**

Run: `npx vitest run && npm run lint && npm run build`
Expected: tout vert.

- [ ] **Step 6: Commit**

```bash
git add src/services/vigilance.ts src/services/vigilance.test.ts src/services/situation-report.ts src/services/situation-report.test.ts src/components/SituationReport.ts src/components/SituationReport.test.ts
git commit -m "feat: note de situation en langage commun L1"
```

---

### Task 6: Blocs du tiroir en rendus purs (extraction sans changement visible)

La fiche France doit contenir tout ce que montrait le tiroir (§14) : indice, jauge, piliers, Δ24 h, courbe 7 jours, plafond, facteur principal, domaines, bloc énergie, chronologie 7 jours. Ces rendus sont extraits en fonctions pures, partagées par le tiroir (v1) et la fiche (v2).

**Files:**
- Create: `src/components/france-intel-blocks.ts`
- Test: `src/components/france-intel-blocks.test.ts`
- Modify: `src/components/france-intel-score.ts`, test `src/components/france-intel-score.test.ts`
- Modify: `src/components/FranceIntelPanel.ts`

**Interfaces:**
- Produces : `renderDomainsBlock(snapshot: Pick<FranceCountrySnapshot, 'signals' | 'meteo'>, lang): string` ; `renderEnergyBlock(energy: FranceIntelEnergySummary | null, lang): string` ; `renderTimelineBlock(timeline: FranceCountrySnapshot['timeline'], lang): string` ; `interface WhyBodyInput { breakdown; delta24h; pillarDeltas; series; lang }` ; `ScoreCardInput extends WhyBodyInput { whyOpen }` ; `renderWhyBody(input: WhyBodyInput): string` ; `trendText(delta: number | null, lang): string` (exporté).

- [ ] **Step 1: Write the failing tests**

Créer `src/components/france-intel-blocks.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { renderDomainsBlock, renderEnergyBlock, renderTimelineBlock } from './france-intel-blocks.ts';
import type { FranceCountrySignals, FranceIntelEnergySummary } from '../types/index.ts';

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
    ecowattSignal: 'red', totalMw: 53600, shares: { nuclear: 70, gas: 5, hydro: 10, wind: 8, solar: 4, other: 3 },
    nuclearStress: null, windGw: 4.2, windLoadFactor: 18, oilStocksDays: 46, oilVigilanceStatus: 'tense',
    fuelTensionLevel: 'HIGH', fuelTensionAnomalyShare: 9.2, fuelPriceHistory: null, ...over,
  };
}

describe('blocs du tiroir en rendus purs (refonte UI étape 2)', () => {
  it('domaines : tuiles en casse normale et risques météo actifs', () => {
    const html = renderDomainsBlock({
      signals: signals({ cyberAlerts: 7, meteoAlerts: 2 }),
      meteo: [{ department: 'Var', departmentCode: '83', level: 'red', risks: ['heat'] }],
    }, 'fr');
    expect(html).toContain('>Domaines<');
    expect(html).toContain('Cyber');
    expect(html).toContain('Canicule · Rouge');
  });

  it('énergie : signal Écowatt en mot L1, carburants en pastille, statut inconnu jamais vert', () => {
    const html = renderEnergyBlock(energy(), 'fr');
    expect(html).toContain('Écowatt : signal rouge');
    expect(html).toContain('<span class="fm-vig fm-vig--orange">Orange</span>');
    expect(renderEnergyBlock(energy({ oilVigilanceStatus: 'unknown' }), 'fr')).toContain('color:var(--text-secondary);">46j');
    expect(renderEnergyBlock(null, 'fr')).toContain('Aucun profil énergie disponible.');
  });

  it('chronologie : jours et libellés échappés', () => {
    const html = renderTimelineBlock({
      days: ['<b>1 sept.</b>'],
      lanes: [{ key: 'social', label: '<i>Social</i>', color: '#ef4444', counts: [2] }],
    }, 'fr');
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('<i>');
    expect(html).toContain('&lt;i&gt;Social&lt;/i&gt;');
  });
});
```

Dans `src/components/france-intel-score.test.ts`, remplacer :

```ts
import { renderScoreCard, renderSituationRow, scoreDriverText } from './france-intel-score.ts';
```

par :

```ts
import { renderScoreCard, renderSituationRow, renderWhyBody, scoreDriverText, trendText } from './france-intel-score.ts';
```

et ajouter à la fin du fichier :

```ts
describe('renderWhyBody (partagé avec la fiche France, refonte UI étape 2)', () => {
  it('rend le contenu chiffré sans le volet qui l’entoure, identique à celui du tiroir', () => {
    const html = renderWhyBody({ ...base, breakdown: breakdown(43) });
    expect(html).toContain('Indice de stabilité 43/100');
    expect(html).toContain('frintel-pillars');
    expect(html).not.toContain('<details');
    expect(renderScoreCard({ ...base, breakdown: breakdown(43) })).toContain(html);
  });

  it('trendText dit la tendance en mots', () => {
    expect(trendText(-3, 'fr')).toBe('en dégradation sur 24 h');
    expect(trendText(2, 'en')).toBe('improving over 24 h');
    expect(trendText(null, 'fr')).toBe('');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/france-intel-blocks.test.ts src/components/france-intel-score.test.ts`
Expected: FAIL, `Cannot find module './france-intel-blocks.ts'` ; `renderWhyBody is not a function`.

- [ ] **Step 3: Écrire le module des blocs**

Créer `src/components/france-intel-blocks.ts` (les trois rendus sont ceux de `FranceIntelPanel.ts`, recopiés à l'identique ; seul `escapeHtml` vient désormais de `france-intel-events.ts`) :

```ts
// src/components/france-intel-blocks.ts — blocs « Domaines », « Énergie » et « Chronologie 7 jours »
// du tiroir Intelligence France, extraits en rendus purs (refonte UI, étape 2) pour être partagés
// avec le volet « Pourquoi ce niveau ? » de la fiche France. Aucun accès au DOM : testable sous
// Node. Rendu identique à l'ancien tiroir ; seul l'échappement passe par la version chaîne.

import type {
  FranceCountrySnapshot,
  FranceIntelEnergySummary,
  FranceIntelTimelineLane,
  MeteoVigilanceLevel,
} from '../types/index.ts';
import { escapeHtml } from './france-intel-events.ts';
import {
  filterFuelPriceSeries,
  formatFuelDeltaCents,
  formatFuelPrice,
  renderFuelPriceChartSvg,
} from '../utils/fuelPriceChart.ts';
import { fuelTensionLevel, levelColorVar, levelLabel, officialLevel } from '../services/vigilance.ts';
import { renderVigilancePill } from './shared/vigilancePill.ts';

type Lang = 'fr' | 'en';

function t(lang: Lang, fr: string, en: string): string {
  return lang === 'fr' ? fr : en;
}

const VIGILANCE_LABELS: Record<MeteoVigilanceLevel, string> = {
  green: 'Vert',
  yellow: 'Jaune',
  orange: 'Orange',
  red: 'Rouge',
  violet: 'Violet',
};

const RISK_LABELS: Record<string, string> = {
  wind: 'Vent',
  'rain-flood': 'Pluie-inondation',
  thunderstorm: 'Orages',
  flood: 'Crues',
  'snow-ice': 'Neige-verglas',
  heat: 'Canicule',
  cold: 'Grand froid',
  avalanche: 'Avalanches',
  'wave-surge': 'Vagues-submersion',
};

function intensity(count: number): number {
  if (count <= 0) return 0.08;
  if (count === 1) return 0.25;
  if (count === 2) return 0.45;
  if (count === 3) return 0.65;
  return 0.9;
}

function renderTimelineLane(lane: FranceIntelTimelineLane): string {
  return `
    <div class="frintel-timeline-row">
      <div class="frintel-timeline-label">${escapeHtml(lane.label)}</div>
      <div class="frintel-timeline-track">
        ${lane.counts.map((count) => `
          <span
            class="frintel-timeline-cell"
            title="${escapeHtml(`${lane.label}: ${count}`)}"
            style="--fi-timeline-color:${lane.color};--fi-timeline-alpha:${intensity(count)};"
          >${count > 0 ? count : ''}</span>
        `).join('')}
      </div>
    </div>
  `;
}

export function renderDomainsBlock(snapshot: Pick<FranceCountrySnapshot, 'signals' | 'meteo'>, lang: Lang): string {
  const s = snapshot.signals;
  const outages = s.powerOutages + s.telecomOutages;
  const meteoTotal = s.meteoAlerts + s.floodAlerts + s.fireDetections;
  type Level = 'low' | 'medium' | 'high';
  const tiles: Array<{ label: string; value: number; meta: string; level: Level }> = [
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
  const levelColor: Record<Level, string> = {
    low: levelColorVar('vert'), medium: levelColorVar('jaune'), high: levelColorVar('orange'),
  };
  const tilesHtml = tiles.map((tile) => `
    <div class="frintel-dom-tile">
      <span class="frintel-dom-dot" style="background:${levelColor[tile.level]};"></span>
      <span class="frintel-dom-label">${escapeHtml(tile.label)}</span>
      <div class="frintel-dom-value">${tile.value} <span class="frintel-dom-meta">${escapeHtml(tile.meta)}</span></div>
    </div>
  `).join('');

  // Chips vigilances météo actives (même logique qu'avant, sans emoji)
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
  const chips: string[] = [];
  for (const [risk, item] of riskMap.entries()) {
    chips.push(`<span class="frintel-chip frintel-chip-warn">${escapeHtml(RISK_LABELS[risk] ?? risk)} · ${escapeHtml(VIGILANCE_LABELS[item.level])}${item.count > 1 ? ` ×${item.count}` : ''}</span>`);
  }
  if (s.railSevere > 0) chips.push(`<span class="frintel-chip frintel-chip-warn">${s.railSevere} SNCF ${t(lang, 'fortes', 'severe')}</span>`);
  if (s.criticalNews > 0) chips.push(`<span class="frintel-chip frintel-chip-crit">${s.criticalNews} ${t(lang, 'titres critiques', 'critical headlines')}</span>`);

  return `
    <section class="frintel-card">
      <div class="frintel-card-top">
        <div class="frintel-card-title">${t(lang, 'Domaines', 'Domains')}</div>
        <div class="frintel-card-meta">${t(lang, 'État par domaine de surveillance', 'Status by watch domain')}</div>
      </div>
      <div class="frintel-dom-grid">${tilesHtml}</div>
      ${chips.length > 0 ? `<div class="frintel-chip-wrap">${chips.join('')}</div>` : ''}
    </section>
  `;
}

export function renderEnergyBlock(energy: FranceIntelEnergySummary | null, lang: Lang): string {
  const energySegments = energy
    ? [
        { label: 'Nuclear', color: '#7c3aed', value: energy.shares.nuclear },
        { label: 'Gas', color: '#2563eb', value: energy.shares.gas },
        { label: 'Hydro', color: '#38bdf8', value: energy.shares.hydro },
        { label: 'Wind', color: '#60a5fa', value: energy.shares.wind },
        { label: 'Solar', color: '#facc15', value: energy.shares.solar },
        { label: t(lang, 'Autre', 'Other'), color: '#34c759', value: energy.shares.other },
      ].filter((segment) => segment.value > 0)
    : [];

  return `
    <section class="frintel-card">
      <div class="frintel-card-top">
        <div class="frintel-card-title">${t(lang, 'Énergie', 'Energy')}</div>
        <div class="frintel-card-meta">${energy?.ecowattSignal ? `${t(lang, 'Écowatt : signal', 'Ecowatt: signal')} ${levelLabel(officialLevel(energy.ecowattSignal), lang).toLowerCase()}` : t(lang, 'Données partielles', 'Partial data')}</div>
      </div>
      ${energy ? `
        <div class="frintel-energy-stack">
          ${energySegments.map((segment) => `<span style="width:${segment.value}%;background:${segment.color};"></span>`).join('')}
        </div>
        <div class="frintel-energy-legend">
          ${energySegments.map((segment) => `
            <div class="frintel-energy-row">
              <span class="frintel-energy-dot" style="background:${segment.color};"></span>
              <span>${escapeHtml(segment.label)} ${segment.value}%</span>
            </div>
          `).join('')}
        </div>
        <div class="frintel-energy-meta">
          <span>${t(lang, 'Production totale', 'Total production')} ${energy.totalMw ?? 'n/a'} MW</span>
          <span>${t(lang, 'Éolien live', 'Live wind')} ${energy.windGw != null ? `${energy.windGw.toFixed(1)} GW` : 'n/a'}</span>
          <span>${t(lang, 'Charge éolienne', 'Wind load factor')} ${energy.windLoadFactor != null ? `${energy.windLoadFactor}%` : 'n/a'}</span>
        </div>
        ${(() => {
          const oilDays = energy.oilStocksDays;
          const oilStatus = energy.oilVigilanceStatus;
          const fuelLevel = energy.fuelTensionLevel;
          const fuelAnomaly = energy.fuelTensionAnomalyShare;
          const fuelHistory = energy.fuelPriceHistory;
          const hasFuelHistory = !!fuelHistory && fuelHistory.series.length > 0;
          if (!oilDays && !fuelLevel && !hasFuelHistory) return '';
          // Jamais vert pour un statut inconnu (couleur neutre) ; les autres statuts suivent L1.
          const oilColor = oilStatus === 'critical' ? levelColorVar('rouge')
            : oilStatus === 'tense' ? levelColorVar('orange')
            : oilStatus === 'normal' ? levelColorVar('vert')
            : 'var(--text-secondary)';
          const oilLabel = oilStatus === 'critical' ? t(lang, 'Critique', 'Critical')
            : oilStatus === 'tense' ? t(lang, 'Sous tension', 'Tense')
            : oilStatus === 'normal' ? t(lang, 'Normal', 'Normal')
            : t(lang, 'Inconnu', 'Unknown');
          const visibleSeries = hasFuelHistory ? filterFuelPriceSeries(fuelHistory, '1m') : [];
          const fuelChart = visibleSeries.length > 0
            ? renderFuelPriceChartSvg(visibleSeries, {
                width: 320,
                height: 92,
                showAxes: false,
              })
            : '';
          const fuelLegend = visibleSeries.map((series) => `
            <div class="frintel-fuel-row">
              <span class="frintel-fuel-name">
                <span class="frintel-fuel-dot" style="background:${series.color};"></span>
                ${escapeHtml(series.label)}
              </span>
              <span class="frintel-fuel-value">${escapeHtml(formatFuelPrice(series.latestPrice))}</span>
              <span class="frintel-fuel-delta" style="color:var(--text-secondary);">7j ${escapeHtml(formatFuelDeltaCents(series.delta7dCents))}</span>
            </div>
          `).join('');
          return `
            <div class="frintel-oil-block">
              <div class="frintel-oil-title">${t(lang, 'Pétrole & Carburants', 'Oil & Fuels')}</div>
              <div class="frintel-oil-grid">
                ${oilDays != null ? `
                  <div class="frintel-oil-row">
                    <span class="frintel-oil-label">${t(lang, 'Stocks nationaux', 'National stocks')}</span>
                    <span class="frintel-oil-value" style="color:${oilColor};">${oilDays}j <span class="frintel-oil-badge" style="color:${oilColor};">${escapeHtml(oilLabel)}</span></span>
                  </div>
                ` : ''}
                ${fuelLevel != null ? `
                  <div class="frintel-oil-row">
                    <span class="frintel-oil-label">${t(lang, 'Tension carburants', 'Fuel tension')}</span>
                    <span class="frintel-oil-value">
                      ${renderVigilancePill(fuelTensionLevel(fuelLevel), lang)}
                      ${fuelAnomaly != null ? ` <span class="frintel-oil-badge" style="color:${levelColorVar(fuelTensionLevel(fuelLevel))};">${fuelAnomaly.toFixed(1)}% ${t(lang, 'anomalies', 'anomalies')}</span>` : ''}
                    </span>
                  </div>
                ` : ''}
              </div>
              ${fuelChart ? `
                <div class="frintel-fuel-history">
                  <div class="frintel-fuel-history-title">${t(lang, 'Prix moyens carburants · 30 jours', 'Average fuel prices · 30 days')}</div>
                  <div class="frintel-fuel-chart">${fuelChart}</div>
                  <div class="frintel-fuel-legend">${fuelLegend}</div>
                </div>
              ` : ''}
            </div>
          `;
        })()}
      ` : `<div class="frintel-empty">${t(lang, 'Aucun profil énergie disponible.', 'No energy profile available.')}</div>`}
    </section>
  `;
}

export function renderTimelineBlock(timeline: FranceCountrySnapshot['timeline'], lang: Lang): string {
  return `
    <section class="frintel-card">
      <div class="frintel-card-top">
        <div class="frintel-card-title">${t(lang, 'Chronologie 7 jours', '7-Day Timeline')}</div>
        <div class="frintel-card-meta">${t(lang, 'Lecture par intensité de signal', 'Signal intensity view')}</div>
      </div>
      <div class="frintel-timeline-head">
        <div></div>
        <div class="frintel-timeline-days">
          ${timeline.days.map((day) => `<span>${escapeHtml(day)}</span>`).join('')}
        </div>
      </div>
      <div class="frintel-timeline">
        ${timeline.lanes.map(renderTimelineLane).join('')}
      </div>
    </section>
  `;
}
```

- [ ] **Step 4: Extraire le corps du volet et la tendance**

Dans `src/components/france-intel-score.ts` :

1. Remplacer :

```ts
export interface ScoreCardInput {
  breakdown: FranceScoreBreakdown;
  delta24h: number | null;
  pillarDeltas: StabilityPillarValues | null;
  series: number[];
  lang: Lang;
  whyOpen: boolean;
}
```

par :

```ts
/** Contenu chiffré du volet « Pourquoi ce niveau ? » (tiroir v1 et fiche France v2). */
export interface WhyBodyInput {
  breakdown: FranceScoreBreakdown;
  delta24h: number | null;
  pillarDeltas: StabilityPillarValues | null;
  series: number[];
  lang: Lang;
}

export interface ScoreCardInput extends WhyBodyInput {
  whyOpen: boolean;
}
```

2. Remplacer `function trendText(delta: number | null, lang: Lang): string {` par :

```ts
/** « en dégradation sur 24 h » / « en amélioration sur 24 h » ; vide si stable ou inconnu. */
export function trendText(delta: number | null, lang: Lang): string {
```

3. Remplacer toute la fonction `renderScoreCard` (de `export function renderScoreCard(input: ScoreCardInput): string {` jusqu'à son `}` final, juste avant `export function renderSituationRow`) par :

```ts
/** Intérieur du volet « Pourquoi ce niveau ? » : indice, Δ24 h, jauge, courbe 7 jours, piliers, facteur, plafond. */
export function renderWhyBody(input: WhyBodyInput): string {
  const { breakdown: bd, lang } = input;
  const level = scoreLevel(bd.score);

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

  // Δ24 h chiffré et facteur principal (spec §14) : visibles uniquement dans le volet replié.
  const deltaLine = `<div class="frintel-why-delta">${t(lang, 'Variation sur 24 h : ', '24 h change: ')}${formatDelta(input.delta24h)}</div>`;
  const factor = dominantFactorText(bd, lang);
  const factorLine = factor
    ? `<div class="frintel-why-factor">${t(lang, 'Facteur principal : ', 'Main factor: ')}${factor}</div>`
    : '';

  return `
    <div class="frintel-why-index">${t(lang, `Indice de stabilité ${bd.score}/100 (base ${bd.baseline}, moins la pression en temps réel)`, `Stability index ${bd.score}/100 (baseline ${bd.baseline}, minus live pressure)`)}</div>
    ${deltaLine}
    <div class="frintel-gauge" role="img" aria-label="${t(lang, `Indice ${bd.score} sur 100`, `Index ${bd.score} out of 100`)}">
      <span class="frintel-gauge-zone" style="width:55%;background:${levelColorVar('rouge')};"></span>
      <span class="frintel-gauge-zone" style="width:15%;background:${levelColorVar('orange')};"></span>
      <span class="frintel-gauge-zone" style="width:15%;background:${levelColorVar('jaune')};"></span>
      <span class="frintel-gauge-zone" style="width:15%;background:${levelColorVar('vert')};"></span>
      <span class="frintel-gauge-marker" style="left:${bd.score}%;"></span>
    </div>
    <div class="frintel-gauge-scale">
      <span class="frintel-gauge-scale-tick" style="left:0%;">0</span>
      <span class="frintel-gauge-scale-tick" style="left:55%;">55</span>
      <span class="frintel-gauge-scale-tick" style="left:70%;">70</span>
      <span class="frintel-gauge-scale-tick" style="left:85%;">85</span>
      <span class="frintel-gauge-scale-tick" style="left:100%;">100</span>
    </div>
    ${renderSparkline(input.series, level, lang)}
    <div class="frintel-pillars">${pillarRows}</div>
    ${factorLine}
    ${capLine}
  `;
}

export function renderScoreCard(input: ScoreCardInput): string {
  const { breakdown: bd, lang } = input;
  const level = scoreLevel(bd.score);
  const trend = trendText(input.delta24h, lang);

  return `
    <section class="frintel-card frintel-level-card">
      <div class="frintel-level-row">
        ${renderVigilancePill(level, lang)}
        <span class="frintel-level-phrase">${levelPhrase(level, lang)}</span>
      </div>
      <div class="frintel-level-driver">${scoreDriverText(bd, lang)}${trend ? ` · ${trend}` : ''}</div>
      <details class="frintel-why"${input.whyOpen ? ' open' : ''}>
        <summary>${t(lang, 'Pourquoi ce niveau ?', 'Why this level?')}</summary>
        <div class="frintel-why-body">${renderWhyBody(input)}</div>
      </details>
    </section>
  `;
}
```

- [ ] **Step 5: Brancher le tiroir sur les blocs extraits**

Dans `src/components/FranceIntelPanel.ts` :

1. Remplacer :

```ts
import type {
  FranceCountrySnapshot,
  FranceIntelTimelineLane,
  IntelEventsState,
  MeteoVigilanceLevel,
  DetectedSituation,
  StructuredBrief,
} from '../types/index.ts';
```

par :

```ts
import type {
  FranceCountrySnapshot,
  IntelEventsState,
  DetectedSituation,
  StructuredBrief,
} from '../types/index.ts';
```

2. Supprimer l'import de `../utils/fuelPriceChart.ts` (bloc `import { filterFuelPriceSeries, … } from '../utils/fuelPriceChart.ts';`).

3. Remplacer :

```ts
import { briefConfidenceLabel, fuelTensionLevel, levelColorVar, levelLabel, officialLevel } from '../services/vigilance.ts';
import { renderVigilancePill } from './shared/vigilancePill.ts';
```

par :

```ts
import { briefConfidenceLabel } from '../services/vigilance.ts';
import { renderDomainsBlock, renderEnergyBlock, renderTimelineBlock } from './france-intel-blocks.ts';
```

4. Supprimer les constantes `VIGILANCE_LABELS` et `RISK_LABELS`, les fonctions `intensity` et `renderTimelineLane`, et les méthodes `renderDomainsBlock`, `renderEnergyBlock` et `renderTimelineBlock` de la classe : leur code est désormais, à l'identique, dans `france-intel-blocks.ts`.

5. Dans `renderContentNow`, remplacer :

```ts
      ${this.renderDomainsBlock(snapshot, lang)}
      ${this.renderEnergyBlock(snapshot, lang)}
      ${this.renderTimelineBlock(snapshot, lang)}
```

par :

```ts
      ${renderDomainsBlock(snapshot, lang)}
      ${renderEnergyBlock(snapshot.energy, lang)}
      ${renderTimelineBlock(snapshot.timeline, lang)}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/components/france-intel-blocks.test.ts src/components/france-intel-score.test.ts && npm run typecheck`
Expected: PASS (3 + 12 tests), typecheck sans erreur (`noUnusedLocals` signalerait un reste dans `FranceIntelPanel.ts`).

- [ ] **Step 7: Run the task gate**

Run: `npx vitest run && npm run lint && npm run build`
Expected: tout vert.

- [ ] **Step 8: Commit**

```bash
git add src/components/france-intel-blocks.ts src/components/france-intel-blocks.test.ts src/components/france-intel-score.ts src/components/france-intel-score.test.ts src/components/FranceIntelPanel.ts
git commit -m "refactor: blocs du tiroir et volet « Pourquoi ce niveau ? » en rendus purs partagés"
```

---

### Task 7: Fiche unique : parties communes et fiche France

**Files:**
- Create: `src/components/fiche/parts.ts`
- Test: `src/components/fiche/parts.test.ts`
- Create: `src/components/fiche/france.ts`
- Test: `src/components/fiche/france.test.ts`

**Interfaces:**
- Consumes : tâche 1 (`drivenByText`, `ThemeId`) ; tâches 2 et 3 (`WorkQueue`, `buildWorkQueue`) ; tâche 6 (`renderWhyBody`, blocs) ; `escapeHtml`, `safeHref`, `formatAge`, `resolveEvidenceRef` (`france-intel-events.ts`) ; `BriefSourceSituation` (`situation-brief.ts`) ; `StabilityPillarValues`.
- Produces (`parts.ts`) : `type Lang` ; `t(lang, fr, en)` ; `labelled(lang, fr, en, text)` ; `parseTime(iso)` ; `formatClock(ms, lang)` ; `formatNumber(value, lang)` ; `severityWord(value, lang)` ; `digestChangeText(item: ChangeDigestItem, lang)` ; `nothingToHandleText(greenTracked, lang)` ; `interface FicheChange { at; text; select }` ; `FicheFigure` ; `FicheWatch` ; `FicheSource { label; href; select }` ; `FicheAction { id; label }` ; `FicheSection { title; html }` ; `interface FicheModel` ; `renderFiche(model, lang): string`.
- Produces (`france.ts`) : `type FranceFicheSnapshot = Pick<FranceCountrySnapshot, 'score' | 'scoreBreakdown' | 'situations' | 'signals' | 'meteo' | 'energy' | 'timeline'>` ; `interface FranceFicheInput` ; `buildFranceFiche(input): FicheModel`.

- [ ] **Step 1: Write the failing tests**

Créer `src/components/fiche/parts.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { digestChangeText, nothingToHandleText, renderFiche, severityWord, type FicheModel } from './parts.ts';
import type { ChangeDigestItem, NewsEvent } from '../../types/index.ts';

function model(over: Partial<FicheModel> = {}): FicheModel {
  return {
    key: 'event:42', kind: 'Événement', name: 'Explosion', level: 'rouge', driver: '3 sources indépendantes',
    freshness: 'Dernier article il y a 10 min', essentiel: ['Repris par 3 sources.'], changesMeta: '',
    changes: [{ at: null, text: 'créé · rouge', select: null }], sections: [{ title: 'Facteurs', html: '<ul><li>f</li></ul>' }],
    figures: [{ label: 'Articles', value: '3' }], watch: [{ text: 'Signal Écowatt de demain', horizon: '6 h' }],
    sourcesTitle: 'Articles', sources: [{ label: 'Le Monde', href: 'https://example.org/a', select: null }],
    why: '<p>Classement</p>', whyOpen: false, actions: [{ id: 'map', label: 'Voir sur la carte' }], ...over,
  };
}

describe('renderFiche (spec §6.2)', () => {
  it('rend les parties dans l’ordre de la spec', () => {
    const html = renderFiche(model(), 'fr');
    const order = ['fiche-head', 'fiche-essentiel', 'fiche-changes', 'fiche-extra', 'fiche-figures', 'fiche-watch', 'fiche-sources', 'fiche-why', 'fiche-actions'];
    const positions = order.map((cls) => html.indexOf(cls));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('omet les parties vides', () => {
    const html = renderFiche(model({ changes: [], figures: [], watch: [], sources: [], why: '', actions: [], sections: [] }), 'fr');
    for (const cls of ['fiche-changes', 'fiche-figures', 'fiche-watch', 'fiche-sources', 'fiche-why', 'fiche-actions', 'fiche-extra']) {
      expect(html).not.toContain(cls);
    }
  });

  it('échappe le texte tiers, n’ouvre que les liens http(s) et garde les attributs fermés (revue)', () => {
    const html = renderFiche(model({
      name: '<img src=x onerror=alert(1)>',
      sources: [
        { label: 'piège', href: 'javascript:alert(1)', select: null },
        { label: 'ok', href: 'https://example.org/a?b="c"', select: null },
        { label: 'sit', href: null, select: 'situation:x" onfocus="alert(1)' },
      ],
    }), 'fr');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('href="https://example.org/a?b=&quot;c&quot;" target="_blank" rel="noopener noreferrer"');
    expect(html).toContain('data-select="situation:x&quot; onfocus=&quot;alert(1)"');
  });

  it('garde le volet ouvert quand il l’était ; trois chiffres au plus ; heure inconnue en tiret', () => {
    const figures = [1, 2, 3, 4].map((n) => ({ label: `c${n}`, value: String(n) }));
    const html = renderFiche(model({ whyOpen: true, figures }), 'fr');
    expect(html).toContain('<details class="fiche-why" data-why="event:42" open>');
    expect(html).not.toContain('c4');
    expect(html).toContain('<span class="fiche-time">—</span>');
  });

  it('passe en anglais avec la bascule EN', () => {
    const html = renderFiche(model(), 'en');
    expect(html).toContain('Why this level?');
    expect(html).toContain('Key figures');
  });
});

describe('textes communs', () => {
  const ev = (over: Partial<NewsEvent> = {}): NewsEvent => ({
    id: 42, evidenceId: 'E42', title: 'Explosion', category: 'security', severity: 'high', status: 'active',
    firstSeen: '2026-09-24T07:00:00Z', lastSeen: '2026-09-24T07:30:00Z', articleCount: 3, sourceCount: 3,
    independentCount: 3, sourceNames: [], lat: null, lon: null, ...over,
  });
  const item = (kinds: ChangeDigestItem['kinds'], over: Partial<ChangeDigestItem> = {}): ChangeDigestItem => ({
    event: ev(), kinds, latestAt: '2026-09-24T07:30:00Z', severityFrom: 'medium', independentFrom: 1, ...over,
  });

  it('dit un changement d’événement en mots, sans flèche entre deux niveaux verts', () => {
    expect(digestChangeText(item(['created']), 'fr')).toBe('Nouveau : Explosion');
    expect(digestChangeText(item(['escalated']), 'fr')).toBe('Aggravé (jaune → orange) : Explosion');
    expect(digestChangeText(item(['escalated'], { severityFrom: 'info', event: ev({ severity: 'low' }) }), 'fr')).toBe('Aggravé : Explosion');
    expect(digestChangeText(item(['corroborated']), 'en')).toBe('Corroborated (1 → 3 independent sources): Explosion');
    expect(severityWord('bogus', 'fr')).toBeNull();
  });

  it('« Rien à traiter » accorde le nombre d’éléments suivis', () => {
    expect(nothingToHandleText(1, 'fr')).toBe('Rien à traiter. 1 élément suivi est au vert.');
    expect(nothingToHandleText(14, 'fr')).toBe('Rien à traiter. 14 éléments suivis sont au vert.');
    expect(nothingToHandleText(0, 'en')).toBe('Nothing to handle. 0 tracked items are green.');
  });
});
```

Créer `src/components/fiche/france.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { buildFranceFiche, type FranceFicheInput, type FranceFicheSnapshot } from './france.ts';
import { renderFiche } from './parts.ts';
import { buildWorkQueue } from '../../services/work-queue.ts';
import type {
  ChangeDigestItem,
  DetectedSituation,
  FranceCountrySignals,
  FranceScoreBreakdown,
  IntelEventsState,
  NewsEvent,
  StructuredBrief,
} from '../../types/index.ts';

const NOW = Date.parse('2026-09-24T08:00:00Z');
const H = 3600_000;

function breakdown(score = 43): FranceScoreBreakdown {
  return {
    score,
    baseline: 95,
    pillars: [
      { key: 'continuity', value: 61, deduction: 18.9, components: [{ label: 'Carburants & pétrole', value: 100 }] },
      { key: 'security', value: 57, deduction: 14.7, components: [] },
      { key: 'signal', value: 28, deduction: 3.4, components: [] },
      { key: 'defense', value: 65, deduction: 8.8, components: [] },
    ],
    shockValue: 55,
    shockExtra: 1.3,
    situationCap: 55,
  };
}

function signals(): FranceCountrySignals {
  return {
    criticalNews: 0, highNews: 0, topNewsCount: 0, meteoAlerts: 0, floodAlerts: 0, fireDetections: 0,
    railDisruptions: 0, railSevere: 0, roadIncidents: 0, powerOutages: 0, telecomOutages: 0,
    cyberAlerts: 0, cyberCritical: 0, militaryFlights: 0, maritimeTrafficFrance: 0,
    defenseAlerts: 0, defenseHigh: 0, jammingSignals: 0, marketStress: 0,
  };
}

function situation(over: Partial<DetectedSituation> = {}): DetectedSituation {
  return {
    id: 'energy-stress', type: 'ENERGY_STRESS', severity: 'high', confidence: 0.8, title: 'Tension énergétique nationale',
    summary: 'Signal Écowatt orange confirmé.', affectedZones: ['Bretagne'], drivers: [], recommendedActions: [],
    sourceRefs: ['Ecowatt RTE'], updatedAt: new Date(NOW), ...over,
  };
}

function event(over: Partial<NewsEvent> = {}): NewsEvent {
  return {
    id: 42, evidenceId: 'E42', title: 'Explosion dans une usine chimique', category: 'security', severity: 'critical',
    status: 'active', firstSeen: '2026-09-24T07:30:00Z', lastSeen: '2026-09-24T07:50:00Z', articleCount: 3,
    sourceCount: 3, independentCount: 3, sourceNames: ['France Info'], lat: 49.4, lon: 1.1, ...over,
  };
}

function eventsState(over: Partial<IntelEventsState> = {}): IntelEventsState {
  return { events: [event()], digest: [], totals: {}, anchor: { since: NOW - 3 * H, kind: 'last-visit' }, fetchedAt: NOW, unavailable: false, ...over };
}

const BRIEF: StructuredBrief = {
  bluf: 'France en vigilance rouge, en dégradation sur 24 h.',
  judgments: [{
    priority: 1, text: 'L’approvisionnement restera tendu 48 h.', confidence: 'high',
    sources: ['SDES'], evidence: ['E42', 'S1'], unsupported: false,
  }],
  watch: [{ text: 'Signal Écowatt de demain', horizon: '6h' }],
  origin: 'llm',
};

function snapshot(over: Partial<FranceFicheSnapshot> = {}): FranceFicheSnapshot {
  return {
    score: 43, scoreBreakdown: breakdown(43), situations: [situation()], signals: signals(), meteo: [], energy: null,
    timeline: { days: [], lanes: [] }, ...over,
  };
}

function input(over: Partial<FranceFicheInput> = {}): FranceFicheInput {
  const snap = over.snapshot ?? snapshot();
  const events = over.events === undefined ? eventsState() : over.events;
  const queue = buildWorkQueue({
    situations: snap.situations, alerts: [], events, ecowatt: null, meteo: [], floods: [], markets: [],
    baseline: {}, firstSeen: new Map(), lang: 'fr',
  });
  return {
    snapshot: snap, queue, drivers: ['energy'], brief: { brief: BRIEF, freshness: 'fresh' }, briefSituationIds: ['energy-stress'],
    events, resolved: [], changeTimes: new Map(), score: { delta24h: -4, pillarDeltas: null, series: [81, 70, 43] },
    freshness: '33 sources sur 35 à jour', whyOpen: false, lang: 'fr', now: NOW, ...over,
  };
}

const visibleOf = (html: string): string => html.slice(0, html.indexOf('<details'));

describe('buildFranceFiche (spec §6.3, §14)', () => {
  it('essentiel = BLUF ; jugements en mots ; preuves cliquables ; indice chiffré seulement dans le volet', () => {
    const html = renderFiche(buildFranceFiche(input()), 'fr');
    const visible = visibleOf(html);
    expect(visible).toContain('France en vigilance rouge, en dégradation sur 24 h.');
    expect(visible).toContain('<span class="fm-vig fm-vig--rouge">Rouge</span>');
    expect(visible).toContain('tirée par l’énergie');
    expect(visible).toContain('confiance élevée');
    expect(visible).toContain('data-select="event:42"');
    expect(visible).toContain('data-select="situation:energy-stress"');
    expect(visible).toContain('6 h');
    expect(visible).not.toContain('/100');
    expect(visible).not.toContain('Indice de stabilité');
    expect(html).toContain('Indice de stabilité 43/100');
    for (const part of ['frintel-pillars', 'frintel-dom-grid', 'frintel-timeline', 'fiche-infra-slot', 'Événements consolidés ouverts (1)']) {
      expect(html).toContain(part);
    }
  });

  it('brief en attente : l’essentiel l’annonce, jamais « indisponible »', () => {
    const html = renderFiche(buildFranceFiche(input({ brief: null })), 'fr');
    expect(html).toContain('Synthèse nationale en cours de préparation…');
    expect(visibleOf(html)).not.toContain('indisponible');
  });

  it('S<n> désigne la situation figée au moment du brief, pas l’instantané courant', () => {
    const html = renderFiche(buildFranceFiche(input({ briefSituationIds: ['cyber-pressure'] })), 'fr');
    expect(html).toContain('data-select="situation:cyber-pressure">S1');
    expect(html).not.toContain('data-select="situation:energy-stress">S1');
  });

  it('ce qui a changé : badges, fil serveur, situations résolues dans les 24 h (§14)', () => {
    const digest: ChangeDigestItem[] = [{ event: event(), kinds: ['created'], latestAt: '2026-09-24T07:40:00Z', severityFrom: null, independentFrom: null }];
    const model = buildFranceFiche(input({
      events: eventsState({ digest }),
      resolved: [
        { id: 'flood-crisis', type: 'FLOOD_CRISIS', severity: 'high', title: 'Crise hydrologique active', affectedZones: [], since: NOW - 2 * H },
        { id: 'energy-stress', type: 'ENERGY_STRESS', severity: 'high', title: 'Tension énergétique nationale', affectedZones: [], since: NOW - H },
      ],
    }));
    expect(model.changesMeta).toContain('Depuis votre visite de');
    const rows = model.changes.map((c) => [c.text, c.select]);
    expect(rows).toContainEqual(['Nouveau : Explosion dans une usine chimique', 'event:42']);
    expect(rows).toContainEqual(['Nouveau : Tension énergétique nationale', 'situation:energy-stress']);
    expect(rows).toContainEqual(['Résolue : Crise hydrologique active', null]);
    expect(rows.filter(([text]) => text === 'Résolue : Tension énergétique nationale')).toHaveLength(0);
  });

  it('première visite, historique indisponible et chargement sont dits en clair', () => {
    expect(buildFranceFiche(input({ events: eventsState({ anchor: { since: NOW - 24 * H, kind: 'default' } }) })).changesMeta)
      .toBe('Première visite : dernières 24 h');
    expect(buildFranceFiche(input({ events: eventsState({ unavailable: true, events: [] }) })).changesMeta).toContain('Historique serveur indisponible');
    expect(buildFranceFiche(input({ events: null })).changesMeta).toBe('Chargement de l’historique…');
  });

  it('actions : voir sur la carte et note de situation ; bascule EN', () => {
    const model = buildFranceFiche(input({ lang: 'en' }));
    expect(model.actions.map((a) => a.id)).toEqual(['show-france', 'report']);
    expect(model.kind).toBe('Country');
    expect(model.driver).toBe('driven by energy');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/fiche/`
Expected: FAIL, `Cannot find module './parts.ts'` et `'./france.ts'`.

- [ ] **Step 3: Écrire les parties communes**

Créer `src/components/fiche/parts.ts` :

```ts
// src/components/fiche/parts.ts — fiche unique de la colonne de droite (refonte UI, spec §6) : un
// modèle commun à tous les types et son rendu HTML, parties toujours dans le même ordre, parties
// vides omises. Pur (aucun DOM) : tout texte tiers est échappé ici et seuls les liens http(s) sont
// cliquables. Les parties propres à un type (« Jugements », « Facteurs »…) et le volet « Pourquoi
// ce niveau ? » arrivent déjà rendus, et échappés, par le rendu de leur type.

import type { ChangeDigestItem, ThreatLevel } from '../../types/index.ts';
import { eventLevel, levelLabel, type VigilanceLevel } from '../../services/vigilance.ts';
import { escapeHtml, safeHref } from '../france-intel-events.ts';
import { renderVigilancePill } from '../shared/vigilancePill.ts';

export type Lang = 'fr' | 'en';

export function t(lang: Lang, fr: string, en: string): string {
  return lang === 'fr' ? fr : en;
}

/** « Nouveau : titre » / « New: title ». */
export function labelled(lang: Lang, fr: string, en: string, text: string): string {
  return lang === 'fr' ? `${fr} : ${text}` : `${en}: ${text}`;
}

export function parseTime(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** Heure au format 24 h (« 14:02 »). */
export function formatClock(ms: number, lang: Lang): string {
  return new Date(ms).toLocaleTimeString(lang === 'fr' ? 'fr-FR' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function formatNumber(value: number, lang: Lang): string {
  return value.toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GB', { maximumFractionDigits: 2 });
}

const SEVERITIES: readonly ThreatLevel[] = ['critical', 'high', 'medium', 'low', 'info'];

/** Gravité brute d'un événement (critical, high…) → mot L1 en minuscules ; null si inconnue. */
export function severityWord(value: string | null, lang: Lang): string | null {
  const known = SEVERITIES.find((s) => s === value);
  return known ? levelLabel(eventLevel(known), lang).toLowerCase() : null;
}

/** Texte brut d'un changement d'événement depuis la visite (le rendu de la fiche l'échappe). */
export function digestChangeText(item: ChangeDigestItem, lang: Lang): string {
  const title = item.event.title;
  switch (item.kinds[0]) {
    case 'created':
      return labelled(lang, 'Nouveau', 'New', title);
    case 'escalated': {
      const from = severityWord(item.severityFrom, lang);
      const to = severityWord(item.event.severity, lang);
      // info et low partagent le vert L1 : pas de « vert → vert » trompeur.
      const arrow = from !== null && to !== null && from !== to ? ` (${from} → ${to})` : '';
      return labelled(lang, `Aggravé${arrow}`, `Escalated${arrow}`, title);
    }
    case 'corroborated': {
      const span = `${item.independentFrom ?? '?'} → ${item.event.independentCount}`;
      return labelled(lang, `Corroboré (${span} sources indép.)`, `Corroborated (${span} independent sources)`, title);
    }
    case 'reopened':
      return labelled(lang, 'Rouvert', 'Reopened', title);
    case 'deescalated':
      return labelled(lang, 'Atténué', 'De-escalated', title);
    case 'closed':
      return labelled(lang, 'Clos', 'Closed', title);
    case 'cooling':
      return labelled(lang, 'Refroidit', 'Cooling', title);
    default:
      return title;
  }
}

/** « Rien à traiter. <n> éléments suivis sont au vert. » (spec §7.4). */
export function nothingToHandleText(greenTracked: number, lang: Lang): string {
  const n = greenTracked;
  if (lang === 'fr') {
    const s = n > 1 ? 's' : '';
    return `Rien à traiter. ${n} élément${s} suivi${s} ${n > 1 ? 'sont' : 'est'} au vert.`;
  }
  return `Nothing to handle. ${n} tracked item${n === 1 ? '' : 's'} ${n === 1 ? 'is' : 'are'} green.`;
}

export interface FicheChange {
  /** Heure du changement (ms), null si inconnue. */
  at: number | null;
  text: string;
  /** Clé de sélection ouverte au clic (« event:42 »), null si la ligne n'ouvre rien. */
  select: string | null;
}

export interface FicheFigure {
  label: string;
  value: string;
}

export interface FicheWatch {
  text: string;
  horizon: string | null;
}

export interface FicheSource {
  label: string;
  /** Lien externe, rendu cliquable seulement s'il est http(s). */
  href: string | null;
  /** Clé de sélection interne (preuve E…/S…). */
  select: string | null;
}

export interface FicheAction {
  id: string;
  label: string;
}

export interface FicheSection {
  title: string;
  /** HTML déjà échappé par le rendu du type. */
  html: string;
}

export interface FicheModel {
  /** Clé de la fiche (« france », « theme:energy », « event:42 ») : état du volet, focus. */
  key: string;
  kind: string;
  name: string;
  level: VigilanceLevel | null;
  /** Ligne « tiré par … » de l'en-tête. */
  driver: string;
  freshness: string;
  /** Une à trois phrases. */
  essentiel: string[];
  /** Méta de « Ce qui a changé » (ancre de visite, chargement) ; vide et sans ligne → partie omise. */
  changesMeta: string;
  changes: FicheChange[];
  /** Parties propres au type, entre « Ce qui a changé » et « Chiffres clés » (« Jugements », « Facteurs »…). */
  sections: FicheSection[];
  figures: FicheFigure[];
  watch: FicheWatch[];
  sourcesTitle: string;
  sources: FicheSource[];
  /** HTML déjà échappé du volet « Pourquoi ce niveau ? » ; vide → volet omis. */
  why: string;
  whyOpen: boolean;
  actions: FicheAction[];
}

function part(cls: string, title: string, body: string): string {
  return `<section class="fiche-part ${cls}"><h3 class="fiche-part-title">${title}</h3>${body}</section>`;
}

function renderChanges(model: FicheModel, lang: Lang): string {
  if (model.changes.length === 0 && model.changesMeta === '') return '';
  const rows = model.changes.map((c) => {
    const time = `<span class="fiche-time">${c.at === null ? '—' : formatClock(c.at, lang)}</span>`;
    const text = escapeHtml(c.text);
    const body = c.select
      ? `<button type="button" class="fiche-link" data-select="${escapeHtml(c.select)}">${text}</button>`
      : `<span>${text}</span>`;
    return `<li class="fiche-change">${time} ${body}</li>`;
  }).join('');
  const meta = model.changesMeta ? `<div class="fiche-meta">${escapeHtml(model.changesMeta)}</div>` : '';
  const empty = rows ? '' : `<p class="fiche-empty">${t(lang, 'Aucun changement notable.', 'No notable change.')}</p>`;
  return part('fiche-changes', t(lang, 'Ce qui a changé', 'What changed'), `${meta}${rows ? `<ul class="fiche-list">${rows}</ul>` : empty}`);
}

function renderSources(model: FicheModel, lang: Lang): string {
  if (model.sources.length === 0) return '';
  const chips = model.sources.map((s) => {
    const label = escapeHtml(s.label);
    const href = s.href ? safeHref(s.href) : null;
    if (href) return `<a class="fiche-source" href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    if (s.select) return `<button type="button" class="fiche-source fiche-link" data-select="${escapeHtml(s.select)}">${label}</button>`;
    return `<span class="fiche-source">${label}</span>`;
  }).join('');
  const title = model.sourcesTitle || t(lang, 'Preuves et sources', 'Evidence and sources');
  return part('fiche-sources', escapeHtml(title), `<div class="fiche-chips">${chips}</div>`);
}

/** Fiche complète : en-tête, essentiel, changements, parties du type, chiffres, à surveiller, sources, volet, actions. */
export function renderFiche(model: FicheModel, lang: Lang): string {
  const pill = model.level ? renderVigilancePill(model.level, lang) : '';
  const driver = model.driver ? ` <span class="fiche-driver">${escapeHtml(model.driver)}</span>` : '';
  const head = `<header class="fiche-head">`
    + `<div class="fiche-kind">${escapeHtml(model.kind)}</div>`
    + `<h2 class="fiche-name" tabindex="-1">${escapeHtml(model.name)}</h2>`
    + (pill || driver ? `<div class="fiche-level">${pill}${driver}</div>` : '')
    + (model.freshness ? `<div class="fiche-fresh">${escapeHtml(model.freshness)}</div>` : '')
    + `</header>`;
  const essentiel = model.essentiel.length > 0
    ? part('fiche-essentiel', t(lang, 'L’essentiel', 'Key points'), model.essentiel.map((p) => `<p>${escapeHtml(p)}</p>`).join(''))
    : '';
  const sections = model.sections.map((s) => part('fiche-extra', escapeHtml(s.title), s.html)).join('');
  const figures = model.figures.length > 0
    ? part('fiche-figures', t(lang, 'Chiffres clés', 'Key figures'), `<dl class="fiche-figures-grid">${model.figures.slice(0, 3)
      .map((f) => `<div><dt>${escapeHtml(f.label)}</dt><dd>${escapeHtml(f.value)}</dd></div>`).join('')}</dl>`)
    : '';
  const watch = model.watch.length > 0
    ? part('fiche-watch', t(lang, 'À surveiller', 'Watch'), `<ul class="fiche-list">${model.watch
      .map((w) => `<li>${w.horizon ? `<span class="fiche-horizon">${escapeHtml(w.horizon)}</span> ` : ''}${escapeHtml(w.text)}</li>`).join('')}</ul>`)
    : '';
  const why = model.why
    ? `<details class="fiche-why" data-why="${escapeHtml(model.key)}"${model.whyOpen ? ' open' : ''}>`
      + `<summary>${t(lang, 'Pourquoi ce niveau ?', 'Why this level?')}</summary>`
      + `<div class="fiche-why-body">${model.why}</div></details>`
    : '';
  const actions = model.actions.length > 0
    ? `<div class="fiche-actions">${model.actions
      .map((a) => `<button type="button" class="fiche-action" data-action="${escapeHtml(a.id)}">${escapeHtml(a.label)}</button>`).join('')}</div>`
    : '';
  return `<article class="fiche" data-fiche="${escapeHtml(model.key)}">${head}${essentiel}${renderChanges(model, lang)}${sections}${figures}${watch}${renderSources(model, lang)}${why}${actions}</article>`;
}
```

- [ ] **Step 4: Écrire la fiche France**

Créer `src/components/fiche/france.ts` :

```ts
// src/components/fiche/france.ts — fiche « France », affichée quand rien n'est sélectionné en
// « Vue générale » (spec §6.3) : BLUF du brief en guise d'essentiel, jugements avec leurs preuves
// cliquables et leur confiance en mots, « À surveiller » du brief, changements depuis la visite,
// et dans « Pourquoi ce niveau ? » tout le contenu chiffré de l'ancien tiroir (spec §14).

import type { FranceCountrySnapshot, IntelEventsState, StructuredBrief } from '../../types/index.ts';
import type { StabilityPillarValues } from '../../utils/stability-history.ts';
import type { BriefSourceSituation } from '../../services/situation-brief.ts';
import { briefConfidenceLabel, eventLevel, levelLabel, scoreLevel } from '../../services/vigilance.ts';
import { drivenByText, type ThemeId } from '../../services/themes.ts';
import type { WorkQueue } from '../../services/work-queue.ts';
import { escapeHtml, formatAge, resolveEvidenceRef } from '../france-intel-events.ts';
import { renderWhyBody } from '../france-intel-score.ts';
import { renderDomainsBlock, renderEnergyBlock, renderTimelineBlock } from '../france-intel-blocks.ts';
import {
  digestChangeText,
  formatClock,
  labelled,
  parseTime,
  t,
  type FicheChange,
  type FicheFigure,
  type FicheModel,
  type FicheSource,
  type Lang,
} from './parts.ts';

/** Champs de l'instantané national lus par la fiche (App.ts passe l'instantané complet). */
export type FranceFicheSnapshot = Pick<
  FranceCountrySnapshot,
  'score' | 'scoreBreakdown' | 'situations' | 'signals' | 'meteo' | 'energy' | 'timeline'
>;

export interface FranceFicheInput {
  snapshot: FranceFicheSnapshot;
  queue: WorkQueue;
  /** Thèmes qui tirent le niveau (drivingThemes). */
  drivers: readonly ThemeId[];
  brief: { brief: StructuredBrief; freshness: 'fresh' | 'cached' } | null;
  /** Situations numérotées S1…S5 au moment du brief (briefSituationIds), jamais l'instantané courant. */
  briefSituationIds: readonly string[];
  /** null tant que les événements n'ont pas été chargés une première fois. */
  events: IntelEventsState | null;
  /** Situations vues dans les 24 h (historique) : celles qui ne sont plus actives sont « résolues ». */
  resolved: readonly BriefSourceSituation[];
  /** Heure d'apparition connue, par clé de liste. */
  changeTimes: ReadonlyMap<string, number>;
  score: { delta24h: number | null; pillarDeltas: StabilityPillarValues | null; series: number[] };
  freshness: string;
  whyOpen: boolean;
  lang: Lang;
  now: number;
}

const MAX_CHANGES = 12;

function evidenceKey(ref: string, input: FranceFicheInput): string | null {
  const target = resolveEvidenceRef(ref, input.briefSituationIds);
  if (!target) return null;
  return target.kind === 'event' ? `event:${target.id}` : `situation:${target.id}`;
}

function evidenceLabel(ref: string, input: FranceFicheInput): string {
  const target = resolveEvidenceRef(ref, input.briefSituationIds);
  if (target?.kind === 'event') {
    const event = input.events?.events.find((e) => e.id === target.id);
    return event ? `${ref} · ${event.title}` : ref;
  }
  if (target?.kind === 'situation') {
    const situation = input.snapshot.situations.find((s) => s.id === target.id);
    return situation ? `${ref} · ${situation.title}` : ref;
  }
  return ref;
}

function changesMeta(input: FranceFicheInput): string {
  const { lang, events } = input;
  if (events === null) return t(lang, 'Chargement de l’historique…', 'Loading history…');
  if (events.unavailable && events.events.length === 0) {
    return t(lang,
      'Historique serveur indisponible : les événements reviendront au prochain rafraîchissement.',
      'Server history unavailable: events will return on the next refresh.');
  }
  if (events.anchor.kind === 'default') return t(lang, 'Première visite : dernières 24 h', 'First visit: last 24 h');
  const clock = formatClock(events.anchor.since, lang);
  const ago = formatAge(new Date(events.anchor.since).toISOString(), input.now, lang);
  return t(lang, `Depuis votre visite de ${clock} (${ago})`, `Since your visit at ${clock} (${ago})`);
}

function franceChanges(input: FranceFicheInput): FicheChange[] {
  const { lang } = input;
  const changes: FicheChange[] = [];
  for (const item of input.queue.items) {
    // Les événements viennent du fil serveur ci-dessous, avec leur heure.
    if (item.badge === null || item.ref.kind === 'event') continue;
    const text = item.badge === 'nouveau'
      ? labelled(lang, 'Nouveau', 'New', item.title)
      : labelled(lang, 'Aggravé', 'Escalated', item.title);
    changes.push({ at: input.changeTimes.get(item.key) ?? null, text, select: item.key });
  }
  for (const d of input.events?.digest ?? []) {
    changes.push({ at: parseTime(d.latestAt), text: digestChangeText(d, lang), select: `event:${d.event.id}` });
  }
  // §14 : les convergences résolues dans les 24 h restent visibles ici.
  const active = new Set(input.snapshot.situations.map((s) => s.id));
  for (const r of input.resolved) {
    if (active.has(r.id)) continue;
    changes.push({ at: r.since, text: labelled(lang, 'Résolue', 'Resolved', r.title), select: null });
  }
  // Heure inconnue d'abord (changé depuis la visite, heure non mesurée), puis du plus récent au plus ancien.
  const rank = (at: number | null): number => at ?? Number.MAX_SAFE_INTEGER;
  return changes.sort((a, b) => rank(b.at) - rank(a.at)).slice(0, MAX_CHANGES);
}

function judgmentsHtml(brief: StructuredBrief, input: FranceFicheInput): string {
  const { lang } = input;
  const rows = brief.judgments.map((j) => {
    const refs = j.evidence.map((ref) => {
      const key = evidenceKey(ref, input);
      const label = escapeHtml(ref);
      return key
        ? `<button type="button" class="fiche-ref fiche-link" data-select="${escapeHtml(key)}">${label}</button>`
        : `<span class="fiche-ref">${label}</span>`;
    }).join(' ');
    const unsupported = j.unsupported ? `${t(lang, 'Non étayé', 'Unsupported')} · ` : '';
    return `<li class="fiche-judgment"><p>${escapeHtml(j.text)}</p>`
      + `<div class="fiche-judgment-foot">${refs}<span class="fiche-conf">${unsupported}${briefConfidenceLabel(j.confidence, lang)}</span></div></li>`;
  }).join('');
  return `<ul class="fiche-list">${rows}</ul>`;
}

function franceSources(brief: StructuredBrief, input: FranceFicheInput): FicheSource[] {
  const out: FicheSource[] = [];
  const seen = new Set<string>();
  for (const ref of brief.judgments.flatMap((j) => j.evidence)) {
    if (seen.has(ref)) continue;
    seen.add(ref);
    out.push({ label: evidenceLabel(ref, input), href: null, select: evidenceKey(ref, input) });
  }
  for (const name of brief.judgments.flatMap((j) => j.sources)) {
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ label: name, href: null, select: null });
  }
  return out;
}

/** §14 : la liste complète des événements consolidés ouverts (l'ancienne section du tiroir). */
function allEventsHtml(input: FranceFicheInput): string {
  const { lang } = input;
  const events = input.events?.events ?? [];
  if (events.length === 0) return '';
  const rows = events.map((e) => {
    const sources = e.independentCount >= 2
      ? t(lang, `${e.independentCount} sources indép.`, `${e.independentCount} independent sources`)
      : t(lang, 'source unique', 'single source');
    return `<li><button type="button" class="fiche-link" data-select="event:${e.id}">${escapeHtml(e.evidenceId)} · ${escapeHtml(e.title)}</button>`
      + ` <span class="fiche-meta">${levelLabel(eventLevel(e.severity), lang)} · ${sources}</span></li>`;
  }).join('');
  return `<h4 class="fiche-why-title">${t(lang, 'Événements consolidés ouverts', 'Open consolidated events')} (${events.length})</h4><ul class="fiche-list">${rows}</ul>`;
}

function briefOrigin(brief: FranceFicheInput['brief'], lang: Lang): string {
  if (!brief) return '';
  const text = brief.brief.origin === 'llm'
    ? `${t(lang, 'Brief : IA', 'Brief: AI')}, ${brief.freshness === 'fresh' ? t(lang, 'à jour', 'fresh') : t(lang, 'en cache', 'cached')}`
    : t(lang, 'Brief : synthèse automatique', 'Brief: automatic synthesis');
  return `<p class="fiche-meta">${text}</p>`;
}

export function buildFranceFiche(input: FranceFicheInput): FicheModel {
  const { snapshot, lang } = input;
  const brief = input.brief?.brief ?? null;
  const figures: FicheFigure[] = [
    { label: t(lang, 'Situations actives', 'Active situations'), value: String(snapshot.situations.length) },
    { label: t(lang, 'Éléments à traiter', 'Items to handle'), value: String(input.queue.items.length) },
  ];
  if (input.queue.eventsStatus === 'ok' && input.events) {
    figures.push({ label: t(lang, 'Événements ouverts', 'Open events'), value: String(input.events.events.length) });
  }
  const why = [
    renderWhyBody({
      breakdown: snapshot.scoreBreakdown,
      delta24h: input.score.delta24h,
      pillarDeltas: input.score.pillarDeltas,
      series: input.score.series,
      lang,
    }),
    // Le baromètre des infrastructures (et son infobulle) est un composant vivant : App.ts l'y rattache.
    '<div class="fiche-infra-slot"></div>',
    renderDomainsBlock(snapshot, lang),
    renderEnergyBlock(snapshot.energy, lang),
    renderTimelineBlock(snapshot.timeline, lang),
    allEventsHtml(input),
    briefOrigin(input.brief, lang),
  ].join('');
  return {
    key: 'france',
    kind: t(lang, 'Pays', 'Country'),
    name: 'France',
    level: scoreLevel(snapshot.score),
    driver: drivenByText(input.drivers, lang),
    freshness: input.freshness,
    essentiel: brief ? [brief.bluf] : [t(lang, 'Synthèse nationale en cours de préparation…', 'National summary being prepared…')],
    changesMeta: changesMeta(input),
    changes: franceChanges(input),
    sections: brief && brief.judgments.length > 0
      ? [{ title: t(lang, 'Jugements', 'Judgments'), html: judgmentsHtml(brief, input) }]
      : [],
    figures,
    watch: (brief?.watch ?? []).map((w) => ({ text: w.text, horizon: w.horizon.replace('h', ' h') })),
    sourcesTitle: t(lang, 'Preuves et sources', 'Evidence and sources'),
    sources: brief ? franceSources(brief, input) : [],
    why,
    whyOpen: input.whyOpen,
    actions: [
      { id: 'show-france', label: t(lang, 'Voir sur la carte', 'Show on map') },
      { id: 'report', label: t(lang, 'Note de situation', 'Situation report') },
    ],
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/components/fiche/ && npm run typecheck`
Expected: PASS (7 + 6 tests), typecheck sans erreur.

- [ ] **Step 6: Run the task gate**

Run: `npx vitest run && npm run lint && npm run build`
Expected: tout vert.

- [ ] **Step 7: Commit**

```bash
git add src/components/fiche/parts.ts src/components/fiche/parts.test.ts src/components/fiche/france.ts src/components/fiche/france.test.ts
git commit -m "feat: fiche unique — parties communes et fiche France (brief, jugements, changements, volet chiffré)"
```

---

### Task 8: Fiches thème, événement, situation, alerte, alerte officielle et marché

Arbitrage A1 : les fiches situation et alerte sont livrées dès l'étape 2, avec le contenu des anciens détails de `SituationMonitor` et `AlertMonitor` (résumé, facteurs, zones, actions, sources, lien source http(s), dossier grands feux ou aéronef, « Voir sur la carte »).

**Files:**
- Create: `src/components/fiche/items.ts`
- Test: `src/components/fiche/items.test.ts`

**Interfaces:**
- Consumes : tâches 2, 4, 6 et 7 (`WorkQueue`, `officialTheme`, `officialSourceName`, `officialTitle`, `OfficialAlertGroup`, `OfficialSignal`, `MarketLine`, `WorkBadge`, `splitScoreLines`, `splitScoreSentences`, `renderEnergyBlock`, parties communes) ; `EventDetailState`.
- Produces : `interface ThemeFicheInput { theme; queue; snapshot: Pick<FranceCountrySnapshot, 'signals' | 'energy'>; events; changeTimes; freshness; whyOpen; lang }` ; `buildThemeFiche(input)` ; `interface EventFicheInput { event; detail; whyOpen; lang; now }` ; `buildEventFiche(input)` ; `interface SituationFicheInput { situation; kind: 'situation' | 'alert'; badge; changeAt; hasDossier; whyOpen; lang }` ; `buildSituationFiche(input)` ; `buildOfficialFiche(group, { freshness; whyOpen; lang })` ; `buildMarketFiche(line, { whyOpen; lang })` ; actions émises : `show-theme`, `map`, `dossier`, `show-layer`.

- [ ] **Step 1: Write the failing test**

Créer `src/components/fiche/items.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import {
  buildEventFiche,
  buildMarketFiche,
  buildOfficialFiche,
  buildSituationFiche,
  buildThemeFiche,
  type ThemeFicheInput,
} from './items.ts';
import { renderFiche } from './parts.ts';
import { buildWorkQueue, officialAlertGroups, type WorkQueueInput } from '../../services/work-queue.ts';
import type {
  DetectedSituation,
  EcowattResponse,
  FranceCountrySignals,
  FranceIntelEnergySummary,
  NewsEvent,
  NewsEventDetail,
} from '../../types/index.ts';

const NOW = Date.parse('2026-09-24T08:00:00Z');
const visibleOf = (html: string): string => html.slice(0, html.indexOf('<details'));

function signals(over: Partial<FranceCountrySignals> = {}): FranceCountrySignals {
  return {
    criticalNews: 0, highNews: 0, topNewsCount: 0, meteoAlerts: 0, floodAlerts: 0, fireDetections: 0,
    railDisruptions: 0, railSevere: 0, roadIncidents: 0, powerOutages: 0, telecomOutages: 0,
    cyberAlerts: 0, cyberCritical: 0, militaryFlights: 0, maritimeTrafficFrance: 0,
    defenseAlerts: 0, defenseHigh: 0, jammingSignals: 0, marketStress: 0, ...over,
  };
}

function situation(over: Partial<DetectedSituation> = {}): DetectedSituation {
  return {
    id: 'energy-stress', type: 'ENERGY_STRESS', severity: 'high', confidence: 0.8, title: 'Tension énergétique nationale',
    summary: 'Signal Écowatt orange confirmé.', affectedZones: ['Bretagne'], drivers: [], recommendedActions: [],
    sourceRefs: ['Ecowatt RTE'], updatedAt: new Date(NOW), ...over,
  };
}

function event(over: Partial<NewsEvent> = {}): NewsEvent {
  return {
    id: 42, evidenceId: 'E42', title: 'Explosion dans une usine chimique', category: 'security', severity: 'critical',
    status: 'active', firstSeen: '2026-09-24T07:30:00Z', lastSeen: '2026-09-24T07:50:00Z', articleCount: 3,
    sourceCount: 3, independentCount: 3, sourceNames: ['France Info'], lat: 49.4, lon: 1.1, ...over,
  };
}

function ecowatt(signalsByRegion: EcowattResponse['signals']): EcowattResponse {
  const mix = { timestamp: new Date(0), nuclear: 0, wind: 0, solar: 0, hydro: 0, gas: 0, other: 0, total: 0 };
  return { signals: signalsByRegion, mixes: {}, national: mix, interconnections: [] };
}

function energy(): FranceIntelEnergySummary {
  return {
    ecowattSignal: 'green', totalMw: 53600, shares: { nuclear: 70, gas: 5, hydro: 10, wind: 8, solar: 4, other: 3 },
    nuclearStress: null, windGw: 4.2, windLoadFactor: 18, oilStocksDays: 46, oilVigilanceStatus: 'normal',
    fuelTensionLevel: 'LOW', fuelTensionAnomalyShare: 1, fuelPriceHistory: null,
  };
}

function queue(over: Partial<WorkQueueInput> = {}): ReturnType<typeof buildWorkQueue> {
  return buildWorkQueue({
    situations: [], alerts: [], events: null, ecowatt: null, meteo: [], floods: [], markets: [],
    baseline: null, firstSeen: new Map(), lang: 'fr', ...over,
  });
}

function themeInput(over: Partial<ThemeFicheInput> = {}): ThemeFicheInput {
  return {
    theme: 'energy', queue: queue(), snapshot: { signals: signals(), energy: null }, events: null,
    changeTimes: new Map(), freshness: '33 sources sur 35 à jour', whyOpen: false, lang: 'fr', ...over,
  };
}

describe('fiche thème', () => {
  it('rien à traiter : fiche verte et éléments suivis au vert (§7.4)', () => {
    const model = buildThemeFiche(themeInput({ queue: queue({ ecowatt: ecowatt({ '53': 'green' }) }) }));
    expect(model.kind).toBe('Thème');
    expect(model.name).toBe('Énergie');
    expect(model.level).toBe('vert');
    expect(model.essentiel).toEqual(['Rien à traiter. 1 élément suivi est au vert.']);
  });

  it('niveau et signaux officiels du thème, chiffres clés, éléments dans le volet', () => {
    const model = buildThemeFiche(themeInput({
      theme: 'environment',
      queue: queue({
        meteo: [{ department: 'Var', departmentCode: '83', level: 'yellow', risks: [] }],
        situations: [situation({ id: 'flood-crisis', type: 'FLOOD_CRISIS', severity: 'critical', title: 'Crise hydrologique active' })],
      }),
      snapshot: { signals: signals({ meteoAlerts: 3, floodAlerts: 2, fireDetections: 14 }), energy: null },
    }));
    expect(model.level).toBe('rouge');
    expect(model.driver).toBe('Crise hydrologique active');
    expect(model.figures.map((f) => f.value)).toEqual(['3', '2', '14']);
    expect(model.essentiel).toContain('Vigilance météo jaune.');
    const html = renderFiche(model, 'fr');
    expect(html).toContain('Météo-France');
    expect(visibleOf(html)).toContain('1 élément à traiter, dont 1 rouge.');
  });

  it('énergie : production, stocks et éolien en chiffres clés, bloc énergie dans le volet', () => {
    const model = buildThemeFiche(themeInput({ snapshot: { signals: signals(), energy: energy() } }));
    expect(model.figures.map((f) => f.label)).toEqual(['Production nationale', 'Stocks de carburant', 'Production éolienne']);
    expect(model.figures[1].value).toBe('46 j');
    expect(model.why).toContain('frintel-energy-stack');
  });
});

describe('fiche événement', () => {
  const detail = (over: Partial<NewsEventDetail> = {}): NewsEventDetail => ({
    event: event(),
    articles: [
      { id: 1, title: '<b>Explosion</b> près de Rouen', link: 'javascript:alert(1)', feedName: 'France Info', publishedAt: '2026-09-24T07:30:00Z' },
      { id: 2, title: 'Le PPI déclenché', link: 'https://example.org/ppi', feedName: 'Paris-Normandie', publishedAt: null },
    ],
    log: [
      { at: '2026-09-24T07:40:00Z', kind: 'escalated', from: 'medium', to: 'high' },
      { at: '2026-09-24T07:30:00Z', kind: 'created', from: null, to: 'medium' },
    ],
    ...over,
  });

  it('articles échappés, seuls les liens http(s) cliquables, journal en mots L1 (revue)', () => {
    const html = renderFiche(buildEventFiche({ event: event(), detail: detail(), whyOpen: false, lang: 'fr', now: NOW }), 'fr');
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('href="https://example.org/ppi"');
    expect(html).toContain('aggravé jaune → orange');
    expect(html).toContain('créé · jaune');
  });

  it('journal en chargement ou indisponible : dit en clair', () => {
    expect(buildEventFiche({ event: event(), detail: 'loading', whyOpen: false, lang: 'fr', now: NOW }).changesMeta).toBe('Chargement du journal…');
    expect(buildEventFiche({ event: event(), detail: 'error', whyOpen: false, lang: 'fr', now: NOW }).changesMeta).toBe('Journal indisponible pour le moment.');
  });

  it('aucun code de catégorie du moteur ; « Voir sur la carte » seulement pour un événement localisé', () => {
    const model = buildEventFiche({ event: event({ category: 'weather' }), detail: undefined, whyOpen: false, lang: 'fr', now: NOW });
    expect(model.kind).toBe('Événement · Environnement et transports');
    expect(renderFiche(model, 'fr')).not.toContain('weather');
    expect(model.actions.map((a) => a.id)).toEqual(['map']);
    expect(buildEventFiche({ event: event({ lat: null, lon: null }), detail: undefined, whyOpen: false, lang: 'fr', now: NOW }).actions).toEqual([]);
  });
});

describe('fiches situation et alerte (arbitrage A1)', () => {
  const cyber = situation({
    id: 'cyber-pressure', type: 'CYBER_PRESSURE', severity: 'high', confidence: 0.82, title: 'Pression cyber multi-source',
    summary: 'Baromètre cyber consolidé à 63/100, dominé par ransomware.',
    drivers: ['Score cyber consolidé : 63/100 (tendance stable)', 'Ransomware : 25/25', '2 alerte(s) critique(s) CERT-FR'],
    recommendedActions: [{ label: 'Consulter les bulletins CERT-FR', ownerHint: 'Analyste cyber', actionType: 'investigate', automatable: true }],
    sourceRefs: ['CERT-FR'],
  });

  it('les sous-scores du moteur ne sont visibles que dans « Pourquoi ce niveau ? » (A7)', () => {
    const html = renderFiche(buildSituationFiche({
      situation: cyber, kind: 'situation', badge: null, changeAt: null, hasDossier: false, whyOpen: false, lang: 'fr',
    }), 'fr');
    const visible = visibleOf(html);
    expect(visible).not.toMatch(/\d+\s*\/\s*\d+/);
    expect(visible).toContain('2 alerte(s) critique(s) CERT-FR');
    expect(visible).toContain('Pression cyber multi-source : vigilance orange.');
    expect(visible).toContain('Consulter les bulletins CERT-FR');
    expect(visible).toContain('IA possible');
    expect(html).toContain('Score cyber consolidé : 63/100 (tendance stable)');
    expect(html).toContain('Ransomware : 25/25');
    expect(html).toContain('Confiance élevée (82 %)');
  });

  it('alerte : lien source http(s) seulement, dossier et carte quand ils existent', () => {
    const alert = situation({
      id: 'news-alert-1', type: 'NEWS_ALERT', linkUrl: 'https://example.org/a', linkLabel: 'Ouvrir l’article', lat: 49.4, lon: 1.1,
    });
    const model = buildSituationFiche({ situation: alert, kind: 'alert', badge: 'nouveau', changeAt: null, hasDossier: false, whyOpen: false, lang: 'fr' });
    expect(model.kind).toBe('Alerte');
    expect(model.sources[0]).toEqual({ label: 'Ouvrir l’article', href: 'https://example.org/a', select: null });
    expect(model.changes[0].text).toBe('Nouveau depuis votre visite');
    expect(model.actions.map((a) => a.id)).toEqual(['map']);
    const unsafe = buildSituationFiche({
      situation: { ...alert, linkUrl: 'javascript:alert(1)' }, kind: 'alert', badge: null, changeAt: null, hasDossier: false, whyOpen: false, lang: 'fr',
    });
    expect(unsafe.sources.some((s) => s.label === 'Ouvrir l’article')).toBe(false);
    const fire = buildSituationFiche({
      situation: situation({ id: 'wildfire-7', type: 'WILDFIRE_ESCALATION' }), kind: 'situation', badge: null, changeAt: null, hasDossier: true, whyOpen: false, lang: 'fr',
    });
    expect(fire.actions).toContainEqual({ id: 'dossier', label: 'Ouvrir le dossier d’incident' });
  });
});

describe('fiches alerte officielle et marché', () => {
  it('alerte officielle : détail par lieu échappé, violet compté rouge et dit dans le volet', () => {
    const [group] = officialAlertGroups(null, [{ department: '<Var>', departmentCode: '83', level: 'violet', risks: ['heat'] }], []);
    const html = renderFiche(buildOfficialFiche(group, { freshness: '', whyOpen: false, lang: 'fr' }), 'fr');
    expect(html).toContain('&lt;Var&gt; : Canicule');
    expect(html).toContain('<span class="fm-vig fm-vig--rouge">Rouge</span>');
    expect(html).toContain('Le violet de Météo-France compte comme rouge.');
    expect(html).toContain('data-action="show-layer"');
  });

  it('marché : jaune, seuil dit en clair', () => {
    const model = buildMarketFiche({ symbol: 'CAC40', name: 'CAC 40', price: 7212.5, changePercent: -3.42, kind: 'index' }, { whyOpen: false, lang: 'fr' });
    expect(model.level).toBe('jaune');
    expect(model.essentiel[0]).toBe('CAC 40 varie de −3,42 % sur la journée, au-delà du seuil de ±3 %.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/fiche/items.test.ts`
Expected: FAIL, `Cannot find module './items.ts'`.

- [ ] **Step 3: Write the implementation**

Créer `src/components/fiche/items.ts` :

```ts
// src/components/fiche/items.ts — fiches thème, événement, situation, alerte, alerte officielle et
// marché (spec §6.3). Le §11 ne prévoyait à l'étape 2 que les fiches France, thème et événement ;
// les fiches situation et alerte sont livrées ici parce que la v2 retire SituationMonitor et
// AlertMonitor et que le §14 exige que leur détail reste accessible (arbitrage A1).

import type {
  DetectedSituation,
  FranceCountrySnapshot,
  IntelEventsState,
  NewsEvent,
  NewsEventChangeKind,
  NewsEventDetail,
  SituationAction,
} from '../../types/index.ts';
import {
  MARKET_ALERT_THRESHOLD,
  confidenceLabel,
  eventLevel,
  formatSignedPct,
  levelLabel,
  levelPhrase,
  levelVigilanceWord,
  situationLevel,
} from '../../services/vigilance.ts';
import { categoryTheme, themeLabel, type SpecificThemeId } from '../../services/themes.ts';
import {
  officialSourceName,
  officialTheme,
  officialTitle,
  type MarketLine,
  type OfficialAlertGroup,
  type OfficialSignal,
  type WorkBadge,
  type WorkQueue,
} from '../../services/work-queue.ts';
import { splitScoreLines, splitScoreSentences } from '../../services/situation-text.ts';
import { escapeHtml, formatAge, safeHref, type EventDetailState } from '../france-intel-events.ts';
import { renderEnergyBlock } from '../france-intel-blocks.ts';
import { renderVigilancePill } from '../shared/vigilancePill.ts';
import {
  digestChangeText,
  formatClock,
  formatNumber,
  labelled,
  nothingToHandleText,
  parseTime,
  severityWord,
  t,
  type FicheAction,
  type FicheChange,
  type FicheFigure,
  type FicheModel,
  type FicheSection,
  type FicheSource,
  type Lang,
} from './parts.ts';

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function plural(n: number): string {
  return n > 1 ? 's' : '';
}

/** Heure inconnue d'abord, puis du plus récent au plus ancien. */
function byTimeDesc(a: FicheChange, b: FicheChange): number {
  const rank = (at: number | null): number => at ?? Number.MAX_SAFE_INTEGER;
  return rank(b.at) - rank(a.at);
}

// ─── Thème ────────────────────────────────────────────────────────────────────────────────────

export interface ThemeFicheInput {
  theme: SpecificThemeId;
  queue: WorkQueue;
  snapshot: Pick<FranceCountrySnapshot, 'signals' | 'energy'>;
  events: IntelEventsState | null;
  changeTimes: ReadonlyMap<string, number>;
  freshness: string;
  whyOpen: boolean;
  lang: Lang;
}

function officialSignalText(o: OfficialSignal, lang: Lang): string {
  const word = levelLabel(o.level, lang).toLowerCase();
  if (o.source === 'ecowatt') return t(lang, `Écowatt : signal ${word}`, `Ecowatt: ${word} signal`);
  if (o.source === 'meteo') return t(lang, `Vigilance météo ${word}`, `Weather ${levelVigilanceWord(o.level, 'en')}`);
  return t(lang, `Vigicrues ${word}`, `Vigicrues ${word}`);
}

function themeFigures(theme: SpecificThemeId, snapshot: ThemeFicheInput['snapshot'], lang: Lang): FicheFigure[] {
  const s = snapshot.signals;
  const e = snapshot.energy;
  switch (theme) {
    case 'energy': {
      const figures: FicheFigure[] = [];
      if (e?.totalMw != null) figures.push({ label: t(lang, 'Production nationale', 'National output'), value: `${formatNumber(Math.round(e.totalMw), lang)} MW` });
      if (e?.oilStocksDays != null) figures.push({ label: t(lang, 'Stocks de carburant', 'Fuel stocks'), value: `${e.oilStocksDays} ${t(lang, 'j', 'd')}` });
      if (e?.windGw != null) figures.push({ label: t(lang, 'Production éolienne', 'Wind output'), value: `${formatNumber(e.windGw, lang)} GW` });
      return figures;
    }
    case 'security':
      return [
        { label: t(lang, 'Alertes cyber (30 j)', 'Cyber alerts (30 d)'), value: String(s.cyberAlerts) },
        { label: t(lang, 'Vols militaires suivis', 'Military flights tracked'), value: String(s.militaryFlights) },
        { label: t(lang, 'Alertes câbles et brouillage', 'Cable and jamming alerts'), value: String(s.defenseAlerts + s.jammingSignals) },
      ];
    case 'environment':
      return [
        { label: t(lang, 'Départements en vigilance orange ou rouge', 'Departments on orange or red'), value: String(s.meteoAlerts) },
        { label: t(lang, 'Tronçons en crue orange ou rouge', 'River sections on orange or red'), value: String(s.floodAlerts) },
        { label: t(lang, 'Feux détectés', 'Fires detected'), value: String(s.fireDetections) },
      ];
    case 'health':
      // Les données santé ne sont pas dans l'instantané national : les panneaux santé deviennent
      // le contenu de ce thème à l'étape 3.
      return [];
  }
}

export function buildThemeFiche(input: ThemeFicheInput): FicheModel {
  const { theme, queue, lang } = input;
  const items = queue.items.filter((i) => i.theme === theme);
  const official = queue.official.filter((o) => officialTheme(o.source) === theme);
  const raised = official.filter((o) => o.level !== 'vert');
  const reds = items.filter((i) => i.level === 'rouge').length;
  const n = items.length;

  const essentiel: string[] = n === 0
    ? [nothingToHandleText(queue.greenTracked[theme], lang)]
    : [
        t(lang,
          `${n} élément${plural(n)} à traiter${reds > 0 ? `, dont ${reds} rouge${plural(reds)}` : ''}.`,
          `${n} item${plural(n)} to handle${reds > 0 ? `, ${reds} red` : ''}.`),
        t(lang, `Le plus grave : ${items[0].title}.`, `Most severe: ${items[0].title}.`),
      ];
  for (const o of raised) essentiel.push(`${officialSignalText(o, lang)}.`);

  const changes: FicheChange[] = items
    .filter((i) => i.badge !== null && i.ref.kind !== 'event')
    .map((i) => ({
      at: input.changeTimes.get(i.key) ?? null,
      text: i.badge === 'nouveau' ? labelled(lang, 'Nouveau', 'New', i.title) : labelled(lang, 'Aggravé', 'Escalated', i.title),
      select: i.key,
    }));
  for (const d of input.events?.digest ?? []) {
    if (categoryTheme(d.event.category) !== theme) continue;
    changes.push({ at: parseTime(d.latestAt), text: digestChangeText(d, lang), select: `event:${d.event.id}` });
  }

  const labels = new Set<string>(official.map((o) => officialSourceName(o.source)));
  for (const i of items) {
    if (i.ref.kind === 'situation' || i.ref.kind === 'alert') {
      for (const ref of i.ref.situation.sourceRefs) labels.add(ref);
    }
  }

  const signalRows = official.map((o) => {
    const where = o.level === 'vert' ? '' : ` · ${o.places} ${t(lang, o.places > 1 ? 'lieux' : 'lieu', o.places > 1 ? 'places' : 'place')}`;
    return `<li>${renderVigilancePill(o.level, lang)} ${escapeHtml(officialSourceName(o.source))}${where}</li>`;
  }).join('');
  const itemRows = items.map((i) => `<li>${renderVigilancePill(i.level, lang)} ${escapeHtml(i.title)}</li>`).join('');
  const why = [
    signalRows ? `<h4 class="fiche-why-title">${t(lang, 'Signaux officiels', 'Official signals')}</h4><ul class="fiche-list">${signalRows}</ul>` : '',
    itemRows ? `<h4 class="fiche-why-title">${t(lang, 'Éléments à traiter', 'Items to handle')}</h4><ul class="fiche-list">${itemRows}</ul>` : '',
    theme === 'energy' ? renderEnergyBlock(input.snapshot.energy, lang) : '',
    `<p class="fiche-meta">${t(lang,
      'Le niveau du thème est le plus élevé de ses signaux officiels et de ses éléments à traiter.',
      'The theme level is the highest of its official signals and items to handle.')}</p>`,
  ].join('');

  return {
    key: `theme:${theme}`,
    kind: t(lang, 'Thème', 'Theme'),
    name: themeLabel(theme, lang),
    level: queue.themeLevels[theme],
    driver: n > 0 ? items[0].title : raised.length > 0 ? officialSignalText(raised[0], lang) : t(lang, 'rien à traiter', 'nothing to handle'),
    freshness: input.freshness,
    essentiel: essentiel.slice(0, 3),
    changesMeta: '',
    changes: changes.sort(byTimeDesc),
    sections: [],
    figures: themeFigures(theme, input.snapshot, lang),
    watch: [],
    sourcesTitle: t(lang, 'Sources', 'Sources'),
    sources: [...labels].slice(0, 8).map((label) => ({ label, href: null, select: null })),
    why,
    whyOpen: input.whyOpen,
    actions: [{ id: 'show-theme', label: t(lang, 'Afficher sur la carte', 'Show on map') }],
  };
}

// ─── Événement consolidé ──────────────────────────────────────────────────────────────────────

export interface EventFicheInput {
  event: NewsEvent;
  /** Articles et journal, chargés à la demande (undefined tant que la demande n'est pas partie). */
  detail: EventDetailState | undefined;
  whyOpen: boolean;
  lang: Lang;
  now: number;
}

const LOG_LABEL: Record<NewsEventChangeKind, [string, string]> = {
  created: ['créé', 'created'],
  escalated: ['aggravé', 'escalated'],
  corroborated: ['corroboré', 'corroborated'],
  reopened: ['rouvert', 'reopened'],
  deescalated: ['atténué', 'de-escalated'],
  cooling: ['en refroidissement', 'cooling'],
  closed: ['clos', 'closed'],
};

const STATUS_LABEL: Record<NewsEvent['status'], [string, string]> = {
  active: ['actif', 'active'],
  cooling: ['refroidit', 'cooling'],
  closed: ['clos', 'closed'],
};

function logText(entry: NewsEventDetail['log'][number], lang: Lang): string {
  const label = LOG_LABEL[entry.kind][lang === 'fr' ? 0 : 1];
  const severity = entry.kind === 'created' || entry.kind === 'escalated' || entry.kind === 'deescalated';
  const value = (v: string): string => (severity ? severityWord(v, lang) ?? v : v);
  if (entry.from !== null && entry.to !== null) {
    const from = value(entry.from);
    const to = value(entry.to);
    // info et low partagent le vert L1 : juste le mot, pas de « vert → vert ».
    return from === to ? label : `${label} ${from} → ${to}`;
  }
  return entry.to !== null ? `${label} · ${value(entry.to)}` : label;
}

export function buildEventFiche(input: EventFicheInput): FicheModel {
  const { event: e, detail, lang, now } = input;
  const level = eventLevel(e.severity);
  const indep = e.independentCount;
  const driver = indep >= 2
    ? t(lang, `${indep} sources indépendantes`, `${indep} independent sources`)
    : e.sourceCount > 1
      ? t(lang, `${e.sourceCount} titres du même groupe`, `${e.sourceCount} outlets from one group`)
      : t(lang, 'source unique', 'single source');
  const names = e.sourceNames.slice(0, 4).join(', ');
  const since = formatClock(parseTime(e.firstSeen) ?? now, lang);
  const loaded = detail !== undefined && detail !== 'loading' && detail !== 'error' ? detail : null;
  const changes: FicheChange[] = loaded
    ? loaded.log.slice(0, 5).map((entry) => ({ at: parseTime(entry.at), text: logText(entry, lang), select: null }))
    : [];
  const changesMeta = loaded
    ? ''
    : detail === 'error'
      ? t(lang, 'Journal indisponible pour le moment.', 'Log unavailable right now.')
      : t(lang, 'Chargement du journal…', 'Loading log…');
  const sources: FicheSource[] = loaded
    ? loaded.articles.map((a) => {
        const at = a.publishedAt ? parseTime(a.publishedAt) : null;
        return { label: `${a.title} · ${a.feedName ?? '—'}${at !== null ? ` · ${formatClock(at, lang)}` : ''}`, href: a.link, select: null };
      })
    : e.sourceNames.map((name) => ({ label: name, href: null, select: null }));
  const status = STATUS_LABEL[e.status][lang === 'fr' ? 0 : 1];
  const why = `<ul class="fiche-list">`
    + `<li>${t(lang, 'Identifiant de preuve', 'Evidence id')} : ${escapeHtml(e.evidenceId)}</li>`
    + `<li>${t(lang, 'Classement', 'Classification')} : ${escapeHtml(themeLabel(categoryTheme(e.category), lang))}, ${levelLabel(level, lang).toLowerCase()}</li>`
    + `<li>${t(lang, 'Corroboration', 'Corroboration')} : ${t(lang,
      `${indep} groupe${plural(indep)} de presse indépendant${plural(indep)} sur ${e.sourceCount} flux`,
      `${indep} independent press group${plural(indep)} across ${e.sourceCount} feeds`)}</li>`
    + `<li>${t(lang, 'Statut', 'Status')} : ${status}</li>`
    + `</ul>`;
  return {
    key: `event:${e.id}`,
    kind: `${t(lang, 'Événement', 'Event')} · ${themeLabel(categoryTheme(e.category), lang)}`,
    name: e.title,
    level,
    driver,
    freshness: `${t(lang, 'Dernier article', 'Last article')} ${formatAge(e.lastSeen, now, lang)}`,
    essentiel: [t(lang,
      `Repris par ${e.sourceCount} source${plural(e.sourceCount)}${names ? ` (${names})` : ''} depuis ${since}.`,
      `Reported by ${e.sourceCount} source${plural(e.sourceCount)}${names ? ` (${names})` : ''} since ${since}.`)],
    changesMeta,
    changes,
    sections: [],
    figures: [
      { label: t(lang, 'Articles', 'Articles'), value: String(e.articleCount) },
      { label: t(lang, 'Flux', 'Feeds'), value: String(e.sourceCount) },
      { label: t(lang, 'Groupes indépendants', 'Independent groups'), value: String(indep) },
    ],
    watch: [],
    sourcesTitle: t(lang, 'Articles', 'Articles'),
    sources,
    why,
    whyOpen: input.whyOpen,
    actions: e.lat !== null && e.lon !== null ? [{ id: 'map', label: t(lang, 'Voir sur la carte', 'Show on map') }] : [],
  };
}

// ─── Situation du moteur et alerte ────────────────────────────────────────────────────────────

export interface SituationFicheInput {
  situation: DetectedSituation;
  kind: 'situation' | 'alert';
  badge: WorkBadge;
  /** Heure d'apparition connue dans la session, null sinon. */
  changeAt: number | null;
  /** Un dossier dédié existe (grand feu, vol militaire). */
  hasDossier: boolean;
  whyOpen: boolean;
  lang: Lang;
}

const ACTION_TYPE: Record<SituationAction['actionType'], [string, string]> = {
  investigate: ['Enquête', 'Investigate'],
  monitor: ['Surveillance', 'Monitor'],
  'cross-check': ['Recoupement', 'Cross-check'],
  escalate: ['Escalade', 'Escalate'],
};

export function buildSituationFiche(input: SituationFicheInput): FicheModel {
  const { situation: s, lang } = input;
  const level = situationLevel(s.severity);
  const summary = splitScoreSentences(s.summary);
  const drivers = splitScoreLines(s.drivers);
  const essentiel = summary.plain.length > 0
    ? summary.plain.slice(0, 3)
    : [t(lang, `${s.title} : ${levelVigilanceWord(level)}.`, `${s.title}: ${levelVigilanceWord(level, 'en')}.`)];

  const sections: FicheSection[] = [];
  if (drivers.plain.length > 0) {
    sections.push({
      title: t(lang, 'Facteurs', 'Drivers'),
      html: `<ul class="fiche-list">${drivers.plain.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}</ul>`,
    });
  }
  if (s.affectedZones.length > 0) {
    sections.push({ title: t(lang, 'Zones', 'Areas'), html: `<p>${escapeHtml(s.affectedZones.join(' · '))}</p>` });
  }
  if (s.recommendedActions.length > 0) {
    const rows = s.recommendedActions.map((a) => {
      const auto = a.automatable ? ` · ${t(lang, 'IA possible', 'AI possible')}` : '';
      return `<li>${escapeHtml(a.label)} <span class="fiche-meta">${escapeHtml(a.ownerHint)} · ${ACTION_TYPE[a.actionType][lang === 'fr' ? 0 : 1]}${auto}</span></li>`;
    }).join('');
    sections.push({ title: t(lang, 'Actions recommandées', 'Recommended actions'), html: `<ul class="fiche-list">${rows}</ul>` });
  }

  const sources: FicheSource[] = s.sourceRefs.map((label) => ({ label, href: null, select: null }));
  // Lien source de l'ancienne fiche d'alerte : seulement s'il est http(s).
  if (s.linkUrl && safeHref(s.linkUrl) !== null) {
    sources.unshift({ label: s.linkLabel ?? t(lang, 'Ouvrir la source', 'Open source'), href: s.linkUrl, select: null });
  }

  // Arbitrage A7 : sous-scores et phrases chiffrées du moteur seulement dans le volet.
  const whyRows = [...drivers.scored, ...summary.scored].map((line) => `<li>${escapeHtml(line)}</li>`).join('');
  const why = `<ul class="fiche-list">${whyRows}`
    + `<li>${capitalize(confidenceLabel(s.confidence, lang))} (${Math.round(s.confidence * 100)} %)</li>`
    + `<li>${t(lang, 'Niveau', 'Level')} : ${levelLabel(level, lang)}, ${levelPhrase(level, lang)}</li></ul>`;

  const actions: FicheAction[] = [];
  if ((s.activateLayers?.length ?? 0) > 0 || (s.lon != null && s.lat != null)) {
    actions.push({ id: 'map', label: t(lang, 'Voir sur la carte', 'Show on map') });
  }
  if (input.hasDossier) {
    actions.push({
      id: 'dossier',
      label: s.type === 'WILDFIRE_ESCALATION'
        ? t(lang, 'Ouvrir le dossier d’incident', 'Open incident file')
        : t(lang, 'Voir l’aéronef', 'Show aircraft'),
    });
  }

  const changes: FicheChange[] = input.badge === null
    ? []
    : [{
        at: input.changeAt,
        text: input.badge === 'nouveau'
          ? t(lang, 'Nouveau depuis votre visite', 'New since your visit')
          : t(lang, 'Aggravé depuis votre visite', 'Escalated since your visit'),
        select: null,
      }];

  return {
    key: `${input.kind}:${s.id}`,
    kind: input.kind === 'alert' ? t(lang, 'Alerte', 'Alert') : t(lang, 'Situation', 'Situation'),
    name: s.title,
    level,
    driver: confidenceLabel(s.confidence, lang),
    freshness: `${t(lang, 'Mise à jour', 'Updated')} ${formatClock(s.updatedAt.getTime(), lang)}`,
    essentiel,
    changesMeta: '',
    changes,
    sections,
    figures: [],
    watch: [],
    sourcesTitle: t(lang, 'Sources', 'Sources'),
    sources,
    why,
    whyOpen: input.whyOpen,
    actions,
  };
}

// ─── Alerte officielle et marché ──────────────────────────────────────────────────────────────

export function buildOfficialFiche(group: OfficialAlertGroup, input: { freshness: string; whyOpen: boolean; lang: Lang }): FicheModel {
  const { lang } = input;
  const n = group.places.length;
  const shown = group.places.slice(0, 5).join(', ');
  const more = n > 5 ? t(lang, ` et ${n - 5} autre${plural(n - 5)}`, ` and ${n - 5} more`) : '';
  const source = officialSourceName(group.source);
  const violet = group.source === 'meteo'
    ? ` ${t(lang, 'Le violet de Météo-France compte comme rouge.', 'Météo-France purple counts as red.')}`
    : '';
  return {
    key: `official:${group.source}:${group.level}`,
    kind: t(lang, 'Alerte officielle', 'Official alert'),
    name: officialTitle(group, lang),
    level: group.level,
    driver: source,
    freshness: input.freshness,
    essentiel: [t(lang,
      `${capitalize(levelVigilanceWord(group.level))} (${levelPhrase(group.level)}) : ${shown}${more}.`,
      `${capitalize(levelVigilanceWord(group.level, 'en'))} (${levelPhrase(group.level, 'en')}): ${shown}${more}.`)],
    changesMeta: '',
    changes: [],
    sections: [{
      title: t(lang, 'Détail par lieu', 'Detail by place'),
      html: `<ul class="fiche-list">${group.details.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}</ul>`,
    }],
    figures: [{ label: t(lang, 'Lieux concernés', 'Places concerned'), value: String(n) }],
    watch: [],
    sourcesTitle: t(lang, 'Sources', 'Sources'),
    sources: [{ label: source, href: null, select: null }],
    why: `<p>${escapeHtml(t(lang, `Niveau publié par ${source}, repris tel quel.`, `Level published by ${source}, shown as is.`))}${violet}</p>`,
    whyOpen: input.whyOpen,
    actions: [{ id: 'show-layer', label: t(lang, 'Afficher la couche', 'Show layer') }],
  };
}

export function buildMarketFiche(line: MarketLine, input: { whyOpen: boolean; lang: Lang }): FicheModel {
  const { lang } = input;
  const threshold = MARKET_ALERT_THRESHOLD[line.kind];
  const pct = formatSignedPct(line.changePercent);
  return {
    key: `market:${line.symbol}`,
    kind: t(lang, 'Marché', 'Market'),
    name: line.name,
    level: 'jaune',
    driver: t(lang, 'mouvement exceptionnel', 'exceptional move'),
    freshness: '',
    essentiel: [t(lang,
      `${line.name} varie de ${pct} sur la journée, au-delà du seuil de ±${threshold} %.`,
      `${line.name} moved ${pct} today, beyond the ±${threshold} % threshold.`)],
    changesMeta: '',
    changes: [],
    sections: [],
    figures: [
      { label: t(lang, 'Cours', 'Price'), value: formatNumber(line.price, lang) },
      { label: t(lang, 'Variation', 'Change'), value: pct },
    ],
    watch: [],
    sourcesTitle: '',
    sources: [],
    why: `<p>${t(lang,
      'Seuil d’alerte : ±3 % sur la journée pour un indice boursier, ±5 % pour le pétrole et le gaz. En deçà, les marchés restent en gris.',
      'Alert threshold: ±3 % over the day for a stock index, ±5 % for oil and gas. Below it, markets stay grey.')}</p>`,
    whyOpen: input.whyOpen,
    actions: [],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/fiche/ && npm run typecheck`
Expected: PASS (7 + 6 + 10 tests), typecheck sans erreur.

- [ ] **Step 5: Run the task gate**

Run: `npx vitest run && npm run lint && npm run build`
Expected: tout vert.

- [ ] **Step 6: Commit**

```bash
git add src/components/fiche/items.ts src/components/fiche/items.test.ts
git commit -m "feat: fiches thème, événement, situation, alerte, alerte officielle et marché"
```

---

### Task 9: Bandeau d'état, barre de thèmes et liste « À traiter » (composants)

**Files:**
- Create: `src/components/poste/StatusBar.ts`, `src/components/poste/ThemeBar.ts`, `src/components/poste/WorkList.ts`
- Test: `src/components/poste/StatusBar.test.ts`, `src/components/poste/WorkList.test.ts`

**Interfaces:**
- Consumes : tâches 1 à 3 (`THEMES`, `themeLabel`, `ThemeId`, `WorkQueueView`, `WorkItem`, `WORK_LIST_CAP`) ; tâche 7 (`nothingToHandleText`) ; `renderVigilancePill`, `levelLabel`, `escapeHtml`, `fmLoaderHTML`.
- Produces : `interface FreshnessCounts { upToDate; total }` ; `freshnessCounts(sources)` ; `freshnessText(counts, lang)` ; `interface StatusBarModel { level: VigilanceLevel | null; drivenBy; trend; visit; freshness; lang }` ; `renderStatusBar(model)` ; `class StatusBar { update(model); setOnSelectFrance(handler) }` ; `interface ThemeBarModel { selected; levels: Record<ThemeId, VigilanceLevel> | null; lang }` ; `renderThemeBar(model)` ; `class ThemeBar { update(model); setOnSelect(handler) }` ; `interface WorkListModel { view; selectedKey; ready; lang; now }` ; `rowMeta(item, lang, now)` ; `renderWorkList(model)` ; `class WorkList { update(model); focusRow(key): boolean; setOnSelect; setOnShowAll; setOnGuard }`.

- [ ] **Step 1: Write the failing tests**

Créer `src/components/poste/StatusBar.test.ts` :

```ts
// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { StatusBar, freshnessCounts, renderStatusBar, type StatusBarModel } from './StatusBar.ts';
import { ThemeBar, renderThemeBar } from './ThemeBar.ts';

afterEach(() => {
  document.body.replaceChildren();
});

function mountRoot(): HTMLElement {
  const root = document.createElement('div');
  document.body.appendChild(root);
  return root;
}

const visit = { firstVisit: false, since: '3 h', aggravations: 2, nouveaux: 1 };
const base: StatusBarModel = {
  level: 'rouge',
  drivenBy: 'tirée par l’énergie',
  trend: 'en dégradation sur 24 h',
  visit,
  freshness: { upToDate: 33, total: 35 },
  lang: 'fr',
};

describe('StatusBar (spec §5.2)', () => {
  it('une ligne : niveau en mot, ce qui le tire, tendance, visite, fraîcheur', () => {
    const html = renderStatusBar(base);
    expect(html).toContain('<span class="fm-vig fm-vig--rouge">Rouge</span>');
    expect(html).toContain('France · tirée par l’énergie · en dégradation sur 24 h');
    expect(html).toContain('Depuis votre visite (3 h)</b> : 2 aggravations · 1 nouveau');
    expect(html).toContain('33 sources sur 35 à jour');
    expect(renderStatusBar({ ...base, visit: { ...visit, firstVisit: true } })).toContain('Première visite : dernières 24 h');
    expect(renderStatusBar({ ...base, level: null })).toContain('Calcul du niveau national…');
  });

  it('compte les sources à jour ; le niveau ouvre la fiche France', () => {
    expect(freshnessCounts([
      { name: 'a', lastUpdate: null, status: 'ok' },
      { name: 'b', lastUpdate: null, status: 'stale' },
    ])).toEqual({ upToDate: 1, total: 2 });
    const root = mountRoot();
    const bar = new StatusBar(root);
    const onFrance = vi.fn();
    bar.setOnSelectFrance(onFrance);
    bar.update(base);
    root.querySelector<HTMLButtonElement>('[data-select="france"]')?.click();
    expect(onFrance).toHaveBeenCalledTimes(1);
  });
});

describe('ThemeBar (spec §5.3)', () => {
  it('cinq thèmes, le mot du niveau sur chacun, le thème choisi est pressé', () => {
    const html = renderThemeBar({
      selected: 'energy',
      levels: { general: 'rouge', energy: 'rouge', security: 'orange', health: 'vert', environment: 'jaune' },
      lang: 'fr',
    });
    expect(html.match(/data-theme=/g)).toHaveLength(5);
    expect(html).toContain('data-theme="energy" aria-pressed="true"');
    expect(html).toContain('Santé <span class="tb-level"><span class="fm-vig fm-vig--vert">Vert</span>');
    // Niveau national pas encore calculé : aucune pastille plutôt qu'un vert par défaut (revue).
    expect(renderThemeBar({ selected: 'general', levels: null, lang: 'fr' })).not.toContain('fm-vig');
  });

  it('un clic choisit le thème', () => {
    const root = mountRoot();
    const bar = new ThemeBar(root);
    const onSelect = vi.fn();
    bar.setOnSelect(onSelect);
    bar.update({ selected: 'general', levels: { general: 'jaune', energy: 'vert', security: 'vert', health: 'vert', environment: 'vert' }, lang: 'fr' });
    root.querySelector<HTMLButtonElement>('[data-theme="health"]')?.click();
    expect(onSelect).toHaveBeenCalledWith('health');
  });
});
```

Créer `src/components/poste/WorkList.test.ts` :

```ts
// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { WorkList, renderWorkList, type WorkListModel } from './WorkList.ts';
import { buildWorkQueue, viewWorkQueue, type WorkQueueInput } from '../../services/work-queue.ts';
import type { ThemeId } from '../../services/themes.ts';
import type { DetectedSituation, IntelEventsState, NewsEvent } from '../../types/index.ts';

const NOW = Date.parse('2026-09-24T08:00:00Z');

function situation(over: Partial<DetectedSituation> = {}): DetectedSituation {
  return {
    id: 'energy-stress', type: 'ENERGY_STRESS', severity: 'high', confidence: 0.8, title: 'Tension énergétique nationale',
    summary: 'Résumé.', affectedZones: [], drivers: [], recommendedActions: [], sourceRefs: [], updatedAt: new Date(NOW), ...over,
  };
}

function event(over: Partial<NewsEvent> = {}): NewsEvent {
  return {
    id: 42, evidenceId: 'E42', title: 'Explosion dans une usine chimique', category: 'security', severity: 'critical',
    status: 'active', firstSeen: '2026-09-24T07:30:00Z', lastSeen: '2026-09-24T07:50:00Z', articleCount: 3,
    sourceCount: 3, independentCount: 3, sourceNames: [], lat: null, lon: null, ...over,
  };
}

function events(over: Partial<IntelEventsState> = {}): IntelEventsState {
  return { events: [], digest: [], totals: {}, anchor: { since: NOW - 3_600_000, kind: 'last-visit' }, fetchedAt: NOW, unavailable: false, ...over };
}

function model(over: Partial<WorkQueueInput> = {}, theme: ThemeId = 'general', now = NOW): WorkListModel {
  const queue = buildWorkQueue({
    situations: [], alerts: [], events: events(), ecowatt: null, meteo: [], floods: [], markets: [],
    baseline: null, firstSeen: new Map(), lang: 'fr', ...over,
  });
  return { view: viewWorkQueue(queue, theme, false), selectedKey: null, ready: true, lang: 'fr', now };
}

function mount(): { root: HTMLElement; list: WorkList } {
  const root = document.createElement('div');
  document.body.appendChild(root);
  return { root, list: new WorkList(root) };
}

const activeKey = (): string | undefined => (document.activeElement instanceof HTMLElement ? document.activeElement.dataset.key : undefined);

afterEach(() => {
  document.body.replaceChildren();
});

describe('renderWorkList (spec §7.2, §7.4)', () => {
  it('titre, mot du niveau dans chaque ligne, badge et sources indépendantes', () => {
    const html = renderWorkList(model({ events: events({
      events: [event()],
      digest: [{ event: event(), kinds: ['created'], latestAt: '2026-09-24T07:40:00Z', severityFrom: null, independentFrom: null }],
    }) }));
    expect(html).toContain('À traiter · Vue générale · 1');
    expect(html).toContain('>NOUVEAU</span>');
    expect(html).toContain('Rouge · il y a 30 min · 3 sources indép.');
  });

  it('rien à traiter, événements indisponibles, voir les autres, garde hors thème', () => {
    const empty = renderWorkList(model({ events: events({ unavailable: true }) }, 'health'));
    expect(empty).toContain('Rien à traiter. 0 élément suivi est au vert.');
    expect(empty).toContain('Événements indisponibles pour le moment');
    // Avant les couches critiques, une liste vide ne rassure pas : « chargement », pas « rien à traiter » (revue).
    const loading = renderWorkList({ ...model({}, 'health'), ready: false });
    expect(loading).toContain('Chargement des données…');
    expect(loading).not.toContain('Rien à traiter');
    const many = Array.from({ length: 14 }, (_, i) => situation({ id: `s${i}` }));
    expect(renderWorkList(model({ situations: many }))).toContain('Voir les 2 autres');
    const guarded = renderWorkList(model({ situations: [situation({ severity: 'critical' })] }, 'health'));
    expect(guarded).toContain('data-guard="energy"');
    expect(guarded).toContain('Hors de ce thème : 1 rouge (Énergie)');
  });

  it('échappe le titre et la clé de ligne (revue)', () => {
    const html = renderWorkList(model({ situations: [situation({ id: 'x" onfocus="alert(1)', title: '<img src=x onerror=alert(1)>' })] }));
    expect(html).not.toContain('<img');
    expect(html).toContain('data-key="situation:x&quot; onfocus=&quot;alert(1)"');
  });
});

describe('WorkList — clavier et focus (spec §9)', () => {
  it('flèches pour se déplacer, clic ou Entrée pour ouvrir la fiche', () => {
    const { root, list } = mount();
    const onSelect = vi.fn();
    list.setOnSelect(onSelect);
    list.update(model({ situations: [situation({ id: 'a' }), situation({ id: 'b' })] }));
    const rows = [...root.querySelectorAll<HTMLButtonElement>('.wl-item')];
    rows[0].focus();
    rows[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(rows[1]);
    rows[1].click();
    expect(onSelect).toHaveBeenCalledWith('situation:b');
  });

  it('le focus survit à vingt reconstructions, puis passe à la première ligne si la sienne disparaît (revue)', () => {
    const { root, list } = mount();
    const at = (now: number, ids: string[]): WorkListModel => model({
      situations: ids.map((id) => situation({ id })),
      firstSeen: new Map(ids.map((id): [string, number] => [`situation:${id}`, NOW - 10 * 60_000])),
    }, 'general', now);
    list.update(at(NOW, ['a', 'b', 'c']));
    root.querySelectorAll<HTMLButtonElement>('.wl-item')[1].focus();
    // « depuis 11 min », « depuis 12 min »… : chaque mise à jour reconstruit réellement la liste.
    for (let i = 1; i <= 20; i += 1) list.update(at(NOW + i * 60_000, ['a', 'b', 'c']));
    expect(activeKey()).toBe('situation:b');
    list.update(at(NOW + 30 * 60_000, ['a', 'c']));
    expect(activeKey()).toBe('situation:a');
  });

  it('ne réécrit pas le DOM quand rien ne change', () => {
    const { root, list } = mount();
    list.update(model({ situations: [situation()] }));
    const row = root.querySelector('.wl-item');
    list.update(model({ situations: [situation()] }));
    expect(root.querySelector('.wl-item')).toBe(row);
  });

  it('« Voir les autres » et la garde remontent leur action', () => {
    const { root, list } = mount();
    const onShowAll = vi.fn();
    const onGuard = vi.fn();
    list.setOnShowAll(onShowAll);
    list.setOnGuard(onGuard);
    const cyber = Array.from({ length: 13 }, (_, i) => situation({ id: `c${i}`, type: 'CYBER_PRESSURE' }));
    list.update(model({ situations: [...cyber, situation({ id: 'e', severity: 'critical' })] }, 'security'));
    root.querySelector<HTMLButtonElement>('[data-more]')?.click();
    root.querySelector<HTMLButtonElement>('[data-guard]')?.click();
    expect(onShowAll).toHaveBeenCalledWith(true);
    expect(onGuard).toHaveBeenCalledWith('energy');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/poste/`
Expected: FAIL, `Cannot find module './StatusBar.ts'`, `'./ThemeBar.ts'`, `'./WorkList.ts'`.

- [ ] **Step 3: Écrire le bandeau d'état**

Créer `src/components/poste/StatusBar.ts` :

```ts
// src/components/poste/StatusBar.ts — bandeau d'état de la disposition A1 (spec §5.2) : niveau
// national en mot et en couleur, ce qui le tire, tendance 24 h, changements depuis la visite et
// voyant de fraîcheur commun (§4.3). Une ligne ; le niveau ouvre la fiche France.

import type { DataSourceStatus } from '../../types/index.ts';
import type { VigilanceLevel } from '../../services/vigilance.ts';
import { renderVigilancePill } from '../shared/vigilancePill.ts';
import { escapeHtml } from '../france-intel-events.ts';

type Lang = 'fr' | 'en';

export interface FreshnessCounts {
  upToDate: number;
  total: number;
}

export interface StatusBarModel {
  /** null tant que l'instantané national n'est pas calculé. */
  level: VigilanceLevel | null;
  drivenBy: string;
  trend: string;
  /** null tant que l'historique n'est pas chargé, ou s'il est indisponible. */
  visit: { firstVisit: boolean; since: string; aggravations: number; nouveaux: number } | null;
  freshness: FreshnessCounts;
  lang: Lang;
}

export function freshnessCounts(sources: readonly DataSourceStatus[]): FreshnessCounts {
  return { upToDate: sources.filter((s) => s.status === 'ok').length, total: sources.length };
}

/** « 33 sources sur 35 à jour » : le seul voyant de fraîcheur (le détail est dans « Sources et qualité »). */
export function freshnessText(counts: FreshnessCounts, lang: Lang): string {
  if (counts.total === 0) return lang === 'fr' ? 'Sources en cours de chargement' : 'Sources loading';
  return lang === 'fr'
    ? `${counts.upToDate} source${counts.upToDate > 1 ? 's' : ''} sur ${counts.total} à jour`
    : `${counts.upToDate} of ${counts.total} sources up to date`;
}

function count(n: number, one: string, many: string, lang: Lang): string {
  const singular = lang === 'fr' ? n <= 1 : n === 1;
  return `${n} ${singular ? one : many}`;
}

export function renderStatusBar(model: StatusBarModel): string {
  const { lang } = model;
  const fr = lang === 'fr';
  if (model.level === null) {
    return `<div class="sb-line"><span class="sb-loading">${fr ? 'Calcul du niveau national…' : 'Computing national level…'}</span></div>`;
  }
  const pill = `<button type="button" class="sb-level" data-select="france" aria-label="${fr ? 'Ouvrir la fiche France' : 'Open the France sheet'}">`
    + `${renderVigilancePill(model.level, lang)}</button>`;
  const summary = ['France', model.drivenBy, model.trend].filter((part) => part.length > 0).map(escapeHtml).join(' · ');
  let visit = '';
  if (model.visit) {
    const v = model.visit;
    visit = v.firstVisit
      ? (fr ? 'Première visite : dernières 24 h' : 'First visit: last 24 h')
      : fr
        ? `<b>Depuis votre visite (${escapeHtml(v.since)})</b> : ${count(v.aggravations, 'aggravation', 'aggravations', lang)} · ${count(v.nouveaux, 'nouveau', 'nouveaux', lang)}`
        : `<b>Since your visit (${escapeHtml(v.since)})</b>: ${count(v.aggravations, 'escalation', 'escalations', lang)} · ${v.nouveaux} new`;
  }
  return `<div class="sb-line">${pill}<span class="sb-summary">${summary}</span>`
    + (visit ? `<span class="sb-visit">${visit}</span>` : '')
    + `<span class="sb-fresh"><span class="sb-dot" aria-hidden="true"></span>${escapeHtml(freshnessText(model.freshness, lang))}</span></div>`;
}

export class StatusBar {
  private readonly root: HTMLElement;
  private lastHtml = '';
  private onSelectFrance: (() => void) | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.addEventListener('click', (e) => {
      const target = e.target instanceof Element ? e.target.closest('[data-select="france"]') : null;
      if (target) this.onSelectFrance?.();
    });
  }

  setOnSelectFrance(handler: () => void): void {
    this.onSelectFrance = handler;
  }

  update(model: StatusBarModel): void {
    const html = renderStatusBar(model);
    if (html === this.lastHtml) return;
    const active = document.activeElement;
    const hadFocus = active instanceof HTMLElement && this.root.contains(active);
    this.root.innerHTML = html;
    this.lastHtml = html;
    if (hadFocus) this.root.querySelector<HTMLElement>('[data-select="france"]')?.focus({ preventScroll: true });
  }
}
```

- [ ] **Step 4: Écrire la barre de thèmes**

Créer `src/components/poste/ThemeBar.ts` :

```ts
// src/components/poste/ThemeBar.ts — barre de thèmes (spec §5.3) : les cinq vues, chacune avec la
// pastille de son niveau (le mot sur la couleur, §9). « Vue générale » porte le niveau national.

import type { VigilanceLevel } from '../../services/vigilance.ts';
import { THEMES, themeLabel, type ThemeId } from '../../services/themes.ts';
import { renderVigilancePill } from '../shared/vigilancePill.ts';
import { escapeHtml } from '../france-intel-events.ts';

type Lang = 'fr' | 'en';

export interface ThemeBarModel {
  selected: ThemeId;
  /** null tant que le niveau national n'est pas calculé : aucune pastille plutôt qu'un vert par défaut. */
  levels: Record<ThemeId, VigilanceLevel> | null;
  lang: Lang;
}

export function renderThemeBar(model: ThemeBarModel): string {
  const buttons = THEMES.map((th) => {
    const on = th.id === model.selected;
    const level = model.levels ? ` <span class="tb-level">${renderVigilancePill(model.levels[th.id], model.lang)}</span>` : '';
    return `<button type="button" class="tb-theme${on ? ' is-on' : ''}" data-theme="${th.id}" aria-pressed="${on ? 'true' : 'false'}">`
      + `${escapeHtml(themeLabel(th.id, model.lang))}${level}</button>`;
  }).join('');
  return `<div class="tb-list" role="group" aria-label="${model.lang === 'fr' ? 'Thèmes' : 'Themes'}">${buttons}</div>`;
}

function findTheme(root: ParentNode, id: string): HTMLElement | null {
  for (const el of root.querySelectorAll<HTMLElement>('[data-theme]')) {
    if (el.dataset.theme === id) return el;
  }
  return null;
}

export class ThemeBar {
  private readonly root: HTMLElement;
  private lastHtml = '';
  private onSelect: ((theme: ThemeId) => void) | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    root.addEventListener('click', (e) => {
      const id = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-theme]')?.dataset.theme : undefined;
      const theme = THEMES.find((th) => th.id === id)?.id;
      if (theme) this.onSelect?.(theme);
    });
    root.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const buttons = [...root.querySelectorAll<HTMLElement>('[data-theme]')];
      const index = buttons.findIndex((b) => b === document.activeElement);
      if (index === -1) return;
      e.preventDefault();
      const next = e.key === 'ArrowRight' ? Math.min(buttons.length - 1, index + 1) : Math.max(0, index - 1);
      buttons[next]?.focus();
    });
  }

  setOnSelect(handler: (theme: ThemeId) => void): void {
    this.onSelect = handler;
  }

  update(model: ThemeBarModel): void {
    const html = renderThemeBar(model);
    if (html === this.lastHtml) return;
    const active = document.activeElement;
    const focused = active instanceof HTMLElement && this.root.contains(active) ? active.dataset.theme : undefined;
    this.root.innerHTML = html;
    this.lastHtml = html;
    if (focused) findTheme(this.root, focused)?.focus({ preventScroll: true });
  }
}
```

- [ ] **Step 5: Écrire la liste « À traiter »**

Créer `src/components/poste/WorkList.ts` :

```ts
// src/components/poste/WorkList.ts — liste « À traiter » (spec §7.2) : une ligne par élément, barre
// de couleur ET mot du niveau (§9), badge NOUVEAU ou AGGRAVÉ, « Voir les <n> autres », garde hors
// thème fixe en bas. Navigable au clavier (flèches, Début, Fin ; Entrée ouvre la fiche). La liste
// est reconstruite à chaque donnée : le focus est rendu à la même ligne, ou à la première.

import { levelLabel } from '../../services/vigilance.ts';
import { THEMES, themeLabel, type ThemeId } from '../../services/themes.ts';
import { WORK_LIST_CAP, type WorkItem, type WorkQueueView } from '../../services/work-queue.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { fmLoaderHTML } from '../shared/loader.ts';
import { nothingToHandleText } from '../fiche/parts.ts';

type Lang = 'fr' | 'en';

export interface WorkListModel {
  view: WorkQueueView;
  selectedKey: string | null;
  /** Couches critiques chargées : avant, une liste vide dit « chargement », jamais « rien à traiter ». */
  ready: boolean;
  lang: Lang;
  now: number;
}

function relative(since: number, now: number, lang: Lang, ongoing: boolean): string {
  const minutes = Math.max(0, Math.round((now - since) / 60_000));
  const unit = minutes < 60
    ? `${minutes} min`
    : minutes < 48 * 60 ? `${Math.round(minutes / 60)} h` : `${Math.round(minutes / 1440)} ${lang === 'fr' ? 'j' : 'd'}`;
  if (lang === 'fr') return ongoing ? `depuis ${unit}` : `il y a ${unit}`;
  return ongoing ? `for ${unit}` : `${unit} ago`;
}

/** « Rouge · Seine-Maritime · il y a 30 min · 3 sources indép. » (spec §7.2), texte brut. */
export function rowMeta(item: WorkItem, lang: Lang, now: number): string {
  const parts = [levelLabel(item.level, lang)];
  if (item.place) parts.push(item.place);
  if (item.since !== null) {
    // Un événement ou une alerte datent d'un instant (« il y a ») ; une situation dure (« depuis »).
    const ongoing = item.ref.kind !== 'event' && item.ref.kind !== 'alert';
    parts.push(relative(item.since, now, lang, ongoing));
  }
  if (item.independentSources !== null) {
    parts.push(item.independentSources >= 2
      ? (lang === 'fr' ? `${item.independentSources} sources indép.` : `${item.independentSources} indep. sources`)
      : (lang === 'fr' ? 'source unique' : 'single source'));
  }
  return parts.join(' · ');
}

function badgeHtml(item: WorkItem, lang: Lang): string {
  // Majuscules du §7.2, exception explicite au §4.3 (arbitrage A4) ; couleur neutre (§2).
  if (item.badge === 'nouveau') return ` <span class="wl-badge">${lang === 'fr' ? 'NOUVEAU' : 'NEW'}</span>`;
  if (item.badge === 'aggrave') return ` <span class="wl-badge">${lang === 'fr' ? 'AGGRAVÉ' : 'ESCALATED'}</span>`;
  return '';
}

export function renderWorkList(model: WorkListModel): string {
  const { view, lang, now } = model;
  const fr = lang === 'fr';
  const title = `${fr ? 'À traiter' : 'To handle'} · ${themeLabel(view.theme, lang)} · ${view.total}`;
  const rows = view.rows.map((item) => {
    const selected = item.key === model.selectedKey;
    return `<li class="wl-row"><button type="button" class="wl-item${selected ? ' is-selected' : ''}" data-key="${escapeHtml(item.key)}"`
      + ` aria-current="${selected ? 'true' : 'false'}" aria-controls="fm-v2-fiche">`
      + `<span class="wl-bar wl-bar--${item.level}" aria-hidden="true"></span>`
      + `<span class="wl-body"><span class="wl-item-title">${escapeHtml(item.title)}${badgeHtml(item, lang)}</span>`
      + `<span class="wl-meta">${escapeHtml(rowMeta(item, lang, now))}</span></span></button></li>`;
  }).join('');
  const notes: string[] = [];
  if (view.eventsStatus === 'loading') {
    notes.push(`<li class="wl-note">${fmLoaderHTML({ text: fr ? 'Chargement des événements…' : 'Loading events…', variant: 'inline' })}</li>`);
  } else if (view.eventsStatus === 'unavailable') {
    notes.push(`<li class="wl-note">${fr ? 'Événements indisponibles pour le moment' : 'Events unavailable right now'}</li>`);
  }
  const emptyText = model.ready ? nothingToHandleText(view.greenTracked, lang) : (fr ? 'Chargement des données…' : 'Loading data…');
  const empty = view.total === 0 ? `<p class="wl-empty">${escapeHtml(emptyText)}</p>` : '';
  const moreLabel = fr
    ? (view.hiddenCount > 1 ? `Voir les ${view.hiddenCount} autres` : 'Voir l’autre élément')
    : `Show ${view.hiddenCount} more`;
  const more = view.hiddenCount > 0
    ? `<button type="button" class="wl-more" data-more="show">${moreLabel}</button>`
    : view.total > WORK_LIST_CAP
      ? `<button type="button" class="wl-more" data-more="hide">${fr ? 'Réduire la liste' : 'Show less'}</button>`
      : '';
  const guardThemes = view.guard ? view.guard.themes.map((th) => themeLabel(th, lang)).join(', ') : '';
  const guard = view.guard
    ? `<button type="button" class="wl-guard" data-guard="${view.guard.target}">${escapeHtml(fr
      ? `Hors de ce thème : ${view.guard.reds} rouge${view.guard.reds > 1 ? 's' : ''} (${guardThemes})`
      : `Outside this theme: ${view.guard.reds} red (${guardThemes})`)}</button>`
    : '';
  return `<div class="wl-head"><h2 class="wl-title" tabindex="-1">${escapeHtml(title)}</h2></div>`
    + `<ul class="wl-list">${rows}${notes.join('')}</ul>${empty}${more}${guard}`;
}

function findByKey(root: ParentNode, key: string): HTMLElement | null {
  for (const el of root.querySelectorAll<HTMLElement>('[data-key]')) {
    if (el.dataset.key === key) return el;
  }
  return null;
}

export class WorkList {
  private readonly root: HTMLElement;
  private lastHtml = '';
  private onSelect: ((key: string) => void) | null = null;
  private onShowAll: ((showAll: boolean) => void) | null = null;
  private onGuard: ((theme: ThemeId) => void) | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    root.addEventListener('click', (e) => this.handleClick(e));
    root.addEventListener('keydown', (e) => this.handleKeydown(e));
  }

  setOnSelect(handler: (key: string) => void): void {
    this.onSelect = handler;
  }

  setOnShowAll(handler: (showAll: boolean) => void): void {
    this.onShowAll = handler;
  }

  setOnGuard(handler: (theme: ThemeId) => void): void {
    this.onGuard = handler;
  }

  update(model: WorkListModel): void {
    const html = renderWorkList(model);
    if (html === this.lastHtml) return;
    const active = document.activeElement;
    const restore = active instanceof HTMLElement && this.root.contains(active) ? this.focusTarget(active) : null;
    this.root.innerHTML = html;
    this.lastHtml = html;
    if (!restore) return;
    // Ligne disparue (élément résolu, expiré, filtré) : la première ligne, jamais le body.
    const target = restore() ?? this.root.querySelector<HTMLElement>('.wl-item') ?? this.root.querySelector<HTMLElement>('.wl-title');
    target?.focus({ preventScroll: true });
  }

  /** Rend le focus à la ligne d'une clé (retour de la fiche) ; false si elle n'est plus affichée. */
  focusRow(key: string): boolean {
    const row = findByKey(this.root, key);
    row?.focus({ preventScroll: true });
    return row !== null;
  }

  private focusTarget(el: HTMLElement): () => HTMLElement | null {
    const key = el.dataset.key;
    if (key !== undefined) return () => findByKey(this.root, key);
    if (el.dataset.more !== undefined) return () => this.root.querySelector<HTMLElement>('.wl-more');
    if (el.dataset.guard !== undefined) return () => this.root.querySelector<HTMLElement>('.wl-guard');
    return () => this.root.querySelector<HTMLElement>('.wl-title');
  }

  private handleClick(e: MouseEvent): void {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;
    const key = target.closest<HTMLElement>('[data-key]')?.dataset.key;
    if (key !== undefined) {
      this.onSelect?.(key);
      return;
    }
    const more = target.closest<HTMLElement>('[data-more]')?.dataset.more;
    if (more !== undefined) {
      this.onShowAll?.(more === 'show');
      return;
    }
    const guard = target.closest<HTMLElement>('[data-guard]')?.dataset.guard;
    const theme = THEMES.find((th) => th.id === guard)?.id;
    if (theme) this.onGuard?.(theme);
  }

  private handleKeydown(e: KeyboardEvent): void {
    const items = [...this.root.querySelectorAll<HTMLElement>('.wl-item')];
    const index = items.findIndex((el) => el === document.activeElement);
    if (index === -1) return;
    let next: number;
    if (e.key === 'ArrowDown') next = Math.min(items.length - 1, index + 1);
    else if (e.key === 'ArrowUp') next = Math.max(0, index - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    else return; // Entrée et Espace : clic natif du bouton → onSelect.
    e.preventDefault();
    items[next]?.focus();
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/components/poste/ && npm run typecheck`
Expected: PASS (4 + 7 tests), typecheck sans erreur.

- [ ] **Step 7: Run the task gate**

Run: `npx vitest run && npm run lint && npm run build`
Expected: tout vert.

- [ ] **Step 8: Commit**

```bash
git add src/components/poste/StatusBar.ts src/components/poste/ThemeBar.ts src/components/poste/WorkList.ts src/components/poste/StatusBar.test.ts src/components/poste/WorkList.test.ts
git commit -m "feat: bandeau d'état, barre de thèmes et liste « À traiter » (clavier, focus conservé)"
```

---

### Task 10: Colonne fiche et contrôleur du poste de situation

**Files:**
- Create: `src/components/poste/FichePanel.ts`, `src/components/poste/PosteSituation.ts`
- Test: `src/components/poste/FichePanel.test.ts`, `src/components/poste/PosteSituation.test.ts`

**Interfaces:**
- Consumes : tâches 2, 3, 7, 8, 9 ; `fetchEventDetail` (`news-events.ts`) ; `unavailableEventsState`, `EventDetailState` ; `trendText` ; `VisitBaseline` ; `BriefSourceSituation`.
- Produces : `class FichePanel { render(model, lang, closable); getBody(); focusHeading(); focusClose(); setOnSelect; setOnAction; setOnWhyToggle; setOnClose }` ; `type PosteLayout` ; `type PosteTab` ; `layoutFor(width)` ; `interface PosteData { snapshot: FranceFicheSnapshot; alerts; ecowatt; meteo; floods; markets: MarketData[]; commodities: CommodityData[]; sources; score; ready: boolean; lang; now }` ; `interface PosteCallbacks { onThemeChange; onFlyTo; onActivateLayers; onOpenDossier; onOpenReport; onShowFrance; onFicheRendered }` ; `interface PosteRoots { app; status; themes; list; fiche; tabs }` ; `class PosteSituation { update(data); setEvents(state | null); setBrief(brief, freshness, ids); setBriefPending(); setResolved(items); setBaseline(b); currentLevels(); setTheme(theme, { silent? }); select(key | null); close(); setTab(tab) }`.

- [ ] **Step 1: Write the failing tests**

Créer `src/components/poste/FichePanel.test.ts` :

```ts
// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { FichePanel } from './FichePanel.ts';
import type { FicheModel } from '../fiche/parts.ts';

function model(over: Partial<FicheModel> = {}): FicheModel {
  return {
    key: 'france', kind: 'Pays', name: 'France', level: 'rouge', driver: 'tirée par l’énergie', freshness: '',
    essentiel: ['BLUF.'], changesMeta: '', changes: [], sections: [], figures: [], watch: [],
    sourcesTitle: 'Preuves et sources', sources: [{ label: 'E42 · Explosion', href: null, select: 'event:42' }],
    why: '<p>Indice</p>', whyOpen: false, actions: [{ id: 'report', label: 'Note de situation' }], ...over,
  };
}

function mount(): { root: HTMLElement; panel: FichePanel } {
  const root = document.createElement('aside');
  document.body.appendChild(root);
  return { root, panel: new FichePanel(root) };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('FichePanel', () => {
  it('remonte sélection, action, volet et fermeture', () => {
    const { root, panel } = mount();
    const onSelect = vi.fn();
    const onAction = vi.fn();
    const onWhy = vi.fn();
    const onClose = vi.fn();
    panel.setOnSelect(onSelect);
    panel.setOnAction(onAction);
    panel.setOnWhyToggle(onWhy);
    panel.setOnClose(onClose);
    panel.render(model(), 'fr', true);
    root.querySelector<HTMLElement>('[data-select="event:42"]')?.click();
    root.querySelector<HTMLElement>('[data-action="report"]')?.click();
    // Attribut plutôt que propriété `open` : le test ne dépend pas de l'implémentation de <details>.
    const details = root.querySelector('details');
    details?.setAttribute('open', '');
    details?.dispatchEvent(new Event('toggle'));
    root.querySelector<HTMLButtonElement>('.fiche-close')?.click();
    expect(onSelect).toHaveBeenCalledWith('event:42');
    expect(onAction).toHaveBeenCalledWith('report', 'france');
    expect(onWhy).toHaveBeenCalledWith('france', true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('bouton de fermeture seulement pour une sélection ; aucune réécriture si rien ne change', () => {
    const { root, panel } = mount();
    panel.render(model(), 'fr', false);
    expect(root.querySelector<HTMLButtonElement>('.fiche-close')?.hidden).toBe(true);
    const name = root.querySelector('.fiche-name');
    panel.render(model(), 'fr', false);
    expect(root.querySelector('.fiche-name')).toBe(name);
  });

  it('le focus sur une preuve survit à une reconstruction de la même fiche', () => {
    const { root, panel } = mount();
    panel.render(model(), 'fr', false);
    root.querySelector<HTMLElement>('[data-select="event:42"]')?.focus();
    panel.render(model({ essentiel: ['Autre phrase.'] }), 'fr', false);
    expect(document.activeElement instanceof HTMLElement ? document.activeElement.dataset.select : undefined).toBe('event:42');
  });
});
```

Créer `src/components/poste/PosteSituation.test.ts` :

```ts
// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from 'vitest';

vi.mock('../../services/news-events.ts', () => ({
  fetchEventDetail: vi.fn(async () => null),
}));

import { fetchEventDetail } from '../../services/news-events.ts';
import { PosteSituation, layoutFor, type PosteCallbacks, type PosteData, type PosteRoots } from './PosteSituation.ts';
import type {
  DetectedSituation,
  FranceCountrySignals,
  FranceScoreBreakdown,
  IntelEventsState,
  NewsEvent,
  StructuredBrief,
} from '../../types/index.ts';

const NOW = Date.parse('2026-09-24T08:00:00Z');

function breakdown(): FranceScoreBreakdown {
  return {
    score: 43, baseline: 95,
    pillars: [
      { key: 'continuity', value: 61, deduction: 18.9, components: [] },
      { key: 'security', value: 57, deduction: 14.7, components: [] },
      { key: 'signal', value: 28, deduction: 3.4, components: [] },
      { key: 'defense', value: 65, deduction: 8.8, components: [] },
    ],
    shockValue: 55, shockExtra: 1.3, situationCap: 55,
  };
}

function signals(): FranceCountrySignals {
  return {
    criticalNews: 0, highNews: 0, topNewsCount: 0, meteoAlerts: 0, floodAlerts: 0, fireDetections: 0,
    railDisruptions: 0, railSevere: 0, roadIncidents: 0, powerOutages: 0, telecomOutages: 0,
    cyberAlerts: 0, cyberCritical: 0, militaryFlights: 0, maritimeTrafficFrance: 0,
    defenseAlerts: 0, defenseHigh: 0, jammingSignals: 0, marketStress: 0,
  };
}

function situation(over: Partial<DetectedSituation> = {}): DetectedSituation {
  return {
    id: 'energy-stress', type: 'ENERGY_STRESS', severity: 'high', confidence: 0.8, title: 'Tension énergétique nationale',
    summary: 'Signal Écowatt orange confirmé.', affectedZones: ['Bretagne'], drivers: [], recommendedActions: [],
    sourceRefs: ['Ecowatt RTE'], updatedAt: new Date(NOW), ...over,
  };
}

function event(): NewsEvent {
  return {
    id: 42, evidenceId: 'E42', title: 'Explosion dans une usine chimique', category: 'security', severity: 'critical',
    status: 'active', firstSeen: '2026-09-24T07:30:00Z', lastSeen: '2026-09-24T07:50:00Z', articleCount: 3,
    sourceCount: 3, independentCount: 3, sourceNames: [], lat: 49.4, lon: 1.1,
  };
}

function eventsState(): IntelEventsState {
  return { events: [event()], digest: [], totals: {}, anchor: { since: NOW - 3_600_000, kind: 'last-visit' }, fetchedAt: NOW, unavailable: false };
}

const BRIEF: StructuredBrief = {
  bluf: 'France en vigilance rouge.',
  judgments: [{ priority: 1, text: 'Tension durable.', confidence: 'high', sources: [], evidence: ['E42'], unsupported: false }],
  watch: [],
  origin: 'deterministic',
};

function data(over: Partial<PosteData> = {}): PosteData {
  return {
    snapshot: {
      score: 43, scoreBreakdown: breakdown(), situations: [situation()], signals: signals(), meteo: [], energy: null,
      timeline: { days: [], lanes: [] },
    },
    alerts: [], ecowatt: null, meteo: [], floods: [], markets: [], commodities: [],
    sources: [{ name: 'Écowatt RTE', lastUpdate: null, status: 'ok' }],
    score: { delta24h: -4, pillarDeltas: null, series: [] },
    ready: true, lang: 'fr', now: NOW, ...over,
  };
}

function setup(width = 1440) {
  const app = document.createElement('div');
  const make = (): HTMLElement => {
    const el = document.createElement('div');
    app.appendChild(el);
    return el;
  };
  const roots: PosteRoots = { app, status: make(), themes: make(), list: make(), fiche: make(), tabs: make() };
  document.body.appendChild(app);
  const cb = {
    onThemeChange: vi.fn(), onFlyTo: vi.fn(), onActivateLayers: vi.fn(), onOpenDossier: vi.fn(() => true),
    onOpenReport: vi.fn(), onShowFrance: vi.fn(), onFicheRendered: vi.fn(),
  } satisfies PosteCallbacks;
  const poste = new PosteSituation(roots, cb, { viewportWidth: () => width });
  poste.setEvents(eventsState());
  poste.update(data());
  return { roots, cb, poste };
}

const ficheKey = (roots: PosteRoots): string | undefined => roots.fiche.querySelector<HTMLElement>('[data-fiche]')?.dataset.fiche;
const activeKey = (): string | undefined => (document.activeElement instanceof HTMLElement ? document.activeElement.dataset.key : undefined);

afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe('layoutFor (spec §9)', () => {
  it('mobile sous 700 px, tablette jusqu’à 1 100 px, ordinateur au-delà', () => {
    expect(layoutFor(699)).toBe('mobile');
    expect(layoutFor(700)).toBe('tablet');
    expect(layoutFor(1100)).toBe('tablet');
    expect(layoutFor(1101)).toBe('desktop');
  });
});

describe('PosteSituation', () => {
  it('rendu initial : niveau national, liste, fiche France par défaut', () => {
    const { roots } = setup();
    expect(roots.status.textContent).toContain('Rouge');
    expect(roots.list.textContent).toContain('À traiter · Vue générale · 2');
    expect(ficheKey(roots)).toBe('france');
    expect(roots.app.dataset.v2Fiche).toBe('default');
  });

  it('un clic ouvre la fiche de la ligne ; Échap la referme et rend le focus à la ligne (§9)', () => {
    const { roots } = setup();
    const row = [...roots.list.querySelectorAll<HTMLButtonElement>('.wl-item')].find((b) => b.dataset.key === 'situation:energy-stress');
    row?.focus();
    row?.click();
    expect(ficheKey(roots)).toBe('situation:energy-stress');
    expect(roots.app.dataset.v2Fiche).toBe('open');
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(ficheKey(roots)).toBe('france');
    expect(activeKey()).toBe('situation:energy-stress');
  });

  it('un thème filtre la liste, affiche sa fiche et demande sa vue de carte (A5)', () => {
    const { roots, cb } = setup();
    roots.themes.querySelector<HTMLButtonElement>('[data-theme="energy"]')?.click();
    expect(cb.onThemeChange).toHaveBeenCalledWith('energy');
    expect(roots.list.textContent).toContain('À traiter · Énergie · 1');
    expect(ficheKey(roots)).toBe('theme:energy');
    expect(roots.list.querySelector('.wl-guard')?.textContent).toContain('Hors de ce thème : 1 rouge');
  });

  it('élément disparu : fiche par défaut, sélection effacée, focus sur le titre de la fiche (revue)', () => {
    const { roots, poste } = setup();
    poste.select('situation:energy-stress');
    roots.fiche.querySelector<HTMLButtonElement>('.fiche-close')?.focus();
    poste.update(data({ snapshot: { ...data().snapshot, situations: [] } }));
    expect(ficheKey(roots)).toBe('france');
    expect(roots.app.dataset.v2Fiche).toBe('default');
    expect(document.activeElement?.classList.contains('fiche-name')).toBe(true);
  });

  it('le volet « Pourquoi ce niveau ? » ouvert le reste après vingt mises à jour', () => {
    const { roots, poste } = setup();
    const details = roots.fiche.querySelector('details.fiche-why');
    expect(details).not.toBeNull();
    details?.setAttribute('open', '');
    details?.dispatchEvent(new Event('toggle'));
    for (let i = 1; i <= 20; i += 1) {
      poste.update(data({ now: NOW + i * 60_000, score: { delta24h: -i, pillarDeltas: null, series: [] } }));
    }
    expect(roots.fiche.querySelector('details.fiche-why')?.hasAttribute('open')).toBe(true);
  });

  it('une preuve E42 ouvre la fiche événement et ne charge ses articles qu’une fois', async () => {
    const { roots, poste } = setup();
    poste.setBrief(BRIEF, 'fresh', ['energy-stress']);
    roots.fiche.querySelector<HTMLButtonElement>('.fiche-judgment [data-select="event:42"]')?.click();
    expect(ficheKey(roots)).toBe('event:42');
    await vi.waitFor(() => expect(roots.fiche.textContent).toContain('Journal indisponible pour le moment.'));
    poste.update(data({ now: NOW + 60_000 }));
    expect(vi.mocked(fetchEventDetail)).toHaveBeenCalledTimes(1);
  });

  it('mobile : onglets ; une sélection ouvre la fiche en volet ; l’onglet « France » montre la fiche du pays', () => {
    const { roots, poste } = setup(390);
    expect(roots.tabs.textContent).toContain('À traiter');
    expect(roots.app.dataset.v2Tab).toBe('list');
    poste.select('situation:energy-stress');
    expect(roots.app.dataset.v2Fiche).toBe('open');
    roots.tabs.querySelector<HTMLButtonElement>('[data-tab="map"]')?.click();
    expect(roots.app.dataset.v2Tab).toBe('map');
    roots.tabs.querySelector<HTMLButtonElement>('[data-tab="fiche"]')?.click();
    expect(roots.app.dataset.v2Tab).toBe('fiche');
    expect(ficheKey(roots)).toBe('france');
  });

  it('ligne de base : les niveaux affichés, sans les événements', () => {
    const { poste } = setup();
    expect(poste.currentLevels()).toEqual({ 'situation:energy-stress': 'orange' });
  });

  it('avant les couches critiques : aucun niveau affiché, jamais un vert par défaut (revue)', () => {
    const { roots, poste } = setup();
    poste.update(data({ ready: false, snapshot: { ...data().snapshot, score: 95, situations: [] } }));
    expect(roots.status.textContent).toContain('Calcul du niveau national…');
    expect(roots.themes.querySelector('.fm-vig')).toBeNull();
    expect(roots.fiche.querySelector('.fiche-head .fm-vig')).toBeNull();
    expect(roots.fiche.textContent).toContain('niveau en cours de calcul');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/poste/FichePanel.test.ts src/components/poste/PosteSituation.test.ts`
Expected: FAIL, `Cannot find module './FichePanel.ts'` et `'./PosteSituation.ts'`.

- [ ] **Step 3: Écrire la colonne fiche**

Créer `src/components/poste/FichePanel.ts` :

```ts
// src/components/poste/FichePanel.ts — colonne de droite de la disposition A1 (spec §6) : affiche le
// modèle rendu par components/fiche/*. Délégation d'événements (le contenu est reconstruit à chaque
// donnée) ; le focus clavier et la position de lecture survivent aux reconstructions ; l'état des
// volets est remonté au contrôleur, qui le garde hors du DOM.

import { renderFiche, type FicheModel, type Lang } from '../fiche/parts.ts';

function findByData(root: ParentNode, attr: 'select' | 'action', value: string): HTMLElement | null {
  for (const el of root.querySelectorAll<HTMLElement>(`[data-${attr}]`)) {
    if (el.dataset[attr] === value) return el;
  }
  return null;
}

export class FichePanel {
  private readonly body: HTMLElement;
  private readonly closeButton: HTMLButtonElement;
  private lastHtml = '';
  private currentKey: string | null = null;
  private onSelect: ((key: string) => void) | null = null;
  private onAction: ((action: string, ficheKey: string) => void) | null = null;
  private onWhyToggle: ((ficheKey: string, open: boolean) => void) | null = null;
  private onClose: (() => void) | null = null;

  constructor(root: HTMLElement) {
    root.id = 'fm-v2-fiche';
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'Fiche');
    this.closeButton = document.createElement('button');
    this.closeButton.type = 'button';
    this.closeButton.className = 'fiche-close';
    this.closeButton.hidden = true;
    this.closeButton.textContent = '×';
    this.body = document.createElement('div');
    this.body.className = 'fiche-body';
    const chrome = document.createElement('div');
    chrome.className = 'fiche-chrome';
    chrome.appendChild(this.closeButton);
    root.replaceChildren(chrome, this.body);

    this.closeButton.addEventListener('click', () => this.onClose?.());
    this.body.addEventListener('click', (e) => this.handleClick(e));
    // `toggle` ne remonte pas : écoute en capture sur le conteneur. L'attribut `open` fait foi.
    this.body.addEventListener('toggle', (e) => {
      const target = e.target;
      if (target instanceof HTMLElement && target.matches('details.fiche-why')) {
        this.onWhyToggle?.(target.dataset.why ?? '', target.hasAttribute('open'));
      }
    }, true);
  }

  setOnSelect(handler: (key: string) => void): void {
    this.onSelect = handler;
  }

  setOnAction(handler: (action: string, ficheKey: string) => void): void {
    this.onAction = handler;
  }

  setOnWhyToggle(handler: (ficheKey: string, open: boolean) => void): void {
    this.onWhyToggle = handler;
  }

  setOnClose(handler: () => void): void {
    this.onClose = handler;
  }

  getBody(): HTMLElement {
    return this.body;
  }

  render(model: FicheModel, lang: Lang, closable: boolean): void {
    this.closeButton.hidden = !closable;
    this.closeButton.setAttribute('aria-label', lang === 'fr' ? 'Fermer la fiche' : 'Close the sheet');
    const html = renderFiche(model, lang);
    if (html === this.lastHtml) return;
    const sameFiche = this.currentKey === model.key;
    const restore = this.focusTarget();
    const scrollTop = this.body.scrollTop;
    this.body.innerHTML = html;
    this.lastHtml = html;
    this.currentKey = model.key;
    // Même fiche mise à jour : garder la position de lecture ; autre fiche : repartir du haut.
    this.body.scrollTop = sameFiche ? scrollTop : 0;
    restore?.()?.focus({ preventScroll: true });
  }

  focusHeading(): void {
    this.body.querySelector<HTMLElement>('.fiche-name')?.focus({ preventScroll: true });
  }

  focusClose(): void {
    if (!this.closeButton.hidden) this.closeButton.focus({ preventScroll: true });
  }

  private focusTarget(): (() => HTMLElement | null) | null {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || !this.body.contains(el)) return null;
    if (el.matches('.fiche-why > summary')) return () => this.body.querySelector<HTMLElement>('.fiche-why > summary');
    const select = el.dataset.select;
    if (select !== undefined) return () => findByData(this.body, 'select', select);
    const action = el.dataset.action;
    if (action !== undefined) return () => findByData(this.body, 'action', action);
    return () => this.body.querySelector<HTMLElement>('.fiche-name');
  }

  private handleClick(e: MouseEvent): void {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;
    const select = target.closest<HTMLElement>('[data-select]')?.dataset.select;
    if (select !== undefined) {
      e.preventDefault();
      this.onSelect?.(select);
      return;
    }
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action !== undefined && this.currentKey !== null) this.onAction?.(action, this.currentKey);
  }
}
```

- [ ] **Step 4: Écrire le contrôleur**

Créer `src/components/poste/PosteSituation.ts` :

```ts
// src/components/poste/PosteSituation.ts — contrôleur de la disposition A1 (refonte UI, étape 2) :
// assemble bandeau d'état, barre de thèmes, liste « À traiter », fiche et onglets mobiles à partir
// des données en cache que lui passe App.ts. Tout l'état d'interface (thème, sélection, volets
// ouverts, onglet, liste dépliée) vit ici, jamais dans le DOM : les composants sont reconstruits à
// chaque arrivée de données (une vingtaine de fois au démarrage).

import type {
  CommodityData,
  DataSourceStatus,
  DetectedSituation,
  EcowattResponse,
  FloodSegment,
  IntelEventsState,
  MarketData,
  MeteoAlert,
  StructuredBrief,
} from '../../types/index.ts';
import type { StabilityPillarValues } from '../../utils/stability-history.ts';
import type { BriefSourceSituation } from '../../services/situation-brief.ts';
import type { VisitBaseline } from '../../services/intel-last-visit.ts';
import { scoreLevel } from '../../services/vigilance.ts';
import { drivenByText, themeLabel, type ThemeId } from '../../services/themes.ts';
import {
  buildWorkQueue,
  drivingThemes,
  levelsForBaseline,
  marketLines,
  viewWorkQueue,
  visitCounts,
  type WorkQueue,
} from '../../services/work-queue.ts';
import { fetchEventDetail } from '../../services/news-events.ts';
import { escapeHtml, unavailableEventsState, type EventDetailState } from '../france-intel-events.ts';
import { trendText } from '../france-intel-score.ts';
import { buildFranceFiche, type FranceFicheSnapshot } from '../fiche/france.ts';
import { buildEventFiche, buildMarketFiche, buildOfficialFiche, buildSituationFiche, buildThemeFiche } from '../fiche/items.ts';
import type { FicheModel, Lang } from '../fiche/parts.ts';
import { StatusBar, freshnessCounts, freshnessText } from './StatusBar.ts';
import { ThemeBar } from './ThemeBar.ts';
import { WorkList } from './WorkList.ts';
import { FichePanel } from './FichePanel.ts';

export type PosteLayout = 'mobile' | 'tablet' | 'desktop';
export type PosteTab = 'list' | 'map' | 'fiche';

/** Disposition selon la largeur (spec §9) : moins de 700 px mobile, 700 à 1 100 px tablette. */
export function layoutFor(width: number): PosteLayout {
  if (width < 700) return 'mobile';
  if (width <= 1100) return 'tablet';
  return 'desktop';
}

/** Chauffe du démarrage : ce qui apparaît pendant ces 2 min vient des données qui arrivent, pas d'un changement. */
const WARMUP_MS = 2 * 60 * 1000;
const MAX_EVENT_DETAILS = 50;

export interface PosteData {
  snapshot: FranceFicheSnapshot;
  alerts: readonly DetectedSituation[];
  ecowatt: EcowattResponse | null;
  meteo: readonly MeteoAlert[];
  floods: readonly FloodSegment[];
  markets: readonly MarketData[];
  commodities: readonly CommodityData[];
  sources: readonly DataSourceStatus[];
  score: { delta24h: number | null; pillarDeltas: StabilityPillarValues | null; series: number[] };
  /**
   * Couches critiques chargées. Avant, l'indice national est calculé sur des données absentes :
   * aucun niveau national ni de thème n'est affiché (jamais un « vert » qui rassurerait à tort).
   */
  ready: boolean;
  lang: Lang;
  now: number;
}

export interface PosteCallbacks {
  /** Thème choisi (barre de thèmes, garde, action de la fiche) : App applique la vue de couches (A5). */
  onThemeChange: (theme: ThemeId) => void;
  onFlyTo: (lon: number, lat: number, zoom: number) => void;
  onActivateLayers: (keys: readonly string[]) => void;
  /** Dossier dédié d'une alerte ou d'une situation (grand feu, vol militaire) ; false s'il n'existe pas. */
  onOpenDossier: (situation: DetectedSituation) => boolean;
  onOpenReport: () => void;
  onShowFrance: () => void;
  /** Après chaque rendu de fiche : App y rattache le baromètre des infrastructures (§14). */
  onFicheRendered: (body: HTMLElement) => void;
}

export interface PosteRoots {
  /** Racine #app : porte data-v2-tab et data-v2-fiche pour la mise en page CSS. */
  app: HTMLElement;
  status: HTMLElement;
  themes: HTMLElement;
  list: HTMLElement;
  fiche: HTMLElement;
  tabs: HTMLElement;
}

export interface PosteOptions {
  /** Largeur de la fenêtre, injectable pour les tests. */
  viewportWidth?: () => number;
}

function durationLabel(ms: number, lang: Lang): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} ${lang === 'fr' ? 'j' : 'd'}`;
}

export class PosteSituation {
  private readonly roots: PosteRoots;
  private readonly callbacks: PosteCallbacks;
  private readonly viewportWidth: () => number;
  private readonly statusBar: StatusBar;
  private readonly themeBar: ThemeBar;
  private readonly workList: WorkList;
  private readonly fichePanel: FichePanel;

  // ── État d'interface (jamais lu dans le DOM) ──
  private theme: ThemeId = 'general';
  /** Clé sélectionnée (« event:42 », « situation:… », « france »…) ; null = fiche par défaut. */
  private selection: string | null = null;
  private showAll = false;
  private tab: PosteTab = 'list';
  private readonly whyOpen = new Set<string>();
  private lastTabsHtml = '';

  // ── Données ──
  private data: PosteData | null = null;
  private queue: WorkQueue | null = null;
  private events: IntelEventsState | null = null;
  private brief: { brief: StructuredBrief; freshness: 'fresh' | 'cached' } | null = null;
  private briefSituationIds: string[] = [];
  private resolved: BriefSourceSituation[] = [];
  private baseline: VisitBaseline | null = null;
  private warmupUntil: number | null = null;
  private readonly knownKeys = new Set<string>();
  private readonly firstSeen = new Map<string, number>();
  private readonly eventDetails = new Map<number, EventDetailState>();

  constructor(roots: PosteRoots, callbacks: PosteCallbacks, options: PosteOptions = {}) {
    this.roots = roots;
    this.callbacks = callbacks;
    this.viewportWidth = options.viewportWidth ?? ((): number => window.innerWidth);
    this.statusBar = new StatusBar(roots.status);
    this.themeBar = new ThemeBar(roots.themes);
    this.workList = new WorkList(roots.list);
    this.fichePanel = new FichePanel(roots.fiche);

    this.statusBar.setOnSelectFrance(() => this.select('france'));
    this.themeBar.setOnSelect((theme) => this.setTheme(theme));
    this.workList.setOnSelect((key) => this.select(key));
    this.workList.setOnShowAll((showAll) => {
      this.showAll = showAll;
      this.render();
    });
    this.workList.setOnGuard((theme) => this.setTheme(theme));
    this.fichePanel.setOnSelect((key) => this.select(key));
    this.fichePanel.setOnAction((action, ficheKey) => this.runAction(action, ficheKey));
    this.fichePanel.setOnWhyToggle((ficheKey, open) => {
      if (open) this.whyOpen.add(ficheKey);
      else this.whyOpen.delete(ficheKey);
    });
    this.fichePanel.setOnClose(() => this.close());

    // Échap referme la fiche (spec §9), que le focus soit dans la liste ou dans la fiche.
    const onEscape = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || this.selection === null) return;
      e.preventDefault();
      this.close();
    };
    roots.list.addEventListener('keydown', onEscape);
    roots.fiche.addEventListener('keydown', onEscape);
    roots.tabs.addEventListener('click', (e) => {
      const tab = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-tab]')?.dataset.tab : undefined;
      if (tab === 'list' || tab === 'map' || tab === 'fiche') this.setTab(tab);
    });
  }

  update(data: PosteData): void {
    this.data = data;
    this.rebuild();
  }

  /** null : modules d'événements non chargés → « indisponible », jamais un chargement sans fin. */
  setEvents(state: IntelEventsState | null): void {
    this.events = state ?? unavailableEventsState(Date.now());
    this.rebuild();
  }

  setBrief(brief: StructuredBrief, freshness: 'fresh' | 'cached', situationIds: readonly string[]): void {
    this.brief = { brief, freshness };
    this.briefSituationIds = [...situationIds];
    this.render();
  }

  setBriefPending(): void {
    this.brief = null;
    this.render();
  }

  setResolved(items: readonly BriefSourceSituation[]): void {
    this.resolved = [...items];
    this.render();
  }

  setBaseline(baseline: VisitBaseline | null): void {
    this.baseline = baseline;
    this.rebuild();
  }

  /** Niveaux affichés, enregistrés comme ligne de base de la prochaine visite. */
  currentLevels(): VisitBaseline {
    return this.queue ? levelsForBaseline(this.queue) : {};
  }

  setTheme(theme: ThemeId, opts: { silent?: boolean } = {}): void {
    if (theme === this.theme) return;
    this.theme = theme;
    this.showAll = false;
    this.selection = null; // un thème affiche sa propre fiche
    if (!opts.silent) this.callbacks.onThemeChange(theme);
    this.render();
  }

  select(key: string | null): void {
    this.selection = key;
    this.render();
    // Tablette et mobile : la fiche s'ouvre en volet, le focus la suit.
    if (key !== null && this.layout() !== 'desktop') this.fichePanel.focusClose();
  }

  close(): void {
    const key = this.selection;
    if (key === null) return;
    this.selection = null;
    this.render();
    if (!this.workList.focusRow(key)) this.fichePanel.focusHeading();
  }

  setTab(tab: PosteTab): void {
    this.tab = tab;
    if (tab === 'fiche') this.selection = null; // l'onglet « France » montre la fiche du pays ou du thème
    this.render();
  }

  private layout(): PosteLayout {
    return layoutFor(this.viewportWidth());
  }

  private rebuild(): void {
    const data = this.data;
    if (!data) return;
    const queue = buildWorkQueue({
      situations: data.snapshot.situations,
      alerts: data.alerts,
      events: this.events,
      ecowatt: data.ecowatt,
      meteo: data.meteo,
      floods: data.floods,
      markets: marketLines(data.markets, data.commodities),
      baseline: this.baseline,
      firstSeen: this.firstSeen,
      lang: data.lang,
    });
    this.trackAppearances(queue, data.now);
    this.queue = queue;
    this.render();
  }

  /** Heure d'apparition des éléments nouveaux pendant la session, après la chauffe du démarrage. */
  private trackAppearances(queue: WorkQueue, now: number): void {
    this.warmupUntil ??= now + WARMUP_MS;
    const warming = now < this.warmupUntil;
    for (const item of queue.items) {
      if (this.knownKeys.has(item.key)) continue;
      this.knownKeys.add(item.key);
      if (!warming) this.firstSeen.set(item.key, now);
    }
  }

  private render(): void {
    const data = this.data;
    const queue = this.queue;
    if (!data || !queue) return;
    const { lang, now } = data;
    const national = data.ready ? scoreLevel(data.snapshot.score) : null;
    const drivers = national ? drivingThemes(queue.themeLevels, national) : [];

    // La fiche d'abord : un élément sélectionné qui a disparu ramène à la fiche par défaut, et
    // la liste doit alors être rendue sans sélection.
    const active = document.activeElement;
    const ficheHadFocus = active instanceof HTMLElement && this.roots.fiche.contains(active);
    let model = this.selection === null ? null : this.ficheFor(this.selection, data, queue, drivers);
    const vanished = this.selection !== null && model === null;
    if (vanished) this.selection = null;
    model ??= this.defaultFiche(data, queue, drivers);
    if (!data.ready && (model.key === 'france' || model.key.startsWith('theme:'))) {
      model = { ...model, level: null, driver: lang === 'fr' ? 'niveau en cours de calcul' : 'level being computed' };
    }
    this.fichePanel.render(model, lang, this.selection !== null);
    this.callbacks.onFicheRendered(this.fichePanel.getBody());
    if (vanished && ficheHadFocus) this.fichePanel.focusHeading();

    const history = this.events && !(this.events.unavailable && this.events.events.length === 0) ? this.events : null;
    this.statusBar.update({
      level: national,
      drivenBy: national ? drivenByText(drivers, lang) : '',
      trend: national ? trendText(data.score.delta24h, lang) : '',
      visit: history
        ? { firstVisit: history.anchor.kind === 'default', since: durationLabel(now - history.anchor.since, lang), ...visitCounts(queue) }
        : null,
      freshness: freshnessCounts(data.sources),
      lang,
    });
    this.themeBar.update({ selected: this.theme, levels: national ? { general: national, ...queue.themeLevels } : null, lang });
    this.workList.update({ view: viewWorkQueue(queue, this.theme, this.showAll), selectedKey: this.selection, ready: data.ready, lang, now });
    this.renderTabs(lang);
    this.roots.app.dataset.v2Tab = this.tab;
    this.roots.app.dataset.v2Fiche = this.selection === null ? 'default' : 'open';
  }

  private freshness(data: PosteData): string {
    return freshnessText(freshnessCounts(data.sources), data.lang);
  }

  private franceFiche(data: PosteData, queue: WorkQueue, drivers: readonly ThemeId[]): FicheModel {
    return buildFranceFiche({
      snapshot: data.snapshot,
      queue,
      drivers,
      brief: this.brief,
      briefSituationIds: this.briefSituationIds,
      events: this.events,
      resolved: this.resolved,
      changeTimes: this.firstSeen,
      score: data.score,
      freshness: this.freshness(data),
      whyOpen: this.whyOpen.has('france'),
      lang: data.lang,
      now: data.now,
    });
  }

  /** « Vue générale » : la France ; un thème : sa fiche (spec §6.1, §7.3). */
  private defaultFiche(data: PosteData, queue: WorkQueue, drivers: readonly ThemeId[]): FicheModel {
    const theme = this.theme;
    if (theme === 'general') return this.franceFiche(data, queue, drivers);
    return buildThemeFiche({
      theme,
      queue,
      snapshot: data.snapshot,
      events: this.events,
      changeTimes: this.firstSeen,
      freshness: this.freshness(data),
      whyOpen: this.whyOpen.has(`theme:${theme}`),
      lang: data.lang,
    });
  }

  private ficheFor(key: string, data: PosteData, queue: WorkQueue, drivers: readonly ThemeId[]): FicheModel | null {
    const { lang, now } = data;
    const whyOpen = this.whyOpen.has(key);
    if (key === 'france') return this.franceFiche(data, queue, drivers);
    const item = queue.items.find((i) => i.key === key);
    if (key.startsWith('event:')) {
      const id = Number(key.slice('event:'.length));
      // Une preuve peut citer un événement hors de la liste (non corroboré) : il reste consultable.
      const event = item?.ref.kind === 'event' ? item.ref.event : this.events?.events.find((e) => e.id === id);
      if (!event) return null;
      this.ensureEventDetail(event.id);
      return buildEventFiche({ event, detail: this.eventDetails.get(event.id), whyOpen, lang, now });
    }
    if (key.startsWith('situation:')) {
      const id = key.slice('situation:'.length);
      const situation = item?.ref.kind === 'situation' ? item.ref.situation : data.snapshot.situations.find((s) => s.id === id);
      if (!situation) return null;
      return buildSituationFiche({
        situation, kind: 'situation', badge: item?.badge ?? null, changeAt: this.firstSeen.get(key) ?? null,
        hasDossier: situation.type === 'WILDFIRE_ESCALATION', whyOpen, lang,
      });
    }
    if (item?.ref.kind === 'alert') {
      const situation = item.ref.situation;
      return buildSituationFiche({
        situation, kind: 'alert', badge: item.badge, changeAt: this.firstSeen.get(key) ?? null,
        hasDossier: situation.type === 'MILITARY_SURGE_ALERT' || situation.type === 'WILDFIRE_ESCALATION', whyOpen, lang,
      });
    }
    if (item?.ref.kind === 'official') return buildOfficialFiche(item.ref.group, { freshness: this.freshness(data), whyOpen, lang });
    if (item?.ref.kind === 'market') return buildMarketFiche(item.ref.line, { whyOpen, lang });
    return null;
  }

  private ensureEventDetail(id: number): void {
    if (this.eventDetails.has(id)) return;
    if (this.eventDetails.size >= MAX_EVENT_DETAILS) {
      const oldest = this.eventDetails.keys().next();
      if (!oldest.done) this.eventDetails.delete(oldest.value);
    }
    this.eventDetails.set(id, 'loading');
    void fetchEventDetail(id).then((detail) => {
      this.eventDetails.set(id, detail ?? 'error');
      this.render();
    });
  }

  private runAction(action: string, ficheKey: string): void {
    const data = this.data;
    if (!data) return;
    const toMap = (): void => {
      if (this.layout() === 'mobile') this.setTab('map');
    };
    if (action === 'report') {
      this.callbacks.onOpenReport();
      return;
    }
    if (action === 'show-france') {
      this.callbacks.onShowFrance();
      toMap();
      return;
    }
    if (action === 'show-theme') {
      this.callbacks.onThemeChange(this.theme);
      toMap();
      return;
    }
    const item = this.queue?.items.find((i) => i.key === ficheKey);
    if (action === 'show-layer' && item?.ref.kind === 'official') {
      this.callbacks.onActivateLayers(item.ref.group.source === 'ecowatt' ? ['powerGrid'] : ['environmental']);
      toMap();
      return;
    }
    const situation = item?.ref.kind === 'situation' || item?.ref.kind === 'alert'
      ? item.ref.situation
      : data.snapshot.situations.find((s) => `situation:${s.id}` === ficheKey);
    if (action === 'dossier' && situation) {
      this.callbacks.onOpenDossier(situation);
      return;
    }
    if (action !== 'map') return;
    if (situation) {
      if (situation.activateLayers && situation.activateLayers.length > 0) this.callbacks.onActivateLayers(situation.activateLayers);
      if (situation.lon != null && situation.lat != null) this.callbacks.onFlyTo(situation.lon, situation.lat, 10);
    } else if (ficheKey.startsWith('event:')) {
      const id = Number(ficheKey.slice('event:'.length));
      const event = this.events?.events.find((e) => e.id === id);
      if (event && event.lon !== null && event.lat !== null) this.callbacks.onFlyTo(event.lon, event.lat, 10);
    }
    toMap();
  }

  private renderTabs(lang: Lang): void {
    const ficheLabel = this.theme === 'general' ? 'France' : themeLabel(this.theme, lang);
    const tabs: Array<[PosteTab, string]> = [
      ['list', lang === 'fr' ? 'À traiter' : 'To handle'],
      ['map', lang === 'fr' ? 'Carte' : 'Map'],
      ['fiche', ficheLabel],
    ];
    const html = `<div class="v2-tabs" role="tablist">${tabs.map(([id, label]) => {
      const on = this.tab === id;
      return `<button type="button" role="tab" class="v2-tab${on ? ' is-on' : ''}" data-tab="${id}" aria-selected="${on ? 'true' : 'false'}">${escapeHtml(label)}</button>`;
    }).join('')}</div>`;
    if (html === this.lastTabsHtml) return;
    const active = document.activeElement;
    const focused = active instanceof HTMLElement && this.roots.tabs.contains(active) ? active.dataset.tab : undefined;
    this.roots.tabs.innerHTML = html;
    this.lastTabsHtml = html;
    if (focused) this.roots.tabs.querySelector<HTMLElement>(`[data-tab="${focused}"]`)?.focus({ preventScroll: true });
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/components/poste/ && npm run typecheck`
Expected: PASS (4 + 7 + 3 + 9 tests), typecheck sans erreur.

- [ ] **Step 6: Run the task gate**

Run: `npx vitest run && npm run lint && npm run build`
Expected: tout vert. Le contrôleur n'est encore importé par personne : le build n'en change pas.

- [ ] **Step 7: Commit**

```bash
git add src/components/poste/FichePanel.ts src/components/poste/PosteSituation.ts src/components/poste/FichePanel.test.ts src/components/poste/PosteSituation.test.ts
git commit -m "feat: colonne fiche et contrôleur du poste de situation (sélection, thèmes, volets, onglets)"
```

---

### Task 11: Intégration dans `App.ts` derrière `?ui=v2` et mise en page (ordinateur, tablette, mobile)

**Files:**
- Modify: `src/App.ts`
- Modify: `src/components/StatusPanel.ts`
- Create: `src/components/StatusPanel.test.ts`
- Modify: `src/styles/main.css`
- Create: `tests/css-ui-v2.test.ts`

**Interfaces:**
- Consumes : tâche 1 (`isUiV2`, `beginVisitBaseline`, `recordVisitBaseline`) ; tâche 10 (`PosteSituation`, `PosteData`, `PosteCallbacks`) ; `getDelta24h`, `getPillarDeltas24h`, `getSparklineSeries` ; `resolvedSituationsFromHistory`, `getHistory` ; `VIEW_PRESETS`.
- Produces : `StatusPanel.getSources(): readonly DataSourceStatus[]` ; dans `App` : `uiV2`, `poste`, `v2Roots`, `v2IntelStarted`, `v2EventsTimer`, `currentCommodityData`, `intelLang()`, `isIntelSurfaceVisible()`, `ensurePoste()`, `startV2Intel()`, `updatePoste()`, `deliverV2Events()`, `openAlertDossier()`, `activateLayersFromSituation()` ; alertes presse avec `category`.

- [ ] **Step 1: Write the failing tests**

Créer `src/components/StatusPanel.test.ts` :

```ts
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { StatusPanel } from './StatusPanel.ts';

describe('StatusPanel.getSources (voyant de fraîcheur de la v2)', () => {
  it('expose les sources suivies dans leur état courant', () => {
    const panel = new StatusPanel(document.createElement('div'));
    panel.updateSource('Écowatt RTE', { status: 'ok', lastUpdate: new Date(0) });
    panel.updateSource('Vigicrues', { status: 'error' });
    panel.updateSource('Écowatt RTE', { status: 'stale' });
    expect(panel.getSources().map((s) => [s.name, s.status])).toEqual([['Écowatt RTE', 'stale'], ['Vigicrues', 'error']]);
  });
});
```

Créer `tests/css-ui-v2.test.ts` :

```ts
// La disposition A1 (?ui=v2) ne doit rien changer à l'interface par défaut : les conteneurs v2 sont
// masqués hors de la v2, toute règle qui les affiche est préfixée par #app.ui-v2, et les trois
// largeurs de la spec §9 (ordinateur, tablette, mobile) sont couvertes.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8');

describe('styles de la disposition A1 (?ui=v2)', () => {
  it('masque les conteneurs v2 hors de la v2', () => {
    expect(css).toMatch(/(^|\n)\.fm-v2-bar, \.fm-v2-list, \.fm-v2-fiche, \.fm-v2-tabs \{ display: none; \}/);
  });

  it('préfixe par #app.ui-v2 toute règle qui affiche un conteneur v2', () => {
    const shows = [...css.matchAll(/([^{}]*\.fm-v2-(?:bar|list|fiche|tabs)[^{}]*)\{[^}]*display:\s*(?:flex|block)/g)].map((m) => m[1].trim());
    expect(shows.length).toBeGreaterThan(0);
    for (const selector of shows) expect(selector).toMatch(/#app\.ui-v2/);
  });

  it('couvre la tablette (fiche en volet par-dessus la carte) et le mobile (onglets)', () => {
    expect(css).toMatch(/@media \(min-width: 700px\) and \(max-width: 1100px\)\s*\{[^@]*#app\.ui-v2:not\(\[data-v2-fiche="open"\]\) \.fm-v2-fiche/);
    expect(css).toMatch(/@media \(max-width: 699px\)\s*\{[^@]*#app\.ui-v2\[data-v2-tab="map"\] \.map-area/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/StatusPanel.test.ts tests/css-ui-v2.test.ts`
Expected: FAIL, `panel.getSources is not a function` ; les trois tests CSS échouent (aucune règle `.fm-v2-*`).

- [ ] **Step 3: `StatusPanel.getSources`**

Dans `src/components/StatusPanel.ts`, remplacer :

```ts
    /** Update a single source by name */
    updateSource(name: string, update: Partial<DataSourceStatus>): void {
```

par :

```ts
    /** Sources suivies, lecture seule : voyant de fraîcheur du bandeau d'état v2 (« 33 sources sur 35 à jour »). */
    getSources(): readonly DataSourceStatus[] {
        return this.sources;
    }

    /** Update a single source by name */
    updateSource(name: string, update: Partial<DataSourceStatus>): void {
```

- [ ] **Step 4: Styles de la v2**

Ajouter à la fin de `src/styles/main.css` :

```css

/* ═══ Refonte UI étape 2 : disposition A1 derrière ?ui=v2 (spec §5, §9) ═══
   Toute la mise en page est préfixée par #app.ui-v2 : l'interface par défaut ne change pas.
   Ordinateur : liste, carte, fiche. Tablette (700 à 1 100 px) : liste et carte, fiche en volet.
   Mobile (moins de 700 px) : trois onglets en bas, fiche en volet remontable. */
.fm-v2-bar, .fm-v2-list, .fm-v2-fiche, .fm-v2-tabs { display: none; }

#app.ui-v2 .fm-v2-bar {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding: 8px 14px;
  flex-shrink: 0;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
}

.sb-line { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 14px; font-size: 13px; color: var(--text-primary); }
.sb-level { padding: 0; border: 0; background: none; cursor: pointer; }
.sb-level .fm-vig { font-size: 13px; padding: 1px 8px; }
.sb-level:focus-visible { outline: 2px solid var(--text-accent); outline-offset: 2px; border-radius: 4px; }
.sb-summary, .sb-loading { color: var(--text-secondary); }
.sb-fresh { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; font-size: 12px; color: var(--text-secondary); }
/* Voyant neutre : la couleur est réservée à la gravité (spec §2). */
.sb-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--text-muted); }

.tb-list { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; }
.tb-list::-webkit-scrollbar { display: none; }
.tb-theme {
  display: inline-flex; align-items: center; gap: 6px; flex: none;
  padding: 4px 10px; border: 1px solid var(--border-color); border-radius: 6px;
  background: transparent; color: var(--text-secondary); font: inherit; font-size: 12px; white-space: nowrap; cursor: pointer;
}
.tb-theme.is-on { color: var(--text-primary); border-color: var(--text-accent); background: var(--bg-surface); }
.tb-theme:focus-visible { outline: 2px solid var(--text-accent); outline-offset: 1px; }
.tb-level .fm-vig { font-size: 10px; padding: 0 5px; }

/* Ordinateur : trois colonnes, rien ne recouvre la carte. */
#app.ui-v2 .main-container { flex-direction: row; position: relative; }
#app.ui-v2 .map-area { min-width: 0; }
#app.ui-v2 .sidebar { width: 300px; height: auto; }
#app.ui-v2.sidebar-collapsed .sidebar { display: none; }
#app.ui-v2 .header-sidebar-toggle { display: inline-flex; width: auto; gap: 6px; padding: 0 10px; }
.header-sidebar-toggle__label { font-size: 12px; }
/* L'en-tête compte un élément de plus (bouton « Couches ») : il ne s'étire pas ; sur ordinateur,
   l'en-tête passe à quatre colonnes pour tenir sur une ligne ; sur mobile, il revient au flux
   (contrôlé à 390 px lors de la vérification du plan : sans ces règles, le titre chevauche l'état). */
#app.ui-v2 .header-sidebar-toggle { justify-self: start; }
@media (min-width: 1101px) {
  #app.ui-v2 .header { grid-template-columns: auto auto minmax(0, 1fr) auto; }
}
@media (max-width: 768px) {
  #app.ui-v2 .header { display: flex; flex-wrap: wrap; align-items: center; column-gap: 8px; }
  #app.ui-v2 .header-sidebar-toggle__label { display: none; }
  #app.ui-v2 .header-center { flex: 1 1 96px; width: auto; min-width: 0; }
  #app.ui-v2 .header-center .region-presets-list { min-width: 0; }
  #app.ui-v2 .region-preset-select { min-width: 0; width: 100%; }
}
#app.ui-v2 .fm-v2-list {
  display: flex; flex-direction: column; flex: 0 0 30%; min-width: 300px; max-width: 460px;
  overflow-y: auto; background: var(--bg-secondary); border-right: 1px solid var(--border-color);
}
#app.ui-v2 .fm-v2-fiche {
  display: flex; flex-direction: column; flex: 0 0 28%; min-width: 340px; max-width: 480px;
  overflow: hidden; background: var(--bg-primary); border-left: 1px solid var(--border-color);
}

/* Liste « À traiter » */
.wl-head { padding: 10px 12px 6px; }
.wl-title { margin: 0; font-size: 12.5px; font-weight: 700; color: var(--text-secondary); }
.wl-title:focus { outline: none; }
.wl-list { margin: 0; padding: 0; list-style: none; }
.wl-item {
  display: flex; gap: 8px; width: 100%; padding: 8px 12px; border: 0; border-top: 1px solid var(--border-color);
  background: transparent; color: var(--text-primary); font: inherit; text-align: left; cursor: pointer;
}
.wl-item:hover { background: var(--bg-surface-hover); }
.wl-item.is-selected { background: var(--bg-surface); }
.wl-item:focus-visible { outline: 2px solid var(--text-accent); outline-offset: -2px; }
.wl-bar { flex: none; align-self: stretch; width: 3px; border-radius: 2px; }
.wl-bar--vert { background: var(--sev-green); }
.wl-bar--jaune { background: var(--sev-yellow); }
.wl-bar--orange { background: var(--sev-orange); }
.wl-bar--rouge { background: var(--sev-red); }
.wl-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.wl-item-title { font-size: 13px; font-weight: 600; line-height: 1.35; }
.wl-meta { font-size: 11.5px; color: var(--text-secondary); }
/* Badge neutre : la couleur est réservée à la gravité (spec §2). */
.wl-badge { padding: 0 4px; border: 1px solid var(--text-secondary); border-radius: 3px; font-size: 10px; font-weight: 700; color: var(--text-primary); white-space: nowrap; }
.wl-note, .wl-empty { margin: 0; padding: 8px 12px; list-style: none; font-size: 12px; color: var(--text-secondary); }
.wl-more {
  align-self: flex-start; margin: 6px 12px; padding: 4px 8px; border: 1px solid var(--border-color); border-radius: 6px;
  background: transparent; color: var(--text-accent); font: inherit; font-size: 12px; cursor: pointer;
}
.wl-guard {
  position: sticky; bottom: 0; margin-top: auto; padding: 8px 12px; border: 0; border-top: 1px solid var(--border-color);
  background: var(--bg-surface); color: var(--text-primary); font: inherit; font-size: 12px; text-align: left; cursor: pointer;
}
.wl-more:focus-visible, .wl-guard:focus-visible { outline: 2px solid var(--text-accent); outline-offset: -2px; }

/* Fiche unique */
.fiche-chrome { display: flex; justify-content: flex-end; min-height: 8px; padding: 6px 8px 0; }
.fiche-close {
  width: 28px; height: 28px; border: 1px solid var(--border-color); border-radius: 6px;
  background: transparent; color: var(--text-secondary); font-size: 16px; cursor: pointer;
}
.fiche-close:focus-visible { outline: 2px solid var(--text-accent); outline-offset: 1px; }
.fiche-body { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 14px 20px; }
.fiche-kind { font-size: 11px; color: var(--text-secondary); }
.fiche-name { margin: 2px 0 6px; font-size: 16px; font-weight: 700; color: var(--text-primary); }
.fiche-name:focus { outline: none; }
.fiche-level { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; font-size: 12.5px; color: var(--text-secondary); }
.fiche-fresh { margin-top: 4px; font-size: 11px; color: var(--text-muted); }
.fiche-part { margin-top: 12px; }
.fiche-part-title { margin: 0 0 4px; font-size: 11.5px; font-weight: 700; color: var(--text-secondary); }
.fiche-part p { margin: 0 0 4px; font-size: 13px; line-height: 1.45; color: var(--text-primary); }
.fiche-list { display: flex; flex-direction: column; gap: 4px; margin: 0; padding: 0; list-style: none; font-size: 12.5px; color: var(--text-primary); }
.fiche-time { display: inline-block; min-width: 40px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
.fiche-link { padding: 0; border: 0; background: none; color: var(--text-accent); font: inherit; text-align: left; cursor: pointer; }
.fiche-figures-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin: 0; }
.fiche-figures-grid dt { font-size: 11px; color: var(--text-secondary); }
.fiche-figures-grid dd { margin: 0; font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--text-primary); }
.fiche-horizon { display: inline-block; min-width: 34px; font-size: 11px; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
.fiche-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.fiche-source { padding: 1px 6px; border: 1px solid var(--border-color); border-radius: 4px; font-size: 11.5px; color: var(--text-primary); text-decoration: none; }
a.fiche-source, button.fiche-source { color: var(--text-accent); }
.fiche-judgment p { margin: 0 0 2px; }
.fiche-judgment-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 11.5px; }
.fiche-ref { font-size: 11.5px; }
.fiche-conf, .fiche-meta, .fiche-empty { font-size: 11.5px; color: var(--text-secondary); }
.fiche-why { margin-top: 14px; }
.fiche-why > summary { cursor: pointer; font-size: 12.5px; color: var(--text-secondary); }
.fiche-why-body { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
.fiche-why-title { margin: 6px 0 2px; font-size: 11.5px; color: var(--text-secondary); }
.fiche-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
.fiche-action {
  padding: 5px 10px; border: 1px solid var(--border-color); border-radius: 6px;
  background: var(--bg-surface); color: var(--text-primary); font: inherit; font-size: 12px; cursor: pointer;
}
.fiche-link:focus-visible,
.fiche-action:focus-visible,
.fiche-source:focus-visible,
.fiche-why > summary:focus-visible { outline: 2px solid var(--text-accent); outline-offset: 2px; }

/* Onglets du mobile */
.v2-tabs { display: flex; height: 100%; }
.v2-tab { flex: 1; border: 0; background: transparent; color: var(--text-secondary); font: inherit; font-size: 13px; cursor: pointer; }
.v2-tab.is-on { color: var(--text-primary); font-weight: 700; box-shadow: inset 0 2px 0 var(--text-accent); }
.v2-tab:focus-visible { outline: 2px solid var(--text-accent); outline-offset: -2px; }

/* Tablette : liste et carte ; la fiche s'ouvre en volet à droite, par-dessus la carte (spec §9). */
@media (min-width: 700px) and (max-width: 1100px) {
  #app.ui-v2 .fm-v2-list { flex-basis: 40%; }
  #app.ui-v2 .fm-v2-fiche {
    position: absolute; top: 0; right: 0; bottom: 0; z-index: var(--z-drawer);
    width: min(380px, 60%); min-width: 0; max-width: none;
    box-shadow: -12px 0 40px rgba(0, 0, 0, 0.42);
  }
  #app.ui-v2:not([data-v2-fiche="open"]) .fm-v2-fiche { display: none; }
}

/* Mobile : trois onglets en bas ; une sélection ouvre la fiche en volet remontable (spec §9). */
@media (max-width: 699px) {
  #app.ui-v2 .main-container { flex-direction: column; padding-bottom: 52px; }
  #app.ui-v2 .fm-v2-list,
  #app.ui-v2 .map-area,
  #app.ui-v2 .fm-v2-fiche {
    display: none; flex: 1 1 auto; width: 100%; min-width: 0; max-width: none; min-height: 0; border: 0;
  }
  #app.ui-v2[data-v2-tab="list"] .fm-v2-list { display: flex; }
  #app.ui-v2[data-v2-tab="map"] .map-area { display: flex; }
  #app.ui-v2[data-v2-tab="fiche"] .fm-v2-fiche { display: flex; }
  #app.ui-v2[data-v2-fiche="open"]:not([data-v2-tab="fiche"]) .fm-v2-fiche {
    display: flex; position: fixed; left: 0; right: 0; bottom: 52px; z-index: var(--z-drawer);
    max-height: 70vh; border-top: 1px solid var(--border-color); border-radius: 16px 16px 0 0;
    box-shadow: 0 -12px 40px rgba(0, 0, 0, 0.5);
  }
  #app.ui-v2 .fm-v2-tabs {
    display: block; position: fixed; left: 0; right: 0; bottom: 0; z-index: calc(var(--z-drawer) + 1);
    height: 52px; padding-bottom: env(safe-area-inset-bottom, 0px);
    background: var(--bg-secondary); border-top: 1px solid var(--border-color);
  }
  #app.ui-v2 .sidebar { width: 100%; max-height: 45vh; }
  #app.ui-v2 .app-bottom-links { display: none; }
  #app.ui-v2 .sb-fresh { margin-left: 0; }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/components/StatusPanel.test.ts tests/css-ui-v2.test.ts tests/css-hidden-attribute.test.ts && npm run typecheck`
Expected: PASS (1 + 3 + 1 tests), typecheck sans erreur.

- [ ] **Step 6: Brancher la v2 dans `App.ts` — imports, constante, champs**

Dans `src/App.ts` :

1. Remplacer :

```ts
import type { FranceIntelPanel } from './components/FranceIntelPanel.ts';
import { briefSituationIds, evaluateBriefLevel, fetchFranceIntelBrief, type BriefLevelMark } from './services/france-intel-brief.ts';
import { scoreLevel } from './services/vigilance.ts';
```

par :

```ts
import type { FranceIntelPanel } from './components/FranceIntelPanel.ts';
import type { PosteSituation } from './components/poste/PosteSituation.ts';
import { briefSituationIds, evaluateBriefLevel, fetchFranceIntelBrief, type BriefLevelMark } from './services/france-intel-brief.ts';
import { scoreLevel } from './services/vigilance.ts';
import { isUiV2 } from './services/ui-mode.ts';
```

2. Remplacer `import { getPreviousScoreForSmoothing, recordStabilitySnapshot } from './utils/stability-history.ts';` par :

```ts
import {
  getDelta24h,
  getPillarDeltas24h,
  getPreviousScoreForSmoothing,
  getSparklineSeries,
  recordStabilitySnapshot,
} from './utils/stability-history.ts';
```

3. Dans la longue ligne `import type { NewsItem, FilterState, … } from './types/index.ts';`, remplacer `MilitaryFlight } from './types/index.ts';` par `MilitaryFlight, CommodityData } from './types/index.ts';`.

4. Remplacer :

```ts
const FRANCE_INTEL_BRIEF_EVENTS_WAIT_MS = 8_000;
```

par :

```ts
const FRANCE_INTEL_BRIEF_EVENTS_WAIT_MS = 8_000;
/** v2 (?ui=v2) : relecture des événements consolidés pour la liste et la fiche France (arbitrage A11). */
const V2_EVENTS_REFRESH_MS = 5 * 60_000;
```

5. Remplacer :

```ts
  private franceIntelBriefSettleTimer: ReturnType<typeof setTimeout> | null = null;
```

par :

```ts
  private franceIntelBriefSettleTimer: ReturnType<typeof setTimeout> | null = null;
  // ── Disposition A1 derrière ?ui=v2 (refonte UI, étape 2) ──────────────────
  /** Nouvelle interface « poste de situation » (paramètre d'URL ?ui=v2) ; sinon l'interface actuelle. */
  private readonly uiV2 = isUiV2(window.location.search);
  private poste: PosteSituation | null = null;
  private postePromise: Promise<PosteSituation> | null = null;
  /** Conteneurs de la v2, créés par renderShell(). */
  private v2Roots: { status: HTMLElement; themes: HTMLElement; list: HTMLElement; fiche: HTMLElement; tabs: HTMLElement } | null = null;
  /** Brief, événements et ligne de base lancés pour la fiche France (équivalent v2 du tiroir ouvert). */
  private v2IntelStarted = false;
  private v2EventsTimer: ReturnType<typeof setInterval> | null = null;
  /** Matières premières en cache : mouvements exceptionnels de l'énergie dans la liste (spec §4.4). */
  private currentCommodityData: CommodityData[] = [];
```

6. Dans `destroy()`, remplacer :

```ts
    this.clearFranceIntelBriefSettleTimer();
    this.clearPausableIntervals();
```

par :

```ts
    this.clearFranceIntelBriefSettleTimer();
    if (this.v2EventsTimer !== null) { clearInterval(this.v2EventsTimer); this.v2EventsTimer = null; }
    this.clearPausableIntervals();
```

- [ ] **Step 7: Brancher la v2 dans `App.ts` — coquille**

1. Dans le constructeur, remplacer :

```ts
    onLanguageChange(() => {
      this.updateShellTranslations();
      this.newsPanel?.refreshTranslations();
      this.statusPanel?.refreshTranslations();
      this.refreshFranceIntelPanel();
    });
```

par :

```ts
    onLanguageChange(() => {
      this.updateShellTranslations();
      this.newsPanel?.refreshTranslations();
      this.statusPanel?.refreshTranslations();
      this.refreshFranceIntelPanel();
      // v2 : la fiche France suit la bascule FR/EN de l'en-tête ; le brief est redemandé dans la langue.
      if (this.uiV2 && this.v2IntelStarted) {
        const lang = this.intelLang();
        this.requestFranceIntelBrief(this.buildFranceSnapshot(lang), lang, { showLoading: false });
      }
    });
```

2. Dans `bindSidebarToggle`, remplacer :

```ts
    let collapsed = false;
    try {
      collapsed = localStorage.getItem('fm-sidebar-collapsed') === 'true';
    } catch {
      collapsed = false;
    }
```

par :

```ts
    // v2 (arbitrage A6) : la barre des couches est repliée par défaut, et mémorisée à part.
    const storageKey = this.uiV2 ? 'fm-v2-sidebar-collapsed' : 'fm-sidebar-collapsed';
    let collapsed = this.uiV2;
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored !== null) collapsed = stored === 'true';
    } catch {
      collapsed = this.uiV2;
    }
```

et, plus bas dans la même méthode, `localStorage.setItem('fm-sidebar-collapsed', String(collapsed));` par `localStorage.setItem(storageKey, String(collapsed));`.

3. Dans `updateShellTranslations`, remplacer :

```ts
    const sidebarToggle = this.container.querySelector<HTMLButtonElement>('[data-sidebar-toggle]');
```

par :

```ts
    const layersLabel = this.container.querySelector<HTMLElement>('.header-sidebar-toggle__label');
    if (layersLabel) layersLabel.textContent = language === 'fr' ? 'Couches' : 'Layers';
    const sidebarToggle = this.container.querySelector<HTMLButtonElement>('[data-sidebar-toggle]');
```

4. Dans `renderShell`, dans le gabarit de l'en-tête, remplacer :

```ts
      <button class="header-sidebar-toggle" type="button" data-sidebar-toggle aria-expanded="true" aria-label="${t('app.sidebarCollapseAria')}">
        ${fmIcon('menu')}
      </button>
```

par :

```ts
      <button class="header-sidebar-toggle" type="button" data-sidebar-toggle aria-expanded="true" aria-label="${t('app.sidebarCollapseAria')}">
        ${fmIcon('menu')}${this.uiV2 ? `<span class="header-sidebar-toggle__label">${language === 'fr' ? 'Couches' : 'Layers'}</span>` : ''}
      </button>
```

5. Remplacer :

```ts
    this.container.appendChild(header);
```

par :

```ts
    this.container.appendChild(header);

    // ── Disposition A1 (?ui=v2) : bandeau d'état et barre de thèmes sous l'en-tête ──
    let v2Bar: HTMLElement | null = null;
    if (this.uiV2) {
      this.container.classList.add('ui-v2');
      this.container.dataset.v2Tab = 'list';
      this.container.dataset.v2Fiche = 'default';
      v2Bar = document.createElement('div');
      v2Bar.className = 'fm-v2-bar';
      v2Bar.innerHTML = '<div class="fm-v2-status"></div><div class="fm-v2-themes"></div>';
      this.container.appendChild(v2Bar);
    }
```

6. Remplacer :

```ts
    main.appendChild(mapArea);

    // ── Right Sidebar ──
```

par :

```ts
    // ── Disposition A1 (?ui=v2) : liste « À traiter » à gauche de la carte, fiche à droite ──
    let v2List: HTMLElement | null = null;
    let v2Fiche: HTMLElement | null = null;
    if (this.uiV2) {
      v2List = document.createElement('aside');
      v2List.className = 'fm-v2-list';
      v2List.setAttribute('aria-label', 'À traiter');
      v2List.innerHTML = '<p class="wl-empty">Chargement…</p>';
      main.appendChild(v2List);
    }

    main.appendChild(mapArea);

    if (this.uiV2) {
      v2Fiche = document.createElement('aside');
      v2Fiche.className = 'fm-v2-fiche';
      main.appendChild(v2Fiche);
    }

    // ── Right Sidebar ──
```

7. Remplacer :

```ts
    this.container.appendChild(bottomLinks);
```

par :

```ts
    this.container.appendChild(bottomLinks);
    if (v2Bar && v2List && v2Fiche) {
      const tabs = document.createElement('nav');
      tabs.className = 'fm-v2-tabs';
      tabs.setAttribute('aria-label', 'Vues');
      this.container.appendChild(tabs);
      const status = v2Bar.querySelector<HTMLElement>('.fm-v2-status');
      const themes = v2Bar.querySelector<HTMLElement>('.fm-v2-themes');
      if (status && themes) this.v2Roots = { status, themes, list: v2List, fiche: v2Fiche, tabs };
    }
```

8. Remplacer :

```ts
    this.layerPanel.setPresetHandler((id) => this.applyLayerPreset(id));
```

par :

```ts
    this.layerPanel.setPresetHandler((id) => {
      this.applyLayerPreset(id);
      // v2 (arbitrage A5) : la vue choisie dans « Couches » devient aussi le thème de la liste et de la fiche.
      this.poste?.setTheme(id, { silent: true });
    });
```

9. Remplacer :

```ts
    this.addGlobalListener(document, 'open-france-intel', () => {
      void this.openFranceIntelPanel();
    });
```

par :

```ts
    this.addGlobalListener(document, 'open-france-intel', () => {
      // v2 : pas de tiroir, la fiche France de la colonne de droite (spec §5, §14).
      if (this.uiV2) {
        this.poste?.select('france');
        return;
      }
      void this.openFranceIntelPanel();
    });
```

- [ ] **Step 8: Brancher la v2 dans `App.ts` — démarrage, carte, données**

1. Dans `init()`, remplacer :

```ts
    this.renderShell();
```

par :

```ts
    this.renderShell();
    if (this.uiV2) {
      void this.ensurePoste().catch((err) => {
        console.error('[App] Poste de situation indisponible', err);
        if (this.v2Roots) this.v2Roots.list.innerHTML = '<p class="wl-empty">Interface indisponible : rechargez la page.</p>';
      });
    }
```

et :

```ts
    await this.loadCriticalLayers();
    this.updateISNR();
```

par :

```ts
    await this.loadCriticalLayers();
    this.updateISNR();
    if (this.uiV2) {
      void this.startV2Intel().catch((err) => console.error('[App] Fiche France v2 : démarrage impossible', err));
    }
```

2. Dans `initMap()`, remplacer tout le bloc compris entre la ligne `    await this.mapContainer.init();` (conservée) et la ligne `    void import('./components/SituationHistoryPanel.ts').then(({ SituationHistoryPanel }) => {` (conservée) — c'est-à-dire la création d'`AlertMonitor` avec son `setDossierHandler`, de `SituationMonitor`, de `SituationBrief` et l'appel `getHistory(7)` — par :

```ts
    // v2 (?ui=v2) : alertes, convergences et situations passent dans la liste « À traiter » et
    // leurs fiches ; les trois panneaux flottants ne sont créés que pour l'interface par défaut.
    if (!this.uiV2) {
      this.alertMonitor?.destroy();
      this.alertMonitor = new AlertMonitor(mapEl);
      this.alertMonitor.setDossierHandler((situation) => this.openAlertDossier(situation));
      this.situationMonitor?.destroy();
      this.situationMonitor = new SituationMonitor(mapEl);
      this.situationMonitor.setOnLayerActivate((layerKeys) => this.activateLayersFromSituation(layerKeys));
      this.situationMonitor.setOnFlyTo((lon, lat, zoom) => {
        this.mapContainer?.flyTo(lon, lat, zoom ?? 10);
      });
      // Modèle "synthèse → détail" : le monitor ne s'affiche plus spontanément,
      // il s'ouvre via le bouton "Détails" du bandeau de synthèse.
      this.situationMonitor.enableManualMode();

      // Synthèse d'ouverture — même flux que SituationMonitor, aucun re-fetch du moteur.
      this.situationBrief?.destroy();
      this.situationBrief = new SituationBrief(mapEl);
      this.situationBrief.setOnFlyTo((lon, lat, zoom) => {
        this.mapContainer?.flyTo(lon, lat, zoom ?? 8);
      });
      this.situationBrief.setOnOpenDetails(() => {
        this.situationMonitor?.toggleOpen();
      });
      // Historique 24 h (situations résolues) : fetch léger unique, tolérant aux erreurs.
      void getHistory(7)
        .then((result) => {
          this.situationBrief?.setRecent24h(
            resolvedSituationsFromHistory(result.data.slots, Date.now()),
          );
        })
        .catch(() => {
          // Le bandeau vit sans historique : il affichera les seules situations actives.
        });
    }

```

3. Remplacer :

```ts
  // ─── Map ────────────────────────────────────────────────────────────────────
```

par (les deux méthodes reprennent à l'identique le corps des anciens rappels d'`AlertMonitor` et de `SituationMonitor`) :

```ts
  /**
   * Dossier dédié d'une alerte ou d'une situation (grand feu, vol militaire) ; false s'il n'y en a
   * pas. Partagé par AlertMonitor (v1) et la fiche d'alerte ou de situation (v2).
   */
  private openAlertDossier(situation: DetectedSituation): boolean {
    if (situation.type === 'WILDFIRE_ESCALATION') {
      const incidentId = situation.id.replace(/^wildfire-/, '');
      // Champ alimenté par la Task 10 (géo-résolution) — currentFireIncidents,
      // à côté de currentActiveFires.
      const incident = this.currentFireIncidents.find((i) => i.id === incidentId);
      if (!incident) return false;
      void this.openWildfireDossier(incident);
      return true;
    }

    if (situation.type === 'MILITARY_SURGE_ALERT') {
      const flight = this.currentMilitaryFlights.find((item) => item.id === situation.entityId);
      const lon = flight?.longitude ?? situation.lon;
      const lat = flight?.latitude ?? situation.lat;
      if (lon == null || lat == null) return false;

      if (!this.activeLayers.military) {
        this.onLayerToggle('military', true);
      }
      this.mapContainer?.flyTo(lon, lat, 10);
      const mapEl = document.getElementById('map-container');
      if (flight && mapEl) {
        this.mapPopup?.showMilitaryFlight(flight, mapEl.clientWidth / 2, mapEl.clientHeight / 2);
      }
      return true;
    }

    return false;
  }

  /** « Voir sur la carte » d'une situation : active ses couches (SituationMonitor v1, fiche v2). */
  private activateLayersFromSituation(layerKeys: readonly string[]): void {
    for (const key of layerKeys) {
      if (key in this.activeLayers && !this.activeLayers[key as keyof typeof this.activeLayers]) {
        this.onLayerToggle(key as keyof typeof this.activeLayers, true);
      }
    }
  }

  // ─── Map ────────────────────────────────────────────────────────────────────
```

4. Dans `startCommodityPolling`, remplacer :

```ts
        const data = await fetchCommodityData();
        this.commodityStrip?.update(data);
```

par :

```ts
        const data = await fetchCommodityData();
        this.currentCommodityData = data;
        this.commodityStrip?.update(data);
```

5. Dans `buildAlertMonitorSituations`, remplacer :

```ts
        linkUrl: item.link,
        linkLabel: t('alerts.openArticle'),
```

par :

```ts
        linkUrl: item.link,
        linkLabel: t('alerts.openArticle'),
        // v2 : rattache l'alerte presse au thème de son article (spec §7.3).
        category: item.threat?.category ?? ('general' as const),
```

- [ ] **Step 9: Brancher la v2 dans `App.ts` — brief et rafraîchissement**

1. Remplacer toute la méthode `refreshFranceIntelPanel` par :

```ts
  private refreshFranceIntelPanel(): void {
    const lang = this.intelLang();
    const snapshot = this.buildFranceSnapshot(lang);
    recordStabilitySnapshot(snapshot.score, {
      continuity: snapshot.axes.continuity,
      security: snapshot.axes.security,
      signal: snapshot.axes.signal,
      defense: snapshot.axes.defense,
    });
    const alerts = this.buildAlertMonitorSituations();
    if (this.uiV2) {
      this.updatePoste(snapshot, alerts, lang);
    } else {
      this.alertMonitor?.update(alerts, lang);
      this.situationMonitor?.update(snapshot.situations, lang);
      this.situationBrief?.update(snapshot.situations);
    }
    void pushHistorySnapshot(snapshot);
    if (!this.isIntelSurfaceVisible()) return;
    this.franceIntelPanel?.show(snapshot);
    const now = Date.now();
    const evaluation = evaluateBriefLevel(this.franceIntelBriefMark, snapshot.score, now);
    this.franceIntelBriefMark = evaluation.mark;
    if (evaluation.refresh) {
      this.requestFranceIntelBrief(snapshot, lang, { showLoading: false });
    } else {
      this.armFranceIntelBriefSettleTimer(evaluation.settleAt);
    }
  }
```

2. Dans `armFranceIntelBriefSettleTimer`, remplacer :

```ts
      if (!this.franceIntelPanel?.isVisible()) return;
      this.refreshFranceIntelPanel();
    }, delay);
```

par :

```ts
      if (!this.isIntelSurfaceVisible()) return;
      this.refreshFranceIntelPanel();
    }, delay);
```

3. Remplacer les deux lignes restantes `    const lang = this.franceIntelPanel?.getCurrentLang() ?? 'fr';` (dans `buildSituationReportContext` et `buildExportContext`) par `    const lang = this.intelLang();`.

4. Remplacer toute la méthode `requestFranceIntelBrief` par :

```ts
  private requestFranceIntelBrief(
    snapshot: FranceCountrySnapshot,
    lang: 'fr' | 'en',
    options?: { showLoading?: boolean },
  ): void {
    const requestId = ++this.franceIntelBriefRequestId;
    // Un brief est demandé : plus rien à stabiliser (chaque demande de brief y compris via ce
    // minuteur repart de zéro), et la nouvelle couleur devient la référence pour la suite.
    this.clearFranceIntelBriefSettleTimer();
    this.franceIntelBriefMark = {
      level: scoreLevel(snapshot.score),
      lastLevelRefreshAt: this.franceIntelBriefMark?.lastLevelRefreshAt ?? null,
      divergentLevel: null,
      divergedSince: null,
    };
    // S1…S5 désignent les situations de CET instantané : figé pour les preuves cliquables.
    const situationIds = briefSituationIds(snapshot.situations);
    if (options?.showLoading !== false) {
      this.franceIntelPanel?.showBriefLoading();
      this.poste?.setBriefPending();
    }

    // Les événements consolidés alimentent le tiroir (v1) ou la liste et la fiche (v2), et servent
    // de preuves citables au brief.
    const eventsLoad = this.loadFranceIntelEvents();
    // Ils sont remis dès qu'ils arrivent, sans limite de temps.
    void eventsLoad.then((loaded) => {
      if (requestId !== this.franceIntelBriefRequestId || !this.isIntelSurfaceVisible()) return;
      if (this.uiV2) {
        this.deliverV2Events(loaded?.state ?? null);
        return;
      }
      if (!this.franceIntelPanel) return;
      if (loaded) this.franceIntelPanel.updateEvents(loaded.state);
      else this.franceIntelPanel.markEventsUnavailable();
    });
    // Le brief ne les attend que FRANCE_INTEL_BRIEF_EVENTS_WAIT_MS : une base qui cale ne
    // doit pas le laisser sur « Génération… » ; il part alors avec les seules situations.
    void settleWithin(eventsLoad.then((loaded) => loaded?.briefEvents ?? []), FRANCE_INTEL_BRIEF_EVENTS_WAIT_MS, [])
      .then((briefEvents) => (requestId === this.franceIntelBriefRequestId
        ? fetchFranceIntelBrief(snapshot, lang, briefEvents)
        : null))
      .then((result) => {
        if (!result || requestId !== this.franceIntelBriefRequestId) return;
        if (!this.isIntelSurfaceVisible()) return;
        if (this.intelLang() !== lang) return;
        this.franceIntelPanel?.updateBrief(result.brief, result.freshness, situationIds);
        this.poste?.setBrief(result.brief, result.freshness, situationIds);
      });
  }
```

5. Remplacer toute la méthode `scheduleFranceIntelBriefRefresh` par :

```ts
  private scheduleFranceIntelBriefRefresh(): void {
    this.clearFranceIntelBriefRefresh();
    this.franceIntelBriefRefreshTimer = setInterval(() => {
      if (document.hidden) return; // skip tick while tab is hidden
      if (!this.isIntelSurfaceVisible()) return;
      const lang = this.intelLang();
      const snapshot = this.buildFranceSnapshot(lang);
      this.franceIntelPanel?.show(snapshot);
      this.requestFranceIntelBrief(snapshot, lang, { showLoading: false });
    }, FRANCE_INTEL_BRIEF_REFRESH_MS);
  }
```

6. Remplacer :

```ts
  private updateISNR(): void {
```

par :

```ts
  // ─── Disposition A1 derrière ?ui=v2 (refonte UI, étape 2) ───────────────────

  /** Langue de l'instantané et du brief : bascule FR/EN de l'en-tête en v2, bouton du tiroir sinon. */
  private intelLang(): 'fr' | 'en' {
    return this.uiV2 ? getCurrentLanguage() : (this.franceIntelPanel?.getCurrentLang() ?? 'fr');
  }

  /** Surface qui affiche le brief : la fiche France (v2, dès son lancement) ou le tiroir ouvert (v1). */
  private isIntelSurfaceVisible(): boolean {
    return this.uiV2 ? this.v2IntelStarted : this.franceIntelPanel?.isVisible() === true;
  }

  /** Contrôleur de la v2, chargé à la demande (hors du chunk critique). */
  private ensurePoste(): Promise<PosteSituation> {
    if (this.poste) return Promise.resolve(this.poste);
    if (this.postePromise) return this.postePromise;
    const roots = this.v2Roots;
    if (!roots) return Promise.reject(new Error('Poste de situation : conteneurs absents'));
    this.postePromise = import('./components/poste/PosteSituation.ts').then(({ PosteSituation }) => {
      const poste = new PosteSituation({ app: this.container, ...roots }, {
        onThemeChange: (theme) => this.applyLayerPreset(theme),
        onFlyTo: (lon, lat, zoom) => this.mapContainer?.flyTo(lon, lat, zoom),
        onActivateLayers: (keys) => this.activateLayersFromSituation(keys),
        onOpenDossier: (situation) => this.openAlertDossier(situation),
        onOpenReport: () => {
          void this.openSituationReport();
        },
        onShowFrance: () => {
          const france = VIEW_PRESETS.france;
          this.mapContainer?.flyTo(france.center[0], france.center[1], france.zoom);
        },
        onFicheRendered: (body) => {
          // §14 : le baromètre des infrastructures (et son infobulle) vit dans « Pourquoi ce niveau ? ».
          const slot = body.querySelector('.fiche-infra-slot');
          if (slot instanceof HTMLElement) this.networkBarometerWidget?.attachTo(slot);
        },
      });
      this.poste = poste;
      this.refreshFranceIntelPanel();
      return poste;
    });
    return this.postePromise;
  }

  /**
   * Équivalent v2 de l'ouverture du tiroir : la fiche France est toujours affichée, donc brief,
   * événements et ligne de base de visite partent dès que les couches critiques sont chargées.
   */
  private async startV2Intel(): Promise<void> {
    if (this.v2IntelStarted) return;
    const poste = await this.ensurePoste();
    const visit = await import('./services/intel-last-visit.ts');
    // Revue : la ligne de base DOIT être figée avant le premier enregistrement (deliverV2Events).
    poste.setBaseline(visit.beginVisitBaseline());
    this.v2IntelStarted = true;
    // Les couches critiques sont là : la v2 peut afficher le niveau national.
    this.refreshFranceIntelPanel();
    if (!this.currentCyberData) void this.loadCyber();
    if (!this.currentOilData) void this.loadOil();
    void this.refreshNetworkBarometerWidget().catch((err) => {
      console.error('[App] Network barometer refresh on v2 start failed', err);
    });
    const lang = this.intelLang();
    this.requestFranceIntelBrief(this.buildFranceSnapshot(lang), lang);
    this.scheduleFranceIntelBriefRefresh();
    this.v2EventsTimer = setInterval(() => {
      if (document.hidden) return; // skip tick while tab is hidden
      void this.loadFranceIntelEvents().then((loaded) => this.deliverV2Events(loaded?.state ?? null));
    }, V2_EVENTS_REFRESH_MS);
    void getHistory(7)
      .then((result) => poste.setResolved(resolvedSituationsFromHistory(result.data.slots, Date.now())))
      .catch(() => {
        // Sans historique, « Ce qui a changé » ne liste simplement pas les situations résolues.
      });
  }

  /** Données en cache (aucun fetch) remises à la v2 à chaque rafraîchissement. */
  private updatePoste(snapshot: FranceCountrySnapshot, alerts: DetectedSituation[], lang: 'fr' | 'en'): void {
    this.poste?.update({
      snapshot,
      alerts,
      ecowatt: this.currentEcowattResponse,
      meteo: this.currentMeteoAlerts,
      floods: this.currentFloodSegments,
      markets: this.currentMarketData,
      commodities: this.currentCommodityData,
      sources: this.statusPanel?.getSources() ?? [],
      score: { delta24h: getDelta24h(), pillarDeltas: getPillarDeltas24h(), series: getSparklineSeries() },
      // Revue : pas de niveau national avant les couches critiques (jamais un vert par défaut).
      ready: this.v2IntelStarted,
      lang,
      now: Date.now(),
    });
  }

  /** Remet les événements à la v2 et enregistre la ligne de base, au même moment que l'ancre de visite. */
  private deliverV2Events(state: IntelEventsState | null): void {
    const poste = this.poste;
    if (!poste) return;
    poste.setEvents(state);
    if (state && !state.unavailable) {
      void import('./services/intel-last-visit.ts').then((visit) => visit.recordVisitBaseline(poste.currentLevels()));
    }
  }

  private updateISNR(): void {
```

- [ ] **Step 10: Run the task gate**

Run: `npx vitest run && npm run typecheck && npm run lint && npm run build`
Expected: tout vert. Si `noUnusedLocals` signale `openFranceIntelPanel` ou un import : il reste utilisé en v1 (écouteur `open-france-intel`) ; ne rien supprimer, corriger le branchement.

Vérifier le découpage : `ls dist/assets | grep -i poste` liste un chunk `PosteSituation-*.js` distinct du chunk `index-*.js` (le contrôleur reste hors du chunk critique).

- [ ] **Step 11: Commit**

```bash
git add src/App.ts src/components/StatusPanel.ts src/components/StatusPanel.test.ts src/styles/main.css tests/css-ui-v2.test.ts
git commit -m "feat: disposition A1 derrière ?ui=v2 — bandeau, liste, fiche, onglets mobiles ; interface par défaut inchangée"
```

---

### Task 12: Vérification navigateur et table §14

**Files:**
- Aucun fichier du dépôt. Script dans le dossier de travail de la session (non versionné).

- [ ] **Step 1: Écrire le script de contrôle**

Créer `$SCRATCH/cdp-poste.mjs` (`$SCRATCH` = dossier temporaire de la session) :

```js
// cdp-poste.mjs — contrôle navigateur de l'étape 2 (disposition A1, ?ui=v2). Chrome sans interface.
// Usage : node cdp-poste.mjs <largeur> <hauteur> <tag> <scénario>
//   scénario : donnees       événements factices (un titre hostile, un lien javascript:), profil neuf
//              retour        mêmes données, profil de « donnees » conservé (seconde visite)
//              indisponible  /api/events* en 503 (historique indisponible), profil neuf
//              v1            interface par défaut, sans ?ui=v2
// Vite doit tourner sur :3017 (sans DATABASE_URL : les événements viennent des données factices).
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const [,, W = '1440', H = '900', TAG = 'desk', SCENARIO = 'donnees'] = process.argv;
const width = Number(W);
const PORT = 9380 + Math.floor(Math.random() * 400);
const profile = SCENARIO === 'retour' ? `/tmp/fm-poste-${TAG}-donnees` : `/tmp/fm-poste-${TAG}-${SCENARIO}`;
if (SCENARIO !== 'retour') rmSync(profile, { recursive: true, force: true });
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
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
const shot = async (name) => { const s = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(name, Buffer.from(s.result.data, 'base64')); };
const log = (label, value) => console.log(`${TAG}/${SCENARIO} ${label}`, value);

// Données factices : un événement rouge corroboré au titre hostile, un jaune corroboré (énergie),
// un jaune isolé (ne doit pas entrer dans la liste), un article au lien javascript: (jamais cliquable).
const NOW = Date.now();
const MIN = 60_000;
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const E42 = { id: 42, title: 'Explosion dans une usine chimique <img src=x onerror=alert(1)>', category: 'security', severity: 'critical', status: 'active', firstSeen: iso(30 * MIN), lastSeen: iso(10 * MIN), articleCount: 3, sourceCount: 3, independentCount: 3, sourceNames: ['France Info', 'Le Monde', 'Paris-Normandie'], lat: 49.44, lon: 1.1 };
const E43 = { id: 43, title: 'Pénuries dans des stations du Rhône et de l’Isère', category: 'energy', severity: 'medium', status: 'active', firstSeen: iso(60 * MIN), lastSeen: iso(20 * MIN), articleCount: 2, sourceCount: 2, independentCount: 2, sourceNames: ['Le Progrès', 'Le Dauphiné libéré'], lat: 45.7, lon: 4.8 };
const E44 = { id: 44, title: 'Rumeur locale non recoupée', category: 'general', severity: 'medium', status: 'active', firstSeen: iso(90 * MIN), lastSeen: iso(80 * MIN), articleCount: 1, sourceCount: 1, independentCount: 1, sourceNames: ['Blog'], lat: null, lon: null };
const FIXTURES = {
  events: { events: [E42, E43, E44], generatedAt: iso(0) },
  changes: { changes: [{ at: iso(25 * MIN), kind: 'created', from: null, to: 'critical', event: E42 }], totals: { created: 1 } },
  detail: {
    event: E42,
    articles: [
      { id: 1, title: 'Explosion près de Rouen', link: 'javascript:alert(1)', feedName: 'France Info', publishedAt: iso(30 * MIN) },
      { id: 2, title: 'Le PPI déclenché', link: 'https://example.org/ppi', feedName: 'Paris-Normandie', publishedAt: iso(20 * MIN) },
    ],
    log: [{ at: iso(30 * MIN), kind: 'created', from: null, to: 'critical' }],
  },
};

async function answer({ requestId, request }) {
  const responseHeaders = [{ name: 'Content-Type', value: 'application/json' }];
  if (SCENARIO === 'indisponible') {
    await send('Fetch.fulfillRequest', { requestId, responseCode: 503, responseHeaders, body: Buffer.from('{"error":"indisponible"}').toString('base64') });
    return;
  }
  const url = request.url;
  const body = url.includes('/api/events/changes') ? FIXTURES.changes
    : url.includes('/api/events/detail') ? FIXTURES.detail
    : FIXTURES.events;
  await send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders, body: Buffer.from(JSON.stringify(body)).toString('base64') });
}

ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); return; }
  if (m.method === 'Fetch.requestPaused') void answer(m.params);
};

await send('Page.enable');
await send('Runtime.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/events*' }] });
await send('Emulation.setDeviceMetricsOverride', { width, height: Number(H), deviceScaleFactor: 1, mobile: width < 600 });
await send('Page.navigate', { url: SCENARIO === 'v1' ? 'http://localhost:3017/?view=app' : 'http://localhost:3017/?view=app&ui=v2' });

const waitFor = async (expression, timeoutMs) => {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await evaluate(expression)) return true;
    await sleep(2000);
  }
  return false;
};

if (SCENARIO === 'v1') {
  await sleep(35000);
  log('v1', await evaluate(`JSON.stringify({
    bar: !!document.querySelector('.fm-v2-bar'),
    alertMonitor: !!document.querySelector('.alert-monitor'),
    situationBrief: !!document.querySelector('.situation-brief'),
    situationMonitor: !!document.querySelector('.situation-monitor'),
    intelEntry: !!document.querySelector('.sidebar-intel-entry'),
  })`));
  await shot(`poste-${TAG}-v1.png`);
  chrome.kill();
  process.exit(0);
}

// Démarrage à froid en développement : attendre le brief et la fin du chargement des événements.
log('prêt', await waitFor(`(() => {
  const essentiel = document.querySelector('.fiche-essentiel')?.textContent ?? '';
  const loading = !!document.querySelector('.wl-note .fm-loader') || (document.querySelector('.fm-v2-status')?.textContent ?? '').includes('Calcul');
  return essentiel.length > 0 && !essentiel.includes('en cours de préparation') && !loading;
})()`, 150000));

log('état', await evaluate(`(() => {
  const q = (s) => document.querySelector(s);
  const rect = (s) => { const el = q(s); if (!el) return null; const r = el.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) }; };
  const text = ['.fm-v2-bar', '.fm-v2-list', '.fm-v2-fiche'].map((s) => q(s)?.innerText ?? '').join('\\n');
  const fiche = q('.fm-v2-fiche');
  const outsideWhy = (() => { if (!fiche) return ''; const clone = fiche.cloneNode(true); clone.querySelectorAll('.fiche-why').forEach((d) => d.remove()); return clone.textContent ?? ''; })();
  return JSON.stringify({
    status: q('.fm-v2-status')?.innerText ?? null,
    themes: [...document.querySelectorAll('.tb-theme')].map((b) => b.innerText.replace(/\\s+/g, ' ').trim()),
    listTitle: q('.wl-title')?.innerText ?? null,
    keys: [...document.querySelectorAll('.wl-item')].map((b) => b.dataset.key),
    firstMeta: q('.wl-meta')?.innerText ?? null,
    badges: [...document.querySelectorAll('.wl-badge')].map((b) => b.textContent),
    injected: document.querySelectorAll('[onerror]').length,
    fiche: q('.fiche')?.dataset.fiche ?? null,
    scoreOutsideWhy: /\\d+\\s*\\/\\s*100/.test(outsideWhy),
    forbidden: ['SIT-', 'ENERGY_STRESS', 'CYBER_PRESSURE', 'FUEL_SUPPLY_RISK', 'CONF 0', 'moteur 10 règles', 'undefined', 'NaN', '[object'].filter((s) => text.includes(s)),
    englishEnums: text.match(/\\b(HIGH|CRITICAL|MEDIUM|tense)\\b/g) ?? [],
    oldPanels: ['.alert-monitor', '.situation-brief', '.situation-monitor', '.frintel-drawer.active'].filter((s) => !!q(s)),
    unavailableLine: (q('.fm-v2-list')?.innerText ?? '').includes('Événements indisponibles pour le moment'),
    list: rect('.fm-v2-list'), map: rect('.map-area'), ficheRect: rect('.fm-v2-fiche'), tabs: rect('.fm-v2-tabs'),
    tab: document.getElementById('app')?.dataset.v2Tab ?? null,
    hScroll: document.documentElement.scrollWidth > window.innerWidth,
    headerOverlap: (() => {
      const a = q('.header-title')?.getBoundingClientRect();
      const b = q('.header-status')?.getBoundingClientRect();
      return !!a && !!b && !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
    })(),
  });
})()`));
await shot(`poste-${TAG}-${SCENARIO}.png`);

if (width >= 700) {
  log('clavier', await evaluate(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const items = [...document.querySelectorAll('.wl-item')];
    if (items.length < 2) return JSON.stringify({ skipped: 'moins de deux lignes' });
    items[0].focus();
    items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    const second = document.activeElement?.dataset.key ?? null;
    document.activeElement.click();
    await wait(400);
    const opened = document.querySelector('.fiche')?.dataset.fiche ?? null;
    const overlay = document.getElementById('app')?.dataset.v2Fiche ?? null;
    const ficheWidth = Math.round(document.querySelector('.fm-v2-fiche').getBoundingClientRect().width);
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(400);
    const back = document.querySelector('.fiche')?.dataset.fiche ?? null;
    const focusKey = document.activeElement?.dataset.key ?? null;
    await wait(5000);
    return JSON.stringify({ second, opened, overlay, ficheWidth, back, focusKey, focusAfter5s: document.activeElement?.dataset.key ?? null });
  })()`));
}

if (SCENARIO !== 'indisponible') {
  log('fiche événement', await evaluate(`(async () => {
    const row = [...document.querySelectorAll('.wl-item')].find((b) => b.dataset.key === 'event:42');
    if (!row) return JSON.stringify({ skipped: 'pas de ligne event:42' });
    row.click();
    await new Promise((r) => setTimeout(r, 2000));
    const fiche = document.querySelector('.fiche');
    const result = {
      fiche: fiche?.dataset.fiche ?? null,
      jsLinks: fiche?.querySelectorAll('a[href^="javascript"]').length ?? -1,
      httpsRel: fiche?.querySelector('a[href="https://example.org/ppi"]')?.getAttribute('rel') ?? null,
      log: (fiche?.innerText ?? '').includes('créé · rouge'),
      injected: document.querySelectorAll('[onerror]').length,
    };
    document.querySelector('.fiche-close')?.click();
    return JSON.stringify(result);
  })()`));
}

log('volet France', await evaluate(`(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  document.querySelector('[data-select="france"]')?.click();
  await wait(500);
  const summary = document.querySelector('[data-fiche="france"] .fiche-why > summary');
  if (!summary) return JSON.stringify({ skipped: 'fiche France absente' });
  summary.focus();
  summary.click();
  await wait(5000);
  const details = document.querySelector('[data-fiche="france"] .fiche-why');
  const result = {
    open: details?.hasAttribute('open') ?? false,
    focusOnSummary: document.activeElement?.matches?.('.fiche-why > summary') ?? false,
    missing: ['.frintel-gauge', '.frintel-pillars', '.frintel-dom-grid', '.frintel-timeline-row', '.fiche-infra-slot #network-barometer-widget']
      .filter((s) => !details?.querySelector(s)),
    essentiel: document.querySelector('[data-fiche="france"] .fiche-essentiel')?.innerText ?? null,
    changes: document.querySelector('[data-fiche="france"] .fiche-changes')?.innerText ?? null,
  };
  summary.click();
  document.querySelector('.fiche-close')?.click();
  return JSON.stringify(result);
})()`));

log('thème Santé', await evaluate(`(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  document.querySelector('[data-theme="health"]')?.click();
  await wait(1500);
  const result = {
    title: document.querySelector('.wl-title')?.innerText ?? null,
    empty: document.querySelector('.wl-empty')?.innerText ?? null,
    guard: document.querySelector('.wl-guard')?.innerText ?? null,
    fiche: document.querySelector('.fiche')?.dataset.fiche ?? null,
    kind: document.querySelector('.fiche-kind')?.innerText ?? null,
  };
  document.querySelector('.wl-guard')?.click();
  await wait(800);
  result.afterGuard = document.querySelector('.tb-theme.is-on')?.dataset.theme ?? null;
  document.querySelector('[data-theme="general"]')?.click();
  await wait(800);
  return JSON.stringify(result);
})()`));

log('§14 accès', await evaluate(`(async () => {
  const toggle = document.querySelector('[data-sidebar-toggle]');
  const label = toggle?.innerText ?? null;
  toggle?.click();
  await new Promise((r) => setTimeout(r, 700));
  const layers = document.querySelector('.layer-panel');
  const layersVisible = !!layers && layers.getBoundingClientRect().height > 0;
  toggle?.click();
  await new Promise((r) => setTimeout(r, 300));
  return JSON.stringify({
    layersToggle: label,
    layersVisible,
    regions: !!document.getElementById('region-presets'),
    legend: !!document.querySelector('.legend-banner-container'),
    noteReport: !!document.querySelector('[data-note-report]'),
    exportMenu: !!document.querySelector('[data-export-menu]'),
    sourcesQuality: !!document.querySelector('a[href="/sources-quality"]'),
    languages: document.querySelectorAll('[data-language-toggle]').length,
    modules: !!document.getElementById('under-map-area'),
    history: !!document.querySelector('.sit-hist-wrap'),
    intelEntry: !!document.querySelector('.sidebar-intel-entry'),
  });
})()`));

if (TAG === 'desk' && SCENARIO === 'donnees') {
  log('EN', await evaluate(`(async () => {
    document.querySelector('[data-language-toggle="en"]')?.click();
    await new Promise((r) => setTimeout(r, 3000));
    const result = {
      status: document.querySelector('.fm-v2-status')?.innerText ?? null,
      list: document.querySelector('.wl-title')?.innerText ?? null,
      why: document.querySelector('.fiche-why > summary')?.innerText ?? null,
    };
    document.querySelector('[data-language-toggle="fr"]')?.click();
    await new Promise((r) => setTimeout(r, 1500));
    return JSON.stringify(result);
  })()`));
}

if (width < 700) {
  log('mobile', await evaluate(`(async () => {
    const app = document.getElementById('app');
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const tabs = [...document.querySelectorAll('.v2-tab')].map((b) => b.innerText);
    document.querySelector('.wl-item')?.click();
    await wait(600);
    const sheet = document.querySelector('.fm-v2-fiche').getBoundingClientRect();
    const sheetOpen = app.dataset.v2Fiche === 'open' && sheet.height > 0 && sheet.bottom <= window.innerHeight;
    document.querySelector('.fiche-close')?.click();
    await wait(400);
    const closed = app.dataset.v2Fiche === 'default';
    document.querySelector('[data-tab="map"]')?.click();
    await wait(800);
    const mapVisible = document.querySelector('.map-area').getBoundingClientRect().height > 100;
    document.querySelector('[data-tab="fiche"]')?.click();
    await wait(400);
    const ficheTab = document.querySelector('.fiche')?.dataset.fiche ?? null;
    document.querySelector('[data-tab="list"]')?.click();
    return JSON.stringify({ tabs, sheetOpen, closed, mapVisible, ficheTab });
  })()`));
  await shot(`poste-${TAG}-${SCENARIO}-onglets.png`);
}

chrome.kill();
process.exit(0);
```

- [ ] **Step 2: Lancer le serveur de développement et les contrôles**

```bash
(DATABASE_URL= GROQ_API_KEY= nohup npx vite --port 3017 --strictPort > "$SCRATCH/vite-poste.log" 2>&1 &)
for i in $(seq 1 60); do curl -s -o /dev/null http://localhost:3017/ && break; sleep 1; done
cd "$SCRATCH"
node cdp-poste.mjs 1440 900 desk donnees
node cdp-poste.mjs 1440 900 desk retour
node cdp-poste.mjs 1280 800 laptop donnees
node cdp-poste.mjs 820 1180 tablet donnees
node cdp-poste.mjs 390 844 mob donnees
node cdp-poste.mjs 1440 900 desk indisponible
node cdp-poste.mjs 820 1180 tablet indisponible
node cdp-poste.mjs 390 844 mob indisponible
node cdp-poste.mjs 1440 900 desk v1
pkill -f "vite --port 3017"
```

Expected :
- `prêt: true` (sinon relancer : le démarrage à froid en développement peut dépasser 150 s sur une machine chargée).
- `état`, toutes largeurs : `forbidden: []`, `englishEnums: []`, `oldPanels: []`, `injected: 0`, `scoreOutsideWhy: false`, `hScroll: false`, `headerOverlap: false`, `fiche: "france"` ; `status` contient « France » et, pour `donnees`, « Première visite : dernières 24 h » (profil neuf) ; `listTitle` commence par « À traiter · Vue générale · » ; `keys` contient `event:42` et `event:43`, jamais `event:44` (jaune non corroboré) ; `badges` contient « NOUVEAU » (E42 créé dans le fil) ; `firstMeta` commence par un mot de niveau (« Rouge », « Orange », « Jaune »).
- `état`, `retour` : `status` contient « Depuis votre visite ( ».
- `état`, 1 440 et 1 280 px : `list.r ≤ map.l + 1` et `map.r ≤ ficheRect.l + 1` (trois colonnes, aucune superposition) ; `tabs.w === 0`.
- `état`, 820 px : `ficheRect.w === 0` (fiche fermée par défaut) ; `clavier` : `overlay: "open"` et `ficheWidth > 0` (volet par-dessus la carte).
- `état`, 390 px : `tab: "list"`, `tabs.h > 0`.
- `état`, `indisponible` : `unavailableLine: true`, `fiche: "france"`.
- `clavier` (≥ 700 px) : `opened === second`, `back: "france"`, `focusKey === second`, `focusAfter5s === second`.
- `fiche événement` : `fiche: "event:42"`, `jsLinks: 0`, `httpsRel: "noopener noreferrer"`, `log: true`, `injected: 0`.
- `volet France` : `open: true`, `focusOnSummary: true`, `missing: []`, `essentiel` non vide et sans « indisponible », `changes` contient « Première visite » ou « Depuis votre visite ».
- `thème Santé` : `title` commence par « À traiter · Santé », `fiche: "theme:health"`, `kind: "Thème"` ; si `title` finit par « · 0 », `empty` commence par « Rien à traiter. » ; `guard` commence par « Hors de ce thème : » (E42 est rouge, en sécurité) et `afterGuard` vaut le thème visé (`security` avec les données factices).
- `§14 accès` : `layersToggle` contient « Couches », `layersVisible: true`, et toutes les autres clés à `true` (`languages: 2`).
- `EN` : `list` commence par « To handle · Overview », `why` vaut « Why this level? ».
- `mobile` : `tabs` vaut `["À traiter", "Carte", "France"]`, `sheetOpen: true`, `closed: true`, `mapVisible: true`, `ficheTab: "france"`.
- `v1` : `bar: false`, et `alertMonitor`, `situationBrief`, `situationMonitor`, `intelEntry` à `true` (interface par défaut intacte).


- [ ] **Step 3: Parcourir la table §14 en v2**

Sur les captures et, au besoin, dans un Chrome ouvert sur `http://localhost:3017/?view=app&ui=v2`, vérifier chaque ligne :

| Fonction actuelle (spec §14) | Emplacement en v2, étape 2 | Vérification |
|---|---|---|
| Panneau d'alertes : liste, détail, « Voir toutes », dossier grands feux, lien source | Lignes `alert:*` et `official:*` de la liste, « Voir les <n> autres » ; fiche alerte : résumé, zones, sources, lien http(s), « Ouvrir le dossier d'incident » ou « Voir l'aéronef » | `état` (clés), tests des tâches 8 et 10 ; en direct, ouvrir une alerte s'il y en a |
| Convergences 24 h : actives, résolues, survol, centrage | Liste (badges), bandeau « Depuis votre visite », fiche France « Ce qui a changé » (« Résolue : … »), « Voir sur la carte » | `état`, `retour`, `volet France` |
| `SituationMonitor` : liste, détail, centrage | Lignes `situation:*`, fiche situation (facteurs, zones, actions recommandées, sources, sous-scores dans le volet), « Voir sur la carte » | `clavier` ; ouvrir une situation en direct |
| Tiroir : score, jauge, piliers, Δ24 h, courbe 7 jours, plafond, facteur principal | Volet de la fiche France | `volet France` (`missing: []`) |
| Tiroir : situations corrélées | Liste et fiche situation | idem |
| Tiroir : brief, preuves cliquables, à surveiller, dernière visite, événements consolidés | Fiche France : essentiel, « Jugements » et leurs preuves, « À surveiller », « Ce qui a changé » ; « Événements consolidés ouverts » dans le volet ; fiche événement | `volet France`, `fiche événement` |
| Tiroir : domaines, bloc énergie, chronologie 7 jours, baromètre des infrastructures et son infobulle | Volet de la fiche France | `volet France` ; survoler le baromètre dans le volet |
| Panneaux par source | Inchangés (panneaux flottants) jusqu'à l'étape 3 | ouvrir Écowatt depuis « Couches » |
| Les 35 couches et leurs groupes | Barre latérale, bouton « Couches » de l'en-tête | `§14 accès` |
| Légendes de couches | Inchangées | `§14 accès` |
| Pastilles de régions | Menu « Régions » inchangé | `§14 accès` |
| Page Modules | Inchangée, sous la carte | `§14 accès` |
| Note de situation, export, sources et qualité, FR/EN, carte/satellite, zoom, jour/nuit | Inchangés, plus « Note de situation » dans la fiche France | `§14 accès`, `EN` ; ouvrir la note et vérifier les badges L1 |
| Panneaux mobiles en volet | Volets de la fiche (mobile, tablette) | `mobile`, `clavier` à 820 px |

- [ ] **Step 4: Regarder les captures**

Ouvrir `poste-desk-donnees.png`, `poste-laptop-donnees.png`, `poste-tablet-donnees.png`, `poste-mob-donnees.png`, `poste-mob-donnees-onglets.png`, `poste-desk-indisponible.png` et `poste-desk-v1.png`. Attendu (critères §2) : niveau national lisible en mot et en couleur avec « tirée par », changements depuis la visite visibles sans clic, aucun code du moteur, liste et fiche à côté de la carte sans la recouvrir sur ordinateur (hors panneaux par source, étape 3), aucun texte qui déborde à 390 px ; la capture v1 est identique à la production.

- [ ] **Step 5: Gate final**

Run: `npx vitest run && npm run typecheck && npm run lint && npm run build && node scripts/check-generated.mjs`
Expected: tout vert.

Aucun commit dans cette tâche : elle vérifie les tâches 1 à 11. Toute correction trouvée ici fait l'objet d'un commit `fix:` dans la tâche qu'elle concerne, puis la tâche 12 est rejouée.

---

## Relecture du plan contre la spec

| Exigence | Tâche |
|---|---|
| §5.2 bandeau d'état (niveau, tirée par, tendance, visite, fraîcheur, première visite) | 3 (`drivingThemes`, `visitCounts`), 9 (`StatusBar`), 10, 11 |
| §5.3 barre de thèmes avec pastilles | 1, 9 (`ThemeBar`), 10 |
| §5.4 trois colonnes (30 %/300 px, carte, 28 %/340 px) | 11 (CSS) |
| §5 retrait en v2 d'AlertMonitor, convergences, SituationBrief, SituationMonitor, tiroir | 11 (`initMap`, `open-france-intel`) |
| §6.1–6.2 fiche unique, parties dans l'ordre, parties vides omises | 7 (`renderFiche`) |
| §6.3 France (BLUF, jugements, à surveiller, brief redemandé au changement de couleur) | 7, 11 (`isIntelSurfaceVisible`) |
| §6.3 thème, événement ; situation, alerte (arbitrage A1) | 8 |
| §7.1 entrées ; §7.2 tri, plafond 12, ligne, badges ; §7.3 filtre, garde ; §7.4 états | 2, 3, 9 |
| §9 mobile (onglets, volet), tablette (volet), clavier, Échap, focus conservé, mot + couleur | 4, 9, 10, 11 |
| §10 `work-queue.ts`, `components/fiche/*.ts`, `StatusBar`, `ThemeBar`, `WorkList`, `FichePanel`, `?ui=v2` | 1, 2, 3, 7–11 |
| §12 tests unitaires, navigateur aux quatre largeurs et quatre états | toutes ; 12 |
| §14 aucune fonction retirée | A1, 6, 7, 8, 11, 12 (table) |
| Reports de l'étape 1 : sous-scores dans « Pourquoi ce niveau ? », note de situation en L1, mot du niveau dans les lignes | 4 et 8, 5, 4 et 9 |
| §2 aucun score brut hors du volet (y compris jugements du brief de repli) | 4, 7, 8 ; contrôle `scoreOutsideWhy` (12) |
| Aucun niveau affiché avant les données (A13) | 9, 10, 11 |

Le plan a été rejoué intégralement sur une copie de `main` (474755ae) hors du dépôt : chaque tâche appliquée dans l'ordre compile (`tsc --noEmit`), ses tests passent, puis la suite complète passe (95 fichiers, 770 tests), `eslint src/` et `npm run build` sont propres, et le contrôleur sort dans un chunk `PosteSituation-*.js` distinct (46 ko). Le script de la tâche 12 a été exécuté sur cette copie (scénario `donnees` aux quatre largeurs, `retour` et `v1` à 1 440 px, `indisponible` à 1 440 et 390 px) : toutes les attentes listées ci-dessus sont satisfaites. Ce rejeu a fait apparaître trois défauts corrigés dans le plan : le vert affiché avant le chargement (A13), le chevauchement de l'en-tête à 390 px (A14) et les sous-scores recopiés par le brief de repli (tâche 4).

Cohérence des noms vérifiée entre tâches : `buildWorkQueue`, `viewWorkQueue`, `drivingThemes`, `visitCounts`, `levelsForBaseline`, `marketLines`, `officialTitle`, `officialTheme`, `officialSourceName` (tâches 2–3, consommés en 7–10) ; `renderFiche`, `FicheModel`, `nothingToHandleText`, `digestChangeText` (7, consommés en 8–10) ; `FranceFicheSnapshot` (7, consommé en 10) ; `trendText`, `renderWhyBody`, blocs (6, consommés en 7, 8, 10) ; `beginVisitBaseline`, `recordVisitBaseline` (1, consommés en 11) ; `PosteSituation.setTheme(id, { silent })`, `select('france')`, `setEvents`, `setBrief`, `setBriefPending`, `setResolved`, `setBaseline`, `currentLevels` (10, consommés en 11) ; `StatusPanel.getSources` (11).
