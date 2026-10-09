#!/usr/bin/env bash
# deploy/oracle/set-radar-token.sh : pose le jeton Cloudflare Radar (lecture seule, gratuit) dans /etc/francemonitor/francemonitor.env
# sur la VM puis redémarre fm-api, sans jamais l'afficher ni le placer sur une ligne de commande.
# Depuis Claude Code (pas de terminal) : copier le jeton, puis  ! pbpaste | bash deploy/oracle/set-radar-token.sh
# Depuis un terminal : bash deploy/oracle/set-radar-token.sh  (saisie masquée)
# Hôte et clé SSH : ceux de la VM (docs/deployment-oracle.md), surchargeables par FM_VM_HOST et FM_VM_KEY.
set -euo pipefail
HOST="${FM_VM_HOST:-ubuntu@141.145.223.156}"
KEY="${FM_VM_KEY:-$HOME/.ssh/francemonitor_oracle}"
TOKEN=''
if [ -t 0 ]; then
  printf 'Jeton Cloudflare Radar (droit Radar en lecture) : '
  IFS= read -rs TOKEN || true
  printf '\n'
else
  IFS= read -r TOKEN || true
fi
# Seuls les blancs de début et de fin (dont le retour chariot d'un collage) sont retirés ; un blanc interne est refusé plus bas.
TOKEN="${TOKEN#"${TOKEN%%[![:space:]]*}"}"
TOKEN="${TOKEN%"${TOKEN##*[![:space:]]}"}"
if [ -z "$TOKEN" ]; then echo 'Jeton vide : rien n’est changé.' >&2; exit 1; fi
case "$TOKEN" in
  *[[:space:]]* | *[Bb]earer*)
    echo 'Ce texte contient un blanc ou le mot Bearer : copier le jeton seul. Rien n’est changé.' >&2; exit 1 ;;
esac
if ! [[ "$TOKEN" =~ ^[A-Za-z0-9_-]{30,}$ ]]; then echo 'Ce texte ne ressemble pas à un jeton Cloudflare : rien n’est changé.' >&2; exit 1; fi
# Le jeton voyage sur l'entrée standard de ssh, suivi d'un saut de ligne (sans lui, `read` sortirait en erreur sous set -e).
# Côté VM : fichier d'environnement exigé et lisible ; copie dans un temporaire du même dossier (droits root:fm 640 posés avant
# d'y écrire), puis rename atomique ; le temporaire est supprimé à toute sortie.
printf '%s\n' "$TOKEN" | ssh -i "$KEY" -o BatchMode=yes "$HOST" 'sudo bash -c '"'"'
  set -euo pipefail
  ENV=/etc/francemonitor/francemonitor.env
  IFS= read -r TOKEN
  [ -n "$TOKEN" ] || { echo "Jeton non reçu : rien n’est changé." >&2; exit 1; }
  if [ ! -f "$ENV" ] || [ ! -r "$ENV" ]; then echo "Fichier d’environnement absent ou illisible : rien n’est changé." >&2; exit 1; fi
  TMP=""
  cleanup() { if [ -n "$TMP" ]; then rm -f "$TMP"; fi; }
  trap cleanup EXIT
  TMP=$(mktemp "${ENV%/*}/.francemonitor.env.XXXXXX")
  chown root:fm "$TMP"
  chmod 640 "$TMP"
  RC=0
  grep -v "^CLOUDFLARE_RADAR_TOKEN=" "$ENV" > "$TMP" || RC=$?
  if [ "$RC" -gt 1 ]; then echo "Lecture du fichier d’environnement impossible : rien n’est changé." >&2; exit 1; fi
  printf "CLOUDFLARE_RADAR_TOKEN=%s\n" "$TOKEN" >> "$TMP"
  mv -f "$TMP" "$ENV"
  TMP=""
  systemctl restart fm-api
  echo "Jeton posé, fm-api redémarré."
'"'"''
