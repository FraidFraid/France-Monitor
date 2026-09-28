#!/usr/bin/env bash
# deploy/oracle/fm-deploy.sh — installé en /usr/local/bin/fm-deploy par setup.sh.
#
# Reçoit une archive tar.gz (produite par .github/workflows/deploy-vm.yml,
# nommée francemonitor-<sha>.tar.gz) et déploie France Monitor de façon
# atomique avec retour arrière automatique si la santé échoue.
#
# Usage (root uniquement — appelé via `sudo fm-deploy <archive>`, cf.
# /etc/sudoers.d/fm-deploy) :
#   fm-deploy /tmp/francemonitor-<sha>.tar.gz
#
# Étapes : extraction dans releases/<sha>, `npm ci --omit=dev`, venv radar
# mis à jour seulement si requirements.txt a changé, bascule atomique du
# lien `current`, redémarrage fm-api/fm-relay/fm-radar, attente de santé
# (API, radar, relais) — retour à la release précédente + redémarrage si
# un des trois échoue, purge au-delà de 5 releases conservées.

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "fm-deploy: doit être lancé en root (sudo)." >&2
  exit 1
fi

ARCHIVE="${1:-}"
if [ -z "$ARCHIVE" ] || [ ! -f "$ARCHIVE" ]; then
  echo "usage: fm-deploy <archive.tar.gz>" >&2
  exit 1
fi

BASE=/srv/francemonitor
RELEASES="$BASE/releases"
CURRENT="$BASE/current"
VENV=/opt/francemonitor/radar-venv
RADAR_REQ_HASH_FILE="$VENV/.requirements.sha256"
FM_USER=fm
FM_GROUP=fm
KEEP_RELEASES=5

HEALTH_URL="http://127.0.0.1:3000/healthz"
RELAY_HEALTH_URL="http://127.0.0.1:8090/health"
RADAR_HEALTH_URL="http://127.0.0.1:8091/health"
HEALTH_TIMEOUT_S=90
HEALTH_POLL_INTERVAL_S=2

SERVICES=(fm-api fm-relay fm-radar)

log() { echo "[fm-deploy] $*"; }

# ─── Identifiant de release : nom de l'archive sans extension ───
# (le workflow nomme l'archive francemonitor-<sha_git>.tar.gz — voir
# .github/workflows/deploy-vm.yml).
ARCHIVE_BASENAME="$(basename "$ARCHIVE")"
RELEASE_ID="${ARCHIVE_BASENAME%.tar.gz}"
RELEASE_ID="${RELEASE_ID#francemonitor-}"
# L'identifiant sert de nom de dossier sous releases/ puis d'argument à rm -rf : on n'accepte qu'un
# SHA de commit (7 à 40 caractères hexadécimaux), jamais « .. » ni un chemin.
if ! [[ "$RELEASE_ID" =~ ^[0-9a-f]{7,40}$ ]]; then
  echo "fm-deploy: identifiant de release invalide '$RELEASE_ID' (attendu : francemonitor-<sha>.tar.gz)" >&2
  exit 1
fi
RELEASE_DIR="$RELEASES/$RELEASE_ID"

log "déploiement de la release '$RELEASE_ID' depuis $ARCHIVE"

PREVIOUS=""
if [ -L "$CURRENT" ]; then
  PREVIOUS="$(readlink -f "$CURRENT")"
  log "release actuelle : $PREVIOUS"
fi

if [ -d "$RELEASE_DIR" ]; then
  log "un répertoire existe déjà pour cette release — purge avant réextraction"
  rm -rf "$RELEASE_DIR"
fi

mkdir -p "$RELEASE_DIR"
log "extraction dans $RELEASE_DIR"
tar -xzf "$ARCHIVE" -C "$RELEASE_DIR"

# npm ci tourne sous l'utilisateur de service, pas en root : les scripts d'installation des
# dépendances n'obtiennent aucun privilège.
NPM_CACHE=/var/cache/francemonitor-npm
mkdir -p "$NPM_CACHE"
chown -R "$FM_USER:$FM_GROUP" "$RELEASE_DIR" "$NPM_CACHE"
log "npm ci --omit=dev (utilisateur $FM_USER)"
(cd "$RELEASE_DIR" && runuser -u "$FM_USER" -- env HOME="$NPM_CACHE" npm_config_cache="$NPM_CACHE" \
  npm ci --omit=dev --no-audit --no-fund)

# ─── Venv radar : mis à jour seulement si requirements.txt a changé ───
REQ_FILE="$RELEASE_DIR/services/radar-worker/requirements.txt"
if [ -f "$REQ_FILE" ]; then
  NEW_HASH="$(sha256sum "$REQ_FILE" | cut -d' ' -f1)"
  OLD_HASH=""
  [ -f "$RADAR_REQ_HASH_FILE" ] && OLD_HASH="$(cat "$RADAR_REQ_HASH_FILE")"
  if [ "$NEW_HASH" != "$OLD_HASH" ]; then
    log "requirements.txt radar modifié — mise à jour du venv $VENV"
    "$VENV/bin/pip" install --no-cache-dir --upgrade pip
    "$VENV/bin/pip" install --no-cache-dir -r "$REQ_FILE"
    echo "$NEW_HASH" > "$RADAR_REQ_HASH_FILE"
  else
    log "requirements.txt radar inchangé — venv conservé tel quel"
  fi
else
  log "AVERTISSEMENT : $REQ_FILE absent de l'archive — venv radar inchangé"
fi

chown -R "$FM_USER:$FM_GROUP" "$RELEASE_DIR"

# ─── Bascule atomique du lien `current` ───
log "bascule du lien current -> $RELEASE_DIR"
ln -sfn "$RELEASE_DIR" "$CURRENT.tmp"
mv -Tf "$CURRENT.tmp" "$CURRENT"

log "redémarrage : ${SERVICES[*]}"
systemctl restart "${SERVICES[@]}"

wait_healthy() {
  local url="$1" label="$2"
  local deadline=$((SECONDS + HEALTH_TIMEOUT_S))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if curl -fsS --max-time 5 "$url" >/dev/null 2>&1; then
      log "santé $label OK ($url)"
      return 0
    fi
    sleep "$HEALTH_POLL_INTERVAL_S"
  done
  log "santé $label ÉCHEC après ${HEALTH_TIMEOUT_S}s ($url)"
  return 1
}

rollback_and_exit() {
  log "ÉCHEC du déploiement de '$RELEASE_ID' — retour arrière"
  if [ -n "$PREVIOUS" ] && [ -d "$PREVIOUS" ]; then
    ln -sfn "$PREVIOUS" "$CURRENT.tmp"
    mv -Tf "$CURRENT.tmp" "$CURRENT"
    systemctl restart "${SERVICES[@]}"
    log "revenu à $PREVIOUS et services redémarrés"
  else
    log "aucune release précédente valide — pas de retour arrière possible, services laissés en l'état"
  fi
  exit 1
}

if ! wait_healthy "$HEALTH_URL" "API (fm-api, /healthz)"; then rollback_and_exit; fi
if ! wait_healthy "$RADAR_HEALTH_URL" "radar (fm-radar, /health)"; then rollback_and_exit; fi
if ! wait_healthy "$RELAY_HEALTH_URL" "relais AIS (fm-relay, /health)"; then rollback_and_exit; fi

log "déploiement réussi : $RELEASE_DIR"

# ─── Purge : ne garder que les KEEP_RELEASES dernières (jamais la courante) ───
CURRENT_TARGET="$(readlink -f "$CURRENT")"
mapfile -t OLD_RELEASES < <(find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' \
  | sort -rn | awk '{print $2}' | tail -n +$((KEEP_RELEASES + 1)))
for old in "${OLD_RELEASES[@]:-}"; do
  [ -z "$old" ] && continue
  if [ "$old" = "$CURRENT_TARGET" ]; then
    continue
  fi
  log "purge de l'ancienne release $old"
  rm -rf "${old:?}"
done

rm -f "$ARCHIVE"
log "terminé."
