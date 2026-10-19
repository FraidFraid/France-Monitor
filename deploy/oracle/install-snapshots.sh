#!/bin/bash
# Installe (ou met à jour) les minuteurs des relevés de la VM : fm-oil (pétrole, 3 h) et fm-fuel (tension carburants, 15 min).
# À relancer après un déploiement qui change leurs unités systemd ; sans effet de bord sinon.
# Usage (depuis le Mac) : ssh -i ~/.ssh/francemonitor_oracle ubuntu@141.145.223.156 'sudo bash /srv/francemonitor/current/deploy/oracle/install-snapshots.sh'
set -euo pipefail
SRC=/srv/francemonitor/current/deploy/oracle/systemd
[ -f /srv/francemonitor/current/dist-node/vm-snapshot.mjs ] || { echo "ARRET : release sans dist-node/vm-snapshot.mjs, déployer d'abord"; exit 1; }
for u in fm-oil fm-fuel; do
  install -m 644 -o root -g root "$SRC/$u.service" "/etc/systemd/system/$u.service"
  install -m 644 -o root -g root "$SRC/$u.timer" "/etc/systemd/system/$u.timer"
done
systemctl daemon-reload
for u in fm-oil fm-fuel; do
  systemctl enable --now "$u.timer"
  echo "Premier relevé $u…"
  systemctl start "$u.service"
  journalctl -u "$u.service" -n 8 --no-pager | grep -E '\] relevé|Error|ARRET' | tail -1
  systemctl list-timers "$u.timer" --no-pager | sed -n 2p
done
