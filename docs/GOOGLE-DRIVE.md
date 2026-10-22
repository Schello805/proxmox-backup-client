# Google Drive mit Rclone

Die App kopiert ausgewählte QNAP-Quellen zusätzlich direkt nach Google Drive. PBS-Ziele und deren Zeitpläne bleiben unabhängig. Bereits fertig eingerichtet? Direkt bei Schritt 6 fortfahren. Dieselben Schritte stehen aufklappbar unter **Anleitung → Google Drive vollständig einrichten**.

## 1. Im LXC vorbereiten

Als root ausführen:

```sh
apt update && apt install -y rclone
runuser -u qnap-backup -- rclone config --config /var/lib/qnap-backup/rclone.conf
```

Bei anderem `DATA_DIR` den Dateipfad anpassen. Ein vorhandenes Remote mit `e` bearbeiten; sonst `n` für ein neues wählen. Immer als Dienstbenutzer konfigurieren: Eine Anmeldung in der privaten Root-Konfiguration wird von der App nicht verwendet.

## 2. Google-Zugang erstellen

1. In der [Google Cloud Console](https://console.cloud.google.com/) ein Projekt erstellen und die **Google Drive API** aktivieren.
2. Unter **Google Auth Platform / OAuth-Zustimmungsbildschirm** App-Namen und eigene E-Mail hinterlegen. Für ein privates Konto **Extern** wählen und dich als Testnutzer hinzufügen. Unter Datenzugriff den Berechtigungsbereich `https://www.googleapis.com/auth/drive` ergänzen.
3. Einen **OAuth-Client vom Typ Desktop-App** erstellen. Die Client-ID endet auf `.apps.googleusercontent.com`. Client-ID und zugehöriges Client-Secret bereithalten.
4. Für dauerhafte automatische Kopien unter **Zielgruppe / Audience → App veröffentlichen / In Produktion** wechseln. Der Testmodus begrenzt die Freigabe üblicherweise auf sieben Tage. Verlangte Homepage- und Datenschutz-URLs unter Branding ergänzen. Eine persönliche App benötigt normalerweise keine öffentliche Verifizierung.

Die gemeinsame Rclone-Client-ID wird 2026 abgeschaltet. Eigene Zugangsdaten verwenden. Die [aktuelle Rclone-Anleitung](https://rclone.org/drive/#making-your-own-client-id) erläutert auch abweichende Google-Menübezeichnungen und Workspace-Konten.

## 3. Rclone-Abfragen im LXC

| Abfrage | Eingabe |
|---|---|
| New remote | `n` |
| name | `gdrive` |
| Storage | `drive` (Google Drive; Menü-Nummern können sich ändern) |
| client_id | Eigene Google-OAuth-Client-ID |
| client_secret | Zugehöriges Client-Secret |
| scope | `1` / `drive` (Lesen und Schreiben) |
| root_folder_id, falls gefragt | Leer lassen, Enter |
| service_account_file | Leer lassen, Enter; kein Dienstkonto nötig |
| Edit advanced config? | `n` |
| Token already configured / refresh? (beim erneuten Anmelden) | `y`, wenn die Anmeldung erneuert werden soll |
| Use web browser / Use auto config? | `n`, weil der LXC keinen Browser hat |

Bei `config_token>` mit dem nächsten Schritt fortfahren.

## 4. Anmeldung am Mac oder PC

1. [Rclone auf dem Computer mit Browser installieren](https://rclone.org/install/), möglichst in derselben Version wie im LXC. `rclone version` zeigt die Version. Auf einem Mac mit vorhandenem Homebrew: `brew install rclone`.
2. Den vollständigen vom LXC angezeigten `rclone authorize "drive" …`-Befehl auf diesem Computer ausführen, inklusive zusätzlicher Argumente für deine Client-ID.
3. Im Browser das richtige Google-Konto wählen und Zugriff erlauben. Eine Warnung zur ungeprüften App nur für deine eigene gerade erstellte App bestätigen.
4. Das ausgegebene Token zwischen den Markierungen vollständig kopieren, im LXC bei `config_token>` einfügen und Enter drücken. Client-Secret und Token bleiben lokal; nicht in die Web-App oder in einen Chat einfügen.

[Alternative Verfahren und Rclone-Anleitung für Server ohne Browser](https://rclone.org/remote_setup/).

## 5. Konfiguration abschließen

| Abfrage | Eingabe |
|---|---|
| Shared Drive / Team Drive? | `n` für „Meine Ablage“; `y` nur für eine tatsächlich verwendete geteilte Workspace-Ablage |
| Keep this remote? / Yes this is OK? | `y` |
| Current remotes zeigt `gdrive` mit Typ `drive` | `q` zum Beenden |

Im LXC:

```sh
chown qnap-backup:qnap-backup /var/lib/qnap-backup/rclone.conf
chmod 600 /var/lib/qnap-backup/rclone.conf
runuser -u qnap-backup -- rclone lsd gdrive: --config /var/lib/qnap-backup/rclone.conf
```

Eine Liste ohne Fehler bestätigt den Lesetest; bei leerer Ablage ist eine leere Ausgabe korrekt. `rclone.conf` enthält die Google-Anmeldung: geschützt sichern. Ein App-Einstellungs-Export enthält sie nicht. Das Update-Skript sichert das ganze Datenverzeichnis.

## 6. App und erster Test

1. **Backup-Ziele → Akkordeon Google Drive** öffnen. Remote `gdrive`, Zielordner beispielsweise `QNAP-Backup`, zunächst eine kleine Quelle auswählen.
2. **Übertragungsart** wählen: **Kopie** übernimmt neue und geänderte Dateien und behält zusätzliche Zieldateien. **Synchronisierung** spiegelt den aktuellen Quellinhalt und entfernt zusätzliche Dateien ausschließlich im jeweiligen Ziel-Unterordner `Remote:Zielordner/Backup-ID`. Dafür die Löschbestätigung aktivieren und unter Quellen die erwartete SMB-Freigabe bestätigen. Bestehende Einrichtungen bleiben auf Kopie. Anschließend optional täglichen, wöchentlichen oder monatlichen Zeitplan einstellen. Die Zeitzone steht unter Einstellungen. Fehlende Monatstage werden auf den letzten Monatstag gelegt.
3. **Google Drive speichern → Google Drive prüfen → Jetzt nach Drive kopieren / Jetzt synchronisieren**. Der Verbindungstest liest; Schreibrechte werden beim Kopieren geprüft.
4. Die Übersicht zeigt Quellen, Plan, nächsten Termin, letzten Erfolg und laufenden Fortschritt. Kopien dort starten oder abbrechen.
5. Nach Erfolg in Google Drive `QNAP-Backup/<Backup-ID>/` öffnen, eine Datei herunterladen und ihren Inhalt prüfen. Erst dann weitere Quellen aktivieren.

Neue Drive-Aufträge warten auf PBS-Aufträge, Pause und Startfenster. Ein laufender Auftrag wird fertiggestellt. Unter **Einstellungen → Startfenster & Bandbreite** hat Google Drive ein eigenes Upload-Limit (MiB/s; 0 = unbegrenzt), unabhängig vom PBS-Limit. Jede Quelle hat einen eigenen Unterordner. Beide Modi vergleichen den vorhandenen Bestand und übertragen nur neue oder geänderte Dateien, nicht jedes Mal die gesamten 2 TB. Im Kopie-Modus bleiben gelöschte Quelldateien im Ziel; Synchronisierung entfernt sie dort nach den Übertragungen (`--delete-after`). Änderungen auf Google Drive werden niemals auf die Quelle zurückgeschrieben. Der Abgleich erfolgt pro manuellem oder geplantem Lauf, nicht in Echtzeit. Die App verwaltet keine eigenen Drive-Versionen. Zum Wiederherstellen Dateien aus Drive herunterladen und zunächst separat prüfen.

Unter **Backup-Ziele → Speicherstände** und auf der Übersicht wird auch die Google-Kontoquote angezeigt. Andere Google-Dienste und der Papierkorb werden getrennt genannt, soweit Google Werte liefert. Geteilte Ablagen können ohne eigene Speicherquote erscheinen. Der Abruf erfolgt im Hintergrund oder per „Speicher aktualisieren“; bei Fehlern bleibt der letzte Stand erkennbar erhalten.

Aktiviertes ntfy meldet auch fehlgeschlagene Drive-Kopien, Verbindungs- und Speicherprüfungen. Abbrüche sind keine Fehler. Mit aktivierter Erfolgszusammenfassung wird auch eine erfolgreiche Drive-Kopie gemeldet.

## Bei Fehlern

- **Remote fehlt / Zugang fehlgeschlagen:** Namen, Typ `drive`, Konfigurationspfad, Eigentümer und Anmeldung als Dienstbenutzer prüfen.
- **Freigabe nach sieben Tagen abgelaufen:** Google-App auf „In Produktion“ stellen und über `rclone config` die Google-Anmeldung erneuern.
- **Kopie fehlgeschlagen:** Speicherplatz und Schreibrechte in Drive sowie die SMB-Zuordnung und Lesbarkeit im LXC prüfen.
- **Auftrag wartet:** PBS-Warteschlange, Pause und Startfenster kontrollieren. Dieser Zustand ist kein Fehler.

Offizielle Erläuterungen: [rclone copy](https://rclone.org/commands/rclone_copy/) und [rclone sync](https://rclone.org/commands/rclone_sync/). Eine Spiegelung übernimmt auch versehentliche Löschungen und ersetzt keine versionierte Sicherung; PBS-Sicherungen bleiben separat.
