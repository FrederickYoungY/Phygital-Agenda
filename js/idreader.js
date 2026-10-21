// ============================================================================
//  idreader.js — Lectura del código de página (rotado 90°, esquina inferior
//  exterior) por correlación con plantillas.
//  Como la geometría es exacta después del aplanado y el conjunto de códigos es
//  cerrado (catálogo de la agenda), se renderiza cada código con la misma fuente,
//  tamaño y espaciado que la imprenta y se elige el de mayor correlación (NCC).
//  Es 100 % local, rápido y funciona sin conexión.
// ============================================================================
import { PAGE } from './config.js';
import { CATALOG } from './catalog.js';
import { STRIP, extractCodeStrip, hypotheses } from './scanner.js';

const S = 3;                 // px por pt en la franja
let fontsReady = null;
const tplCache = new Map();  // `${font}|${id}` → plantilla

export function loadFonts(base = './fonts/') {
  if (!fontsReady) {
    const faces = [new FontFace('PhyPoppins', `url(${base}Poppins-Regular.ttf)`),
                   new FontFace('PhyJosefin', `url(${base}JosefinSans-Regular.ttf)`)];
    fontsReady = Promise.all(faces.map(f => f.load().then(ff => { document.fonts.add(ff); return ff; })));
  }
  return fontsReady;
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}

function template(id, font) {
  const key = font + '|' + id;
  if (tplCache.has(key)) return tplCache.get(key);
  const w = Math.round(STRIP.LEN * S), h = Math.round((STRIP.ASC + STRIP.DESC) * S);
  const cv = makeCanvas(w, h), ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#000'; ctx.textBaseline = 'alphabetic';
  ctx.filter = 'blur(0.9px)';   // la foto nunca es tan nítida como la plantilla
  ctx.font = `${PAGE.CODE_SIZE * S}px ${font}`;
  let x = STRIP.PRE * S;
  const chars = [];
  for (const ch of id) {
    const cw = ctx.measureText(ch).width;
    ctx.fillText(ch, x, STRIP.ASC * S);
    chars.push({ a: Math.floor(x - 1), b: Math.ceil(x + cw + 1) });
    x += cw + PAGE.CODE_CS * S;
  }
  const d = ctx.getImageData(0, 0, w, h).data;
  // tinta y bounding box
  const ink = new Float32Array(w * h);
  let x0 = w, x1 = 0, y0 = h, y1 = 0;
  for (let i = 0; i < ink.length; i++) {
    const v = 1 - d[i * 4] / 255; ink[i] = v;
    if (v > 0.15) { const xx = i % w, yy = (i / w) | 0; if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy; }
  }
  const pad = 2;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  const tw = x1 - x0 + 1, th = y1 - y0 + 1;
  const t = new Float32Array(tw * th);
  let mean = 0;
  for (let y = 0; y < th; y++) for (let xx = 0; xx < tw; xx++) { const v = ink[(y + y0) * w + xx + x0]; t[y * tw + xx] = v; mean += v; }
  mean /= t.length;
  let norm = 0;
  for (let i = 0; i < t.length; i++) { t[i] -= mean; norm += t[i] * t[i]; }
  const T = { t, tw, th, x0, y0, norm: Math.sqrt(norm), ink, w, h, chars, yA: Math.round((STRIP.ASC - PAGE.CODE_SIZE * 0.85) * S), yB: Math.round((STRIP.ASC + 1) * S) };
  tplCache.set(key, T);
  return T;
}

function stripInk(img) {
  const { data, width: w, height: h } = img;
  const g = new Float32Array(w * h);
  // normaliza contraste: papel → 0, tinta más oscura → 1
  let mx = 0, mn = 255;
  for (let i = 0; i < g.length; i++) {
    const v = (data[i * 4] * 77 + data[i * 4 + 1] * 150 + data[i * 4 + 2] * 29) >> 8;
    g[i] = v; if (v > mx) mx = v; if (v < mn) mn = v;
  }
  const rng = Math.max(20, mx - mn);
  for (let i = 0; i < g.length; i++) g[i] = (mx - g[i]) / rng;
  return { g, w, h, contrast: mx - mn };
}

function ncc(strip, T, maxShift) {
  const { g, w, h } = strip;
  let best = -1, bdx = 0, bdy = 0;
  for (let dy = -maxShift; dy <= maxShift; dy++) for (let dx = -maxShift; dx <= maxShift; dx++) {
    const ox = T.x0 + dx, oy = T.y0 + dy;
    if (ox < 0 || oy < 0 || ox + T.tw > w || oy + T.th > h) continue;
    let sI = 0, sII = 0, sIT = 0;
    const N = T.tw * T.th;
    for (let y = 0; y < T.th; y++) {
      const ro = (oy + y) * w + ox, rt = y * T.tw;
      for (let x = 0; x < T.tw; x++) {
        const v = g[ro + x]; sI += v; sII += v * v; sIT += v * T.t[rt + x];
      }
    }
    const varI = sII - sI * sI / N;
    if (varI <= 1e-6) continue;
    const c = sIT / (Math.sqrt(varI) * T.norm);
    if (c > best) { best = c; bdx = dx; bdy = dy; }
  }
  return { c: best, dx: bdx, dy: bdy };
}

// NCC de una ventana [xa,xb)×[ya,yb) de la plantilla contra la franja desplazada (dx,dy)
function nccBox(strip, T, xa, xb, ya, yb, dx, dy) {
  const { g, w, h } = strip;
  let best = -1;
  for (let ey = -1; ey <= 1; ey++) for (let ex = -1; ex <= 1; ex++) {
    let sI = 0, sII = 0, sT = 0, sTT = 0, sIT = 0, N = 0;
    for (let y = ya; y < yb; y++) {
      const sy = y + dy + ey; if (sy < 0 || sy >= h) continue;
      for (let x = xa; x < xb; x++) {
        const sx = x + dx + ex; if (sx < 0 || sx >= w) continue;
        const v = g[sy * w + sx], t = T.ink[y * T.w + x];
        sI += v; sII += v * v; sT += t; sTT += t * t; sIT += v * t; N++;
      }
    }
    if (!N) continue;
    const vI = sII - sI * sI / N, vT = sTT - sT * sT / N;
    if (vI <= 1e-6 || vT <= 1e-6) continue;
    const c = (sIT - sI * sT / N) / Math.sqrt(vI * vT);
    if (c > best) best = c;
  }
  return best;
}

// Puntaje fino: promedio de la correlación carácter por carácter (un dígito distinto pesa mucho)
function charScore(strip, T, dx, dy) {
  let s = 0;
  for (const ch of T.chars) s += nccBox(strip, T, Math.max(0, ch.a), Math.min(T.w, ch.b), Math.max(0, T.yA), Math.min(T.h, T.yB), dx, dy);
  return s / T.chars.length;
}

/**
 * Prueba las 4 hipótesis (giro × lado) y todos los códigos del catálogo compatibles.
 * @param src ImageData de la foto (resolución completa)
 * @param imgPts 4 centros de cuadrados (orden horario desde arriba-izquierda)
 * @returns {{id, score, margin, side, H, ranking:[{id,score}]}}
 */
export async function identifyPage(src, imgPts, catalog = CATALOG) {
  await loadFonts();
  const hyps = hypotheses(imgPts);
  const results = [];
  for (const hy of hyps) {
    const strip = stripInk(extractCodeStrip(src, hy.H, hy.side, S));
    if (strip.contrast < 25) continue;
    const ids = catalog.filter(p => p.lado === hy.side).map(p => p.id);
    for (const id of ids) {
      for (const f of PAGE.CODE_FONTS) {
        const T = template(id, f);
        const r = ncc(strip, T, 4);
        results.push({ id, font: f, score: r.c, coarse: r.c, hy, T, dx: r.dx, dy: r.dy, strip });
      }
    }
  }
  if (!results.length) return null;
  // 1ª etapa: correlación global; 2ª etapa: carácter por carácter sobre los mejores
  results.sort((a, b) => b.coarse - a.coarse);
  const best = results.slice(0, 24);
  for (const r of best) r.score = 0.35 * r.coarse + 0.65 * charScore(r.strip, r.T, r.dx, r.dy);
  best.sort((a, b) => b.score - a.score);
  results.length = 0; results.push(...best);
  const top = results[0];
  const second = results.find(r => r.id !== top.id);
  return {
    id: top.id, score: top.score, margin: top.score - (second ? second.score : 0),
    side: top.hy.side, rot: top.hy.rot, H: top.hy.H,
    ranking: results.slice(0, 6).map(r => ({ id: r.id, font: r.font, score: +r.score.toFixed(3), coarse: +r.coarse.toFixed(3), dx: r.dx, dy: r.dy })), font: top.font,
  };
}

/** Imagen (dataURL) de la franja del código, para mostrarla al usuario. */
export function codeStripPreview(src, H, side) {
  const img = extractCodeStrip(src, H, side, 4, 44);
  const cv = makeCanvas(img.width, img.height);
  cv.getContext('2d').putImageData(img, 0, 0);
  return cv;
}
