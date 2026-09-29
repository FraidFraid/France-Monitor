# Fiche de classification des événements

Version : `kw-2` (mots-clés) / `groq-2` (LLM, `llm-2` si un autre fournisseur est configuré). Décision du 28/09/2026.

## Ce que le système affirme

- Chaque article et chaque événement porte une **gravité signalée**, une **gravité retenue**, une **temporalité** (en cours / passé / à venir), une **zone** (France / étranger / indéterminée) et les **motifs** qui ont abaissé la gravité — à la manière du Common Alerting Protocol, qui sépare gravité, urgence et certitude.
- La **gravité retenue** d'un événement est le niveau atteint par au moins **2 groupes de presse indépendants**. Un seul groupe : `medium` au plus ; l'événement apparaît « À confirmer » dans « À traiter » s'il a été signalé `high` ou `critical`. Un événement signalé `high` ou `critical` par un groupe reste au moins `medium`, même si un autre groupe le note plus bas.
- Les événements « à confirmer » sont classés par leur gravité signalée dans `/api/events` : ils ne sortent pas des premiers résultats.
- La presse n'entre dans « À traiter » que par des événements consolidés (repli sur les articles si les événements ne sont pas chargés).
- La gravité retenue est le seul champ lu par la carte, le score national, les fils et le brief ; les autres axes servent l'affichage et l'audit.

## Règles

**Mots-clés (`src/services/classifier.ts`, `src/services/classification-guards.ts`)**
- `high` ou `critical` seulement si le **titre** le justifie ; un mot-clé présent dans le seul résumé donne `medium` au plus, et l'article part à l'arbitrage du LLM.
- Emplois figurés écartés (« séisme au Sénat », « tempête médiatique »).
- Terrorisme sans victime au titre (attentat déjoué, dégâts matériels, enquête) : `high` au plus.
- Procès, condamnation, mise en examen, hommage, anniversaire → temporalité « passé », `low` au plus. « Apologie » nomme un délit, pas une étape judiciaire : non concerné.
- Hypothèse (« pas à l'abri », « et si », « faut-il / doit-on craindre ») → « à venir », `low` au plus.
- Lieu, gentilé ou acteur étranger sans ancre française → « étranger », `medium` au plus.

**LLM (`api/_lib/llm-classifier.js`, `api/_lib/llm-pass.js`)**
- Grille écrite à 5 niveaux (0 aucun impact opérationnel … 4 crise nationale en cours) ; un projet terroriste déjoué, l'arrestation de suspects de terrorisme ou une menace crédible contre une infrastructure ou l'ordre public vaut 3, même sans victime.
- Titre qui parle de terrorisme : le serveur impose une gravité signalée de 3 au moins (le modèle notait 1 un projet déjoué malgré la clause de la grille — vérifié le 29/09) ; les plafonds s'appliquent ensuite.
- Réponses « en France ? » et « en cours ? » ; le serveur applique les plafonds (étranger → `medium`, passé → `low`, plafonds du titre) : le modèle ne peut pas les contourner.
- 2 lots de 10 articles par passage (candidats graves des mots-clés d'abord, puis ambigus).

## Mesure

Instantané de production du 28/09/2026 14:19 UTC : 4 570 articles publiés sur 48 h, les 100 premiers événements.

| Événements | Avant | Mots-clés seuls | Avec LLM |
|---|---|---|---|
| critical | 27 | 0 | 0 |
| high | 55 | 9 | 2 |
| medium | 18 | 60 | 34 |
| « À confirmer » | — | 20 | 4 |

Les 2 événements `high` restants avec LLM gardent leur ancienne note faute d'articles dans la fenêtre de 48 h (artefact du rejeu). La colonne « avec LLM » précède aussi le plancher des signalements graves (qui relève certains événements de `low`/`info` à `medium`, sans rien ajouter à « À traiter »).

| Articles | Avant | Mots-clés seuls | Avec LLM |
|---|---|---|---|
| critical | 32 | 1 | 0 |
| high | 305 | 118 | 10 |

Critères (fixés avant la mesure) :

| Critère | Résultat |
|---|---|
| ≤ 3 événements `critical` | 0 — OK |
| Aucun événement étranger au-dessus de `medium` | 0 — OK |
| Aucun article annoté ≤ `medium` sorti `critical` | 0 avec LLM — OK |
| Aucun article annoté hors de France au-dessus de `medium` | 0 avec LLM — OK |
| ≥ 80 % des articles annotés `high`+ restent ≥ `medium` | mots-clés seuls : 100 % (7/7) ; avec LLM : 57 % (4/7) avec la grille seule, **100 % (7/7)** avec la règle serveur « terrorisme au titre » (29/09) — OK |

La colonne « avec LLM » vient du rejeu complet fait avant l'ajout de la clause « menace terroriste » à la grille ; cette clause ne touche que le niveau 3 (elle ne peut créer ni `critical` ni événement étranger au-dessus de `medium`). L'échec du rappel avec la grille précédente venait de deux causes, corrigées le 28/09 par décision de l'analyste : la grille notait 1 un projet terroriste déjoué (« situation maîtrisée ») et « apologie » était traité comme un marqueur judiciaire. La revérification avec la grille finale — un rejeu complet (~52 000 jetons) puis un contrôle ciblé des 3 articles concernés — a buté sur le quota journalier gratuit de Groq (200 000 jetons, consommé en continu par la production) : elle est à faire dès le lendemain ou juste après le déploiement.

## Jeu annoté

`tests/fixtures/classification/labels.json` : 202 articles réels tirés de l'instantané (tous les `critical`, 80 `high`, 90 autres ; graine fixe).

- 32 articles annotés **à l'aveugle par l'analyste** (ceux que Claude jugeait graves et ceux que la production notait `critical`) : accord avec Claude exact 53 %, à un niveau près 84 %, « en France » 94 %, « en cours » 50 %.
- 20 étiquettes de Claude vérifiées par l'analyste : 20 d'accord.
- L'étiquette de l'analyste fait foi ; 5 articles non relus de la même histoire ont été alignés sur son jugement.
- Écarts marquants : l'analyste note `high` des faits de terrorisme déjoués ou à l'étranger (menace), là où la grille initiale notait les conséquences — d'où la clause « menace terroriste » ; il note `medium` ou `low` l'attentat sans victime en Corse, que les mots-clés classaient `critical` — d'où la règle « terrorisme sans victime ».

## Limites connues

- Listes heuristiques (lieux et gentilés étrangers, marqueurs) : un titre sans nom de lieu n'est jugé étranger que par le LLM.
- Un seul annotateur ; accord modéré sur la temporalité (« en cours ») : l'axe est ambigu pour un humain.
- Instantané de 48 h : les résultats varient avec l'actualité.
- Fournisseur LLM par défaut : Groq (États-Unis) — voir `docs/privacy.md`. Quota gratuit de 200 000 jetons par jour partagé entre la production et les rejeux.
- Les entrées du score national comptent encore les articles graves un par un (à re-mesurer).

## Re-mesure

```bash
node scripts/snapshot-classification.mjs                      # instantané en lecture seule
node scripts/replay-classification.mjs <instantané>           # mots-clés seuls, gratuit
node --env-file-if-exists=.env scripts/replay-classification.mjs <instantané> --groq   # ~26 appels LLM
```

À refaire 48 h après chaque changement de règles, et une fois après le déploiement de cette version.
