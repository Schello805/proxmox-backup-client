const { test, expect, login } = require('./fixtures.cjs');
test('Running and queued backups can be cancelled individually and together', async ({ page }) => {
  await login(page);
  const software = page.locator('[data-folder="software"]'), filme = page.locator('[data-folder="filme"]');
  await expect(software.getByRole('button', { name: 'Starten', exact: true })).toBeEnabled();
  await software.getByRole('button', { name: 'Starten', exact: true }).click();
  await filme.getByRole('button', { name: 'Starten', exact: true }).click();
  await expect(filme.locator('.job-state')).toContainText('Wartet');
  await filme.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(filme.locator('.job-state')).toContainText('Abgebrochen');
  await expect(software.locator('.job-state')).toContainText('Läuft');
  await filme.getByRole('button', { name: 'Starten', exact: true }).click();
  await page.getByRole('button', { name: 'Alle abbrechen', exact: true }).click();
  await expect(software.locator('.job-state')).toContainText('Abgebrochen'); await expect(filme.locator('.job-state')).toContainText('Abgebrochen');
  const activity = await (await page.request.get('/api/activity')).json(); expect(activity.active).toBe(null); expect(activity.queue).toEqual([]);
  await software.getByRole('button', { name: 'Starten', exact: true }).click(); await expect(software.locator('.job-state')).toContainText('Läuft');
  await software.getByRole('button', { name: 'Abbrechen', exact: true }).click(); await expect(software.locator('.job-state')).toContainText('Abgebrochen');
  const history = await (await page.request.get('/api/history/software')).json(); expect(history.entries.every(entry => entry.status === 'cancelled')).toBe(true);
});

test('Refresh stays responsive while SMB readability is slow; changed mappings disable backups immediately', async ({ page, app }) => {
  await login(page);
  await app.setMount('/mnt/Daten/Daten', { id: '999', checkDelayMs: 5000 });
  const response = page.waitForResponse(response => response.url().endsWith('/api/refresh') && response.request().method() === 'POST');
  await page.getByRole('button', { name: '↻ Aktualisieren', exact: true }).click();
  await response; await expect(page.getByRole('button', { name: '↻ Aktualisieren', exact: true })).toBeEnabled({ timeout: 2000 });
  const daten = page.locator('[data-folder="daten"]'); await expect(daten).toContainText('Prüfung läuft');
  await app.setMount('/mnt/Daten/Daten', { source: '//test-nas/software', checkDelayMs: 0 });
  await page.getByRole('button', { name: '↻ Aktualisieren', exact: true }).click();
  await expect(daten).toContainText('SMB geändert'); await expect(daten.getByRole('button', { name: 'Starten', exact: true })).toBeDisabled();
});

test('Alle sichern runs sources sequentially, skips duplicate starts and supports cancelling the rest', async ({ page, app }) => {
  await login(page); await page.getByRole('button', { name: 'Alle PBS-Aufträge starten', exact: true }).click();
  const software = page.locator('[data-folder="software"]'), filme = page.locator('[data-folder="filme"]');
  await expect(software.locator('.job-state')).toContainText('Läuft'); await expect(filme.locator('.job-state')).toContainText('Wartet');
  expect((await (await page.request.get('/api/activity')).json()).queue).toEqual(['filme','serien','hoerspiele','musik','daten']);
  await page.getByRole('button', { name: 'Alle PBS-Aufträge starten', exact: true }).click(); await expect(page.locator('#notice')).toContainText('Keine zusätzlichen');
  expect((await (await page.request.get('/api/activity')).json()).queue).toHaveLength(5);
  app.finish(); await expect(software.locator('.job-state')).toContainText('Erfolgreich'); await expect(filme.locator('.job-state')).toContainText('Läuft');
  await page.getByRole('button', { name: 'Alle abbrechen', exact: true }).click();
  const activity = await (await page.request.get('/api/activity')).json(); expect(activity.active).toBe(null); expect(activity.queue).toEqual([]); expect(activity.jobs.software.status).toBe('success'); expect(activity.jobs.daten.status).toBe('cancelled');
});
