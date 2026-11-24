// Diagnostics report: the home folder never leaves the machine, the body keeps
// the site's names and limits, warn/error go out at most once per 10 minutes
// (the latest still arrives), and nothing is sent without a token.

const test = require('node:test');
const assert = require('node:assert/strict');

const { maskHome, buildReport, createReporter, sendReport, MAX_BODY_BYTES } = require('../src/report');

test('maskHome replaces the Mac home everywhere and leaves a longer name alone', () => {
  const home = '/Users/ivan';
  assert.equal(
    maskHome('Папка: /Users/ivan/Library/Steam · реплеи: /Users/ivan/x', home),
    'Папка: ~/Library/Steam · реплеи: ~/x',
  );
  assert.equal(maskHome('/Users/ivanov/Library', home), '/Users/ivanov/Library');
  assert.equal(maskHome('/Users/ivan', home), '~');
});

test('maskHome on Windows ignores case and the separator', () => {
  const home = 'C:\\Users\\Ivan';
  assert.equal(maskHome('c:\\users\\ivan\\Steam and C:/Users/Ivan/x', home), '~\\Steam and ~/x');
});

test('maskHome with an empty or short home leaves the text as is', () => {
  assert.equal(maskHome('/a/b', ''), '/a/b');
  assert.equal(maskHome('/a/b', '/'), '/a/b');
});

function sample(overrides = {}) {
  return {
    installId: '3f2b9c1e-0000-4000-8000-000000000001',
    reason: 'start',
    version: '0.1.18',
    platform: 'darwin',
    arch: 'arm64',
    osRelease: '23.6.0',
    dota: { path: null, replays: null },
    looked: [{ path: '/Users/ivan/Library/Application Support/Steam/steamapps/libraryfolders.vdf', exists: false, dota: false }],
    watcher: false,
    stats: { today: 0, total: 3, failures: 1, lastUploadAt: '2026-11-20T10:00:00.000Z' },
    log: [{ ts: '2026-11-24T10:00:00.000Z', level: 'warn', message: 'Папка /Users/ivan/Dota' }],
    ...overrides,
  };
}

test('buildReport keeps exactly the contract fields and masks every path', () => {
  const body = buildReport(sample({ dota: { path: '/Users/ivan/Steam/dota 2 beta', replays: 7 }, watcher: true }), '/Users/ivan');
  assert.deepEqual(Object.keys(body).sort(), [
    'arch', 'dota', 'installId', 'log', 'looked', 'osRelease', 'platform', 'reason', 'stats', 'version', 'watcher',
  ]);
  assert.deepEqual(body.dota, { found: true, path: '~/Steam/dota 2 beta', replays: 7 });
  assert.equal(body.looked[0].path, '~/Library/Application Support/Steam/steamapps/libraryfolders.vdf');
  assert.equal(body.log[0].message, 'Папка ~/Dota');
  assert.deepEqual(body.stats, { today: 0, total: 3, failures: 1, lastUploadAt: '2026-11-20T10:00:00.000Z' });
  assert.ok(!JSON.stringify(body).includes('/Users/ivan'));
});

test('buildReport: Dota not found → found false, path and replays null', () => {
  const body = buildReport(sample({ dota: { path: null, replays: 0 } }), '/Users/ivan');
  assert.deepEqual(body.dota, { found: false, path: null, replays: null });
});

test('buildReport cuts the log to 100 newest lines of ≤ 500 chars and looked to 20', () => {
  const log = Array.from({ length: 150 }, (_, i) => ({ ts: '2026-11-24T10:00:00.000Z', level: 'info', message: `${i} ${'x'.repeat(600)}` }));
  const looked = Array.from({ length: 30 }, (_, i) => ({ path: `/p/${i}`, exists: true, dota: false }));
  const body = buildReport(sample({ log, looked }), '/Users/ivan');
  assert.equal(body.log.length, 100);
  assert.ok(body.log[0].message.startsWith('50 '));
  assert.ok(body.log.every((e) => e.message.length <= 500));
  assert.equal(body.looked.length, 20);
});

test('the body stays under 64 KB even with 100 lines of 500 Cyrillic characters', () => {
  const log = Array.from({ length: 100 }, (_, i) => ({ ts: '2026-11-24T10:00:00.000Z', level: 'error', message: `${i} ${'ж'.repeat(600)}` }));
  const body = buildReport(sample({ log }), '/Users/ivan');
  assert.ok(Buffer.byteLength(JSON.stringify(body)) <= MAX_BODY_BYTES);
  assert.ok(Buffer.byteLength(JSON.stringify(body)) < 64 * 1024);
  assert.ok(body.log.length > 50);
  assert.ok(body.log.at(-1).message.startsWith('99 '), 'the newest line is kept');
  const ascii = buildReport(sample({ log: log.map((e) => ({ ...e, message: 'x'.repeat(500) })) }), '/Users/ivan');
  assert.equal(ascii.log.length, 100);
});

function fakeClock() {
  let t = 1_000_000;
  const timers = [];
  return {
    now: () => t,
    setTimer: (fn, ms) => { timers.push({ fn, at: t + ms }); return {}; },
    advance(ms) {
      t += ms;
      for (const tm of timers.splice(0)) {
        if (tm.at <= t) tm.fn();
        else timers.push(tm);
      }
    },
    timers,
  };
}

test('start and link go out at once; warn/error at most once per 10 minutes with one trailing send', () => {
  const clock = fakeClock();
  const sent = [];
  const r = createReporter({ send: (reason) => sent.push(reason), now: clock.now, setTimer: clock.setTimer });
  r.report('warn'); // before start: carried by the start report
  assert.deepEqual(sent, []);
  r.report('start');
  r.report('error');
  assert.deepEqual(sent, ['start', 'error']);
  clock.advance(60 * 1000);
  r.report('warn');
  r.report('error');
  r.report('warn');
  assert.deepEqual(sent, ['start', 'error'], 'inside the window nothing goes out yet');
  assert.equal(clock.timers.length, 1, 'one trailing send scheduled');
  r.report('link');
  assert.deepEqual(sent, ['start', 'error', 'link']);
  clock.advance(9 * 60 * 1000);
  assert.deepEqual(sent, ['start', 'error', 'link', 'error'], 'the trailing send carries the worst level');
  clock.advance(60 * 1000);
  r.report('warn');
  assert.deepEqual(sent, ['start', 'error', 'link', 'error'], 'a new window opened at the trailing send');
  clock.advance(10 * 60 * 1000);
  assert.deepEqual(sent, ['start', 'error', 'link', 'error', 'warn']);
});

test('a failing send never throws', async () => {
  const clock = fakeClock();
  const r = createReporter({
    send: (reason) => { if (reason === 'start') throw new Error('boom'); return Promise.reject(new Error('net')); },
    now: clock.now,
    setTimer: clock.setTimer,
  });
  assert.doesNotThrow(() => r.report('start'));
  assert.doesNotThrow(() => r.report('error'));
  await new Promise((res) => setImmediate(res));
});

test('sendReport without a token makes no request', async () => {
  let calls = 0;
  const out = await sendReport({ resoUrl: 'https://x.test', resoToken: '', body: {}, fetchImpl: () => { calls++; } });
  assert.equal(out, null);
  assert.equal(calls, 0);
});

test('sendReport posts the JSON with the token and never throws', async () => {
  const calls = [];
  const ok = await sendReport({
    resoUrl: 'https://x.test/',
    resoToken: 'tok',
    body: { a: 1 },
    fetchImpl: async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200 }; },
  });
  assert.deepEqual(ok, { ok: true, status: 200 });
  assert.equal(calls[0].url, 'https://x.test/api/companion/report');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.equal(calls[0].init.body, '{"a":1}');

  const bad = await sendReport({ resoToken: 'tok', body: {}, fetchImpl: async () => ({ ok: false, status: 503 }) });
  assert.deepEqual(bad, { ok: false, status: 503 });
  const down = await sendReport({ resoToken: 'tok', body: {}, fetchImpl: async () => { throw new Error('offline'); } });
  assert.deepEqual(down, { ok: false, status: 0 });
});
