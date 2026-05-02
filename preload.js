/**
 * IKANDY - Preload Script
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('IKANDY', {
  // Auth
  startAuth:  ()     => ipcRenderer.invoke('start-auth'),
  logout:     ()     => ipcRenderer.invoke('logout'),
  isAuthed:   ()     => ipcRenderer.invoke('is-authed'),

  // BYOK - Client ID management
  getClientId:   ()    => ipcRenderer.invoke('get-client-id'),
  saveClientId:  (id)  => ipcRenderer.invoke('save-client-id', id),
  clearClientId: ()    => ipcRenderer.invoke('clear-client-id'),

  // Background folder
  pickImageFolder:  () => ipcRenderer.invoke('pick-image-folder'),

  // Custom preset folder
  pickPresetFolder: () => ipcRenderer.invoke('pick-preset-folder'),
  getPresetFolder:  () => ipcRenderer.invoke('get-preset-folder'),
  clearPresetFolder:() => ipcRenderer.invoke('clear-preset-folder'),

  // Preset thumbnail persistent cache
  loadAllThumbs: (names)         => ipcRenderer.invoke('preset-thumb-load-all', names),
  saveThumb:     (name, dataUrl) => ipcRenderer.invoke('preset-thumb-save', { name, dataUrl }),
  clearThumbs:   ()              => ipcRenderer.invoke('preset-thumb-clear'),

  // Broken-preset persistence (presets that crash butterchurn — never replay)
  loadBrokenPresets:  ()      => ipcRenderer.invoke('broken-presets-load'),
  addBrokenPreset:    (name)  => ipcRenderer.invoke('broken-presets-add', name),
  clearBrokenPresets: ()      => ipcRenderer.invoke('broken-presets-clear'),

  // Mood detection cache
  loadMoodCache: ()        => ipcRenderer.invoke('mood-cache-load'),
  saveMoodCache: (entries) => ipcRenderer.invoke('mood-cache-save', entries),

  // Playlists
  getPlaylists: ()     => ipcRenderer.invoke('get-playlists'),
  playPlaylist: (uri)  => ipcRenderer.invoke('play-playlist', uri),

  // Shuffle (routes to active source). Accepts a mode string per source.
  setShuffle:   (mode) => ipcRenderer.invoke('set-shuffle', mode),

  // Source mode
  getSource:    ()     => ipcRenderer.invoke('get-source'),
  setSource:    (mode) => ipcRenderer.invoke('set-source', mode),
  setVlcConfig: (cfg)  => ipcRenderer.invoke('set-vlc-config', cfg),
  vlcTest:      ()     => ipcRenderer.invoke('vlc-test'),
  vlcAction:    (cmd)  => ipcRenderer.invoke('vlc-action', cmd),
  setFoobarConfig: (cfg) => ipcRenderer.invoke('set-foobar-config', cfg),
  foobarTest:      ()    => ipcRenderer.invoke('foobar-test'),
  foobarAction:    (cmd) => ipcRenderer.invoke('foobar-action', cmd),
  // SMTC ("Now Playing" — Windows only)
  smtcAction:      (cmd) => {
    const payload = typeof cmd === 'string' ? { type: cmd } : cmd;
    return ipcRenderer.invoke('smtc-action', payload);
  },
  getFoobarPlaylists:       ()                      => ipcRenderer.invoke('get-foobar-playlists'),
  getFoobarPlaylistTracks:  (id)                    => ipcRenderer.invoke('get-foobar-playlist-tracks', id),
  playFoobarPlaylist:       (id)                    => ipcRenderer.invoke('play-foobar-playlist', id),
  playFoobarTrack:          (playlistId, index)     => ipcRenderer.invoke('play-foobar-track', { playlistId, index }),

  // Playback action - string or object
  action: (cmd) => {
    const payload = typeof cmd === 'string' ? { type: cmd } : cmd;
    return ipcRenderer.invoke('playback-action', payload);
  },

  // Push listeners from main — removeAllListeners prevents accumulation on re-register
  onAuthResult:   (cb) => { ipcRenderer.removeAllListeners('auth-result');   ipcRenderer.on('auth-result',   (_e, d) => cb(d)); },
  onSpotifyState: (cb) => { ipcRenderer.removeAllListeners('spotify-state'); ipcRenderer.on('spotify-state', (_e, d) => cb(d)); },
  onLyrics:       (cb) => { ipcRenderer.removeAllListeners('lyrics');        ipcRenderer.on('lyrics',        (_e, d) => cb(d)); },
  onUpdateStatus: (cb) => { ipcRenderer.removeAllListeners('update-status'); ipcRenderer.on('update-status', (_e, d) => cb(d)); },
  onUpdateAvailable: (cb) => { ipcRenderer.removeAllListeners('update-available'); ipcRenderer.on('update-available', (_e, d) => cb(d)); },
  openExternal:  (url) => ipcRenderer.invoke('open-external', url),
  installUpdate:  ()   => ipcRenderer.send('update-install'),

  platform:      process.platform,
  rendererReady: ()    => ipcRenderer.send('renderer-ready'),

  // Multi-monitor
  mmEnable:        ()     => ipcRenderer.invoke('mm-enable'),
  mmDisable:       ()     => ipcRenderer.invoke('mm-disable'),
  mmSetMode:       (mode) => ipcRenderer.invoke('mm-set-mode', mode),
  mmOpenDisplay:   (id)   => ipcRenderer.invoke('mm-open-display', id),
  mmCloseDisplay:  (id)   => ipcRenderer.invoke('mm-close-display', id),
  mmRespan:        (ids)  => ipcRenderer.invoke('mm-respan', ids),
  mmSetFit:        (mode) => ipcRenderer.invoke('mm-set-fit', mode),
  closeAllMirrors: ()     => ipcRenderer.invoke('close-all-mirrors'),
  sendMirrorAudio: (data) => ipcRenderer.send('mirror-audio', data),
  onMirrorClosed:  (cb)   => { ipcRenderer.removeAllListeners('mirror-closed');    ipcRenderer.on('mirror-closed',    (_e, id) => cb(id)); },
  onMirrorAudio:   (cb)   => { ipcRenderer.removeAllListeners('mirror-audio');     ipcRenderer.on('mirror-audio',     (_e, d)  => cb(d));  },
  onMirrorFit:     (cb)   => { ipcRenderer.removeAllListeners('mirror-fit');       ipcRenderer.on('mirror-fit',       (_e, m)  => cb(m));  },
  onMirrorSource:  (cb)   => { ipcRenderer.removeAllListeners('mirror-source');    ipcRenderer.on('mirror-source',    (_e, id) => cb(id)); },
  onMirrorError:   (cb)   => { ipcRenderer.removeAllListeners('mirror-error');     ipcRenderer.on('mirror-error',     (_e, d)  => cb(d));  },
  onMmStateChanged: (cb)  => { ipcRenderer.removeAllListeners('mm-state-changed');  ipcRenderer.on('mm-state-changed',  (_e, d) => cb(d)); },
  onMmDisplayAdded: (cb)  => { ipcRenderer.removeAllListeners('mm-display-added'); ipcRenderer.on('mm-display-added',  (_e, d) => cb(d)); },
  reportMirrorError:(label, msg) => ipcRenderer.send('mirror-error-report', { label, msg }),
});

console.log('[IKANDY Preload] Ready. Platform:', process.platform);
