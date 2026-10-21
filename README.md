# QNAP · Backup Control

Lokale Web-App für **QNAP → Proxmox-Host → Debian-LXC → Proxmox Backup Server**.

Mount-Status und Ordnergrößen, manuelle Backups mit Abbruchfunktion, Wochenpläne mit Zeitzone und Zeitplanvorschlägen, Gantt-Diagramm, PBS-Speicherstände, Fortschritt, Laufvergleiche, bearbeitbare Warteschlange, Startfenster, Upload-Limit, Einstellungs-Export und optionale ntfy-Zusammenfassungen. Zwei Backup-Ziele auf demselben oder unterschiedlichen PBS; das Ziel ist je Quelle wählbar. Ein Gesundheitsstatus je Quelle führt zur passenden Aktion; die Wiederherstellungsansicht öffnet den PBS-Datastore und zeigt Snapshot und kurze Prüfschritte. Quellen lassen sich direkt aus der Übersicht bearbeiten. Ein kompakter Assistent führt durch neue Quellen und PBS-Ziele, inklusive Kopierbefehlen.

![Backup Control – Übersicht](https://github.com/user-attachments/assets/6992b213-ba63-4d0f-922a-1ee99742ee03)

## Voraussetzungen

- Debian-12-LXC mit Node.js ab 18 und installiertem `proxmox-backup-client`.
- QNAP-Freigaben am Proxmox-Host per SMB eingebunden und in den LXC unter `/mnt/Daten/` durchgereicht.
- Der Dienstbenutzer muss die Quelldaten lesen können. Die App erstellt keine Mounts.

## Installation

Als root im LXC:

```sh
apt update && apt install -y nodejs git ca-certificates
git clone https://github.com/Schello805/proxmox-backup-client.git /opt/proxmox-backup-client
cd /opt/proxmox-backup-client
bash deploy/install.sh
nano /etc/qnap-backup.env
bash deploy/install.sh
```

Im Environment `APP_PASSWORD` setzen (mindestens sechs Zeichen) oder für Zugriff ohne Anmeldung leeren. Oberfläche: **http://LXC-IP:3000**. Nur im vertrauenswürdigen Netz betreiben; für weitere Zugriffe HTTPS verwenden.

Danach PBS-Zugang unter **Backup-Ziele** speichern und prüfen. Unter **Quellen** die SMB-Zuordnung kontrollieren. Ein erstes Backup starten und im PBS eine Datei testweise wiederherstellen.

## Update und Betrieb

```sh
bash /opt/proxmox-backup-client/deploy/update.sh
systemctl status qnap-backup
journalctl -u qnap-backup -n 50
```

**Alle sichern** stellt sämtliche eingerichteten Quellen in die Warteschlange; sie werden nacheinander auf ihr jeweiliges Ziel gesichert. Bereits laufende oder wartende Quellen werden übersprungen.

Laufende und wartende Aufträge lassen sich in der Übersicht einzeln oder über **Alle abbrechen** stoppen. Vor einem Update warten, bis kein Auftrag mehr läuft oder wartet. Mount-Zuordnungen werden sofort aktualisiert; Lesbarkeit und Ordnergrößen werden im Hintergrund geprüft.

Konfiguration und Verlauf: `/var/lib/qnap-backup/`. Backups laufen nacheinander als `.pxar`-Archive ohne zusätzliche clientseitige Verschlüsselung; die Übertragung erfolgt per TLS. Aufbewahrung und Verify-Jobs werden im PBS konfiguriert. Die App löscht keine PBS-Sicherungen.

[Installation, Update, Rückweg und Fehlerbehebung](docs/OPERATIONS.md)

## Entwicklung

```sh
npm ci
npm start
npm test
npx playwright install chromium
npm run test:browser
```

Ohne echte CIFS-Mounts sind Backups gesperrt. Die Browsertests verwenden isolierte Testdaten.
