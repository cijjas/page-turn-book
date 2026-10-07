// The book engine: three.js sheets that curl over a spine (after paper.design/mono's magazine).
// Every number lives in `config` and can be changed while the book is open with `book.set(path, value)`,
// except `book.aspect` and `book.pageWidth`, which need a rebuild.

import * as THREE from 'three';
import { loadPaper, DEFAULT_PAPER } from './paper.js';

export const DEFAULT_CONFIG = {
  book: {
    aspect: 28 / 21,      // page height / width (rebuild)
    pageWidth: 896,       // texture width of a page in px (rebuild)
    fit: .82,             // share of the box the open spread fills
    perspective: 40,      // camera field of view in degrees; framing is kept
    visibleSheets: 5,     // sheets drawn under each open page
  },
  material: { metalness: .17, showThrough: .04, inkGloss: .33 },
  cover: { hard: false, overhang: .014, thickness: .015, raise: .006, roughness: .4 },   // hard cover: rigid boards with real thickness, a few mm larger than the pages
  specks: { size: 1.46, darken: .17, roughen: .33 },          // the "original" paper only
  shape: { liftMaxX: .14, liftMaxZ: .04, liftDipX: .58, liftDipZ: .035, liftMidX: .72, liftMidZ: .04, liftEdgeZ: .03, wrinkle: .13 },
  light: { ambient: 1.5, sky: '#ffffff', ground: '#a1aeaf', sun: 2, sunColor: '#ffffff', sunX: -3.5, sunY: 1.3, sunZ: 4.1, shadow: .15 },
  curl: { angleMaxDeg: 45, curlArc: .88, curlArcJitter: .2, curlAngleJitter: .3, curlTiltJitterDeg: 6, cornerRollMax: 2.3, directionSmoothTime: .4, curveSmoothTime: .5 },
  hover: { progress: .03, smoothTime: 2, gapToSheetAbove: .1 },
  riffle: { startTime: .22, firstFlipTime: 1.2, fastestFlipTime: .5, speedUpSheets: 20, firstGapShare: .15, fastestGapShare: .05, moveSlopPx: 40 },
  drag: { turnFraction: .8, progressSmoothTime: .9, fallTime: 1, fallTimeExponent: .5, landingSpeed: .5, commitProgress: .2, clickSlopPx: 5 },
  flip: { flipTime: .85, followArcGainMin: 1, followArcGainMax: 1.08 },
};

export function mergeConfig(base, over = {}) {
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(over)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object') Object.assign(out[k], v);
    else out[k] = v;
  }
  return out;
}

const SETTLE = 1e-4;

export function createBook(host, { pageCount, renderPage, pageColor = '#f3efe6', config = {}, paper = DEFAULT_PAPER, start = 0, autoOpen = false, onSpread, onReady }) {
  const cfg = mergeConfig(DEFAULT_CONFIG, config);
  const { CURL, HOVER, RIFFLE, DRAG, FLIP } = { CURL: cfg.curl, HOVER: cfg.hover, RIFFLE: cfg.riffle, DRAG: cfg.drag, FLIP: cfg.flip };
  const SHEETS = Math.ceil(pageCount / 2), ASPECT = cfg.book.aspect, HALF = ASPECT / 2;
  const PW = Math.round(cfg.book.pageWidth), PH = Math.round(PW * ASPECT);

  let turned = clamp(start | 0, 0, SHEETS);
  const sheets = [], tweens = [];
  let dirty = true, lastNow = 0, lastFlipped = -1, ready = false, paperReady = false, running = false, inView = true, destroyed = false;
  let down = null, drag = null, hold = null, jump = null;
  let hovering = false, hoverX = 0, hoverY = 0, hoverSheet = -1, hitInset = '';
  const ac = new AbortController(), on = (t, ev, fn, opt) => t.addEventListener(ev, fn, { signal: ac.signal, ...opt });

  // ---- DOM
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true;
  const canvas = renderer.domElement;
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;opacity:0;transition:opacity .6s ease';
  const hit = document.createElement('div');
  hit.style.cssText = 'position:absolute;inset:0;touch-action:pan-y pinch-zoom;cursor:pointer';
  host.append(canvas, hit);

  // ---- scene
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 1.5, 4.5);
  const hemi = new THREE.HemisphereLight();
  const sun = new THREE.DirectionalLight();
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -.8, right: 1, top: HALF + .18, bottom: -(HALF + .38), near: 1.5, far: 6.6 });
  sun.shadow.camera.updateProjectionMatrix(); sun.shadow.bias = -.001;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.ShadowMaterial());
  ground.position.z = -1e-5; ground.receiveShadow = true;
  scene.add(hemi, sun, sun.target, ground);
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  const solids = new Map();
  const solid = css => {
    if (!solids.has(css)) {
      const c = new THREE.Color(css), t = new THREE.DataTexture(new Uint8Array([c.r, c.g, c.b].map(v => Math.round(v * 255)).concat(255)), 1, 1);
      t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; solids.set(css, t);
    }
    return solids.get(css);
  };
  const blankTex = i => solid(typeof pageColor === 'function' ? pageColor(i) : pageColor);

  // ---- uniforms every sheet shares: look + paper
  const flat = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1); flat.needsUpdate = true;
  const grain = (() => {   // Paper's original speck pattern
    const n = 256, cv = document.createElement('canvas'); cv.width = cv.height = n;
    const g = cv.getContext('2d'), img = g.createImageData(n, n), raw = new Float32Array(n * n);
    for (let i = 0; i < raw.length; i++) raw[i] = Math.random();
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x, nb = (raw[i] + raw[y * n + (x + 1) % n] + raw[((y + 1) % n) * n + x]) / 3;
      const v = Math.round((.55 * raw[i] + .45 * nb) * 255);
      img.data.set([v, v, v, 255], i * 4);
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = maxAniso; return t;
  })();
  const shared = {
    LIFT_MAX_X: { value: 0 }, LIFT_MAX_Z: { value: 0 }, LIFT_DIP_X: { value: 0 }, LIFT_DIP_Z: { value: 0 }, LIFT_MID_X: { value: 0 },
    LIFT_MID_Z: { value: 0 }, LIFT_EDGE_Z: { value: 0 }, DEFORM: { value: 0 },
    PAPER_TRANSPARENCY: { value: 0 }, INK_GLOSS: { value: 0 }, PATTERN_SIZE: { value: 0 }, TEXTURE_COLOR: { value: 0 }, PATTERN_ROUGHNESS: { value: 0 },
    uPatternTex: { value: grain }, uSpecks: { value: 0 },
    uCoverScale: { value: new THREE.Vector2(1, 1) }, uBoardZ: { value: .05 }, uThickness: { value: 0 },
    uToneMap: { value: flat }, uToneMean: { value: .5 }, uToneStd: { value: .1 }, uContrast: { value: 0 }, uToneRepeat: { value: new THREE.Vector2(1, ASPECT) },
  };
  const CONSTS = `
    const float SHEET_ASPECT = ${ASPECT.toFixed(5)};
    const float NORMAL_EPSILON = 0.03;
    const float SHADOW_OFFSET_X = 0.004;
    uniform float LIFT_MAX_X, LIFT_MAX_Z, LIFT_DIP_X, LIFT_DIP_Z, LIFT_MID_X, LIFT_MID_Z, LIFT_EDGE_Z, DEFORM;
    uniform float PAPER_TRANSPARENCY, INK_GLOSS, PATTERN_SIZE, TEXTURE_COLOR, PATTERN_ROUGHNESS, uSpecks;
  `;
  const VERTEX = `
    ${CONSTS}
    uniform float uFlipProgress, uWrinkleSide, uBendAngle, uDirection, uStackLift;
    uniform vec2 uFold, uCurl, uFlipRotation;
    uniform float uRigid, uBoardZ, uThickness;
    uniform vec2 uCoverScale;
    varying vec2 vGrainUv;
    varying float vThick;
    attribute vec3 aNoise;
    attribute float aThick;
    const float HALF_PI = 1.57079633;

    vec3 _sheetPosition(vec2 uv, float rawNoise) {
      float flatX = uv.x * mix(1.0, uCoverScale.x, uRigid);
      float flatY = (uv.y - 0.5) * SHEET_ASPECT * mix(1.0, uCoverScale.y, uRigid);
      float wrinkle = mix(rawNoise, 1.0 - rawNoise, uFlipProgress) - .5;
      wrinkle *= smoothstep(0.0, 0.35, uv.x) * DEFORM * uStackLift * (1.0 - uRigid);

      float lift;
      if (uv.x <= LIFT_MAX_X) lift = LIFT_MAX_Z * sin(uv.x / LIFT_MAX_X * HALF_PI);
      else if (uv.x <= LIFT_DIP_X) lift = mix(LIFT_MAX_Z, LIFT_DIP_Z, smoothstep(LIFT_MAX_X, LIFT_DIP_X, uv.x));
      else if (uv.x <= LIFT_MID_X) lift = mix(LIFT_DIP_Z, LIFT_MID_Z, smoothstep(LIFT_DIP_X, LIFT_MID_X, uv.x));
      else lift = mix(LIFT_MID_Z, LIFT_EDGE_Z, 1.0 - cos((uv.x - LIFT_MID_X) / (1.0 - LIFT_MID_X) * HALF_PI));
      lift *= uStackLift;
      // a board stays flat: on top of its stack when it's the top sheet, on the table when it's the bottom one
      float onTop = clamp((uStackLift - 0.31) / 0.69, 0.0, 1.0);
      lift = mix(lift, uBoardZ * onTop, uRigid);

      float localU =  flatX * uFold.x + flatY * uFold.y;
      float localV = -flatX * uFold.y + flatY * uFold.x;
      float beyond = max(0.0, localU - uCurl.x);
      float angle = beyond / uCurl.y * uBendAngle;
      float sinc = abs(angle) < 1e-4 ? 1.0 : sin(angle) / angle;
      float versine = abs(angle) < 1e-4 ? 0.0 : (1.0 - cos(angle)) / angle;
      float curledU = localU - beyond + beyond * sinc;
      float pz = -uDirection * beyond * versine;
      // board thickness: grows upward when the board is on top of its stack, downward when it's underneath
      pz += uRigid * (aThick - (1.0 - onTop)) * uThickness;
      float px = curledU * uFold.x - localV * uFold.y;
      float py = curledU * uFold.y + localV * uFold.x;

      vec3 p = vec3(px * uFlipRotation.x - pz * uFlipRotation.y, py, px * uFlipRotation.y + pz * uFlipRotation.x);
      p.z += lift + uWrinkleSide * wrinkle;
      return p;
    }
    vec3 _sheetP;
  `;

  // ---- one sheet geometry for all, with wrinkle noise baked per vertex
  const geometry = (() => {
    const geo = new THREE.PlaneGeometry(1, ASPECT, 64, Math.round(64 * ASPECT)), uv = geo.attributes.uv, count = uv.count;
    const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
    const value = (x, y) => {
      const cx = Math.floor(x), cy = Math.floor(y), fx = x - cx, fy = y - cy, bx = fx * fx * (3 - 2 * fx), by = fy * fy * (3 - 2 * fy);
      return lerp(lerp(hash(cx, cy), hash(cx + 1, cy), bx), lerp(hash(cx, cy + 1), hash(cx + 1, cy + 1), bx), by);
    };
    const raw = (u, v) => { let px = u / 1.2 + 614.98, py = (v - .5) * ASPECT / 1.2 + 357.42, sum = 0, amp = .5; for (let o = 0; o < 3; o++) { sum += amp * value(px, py); amp *= .5; px *= 2; py *= 2; } return sum; };
    const out = new Float32Array(count * 3), du = .03, dv = .03 / ASPECT;
    for (let i = 0; i < count; i++) { const u = uv.getX(i), v = uv.getY(i); out[i * 3] = raw(u, v); out[i * 3 + 1] = raw(u + du, v); out[i * 3 + 2] = raw(u, v + dv); }
    geo.setAttribute('aNoise', new THREE.BufferAttribute(out, 3));
    return geo;
  })();

  // a board is a box: top and bottom faces plus four edges; the shader places it from uv and aThick alone
  const boardGeometry = (() => {
    const geo = new THREE.BoxGeometry(1, ASPECT, 1), pos = geo.attributes.position, n = pos.count;
    const uv = new Float32Array(n * 2), thick = new Float32Array(n);
    for (let i = 0; i < n; i++) { uv[2 * i] = pos.getX(i) + .5; uv[2 * i + 1] = pos.getY(i) / ASPECT + .5; thick[i] = pos.getZ(i) + .5; }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('aThick', new THREE.BufferAttribute(thick, 1));
    geo.setAttribute('aNoise', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    return geo;
  })();
  geometry.setAttribute('aThick', new THREE.BufferAttribute(new Float32Array(geometry.attributes.uv.count), 1));

  const stackLift = (i, t) => .31 + .69 * (SHEETS > 1 ? (i + (SHEETS - 1 - 2 * i) * (1 - t)) / (SHEETS - 1) : 1);
  function makeSheet(i) {
    const u = {
      uDirection: { value: 1 }, uStackLift: { value: 1 }, uFlipProgress: { value: 0 }, uWrinkleSide: { value: -1 }, uBendAngle: { value: 0 },
      uFold: { value: new THREE.Vector2(1, 0) }, uCurl: { value: new THREE.Vector2(0, 1) }, uFlipRotation: { value: new THREE.Vector2(1, 0) },
      uBackMap: { value: blankTex(2 * i + 1) }, uRigid: { value: 0 }, ...shared,
    };
    const mat = new THREE.MeshStandardMaterial({ map: blankTex(2 * i), side: THREE.DoubleSide, metalness: cfg.material.metalness, roughness: .5, bumpMap: flat, bumpScale: 0 });
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = VERTEX + sh.vertexShader
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
          if (uRigid > 0.5) {
            // a board only rotates about the spine, so its normal is the mesh normal rotated the same way
            objectNormal = vec3(normal.x * uFlipRotation.x - normal.z * uFlipRotation.y, normal.y, normal.x * uFlipRotation.y + normal.z * uFlipRotation.x);
            _sheetP = _sheetPosition(uv, 0.0);
          } else {
            vec2 du = vec2(NORMAL_EPSILON, NORMAL_EPSILON / SHEET_ASPECT);
            vec3 p0 = _sheetPosition(uv, aNoise.x);
            vec3 px = _sheetPosition(uv + vec2(du.x, 0.0), aNoise.y);
            vec3 py = _sheetPosition(uv + vec2(0.0, du.y), aNoise.z);
            objectNormal = normalize(cross(px - p0, py - p0));
            _sheetP = p0;
          }`)
        .replace('#include <begin_vertex>', 'vec3 transformed = _sheetP;\nvGrainUv = uv;\nvThick = aThick;');
      sh.fragmentShader = CONSTS + `
        uniform sampler2D uBackMap, uPatternTex, uToneMap;
        uniform float uToneMean, uToneStd, uContrast, uRigid;
        uniform vec2 uToneRepeat;
        varying vec2 vGrainUv;
        varying float vThick;
      ` + sh.fragmentShader
        .replace('#include <normal_fragment_begin>', `
          vec3 normal = normalize(vNormal);
          float faceDirection = normal.z >= 0.0 ? 1.0 : -1.0;
          normal *= faceDirection;
          vec3 nonPerturbedNormal = normal;`)
        .replace('#include <map_fragment>', `
          float inkAmount = 0.0;
          #ifdef USE_MAP
            vec4 frontColor = texture2D(map, vMapUv);
            vec4 backColor = texture2D(uBackMap, vec2(1.0 - vMapUv.x, vMapUv.y));
            bool facing = gl_FrontFacing;
            if (uRigid > 0.5 && vThick < 0.5) facing = !facing;   // the underside of a board is its own front face
            vec4 faceColor = facing ? frontColor : backColor;
            vec4 otherColor = facing ? backColor : frontColor;
            vec4 sheetColor = faceColor;
            sheetColor.rgb *= mix(vec3(1.0), otherColor.rgb, PAPER_TRANSPARENCY);
            diffuseColor *= sheetColor;
            inkAmount = 1.0 - dot(faceColor.rgb, vec3(0.299, 0.587, 0.114));
          #endif
          float paperTone = dot(texture2D(uToneMap, vGrainUv * uToneRepeat).rgb, vec3(0.299, 0.587, 0.114));
          diffuseColor.rgb *= clamp(1.0 + (paperTone - uToneMean) / uToneStd * uContrast, 0.0, 2.0);`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor *= mix(1., 0., inkAmount * INK_GLOSS);
          float pattern = texture2D(uPatternTex, vGrainUv * PATTERN_SIZE * vec2(1.0, SHEET_ASPECT)).r;
          pattern = 2. * pow(pattern, 7.) * uSpecks;
          roughnessFactor = clamp(mix(roughnessFactor, 1.0, clamp(pattern * PATTERN_ROUGHNESS, 0.0, 1.0)), 0.0, 1.0);`)
        .replace('#include <opaque_fragment>', `#include <opaque_fragment>
          gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.), pattern * TEXTURE_COLOR);`);
    };
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
    depth.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = VERTEX + sh.vertexShader.replace('#include <begin_vertex>',
        'vec3 transformed = _sheetPosition(uv, aNoise.x) - vec3(SHADOW_OFFSET_X, 0., 0.);');
    };
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.customDepthMaterial = depth; mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);
    return { mesh, mat, depth, uniforms: u, flipProgress: i < turned ? 1 : 0, direction: 1, directionSmooth: 1,
      curve: { curlArc: 0, curlAngleDeg: 0 }, curveTarget: { curlArc: 0, curlAngleDeg: 0 }, wobble: { arc: .5, angle: .5, tilt: 0 },
      liftBase: stackLift(i, 0), liftSpan: stackLift(i, 1) - stackLift(i, 0) };
  }
  for (let i = 0; i < SHEETS; i++) sheets.push(makeSheet(i));

  // ---- config → scene
  function applyConfig() {
    const s = cfg.shape, m = cfg.material, sp = cfg.specks, l = cfg.light;
    shared.LIFT_MAX_X.value = s.liftMaxX; shared.LIFT_MAX_Z.value = s.liftMaxZ; shared.LIFT_DIP_X.value = s.liftDipX; shared.LIFT_DIP_Z.value = s.liftDipZ;
    shared.LIFT_MID_X.value = s.liftMidX; shared.LIFT_MID_Z.value = s.liftMidZ; shared.LIFT_EDGE_Z.value = s.liftEdgeZ; shared.DEFORM.value = s.wrinkle;
    shared.PAPER_TRANSPARENCY.value = m.showThrough; shared.INK_GLOSS.value = m.inkGloss;
    shared.PATTERN_SIZE.value = sp.size; shared.TEXTURE_COLOR.value = sp.darken; shared.PATTERN_ROUGHNESS.value = sp.roughen;
    for (const sh of sheets) sh.mat.metalness = m.metalness;
    const c = cfg.cover;
    sheets.forEach((sh, i) => { const r = isRigid(i); sh.uniforms.uRigid.value = r ? 1 : 0; sh.mesh.geometry = r ? boardGeometry : geometry; });
    shared.uThickness.value = c.thickness;
    ground.position.z = -(c.hard ? c.thickness : 0) - 1e-5;   // the bottom board sits below the table line
    shared.uCoverScale.value.set(1 + c.overhang, 1 + 2 * c.overhang / ASPECT);
    shared.uBoardZ.value = s.liftMaxZ + .5 * s.wrinkle + c.raise;   // clear of the highest page wrinkle
    applyRoughness();
    hemi.intensity = l.ambient; hemi.color.set(l.sky); hemi.groundColor.set(l.ground);
    sun.intensity = l.sun; sun.color.set(l.sunColor); sun.position.set(l.sunX, l.sunY, l.sunZ);
    ground.material.opacity = l.shadow;
    frameCamera();
    dirty = true;
  }
  const isRigid = i => cfg.cover.hard && SHEETS > 1 && (i === 0 || i === SHEETS - 1);
  function applyRoughness() { sheets.forEach((sh, i) => { sh.mat.roughness = isRigid(i) ? cfg.cover.roughness : roughness; }); dirty = true; }
  function frameCamera() {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1, fov = cfg.book.perspective;
    const dist = 2.99 * Math.tan(20 * Math.PI / 180) / Math.tan(fov / 2 * Math.PI / 180);   // keep the book the same size as fov changes
    camera.fov = fov; camera.aspect = w / h;
    camera.position.set(0, 0, dist); camera.lookAt(0, 0, 0);
    camera.near = Math.max(.05, dist - 1.6); camera.far = dist + 1.6;
    const visH = 2 * dist * Math.tan(fov / 2 * Math.PI / 180), visW = visH * camera.aspect;
    camera.zoom = cfg.book.fit * Math.min(visH / ASPECT, visW / 2);
    camera.updateProjectionMatrix();
    dirty = true;
  }
  const spreadPx = () => { const visH = 2 * camera.position.z * Math.tan(camera.fov / 2 * Math.PI / 180); return canvas.getBoundingClientRect().width * 2 * camera.zoom / (visH * camera.aspect); };

  // ---- paper
  let paperMaps = {}, bump = 0, roughness = .5, paperNow = {}, paperToken = 0;
  async function setPaper(input) {
    const token = ++paperToken;
    const p = await loadPaper(input);
    if (destroyed || token !== paperToken) return p.spec;
    paperMaps.tone?.dispose(); if (paperMaps.height !== paperMaps.tone) paperMaps.height?.dispose();
    paperMaps = {};
    if (p.spec.specks || !p.tone) {
      shared.uSpecks.value = p.spec.specks ? 1 : 0; shared.uToneMap.value = flat;
      for (const s of sheets) s.mat.bumpMap = flat;
    } else {
      const make = src => { const t = src instanceof HTMLCanvasElement ? new THREE.CanvasTexture(src) : new THREE.Texture(src); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = maxAniso; t.needsUpdate = true; return t; };
      const tone = make(p.tone), height = p.height === p.tone ? tone : make(p.height);
      paperMaps = { tone, height };
      shared.uSpecks.value = 0; shared.uToneMap.value = tone; shared.uToneMean.value = p.mean; shared.uToneStd.value = p.std;
      for (const s of sheets) s.mat.bumpMap = height;
    }
    paperNow = { ...p.spec };
    return tunePaper(p.spec);
  }
  function tunePaper({ scale, contrast, bump: b, roughness: r } = {}) {
    if (scale != null) { shared.uToneRepeat.value.set(scale, scale * ASPECT); paperMaps.height?.repeat.set(scale, scale * ASPECT); }
    if (contrast != null) shared.uContrast.value = contrast;
    if (b != null) bump = b;
    if (r != null) roughness = r;
    for (const s of sheets) s.mat.bumpScale = bump;
    applyRoughness();
    for (const [k, v] of Object.entries({ scale, contrast, bump: b, roughness: r })) if (v != null) paperNow[k] = v;
    dirty = true;
    return { ...paperNow };
  }

  // ---- curl geometry helpers
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), table = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), onTable = new THREE.Vector3();
  function pointOnTable(cx, cy) {
    const r = canvas.getBoundingClientRect();
    ndc.set((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray.ray.intersectPlane(table, onTable) ? { angle: Math.atan2(onTable.y, onTable.x), dist: Math.hypot(onTable.x, onTable.y) } : null;
  }
  const cornerRollLimit = deg => { const a = Math.abs(deg) * Math.PI / 180; return CURL.cornerRollMax / (Math.PI * (Math.cos(a) / (1 - HALF * Math.sin(a)))); };
  const isAnimating = i => tweens.some(t => t.sheet === i);
  function leadCurve(i) {
    const t = sheets[lastFlipped];
    if (!t || lastFlipped === i || !isAnimating(lastFlipped)) return undefined;
    return (t.direction > 0 ? t.flipProgress > .5 : t.flipProgress < .5) ? undefined : t.curveTarget;
  }
  function curveFromPoint(i, p) {
    if (isRigid(i)) return { curlArc: 0, curlAngleDeg: 0 };   // boards don't bend
    const w = sheets[i].wobble, lead = leadCurve(i);
    let deg = 0;
    if (p) {
      let a = p.angle * 180 / Math.PI; if (a > 90) a = 180 - a; if (a < -90) a = -180 - a;
      deg = clamp(-(a / 90) * CURL.angleMaxDeg * p.dist * (1 - w.angle * CURL.curlAngleJitter) + w.tilt * CURL.curlTiltJitterDeg, -CURL.angleMaxDeg, CURL.angleMaxDeg);
    }
    if (!lead) return { curlArc: Math.min(CURL.curlArc * (1 - w.arc * CURL.curlArcJitter), cornerRollLimit(deg)), curlAngleDeg: deg };
    deg = clamp(deg, Math.min(0, lead.curlAngleDeg), Math.max(0, lead.curlAngleDeg));
    return { curlArc: clamp(lead.curlArc * lerp(FLIP.followArcGainMin, FLIP.followArcGainMax, w.arc), lead.curlArc, cornerRollLimit(deg)), curlAngleDeg: deg };
  }
  const curveAt = (cx, cy, i) => curveFromPoint(i, pointOnTable(cx, cy));
  const cornerCurve = (i, forward) => { const w = sheets[i].wobble, y = -.42 + .25 * w.angle, x = forward ? .92 : -.92; return curveFromPoint(i, { angle: Math.atan2(y, x), dist: Math.hypot(x, y) }); };
  function setCurve(s, c, now) { s.curveTarget.curlArc = c.curlArc; s.curveTarget.curlAngleDeg = c.curlAngleDeg; if (now) { s.curve.curlArc = c.curlArc; s.curve.curlAngleDeg = c.curlAngleDeg; } }
  function sideAt(cx) {
    const r = canvas.getBoundingClientRect(), fwd = cx - r.left >= r.width / 2;
    if (fwd ? turned >= SHEETS : turned <= 0) return null;
    return { sheet: fwd ? turned : turned - 1, forward: fwd };
  }

  // ---- flipping
  const removeTween = i => { const k = tweens.findIndex(t => t.sheet === i); if (k !== -1) tweens.splice(k, 1); };
  function beginFlip(i, to) {
    lastFlipped = i;
    sheets[i].wobble = { arc: Math.random(), angle: Math.random(), tilt: 2 * Math.random() - 1 };
    turned = to === 1 ? i + 1 : i;
    spreadChanged(); dirty = true;
  }
  function flipTo(i, forward, to, time = FLIP.flipTime) {
    beginFlip(i, to);
    const from = sheets[i].flipProgress; removeTween(i);
    tweens.push({ sheet: i, from, to, direction: forward ? 1 : -1, start: performance.now(), duration: 1000 * time * Math.max(.2, Math.abs(to - from)) });
  }
  function tweenValue(t, now) {
    const k = clamp((now - t.start) / t.duration, 0, 1);
    if (t.launch === undefined) return t.from + (t.to - t.from) * .5 * (1 - Math.cos(k * Math.PI));
    const k2 = k * k, k3 = k2 * k, e = (k3 - 2 * k2 + k) * t.launch + (3 * k2 - 2 * k3) + (k3 - k2) * DRAG.landingSpeed;
    return t.from + (t.to - t.from) * e;
  }
  const speedUp = (a, b, n) => a + (b - a) * Math.min(n / RIFFLE.speedUpSheets, 1);
  function riffleStep(forward, count, at) {
    if (forward ? turned >= SHEETS : turned <= 0) return false;
    const i = forward ? turned : turned - 1, s = sheets[i];
    setCurve(s, at ? curveAt(at[0], at[1], i) : count === 0 && hold ? s.curveTarget : cornerCurve(i, forward), true);
    s.direction = forward ? 1 : -1;
    flipTo(i, forward, forward ? 1 : 0, speedUp(RIFFLE.firstFlipTime, RIFFLE.fastestFlipTime, count));
    return true;
  }
  const stopHold = () => { if (hold) { clearTimeout(hold.timer); hold = null; } };
  const stopJump = () => { if (jump) { clearTimeout(jump.timer); jump = null; } };
  function holdTick() {
    if (!hold) return;
    if (!hold.fired) { hold.fired = true; drag = null; }
    const gap = speedUp(RIFFLE.firstFlipTime, RIFFLE.fastestFlipTime, hold.count) * speedUp(RIFFLE.firstGapShare, RIFFLE.fastestGapShare, hold.count);
    if (riffleStep(hold.forward, hold.count, hold.count === 0 ? null : [hold.x, hold.y])) { hold.count++; hold.timer = setTimeout(holdTick, 1000 * gap); }
    else stopHold();
  }
  function step(forward) {
    stopJump(); stopHold();
    if (forward ? turned >= SHEETS : turned <= 0) return;
    const i = forward ? turned : turned - 1, s = sheets[i];
    setCurve(s, cornerCurve(i, forward), true); s.direction = forward ? 1 : -1;
    flipTo(i, forward, forward ? 1 : 0);
  }
  function jumpTo(target) {
    target = clamp(target | 0, 0, SHEETS); stopHold(); stopJump();
    if (target === turned) return;
    const forward = target > turned, LIMIT = 16;
    if (Math.abs(target - turned) > LIMIT) {
      const to = forward ? target - LIMIT : target + LIMIT;
      for (let i = Math.min(turned, to); i < Math.max(turned, to); i++) { removeTween(i); sheets[i].flipProgress = forward ? 1 : 0; }
      turned = to; spreadChanged(); dirty = true;
    }
    jump = { target, forward, count: 4 };
    const tick = () => {
      if (!jump || turned === jump.target) { jump = null; return; }
      riffleStep(jump.forward, jump.count, null);
      jump.count++; jump.timer = setTimeout(tick, 1000 * speedUp(.9, .45, jump.count) * speedUp(.13, .05, jump.count));
    };
    tick();
  }

  // ---- pointer
  const movedBeyond = (e, slop = DRAG.clickSlopPx) => down && (e.clientX - down.x) ** 2 + (e.clientY - down.y) ** 2 > slop * slop;
  on(hit, 'pointermove', e => {
    if (hold && movedBeyond(e, hold.fired ? RIFFLE.moveSlopPx : undefined)) stopHold();
    if (drag) {
      drag.progress = clamp(drag.base - (e.clientX - down.x) / drag.rectWidth / DRAG.turnFraction, 0, 1);
      drag.targetCurve = curveAt(e.clientX, e.clientY, drag.sheet); dirty = true; return;
    }
    hoverX = e.clientX; hoverY = e.clientY; hovering = true; dirty = true;
  });
  on(hit, 'pointerleave', () => { hovering = false; dirty = true; });
  on(hit, 'pointerdown', e => {
    if (e.button !== 0 || !ready) return;
    const side = sideAt(e.clientX); if (!side) return;
    stopJump();
    const s = sheets[side.sheet];
    prioritize(side.sheet);
    if (!isAnimating(side.sheet)) setCurve(s, curveAt(e.clientX, e.clientY, side.sheet), true);
    removeTween(side.sheet);
    down = { x: e.clientX, y: e.clientY };
    drag = { sheet: side.sheet, forward: side.forward, base: s.flipProgress, progress: s.flipProgress, rectWidth: spreadPx() / .63, targetCurve: { ...s.curveTarget }, speed: 0 };
    s.direction = side.forward ? 1 : -1;
    stopHold();
    hold = { forward: side.forward, x: e.clientX, y: e.clientY, count: 0, fired: false, timer: setTimeout(holdTick, 1000 * RIFFLE.startTime) };
    try { hit.setPointerCapture(e.pointerId); } catch {}
    dirty = true;
  });
  function release(e) {
    stopHold();
    if (!drag) { down = null; return; }
    const d = drag, moved = movedBeyond(e);
    drag = null; down = null;
    try { hit.releasePointerCapture(e.pointerId); } catch {}
    if (!moved) return flipTo(d.sheet, d.forward, d.forward ? 1 : 0);
    const committed = (d.forward ? d.progress - d.base : d.base - d.progress) >= DRAG.commitProgress;
    const to = d.forward === committed ? 1 : 0;
    beginFlip(d.sheet, to);
    const from = sheets[d.sheet].flipProgress, span = Math.max(Math.abs(to - from), .001);
    const dur = DRAG.fallTime * Math.pow(span, DRAG.fallTimeExponent), v = to === 1 ? d.speed : -d.speed;
    removeTween(d.sheet);
    tweens.push({ sheet: d.sheet, from, to, direction: d.forward ? 1 : -1, start: performance.now(), duration: 1000 * dur, launch: clamp(v * dur / span, 0, 2) });
  }
  on(hit, 'pointerup', release);
  on(hit, 'pointercancel', release);

  // ---- per frame
  function applyUniforms(s, lift) {
    const u = s.uniforms, c = s.curve, dir = s.directionSmooth, r = s.flipProgress * Math.PI;
    const bend = Math.sin(r) * Math.PI * c.curlArc;
    const l = c.curlAngleDeg * Math.PI / 180, cs = Math.cos(l), sn = Math.sin(l);
    const len = 1 - HALF * Math.sin(Math.abs(l)), startU = 1 - len;
    const m = Math.max(0, cs + sn * HALF * Math.sign(sn) - startU), p = m / len * bend;
    const g = r + .5 * dir * (m * (Math.abs(p) < 1e-4 ? 0 : (1 - Math.cos(p)) / p));
    u.uFlipProgress.value = s.flipProgress; u.uWrinkleSide.value = -Math.cos(r); u.uDirection.value = dir;
    u.uStackLift.value = lift; u.uBendAngle.value = bend;
    u.uFold.value.set(cs, sn); u.uCurl.value.set(startU, len); u.uFlipRotation.value.set(Math.cos(g), Math.sin(g));
  }
  function smoothCurve(s, k) {
    let moving = false;
    for (const key of ['curlArc', 'curlAngleDeg']) {
      const d = s.curveTarget[key] - s.curve[key];
      if (Math.abs(d) < SETTLE) s.curve[key] = s.curveTarget[key]; else { s.curve[key] += d * k; moving = true; }
    }
    return moving;
  }
  function frame(now) {
    const t = performance.now();
    for (let k = tweens.length - 1; k >= 0; k--) {
      const tw = tweens[k], s = sheets[tw.sheet];
      s.flipProgress = tweenValue(tw, t); s.direction = tw.direction;
      if (t >= tw.start + tw.duration) { tweens.splice(k, 1); dirty = true; }
    }
    const dt = lastNow ? Math.min((now - lastNow) / 1000, .1) : 1 / 60; lastNow = now;
    const dirK = 1 - Math.pow(.001, dt / CURL.directionSmoothTime);
    if (drag) {
      const s = sheets[drag.sheet], a = 1 - Math.pow(.01, dt / DRAG.progressSmoothTime), d = (drag.progress - s.flipProgress) * a;
      s.flipProgress += d; drag.speed = dt > 0 ? d / dt : 0; setCurve(s, drag.targetCurve, false);
    }
    let moving = tweens.length > 0 || drag !== null;
    const settleK = 1 - Math.pow(.001, dt / HOVER.smoothTime), curveK = 1 - Math.pow(.001, dt / CURL.curveSmoothTime);
    const hv = !hovering || drag || hold || jump ? null : sideAt(hoverX), prev = hoverSheet;
    hoverSheet = hv && ready && !isAnimating(hv.sheet) ? hv.sheet : -1;
    if (hoverSheet !== -1) setCurve(sheets[hoverSheet], curveAt(hoverX, hoverY, hoverSheet), hoverSheet !== prev);
    for (let i = 0; i < SHEETS; i++) {
      const s = sheets[i];
      if (!isAnimating(i) && !(drag && drag.sheet === i)) {
        const side = i >= turned ? 0 : 1, target = i === hoverSheet ? (side === 0 ? HOVER.progress : 1 - HOVER.progress) : side;
        const diff = target - s.flipProgress;
        if (Math.abs(diff) < SETTLE) { if (s.flipProgress !== target) { s.flipProgress = target; dirty = true; } }
        else { s.flipProgress += diff * settleK; moving = true; }
        const nb = sheets[side === 0 ? i - 1 : i + 1];
        if (nb) {
          const lim = side === 0 ? Math.min(s.flipProgress, Math.max(0, nb.flipProgress - HOVER.gapToSheetAbove)) : Math.max(s.flipProgress, Math.min(1, nb.flipProgress + HOVER.gapToSheetAbove));
          if (lim !== s.flipProgress) { s.flipProgress = lim; moving = true; }
        }
        s.direction = side === 1 && s.flipProgress !== side ? -1 : 1;
        s.directionSmooth = s.direction;
      }
      const dd = s.direction - s.directionSmooth;
      if (Math.abs(dd) < SETTLE) { if (s.directionSmooth !== s.direction) { s.directionSmooth = s.direction; dirty = true; } }
      else { s.directionSmooth += dd * dirK; moving = true; }
      if (smoothCurve(s, curveK)) moving = true;
      applyUniforms(s, s.liftBase + s.liftSpan * s.flipProgress);
    }
    const busy = tweens.length > 0 || drag !== null || hold !== null;
    const inset = turned === 0 && !busy ? '0 0 0 50%' : turned === SHEETS && !busy ? '0 50% 0 0' : '0';
    if (inset !== hitInset) { hitInset = inset; hit.style.inset = inset; }
    if (moving || dirty) {
      for (let i = 0; i < SHEETS; i++) {
        const m = sheets[i].mesh, d = i >= turned ? i - turned : turned - 1 - i, live = isAnimating(i) || (drag !== null && drag.sheet === i);
        m.visible = d <= cfg.book.visibleSheets || live || isRigid(i);   // boards always show, framing the pages
        const cast = d < 3 || live; if (m.castShadow !== cast) m.castShadow = cast;
        m.renderOrder = d;
      }
      renderer.shadowMap.needsUpdate = true;
      renderer.render(scene, camera);
      dirty = false;
    }
  }
  function updateLoop() {
    const run = inView && !document.hidden && !destroyed;
    if (run === running) return;
    running = run; lastNow = 0; dirty = true;
    renderer.setAnimationLoop(run ? frame : null);
  }
  on(document, 'visibilitychange', updateLoop);
  const io = new IntersectionObserver(es => { inView = es[es.length - 1].isIntersecting; updateLoop(); }, { rootMargin: '50% 0px' });
  io.observe(host);
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 3, Math.sqrt(15e6 / (w * h))));
    renderer.setSize(w, h, false);
    frameCamera();
  }
  const ro = new ResizeObserver(resize); ro.observe(canvas);
  on(window, 'resize', resize);

  // ---- page textures: only sheets near the open spread hold one
  const loaded = new Map(), pending = new Set();
  let queue = [];
  const near = (p, r) => { const s = p >> 1; return s >= turned - r - 1 && s <= turned + r; };
  function attach(p, tex) { const s = sheets[p >> 1]; if (p % 2 === 0) s.mat.map = tex; else s.uniforms.uBackMap.value = tex; dirty = true; }
  function schedule() {
    const mid = 2 * turned - .5, want = [];
    for (let s = Math.max(0, turned - 4); s <= Math.min(SHEETS - 1, turned + 3); s++) for (const p of [2 * s, 2 * s + 1]) if (p < pageCount && !loaded.has(p) && !pending.has(p)) want.push(p);
    queue = want.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
    for (const [p, tex] of loaded) if (!near(p, 7)) { attach(p, blankTex(p)); tex.dispose(); loaded.delete(p); }
    pump();
  }
  function prioritize(sheet) {
    for (const p of [2 * sheet + 1, 2 * sheet + 2, 2 * sheet]) if (p < pageCount && !loaded.has(p) && !pending.has(p)) { queue = queue.filter(q => q !== p); queue.unshift(p); }
    pump();
  }
  function pump() {
    while (pending.size < 2 && queue.length) {
      const p = queue.shift();
      if (loaded.has(p) || pending.has(p) || !near(p, 5)) continue;
      pending.add(p);
      Promise.resolve(renderPage(p, { width: PW, height: PH })).then(src => {
        pending.delete(p);
        if (destroyed) return;
        if (src && near(p, 6)) {
          const tex = new THREE.CanvasTexture(src); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = maxAniso;
          attach(p, tex); loaded.set(p, tex);
        }
        checkReady(); pump();
      }).catch(err => { pending.delete(p); console.warn(`page-turn-book: page ${p}`, err); checkReady(); pump(); });
    }
  }
  function checkReady() {
    if (ready || !paperReady) return;
    const need = [2 * turned - 1, 2 * turned].filter(p => p >= 0 && p < pageCount);
    if (need.every(p => loaded.has(p) || (!pending.has(p) && !queue.includes(p)))) {
      ready = true; canvas.style.opacity = '1'; dirty = true;
      onReady?.();
      if (autoOpen && turned === 0) setTimeout(() => turned === 0 && step(true), 700);
    }
  }
  function spreadChanged() {
    onSpread?.(turned, { left: turned > 0 ? 2 * turned - 1 : null, right: turned < SHEETS && 2 * turned < pageCount ? 2 * turned : null });
    schedule();
  }

  applyConfig();
  resize();
  setPaper(paper).catch(err => console.warn(err)).finally(() => { paperReady = true; checkReady(); });
  spreadChanged();
  updateLoop();

  return {
    next: () => step(true),
    prev: () => step(false),
    jumpTo,
    goToPage: p => jumpTo(Math.ceil(clamp(p | 0, 0, pageCount - 1) / 2)),
    setPaper, tunePaper,
    get paper() { return { ...paperNow }; },
    // set('light.sun', 3) or set({ light: { sun: 3 } })
    set(path, value) {
      if (typeof path === 'object') { for (const [k, v] of Object.entries(path)) Object.assign(cfg[k], v); }
      else { const [group, key] = path.split('.'); cfg[group][key] = value; }
      applyConfig();
    },
    get config() { return structuredClone(cfg); },
    get sheet() { return turned; },
    get sheetCount() { return SHEETS; },
    destroy() {
      destroyed = true; stopHold(); stopJump(); ac.abort(); io.disconnect(); ro.disconnect();
      renderer.setAnimationLoop(null);
      for (const s of sheets) { s.mat.dispose(); s.depth.dispose(); }
      for (const t of loaded.values()) t.dispose();
      for (const t of solids.values()) t.dispose();
      paperMaps.tone?.dispose(); paperMaps.height?.dispose(); flat.dispose(); grain.dispose();
      geometry.dispose(); boardGeometry.dispose(); ground.geometry.dispose(); ground.material.dispose(); renderer.dispose();
      canvas.remove(); hit.remove();
    },
  };
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
