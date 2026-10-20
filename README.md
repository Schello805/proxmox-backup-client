# QNAP → Proxmox Backup Control

Version 2.1.0 · [Betrieb, sichere Updates und Fehlerbehebung](docs/OPERATIONS.md)

Eine lokale Web-App für einen bestehenden Debian-12-LXC. Zeigt durchgereichte QNAP-SMB-Freigaben, startet den Proxmox Backup Client und dokumentiert den Aufbau. Ohne npm-Abhängigkeiten; Node.js ab Version 18.

## Neu in 2.1.0

- Live-Status mit Laufzeit, verarbeiteter Datenmenge, Client-Upload und durchschnittlicher Verarbeitungsgeschwindigkeit. Messwerte abhängig vom installierten Client; keine geschätzten Prozentwerte.
- „System & Wartung“ über „Diagnose“ oder den Versionsbutton: Mount-/Verzeichniszugriff, PBS-Verbindung, lokale Laufzeitumgebung und Wochenpläne prüfen.
- Manuelle GitHub-Update-Prüfung mit Versions- und Commit-Vergleich, Erkennung lokaler Änderungen und dokumentiertem Update-Weg.

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

Diese Angaben sind dokumentierter Bestand, keine automatische Live-Verifikation. Die App importiert keine CLI-Umgebungsvariablen. Vorhandene Snapshots einschließlich historischer CLI-Sicherungen lassen sich über „PBS-Bestand“ auslesen; sie werden nicht in lokale App-Laufprotokolle umgewandelt. Das vollständige Repository mit Ziel-Datastore `pbs1` muss in den App-Einstellungen eingetragen werden.

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
| Daten | `/mnt/Daten/Daten` | `host/daten` |

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

Für Passwortschutz in `/etc/qnap-backup.env` ein eigenes `APP_PASSWORD` mit mindestens sechs Zeichen setzen. Ohne gesetztes Passwort startet eine neue Konfiguration ohne Anmeldung. Es wird kein Benutzername benötigt; ein vorhandenes `APP_USER` wird ignoriert. `HOST=0.0.0.0` macht die Oberfläche im LXC-Netz erreichbar. Zugriff über `http://<LXC-IP>:3000`. Passwort-Anmeldung über unverschlüsseltes HTTP nur im vertrauenswürdigen Netz einsetzen; für andere Netze HTTPS-Reverse-Proxy oder einen SSH-Tunnel verwenden. Keine direkte Internetfreigabe.

Der Dienstbenutzer `qnap-backup` muss alle eingerichteten Quellverzeichnisse und deren Dateien lesen und Verzeichnisse betreten können. Bei einem unprivilegierten LXC die UID/GID-Zuordnung berücksichtigen. Berechtigungen und SMB-Optionen auf dem Proxmox-Host passend zur vorhandenen Konfiguration einstellen; keine pauschalen `chmod 777` verwenden.

```sh
runuser -u qnap-backup -- ls /mnt/Daten/Software
runuser -u qnap-backup -- ls /mnt/Daten/Filme
runuser -u qnap-backup -- ls /mnt/Daten/Serien
runuser -u qnap-backup -- ls /mnt/Daten/Hoerspiele
runuser -u qnap-backup -- ls /mnt/Daten/Musik
runuser -u qnap-backup -- ls /mnt/Daten/Daten

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
4. **Einstellungen speichern** und danach separat **Verbindung prüfen** wählen. Dies prüft Anmeldung und Snapshot-Abfrage, nicht die Schreibrechte oder den Zustand aller Quelldateien.
5. Mounts prüfen und einen Auftrag manuell sichern. Protokoll und Ergebnis kontrollieren, anschließend im PBS einen Restore testen.
6. Pro Ordner eine Frequenz und Uhrzeit wählen: täglich, werktags, Wochenende, wöchentlich oder eigene Wochentage. Mehrere Tage sind kombinierbar; „Nur manuell“ deaktiviert den Zeitplan.

Repository-Syntax, Umgebungsvariablen und Backup/Restore sind in der [Proxmox Client-Dokumentation](https://pbs.proxmox.com/docs/backup-client.html) beschrieben. PBS-Rechte einschließlich Token-Rechte und Rechte auf dem Namespace passend setzen. Die Verbindungstest-Abfrage kann zusätzliche Leserechte gegenüber einem reinen Backup-Zugang benötigen.

Passwörter werden nicht an die Oberfläche zurückgegeben. Ein leeres Passwortfeld behält das gespeicherte Passwort. Zum Entfernen des Secrets den Dienst stoppen und die Konfigurationsdatei lokal bearbeiten. Konfigurationsänderungen sind während laufender oder wartender Aufträge gesperrt.

## Betrieb und Datensicherheit

- Pro Ordner ein Archiv `qnap-<ordner>.pxar` in einer eigenen Gruppe `host/<ordner>`. Die Backup-IDs entsprechen dem bisherigen CLI-Aufbau (`--backup-id software` usw.). Für die Fortsetzung einer bestehenden Gruppe müssen Repository, Namespace und Besitzer übereinstimmen. Bereits mit der ersten App-Version angelegte Gruppen `host/qnap-<ordner>` bleiben im PBS erhalten; sie werden nicht verschoben oder gelöscht.
- Vor jedem Backup: Linux-Mountinfo auswerten und Quellverzeichnis öffnen. Ohne SMB/CIFS-Dateisystem kein Backup. Unter **Quellen → SMB bestätigen** die erkannte Freigabe prüfen und festlegen. Danach wird vor jedem Backup auch deren Identität exakt mit dem erwarteten `//server/freigabe` verglichen; bei Abweichung ist das Backup gesperrt. Ohne Bestätigung wird weiterhin nur der Dateisystemtyp geprüft. Die Oberfläche zeigt die erkannte SMB-Quelle als Tooltip. Verbindungen können während des Backups ausfallen; den tatsächlichen Lauf und PBS-Verify prüfen.
- Zusätzliche untergeordnete Mounts werden vom Backup Client standardmäßig übersprungen. Für diesen Aufbau werden die Quellordner einzeln gesichert. Symlinks werden als solche archiviert, nicht als zusätzliche Datenquellen verfolgt.
- **Keine zusätzliche clientseitige Verschlüsselung** (`--crypt-mode none`). Transport zum PBS per TLS. Verschlüsselung mit Schlüsselverwaltung ist in dieser Version nicht implementiert.
- Alle Aufträge laufen nacheinander, damit QNAP und Netzwerk nicht durch gleichzeitige Läufe belastet werden.
- An den gewählten Wochentagen in der eingestellten IANA-Zeitzone (Standard `Europe/Berlin`), höchstens ein automatischer Start pro Auftrag und Kalendertag. Uhrzeit muss während des laufenden Dienstes erreicht werden. Keine automatische Nachholung verpasster Zeiten. Überfällige Läufe werden angezeigt; optionale ntfy-Fehlermeldungen sind verfügbar. Nicht existierende Uhrzeiten bei Sommerzeit werden übersprungen; doppelte Uhrzeiten lösen nur einmal aus.
- Bei Dienstende werden laufende Prozesse beendet. Beim Neustart werden vorher laufende/wartende Aufträge als unterbrochen markiert, nicht automatisch wiederholt. Kein zweites App-Exemplar mit denselben Daten betreiben.
- Konfiguration: `/var/lib/qnap-backup/config.json`; Status: `state.json`; letzter Lauf je Ordner: `<ordner>.log` (max. 256 KiB). Die letzten zehn abgeschlossenen App-Läufe inklusive begrenztem Protokoll liegen zusätzlich unter `history/<backup-id>/`. Alle Dateien sind nur für den Dienstbenutzer lesbar. Ältere Verlaufseinträge und deren lokale Protokolle werden automatisch entfernt; PBS-Backups bleiben unberührt.
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

Unter **Einstellungen → App mit Passwort schützen → Zugang speichern** lässt sich der App-Passwortschutz unabhängig von PBS-Zugang und Zeitplänen ein- oder ausschalten. Bei ausgeschaltetem Schutz ist die App für erreichbare Geräte im Netzwerk ohne Anmeldung bedienbar. Ein vorhandenes `APP_PASSWORD` kann für späteres Wiedereinschalten gesetzt bleiben. Bei eingeschaltetem Schutz öffnet die App ein eigenes Passwort-Modal, ohne Benutzername und ohne Browser-Anmeldefenster. `APP_PASSWORD` benötigt bei eingeschaltetem Schutz mindestens sechs Zeichen; längere bestehende Passwörter bleiben gültig. Die Auswahl wird als `authEnabled` in der Konfiguration gespeichert und bleibt beim Neustart erhalten. Für bestehende Konfigurationen mit gesetztem `APP_PASSWORD` bleibt der Schutz beim Update zunächst eingeschaltet. Ohne gesetztes Passwort ist Einschalten erst nach Setzen von `APP_PASSWORD` und Dienstneustart möglich. Die Anmeldung gilt zwölf Stunden und verwendet ein zufälliges HttpOnly-/SameSite-Cookie. „Sperren“ beendet die Sitzung; nach Dienstneustart ist eine erneute Anmeldung nötig. Nach zehn Fehlversuchen pro IP wird eine Minute lang begrenzt. Bei HTTPS-Reverse-Proxy `COOKIE_SECURE=true` in der Dienst-Umgebung setzen.

Oben in der Übersicht stehen laufender Auftrag, Prüfschritt oder Backup-Phase, Startzeit, Laufzeit, Auslöser und Warteschlange. Das Live-Protokoll und die Auftragszustände aktualisieren sich alle drei Sekunden, die aufwendigere Mount-Prüfung alle 15 Sekunden. Es wird keine geschätzte Prozentanzeige erfunden. Separat in einer Shell gestartete Backups sind nicht Teil dieses Status.

### Update von der ersten Version

Bestehende PBS-Einstellungen, Zeitpläne und Ergebnisse bleiben erhalten. Nach dem Update einmal mit dem bisherigen `APP_PASSWORD` im neuen App-Dialog anmelden. Optional in `/etc/qnap-backup.env` ein kürzeres Passwort (mindestens sechs Zeichen) setzen; `APP_USER` kann entfernt werden. Danach den Dienst neu starten.

## Updates

Für bestehende Installationen ab Version 2:

```sh
bash /opt/proxmox-backup-client/deploy/update.sh
```

Das Skript verweigert laufende Backups, sichert Daten und prüft die neue Version vor dem Neustart. Für den ersten Wechsel und den Rückweg siehe [Betriebsanleitung](docs/OPERATIONS.md). Konfiguration und Ergebnisse unter `/var/lib/qnap-backup` bleiben erhalten; Sicherungen enthalten Zugangsdaten.

## Lokale Entwicklung

```sh
APP_PASSWORD='lokales-testpasswort' npm start
npm test
```

Standard: `127.0.0.1:3000`, optionaler App-Passwortschutz. Ohne Linux-Mountinfo und echte CIFS-Quellen werden alle Mounts als nicht verfügbar angezeigt und Backups gesperrt. Keine simulierten Erfolgsmeldungen. `config.json` und `data/` sind von Git ausgeschlossen. Getestet werden Mount-Erkennung, Validierung, Zeitpläne und die HTTP-Schnittstelle; der reale PBS-/QNAP-Betrieb muss im LXC geprüft werden.

## Wochenpläne

Pro Ordner wird ein Wochenplan als `{ "days": [1, 3, 5], "time": "02:30" }` gespeichert (1 = Montag, 7 = Sonntag). Das Beispiel sichert montags, mittwochs und freitags um 02:30 Uhr. Die Presets „Täglich“, „Werktags“, „Wochenende“ und „Wöchentlich“ setzen passende Tage; unter „Eigene Tage“ sind mehrere Tage frei wählbar. Eine gemeinsame Uhrzeit gilt für alle gewählten Tage. „Nur manuell“ entspricht `{ "days": [], "time": "" }`.

Alte Konfigurationen mit einer einfachen Uhrzeit werden beim Laden automatisch als tägliche Pläne verstanden und beim nächsten Speichern im neuen Format abgelegt. Die Sicherung bleibt auf höchstens einen automatischen Start pro Ordner und Kalendertag begrenzt. Ausgefallene Zeiten werden weiterhin nicht nachgeholt.

## Quellen in der UI hinzufügen

**Übersicht → Quellen → Quelle hinzufügen**: Name (z. B. „Daten“), dauerhafte Backup-ID (`daten`) und Pfad (`/mnt/Daten/Daten`) eintragen. „SMB-Quelle ermitteln“ liest die vorhandene Mount-Information; mit „Quelle speichern“ wird sie als erwartete Freigabe festgelegt. Bei bestehenden Quellen übernimmt „SMB bestätigen“ die aktuell erkannte Freigabe. Diese Quelle vor dem Bestätigen kontrollieren.

„Daten“ wird beim Update von Konfigurationen ohne Quellenliste automatisch ergänzt, zunächst ohne automatischen Zeitplan. Bestehende Zeitpläne, PBS-Zugangsdaten und Ergebnisse bleiben erhalten. Die App registriert vorhandene Mounts; sie erstellt weder SMB-Mounts noch LXC-Durchreichungen. Neue Verzeichnisse müssen weiterhin am Proxmox-Host eingebunden und im LXC sichtbar sein.

Quellen dürfen nur unter `/mnt/Daten/` liegen. Der übergeordnete Ordner selbst und überlappende Quellpfade sind ausgeschlossen. „Abmelden“ entfernt nur die App-Konfiguration der Quelle, keine Dateien, gespeicherten Verläufe oder PBS-Snapshots. Die Backup-ID bleibt beim Bearbeiten gleich, damit Gruppe und Verlauf zusammengehören. Ändert sich Pfad oder PBS-Ziel, wird die lokale Erfolgsanzeige für den neuen Kontext zurückgesetzt; der Verlauf bleibt erhalten. Bis zu 30 Quellen sind möglich; die kompakte Startseite zeigt sechs pro Seite.

## Zeitzone, nächste Termine und Warnungen

Unter **Einstellungen → Sicherungsplan → Zeitzone** eine IANA-Zeitzone wählen, z. B. `Europe/Berlin`, `Europe/Vienna`, `Europe/Zurich` oder `UTC`. Sie gilt für alle Wochenpläne und sämtliche Datumsanzeigen. Die Betriebssystem-Zeitzone muss dafür nicht verändert werden; die Systemuhr muss korrekt synchronisiert sein. Die Sommer-/Winterzeit wird automatisch berücksichtigt. Nicht existierende lokale Uhrzeiten werden übersprungen, doppelte Uhrzeiten erhalten nur den ersten Termin. Ältere Konfigurationen bleiben auf `Europe/Berlin`.

In jeder Quellenzeile steht der nächste konkrete Termin. Ein Klick auf den Quellennamen öffnet den Verlauf. Die App warnt nach zehn Minuten ohne erfolgreichen Lauf seit dem zuletzt fälligen Termin, außer der Auftrag läuft oder wartet noch. Nach einem Neustart werden verpasste Termine seit dem bisherigen Beobachtungsbeginn erkannt; beim ersten Update sowie nach Änderung von Plan, Pfad, Ziel oder Zeitzone beginnt die Beobachtung neu. Es werden keine historischen Warnungen für noch nie beobachtete Pläne erfunden. Ein manueller erfolgreicher Lauf nach dem fälligen Termin beseitigt die Warnung ebenfalls.

Zusätzlich kann unter **Warnschwelle** die Grenze für einen zu alten letzten App-Erfolg gesetzt werden (Standard 14 Tage). PBS-Snapshots aus anderen Programmen werden separat angezeigt und ersetzen keinen App-Lauf oder App-Erfolg.

## PBS-Bestand und Historie

**Übersicht → PBS-Bestand → Vom PBS abrufen** fragt `proxmox-backup-client snapshot list --output-format json` ab. Angezeigt werden Gruppe, Zeitpunkt, Größe (falls vorhanden) und Archive – einschließlich früherer CLI-Läufe und der ersten `host/qnap-…`-Gruppen. Ein Quellenfilter berücksichtigt die aktuelle ID sowie die frühere `qnap-`-ID. Es wird nur der eingestellte Namespace abgefragt. Leserechte des PBS-Zugangs begrenzen den sichtbaren Bestand. Details zum Befehl: [offizielle Client-Befehle](https://pbs.proxmox.com/docs/command-syntax.html#proxmox-backup-client).

Der Bestand wird auf Anforderung bzw. beim Verbindungstest aktualisiert und unter `pbs.json` zwischengespeichert. Bei einem Fehler bleibt der alte Bestand mit Datum und deutlichem Fehlerhinweis sichtbar. Maximal 5000 Snapshots werden zwischengespeichert, im Dialog maximal die neuesten 200 passenden Einträge angezeigt. Die Liste ist keine unabhängige Integritätsprüfung; Verify-Jobs weiterhin im PBS konfigurieren.

Der lokale Verlauf enthält bis zu zehn abgeschlossene App-Läufe mit Dauer, Ergebnis, Auslöser und abrufbarem Protokoll. Beim ersten Update wird ein vorhandener letzter Lauf übernommen, soweit dessen Metadaten vorliegen. Vor dem Update nicht aufbewahrte Protokolle können nicht rekonstruiert werden. Während des Dienstneustarts laufende/wartende Aufträge werden als unterbrochen archiviert.

## Optionale ntfy-Fehlermeldungen

Unter **Einstellungen → Benachrichtigungen über ntfy** Server (z. B. `https://ntfy.example.de`), Topic (z. B. `qnap-backups`) und bei Bedarf einen Zugriffstoken eintragen, dann „Fehlermeldungen aktivieren“ auswählen und **ntfy speichern**. Daraus wird die vollständige Topic-URL gebildet. ntfy wird separat über `/api/notifications` gespeichert: Fehler in PBS-Feldern oder noch nicht fertigen Zeitplänen verhindern das Aktivieren nicht. Das Topic anschließend mit der ntfy-App abonnieren. Es ist kein Dienst voreingestellt; ohne Aktivierung wird nichts versendet. Passende Topic-Zugriffsrechte im ntfy-Server einrichten. Ein eigener Server im lokalen Netz ist möglich.

Mit „ntfy speichern“ speichern und danach über „Gespeicherte Verbindung testen“ gezielt eine Testmeldung senden. Das Ergebnis bzw. die konkrete Fehlermeldung bleibt direkt unter dem Formular sichtbar. Server und Topic sind beide erforderlich, wenn ntfy aktiviert wird; eine reine Serveradresse reicht als Ziel nicht aus. Automatisch gemeldet werden fehlgeschlagene Backups, verpasste Termine und ein zu alter letzter Erfolg. Nachrichten enthalten Quellennamen und Fehlertyp, keine Kennwörter, Dateipfade oder vollständigen Protokolle. Versand erfolgt per HTTP POST gemäß [ntfy-Dokumentation](https://docs.ntfy.sh/publish/). Tokens werden nicht an den Browser zurückgegeben; ein leerer Token behält den bisherigen nur bei unveränderter URL.

Meldungen werden pro Ereignis dedupliziert. Fehlgeschlagene Zustellungen erscheinen in den Einstellungen und werden nicht endlos wiederholt; nach Behebung einen Test senden. Warnungen bleiben unabhängig von der Zustellung in der App sichtbar.

### Fehlermeldung beim Speichern

Ein HTTP-Status `400` in der Browser-Konsole allein zeigt nicht die Ursache. Der Server liefert zusätzlich JSON mit `error`; die App zeigt diese Meldung dauerhaft im betroffenen Formular. Passwortschutz und ntfy besitzen eigene Speichern-Schaltflächen und benötigen keine vollständigen PBS-Einstellungen. Allgemeine PBS-/Zeitplanfehler stehen direkt unter „Einstellungen speichern“.

## Formulare und Konfigurationspflege

Speichern, PBS-Verbindungstest und ntfy-Test sind getrennte Aktionen. Eingabefehler erscheinen direkt am Feld; der Server liefert ergänzend den Feldnamen. Noch nicht gespeicherte PBS-Werte, Zeitpläne, ntfy-Einstellungen und Auth-Auswahl bleiben bei automatischen Statusabfragen und Quellenänderungen erhalten. Änderungen während eines Speichervorgangs bleiben als ungespeichert markiert. Eine noch leere PBS-Einrichtung kann gespeichert werden; Backups bleiben bis zur vollständigen Einrichtung gesperrt.

Konfigurationen besitzen ab Version 2 eine Schemaversion und werden bei der ersten Migration mit einer Kopie des Originals gesichert. `npm run check` prüft sie ohne Migration und ohne Änderungen an Status oder Verlauf. Details zu Modulen, Startprüfungen, Installation und Update stehen in [docs/OPERATIONS.md](docs/OPERATIONS.md).
