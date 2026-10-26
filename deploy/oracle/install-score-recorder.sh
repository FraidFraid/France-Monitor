#!/bin/bash
# Installe (ou met à jour) l'enregistreur de la note nationale : Playwright et son Chromium dans /opt/fm-recorder (hors release), profil
# du navigateur dans /var/lib/francemonitor/recorder, minuteur fm-score-recorder (15 min). À relancer après un déploiement qui change
# ses unités systemd ; sans effet de bord sinon.
# Usage (depuis le Mac) : ssh -i ~/.ssh/francemonitor_oracle ubuntu@141.145.223.156 'sudo bash /srv/francemonitor/current/deploy/oracle/install-score-recorder.sh'
set -euo pipefail
SRC=/srv/francemonitor/current/deploy/oracle/systemd
PW_VERSION=1.49.1
[ -f /srv/francemonitor/current/scripts/score-recorder.mjs ] || { echo "ARRET : release sans scripts/score-recorder.mjs, déployer d'abord"; exit 1; }

mkdir -p /opt/fm-recorder /var/lib/francemonitor/recorder
cd /opt/fm-recorder
[ -f package.json ] || echo '{"private":true}' > package.json
npm install --no-audit --no-fund --omit=dev "playwright@${PW_VERSION}"
export PLAYWRIGHT_BROWSERS_PATH=/opt/fm-recorder/browsers
npx --yes playwright install-deps chromium
npx --yes playwright install chromium
chmod -R a+rX /opt/fm-recorder
chown -R fm:fm /var/lib/francemonitor/recorder

install -m 644 -o root -g root "$SRC/fm-score-recorder.service" /etc/systemd/system/fm-score-recorder.service
install -m 644 -o root -g root "$SRC/fm-score-recorder.timer" /etc/systemd/system/fm-score-recorder.timer
systemctl daemon-reload
systemctl enable --now fm-score-recorder.timer
echo "Premier relevé (3 à 5 min)…"
systemctl start fm-score-recorder.service || true
journalctl -u fm-score-recorder.service -n 8 --no-pager | grep -E 'score-recorder|Error|ARRET' | tail -2
systemctl list-timers fm-score-recorder.timer --no-pager | sed -n 2p
free -m | sed -n 1,2p
