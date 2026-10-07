// Paper surfaces for the book.
//
// A paper is two grayscale maps plus four numbers:
//   toneMap    how the sheet's brightness varies (fibres, specks, mottling)
//   heightMap  the sheet's tooth, used as a bump map so light catches the grain
//   scale      how many times the maps repeat across one page width; higher = finer grain
//   contrast   brightness variation at one standard deviation of the tone map (0.04 = ±4%)
//   bump       strength of the tooth in the lighting
//   roughness  base roughness of the sheet (0 glossy … 1 matte)
//
// Presets are either generated here (tileable noise) or real scans from ambientCG (CC0).


export const PAPERS = {
  original: {
    label: 'Paper original (specks)', specks: true,
    scale: 1, contrast: 0, bump: 0, roughness: .5,
  },
  smooth: {
    label: 'Smooth', generate: 'flat',
    scale: 1, contrast: 0, bump: 0, roughness: .55,
  },
  fine: {
    label: 'Fine tooth', generate: 'fine',
    scale: 2, contrast: .03, bump: .35, roughness: .62,
  },
  laid: {
    label: 'Laid', generate: 'laid',
    scale: 1, contrast: .03, bump: .45, roughness: .64,
  },
  cotton: {
    label: 'Cotton rag (scan)',
    toneMap: new URL('./textures/cotton-tone.jpg', import.meta.url).href, heightMap: new URL('./textures/cotton-height.jpg', import.meta.url).href,
    scale: 2.5, contrast: .02, bump: .5, roughness: .72,
  },
  fiber: {
    label: 'Fibre (scan)',
    toneMap: new URL('./textures/fiber-tone.jpg', import.meta.url).href, heightMap: new URL('./textures/fiber-height.jpg', import.meta.url).href,
    scale: 2, contrast: .045, bump: .25, roughness: .64,
  },
  recycled: {
    label: 'Recycled (scan)',
    toneMap: new URL('./textures/recycled-tone.jpg', import.meta.url).href, heightMap: new URL('./textures/recycled-height.jpg', import.meta.url).href,
    scale: 2, contrast: .05, bump: .2, roughness: .6,
  },
};
export const DEFAULT_PAPER = 'original';

// Accepts a preset name, or an object: { preset?, texture?, toneMap?, heightMap?, scale?, contrast?, bump?, roughness? }.
// `texture` sets both maps at once. Maps can be URLs, images, canvases or ImageBitmaps.
export function paperSpec(input = DEFAULT_PAPER) {
  const o = typeof input === 'string' ? { preset: input } : { ...input };
  const base = PAPERS[o.preset] ?? (o.texture || o.toneMap || o.heightMap ? {} : PAPERS[DEFAULT_PAPER]);
  const spec = { ...base, ...o };
  if (o.texture) { spec.toneMap = o.texture; spec.heightMap = o.texture; delete spec.generate; }
  else if (o.toneMap || o.heightMap) delete spec.generate;
  spec.scale ??= 1; spec.contrast ??= .03; spec.bump ??= .3; spec.roughness ??= .6;
  return spec;
}

// Resolves a spec to drawable sources plus tone statistics: { tone, height, mean, std, spec }.
export async function loadPaper(input) {
  const spec = paperSpec(input);
  let tone, height;
  if (spec.generate) tone = height = generate(spec.generate);
  else {
    [tone, height] = await Promise.all([toSource(spec.toneMap ?? spec.heightMap), toSource(spec.heightMap ?? spec.toneMap)]);
  }
  const { mean, std } = stats(tone);
  return { tone, height, mean, std, spec };
}

function toSource(v) {
  if (typeof v !== 'string') return Promise.resolve(v);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`paper texture failed to load: ${v}`));
    img.src = v;
  });
}

function stats(src) {
  try {
    // measured at full resolution on a crop: downscaling would average the grain away and understate its spread
    const w = src.naturalWidth || src.width, h = src.naturalHeight || src.height, n = Math.min(512, w, h);
    const c = document.createElement('canvas'); c.width = c.height = n;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(src, 0, 0);
    const d = x.getImageData(0, 0, n, n).data;
    let s = 0, s2 = 0;
    for (let i = 0; i < d.length; i += 4) { const l = (.299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2]) / 255; s += l; s2 += l * l; }
    const m = s / (n * n);
    return { mean: m, std: Math.max(Math.sqrt(Math.max(0, s2 / (n * n) - m * m)), 1e-3) };
  } catch {
    return { mean: .5, std: .1 };   // cross-origin image without CORS: no stats, sensible defaults
  }
}

// ---- generated papers (all tile seamlessly)
const cache = new Map();
function generate(kind) {
  if (cache.has(kind)) return cache.get(kind);
  const N = kind === 'flat' ? 4 : 1024;
  const field = new Float32Array(N * N).fill(.5);
  if (kind !== 'flat') {
    const rand = mulberry32(kind === 'laid' ? 7 : 3);
    const white = new Float32Array(N * N).map(() => rand());
    const tooth = blur(white, N);                         // ~1–2 texel grains
    const cloud = periodicNoise(N, 32, rand), mottle = periodicNoise(N, 8, rand);
    for (let i = 0; i < field.length; i++) field[i] = kind === 'laid' ? .55 * tooth[i] + .3 * cloud[i] + .15 * mottle[i] : .88 * tooth[i] + .09 * cloud[i] + .03 * mottle[i];
    if (kind === 'laid') {
      const lines = 146, chainEvery = 128;                // horizontal laid lines, vertical chain lines
      for (let y = 0; y < N; y++) {
        const laid = .5 + .5 * Math.sin(y / N * lines * 2 * Math.PI);
        for (let x = 0; x < N; x++) {
          const dx = Math.min(x % chainEvery, chainEvery - x % chainEvery);
          const i = y * N + x;
          field[i] = .65 * field[i] + .3 * laid + .05 - .18 * Math.exp(-dx * dx / 4);
        }
      }
    }
    normalize(field);
  }
  const c = document.createElement('canvas'); c.width = c.height = N;
  const x = c.getContext('2d'), img = x.createImageData(N, N);
  for (let i = 0; i < field.length; i++) { const v = Math.round(field[i] * 255); img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  x.putImageData(img, 0, 0);
  cache.set(kind, c);
  return c;
}
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function blur(src, N) {
  const out = new Float32Array(src.length);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let s = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += src[((y + j + N) % N) * N + (x + i + N) % N] * (i === 0 && j === 0 ? 4 : i === 0 || j === 0 ? 2 : 1);
    out[y * N + x] = s / 16;
  }
  return out;
}
function periodicNoise(N, cells, rand) {
  const g = Float32Array.from({ length: cells * cells }, rand), out = new Float32Array(N * N), at = (i, j) => g[((j + cells) % cells) * cells + (i + cells) % cells];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const fx = x / N * cells, fy = y / N * cells, ix = Math.floor(fx), iy = Math.floor(fy);
    let tx = fx - ix, ty = fy - iy; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
    const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * tx, b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * tx;
    out[y * N + x] = a + (b - a) * ty;
  }
  return out;
}
function normalize(f) {
  let lo = Infinity, hi = -Infinity;
  for (const v of f) { if (v < lo) lo = v; if (v > hi) hi = v; }
  for (let i = 0; i < f.length; i++) f[i] = (f[i] - lo) / (hi - lo || 1);
}
