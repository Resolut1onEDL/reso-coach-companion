// Dota 2 install path detection + replays folder resolution.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function commonDotaPaths(platform = process.platform, home = process.env.HOME || '') {
  if (platform === 'win32') {
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
  if (platform === 'darwin') {
    return [
      path.posix.join(home, 'Library/Application Support/Steam/steamapps/common/dota 2 beta'),
    ];
  }
  // linux
  return [
    path.posix.join(home, '.steam/steam/steamapps/common/dota 2 beta'),
    path.posix.join(home, '.local/share/Steam/steamapps/common/dota 2 beta'),
  ];
}

// Where Steam itself lives by default; its steamapps/libraryfolders.vdf lists
// every library folder (an external disk, a second drive), Dota can be in any.
function steamRoots(platform, home) {
  if (platform === 'win32') return ['C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam'];
  if (platform === 'darwin') return [path.posix.join(home, 'Library/Application Support/Steam')];
  return [
    path.posix.join(home, '.steam/steam'),
    path.posix.join(home, '.local/share/Steam'),
    path.posix.join(home, '.var/app/com.valvesoftware.Steam/.local/share/Steam'),
  ];
}

// Every `"path"  "<lib>"` entry of a libraryfolders.vdf, unescaped.
function libraryPaths(vdf) {
  const out = [];
  const re = /"path"\s+"((?:[^"\\]|\\.)*)"/gi;
  let m;
  while ((m = re.exec(vdf))) out.push(m[1].replace(/\\(.)/g, '$1'));
  return out;
}

// Search Dota in the fixed places and in every Steam library. Returns the
// first Dota root and every place checked (for the diagnostics report).
function findDota({
  platform = process.platform,
  home = os.homedir(),
  exists = fs.existsSync,
  readFile = fs.readFileSync,
} = {}) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const looked = [];
  const libraryDirs = [];
  for (const root of steamRoots(platform, home)) {
    const vdf = p.join(root, 'steamapps', 'libraryfolders.vdf');
    let found = false;
    try {
      found = !!exists(vdf);
      if (found) libraryDirs.push(...libraryPaths(String(readFile(vdf, 'utf8'))));
    } catch {
      /* unreadable vdf: the fixed places still get checked */
    }
    looked.push({ path: vdf, exists: found, dota: false });
  }
  const candidates = [
    ...commonDotaPaths(platform, home),
    ...libraryDirs.map((lib) => p.join(lib, 'steamapps', 'common', 'dota 2 beta')),
  ];
  const seen = new Set();
  let dotaPath = null;
  for (const c of candidates) {
    const key = platform === 'win32' ? c.toLowerCase().replace(/\//g, '\\') : c;
    if (!c || seen.has(key)) continue;
    seen.add(key);
    let there = false;
    let dota = false;
    try {
      there = !!exists(c);
      dota = there && !!exists(p.join(c, 'game', 'dota', 'gameinfo.gi'));
    } catch {
      /* treat as missing */
    }
    looked.push({ path: c, exists: there, dota });
    if (dota && !dotaPath) dotaPath = c;
  }
  return { path: dotaPath, looked };
}

function getDotaPath() {
  return findDota().path;
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

module.exports = { getDotaPath, findDota, getReplaysPath, isDotaRoot, resolveDotaPath };
