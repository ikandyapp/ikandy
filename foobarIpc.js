// src/foobar/foobarIpc.js
// IPC bridge for FoobarController. Mirrors vlc:* channel naming.
// Register once from main.js: require('./foobar/foobarIpc').register({ ... })

'use strict';

const { ipcMain } = require('electron');
const { FoobarController } = require('./foobarController');

const foobar = new FoobarController();

function register({ store, sourceMutex }) {
  // ---- config ----
  // Persist host/port via your existing settings store (same pattern as VLC).
  const cfg = store?.get?.('foobar') || {};
  if (cfg.host || cfg.port) foobar.setEndpoint(cfg.host, cfg.port);

  ipcMain.handle('foobar:setEndpoint', (_e, { host, port }) => {
    foobar.setEndpoint(host, port);
    store?.set?.('foobar', { host: foobar.host, port: foobar.port });
    return { host: foobar.host, port: foobar.port };
  });

  ipcMain.handle('foobar:getEndpoint', () => ({ host: foobar.host, port: foobar.port }));

  // ---- health / state ----
  ipcMain.handle('foobar:isAvailable', () => foobar.isAvailable());
  ipcMain.handle('foobar:getState',    () => foobar.getState());

  // ---- transport ----
  ipcMain.handle('foobar:play',      async () => { await sourceMutex('foobar'); return foobar.play(); });
  ipcMain.handle('foobar:pause',     () => foobar.pause());
  ipcMain.handle('foobar:playPause', async () => { await sourceMutex('foobar'); return foobar.playPause(); });
  ipcMain.handle('foobar:stop',      () => foobar.stop());
  ipcMain.handle('foobar:next',      () => foobar.next());
  ipcMain.handle('foobar:previous',  () => foobar.previous());
  ipcMain.handle('foobar:setVolume', (_e, v)  => foobar.setVolume(v));
  ipcMain.handle('foobar:seek',      (_e, s)  => foobar.seek(s));

  return foobar; // expose for any internal callers (e.g. mutex)
}

module.exports = { register };
