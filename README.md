# Backup Control

Lokale Web-App für **QNAP → Debian-LXC → Proxmox Backup Server** und **Google Drive über Rclone**. Gemeinsame Übersicht über Planung, App-Aufträge und extern umgesetzte Sicherungen. Die frühere Planner-App wird für das Bearbeiten der Planung nicht benötigt.

- **Übersicht:** Laufstatus, Fehler, Quellen, Ziele und tatsächliche Sicherungswege.
- **Aufträge:** eingerichtete App-Aufträge und externe Sicherungen gemeinsam sehen; PBS und Drive starten/abbrechen.
- **Zeitplan:** alle eingerichteten Backups als Woche/Agenda; geplante Wege optional vergleichen, Zeitfenster und erwartete Netzlast prüfen.
- **Backup-Planung:** Planner-Import und vollständige Bearbeitung; je Weg geplant, App-Umsetzung oder externe Umsetzung dokumentieren.
- **Daten / Ziele:** Gerät → Datenbestand → Zielgerät → Datastore/Ordner abbilden. Geräte direkt unter Daten verwalten; Mount-Änderungen am Host bleiben Teil der Anleitung.
- **Einstellungen / Protokoll:** Zeitzone, Bandbreite, ntfy, Updates, Diagnose und zentrale Laufprotokolle.

## Installation

Voraussetzung: Debian-12-LXC, Node.js ab 18, installierter `proxmox-backup-client` und für den Dienstbenutzer lesbare Freigaben unter `/mnt/Daten/`.

Als root im LXC:

```sh
apt update && apt install -y nodejs git ca-certificates
git clone https://github.com/Schello805/proxmox-backup-client.git /opt/proxmox-backup-client
cd /opt/proxmox-backup-client
bash deploy/install.sh
nano /etc/qnap-backup.env
bash deploy/install.sh
```

Oberfläche: **http://LXC-IP:3000**. `APP_PASSWORD` schützt die App; leer lassen für Zugriff ohne Anmeldung im vertrauenswürdigen Netz. PBS und Google Drive anschließend unter **Ziele** einrichten.

## Aktualisieren

```sh
bash /opt/proxmox-backup-client/deploy/update.sh
```

Vor dem Update laufende Aufträge beenden. Konfiguration und Verlauf liegen unter `/var/lib/qnap-backup/`. Die App löscht keine PBS-Sicherungen; Aufbewahrung und Verify werden im PBS konfiguriert. PBS nutzt `.pxar`-Archive, Drive normale Dateien mit wählbarem Versions- oder Abgleichmodus.

## Anleitungen

- [Installation, Betrieb und Fehlerbehebung](docs/OPERATIONS.md)
- [Google Drive vollständig einrichten](docs/GOOGLE-DRIVE.md)
- [Planner-Import, Strategie und Kalender](docs/STRATEGY.md)

Der Planner-Import startet keine Sicherungen. Externe Umsetzung dokumentiert das ausführende System und den Zeitplan, ohne einen automatischen Laufnachweis zu behaupten. Netzlast-Hinweise beruhen auf bekannten/geschätzten Zeiten und MiB/s, nicht auf Live-Messungen. Strategie und App-Einstellungen getrennt exportieren; die Rclone-Anmeldung separat sichern.

## Entwicklung

```sh
npm ci
npx playwright install chromium
npm run test:all
```
