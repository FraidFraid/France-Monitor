# Spec — Historique multi-jours de la situation globale France

**Date :** 2026-04-10
**Statut :** Validé — prêt pour implémentation
**Version spec :** 1.0

---

## 1. Contexte et objectif

France Monitor affiche aujourd'hui la situation nationale comme un état instantané : score CII, situations actives, axes par domaine. Il n'existe aucune mémoire de l'évolution dans le temps.

Cette spec décrit la fonctionnalité d'**historique multi-jours de la situation globale France** : un système qui capture des instantanés périodiques de l'état national, les stocke côté serveur, les met en cache côté client, et les expose dans un nouveau panel analytique.

**Objectifs produit :**
- Permettre une lecture rétrospective sur 7 jours (vue standard) et jusqu'à 30 jours (vue analytique)
- Comprendre les dynamiques de la situation nationale : aggravations, accalmies, séquences marquantes
- Identifier quels signaux ont le plus contribué aux variations
- Distinguer explicitement état courant, états passés, variations et événements explicatifs

**Ce que ce système n'est pas :**
- Un système de replay temps réel (pas de rejoue minute par minute)
- Un système de journalisation exhaustif (pas de stockage de l'état applicatif complet)
- Un système d'alerting historique (pas de notifications sur des seuils passés)

---

## 2. Décisions structurantes

| Dimension | Décision retenue |
|---|---|
| Horizon | 7 jours par défaut, 30 jours max |
| Granularité | 4 snapshots/jour : 00h, 06h, 12h, 18h UTC |
| Stratégie d'écriture | Lazy-write (Approche B) — écrit au premier appel client d'un slot |
| Source de vérité | Serveur (Upstash Redis) |
| Cache lecture | Client (localStorage, V1) |
| Richesse des snapshots | Niveau intermédiaire (score + axes + situations résumées) |

---

## 3. Modèle de données

### 3.1 SituationSnapshot

Chaque snapshot capture l'état national au moment d'un slot. Format JSON stocké dans Redis.

```
SituationSnapshot {
  version:     number          // entier, commence à 1 — permet la migration future du format

  slotKey:     string          // identifiant canonique du slot, UTC, ex: "2026-04-10T12:00"
                               // calculé côté serveur uniquement
  capturedAt:  string          // ISO8601 exact de la capture (peut différer de slotKey de quelques min)

  score:       number          // Score CII global 0–100

  axes: {
    energy:    number | null   // 0–100, null si source absente ou périmée
    cyber:     number | null
    social:    number | null
    infra:     number | null
    weather:   number | null
    transport: number | null
  }

  situations: Array<{
    id:            string      // slug stable, indépendant du wording, ex: "energy-stress"
    type:          string      // SituationType
    severity:      string      // "critical" | "high" | "medium" | "watch"
    title:         string      // titre court normalisé
    topDriver:     string      // premier driver, court (~60 chars max), normalisé
    affectedZones: string[]    // max 3 zones — règle : 3 premières zones des situations
                               // les plus sévères, ordre stable (sévérité desc, alpha)
    confidence:    number      // 0–1
  }>

  meta: {
    totalSituations: number
    maxSeverity:     string | null   // sévérité maximale parmi les situations actives, ou null
    avgConfidence:   number          // moyenne des confidences des situations actives
                                     // méthode : somme / count, 0 si aucune situation
  }

  dataStatus: {
    overall:   "ok" | "degraded"     // "degraded" si au moins un axe est null
    sources: {
      // Correspondance explicite source → axe(s) alimenté(s) :
      // energy    → axes.energy
      // cyber     → axes.cyber
      // stability → axes.social (données ISNR)
      // meteo     → axes.weather
      // network   → axes.infra + axes.transport
      energy:    "ok" | "missing"
      cyber:     "ok" | "missing"
      stability: "ok" | "missing"
      meteo:     "ok" | "missing"
      network:   "ok" | "missing"
    }
  }
}
```

**Taille estimée :** 3–8 KB par snapshot selon le nombre de situations actives.
**Sur 30 jours × 4 slots = 120 snapshots :** ~360 KB–1 MB. Confortable pour Redis et localStorage.

### 3.2 Sémantique des états de slot

| État | Définition | Représentation |
|---|---|---|
| `captured / ok` | Snapshot capturé, toutes les sources présentes | Barre pleine, couleur de sévérité |
| `captured / degraded` | Snapshot capturé, mais au moins un axe `null` (source manquante à la capture) | Barre pleine + indicateur discret de dégradation |
| `missing` | Aucun visiteur pendant ce slot de 6h — slot jamais écrit dans Redis | Marqueur visible (tiret pointillé), jamais une barre à zéro |

Un slot `missing` n'est **jamais** interprété comme une amélioration de la situation. C'est une absence de donnée, assumée et affichée comme telle.

### 3.3 Clé de slot

La `slotKey` est déterminée côté serveur à partir du timestamp UTC courant. Les slots légitimes sont `00:00`, `06:00`, `12:00`, `18:00`. On prend le slot passé le plus récent.

Exemples :
- 14h23 → `slotKey = "2026-04-10T12:00"`
- 05h58 → `slotKey = "2026-04-10T00:00"`
- 00h01 → `slotKey = "2026-04-10T00:00"`

### 3.4 Stockage Redis

- **Snapshots :** clé individuelle `france:history:{slotKey}` → JSON du snapshot, TTL 31 jours (nettoyage automatique)
- **Index :** clé `france:history:index` → Redis list ordonnée des `slotKey` écrits (RPUSH à l'écriture, LTRIM à 120 éléments max)

L'index est un accélérateur de lecture, pas la source de vérité pour la timeline. La grille canonique est toujours reconstruite côté serveur indépendamment de l'index.

---

## 4. Architecture serveur

### 4.1 Route : `api/situation-history.js`

**Méthode :** GET
**Paramètre :** `days` — valeur strictement limitée à `7` ou `30` en V1. Toute autre valeur retourne 400.

**Comportement séquentiel à chaque appel :**

1. **Calcul du slot courant** : détermine la `slotKey` du slot actif (voir règle en section 3.3).

2. **Vérification du slot** : `GET france:history:{slotKey}`.
   - Si le slot existe déjà → aller directement à l'étape 4 (pas de construction).
   - Si absent → continuer à l'étape 3.

3. **Construction et écriture du snapshot** :
   - Lire les caches Redis source (voir section 4.5 pour les clés et règles de fraîcheur).
   - Construire le snapshot complet (`version`, `score`, `axes`, `situations`, `dataStatus`).
   - `SET france:history:{slotKey} {snapshot} NX EX 2678400` (31 jours en secondes).
   - Si NX échoue (écriture concurrente gagnante) : ignorer silencieusement. Les deux snapshots construits en concurrence dans le même slot sont équivalents (mêmes sources Redis dans la même fenêtre de 6h).
   - `RPUSH france:history:index {slotKey}` + `LTRIM france:history:index 0 119`.

4. **Construction de la grille canonique** : générer la liste exhaustive des `slotKey` attendus pour la période (voir section 4.3 pour la définition exacte de la fenêtre temporelle), indépendamment de l'index Redis.

5. **MGET groupé** : récupérer tous les snapshots de la grille en une seule commande Redis.

6. **Projection** : chaque `slotKey` absent du MGET devient `{ slotKey, status: "missing" }`.

7. **Retour** de la réponse structurée.

**Structure de réponse :**

```
{
  requestedRange: {
    from:  string    // ISO8601, début de la période
    to:    string    // ISO8601, fin de la période (slot courant)
  }
  slotCount: {
    expected:  number   // nombre de slots théoriques dans la période
    captured:  number   // slots avec un snapshot
    missing:   number   // slots sans snapshot
    degraded:  number   // snapshots avec dataStatus.overall = "degraded"
  }
  slots: Array<SituationSnapshot | { slotKey: string, status: "missing" }>
}
```

Les slots sont ordonnés chronologiquement, du plus ancien au plus récent.

### 4.2 Idempotence et concurrence

Deux appels simultanés dans le même slot peuvent tous deux passer l'étape GET (slot absent), construire un snapshot et tenter `SET NX`. Le premier gagne, le second est ignoré silencieusement. Les deux snapshots sont équivalents car construits depuis les mêmes caches Redis dans la même fenêtre de 6h. Aucun lock distribué nécessaire.

### 4.3 Définition exacte de la fenêtre temporelle

La fenêtre est toujours exprimée en **nombre de slots UTC**, en remontant depuis le slot courant inclus.

- **7 jours** = les 28 derniers slots, de `currentSlot - 27×6h` à `currentSlot` inclus
- **30 jours** = les 120 derniers slots, de `currentSlot - 119×6h` à `currentSlot` inclus

Les bornes sont **toujours alignées sur la grille UTC** (00h, 06h, 12h, 18h). La notion de "jour calendaire" n'intervient que dans l'agrégation visuelle 30j côté UI, non dans le calcul serveur. Le `slotCount.expected` est donc toujours exactement 28 ou 120.

Pour l'agrégation journalière en vue 30j : un slot appartient au jour UTC dans lequel tombe sa `slotKey` (ex: `2026-04-10T00:00` → jour UTC `2026-04-10`).

### 4.4 Ce que cette route ne fait pas

- Elle ne recompute pas les données brutes : elle lit uniquement les caches Redis existants
- Elle ne déclenche aucun appel API externe
- Elle ne s'auto-déclenche pas : elle est toujours initiée par un client
- Elle n'est pas couplée au brief IA ni à aucun autre service applicatif

### 4.5 Sources Redis — clés, fraîcheur et règle de présence

Le snapshot construit en étape 3 lit les caches Redis déjà écrits par les proxies existants. L'implémenteur doit identifier les clés exactes en inspectant les handlers `api/` et plugins correspondants. La règle de présence est uniforme :

> **Une source est `"ok"` si sa clé Redis existe et a été écrite il y a moins de `maxAge` minutes. Sinon elle est `"missing"` et l'axe correspondant est `null`.**

| Source (`dataStatus.sources`) | Axe(s) alimenté(s) | `maxAge` retenu |
|---|---|---|
| `energy` | `axes.energy` | 45 min |
| `cyber` | `axes.cyber` | 90 min |
| `stability` | `axes.social` | 45 min |
| `meteo` | `axes.weather` | 45 min |
| `network` | `axes.infra` + `axes.transport` | 45 min |

Les `maxAge` sont des seuils de présence, pas des TTL Redis. Une donnée peut être plus ancienne que `maxAge` tout en étant encore valide dans Redis — elle est simplement considérée trop périmée pour un snapshot de qualité. Si une source est `"missing"`, l'axe est `null` et `dataStatus.overall` passe à `"degraded"`.

**Note pour l'implémenteur :** au moment de l'étape 3, lire la clé Redis source et vérifier son champ `updatedAt` ou `fetchedAt` (selon la structure de chaque cache). Si absent ou trop ancien → source manquante. Ne pas forcer de rafraîchissement.

### 4.6 Migration future vers Cron (Approche A)

Si la complétude des slots devient critique (trafic insuffisant la nuit, besoin de garantir les 4 slots/jour), la migration vers une Vercel Cron Function est directe : le modèle de snapshot ne change pas, seul le déclencheur de l'écriture change. La route `api/situation-history.js` reste identique pour la lecture.

---

## 5. Architecture client

### 5.1 Service : `src/services/situation-history.ts`

Responsabilité unique : fournir l'historique à l'UI en gérant la transparence entre cache local et serveur.

**Fonction principale :**

```
getHistory(days: 7 | 30, force?: boolean): Promise<HistoryResult>
```

**Flux interne :**

1. Si `force` est `false` (défaut) : vérifier le cache localStorage (`fm:situation-history:7j` ou `fm:situation-history:30j`)
2. Si le cache existe et a moins de 20 minutes → retourner directement (`source: "cached"`)
3. Sinon : appeler `/api/situation-history?days=N`
4. Si succès : mettre à jour le cache localStorage, retourner (`source: "fresh"`)
5. Si échec réseau ET cache expiré disponible : retourner le cache expiré (`source: "stale"`, `errorRecoveredFromCache: true`)
6. Si `force: true` : ignorer la durée de fraîcheur du cache, forcer l'appel réseau

**Contrat de retour `HistoryResult` :**

```
{
  data:                    HistoryResponse   // requestedRange + slotCount + slots[]
  source:                  "fresh"           // appel réseau réussi
                         | "cached"          // cache local frais (< 20 min)
                         | "stale"           // cache local expiré, utilisé en fallback
  fetchedAt:               string            // ISO8601 de la dernière récupération
  isDegraded:              boolean           // true si ≥1 slot missing ou degraded dans data
  errorRecoveredFromCache: boolean           // true si fallback sur cache expiré
}
```

**Distinction importante :** `source` décrit la fraîcheur du cache client. `isDegraded` et les statuts de slots décrivent la qualité des snapshots eux-mêmes. Ces deux dimensions sont indépendantes et ne doivent jamais être mélangées.

**Structure du cache localStorage :**

```
fm:situation-history:v1:7j  →  { fetchedAt: string, schemaVersion: 1, days: 7, response: HistoryResponse }
fm:situation-history:v1:30j →  { fetchedAt: string, schemaVersion: 1, days: 30, response: HistoryResponse }
```

La version de schéma est encodée dans la clé (`v1`). Lors d'un changement de `SituationSnapshot.version`, la clé localStorage change de préfixe (`v2`, etc.). L'ancienne clé est ignorée et peut être supprimée au premier accès (`localStorage.removeItem`). Aucune migration de données n'est effectuée : en cas de changement de schéma, le client recharge depuis le serveur.

**Règle de lecture :** si la clé attendue est absente, ou si `schemaVersion` dans le cache ne correspond pas à la version courante, le cache est considéré invalide et un appel réseau est déclenché.

**Durée de fraîcheur :** 20 minutes. Un slot de 6h change au plus toutes les 6h ; 20 minutes est un équilibre entre réactivité et économie de requêtes.

**Note de migration :** localStorage est retenu pour la V1. Si la taille des réponses devient problématique (montée en richesse du modèle), la migration vers IndexedDB est possible sans changer l'interface du service.

### 5.2 Intégration dans App.ts

- Chargement **lazy** : le service est appelé uniquement à l'ouverture du `SituationHistoryPanel`, pas au démarrage de l'app
- **Pas de polling** : l'historique est consulté sur demande
- Le refresh est déclenché uniquement par action utilisateur explicite (bouton Actualiser)

---

## 6. UI/UX

### 6.1 Positionnement

Un nouveau panel flottant **`SituationHistoryPanel`**, distinct du `SituationMonitor` (qui reste l'état instantané). Ouverture sur action explicite uniquement (bouton dans `SituationMonitor` ou `LayerPanel`). Fermable. Non affiché par défaut.

**Séparation des responsabilités :**
- `SituationMonitor` → état courant, opérationnel, toujours visible
- `SituationHistoryPanel` → lecture analytique rétrospective, ouvert à la demande

### 6.2 Vue 7 jours (défaut)

**Timeline de barres verticales**, une par slot (28 barres max sur 7 jours).

Propriétés de chaque barre :
- **Hauteur** : proportionnelle au score CII (0–100)
- **Couleur** : sévérité maximale du slot (`critical` rouge, `high` orange, `medium` jaune, `watch` bleu)
- **Slot `missing`** : espace vide avec un marqueur de tiret pointillé centré visible — jamais une barre à zéro (ambiguë avec un CII réel bas)
- **Slot `degraded`** : barre affichée normalement, avec une bande hachurée de 2px en bas de barre
- **Slot courant** : barre légèrement plus large, contour sobre lumineux

Organisation visuelle : les 4 barres d'un même jour sont regroupées sous une étiquette de date (`Lun 07`, `Mar 08`…), séparées par un gap fin entre barres et un gap plus large entre jours. Sur faible largeur (mobile), les labels de dates sont réduits ou espacés pour préserver la lisibilité.

### 6.3 Vue 30 jours

Même structure, avec **agrégation journalière** : les 4 slots d'une journée sont réduits à 1 barre.

Règles d'agrégation :
- **0 slot capturé** → journée `missing`, espace vide avec ligne pointillée à mi-hauteur (marqueur visible, jamais de blanc silencieux)
- **1–3 slots capturés sur 4** → barre affichée avec bande hachurée de 2px indiquant la partialité, valeurs calculées sur les slots capturés uniquement
- **4 slots capturés** → barre pleine ; indicateur `degraded` discret si au moins un slot l'est

**Hauteur de barre (CII agrégé) :** moyenne des scores CII des slots capturés de la journée. Ce choix assume que la hauteur traduit le niveau global de la journée, non son pic. Une journée avec un pic court et trois slots calmes apparaîtra à hauteur modérée.

**Couleur de barre (sévérité) :** sévérité maximale parmi les slots capturés. La couleur capture le pire événement de la journée même si la hauteur est basse. Ces deux dimensions sont délibérément indépendantes : couleur = signal d'alerte, hauteur = niveau ambiant.

Ce choix est un arbitrage produit assumé. Il n'est pas modifiable par configuration en V1.

### 6.4 Interactions

**Survol d'une barre (tooltip) :**
```
Mer 09 avril — 12h00
CII : 67/100  ·  ÉLEVÉ

Situations actives :
⚡ Tension énergétique — Ecowatt orange, Grand Est
🌊 Crise hydrologique — 2 tronçons rouges, Rhône
+1 autre
```
Maximum 2 situations affichées, `+N autres` si besoin. Le tooltip reste strictement synthétique.

**Clic sur une barre (vue détaillée inline) :**
Vue complète s'ouvre sous le graphe : liste exhaustive des situations du slot, chacune avec sévérité, driver principal et zones affectées. Deuxième clic sur la même barre ferme la vue.

### 6.5 Toggle et navigation

- Toggle `7j | 30j` en haut à droite du panel
- Changer de vue ne recharge pas depuis le réseau si le cache 30j est frais
- Bouton **Actualiser** en haut à droite : refresh forcé, bypass du cache

### 6.6 Indicateurs de qualité (pied de panel)

Ligne basse discrète :
- `Source : serveur · il y a 4 min` ou `Cache local · 23 min`
- Si `isDegraded` : `⚠ Historique partiel — N slots non capturés`
- Si `errorRecoveredFromCache` : `Réseau indisponible — données locales`

### 6.7 Ce que l'UI ne fait pas en V1

- Pas de zoom interactif sur la timeline
- Pas d'export
- Pas de comparaison entre deux périodes
- Pas d'annotation manuelle

---

## 7. Stratégie d'implémentation par étapes

### Étape 1 — Fondations : modèle + endpoint serveur

**Périmètre :** backend uniquement, aucun changement UI.

- Ajouter le type `SituationSnapshot` et `HistoryResponse` dans `src/types/index.ts`
- Écrire `api/situation-history.js` : calcul du slot canonique, écriture NX, grille théorique, MGET, réponse structurée
- Écrire la fonction de construction du snapshot depuis les caches Redis existants

**Critère de sortie :** l'endpoint répond correctement avec la grille complète, les snapshots s'accumulent dans Redis, l'idempotence est vérifiée, les slots `missing` sont explicites dans la réponse.

### Étape 2 — Service client + cache

**Périmètre :** `src/services/situation-history.ts`, pas encore d'UI.

- Implémenter `getHistory(days, force?)` avec le contrat complet
- Gestion du cache localStorage, fraîcheur 20 min
- Fallback sur cache expiré si réseau indisponible
- Exposition de `source`, `fetchedAt`, `isDegraded`, `errorRecoveredFromCache`

**Critère de sortie :** le service est testable depuis la console ou `App.ts`, le cache se remplit, le fallback fonctionne hors réseau.

### Étape 3 — Panel UI

**Périmètre :** `src/components/SituationHistoryPanel.ts` + intégration dans `App.ts`.

- Rendu de la timeline 7j : barres, couleurs de sévérité, slots `missing` et `degraded`
- Toggle 7j/30j avec agrégation journalière
- Tooltip au survol (max 2 situations + `+N autres`)
- Vue détaillée inline au clic
- Indicateurs de qualité en pied de panel
- Bouton Actualiser (refresh forcé)
- Point d'entrée : bouton d'ouverture dans `SituationMonitor` ou `LayerPanel`

**Critère de sortie :** panel ouvrable/fermable, timeline lisible, états `missing`/`degraded`/`captured` distincts visuellement, qualité des données affichée.

---

## 8. Risques et arbitrages

| Risque | Probabilité | Impact | Mitigation |
|---|---|---|---|
| Sources Redis vides au moment du slot (données pas encore fraîches) | Moyen | Moyen | Axes `null` + `dataStatus: degraded` — assumé dans le modèle |
| Slots manquants la nuit (peu de trafic à 00h) | Élevé au départ | Faible | Assumé et affiché explicitement. S'améliore avec le trafic. Migration Cron possible sans changer le modèle. |
| localStorage quota insuffisant si le modèle grossit | Faible | Moyen | Clés séparées 7j/30j, TTL cache court. Migration IndexedDB prévue sans changement d'interface. |
| Race condition sur l'écriture Redis | Faible | Faible | SET NX — idempotent par design |
| Dérive du format snapshot entre versions | Moyen (long terme) | Élevé | Champ `version` à la racine, migration lazy à la lecture |
| Vue 30j trop agressive dans l'agrégation | Faible | Moyen | Règle d'agrégation verrouillée dans la spec, indicateurs de partialité systématiques |

**Arbitrage central :** l'historique ne sera jamais complet à 100% en lazy-write. C'est un choix délibéré, pas un bug. L'UI l'affiche clairement. Si la complétude devient un besoin critique, la migration vers une Cron Vercel (Approche A) est directe — le modèle de données ne change pas.

---

## 9. Hors scope V1

- Vercel Cron Function (Approche A) — prévu comme migration, pas en V1
- Export CSV ou JSON de l'historique
- Comparaison de deux périodes
- Annotations manuelles sur la timeline
- Alerting basé sur des seuils historiques
- Accès multi-utilisateur ou API publique de l'historique
