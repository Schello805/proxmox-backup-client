#!/bin/sh
set -eu
[ "$(id -u)" -eq 0 ] || { echo 'Installation als root im LXC ausführen.' >&2; exit 1; }
APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
[ "$APP_DIR" = /opt/proxmox-backup-client ] || { echo 'Repository zuerst unter /opt/proxmox-backup-client ablegen.' >&2; exit 1; }
command -v node >/dev/null
command -v proxmox-backup-client >/dev/null || { echo 'Proxmox Backup Client zuerst installieren.' >&2; exit 1; }
if ! id qnap-backup >/dev/null 2>&1; then useradd --system --user-group --home-dir /var/lib/qnap-backup --no-create-home --shell /usr/sbin/nologin qnap-backup; fi
install -d -m 700 -o qnap-backup -g qnap-backup /var/lib/qnap-backup
if [ ! -f /etc/qnap-backup.env ]; then
  install -m 600 "$APP_DIR/deploy/qnap-backup.env.example" /etc/qnap-backup.env
  echo '/etc/qnap-backup.env wurde angelegt. APP_PASSWORD setzen oder für Zugriff ohne Anmeldung leeren, dann Installation erneut starten.'
  exit 0
fi
if [ -f /var/lib/qnap-backup/config.json ]; then
  echo 'Vorhandene Installation erkannt. Für Updates deploy/update.sh verwenden.' >&2
  exit 1
fi
export DATA_DIR=/var/lib/qnap-backup CONFIG_FILE=/var/lib/qnap-backup/config.json
cd "$APP_DIR"
node scripts/check.js --env-file /etc/qnap-backup.env --user qnap-backup --require-client
install -m 644 deploy/qnap-backup.service /etc/systemd/system/qnap-backup.service
sh deploy/enable-web-updates.sh
systemctl enable --now qnap-backup
systemctl is-active --quiet qnap-backup
