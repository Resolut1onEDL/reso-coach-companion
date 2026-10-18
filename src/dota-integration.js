// Dota 2 install path detection + replays folder resolution.

const fs = require('node:fs');
const path = require('node:path');

function commonDotaPaths() {
  if (process.platform === 'win32') {
    return [
      'C:\\Program Files (x86)\\Steam\\steamapps\\common\\dota 2 beta',
      'C:\\Program Files\\Steam\\steamapps\\common\\dota 2 beta',
      'D:\\Steam\\steamapps\\common\\dota 2 beta',
      'D:\\SteamLibrary\\steamapps\\common\\dota 2 beta',
      'E:\\Steam\\steamapps\\common\\dota 2 beta',
      'E:\\SteamLibrary\\steamapps\\common\\dota 2 beta',
      'F:\\Steam\\steamapps\\common\\dota 2 beta',
      'F:\\SteamLibrary\\steamapps\\common\\dota 2 beta',
    ];
  }
  if (process.platform === 'darwin') {
    return [
      path.join(
        process.env.HOME || '',
        'Library/Application Support/Steam/steamapps/common/dota 2 beta',
      ),
    ];
  }
  // linux
  return [
    path.join(process.env.HOME || '', '.steam/steam/steamapps/common/dota 2 beta'),
    path.join(process.env.HOME || '', '.local/share/Steam/steamapps/common/dota 2 beta'),
  ];
}

function getDotaPath() {
  for (const p of commonDotaPaths()) {
    if (!p) continue;
    if (fs.existsSync(p) && fs.existsSync(path.join(p, 'game', 'dota', 'gameinfo.gi'))) {
      return p;
    }
  }
  return null;
}

function getReplaysPath(dotaPath) {
  return path.join(dotaPath, 'game', 'dota', 'replays');
}

function isDotaRoot(p) {
  return !!p && fs.existsSync(path.join(p, 'game', 'dota', 'gameinfo.gi'));
}

// A folder the user picked → the Dota install root («dota 2 beta»), or null.
// Accepts the root itself, a folder inside it (game, game/dota, the replays
// folder game/dota/replays) and a Steam library folder above it.
function resolveDotaPath(picked) {
  if (!picked) return null;
  const start = path.resolve(picked);
  let p = start;
  for (let i = 0; i < 4; i++) {
    if (isDotaRoot(p)) return p;
    const up = path.dirname(p);
    if (up === p) break;
    p = up;
  }
  for (const sub of [['dota 2 beta'], ['common', 'dota 2 beta'], ['steamapps', 'common', 'dota 2 beta']]) {
    const candidate = path.join(start, ...sub);
    if (isDotaRoot(candidate)) return candidate;
  }
  return null;
}

module.exports = { getDotaPath, getReplaysPath, isDotaRoot, resolveDotaPath };
