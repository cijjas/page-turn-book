// Playground: every setting of <page-turn-book> on a panel, saved between reloads.

import GUI from 'lil-gui';
import '../src/page-turn-book.js';
import { DEFAULT_CONFIG, PAPERS } from '../src/page-turn-book.js';
import { intemperies } from './intemperies.js';

const book = document.getElementById('book');
const status = document.getElementById('status');
const STORE = 'page-turn-book-playground';

// slider ranges: [min, max, step]; keys marked * rebuild the book when released
const RANGES = {
  book: { aspect: [.5, 2, .01, '*'], pageWidth: [256, 2048, 64, '*'], fit: [.3, 1.3, .01], perspective: [8, 100, 1], visibleSheets: [1, 30, 1] },
  material: { metalness: [0, 1, .01], showThrough: [0, .3, .005], inkGloss: [0, 1, .01] },
  cover: { overhang: [0, .06, .001], thickness: [0, .06, .001], raise: [0, .05, .001], pressPages: [0, 1, .01], grain: [.25, 8, .05], contrast: [0, .3, .001], bump: [0, 3, .01], roughness: [0, 1, .01], metalness: [0, 1, .01] },
  specks: { size: [.2, 8, .01], darken: [0, 1, .01], roughen: [0, 1, .01] },
  shape: { liftMaxX: [.01, 1, .01], liftMaxZ: [0, .2, .001], liftDipX: [.01, 1, .01], liftDipZ: [0, .2, .001], liftMidX: [.01, .99, .01], liftMidZ: [0, .2, .001], liftEdgeZ: [0, .2, .001], wrinkle: [0, .6, .005] },
  light: { ambient: [0, 6, .05], sun: [0, 10, .05], sunX: [-10, 10, .1], sunY: [-10, 10, .1], sunZ: [.5, 12, .1], shadow: [0, 1, .01] },
  curl: { angleMaxDeg: [0, 90, 1], curlArc: [0, 2, .01], curlArcJitter: [0, 1, .01], curlAngleJitter: [0, 1, .01], curlTiltJitterDeg: [0, 30, .5], cornerRollMax: [0, 6, .05], directionSmoothTime: [.01, 2, .01], curveSmoothTime: [.01, 2, .01] },
  hover: { progress: [0, .25, .005], smoothTime: [.05, 5, .05], gapToSheetAbove: [0, .5, .01] },
  riffle: { startTime: [.05, 1.5, .01], firstFlipTime: [.1, 3, .05], fastestFlipTime: [.05, 2, .01], speedUpSheets: [1, 60, 1], firstGapShare: [.01, 1, .01], fastestGapShare: [.005, .5, .005], moveSlopPx: [0, 200, 1] },
  drag: { turnFraction: [.2, 2, .01], progressSmoothTime: [.05, 3, .05], fallTime: [.1, 3, .05], fallTimeExponent: [.1, 2, .05], landingSpeed: [0, 3, .05], commitProgress: [0, 1, .01], clickSlopPx: [0, 40, 1] },
  flip: { flipTime: [.1, 3, .05], followArcGainMin: [.5, 2, .01], followArcGainMax: [.5, 2, .01] },
};
const TITLES = { cover: 'Hard cover', book: 'Book', material: 'Material', specks: 'Specks (original paper)', shape: 'Resting shape', light: 'Light & shadow', curl: 'Curl', hover: 'Hover', riffle: 'Hold to riffle', drag: 'Drag', flip: 'Turn' };

// ---- state (persisted)
const defaults = () => ({
  content: 'Sample pages', samplePages: 24,
  layout: { width: 100, height: 100, stage: '#f6f6f3', outline: false },
  paper: { preset: 'original', scale: 1, contrast: 0, bump: 0, roughness: .5 },
  config: structuredClone(DEFAULT_CONFIG),
});
let state = defaults();
try { const saved = JSON.parse(localStorage.getItem(STORE)); if (saved?.config?.light) for (const k of ['bounce', 'bounceWidth', 'bounceSheen', 'bounceRight']) delete saved.config.light[k]; if (saved) localStorage.setItem(STORE, JSON.stringify(saved)); } catch {}
try { const saved = JSON.parse(localStorage.getItem(STORE)); if (saved) state = { ...state, ...saved, config: { ...state.config, ...Object.fromEntries(Object.entries(saved.config ?? {}).map(([k, v]) => [k, { ...state.config[k], ...v }])) } }; } catch {}
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch {} };

// ---- content
let userImages = null, intemperiesData = null;
async function loadContent() {
  status.textContent = 'loading pages…';
  if (state.content === 'Intemperies') {
    try { intemperiesData ??= await intemperies(); }
    catch { status.textContent = 'Intemperies pages are not in this copy — showing samples'; state.content = 'Sample pages'; return loadContent(); }
    book.pageColor = intemperiesData.pageColor;
    book.pageCount = intemperiesData.pageCount;
    book.renderPage = intemperiesData.renderPage;
  } else if (state.content === 'Sample pages') {
    book.pageColor = '#f4f0e6';
    book.pageCount = state.samplePages;
    book.renderPage = samplePage;
  } else if (userImages) {
    book.renderPage = null; book.pageColor = '#f4f0e6';
    book.pages = userImages;
  }
}

// ---- layout
function applyLayout() {
  const s = document.documentElement.style, l = state.layout;
  s.setProperty('--book-w', l.width + '%'); s.setProperty('--book-h', l.height + '%');
  s.setProperty('--stage', l.stage); s.setProperty('--outline', l.outline ? '#9aa3ad' : 'transparent');
}

// ---- panel
// double-click any control to put it back to its default
const resettable = (ctrl, value) => { ctrl.domElement.addEventListener('dblclick', e => { e.preventDefault(); ctrl.setValue(typeof value === 'function' ? value() : value); }); return ctrl; };
const BASE = defaults();
const gui = new GUI({ title: 'page-turn-book', width: 300 });
const content = gui.addFolder('Content');
content.add(state, 'content', ['Intemperies', 'Sample pages', 'Your images…']).name('pages').onChange(async v => {
  if (v === 'Your images…') return pickImages();
  save(); await loadContent();
});
resettable(content.add(state, 'samplePages', 2, 400, 2), BASE.samplePages).name('sample page count').onFinishChange(() => { save(); if (state.content === 'Sample pages') loadContent(); });

const layout = gui.addFolder('Size & stage');
resettable(layout.add(state.layout, 'width', 20, 100, 1), BASE.layout.width).name('width %').onChange(() => { applyLayout(); save(); });
resettable(layout.add(state.layout, 'height', 20, 100, 1), BASE.layout.height).name('height %').onChange(() => { applyLayout(); save(); });
resettable(layout.addColor(state.layout, 'stage'), BASE.layout.stage).name('background').onChange(() => { applyLayout(); save(); });
layout.add(state.layout, 'outline').name('show element box').onChange(() => { applyLayout(); save(); });

const paperF = gui.addFolder('Paper');
const paperCtl = {};
paperCtl.preset = paperF.add(state.paper, 'preset', Object.keys(PAPERS)).name('preset').onChange(async v => {
  const spec = await book.setPaper(v); Object.assign(state.paper, pick(spec)); paperF.controllersRecursive().forEach(c => c.updateDisplay()); save();
});
for (const [k, r] of Object.entries({ scale: [.25, 8, .05], contrast: [0, .3, .001], bump: [0, 3, .01], roughness: [0, 1, .01] })) {
  paperCtl[k] = resettable(paperF.add(state.paper, k, ...r), () => PAPERS[state.paper.preset]?.[k] ?? BASE.paper[k]).name(k === 'scale' ? 'grain (repeats/page)' : k).onChange(v => { book.tunePaper({ [k]: v }); save(); });
}
paperF.add({ custom: () => pickTexture() }, 'custom').name('custom texture image…');

for (const [group, keys] of Object.entries(RANGES)) {
  const f = gui.addFolder(TITLES[group]);
  for (const [key, [min, max, step, rebuild]] of Object.entries(keys)) {
    const c = resettable(f.add(state.config[group], key, min, max, step), DEFAULT_CONFIG[group][key]);
    if (rebuild) c.onFinishChange(v => { book.set(`${group}.${key}`, v); save(); });
    else c.onChange(v => { book.set(`${group}.${key}`, v); save(); });
  }
  for (const [key, v] of Object.entries(state.config[group])) if (typeof v === 'boolean') resettable(f.add(state.config[group], key), DEFAULT_CONFIG[group][key]).name(key === 'hard' ? 'hard cover' : key).onChange(b => { book.set(`${group}.${key}`, b); save(); });
  for (const [key, v] of Object.entries(state.config[group])) if (typeof v === 'string' && !v.startsWith('#')) resettable(f.add(state.config[group], key, Object.keys(PAPERS)), DEFAULT_CONFIG[group][key]).onChange(t => { book.set(`${group}.${key}`, t); save(); });
  for (const [key, v] of Object.entries(state.config[group])) if (typeof v === 'string' && v.startsWith('#')) resettable(f.addColor(state.config[group], key), DEFAULT_CONFIG[group][key]).onChange(c => { book.set(`${group}.${key}`, c); save(); });
  if (!['book', 'light', 'cover'].includes(group)) f.close();
}

const nav = gui.addFolder('Navigate');
const navState = { sheet: 0 };
nav.add({ prev: () => book.prev() }, 'prev').name('← previous');
nav.add({ next: () => book.next() }, 'next').name('next →');
const sheetCtl = nav.add(navState, 'sheet', 0, 1, 1).name('jump to sheet').onFinishChange(v => book.jumpTo(v));

gui.add({ copy: copyConfig }, 'copy').name('copy settings (JSON)');
gui.add({ reset: () => { localStorage.removeItem(STORE); location.reload(); } }, 'reset').name('reset everything');

// ---- wiring
book.addEventListener('spread', e => {
  navState.sheet = e.detail.sheet; sheetCtl.max(book.sheetCount).updateDisplay();
  const { left, right } = e.detail;
  status.textContent = `sheet ${e.detail.sheet} / ${book.sheetCount} · pages ${left ?? '–'} | ${right ?? '–'}`;
});
book.addEventListener('ready', async () => {
  const spec = await book.setPaper({ preset: state.paper.preset, ...pick(state.paper) });
  Object.assign(state.paper, pick(spec));
});

book.config = state.config;
book.setAttribute('paper', state.paper.preset);
applyLayout();
if (state.content === 'Your images…') state.content = 'Sample pages';
loadContent();

// ---- helpers
function pick(s) { return { scale: s.scale, contrast: s.contrast, bump: s.bump, roughness: s.roughness }; }
function pickFiles(multiple) {
  return new Promise(res => { const i = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', multiple }); i.onchange = () => res([...i.files]); i.click(); });
}
async function pickImages() {
  const files = await pickFiles(true);
  if (!files.length) { state.content = 'Sample pages'; content.controllers[0].updateDisplay(); return; }
  userImages = files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).map(f => URL.createObjectURL(f));
  status.textContent = `${files.length} images`;
  loadContent();
}
async function pickTexture() {
  const [f] = await pickFiles(false); if (!f) return;
  const spec = await book.setPaper({ texture: URL.createObjectURL(f), ...pick(state.paper) });
  Object.assign(state.paper, pick(spec)); status.textContent = `paper: ${f.name}`;
}
async function copyConfig() {
  const out = { paper: { preset: state.paper.preset, ...pick(state.paper) }, config: book.config };
  const text = JSON.stringify(out, null, 2);
  try { await navigator.clipboard.writeText(text); status.textContent = 'settings copied'; } catch { console.log(text); status.textContent = 'settings printed to console'; }
}

// sample pages: a cover, then numbered spreads with a picture block and text lines
const HUES = [18, 200, 140, 35, 260, 90, 330, 170];
function samplePage(i, { width: W, height: H }) {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'), u = W / 100, right = i % 2 === 0;
  if (i === 0) {
    const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#2b3a55'); g.addColorStop(1, '#0f1726');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.fillStyle = '#efe7d6'; x.font = `400 ${11 * u}px "Instrument Serif", Georgia, serif`; x.textAlign = 'center';
    x.fillText('page-turn-book', W / 2, H * .3);
    return c;
  }
  x.fillStyle = '#f4f0e6'; x.fillRect(0, 0, W, H);
  const L = right ? 11 * u : 7 * u, R = right ? 7 * u : 11 * u, hue = HUES[i % HUES.length];
  const g = x.createLinearGradient(0, H * .07, 0, H * .55);
  g.addColorStop(0, `hsl(${hue} 45% 62%)`); g.addColorStop(1, `hsl(${(hue + 40) % 360} 35% 30%)`);
  x.fillStyle = g; x.fillRect(L, H * .07, W - L - R, H * .45);
  x.fillStyle = '#1d1b18'; x.font = `400 ${7 * u}px "Instrument Serif", Georgia, serif`; x.textAlign = 'left';
  x.fillText(`Chapter ${Math.ceil(i / 2)}`, L, H * .63);
  x.fillStyle = '#b9b2a4';
  for (let k = 0; k < 9; k++) x.fillRect(L, H * .68 + k * 3.4 * u, (W - L - R) * (k === 8 ? .55 : .97 - (k % 3) * .04), 1.1 * u);
  x.fillStyle = '#8a8478'; x.font = `400 ${2.2 * u}px ui-monospace, Menlo, monospace`;
  x.textAlign = right ? 'right' : 'left'; x.fillText(String(i), right ? W - R : L, H * .95);
  return c;
}
