// Diagnostics report: a linked companion sends its state and the tail of its
// log to the site (POST /api/companion/report), so a player's «it doesn't
// work» can be read without asking him for the log. Paths are sent with the
// home folder replaced by «~»; the token and replay contents never go out.

const os = require('node:os');
const { RESO_DEFAULT_URL } = require('./uploader');

const LOG_LINES = 100;
const MESSAGE_MAX = 500;
const PATH_MAX = 500;
const LOOKED_MAX = 20;
const MAX_BODY_BYTES = 64000; // the site refuses a body over 64 KB
const LEVELS = new Set(['info', 'warn', 'error']);

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Replace the home folder with «~» everywhere in a string. A Windows home
// matches in any case and with either separator.
function maskHome(text, home = os.homedir()) {
  if (typeof text !== 'string' || typeof home !== 'string') return text;
  const h = home.replace(/[\\/]+$/, '');
  if (h.length < 3) return text;
  const windows = /^[A-Za-z]:[\\/]/.test(h) || h.includes('\\');
  const body = windows
    ? h.split(/[\\/]+/).map(escapeRe).join('[\\\\/]+')
    : escapeRe(h);
  // Not followed by a name character: /Users/ivan must not eat /Users/ivanov.
  const re = new RegExp(`${body}(?![A-Za-z0-9_.-])`, windows ? 'gi' : 'g');
  return text.replace(re, '~');
}

function clip(value, max) {
  return String(value ?? '').slice(0, max);
}

function count(n) {
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

function isoOrNull(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// The report body exactly as the site validates it (names and limits).
function buildReport({ installId, reason, version, platform, arch, osRelease, dota, looked, watcher, stats, log }, home = os.homedir()) {
  const mask = (s) => maskHome(String(s ?? ''), home);
  const dotaPath = dota && dota.path ? clip(mask(dota.path), PATH_MAX) : null;
  const replays = dotaPath && Number.isInteger(dota.replays) && dota.replays >= 0 ? dota.replays : null;
  const body = {
    installId: String(installId),
    reason,
    version: clip(version, 32),
    platform: clip(platform, 16),
    arch: clip(arch, 16),
    osRelease: clip(osRelease, 64),
    dota: { found: !!dotaPath, path: dotaPath, replays },
    looked: (Array.isArray(looked) ? looked : []).slice(0, LOOKED_MAX).map((l) => ({
      path: clip(mask(l.path), PATH_MAX),
      exists: !!l.exists,
      dota: !!l.dota,
    })),
    watcher: !!watcher,
    stats: {
      today: count(stats && stats.today),
      total: count(stats && stats.total),
      failures: count(stats && stats.failures),
      lastUploadAt: isoOrNull(stats && stats.lastUploadAt),
    },
    log: (Array.isArray(log) ? log : []).slice(-LOG_LINES).map((e) => ({
      ts: isoOrNull(e.ts) || new Date(0).toISOString(),
      level: LEVELS.has(e.level) ? e.level : 'info',
      message: clip(mask(e.message), MESSAGE_MAX),
    })),
  };
  // Cyrillic is 2 bytes a character: 100 long lines can pass 64 KB, so the
  // oldest lines go first until the body fits.
  while (body.log.length && Buffer.byteLength(JSON.stringify(body)) > MAX_BODY_BYTES) body.log.shift();
  return body;
}

// 'start' and 'link' go out at once; 'warn'/'error' at most once per
// minGapMs, and one inside the window schedules a single send at its end so
// the latest error still arrives. Warn/error before 'start' are skipped: the
// start report carries them. Never throws, never logs through pushLog.
function createReporter({ send, now = Date.now, setTimer = setTimeout, minGapMs = 10 * 60 * 1000 }) {
  let started = false;
  let lastAt = null;
  let trailing = null; // the level the scheduled send will carry
  const fire = (reason) => {
    try {
      Promise.resolve(send(reason)).catch((e) => console.warn(`[report] ${reason} failed: ${e && e.message}`));
    } catch (e) {
      console.warn(`[report] ${reason} failed: ${e && e.message}`);
    }
  };
  function report(reason) {
    if (reason === 'start' || reason === 'link') {
      started = true;
      fire(reason);
      return;
    }
    if (reason !== 'warn' && reason !== 'error') return;
    if (!started) return;
    const t = now();
    if (lastAt === null || t - lastAt >= minGapMs) {
      lastAt = t;
      fire(reason);
      return;
    }
    if (trailing) {
      if (reason === 'error') trailing = 'error';
      return;
    }
    trailing = reason;
    const timer = setTimer(() => {
      const level = trailing;
      trailing = null;
      lastAt = now();
      fire(level);
    }, lastAt + minGapMs - t);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }
  return { report };
}

// POST the report. No token → null and no request. Never throws.
async function sendReport({ resoUrl, resoToken, body, fetchImpl = fetch }) {
  if (!resoToken) return null;
  const base = (resoUrl || RESO_DEFAULT_URL).replace(/\/+$/, '');
  try {
    const res = await fetchImpl(`${base}/api/companion/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resoToken}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) console.warn(`[report] HTTP ${res.status}`);
    return { ok: !!res.ok, status: res.status };
  } catch (e) {
    console.warn(`[report] send failed: ${e && e.message}`);
    return { ok: false, status: 0 };
  }
}

module.exports = { maskHome, buildReport, createReporter, sendReport, MAX_BODY_BYTES };
