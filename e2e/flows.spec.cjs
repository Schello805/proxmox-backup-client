'use strict';
const { test, expect, login } = require('./fixtures.cjs');

test('Passwort-Modal: Fehler, Anmeldung und Sperren', async ({ page }) => {
  await page.goto('/'); await expect(page.getByRole('dialog', { name: 'Willkommen zurück' })).toBeVisible();
  await page.getByLabel('Passwort', { exact: true }).fill('falsch');
  await page.getByRole('button', { name: 'Entsperren' }).click(); await expect(page.locator('#loginError')).not.toBeEmpty();
  await page.getByLabel('Passwort', { exact: true }).fill('123456'); await page.getByRole('button', { name: 'Entsperren' }).click();
  await expect(page.locator('#loginDialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Sperren', exact: true }).click(); await expect(page.locator('#loginDialog')).toBeVisible();
  await page.reload(); await expect(page.locator('#loginDialog')).toBeVisible();
});

test('Passwortschutz lässt sich deaktivieren und wieder einschalten', async ({ page }) => {
  await login(page); await page.getByRole('link', { name: /^⚙.*Einstellungen$/ }).click();
  await page.getByLabel('App mit Passwort schützen').uncheck(); await page.getByRole('button', { name: 'Zugang speichern' }).click();
  await expect(page.locator('#authResult')).toContainText('ausgeschaltet'); await page.reload(); await expect(page.locator('#loginDialog')).not.toBeVisible();
  await page.getByRole('link', { name: /^⚙.*Einstellungen$/ }).click();
  await page.getByLabel('App mit Passwort schützen').check(); await page.getByRole('button', { name: 'Zugang speichern' }).click();
  await expect(page.locator('#authResult')).toContainText('eingeschaltet'); await page.getByRole('button', { name: 'Sperren', exact: true }).click();
  await expect(page.locator('#loginDialog')).toBeVisible();
});

test('Zeitzonen-Dropdown und Wochenplan an der Daten speichern; Polling bewahrt Entwürfe', async ({ page }) => {
  await login(page); await page.clock.install(); await page.getByRole('link', { name: /^⚙.*Einstellungen$/ }).click();
  const zone = page.getByRole('combobox', { name: 'Zeitzone', exact: true });
  await expect(zone).toHaveJSProperty('tagName', 'SELECT'); await zone.selectOption('UTC');
  await page.clock.fastForward(16_000); await expect(zone).toHaveValue('UTC');
  await page.getByRole('button', { name: 'Einstellungen speichern', exact: true }).click(); await expect(page.locator('#preferencesResult')).toContainText('gespeichert');
  await page.getByRole('link', { name: /Aufträge$/ }).click(); await page.locator('tr[data-folder="software"]').getByRole('button', { name: 'Zeitplan Software bearbeiten' }).click();
  const detail = page.locator('#sourceDetail');
  await detail.getByRole('combobox', { name: 'Frequenz', exact: true }).selectOption('custom');
  await detail.getByRole('button', { name: 'Sicherung Fr', exact: true }).click();
  await detail.getByLabel('Uhrzeit', { exact: true }).fill(''); await detail.getByRole('button', { name: 'Daten speichern', exact: true }).click();
  await expect(detail.getByLabel('Uhrzeit', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await detail.getByLabel('Uhrzeit', { exact: true }).fill('03:15'); await page.clock.fastForward(16_000); await expect(detail.getByLabel('Uhrzeit', { exact: true })).toHaveValue('03:15');
  await detail.getByRole('button', { name: 'Daten speichern', exact: true }).click(); await expect(detail.locator('#sourceResult')).toContainText('gespeichert');
  await page.reload(); await expect(detail.getByLabel('Uhrzeit', { exact: true })).toHaveValue('03:15');
  await expect(detail.getByRole('button', { name: 'Sicherung Mo', exact: true })).toHaveAttribute('aria-pressed','true');
  await expect(detail.getByRole('button', { name: 'Sicherung Mi', exact: true })).toHaveAttribute('aria-pressed','true');
  await expect(detail.getByRole('button', { name: 'Sicherung Fr', exact: true })).toHaveAttribute('aria-pressed','false');
  await expect(detail.locator('#sourceTimezone')).toContainText('UTC');
});

test('ntfy: fehlendes Topic markieren, speichern und Testmeldung senden', async ({ page }) => {
  await login(page); await page.getByRole('link', { name: /^⚙.*Einstellungen$/ }).click();
  await page.getByText('Benachrichtigungen über ntfy', { exact: true }).click();
  await page.getByLabel('Fehlermeldungen aktivieren').check(); await page.getByRole('button', { name: 'ntfy speichern' }).click();
  await expect(page.getByRole('textbox', { name: /^Topic/ })).toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('textbox', { name: /^Topic/ }).fill('e2e-backup'); await page.getByRole('button', { name: 'ntfy speichern' }).click();
  await expect(page.locator('#notificationResult')).toContainText('aktiviert und gespeichert');
  await page.getByRole('button', { name: 'Gespeicherte Verbindung testen' }).click(); await expect(page.locator('#notificationResult')).toContainText('zugestellt');
  await page.reload(); await page.getByRole('link', { name: /^⚙.*Einstellungen$/ }).click(); await page.getByText('Benachrichtigungen über ntfy', { exact: true }).click();
  await expect(page.getByLabel('Fehlermeldungen aktivieren')).toBeChecked(); await expect(page.getByRole('textbox', { name: /^Topic/ })).toHaveValue('e2e-backup');
});

test('Daten hinzufügen, SMB ermitteln, bearbeiten und abmelden', async ({ page }) => {
  await login(page); await page.locator('#manageSources').click();
  const dialog = page.getByRole('region', { name: 'Daten', exact: true });
  await dialog.getByLabel('Name', { exact: true }).fill('Fotos'); await dialog.getByLabel('Backup-ID', { exact: true }).fill('fotos');
  await dialog.getByLabel('Pfad im LXC', { exact: true }).fill('/mnt/Daten/Fotos'); await dialog.getByRole('button', { name: 'Mount-Quelle ermitteln' }).click();
  await expect(dialog.getByLabel('Erwartete Netzwerkfreigabe', { exact: true })).toHaveValue('//test-nas/fotos');
  await dialog.getByRole('button', { name: 'Daten speichern' }).click();
  let row = dialog.locator('.source-editor-row').filter({ has: page.getByText('Fotos', { exact: true }) }); await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Bearbeiten' }).click(); await dialog.getByLabel('Name', { exact: true }).fill('Fotos privat');
  await dialog.getByRole('button', { name: 'Daten speichern' }).click();
  row = dialog.locator('.source-editor-row').filter({ has: page.getByText('Fotos privat', { exact: true }) }); await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Abmelden' }).click(); await expect(row).toHaveCount(0);
  await expect(dialog.locator('.source-editor-row')).toHaveCount(6);
});

test('Backup starten: Prozent, Restzeit, Live-Protokoll und Verlauf', async ({ page, app }, testInfo) => {
  await login(page);
  const row = page.locator('tr[data-folder="software"]');
  await page.getByRole('button', { name: '↻ Aktualisieren' }).click(); await expect(row.locator('.source-size')).toHaveText('10 GiB');
  await row.getByRole('button', { name: 'Starten', exact: true }).click();
  await expect(page.locator('#progressEstimate')).toContainText('ca. 50 %'); await expect(page.locator('#progressEstimate')).toContainText('Restzeit ca. 2 min');
  await expect(page.getByRole('progressbar', { name: 'Geschätzter Backup-Fortschritt' })).toHaveJSProperty('value', 50);
  await expect(row.getByRole('button', { name: 'Abbrechen', exact: true })).toBeEnabled();
  expect(await page.locator('#statusDashboard').evaluate(element => element.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('progress.png') });
  await page.getByRole('link', { name: /Protokoll$/ }).click(); await expect(page.locator('#logText')).toContainText('processed 5 GiB');
  await page.getByRole('link',{name:/Aufträge$/}).click();
  app.finish(); await expect(row.locator('.job-state')).toContainText('Erfolgreich');
  await expect(page.locator('#progressEstimate')).toHaveText('100 % · Abgeschlossen');
  await row.getByRole('button', { name: 'Software', exact: true }).click(); await expect(page.locator('#historyRows')).toContainText('Erfolgreich');
});

test('Fehlgeschlagenes Backup wird als Fehler angezeigt', async ({ page, app }) => {
  await login(page); const row = page.locator('tr[data-folder="software"]'); await row.getByRole('button', { name: 'Starten', exact: true }).click();
  await expect(row.locator('.job-state')).toContainText('Läuft'); app.finish(1);
  await expect(row.locator('.job-state')).toContainText('Fehler'); await expect(page.locator('#activityDescription')).toContainText('Exit-Code 1');
});

test('Diagnose und Update-Prüfung über die Hauptnavigation öffnen', async ({ page }) => {
  await login(page); await page.getByRole('link',{name:/Einstellungen/}).click(); await page.locator('#systemMaintenance>summary').click(); await expect(page.locator('#installedVersion')).toContainText('Installiert: v');
  await page.getByRole('button', { name: 'Diagnose starten' }).click(); await expect(page.locator('#diagnosticSummary')).toContainText('geprüft');
  await page.getByRole('link',{name:/Protokoll$/}).click();await page.locator('#logKind').selectOption('System');await expect(page.locator('#logText')).toContainText('PBS-Verbindung');await expect(page.locator('#logText')).toContainText('Nur manuelle Sicherung');await page.getByRole('link',{name:/Einstellungen/}).click();
  await page.getByRole('button', { name: 'Auf Updates prüfen' }).click(); await expect(page.locator('#updateResult')).toContainText('Ein neuer Stand');
  await expect(page.locator('#latestVersionLink')).toHaveAttribute('href', /github\.com\/Schello805/);
});

test.describe('Ohne Quellgröße', () => {
  test.use({ sourceSize: false });
  test('zeigt keine erfundene Prozentzahl oder Restzeit', async ({ page }) => {
    await login(page); await page.locator('tr[data-folder="software"]').getByRole('button', { name: 'Starten', exact: true }).click();
    await expect(page.locator('#progressEstimate')).toContainText('Quellgröße noch nicht verfügbar');
    await expect(page.getByRole('progressbar', { name: 'Geschätzter Backup-Fortschritt' })).toHaveCount(0);
  });
});


test('PBS-Bestand abrufen und nach Gruppe filtern', async ({ page }) => {
  await login(page); await page.getByRole('link', { name: /Ziele$/ }).click(); await page.locator('#pbsSettings>summary').click(); await page.getByRole('link', { name: 'PBS-Bestand', exact: true }).click();
  await page.getByRole('button', { name: 'Vom PBS abrufen', exact: true }).click();
  await expect(page.locator('#pbsRows')).toContainText('host/software');
  await page.getByRole('combobox', { name: 'PBS-Bestand filtern' }).selectOption('filme');
  await expect(page.locator('#pbsRows tr')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'PBS-Bestand filtern' }).selectOption('software');
  await expect(page.locator('#pbsRows')).toContainText('host/software');
});

test('Mobile Navigation und Einstellungen ohne horizontales Seiten-Scrollen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await login(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('link', { name: /^⚙.*Einstellungen$/ }).click();
  await expect(page.getByRole('combobox', { name: 'Zeitzone', exact: true })).toBeVisible();
  await page.getByRole('link', { name: /Anleitung/ }).click(); await expect(page.locator('#guide')).toBeVisible();
});


test('Zweiten Datastore einrichten, Quelle zuweisen und getrennten PBS-Bestand prüfen', async ({ page, app }, testInfo) => {
  await login(page); await page.getByRole('link', { name: /Ziele$/ }).click(); if ((await page.locator('#pbsSettings').getAttribute('open')) === null) await page.locator('#pbsSettings>summary').click();
  await page.locator('#additionalTargets').getByRole('link',{name:'+ Datastore hinzufügen',exact:true}).click();
  const wizard=page.getByRole('region',{name:'Einrichtungsassistent'});await wizard.getByRole('textbox',{name:'Neuer Datastore',exact:true}).fill('archive-store');await wizard.getByRole('button',{name:'Weiter',exact:true}).click();await wizard.getByRole('button',{name:'Weiter',exact:true}).click();await wizard.getByRole('button',{name:'Ziel speichern & prüfen',exact:true}).click();await expect(wizard.locator('#assistantResult')).toContainText('Ziel gespeichert');await page.getByRole('link',{name:/Ziele$/}).click();
  await page.getByRole('button', { name: 'Verbindung prüfen', exact: true }).click();
  await expect(page.locator('#connectionResult')).toContainText('archive-store: PBS erreichbar');
  await expect(page.locator('#connectionResult')).toContainText('test-store: PBS erreichbar');
  await page.getByRole('link', { name: /Aufträge$/ }).click(); await page.locator('#manageSources').click();
  const dialog = page.getByRole('region', { name: 'Daten', exact: true });
  await dialog.locator('.source-editor-row').filter({ has: page.getByText('Software', { exact: true }) }).getByRole('button', { name: 'Bearbeiten' }).click();
  await dialog.getByRole('combobox', { name: 'Backup-Ziel', exact: true }).selectOption('secondary');
  await dialog.getByRole('button', { name: 'Daten speichern' }).click(); await expect(dialog.locator('#sourceResult')).toContainText('Daten und Sicherungsplan gespeichert');
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).click();
  const row = page.locator('tr[data-folder="software"]'); await expect(row.locator('.source-target')).toHaveText('archive-store');
  await row.getByRole('button', { name: 'Starten', exact: true }).click(); await page.getByRole('link', { name: /Protokoll$/ }).click();
  await expect(page.locator('#logText')).toContainText('E2E repository: test@pbs@localhost:archive-store');
  await page.getByRole('link',{name:/Aufträge$/}).click();
  app.finish(); await expect(row.locator('.job-state')).toContainText('Erfolgreich');
  await row.getByRole('button', { name: 'Software', exact: true }).click(); await expect(page.locator('#historyRows')).toContainText('test@pbs@localhost:archive-store');
  await page.getByRole('link',{name:/Aufträge$/}).click();
  await page.getByRole('link', { name: /Ziele$/ }).click(); if ((await page.locator('#pbsSettings').getAttribute('open')) === null) await page.locator('#pbsSettings>summary').click(); await page.getByRole('link', { name: 'PBS-Bestand', exact: true }).click();
  await page.getByRole('combobox', { name: 'Datastore auswählen' }).selectOption('secondary');
  await page.getByRole('button', { name: 'Vom PBS abrufen', exact: true }).click(); await expect(page.locator('#pbsRows')).toContainText('host/daten');
  await page.getByRole('combobox', { name: 'Datastore auswählen' }).selectOption('primary');
  await expect(page.locator('#pbsRows')).not.toContainText('host/daten');
  await page.getByRole('region', { name: 'Sicherungen auf dem PBS' }).getByRole('button', { name: 'Schließen' }).click();
  await page.screenshot({ path: testInfo.outputPath('two-datastores.png') });
  await page.reload(); await expect(page.locator('tr[data-folder="software"] .source-target')).toHaveText('archive-store');
  await page.getByRole('link', { name: /Ziele$/ }).click(); if ((await page.locator('#pbsSettings').getAttribute('open')) === null) await page.locator('#pbsSettings>summary').click();
  await page.locator('[data-datastore="secondary"]').getByRole('button',{name:'Entfernen',exact:true}).click();await page.locator('[data-datastore="secondary"]').getByRole('button',{name:'Entfernen bestätigen',exact:true}).click();await expect(page.locator('#notice')).toContainText(/Datastore 2/);
});

test('Aktualisieren erkennt geänderte und neue SMB-Mounts ohne automatische Freigabe', async ({ page, app }, testInfo) => {
  await login(page);
  const data = page.locator('tr[data-folder="daten"]'); await page.getByRole('button', { name: '↻ Aktualisieren', exact: true }).click(); await expect(data.locator('.source-size')).toHaveText('10 GiB');
  await app.setMount('/mnt/Daten/Daten', { source: '//test-nas/CorrectData', bytes: 200 * 1024 ** 3 });
  await app.setMount('/mnt/Daten/FotosNeu', { source: '//test-nas/fotos-neu', bytes: 20 * 1024 ** 3 });
  await page.getByRole('button', { name: '↻ Aktualisieren', exact: true }).click();
  await expect(data.getByText('● Mount geändert', { exact: true })).toBeVisible();
  await expect(data.locator('.source-size')).not.toHaveText('10 GiB');
  await expect(data.getByRole('button', { name: 'Starten', exact: true })).toBeDisabled();
  await page.getByRole('link',{name:/Übersicht/}).click();await expect(page.getByRole('button', { name: 'Neue Netzwerkfreigaben (1)', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('mount-refresh.png') });
  await page.getByRole('button', { name: 'Neue Netzwerkfreigaben (1)', exact: true }).click();
  const dialog = page.getByRole('region', { name: 'Daten', exact: true });
  await dialog.getByRole('button', { name: 'FotosNeu als Quelle vorbereiten' }).click();
  await expect(dialog.getByLabel('Pfad im LXC', { exact: true })).toHaveValue('/mnt/Daten/FotosNeu');
  await expect(dialog.getByLabel('Erwartete Netzwerkfreigabe', { exact: true })).toHaveValue('//test-nas/fotos-neu');
  await dialog.getByRole('button', { name: 'Daten speichern', exact: true }).click();
  await expect(dialog.locator('#sourceResult')).toContainText('Daten und Sicherungsplan gespeichert');
  await expect(dialog.locator('#discoveredSources')).not.toBeVisible();
  await dialog.locator('.source-editor-row').filter({ has: page.getByText('Daten', { exact: true }) }).getByRole('button', { name: 'Mount bestätigen' }).click();
  await expect(dialog.locator('#sourceResult')).toContainText('//test-nas/CorrectData');
  await dialog.getByRole('button', { name: 'Schließen' }).click();
  await page.getByRole('button', { name: '↻ Aktualisieren', exact: true }).click();
  await expect(data.locator('.source-size')).toHaveText('200 GiB');
});

test('Aktualisieren erzwingt neue Größen und verschiebt Messungen während laufender Backups', async ({ page, app }) => {
  await login(page); const row = page.locator('tr[data-folder="software"]');
  await page.getByRole('button', { name: '↻ Aktualisieren', exact: true }).click();
  await expect(row.locator('.source-size')).toHaveText('10 GiB');
  await app.setMount('/mnt/Daten/Software', { bytes: 30 * 1024 ** 3 });
  await page.getByRole('button', { name: '↻ Aktualisieren', exact: true }).click();
  await expect(row.locator('.source-size')).toHaveText('30 GiB');
  await row.getByRole('button', { name: 'Starten', exact: true }).click();
  await app.setMount('/mnt/Daten/Software', { bytes: 50 * 1024 ** 3 });
  await page.getByRole('button', { name: '↻ Aktualisieren', exact: true }).click();
  await expect(page.locator('#notice')).toContainText('warten auf das Ende');
  await expect(row.locator('.job-state')).toContainText('Läuft');
  await expect(row.locator('.source-size')).toHaveText('Größe vorgemerkt …');
  app.finish(); await expect(row.locator('.job-state')).toContainText('Erfolgreich');
  await page.getByRole('button', { name: '↻ Aktualisieren', exact: true }).click();
  await expect(row.locator('.source-size')).toHaveText('50 GiB');
});

test('Navigation als Seiten und Drilldown: Quelle und Wochenplan direkt in der Übersicht', async ({ page }, testInfo) => {
  await login(page);
  await page.locator('#manageSources').click();
  await expect(page).toHaveURL(/#sourcesDialog$/);
  await expect(page.getByRole('region', { name: 'Daten', exact: true })).toBeVisible();
  await expect(page.locator('dialog:not(#loginDialog)')).toHaveCount(0);
  await page.goBack(); await expect(page.locator('#jobs')).toBeVisible();
  await page.locator('tr[data-folder="software"]').getByRole('button', { name: 'Zeitplan Software bearbeiten' }).click();
  await expect(page).toHaveURL(/#jobs\/software\/edit$/);
  const detail = page.locator('#sourceDetail');
  await expect(detail).toBeVisible(); await expect(page.locator('#folders')).toBeVisible();
  await detail.getByLabel('Name', { exact: true }).fill('Software neu');
  await detail.getByRole('combobox', { name: 'Frequenz', exact: true }).selectOption('weekly');
  await detail.getByLabel('Uhrzeit', { exact: true }).fill('04:25');
  for (const day of ['Mo','Mi','Fr']) { const button = detail.getByRole('button', { name: 'Sicherung ' + day, exact: true }); if (await button.getAttribute('aria-pressed') !== 'true') await button.click(); }
  await detail.getByRole('button', { name: 'Daten speichern', exact: true }).click();
  await expect(detail.locator('#sourceResult')).toContainText('Sicherungsplan gespeichert');
  await expect(page.locator('tr[data-folder="software"]')).toContainText('Software neu');
  await expect(page.locator('tr[data-folder="software"]')).toContainText('04:25');
  await page.screenshot({ path: testInfo.outputPath('source-drilldown.png'), fullPage: true });
  await detail.getByRole('button', { name: 'Verlauf', exact: true }).click();
  await expect(page).toHaveURL(/\/history$/); await expect(page.locator('#historyRows')).not.toBeEmpty();
  await page.goBack(); await expect(detail.getByLabel('Uhrzeit', { exact: true })).toHaveValue('04:25');
  await page.reload(); await expect(detail).toBeVisible(); await expect(detail.getByLabel('Name', { exact: true })).toHaveValue('Software neu');
  await detail.getByRole('button', { name: 'Schließen', exact: true }).click(); await expect(detail).not.toBeVisible();
  await page.getByRole('link', { name: /Ziele$/ }).click(); if ((await page.locator('#pbsSettings').getAttribute('open')) === null) await page.locator('#pbsSettings>summary').click();
  await expect(page.locator('#additionalTargets tbody tr')).toHaveCount(1);await expect(page.locator('#additionalTargets').getByLabel('Datastore test-store',{exact:true})).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('compact-datastores.png') });
});
