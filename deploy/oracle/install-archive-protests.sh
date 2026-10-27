#!/bin/bash
# Installe (ou met à jour) l'archive horaire de la couche Manifestations : minuteur fm-archive-protests (toutes les heures à :23),
# fichiers dans /var/lib/francemonitor/data/manifestations, lus par /api/social/protests-archive. À relancer après un déploiement
# qui change ses unités systemd ; sans effet de bord sinon.
# Usage (depuis le Mac) : ssh -i ~/.ssh/francemonitor_oracle ubuntu@141.145.223.156 'sudo bash /srv/francemonitor/current/deploy/oracle/install-archive-protests.sh'
set -euo pipefail
SRC=/srv/francemonitor/current/deploy/oracle/systemd
[ -f /srv/francemonitor/current/scripts/archive-protests.mjs ] || { echo "ARRET : release sans scripts/archive-protests.mjs, déployer d'abord"; exit 1; }

mkdir -p /var/lib/francemonitor/data/manifestations
chown fm:fm /var/lib/francemonitor/data/manifestations

install -m 644 -o root -g root "$SRC/fm-archive-protests.service" /etc/systemd/system/fm-archive-protests.service
install -m 644 -o root -g root "$SRC/fm-archive-protests.timer" /etc/systemd/system/fm-archive-protests.timer
systemctl daemon-reload
systemctl enable --now fm-archive-protests.timer
echo "Premier relevé…"
systemctl start fm-archive-protests.service || true
journalctl -u fm-archive-protests.service -n 5 --no-pager | grep -E 'archive-protests|Error|ARRET' | tail -2
systemctl list-timers fm-archive-protests.timer --no-pager | sed -n 2p
curl -s http://127.0.0.1:3000/api/social/protests-archive; echo
