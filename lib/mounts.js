'use strict';
function decodeMount(value) { return value.replace(/\\([0-7]{3})/g, (_, n) => String.fromCharCode(parseInt(n, 8))); }
function parseMounts(mountinfo) {
  return mountinfo.trim().split('\n').map(line => {
    const [left, right] = line.split(' - ');
    if (!right) return null;
    const fields = left.split(' '), after = right.split(' ');
    return { id: fields[0], device: fields[2], target: decodeMount(fields[4]), root: decodeMount(fields[3]), type: after[0], source: decodeMount(after[1]) };
  }).filter(Boolean);
}
function mountFor(file, mountinfo) {
  return parseMounts(mountinfo).filter(m => (file === m.target || file.startsWith(m.target === '/' ? '/' : m.target + '/')))
    .sort((a, b) => b.target.length - a.target.length)[0] || null;
}
function mountIssue(mount, expectedSource) {
  if (!mount || !['cifs','smb3','nfs','nfs4'].includes(mount.type)) return 'Kein SMB/CIFS- oder NFS-Dateisystem unter diesem Pfad. Backup gesperrt.';
  if (expectedSource && mount.source !== expectedSource) return 'Mount-Quelle stimmt nicht mit der bestätigten Freigabe überein. Backup gesperrt.';
  return '';
}

function mountIdentity(mount) { return JSON.stringify(['id','device','source','root','target','type'].map(key => mount?.[key] ?? null)); }
module.exports = { mountFor, mountIssue, parseMounts, mountIdentity };
