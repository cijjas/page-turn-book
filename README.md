# page-turn-book

A book for the web whose pages you can actually turn. Grab a corner and the page curls, casts a shadow and falls when you let go.

**[Try it →](https://cijjas.github.io/page-turn-book/)**

It's a web component: one HTML tag and your images.

```html
<page-turn-book auto-open style="height: 80vh">
  <img src="cover.jpg">
  <img src="page-1.jpg">
  <img src="page-2.jpg">
  <img src="page-3.jpg">
</page-turn-book>
```

## How to use it

1. Copy the `src` folder into your project.
2. Load three.js and the component:

```html
<script type="importmap">
  { "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.162.0/build/three.module.min.js" } }
</script>
<script type="module" src="src/page-turn-book.js"></script>
```

3. Put `<page-turn-book>` on the page with your images inside, as above, and give it a height.

The first image is the cover. After that, pages go left, right, left, right, like a real book.

## Turning pages

- **Drag** a page from its corner.
- **Click** a page to turn it.
- **Hold** the mouse down to flip through quickly.
- **← →** arrow keys (add the `keyboard` attribute).

## Options

Set these as attributes on the tag:

| Attribute | What it does | Example |
|---|---|---|
| `paper` | Paper texture: `original`, `smooth`, `fine`, `laid`, `cotton`, `fiber`, `recycled` | `paper="cotton"` |
| `aspect` | Page height ÷ width | `aspect="1.414"` (A4) |
| `auto-open` | Opens the cover once it loads | |
| `keyboard` | Arrow keys turn pages | |
| `start` | Opens at this sheet | `start="3"` |
| `fit` | How much of the box the book fills (0–1) | `fit="0.9"` |

## Controlling it from JavaScript

```js
const book = document.querySelector('page-turn-book');

book.next();            // turn forward
book.prev();            // turn back
book.goToPage(20);      // flip through to a page

book.setPaper('fiber');                     // change the paper
book.set('light.sun', 3);                   // change any setting live
book.addEventListener('spread', e => console.log(e.detail.sheet));
```

There are about 60 settings in all: light, shadows, curl, speed and more. The easiest way to explore them is the playground: tweak the sliders, press **copy settings**, and paste the result into `book.config = { … }`.

## Run the playground yourself

```sh
npm install
npm run dev
```

## Credits

- The page-turn engine is based on the magazine at [paper.design/mono](https://paper.design/mono), used with permission. Thanks, Paper.
- Paper textures from [ambientCG](https://ambientcg.com) (CC0).
- Built with [three.js](https://threejs.org).

## License

MIT
