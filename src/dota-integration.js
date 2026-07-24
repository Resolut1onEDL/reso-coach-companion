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

module.exports = { getDotaPath, getReplaysPath };
