#!/bin/bash
# Installe le minuteur fm-arretes sur la VM (une seule fois, après le déploiement qui apporte scripts/build-arretes.mjs).
# Usage (depuis le Mac) : ssh -i ~/.ssh/francemonitor_oracle ubuntu@141.145.223.156 'sudo bash /srv/francemonitor/current/deploy/oracle/install-arretes.sh'
set -euo pipefail
SRC=/srv/francemonitor/current/deploy/oracle/systemd
[ -f /srv/francemonitor/current/scripts/build-arretes.mjs ] || { echo "ARRET : release sans scripts/build-arretes.mjs, déployer d'abord"; exit 1; }
install -m 644 -o root -g root "$SRC/fm-arretes.service" /etc/systemd/system/fm-arretes.service
install -m 644 -o root -g root "$SRC/fm-arretes.timer" /etc/systemd/system/fm-arretes.timer
systemctl daemon-reload
systemctl enable --now fm-arretes.timer
echo "Premier relevé (quelques minutes)…"
systemctl start fm-arretes.service
journalctl -u fm-arretes.service -n 5 --no-pager | tail -4
systemctl list-timers fm-arretes.timer --no-pager | sed -n 2p
