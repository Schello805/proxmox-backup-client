# QNAP → Proxmox Backup Control

Eine lokale Web-App für einen bestehenden Debian-12-LXC. Zeigt durchgereichte QNAP-SMB-Freigaben, startet den Proxmox Backup Client und dokumentiert den Aufbau. Ohne npm-Abhängigkeiten; Node.js ab Version 18.

## Bestehender Aufbau / Vorbereitung

```text
QNAP NAS ── SMB/CIFS ── Proxmox-Host ── Bind Mount ── Debian-12-LXC ── TLS ── PBS
```

### Dokumentierter Ist-Stand

Nach Angaben des Betreibers (20.10.2026):

- Frischer **unprivilegierter Debian-12-LXC (Bookworm)**. Vorherige Versuche unter Ubuntu und Debian 13 hatten Paketprobleme mit `libfuse3-3`; Debian 12 ist die bestehende funktionierende Basis.
- SMB-Anbindung am Proxmox-Host, Durchreichung als Bind-Mounts nach `/mnt/Daten/` im LXC. Im Container wird keine zusätzliche SMB-Anmeldung eingerichtet.
- Datastore **`pbs1`** wurde bereits gelöscht und neu angelegt. Dies ist eine abgeschlossene historische Maßnahme, **kein Installationsschritt** dieser App.
- Backup Client aus dem offiziellen Proxmox-Repository installiert; CLI-Verbindung mit `PBS_REPOSITORY` und `PBS_PASSWORD` eingerichtet.
- Software-Backup mit `.pxar` und `--backup-id software` gestartet. Erfolgreicher Abschluss und Restore sind noch zu bestätigen.
- Frühere KI-Vorlage: Node.js/Express/Tailwind mit `config.json`, `server.js`, `index.html`. Die hier bereitgestellte App verwendet Node.js ohne zusätzliche npm-Abhängigkeiten und eigenes CSS; Frontend-Dateien liegen ausschließlich in `public/`.

Diese Angaben sind dokumentierter Bestand, keine automatische Live-Verifikation. Die App importiert weder CLI-Umgebungsvariablen noch historische Backup-Ergebnisse. Das vollständige Repository mit Ziel-Datastore `pbs1` muss in den App-Einstellungen eingetragen werden.

Debian 12 und `proxmox-backup-client` sind im LXC bereits installiert. Bei Neuinstallation zuerst einen Debian-12-LXC anlegen und den Client entsprechend der [offiziellen Proxmox-Anleitung](https://pbs.proxmox.com/docs/installation.html) installieren. PBS, Datastore und ein berechtigter Backup-Benutzer bzw. API-Token müssen vorhanden sein.

Die QNAP-Freigaben werden **am Proxmox-Host** per SMB eingebunden und über die LXC-Konfiguration durchgereicht. Beispiel (auf dem Host, vorhandene Konfiguration beachten):

```text
mp0: /mnt/qnap,mp=/mnt/Daten,ro=1
```

`/mnt/qnap` ist ein Beispiel für den unbekannten Hostpfad. Es können auch mehrere einzelne Durchreichungen existieren. Die bestätigten Pfade **im LXC** sind:

| Auftrag | Pfad | Backup-Gruppe |
|---|---|---|
| Software | `/mnt/Daten/Software` | `host/software` |
| Filme | `/mnt/Daten/Filme` | `host/filme` |
| Serien | `/mnt/Daten/Serien` | `host/serien` |
| Hörspiele | `/mnt/Daten/Hoerspiele` | `host/hoerspiele` |
| Musik | `/mnt/Daten/Musik` | `host/musik` |

Im LXC beispielsweise mit `findmnt -T /mnt/Daten/Software` prüfen. Der Dateisystemtyp muss `cifs` oder `smb3` sein. Der Host muss SMB vor dem LXC-Start einbinden. Beim Dienststart vorhandene Mounts werden in dessen durch systemd isolierte Mount-Umgebung übernommen; bei späteren Mount-Änderungen den Dienst neu starten und erneut prüfen.

## Installation im vorhandenen LXC

Die folgenden Befehle als root **im LXC** ausführen. Es wird kein Container angelegt und keine vorhandene SMB-Konfiguration verändert.

```sh
apt update
apt install -y nodejs git ca-certificates
node --version
proxmox-backup-client version

git clone https://github.com/Schello805/proxmox-backup-client.git /opt/proxmox-backup-client
cd /opt/proxmox-backup-client
useradd --system --user-group --home-dir /var/lib/qnap-backup --no-create-home --shell /usr/sbin/nologin qnap-backup
install -m 600 deploy/qnap-backup.env.example /etc/qnap-backup.env
nano /etc/qnap-backup.env
```

In `/etc/qnap-backup.env` ein eigenes `APP_PASSWORD` mit mindestens sechs Zeichen setzen. Es wird kein Benutzername benötigt; ein vorhandenes `APP_USER` wird ignoriert. `HOST=0.0.0.0` macht die Oberfläche im LXC-Netz erreichbar. Zugriff über `http://<LXC-IP>:3000`. Passwort-Anmeldung über unverschlüsseltes HTTP nur im vertrauenswürdigen Netz einsetzen; für andere Netze HTTPS-Reverse-Proxy oder einen SSH-Tunnel verwenden. Keine direkte Internetfreigabe.

Der Dienstbenutzer `qnap-backup` muss alle fünf Verzeichnisse und deren Dateien lesen und Verzeichnisse betreten können. Bei einem unprivilegierten LXC die UID/GID-Zuordnung berücksichtigen. Berechtigungen und SMB-Optionen auf dem Proxmox-Host passend zur vorhandenen Konfiguration einstellen; keine pauschalen `chmod 777` verwenden.

```sh
runuser -u qnap-backup -- ls /mnt/Daten/Software
runuser -u qnap-backup -- ls /mnt/Daten/Filme
runuser -u qnap-backup -- ls /mnt/Daten/Serien
runuser -u qnap-backup -- ls /mnt/Daten/Hoerspiele
runuser -u qnap-backup -- ls /mnt/Daten/Musik

install -m 644 deploy/qnap-backup.service /etc/systemd/system/qnap-backup.service
systemctl daemon-reload
systemctl enable --now qnap-backup
systemctl status qnap-backup
journalctl -u qnap-backup -n 50
```

Falls der Dienst wegen LXC/systemd-Isolierung nicht startet, den konkreten Journalfehler prüfen; nicht den LXC pauschal privilegieren. Die App benötigt weder Mount-Rechte noch Zugriff auf die Proxmox-Host-Konfiguration.

## Erster Start und Einstellungen

1. Web-App öffnen und im App-Modal mit dem Passwort aus `/etc/qnap-backup.env` anmelden.
2. Unter **Einstellungen** PBS-Adresse (z. B. `192.168.1.20`), Datastore (`pbs1`) und PBS-Benutzer (z. B. `backup@pbs`) eintragen. Mit API-Token lautet der Benutzer z. B. `backup@pbs!qnap`. Die App setzt daraus das Repository zusammen.
3. Passwort bzw. API-Token-Secret hinterlegen. Bei selbst signiertem Zertifikat den **im PBS verifizierten** SHA-256-Fingerprint eintragen; optional den bereits angelegten Namespace.
4. **Speichern & Verbindung prüfen** wählen. Dies prüft Anmeldung und Snapshot-Abfrage, nicht die Schreibrechte oder den Zustand aller Quelldateien.
5. Mounts prüfen und einen Auftrag manuell sichern. Protokoll und Ergebnis kontrollieren, anschließend im PBS einen Restore testen.
6. Pro Ordner eine Frequenz und Uhrzeit wählen: täglich, werktags, Wochenende, wöchentlich oder eigene Wochentage. Mehrere Tage sind kombinierbar; „Nur manuell“ deaktiviert den Zeitplan.

Repository-Syntax, Umgebungsvariablen und Backup/Restore sind in der [Proxmox Client-Dokumentation](https://pbs.proxmox.com/docs/backup-client.html) beschrieben. PBS-Rechte einschließlich Token-Rechte und Rechte auf dem Namespace passend setzen. Die Verbindungstest-Abfrage kann zusätzliche Leserechte gegenüber einem reinen Backup-Zugang benötigen.

Passwörter werden nicht an die Oberfläche zurückgegeben. Ein leeres Passwortfeld behält das gespeicherte Passwort. Zum Entfernen des Secrets den Dienst stoppen und die Konfigurationsdatei lokal bearbeiten. Konfigurationsänderungen sind während laufender oder wartender Aufträge gesperrt.

## Betrieb und Datensicherheit

- Pro Ordner ein Archiv `qnap-<ordner>.pxar` in einer eigenen Gruppe `host/<ordner>`. Die Backup-IDs entsprechen dem bisherigen CLI-Aufbau (`--backup-id software` usw.). Für die Fortsetzung einer bestehenden Gruppe müssen Repository, Namespace und Besitzer übereinstimmen. Bereits mit der ersten App-Version angelegte Gruppen `host/qnap-<ordner>` bleiben im PBS erhalten; sie werden nicht verschoben oder gelöscht.
- Vor jedem Backup: Linux-Mountinfo auswerten und Quellverzeichnis öffnen. Ohne SMB/CIFS-Dateisystem kein Backup. Dies erkennt fehlende Mounts, **nicht die Identität** der erwarteten QNAP-Freigabe. Die Oberfläche zeigt die erkannte SMB-Quelle als Tooltip. Verbindungen können während des Backups ausfallen; den tatsächlichen Lauf und PBS-Verify prüfen.
- Zusätzliche untergeordnete Mounts werden vom Backup Client standardmäßig übersprungen. Für diesen Aufbau werden die fünf Quellordner einzeln gesichert. Symlinks werden als solche archiviert, nicht als zusätzliche Datenquellen verfolgt.
- **Keine zusätzliche clientseitige Verschlüsselung** (`--crypt-mode none`). Transport zum PBS per TLS. Verschlüsselung mit Schlüsselverwaltung ist in dieser Version nicht implementiert.
- Alle Aufträge laufen nacheinander, damit QNAP und Netzwerk nicht durch fünf gleichzeitige Läufe belastet werden.
- An den gewählten Wochentagen in `Europe/Berlin`, höchstens ein automatischer Start pro Auftrag und Kalendertag. Uhrzeit muss während des laufenden Dienstes erreicht werden. Keine Nachholung verpasster Zeiten, keine Benachrichtigungen. Nicht existierende Uhrzeiten bei Sommerzeit werden übersprungen; doppelte Uhrzeiten lösen nur einmal aus.
- Bei Dienstende werden laufende Prozesse beendet. Beim Neustart werden vorher laufende/wartende Aufträge als unterbrochen markiert, nicht automatisch wiederholt. Kein zweites App-Exemplar mit denselben Daten betreiben.
- Konfiguration: `/var/lib/qnap-backup/config.json`; Status: `state.json`; letzter Lauf je Ordner: `<ordner>.log` (max. 256 KiB). Alle Dateien nur für den Dienstbenutzer lesbar. Kein vollständiges Protokollarchiv.
- „Letzter Erfolg“ bedeutet Exit-Code 0 eines von dieser App gestarteten Backups, keine unabhängige Integritätsprüfung im PBS.
- Aufbewahrung, Prune, Garbage Collection und Verify-Jobs im PBS konfigurieren. Die App löscht keine PBS-Daten.
- Die Web-App fragt weder QNAP noch Proxmox-Host direkt ab. Das Architekturdiagramm beschreibt den bestätigten Aufbau; live geprüft werden LXC, Mounts und auf Anforderung die PBS-Verbindung.

## Wiederherstellung testen

Am einfachsten im PBS-Webinterface eine Datei aus dem Snapshot herunterladen. Alternativ im LXC in einen separaten, beschreibbaren lokalen Testordner wiederherstellen. In dieser Shell `PBS_REPOSITORY`, `PBS_PASSWORD`, bei Bedarf `PBS_FINGERPRINT` und `PBS_NAMESPACE` setzen; die App-Konfiguration wird vom CLI nicht automatisch eingelesen. Secrets nicht in die Shell-History schreiben, z. B. mit `read -rs PBS_PASSWORD; export PBS_PASSWORD` in Bash erfassen.

```sh
proxmox-backup-client snapshot list
mkdir -p /tmp/restore-test
proxmox-backup-client restore 'host/software/<ZEITSTEMPEL>' qnap-software.pxar /tmp/restore-test
```

Snapshot-Namen aus der Liste übernehmen. Bei älteren CLI-Sicherungen den tatsächlichen Archivnamen im PBS prüfen; `.pxar` allein legt den Archivnamen nicht fest. Testdateien öffnen und mit der Quelle vergleichen. Nicht in produktive QNAP-Verzeichnisse zurückschreiben.

## Anmeldung und Live-Status

Die App öffnet ein eigenes Passwort-Modal, ohne Benutzername und ohne Browser-Anmeldefenster. `APP_PASSWORD` akzeptiert mindestens sechs Zeichen; längere bestehende Passwörter bleiben gültig. Die Anmeldung gilt zwölf Stunden und verwendet ein zufälliges HttpOnly-/SameSite-Cookie. „Sperren“ beendet die Sitzung; nach Dienstneustart ist eine erneute Anmeldung nötig. Nach zehn Fehlversuchen pro IP wird eine Minute lang begrenzt. Bei HTTPS-Reverse-Proxy `COOKIE_SECURE=true` in der Dienst-Umgebung setzen.

Oben in der Übersicht stehen laufender Auftrag, Prüfschritt oder Backup-Phase, Startzeit, Laufzeit, Auslöser und Warteschlange. Das Live-Protokoll und die Auftragszustände aktualisieren sich alle drei Sekunden, die aufwendigere Mount-Prüfung alle 15 Sekunden. Es wird keine geschätzte Prozentanzeige erfunden. Separat in einer Shell gestartete Backups sind nicht Teil dieses Status.

### Update von der ersten Version

Bestehende PBS-Einstellungen, Zeitpläne und Ergebnisse bleiben erhalten. Nach dem Update einmal mit dem bisherigen `APP_PASSWORD` im neuen App-Dialog anmelden. Optional in `/etc/qnap-backup.env` ein kürzeres Passwort (mindestens sechs Zeichen) setzen; `APP_USER` kann entfernt werden. Danach den Dienst neu starten.

## Updates

```sh
systemctl stop qnap-backup
cd /opt/proxmox-backup-client
git pull --ff-only
npm test
systemctl start qnap-backup
```

Konfiguration und Ergebnisse unter `/var/lib/qnap-backup` bleiben erhalten. Vor Updates dieses Verzeichnis separat sichern; es enthält Zugangsdaten.

## Lokale Entwicklung

```sh
APP_PASSWORD='lokales-testpasswort' npm start
npm test
```

Standard: `127.0.0.1:3000`, Anmeldung nur mit App-Passwort. Ohne Linux-Mountinfo und echte CIFS-Quellen werden alle Mounts als nicht verfügbar angezeigt und Backups gesperrt. Keine simulierten Erfolgsmeldungen. `config.json` und `data/` sind von Git ausgeschlossen. Getestet werden Mount-Erkennung, Validierung, Zeitpläne und die HTTP-Schnittstelle; der reale PBS-/QNAP-Betrieb muss im LXC geprüft werden.

## Wochenpläne

Pro Ordner wird ein Wochenplan als `{ "days": [1, 3, 5], "time": "02:30" }` gespeichert (1 = Montag, 7 = Sonntag). Das Beispiel sichert montags, mittwochs und freitags um 02:30 Uhr. Die Presets „Täglich“, „Werktags“, „Wochenende“ und „Wöchentlich“ setzen passende Tage; unter „Eigene Tage“ sind mehrere Tage frei wählbar. Eine gemeinsame Uhrzeit gilt für alle gewählten Tage. „Nur manuell“ entspricht `{ "days": [], "time": "" }`.

Alte Konfigurationen mit einer einfachen Uhrzeit werden beim Laden automatisch als tägliche Pläne verstanden und beim nächsten Speichern im neuen Format abgelegt. Die Sicherung bleibt auf höchstens einen automatischen Start pro Ordner und Kalendertag begrenzt. Ausgefallene Zeiten werden weiterhin nicht nachgeholt.
