#!/bin/sh
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SCRIPT_FILE=$SCRIPT_DIR/$(basename -- "$0")
APP_DIR=${APP_DIR:-$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)}
DATA_DIR=${DATA_DIR:-/var/lib/qnap-backup}
CONFIG_FILE=${CONFIG_FILE:-$DATA_DIR/config.json}
ENV_FILE=${ENV_FILE:-/etc/qnap-backup.env}
export DATA_DIR CONFIG_FILE
cd "$APP_DIR"
# Beim Ersetzen des Repositorys nicht die gerade gelesene Skriptdatei ändern.
if [ "${1:-}" != "--check" ] && [ "${QNAP_UPDATE_COPY:-}" != 1 ]; then
  COPY_FILE=$(mktemp /tmp/qnap-update.XXXXXX)
  trap 'rm -f "$COPY_FILE"' EXIT
  cp "$SCRIPT_FILE" "$COPY_FILE"
  QNAP_UPDATE_COPY=1 APP_DIR="$APP_DIR" sh "$COPY_FILE" "$@"
  exit 0
fi
check_busy() {
  if [ -f scripts/check.js ]; then node scripts/check.js --busy; return; fi
  # Erster Wechsel von einer Version ohne Prüfskript: nur die Statusdatei lesen.
  node -e 'const fs=require("fs"),file=process.argv[1];try{if(!fs.existsSync(file))process.exit(0);const state=JSON.parse(fs.readFileSync(file,"utf8"));if(Object.values(state.jobs||{}).some(job=>["running","queued"].includes(job.status))){console.error("Update abgebrochen: Backup läuft oder wartet.");process.exit(2);}}catch{console.error("Statusdatei unlesbar. Update abgebrochen.");process.exit(1);}' "$DATA_DIR/state.json"
}
check_busy
if [ "${1:-}" = "--check" ]; then
  if [ -f "$ENV_FILE" ]; then
    exec node scripts/check.js --env-file "$ENV_FILE" --require-client
  fi
  exec node scripts/check.js --require-client
fi
[ "$(id -u)" -eq 0 ] || { echo 'Update als root im LXC ausführen.' >&2; exit 1; }
[ -z "$(git status --porcelain --untracked-files=normal)" ] || { echo 'Lokale Codeänderungen vorhanden. Update abgebrochen.' >&2; exit 1; }
# Vor dem Stoppen prüfen, ob ein ausschließlich vorspulendes Update möglich ist.
git fetch origin
git merge-base --is-ancestor HEAD origin/main || { echo 'Lokaler Stand ist nicht mit origin/main vorspulbar.' >&2; exit 1; }
# Ab jetzt verhindern Scheduler und API neue Starts; die zweite Prüfung schließt
# den Zeitraum zwischen Vorprüfung und Wartungsbeginn ab.
(umask 077; set -C; : > "$DATA_DIR/maintenance") || { echo 'Wartungsdatei existiert bereits. Laufendes Update prüfen.' >&2; exit 1; }
trap 'rm -f "$DATA_DIR/maintenance"' EXIT
check_busy
OLD_COMMIT=$(git rev-parse HEAD)
BACKUP_DIR=/var/backups/qnap-backup/$(date +%Y%m%d-%H%M%S)-$$
install -d -m 700 "$BACKUP_DIR"
WAS_ACTIVE=0
if systemctl is-active --quiet qnap-backup; then WAS_ACTIVE=1; systemctl stop qnap-backup; fi
# Ab hier werden Quellcode und Daten als zusammengehöriger Rückweg gesichert.
tar --exclude=./maintenance -C "$DATA_DIR" -czf "$BACKUP_DIR/data.tar.gz" .
if [ -f "$ENV_FILE" ]; then install -m 600 "$ENV_FILE" "$BACKUP_DIR/qnap-backup.env"; fi
printf '%s\n' "$OLD_COMMIT" > "$BACKUP_DIR/commit"
chmod 600 "$BACKUP_DIR/commit" "$BACKUP_DIR/data.tar.gz"
SUCCESS=0
on_exit() {
  rm -f "$DATA_DIR/maintenance"
  if [ "$SUCCESS" -ne 1 ]; then
    echo "Update fehlgeschlagen. Dienst bleibt gestoppt. Sicherung: $BACKUP_DIR" >&2
    echo 'Rückweg: docs/OPERATIONS.md → Wiederherstellung nach fehlgeschlagenem Update.' >&2
  fi
}
trap on_exit EXIT
git merge --ff-only origin/main
node scripts/check.js --env-file "$ENV_FILE" --user qnap-backup --require-client
install -m 644 deploy/qnap-backup.service /etc/systemd/system/qnap-backup.service
systemctl daemon-reload
if [ "$WAS_ACTIVE" -eq 1 ]; then
  systemctl start qnap-backup
  systemctl is-active --quiet qnap-backup
fi
SUCCESS=1
printf 'Update abgeschlossen. Sicherung: %s\n' "$BACKUP_DIR"
