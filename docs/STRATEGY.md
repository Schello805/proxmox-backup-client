# Backup-Strategie und gemeinsamer Zeitplan

**Aufträge** steuert PBS und Google Drive. **Strategie** dokumentiert zusätzlich Sicherungen, die etwa QNAP HBS, Proxmox oder ein anderes Programm ausführt. **Zeitplan** zeigt beides zusammen.

## Planner übernehmen

1. Unter **Strategie → Planner importieren** die JSON-Datei auswählen und **Datei prüfen** drücken.
2. Die Vorschau zeigt aktive Pläne, Datenbestände, Ziele und Standorte. Gelöschte oder inaktive Datensätze werden ausgeschlossen; defekte Referenzen verhindern den Import.
3. Optional Datenbestände ausdrücklich mit eingebundenen App-Quellen und Planner-Ziele mit App-Zielen verbinden. Gleiche Namen bedeuten nicht dieselbe Quelle oder dasselbe Gerät.
4. Ersetzen bestätigen und **Strategie übernehmen** drücken.

Der Import ersetzt ausschließlich Strategie-Metadaten. Er legt keine ausführbaren Aufträge, Mounts oder Zugangsdaten an und verändert keine bestehenden App-Zeitpläne. Externe Sicherungen müssen weiterhin in ihrem jeweiligen Programm eingerichtet werden.

## Danach

- **Sicherungswege** zeigt Ursprung, gegebenenfalls eine vorgeschaltete Kopie, Ziel und Schutzart.
- **Mit App verbinden** verwaltet die Zuordnung zu vorhandenen Quellen und Zielen.
- **Geräte & Standorte** verwaltet Standorte, Quellgeräte, Speicherziele, Datenbestände und Software. Verwendete Einträge lassen sich erst nach dem Entfernen ihrer Verknüpfungen löschen.
- **Externer Plan** legt einen dokumentierten Weg samt Tages-, Wochen- oder Monatsplan an. Auch Monatsende und manuelle Pläne sind möglich.
- **Aufträge** enthält Suche sowie Filter für Verwaltung und Status. Externe Pläne haben keine Start-Schaltfläche. Bei einer Zuordnung bleiben Plan und ausführbarer App-Auftrag ausdrücklich unterscheidbar.

## Status und Kalender richtig lesen

Ein dokumentierter Plan ist kein Backup-Nachweis. Auch die Zuordnung zu einem App-Auftrag bestätigt nicht automatisch jeden Datenbestand oder eine unabhängige Kopie. Datastores desselben PBS dürfen nicht allein aufgrund ihrer Anzahl als unabhängige Sicherungen gezählt werden.

Der gemeinsame Kalender zeigt gemessene erfolgreiche Laufzeiten bei App-Aufträgen, deklarierte Laufzeiten bei externen Plänen und Startpunkte bei unbekannter Dauer. Eine deklarierte Dauer ist gestrichelt. Überlappende Balken werden in getrennten Spuren angezeigt. PBS-Aufträge dieser App laufen weiterhin nacheinander; Balken sind keine Zusage tatsächlicher Start- oder Endzeiten.

Die Wochenansicht und Agenda berücksichtigen die konfigurierte Zeitzone und die tatsächliche Länge der Tage bei Zeitumstellungen. Vollständig verknüpfte externe Pläne lassen sich über den externen Filter ansehen; in der gemeinsamen Ansicht wird derselbe zugeordnete Weg nicht noch einmal als eigener Termin angezeigt.

## Strategie sichern

**Strategie exportieren** lädt eine JSON-Datei ohne Backup-Zugangsdaten herunter. Sie lässt sich über denselben Import wieder einlesen. Beim Import oder Speichern eines geänderten Strategiestands behält die App zehn vorherige Fassungen unter `strategy-backups/` im Datenverzeichnis. Eine dortige JSON-Datei kann über den Strategie-Import wiederhergestellt werden.

Die Strategie liegt in `strategy.json` im Datenverzeichnis und ist unabhängig vom Einstellungs-Export. Daher den Strategie-Export zusätzlich aufbewahren. Eine veraltete Vorschau oder gleichzeitig geänderte Strategie wird vor dem Überschreiben abgewiesen.
