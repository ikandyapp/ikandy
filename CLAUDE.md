# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What Is This?

IKANDY is a dark, cinematic music visualizer for Windows built on Butterchurn (MilkDrop/WebGL). It's an Electron desktop app that integrates with Spotify, VLC, foobar2000, and system audio to drive 500+ procedural presets with synced lyrics and multi-monitor support.

## Commands

```bash
npm start          # Run in development (DevTools available via Ctrl+Shift+I)
npm run dev        # Same but with NODE_ENV=development set explicitly
npm run build      # Build installer for all platforms
npm run build:win  # Windows NSIS installer (x64)
npm run build:mac  # macOS DMG (arm64 + x64)
npm run build:linux # Linux AppImage
```

No test runner, linter, or type checker — vanilla JavaScript only.

## Architecture

This is a standard Electron multi-process app with **no frontend framework**. All code is vanilla JS.

### Process Boundaries

| File | Process | Role |
|------|---------|------|
| `main.js` (~2700 lines) | Main (Node.js) | All external APIs, OAuth, IPC handlers, window management |
| `preload.js` | Preload (sandboxed) | Context-isolated bridge exposing `window.IKANDY` to renderer |
| `IKANDY.html` | Renderer (Chromium) | All canvas/WebGL rendering + UI controls (inline CSS + scripts) |
| `mirror.html` | Renderer (Chromium) | Multi-monitor display via `getDisplayMedia()` screen capture |

### Main Process (`main.js`)

Heavy-lifting service layer — no rendering. Key subsystems:

- **Spotify**: PKCE OAuth (local server on port 8888), `/me/player` polling every 5s, 429 rate-limit recovery (state persisted to disk across restarts)
- **VLC**: HTTP API polling (port 8080)
- **foobar2000**: Beefweb HTTP/WebSocket (port 8880)
- **Lyrics**: Parallel LRCLIB requests + lyrics.ovh fallback; RTT-compensated sync (+25ms)
- **Multi-monitor**: Manages mirror `BrowserWindow` instances; IPC bridges audio/source to them
- **Auto-updater**: `electron-updater` deferred 3s after launch, staged downloads from GitHub releases
- **Credentials**: Spotify tokens encrypted via `safeStorage.encryptString` (OS keychain); client ID user-provided (BYOK)

### Renderer (`IKANDY.html`)

Single-file bundle (~445KB inline). Key systems:

- **Canvas stack**: Multiple fixed-position overlays composited with CSS blend modes (`screen`, `overlay`)
- **Butterchurn**: WebGL-based MilkDrop preset renderer
- **Scenes**: Aurora, Pawrticles, Ripple, Waveray, Fire, Singularity, Voyager (all procedural, canvas 2D/WebGL)
- **Image FX**: Rain, VHS, Ink, Fog, Paint, Film, Metal, Shatter, Corrupt, Plasma, Holo, Heat
- **Audio pipeline**: `getDisplayMedia()` → `AudioContext` → `AnalyserNode` → Butterchurn + beat detection. Unity gain + `WaveShaperNode` soft-clipper (no hard clipping). Self-heals on disconnect (3 attempts: original, context rebuild, fresh capture).
- **Beat detection**: Adaptive thresholds, no fixed limits. Drives particle burst.

### IPC Channels (Main ↔ Renderer)

```
Auth:         start-auth, logout, is-authed, get-client-id, save-client-id, clear-client-id
Playback:     playback-action, set-shuffle
Sources:      get-source, set-source, vlc-test, vlc-action, set-vlc-config,
              foobar-test, foobar-action, set-foobar-config, smtc-action
Data push:    spotify-state, lyrics, update-available, update-status
Multi-monitor: get-displays, open-mirror, close-mirror, close-all-mirrors,
               set-span-displays, mirror-audio, mirror-source, mirror-closed
Presets:      pick-preset-folder, get-preset-folder, preset-thumb-load-all,
              preset-thumb-save, broken-presets-load, broken-presets-add
Playlists:    get-playlists, play-playlist, get-foobar-playlists,
              get-foobar-playlist-tracks, play-foobar-playlist, play-foobar-track
Other:        open-external (GitHub URLs only), renderer-ready
```

## Security Model

- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`
- `will-navigate` handler blocks any navigation away from `IKANDY.html`
- `window.open()` denied; external links only allowed to GitHub URLs via `shell.openExternal`
- Only `media`, `display-capture`, and `fullscreen` permissions granted
- Spotify tokens encrypted via OS keychain (`safeStorage`)

## Persistent Storage

All state in `app.getPath('userData')` (`%APPDATA%\IKANDY\` on Windows):

| File | Contents |
|------|----------|
| `IKANDY-tokens.json` | Encrypted Spotify access/refresh tokens |
| `IKANDY-client-id.txt` | User-supplied Spotify Client ID |
| `IKANDY-source.json` | Active source + VLC/foobar connection config |
| `IKANDY-preset-folder.txt` | Custom preset directory path |
| `IKANDY-preset-thumbs/` | Cached preset thumbnail dataURLs |
| `IKANDY-broken-presets.json` | Presets that crash Butterchurn (suppressed) |
| `IKANDY-ratelimit.json` | Spotify 429 resume timestamp |

localStorage (renderer): `IKANDY-fx-strengths`, `IKANDY-scene-intensities` (per-effect intensity memory)

## Key Conventions

- **Log prefix**: `[IKANDY]` on all `console.log` calls
- **API timeouts**: 8s (Spotify), 3s (VLC/foobar)
- **Build stamp**: `main.js` logs `[IKANDY] main.js loaded — multi-monitor build YYYY-MM-DD rN` on startup
- **Single-instance lock**: `app.requestSingleInstanceLock()` — second launch focuses existing window
- **DevTools**: Gated by `!app.isPackaged` — only available in dev (`npm start`)
- **Windows-specific**: Hardware-accelerated WebGL screen capture uses `AllowWGCScreenCapturer` Chromium flag; app is Windows-first
