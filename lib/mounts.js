'use strict';
function decodeMount(value) { return value.replace(/\\([0-7]{3})/g, (_, n) => String.fromCharCode(parseInt(n, 8))); }
function mountFor(file, mountinfo) {
  return mountinfo.trim().split('\n').map(line => {
    const [left, right] = line.split(' - ');
    if (!right) return null;
    const fields = left.split(' '), after = right.split(' ');
    return { target: decodeMount(fields[4]), root: decodeMount(fields[3]), type: after[0], source: decodeMount(after[1]) };
  }).filter(m => m && (file === m.target || file.startsWith(m.target === '/' ? '/' : m.target + '/')))
    .sort((a, b) => b.target.length - a.target.length)[0] || null;
}
function mountIssue(mount, expectedSource) {
  if (!mount || !['cifs','smb3'].includes(mount.type)) return 'Kein SMB/CIFS-Dateisystem unter diesem Pfad. Backup gesperrt.';
  if (expectedSource && mount.source !== expectedSource) return 'SMB-Quelle stimmt nicht mit der bestätigten Freigabe überein. Backup gesperrt.';
  return '';
}

module.exports = { mountFor, mountIssue };
