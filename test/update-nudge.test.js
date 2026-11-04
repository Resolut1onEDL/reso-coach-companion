// Update nudge: a pending update is announced once when Dota starts (or when
// it turns up while Dota runs), never without Dota and never twice a session.

const test = require('node:test');
const assert = require('node:assert/strict');

const { nudgeText, dotaInOutput, createNudge } = require('../src/update-nudge');

function setup() {
  const shown = [];
  const nudge = createNudge({ notify: (v) => shown.push(v) });
  return { nudge, shown };
}

test('Dota starting with a downloaded update shows the notification once', () => {
  const { nudge, shown } = setup();
  nudge.onUpdate({ state: 'downloaded', version: '0.1.16' });
  assert.deepEqual(shown, []);
  assert.equal(nudge.onDota(true), true);
  assert.equal(nudge.onDota(true), false);
  assert.deepEqual(shown, ['0.1.16']);
});

test('an update found while Dota runs is announced right away, then not again', () => {
  const { nudge, shown } = setup();
  nudge.onDota(true);
  nudge.onUpdate({ state: 'available', version: '0.1.16' });
  nudge.onUpdate({ state: 'downloading', version: '0.1.16', progress: 40 });
  nudge.onUpdate({ state: 'downloaded', version: '0.1.16' });
  assert.deepEqual(shown, ['0.1.16']);
});

test('the next Dota session announces again; no update means no notification', () => {
  const { nudge, shown } = setup();
  nudge.onDota(true);
  assert.deepEqual(shown, []);
  nudge.onUpdate({ state: 'available', version: '0.1.16' });
  nudge.onDota(false);
  nudge.onDota(true);
  assert.deepEqual(shown, ['0.1.16', '0.1.16']);
  nudge.onDota(false);
  nudge.onUpdate({ state: 'not-available', version: '0.1.16' });
  nudge.onDota(true);
  assert.equal(shown.length, 2);
});

test('a failed check keeps the pending version', () => {
  const { nudge, shown } = setup();
  nudge.onUpdate({ state: 'available', version: '0.1.16' });
  nudge.onUpdate({ state: 'error', version: '0.1.16', error: 'net' });
  nudge.onDota(true);
  assert.deepEqual(shown, ['0.1.16']);
});

test('the Dota process is found in tasklist and pgrep output', () => {
  assert.equal(dotaInOutput('win32', '"dota2.exe","12345","Console","1","2 000 000 K"\r\n'), true);
  assert.equal(dotaInOutput('win32', 'INFO: No tasks are running which match the specified criteria.\r\n'), false);
  assert.equal(dotaInOutput('darwin', '4242\n'), true);
  assert.equal(dotaInOutput('darwin', ''), false);
  assert.equal(dotaInOutput('linux', undefined), false);
});

test('the copy is the founder\'s short version', () => {
  assert.deepEqual(nudgeText('0.1.16', 'win32'), {
    title: 'Обнови компаньон',
    body: 'Новый парсер, версия 0.1.16 — нажми, чтобы обновить.',
    action: 'Обновить',
  });
  assert.match(nudgeText('0.1.16', 'darwin').body, /чтобы скачать\.$/);
});
