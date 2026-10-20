'use strict';
const crypto = require('node:crypto');
function createAuth({ getConfig, password: PASS, json }) {
  const expectedPassword = crypto.createHash('sha256').update(PASS).digest();
  const sessions = new Map(), attempts = new Map();
  const SESSION_MS = 12 * 60 * 60 * 1000;
  function sessionToken(req) {
    return (req.headers.cookie || '').split(';').map(c => c.trim()).find(c => c.startsWith('qnap_session='))?.slice(13);
  }
  function authorized(req) {
    if (!getConfig().authEnabled) return true;
    const token = sessionToken(req), expires = sessions.get(token);
    if (!expires || expires <= Date.now()) { if (token) sessions.delete(token); return false; }
    return true;
  }
  function cookie(req, token, age) {
    return `qnap_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${req.socket.encrypted || process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`;
  }
  function login(req, res, input) {
    if (!getConfig().authEnabled) return json(res, 200, { success: true });
    const now = Date.now(), ip = req.socket.remoteAddress;
    for (const [key, entry] of attempts) if (entry.until <= now) attempts.delete(key);
    for (const [key, expires] of sessions) if (expires <= now) sessions.delete(key);
    const attempt = attempts.get(ip) || { count: 0, until: now + 60000 };
    if (attempt.count >= 10) return json(res, 429, { error: 'Zu viele Versuche. Bitte in einer Minute erneut versuchen.' });
    if (typeof input.password !== 'string' || !crypto.timingSafeEqual(expectedPassword, crypto.createHash('sha256').update(input.password).digest())) {
      attempt.count++; if (attempts.size < 1000 || attempts.has(ip)) attempts.set(ip, attempt);
      return json(res, 401, { error: 'Das Passwort stimmt nicht.' });
    }
    attempts.delete(ip);
    if (sessions.size >= 1000) sessions.delete(sessions.keys().next().value);
    const token = crypto.randomBytes(32).toString('hex'); sessions.set(token, now + SESSION_MS);
    res.setHeader('Set-Cookie', cookie(req, token, SESSION_MS / 1000));
    return json(res, 200, { success: true });

  }
  function reset(req, res, enabled) { sessions.clear(); if (enabled) { const token = crypto.randomBytes(32).toString('hex'); sessions.set(token, Date.now() + SESSION_MS); res.setHeader('Set-Cookie', cookie(req, token, SESSION_MS / 1000)); } else res.setHeader('Set-Cookie', cookie(req, '', 0)); }
  function logout(req,res) { sessions.delete(sessionToken(req)); res.setHeader('Set-Cookie', cookie(req,'',0)); }
  return { authorized, login, reset, logout };

}
module.exports = { createAuth };
