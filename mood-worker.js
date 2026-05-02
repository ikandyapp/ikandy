// mood-worker.js — image pixel analysis, no DOM access
// Receives: { fileUrl, pixels: Uint8ClampedArray (RGBA), width, height }
// Returns:  { fileUrl, metrics, lights }
//
// lights[] entries: { x, y, r, g, b, brightness }
//   x, y are normalized screen UV [0,1] with Y already flipped to match
//   the bg-canvas shader convention (v_uv.y = 1 at screen top).

self.onmessage = function ({ data }) {
  const { fileUrl, pixels, width, height, skipLights } = data;
  const metrics = computeMetrics(pixels, width, height);
  const lights  = skipLights ? [] : extractLights(pixels, width, height);

  const fname = fileUrl.split('/').pop() || fileUrl;
  const m = metrics;
  const T = m.colorTemp >= 0 ? `+${m.colorTemp.toFixed(2)}` : m.colorTemp.toFixed(2);
  const top = lights[0];
  const topStr = top
    ? `top:(${top.x.toFixed(2)},${top.y.toFixed(2)}) rgb(${(top.r*255|0)},${(top.g*255|0)},${(top.b*255|0)}) B:${top.brightness.toFixed(2)}`
    : 'no lights';
  self.postMessage({ type: 'log', text:
    `[pulse] ${fname} | B:${m.brightness.toFixed(2)} sd:${m.stdDev.toFixed(2)} S:${m.saturation.toFixed(2)} T:${T} hue:${m.dominantHue} | lights:${lights.length} ${topStr}`
  });

  self.postMessage({ fileUrl, metrics, lights });
};

function computeMetrics(pixels, width, height) {
  const n = (width * height) || 1;
  let sumL = 0, sumL2 = 0, sumS = 0, sumR = 0, sumB = 0;
  const hueBuckets = [0, 0, 0, 0, 0, 0, 0, 0]; // 8 × 45° slices
  let coloredPixels = 0;

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i]     / 255;
    const g = pixels[i + 1] / 255;
    const b = pixels[i + 2] / 255;

    const L = 0.299 * r + 0.587 * g + 0.114 * b;
    sumL  += L;
    sumL2 += L * L;
    sumR  += r;
    sumB  += b;

    const mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
    const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
    const d  = mx - mn;
    const l  = (mx + mn) * 0.5;
    const denom = 1 - Math.abs(2 * l - 1);
    sumS += (denom < 1e-6) ? 0 : d / denom; // guard pure black/white pixels

    if (d > 0.1) {
      coloredPixels++;
      let h;
      if      (mx === r) h = ((g - b) / d + 6) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else               h = (r - g) / d + 4;
      hueBuckets[Math.floor(h * 60 / 45) % 8]++;
    }
  }

  const brightness = sumL / n;
  const stdDev     = Math.sqrt(Math.max(0, sumL2 / n - brightness * brightness));
  const saturation = sumS / n;
  const colorTemp  = (sumR - sumB) / n; // positive = warm, negative = cool

  const hueNames = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'magenta'];
  let dominantHue = 'neutral';
  if (coloredPixels > n * 0.15) {
    let maxVal = -1, maxIdx = 0;
    for (let i = 0; i < 8; i++) {
      if (hueBuckets[i] > maxVal) { maxVal = hueBuckets[i]; maxIdx = i; }
    }
    dominantHue = hueNames[maxIdx];
  }

  return { brightness, stdDev, saturation, colorTemp, dominantHue };
}

function extractLights(pixels, width, height) {
  const n = width * height;

  // Build luminance array
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    lum[i] = 0.299 * pixels[p] / 255
           + 0.587 * pixels[p + 1] / 255
           + 0.114 * pixels[p + 2] / 255;
  }

  // 80th-percentile brightness threshold
  const sorted = lum.slice().sort((a, b) => a - b);
  const threshold = sorted[Math.floor(n * 0.80)];

  // Find strict local maxima: candidate must be at least 5% brighter than
  // all neighbours (kills uniform sky/window regions that tie with neighbours)
  const R = 2;
  const DELTA = 0.05;
  const candidates = [];
  for (let y = R; y < height - R; y++) {
    for (let x = R; x < width - R; x++) {
      const idx = y * width + x;
      const v = lum[idx];
      if (v < threshold) continue;
      let secondMax = 0;
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          if (dx === 0 && dy === 0) continue;
          const n = lum[(y + dy) * width + (x + dx)];
          if (n > secondMax) secondMax = n;
        }
      }
      if (v < secondMax + DELTA) continue; // must beat neighbours by DELTA

      // Require saturation ≥ 0.35 — reject white/grey sky and window highlights
      const p = idx * 4;
      const r = pixels[p]     / 255;
      const g = pixels[p + 1] / 255;
      const b = pixels[p + 2] / 255;
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      const l  = (mx + mn) * 0.5;
      const sat = (mx === mn) ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1));
      if (sat < 0.35) continue;

      candidates.push({
        x:          x / (width  - 1),
        y:  1.0 -   y / (height - 1),
        r, g, b,
        brightness: v,
        score:      v * (1 + sat), // favors saturated bright over pure-white bright
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, 8);
}
