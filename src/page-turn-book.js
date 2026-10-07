// <page-turn-book>: a 3D book whose pages curl and turn under the pointer.
//
//   <page-turn-book paper="cotton" aspect="1.333" auto-open style="height: 80vh">
//     <img src="cover.jpg"> <img src="p1.jpg"> <img src="p2.jpg"> …
//   </page-turn-book>
//
// Pages come from child <img> elements, or from the `pages` property (URLs, images, canvases), or from
// `renderPage(index, { width, height })` for pages you draw yourself. Page 0 is the cover; even pages sit on the right.
//
// Attributes: paper, aspect, page-width, start, auto-open, keyboard, fit, perspective
// Properties: pages, renderPage, pageColor, config (any part of DEFAULT_CONFIG)
// Methods:    next(), prev(), jumpTo(sheet), goToPage(index), setPaper(name|object), tunePaper({…}), set(path, value)
// Events:     spread → detail { sheet, left, right };  ready

import { createBook, DEFAULT_CONFIG, mergeConfig } from './engine.js';
import { PAPERS } from './paper.js';

export { DEFAULT_CONFIG, PAPERS };

const REBUILD = new Set(['aspect', 'page-width']);

export class PageTurnBook extends HTMLElement {
  static observedAttributes = ['paper', 'aspect', 'page-width', 'start', 'auto-open', 'fit', 'perspective'];

  #engine = null; #keys = e => this.#onKey(e); #pages = null; #render = null; #pageColor = '#f3efe6'; #config = {}; #queued = false; #sheet = 0; #count = 0;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      :host { display: block; position: relative; min-height: 240px; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
      .frame { position: absolute; inset: 0; }
      slot { display: none; }
    </style><div class="frame" part="frame"></div><slot></slot>`;
    this.frame = root.querySelector('.frame');
    root.querySelector('slot').addEventListener('slotchange', () => { if (!this.#pages && !this.#render) this.#rebuild(); });
  }

  connectedCallback() { this.#rebuild(); document.addEventListener('keydown', this.#keys); }
  disconnectedCallback() { document.removeEventListener('keydown', this.#keys); this.#engine?.destroy(); this.#engine = null; }

  attributeChangedCallback(name, old, value) {
    if (old === value || !this.#engine) return;
    if (REBUILD.has(name) || name === 'start') return this.#rebuild();
    if (name === 'paper') this.#engine.setPaper(value || undefined);
    if (name === 'fit') this.#engine.set('book.fit', +value);
    if (name === 'perspective') this.#engine.set('book.perspective', +value);
  }

  // ---- properties
  set pages(v) { this.#pages = v; this.#rebuild(); }
  get pages() { return this.#pages; }
  set renderPage(fn) { this.#render = fn; this.#rebuild(); }
  get renderPage() { return this.#render; }
  set pageColor(v) { this.#pageColor = v; this.#rebuild(); }
  get pageColor() { return this.#pageColor; }
  set config(c) {
    const rebuild = c?.book && ('aspect' in c.book || 'pageWidth' in c.book);
    this.#config = mergeConfig(mergeConfig(DEFAULT_CONFIG, this.#config), c);
    if (rebuild || !this.#engine) this.#rebuild(); else this.#engine.set(c);
  }
  get config() { return this.#engine?.config ?? mergeConfig(DEFAULT_CONFIG, this.#config); }

  // ---- methods
  next() { this.#engine?.next(); }
  prev() { this.#engine?.prev(); }
  jumpTo(sheet) { this.#engine?.jumpTo(sheet); }
  goToPage(index) { this.#engine?.goToPage(index); }
  setPaper(p) { return this.#engine?.setPaper(p); }
  tunePaper(p) { return this.#engine?.tunePaper(p); }
  set(path, value) {
    if (path === 'book.aspect' || path === 'book.pageWidth') { this.config = { book: { [path.split('.')[1]]: value } }; return; }
    const [g, k] = path.split('.'); (this.#config[g] ??= {})[k] = value;
    this.#engine?.set(path, value);
  }
  get paper() { return this.#engine?.paper; }
  get sheet() { return this.#sheet; }
  get sheetCount() { return this.#count; }

  // ---- internals
  #onKey(e) {
    if (!this.hasAttribute('keyboard') || e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.('input, select, textarea, [contenteditable]')) return;
    const act = { ArrowRight: () => this.next(), ArrowLeft: () => this.prev(), Home: () => this.jumpTo(0), End: () => this.jumpTo(this.sheetCount) }[e.key];
    if (act) { act(); e.preventDefault(); }
  }

  #rebuild() {
    if (this.#queued || !this.isConnected) return;
    this.#queued = true;
    queueMicrotask(() => { this.#queued = false; this.#build(); });
  }

  #build() {
    const keepPaper = this.#engine?.paper;
    const keepSheet = this.#engine ? this.#sheet : null;
    this.#engine?.destroy(); this.#engine = null;
    const sources = this.#pages ?? [...this.querySelectorAll(':scope > img')].map(img => img.currentSrc || img.src);
    const pageCount = this.#render ? (this.#config.pageCount ?? this.getAttribute('pages') ?? 0) | 0 : sources.length;
    if (!pageCount) return;
    this.#count = Math.ceil(pageCount / 2);

    const aspect = +(this.getAttribute('aspect') ?? this.#config.book?.aspect ?? DEFAULT_CONFIG.book.aspect);
    const pageWidth = +(this.getAttribute('page-width') ?? this.#config.book?.pageWidth ?? DEFAULT_CONFIG.book.pageWidth);
    const book = { ...this.#config.book, aspect, pageWidth };
    if (this.hasAttribute('fit')) book.fit = +this.getAttribute('fit');
    if (this.hasAttribute('perspective')) book.perspective = +this.getAttribute('perspective');

    const render = this.#render ?? ((i, size) => toPageCanvas(sources[i], size));
    this.#engine = createBook(this.frame, {
      pageCount,
      renderPage: async (i, size) => toPageCanvas(await render(i, size), size),
      pageColor: this.#pageColor,
      config: { ...this.#config, book },
      paper: keepPaper ?? this.getAttribute('paper') ?? undefined,
      start: keepSheet ?? +(this.getAttribute('start') ?? 0),
      autoOpen: keepSheet === null && this.hasAttribute('auto-open'),
      onSpread: (sheet, pages) => { this.#sheet = sheet; this.dispatchEvent(new CustomEvent('spread', { detail: { sheet, ...pages } })); },
      onReady: () => this.dispatchEvent(new Event('ready')),
    });
  }

  set pageCount(n) { this.#config.pageCount = n; this.#rebuild(); }
}

// any image-ish source → a canvas exactly the page size (cropped like object-fit: cover)
async function toPageCanvas(v, { width, height }) {
  if (!v) return null;
  if (typeof v === 'string') v = await new Promise((res, rej) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = () => rej(new Error('image failed: ' + v)); im.src = v; });
  if (v instanceof HTMLCanvasElement && v.width === width && v.height === height) return v;
  const w = v.naturalWidth || v.videoWidth || v.width, h = v.naturalHeight || v.videoHeight || v.height;
  const c = document.createElement('canvas'); c.width = width; c.height = height;
  const x = c.getContext('2d'), k = Math.max(width / w, height / h);
  x.imageSmoothingQuality = 'high';
  x.drawImage(v, (width - w * k) / 2, (height - h * k) / 2, w * k, h * k);
  return c;
}

if (!customElements.get('page-turn-book')) customElements.define('page-turn-book', PageTurnBook);
