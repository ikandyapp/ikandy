// =============================================================
// WIRING SNIPPETS — apply to existing files. Do NOT replace files.
// =============================================================


// -------------------------------------------------------------
// 1) main.js  — register foobar IPC alongside VLC/Spotify
// -------------------------------------------------------------
// Add near your other IPC registrations:

const foobarIpc = require('./foobar/foobarIpc');

const foobar = foobarIpc.register({
  store,                  // your existing settings store (electron-store, etc.)
  sourceMutex,            // see #2 below — pass the same mutex VLC/Spotify use
});


// -------------------------------------------------------------
// 2) sourceMutex — extend existing source-switch logic
// -------------------------------------------------------------
// Wherever you currently stop "the other" source on switch, just add foobar.
// One async function, called by every source before it starts playing.
//
// Replace your current mutex with this (or merge into it):

async function sourceMutex(incoming) {
  // Stop everything that ISN'T the incoming source.
  const stops = [];
  if (incoming !== 'spotify') stops.push(safe(() => spotify.pause()));
  if (incoming !== 'vlc')     stops.push(safe(() => vlc.stop()));
  if (incoming !== 'foobar')  stops.push(safe(() => foobar.stop()));
  if (incoming !== 'local')   stops.push(safe(() => localPlayer?.stop?.()));
  await Promise.allSettled(stops);
}

function safe(fn) { try { return Promise.resolve(fn()); } catch { return Promise.resolve(); } }


// -------------------------------------------------------------
// 3) preload.js — expose foobar API behind contextBridge
// -------------------------------------------------------------
// Add to your existing exposeInMainWorld('ikandy', { ... }) object,
// alongside the vlc and spotify keys:

foobar: {
  setEndpoint: (host, port)   => ipcRenderer.invoke('foobar:setEndpoint', { host, port }),
  getEndpoint: ()             => ipcRenderer.invoke('foobar:getEndpoint'),
  isAvailable: ()             => ipcRenderer.invoke('foobar:isAvailable'),
  getState:    ()             => ipcRenderer.invoke('foobar:getState'),
  play:        ()             => ipcRenderer.invoke('foobar:play'),
  pause:       ()             => ipcRenderer.invoke('foobar:pause'),
  playPause:   ()             => ipcRenderer.invoke('foobar:playPause'),
  stop:        ()             => ipcRenderer.invoke('foobar:stop'),
  next:        ()             => ipcRenderer.invoke('foobar:next'),
  previous:    ()             => ipcRenderer.invoke('foobar:previous'),
  setVolume:   (v)            => ipcRenderer.invoke('foobar:setVolume', v),
  seek:        (s)            => ipcRenderer.invoke('foobar:seek', s),
},


// -------------------------------------------------------------
// 4) IPC allowlist — add the channels
// -------------------------------------------------------------
// Add these to your existing allowlist (same place vlc:* lives):

'foobar:setEndpoint',
'foobar:getEndpoint',
'foobar:isAvailable',
'foobar:getState',
'foobar:play',
'foobar:pause',
'foobar:playPause',
'foobar:stop',
'foobar:next',
'foobar:previous',
'foobar:setVolume',
'foobar:seek',


// -------------------------------------------------------------
// 5) Renderer — poll like VLC
// -------------------------------------------------------------
// Use the same polling cadence/loop you use for VLC. Example:
//
//   const state = await window.ikandy.foobar.getState();
//   updateNowPlaying(state); // title, artist, album, artworkUrl, position, duration
//
// Source button click handler:
//
//   await window.ikandy.foobar.play();   // mutex auto-stops other sources
