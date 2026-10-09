# Déploiement sur VM Oracle Always Free (Cloudflare devant)

Décision du 27/09/2026 (voir la spec de migration) : faire tourner France
Monitor pour 0 €/mois sur une VM ARM Oracle Cloud « Always Free »
(Ubuntu 24.04 aarch64, région Paris ou Marseille), Cloudflare gratuit devant
(DNS, CDN, HTTPS). Vercel/Railway/Render restent en service tant que la VM
n'est pas validée ; la bascule DNS est une action manuelle, réversible.

Ce document est la procédure pas à pas — pour l'utilisateur (comptes,
consoles web, secrets) ET pour l'agent qui l'accompagne (commandes exactes).
Voir aussi `docs/deployment.md` (topologie actuelle Vercel/Railway/Render) et
`deploy/oracle/` (scripts et unités systemd produits par cette procédure).

## Résumé — actions manuelles, dans l'ordre

1. Créer/vérifier le compte Oracle Cloud **Free Tier** (§a) — ne jamais passer en Pay As You Go.
2. Créer l'instance VM.Standard.A1.Flex 2 OCPU / 3 Go, Ubuntu 24.04 aarch64 (§a).
3. Ouvrir 80/443 dans la liste de sécurité du VCN (§a).
4. Lancer `deploy/oracle/setup.sh` en root sur la VM (§a).
5. Configurer Cloudflare : site, DNS, certificat Origin CA, SSL Full (strict), cache API, WebSockets (§b).
6. Déposer les certificats Origin CA dans `/etc/francemonitor/tls/` sur la VM (§b).
7. Migrer les secrets vers `/etc/francemonitor/francemonitor.env` (§c).
8. Configurer les secrets/variables GitHub Actions (§d).
9. Premier déploiement (workflow ou manuel) + vérifications AVANT bascule DNS (§e).
10. Bascule des serveurs de noms chez Name.com vers Cloudflare, attendre la propagation, revérifier (§f).
11. Mettre hors service Vercel, Railway, Render une fois la VM stable (§g).
12. Connaître le retour arrière si besoin (§h).
13. Sauvegarde de la base Neon : installée par `setup.sh`, restauration décrite en §i.
14. Jeton Cloudflare Radar (facultatif, gratuit) : `! pbpaste | bash deploy/oracle/set-radar-token.sh` depuis le poste (§j).

---

## (a) Compte Oracle Cloud et instance VM

### Compte — rester en Free Tier, jamais Pay As You Go

- Créer un compte sur [cloud.oracle.com](https://cloud.oracle.com) si nécessaire. Une carte bancaire est demandée pour la vérification d'identité, mais **un compte Free Tier ne peut pas être facturé** : Oracle ne débite rien tant que le compte reste en Free Tier.
- **Ne pas passer en « Pay As You Go »** : d'après la documentation Oracle sur les Always Free Resources, un compte Pay As You Go est facturé pour tout ce qui dépasse les limites Always Free, et n'est **pas** exempté de la récupération des instances inactives pour autant. Rester en Free Tier tant que l'usage reste dans les limites Always Free (ce qui est le cas ici).
- Pendant les 30 jours d'essai (crédits gratuits), n'utiliser **que** des ressources explicitement éligibles « Always Free » (le formulaire de création d'instance l'indique) — un crédit d'essai mal utilisé peut faire basculer par erreur des ressources facturables.
- Région : `eu-paris-1` (Paris) ou `eu-marseille-1` (Marseille) — au choix, les deux sont éligibles Always Free.

### Limites Always Free — Ampere A1 (important, à ne pas dépasser)

Les Always Free Resources Ampere A1 sont plafonnées à **1 500 OCPU-heures et
9 000 Go-heures par mois**, ce qui correspond à un total de **2 OCPU et 12 Go
de RAM**, à répartir sur une ou plusieurs instances A1.Flex. Taille retenue
pour France Monitor :

| Paramètre | Valeur |
|---|---|
| Forme | `VM.Standard.A1.Flex` |
| OCPU | **2** |
| Mémoire | **3 Go** (6 Go à la création, réduite le 28/09/2026) |
| OS | Ubuntu 24.04 (aarch64) |
| Disque de démarrage (boot volume) | 100 Go |
| Adresse IP publique | **Éphémère** (pas d'IP réservée) |
| Clé SSH publique | fournie à la création (celle de l'administrateur, distincte de la clé de déploiement CI) |

Pourquoi 2 OCPU / 3 Go et pas tout le quota Always Free (2 OCPU / 12 Go au total pour un compte Always Free) :

- **Récupération pour inactivité** : Oracle peut récupérer une instance Always Free si, sur 7 jours, CPU (95ᵉ centile) < 20 % ET réseau < 20 % ET mémoire < 20 % (A1). Il suffit qu'UN critère dépasse 20 %. Le CPU tourne à ~2 % et le réseau est faible : c'est la mémoire qui nous protège. Mesure Oracle (`oci_computeagent` / `MemoryUtilization`, agent `oracle-cloud-agent` actif) le 28/09/2026 : **14–16 % à 6 Go** → VM réduite à **3 Go** : **≈ 23 %** mesuré juste après (12:55–13:05 UTC). Marge mince : si la moyenne sur 24 h retombe sous ~22 %, passer à 2 Go (≈ 33 %, le swap de 4 Go absorbe les pics). Une « relance » ponctuelle tous les 2–3 jours ne sert à rien : les seuils portent sur 7 jours glissants.
- Contrôle : `oci monitoring metric-data summarize-metrics-data --namespace oci_computeagent --query-text 'MemoryUtilization[1h]{resourceId = "<ocid>"}.mean()' …` doit rester nettement au-dessus de 20 %. Ne pas remonter la mémoire sans refaire ce calcul.
- 3 Go suffisent pour la charge réelle (Caddy + API Node + relais AIS Node + worker FastAPI/uvicorn ≈ 0,7 Go utilisés) ; `deploy/oracle/setup.sh` crée un swapfile de 4 Go en filet de sécurité pour les pics mémoire du décodage radar BUFR (cf. commentaire dans `services/radar-worker/publish_job.py`). Le build Vite se fait dans GitHub Actions, pas sur la VM.
- Redimensionner (redémarrage ~2 min, services relancés par systemd) : `oci compute instance update --instance-id <ocid> --shape-config '{"ocpus":2,"memoryInGBs":3}' --force --wait-for-state RUNNING`.

Le disque de démarrage de 100 Go tient dans le total Always Free de 200 Go de
stockage bloc (boot volume compris) — de la marge reste disponible pour un
second volume si besoin plus tard.

**Récupération des instances inactives — à surveiller après mise en
service** : Oracle peut récupérer une instance Always Free si, sur une
fenêtre glissante de 7 jours, le CPU au 95ᵉ centile, le réseau ET (pour les
formes A1) la mémoire sont **tous** sous 20 % d'utilisation. Conséquence
pratique : surveiller la mémoire **telle qu'Oracle la mesure** (métrique
`MemoryUtilization`, voir ci-dessus ; `free -h` donne un chiffre un peu plus
bas) et, si elle reste trop proche de 20 %, **réduire** la mémoire de
l'instance (la même charge pèse alors plus en pourcentage) — jamais l'augmenter.
Le test de fumée quotidien (`smoke.yml`) détectera de toute façon un arrêt
de l'instance (toutes les routes échoueraient).

**Si la création échoue avec « Out of host capacity »** : c'est une pénurie
temporaire de capacité Ampere A1 dans le domaine de disponibilité choisi —
recommencer dans un autre domaine de disponibilité (AD) de la même région,
ou réessayer plus tard (situation fréquente et documentée par Oracle sur les
formes Always Free, pas une erreur de configuration).

### Créer l'instance

1. Console Oracle Cloud → **Compute → Instances → Create Instance**.
2. Nom : `francemonitor-vm` (ou équivalent).
3. Image : **Canonical Ubuntu 24.04** (aarch64 — bien vérifier l'architecture ARM, pas x86).
4. Forme : **Ampere · VM.Standard.A1.Flex**, 2 OCPU, 3 Go de mémoire.
5. Configuration réseau : VCN par défaut (ou dédié), **adresse IPv4 publique éphémère** activée (ne pas réserver d'IP).
6. Clé SSH : coller la clé publique de l'administrateur (paire dédiée, à conserver — c'est la clé d'accès root/`ubuntu`, distincte de la clé de déploiement CI créée en §d).
7. Volume de démarrage : 100 Go.
8. Créer, attendre l'état « Running », noter l'adresse IP publique attribuée.

### Liste de sécurité du VCN

Sous **Networking → Virtual Cloud Networks → (le VCN) → Security Lists →
Default Security List** : ajouter des règles d'entrée (Ingress) :

| Source | Protocole | Port | Description |
|---|---|---|---|
| `0.0.0.0/0` | TCP | 80 | HTTP (redirection Cloudflare → 443) |
| `0.0.0.0/0` | TCP | 443 | HTTPS |

Le port 22 (SSH) est déjà ouvert par défaut sur la liste de sécurité par
défaut d'Oracle ; restreindre sa source à l'IP de l'administrateur si
possible (sinon laisser tel quel, l'accès reste protégé par clé).

### Provisionnement de la VM

Se connecter en SSH (`ssh -i <clé_admin> ubuntu@<ip_publique>`), récupérer le
dépôt (ou juste le dossier `deploy/oracle/`), puis :

```bash
sudo DEPLOY_USER=ubuntu bash deploy/oracle/setup.sh
```

`setup.sh` est idempotent (peut être relancé sans risque) et installe :
Node.js 24 (NodeSource, arm64), Caddy (dépôt officiel), Python 3.12 + venv,
`libeccodes0`/`libeccodes-data` (radar), ouvre 80/443 dans iptables (les
images Ubuntu d'Oracle bloquent tout hors 22/ICMP par défaut, en plus de la
liste de sécurité du VCN — la règle est insérée avant le `REJECT` final et
persistée via `netfilter-persistent`), crée l'utilisateur système `fm`,
l'arborescence `/srv/francemonitor`, `/etc/francemonitor`,
`/var/lib/francemonitor/radar`, `/opt/francemonitor/radar-venv`, un swapfile
de 4 Go, les unités systemd, le Caddyfile, `/usr/local/bin/fm-deploy` et la
règle sudoers minimale (`/etc/sudoers.d/fm-deploy`, groupe `fmdeploy`).

À la fin du script, `caddy validate` échouera probablement — c'est attendu
tant que les certificats Origin CA (§b) ne sont pas encore déposés.

---

## (b) Cloudflare

1. **Ajouter le site** : dashboard Cloudflare → *Add a site* → `francemonitor.com` → plan gratuit.
2. **Enregistrements DNS** (proxifiés, nuage orange) :
   - `A` `www` → `<IP publique de la VM>`, proxy activé.
   - `A` `@` (apex) → `<IP publique de la VM>`, proxy activé.
> **Mise à jour du 28/09/2026 : on n'utilise PLUS le certificat Origin CA.** Caddy obtient seul des
> certificats Let's Encrypt (Caddyfile sans directive `tls`), valides pour les navigateurs pendant
> l'activation de la zone Cloudflare (le DNS renvoie alors l'IP de la VM) puis pour Cloudflare en
> **Full (strict)**. Garder « Always Use HTTPS » désactivé côté Cloudflare (renouvellement HTTP-01).
> L'encadré ci-dessous reste pour mémoire.
>
> **Constaté le 28/09/2026 :** Cloudflare refuse d'émettre un certificat Origin CA tant que la zone est
> « pending » (serveurs de noms pas encore basculés) : *« This zone is either not part of your account »*.
> Ordre qui marche : (1) sur la VM, générer la clé et la CSR (`openssl req -new -newkey ec -pkeyopt
> ec_paramgen_curve:prime256v1 -nodes -keyout /etc/francemonitor/tls/origin-key.pem -out
> /etc/francemonitor/tls/origin.csr`), la clé ne quitte jamais la VM ; (2) poser un certificat autosigné
> temporaire avec cette clé dans `origin.pem` (Caddy démarre) et laisser Cloudflare en mode **Full** ;
> (3) basculer les serveurs de noms ; (4) une fois la zone active, *Create Certificate → Use my private key
> and CSR* avec la CSR, remplacer `origin.pem` par le certificat obtenu, `systemctl reload caddy`, puis
> passer en **Full (strict)**.

3. **Certificat Origin CA** : *SSL/TLS → Origin Server → Create Certificate*.
   - Liste d'hôtes : `francemonitor.com`, `www.francemonitor.com` (les deux, un seul certificat sert les deux blocs du Caddyfile).
   - Validité 15 ans (par défaut), clé RSA 2048 (par défaut).
   - Copier le certificat dans `/etc/francemonitor/tls/origin.pem` et la clé privée dans `/etc/francemonitor/tls/origin-key.pem` sur la VM (`scp` ou copier/coller via `sudo tee` en SSH) :
     ```bash
     sudo install -m 640 -o root -g caddy /dev/stdin /etc/francemonitor/tls/origin.pem   <<< "$(cat origin.pem)"
     sudo install -m 640 -o root -g caddy /dev/stdin /etc/francemonitor/tls/origin-key.pem <<< "$(cat origin-key.pem)"
     sudo systemctl restart caddy
     ```
4. **SSL/TLS → Overview** : mode **Full (strict)** (Cloudflare valide le certificat Origin CA de la VM — jamais « Flexible », qui casserait le WebSocket du relais AIS et enverrait du trafic non chiffré à l'origine).
5. **Cache** : *Caching → Cache Rules* → règle « API » sur `www.francemonitor.com/api/*` : **Eligible for cache**, *Edge TTL* = **Use cache-control header if present, bypass cache if not**, *Browser TTL* = **Respect origin**. Les routes `/api/*` fixent elles-mêmes leur durée de cache CDN (`s-maxage`, comme sur Vercel) et répondent `no-store` en cas d'erreur : Cloudflare les garde donc exactement aussi longtemps que Vercel le faisait. Ne PAS mettre « Bypass » : chaque visiteur interrogerait alors l'origine et la base Neon, dont le quota gratuit s'épuiserait. La clé de cache inclut la chaîne de requête (comportement par défaut, à conserver).
   **Et** *Caching → Configuration → Browser Cache TTL* = **Respect Existing Headers** (réglage de zone) : la valeur par défaut « 4 hours » ajoute `max-age=14400` à toute réponse sans `max-age` — donc à toutes les routes `/api/*`, qui n'ont que `s-maxage` — et les navigateurs réutilisaient alors `/api/events`, `/api/news`… pendant 4 h sans rien redemander (constaté et corrigé le 28/09/2026). Contrôle : `curl -sI https://www.francemonitor.com/api/events | grep -i cache-control` ne doit PAS contenir `max-age=14400`.
6. **WebSockets** : *Network → WebSockets* → activé (activé par défaut sur le plan gratuit, à vérifier). Nécessaire pour `/relay/*` (relais AIS).
7. **Vérifier `curl`** une fois le DNS propagé côté Cloudflare (avant la bascule des NS, voir §f, ces enregistrements ne sont vus que par Cloudflare tant que Name.com pointe encore ailleurs) :
   ```bash
   curl -Ik https://www.francemonitor.com
   ```

---

## (c) Migration des secrets

Objectif : remplir `/etc/francemonitor/francemonitor.env` sur la VM
(`root:fm`, `640`, format `CLE=valeur`) à partir de
`deploy/oracle/francemonitor.env.example` (qui ne contient que les NOMS).

1. **Vercel → local** : `vercel env pull .env.oracle-migration --environment=production` (nécessite `vercel login` + projet lié). **Ne jamais committer ce fichier.**
2. **Railway (radar-worker)** : `railway link` puis `railway variables --service radar-worker --environment production` pour lister `METEO_FRANCE_RADAR_API_KEY` et `RADAR_WORKER_TOKEN`.
3. **Render (ais-relay)** : dashboard Render → service `france-monitor` → *Environment* → copier `AISSTREAM_API_KEY`.
4. **GIE (AGSI/ALSI)** : si l'API exige désormais une clé, créer un compte sur [agsi.gie.eu](https://agsi.gie.eu) et générer `GIE_API_KEY`.
5. Fusionner ces valeurs dans un fichier local (jamais commité, par exemple dans le répertoire de travail temporaire de l'agent), en suivant la structure de `deploy/oracle/francemonitor.env.example`. Attention aux variables **déjà fixées dans les unités systemd** (`RADAR_STORAGE_DIR`, `RADAR_PUBLIC_BASE_URL`, `RELAY_PORT`, `ECCODES_DEFINITION_PATH`) : ne pas recopier les anciennes valeurs Railway (ex. `RADAR_STORAGE_DIR=/data`) dans le fichier — les unités systemd les redéfinissent de toute façon (`Environment=` prime sur `EnvironmentFile=`), mais autant garder le fichier propre.
6. Copier le résultat sur la VM :
   ```bash
   scp -i <clé_admin> francemonitor.env ubuntu@<ip>:/tmp/francemonitor.env
   ssh -i <clé_admin> ubuntu@<ip> \
     'sudo install -m 640 -o root -g fm /tmp/francemonitor.env /etc/francemonitor/francemonitor.env && rm -f /tmp/francemonitor.env'
   ```
7. `RADAR_WORKER_TOKEN` doit être **identique** à `secrets.RADAR_WORKER_TOKEN` côté GitHub (utilisé par `radar-refresh.yml`) — soit garder la même valeur que Railway, soit en générer une nouvelle et mettre à jour le secret GitHub en même temps.

---

## (d) Secrets et variables GitHub Actions

Dans **Settings → Secrets and variables → Actions** du dépôt :

**Secrets** (onglet *Secrets*) :

| Nom | Contenu |
|---|---|
| `VM_HOST` | IP publique (ou nom DNS) de la VM. **Absent = `deploy-vm.yml` sauté entièrement.** |
| `VM_USER` | Utilisateur SSH de déploiement (ex. `ubuntu`, doit être membre du groupe `fmdeploy` sur la VM — voir §a). |
| `VM_SSH_KEY` | Clé privée SSH **dédiée au déploiement** (ne pas réutiliser la clé admin) — la clé publique correspondante doit être dans `~/.ssh/authorized_keys` de `VM_USER` sur la VM. |
| `VM_HOST_KEY` | *(optionnel)* Sortie de `ssh-keyscan -H <ip>` — évite un `ssh-keyscan` en direct à chaque run si fourni. |
| `RADAR_WORKER_TOKEN` | Déjà existant (utilisé par `radar-refresh.yml`) — doit matcher la valeur mise dans `francemonitor.env` (§c). |

**Variables** (onglet *Variables*) :

| Nom | Valeur |
|---|---|
| `VITE_AIS_RELAY_URL` | `wss://www.francemonitor.com/relay` |
| `VITE_ENABLE_CYBER_PANEL` / `VITE_ENABLE_GAS_PANEL` / `VITE_ENABLE_OIL_LAYER` | laisser absentes (= actives par défaut), sauf désactivation volontaire |
| `SITE_URL` | `https://www.francemonitor.com` (utilisé par `deploy-vm.yml` et `smoke.yml` — optionnel, c'est déjà le repli par défaut) |
| `RADAR_WORKER_URL` | à définir **après** la bascule (§f) : `https://www.francemonitor.com/radar` (avant la bascule, laisser absent — le repli Railway continue de fonctionner) |
| `AIS_RELAY_URL` | idem, après bascule : `https://www.francemonitor.com/relay` |

Ne définir `RADAR_WORKER_URL` / `AIS_RELAY_URL` qu'une fois la VM validée en
production (§e/§f) : tant qu'elles sont absentes, `smoke.yml` et
`radar-refresh.yml` continuent de tester Railway/Render, ce qui est le
comportement voulu avant la bascule.

---

## (e) Premier déploiement et vérifications (avant bascule DNS)

Le premier déploiement peut se faire par le workflow (une fois §d complété)
ou manuellement pour valider avant de toucher au DNS :

```bash
# Manuel, depuis un poste avec le dépôt cloné :
npm ci && npm run build
tar -czf francemonitor-manual.tar.gz dist api server services/radar-worker ais-relay.js package.json package-lock.json
scp -i <clé_déploiement> francemonitor-manual.tar.gz <VM_USER>@<ip>:/tmp/
ssh -i <clé_déploiement> <VM_USER>@<ip> 'sudo /usr/local/bin/fm-deploy /tmp/francemonitor-manual.tar.gz'
```

Puis, **avant toute bascule DNS** (le site est déjà servi par Cloudflare
proxifié sur l'IP de la VM, donc déjà testable via son URL publique une fois
Cloudflare actif — voir §b.7) :

```bash
curl -Ik https://www.francemonitor.com
curl -s https://www.francemonitor.com/api/health-check | jq .
curl -s https://www.francemonitor.com/radar/health | jq .
curl -sI https://www.francemonitor.com/relay/health   # doit répondre (HTTP, pas WS)
```

Lancer aussi `smoke.yml` manuellement (`workflow_dispatch`) avec
`vars.SITE_URL=https://www.francemonitor.com` (ou une variable temporaire) si
un test complet est souhaité avant la bascule des NS.

---

## (f) Bascule DNS (Name.com → Cloudflare)

1. Chez Name.com : noter les serveurs de noms actuels (pour rollback, §h).
2. Dans Cloudflare (une fois le site ajouté, §b), relever les deux serveurs de noms Cloudflare assignés (ex. `xxx.ns.cloudflare.com`).
3. Chez Name.com → gestion du domaine → changer les serveurs de noms pour ceux de Cloudflare.
4. Propagation : de quelques minutes à 24-48h. Vérifier avec `dig NS francemonitor.com +short`.
5. Une fois Cloudflare actif comme autorité DNS (dashboard Cloudflare indique le site « Active ») : revérifier les routes de §e, puis mettre à jour `RADAR_WORKER_URL` / `AIS_RELAY_URL` dans les variables GitHub (§d) pour qu'elles pointent sur la VM.
6. Surveiller `smoke.yml` (quotidien) et les logs Caddy (`journalctl -u caddy -f`) les premiers jours.

---

## (g) Mise hors service de Vercel, Railway, Render

À faire seulement après plusieurs jours stables sur la VM :

- **Vercel** : dashboard → projet `france-monitor` → *Settings → Advanced →
  Delete Project*. Résilier l'abonnement Pro dans *Settings → Billing* si
  applicable (vérifier qu'aucun autre projet ne dépend du même compte/plan).
- **Railway** : supprimer le projet `radar-worker` ET le projet
  `proactive-enjoyment` (mentionné dans l'audit infra comme second projet
  associé au compte) — vérifier dans le dashboard qu'aucun autre service actif n'y est hébergé avant suppression.
- **Render** : supprimer le service `france-monitor` (ais-relay).

Conserver les exports de variables d'environnement (§c) au cas où un retour
arrière serait nécessaire (§h) — ne pas les committer, les garder hors dépôt.

---

## (h) Retour arrière

Si un problème survient après la bascule DNS (§f) :

1. Chez Name.com, remettre les serveurs de noms d'origine (notés en §f.1) — Vercel/Railway/Render reprennent le trafic une fois la propagation DNS terminée.
2. Ne PAS supprimer Vercel/Railway/Render avant d'avoir confirmé plusieurs jours de stabilité sur la VM (§g) — c'est précisément pour permettre ce retour arrière que la suppression est une étape séparée et tardive.
3. Si le problème est repéré avant la bascule DNS (pendant §e), aucun retour arrière n'est nécessaire : Vercel reste l'origine servie au public, la VM n'est testée que via son IP/Cloudflare en parallèle.
4. Au niveau applicatif seul (pas DNS) : `fm-deploy` revient automatiquement à la release précédente si les contrôles de santé échouent après un déploiement (voir `deploy/oracle/fm-deploy.sh`) — aucune action manuelle n'est nécessaire pour ce cas-là.

---

## (i) Sauvegarde de la base Neon

Mise en place le 29/09/2026. Script `deploy/oracle/fm-backup-db.sh` (installé en
`/usr/local/bin/fm-backup-db`), lancé chaque nuit à 03:15 UTC par
`fm-backup-db.timer`, sous l'utilisateur dédié `fmbackup` : `fm` (l'API) ne peut ni
lire ni effacer les copies. Copies dans `/var/backups/francemonitor/` (700),
nommées `full-<date UTC>.dump` et `light-<date UTC>.dump` (format personnalisé
`pg_dump`, compressé). Client : `postgresql-client-17` du dépôt PGDG (même version
majeure que Neon). Connexion directe (`DATABASE_URL_UNPOOLED`), certificat vérifié
(`verify-full`), mot de passe transmis par l'environnement, jamais sur la ligne de
commande.

**Pourquoi deux sortes de copie.** Le palier gratuit Neon plafonne le transfert
réseau à 5 Go par mois ; au-delà, la base est suspendue jusqu'au mois suivant. Ce
que `pg_dump` fait transiter est le volume brut des données, pas la taille du
fichier compressé.

| Copie | Quand | Contenu | Gardées | Fichier | Transfert Neon |
|---|---|---|---|---|---|
| complète | dimanche, ou si la dernière a plus de 8 jours | tout | 5 | 50 Mo | 135 Mo |
| légère | les autres nuits | tout sauf le contenu de `news_items` | 8 | 1,3 Mo | 6 Mo |

Mesures du 29/09/2026 (210 547 articles, 14 288 événements) : environ **0,7 Go de
transfert par mois**, 15 % du plafond. Pire cas : 7 jours d'articles perdus ;
événements, journal des événements, flux et compteurs sont sauvegardés chaque
nuit. Chaque copie est relue (`pg_restore --list`) avant d'être gardée ; une
copie sans les données attendues est écartée et le service échoue. Pas de
relance automatique : chaque essai consomme du transfert ; une complète manquée
le dimanche est refaite la nuit suivante.

**Surveiller**

```bash
systemctl list-timers fm-backup-db.timer
sudo journalctl -u fm-backup-db -n 5 -o cat     # une ligne JSON par copie : mode, taille, durée
sudo ls -l /var/backups/francemonitor
```

**Lancer une copie à la main** (compte dans le transfert Neon)

```bash
sudo systemctl start fm-backup-db               # auto : complète si aucune de moins de 8 jours
sudo systemd-run --quiet --wait --pipe --collect -p User=fmbackup -p Group=fmbackup \
  -p EnvironmentFile=/etc/francemonitor/francemonitor.env \
  -p ReadWritePaths=/var/backups/francemonitor /usr/local/bin/fm-backup-db light   # ou full
```

**Restaurer** dans une base PostgreSQL 17 vide (nouveau projet ou branche Neon,
ou serveur local) — `<cible>` est sa chaîne de connexion :

```bash
# 1. Dernière copie légère : schéma complet, événements, journal, flux, compteurs.
pg_restore --no-owner --no-privileges --exit-on-error -d "<cible>" light-<la plus récente>.dump
# 2. Articles de la dernière copie complète.
pg_restore --no-owner --no-privileges --exit-on-error --data-only -t news_items -d "<cible>" full-<la plus récente>.dump
```

Si la copie complète est la plus récente, l'étape 1 suffit avec elle. La seule
clé étrangère (`news_items.feed_id` → `feeds`) est satisfaite : les flux sont dans
la copie légère. Les compteurs d'identifiants viennent de la copie légère : ils
sont en avance sur les articles restaurés, les nouvelles écritures n'entrent pas
en collision. Restauration testée le 29/09/2026 sur un serveur PostgreSQL 17
temporaire de la VM, retiré ensuite : complète en 8 s, puis légère + articles,
comptes identiques.

Récupérer une copie sur un poste :
`ssh ubuntu@<vm> 'sudo cat /var/backups/francemonitor/<fichier>.dump' > <fichier>.dump`

**Limite.** Les copies sont sur la même VM que l'API. Perdre la VM ne perd rien
(Neon garde les données) ; perdre Neon et la VM en même temps n'est pas couvert.
Une copie hors VM reste possible gratuitement (Oracle Object Storage Always Free,
20 Go), non faite.

---

## (j) Jeton Cloudflare Radar

Le panneau Internet lit Cloudflare Radar (pannes et anomalies Internet signalées
pour la France) seulement si `CLOUDFLARE_RADAR_TOKEN` est posé dans
`/etc/francemonitor/francemonitor.env`. Sans lui, la section Radar dit « non
configuré » et rien d'autre ne change : IODA et RIPEstat restent servis par
`/api/outages/internet`, aucune erreur n'est levée. Le jeton est gratuit et en
lecture seule ; aucune autre clé n'est nécessaire pour les pannes réseau.

1. **Créer le jeton** sur le tableau de bord Cloudflare : profil, « Jetons d'API »,
   « Créer un jeton », jeton personnalisé avec un seul droit, la lecture Radar au
   niveau du compte (« Account · Radar · Read » en anglais ; libellé exact à
   confirmer à l'écran). Aucun droit de zone, aucun autre droit.
2. **Le copier** (Cloudflare ne le montre qu'une fois).
3. **Le poser** depuis le dépôt cloné sur le poste :
   - depuis Claude Code (pas de terminal) : `! pbpaste | bash deploy/oracle/set-radar-token.sh`
   - depuis un terminal : `bash deploy/oracle/set-radar-token.sh` (saisie masquée)

   Le script contrôle la forme du texte sans le répéter, le transmet à la VM par
   l'entrée standard de `ssh` (jamais sur une ligne de commande, dans un journal ni
   à l'écran), remplace l'ancienne ligne `CLOUDFLARE_RADAR_TOKEN=` du fichier
   d'environnement (gardé `root:fm`, `640`, autres lignes inchangées) puis
   redémarre `fm-api`. Hôte et clé par défaut : `ubuntu@141.145.223.156` et
   `~/.ssh/francemonitor_oracle`, surchargeables par `FM_VM_HOST` et `FM_VM_KEY`.
   `ssh` tourne en `BatchMode=yes` et `sudo` sans terminal : sans clé valable ou
   sans sudo sans mot de passe, le script échoue sans rien changer.
4. **Vérifier** directement auprès de `fm-api` sur la VM (même adresse locale que
   les contrôles de santé de `fm-deploy`, `127.0.0.1:3000`), ce qui contourne
   seulement le cache de Cloudflare ; la route et ses sources sont lues comme
   d'habitude :

   ```bash
   ssh -i ~/.ssh/francemonitor_oracle ubuntu@141.145.223.156 \
     'curl -s http://127.0.0.1:3000/api/outages/internet' | jq '.radar.configured, .errors'
   ```

   Attendu : `true` dès le redémarrage, puis, après la relève suivante (Radar est
   relu toutes les 15 min), aucune erreur commençant par « Cloudflare Radar : ».
   Un « HTTP 403 » signale un droit manquant sur le jeton.

   Par le domaine public
   (`curl -s https://www.francemonitor.com/api/outages/internet | jq …`), la
   réponse peut venir du cache de Cloudflare (`s-maxage=300`,
   `stale-while-revalidate=900`) : elle peut encore dire `false` jusqu'à
   20 min environ après la pose, sans que la pose ait échoué.

**Retirer le jeton** : supprimer la ligne `CLOUDFLARE_RADAR_TOKEN=` de
`/etc/francemonitor/francemonitor.env` sur la VM, puis
`sudo systemctl restart fm-api` ; la section Radar repasse à « non configuré ».

---

## Rappel — GitHub Actions n'est pas un planificateur fiable

`radar-refresh.yml` (`*/5 * * * *`) et l'ancien cron de secours Vercel
dérivent régulièrement à 3–6h d'intervalle sur les dépôts peu actifs — c'est
documenté et volontairement traité comme un filet de sécurité, jamais comme
le mécanisme primaire. Sur la VM, l'horaire exact est assuré par les
**timers systemd** (`fm-ingest-news.timer` toutes les 30 min,
`fm-fuel-series.timer` toutes les 3h, tous deux `Persistent=true` : un
rattrapage a lieu au redémarrage si la VM était éteinte à l'heure prévue) et
par la boucle interne du worker radar (`RADAR_REFRESH_INTERVAL_SECONDS`,
300s par défaut) — `radar-refresh.yml` reste un filet de sécurité externe,
comme aujourd'hui sur Railway.
