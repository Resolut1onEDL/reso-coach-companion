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
