/**
 * iKandy - Preload Script
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ikandy', {
  // Auth
  startAuth:  ()     => ipcRenderer.invoke('start-auth'),
  logout:     ()     => ipcRenderer.invoke('logout'),
  isAuthed:   ()     => ipcRenderer.invoke('is-authed'),

  // BYOK - Client ID management
  getClientId:   ()    => ipcRenderer.invoke('get-client-id'),
  saveClientId:  (id)  => ipcRenderer.invoke('save-client-id', id),
  clearClientId: ()    => ipcRenderer.invoke('clear-client-id'),

  // Background folder
  pickImageFolder: () => ipcRenderer.invoke('pick-image-folder'),

  // Playlists
  getPlaylists: ()     => ipcRenderer.invoke('get-playlists'),
  playPlaylist: (uri)  => ipcRenderer.invoke('play-playlist', uri),

  // Source mode
  getSource:    ()     => ipcRenderer.invoke('get-source'),
  setSource:    (mode) => ipcRenderer.invoke('set-source', mode),
  setVlcConfig: (cfg)  => ipcRenderer.invoke('set-vlc-config', cfg),
  vlcTest:      ()     => ipcRenderer.invoke('vlc-test'),
  vlcAction:    (cmd)  => ipcRenderer.invoke('vlc-action', cmd),

  // Playback action - string or object
  action: (cmd) => {
    const payload = typeof cmd === 'string' ? { type: cmd } : cmd;
    return ipcRenderer.invoke('playback-action', payload);
  },

  // Push listeners from main
  onAuthResult:   (cb) => ipcRenderer.on('auth-result',   (_e, d) => cb(d)),
  onSpotifyState: (cb) => ipcRenderer.on('spotify-state', (_e, d) => cb(d)),
  onLyrics:       (cb) => ipcRenderer.on('lyrics',        (_e, d) => cb(d)),

  platform:      process.platform,
  rendererReady: ()    => ipcRenderer.send('renderer-ready'),
});

console.log('[iKandy Preload] Ready. Platform:', process.platform);
