#!/bin/bash
# Installe le minuteur fm-oil sur la VM (une seule fois, après le déploiement qui apporte dist-node/oil-snapshot.mjs).
# Usage (depuis le Mac) : ssh -i ~/.ssh/francemonitor_oracle ubuntu@141.145.223.156 'sudo bash /srv/francemonitor/current/deploy/oracle/install-oil.sh'
set -euo pipefail
SRC=/srv/francemonitor/current/deploy/oracle/systemd
[ -f /srv/francemonitor/current/dist-node/oil-snapshot.mjs ] || { echo "ARRET : release sans dist-node/oil-snapshot.mjs, déployer d'abord"; exit 1; }
install -m 644 -o root -g root "$SRC/fm-oil.service" /etc/systemd/system/fm-oil.service
install -m 644 -o root -g root "$SRC/fm-oil.timer" /etc/systemd/system/fm-oil.timer
systemctl daemon-reload
systemctl enable --now fm-oil.timer
echo "Premier relevé (quelques secondes)…"
systemctl start fm-oil.service
journalctl -u fm-oil.service -n 5 --no-pager | tail -3
systemctl list-timers fm-oil.timer --no-pager | sed -n 2p
