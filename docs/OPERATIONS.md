# Installation, Updates und Fehlerbehebung

Alle Betriebsbefehle als root im Debian-12-LXC ausführen. Die SMB-Mounts bleiben auf dem Proxmox-Host und werden in den LXC durchgereicht.

## Neue Installation

Voraussetzungen: Node.js ab 18, Git, installierter `proxmox-backup-client`, vorhandenes `/mnt/Daten` mit den durchgereichten Quellen. Quellcode unter `/opt/proxmox-backup-client` ablegen.

```sh
cd /opt/proxmox-backup-client
bash deploy/install.sh
nano /etc/qnap-backup.env
bash deploy/install.sh
```

Der erste Aufruf legt bei Bedarf den Dienstbenutzer und eine geschützte Environment-Datei an. Die Datei bearbeiten: eigenes `APP_PASSWORD` setzen oder für Zugriff ohne Anmeldung leeren. Der zweite Aufruf prüft Konfiguration, Schreibrechte und Client unter dem Dienstbenutzer und richtet systemd ein. Vorhandene Konfigurationen werden nicht überschrieben; dafür ist der Update-Weg vorgesehen. UID/GID und SMB-Leserechte auf dem Host müssen zum unprivilegierten LXC passen.

## Laufende Installation aktualisieren

Ab Version 2 ist der normale Weg:

```sh
bash /opt/proxmox-backup-client/deploy/update.sh
```

Beim ersten Wechsel von einer älteren Version zunächst die neuen Skripte holen, während kein Backup läuft:

```sh
cd /opt/proxmox-backup-client
git fetch origin
git show origin/main:deploy/update.sh > /tmp/qnap-update.sh
APP_DIR=/opt/proxmox-backup-client sh /tmp/qnap-update.sh
```

Das Skript verweigert lokale Codeänderungen und laufende/wartende Backups. Nach dem Git-Fetch prüft es, dass der lokale Stand ausschließlich vorgespult werden kann. Eine Wartungsdatei verhindert neue manuelle und geplante Starts zwischen Prüfung und Dienststopp. Daten und Environment-Datei werden unter `/var/backups/qnap-backup/<Zeitstempel>/` gesichert. Danach folgen Code-Update, Vorprüfung als Dienstbenutzer und systemd-Neustart. Ein vorher gestoppter Dienst bleibt gestoppt.

Scheitert die Prüfung nach dem Stoppen, bleibt der Dienst gestoppt; das Skript nennt den Sicherungspfad. Es startet keine ungeprüfte Version. Die Sicherungen enthalten Zugangsdaten: nur root darf sie lesen, nicht ins Repository hochladen.

Nur prüfen, ohne Update, Dienststopp oder Migration:

```sh
cd /opt/proxmox-backup-client
DATA_DIR=/var/lib/qnap-backup CONFIG_FILE=/var/lib/qnap-backup/config.json \
  bash deploy/update.sh --check
```

Die Vorprüfung ist automatisiert getestet. Das produktive systemd-Update muss auf dem LXC geprüft werden; lokale Tests ersetzen keinen echten Backup-/Restore-Test.

## Konfigurationsmigration und Versionsanzeige

Die App zeigt ihre Version im Kopfbereich. Unter „Aufbau & Systemdetails“ stehen Node-Version, Backup Client und Betriebsprüfungen. Fehlender Client oder fehlende PBS-Einstellungen werden als Hinweis angezeigt; ungültige Konfiguration, nicht beschreibbare Speicherpfade oder ungültiger Port verhindern den Start.

Konfigurationen ohne `schemaVersion` werden als Version 1 verstanden. Version 2 übernimmt Zugangsdaten, Auth-Auswahl, Quellen und Zeitpläne und erstellt vor dem Schreiben eine geschützte Datei `config.json.pre-v2-<Zeitstempel>.json` neben dem Original. Weitere Starts legen keine zusätzlichen Migrationskopien an. Kaputtes JSON und unbekannte neuere Schemaversionen werden nicht überschrieben. `npm run check` prüft schreibfrei.

## Rückweg nach fehlgeschlagenem Update

Den tatsächlich vom Skript genannten Sicherungsordner einsetzen:

```sh
systemctl stop qnap-backup
cd /opt/proxmox-backup-client
BACKUP_DIR=/var/backups/qnap-backup/ZEITSTEMPEL
OLD_COMMIT=$(cat "$BACKUP_DIR/commit")
git switch --detach "$OLD_COMMIT"
tar -C /var/lib/qnap-backup -xzf "$BACKUP_DIR/data.tar.gz"
chown -R qnap-backup:qnap-backup /var/lib/qnap-backup
install -m 600 "$BACKUP_DIR/qnap-backup.env" /etc/qnap-backup.env
install -m 644 deploy/qnap-backup.service /etc/systemd/system/qnap-backup.service
systemctl daemon-reload
systemctl start qnap-backup
systemctl status qnap-backup --no-pager
```

Der Rückweg stellt zusammengehörigen Code und Datenstand wieder her. Vor einem späteren erneuten Update kann mit `git switch main` auf den normalen Branch zurückgekehrt werden, sofern keine lokalen Codeänderungen hinzugekommen sind.

## Fehler schnell eingrenzen

```sh
systemctl status qnap-backup --no-pager
journalctl -u qnap-backup -n 60 --no-pager
ss -ltnp | grep ':3000'
```

- **Zweite App-Instanz:** Ein Datenverzeichnis darf nur von einem laufenden Controller verwendet werden. Für einen manuellen Start zuerst den systemd-Dienst stoppen. Eine nach einem Systemabsturz verwaiste `.instance-lock` wird automatisch erkannt, wenn deren Prozess nicht mehr existiert.
- **Start scheitert:** Journal lesen. Bei JSON-Fehlern Original erhalten und eine passende Sicherung verwenden. Portbelegung und Node-Version prüfen.
- **Quelle nicht verfügbar:** Im LXC `findmnt -T /mnt/Daten/Daten` prüfen. Als Dienstbenutzer `runuser -u qnap-backup -- ls /mnt/Daten/Daten` testen. Mounts auf dem Host korrigieren, nicht im Container neu einrichten.
- **SMB-Identität abweichend:** Erkannte und erwartete Freigabe unter „Quellen“ vergleichen. Erst nach Prüfung erneut bestätigen.
- **HTTP 400 beim Speichern:** Die App nennt das Feld direkt an der Eingabe und liefert `error` und `field` in der Serverantwort. Speichern führt keinen Verbindungstest und keine Testnachricht aus.
- **Verbindungstest:** Prüft die gespeicherten PBS-Werte; ungespeicherte Eingaben bleiben erhalten. Bei Änderungen zuerst speichern.
- **ntfy:** Eigene Speichern-Schaltfläche verwenden. Server und Topic getrennt angeben; anschließend gespeicherte Verbindung testen.
- **Wartung bleibt stehen:** Prüfen, ob noch ein Update läuft. Nur wenn keines läuft, eine nach einem abgebrochenen Prozess verbliebene Datei `/var/lib/qnap-backup/maintenance` entfernen. Danach dürfen neue Backups wieder starten.

## Entwickeln und prüfen

```sh
npm test
npm run check
```

`server.js` enthält HTTP-Routen und verdrahtet die Dienste. `lib/` enthält Anmeldung, Konfiguration, Migration, Backup-Ausführung, Verlauf, PBS und Scheduler. `core.js` hält die bisherige Hilfsfunktionsschnittstelle kompatibel. Im Browser trennt `public/js/` API-Zugriffe, Darstellung und Formularzustand; `public/app.js` verbindet die Ansichten und Aktionen. Das Frontend verwendet native ES-Module ohne Build-Schritt.

### Größen der Quellen

Die Übersicht zeigt unter dem SMB-Status die logische, unkomprimierte Dateigröße in GiB (kein PBS-Speicherverbrauch und keine Gesamtkapazität des NAS). Die Messung nutzt GNU `du --summarize --bytes --one-file-system` im LXC. Sie läuft nach erfolgreicher Mount-Prüfung einzeln im Hintergrund und wird beim Abrufen der Übersicht nach sechs Stunden erneut angestoßen. Während laufender oder vorgemerkter Backups startet kein neuer Scan; ein bereits laufender Scan kann sich mit einem später gestarteten Backup überschneiden. Nach einem App-Neustart werden die Werte neu ermittelt.

Die Messung liest Verzeichniseinträge und kann große SMB-Freigaben zusätzlich belasten. Nach zehn Minuten wird sie abgebrochen; Lesefehler und Zeitüberschreitungen erscheinen als „Größe nicht verfügbar“, ohne unvollständige Summen anzuzeigen. Ein erneuter Versuch erfolgt nach 15 Minuten beim nächsten Abruf der Übersicht. Änderungen während der Messung können zu abweichenden Größen führen; der Wert ist eine Orientierung, kein konsistenter Snapshot.

### Live-Fortschritt (ab 2.1.0)

Die Statuskarte zeigt Laufzeit, verarbeitete Daten, den vom Client gemeldeten Upload und die durchschnittliche Verarbeitungsgeschwindigkeit. Die Weboberfläche aktualisiert alle drei Sekunden; neue Messwerte erscheinen erst, wenn der Client sie protokolliert (je nach Client-Version typischerweise etwa minütlich). Ohne passende Meldungen bleiben die Felder leer; ältere Clients liefern gegebenenfalls erst beim Abschluss die Verarbeitungssumme. Die App berechnet keine Prozentwerte oder Restzeit aus zwischengespeicherten Ordnergrößen.

„Upload (Client)“ ist der Zähler aus dem Client-Protokoll und kein gemessener Netzwerkverkehr. Komprimierung und Deduplizierung beeinflussen den tatsächlichen Transport und PBS-Speicherbedarf. „Ø Verarbeitung“ ist die verarbeitete Datenmenge geteilt durch die vom Client gemeldete Zeit. Messwerte werden beim nächsten Lauf zurückgesetzt und beim Abschluss im lokalen Auftragsverlauf gespeichert. Die Erfolgserkennung erfolgt weiterhin über den Prozess-Exit-Code, nicht über Fortschrittsmeldungen.

Grundlage des Parsers: [Proxmox: Einführung der periodischen Fortschrittsmeldungen](https://lore.proxmox.com/pbs-devel/3d6ae324-7aab-4547-87f4-b63f632c0b3e@proxmox.com/).

### Systemdiagnose und Update-Anzeige

Über „Diagnose“ auf der Übersicht oder den Versionsbutton im Kopfbereich öffnet sich „System & Wartung“. „Diagnose starten“ prüft die Laufzeitumgebung und den lokalen Datenspeicher erneut, öffnet die Quellverzeichnisse, prüft deren Mount-Zuordnung, liest den PBS-Snapshot-Bestand und zeigt die nächsten Termine in der gewählten Zeitzone. Die Prüfung läuft im Hintergrund; mehrfache Starts teilen sich einen laufenden Durchgang. Ohne Wochenplan erscheint ein Hinweis. Die Prüfung verändert keine Backups, verschickt keine Testbenachrichtigung und prüft nicht rekursiv die Lesbarkeit jeder Datei. Die vorhandene PBS-Bestandsanzeige wird beim Verbindungstest aktualisiert. Änderungen an der Konfiguration während der Prüfung erfordern einen neuen Durchgang.

„Auf Updates prüfen“ vergleicht den beim Dienststart erfassten lokalen Commit mit `main` auf GitHub und zeigt die dortige Paketversion sowie einen Link zum Commit. Auch neue Commits ohne Versionsänderung werden erkannt. Lokale Änderungen, ein vorausliegender oder auseinander gelaufener Git-Stand werden gesondert angezeigt. Ohne Git-Checkout ist der Vergleich unbekannt; ein Netzwerkfehler gilt nicht als „aktuell“. GitHub wird nur beim ausdrücklichen Prüfen kontaktiert; Ergebnisse werden für eine Minute zwischengespeichert. Die Prüfung überträgt keine Konfiguration und verwendet keine PBS-Zugangsdaten. Updates werden weiterhin mit dem dokumentierten Update-Skript im LXC installiert.
