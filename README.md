# QNAP · Backup Control

Lokale Web-App für **QNAP → Proxmox-Host → Debian-LXC → Proxmox Backup Server**.

Mount-Status und Ordnergrößen, manuelle Backups mit Abbruchfunktion, Wochen- und Monatspläne mit Zeitzone und Zeitplanvorschlägen, Gantt-Diagramm, PBS-Speicherstände, Fortschritt, Laufvergleiche, bearbeitbare Warteschlange, Startfenster, Upload-Limit, Einstellungs-Export und optionale ntfy-Zusammenfassungen. Zwei Backup-Ziele auf demselben oder unterschiedlichen PBS; das Ziel ist je Quelle wählbar. Ein Gesundheitsstatus je Quelle führt zur passenden Aktion; die Wiederherstellungsansicht öffnet den PBS-Datastore und zeigt Snapshot und kurze Prüfschritte. Quellen werden unter Quellen verwaltet; Aufträge und deren Zeitpläne stehen auf der eigenen Seite Aufträge. Ein kompakter Assistent führt durch neue Quellen und PBS-Ziele, inklusive Kopierbefehlen.

Backup-Ziele werden über eine gemeinsame Auswahl hinzugefügt. Kennzahlen zeigen eingerichtete Ziele, Quellenzuordnung, automatische PBS-Pläne und die ermittelte Quellgröße mit Messabdeckung.

Das Dashboard hebt den PBS-Sicherungsstand mit überfälligen und noch ungesicherten Quellen hervor. Google Drive zeigt seinen Status im Zielpanel; Fortschritt und Steuerung stehen auf der Auftragsseite. Zielprobleme bleiben auch bei geschlossenen Einstellungen sichtbar. Das Dashboard zeigt außerdem Mounts, Zielzustand, laufende Aufträge und Hinweise; Auftragsliste, Warteschlange, Drive-Aufträge und Gantt stehen auf der separaten Seite Aufträge. Eine gemeinsame Tabelle zeigt PBS- und Drive-Aufträge mit Quelle, Ziel/Betriebsart, Zeitplan, nächstem Start, letztem Erfolg und Status. Drive-Quellen mit gemeinsamem Plan erscheinen als ein gemeinsamer Auftrag. Die Auftragsliste bleibt offen. Unter Quellen stehen alle Datenquellen in einer durchsuchbaren Tabelle mit Statusfilter und feststehendem Tabellenkopf.

Die eigene Seite „Protokoll“ bündelt aktuelle und archivierte PBS-Ausgaben, Drive-Laufergebnisse und Benachrichtigungsfehler mit Bereichs-, Quellen- und Zielfilter. PBS-Dateien werden bis 256 KiB angezeigt; für Drive stehen bisher Zusammenfassungen zur Verfügung.

Die Navigation steht links: Übersicht, Aufträge, Quellen und Ziele oben; Einstellungen, Anleitung und zuletzt Protokoll unten über dem Controller-Hinweis. Allgemeine Optionen, Systeminformationen, Diagnose und Updates stehen gemeinsam unter Einstellungen; der PBS-Bestand bleibt direkt bei der PBS-Konfiguration erreichbar.

Verwaltung erfolgt über Quellen, Backup-Ziele und Einstellungen. Unter Quellen → Mounts verwalten stehen geprüfte Kopierbefehle für Änderungen an der LXC-Durchreichung; SMB-Storage selbst wird in der Proxmox-Weboberfläche verwaltet. Die App-Anleitung enthält die Übersicht „Verwaltung · Was geht wo?“. Entfernen in der App löscht keine Quelldaten oder Sicherungen.

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

## Google Drive (optional)

[Vollständige Google-Drive-Einrichtung](docs/GOOGLE-DRIVE.md): Google-Client-ID, jede Rclone-Abfrage, Anmeldung ohne Browser und erster Test. Auch direkt in der App unter **Anleitung → Google Drive vollständig einrichten**.

Backup-Ziele und Speicherstände sind aufklappbar; die Google-Kontoquote ergänzt die PBS-Speicherstände. PBS und Google Drive haben getrennte Upload-Limits; aktiviertes ntfy meldet auch Drive-Fehler. Die Übersicht zeigt Drive-Quellen, eigenen Zeitplan, nächsten Termin, letzten Erfolg und Fortschritt; Kopien lassen sich dort starten und abbrechen. Normale Dateien je Quelle in einem eigenen Zielunterordner: Pro Drive-Ziel wählbar: Sicherung mit Versionen (alte Dateien in einem separaten `.versions`-Ordner), Abgleich ohne Löschen und Abgleich mit Löschen (mit Bestätigung). Alle drei übertragen nur neue und geänderte Dateien statt jedes Mal den gesamten Bestand; keine automatische Echtzeitüberwachung. Alte Versionen werden nur im Sicherungsmodus archiviert und nicht automatisch bereinigt; es entstehen keine vollständigen Drive-Snapshots. Die Google-Anmeldung in `rclone.conf` separat schützen und sichern; sie gehört nicht zum Einstellungs-Export.

## Entwicklung

```sh
npm ci
npm start
npm test
npx playwright install chromium
npm run test:browser
```

Ohne echte CIFS-Mounts sind Backups gesperrt. Die Browsertests verwenden isolierte Testdaten.

Nach jedem Drive-Upload vergleicht die App Dateinamen und Größen mit dem Ziel. Unter **Ziele → Google Drive → Zielbestand gründlich prüfen** startet ein lesender Vergleich mit verfügbaren Prüfsummen (sonst Größen). Zusätzliche Zieldateien sind nur beim Abgleich ohne Löschen erlaubt. Ergebnisse stehen getrennt vom Upload im Auftragsstatus und im zentralen Protokoll; Fehler lösen bei aktiviertem ntfy eine Meldung aus. Eine laufende Prüfung lässt sich abbrechen. Während des Vergleichs die Quelle möglichst nicht ändern.

Nach einem PBS-Backup bestätigt die App den Snapshot samt erwartetem Archiv aus dem aktuellen Lauf. Dies prüft den Bestand, nicht sämtliche Datenblöcke. **Verify-Jobs und regelmäßige Wiederherstellungstests auf dem PBS bleiben erforderlich.**

Neben der Versionsnummer zeigt die App den Update-Status. GitHub wird beim Öffnen und danach stündlich bei geöffneter App geprüft; ein Klick auf die Anzeige öffnet System & Wartung. Updates bleiben manuell.
