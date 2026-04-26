/**
 * IKANDY — Electron Main Process v13
 *
 * Architecture: ALL Spotify communication happens in main process (Node.js).
 * The renderer (HTML) only receives track data via IPC — zero auth code there.
 *
 * Auth:   PKCE flow, token encrypted via safeStorage (OS keychain) in userData.
 *         Refresh token auto-renews the session — login once, done forever.
 * Data:   main.js polls GET /me/player/currently-playing every 10s via Node https.
 *         Sends { title, artist, album, art, progress, duration, trackId } to renderer.
 * Lyrics: main.js fetches LRCLIB for synced lyrics, sends to renderer.
 * Audio:  Renderer captures system audio via getDisplayMedia for visual reactivity.
 */

const { app, BrowserWindow, ipcMain, session, shell, desktopCapturer, dialog, safeStorage, globalShortcut } = require('electron');
const { autoUpdater } = require('electron-updater');
const http  = require('http');
const https = require('https');
const path  = require('path');
const fs    = require('fs');

// ── Config ────────────────────────────────────────────────────────────────────
const CLIENT_ID_FILE = () => path.join(app.getPath("userData"), "IKANDY-client-id.txt");
function getClientId() { try { return fs.readFileSync(CLIENT_ID_FILE(), "utf8").trim(); } catch(e) { return ""; } }
const CALLBACK_PORT = 8888;
const REDIRECT_URI  = `http://127.0.0.1:${CALLBACK_PORT}/callback`;
const SCOPES        = 'user-read-currently-playing user-read-playback-state user-modify-playback-state user-read-private streaming playlist-read-private playlist-read-collaborative';
const TOKEN_FILE    = () => path.join(app.getPath('userData'), 'IKANDY-tokens.json');
const POLL_INTERVAL = 5000;  // 5 seconds — snappy track detection, 12 calls/min (6.7% of rate limit)
const VOL_INTERVAL  = 8000;  // 8 seconds — catches external volume changes quickly
let   volPollTimer  = null;
let   lastVolume    = null;

// ── State ─────────────────────────────────────────────────────────────────────
let mainWindow   = null;
let authServer   = null;
let pollTimer    = null;
let tokens       = {};        // { access_token, refresh_token, expires_at }
let lastTrackId     = null;
let lastKnownPlaying = false;   // cached play state for playpause without extra GET
let isRateLimited   = false;

// ── Source mode ───────────────────────────────────────────────────────────────
let sourceMode   = 'spotify';
let vlcPort      = 8080;
let vlcPassword  = '';
const SOURCE_FILE = () => path.join(app.getPath('userData'), 'IKANDY-source.json');
function loadSource() {
  try {
    const s = JSON.parse(fs.readFileSync(SOURCE_FILE(), 'utf8'));
    sourceMode  = s.mode        || 'spotify';
    vlcPort     = s.vlcPort     || 8080;
    vlcPassword = s.vlcPassword || '';
  } catch(e) {}
}
function saveSource() {
  try { fs.writeFileSync(SOURCE_FILE(), JSON.stringify({ mode: sourceMode, vlcPort, vlcPassword })); } catch(e) {}
}
function loadTokens() {
  try {
    const raw = fs.readFileSync(TOKEN_FILE());
    // Try encrypted first (safeStorage), fall back to plaintext for migration
    if (safeStorage.isEncryptionAvailable()) {
      try {
        const decrypted = safeStorage.decryptString(raw);
        tokens = JSON.parse(decrypted);
        console.log('[IKANDY] Loaded encrypted tokens, expires:', tokens.expires_at ? new Date(tokens.expires_at).toISOString() : 'unknown');
        return tokens;
      } catch(e) {
        // Might be legacy plaintext — try that
        try {
          tokens = JSON.parse(raw.toString('utf8'));
          // Re-save as encrypted
          saveTokens(tokens);
          console.log('[IKANDY] Migrated plaintext tokens to encrypted storage');
          return tokens;
        } catch(e2) { tokens = {}; }
      }
    } else {
      // Encryption unavailable — fall back to plaintext
      tokens = JSON.parse(raw.toString('utf8'));
      console.log('[IKANDY] Loaded tokens (encryption unavailable), expires:', tokens.expires_at ? new Date(tokens.expires_at).toISOString() : 'unknown');
    }
  }
  catch(e) { tokens = {}; }
  return tokens;
}
function saveTokens(t) {
  tokens = t;
  try {
    const data = JSON.stringify(t, null, 2);
    if (safeStorage.isEncryptionAvailable()) {
      fs.writeFileSync(TOKEN_FILE(), safeStorage.encryptString(data));
    } else {
      fs.writeFileSync(TOKEN_FILE(), data);
    }
  }
  catch(e) { console.error('[IKANDY] Could not save tokens:', e.message); }
}
function clearTokens() {
  tokens = {};
  try { fs.unlinkSync(TOKEN_FILE()); } catch(e) {}
}

// ── Node https helper ─────────────────────────────────────────────────────────
function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(3000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function httpsRequest(method, url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(url);
    const bodyStr = typeof body === 'string' ? body : '';
    const options = {
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method,
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        ...headers,
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(bodyStr);
    req.end();
  });
}

function httpsPost(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(url);
    const bodyStr = typeof body === 'string' ? body : body.toString();
    const options = {
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method:   'POST',
      headers:  { 'Content-Type': 'application/x-www-form-urlencoded',
                  'Content-Length': Buffer.byteLength(bodyStr), ...headers },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(bodyStr);
    req.end();
  });
}

// ── Token refresh ─────────────────────────────────────────────────────────────
async function refreshAccessToken() {
  if (!tokens.refresh_token) return false;
  try {
    const body = new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id:     getClientId(),
    });
    const res  = await httpsPost('https://accounts.spotify.com/api/token', body);
    const data = JSON.parse(res.body);
    if (!data.access_token) return false;
    saveTokens({
      access_token:  data.access_token,
      refresh_token: data.refresh_token || tokens.refresh_token,
      expires_at:    Date.now() + data.expires_in * 1000,
    });
    console.log('[IKANDY] Token refreshed, expires in', data.expires_in, 's');
    return true;
  } catch(e) {
    console.error('[IKANDY] Token refresh failed:', e.message);
    return false;
  }
}

async function ensureValidToken() {
  if (!tokens.access_token) return false;
  if (tokens.expires_at && Date.now() > tokens.expires_at - 60000) {
    return await refreshAccessToken();
  }
  return true;
}

// ── Spotify polling (runs in main process — no rate limit visibility in renderer)
async function pollCurrentTrack() {
  if (isRateLimited) return;
  const valid = await ensureValidToken();
  if (!valid) {
    mainWindow?.webContents.send('spotify-state', { type: 'not-authed' });
    return;
  }
  try {
    const res = await httpsGet(
      'https://api.spotify.com/v1/me/player/currently-playing',
      { Authorization: 'Bearer ' + tokens.access_token }
    );

    if (res.status === 204) {
      mainWindow?.webContents.send('spotify-state', { type: 'idle' });
      return;
    }
    if (res.status === 401) {
      await refreshAccessToken();
      return;
    }
    if (res.status === 403) {
      console.error('[IKANDY] 403 on currently-playing — check User Management in Spotify Dashboard');
      mainWindow?.webContents.send('spotify-state', { type: 'error', message: '403 — check Spotify Dashboard User Management' });
      return;
    }
    if (res.status === 429) {
      const wait = parseInt(res.headers['retry-after'] || '120') * 1000;
      const resumeAt = Date.now() + wait;
      console.warn('[IKANDY] 429 rate limited — pausing', Math.round(wait/1000), 's until', new Date(resumeAt).toLocaleTimeString());
      isRateLimited = true;
      clearInterval(pollTimer); pollTimer = null;
      // Save resume time so restarts don't immediately re-hit the limit
      try { fs.writeFileSync(path.join(app.getPath('userData'), 'IKANDY-ratelimit.json'), JSON.stringify({ resumeAt })); } catch(e) {}
      mainWindow?.webContents.send('spotify-state', { type: 'error', message: `Rate limited — resuming at ${new Date(resumeAt).toLocaleTimeString()}` });
      setTimeout(() => {
        isRateLimited = false;
        try { fs.unlinkSync(path.join(app.getPath('userData'), 'IKANDY-ratelimit.json')); } catch(e) {}
        pollTimer = setInterval(pollCurrentTrack, POLL_INTERVAL);
        pollCurrentTrack();
        console.log('[IKANDY] Rate limit cleared — polling resumed');
      }, wait);
      return;
    }

    const data = JSON.parse(res.body);
    if (!data?.item) { console.warn('[IKANDY] Poll: 200 but no item in response'); return; }

    // Compensate for network latency — progress_ms is from when Spotify
    // captured it, not when we receive it. Add ~200ms for typical latency.
    const latencyMs = 200;
    const track = {
      type:      'track',
      id:        data.item.id,
      title:     data.item.name,
      artist:    (data.item.artists || []).map(a => a.name).join(', '),
      album:     data.item.album?.name || '',
      art:       data.item.album?.images?.[0]?.url || '',
      progress:  (data.progress_ms || 0) + (data.is_playing ? latencyMs : 0),
      duration:  data.item.duration_ms || 0,
      playing:   data.is_playing,
      timestamp: Date.now(),
    };

    lastKnownPlaying = track.playing;
    mainWindow?.webContents.send('spotify-state', track);

    // Fetch lyrics when track changes
    if (track.id !== lastTrackId) {
      lastTrackId = track.id;
      fetchLyrics(track.title, track.artist);
    }
  } catch(e) {
    console.warn('[IKANDY] Poll error:', e.message);
  }
}

// ── Lyrics fetch (LRCLIB → lyrics.ovh fallback) ───────────────────────────────
async function fetchLyrics(title, artist) {
  console.log('[IKANDY] Fetching lyrics for:', title, '—', artist);
  const cleanArtist = artist.split(/[,&]/)[0].trim();
  const cleanTitle  = title.replace(/\s*[\(\[].*[\)\]]/g, '').trim();

  // Helper: fetch one LRCLIB url and extract lyrics payload
  // Validates returned track name matches what we asked for (prevents false positives)
  async function tryLrclib(url, validateTitle) {
    try {
      const res = await httpsGet(url);
      if (res.status !== 200) return null;
      let data = JSON.parse(res.body);
      if (Array.isArray(data)) data = data[0];
      if (!data) return null;
      // Validate track name matches if we have one to check against
      if (validateTitle && data.trackName) {
        const returned = data.trackName.toLowerCase().trim();
        const expected = validateTitle.toLowerCase().trim();
        // Allow if returned name contains expected or vice versa (handles subtitles etc)
        if (!returned.includes(expected) && !expected.includes(returned)) return null;
      }
      if (data.syncedLyrics) return { type: 'synced', raw: data.syncedLyrics, name: data.trackName };
      if (data.plainLyrics)  return { type: 'plain',  raw: data.plainLyrics };
      return null;
    } catch(e) { return null; }
  }

  // Fire all LRCLIB strategies IN PARALLEL — take fastest winner that has synced lyrics,
  // fall back to plain if no synced found, all in one round-trip time
  const base = 'https://lrclib.net/api';
  const [r1, r2, r3] = await Promise.all([
    tryLrclib(`${base}/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}`, cleanTitle),
    tryLrclib(`${base}/search?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}`, cleanTitle),
    tryLrclib(`${base}/get?artist_name=${encodeURIComponent(cleanArtist)}&track_name=${encodeURIComponent(cleanTitle)}`, cleanTitle),
  ]);

  // Prefer synced over plain, prefer earlier strategies
  const results = [r1, r2, r3].filter(Boolean);
  const synced  = results.find(r => r.type === 'synced');
  const plain   = results.find(r => r.type === 'plain');
  const winner  = synced || plain;

  if (winner) {
    console.log('[IKANDY] Lyrics:', winner.type, 'from LRCLIB', winner.name || '');
    mainWindow?.webContents.send('lyrics', winner);
    return;
  }

  // Fallback: lyrics.ovh (only if LRCLIB completely missed)
  try {
    const res = await httpsGet(`https://api.lyrics.ovh/v1/${encodeURIComponent(cleanArtist)}/${encodeURIComponent(title)}`);
    if (res.status === 200) {
      const data = JSON.parse(res.body);
      if (data.lyrics) {
        console.log('[IKANDY] Lyrics: plain from lyrics.ovh');
        mainWindow?.webContents.send('lyrics', { type: 'plain', raw: data.lyrics });
        return;
      }
    }
  } catch(e) {}

  console.log('[IKANDY] Lyrics: not found for', title);
  mainWindow?.webContents.send('lyrics', { type: 'none' });
}

// ── OAuth local server ────────────────────────────────────────────────────────
function startAuthServer(pkceVerifier) {
  if (authServer) { authServer.close(); authServer = null; }

  authServer = http.createServer(async (req, res) => {
    const actualPort = authServer?.address()?.port || CALLBACK_PORT;
    const url   = new URL(req.url, `http://127.0.0.1:${actualPort}`);
    if (url.pathname !== '/callback') { res.writeHead(404); res.end(); return; }

    const code  = url.searchParams.get('code');
    const error = url.searchParams.get('error');

    // Send nice response to browser
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html><html><head><title>IKANDY</title><style>
      body{background:#060608;color:#b89a5a;font-family:sans-serif;display:flex;
      align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:12px;}
      h1{font-size:40px;letter-spacing:.22em;}p{color:#444;font-size:13px;}
    </style></head><body><h1>IKANDY ✓</h1>
    <p>Connected! You can close this tab.</p>
    <script>setTimeout(()=>window.close(),1500);</script></body></html>`);

    authServer.close(); authServer = null;

    if (error || !code) {
      console.error('[IKANDY] Auth error:', error);
      mainWindow?.webContents.send('auth-result', { success: false, error });
      return;
    }

    // Exchange code for tokens — in main process
    try {
      const body = new URLSearchParams({
        client_id:     getClientId(),
        grant_type:    'authorization_code',
        code,
        redirect_uri:  authServer?._actualPort && authServer._actualPort !== CALLBACK_PORT
          ? `http://127.0.0.1:${authServer._actualPort}/callback`
          : REDIRECT_URI,
        code_verifier: pkceVerifier,
      });
      const r    = await httpsPost('https://accounts.spotify.com/api/token', body);
      const data = JSON.parse(r.body);

      console.log('[IKANDY] Token exchange status:', r.status);

      if (data.error) {
        mainWindow?.webContents.send('auth-result', { success: false, error: data.error_description || data.error });
        return;
      }

      saveTokens({
        access_token:  data.access_token,
        refresh_token: data.refresh_token,
        expires_at:    Date.now() + data.expires_in * 1000,
      });

      console.log('[IKANDY] Auth success — token saved to', TOKEN_FILE());

      // Fetch user profile to get product (free/premium)
      let product = 'free';
      try {
        const me = await httpsGet('https://api.spotify.com/v1/me',
          { Authorization: 'Bearer ' + data.access_token });
        if (me.status === 200) product = JSON.parse(me.body).product || 'free';
      } catch(e) {}
      console.log('[IKANDY] Spotify product:', product);
      mainWindow?.webContents.send('auth-result', { success: true, product });

      // Start polling immediately
      startPolling();

      if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
    } catch(e) {
      console.error('[IKANDY] Token exchange error:', e.message);
      mainWindow?.webContents.send('auth-result', { success: false, error: e.message });
    }
  });

  // Try preferred port first, fall back to random OS-assigned port
  function tryListen(port) {
    authServer.listen(port, '127.0.0.1', () => {
      const actualPort = authServer.address().port;
      console.log('[IKANDY] Auth server ready on port', actualPort);
      // If we got a different port, update the redirect URI used in auth flow
      if (actualPort !== CALLBACK_PORT) {
        console.log('[IKANDY] Port', CALLBACK_PORT, 'was busy — using', actualPort);
        authServer._actualPort = actualPort;
      }
    });
  }
  authServer.on('error', e => {
    if (e.code === 'EADDRINUSE') {
      console.warn('[IKANDY] Port', CALLBACK_PORT, 'in use — trying random port');
      tryListen(0);  // 0 = let OS assign a free port
    } else {
      console.error('[IKANDY] Auth server error:', e.message);
      mainWindow?.webContents.send('auth-result', {
        success: false, error: 'Auth server failed: ' + e.message
      });
    }
  });
  tryListen(CALLBACK_PORT);
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  if (volPollTimer) { clearInterval(volPollTimer); volPollTimer = null; }
  if (sourceMode === 'local') {
    console.log('[IKANDY] Local audio mode — no polling');
    return;
  }
  if (sourceMode === 'vlc') {
    pollVLC();
    pollTimer = setInterval(pollVLC, POLL_INTERVAL);
    console.log('[IKANDY] VLC polling started');
    return;
  }

  // Check if we're still within a rate-limit window from a previous session
  const rlFile = path.join(app.getPath('userData'), 'IKANDY-ratelimit.json');
  try {
    const rl = JSON.parse(fs.readFileSync(rlFile, 'utf8'));
    if (rl.resumeAt && rl.resumeAt > Date.now()) {
      const waitMs = rl.resumeAt - Date.now();
      console.warn('[IKANDY] Rate limit still active — waiting', Math.round(waitMs/1000), 's before first poll');
      isRateLimited = true;
      mainWindow?.webContents.send('spotify-state', { type: 'error', message: `Rate limited — resuming at ${new Date(rl.resumeAt).toLocaleTimeString()}` });
      setTimeout(() => {
        isRateLimited = false;
        try { fs.unlinkSync(rlFile); } catch(e) {}
        pollCurrentTrack();
        pollTimer = setInterval(pollCurrentTrack, POLL_INTERVAL);
        console.log('[IKANDY] Rate limit expired — polling started');
      }, waitMs);
      return;
    }
  } catch(e) {} // no rate limit file — proceed normally

  pollCurrentTrack(); // immediate first poll
  pollTimer = setInterval(pollCurrentTrack, POLL_INTERVAL);
  // Volume poll — separate timer, hits /me/player for device volume
  volPollTimer = setInterval(pollVolume, 8000);
  pollVolume(); // immediate check
  console.log('[IKANDY] Polling started (' + POLL_INTERVAL/1000 + 's interval)');
}

async function pollVolume() {
  if (sourceMode !== 'spotify' || !tokens.access_token) return;
  try {
    const valid = await ensureValidToken();
    if (!valid) return;
    const res = await httpsGet('https://api.spotify.com/v1/me/player',
      { Authorization: 'Bearer ' + tokens.access_token });
    if (res.status !== 200) return;
    const data = JSON.parse(res.body);
    const vol = data?.device?.volume_percent ?? null;
    if (vol !== null && vol !== lastVolume) {
      lastVolume = vol;
      mainWindow?.webContents.send('spotify-state', { type: 'volume', volume: vol });
      console.log('[IKANDY] Volume sync:', vol + '%');
    }
  } catch(e) { /* silent — volume sync is best-effort */ }
}

// ── IPC ───────────────────────────────────────────────────────────────────────
// Renderer asks main to open the auth URL (main has the PKCE verifier)
ipcMain.handle('start-auth', async () => {
  // Guard — refuse to open auth if no client ID configured
  if (!getClientId()) {
    mainWindow?.webContents.send('auth-result', { success: false, needsSetup: true });
    return { ok: false, error: 'No Client ID' };
  }
  // Generate PKCE in main process
  const { randomBytes, createHash } = require('crypto');
  const verifier  = randomBytes(64).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state     = randomBytes(16).toString('hex');

  startAuthServer(verifier); // server knows verifier for token exchange

  const params = new URLSearchParams({
    client_id:             getClientId(),
    response_type:         'code',
    redirect_uri:          REDIRECT_URI,
    scope:                 SCOPES,
    code_challenge_method: 'S256',
    code_challenge:        challenge,
    state,
    show_dialog:           'true',
  });
  const authUrl = 'https://accounts.spotify.com/authorize?' + params;
  console.log('[IKANDY] Opening auth URL in system browser');
  await shell.openExternal(authUrl);
  return { ok: true };
});

ipcMain.handle('logout', () => {
  clearTokens();
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  lastTrackId = null;
  mainWindow?.webContents.send('auth-result', { success: false, loggedOut: true });
  return { ok: true };
});

ipcMain.handle('is-authed', () => ({
  authed: !!(tokens.access_token && tokens.expires_at > Date.now() + 60000)
}));

ipcMain.handle('get-client-id', () => ({ id: getClientId() }));

ipcMain.handle('save-client-id', (_e, id) => {
  if (!id || typeof id !== 'string' || !id.trim().match(/^[a-f0-9]{10,64}$/i)) return { ok: false, error: 'Invalid Client ID — must be hex' };
  try {
    fs.writeFileSync(CLIENT_ID_FILE(), id.trim());
    console.log('[IKANDY] Client ID saved');
    return { ok: true };
  } catch(e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('clear-client-id', () => {
  try { fs.unlinkSync(CLIENT_ID_FILE()); } catch(e) {}
  clearTokens();
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  mainWindow?.webContents.send('auth-result', { success: false, needsSetup: true });
  return { ok: true };
});

ipcMain.handle('get-source',  () => ({ mode: sourceMode, vlcPort, vlcPassword }));
ipcMain.handle('set-source',  async (_e, mode) => {
  if (!['spotify','vlc','local'].includes(mode)) return { ok: false, error: 'Invalid mode' };
  const prev = sourceMode;
  sourceMode = mode;
  saveSource();
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  lastTrackId = null;
  lastKnownPlaying = false;
  // Local mode — pause previous source then stop
  if (mode === 'local') {
    try {
      const auth = Buffer.from(`:${vlcPassword}`).toString('base64');
      if (prev === 'spotify' && tokens.access_token) {
        await httpsRequest('PUT', 'https://api.spotify.com/v1/me/player/pause', '',
          { Authorization: 'Bearer ' + tokens.access_token });
      } else if (prev === 'vlc') {
        const statusRes = await httpGet(`http://localhost:${vlcPort}/requests/status.json`,
          { Authorization: 'Basic ' + auth });
        if (statusRes.status === 200) {
          const vlcData = JSON.parse(statusRes.body);
          if (vlcData.state === 'playing') {
            await httpGet(`http://localhost:${vlcPort}/requests/status.json?command=pl_pause`,
              { Authorization: 'Basic ' + auth });
          }
        }
      }
    } catch(e) { /* best effort */ }
    mainWindow?.webContents.send('spotify-state', { type: 'local' });
    return { ok: true };
  }
  try {
    const auth = Buffer.from(`:${vlcPassword}`).toString('base64');
    if (prev === 'spotify' && mode === 'vlc') {
      // Pause Spotify
      if (tokens.access_token) {
        await httpsRequest('PUT', 'https://api.spotify.com/v1/me/player/pause', '',
          { Authorization: 'Bearer ' + tokens.access_token });
      }
      mainWindow?.webContents.send('spotify-state', { type: 'track', playing: false });
    } else if (prev === 'vlc' && mode === 'spotify') {
      // Check VLC state first — only pause if actually playing
      try {
        const statusRes = await httpGet(`http://localhost:${vlcPort}/requests/status.json`,
          { Authorization: 'Basic ' + auth });
        if (statusRes.status === 200) {
          const vlcData = JSON.parse(statusRes.body);
          if (vlcData.state === 'playing') {
            await httpGet(`http://localhost:${vlcPort}/requests/status.json?command=pl_pause`,
              { Authorization: 'Basic ' + auth });
          }
        }
      } catch(e) { /* VLC not running, ignore */ }
      mainWindow?.webContents.send('spotify-state', { type: 'track', playing: false });
    }
  } catch(e) { /* best effort */ }
  // Restart polling for new source
  startPolling();
  return { ok: true };
});
ipcMain.handle('set-vlc-config', (_e, { port, password }) => {
  const p = parseInt(port);
  vlcPort     = (p >= 1 && p <= 65535) ? p : 8080;
  vlcPassword = typeof password === 'string' ? password.slice(0, 256) : '';
  saveSource();
  return { ok: true };
});
ipcMain.handle('vlc-test', async () => {
  try {
    const auth = Buffer.from(`:${vlcPassword}`).toString('base64');
    const res  = await httpGet(`http://localhost:${vlcPort}/requests/status.json`,
      { Authorization: 'Basic ' + auth });
    if (res.status === 200) return { ok: true };
    if (res.status === 401) return { ok: false, error: 'Wrong password' };
    return { ok: false, error: `HTTP ${res.status}` };
  } catch(e) { return { ok: false, error: 'VLC not reachable — is it running with Web interface enabled?' }; }
});
ipcMain.handle('vlc-action', async (_e, action) => {
  const allowedVlcActions = ['play','pause','playpause','next','prev','volume','seek','stop','restart'];
  if (!action?.type || !allowedVlcActions.includes(action.type)) return { ok: false, error: 'Invalid action' };
  try {
    const auth = Buffer.from(`:${vlcPassword}`).toString('base64');
    if (action.type === 'seek') {
      const sec = Math.max(0, Math.round(action.position));
      await httpGet(`http://localhost:${vlcPort}/requests/status.json?command=seek&val=${sec}`,
        { Authorization: 'Basic ' + auth });
      setTimeout(pollVLC, 800);
      return { ok: true };
    }
    if (action.type === 'restart') {
      await httpGet(`http://localhost:${vlcPort}/requests/status.json?command=seek&val=0`,
        { Authorization: 'Basic ' + auth });
      setTimeout(pollVLC, 800);
      return { ok: true };
    }
    if (action.type === 'volume') {
      const vol = Math.round((action.value / 100) * 256);
      await httpGet(`http://localhost:${vlcPort}/requests/status.json?command=volume&val=${vol}`,
        { Authorization: 'Basic ' + auth });
      return { ok: true };
    }
    const cmds = { playpause: 'pl_pause', next: 'pl_next', prev: 'pl_previous', play: 'pl_play', pause: 'pl_pause', stop: 'pl_stop' };
    const cmd  = cmds[action.type];
    if (!cmd) return { ok: false };
    await httpGet(`http://localhost:${vlcPort}/requests/status.json?command=${cmd}`,
      { Authorization: 'Basic ' + auth });
    setTimeout(pollVLC, 800);
    return { ok: true };
  } catch(e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('get-playlists', async () => {
  try {
    const items = [];
    let url = 'https://api.spotify.com/v1/me/playlists?limit=50';
    while (url) {
      const res = await httpsGet(url, { Authorization: 'Bearer ' + tokens.access_token });
      if (res.status !== 200) break;
      const data = JSON.parse(res.body);
      items.push(...(data.items || []));
      url = data.next || null;
    }
    return { ok: true, items };
  } catch(e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('play-playlist', async (_e, uri) => {
  if (uri !== 'liked' && !String(uri).match(/^spotify:(playlist|album|artist):[a-zA-Z0-9]+$/)) {
    return { ok: false, error: 'Invalid URI' };
  }
  try {
    let body;
    if (uri === 'liked') {
      const res = await httpsGet('https://api.spotify.com/v1/me/tracks?limit=50',
        { Authorization: 'Bearer ' + tokens.access_token });
      const data = JSON.parse(res.body);
      const uris = data.items.map(i => i.track.uri);
      body = JSON.stringify({ uris });
    } else {
      body = JSON.stringify({ context_uri: uri });
    }
    await httpsRequest('PUT', 'https://api.spotify.com/v1/me/player/play', body,
      { Authorization: 'Bearer ' + tokens.access_token, 'Content-Type': 'application/json' });
    setTimeout(pollSpotify, 800);
    return { ok: true };
  } catch(e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('playback-action', async (_e, action) => {
  const allowedActions = ['play','pause','playpause','next','prev','previous','volume','seek','poll','telemetry','focus-window'];
  if (!action?.type || !allowedActions.includes(action.type)) return { ok: false, error: 'Invalid action' };

  if (action.type === 'focus-window') {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
    return { ok: true };
  }
  if (action.type === 'telemetry') return { ok: true };
  if (action.type === 'poll') { pollSpotify(); return { ok: true }; }

  try {
    const auth = { Authorization: 'Bearer ' + tokens.access_token };
    if (action.type === 'playpause') {
      const endpoint = lastKnownPlaying ? 'pause' : 'play';
      await httpsRequest('PUT', `https://api.spotify.com/v1/me/player/${endpoint}`, '', auth);
      lastKnownPlaying = !lastKnownPlaying;
      return { ok: true };
    }
    if (action.type === 'play') {
      await httpsRequest('PUT', 'https://api.spotify.com/v1/me/player/play', '', auth);
      lastKnownPlaying = true; return { ok: true };
    }
    if (action.type === 'pause') {
      await httpsRequest('PUT', 'https://api.spotify.com/v1/me/player/pause', '', auth);
      lastKnownPlaying = false; return { ok: true };
    }
    if (action.type === 'next') {
      await httpsRequest('POST', 'https://api.spotify.com/v1/me/player/next', '', auth);
      setTimeout(pollSpotify, 800); return { ok: true };
    }
    if (action.type === 'prev' || action.type === 'previous') {
      await httpsRequest('POST', 'https://api.spotify.com/v1/me/player/previous', '', auth);
      setTimeout(pollSpotify, 800); return { ok: true };
    }
    if (action.type === 'seek') {
      const ms = Math.max(0, Math.round(action.position_ms ?? (action.position * 1000) ?? 0));
      await httpsRequest('PUT', `https://api.spotify.com/v1/me/player/seek?position_ms=${ms}`, '', auth);
      setTimeout(pollSpotify, 500); return { ok: true };
    }
    if (action.type === 'volume') {
      const vol = Math.max(0, Math.min(100, Math.round(action.value)));
      await httpsRequest('PUT', `https://api.spotify.com/v1/me/player/volume?volume_percent=${vol}`, '', auth);
      return { ok: true };
    }
    return { ok: false, error: 'Unknown action' };
  } catch(e) { return { ok: false, error: e.message }; }
});

// ── Custom preset folder ──────────────────────────────────────────────────────
const PRESET_FOLDER_FILE = () => path.join(app.getPath('userData'), 'IKANDY-preset-folder.txt');

function getSavedPresetFolder() {
  try { return fs.readFileSync(PRESET_FOLDER_FILE(), 'utf8').trim(); } catch(e) { return null; }
}

function loadPresetsFromFolder(dir) {
  try {
    const files = fs.readdirSync(dir).filter(f => {
      if (path.extname(f).toLowerCase() !== '.json') return false;
      const full = path.resolve(dir, f);
      if (!full.startsWith(path.resolve(dir))) return false;
      try { return fs.statSync(full).isFile(); } catch(e) { return false; }
    });
    const presets = {};
    for (const f of files) {
      try {
        const name = path.basename(f, '.json');
        const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        presets[name] = data;
      } catch(e) {}
    }
    return { ok: true, presets, count: Object.keys(presets).length, dir };
  } catch(e) { return { ok: false, error: e.message }; }
}

ipcMain.handle('pick-preset-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Preset Folder (.json files)',
  });
  if (result.canceled || !result.filePaths.length) return { ok: false };
  const dir = result.filePaths[0];
  if (!path.isAbsolute(dir)) return { ok: false, error: 'Invalid path' };
  fs.writeFileSync(PRESET_FOLDER_FILE(), dir, 'utf8');
  return loadPresetsFromFolder(dir);
});

ipcMain.handle('get-preset-folder', () => {
  const dir = getSavedPresetFolder();
  if (!dir) return { ok: false };
  return loadPresetsFromFolder(dir);
});

ipcMain.handle('clear-preset-folder', () => {
  try { fs.unlinkSync(PRESET_FOLDER_FILE()); } catch(e) {}
  return { ok: true };
});

ipcMain.handle('pick-image-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Image Folder',
  });
  if (result.canceled || !result.filePaths.length) return { ok: false };
  const dir = result.filePaths[0];
  const exts = new Set(['.jpg','.jpeg','.png','.webp','.gif','.bmp']);
  const files = fs.readdirSync(dir)
    .filter(f => {
      if (!exts.has(path.extname(f).toLowerCase())) return false;
      // Prevent path traversal — ensure file is directly inside dir
      const fullPath = path.resolve(dir, f);
      if (!fullPath.startsWith(path.resolve(dir))) return false;
      try {
        const stat = fs.statSync(fullPath);
        return stat.isFile() && stat.size <= 50 * 1024 * 1024;
      } catch(e) { return false; }
    })
    .map(f => 'file:///' + path.join(dir, f).replace(/\\/g, '/'));
  return { ok: true, files, dir };
});


// ── Enable getDisplayMedia in Electron ───────────────────────────────────────
// Electron blocks getDisplayMedia by default. This handler intercepts the
// request from the renderer and uses Electron's desktopCapturer to provide
// a real audio stream from any application on the system.
function setupDesktopCapturer() {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    // Must provide a video source — Electron requires it even for audio-only capture.
    // We get the first screen source (silently, no picker) just to satisfy the requirement,
    // then stop the video track in the renderer. Audio loopback is what we actually use.
    desktopCapturer.getSources({ types: ['screen'] }).then(sources => {
      if (sources.length > 0) {
        callback({ video: sources[0], audio: 'loopback' });
      } else {
        callback({});
      }
    }).catch(() => callback({}));
  });
  console.log('[IKANDY] desktopCapturer / getDisplayMedia enabled');
}

// ── Cookie rewriting for SDK session ─────────────────────────────────────────
function setupSession() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const url = details.url || '';
    const headers = { ...details.responseHeaders };
    if (url.includes('spotify.com') || url.includes('scdn.co')) {
      const raw = headers['set-cookie'] || headers['Set-Cookie'];
      if (raw) {
        headers['set-cookie'] = [].concat(raw).map(c =>
          c.replace(/;\s*SameSite=\w+/gi, '').replace(/;\s*Secure/gi, '')
        );
      }
    }
    callback({ responseHeaders: headers });
  });
}

// ── Single-instance ───────────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }
else {
  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  });
}

// ── Window ────────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 800, minWidth: 800, minHeight: 500,
    show: false,  // don't show until maximized
    title: 'IKANDY',
    backgroundColor: '#060608',
    autoHideMenuBar: true,  // hides the File/Edit/View menu bar
    frame: true,
    webPreferences: {
      autoplayPolicy:  'no-user-gesture-required',
      nodeIntegration: false,
      contextIsolation: true,
      sandbox:         false,
      webSecurity:     true,
      devTools:        !app.isPackaged,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Remove the native menu entirely
  mainWindow.setMenu(null);

  mainWindow.maximize();
  mainWindow.show();
  mainWindow.loadFile('IKANDY.html');
  // mainWindow.webContents.openDevTools({ mode: 'detach' });

  // Register Ctrl+Shift+I to toggle DevTools
  if (!app.isPackaged) {
    globalShortcut.register('CommandOrControl+Shift+I', () => {
      if (mainWindow) {
        if (mainWindow.webContents.isDevToolsOpened()) {
          mainWindow.webContents.closeDevTools();
        } else {
          mainWindow.webContents.openDevTools({ mode: 'detach' });
        }
      }
    });
  }

  mainWindow.on('closed', () => {
    globalShortcut.unregisterAll();
    mainWindow = null;
  });

  // ── Auto-updater ──────────────────────────────────────────────────────────────
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify();

    autoUpdater.on('update-available', () => {
      mainWindow?.webContents.send('update-status', { status: 'available' });
    });

    autoUpdater.on('update-downloaded', () => {
      mainWindow?.webContents.send('update-status', { status: 'ready' });
    });

    autoUpdater.on('error', (e) => {
      console.log('[IKANDY] Auto-update error:', e.message);
    });
  }
}


// ── Spotify volume poll (separate, slow interval) ─────────────────────────────
async function pollSpotifyVolume() {
  if (sourceMode !== 'spotify') return;
  const valid = await ensureValidToken();
  if (!valid) return;
  try {
    const res = await httpsGet('https://api.spotify.com/v1/me/player',
      { Authorization: 'Bearer ' + tokens.access_token });
    if (res.status !== 200) return;
    const data = JSON.parse(res.body);
    const vol = data.device?.volume_percent ?? null;
    if (vol !== null && vol !== lastVolume) {
      lastVolume = vol;
      mainWindow?.webContents.send('spotify-state', { type: 'volume', volume: vol });
    }
  } catch(e) {}
}

// ── VLC polling ───────────────────────────────────────────────────────────────
async function pollVLC() {
  try {
    const auth = Buffer.from(`:${vlcPassword}`).toString('base64');
    const res  = await httpGet(`http://localhost:${vlcPort}/requests/status.json`,
      { Authorization: 'Basic ' + auth });
    if (res.status === 401) {
      mainWindow?.webContents.send('spotify-state', { type: 'error', message: 'VLC: wrong password' });
      return;
    }
    if (res.status !== 200) {
      mainWindow?.webContents.send('spotify-state', { type: 'error', message: `VLC: HTTP ${res.status}` });
      return;
    }
    const data = JSON.parse(res.body);
    const meta = data.information?.category?.meta || {};
    const title  = meta.title  || meta.filename || 'Unknown';
    const artist = meta.artist || meta.album_artist || '';
    const album  = meta.album  || '';
    const duration = (data.length || 0) * 1000;
    const progress = (data.time   || 0) * 1000;
    const playing  = data.state === 'playing';
    const trackId  = `${title}::${artist}`;
    const volume   = data.volume != null ? Math.round((data.volume / 256) * 100) : null;
    // VLC art: served locally via HTTP with auth
    const art = `http://:${vlcPassword}@localhost:${vlcPort}/art`;

    lastKnownPlaying = playing;
    mainWindow?.webContents.send('spotify-state', {
      type: 'track', id: trackId, title, artist, album,
      art, progress, duration, playing, timestamp: Date.now(), volume,
    });

    if (trackId !== lastTrackId) {
      lastTrackId = trackId;
      if (title !== 'Unknown') fetchLyrics(title, artist);
    }
  } catch(e) {
    mainWindow?.webContents.send('spotify-state', { type: 'error', message: 'VLC: not reachable — is it running?' });
  }
}

// ── Telemetry ─────────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://grimznincoiujnurhmlx.supabase.co/rest/v1';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdyaW16bmluY29pdWpudXJobWx4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxNDQ5NzAsImV4cCI6MjA5MjcyMDk3MH0.X-eXBp4gF3RthSt10As83Ft4z5rOc929IMdis5BSuxk';

// UUID stored in userData — persists across launches
const UUID_FILE = () => path.join(app.getPath('userData'), 'IKANDY-uuid.txt');
function getOrCreateUUID() {
  try {
    const existing = fs.readFileSync(UUID_FILE(), 'utf8').trim();
    if (existing) return { uuid: existing, isNew: false };
  } catch(e) {}
  const uuid = require('crypto').randomUUID();
  try { fs.writeFileSync(UUID_FILE(), uuid); } catch(e) {}
  return { uuid, isNew: true };
}

function supabasePost(table, body) {
  const data = JSON.stringify(body);
  const u = new URL(SUPABASE_URL + '/' + table);
  const req = https.request({
    method: 'POST', hostname: u.hostname, path: u.pathname,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Length': Buffer.byteLength(data),
      'Prefer': 'return=minimal',
    },
  });
  req.on('error', () => {});
  req.write(data);
  req.end();
}

let _launchTime  = Date.now();
let _sessionUUID = '';
let _telemetry   = { source_mode: 'spotify', auto_cycle: false };

function pingLaunch() {
  try {
    const { uuid, isNew } = getOrCreateUUID();
    _sessionUUID = uuid;
    supabasePost('launches', {
      uuid,
      is_new_user: isNew,
      version:     app.getVersion(),
      platform:    process.platform,
      source_mode: _telemetry.source_mode,
      auto_cycle:  _telemetry.auto_cycle,
      session_seconds: null, // filled on close
    });
  } catch(e) {}
}

function pingClose() {
  try {
    const seconds = Math.round((Date.now() - _launchTime) / 1000);
    // PATCH the latest row for this uuid with session duration
    const u = new URL(SUPABASE_URL + '/launches');
    const data = JSON.stringify({
      session_seconds: seconds,
      source_mode: _telemetry.source_mode,
      auto_cycle:  _telemetry.auto_cycle,
    });
    const req = https.request({
      method: 'PATCH', hostname: u.hostname,
      path: u.pathname + '?uuid=eq.' + _sessionUUID + '&order=launched_at.desc&limit=1',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Content-Length': Buffer.byteLength(data),
        'Prefer': 'return=minimal',
      },
    });
    req.on('error', () => {});
    req.write(data);
    req.end();
  } catch(e) {}
}

function pingError(message, stack) {
  try {
    supabasePost('errors', {
      uuid:          _sessionUUID,
      version:       app.getVersion(),
      platform:      process.platform,
      error_message: String(message).slice(0, 500),
      error_stack:   String(stack  ).slice(0, 2000),
    });
  } catch(e) {}
}

// Catch unhandled errors in main process
process.on('uncaughtException',      (e) => pingError(e.message, e.stack));
process.on('unhandledRejection',     (e) => pingError(e?.message || e, e?.stack || ''));

// IPC — renderer reports source mode and auto-cycle state
ipcMain.on('update-install', () => {
  autoUpdater.quitAndInstall();
});

ipcMain.on('telemetry', (_e, data) => {
  if (data.source_mode !== undefined) _telemetry.source_mode = data.source_mode;
  if (data.auto_cycle  !== undefined) _telemetry.auto_cycle  = data.auto_cycle;
});

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  pingLaunch();
  setupDesktopCapturer();
  setupSession();
  loadTokens();
  loadSource();
  createWindow();

  // Wait for renderer to signal it has registered IPC listeners (after boot())
  // This prevents auth-result arriving before setupSpotifyIPC() runs
  ipcMain.once('renderer-ready', async () => {
    console.log('[IKANDY] Renderer ready — checking token');

    if (sourceMode === 'vlc' || sourceMode === 'local') {
      sourceMode = 'spotify';
      console.log('[IKANDY] Non-spotify mode saved but starting in Spotify mode');
    }
    if (!getClientId()) {
      console.log('[IKANDY] No Client ID — showing setup screen');
      mainWindow?.webContents.send('auth-result', { success: false, needsSetup: true });
      return;
    }
    const valid = await ensureValidToken();
    if (valid) {
      console.log('[IKANDY] Valid token found — restoring session');
      // Send auth-result immediately so loading screen fades fast
      // Fetch product in background and send update if needed
      mainWindow?.webContents.send('auth-result', { success: true, restored: true, product: 'free' });
      startPolling();
      try {
        const me = await httpsGet('https://api.spotify.com/v1/me',
          { Authorization: 'Bearer ' + tokens.access_token });
        if (me.status === 200) {
          const product = JSON.parse(me.body).product || 'free';
          // Send product update so UI can unlock premium controls if needed
          mainWindow?.webContents.send('auth-result', { success: true, restored: true, product });
        }
      } catch(e) {}
    } else {
      console.log('[IKANDY] No valid token — showing login');
      mainWindow?.webContents.send('auth-result', { success: false });
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  pingClose();
  if (pollTimer) clearInterval(pollTimer);
  if (authServer) authServer.close();
  if (process.platform !== 'darwin') app.quit();
});