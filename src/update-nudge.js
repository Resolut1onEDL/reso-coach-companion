// Update nudge: tell the player to update when he sits down to play.
//
// A player who never quits the tray app never got updates (install happened
// only on quit). Now, when Dota starts — or the download finishes while Dota
// runs — and a newer version is pending, main.js shows a system notification,
// once per Dota session.

const { execFile } = require('node:child_process');

const PENDING_STATES = new Set(['available', 'downloading', 'downloaded']);

function nudgeText(version, platform) {
  return {
    title: 'Обнови компаньон',
    body: `Новый парсер, версия ${version} — нажми, чтобы ${platform === 'darwin' ? 'скачать' : 'обновить'}.`,
    action: 'Обновить',
  };
}

function dotaProcessCommand(platform) {
  if (platform === 'win32') return ['tasklist', ['/FI', 'IMAGENAME eq dota2.exe', '/NH', '/FO', 'CSV']];
  return ['pgrep', ['-x', 'dota2']];
}

function dotaInOutput(platform, stdout) {
  if (platform === 'win32') return /^"dota2\.exe"/im.test(stdout || '');
  return /^\d+/m.test(stdout || '');
}

// pgrep exits 1 when nothing matches — that is "not running", not an error.
function isDotaRunning(platform = process.platform) {
  const [cmd, args] = dotaProcessCommand(platform);
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 10000 }, (_err, stdout) => {
      resolve(dotaInOutput(platform, stdout));
    });
  });
}

function createNudge({ notify }) {
  let dotaRunning = false;
  let notified = false;
  let pendingVersion = null;

  function maybeNotify() {
    if (dotaRunning && pendingVersion && !notified) {
      notified = true;
      notify(pendingVersion);
    }
  }

  return {
    // Returns true when Dota has just started.
    onDota(running) {
      const started = running && !dotaRunning;
      if (started) notified = false;
      dotaRunning = running;
      maybeNotify();
      return started;
    },
    onUpdate(state) {
      if (PENDING_STATES.has(state.state) && state.version) pendingVersion = state.version;
      else if (state.state === 'not-available') pendingVersion = null;
      maybeNotify();
    },
    get pendingVersion() { return pendingVersion; },
  };
}

module.exports = { nudgeText, dotaProcessCommand, dotaInOutput, isDotaRunning, createNudge, PENDING_STATES };
