// Folder picking: whatever folder the user points at — the Dota root, the
// replays folder inside it or the Steam library above it — resolves to the
// Dota root, and an unrelated folder resolves to nothing.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { resolveDotaPath, isDotaRoot, getReplaysPath } = require('../src/dota-integration');

function makeSteamLibrary() {
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'steam-'));
  const root = path.join(lib, 'steamapps', 'common', 'dota 2 beta');
  fs.mkdirSync(path.join(root, 'game', 'dota', 'replays'), { recursive: true });
  fs.writeFileSync(path.join(root, 'game', 'dota', 'gameinfo.gi'), '');
  return { lib, root };
}

test('the Dota root resolves to itself', () => {
  const { root } = makeSteamLibrary();
  assert.equal(resolveDotaPath(root), root);
  assert.ok(isDotaRoot(root));
});

test('the replays folder and the folders above it resolve to the root', () => {
  const { root } = makeSteamLibrary();
  assert.equal(resolveDotaPath(getReplaysPath(root)), root);
  assert.equal(resolveDotaPath(path.join(root, 'game', 'dota')), root);
  assert.equal(resolveDotaPath(path.join(root, 'game')), root);
});

test('a Steam library folder resolves to the root inside it', () => {
  const { lib, root } = makeSteamLibrary();
  assert.equal(resolveDotaPath(lib), root);
  assert.equal(resolveDotaPath(path.join(lib, 'steamapps')), root);
  assert.equal(resolveDotaPath(path.join(lib, 'steamapps', 'common')), root);
});

test('a folder without Dota resolves to null and nothing is created in it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'not-dota-'));
  assert.equal(resolveDotaPath(dir), null);
  assert.equal(resolveDotaPath(''), null);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('the empty game/dota/replays an old version created inside the replays folder does not fool it', () => {
  const { root } = makeSteamLibrary();
  const replays = getReplaysPath(root);
  fs.mkdirSync(path.join(replays, 'game', 'dota', 'replays'), { recursive: true });
  assert.equal(isDotaRoot(replays), false);
  assert.equal(resolveDotaPath(replays), root);
});

// Steam libraries: findDota reads libraryfolders.vdf and looks for «dota 2
// beta» in every library, on a fake file system.
const { findDota } = require('../src/dota-integration');

function fakeFs(files) {
  const set = new Set(Object.keys(files));
  const dirs = new Set();
  for (const f of set) {
    for (let p = f; ; ) {
      const up = p.replace(/[\\/][^\\/]*$/, '');
      if (up === p || !up) break;
      dirs.add(up);
      p = up;
    }
  }
  return {
    exists: (p) => set.has(p) || dirs.has(p),
    readFile: (p) => {
      if (!(p in files)) throw new Error('ENOENT');
      return files[p];
    },
  };
}

const MAC_STEAM = '/Users/ivan/Library/Application Support/Steam';

test('Mac: Dota on an external volume listed in libraryfolders.vdf is found', () => {
  const vdf = `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${MAC_STEAM}"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"/Volumes/SSD/SteamLibrary"\n\t\t"apps"\n\t\t{\n\t\t\t"570"\t\t"40000000000"\n\t\t}\n\t}\n}\n`;
  const fsx = fakeFs({
    [`${MAC_STEAM}/steamapps/libraryfolders.vdf`]: vdf,
    '/Volumes/SSD/SteamLibrary/steamapps/common/dota 2 beta/game/dota/gameinfo.gi': '',
  });
  const r = findDota({ platform: 'darwin', home: '/Users/ivan', ...fsx });
  assert.equal(r.path, '/Volumes/SSD/SteamLibrary/steamapps/common/dota 2 beta');
  assert.deepEqual(r.looked, [
    { path: `${MAC_STEAM}/steamapps/libraryfolders.vdf`, exists: true, dota: false },
    { path: `${MAC_STEAM}/steamapps/common/dota 2 beta`, exists: false, dota: false },
    { path: '/Volumes/SSD/SteamLibrary/steamapps/common/dota 2 beta', exists: true, dota: true },
  ]);
});

test('Windows: a D:\\SteamLibrary entry (escaped backslashes) is found', () => {
  const vdf = '"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"D:\\\\Games\\\\SteamLibrary"\n\t}\n}\n';
  const fsx = fakeFs({
    'C:\\Program Files (x86)\\Steam\\steamapps\\libraryfolders.vdf': vdf,
    'D:\\Games\\SteamLibrary\\steamapps\\common\\dota 2 beta\\game\\dota\\gameinfo.gi': '',
  });
  const r = findDota({ platform: 'win32', home: 'C:\\Users\\Ivan', ...fsx });
  assert.equal(r.path, 'D:\\Games\\SteamLibrary\\steamapps\\common\\dota 2 beta');
  const paths = r.looked.map((l) => l.path);
  assert.equal(
    paths.filter((p) => p.toLowerCase() === 'c:\\program files (x86)\\steam\\steamapps\\common\\dota 2 beta').length,
    1,
    'the default library listed in the vdf is checked once',
  );
  assert.ok(r.looked.length <= 20);
});

test('a missing libraryfolders.vdf still checks the fixed places and finds nothing', () => {
  const r = findDota({ platform: 'darwin', home: '/Users/ivan', ...fakeFs({}) });
  assert.equal(r.path, null);
  assert.deepEqual(r.looked, [
    { path: `${MAC_STEAM}/steamapps/libraryfolders.vdf`, exists: false, dota: false },
    { path: `${MAC_STEAM}/steamapps/common/dota 2 beta`, exists: false, dota: false },
  ]);
});

test('a library without Dota is listed as checked, not found', () => {
  const vdf = `"libraryfolders" { "0" { "path" "${MAC_STEAM}" } "1" { "path" "/Volumes/Games" } }`;
  const fsx = fakeFs({
    [`${MAC_STEAM}/steamapps/libraryfolders.vdf`]: vdf,
    '/Volumes/Games/steamapps/common/Counter-Strike Global Offensive/csgo.exe': '',
  });
  const r = findDota({ platform: 'darwin', home: '/Users/ivan', ...fsx });
  assert.equal(r.path, null);
  assert.deepEqual(r.looked.at(-1), { path: '/Volumes/Games/steamapps/common/dota 2 beta', exists: false, dota: false });
});

test('Linux: libraries of the Flatpak Steam are read too', () => {
  const root = '/home/ivan/.var/app/com.valvesoftware.Steam/.local/share/Steam';
  const fsx = fakeFs({
    [`${root}/steamapps/libraryfolders.vdf`]: '"libraryfolders" { "0" { "path" "/mnt/games" } }',
    '/mnt/games/steamapps/common/dota 2 beta/game/dota/gameinfo.gi': '',
  });
  const r = findDota({ platform: 'linux', home: '/home/ivan', ...fsx });
  assert.equal(r.path, '/mnt/games/steamapps/common/dota 2 beta');
});
