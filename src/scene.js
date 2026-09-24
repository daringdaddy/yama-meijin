// 切り絵のジオラマ。スクロールでカメラが登山口→森→お花畑→雲海→山頂へ登る。
// 背景の山はセットとして固定し、鳥・花・雲などの小物だけを 12コマ/秒で動かす（ストップモーション）。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const STEP = 1 / 12;

// ---- 乱数 ----
function rng(seed) {
  let s = seed | 0;
  return () => { s = s + 0x6D2B79F5 | 0; let r = Math.imul(s ^ s >>> 15, 1 | s); r = r + Math.imul(r ^ r >>> 7, 61 | r) ^ r; return ((r ^ r >>> 14) >>> 0) / 4294967296; };
}
const hash = (a, b) => { let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35); h ^= h >>> 13; h = Math.imul(h, 0x27d4eb2d); h ^= h >>> 15; return (h >>> 0) / 4294967296; };

// ---- カメラの立ち位置（セクション順）: 位置と注視点 ----
const KEYS = [
  { p: [0, 2.2, 20], l: [0, 2.4, 0] },        // 登山口
  { p: [0, 5.5, 11], l: [0, 5.8, -10] },       // 登山道
  { p: [0, 32, -22], l: [0, 32.5, -40] },      // 森（鳥）
  { p: [0, 62, -62], l: [0, 62.4, -80] },      // お花畑（花）
  { p: [0, 94, -102], l: [0, 94.6, -120] },    // 雲海（雲）
  { p: [0, 112, -118], l: [0, 125, -150] },    // 山頂（見上げる）
];
// カメラの高さごとの空の色
const SKY = [[0, '#efe9dc'], [32, '#ebe6d6'], [62, '#e6ecdc'], [94, '#f3e1c8'], [104, '#8d97a6'], [112, '#2c4561']];

export function createScene(canvas, { reduced = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;

  const scene = new THREE.Scene();
  const bg = new THREE.Color(SKY[0][1]);
  scene.background = bg;
  scene.fog = new THREE.Fog(bg.clone(), 28, 150);

  const camera = new THREE.PerspectiveCamera(35, 1, 0.5, 400);
  scene.add(camera);
  // 高度帯ごとのセット。見えるのはカメラがいる帯だけ（帯の切り替えは雲の中で行う）
  const G = [0, 1, 2, 3].map(() => { const g = new THREE.Group(); scene.add(g); return g; });
  let cur = G[0];

  // ---- 光：やわらかい環境光＋影を落とす太陽 ----
  scene.add(new THREE.HemisphereLight('#fffaf0', '#b9b1a0', 1.55));
  const sun = new THREE.DirectionalLight('#fff3dc', 1.7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -34, right: 34, top: 26, bottom: -26, near: 1, far: 140 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  // ---- 紙の質感（色に掛け合わせる紙目） ----
  const grain = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d'); const img = g.createImageData(256, 256); const r = rng(5);
    for (let i = 0; i < img.data.length; i += 4) { const v = 236 + r() * 19; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
    g.putImageData(img, 0, 0);
    for (let i = 0; i < 380; i++) {
      const x = r() * 256, y = r() * 256, a = r() * Math.PI, l = 3 + r() * 10;
      g.strokeStyle = r() < .5 ? 'rgba(255,255,255,.55)' : 'rgba(120,110,90,.16)'; g.lineWidth = .6 + r() * .6;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(.3, .3); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return t;
  })();
  const mats = new Map();
  const mat = (color) => {
    if (!mats.has(color)) mats.set(color, new THREE.MeshStandardMaterial({ color, map: grain, roughness: 1, metalness: 0 }));
    return mats.get(color);
  };

  // 手で切った輪郭（少しだけガタつかせる）
  const shapeOf = (pts, seed = 1, wob = 0.03) => {
    const r = rng(seed); const s = new THREE.Shape();
    pts.forEach(([x, y], i) => { const nx = x + (r() - .5) * wob * 2, ny = y + (r() - .5) * wob * 2; i ? s.lineTo(nx, ny) : s.moveTo(nx, ny); });
    s.closePath(); return s;
  };
  const extrude = (shape, depth = 0.08) => new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 6 });
  const flat = (shape) => new THREE.ShapeGeometry(shape, 6);
  const mesh = (geo, color, { cast = true, receive = true } = {}) => { const m = new THREE.Mesh(geo, mat(color)); m.castShadow = cast; m.receiveShadow = receive; return m; };

  // 稜線：peaks=[[x, 高さ, 裾の半幅]]
  const ridgePts = (seed, x0, x1, base, peaks, jag, bottom, n = 90) => {
    const r = rng(seed); const pts = [[x0, bottom]];
    for (let i = 0; i <= n; i++) {
      const x = x0 + (x1 - x0) * i / n;
      let y = base; for (const [px, ph, pw] of peaks) y += ph * Math.max(0, 1 - Math.abs(x - px) / pw) ** 1.15;
      pts.push([x, y + (r() - .5) * jag]);
    }
    pts.push([x1, bottom]); return pts;
  };
  const ridgeY = (pts, x) => { // 稜線上の高さ（花や木を稜線に置くため）
    for (let i = 1; i < pts.length - 2; i++) { const [xa, ya] = pts[i], [xb, yb] = pts[i + 1]; if (x >= xa && x <= xb) return ya + (yb - ya) * (x - xa) / (xb - xa); }
    return pts[1][1];
  };
  const layer = (pts, color, z, seed) => { const m = mesh(extrude(shapeOf(pts, seed, 0.02)), color); m.position.z = z - 0.08; cur.add(m); return m; };

  const tree = (h, w, seed) => {
    const t = [[-.07, 0], [-.07, .1], [-.5, .1], [-.2, .4], [-.4, .4], [-.14, .68], [-.3, .68], [0, 1]];
    const pts = [...t, ...t.slice(0, -1).reverse().map(([x, y]) => [-x, y])].map(([x, y]) => [x * w, y * h]);
    return extrude(shapeOf(pts, seed, 0.02), 0.06);
  };
  const forestRow = (seed, color, z, ground, count, hMin, hMax, spread = 70) => {
    const r = rng(seed);
    const pts = ridgePts(seed, -spread, spread, ground, [], 0.5, ground - 45, 40);
    const geos = [extrude(shapeOf(pts, seed, 0.02))];
    for (let i = 0; i < count; i++) {
      const u = r() * 2 - 1, x = Math.sign(u) * Math.abs(u) ** 1.2 * spread * .9;
      const h = hMin + r() * (hMax - hMin);
      const g = tree(h, h * (.42 + r() * .12), seed * 100 + i); g.translate(x, ridgeY(pts, x) - .15, 0.01 * (i % 3)); geos.push(g);
    }
    const m = mesh(mergeGeometries(geos), color); m.position.z = z - 0.08; cur.add(m); return m;
  };


  // ================= ① 登山口（y≈0） =================
  {
    const far = ridgePts(11, -90, 90, 1.2, [[-14, 6.2, 12], [-3, 4.5, 8], [7, 6.8, 11], [20, 4.2, 10], [-30, 3.5, 12], [34, 3, 14]], 0.5, -45);
    layer(far, '#c3ccbd', -38, 11);
    // 残雪
    for (const [px, py] of [[-14, 7.3], [7, 7.9], [-3, 5.6]]) {
      const s = mesh(flat(shapeOf([[-1.3, -.6], [-.5, -.1], [0, .15], [.6, -.2], [1.4, -.7], [.7, -.45], [.2, -.8], [-.4, -.5]], px * 7, 0.05)), '#fbfaf5', { cast: false });
      s.position.set(px, py - .3, -37.9); s.scale.setScalar(1.2); cur.add(s);
    }
    layer(ridgePts(12, -90, 90, -0.6, [[-22, 3.2, 14], [2, 2.6, 16], [26, 3.6, 14]], 0.5, -45), '#a9b8a6', -27, 12);
    forestRow(13, '#8a9a6b', -17, -1.6, 70, .8, 1.5, 70);
    forestRow(14, '#5f7a55', -9, -3.4, 60, .7, 1.2, 50);
    forestRow(15, '#3f5d4a', -1.5, -4.6, 40, .9, 1.6, 34);
    const sunDisk = mesh(flat(shapeOf([...Array(40)].map((_, i) => [Math.cos(i / 40 * Math.PI * 2) * 2.4, Math.sin(i / 40 * Math.PI * 2) * 2.4]), 3, 0.03)), '#e8c86a', { cast: false });
    sunDisk.position.set(4.5, 10.5, -46); cur.add(sunDisk);
  }

  // 雲の形（下が平らで上がもこもこ）
  const cloudPts = (w, h, seed) => { // 3つの丸を並べた雲（底は平ら）
    const r = rng(seed);
    const cs = [[-.3 * w, (.18 + r() * .06) * w], [-.02 * w, (.27 + r() * .06) * w], [.28 * w, (.17 + r() * .06) * w]];
    const top = (x) => Math.max(0, ...cs.map(([cx, rr]) => Math.abs(x - cx) < rr ? Math.sqrt(rr * rr - (x - cx) ** 2) : 0));
    const x0 = cs[0][0] - cs[0][1] * .98, x1 = cs[2][0] + cs[2][1] * .98;
    const pts = []; const n = 48;
    for (let i = 0; i <= n; i++) { const x = x0 + (x1 - x0) * i / n; pts.push([x, Math.max(.04, top(x)) * (h / (.3 * w))]); }
    return pts;
  };
  const drifting = [];
  for (const [x, y, z, w, s] of [[-7, 11.5, -32, 5, 21], [9, 13.5, -40, 6, 22], [-2, 16, -44, 4, 23]]) {
    const c = mesh(extrude(shapeOf(cloudPts(w, w * .3, s), s, 0.03), 0.06), '#fbfaf5'); c.position.set(x, y, z); cur.add(c);
    drifting.push({ obj: c, x0: x, speed: .12 + (s % 3) * .04, range: 36 });
  }

  // ================= ② 森：鳥 =================
  cur = G[1];
  {
    const B = 30, Z = -40;
    forestRow(21, '#2f4638', Z, B - 3.2, 70, 1.8, 3.4, 44);
    forestRow(22, '#3f5d4a', Z - 5, B - 1.2, 80, 2, 3.6, 56);
    forestRow(23, '#5f7a55', Z - 12, B + 1.2, 90, 2, 3.4, 70);
    forestRow(24, '#7f9570', Z - 20, B + 4.5, 90, 1.4, 2.4, 80);
    layer(ridgePts(25, -110, 110, B + 7, [[-26, 8, 18], [-6, 12, 16], [18, 9, 18], [44, 7, 20]], 0.7, B - 45), '#aebaa6', Z - 34, 25);
  }
  // 鳥：アイコンと同じ「Vの字」。羽ばたきは3枚の絵を切り替えるだけ
  const birds = [];
  {
    const wingL = new THREE.Shape(); wingL.moveTo(0, 0); wingL.quadraticCurveTo(-.25, .32, -.62, .42); wingL.quadraticCurveTo(-.3, .12, -.05, -.06); wingL.closePath();
    const wingR = new THREE.Shape(); wingR.moveTo(0, 0); wingR.quadraticCurveTo(.25, .32, .62, .42); wingR.quadraticCurveTo(.3, .12, .05, -.06); wingR.closePath();
    const bodyShape = new THREE.Shape(); bodyShape.absellipse(0, -.02, .2, .09, 0, Math.PI * 2);
    const specs = [[-8, 34.4, -44, '#5a4632', .55, 0], [-12, 35.6, -47, '#5a4632', .45, 1.3], [4, 36.2, -49, '#2456a8', .5, 2.1], [10, 33.6, -43.5, '#5a4632', .6, 3.3], [0, 37.2, -51, '#5a4632', .42, 4.7]];
    for (const [x, y, z, color, sc, ph] of specs) {
      const g = new THREE.Group();
      const b = mesh(flat(bodyShape), color); const l = mesh(flat(wingL), color); const r = mesh(flat(wingR), color);
      g.add(l, r, b); g.scale.setScalar(sc * 1.6); g.position.set(x, y, z); cur.add(g);
      birds.push({ g, l, r, x0: x, y0: y, ph, speed: .9 + ph * .08 });
    }
  }

  // ================= ③ お花畑：花 =================
  cur = G[2];
  const flowers = [];
  {
    const B = 60, Z = -80;
    const p0 = ridgePts(31, -80, 80, B - 2.2, [[-8, .6, 20], [10, .8, 24]], .15, B - 45);
    const p1 = ridgePts(32, -90, 90, B - .3, [[-14, 1, 22], [16, 1.3, 20]], .2, B - 45);
    const p2 = ridgePts(33, -100, 100, B + 1.6, [[0, 1.2, 30]], .25, B - 45);
    layer(p0, '#6d8a5a', Z, 31); layer(p1, '#86a06a', Z - 5, 32); layer(p2, '#a3b38a', Z - 11, 33);
    // 岩稜と残雪
    const rock = ridgePts(34, -110, 110, B + 3.5, [[-18, 5, 12], [-5, 7.5, 9], [9, 5.8, 10], [26, 6.5, 12]], 1.3, B - 45, 120);
    layer(rock, '#9aa093', Z - 21, 34);
    for (const [px, py] of [[-5, 10.4], [-18, 8], [26, 9.5], [9, 8.7]]) {
      const s = mesh(flat(shapeOf([[-1, -.4], [-.3, 0], [.2, .1], [.9, -.3], [.4, -.6], [-.4, -.7]], px * 3 + 9, .05)), '#fbfaf5', { cast: false });
      s.position.set(px, B + py - 1.6, Z - 20.9); cur.add(s);
    }
    layer(ridgePts(35, -130, 130, B + 8, [[-30, 7, 22], [0, 10, 18], [32, 8, 22]], .8, B - 45), '#c5ccc0', Z - 38, 35);

    // 花の部品
    const petalRound = (len, wid) => { const s = new THREE.Shape(); s.moveTo(0, 0); s.bezierCurveTo(-wid, len * .35, -wid * .9, len, 0, len); s.bezierCurveTo(wid * .9, len, wid, len * .35, 0, 0); return s; };
    const petalNotch = (len, wid) => { const s = new THREE.Shape(); s.moveTo(0, 0); s.bezierCurveTo(-wid, len * .3, -wid, len * .95, -wid * .35, len); s.lineTo(0, len * .82); s.lineTo(wid * .35, len); s.bezierCurveTo(wid, len * .95, wid, len * .3, 0, 0); return s; };
    const petalLong = (len, wid) => { const s = new THREE.Shape(); s.moveTo(0, 0); s.quadraticCurveTo(-wid, len * .5, 0, len); s.quadraticCurveTo(wid, len * .5, 0, 0); return s; };
    const disc = (r) => { const s = new THREE.Shape(); s.absarc(0, 0, r, 0, Math.PI * 2); return s; };
    const TYPES = [
      { n: 5, petal: flat(petalRound(.34, .2)), color: '#fffdf8', eye: '#e9c53a', eyeR: .1 },    // チングルマ風
      { n: 6, petal: flat(petalLong(.46, .12)), color: '#f2a93a', eye: '#b3661e', eyeR: .06 },    // ニッコウキスゲ風
      { n: 5, petal: flat(petalNotch(.28, .17)), color: '#e793b4', eye: '#f3d55a', eyeR: .07 },  // ハクサンコザクラ風
    ];
    const flowerMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: grain, roughness: 1, metalness: 0 });
    const leafCache = new Map();
    const leafGeo = (len) => { const k = len.toFixed(2); if (!leafCache.has(k)) leafCache.set(k, flat(petalLong(len, .08))); return leafCache.get(k); };
    const r = rng(36);
    const rows = [[p0, Z + .02, 46, 1], [p1, Z - 5 + .02, 40, .8], [p2, Z - 11 + .02, 30, .62]];
    rows.forEach(([pts, z, count, sc], ri) => {
      for (let i = 0; i < count; i++) {
        const u = r() * 2 - 1, x = Math.sign(u) * Math.abs(u) ** 1.35 * 16;
        const t = TYPES[Math.floor(r() * 3)];
        const stemH = (.35 + r() * .8) * sc;
        // 1輪ぶんの部品を1つの形にまとめる（描画回数を減らす）。色は頂点色で持つ
        const parts = [];
        const put = (geo, color, m4) => { const g = geo.clone().applyMatrix4(m4); const c = new THREE.Color(color); const n = g.attributes.position.count; g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(n).fill(0).flatMap(() => [c.r, c.g, c.b]), 3)); parts.push(g); };
        const M = (x, y, z, rz = 0, s = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rz), new THREE.Vector3(s, s, s));
        put(flat(shapeOf([[-.025, 0], [-.025, stemH], [.025, stemH], [.025, 0]], i, 0)), '#557a47', M(0, 0, 0));
        put(leafGeo(.34 * sc + .1), '#557a47', M(0, stemH * .15, .002, (r() < .5 ? 1 : -1) * (.6 + r() * .4)));
        const hs = sc * (.85 + r() * .35);
        for (let k = 0; k < t.n; k++) put(t.petal, t.color, M(0, stemH, .004 + .004 * k, k / t.n * Math.PI * 2 + r() * .2, hs));
        put(flat(disc(t.eyeR)), t.eye, M(0, stemH, .05, 0, hs));
        const g = new THREE.Mesh(mergeGeometries(parts), flowerMat); g.castShadow = true; g.receiveShadow = true;
        g.position.set(x, ridgeY(pts, x) - .12, z + r() * .05);
        g.scale.setScalar(0.001); cur.add(g);
        flowers.push({ g, delay: (x + 16) / 32 * .9 + ri * .25 + r() * .15, id: flowers.length });
      }
    });
  }

  // ================= ④ 雲海：雲 =================
  cur = G[3];
  const kasa = [];
  const seaLayers = [];
  {
    const B = 90, Z = -120;
    // 主峰（笠雲をかぶる山）
    const peakPts = [[-60, B - 40], [-6, B + 3.2], [-2.2, B + 6.8], [-.8, B + 8.2], [0, B + 8.5], [1, B + 8.2], [2.6, B + 6.6], [7, B + 3], [60, B - 40]];
    const peak = mesh(extrude(shapeOf(peakPts, 41, .06)), '#6b7a8c'); peak.position.z = Z - 18; cur.add(peak);
    const snow = mesh(flat(shapeOf([[-2.3, B + 6.7], [-.8, B + 8.2], [0, B + 8.5], [1, B + 8.2], [2.7, B + 6.5], [1.8, B + 6.1], [1, B + 6.9], [.2, B + 6], [-.7, B + 6.8], [-1.5, B + 6.1]], 42, .03)), '#fbfcfd', { cast: false });
    snow.position.z = Z - 17.9; cur.add(snow);
    // 笠雲：3枚のレンズが山頂にかぶさる（近づくと1枚ずつ置かれる）
    const lens = (w, h) => { const s = new THREE.Shape(); s.moveTo(-w / 2, 0); s.quadraticCurveTo(0, h * 2, w / 2, 0); s.quadraticCurveTo(0, h * .35, -w / 2, 0); return s; };
    [[7.6, .9, 8.0, '#fbfcfd'], [6, .8, 8.75, '#eef3f8'], [4.2, .7, 9.4, '#fbfcfd']].forEach(([w, h, y, c], i) => {
      const m = mesh(extrude(lens(w, h), .07), c); m.position.set(.1, B + y, Z - 17.3 + i * .12); m.scale.setScalar(.001); cur.add(m);
      kasa.push({ m, i });
    });
    // 遠くの峰
    layer(ridgePts(43, -140, 140, B - 2, [[-34, 7, 9], [-22, 4.5, 7], [28, 6.5, 9], [45, 4, 8]], .5, B - 45), '#9fb2c6', Z - 45, 43);
    // 朝日
    const s = mesh(flat(shapeOf([...Array(48)].map((_, i) => [Math.cos(i / 48 * Math.PI * 2) * 4.2, Math.sin(i / 48 * Math.PI * 2) * 4.2]), 44, .05)), '#f2b45a', { cast: false });
    s.position.set(-10, B + 2.6, Z - 70); cur.add(s);
    // 雲海：手前ほど白く、横にゆっくり流れる
    const sea = [[Z - 2, B + .2, '#fbfcfd', 51, .06], [Z - 7, B + 1.2, '#f1f5f9', 52, -.04], [Z - 13, B + 2.1, '#e4ecf3', 53, .03], [Z - 30, B + 2.6, '#d6e1eb', 54, -.02]];
    for (const [z, top, color, seed, speed] of sea) {
      const r = rng(seed); const pts = [[-120, top - 45]];
      for (let x = -120; x <= 120; x += 1.2) pts.push([x, top + Math.abs(Math.sin(x * .55 + seed)) * .7 + r() * .15]);
      pts.push([120, top - 45]);
      const m = mesh(extrude(shapeOf(pts, seed, .02), .06), color); m.position.z = z; cur.add(m);
      seaLayers.push({ m, speed });
    }
  }

  // ================= ⑤ 山頂の空：星 =================
  const stars = [];
  {
    const star = new THREE.Shape(); for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2 + Math.PI / 2, rr = i % 2 ? .12 : .42; i ? star.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : star.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    star.closePath(); const g = flat(star); const r = rng(61);
    for (let i = 0; i < 70; i++) {
      const m = mesh(g, i % 5 ? '#f3e6c0' : '#e8c86a', { cast: false, receive: false });
      m.material = new THREE.MeshBasicMaterial({ color: i % 5 ? '#f3e6c0' : '#e8c86a', fog: false });
      m.position.set((r() - .5) * 90, 119 + r() * 40, -175 - r() * 30); m.scale.setScalar(.6 + r() * 1.3); m.rotation.z = r();
      cur.add(m); stars.push({ m, s: m.scale.x, id: i });
    }
  }

  // ---- 帯のあいだの雲（カメラに付いていて、登るあいだ上から下へ流れ過ぎる） ----
  const mist = new THREE.Group(); camera.add(mist);
  const mistLayers = [];
  {
    const band = (w, h, seed) => { // 上下の縁がもこもこした、縦長の雲の帯
      const r = rng(seed); const pts = []; const edge = (x, k) => { // 丸をつなげた縁
        const period = 1.6 + (k % 2) * .5, ph = seed * .7 + k;
        const u = ((x + ph) / period) % 1; const t = (u < 0 ? u + 1 : u) * 2 - 1; return Math.sqrt(Math.max(0, 1 - t * t)) * .55;
      };
      const n = 120;
      for (let i = 0; i <= n; i++) { const x = -w / 2 + w * i / n; pts.push([x, h / 2 + edge(x, 1) + r() * .02]); }
      for (let i = n; i >= 0; i--) { const x = -w / 2 + w * i / n; pts.push([x, -h / 2 - edge(x, 2) - r() * .02]); }
      return shapeOf(pts, seed, .005);
    };
    const fine = grain.clone(); fine.repeat.set(3, 3); fine.needsUpdate = true;
    [['#fbfaf6', 0, 61], ['#ffffff', .35, 62], ['#f4f2ec', -.3, 63]].forEach(([c, off, seed], i) => {
      const m = new THREE.Mesh(flat(band(14, 7.5, seed)), new THREE.MeshBasicMaterial({ color: c, map: fine, fog: false, depthTest: false, transparent: false }));
      m.position.z = -4 - i * .02; m.renderOrder = 10 + i;
      mist.add(m); mistLayers.push({ m, off });
    });
  }
  const bandY = KEYS.map(k => k.p[1]);                 // 2.2, 5.5, 32, 62, 94, 112
  const BANDS = [[-99, 5.5], [5.5, 32], [32, 62], [62, 94], [94, 999]]; // カメラ高さ→どの帯の間か
  const BAND_OF = [0, 0, 1, 2, 3, 3];
  function updateBands(y) {
    // いま、どのキー間を移動中か（帯が変わる区間だけ雲を流す）
    let u = -1, from = 0, to = 0;
    for (let i = 0; i < bandY.length - 1; i++) {
      if (y >= bandY[i] && y <= bandY[i + 1]) { from = BAND_OF[i]; to = BAND_OF[i + 1]; u = (y - bandY[i]) / (bandY[i + 1] - bandY[i]); break; }
    }
    if (y > bandY[bandY.length - 1]) { from = to = 3; }
    const active = u >= 0 && from !== to ? (u < .5 ? from : to) : (y <= bandY[0] ? 0 : to);
    G.forEach((g, i) => { g.visible = i === active; });
    const crossing = u >= 0 && from !== to;
    mist.visible = crossing && u > .08 && u < .92;
    if (mist.visible) {
      const H = 2 * 4 * Math.tan(camera.fov * Math.PI / 360); // 距離4での画面の高さ
      const k = (u - .08) / .84;
      mistLayers.forEach(({ m, off }, i) => { m.position.y = (1 - 2 * k) * H * 2.1 + off * H; m.scale.x = Math.max(1, camera.aspect * 1.2); });
    }
  }

  // ---- 動かす ----
  const cam = { p: new THREE.Vector3(...KEYS[0].p), l: new THREE.Vector3(...KEYS[0].l) };
  const target = { p: cam.p.clone(), l: cam.l.clone() };
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  let progress = 0, lastStep = -1, dirty = true, running = true;
  const bloom = { start: null }, kasaState = { start: null };

  function setProgress(f) { // f: セクション番号（小数）
    progress = Math.max(0, Math.min(KEYS.length - 1, f));
    const i = Math.min(KEYS.length - 2, Math.floor(progress)), t = progress - i;
    const e = t * t * (3 - 2 * t);
    target.p.fromArray(KEYS[i].p).lerp(new THREE.Vector3(...KEYS[i + 1].p), e);
    target.l.fromArray(KEYS[i].l).lerp(new THREE.Vector3(...KEYS[i + 1].l), e);
    dirty = true;
  }
  function setPointer(x, y) { pointer.tx = x; pointer.ty = y; dirty = true; }

  const skyColor = (y, out) => {
    for (let i = 0; i < SKY.length - 1; i++) {
      const [y0, c0] = SKY[i], [y1, c1] = SKY[i + 1];
      if (y <= y1 || i === SKY.length - 2) { const t = Math.max(0, Math.min(1, (y - y0) / (y1 - y0))); return out.set(c0).lerp(new THREE.Color(c1), t); }
    }
    return out;
  };

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h;
    // 縦長画面では少し引いて、横幅が足りなくならないようにする
    camera.fov = w / h < .8 ? 42 : 35;
    camera.updateProjectionMatrix(); dirty = true;
  }
  resize(); window.addEventListener('resize', resize);

  const clock = new THREE.Clock();
  function frame() {
    if (!running) return;
    requestAnimationFrame(frame);
    const t = clock.getElapsedTime();
    const step = Math.floor(t / STEP);
    const k = reduced ? 1 : 0.075;
    pointer.x += (pointer.tx - pointer.x) * .05; pointer.y += (pointer.ty - pointer.y) * .05;
    const before = cam.p.x + cam.p.y + cam.p.z;
    cam.p.lerp(target.p, k); cam.l.lerp(target.l, k);
    const moving = Math.abs(before - (cam.p.x + cam.p.y + cam.p.z)) > 1e-4 || Math.abs(pointer.tx - pointer.x) > 1e-3 || Math.abs(pointer.ty - pointer.y) > 1e-3;
    const newStep = step !== lastStep && !reduced;
    if (!moving && !newStep && !dirty) return;
    dirty = false;

    camera.position.set(cam.p.x + pointer.x * .9, cam.p.y - pointer.y * .45, cam.p.z);
    camera.lookAt(cam.l.x + pointer.x * .3, cam.l.y, cam.l.z);
    skyColor(camera.position.y, bg); scene.fog.color.copy(bg);
    updateBands(cam.p.y);
    sun.position.set(cam.l.x - 12, cam.l.y + 18, cam.l.z + 26); sun.target.position.copy(cam.l);

    if (newStep || lastStep < 0) {
      lastStep = step;
      const tq = step * STEP; // 12コマ/秒に量子化した時刻
      for (const d of drifting) d.obj.position.x = ((d.x0 + tq * d.speed + d.range / 2) % d.range + d.range) % d.range - d.range / 2;
      for (const b of birds) {
        const f = (step + Math.round(b.ph * 3)) % 4, w = [1, .35, -.55, .35][f];
        b.l.scale.y = b.r.scale.y = w;
        b.g.position.x = ((b.x0 + tq * b.speed + 30) % 60 + 60) % 60 - 30;
        b.g.position.y = b.y0 + Math.sin(tq * 1.3 + b.ph) * .35 + (f === 2 ? -.05 : 0);
      }
      for (const s of seaLayers) s.m.position.x = Math.sin(tq * .05) * 6 * Math.sign(s.speed) * Math.abs(s.speed) * 10;
      // 花：お花畑に近づいたら、左から順に1輪ずつ咲く
      if (progress > 2.45 && bloom.start === null) bloom.start = tq;
      for (const f of flowers) {
        let s = 0.001;
        if (bloom.start !== null) {
          const k2 = (tq - bloom.start - f.delay) / (STEP * 4);
          s = k2 <= 0 ? 0.001 : k2 >= 1 ? 1 : [0.35, 0.75, 1.12, 1][Math.min(3, Math.floor(k2 * 4))];
          if (reduced) s = 1;
        }
        f.g.scale.setScalar(s);
        if (s >= 1) f.g.rotation.z = (hash(f.id, step) - .5) * .05;
      }
      // 笠雲：雲海に近づいたら3枚が順に置かれる
      if (progress > 3.4 && kasaState.start === null) kasaState.start = tq;
      for (const c of kasa) {
        let s = .001;
        if (kasaState.start !== null) { const k3 = (tq - kasaState.start - .5 - c.i * .35) / (STEP * 3); s = k3 <= 0 ? .001 : k3 >= 1 ? 1 : [.5, 1.15, 1][Math.min(2, Math.floor(k3 * 3))]; if (reduced) s = 1; }
        c.m.scale.setScalar(s);
        if (s >= 1) c.m.position.x = .1 + (hash(c.i + 70, step) - .5) * .06;
      }
      for (const s of stars) s.m.scale.setScalar(s.s * (hash(s.id, Math.floor(step / 3)) > .85 ? .6 : 1));
    }
    renderer.render(scene, camera);
  }
  frame();
  document.addEventListener('visibilitychange', () => { const was = running; running = !document.hidden; if (running && !was) { dirty = true; frame(); } });

  return { setProgress, setPointer, keyCount: KEYS.length };
}
