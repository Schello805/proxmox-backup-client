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

Konfigurationen ohne `schemaVersion` werden als Version 1 verstanden. Das aktuelle Schema 4 übernimmt Zugangsdaten, Auth-Auswahl, Quellen und Zeitpläne aus Schema 1, 2 oder 3 und erstellt vor dem Schreiben eine geschützte Datei `config.json.pre-v4-<Zeitstempel>.json` neben dem Original. Bestehende Quellen erhalten das Ziel `primary` (bisheriger Datastore). Weitere Starts legen keine zusätzlichen Migrationskopien an. Kaputtes JSON und unbekannte neuere Schemaversionen werden nicht überschrieben. `npm run check` prüft schreibfrei.

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

Die Statuskarte zeigt Laufzeit, verarbeitete Daten, den vom Client gemeldeten Upload und die durchschnittliche Verarbeitungsgeschwindigkeit. Die Weboberfläche aktualisiert alle drei Sekunden; neue Messwerte erscheinen erst, wenn der Client sie protokolliert (je nach Client-Version typischerweise etwa minütlich). Ohne passende Meldungen bleiben die Felder leer; ältere Clients liefern gegebenenfalls erst beim Abschluss die Verarbeitungssumme. Seit 2.2.0 zeigt die App zusätzlich eine ausdrücklich gekennzeichnete Schätzung für Prozent und Restzeit (siehe unten).

„Upload (Client)“ ist der Zähler aus dem Client-Protokoll und kein gemessener Netzwerkverkehr. Komprimierung und Deduplizierung beeinflussen den tatsächlichen Transport und PBS-Speicherbedarf. „Ø Verarbeitung“ ist die verarbeitete Datenmenge geteilt durch die vom Client gemeldete Zeit. Messwerte werden beim nächsten Lauf zurückgesetzt und beim Abschluss im lokalen Auftragsverlauf gespeichert. Die Erfolgserkennung erfolgt weiterhin über den Prozess-Exit-Code, nicht über Fortschrittsmeldungen.

Grundlage des Parsers: [Proxmox: Einführung der periodischen Fortschrittsmeldungen](https://lore.proxmox.com/pbs-devel/3d6ae324-7aab-4547-87f4-b63f632c0b3e@proxmox.com/).

### Systemdiagnose und Update-Anzeige

Über „Diagnose“ auf der Übersicht oder den Versionsbutton im Kopfbereich öffnet sich „System & Wartung“. „Diagnose starten“ prüft die Laufzeitumgebung und den lokalen Datenspeicher erneut, öffnet die Quellverzeichnisse, prüft deren Mount-Zuordnung, liest den PBS-Snapshot-Bestand und zeigt die nächsten Termine in der gewählten Zeitzone. Die Prüfung läuft im Hintergrund; mehrfache Starts teilen sich einen laufenden Durchgang. Ohne Wochenplan erscheint ein Hinweis. Die Prüfung verändert keine Backups, verschickt keine Testbenachrichtigung und prüft nicht rekursiv die Lesbarkeit jeder Datei. Die vorhandene PBS-Bestandsanzeige wird beim Verbindungstest aktualisiert. Änderungen an der Konfiguration während der Prüfung erfordern einen neuen Durchgang.

„Auf Updates prüfen“ vergleicht den beim Dienststart erfassten lokalen Commit mit `main` auf GitHub und zeigt die dortige Paketversion sowie einen Link zum Commit. Auch neue Commits ohne Versionsänderung werden erkannt. Lokale Änderungen, ein vorausliegender oder auseinander gelaufener Git-Stand werden gesondert angezeigt. Ohne Git-Checkout ist der Vergleich unbekannt; ein Netzwerkfehler gilt nicht als „aktuell“. GitHub wird nur beim ausdrücklichen Prüfen kontaktiert; Ergebnisse werden für eine Minute zwischengespeichert. Die Prüfung überträgt keine Konfiguration und verwendet keine PBS-Zugangsdaten. Updates werden weiterhin mit dem dokumentierten Update-Skript im LXC installiert.


### Prozent und Restzeit (ab 2.2.0)

Für die Schätzung wird eine erfolgreiche, weniger als sechs Stunden alte Größenmessung der betreffenden Quelle verwendet. Die Größe wird je Backup-Lauf festgehalten, damit sich die Bezugsgröße während des Backups nicht durch neue Messungen verschiebt. Wird eine bereits laufende Größenmessung erst während des Backups fertig, kann ihr Ergebnis beim nächsten Client-Messwert übernommen werden. Für die Prozentzahl zählt der verarbeitete Datenstrom, nicht der durch Deduplizierung kleinere Upload. Die Restzeit folgt aus verbleibender Datenmenge und durchschnittlicher Verarbeitungsgeschwindigkeit am letzten Messpunkt.

Die Anzeige ist eine Orientierung: pxar-Metadaten, ausgeschlossene Dateien, Änderungen an der Quelle und der abschließende PBS-Schreibvorgang können sie verändern. Solange der Prozess läuft, wird höchstens 99 % angezeigt. Wenn die geschätzte Datenmenge erreicht wird, bleibt die Restzeit offen; ein erfolgreicher Prozessabschluss zeigt 100 %. Ohne Quellgröße, ohne Client-Messwerte oder nach mehr als drei Minuten ohne frische Messwerte wird keine Restzeit erfunden. Nach einem Dienstneustart müssen die Quellgrößen erneut ermittelt werden; eine Sicherung startet auch ohne verfügbare Schätzung.

### Automatische Browserprüfungen

Die Produktion startet weiterhin mit `node server.js` ohne npm-Laufzeitabhängigkeiten. Playwright ist ausschließlich eine Entwicklungsabhängigkeit. Für die Browserprüfungen Node.js 22 oder neuer und die Testwerkzeuge installieren:

```sh
npm ci
npx playwright install chromium
npm run test:all
```

Auf Linux kann die Browserinstallation zusätzlich Systembibliotheken benötigen: `npx playwright install --with-deps chromium`. Nur Backendtests: `npm test`. Nur Browserprüfungen: `npm run test:browser`. Den Bericht öffnet `npx playwright show-report`.

Die vierzehn Chromium-Abläufe prüfen Passwort-Modal und Fehlermeldung, optionalen Passwortschutz, Zeitzonen-Dropdown und Mehrtagespläne samt Entwurfsschutz bei Statusaktualisierungen, ntfy-Validierung/Speichern/Testmeldung, Quellenverwaltung, Backup-Start mit Prozent/Restzeit/Live-Protokoll/Verlauf, fehlgeschlagenen Lauf, Diagnose/Update-Anzeige, fehlende Größenmessung, PBS-Filter und mobile Navigation. Zusätzlich wird die Übersicht mit sechs Quellen bei 1280 × 720 Pixeln auf vertikales Scrollen geprüft. Unbehandelte JavaScript-Fehler lassen die Browserprüfung fehlschlagen.

Jeder Ablauf startet eine eigene App-Instanz auf einem zufälligen lokalen Port mit temporärer Konfiguration. NAS-Zugriff, Backup-Prozess, PBS-Antworten, ntfy-Versand und GitHub-Vergleich sind ausschließlich im Test-Einstiegspunkt `e2e/server.cjs` simuliert. Der Produktionsserver importiert diesen Einstiegspunkt nicht. Die Tests kontaktieren keinen echten PBS, keine QNAP und keinen Benachrichtigungsdienst; sie ersetzen keinen echten Backup-/Restore-Test.

GitHub Actions führt Backend- und Browserprüfungen bei Pushes und Pull Requests aus. Bei Fehlern stehen Screenshots und Playwright-Traces als Artefakt für sieben Tage bereit. Lokale Berichte unter `playwright-report/` und `test-results/` sind von Git ausgeschlossen.


### Zwei Datastores auf demselben PBS (ab 2.3.0)

1. Den zweiten Datastore auf dem vorhandenen PBS bereitstellen. Der in der App hinterlegte Benutzer/API-Token braucht dort die passenden Backup-Rechte und für die Bestands-/Verbindungsprüfung Leserechte. Ein verwendeter Namespace muss im jeweiligen Datastore verfügbar sein.
2. Unter „Backup-Ziele“ den bisherigen Datastore unter „Datastore 1“ belassen und den exakten Namen des zweiten unter „Datastore 2 (optional)“ eintragen. Speichern und die Verbindung prüfen. Server, Zugangsdaten, Fingerprint und Namespace gelten gemeinsam für beide Datastores.
3. Unter „Quellen“ die betreffende Quelle bearbeiten, im Dropdown „Backup-Ziel“ den zweiten Datastore wählen und speichern. Der bestehende Wochenplan gilt weiter für dieses Ziel. Alle nicht geänderten Quellen bleiben beim bisherigen Datastore.

Die App erstellt keine PBS-Datastores und verschiebt oder löscht keine alten Snapshots. Jede Quelle hat genau ein Ziel; es erfolgt keine gleichzeitige Kopie auf beide Datastores. Die globale Warteschlange führt weiterhin nur ein Backup gleichzeitig aus und verwendet für jeden Auftrag die tatsächliche Ziel-Repository-Zeichenfolge. Ein unbekanntes oder unkonfiguriertes Ziel wird abgewiesen, statt auf Datastore 1 zurückzufallen.

Die Übersicht zeigt das Ziel neben dem Quellnamen. Der laufende Auftrag, das Protokoll und archivierte Läufe dokumentieren den tatsächlichen Datastore. Nach einer Zieländerung wird der aktuelle Erfolgsstatus der betroffenen Quelle zurückgesetzt; ältere Einträge bleiben im Verlauf mit ihrem ursprünglichen Ziel erhalten. Der erfolgreiche Lauf auf Datastore 1 gilt dadurch nicht fälschlich als Erfolg auf Datastore 2.

In der Ansicht „PBS-Bestand“ bestimmt das Dropdown „Datastore auswählen“, welcher Bestand gelesen wird. Beide Bestände, Prüfresultate und Cache-Dateien sind getrennt. Die Verbindungsschaltfläche unter „Backup-Ziele“ und die Diagnose prüfen beide konfigurierten Datastores. Zum Entfernen von Datastore 2 zuerst alle zugeordneten Quellen wieder Datastore 1 zuweisen. Während laufender oder vorgemerkter Backups sowie PBS-Abfragen sind Konfigurationsänderungen gesperrt.

Die zusätzlichen automatischen Prüfungen decken die Schema-2-Migration, Zielvalidierung, getrennte PBS-Caches bei Fehlern, Warteschlangen-Routing und das Zurücksetzen betroffener Laufzustände ab. Der Browserablauf konfiguriert Datastore 2, weist eine Quelle zu, prüft das tatsächliche Repository im Testprozess und Verlauf, wechselt den PBS-Bestand und kontrolliert die Persistenz nach Neuladen.


### Mounts und Größen manuell aktualisieren (ab 2.4.0)

„Aktualisieren“ auf der Übersicht prüft die registrierten Quellen erneut, leert die Größen-Caches und bricht veraltete Größenmessungen ab. Neue Messungen laufen einzeln im Hintergrund. Während ein Backup läuft oder wartet bzw. Wartung aktiv ist, bleiben sie vorgemerkt; die App zeigt den Grund an. Der Button wartet nicht auf das Ende eines mehrminütigen NAS-Scans. Nach dem Klick wird kurz danach nochmals Status gelesen; weitere Ergebnisse erscheinen mit den normalen Statusaktualisierungen.

Der Größen-Cache berücksichtigt neben Quellpfad und erwarteter Freigabe auch die tatsächlich erkannte Mount-ID, das Gerät, die SMB-Quelle, den Mount-Pfad, die Mount-Wurzel und den Dateisystemtyp. Ein Wechsel oder Neu-Einhängen verwirft alte Größen auch bei automatischen Statusabfragen. Vor und nach dem Scan wird die Mount-Zuordnung geprüft. Ein währenddessen veränderter Mount, ein Lesefehler, ein falscher Ergebnispfad oder eine Zeitüberschreitung liefert keine gültige Summe. Ein vor der Aktualisierung gestarteter Scan darf später keinen neuen Cache überschreiben. Entfernte Quellen werden aus der Mess-Warteschlange entfernt. Die Prozent-Schätzung verwendet nur eine zum beim Backup-Start geprüften Mount passende Größe.

Zusätzlich liest der Button die im LXC sichtbaren SMB/CIFS-Mountpunkte unter `/mnt/Daten/`. Noch nicht registrierte, nicht mit vorhandenen Quellen überlappende Mounts erscheinen unter „Neue SMB-Freigaben (N)“. Dort eine Freigabe auswählen, vorgeschlagenen Namen/Pfad und Backup-Ziel prüfen und „Quelle speichern“ drücken. Der neue Auftrag bleibt zunächst manuell. Mounts oder Unterordner auf dem Proxmox-Host, die noch nicht in diesen LXC durchgereicht wurden, kann die App nicht erkennen. Sie legt keine Host-Mounts an und startet durch Erkennung keine Sicherung.

Stimmt die aktuelle SMB-Quelle nicht mehr mit der hinterlegten Erwartung überein, erscheint „SMB geändert“. Der erkannte UNC-Pfad steht in der Zeile und im Tooltip; der Backup-Start bleibt gesperrt. Unter „Quellen“ die angezeigte tatsächliche Quelle prüfen und bei korrekter Zuordnung „SMB bestätigen“ wählen. Die Aktualisierung überschreibt diese Bestätigung nicht automatisch. Das verhindert insbesondere, dass ein irrtümlich nach `/mnt/Daten/Daten` gebundener Software-Mount unbemerkt als Daten-Backup behandelt wird.

## Navigation und Quellen bearbeiten

Die Navigation im Kopfbereich öffnet Quellen, PBS-Bestand und Diagnose als normale App-Ansichten. Browser-Zurück und direkte Links funktionieren auch für Quellendetails. Nur die Anmeldung verwendet ein Modal.

In der Übersicht den Quellennamen für den Verlauf oder den Zeitplan zum Bearbeiten anklicken. Der Detailbereich bleibt unter der Quellentabelle. Dort lassen sich Name, Pfad, erwartete SMB-Freigabe, Datastore und Wochenplan ändern sowie Verlauf und Protokoll ansehen. „Quelle speichern“ speichert Quelle und Wochenplan gemeinsam; die Zeitzone gilt weiterhin zentral für alle Quellen. „Schließen“ kehrt zur kompakten Übersicht zurück.


## Kompakter Einrichtungsassistent

„+ Hinzufügen“ in der Übersicht öffnet den Quellen-Assistenten. Drei Schritte: Angaben → Host/LXC vorbereiten → SMB prüfen und hinzufügen. Name, Backup-ID und LXC-Pfad werden vorgeschlagen; vorhandene Angaben lassen sich ändern. Bereits im LXC sichtbare Quellen überspringen die Host-Einrichtung. Jeder Befehlsblock nennt den Rechner und besitzt eine Kopiertaste, auch beim Zugriff per HTTP im LAN.

Der Host-Befehl prüft die erwartete SMB-Freigabe, verwendet einen freien `mp`-Slot und reicht ihn schreibgeschützt durch. Er legt keine SMB-Verbindung an und stoppt keinen LXC. Fehlende SMB-Freigaben zuerst über Proxmox → Rechenzentrum → Storage → Hinzufügen → SMB/CIFS anlegen. Nach Änderungen gegebenenfalls den LXC herunterfahren und wieder starten; den App-Dienst erst nach Ende laufender Backups neu starten. Die abschließende App-Prüfung muss die erwartete Freigabe bestätigen. Neue Quellen starten ohne Automatik; den Wochenplan anschließend im Detailbereich wählen.

„PBS-Ziel“ unterstützt einen weiteren Datastore mit gemeinsamem Zugang oder einen zweiten PBS mit eigener Adresse, Benutzer, Passwort/Token, Fingerprint und Namespace. Insgesamt sind zwei Ziele möglich; jede Quelle verwendet eines davon. Ein neuer Datastore kann mit dem vorbereiteten Befehl auf einem bereits gemounteten PBS-Datenträger angelegt werden. Die App formatiert keine Datenträger und führt die Kopierbefehle nicht selbst aus. Nach dem Speichern wird der Zugriff geprüft; bei einem Verbindungsfehler bleibt das Ziel gespeichert und kann korrigiert werden. Zweiten Zugang unter Backup-Ziele → Eigener Zugang für Datastore 2 bearbeiten. Leeres Passwort behält das Secret nur bei gleicher Serveradresse und Auth-ID.

Befehlsreferenzen: [LXC Bind-Mounts](https://pve.proxmox.com/pve-docs/pct.1.html), [PBS-Datastore und Zertifikat](https://pbs.proxmox.com/docs/proxmox-backup-manager/man1.html).


## Übersicht, Problemhilfe und Gantt-Zeitplan

- **Backup-Ziele:** PBS-Zugänge, Datastores, Fingerprints, Namespaces und Verbindungstest.
- **Einstellungen:** gemeinsame Zeitzone, Warnschwelle, App-Passwortschutz und ntfy.
- **Quelle → Bearbeiten:** Zielzuordnung und Wochenplan einschließlich täglicher, werktäglicher und eigener Frequenzen. Das Speichern der drei Bereiche erfolgt getrennt; ein geänderter Zeitplan überschreibt keine PBS-Entwürfe.

Bei einer falschen SMB-Zuordnung zeigt die Übersicht die tatsächlich erkannte und erwartete Freigabe. „Zuordnung prüfen“ öffnet den Detailbereich mit dem nächsten Prüfschritt. Fehlende Mounts, unvollständige oder nicht bestätigte PBS-Zugänge und fehlgeschlagene Backups besitzen eigene Aktionen. Die App bestätigt eine geänderte Freigabe nicht automatisch. Bei überfälligen oder unterbrochenen Aufträgen lässt sich eine Sicherung direkt anstoßen.

Das Gantt-Diagramm steht unter der Quellentabelle und zeigt sieben Kalendertage ab heute in der eingestellten Zeitzone. Das Dropdown zoomt auf einen einzelnen Tag. Balken beginnen am geplanten Termin; ihre Länge entspricht der letzten erfolgreichen App-Sicherung mit demselben Quellpfad, Repository und Namespace. Die gemessene Dauer steht zusätzlich neben dem Quellennamen. Fehlgeschlagene oder unterbrochene Läufe liefern keine Dauer; ohne passenden Messwert erscheint nur ein umrandeter Startpunkt. Ältere Verläufe ohne passende Metadaten erzeugen keinen erfundenen Messwert.

Die Balken sind eine Planungshilfe, keine Zusage für den nächsten Lauf. Aufträge laufen seriell; Überschneidungen sind als mögliche Warteschlange markiert. Sommer-/Winterzeit und über Mitternacht reichende Balken werden berücksichtigt; nicht existierende lokale Startzeiten entfallen, doppelte Uhrzeiten erhalten nur den ersten Termin. Vergangene geplante Starts des heutigen Tages werden blasser angezeigt. Ein Klick auf Balken oder Quellennamen öffnet den zugehörigen Wochenplan.

Fingerprints sind serverbezogen: „PBS-1-Fingerprint“ steht direkt beim ersten Zugang, „PBS-2-Fingerprint“ beim eigenen Zugang des zweiten PBS. Der Assistent fragt beim zusätzlichen Server ausdrücklich nach dessen Fingerprint. Ein weiterer Datastore auf demselben PBS verwendet den Fingerprint dieses Servers. Bei vertrauenswürdigem CA-Zertifikat kann das Feld leer bleiben. Ein ungültiger zweiter Fingerprint wird am Feld für PBS 2 markiert.


## Zeitplanvorschläge, PBS-Speicher und Erfolgszusammenfassungen

**Zeitplan prüfen** am Gantt-Diagramm vergleicht die gemessenen Wochenpläne und schlägt freie Uhrzeiten mit zehn Minuten Puffer vor. Die Wochentage bleiben unverändert. Quellen ohne erfolgreiche Laufzeitmessung werden ausdrücklich genannt und nicht eingerechnet. Jeder Vorschlag wird einzeln mit „Übernehmen“ gespeichert; danach werden die übrigen Vorschläge neu berechnet. Zwischenzeitlich geänderte Pläne oder Messwerte machen alte Vorschläge ungültig. Ohne freies Zeitfenster empfiehlt die App eine manuelle Änderung der Tage oder Frequenz. Die Messwerte liefern eine Planungshilfe, keine Garantie für die Dauer des nächsten Backups.

**PBS-Speicher** zeigt Gesamtgröße, belegten und verfügbaren Speicher je Datastore, inklusive Abrufzeit. Die Werte kommen aus `proxmox-backup-client status --output-format json` und beziehen sich auf das Dateisystem des Datastores, nicht auf die Summe seiner Backup-Archive. Zwei Datastores auf derselben Partition können dieselben Werte anzeigen. Hintergrundabfragen erfolgen alle 15 Minuten und werden während laufender Backups bzw. Wartung verschoben; „Speicher aktualisieren“ fragt gezielt ab. Bei fehlenden Rechten oder Abfragefehlern bleiben alte Messwerte mit Fehler- und Alterskennzeichnung sichtbar. Ein Fehler der Speicherabfrage sperrt keine Sicherung. Unter Backup-Ziele ist die Warnschwelle einstellbar (50–99 %, Standard 90 % Belegung). Befehlsreferenz: [Proxmox Backup Client](https://pbs.proxmox.com/docs/command-syntax.html#proxmox-backup-client).

Unter **Einstellungen → Benachrichtigungen über ntfy → Auch Erfolgszusammenfassungen senden** lässt sich zusätzlich zu den bisherigen Fehlermeldungen eine Zusammenfassung aktivieren. Standardmäßig bleibt sie ausgeschaltet. Nach Ende einer zusammenhängenden Warteschlange mit mindestens einem erfolgreichen Lauf wird einmal gemeldet: erfolgreiche und fehlgeschlagene Quellen sowie deren Dauer. Ein einzelner manueller Lauf bildet ebenfalls eine Warteschlange. Bei gemischten Ergebnissen bleibt die Meldung als Warnung gekennzeichnet. Einzelne Fehler werden weiterhin sofort gemeldet; ausschließlich fehlgeschlagene oder beim Dienstende unterbrochene Warteschlangen erzeugen keine zusätzliche Erfolgszusammenfassung. Versendet werden nur Quellennamen, Dauer und Ergebnis, keine Dateipfade, Secrets oder Protokolle.


### Sicherungen abbrechen

In der Übersicht **Abbrechen** am Auftrag oder **Alle abbrechen** wählen. Letzteres entfernt zuerst die Warteschlange und stoppt danach den aktiven Client. Während **Wird abgebrochen** bleibt das Update gesperrt. Falls nötig folgt nach fünf Sekunden ein erzwungener Prozessabbruch; freigegeben wird erst nach dem tatsächlichen Prozessende. Abgebrochene Aufträge bleiben im Verlauf und werden nicht als erfolgreiche Sicherung gewertet. Vorhandene PBS-Sicherungen werden nicht gelöscht.

Bei älteren Versionen ohne Abbruchfunktion kann `systemctl restart qnap-backup` laufende App-Sicherungen beenden. Wartende Aufträge werden beim Neustart als unterbrochen archiviert. Danach das reguläre Update ausführen.


### Warteschlange und Startfenster

Unter der Quellentabelle die Warteschlange öffnen: wartende Aufträge nach oben/unten verschieben, entfernen oder nach dem aktuellen Backup pausieren. „Fortsetzen“ gibt die verbleibenden Aufträge frei. Die Pause bleibt bei einem Dienstneustart erhalten; offene Aufträge werden wie bisher beim Neustart als unterbrochen archiviert und müssen neu gestartet werden. Vor einem App-Update die Warteschlange abschließen oder abbrechen.

Unter Einstellungen ein globales Startfenster festlegen (auch über Mitternacht). Es gilt in der eingestellten Zeitzone für manuelle und geplante Aufträge. Außerhalb warten neue Aufträge; laufende Sicherungen werden fertiggestellt. Die Warteschlange prüft etwa alle zehn Sekunden, ob sie weiterlaufen darf. Das ist kein hartes Ende laufender Backups am Fensterende.

Upload-Limit in MiB/s: 0 bedeutet unbegrenzt. Änderungen gelten beim nächsten Client-Start, auch wenn Aufträge bereits warten. Technisch werden `--rate` und `--burst` in Bytes an den Client übergeben; siehe [Proxmox-Client-Dokumentation](https://pbs.proxmox.com/docs/proxmox-backup-client/man1.html).

### Laufvergleich und Einstellungen sichern

Quelle anklicken → Verlauf: letzte erfolgreiche Dauer, verarbeitete Daten und Upload mit Vergleich zum vorherigen erfolgreichen Lauf am selben Pfad, Ziel und Namespace. Fehlende Client-Messwerte bleiben unbekannt. Die Kennzahlen sind keine Dateiliste und keine Aussage über eine vollständige inhaltliche Änderungserkennung.

Einstellungen → Export: standardmäßig ohne PBS-Passwörter oder ntfy-Token. Nur die ausdrückliche Auswahl exportiert Zugangsdaten im Klartext; das App-Passwort aus der Environment-Datei wird nie exportiert. Beim Wiederherstellen zuerst Datei prüfen und Änderungsvorschau lesen, dann übernehmen. Die App-Anmeldung bleibt unverändert. Fehlende Zugangsdaten werden nur bei unveränderter Server-/Benutzer-Zuordnung übernommen, ansonsten müssen sie neu eingetragen werden. Der zweite PBS kann dafür als noch nicht vollständig eingerichtetes Ziel gespeichert werden; Backups bleiben ohne Zugang gesperrt.

Vor dem Übernehmen alle Aufträge beenden. Der Server prüft die Datei erneut, weist eine veraltete Vorschau ab und sichert den bisherigen Stand unter `/var/lib/qnap-backup/config-before-restore-*.json` (nur für den Dienstbenutzer lesbar). Konfigurationsdateien enthalten Geheimnisse und gehören nicht ins Repository. Historie und PBS-Sicherungen bleiben erhalten. Mounts und Pakete werden durch den Import nicht eingerichtet.
