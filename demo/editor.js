// Layout editor for the Intemperies book: a strip under the book that edits the two pages on view.

import { LAYOUTS } from './intemperies.js';

export function layoutEditor(book, data, { mount = document.body } = {}) {
  const el = document.createElement('div');
  el.className = 'ed';
  el.innerHTML = `<style>
    .ed { position: absolute; left: 12px; right: calc(var(--gui-width, 300px) + 12px); bottom: 28px; z-index: 5; display: grid; grid-template-columns: 1fr auto 1fr; gap: 10px; align-items: start;
      font: 12px ui-monospace, Menlo, monospace; color: #222; pointer-events: none; }
    .ed > * { pointer-events: auto; }
    .ed .pg { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 8px 10px; background: rgb(250 250 247 / .92); border: 1px solid #cfd3da; border-radius: 6px; backdrop-filter: blur(6px); }
    .ed .pg.r { justify-content: flex-end; }
    .ed .mid { display: grid; gap: 6px; padding: 8px; background: rgb(250 250 247 / .92); border: 1px solid #cfd3da; border-radius: 6px; }
    .ed b { width: 100%; font-weight: 600; letter-spacing: .04em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ed .r b { text-align: right; }
    .ed select, .ed button { font: inherit; color: inherit; padding: 3px 6px; border: 1px solid #cfd3da; border-radius: 4px; background: #fff; cursor: pointer; }
    .ed button:hover, .ed select:hover { border-color: #3b6fd8; }
    .ed .thumb { width: 44px; height: 58px; object-fit: cover; border-radius: 3px; background: #ddd; cursor: pointer; }
    .ed .pick { position: fixed; inset: 0; z-index: 20; background: rgb(0 0 0 / .55); overflow: auto; padding: 24px; display: none; }
    .ed .pick.on { display: block; }
    .ed .pick .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 8px; }
    .ed .pick img { width: 100%; aspect-ratio: 3 / 4; object-fit: cover; border-radius: 4px; cursor: pointer; background: #333; }
    .ed .pick img:hover { outline: 3px solid #3b6fd8; }
    .ed .pick .close { position: fixed; top: 12px; right: 12px; }
    .ed .pick .cap { color: #ddd; font-size: 11px; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    @media (prefers-color-scheme: dark) { .ed { color: #e4e4e1; } .ed .pg, .ed .mid { background: rgb(22 24 28 / .9); border-color: #3a404a; } .ed select, .ed button { background: #1d2126; border-color: #3a404a; } }
  </style>
  <div class="pg l" data-side="l"></div>
  <div class="mid">
    <button data-act="swap" title="swap the two pages">⇄ swap</button>
    <button data-act="reset" title="back to the original order and layouts">reset all</button>
    <button data-act="export" title="download intemperies-layout.json">export</button>
  </div>
  <div class="pg r" data-side="r"></div>
  <div class="pick"><button class="close">close</button><div class="grid"></div></div>`;
  mount.append(el);

  const pick = el.querySelector('.pick'), grid = pick.querySelector('.grid');
  let pages = { left: null, right: null }, picking = null;
  grid.innerHTML = data.photos.map(p => `<div><img loading="lazy" src="${data.byI[p.i].src}" data-i="${p.i}"><div class="cap">${p.i} · ${p.trip}</div></div>`).join('');
  pick.querySelector('.close').onclick = () => pick.classList.remove('on');
  grid.onclick = e => { const img = e.target.closest('img'); if (!img || picking == null) return; apply(data.update(picking, { kind: 'photo', photo: +img.dataset.i, layout: data.sequence[picking].layout || 'top' })); pick.classList.remove('on'); };

  function apply(result) {
    if (result === 'rebuild') { book.pageCount = data.pageCount; render(); return; }
    for (const i of result) book.refreshPage(i);
    render();
  }
  function side(i, cls) {
    const box = el.querySelector(`.pg.${cls}`);
    if (i == null || !data.sequence[i]) { box.innerHTML = `<b>${cls === 'l' ? 'no left page' : 'no right page'}</b>`; return; }
    const e = data.sequence[i], photo = e.kind === 'photo' ? data.byI[e.photo] : null;
    box.innerHTML = `<b>${i} · ${data.describe(i)}</b>
      ${photo ? `<img class="thumb" src="${photo.src}" title="change photo">` : `<button data-act="photo">+ photo</button>`}
      ${e.kind === 'photo' ? `<select data-act="layout">${LAYOUTS.map(l => `<option ${l === (e.layout || 'top') ? 'selected' : ''}>${l}</option>`).join('')}</select>` : ''}
      <select data-act="paper"><option ${e.paper === 'cream' ? 'selected' : ''}>cream</option><option ${e.paper === 'black' ? 'selected' : ''}>black</option></select>
      <button data-act="prev" title="move this page one earlier">←</button><button data-act="next" title="move this page one later">→</button>
      <button data-act="insert" title="insert a blank page before this one">+ blank</button>
      <button data-act="remove" title="remove this page">✕</button>`;
    box.querySelector('.thumb')?.addEventListener('click', () => { picking = i; pick.classList.add('on'); });
    box.querySelector('[data-act=photo]')?.addEventListener('click', () => { picking = i; pick.classList.add('on'); });
    box.querySelector('[data-act=layout]')?.addEventListener('change', ev => apply(data.update(i, { layout: ev.target.value })));
    box.querySelector('[data-act=paper]').addEventListener('change', ev => apply(data.update(i, { paper: ev.target.value })));
    box.querySelector('[data-act=prev]').addEventListener('click', () => apply(data.move(i, -1)));
    box.querySelector('[data-act=next]').addEventListener('click', () => apply(data.move(i, 1)));
    box.querySelector('[data-act=insert]').addEventListener('click', () => apply(data.insert(i)));
    box.querySelector('[data-act=remove]').addEventListener('click', () => { if (confirm(`Remove page ${i}?`)) apply(data.remove(i)); });
  }
  function render() { side(pages.left, 'l'); side(pages.right, 'r'); }
  el.querySelector('[data-act=swap]').onclick = () => { if (pages.left != null && pages.right != null) apply(data.swap(pages.left, pages.right)); };
  el.querySelector('[data-act=reset]').onclick = () => { if (confirm('Back to the original order and layouts?')) apply(data.reset()); };
  el.querySelector('[data-act=export]').onclick = () => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data.exportJSON()], { type: 'application/json' })); a.download = 'intemperies-layout.json'; a.click();
  };
  book.addEventListener('spread', e => { pages = { left: e.detail.left, right: e.detail.right }; render(); });
  render();
  return { el, destroy: () => el.remove() };
}
