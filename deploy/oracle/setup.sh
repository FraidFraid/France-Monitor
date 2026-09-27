#!/usr/bin/env bash
# deploy/oracle/setup.sh — provisionnement idempotent de la VM Oracle Always Free
# (Ubuntu 24.04 aarch64) qui héberge France Monitor derrière Cloudflare.
#
# À lancer UNE FOIS en root sur la VM (peut être relancé sans risque, c'est
# idempotent) :
#
#   sudo DEPLOY_USER=ubuntu bash deploy/oracle/setup.sh
#
# DEPLOY_USER est l'utilisateur SSH qui recevra le droit d'exécuter
# `sudo fm-deploy` (celui que GitHub Actions utilisera, secret VM_USER).
# Par défaut "ubuntu" (utilisateur cloud-init standard des images Oracle).
#
# Voir docs/deployment-oracle.md pour la procédure complète (création de la
# VM, Cloudflare, secrets, premier déploiement, bascule DNS).

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "setup.sh doit être lancé en root (sudo)." >&2
  exit 1
fi

DEPLOY_USER="${DEPLOY_USER:-ubuntu}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # .../deploy
ORACLE_DIR="$REPO_DIR/oracle"

FM_USER=fm
FM_GROUP=fm
BASE_DIR=/srv/francemonitor
RELEASES_DIR="$BASE_DIR/releases"
CONFIG_DIR=/etc/francemonitor
TLS_DIR="$CONFIG_DIR/tls"
ENV_FILE="$CONFIG_DIR/francemonitor.env"
RADAR_STORAGE_DIR=/var/lib/francemonitor/radar
RADAR_VENV=/opt/francemonitor/radar-venv
SWAPFILE=/swapfile
SWAPFILE_SIZE_MB=4096

log() { echo "[setup] $*"; }

# ─────────────────────────────────────────────────────────────────
# 1. Paquets système
# ─────────────────────────────────────────────────────────────────

export DEBIAN_FRONTEND=noninteractive

log "apt update"
apt-get update -y

log "paquets de base"
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg apt-transport-https lsb-release \
  software-properties-common jq \
  python3.12-venv python3-pip \
  libeccodes0 libeccodes-data \
  iptables-persistent

# Node.js 24 (NodeSource, détecte automatiquement arm64)
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed -E 's/^v([0-9]+).*/\1/')" -lt 24 ]; then
  log "installation de Node.js 24 (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
else
  log "Node.js déjà présent : $(node -v)"
fi

# Caddy (dépôt officiel Cloudsmith)
if ! command -v caddy >/dev/null 2>&1; then
  log "installation de Caddy (dépôt officiel)"
  apt-get install -y debian-keyring debian-archive-keyring
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update -y
  apt-get install -y caddy
else
  log "Caddy déjà présent : $(caddy version)"
fi

# ─────────────────────────────────────────────────────────────────
# 2. Utilisateur système `fm` + groupe de déploiement
# ─────────────────────────────────────────────────────────────────

if ! id "$FM_USER" >/dev/null 2>&1; then
  log "création de l'utilisateur système $FM_USER"
  useradd --system --create-home --home-dir "$BASE_DIR" --shell /usr/sbin/nologin "$FM_USER"
else
  log "utilisateur $FM_USER déjà présent"
fi

groupadd -f fmdeploy
if id "$DEPLOY_USER" >/dev/null 2>&1; then
  usermod -aG fmdeploy "$DEPLOY_USER"
  log "utilisateur $DEPLOY_USER ajouté au groupe fmdeploy (droit sudo fm-deploy)"
else
  log "AVERTISSEMENT : l'utilisateur '$DEPLOY_USER' n'existe pas encore — ajoute-le au groupe fmdeploy manuellement :"
  log "  sudo usermod -aG fmdeploy <utilisateur_ssh_de_deploiement>"
fi

# ─────────────────────────────────────────────────────────────────
# 3. Arborescence
# ─────────────────────────────────────────────────────────────────

log "arborescence /srv, /etc, /var/lib, /opt"

install -d -m 750 -o "$FM_USER" -g "$FM_GROUP" "$BASE_DIR"
install -d -m 750 -o "$FM_USER" -g "$FM_GROUP" "$RELEASES_DIR"
install -d -m 750 -o root      -g "$FM_GROUP"  "$CONFIG_DIR"
install -d -m 750 -o root      -g caddy        "$TLS_DIR"
install -d -m 750 -o "$FM_USER" -g "$FM_GROUP" "$RADAR_STORAGE_DIR"
install -d -m 755 -o "$FM_USER" -g "$FM_GROUP" /opt/francemonitor
install -d -m 750 -o root      -g root         /var/log/caddy

if [ ! -f "$ENV_FILE" ]; then
  log "création de $ENV_FILE (vide) — à remplir depuis deploy/oracle/francemonitor.env.example"
  install -m 640 -o root -g "$FM_GROUP" /dev/null "$ENV_FILE"
else
  log "$ENV_FILE déjà présent — non modifié"
fi

# Venv radar : créé vide ici, peuplé au premier déploiement par fm-deploy
# (qui compare le hash de requirements.txt à chaque release).
if [ ! -d "$RADAR_VENV" ]; then
  log "création du venv radar $RADAR_VENV"
  python3.12 -m venv "$RADAR_VENV"
  chown -R "$FM_USER:$FM_GROUP" "$RADAR_VENV"
else
  log "venv radar déjà présent"
fi

# ─────────────────────────────────────────────────────────────────
# 4. Swap — filet de sécurité mémoire
#
# La VM Always Free recommandée (VM.Standard.A1.Flex, 2 OCPU / 6 Go, voir
# docs/deployment-oracle.md §a) fait tourner Caddy + API Node + relais AIS
# Node + worker radar Python en simultané ; le décodage BUFR radar peut
# ponctuellement consommer plusieurs centaines de Mo à quelques Go. Un
# swapfile modeste évite un OOM-kill sur un pic plutôt qu'une dégradation
# progressive de performance — swappiness bas pour ne l'utiliser qu'en
# dernier recours (la moyenne mémoire réelle sur 7 j reste ce qu'Oracle
# regarde pour la récupération des instances inactives, pas le swap).
# ─────────────────────────────────────────────────────────────────

if [ ! -f "$SWAPFILE" ]; then
  log "création d'un swapfile de ${SWAPFILE_SIZE_MB}M"
  fallocate -l "${SWAPFILE_SIZE_MB}M" "$SWAPFILE" || dd if=/dev/zero of="$SWAPFILE" bs=1M count="$SWAPFILE_SIZE_MB"
  chmod 600 "$SWAPFILE"
  mkswap "$SWAPFILE"
  swapon "$SWAPFILE"
  grep -q "^$SWAPFILE " /etc/fstab || echo "$SWAPFILE none swap sw 0 0" >> /etc/fstab
  sysctl -w vm.swappiness=10 >/dev/null
  grep -q "^vm.swappiness" /etc/sysctl.d/99-francemonitor.conf 2>/dev/null || \
    echo "vm.swappiness=10" > /etc/sysctl.d/99-francemonitor.conf
else
  log "swapfile déjà présent"
fi

# ─────────────────────────────────────────────────────────────────
# 5. iptables — ouverture 80/443 (les images Ubuntu d'Oracle bloquent tout
#    hors 22/ICMP/loopback par défaut, en plus de la liste de sécurité VCN)
# ─────────────────────────────────────────────────────────────────

open_port() {
  local port="$1"
  if iptables -C INPUT -p tcp -m state --state NEW -m tcp --dport "$port" -j ACCEPT 2>/dev/null; then
    log "iptables : port $port déjà ouvert"
    return 0
  fi
  local reject_line
  reject_line=$(iptables -L INPUT -n --line-numbers | awk '$2=="REJECT"{print $1; exit}')
  if [ -n "$reject_line" ]; then
    log "iptables : insertion ACCEPT tcp/$port avant la règle REJECT (ligne $reject_line)"
    iptables -I INPUT "$reject_line" -p tcp -m state --state NEW -m tcp --dport "$port" -j ACCEPT
  else
    log "iptables : pas de règle REJECT trouvée dans INPUT — ajout en fin de chaîne pour tcp/$port"
    iptables -A INPUT -p tcp -m state --state NEW -m tcp --dport "$port" -j ACCEPT
  fi
}

open_port 80
open_port 443

log "persistance des règles iptables (netfilter-persistent)"
netfilter-persistent save

# ─────────────────────────────────────────────────────────────────
# 6. Caddyfile
# ─────────────────────────────────────────────────────────────────

log "installation du Caddyfile"
install -m 644 -o root -g root "$ORACLE_DIR/Caddyfile" /etc/caddy/Caddyfile

if command -v caddy >/dev/null 2>&1; then
  log "validation du Caddyfile"
  caddy validate --config /etc/caddy/Caddyfile || {
    echo "AVERTISSEMENT : le Caddyfile ne valide pas (attendu tant que les certificats TLS" >&2
    echo "d'origine Cloudflare ne sont pas encore déposés dans $TLS_DIR — voir docs/deployment-oracle.md §b/c)." >&2
  }
fi

# ─────────────────────────────────────────────────────────────────
# 7. Unités systemd
# ─────────────────────────────────────────────────────────────────

log "installation des unités systemd"
install -m 644 -o root -g root "$ORACLE_DIR"/systemd/fm-api.service          /etc/systemd/system/fm-api.service
install -m 644 -o root -g root "$ORACLE_DIR"/systemd/fm-relay.service        /etc/systemd/system/fm-relay.service
install -m 644 -o root -g root "$ORACLE_DIR"/systemd/fm-radar.service        /etc/systemd/system/fm-radar.service
install -m 644 -o root -g root "$ORACLE_DIR"/systemd/fm-ingest-news.service  /etc/systemd/system/fm-ingest-news.service
install -m 644 -o root -g root "$ORACLE_DIR"/systemd/fm-ingest-news.timer    /etc/systemd/system/fm-ingest-news.timer
install -m 644 -o root -g root "$ORACLE_DIR"/systemd/fm-fuel-series.service  /etc/systemd/system/fm-fuel-series.service
install -m 644 -o root -g root "$ORACLE_DIR"/systemd/fm-fuel-series.timer    /etc/systemd/system/fm-fuel-series.timer

systemctl daemon-reload

# Activés au boot, mais PAS démarrés ici : tant qu'aucune release n'a été
# déployée (/srv/francemonitor/current n'existe pas), fm-api/fm-relay/fm-radar
# n'ont rien à exécuter. Le premier `fm-deploy` les démarre.
systemctl enable fm-api.service fm-relay.service fm-radar.service
systemctl enable fm-ingest-news.timer fm-fuel-series.timer
systemctl enable caddy

# ─────────────────────────────────────────────────────────────────
# 8. fm-deploy + sudoers
# ─────────────────────────────────────────────────────────────────

log "installation de /usr/local/bin/fm-deploy"
install -m 750 -o root -g root "$ORACLE_DIR/fm-deploy.sh" /usr/local/bin/fm-deploy

log "installation de la règle sudoers (groupe fmdeploy → fm-deploy uniquement)"
SUDOERS_FILE=/etc/sudoers.d/fm-deploy
cat > "$SUDOERS_FILE.tmp" <<'EOF'
# Généré par deploy/oracle/setup.sh — ne pas éditer à la main.
# Le groupe fmdeploy peut lancer UNIQUEMENT /usr/local/bin/fm-deploy, sans mot de passe.
%fmdeploy ALL=(root) NOPASSWD: /usr/local/bin/fm-deploy *
EOF
chmod 440 "$SUDOERS_FILE.tmp"
if visudo -c -f "$SUDOERS_FILE.tmp" >/dev/null 2>&1; then
  mv "$SUDOERS_FILE.tmp" "$SUDOERS_FILE"
  log "règle sudoers installée : $SUDOERS_FILE"
else
  echo "ERREUR : le fichier sudoers généré est invalide, abandon (rien n'a été installé)." >&2
  rm -f "$SUDOERS_FILE.tmp"
  exit 1
fi

log "terminé."
log ""
log "Reste à faire manuellement (voir docs/deployment-oracle.md) :"
log "  1. Déposer les certificats Origin CA Cloudflare dans $TLS_DIR (origin.pem, origin-key.pem)."
log "  2. Remplir $ENV_FILE à partir de deploy/oracle/francemonitor.env.example (secrets)."
log "  3. Premier déploiement via GitHub Actions (deploy-vm.yml) ou manuellement avec fm-deploy."
log "  4. systemctl restart caddy une fois les certificats en place."
