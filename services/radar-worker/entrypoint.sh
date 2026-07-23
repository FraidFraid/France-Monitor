#!/bin/sh
# Le volume Railway est monté root : on ajuste la propriété du stockage
# au démarrage puis on exécute uvicorn en utilisateur non privilégié.
set -e
STORAGE="${RADAR_STORAGE_DIR:-/data}"
mkdir -p "$STORAGE"
chown -R 65532:65532 "$STORAGE"
exec setpriv --reuid=65532 --regid=65532 --clear-groups \
  uvicorn app:app --host 0.0.0.0 --port 8091
