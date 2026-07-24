// Reso Coach Companion — main process.
//
// Lifecycle:
//   1. App start → restore settings (dotaPath, autoStart)
//   2. Detect Dota path if missing
//   3. Start file-watcher on Dota replays folder (chokidar)
//   4. On new .dem detected → parser-runner → upload to app.reso.coach → log + IPC event

const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const Store = require('electron-store');
const { autoUpdater } = require('electron-updater');

const { startWatcher, stopWatcher } = require('./file-watcher');
const { parseReplay } = require('./parser-runner');
const { uploadToReso, RESO_DEFAULT_URL } = require('./uploader');
const { getDotaPath, getReplaysPath } = require('./dota-integration');

const store = new Store({
  defaults: {
    resoUrl: RESO_DEFAULT_URL,
    resoToken: '', // per-user upload token from the Steam device-link
    dotaPath: '',
    autoStart: true,
    totalUploads: 0,
    totalFailures: 0,
    lastUploadAt: null,
  },
});

let mainWindow = null;
let tray = null;
let isQuitting = false;

const stats = {
  uploadsToday: 0,
  totalUploads: store.get('totalUploads'),
  totalFailures: store.get('totalFailures'),
  lastUploadAt: store.get('lastUploadAt'),
  watcherActive: false,
};

const log = [];
function pushLog(level, message) {
  const entry = { ts: new Date().toISOString(), level, message };
  log.push(entry);
  if (log.length > 200) log.shift();
  console.log(`[${level}] ${message}`);
  emit('log', entry);
}

function emit(name, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app-event', { name, payload });
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 640,
    resizable: true,
    backgroundColor: '#262624',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Открыть', click: () => mainWindow && mainWindow.show() },
    { type: 'separator' },
    { label: `Загружено сегодня: ${stats.uploadsToday}`, enabled: false },
    { label: `Всего: ${stats.totalUploads}`, enabled: false },
    {
      label: `Watcher: ${stats.watcherActive ? 'on' : 'off'}`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Выход',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
}

function createTray() {
  const iconPath = path.join(__dirname, '..', 'assets', 'tray.png');
  if (!fs.existsSync(iconPath)) {
    tray = null;
    return;
  }
  // Resize explicitly — macOS renders oversized tray images at full size.
  const image = nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 });
  tray = new Tray(image);
  tray.setToolTip('Reso Coach Companion');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => mainWindow && mainWindow.show());
}

function refreshTray() {
  if (tray) tray.setContextMenu(buildTrayMenu());
}

// === Replay processing pipeline ===
async function processReplay(filePath, matchIdHint) {
  pushLog('info', `Парсинг ${path.basename(filePath)} (матч ${matchIdHint ?? '?'})`);
  emit('replay-detected', { filePath, matchId: matchIdHint });

  let parsed;
  try {
    const r = await parseReplay(filePath);
    parsed = r.parsed;
  } catch (e) {
    pushLog('error', `Парсинг не удался: ${e.message}`);
    stats.totalFailures++;
    store.set('totalFailures', stats.totalFailures);
    emit('parse-error', { filePath, error: e.message });
    return;
  }

  const resoToken = store.get('resoToken');
  if (!resoToken) {
    pushLog('warn', 'Аккаунт не связан — нажми «Войти через Steam», чтобы матчи попадали на reso.coach');
    return;
  }

  pushLog('info', `Распарсен матч ${parsed.id}; загружаю на reso.coach...`);
  try {
    await uploadToReso({ parsed, resoUrl: store.get('resoUrl'), resoToken });
    stats.uploadsToday++;
    stats.totalUploads++;
    stats.lastUploadAt = new Date().toISOString();
    store.set('totalUploads', stats.totalUploads);
    store.set('lastUploadAt', stats.lastUploadAt);
    refreshTray();
    pushLog('info', `reso.coach: матч ${parsed.id} загружен ✓`);
    emit('upload-success', { matchId: parsed.id, stats });
  } catch (e) {
    stats.totalFailures++;
    store.set('totalFailures', stats.totalFailures);
    pushLog('error', `Загрузка не удалась: ${e.message}`);
    emit('upload-error', { matchId: parsed.id, error: e.message });
  }
}

function onNewReplay(filePath, matchId) {
  // Fire and forget — the watcher chains; we don't want to block file-watcher.
  processReplay(filePath, matchId).catch((e) => {
    pushLog('error', `Pipeline crashed: ${e.message}`);
  });
}

// === IPC ===
ipcMain.handle('get-settings', () => ({
  resoLinked: !!store.get('resoToken'), // never expose the token itself
  dotaPath: store.get('dotaPath'),
  autoStart: store.get('autoStart'),
  stats,
  log: log.slice(-50),
}));

ipcMain.handle('save-settings', (_evt, s) => {
  if (s.dotaPath !== undefined) store.set('dotaPath', s.dotaPath);
  if (s.autoStart !== undefined) {
    store.set('autoStart', s.autoStart);
    app.setLoginItemSettings({ openAtLogin: !!s.autoStart });
  }
  // Restart watcher if dotaPath changed
  if (s.dotaPath !== undefined && s.dotaPath) {
    stopWatcher();
    const replaysPath = getReplaysPath(s.dotaPath);
    startWatcher(replaysPath, onNewReplay);
    stats.watcherActive = true;
    refreshTray();
  }
  return { ok: true };
});

ipcMain.handle('select-dota-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Выбери папку Dota 2 (содержит game/dota/...)',
  });
  if (result.canceled || result.filePaths.length === 0) return { ok: false };
  const dotaPath = result.filePaths[0];
  store.set('dotaPath', dotaPath);
  stopWatcher();
  startWatcher(getReplaysPath(dotaPath), onNewReplay);
  stats.watcherActive = true;
  refreshTray();
  return { ok: true, dotaPath };
});

// Steam device-link: spin up a one-shot loopback server, open the web's
// /link-device in the system browser, and capture the per-user upload token it
// redirects back with. The web hard-fixes the delivery host to 127.0.0.1, so the
// token only ever reaches this local server.
ipcMain.handle('steam-login', () => {
  const resoUrl = (store.get('resoUrl') || RESO_DEFAULT_URL).replace(/\/+$/, '');
  return new Promise((resolve) => {
    let settled = false;
    let server;
    let timer;
    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        if (server) server.close();
      } catch {
        /* already closing */
      }
      resolve(result);
    };
    server = http.createServer((req, res) => {
      let token = null;
      try {
        token = new URL(req.url, 'http://127.0.0.1').searchParams.get('token');
      } catch {
        /* malformed */
      }
      if (!token) {
        res.writeHead(404);
        res.end();
        return;
      }
      store.set('resoToken', token);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        '<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;background:#262624;color:#eceae4;text-align:center;padding-top:80px"><h2 style="color:#e06c4c">Готово ✓</h2><p>Аккаунт связан с reso.coach. Можешь закрыть вкладку.</p></body>',
      );
      pushLog('info', 'reso.coach: аккаунт связан (Steam)');
      emit('reso-linked', { linked: true });
      done({ ok: true });
    });
    server.on('error', (e) => done({ ok: false, error: e.message }));
    timer = setTimeout(() => done({ ok: false, error: 'timeout' }), 5 * 60 * 1000);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      pushLog('info', `reso.coach: открываю Steam-логин (loopback :${port})`);
      shell.openExternal(`${resoUrl}/link-device?port=${port}`);
    });
  });
});

ipcMain.handle('reso-unlink', () => {
  store.set('resoToken', '');
  emit('reso-linked', { linked: false });
  return { ok: true };
});

ipcMain.handle('get-stats', () => stats);

// Parse every .dem in the replays folder for the chosen period and upload
// (server upserts by match_id). Powers «Залить мои матчи».
//
// Sequential, not parallel — parser binary uses ~100MB RAM per spawn and
// network upload chains. Emits `reparse-progress` events so the UI can
// show "X / N done".
ipcMain.handle('reparse-folder', async (_evt, opts) => {
  const dotaPath = store.get('dotaPath');
  if (!dotaPath) return { ok: false, error: 'Папка Dota 2 не задана' };
  const replaysPath = getReplaysPath(dotaPath);
  if (!fs.existsSync(replaysPath)) {
    return { ok: false, error: `Папка реплеев не найдена: ${replaysPath}` };
  }

  // opts.days: undefined/null/0 = всё, иначе фильтр по mtime за последние N дней.
  // Дота не меняет mtime после записи реплея, поэтому это надёжный сигнал
  // даты матча (имена .dem могут не содержать ISO-даты).
  const days = Number(opts && opts.days) || 0;
  const cutoffMs = days > 0 ? Date.now() - days * 24 * 60 * 60 * 1000 : 0;

  const files = fs
    .readdirSync(replaysPath)
    .filter((f) => f.toLowerCase().endsWith('.dem'))
    .map((f) => path.join(replaysPath, f))
    .filter((fp) => {
      if (cutoffMs === 0) return true;
      try {
        return fs.statSync(fp).mtimeMs >= cutoffMs;
      } catch {
        return false;
      }
    });

  if (files.length === 0) {
    return { ok: true, total: 0, ok_count: 0, fail_count: 0 };
  }

  pushLog('info', `Заливка: ${files.length} .dem${days > 0 ? ` (за ${days} дн.)` : ''}`);
  let ok_count = 0;
  let fail_count = 0;
  for (let i = 0; i < files.length; i++) {
    const fp = files[i];
    emit('reparse-progress', { current: i + 1, total: files.length, file: path.basename(fp) });
    try {
      await processReplay(fp, null);
      ok_count++;
    } catch (e) {
      pushLog('error', `Не удалось обработать ${path.basename(fp)}: ${e.message}`);
      fail_count++;
    }
  }
  emit('reparse-progress', { current: files.length, total: files.length, done: true });
  return { ok: true, total: files.length, ok_count, fail_count };
});

// === Auto-updater ===
// Reads `publish` config from package.json (GitHub provider). On packaged
// builds, checks the repo's releases for a newer tag and downloads in the
// background. Renderer drives UI via `update-status` events; manual button
// triggers `check-for-updates`.
//
// Status lifecycle (state field): idle → checking → available → downloading
// → downloaded → (user clicks restart) → quitAndInstall.
// `not-available` and `error` are terminal until next manual check.
let updateState = { state: 'idle', version: null, progress: null, error: null };

function setUpdateState(patch) {
  updateState = { ...updateState, ...patch };
  emit('update-status', updateState);
}

if (app.isPackaged) {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = { info: (m) => pushLog('info', `update: ${m}`),
                         warn: (m) => pushLog('warn', `update: ${m}`),
                         error: (m) => pushLog('error', `update: ${m}`),
                         debug: () => {} };

  autoUpdater.on('checking-for-update', () => setUpdateState({ state: 'checking', error: null }));
  autoUpdater.on('update-available', (info) => setUpdateState({ state: 'available', version: info.version, error: null }));
  autoUpdater.on('update-not-available', (info) => setUpdateState({ state: 'not-available', version: info.version, error: null }));
  autoUpdater.on('download-progress', (p) => setUpdateState({ state: 'downloading', progress: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => setUpdateState({ state: 'downloaded', version: info.version, progress: 100 }));
  autoUpdater.on('error', (err) => setUpdateState({ state: 'error', error: err && err.message ? err.message : String(err) }));
}

ipcMain.handle('check-for-updates', async () => {
  if (!app.isPackaged) {
    return { ok: false, error: 'dev build — auto-update disabled' };
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    return { ok: true, version: result && result.updateInfo ? result.updateInfo.version : null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('quit-and-install', () => {
  if (!app.isPackaged) return { ok: false, error: 'dev build' };
  if (updateState.state !== 'downloaded') return { ok: false, error: 'no update ready' };
  // setImmediate so the IPC reply lands before the app shuts down
  setImmediate(() => autoUpdater.quitAndInstall());
  return { ok: true };
});

ipcMain.handle('get-update-status', () => updateState);

// === Lifecycle ===
//
// Enforce single instance — two copies would double-watch the replays folder
// and show two tray icons (common after auto-update or accidental double-launch).
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(() => {
  createWindow();
  createTray();

  // Auto-detect Dota path if not set
  let dotaPath = store.get('dotaPath');
  if (!dotaPath) {
    dotaPath = getDotaPath();
    if (dotaPath) {
      store.set('dotaPath', dotaPath);
      pushLog('info', `Dota 2 найдена: ${dotaPath}`);
    } else {
      pushLog('warn', 'Dota 2 не найдена. Укажи папку вручную в настройках.');
    }
  }

  if (dotaPath) {
    const replaysPath = getReplaysPath(dotaPath);
    startWatcher(replaysPath, onNewReplay);
    stats.watcherActive = true;
  }

  if (store.get('autoStart')) {
    app.setLoginItemSettings({ openAtLogin: true });
  }

  // Check for app updates in the background. Runs once on startup; user can
  // re-trigger from UI. Skipped in dev (autoUpdater throws "not packaged").
  if (app.isPackaged) {
    autoUpdater.checkForUpdates().catch((e) => pushLog('warn', `update check failed: ${e.message}`));
  }
});

app.on('window-all-closed', () => {
  // keep running in tray
});

app.on('before-quit', () => {
  isQuitting = true;
  stopWatcher();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
