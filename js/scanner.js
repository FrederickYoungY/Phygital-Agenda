// ============================================================================
//  scanner.js — Visión artificial sin dependencias
//  · Detección de los 4 cuadrados fiduciarios (umbral adaptativo + componentes
//    conexas + momentos de 2º orden → "cuadrado macizo", invariante a rotación)
//  · Homografía (4 puntos) y aplanado de la página (warp con interpolación bilineal)
//  · Extracción de la franja del código (rotada 90°) ya enderezada
//  Todas las funciones trabajan sobre ImageData / arreglos, así se pueden mover
//  a un Web Worker sin cambios.
// ============================================================================
import { PAGE } from './config.js';

// ---------------------------------------------------------------- utilidades
export function toGray(img) {
  const { data, width, height } = img;
  const g = new Uint8Array(width * height);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) {
    g[j] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
  }
  return g;
}

function integral(g, w, h) {
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 1; y <= h; y++) {
    let row = 0;
    const o = (y - 1) * w, io = y * (w + 1), ip = (y - 1) * (w + 1);
    for (let x = 1; x <= w; x++) {
      row += g[o + x - 1];
      I[io + x] = I[ip + x] + row;
    }
  }
  return I;
}

// --------------------------------------------------- 1) cuadrados fiduciarios
/**
 * Busca los 4 cuadrados negros de las esquinas.
 * @returns {null | {pts:[{x,y,s}], score:number}}  pts en orden horario empezando por el
 *          más cercano a la esquina superior izquierda de la IMAGEN.
 */
export function detectMarkers(g, w, h, opts = {}) {
  const maxCand = opts.maxCandidates || 32;
  const r = Math.max(6, Math.round(Math.max(w, h) / 45));
  const I = integral(g, w, h);
  const W1 = w + 1;

  // máscara de "muy oscuro respecto al entorno"
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const sum = I[y1 * W1 + x1] - I[y0 * W1 + x1] - I[y1 * W1 + x0] + I[y0 * W1 + x0];
      const n = (y1 - y0) * (x1 - x0);
      const v = g[y * w + x];
      if (v * n < sum * 0.6 && v < 170) mask[y * w + x] = 1;
    }
  }

  // componentes conexas (8-vecinos) con momentos
  const label = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  const maxSide = Math.max(w, h) * 0.06;
  const cands = [];
  let cur = 0;
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p] || label[p]) continue;
    cur++;
    let sp = 0; stack[sp++] = p; label[p] = cur;
    let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    let minx = w, maxx = 0, miny = h, maxy = 0, big = false;
    while (sp) {
      const q = stack[--sp];
      const x = q % w, y = (q / w) | 0;
      n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
      if (x < minx) minx = x; if (x > maxx) maxx = x;
      if (y < miny) miny = y; if (y > maxy) maxy = y;
      if (maxx - minx > maxSide || maxy - miny > maxSide) big = true;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= w) continue;
          const qq = yy * w + xx;
          if (mask[qq] && !label[qq]) { label[qq] = cur; stack[sp++] = qq; }
        }
      }
    }
    if (big || n < (opts.minArea || 10)) continue;
    const mx = sx / n, my = sy / n;
    const cxx = sxx / n - mx * mx + 1 / 12, cyy = syy / n - my * my + 1 / 12, cxy = sxy / n - mx * my;
    const det = cxx * cyy - cxy * cxy;
    if (det <= 0) continue;
    const solidity = n / (12 * Math.sqrt(det));          // 1.0 = cuadrilátero macizo
    const tr = cxx + cyy, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
    const elong = (tr / 2 + disc) / Math.max(1e-6, tr / 2 - disc);
    if (solidity < 0.78 || solidity > 1.25 || elong > 2.6) continue;
    // contraste: el cuadrado debe ser bastante más oscuro que su anillo exterior
    cands.push({ x: mx + 0.5, y: my + 0.5, s: Math.sqrt(n), area: n, q: Math.abs(1 - solidity) + (elong - 1) * 0.15 });
  }
  if (cands.length < 4) return null;
  cands.sort((a, b) => a.q - b.q);
  const C = cands.slice(0, maxCand);

  // búsqueda de la mejor cuaterna
  const ratioShort = PAGE.MARKER / (PAGE.W - PAGE.M_OUT - PAGE.M_INN);
  const aspectExp = (PAGE.W - PAGE.M_OUT - PAGE.M_INN) / (PAGE.H - 2 * PAGE.M_V);
  let best = null;
  const n = C.length;
  for (let a = 0; a < n - 3; a++) for (let b = a + 1; b < n - 2; b++)
    for (let c = b + 1; c < n - 1; c++) for (let d = c + 1; d < n; d++) {
      const Q = [C[a], C[b], C[c], C[d]];
      let smin = Infinity, smax = 0;
      for (const p of Q) { if (p.s < smin) smin = p.s; if (p.s > smax) smax = p.s; }
      if (smax > smin * 2.3) continue;
      const o = orderClockwise(Q);
      if (!convex(o)) continue;
      const L = [dist(o[0], o[1]), dist(o[1], o[2]), dist(o[2], o[3]), dist(o[3], o[0])];
      const e1 = (L[0] + L[2]) / 2, e2 = (L[1] + L[3]) / 2;
      const sh = Math.min(e1, e2), lo = Math.max(e1, e2);
      const asp = sh / lo;
      if (asp < aspectExp * 0.7 || asp > aspectExp * 1.3) continue;
      const ms = (o[0].s + o[1].s + o[2].s + o[3].s) / 4;
      const rel = ms / sh / ratioShort;
      if (rel < 0.45 || rel > 2.2) continue;
      // lados opuestos parecidos (perspectiva moderada)
      if (Math.min(L[0], L[2]) / Math.max(L[0], L[2]) < 0.6) continue;
      if (Math.min(L[1], L[3]) / Math.max(L[1], L[3]) < 0.6) continue;
      const area = polyArea(o);
      const score = area * (1 - Math.abs(asp - aspectExp)) * (1 - Math.min(0.5, Math.abs(Math.log(rel)) * 0.3));
      if (!best || score > best.score) best = { pts: o, score };
    }
  return best;
}

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function polyArea(p) {
  let s = 0;
  for (let i = 0; i < p.length; i++) { const j = (i + 1) % p.length; s += p[i].x * p[j].y - p[j].x * p[i].y; }
  return Math.abs(s) / 2;
}
function convex(p) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = p[i], b = p[(i + 1) % 4], c = p[(i + 2) % 4];
    const z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (z === 0) return false;
    if (!sign) sign = Math.sign(z); else if (Math.sign(z) !== sign) return false;
  }
  return true;
}
export function orderClockwise(Q) {
  const cx = Q.reduce((s, p) => s + p.x, 0) / 4, cy = Q.reduce((s, p) => s + p.y, 0) / 4;
  const o = [...Q].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  let k = 0, m = Infinity;
  o.forEach((p, i) => { if (p.x + p.y < m) { m = p.x + p.y; k = i; } });
  return [...o.slice(k), ...o.slice(0, k)];
}

/** Afina el centro de cada cuadrado en la imagen a resolución completa. */
export function refineMarkers(g, w, h, pts) {
  return pts.map(p => {
    const R = Math.max(4, Math.round(p.s * 1.3));
    const x0 = Math.max(0, Math.floor(p.x - R)), x1 = Math.min(w - 1, Math.ceil(p.x + R));
    const y0 = Math.max(0, Math.floor(p.y - R)), y1 = Math.min(h - 1, Math.ceil(p.y + R));
    let mn = 255, sum = 0, cnt = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const v = g[y * w + x]; if (v < mn) mn = v; sum += v; cnt++;
    }
    // borde del parche ≈ papel
    let bs = 0, bc = 0;
    for (let x = x0; x <= x1; x++) { bs += g[y0 * w + x] + g[y1 * w + x]; bc += 2; }
    for (let y = y0; y <= y1; y++) { bs += g[y * w + x0] + g[y * w + x1]; bc += 2; }
    const thr = (mn + bs / bc) / 2;
    let sx = 0, sy = 0, n = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const v = g[y * w + x];
      if (v < thr) { const wt = thr - v; sx += (x + 0.5) * wt; sy += (y + 0.5) * wt; n += wt; }
    }
    return n ? { x: sx / n, y: sy / n, s: p.s } : p;
  });
}

// --------------------------------------------------------- 2) homografía
/** H tal que (u,v) → (x,y). src y dst: 4 puntos {x,y}. */
export function homography(src, dst) {
  const A = [], B = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i], { x: X, y: Y } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]); B.push(X);
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]); B.push(Y);
  }
  const h = solve(A, B);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}
function solve(A, b) {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}
export function applyH(H, x, y) {
  const d = H[6] * x + H[7] * y + H[8];
  return { x: (H[0] * x + H[1] * y + H[2]) / d, y: (H[3] * x + H[4] * y + H[5]) / d };
}

// ------------------------------------------------ 3) hipótesis de página
/** Centros de los cuadrados en coordenadas de página (pt, origen arriba-izquierda), orden TL,TR,BR,BL. */
export function pageMarkerPts(side) {
  const { W, H, M_OUT, M_INN, M_V } = PAGE;
  const xl = side === 'R' ? M_INN : M_OUT;          // R = página derecha: anillo a la izquierda
  const xr = side === 'R' ? W - M_OUT : W - M_INN;
  return [{ x: xl, y: M_V }, { x: xr, y: M_V }, { x: xr, y: H - M_V }, { x: xl, y: H - M_V }];
}
/** Las 4 hipótesis plausibles (2 giros × lado izq/der) con su homografía página→imagen. */
export function hypotheses(imgPts) {
  const L = [dist(imgPts[0], imgPts[1]), dist(imgPts[1], imgPts[2]), dist(imgPts[2], imgPts[3]), dist(imgPts[3], imgPts[0])];
  const topIsShort = (L[0] + L[2]) < (L[1] + L[3]);
  const rots = topIsShort ? [0, 2] : [1, 3];
  const out = [];
  for (const k of rots) for (const side of ['R', 'L']) {
    const P = pageMarkerPts(side);
    const pagePts = [0, 1, 2, 3].map(i => P[(i + k) % 4]);
    out.push({ rot: k, side, H: homography(pagePts, imgPts) });
  }
  return out;
}

// ---------------------------------------------------------- 4) aplanado
/** Aplana la página completa. H: página(pt) → imagen(px). */
export function warpPage(src, H, outW) {
  const s = outW / PAGE.W, outH = Math.round(PAGE.H * s);
  const out = new ImageData(outW, outH);
  sampleInto(src, out, (u, v) => applyH(H, u / s, v / s));
  return out;
}
function sampleInto(src, out, map) {
  const { data: sd, width: sw, height: sh } = src;
  const od = out.data, ow = out.width, oh = out.height;
  for (let v = 0; v < oh; v++) for (let u = 0; u < ow; u++) {
    const { x, y } = map(u + 0.5, v + 0.5);
    const o = (v * ow + u) * 4;
    const fx = x - 0.5, fy = y - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    if (x0 < 0 || y0 < 0 || x0 >= sw - 1 || y0 >= sh - 1) {
      od[o] = od[o + 1] = od[o + 2] = 255; od[o + 3] = 255; continue;
    }
    const ax = fx - x0, ay = fy - y0;
    const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
    for (let c = 0; c < 3; c++) {
      const top = sd[i00 + c] + (sd[i10 + c] - sd[i00 + c]) * ax;
      const bot = sd[i01 + c] + (sd[i11 + c] - sd[i01 + c]) * ax;
      od[o + c] = top + (bot - top) * ay;
    }
    od[o + 3] = 255;
  }
}

// ---------------------------------------------- 5) franja del código de página
export const STRIP = { LEN: 72, ASC: 10, DESC: 4, PRE: 4 };   // en pt
/**
 * Devuelve la franja del código ya girada para leerse de izquierda a derecha.
 * Coordenadas de la franja: u = a lo largo del texto, v = de arriba (ascendentes) a abajo.
 */
export function extractCodeStrip(src, H, side, s = 3, lenPt = STRIP.LEN) {
  const { W, H: PH, M_OUT, CODE_DX, CODE_Y0 } = PAGE;
  const xo = side === 'R' ? W - M_OUT : M_OUT;
  const xb = xo + CODE_DX;                         // línea base (en x de página)
  const w = Math.round(lenPt * s), h = Math.round((STRIP.ASC + STRIP.DESC) * s);
  const out = new ImageData(w, h);
  sampleInto(src, out, (u, v) => {
    const yUp = CODE_Y0 - STRIP.PRE + u / s;       // pt desde el borde inferior
    const px = xb - STRIP.ASC + v / s;
    return applyH(H, px, PH - yUp);
  });
  return out;
}

// ---------------------------------------------- 6) nitidez (varianza del laplaciano)
/** Mide qué tan nítida está una zona (valores altos = nítida). Muestrea cada 2 px. */
export function sharpness(g, w, h, x0 = 0, y0 = 0, x1 = w, y1 = h) {
  x0 = Math.max(1, Math.floor(x0)); y0 = Math.max(1, Math.floor(y0));
  x1 = Math.min(w - 1, Math.ceil(x1)); y1 = Math.min(h - 1, Math.ceil(y1));
  let s = 0, s2 = 0, n = 0;
  for (let y = y0; y < y1; y += 2) {
    const o = y * w;
    for (let x = x0; x < x1; x += 2) {
      const L = 4 * g[o + x] - g[o + x - 1] - g[o + x + 1] - g[o + x - w] - g[o + x + w];
      s += L; s2 += L * L; n++;
    }
  }
  return n ? s2 / n - (s / n) ** 2 : 0;
}

// ---------------------------------------------- 7) búsqueda dentro de un visor
/**
 * Busca UN cuadrado macizo dentro del rectángulo [x0,x1)×[y0,y1) (visor fijo en pantalla).
 * Solo analiza esa zona: es rápido y no se confunde con el resto de la página.
 * @returns {{x,y,s}|null} centro y lado aproximado (px de la imagen g)
 */
export function findMarkerInRegion(g, w, h, x0, y0, x1, y1) {
  x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
  x1 = Math.min(w, Math.ceil(x1)); y1 = Math.min(h, Math.ceil(y1));
  const cw = x1 - x0, ch = y1 - y0;
  if (cw < 8 || ch < 8) return null;
  const side = Math.min(cw, ch);
  // umbral: más oscuro que el 60 % del promedio local (ventana ~ 1/3 del visor) y bajo 170
  const r = Math.max(3, Math.round(side / 6));
  const I = new Float64Array((cw + 1) * (ch + 1)), W1 = cw + 1;
  for (let y = 1; y <= ch; y++) {
    let row = 0;
    const o = (y0 + y - 1) * w + x0;
    for (let x = 1; x <= cw; x++) { row += g[o + x - 1]; I[y * W1 + x] = I[(y - 1) * W1 + x] + row; }
  }
  const mask = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) {
    const ya = Math.max(0, y - r), yb = Math.min(ch, y + r + 1);
    for (let x = 0; x < cw; x++) {
      const xa = Math.max(0, x - r), xb = Math.min(cw, x + r + 1);
      const sum = I[yb * W1 + xb] - I[ya * W1 + xb] - I[yb * W1 + xa] + I[ya * W1 + xa];
      const v = g[(y0 + y) * w + x0 + x];
      if (v * (yb - ya) * (xb - xa) < sum * 0.62 && v < 170) mask[y * cw + x] = 1;
    }
  }
  const label = new Uint8Array(cw * ch), stack = new Int32Array(cw * ch);
  let best = null;
  const minS = side * 0.06, maxS = side * 0.75;
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p] || label[p]) continue;
    let sp = 0; stack[sp++] = p; label[p] = 1;
    let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, touches = false;
    while (sp) {
      const q = stack[--sp], x = q % cw, y = (q / cw) | 0;
      n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
      if (x === 0 || y === 0 || x === cw - 1 || y === ch - 1) touches = true;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= ch) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= cw) continue;
          const qq = yy * cw + xx;
          if (mask[qq] && !label[qq]) { label[qq] = 1; stack[sp++] = qq; }
        }
      }
    }
    const s = Math.sqrt(n);
    if (touches || s < minS || s > maxS || n < 6) continue;
    const mx = sx / n, my = sy / n;
    const cxx = sxx / n - mx * mx + 1 / 12, cyy = syy / n - my * my + 1 / 12, cxy = sxy / n - mx * my;
    const det = cxx * cyy - cxy * cxy; if (det <= 0) continue;
    const solidity = n / (12 * Math.sqrt(det));
    const tr = cxx + cyy, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
    const elong = (tr / 2 + disc) / Math.max(1e-6, tr / 2 - disc);
    if (solidity < 0.75 || solidity > 1.25 || elong > 2.4) continue;
    // preferir el más macizo, más grande y más cerca del centro del visor
    const dc = Math.hypot(mx - cw / 2, my - ch / 2) / side;
    const score = s * (1.2 - Math.abs(1 - solidity)) * (1.2 - dc);
    if (!best || score > best.score) best = { x: x0 + mx + 0.5, y: y0 + my + 0.5, s, score };
  }
  return best;
}
