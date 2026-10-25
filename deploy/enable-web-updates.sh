#!/bin/sh
set -eu
[ "$(id -u)" -eq 0 ] || { echo 'Aktivierung als root im LXC ausführen.' >&2; exit 1; }
APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
[ "$APP_DIR" = /opt/proxmox-backup-client ] || { echo 'Web-Updates erfordern /opt/proxmox-backup-client.' >&2; exit 1; }
cd "$APP_DIR"
install -d -m 755 -o root -g root /usr/local/lib/qnap-backup
install -m 644 -o root -g root deploy/web-update.cjs /usr/local/lib/qnap-backup/web-update.cjs
install -m 644 deploy/qnap-backup-update.service /etc/systemd/system/qnap-backup-update.service
install -m 644 deploy/qnap-backup-update.path /etc/systemd/system/qnap-backup-update.path
systemctl daemon-reload
systemctl enable --now qnap-backup-update.path
systemctl is-active --quiet qnap-backup-update.path
printf 'Web-Updates aktiviert. Künftige Updates im App-Footer starten.\n'
