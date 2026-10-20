export function createAPI(onUnauthorized, fetcher = fetch) {
  return async function api(url, data) {
    const options = { signal: AbortSignal.timeout(25000) };
    if (data !== undefined) Object.assign(options, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qnap-dashboard' }, body: JSON.stringify(data) });
    const response = await fetcher(url, options);
    let result;
    try { result = await response.json(); } catch { throw new Error('Der Server hat keine gültige JSON-Antwort geliefert. Dienstprotokoll prüfen.'); }
    if (response.status === 401 && url !== '/api/login') onUnauthorized();
    if (!response.ok) throw Object.assign(new Error(result.error || `Anfrage fehlgeschlagen (HTTP ${response.status}).`), { field: result.field, status: response.status });
    return result;
  };
}
