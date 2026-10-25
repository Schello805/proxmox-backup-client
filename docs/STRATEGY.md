# Backup-Planung, Umsetzung und gemeinsamer Betrieb

Die App dokumentiert die gesamte Backup-Landschaft. Die Ausführung kann durch Backup Control oder direkt durch ein anderes System erfolgen. Quellen und Ziele werden dabei gemeinsam dargestellt: Ein Datenbestand kann einen eingerichteten Sicherungsweg und weitere noch geplante Wege besitzen.

## Drei Umsetzungsstände

| Stand | Bedeutung |
|---|---|
| Geplant | Gewünschter Sicherungsweg, noch nicht als eingerichtet bestätigt. |
| Durch diese App umgesetzt | Vollständig mit passenden vorhandenen App-Aufträgen verbunden. Der tatsächliche App-Zeitplan ist maßgeblich. |
| Extern umgesetzt | Das angegebene System führt die Sicherung aus, etwa Proxmox oder QNAP HBS. Die App dokumentiert dessen Zeitplan; Laufstatus und Erfolg werden nicht automatisch abgefragt. |

Das Umstellen eines Planes startet keine Sicherung und verändert keine bestehenden App-Aufträge. Ein extern eingerichtetes Backup braucht keinen LXC-Mount und keine Middleware.

## Planner übernehmen

1. **Backup-Planung → Planner importieren** öffnen, JSON-Datei auswählen und **Datei prüfen** drücken.
2. Die Vorschau zeigt aktive Pläne und Stammdaten. Gelöschte oder inaktive Einträge werden ausgeschlossen; defekte Referenzen verhindern die Übernahme.
3. Optional Datenbestände mit App-Quellen und Planner-Ziele mit App-Zielen verbinden. Gleiche Namen werden nicht automatisch gleichgesetzt.
4. Ersetzen bestätigen und übernehmen.

Ältere/importierte Pläne bleiben zunächst **geplant**. Danach unter **Backup-Pläne → Bearbeiten → Umsetzung** angeben, welche Sicherungen bereits eingerichtet sind. Die App erfindet keinen Ausführungsnachweis.

## Umsetzung bearbeiten

- **Extern umgesetzt:** Ausführendes System, Quelle, Ziel und tatsächlich dort eingerichteten Tages-, Wochen- oder Monatsplan eintragen. Die App führt diesen Auftrag nicht aus und verändert das fremde System nicht.
- **Durch diese App umgesetzt:** Im selben Formular die ausgewählten Datenbestände und das Ziel ausdrücklich mit vorhandenen App-Quellen und App-Zielen verbinden. Nur passende, vollständig abgedeckte Aufträge werden akzeptiert. Deren echte Zeitpläne lassen sich über die angezeigten Links bearbeiten.
- **Noch nicht eingerichtet:** Als geplant speichern. Über den Daten-Assistenten einen lesbaren LXC-Ordner registrieren und unter Ziele den Zugang einrichten; danach den Weg mit seinem eingerichteten App-Auftrag verbinden. Alternativ die Sicherung im zuständigen System einrichten und anschließend als extern umgesetzt dokumentieren.

Fehlt eine App-Verknüpfung nach einer Konfigurationsänderung, zeigt die Planung dies ausdrücklich. Teilzuordnungen und fehlende Zugangsdaten gelten nicht als vollständige App-Umsetzung. Die App markiert sie nicht allein anhand eines früheren Namens als erfolgreich.

## Gemeinsame Ansichten

- **Daten:** App-Ordner und nicht zugeordnete dokumentierte Datenbestände. Eine explizite Zuordnung vermeidet doppelte Einträge. Externe/geplante Datenbestände bekommen keine erfundene Mount-Prüfung und keine Start-Schaltfläche.
- **Ziele:** Gemeinsamer Zielkatalog aus eingerichteten App-Zielen und dokumentierten Speicherzielen mit Umsetzungsstand.
- **Aufträge:** Alle eingerichteten Sicherungen, durch diese App oder extern. Filter für PBS, Drive, externe Umsetzung sowie Status. Nur App-Aufträge lassen sich hier starten/abbrechen.
- **Zeitplan:** Standardmäßig alle eingerichteten Sicherungen. Noch geplante Wege sind separat oder zum Vergleich zuschaltbar. App-Umsetzungen verwenden die wirklichen App-Termine und werden nicht als zweiter Plan doppelt angezeigt.

Die Balken verwenden letzte erfolgreiche App-Laufzeiten oder die deklarierte externe Dauer. Bei unbekannter Dauer erscheinen Startpunkte. Zeitzone, Monatsende, über Mitternacht reichende Läufe und Zeitumstellungen werden berücksichtigt. Geplante Zeitfenster sind kein Live-Fortschritt und keine Zusage tatsächlicher Endzeiten.

## Netzlast und Überschneidungen

1. Unter **Geräte, Daten & Ziele → Netzwerkbereiche** einen Bereich samt nutzbarer Kapazität in **MiB/s** anlegen, beispielsweise LAN oder Internet-Uplink.
2. Im jeweiligen Plan unter **Netzwerk & erwartete Last** Bereich und erwartete Übertragungsrate eintragen. Diese Angaben sind Schätzungen; sie setzen kein Upload-Limit.
3. Im **Zeitplan → Zeitfenster und Netzlast prüfen** die Hinweise ansehen.

Die Analyse vergleicht bekannte Fenster auf gemeinsamen Quellen/Zielen und summiert erwartete externe Übertragungen im jeweiligen Netzwerkbereich. PBS und Drive teilen sich die App-Warteschlange; ihre Raten werden nicht so addiert, als liefen sie gleichzeitig. Zeitgleiche App-Termine können sich durch die Warteschlange verschieben und dadurch mit späteren externen Läufen konkurrieren.

Ohne Dauer oder Rate ist die Auswertung unvollständig. Gleichzeitige Termine allein sind kein Überlastungsnachweis. In der Vergleichsansicht werden eingerichtete und noch geplante Wege als Simulation gemeinsam betrachtet. Die App misst keine Live-Netzauslastung und verschiebt keine externen Zeitpläne. Bei sehr großen Datenmengen wird die Auswertung ausdrücklich begrenzt.

## Ohne die frühere App planen

Unter **Geräte, Daten & Ziele** sind alle Bereiche direkt als Schaltflächen mit Anzahl erreichbar. Reihenfolge: Geräte (z. B. QNAP4bay und PBS) → Daten mit Quellgerät (z. B. Musik auf QNAP4bay) → Speicherziel mit Zielgerät (z. B. Datastore pbs2 auf PBS) → Backup-Plan. Standorte, Software und Netzwerkbereiche ergänzen die Dokumentation. Über **Weiter zum Backup-Plan** Schutzart, Zeitplan und Umsetzungsstand festlegen. Aufbewahrung, Versionenzahl, Verantwortung und deklarierte Schutzmerkmale sind bearbeitbar. Beim Entfernen werden verwendende Geräte, Daten, Ziele und Pläne namentlich angezeigt und können direkt bearbeitet werden. Ein Standort lässt sich ausdrücklich mit „Zuordnungen lösen und Standort entfernen“ löschen: Standortzuordnungen werden aufgehoben, untergeordnete Standorte werden eigenständig; Geräte, Speicherziele, Daten und Pläne bleiben erhalten. Andere verwendete Stammdaten können erst nach ihren Verknüpfungen entfernt werden.

Die Angaben beschreiben gewünschte oder dokumentierte Einstellungen. Sie stellen am Ziel keine Aufbewahrung, Verschlüsselung oder Unveränderlichkeit ein. Auch mehrere Datastores auf demselben PBS sind nicht automatisch unabhängige Kopien.

## Planung sichern

**Planung exportieren** lädt die JSON-Datei ohne Backup-Zugangsdaten herunter. Der Import liest auch die eigenen Exporte einschließlich Zuordnungen und Umsetzungsständen. App-Zuordnungen werden erneut gegen die vorhandenen Aufträge validiert.

Die Planung liegt in `strategy.json` im Datenverzeichnis. Beim Speichern bleiben zehn vorherige Fassungen unter `strategy-backups/` erhalten. Diese Dateien lassen sich über denselben Import wiederherstellen. Eine veraltete Vorschau wird vor dem Überschreiben abgewiesen. Planung und App-Einstellungen sind weiterhin getrennt zu exportieren; die Rclone-Anmeldung separat sichern.

## Geräte, Daten und Speicherziele

Ein **Gerät** stellt Daten oder Speicher bereit, z. B. QNAP4bay oder PBS. Ein **Datenbestand** ist z. B. Software oder Musik. Ein **Ziel** ist der konkrete Speicherort, z. B. Datastore pbs2 auf dem PBS.

Unter **Daten → Geräte verwalten** Geräte anlegen, bearbeiten oder entfernen. Die Tabellenzeilen unter **Daten** werden nach dem zugeordneten Gerät gruppiert und lassen sich nach Gerät filtern. Bei registrierten App-Daten über **Gerät zuordnen** den tatsächlichen Speicherort festlegen. Teilaufträge übernehmen das Gerät ihres übergeordneten Datenbestands, solange ihnen kein eigenes Gerät zugeordnet ist.

Unter **Ziele → Gemeinsamer Zielkatalog → Gerät zuordnen** das Zielgerät festlegen. Mehrere PBS-Datastores können dasselbe PBS-Gerät verwenden. Geräte werden auch in den Aufträgen und den tatsächlichen Sicherungswegen angezeigt. Namen und Zuordnungen verändern keine Mounts, Backup-Zugänge oder Sicherungspläne.

Die Gerätezuordnung wird ausdrücklich gespeichert. Der ursprüngliche Speicherort eines importierten Datenbestands wird nicht automatisch zum tatsächlichen Speicherort einer aktuell eingebundenen Kopie erklärt. Ohne Zuordnung bleibt das Gerät offen gekennzeichnet. Auch gleichlautende Namen führen nicht zu einer automatischen Zusammenführung.

Ein Gerät kann sowohl Daten als auch Speicherziele bereitstellen. Verwendete Geräte können erst nach ihren Zuordnungen entfernt werden. Die Zuordnungen gehören zum Planungs-Export und bleiben beim Einlesen eigener Exporte erhalten.

Unter **Geräte, Daten & Ziele → Daten → Bearbeiten** zeigt „Backup-Ziele und Pläne“ alle Sicherungswege dieses Datenbestands. Ziele geplanter und externer Pläne sind dort änderbar; **Eintrag speichern** übernimmt sie gemeinsam. Bei Plänen mit mehreren Datenbeständen muss die Zieländerung für den ganzen Plan ausdrücklich bestätigt werden. Für App-verknüpfte Pläne führen Links zur tatsächlichen Auftragskonfiguration und zur Plan-Verknüpfung. Externe Sicherungen müssen zusätzlich im ausführenden System geändert werden.

**Speicherziel anlegen** registriert ausschließlich einen Speicherort, z. B. `pbs2` auf dem Gerät „Proxmox Backup Server“. Es erstellt keinen Backup-Plan oder ausführbaren Auftrag. Standort, Anbieter, Farbe und Schutzmerkmale stehen unter **Weitere Angaben · optional**. Daten, Quelle und Zeitplan werden anschließend getrennt unter **Backup-Pläne** verbunden. Ein Name wie „Backup von PVE auf PBS“ gehört zum Plan; der Zielname bezeichnet den Speicherort.

Bei **Durch diese App umgesetzt** muss zusätzlich zur Ordner-/Zielzuordnung auch die **Schutzart** mit dem vorhandenen Auftrag übereinstimmen. PBS verwendet „Sicherung mit Versionen“; Drive verwendet je nach Betriebsart Sicherung oder Synchronisierung. Das Formular zeigt den vorhandenen Auftrag samt Schutzart und weist sofort auf Abweichungen hin. Beim Speichern nennt eine unvollständige Verknüpfung konkret den fehlenden Ordner, das fehlende Ziel, den unvollständigen Zielzugang oder die abweichende Schutzart.
