#!/bin/sh
# fm-backup-db — sauvegarde de la base Neon sur le disque de la VM (docs/deployment-oracle.md § (i)).
#
# Palier gratuit Neon : 5 Go de transfert réseau par mois ; au-delà, la base est suspendue jusqu'au
# mois suivant (production arrêtée). Une copie complète chaque nuit (~230 Mo × 30) dépasserait ce
# plafond. D'où deux sortes de copie :
#   - complète (full) : le dimanche, ou dès que la dernière complète a plus de 8 jours ; 5 gardées ;
#   - légère (light)  : les autres nuits, tout sauf le contenu de news_items (les articles) ; 8 gardées.
# Pire cas : 7 jours d'articles perdus ; événements, journal des événements et flux sauvegardés chaque nuit.
#
# Usage : fm-backup-db [auto|full|light]   (auto par défaut)
# Lancé chaque nuit par fm-backup-db.timer (utilisateur fmbackup, secrets via l'EnvironmentFile).
set -eu
umask 077

BACKUP_DIR=${BACKUP_DIR:-/var/backups/francemonitor}
KEEP_FULL=${KEEP_FULL:-5}
KEEP_LIGHT=${KEEP_LIGHT:-8}
mode=${1:-auto}

log() { echo "[fm-backup-db] $*" >&2; }

case $mode in
  auto | full | light) ;;
  *) log "mode inconnu : $mode (auto, full ou light)"; exit 2 ;;
esac

# Connexion directe : pg_dump passe mal par le pooler PgBouncer de Neon (mode transaction).
url=${DATABASE_URL_UNPOOLED:-}
if [ -z "$url" ]; then
  : "${DATABASE_URL:?DATABASE_URL absente}"
  url=$(printf %s "$DATABASE_URL" | sed 's/-pooler\././')
fi

# Le mot de passe passe par l'environnement, jamais par la ligne de commande (lisible par `ps`).
rest=${url#*://}
query=
case $rest in *\?*) query=${rest#*\?}; rest=${rest%%\?*} ;; esac
creds=${rest%%@*}
hostpart=${rest#*@}
hostport=${hostpart%%/*}
PGUSER=${creds%%:*}
PGPASSWORD=${creds#*:}
PGDATABASE=${hostpart#*/}
PGHOST=${hostport%%:*}
case $hostport in *:*) PGPORT=${hostport#*:} ;; *) PGPORT=5432 ;; esac
case "$PGUSER$PGPASSWORD$PGDATABASE" in *%*) log "identifiants encodés (%xx) non gérés"; exit 1 ;; esac
# Certificat du serveur vérifié contre les autorités du système (Neon : Let's Encrypt).
PGSSLMODE=verify-full
PGSSLROOTCERT=system
export PGUSER PGPASSWORD PGDATABASE PGHOST PGPORT PGSSLMODE PGSSLROOTCERT
case "&$query&" in *'&channel_binding=require&'*) export PGCHANNELBINDING=require ;; esac

if [ "$mode" = auto ]; then
  recent_full=$(find "$BACKUP_DIR" -maxdepth 1 -name 'full-*.dump' -mtime -8 -print -quit)
  if [ "$(date -u +%u)" = 7 ] || [ -z "$recent_full" ]; then mode=full; else mode=light; fi
fi

stamp=$(date -u +%Y-%m-%dT%H%MZ)
final="$BACKUP_DIR/$mode-$stamp.dump"
tmp="$final.part"
trap 'rm -f "$tmp"' EXIT

started=$(date +%s)
if [ "$mode" = light ]; then
  pg_dump --format=custom --compress=6 --no-owner --no-privileges --exclude-table-data=news_items --file="$tmp"
else
  pg_dump --format=custom --compress=6 --no-owner --no-privileges --file="$tmp"
fi

# Contrôle : la copie se relit et contient les données attendues (sinon elle n'est pas gardée).
toc=$(pg_restore --list "$tmp")
expected="news_events news_event_log feeds"
[ "$mode" = full ] && expected="news_items $expected"
for table in $expected; do
  if ! printf '%s\n' "$toc" | grep -q " TABLE DATA public $table "; then
    log "données de $table absentes de la copie $mode : copie écartée"
    exit 1
  fi
done
mv "$tmp" "$final"
trap - EXIT

# Rotation : les noms portent la date, l'ordre alphabétique inverse va du plus récent au plus ancien.
prune() {
  ls -1r "$BACKUP_DIR"/"$1"-*.dump 2>/dev/null | tail -n +"$(($2 + 1))" | while read -r old; do rm -f -- "$old"; done
}
prune full "$KEEP_FULL"
prune light "$KEEP_LIGHT"

printf '{"mode":"%s","file":"%s","bytes":%s,"seconds":%s,"kept_full":%s,"kept_light":%s,"disk_free_kb":%s}\n' \
  "$mode" "$(basename "$final")" "$(stat -c %s "$final")" "$(($(date +%s) - started))" \
  "$(ls -1 "$BACKUP_DIR"/full-*.dump 2>/dev/null | wc -l)" "$(ls -1 "$BACKUP_DIR"/light-*.dump 2>/dev/null | wc -l)" \
  "$(df -Pk "$BACKUP_DIR" | awk 'NR == 2 { print $4 }')"
