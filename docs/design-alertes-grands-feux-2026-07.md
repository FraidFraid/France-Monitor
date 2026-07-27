# Alertes « grands feux » — dossier d'incident OSINT

**Date** : 2026-07-27
**Statut** : design validé, plan d’implémentation à écrire
**Déclencheur** : épisode de feux en Gironde (juillet 2026). Le dashboard voyait le feu
mais ne savait pas ce qu'il détruisait.

---

## 1. Problème

FIRMS/VIIRS mesure la **détection** : où ça brûle, à quelle intensité radiative. Il ne peut
structurellement pas fournir l'**impact** — hectares, évacuations, habitations détruites sont
des faits *administratifs*, produits par la préfecture, le SDIS et relayés par la presse.

Sans cette couche d'impact, un événement reste une anomalie thermique. C'est le passage à
l'impact qui en fait un événement exploitable en OSINT.

### 1.1 L'impact n'est pas inférable de l'intensité

Mesuré sur l'épisode de référence (§11), et c'est le fait qui justifie toute la feature :

| commune | détections | FRP | maisons détruites |
|---|---|---|---|
| Saint-Jean-d'Illac | 118 (16 %) | **2 114 MW** | non citée |
| Le Porge | 15 (2 %) | **48 MW** | **175** |

Le Porge concentre **175 des ~200 bâtiments détruits** avec **44 fois moins d'énergie radiative**
que Saint-Jean-d'Illac, qui n'apparaît pas au bilan des habitations.

**L'intensité satellite et le dommage humain sont décorrélés.** La couche d'impact n'est donc pas
un enrichissement cosmétique : elle est **non-inférable** depuis les données dont on dispose déjà.
Aucun raffinement du scoring FIRMS ne la remplacera.

Corollaire de conception : le dossier ne doit **jamais** laisser croire qu'une intensité élevée
implique des dégâts élevés. Les blocs « détection » et « impacts déclarés » restent visuellement
séparés, et le `severityScore` FIRMS n'est jamais présenté comme une mesure de gravité humaine.

### 1.2 État des lieux constaté dans le dépôt

Ce qui existe et qui est solide :

- `src/services/fire-clustering.ts` — DBSCAN (eps 3 km, minPoints 2) sur les détections VIIRS,
  produit des `FireIncident` avec centroïde pondéré FRP, bbox, persistance, `nearUrban`,
  `severityScore` / `impactScore`. Vivant : `FiresPanel.ts` affiche déjà la liste des incidents.
- `api/ingest/news.ts` — cron 15 min : sync feeds → parse RSS → classification keyword →
  géocodage BAN (`api/_lib/server-geocoder.js`) → INSERT Neon dédupliqué.
- `AlertMonitor.ts` — overlay d'alertes non bloquant, avec **déjà** un flux clic → détail
  (`AlertMonitor.ts:165`).

Ce qui manque, et qui explique le ressenti sur la Gironde :

1. **`detectWildfireEscalation` (`situation-engine.ts:245`) n'utilise pas les incidents.**
   Il compte `raw.activeFires.length` au national et pose `affectedZones: ['France']`.
2. **Aucun hectare dans tout le dépôt.** `grep -i "hectare|areaHa|burned"` ne renvoie rien.
3. **Aucune source préfecture.** La whitelist `scrapling-proxy` compte 11 domaines, aucun
   `.gouv.fr` préfectoral.
4. **Aucune historisation des feux.** Neon ne contient que `feeds` et `news_items`. FIRMS est
   en fenêtre 24 h (`SUOMI_VIIRS_C2_Europe_24h.csv`) : un épisode passé n'est pas rejouable.

### 1.3 Le capteur national est saturé

Mesuré le 2026-07-26 sur les données réelles : `activeFires.length = 886` pour la France
métropole, très au-dessus du seuil `critical` de 20 du détecteur actuel.

**En pleine saison des feux, `WILDFIRE_ESCALATION` est donc épinglé en permanence sur
`critical` avec `affectedZones: ['France']`.** Une alerte toujours allumée qui ne dit pas où
est pire qu'un faux positif : c'est un capteur inutilisable.

---

## 2. Décisions actées

| Décision | Choix | Raison |
|---|---|---|
| Unité de l'alerte | **Incident localisé** (`FireIncident`), rattaché à ses départements | Réutilise le clustering déjà en place ; supprime la saturation nationale |
| Extraction des chiffres | **Hybride** : patterns déterministes d'abord, Ollama local en secours | Calque de `classifier.ts` / `ai-classifier.ts` ; auditable par défaut |
| Surfacing | **Alerte non bloquante** dans `AlertMonitor` + dossier au clic | Posture de veille : la carte reste visible, l'analyste ouvre quand il décide |
| Répartition | **Extraction serveur, jointure et LLM client** | Voir §2.1 |
| Préfectures | **Étage 2**, non bloquant pour la V1 | La PQR coule déjà (`Sud Ouest` dans `feeds.ts`) |

### 2.1 Pourquoi l'extraction est serveur et le LLM client

Deux contraintes se combinent et déterminent la répartition :

- **La trace des révisions est un actif OSINT.** « 7 400 ha à 18 h 30 → 9 200 ha à 22 h 15 »
  est souvent plus informatif que le dernier chiffre. L'avoir exige une persistance partagée,
  donc le serveur. Une extraction purement client ferait refaire le travail à chaque analyste
  sans mémoire.
- **Une fonction Vercel ne peut pas joindre l'Ollama local de l'analyste.** Un étage LLM
  serveur signifierait Groq, donc cloud. Or les communiqués préfectoraux nomment communes,
  lieux-dits et parfois des personnes : `CLAUDE.md` interdit l'envoi de PII vers un LLM cloud.

D'où : **patterns déterministes côté serveur** (là où le texte est déjà géocodé et dédupliqué),
**Ollama côté client** et uniquement à l'ouverture d'un dossier. La contrainte de
confidentialité est respectée *par construction*, pas par discipline.

### 2.2 Sources d'impact — ce qui a été vérifié

Sondé le 2026-07-27 :

| Source | Résultat | Conséquence |
|---|---|---|
| `gironde.gouv.fr` | HTTP 200, **aucun `Access-Control-Allow-Origin`** | Proxy obligatoire depuis le navigateur |
| RSS préfecture | **404** sur `/rss.xml`, `/feed/rss`, `/Actualites/rss` ; `?page=rss` renvoie du HTML | Préfecture = scraping HTML, pas RSS |
| EFFIS WFS `ms:modis.ba.poly` | **503** sur GeoJSON *et* sur l'URL officiellement documentée | Jamais en dépendance dure |

**EFFIS ne fournira pas le chiffre temps réel.** La couche est MODIS (résolution grossière) et
cartographie la surface brûlée de façon *rétrospective*. Elle sert au périmètre consolidé
a posteriori, en best-effort.

Conséquence : le chiffre « X hectares, Y évacués » à H+2 n'existe **que** dans la communication
préfecture/SDIS et la presse.

---

## 3. Modèle de données

### 3.1 `ImpactFact` — persisté, jamais modifié

L'unité est **le fait déclaré, pas le nombre**. Un fait peut être qualitatif : voir §3.4.

| champ | rôle |
|---|---|
| `kind` | voir tableau ci-dessous |
| `value`, `unit` | valeur brute — **optionnels** (un ordre d'évacuation n'a pas de valeur) |
| `quote` | **phrase source verbatim** |
| `sourceUrl`, `sourceName` | provenance |
| `sourceLevel` | `primary` \| `secondary` \| `tertiary` — §12.2 |
| `reliability` | `A`–`F`, **dérivée** de `tier` + métriques observées — §12.1 |
| `credibility` | `1`–`6`, propre à ce fait — §12.1 |
| `corroboration` | sources indépendantes affirmant le même fait — §12.3 |
| `observedAt` | horodatage de la *déclaration* (pas de l'ingestion) |
| `deptCode` | rattachement géographique |
| `communes` | communes nommées dans la source, si présentes |
| `method` | `pattern` \| `llm` — traçabilité de l'extraction |
| `provisional` | `true` tant qu'aucune source primaire n'a publié de bilan clos — §12.6 |

Genres de faits :

| `kind` | chiffré ? | source typique |
|---|---|---|
| `area_ha` | oui | presse |
| `evacuated` | oui | presse |
| `dwellings_destroyed` | oui | presse |
| `injured` | oui | presse |
| `evacuation_order` | **non** | **préfecture** (FR-Alert, arrêté) |
| `road_closed` | non (ou km) | préfecture, presse |
| `rail_disrupted` | non | opérateur, presse |

Table Neon `fire_impact_facts`. **Aucun `UPDATE` : chaque révision est une nouvelle ligne.**
C'est ce qui produit la chronologie des révisions — et ce qui rend impossible, par construction,
la réconciliation prohibée au §12.4.

### 3.2 `WildfireDossier` — client, dérivé, jamais persisté

```
FireIncident (existant, FIRMS)  ─┐
département/communes (BAN)      ─┼─→ WildfireDossier
ImpactFact[] (serveur)          ─┘
```

### 3.3 Règle de provenance

Un `ImpactFact` sans `quote` + `sourceUrl` + `observedAt` **n'est pas affichable**. La règle est
portée par le type, pas par le composant de rendu : structurellement impossible à contourner.

Motif : un chiffre d'hectares en cours de feu est une **déclaration datée et sourcée**, pas une
mesure. Il est révisé en permanence, parfois à la baisse. Afficher un nombre nu qui ferait
autorité fabrique de la fausse précision — pire que pas de chiffre.

### 3.4 Un fait sans chiffre reste un fait

Constat de terrain (§11) : le communiqué préfectoral du 25/07/2026 nomme les communes évacuées
et ordonne FR-Alert, mais **ne contient aucun nombre**.

La préfecture est autoritaire sur les **ordres et la géographie** ; les chiffres viennent de la
presse. Un extracteur qui n'accepterait que des faits chiffrés jetterait donc la source la plus
fiable. D'où `value` optionnel et le genre `evacuation_order`.

### 3.5 Un incident peut couvrir plusieurs départements

L'épisode de référence a touché la Gironde (33) **et** les Landes (40) — 3 500 ha et 40 000
évacués côté Landes. Un `WildfireDossier` porte donc une **liste** de départements et peut
agréger des faits provenant de plusieurs préfectures. Pas de champ `deptCode` unique au niveau
du dossier.

---

## 4. Seuils « grand feu »

Portés par l'incident, pas par le national :

```
porte d'entrée : detectionsCount >= 40  ET  frpTotal >= 300 MW

critical : detectionsCount >= 300  OU  (frpTotal >= 3000 ET nearUrban)
high     : detectionsCount >= 100  OU  frpTotal >= 1500
medium   : au-dessus de la porte d'entrée
```

### 4.1 Calibration empirique

Données réelles VIIRS 24 h du 2026-07-26 (2 975 détections Europe, 886 France métropole),
clusterisées avec eps 3 km / minPoints 2 :

| rang | détections | FRP total | zone | verdict attendu |
|---|---|---|---|---|
| 1 | 650 | 7 178 MW | Gironde, front principal | `critical` |
| 2 | 57 | 488 MW | Gironde, second front | `medium` (retenu) |
| 3 | 22 | 361 MW | ailleurs | écarté |

Le plus gros cluster hors Gironde plafonne à **22 détections**. L'écart avec 650 est tel que
tout seuil entre 30 et 500 sépare proprement.

Le total clusterisé en Gironde (650 + 57 + un résidu de petits clusters) est inférieur aux 734
détections de la bbox : la différence part en bruit DBSCAN et en clusters sous `minPoints`.
Les deux chiffres ne se contredisent pas, ils comptent deux choses différentes.

Signature comparée Gironde / reste de la France :

| | Gironde | Reste France |
|---|---|---|
| détections | 734 | 152 |
| FRP total | 7 779 MW | 838 MW |
| FRP médian | 4,49 MW | 1,59 MW |
| étendue | 66 × 48 km | 1 130 × 1 173 km |
| confiance `high` | 27 | 1 |

**Le discriminant est la densité spatiale, pas l'intensité par point** (4,49 vs 1,59 MW, à peine
2,8×). C'est exactement ce que le DBSCAN existant capture.

### 4.2 Réserve sur la calibration

Ces chiffres proviennent d'une **réimplémentation Python** de DBSCAN utilisée pour l'analyse,
pas de `clusterFireDetections`. Le test de contrat (§7) doit rejouer la fixture à travers
**l'implémentation réelle** et verrouiller les cibles.

Comme pour `france-country-intel.test.ts` : **on n'ajuste jamais les cibles du test pour faire
passer un changement de formule.**

### 4.3 Fixture de calibration

`src/services/__fixtures__/gironde-2026-07-26-viirs.json` — 734 détections VIIRS de la bbox
Gironde, capturées le 2026-07-27 avant expiration de la fenêtre 24 h.

Cette donnée est **irremplaçable** : sans historisation côté serveur, un épisode passé n'est
pas rejouable. Ne pas la supprimer.

**Limite critique — la fixture est une traîne, pas un pic.** Le feu s'est déclaré le 22 juillet
et atteignait 42 000 ha le 26 au matin. La capture du 26 photographie donc la **phase
déclinante**, à J+4, pas le pic des 24-25 juillet.

Deux conséquences :

- La calibration est **conservatrice** : 650 détections en phase déclinante confirment que la
  porte à 40 est très sûre. Un pic serait nettement au-dessus.
- **On ne sait pas à quoi ressemble un pic.** La fenêtre FIRMS de 24 h l'a manqué. C'est
  l'argument décisif du §9.1.

---

## 5. Flux

### 5.1 Serveur

Extension de `api/ingest/news.ts` (cron 15 min) : après l'INSERT, une passe d'extraction
déterministe → `fire_impact_facts`.

**Déclenchement de l'extraction** — un item y passe si son texte correspond à un lexique feu
(`incendie`, `feu de forêt`, `feux`, `hectares brûlés`, `sinistre`…). Volontairement **pas** de
filtrage par département côté serveur : le serveur ignore les `FireIncident`, qui sont calculés
côté client. La jointure géographique se fait plus tard, par `deptCode`, au moment d'assembler
le dossier. Cette séparation garde le cron indépendant de l'état client.

Nouveau `api/_lib/impact-extractor.js` — fonctions pures, testables sans réseau ni base.

Nouvel endpoint `GET /api/fires/impacts?dept=33&since=…`.

### 5.2 Client

Nouveau `src/services/wildfire-dossier.ts` :

| fonction | nature | rôle |
|---|---|---|
| `selectMajorIncidents(incidents)` | **pure** | applique les seuils du §4 |
| `buildDossier(incident, facts)` | **pure** | assemble détection + localisation + impacts |
| `enrichWithLlm(dossier)` | effet de bord | Ollama, **uniquement à l'ouverture du modal** |

Découpage volontaire : les deux fonctions pures portent toute la logique décidable et se testent
sans réseau ; le LLM est isolé au bord, là où il est optionnel et non déterministe.

### 5.3 Refactorisation du détecteur

`detectWildfireEscalation` émet une `DetectedSituation` **par incident majeur**, avec
`affectedZones: ['Gironde']` au lieu de `['France']`. Corrige la saturation du §1.3.

---

## 6. Composants UI

### 6.1 `AlertMonitor` — un seul point d'extension

Hook optionnel `onOpenDossier?: (s: DetectedSituation) => boolean`. S'il renvoie `true`, le
détail intégré est court-circuité. Trois lignes de changement, **zéro duplication** du rendu
existant.

### 6.2 `WildfireDossierModal` — nouveau

Suit la forme de `SentinelModal` : overlay, clic extérieur, `Escape`, `destroy()`.

- **En-tête** — départements, sévérité, âge de l'observation
- **Bloc observé** (FIRMS) — détections, FRP total, étendue, persistance, `nearUrban`, satellites
- **Bloc déclaré** — une ligne par `ImpactFact` : `valeur — source, heure`, badge
  `sourceLevel`, note `reliability`/`credibility`, marqueur `provisional`, phrase source
  dépliable, marqueur `pattern` / `llm`
- **Chronologie des révisions** — **toutes** les valeurs de `area_ha` dans le temps, divergences
  incluses, jamais réconciliées (§12.4)
- **Bloc consolidé** — périmètre EFFIS s'il a répondu, sinon **absent** (pas d'emplacement vide)

Les deux blocs `observé` / `déclaré` sont visuellement séparés et ne partagent aucun indicateur
composite (§12.5).

Quatre règles de rendu non négociables :

1. **Aucun chiffre sans provenance** (§3.3).
2. **Aucun chiffre sans son niveau de source et ses deux notes** (§12.1, §12.2).
3. **Aucune valeur agrégée ou réconciliée** — l'UI affiche des séries, pas des scalaires (§12.4).
4. **`escapeHtml` sur tout.** Le modal affiche du texte tiers verbatim — surface XSS la plus
   directe du projet. Convention déjà en place (10 usages dans `AlertMonitor`), suivie sans
   exception.

### 6.3 Dette évitée

La sévérité réutilise `SituationSeverity`, qui existe déjà. On n'ajoute **pas** un cinquième
endroit aux bandes de score dupliquées signalées dans `CLAUDE.md`.

---

## 7. Erreurs et dégradation

| panne | comportement |
|---|---|
| `/api/fires/impacts` muet | dossier avec la détection seule, mention « impacts non renseignés » — jamais un zéro, jamais un chiffre supposé |
| Ollama absent | on reste sur les faits `pattern`. **Pas de bascule vers Groq** : texte préfectoral nominatif vers le cloud interdit |
| EFFIS 503 *(observé au design)* | bloc consolidé absent, circuit breaker, jamais bloquant |
| FIRMS indisponible | aucun incident, donc aucune alerte — comportement actuel inchangé |
| préfecture (étage 2) | circuit breaker par domaine, comme les autres services |

**Principe transversal : une donnée manquante s'affiche comme manquante.** Dans un outil OSINT,
un blanc honnête vaut mieux qu'un chiffre plausible.

---

## 8. Tests

- **`wildfire-dossier.test.ts`** — rejoue `gironde-2026-07-26-viirs.json` à travers le **vrai**
  `clusterFireDetections`, puis verrouille : front principal `critical`, second front retenu en
  `medium`, plus gros cluster hors Gironde écarté. Fixture-contrat.
- **`impact-extractor.test.ts`** — formulations françaises réelles : `7 400 hectares`,
  `7.400 ha`, `près de 8 000 hectares`, `1 200 personnes évacuées`,
  `une cinquantaine de maisons`. Et des **cas négatifs** : un texte sans chiffre ne produit
  aucun fait ; une formulation ambiguë produit *rien* plutôt qu'un fait douteux.
- **Test de provenance** — tout `ImpactFact` porte `quote` + `sourceUrl` + `observedAt`, plus
  `sourceLevel`, `reliability` et `credibility`. Un fait incomplet est rejeté, pas dégradé.
- **Test de non-réconciliation** — deux faits `area_ha` divergents pour le même incident
  ressortent **tous les deux** dans le dossier. Le test échoue si une moyenne, un `max` ou un
  « dernier connu » apparaît (§12.4).
- **Test de corroboration** — deux items issus de la même dépêche ne comptent que pour **une**
  corroboration (§12.3).
- **Test de non-substitution** — aucun indicateur du dossier ne mélange observé et déclaré : le
  `severityScore` FIRMS n'apparaît jamais dans le bloc « déclaré » (§12.5).
- **Test XSS** — une `quote` contenant `<script>` ressort échappée.
- Clôture par `npm run build` + `npm run typecheck`.

---

## 9. Périmètre

### Dans la V1

- Extraction déterministe serveur sur le flux PQR existant
- Table `fire_impact_facts` + endpoint `/api/fires/impacts`
- **Historisation des `FireIncident`** — voir §9.1
- `wildfire-dossier.ts` (sélection, assemblage, enrichissement Ollama)
- `detectWildfireEscalation` par incident
- `WildfireDossierModal` + hook `AlertMonitor`

### 9.1 Pourquoi l'historisation remonte en V1

Initialement classée « souhaitable, chantier distinct ». L'épisode de référence a démontré que
c'est une **condition de fonctionnement**, pas un confort.

FIRMS est en fenêtre 24 h. L'épisode a duré du 22 au 26 juillet. **Sans persistance, l'outil ne
voit jamais qu'une tranche de 24 h d'un événement de 5 jours** — en l'occurrence la traîne, en
ratant le pic. Il ne peut ni reconstituer la progression, ni comparer un nouvel épisode aux
précédents, ni servir à recalibrer les seuils.

La courbe de progression (1 400 → 4 800 → 19 000 → 32 000 → 42 000 ha) est elle-même le signal
OSINT central : c'est la **vitesse** de propagation qui dit la gravité, pas l'instantané. Il faut
les deux séries — détections satellite et faits déclarés — pour la tracer.

Coût réel modéré : le cron existe, Neon existe, et le schéma est un append-only de plus.

### Hors V1, explicitement

- **Scraping préfecture** (étage 2) — la V1 est utile sans écrire un seul scraper : la PQR
  alimente déjà. Le scraping préfectoral améliore l'autorité de la source, il ne conditionne
  pas la valeur. **Nuance issue du terrain** : la préfecture apporte les `evacuation_order`, que
  la presse rend mal. À faire monter en priorité dès que la V1 tourne.
- **EFFIS** — best-effort, peut être livré après, service en 503 au moment du design.

---

## 10. Limites assumées

Ce que ce design ne saura pas, et qu'il faut porter au dossier :

1. **Les seuils sont calibrés sur la traîne d'un seul épisode.** Ils sépareront proprement un
   Gironde d'un été calme, et la marge est confortable (650 contre 22 détections). Mais ils
   n'ont rien prouvé sur un cas **intermédiaire** — un feu de 200 ha dans le Var — et le **pic**
   n'a pas été observé (§4.3). À revoir dès le deuxième épisode réel, que l'historisation du
   §9.1 rendra enfin comparable.
2. **Les patterns sont adossés à un seul corpus** (§11.4), tiré d'un épisode exceptionnel. Les
   formulations d'un feu ordinaire — plus courtes, moins chiffrées, souvent sans bilan — ne sont
   pas représentées. D'où le repli « non renseigné » plutôt qu'une extraction agressive.
3. **Les chiffres du cas de référence sont provisoires et partiellement tertiaires.** La source
   qui les consolide portait la mention « incendie en cours » au relevé et présente une
   incohérence interne sur les blessés. Le corpus vaut pour calibrer des *patterns*, pas comme
   vérité terrain sur l'épisode.

---

## 11. Cas de référence — Gironde/Landes, 22-26 juillet 2026

Relevé le 2026-07-27. **Chiffres provisoires** : l'épisode était encore en cours. Sert de corpus
de calibration pour les patterns d'extraction (§8) et de scénario de bout en bout.

**Origine** : incendie déclaré le mardi 22 juillet à **Saumos** (Gironde). Cause accidentelle —
travaux de débroussaillage Enedis. À noter : `www.enedis.fr` est déjà dans la whitelist
`scrapling-proxy`.

### 11.1 Progression déclarée

| date | hectares |
|---|---|
| 22 juil. (soir) | 1 400 |
| 23 juil. | 4 800 |
| 24 juil. | 19 000 |
| 25 juil. (midi) | 32 000+ |
| 26 juil. (matin) | **42 000** |

**Évacuations** : 20 000 (23 juil.) → **110 000** (24 juil., terrestre *et maritime* depuis la
presqu'île du Cap Ferret) → **220 000** (26 juil.).

**Habitations** : plus de 200 bâtiments détruits, dont **175 maisons au Porge**.

**Blessés** : 42 sapeurs-pompiers. Aucun mort civil.

**Infrastructures** : A63 coupée sur ~70 km ; TER et TGV interrompus vers Dax, Arcachon,
Mont-de-Marsan.

**Landes** : 3 500 ha, 40 000 évacués (Biscarrosse, Parentis-en-Born, Sanguinet).

### 11.2 Ce que la donnée satellite disait seule

Capture VIIRS 24 h du 26 juillet — 734 détections, centroïde pondéré FRP à 44,7794 N / −0,9253 E,
emprise 66 × 48 km, 3 passages satellite. Reverse-géocodage `geo.api.gouv.fr` :
**16 communes**, 730 détections en Gironde (33), 4 à Biscarrosse (40).

Top 5 : Lanton 191 · Saint-Jean-d'Illac 118 · Le Temple 105 · Audenge 94 · Lacanau 59.

La BAN ne renvoie **aucune adresse** sur les points les plus denses : foyer en forêt non adressée
(massif des Landes de Gascogne).

### 11.3 Écarts entre satellite et réalité — à retenir

| ce que le satellite montrait | la réalité |
|---|---|
| 4 détections dans les Landes (0,5 %) | 3 500 ha, **40 000 évacués** |
| Le Porge : 15 détections, 48 MW (2 %) | **175 maisons détruites** |
| instantané du 26 juillet | événement de **5 jours**, pic manqué |

Ces trois écarts sont la justification empirique du design. Chacun serait invisible sans la
couche d'impact.

### 11.4 Formulations observées pour les patterns

À couvrir par `impact-extractor.test.ts` : `42 000 hectares de forêt ont été détruits`,
`220 000 personnes, par voie terrestre et même par voie maritime`, `175 maisons`,
`plus de 200 bâtiments`, `42 sapeurs-pompiers blessés`, `l'A63 coupée sur 70 km`.

Le communiqué préfectoral du 25/07 est le contre-exemple utile : **aucun chiffre**, mais quatre
communes nommées et un ordre FR-Alert — un `evacuation_order` de plein droit (§3.4).

### 11.5 Sources

- [Préfecture de la Gironde — communiqué FR-Alert du 25/07/2026](https://www.gironde.gouv.fr/Actualites/Communiques-de-presse/Communiques-de-presse-2026/Juillet-2026/Incendie-en-Gironde-declenchement-de-FR-Alert-pour-l-evacuation-des-nouvelles-communes)
  — primaire, autoritaire sur les ordres et la géographie, sans chiffres
- [Feux de forêt de 2026 en Gironde et Landes — Wikipédia](https://fr.wikipedia.org/wiki/Feux_de_for%C3%AAt_de_2026_en_Gironde_et_Landes)
  — tertiaire, consolide les chiffres. Article marqué « incendie en cours » au relevé, et
  **incohérence interne** sur le décompte des 42 blessés entre zones Gironde et Landes.
- Capture VIIRS `SUOMI_VIIRS_C2_Europe_24h.csv` du 2026-07-26 →
  `src/services/__fixtures__/gironde-2026-07-26-viirs.json`

---

## 12. Tradecraft OSINT

Les §3.3 et §3.4 posent la provenance. Cette section pose l'**évaluation** — ce qui sépare un
agrégateur d'un outil de renseignement.

### 12.1 Deux axes orthogonaux, jamais fusionnés

La fiabilité d'une source et la crédibilité d'une information sont **indépendantes**. Une source
excellente peut relayer un chiffre provisoire ; une source médiocre peut rapporter un fait exact.
Les confondre en une note unique détruit l'information.

`ImpactFact` porte donc deux notations séparées, dans l'esprit du code Admiralty :

| axe | échelle | origine |
|---|---|---|
| `reliability` | `A`–`F` | **dérivée**, pas saisie : `tier` de `feeds.ts` + métriques observées de `source-quality-history.ts` |
| `credibility` | `1`–`6` | propre **à ce fait** : corroboration, statut officiel, caractère provisoire |

`reliability` réutilise le scoring existant — pas de second système à maintenir.

### 12.2 Niveau de source, distinct de sa fiabilité

| `sourceLevel` | définition | exemple sur le cas de référence |
|---|---|---|
| `primary` | l'acteur lui-même | préfecture, SDIS, opérateur |
| `secondary` | rapporte l'acteur | PQR, presse nationale |
| `tertiary` | consolide des rapports | encyclopédie, agrégateur |

Wikipédia est **fiable et tertiaire** à la fois : les deux dimensions ne se déduisent pas l'une
de l'autre. Un outil qui n'a que `tier` ne peut pas exprimer ça, et finit par présenter une
consolidation tertiaire avec l'autorité d'un communiqué officiel.

**Règle** : le niveau est toujours affiché. Un chiffre tertiaire n'emprunte jamais l'autorité
d'une source primaire.

### 12.3 Corroboration

`corroboration`: la liste des sources indépendantes affirmant le même fait — pas un simple
compteur, car l'identité des sources compte.

Deux médias reprenant la même dépêche ne sont **pas** deux corroborations. La détection de
reprise est déjà nécessaire au pipeline (`news_items` est dédupliqué) : on la réutilise.

### 12.4 Ne jamais réconcilier les chiffres divergents

Le point le plus important de cette section.

Sur le cas de référence, le 25 juillet, la surface déclarée était de **32 000 ha** ; le 26 elle
passait à **42 000 ha**. Un agrégateur naïf moyenne, ou garde le plus récent, ou le plus élevé.

**Les trois sont des fautes.** Le dossier affiche **toutes** les valeurs, chacune avec sa source,
son horodatage et ses deux notes. La divergence est une information : elle dit soit une
progression réelle, soit un désaccord entre sources — et distinguer les deux est précisément le
travail de l'analyste, pas celui de l'outil.

Conséquence sur le modèle : `fire_impact_facts` est append-only (§3.1) et il n'existe **aucune**
fonction du type `getCurrentAreaHa()` renvoyant un scalaire. L'API expose des **séries**. Cette
absence est délibérée : il n'y a pas de « vrai chiffre » à exposer.

### 12.5 Séparer l'observé du déclaré

Déjà acquis structurellement, rappelé ici car c'est un principe de métier :

- **Observé** — détections VIIRS, FRP, emprise. Mesure instrumentale, incertitude connue.
- **Déclaré** — hectares, évacués, habitations. Assertion humaine, révisable.

Le §1.1 démontre qu'ils ne sont pas substituables. Le dossier ne les mélange jamais dans un même
bloc, et aucun indicateur composite ne les agrège en un score unique de « gravité ».

### 12.6 Ce que l'outil n'affirme jamais

- Qu'un feu est éteint — l'absence de détection n'est pas une extinction (couverture nuageuse,
  créneau satellite, feu couvant sous canopée).
- Qu'un chiffre est définitif — tant qu'aucune source primaire n'a publié de bilan clos.
- Une cause — sur le cas de référence, l'origine Enedis est un fait *rapporté*, à traiter comme
  tel et non comme une conclusion de l'outil.
