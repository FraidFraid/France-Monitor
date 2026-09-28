#!/usr/bin/env bash
# deploy/oracle/oci-retry-launch.sh — relance la création de la VM Always Free « francemonitor »
# (VM.Standard.A1.Flex 2 OCPU / 6 Go, Ubuntu 24.04 Minimal aarch64, disque 100 Go) tant qu'Oracle
# répond « Out of host capacity », puis s'arrête dès qu'elle existe.
#
# Prérequis : OCI CLI configurée (~/.oci/config, compte Free Tier, région eu-paris-1) et la clé SSH
# publique ~/.ssh/francemonitor_oracle.pub. Crée au besoin le réseau (VCN 10.0.0.0/16, passerelle
# internet, sous-réseau public 10.0.0.0/24, ports 22/80/443 ouverts), gratuit.
#
# Lancement en arrière-plan, sans mise en veille du Mac :
#   nohup caffeinate -i bash deploy/oracle/oci-retry-launch.sh >> ~/Library/Logs/francemonitor-oci.log 2>&1 &
# Résultat : IP publique dans ~/.oci/francemonitor-ip.txt + notification macOS.

set -uo pipefail
export SUPPRESS_LABEL_WARNING=True PYTHONWARNINGS=ignore

NAME=francemonitor
REGION=eu-paris-1
AD="mwCU:EU-PARIS-1-AD-1"
SHAPE=VM.Standard.A1.Flex
OCPUS=2
MEMORY_GB=6
BOOT_GB=100
SSH_PUB="$HOME/.ssh/francemonitor_oracle.pub"
RETRY_S=300          # « Out of host capacity » : réessai toutes les 5 min
THROTTLE_S=900       # 429 (trop de requêtes) : on ralentit
IP_FILE="$HOME/.oci/francemonitor-ip.txt"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
notify() { osascript -e "display notification \"$1\" with title \"France Monitor — Oracle\"" >/dev/null 2>&1 || true; }

TENANCY="$(awk -F= '/^tenancy=/{print $2}' "$HOME/.oci/config")"
[ -n "$TENANCY" ] || { log "tenancy introuvable dans ~/.oci/config"; exit 1; }
[ -f "$SSH_PUB" ] || { log "clé SSH absente : $SSH_PUB"; exit 1; }

oci_q() { oci --region "$REGION" "$@"; }

# Lecture stricte : renvoie l'identifiant trouvé (ou une chaîne vide si la liste est vraiment vide),
# et ÉCHOUE si la commande échoue. Une nouvelle clé d'API donne des 401 intermittents pendant
# quelques minutes : les prendre pour « rien n'existe » créerait des doublons (vu le 28/09/2026).
read_id() {
  local out
  out="$(oci_q "$@" 2>/tmp/fm-oci-read.err)" || { log "lecture en échec ($2 $3) — rien n'est créé, nouvel essai plus tard"; return 1; }
  [ "$out" = "null" ] && out=""
  printf '%s' "$out"
}

# ── Réseau (idempotent) ─────────────────────────────────────────────────────────────────────
ensure_network() {
  VCN_ID="$(read_id network vcn list --compartment-id "$TENANCY" --display-name "$NAME-vcn" \
    --query 'data[?"lifecycle-state"==`AVAILABLE`] | [0].id' --raw-output)" || return 1
  if [ -z "$VCN_ID" ]; then
    log "création du réseau $NAME-vcn"
    VCN_ID="$(oci_q network vcn create --compartment-id "$TENANCY" --display-name "$NAME-vcn" \
      --cidr-blocks '["10.0.0.0/16"]' --dns-label fmvcn --wait-for-state AVAILABLE \
      --query 'data.id' --raw-output)" || return 1
  fi
  IGW_ID="$(read_id network internet-gateway list --compartment-id "$TENANCY" --vcn-id "$VCN_ID" \
    --query 'data[0].id' --raw-output)" || return 1
  if [ -z "$IGW_ID" ]; then
    IGW_ID="$(oci_q network internet-gateway create --compartment-id "$TENANCY" --vcn-id "$VCN_ID" \
      --is-enabled true --display-name "$NAME-igw" --wait-for-state AVAILABLE \
      --query 'data.id' --raw-output)" || return 1
  fi
  RT_ID="$(oci_q network vcn get --vcn-id "$VCN_ID" --query 'data."default-route-table-id"' --raw-output)"
  oci_q network route-table update --rt-id "$RT_ID" --force \
    --route-rules "[{\"destination\":\"0.0.0.0/0\",\"destinationType\":\"CIDR_BLOCK\",\"networkEntityId\":\"$IGW_ID\"}]" >/dev/null || return 1
  SL_ID="$(oci_q network vcn get --vcn-id "$VCN_ID" --query 'data."default-security-list-id"' --raw-output)"
  # Entrées : SSH 22, HTTP 80, HTTPS 443 (Caddy derrière Cloudflare) ; sorties : tout.
  local ingress='[' port first=1
  for port in 22 80 443; do
    [ $first -eq 1 ] || ingress+=','
    first=0
    ingress+="{\"source\":\"0.0.0.0/0\",\"protocol\":\"6\",\"isStateless\":false,\"tcpOptions\":{\"destinationPortRange\":{\"min\":$port,\"max\":$port}}}"
  done
  # ICMP « fragmentation nécessaire » (découverte du MTU) et ICMP interne, comme la liste par défaut.
  ingress+=',{"source":"0.0.0.0/0","protocol":"1","isStateless":false,"icmpOptions":{"type":3,"code":4}}'
  ingress+=',{"source":"10.0.0.0/16","protocol":"1","isStateless":false,"icmpOptions":{"type":3}}'
  ingress+=']'
  oci_q network security-list update --security-list-id "$SL_ID" --force \
    --ingress-security-rules "$ingress" \
    --egress-security-rules '[{"destination":"0.0.0.0/0","protocol":"all","isStateless":false}]' >/dev/null || return 1
  SUBNET_ID="$(read_id network subnet list --compartment-id "$TENANCY" --vcn-id "$VCN_ID" \
    --query 'data[0].id' --raw-output)" || return 1
  if [ -z "$SUBNET_ID" ]; then
    SUBNET_ID="$(oci_q network subnet create --compartment-id "$TENANCY" --vcn-id "$VCN_ID" \
      --cidr-block 10.0.0.0/24 --display-name "$NAME-public" --dns-label public \
      --prohibit-public-ip-on-vnic false --wait-for-state AVAILABLE \
      --query 'data.id' --raw-output)" || return 1
  fi
  log "réseau prêt (sous-réseau $SUBNET_ID)"
}

# ── Image Ubuntu 24.04 Minimal aarch64 la plus récente compatible A1 ─────────────────────────
IMAGE_ID="$(oci_q compute image list --compartment-id "$TENANCY" --operating-system "Canonical Ubuntu" \
  --shape "$SHAPE" --sort-by TIMECREATED --sort-order DESC \
  --query 'data[?contains("display-name", `24.04-Minimal-aarch64`)] | [0].id' --raw-output)"
[ -n "$IMAGE_ID" ] && [ "$IMAGE_ID" != "null" ] || { log "image Ubuntu 24.04 Minimal aarch64 introuvable"; exit 1; }
log "image : $IMAGE_ID"

existing_instance() {
  read_id compute instance list --compartment-id "$TENANCY" --display-name "$NAME" \
    --query 'data[?"lifecycle-state"!=`TERMINATED` && "lifecycle-state"!=`TERMINATING`] | [0].id' --raw-output
}

public_ip() {
  oci_q compute instance list-vnics --instance-id "$1" --query 'data[0]."public-ip"' --raw-output 2>/dev/null
}

until ensure_network; do log "réseau : échec, nouvel essai dans 60 s"; sleep 60; done

attempt=0
while true; do
  # Lecture en échec : on ne tente PAS de créer (risque de doublon), on attend le tour suivant.
  if ! INSTANCE_ID="$(existing_instance)"; then sleep 60; continue; fi
  if [ -n "$INSTANCE_ID" ]; then
    log "instance présente : $INSTANCE_ID — attente de l'état RUNNING"
    oci_q compute instance get --instance-id "$INSTANCE_ID" --wait-for-state RUNNING >/dev/null 2>&1 || true
    IP="$(public_ip "$INSTANCE_ID")"
    echo "$IP" > "$IP_FILE"
    log "VM PRÊTE — IP publique : $IP (écrite dans $IP_FILE)"
    notify "VM créée ! IP publique : $IP"
    exit 0
  fi
  attempt=$((attempt + 1))
  log "tentative $attempt de création ($SHAPE $OCPUS OCPU / $MEMORY_GB Go)"
  OUT="$(oci_q compute instance launch --compartment-id "$TENANCY" --availability-domain "$AD" \
    --display-name "$NAME" --shape "$SHAPE" \
    --shape-config "{\"ocpus\":$OCPUS,\"memoryInGBs\":$MEMORY_GB}" \
    --image-id "$IMAGE_ID" --boot-volume-size-in-gbs "$BOOT_GB" \
    --subnet-id "$SUBNET_ID" --assign-public-ip true \
    --ssh-authorized-keys-file "$SSH_PUB" 2>&1)"
  if echo "$OUT" | grep -q '"lifecycle-state"'; then
    log "création acceptée par Oracle"
    continue   # la boucle suivante attend RUNNING et récupère l'IP
  elif echo "$OUT" | grep -qiE 'out of (host )?capacity|OutOfCapacity'; then
    log "pas de capacité — nouvel essai dans $((RETRY_S / 60)) min"
    sleep "$RETRY_S"
  elif echo "$OUT" | grep -qE '"status": 429|TooManyRequests'; then
    log "trop de requêtes (429) — pause de $((THROTTLE_S / 60)) min"
    sleep "$THROTTLE_S"
  elif echo "$OUT" | grep -qiE 'LimitExceeded|QuotaExceeded'; then
    log "limite de compte atteinte : arrêt (vérifier qu'aucune autre instance A1 n'existe)"
    echo "$OUT" | grep -E '"code"|"message"' | head -3
    notify "Arrêt : limite de compte Oracle atteinte (voir le journal)."
    exit 2
  else
    log "erreur inattendue — nouvel essai dans $((RETRY_S / 60)) min"
    echo "$OUT" | grep -E '"code"|"message"|"status"' | head -4
    sleep "$RETRY_S"
  fi
done
