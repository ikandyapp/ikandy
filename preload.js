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

  // Playlists
  getPlaylists: ()     => ipcRenderer.invoke('get-playlists'),
  playPlaylist: (uri)  => ipcRenderer.invoke('play-playlist', uri),

  // Source mode
  getSource:    ()     => ipcRenderer.invoke('get-source'),
  setSource:    (mode) => ipcRenderer.invoke('set-source', mode),
  setVlcConfig: (cfg)  => ipcRenderer.invoke('set-vlc-config', cfg),
  vlcTest:      ()     => ipcRenderer.invoke('vlc-test'),
  vlcAction:    (cmd)  => ipcRenderer.invoke('vlc-action', cmd),
  setFoobarConfig: (cfg) => ipcRenderer.invoke('set-foobar-config', cfg),
  foobarTest:      ()    => ipcRenderer.invoke('foobar-test'),
  foobarAction:    (cmd) => ipcRenderer.invoke('foobar-action', cmd),
  getFoobarPlaylists: () => ipcRenderer.invoke('get-foobar-playlists'),
  playFoobarPlaylist: (id) => ipcRenderer.invoke('play-foobar-playlist', id),

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
  installUpdate:  ()   => ipcRenderer.send('update-install'),

  platform:      process.platform,
  rendererReady: ()    => ipcRenderer.send('renderer-ready'),
});

console.log('[IKANDY Preload] Ready. Platform:', process.platform);
