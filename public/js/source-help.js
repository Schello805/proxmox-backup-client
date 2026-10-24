export function installSourceHelp(form) {
  const hints = {
    name: ['Name', 'Anzeigename in der App, zum Beispiel „Daten“. Du kannst ihn später ändern.'],
    id: ['Backup-ID', 'Dauerhafter Name der Sicherungsgruppe im PBS, zum Beispiel „daten“. Kleinbuchstaben, Zahlen, Bindestriche und Unterstriche; mit einem Buchstaben beginnen. Bei einer vorhandenen Sicherung dieselbe ID und dasselbe Ziel verwenden.'],
    path: ['Pfad im LXC', 'Ordner innerhalb des Backup-Containers, zum Beispiel /mnt/Daten/Daten. Nicht den Host-Pfad /mnt/pve/… und nicht die NAS-Adresse eintragen. Der Ordner muss bereits eingebunden und für qnap-backup lesbar sein.'],
    target: ['Backup-Ziel', 'PBS-Datastore für diese Quelle auswählen. Weitere Ziele unter „Ziele“ anlegen. Google Drive wird separat in den Google-Drive-Einstellungen konfiguriert.'],
    expectedSource: ['Erwartete Netzwerkfreigabe', 'Optionaler Schutz gegen eine falsche Freigabe. SMB-Beispiel: //192.168.1.21/Daten; NFS-Beispiel: 192.168.1.21:/Daten. Am einfachsten Pfad eintragen und „Mount-Quelle ermitteln“ klicken. Der erkannte Wert wird erst beim Speichern übernommen.'],
    planMode: ['Frequenz', '„Nur manuell“ startet nichts automatisch. Für einen Zeitplan täglich, wöchentlich, monatlich oder eigene Wochentage wählen. Bei wöchentlichen und eigenen Plänen die gewünschten Tage anklicken.'],
    planTime: ['Uhrzeit', 'Startzeit in der unter dem Plan angezeigten Zeitzone. Diese lässt sich unter „Einstellungen“ ändern. Bei „Nur manuell“ wird die Uhrzeit nicht verwendet.']
  };
  for (const [name, [title, text]] of Object.entries(hints)) {
    const input = form.elements.namedItem(name), label = input.closest('label');
    const wrapper = document.createElement('div'); wrapper.className = 'source-help-field';
    label.before(wrapper); wrapper.append(label);
    const button = document.createElement('button'); button.type = 'button'; button.className = 'source-help-button'; button.textContent = '?';
    button.setAttribute('aria-label', `Hilfe: ${title}`);
    const tip = document.createElement('span'); tip.className = 'source-help-tip'; tip.id = `source-help-${name}`; tip.role = 'tooltip'; tip.textContent = text; tip.hidden = true;
    button.setAttribute('aria-describedby', tip.id); input.setAttribute('aria-describedby', [input.getAttribute('aria-describedby'), tip.id].filter(Boolean).join(' '));
    wrapper.append(button, tip);
    button.addEventListener('mouseenter', () => { tip.hidden = false; });
    button.addEventListener('mouseleave', () => { if (document.activeElement !== button) tip.hidden = true; });
    button.addEventListener('focus', () => { tip.hidden = false; });
    button.addEventListener('blur', () => { tip.hidden = true; });
    button.addEventListener('click', () => { tip.hidden = false; });
    button.addEventListener('keydown', event => { if (event.key === 'Escape') { tip.hidden = true; event.stopPropagation(); } });
  }
}
