// Intemperies — de la Argentina: an editable page list and the page drawing.
// Vertical 21 × 28 cm pages; black or cream paper per movement; Instrument Serif titles, Paper Mono captions.
//
// The book is a flat list of entries. Photo entries carry a layout:
//   top      photo at the top, caption below (the default)
//   big      photo fills the page width, caption below
//   center   smaller photo in the middle of the page
//   bottom   caption at the top, photo at the bottom
//   full     photo bleeds off the page, caption over it
// Edits are kept in localStorage and can be exported as intemperies-layout.json; if that file exists in /public it is the starting point.

const ROMAN = ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII','XIII','XIV','XV'];
const MON = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];
const DARK = new Set(['Cuerpo','Ceniza','Atardecer','Campamento','Noche','Fin']);
const PAL = { black: { bg: '#0d0c0b', ink: '#ebe6da', dim: '#8e897e' }, cream: { bg: '#f5f0e5', ink: '#1d1b18', dim: '#8a8478' } };
const SERIF = '"Instrument Serif", Georgia, serif', MONO = '"Paper Mono", ui-monospace, monospace';
const COVER_PHOTO = 141;
export const LAYOUTS = ['top', 'big', 'center', 'bottom', 'full'];
export const KINDS = ['photo', 'blank', 'opener', 'title', 'index', 'closing', 'backcover'];
const STORE = 'intemperies-sequence';

export async function intemperies() {
  const { photos, flow } = await (await fetch('/intemperies.json')).json();
  const byI = Object.fromEntries(photos.map(p => [p.i, { ...p, src: '/' + p.src }]));
  const years = photos.map(p => +p.trip.slice(0, 4)).filter(Boolean);
  const Y0 = Math.min(...years), Y1 = Math.max(...years);
  const movements = flow.filter(m => m.name !== 'Fin');

  // ---- the default sequence, from the flow
  function defaultSequence() {
    const seq = [{ kind: 'cover', paper: 'black' }, { kind: 'title', paper: 'black' }, { kind: 'index', paper: 'black' }];
    flow.forEach((mv, k) => {
      const paper = DARK.has(mv.name) ? 'black' : 'cream';
      if (mv.name !== 'Fin') {
        if (seq.length % 2 === 0) seq.push({ kind: 'blank', paper });
        seq.push({ kind: 'opener', k, paper });
      } else if (seq.length % 2 === 0) seq.push({ kind: 'blank', paper });
      mv.ids.forEach(i => seq.push({ kind: 'photo', photo: i, layout: 'top', paper }));
    });
    if (seq.length % 2 === 1) seq.push({ kind: 'blank', paper: 'black' });
    seq.push({ kind: 'closing', paper: 'black' });
    if (seq.length % 2 === 1) seq.push({ kind: 'blank', paper: 'black' });
    seq.push({ kind: 'backcover', paper: 'black' });
    if (seq.length % 2 === 1) seq.push({ kind: 'blank', paper: 'black' });
    return seq;
  }
  let sequence = defaultSequence();
  try { const r = await fetch('/intemperies-layout.json'); if (r.ok) sequence = await r.json(); } catch {}
  try { const saved = JSON.parse(localStorage.getItem(STORE)); if (Array.isArray(saved) && saved.length) sequence = saved; } catch {}

  const openers = () => movements.map((m, k) => ({ k, name: m.name, page: sequence.findIndex(q => q.kind === 'opener' && q.k === k) }));
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(sequence)); } catch {} };

  await Promise.allSettled(['400 40px "Instrument Serif"', 'italic 400 40px "Instrument Serif"', '400 20px "Paper Mono"'].map(f => document.fonts.load(f)));

  async function renderPage(idx, { width: PW, height: PH }) {
    const pg = sequence[idx]; if (!pg) return null;
    const right = idx % 2 === 0, pal = PAL[pg.paper || 'black'], CQ = PW / 100;
    const c = document.createElement('canvas'); c.width = PW; c.height = PH;
    const x = c.getContext('2d');
    x.fillStyle = pal.bg; x.fillRect(0, 0, PW, PH);
    x.imageSmoothingQuality = 'high'; x.textBaseline = 'alphabetic';
    const mono = (s, col = pal.dim) => { x.font = `400 ${s}px ${MONO}`; x.fillStyle = col; };
    const fs = 2.15 * CQ, lh = fs * 1.5;
    const caption = (p, yLast, col = pal.dim) => {
      const lines = [p.trip.replace(/^\d{4}\s+/, '').toUpperCase(),
        [p.date ? `${+p.date.slice(8, 10)} ${MON[+p.date.slice(5, 7) - 1]} ${p.trip.slice(0, 4)}` : '', p.time].filter(Boolean).join(' · ')];
      mono(fs, col);
      lines.forEach((ln, k) => track(x, ln, right ? PW * .11 : PW * .89, yLast - (lines.length - 1 - k) * lh, fs * .02, right ? 'left' : 'right'));
      track(x, String(idx), right ? PW * .93 : PW * .07, yLast, 0, right ? 'right' : 'left');
    };
    const drawFit = (im, bx, by, bw, bh, align = 'start') => {
      const s = Math.min(bw / im.naturalWidth, bh / im.naturalHeight), w = im.naturalWidth * s, h = im.naturalHeight * s;
      const y = align === 'end' ? by + bh - h : align === 'center' ? by + (bh - h) / 2 : by;
      x.drawImage(im, bx + (bw - w) / 2, y, w, h);
    };
    switch (pg.kind) {
      case 'cover': {
        const im = await loadImage(byI[pg.photo ?? COVER_PHOTO].src), s = Math.max(PW / im.naturalWidth, PH / im.naturalHeight);
        x.drawImage(im, (PW - im.naturalWidth * s) / 2, (PH - im.naturalHeight * s) / 2, im.naturalWidth * s, im.naturalHeight * s);
        const g = x.createLinearGradient(0, 0, 0, PH);
        g.addColorStop(0, 'rgba(0,0,0,.30)'); g.addColorStop(.4, 'rgba(0,0,0,0)'); g.addColorStop(.75, 'rgba(0,0,0,.1)'); g.addColorStop(1, 'rgba(0,0,0,.38)');
        x.fillStyle = g; x.fillRect(0, 0, PW, PH);
        x.fillStyle = '#f2e5c9';
        x.font = `400 ${13.5 * CQ}px ${SERIF}`; x.textAlign = 'center'; x.fillText('INTEMPERIES', PW / 2, PH * .11 + 13.5 * CQ * .8);
        x.font = `400 ${3.4 * CQ}px ${SERIF}`; track(x, 'DE LA ARGENTINA', PW / 2, PH * .22 + 3.4 * CQ * .85, 3.4 * CQ * .55, 'center');
        x.font = `400 ${2.6 * CQ}px ${SERIF}`; track(x, 'CHRISTIAN IJJAS', PW / 2, PH * .93 - 2.6 * CQ * .25, 2.6 * CQ * .08, 'center');
        break;
      }
      case 'title':
        x.fillStyle = pal.ink; x.font = `400 ${9 * CQ}px ${SERIF}`; x.textAlign = 'center'; x.fillText('Intemperies', PW / 2, PH * .40 + 9 * CQ * .8);
        mono(2.2 * CQ); track(x, 'DE LA ARGENTINA', PW / 2, PH * .52 + 2.2 * CQ * .8, 2.2 * CQ * .4, 'center');
        break;
      case 'index': {
        const ns = 4.4 * CQ, ms = 2.1 * CQ, lh2 = ns * 1.55; let y = PH * .13;
        for (const o of openers()) {
          const base = y + lh2 / 2 + ns * .3;
          mono(ms); track(x, ROMAN[o.k], PW * .11, base, ms * .2);
          x.textAlign = 'right'; x.fillText(String(o.page), PW * .89, base);
          x.fillStyle = pal.ink; x.font = `400 ${ns}px ${SERIF}`; x.textAlign = 'left'; x.fillText(o.name, PW * .21, base);
          y += lh2;
        }
        break;
      }
      case 'opener': {
        const mv = movements[pg.k], lx = PW * .11;
        mono(2.4 * CQ); track(x, ROMAN[pg.k], lx, PH * .09 + 2.4 * CQ * .8, 2.4 * CQ * .3);
        let hs = 15 * CQ; x.font = `400 ${hs}px ${SERIF}`;
        const tw = x.measureText(mv.name).width; if (tw > PW * .8) { hs *= PW * .8 / tw; x.font = `400 ${hs}px ${SERIF}`; }
        x.fillStyle = pal.ink; x.textAlign = 'left'; x.fillText(mv.name, lx, PH * .14 + hs * .78);
        if (mv.line) {
          const qs = 5.2 * CQ, qlh = qs * 1.18; x.font = `italic 400 ${qs}px ${SERIF}`;
          const lines = wrapLines(x, mv.line, PW * .71);
          lines.forEach((ln, k) => x.fillText(ln, lx, PH * .8 - (lines.length - 1 - k) * qlh - qlh * .26));
        }
        if (mv.handoff) {
          mono(fs);
          const lines = wrapLines(x, '→ ' + mv.handoff.toUpperCase(), PW * .8, fs * .06);
          lines.forEach((ln, k) => track(x, ln, lx, PH * .93 - (lines.length - 1 - k) * lh - lh * .27, fs * .06));
        }
        break;
      }
      case 'photo': {
        const p = byI[pg.photo]; if (!p) break;
        const im = await loadImage(p.src), vert = im.naturalHeight > im.naturalWidth;
        const L = right ? 11 : 7, R = right ? 7 : 11, bx = PW * L / 100, bw = PW * (100 - L - R) / 100;
        const last = PH * .935 - lh * .27;
        switch (pg.layout || 'top') {
          case 'big': drawFit(im, bx, PH * .07, bw, PH * .8); caption(p, last); break;
          case 'center': drawFit(im, PW * .2, PH * .22, PW * .6, PH * .5, 'center'); caption(p, last); break;
          case 'bottom': caption(p, PH * .065 + lh * .73); drawFit(im, bx, PH * .14, bw, PH * .79, 'end'); break;
          case 'full': {
            const s = Math.max(PW / im.naturalWidth, PH / im.naturalHeight);
            x.drawImage(im, (PW - im.naturalWidth * s) / 2, (PH - im.naturalHeight * s) / 2, im.naturalWidth * s, im.naturalHeight * s);
            const g = x.createLinearGradient(0, PH * .75, 0, PH); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.45)');
            x.fillStyle = g; x.fillRect(0, PH * .75, PW, PH * .25);
            caption(p, last, '#e8e2d6'); break;
          }
          default: drawFit(im, bx, PH * .07, bw, vert ? PH * .77 : PH * .62); caption(p, last);
        }
        break;
      }
      case 'closing': {
        const qs = 6 * CQ, lh2 = qs * 1.2; x.fillStyle = pal.ink; x.font = `italic 400 ${qs}px ${SERIF}`; x.textAlign = 'center';
        wrapLines(x, 'Cuando camino solo en la naturaleza, no estoy caminando solo.', PW * .72).forEach((ln, k) => x.fillText(ln, PW / 2, PH * .42 + k * lh2 + qs * .85));
        break;
      }
      case 'backcover': {
        const lh2 = fs * 1.6; mono(fs);
        const lines = [`${photos.length} FOTOGRAFÍAS`, `${Y0} – ${Y1}`, ...wrapLines(x, 'CÓRDOBA · SALTA · JUJUY · NEUQUÉN · RÍO NEGRO · CHUBUT · SANTA CRUZ', PW * .78)];
        lines.forEach((ln, k) => x.fillText(ln, PW * .11, PH * .91 - (lines.length - 1 - k) * lh2 - lh2 * .3));
        break;
      }
    }
    return c;
  }

  return {
    photos, byI, movements, movementNames: movements.map(m => m.name),
    get sequence() { return sequence; },
    get pageCount() { return sequence.length; },
    renderPage,
    pageColor: i => PAL[sequence[i]?.paper ?? 'black'].bg,
    describe: i => { const e = sequence[i]; if (!e) return ''; return e.kind === 'photo' ? `${byI[e.photo]?.trip ?? '?'} · ${e.layout || 'top'}` : e.kind === 'opener' ? `opener: ${movements[e.k]?.name}` : e.kind; },
    // ---- editing; each returns the pages that must be redrawn, or 'rebuild' when the page count changed
    update(i, patch) { Object.assign(sequence[i], patch); save(); return [i]; },
    swap(a, b) { [sequence[a], sequence[b]] = [sequence[b], sequence[a]]; save(); return [a, b]; },
    move(i, dir) { const j = i + dir; if (j < 0 || j >= sequence.length) return []; return this.swap(i, j); },
    insert(i, entry = { kind: 'blank', paper: sequence[i]?.paper ?? 'cream' }) { sequence.splice(i, 0, entry); save(); return 'rebuild'; },
    remove(i) { if (sequence.length <= 2) return []; sequence.splice(i, 1); save(); return 'rebuild'; },
    reset() { sequence = defaultSequence(); save(); return 'rebuild'; },
    exportJSON: () => JSON.stringify(sequence, null, 1),
  };
}

function loadImage(src) {
  return new Promise((res, rej) => { const im = new Image(); im.decoding = 'async'; im.onload = () => res(im); im.onerror = () => rej(new Error('image ' + src)); im.src = src; });
}
function track(x, text, px, y, spacing, align = 'left') {
  x.textAlign = 'left';
  const chars = [...text], widths = chars.map(c => x.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
  let cx = align === 'center' ? px - total / 2 : align === 'right' ? px - total : px;
  chars.forEach((c, k) => { x.fillText(c, cx, y); cx += widths[k] + spacing; });
}
function wrapLines(x, text, maxW, spacing = 0) {
  const lines = []; let line = '';
  const w = s => x.measureText(s).width + spacing * Math.max(0, [...s].length - 1);
  for (const word of text.split(/\s+/)) { const t = line ? line + ' ' + word : word; if (w(t) > maxW && line) { lines.push(line); line = word; } else line = t; }
  if (line) lines.push(line);
  return lines;
}
