# Changelog

All notable changes to IKANDY are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.11] - 2026-05-02

### Added
- **Image-texture preset category** — butterchurn's image-texture pack (~150 presets using "cells" and "seaweed" textures) is now loaded at startup but kept out of the default rotation. A new "Include image-texture presets" checkbox in the Scenes accordion (same row as "Hide non-reactive presets") merges them into the active pool when enabled. Textures are lazy-loaded via `imageData.min.js` on first enable. If `loadExtraImages()` is available on the butterchurn instance it is called immediately; otherwise `window.imageData` is set for butterchurn to pick up at preset-load time. Silent detection handles any presets that render black due to missing texture support.

### Changed
- **Preset library trimmed** — `md1.min.js` removed from the load chain (−57 presets, oldest/lowest-rated). `nonMinimal.min.js` also removed (it is the union of base+extra+md1 minus minimal and contributed 0 net presets).
- **extra2 added** — `butterchurnPresetsExtra2.min.js` from butterchurn-presets@2.4.7 added to the procedural load chain. Net-new count logged on first launch; if <20 it is flagged in the console.
- **Library log updated** — boot now prints `[IKANDY] Library: N procedural + M image-texture presets` (visible in BUG panel).

## [1.0.10] - 2026-05-02

### Added
- **Silent-preset detection** — after each preset loads, three pixel samples are taken at 1 s, 2 s, and 3 s. A preset is marked silent only if all three samples are ≥95% near-black (R+G+B < 10). Saved to `IKANDY-broken-presets.json` with `reason:"silent"` and skipped in auto-cycle thereafter. Prevents false positives from presets with legitimate dark intro phases.
- **Shuffle bag for auto-cycle** — replaces the old `Math.random()` pick with a Fisher-Yates–shuffled deck. Every non-broken, non-silent preset is guaranteed to appear exactly once before any repeats. Bag automatically excludes any preset newly marked broken or silent mid-session.
- **Reactivity scan** — opt-in checkbox ("Hide non-reactive presets") in the Scenes accordion. Off by default. When first enabled, runs a background scan: loads each preset in a hidden 64×64 butterchurn instance, measures the brightness delta between silence and loud bass audio, and assigns a score 0–1. Presets scoring below 0.25 are excluded from auto-cycle. Results persist to `IKANDY-preset-reactivity.json` so subsequent launches restore the filter instantly without re-scanning. Progress shown as "Analyzing presets… N/M" with a cancel button; cancel unchecks the toggle.

### Changed
- **Broken-preset file schema** — `IKANDY-broken-presets.json` now stores `[{name, reason}]` objects instead of plain strings. Existing plain-string entries are coerced to `{reason:"crash"}` on first read (backward-compatible).

## [1.0.9] - 2026-05-02

### Added
- **Multi-monitor: Mirror mode** — one frameless `BrowserWindow` per secondary display, always-on-top at screen-saver level, auto-opened when the toggle is turned on. Per-monitor checkboxes let you include or exclude individual displays without toggling the whole feature off.
- **Multi-monitor: Span mode** — stretches the main window to the bounding box of all selected secondaries so the visualiser covers the wall. Per-monitor checkboxes dynamically respan to the selected subset.
- **Multi-monitor: Fit / Fill toggle** — Mirror mode only. *Fit* (default) letterboxes the source into each display; *Fill* stretches to cover. Runtime toggle propagated to all open mirrors instantly via IPC push. Span always forces fill.
- **Multi-monitor: Escape bail-out** — pressing Escape while MM is active immediately disables it (closes all mirrors / exits span, restores main window bounds) and shows a brief "Multi-monitor disabled" toast. Existing Escape behaviour (exit fullscreen / close preset panel) falls through only when MM is off.
- **Multi-monitor: localStorage persistence** — MM on/off, mode (mirror/span), fit mode, and per-monitor checked IDs are saved on every change and restored on next launch. If the monitor lineup changed since the last session (different IDs or count), per-display restore is skipped and all monitors default to checked; the skip reason is logged.
- **Multi-monitor: hot-plug handling** — `display-added` auto-opens a new mirror and adds a checkbox row; `display-removed` closes the orphaned mirror or recomputes span (forces MM off if the last secondary disconnects); `display-metrics-changed` repositions the mirror to the new bounds. All three events log display ID, label, bounds, and changed-metrics array for debugging. Win+P / WorkerW instability documented in code.
- **Mirror reconnect** — when a mirror's capture stream ends unexpectedly, up to 3 reconnect attempts are made with exponential backoff (1 s, 2 s, 4 s). Each attempt logs `[Mirror] reconnect attempt N/3 in Xms`. A `_reconnecting` guard prevents double-triggers. Success resets the counter; exhausting all attempts shows a permanent error status.
- **Mood worker (`mood-worker.js`)** — off-thread image pixel analysis (brightness, std-dev, saturation, colour temperature, dominant hue) and light-source extraction. Lights: strict local-maximum filter (must beat all neighbours by ≥ 5%), saturation ≥ 0.35, ranked by `brightness × (1 + saturation)`, capped at 8. `skipLights` flag omits extraction when the Pulse feature is hidden.

### Changed
- **Multi-monitor UI overhauled** — replaced the old per-display picker and Refresh/Close-all buttons with a single toggle that auto-opens all secondaries, plus an inline checkbox list for per-display control. Mode and Fit buttons are always visible; the checkbox list appears only when MM is on.
- **Windows Graphics Capture enabled** (`main.js`) — `AllowWGCScreenCapturer`, `AllowWGCDesktopCapturer`, and `AllowWGCFrameSourceCapturer` Chromium flags appended on Win32. Electron was silently falling back to BitBlt, which returns black frames for WebGL / Butterchurn content on Windows 10+.

## [1.0.8] - 2026-05-01

### Added
- **Draw on canvas** — right-click and drag to draw freehand lines over the visualiser (screen-blend layer, z-index 19). Both mouse buttons held simultaneously clears the canvas. Color options: Random (default, cycles through accent-adjacent hues), White, Accent. Brush width 1–40 px, persisted to `IKANDY-draw-width`. Toggle and color/width controls live in the right-click hide-options menu under Mouse effects.
- **SMTC volume label** — a locked row in the transport bar explains that volume control isn't available from IKANDY and directs users to their source app or system mixer, replacing the previously absent/broken volume slider.

### Changed
- **Modal scroll on small displays** — all modals now cap at `100vh − 40px` with `overflow-y: auto` so content is reachable on 768 px-tall or smaller screens without the modal clipping off-screen.
- **Audio reconnect coverage expanded** — `autoConnectSystemAudio` is now triggered on play gesture (click/keydown), on cold boot when Spotify is already playing, and when switching to the Spotify source. Previously these paths required a manual "Reconnect System Audio" click after the stream lapsed.

## [1.0.7] - 2026-05-01

### Added
- **Click ripples** — left-click spawns an expanding ring at the cursor; right-click collapses an implosion ring inward. Double-right-click triggers a rapid strobe flash. Hold right-click charges a growing ring that explodes outward on release with intensity proportional to hold duration. All effects rendered on a dedicated `click-ripple-canvas` (screen-blend, z-index 18).
- **Cursor trail** — a fading streak of up to 28 points follows mouse movement. Trail color matches the current accent. Rendered in the same click-ripple pass so there is no second canvas.
- **Double-click particle burst at cursor** — overrides the burst origin to the cursor position for one frame, placing the particle explosion exactly where the user clicks.
- **Aurora mouse warp** — in the Aurora scene the UV field is locally pulled toward the cursor based on distance; the curtain bends and reaches toward the pointer in real time.
- **Pawrticles mouse repel** — particles flee from the cursor within a configurable radius, snapping back after the pointer moves away.
- **Mouse effects toggle** — on/off switch in the right-click hide-options menu. Persisted to `IKANDY-mouse-fx`. Disabling clears all active rings and trail immediately.
- **Welcome modal** — shown on first launch (or after a version bump). Displays version number, highlights new features in the current release, and links to the subreddit. "Don't show again" option persisted to `IKANDY-welcome-seen`.

## [1.0.6] - 2026-04-30

### Added
- **Voyager scene** — new procedural gas giant rendered entirely in a fragment shader. Spinning planet with banded violet/teal/cream surface (domain-warped fbm clouds), atmospheric Fresnel rim glow, soft outer halo, sparse twinkly starfield, and faint nebula tint. Zero asset weight (no textures bundled).
- **Voyager: lightning storms** on the night side. Storm regions are smooth fbm blobs; sparkle within them is high-frequency fbm scrolling fast (no cubic-cell artifacts). Bass response is quadratic so quiet sections sparkle subtly and drops produce a global white-hot flash. Color shifts from electric blue to white at peak intensity.
- **Voyager: shooting stars** — 4 simultaneous tracks with staggered periods (5–11s) so 1–2 are visible at any moment. Per-spawn random origin, direction, and color (cyan-white / magenta-rose / gold). Sharp 1px streak with head-to-tail taper. Pass behind the planet for proper deep-space depth.
- **Press-play hint flyout** — appears above the play button on first reconnect-with-no-audio per session. Auto-hides on timeout or when real audio signal is detected. Replaces the "click BUG → Copy → paste in chat" toast for the benign no-audio case.
- **Per-FX strength memory** — each image FX (Rain, Fog, VHS, etc.) remembers its own strength independently. Persisted to localStorage as `IKANDY-fx-strengths`. Switching between FX types snaps the slider to each one's saved value.
- **Per-scene intensity memory** — same pattern for scenes. Each scene (Voyager, Aurora, Singularity, etc.) remembers its own intensity. Persisted as `IKANDY-scene-intensities`. Falls back to the legacy global value for scenes never individually tuned.
- **Hide-options menu: per-feature on/off sliders** — each row in the right-click hide menu (User controls, Album art & progress, Connection status) now has a slider toggle that hard-disables the feature regardless of UI hide state. Persisted independently of the existing "keep visible while hidden" checkmarks.

### Changed
- **Audio chain reworked** — boost gain dropped from 4× to 1× (unity), and a `WaveShaperNode` soft-clipper (tanh, drive 0.7, 2× oversampling) inserted between source and analyser. Previous chain produced hard digital clipping (waveform slammed 0/255 rails as a square wave) on normal-volume sources like Spotify. New chain stays nearly linear through ±0.7 input and only soft-bends true peaks. Affects all scenes that read the analyser.
- **Spotify lyric timing** — replaced fixed 200ms latency compensation with measured per-request RTT (`half-RTT + 25ms`, clamped 50–500ms) in `main.js`. Renderer-side anchoring now uses `state.timestamp` to subtract IPC delay (5–30ms). Combined accuracy: ~30ms of true playback position, vs hundreds of ms before. Affects both Classic and Physics lyric modes equally.
- **Particle Burst beat detection rewritten as adaptive** — replaced fixed `RISE_MIN=0.04` / `FLOOR=0.08` thresholds with rolling baseline + dynamic range tracking. Auto-calibrates to the song: thresholds derive from the actual loudness of the music being played. Fires on any source/audio chain gain. Removed the `bass >= peak * 0.85` gate that suppressed back-to-back kicks. Burst intensity now normalized by the song's own dynamic range.
- **Reconnect Audio self-heal** — added a third attempt step. When the second attempt (context rebuild) still produces silence, attempts a fresh `getDisplayMedia` re-acquire to re-bind to the current Windows default output device. Bounded with `_acquireAttempted` flag to prevent infinite loops. Skipped for the Stereo Mix fallback path so the 5.1/7.1 customer fix is preserved.
- **Reconnect Audio: silent failure handling** — instead of a "click BUG → Copy" bug-report toast, a friendly amber flyout appears above the play button: `▶ Press Play in your source app`. Auto-dismisses after 10s or when the analyser detects real signal (whichever first). Only shows when `_hasSeenAudio` is false (first time per session) — once any signal has been detected, subsequent silent reconnects produce no flyout.
- **Reconnect Audio: console noise** — `[IKANDY] Self-heal retry silent...` and similar recovery-flow warnings no longer pile into the BUG panel. Extended the warn-skip pattern in the `console.warn` hijack to ignore self-heal / re-acquire / sample rate mismatch / stereo-mix fallback / auto-connect messages. Real bugs still surface; recovery flow info doesn't.
- **Waveray waveform** — amplitude clamped so peaks always stay inside the unfaded center band (was overflowing to fill the whole canvas at full bass). Intensity slider now scales the entire wave amplitude (was only scaling the bass-reactive component, so I=0.2 still produced full-size waves).
- **Waveray lasers retuned** — beams ~3× thinner (was up to 45px wide on bass peaks, now ~12px). Three-pass rendering: outer haze (3.2× width, low alpha), bright sharp core (98%-lightness pinpoint at 0%, hard falloff by 30%), mirror beam. Reads as laser beams instead of floodlights.
- **Fog shader rewritten** — replaced 19 rigid primitives (6 ellipse fog banks + 8 mid wisps + 5 high wisps) with three layers of domain-warped fbm. Fog now flows as a continuous medium rather than drifting as discrete blobs. Each layer's sample point is warped by a second fbm field, producing real curl-noise rolling motion. Bottom-heavy vertical gradient (fog hugs ground), depth-shifted color (cool grey → warm cream), upper-half haze floor lifted so fog reads everywhere not just at the bottom.
- **Fog strength baseline bumped** — density threshold lowered (0.38 → 0.28), cap raised (0.86 → 0.92), strength multiplier 1.25× baked in. Default strength now reads as visibly thick.
- **Voyager: lighting model** — replaced the multiplicative terminator that drove the night side to literal zero with proper ambient + diffuse (ambient 0.18, diffuse 1.25). Night side now stays dimly visible so storms read against it. Removed the audio modulation from the cloud noise time-base — clouds now flow at a constant rate, eliminating the "shaking world" effect that came from `u_mid` retroactively shifting the noise sample point.
- **Voyager: intensity curve** — final multiplier changed from `col * u_intensity` to `col * (0.5 + u_intensity)`. Default 1.0 reads as the previous 2.0 ("rich"). Slider 0 still produces a dim but visible image.
- **Spotify auth port handling (`main.js`)** — `startAuthServer` now returns a Promise that resolves with the actual port. `start-auth` awaits the resolve and aborts with a clear error message ("Port 8888 is in use by another app...") if the registered port wasn't acquired. Previously the server silently fell back to a random port while the auth URL still asked Spotify to redirect to 8888 → user got a connection-refused page in their browser with no in-app feedback.
- **`buildSceneProgram` hardened** — now checks both `COMPILE_STATUS` and `LINK_STATUS` and returns `null` on failure. Render functions already check `if (!gl || !_xxxProgram) return;`, so failed shaders now correctly short-circuit instead of producing a flood of `INVALID_OPERATION: drawArrays: no valid shader program in use` runtime errors. Real GLSL compile errors surface cleanly to the BUG panel instead.
- **Image FX + Scene coexistence** — `setImgFx` no longer disables scenes. Scenes and image FX can run simultaneously; switching between FX types preserves whatever scene the user enabled. Fresh image upload OR folder pick still resets everything (FX = Rain, waveform off, scene off) as a clean slate.
- **Scene selection no longer disables waveform** — `selectScene` used to call `toggleViz()`. Removed. Waveform now stays under user control unless they upload an image, pick a folder, or activate a Vibe FX.

### Fixed
- **Rain condensation beads cell-clipping** — the static beads loop iterated only `(0,0)→(1,1)` from the current cell (current + 3 forward neighbors). Drops centered in cells *up*, *left*, or *up-left* whose footprint extended into the current pixel were never drawn — produced visible rectangular cutoffs where drop circles crossed cell boundaries. Replaced with a 3×3 full-neighborhood scan. Sliding/hero drops were unaffected (they use absolute-position lists, not cell-based).
- **Voyager shader compile error** on stricter WebGL drivers — replaced integer-literal vec3 constructors (`vec3(0,0,0)`) with explicit floats (`vec3(0.0, 0.0, 0.0)`). GLSL ES 1.00 spec technically allows int-to-float in vec constructors, but real-world drivers (Intel iGPUs, older Nvidia) reject it.
- **Voyager: vec3 over-construction** — `vec3(rn * 2.5, u_time * ...)` was vec3 + float = 4 components, rejected as "too many arguments." Reworked to add a 3D offset vector instead: `rn * 2.5 + vec3(0.0, 0.0, u_time * ...)`. Same animated-clouds effect, valid GLSL.
- **Voyager lightning cell artifacts** — initial implementation used `floor(stormSample * 6.0)` for per-cell hash flicker, which made entire cubic cells flash uniformly as visible squares. Replaced with continuous high-frequency fbm sparkle — natural irregular shapes, no cell artifacts.
- **Voyager self-heal infinite loop** — the fresh `getDisplayMedia` re-acquire was passing `_isRetry=false` on the recursive call, restarting the whole self-heal cycle on the silent fresh stream. Added `_acquireAttempted` parameter; recursion now guaranteed to terminate.
- **Mutual exclusion: chromatic ↔ waveform invariant** — when waveform is disabled (manually, or by a Vibe activation), chromatic is now also disabled. Previously chromatic stayed in a "true but invisible" state with the toggle button reading "On" while doing nothing. Toggle button state now always matches reality.
- **Mutual exclusion: chromatic ↔ vibe** — activating chromatic now disables any active vibe (image FX). Activating chromatic still auto-enables waveform if off, since chromatic is a post-process on viz pixels. Net invariant: viz pipeline (waveform + chromatic) and image-FX pipeline (vibe) cannot both run.

### Removed
- The old "checkered cells light up" lightning detection in Voyager (replaced with continuous fbm sparkle).
- Cell-hash phase flicker math from Voyager storms.
- Bug-report toast on the no-audio reconnect case.
