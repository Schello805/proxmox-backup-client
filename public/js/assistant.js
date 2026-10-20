export function installAssistant({ api, getConfig, refresh, openSource }) {
  const root = document.querySelector('#assistant');
  let kind = '', step = 0, busy = false;
  let commandViews = [];
  const $ = selector => root.querySelector(selector);
  const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
  root.innerHTML = `<div class="page-heading"><div><span class="eyebrow">SCHRITT FÜR SCHRITT</span><h1>Hinzufügen</h1><p>Vorbereiten, prüfen, übernehmen.</p></div><a href="#overview" class="secondary">Zur Übersicht</a></div>
  <nav class="assistant-choices" aria-label="Einrichtung auswählen"><a href="#assistant/source">Neue Quelle</a><a href="#assistant/pbs">PBS-Ziel</a></nav>
  <form id="assistantForm" class="panel assistant-panel" novalidate>
    <ol id="assistantSteps" class="assistant-steps"></ol><div id="assistantBody"></div>
    <p id="assistantResult" role="status"></p><div class="actions"><button type="button" id="assistantBack" class="secondary">Zurück</button><button type="submit" id="assistantNext" class="primary">Weiter</button></div>
  </form>`;
  const source = { name: '', id: '', path: '', expectedSource: '', target: 'primary', hostPath: '', ct: '119', inLXC: false };
  const suggested = {};
  const pbs = { datastore: '', path: '/mnt/datastore', create: false, server: '', authId: '', password: '', fingerprint: '', namespace: '', ownServer: false };
  let storedTarget = null;
  function field(label, name, value, type = 'text') {
    const wrapper = document.createElement('label'); wrapper.textContent = label;
    const input = document.createElement('input'); input.name = name; input.type = type;
    if (type === 'checkbox') input.checked = Boolean(value); else input.value = value;
    input.addEventListener('input', () => { (kind === 'source' ? source : pbs)[name] = type === 'checkbox' ? input.checked : input.value; $('#assistantResult').textContent = ''; for (const update of commandViews) update(); });
    wrapper.append(input); return wrapper;
  }
  function text(value, className = 'hint') { const p = document.createElement('p'); p.className = className; p.textContent = value; $('#assistantBody').append(p); }
  function commands(title, instructions, value) {
    const card = document.createElement('section'); card.className = 'command-card';
    const heading = document.createElement('div'); heading.className = 'panel-title';
    const strong = document.createElement('strong'); strong.textContent = title;
    const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'secondary'; copy.textContent = 'Kopieren'; copy.setAttribute('aria-label', title + ' kopieren');
    const pre = document.createElement('pre'); pre.tabIndex = 0;
    const current = () => typeof value === 'function' ? value() : value;
    const paint = () => { try { pre.textContent = current(); } catch { pre.textContent = 'Bitte die Angaben oben korrigieren.'; } }; commandViews.push(paint); paint();
    copy.addEventListener('click', async () => {
      try {
        const value = current();
        if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(value);
        else { const area = document.createElement('textarea'); area.value = value; area.className = 'copy-buffer'; document.body.append(area); const x = scrollX, y = scrollY; area.focus({ preventScroll: true }); area.select(); const ok = document.execCommand('copy'); area.remove(); copy.focus({ preventScroll: true }); window.scrollTo(x, y); if (!ok) throw new Error(); }
        copy.textContent = 'Kopiert ✓';
      } catch { if (pre.textContent === 'Bitte die Angaben oben korrigieren.') { $('#assistantResult').textContent = pre.textContent; return; } const selection = getSelection(), range = document.createRange(); range.selectNodeContents(pre); selection.removeAllRanges(); selection.addRange(range); $('#assistantResult').textContent = 'Befehl markiert – mit Strg+C kopieren.'; }
    });
    const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = instructions;
    heading.append(strong, copy); card.append(heading, hint, pre); $('#assistantBody').append(card);
  }
  function render() {
    const config = getConfig(), labels = kind === 'source' ? ['Quelle', 'Einbinden', 'Prüfen & speichern'] : ['Datastore', 'Vorbereiten', 'Prüfen & speichern'];
    $('#assistantSteps').replaceChildren(...labels.map((label, index) => { const li = document.createElement('li'); li.textContent = `${index + 1}. ${label}`; if (index === step) li.setAttribute('aria-current', 'step'); return li; }));
    root.querySelectorAll('.assistant-choices a').forEach(link => link.classList.toggle('active', link.hash.endsWith(kind)));
    commandViews = []; $('#assistantBody').replaceChildren(); $('#assistantBack').hidden = step === 0 || (kind === 'pbs' && Boolean(storedTarget)); $('#assistantNext').textContent = step === 2 ? (kind === 'source' ? 'Quelle prüfen & hinzufügen' : 'Ziel speichern & prüfen') : 'Weiter';
    if (kind === 'source') {
      if (step === 0) {
        const grid = document.createElement('div'); grid.className = 'assistant-fields';
        grid.append(field('Quellenname', 'name', source.name), field('Backup-ID', 'id', source.id), field('Pfad im LXC', 'path', source.path), field('SMB-Freigabe', 'expectedSource', source.expectedSource));
        const label = document.createElement('label'); label.textContent = 'Backup-Ziel'; const select = document.createElement('select'); select.name = 'target';
        for (const [value, name] of [['primary', config.repository.split(':').at(-1) || 'Datastore 1'], ...(config.secondaryDatastore ? [['secondary', config.secondaryDatastore + (config.secondaryPBS ? ' · ' + config.secondaryPBS.server : '')]] : [])]) { const option = document.createElement('option'); option.value = value; option.textContent = name; select.append(option); }
        select.value = source.target; select.addEventListener('change', () => source.target = select.value); label.append(select); grid.append(label, field('Bereits im LXC eingebunden', 'inLXC', source.inLXC, 'checkbox'));
        grid.querySelector('[name=name]').addEventListener('input', () => {
          const slug = source.name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 32);
          const server = config.sources.find(item => item.expectedSource)?.expectedSource.split('/')[2];
          for (const [key, value] of [['id', /^[a-z]/.test(slug) ? slug : 'quelle-' + slug], ['path', '/mnt/Daten/' + source.name.replace(/[^a-zA-Z0-9_-]/g, '-')], ['expectedSource', server ? '//' + server + '/' + source.name : '']]) if (!source[key] || source[key] === suggested[key]) { source[key] = value; suggested[key] = value; grid.querySelector(`[name=${key}]`).value = value; }
        });
        $('#assistantBody').append(grid); text('Beispiel: Fotos · fotos · /mnt/Daten/Fotos · //192.168.1.21/Fotos');
      } else if (step === 1) {
        if (!source.inLXC) {
          const grid = document.createElement('div'); grid.className = 'assistant-fields'; grid.append(field('Host-Mountpfad', 'hostPath', source.hostPath), field('LXC-ID', 'ct', source.ct, 'number')); $('#assistantBody').append(grid);
          text('Falls SMB am Host fehlt: Proxmox → Rechenzentrum → Storage → Hinzufügen → SMB/CIFS. Freigabe eintragen; den Mountpfad oben verwenden.');
          commands('1 · Proxmox-Host · Bash', 'Prüft die Freigabe und verwendet einen freien mp-Slot. Danach den LXC im Proxmox-Webinterface herunterfahren und wieder starten, falls der Mount noch nicht sichtbar ist.', () => hostCommands());
        }
        commands('2 · LXC · Bash', 'Hier müssen die richtige SMB-Freigabe und lesbare Dateien erscheinen. Den Dienst nach Mount-Änderungen neu starten; vorher laufende Backups beenden.', `findmnt -T ${quote(source.path)} -o TARGET,SOURCE,FSTYPE &&\nrunuser -u qnap-backup -- ls -- ${quote(source.path)} &&\nDATA_DIR=/var/lib/qnap-backup node /opt/proxmox-backup-client/scripts/check.js --busy &&\nsystemctl restart qnap-backup`);
      } else {
        text(`${source.name} · ${source.path} → ${source.target === 'secondary' ? config.secondaryDatastore : config.repository.split(':').at(-1)}`, 'assistant-summary');
        text(`Erwartet: ${source.expectedSource}. Die App prüft jetzt die tatsächliche SMB-Zuordnung. Startet ohne automatischen Zeitplan.`);
      }
    } else renderPBS(config);
    const cards = [...root.querySelectorAll('.command-card')]; if (cards.length) { const grid = document.createElement('div'); grid.className = 'assistant-commands'; grid.append(...cards); $('#assistantBody').append(grid); }
  }
  function validateSource() {
    const config = getConfig();
    if (!source.name.trim() || source.name.length > 60 || /[\r\n\0]/.test(source.name)) throw new Error('Kurzen Quellennamen eintragen.');
    if (!/^[a-z][a-z0-9_-]{0,39}$/.test(source.id) || config.sources.some(item => item.id === source.id)) throw new Error('Eine freie Backup-ID aus kleinen Buchstaben, Ziffern und Bindestrichen wählen.');
    if (!/^\/mnt\/Daten\/[a-zA-Z0-9_./ -]+$/.test(source.path) || source.path.endsWith('/') || source.path.split('/').slice(1).some(part => ['', '.', '..'].includes(part)) || source.path.includes('//')) throw new Error('Einen Pfad unter /mnt/Daten/ angeben.');
    if (config.sources.some(item => item.path === source.path || item.path.startsWith(source.path + '/') || source.path.startsWith(item.path + '/'))) throw new Error('Dieser Pfad ist bereits enthalten oder überlappt mit einer Quelle.');
    if (!/^\/\/[^/\s]+\/[^\r\n\0]+$/.test(source.expectedSource)) throw new Error('SMB-Freigabe als //server/freigabe angeben.');
  }
  function validateHost() { if (!/^\/[a-zA-Z0-9_./ -]+$/.test(source.hostPath) || source.hostPath.split('/').includes('..') || !/^\d+$/.test(source.ct) || Number(source.ct) < 100) throw new Error('Gültigen absoluten Hostpfad und LXC-ID ab 100 eintragen.'); }
  function hostCommands() {
    validateHost();
    return `bash <<'QNAP_SETUP'\nset -eu\nct=${quote(source.ct)}\nhost_path=${quote(source.hostPath)}\nlxc_path=${quote(source.path)}\nexpected=${quote(source.expectedSource)}\n[ "$(findmnt -n -o SOURCE -T "$host_path")" = "$expected" ] || { echo 'SMB-Freigabe am Host stimmt nicht.'; exit 1; }\ncase "$(findmnt -n -o FSTYPE -T "$host_path")" in cifs|smb3) ;; *) echo 'Kein SMB-Mount.'; exit 1 ;; esac\nconfig=$(pct config "$ct")\nif printf '%s\\n' "$config" | tr ',' '\\n' | grep -Fxq -- "mp=$lxc_path"; then\n  echo 'Zielpfad bereits konfiguriert. Bestehende Zuordnung prüfen.'\n  exit 1\nfi\nfor slot in $(seq 0 255); do\n  if ! printf '%s\\n' "$config" | grep -q "^mp$slot:"; then\n    pct set "$ct" "-mp$slot" "$host_path,mp=$lxc_path,ro=1"\n    exit 0\n  fi\ndone\necho 'Kein freier Mount-Slot.'\nexit 1\nQNAP_SETUP`;
  }
  function validatePBS() {
    const config = getConfig();
    if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,63}$/.test(pbs.datastore)) throw new Error('Datastore-Namen aus Buchstaben, Zahlen, Punkt, Bindestrich oder Unterstrich wählen.');
    if (!storedTarget && ((!pbs.ownServer && pbs.datastore === config.repository.split(':').at(-1)) || config.secondaryDatastore)) throw new Error(config.secondaryDatastore ? 'Beide Datastore-Plätze sind bereits eingerichtet. Vorhandene Ziele unter Einstellungen bearbeiten.' : 'Dieser Datastore ist bereits eingerichtet.');
    if (pbs.create && (!/^\/[a-zA-Z0-9_./-]+$/.test(pbs.path) || pbs.path === '/' || pbs.path.split('/').some(part => ['.', '..'].includes(part)))) throw new Error('Den vorhandenen Mountpfad des PBS-Datenträgers angeben, z. B. /mnt/datastore.');
    if (!storedTarget && (!config.repository || pbs.ownServer) && (!/^[a-zA-Z0-9.-]+$/.test(pbs.server) || !/^[^\s@]+@[^\s@]+$/.test(pbs.authId) || !pbs.password)) throw new Error('PBS-Adresse, Benutzer (z. B. backup@pbs) und Passwort oder Token eintragen.');
  }
  function renderPBS(config) {
    if (step === 0) {
      text(config.repository && !pbs.ownServer ? `Weiterer Datastore auf ${config.repository.slice(config.repository.lastIndexOf('@') + 1, config.repository.lastIndexOf(':'))}. Verwendet denselben Zugang und Namespace.` : 'Vorhandenen PBS verbinden. Debian-LXC und Backup Client sind bereits eingerichtet.');
      if (config.repository) { const own = field('Zusätzlicher PBS mit eigenem Zugang', 'ownServer', pbs.ownServer, 'checkbox'); own.querySelector('input').addEventListener('change', render); $('#assistantBody').append(own); }
      const grid = document.createElement('div'); grid.className = 'assistant-fields'; grid.append(field('Neuer Datastore', 'datastore', pbs.datastore), field('Datastore muss noch angelegt werden', 'create', pbs.create, 'checkbox'));
      if (!config.repository || pbs.ownServer) grid.append(field('PBS-Adresse', 'server', pbs.server), field('PBS-Benutzer', 'authId', pbs.authId), field('PBS-Passwort / Token', 'password', pbs.password, 'password'), field('Zertifikats-Fingerprint (optional)', 'fingerprint', pbs.fingerprint), field('Namespace (optional)', 'namespace', pbs.namespace));
      $('#assistantBody').append(grid);
      if (config.secondaryDatastore) text('Beide Ziele sind belegt. Unter Einstellungen kannst du sie bearbeiten.');
    } else if (step === 1) {
      if (pbs.create) {
        $('#assistantBody').append(field('PBS-Datenträger · Mountpfad', 'path', pbs.path));
        commands('1 · PBS · Bash', 'Auf dem PBS ausführen. Der Datenträger muss bereits gemountet sein. Legt nur den Datastore an; keine Formatierung.', () => { validatePBS(); return `mountpoint -q -- ${quote(pbs.path)} &&\nproxmox-backup-manager datastore create ${quote(pbs.datastore)} ${quote(pbs.path.replace(/\/$/, '') + '/' + pbs.datastore)}`; });
      }
      commands('2 · PBS · Shell', 'Datastore kontrollieren. Der verwendete PBS-Benutzer braucht Backup-Rechte und Leserechte für die Bestandsabfrage. Bei selbst signiertem Zertifikat den Fingerprint mit den Einstellungen vergleichen.', 'proxmox-backup-manager datastore list\nproxmox-backup-manager cert info');
    } else {
      text(`Datastore: ${pbs.datastore}${pbs.ownServer || !config.repository ? ' · PBS: ' + pbs.server : ''}`, 'assistant-summary');
      text('Speichert das Ziel und prüft den Zugriff. Danach kannst du es direkt an einer Quelle auswählen. Bestehende Quellen behalten ihr Ziel.');
    }
  }
  async function savePBS() {
    validatePBS();
    if (!storedTarget) {
      const result = await api('/api/targets/setup', pbs); storedTarget = result.target; pbs.password = '';
      await refresh();
    }
    try { const result = await api('/api/connection', { target: storedTarget }); if (!result.ok) throw new Error(result.message); $('#assistantResult').textContent = `Ziel gespeichert · ${result.message}. Unter Quellen das Backup-Ziel auswählen.`; $('#assistantNext').textContent = 'Verbindung erneut prüfen'; }
    catch (e) { $('#assistantResult').textContent = `Ziel gespeichert, Prüfung fehlgeschlagen: ${e.message}. Zugang und PBS-Rechte unter Einstellungen prüfen.`; $('#assistantNext').textContent = 'Verbindung erneut prüfen'; }
  }
  $('#assistantBack').addEventListener('click', () => { step--; $('#assistantResult').textContent = ''; render(); });
  $('#assistantForm').addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return;
    $('#assistantResult').textContent = '';
    try {
      if (kind === 'pbs') { validatePBS(); if (step < 2) { step++; render(); return; } busy = true; $('#assistantNext').disabled = true; await savePBS(); return; }
      validateSource();
      if (step < 2) { if (step === 0 && !source.hostPath) source.hostPath = '/mnt/pve/QNAP4bay-' + source.name.replace(/[^a-zA-Z0-9_-]/g, '-'); if (step === 1 && !source.inLXC) validateHost(); step++; render(); return; }
      busy = true; $('#assistantNext').disabled = true;
      const verified = await api('/api/sources/probe', { path: source.path, expectedSource: source.expectedSource });
      if (!verified.ok || verified.mount?.source !== source.expectedSource) throw new Error(verified.error || 'Die erkannte SMB-Freigabe stimmt nicht überein. Host-Zuordnung prüfen.');
      const config = getConfig();
      await api('/api/sources', { sources: [...config.sources, Object.fromEntries(['id','name','path','expectedSource','target'].map(key => [key, source[key]]))] });
      await refresh(); const addedId = source.id; Object.assign(source, { name: '', id: '', path: '', expectedSource: '', target: 'primary', hostPath: '', ct: '119', inLXC: false }); step = 0; openSource(addedId); $('#assistantResult').textContent = 'Quelle hinzugefügt. Den Wochenplan kannst du direkt im Detailbereich einstellen.';
    } catch (e) { $('#assistantResult').textContent = e.message; }
    finally { busy = false; $('#assistantNext').disabled = false; }
  });
  return { open(nextKind) { const next = nextKind === 'pbs' ? 'pbs' : 'source'; if (next !== kind) { kind = next; step = 0; $('#assistantResult').textContent = ''; } render(); } };
}
