#!/usr/bin/env node
// Stage the replay-parser CLI binaries into ./bin/ for packaging.
//
// The parser SOURCE is private — only the compiled BINARIES are published, as
// assets on a GitHub release of Resolut1onEDL/dota-replay-parser (pinned by
// package.json `parserVersion`, e.g. "v4.3.1"). Two sources, in order:
//   1. a local ../dota-replay-parser/dist-release/ (dev machines with the parser
//      repo checked out — freshest build; also DOTA_PARSER_DIST), else
//   2. download the pinned release assets over https (CI / fresh clones).
//
// Runs on `npm install` (postinstall) and before `npm run build` (electron-
// builder needs all three platform binaries present at packaging time).
//
// SUPPLY-CHAIN RULE (learned the hard way): the local dist-release/ dir is
// used ONLY when DOTA_PARSER_DIST is set explicitly. The old "local dir
// first" default shipped stale v4.3.1 binaries inside a build pinned to
// v4.4.2 — Immortal players then fed 4.3.1 JSON into prod for a week. The
// pinned GitHub release is the only source that matches the pin by
// construction.

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');

const REPO = 'Resolut1onEDL/dota-replay-parser';
const FILES = ['parser-mac-arm64', 'parser-linux-x64', 'parser-win-x64.exe'];

const pkg = require(path.join(__dirname, '..', 'package.json'));
const version = pkg.parserVersion;
if (!version) {
  console.error('install-parser: package.json is missing `parserVersion` (e.g. "v4.3.1")');
  process.exit(1);
}

const binDir = path.join(__dirname, '..', 'bin');
// Local override is OPT-IN only (see supply-chain rule above).
const localDir = process.env.DOTA_PARSER_DIST || null;
fs.mkdirSync(binDir, { recursive: true });

function fetch(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'install-parser' } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return resolve(fetch(res.headers.location));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

async function stageOne(name) {
  const dest = path.join(binDir, name);
  if (localDir) {
    const local = path.join(localDir, name);
    if (!fs.existsSync(local)) {
      throw new Error(`DOTA_PARSER_DIST set but ${local} is missing`);
    }
    fs.copyFileSync(local, dest);
    fs.chmodSync(dest, 0o755);
    console.log(`install-parser: ${name} <- ${local} (DOTA_PARSER_DIST override)`);
    return;
  }
  const url = `https://github.com/${REPO}/releases/download/${version}/${name}`;
  process.stdout.write(`install-parser: ${name} ${version} (download) ... `);
  const buf = await fetch(url);
  fs.writeFileSync(dest, buf, { mode: 0o755 });
  console.log(`ok (${buf.length} bytes)`);
}

(async () => {
  try {
    await Promise.all(FILES.map(stageOne));
    console.log(`install-parser: parser pinned to ${version}`);
  } catch (e) {
    console.error('\ninstall-parser failed:', e.message);
    console.error(`Hint: ensure release ${version} exists at https://github.com/${REPO}/releases`);
    process.exit(1);
  }
})();
