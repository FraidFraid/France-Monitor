# Runbook — passage Vercel Pro → Hobby

Objectif : réduire la facture mensuelle de **≈23 €/mois (Vercel Pro ≈18,5 € + Railway ≈4,6 €) à ≈4,6 €/mois (Railway seul)**, une fois que le routeur API unique (`api/index.js` + `api/_handlers/**`, voir `docs/deployment.md` §1) a supprimé le blocage du plafond de 12 fonctions par déploiement sur le palier Hobby.

Contexte détaillé et chiffrage : `docs/audit-2026-09-infrastructure.md` §7. Ce document est la check-list d'exécution, dans l'ordre, copiable-collable.

**Ne pas sauter d'étape.** Chaque étape a une vérification explicite ; ne passer à la suivante qu'une fois la vérification passée.

---

## Limites Vercel Hobby qui comptent ici

| Limite | Valeur Hobby | Situation France Monitor après ce runbook |
|---|---|---|
| Fonctions par déploiement | 12 max | 4 (`api/index.js`, `api/ingest/news.ts`, `api/fuel-price-series-refresh.js`, `api/sentinel-ndwi.ts`) |
| Cadence des crons | 1 exécution/jour, précision à l'heure | 2 crons quotidiens (`vercel.json`) |
| Invocations/mois | 1 000 000 | loin en dessous une fois les correctifs de cache du chantier perf appliqués |
| CPU actif | 4 h/mois | à surveiller (Usage → Functions) |
| Transfert | 100 Go/mois | la page d'accueil pèse ≈28 Mo → ≈3 500 visites/mois avant plafond ; correctifs perf prioritaires |
| Usage commercial | interdit par le fair use Hobby | à revoir si France Monitor est un jour monétisé |

---

## 0. Prérequis et vérifications avant de commencer

- [ ] Ce commit (branche `feat/audit-2026-09` ou équivalent) contient le routeur unique : vérifier `npm test -- tests/api-router.test.ts` passe en local (4 fonctions, crons quotidiens, rewrites API avant le fallback SPA).
- [ ] Confirmer le plan actuel sur `https://vercel.com/<team>/france-monitor/settings/billing` (dashboard, non vérifiable en CLI).
- [ ] Confirmer l'usage actuel (invocations, CPU, transfert) sur `Settings → Usage`, pour avoir une baseline de comparaison après bascule.
- [ ] Vérifier qu'un seul membre a besoin d'accès développeur sur le projet (le fair use Hobby suppose une équipe personnelle).
- [ ] Avoir un compte Upstash (déjà utilisé pour Redis) pour créer le schedule QStash à l'étape 1.

## 1. Créer le schedule Upstash QStash (remplace le cron Vercel 30 min)

Dans la console Upstash (`console.upstash.com` → QStash → Schedules → Create Schedule) :

| Champ | Valeur |
|---|---|
| Destination URL | `https://www.francemonitor.com/api/ingest/news` |
| Méthode | `POST` |
| Cron expression | `*/30 * * * *` |
| Header | `Upstash-Forward-Authorization: Bearer <CRON_SECRET>` (la même valeur que le `CRON_SECRET` configuré sur Vercel) |
| Retries | 3 (défaut QStash — le handler est idempotent grâce au verrou Redis `ingest_lock`) |

QStash transmet cet en-tête au handler sous la forme d'un `Authorization: Bearer <CRON_SECRET>` classique — `api/ingest/news.ts` accepte déjà ce format (GET ou POST), **aucun changement de code n'est nécessaire**.

Palier gratuit QStash : 1 000 messages/jour, 10 schedules. Ce schedule consomme 48 messages/jour — large marge.

**Vérification** :
```bash
# Déclencher manuellement le schedule depuis la console Upstash ("Trigger now"), puis :
curl -s https://www.francemonitor.com/api/health-check | jq
```
`status` doit valoir `ok` ou `degraded` (pas `down`), et `ingest:last-tick` doit refléter un tick récent. Vérifier aussi dans la console Upstash QStash que le dernier envoi est en succès (code 200).

- [ ] Schedule QStash créé et vérifié.

## 2. Ouvrir une PR et vérifier le déploiement de prévisualisation

Ouvrir la pull request depuis cette branche vers `main`. Sur le déploiement **Preview** généré par Vercel, exécuter le script de fumée suivant (adapter `PREVIEW_URL`) :

```bash
#!/usr/bin/env bash
set -u
PREVIEW_URL="https://<preview-deployment>.vercel.app"
declare -A checks=(
  ["/api/news?limit=3"]="200 application/json"
  ["/api/news/history"]="200 application/json"
  ["/api/weather/vigilance"]="200 application/json"
  ["/api/energy/ecowatt"]="200 application/json"
  ["/api/traffic/air"]="200 application/json"
  ["/api/ministers/composition"]="200 application/json"
  ["/api/gie/agsi"]="200 application/json"
  ["/api/opendata-proxy?url=https://geo.api.gouv.fr/regions"]="200 application/json"
  ["/api/arcep"]="200 application/json"
  ["/api/health-check"]="200 application/json"
  ["/api/route-qui-n-existe-pas"]="404 application/json"
  ["/about"]="200 text/html"
)
fail=0
for path in "${!checks[@]}"; do
  read -r expected_status expected_type <<< "${checks[$path]}"
  resp=$(curl -s -o /tmp/body.$$ -D /tmp/headers.$$ -w "%{http_code}" "$PREVIEW_URL$path")
  ctype=$(grep -i '^content-type:' /tmp/headers.$$ | head -1 | cut -d' ' -f2- | tr -d '\r' | cut -d';' -f1)
  status="OK"
  [ "$resp" != "$expected_status" ] && status="FAIL (status $resp attendu $expected_status)"
  [[ "$ctype" != "$expected_type" ]] && status="FAIL (content-type $ctype attendu $expected_type)"
  [[ "$status" == FAIL* ]] && fail=1
  printf "%-55s %s\n" "$path" "$status"
done

# POST avec corps JSON
resp=$(curl -s -o /tmp/body.$$ -w "%{http_code}" -X POST "$PREVIEW_URL/api/intelligence/v1/summarize" \
  -H "Content-Type: application/json" -d '{"text":"Texte de test pour le résumé."}')
echo "POST /api/intelligence/v1/summarize -> $resp"
[ "$resp" != "200" ] && [ "$resp" != "503" ] && fail=1   # 503 acceptable si GROQ_API_KEY absent en preview

rm -f /tmp/body.$$ /tmp/headers.$$
exit $fail
```

Notes :
- `/api/ministers/composition` et `/api/gie/agsi` (et `alsi`) ne répondront correctement qu'une fois les handlers correspondants livrés (chantier séparé, voir `docs/audit-2026-09-infrastructure.md` recommandation 3) — si ce script tourne avant leur fusion, ces deux lignes échoueront et c'est attendu ; ne pas bloquer le reste du runbook pour ça, mais ne pas rétrograder tant qu'elles ne passent pas (sinon on répète l'incident silencieux qu'elles corrigent).
- Le test « route qui n'existe pas » vérifie que le routeur renvoie un **404 JSON**, pas le HTML du fallback SPA (`index.html`) — c'est le signal qui aurait détecté les routes mortes de l'audit.

- [ ] Toutes les lignes du script passent (ou les deux exceptions ministres/GIE sont documentées comme dépendance en attente).

## 3. Merger et surveiller la production

- [ ] Merger la PR sur `main`.
- [ ] Attendre le déploiement Production automatique (intégration Git Vercel).
- [ ] Rejouer le script de fumée de l'étape 2 avec `PREVIEW_URL=https://www.francemonitor.com`.
- [ ] Surveiller `Vercel → Observability → Logs` pendant 15 minutes pour repérer une erreur 500 en rafale.
- [ ] Vérifier qu'un tick QStash a bien eu lieu dans les 30 minutes suivant le déploiement (`/api/health-check`).

## 4. Rétrograder le plan Vercel

1. `Vercel dashboard → Settings → Billing → Downgrade to Hobby`.
2. Confirmer qu'un seul membre développeur reste sur l'équipe (condition du fair use Hobby).
3. Vérifier que le **premier déploiement Hobby** réussit : `tests/api-router.test.ts` a déjà vérifié en CI que le projet reste sous la limite de 12 fonctions et que les crons sont quotidiens, donc ce déploiement ne devrait pas être refusé — mais c'est le seul moment où Vercel applique réellement la limite Hobby, donc vérifier le statut du déploiement dans le dashboard.

- [ ] Plan Hobby actif, déploiement de confirmation réussi.

## 5. Brancher un monitoring externe gratuit

Sur [UptimeRobot](https://uptimerobot.com) (palier gratuit, 50 monitors, intervalle 5 min) :

| Monitor | URL | Attendu |
|---|---|---|
| France Monitor API | `https://www.francemonitor.com/api/health-check` | HTTP 200, mot-clé `"status":"ok"` ou `"status":"degraded"` absent de `"down"` |
| Radar worker (Railway) | `https://radar-worker-production-0c93.up.railway.app/health` | HTTP 200 |
| AIS relay (Render) | `https://france-monitor.onrender.com/health` | HTTP 200 |

- [ ] Les trois monitors sont créés et passent au vert au moins une fois.

## 6. Plan de retour arrière

Si un problème survient après la bascule (crons manquants, fonctions refusées, régression) :

1. `Vercel dashboard → Settings → Billing → Upgrade to Pro` — immédiat, aucune perte de données.
2. Remettre le cron 30 min dans `vercel.json` si le schedule QStash pose problème (`git revert` du commit qui l'a retiré, ou modification manuelle) et redéployer.
3. Le schedule QStash peut être laissé actif en parallèle sans conflit — le verrou Redis `ingest_lock` empêche une double exécution si les deux mécanismes tournent en même temps ; le désactiver dans la console Upstash une fois la stabilité confirmée n'est utile que pour l'hygiène, pas pour la sécurité.
4. Aucune migration de données n'est impliquée dans ce runbook (pas de changement de schéma Neon, pas de changement de clés Redis) : le retour arrière est purement une bascule de plan et de scheduler.

---

## Coût avant / après

| Poste | Avant | Après |
|---|---|---|
| Vercel | Pro, ≈20 $/mois (≈18,5 €) | Hobby, 0 € |
| Railway | Hobby, 5 $/mois (≈4,6 €) | inchangé, ≈4,6 € |
| Upstash QStash | — | 0 € (palier gratuit, 48/1000 messages/jour) |
| **Total** | **≈23 €/mois** | **≈4,6 €/mois** |

Option €0 supplémentaire (remplacer Railway par une VM Oracle Cloud Always Free) : voir `docs/audit-2026-09-infrastructure.md` §7.3 — non recommandée dans l'immédiat, Railway est le seul service qui fait un vrai travail permanent (radar toutes les 5 min) et 4,6 €/mois est déjà un coût mineur.
