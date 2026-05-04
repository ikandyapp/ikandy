# IKANDY

Electron-based music visualizer built on Butterchurn (MilkDrop in WebGL). Solo-developer project, near-zero budget, ambitious cinematic post-processed visual quality.

**The name is always written `IKANDY` in all caps — code comments, READMEs, UI strings, marketing copy, commit messages, Discord posts. Never "ikandy" or "iKandy".**

---

## Stack

- **Electron 30** (main + preload + renderer split)
- **Butterchurn** WebGL visualizer (350 MilkDrop presets bundled)
- **Spotify Web API** via PKCE OAuth (BYOK — user provides Client ID)
- **VLC HTTP API** (port-checked, regex-validated)
- **foobar2000** + Now Playing as alternate sources
- **LRCLIB** for synced lyrics
- **Supabase** for opt-in telemetry
- **GLSL shaders** (12 post-process passes) + custom audio-reactive scenes (5)
- **Bebas Neue** embedded locally as a font file (do not load from Google Fonts — it caused startup flicker)

## Repo layout

```
src/main/        Electron main process, IPC handlers, window mgmt
src/preload/     contextBridge exposure (allowlisted only)
src/renderer/    ikandy.html + JS — Butterchurn, FX layer, UI
src/shaders/     12 GLSL post-process passes
src/scenes/      5 audio-reactive scenes (lofi planned)
src/lyrics/      LRCLIB fetch + classic + physics modes
src/sources/     Spotify, VLC, foobar2000, Now Playing adapters
src/telemetry/   Supabase opt-in events
assets/          icons, Bebas Neue font, presets
```

## Build & run

- `npm install` — install deps
- `npm start` — dev run
- `npm run build` — package via electron-builder, outputs to `dist/`
- `npm run dist` — full distributable .exe (signed once Certum cert is wired)
- _(TODO: confirm exact script names — replace these if different)_

**Always delete `dist/` before a fresh package build** — stale icons/manifests caused real bugs.

## Security model — non-negotiable

These are audited (April 2026) and must not regress:

- `contextIsolation: true`
- `nodeIntegration: false`
- `webSecurity: true`
- `sandbox: true` where possible
- All IPC channels are allowlisted in main and preload — no wildcard `ipcMain.handle`
- Spotify Client ID validated as 32-char hex before use
- VLC port restricted to a safe range
- Spotify URIs validated by regex before any fetch
- File paths validated against traversal (`..`, absolute outside app dir)
- Tokens stored via Electron `safeStorage` (DPAPI on Windows)
- DevTools **disabled in packaged builds** — never re-enable for "convenience"
- Never load remote scripts at runtime; bundle everything

If a change touches IPC, preload, BrowserWindow opts, or token handling, call it out explicitly in the commit message and PR.

## Conventions

- Plain JS, no TypeScript (keep the build simple)
- 2-space indent, single quotes, semicolons
- Comments are sparse — code should explain itself; comments explain *why* not *what*
- IPC channel names: `ikandy:domain:action` (e.g. `ikandy:spotify:auth`)
- New shaders go in `src/shaders/`, register in the shader index, add a UI toggle
- New scenes go in `src/scenes/`, follow the existing audio-reactive interface
- Keep the FX Layer pipeline ordered: scene → bloom → CA → grain → vignette
- Never use `localStorage` for sensitive data — `safeStorage` only

## Visual quality philosophy

Push WebGL and Chromium hard. The bar is "make a MilkDrop3 dev react." Bloom, motion blur, color grading, MSAA, radial chromatic aberration, beat-modulated post-processing — all in scope. Performance matters but visual ambition wins ties.

Bass-reactive vignette and grain are already in. FX layer is on `#fx-canvas`, particle bursts on `#pb-canvas`.

## Distribution

- Site: **ikandy.app** (GitHub Pages, Porkbun DNS) — repo `ikandyapp/ikandy.github.io` _(verify name)_
- App repo: **github.com/ikandyapp/ikandy** (branch: `master`)
- Releases: GitHub Releases hosts the `.exe`
- Funding: buymeacoffee.com/ikandy
- Community: Discord (planned, link TBD)

## Auto-updater status

Code is wired into `main.js`, `preload.js`, `ikandy.html`, `package.json` — but `electron-updater` is **not yet installed** and the Certum Open Source code-signing cert is **in verification**. Do not flip the updater on until both are ready. When activating: `npm install electron-updater`, wire Certum into `package.json` build config, regenerate `latest.yml`, test on a throwaway build before pushing to Releases.

## What I'm working on right now

- IKANDY website: feedback/comment section, `guide.html` styled to match the dark site, GitHub Releases direct download link, demo video integration
- Custom preset folder loader (.milk files) — needs static-analysis compatibility scan for `get_fft()`, large megabuf, HLSL extensions, `milk2_img.ini` references, with a post-load report
- Lofi scene (2D canvas, beat-pulsating)
- Mood scenes (Spotify valence → rain/sunshine/overcast)

## Things to never do

- Write the name as "ikandy", "iKandy", "Ikandy", etc. It is `IKANDY`.
- Re-enable DevTools in packaged builds
- Add a wildcard IPC handler
- Load fonts or scripts from a remote CDN at runtime
- Commit secrets — Spotify uses BYOK, there are no embedded keys
- Bump Electron major versions without a fresh security audit
- Add npm dependencies casually — every dep is a supply-chain surface; justify it
