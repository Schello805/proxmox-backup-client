export function installSourceHelp(form) {
  const hints = {
    name: ['Name', 'Anzeigename in der App, zum Beispiel „Daten“. Du kannst ihn später ändern.'],
    id: ['Backup-ID', 'Dauerhafte Kennung, zum Beispiel „daten“: im PBS der Gruppenname, in Google Drive der Unterordner im Ziel. Kleinbuchstaben, Zahlen, Bindestriche und Unterstriche; mit einem Buchstaben beginnen. Für vorhandene Sicherungen dieselbe ID und dasselbe Ziel verwenden.'],
    path: ['Pfad im LXC', 'Ordner innerhalb des Backup-Containers, zum Beispiel /mnt/Daten/Daten. Nicht den Host-Pfad /mnt/pve/… und nicht die NAS-Adresse eintragen. Der Ordner muss bereits eingebunden und für qnap-backup lesbar sein.'],
    target: ['Backup-Ziel', 'Ein eingerichtetes Ziel auswählen: PBS sichert mit Versionen; Google Drive verwendet den unter Ziele eingestellten Modus. Der Google-Drive-Zeitplan gilt gemeinsam für alle dort ausgewählten Daten.'],
    expectedSource: ['Erwartete Netzwerkfreigabe', 'Optionaler Schutz gegen eine falsche Freigabe. SMB-Beispiel: //192.168.1.21/Daten; NFS-Beispiel: 192.168.1.21:/Daten. Am einfachsten Pfad eintragen und „Mount-Quelle ermitteln“ klicken. Der erkannte Wert wird erst beim Speichern übernommen.'],
    planMode: ['Frequenz', '„Nur manuell“ startet nichts automatisch. Für einen Zeitplan täglich, wöchentlich, monatlich oder eigene Wochentage wählen. Bei wöchentlichen und eigenen Plänen die gewünschten Tage anklicken.'],
    planTime: ['Uhrzeit', 'Startzeit in der unter dem Plan angezeigten Zeitzone. Diese lässt sich unter „Einstellungen“ ändern. Bei „Nur manuell“ wird die Uhrzeit nicht verwendet.']
  };
  for (const [name, [title, text]] of Object.entries(hints)) {
    const input = form.elements.namedItem(name), label = input.closest('label');
    const wrapper = document.createElement('div'); wrapper.className = 'source-help-field';
    label.before(wrapper);
    input.id ||= `source-field-${name}`;
    const heading = document.createElement('div'); heading.className = 'source-help-heading';
    const caption = document.createElement('label'); caption.htmlFor = input.id; caption.textContent = title;
    const controls = document.createElement('div'); controls.className = 'source-help-controls';
    for (const node of [...label.childNodes]) if (node.nodeType !== Node.TEXT_NODE) controls.append(node);
    label.remove(); heading.append(caption); wrapper.append(heading, controls);
    const button = document.createElement('button'); button.type = 'button'; button.className = 'source-help-button'; button.textContent = '?';
    button.setAttribute('aria-label', `Hilfe: ${title}`);
    const tip = document.createElement('span'); tip.className = 'source-help-tip'; tip.id = `source-help-${name}`; tip.role = 'tooltip'; tip.textContent = text; tip.hidden = true;
    button.setAttribute('aria-describedby', tip.id); input.setAttribute('aria-describedby', [input.getAttribute('aria-describedby'), tip.id].filter(Boolean).join(' '));
    heading.append(button); wrapper.append(tip);
    button.addEventListener('mouseenter', () => { tip.hidden = false; });
    button.addEventListener('mouseleave', () => { if (document.activeElement !== button) tip.hidden = true; });
    button.addEventListener('focus', () => { tip.hidden = false; });
    button.addEventListener('blur', () => { tip.hidden = true; });
    button.addEventListener('click', () => { tip.hidden = false; });
    button.addEventListener('keydown', event => { if (event.key === 'Escape') { tip.hidden = true; event.stopPropagation(); } });
  }
}
