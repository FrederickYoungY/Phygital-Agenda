// ============================================================================
//  pipeline.js — Foto → fiduciarios → ID de página → página aplanada (JPEG)
// ============================================================================
import { OUTPUT_WIDTH, OUTPUT_QUALITY, ORIGINAL_MAX } from './config.js';
import { toGray, detectMarkers, refineMarkers, warpPage, sharpness } from './scanner.js';
import { identifyPage, loadFonts, codeStripPreview } from './idreader.js';

const FULL_MAX = 3200;      // lado mayor con el que se trabaja la foto
const DETECT_MAX = 1600;    // lado mayor para buscar los cuadrados

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function drawScaled(source, sw, sh, maxSide) {
  const k = Math.min(1, maxSide / Math.max(sw, sh));
  const c = canvas(Math.round(sw * k), Math.round(sh * k));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, c.width, c.height);
  return { c, ctx, k };
}

/**
 * Busca los cuadrados en un frame de video (vista previa en vivo).
 * @returns {{pts:Array|null, sharp:number}} puntos en px del video y nitidez de la zona de la página.
 */
export function detectInFrame(video, work, maxSide = 900) {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw) return { pts: null, sharp: 0 };
  const k = Math.min(1, maxSide / Math.max(vw, vh));
  const w = Math.round(vw * k), h = Math.round(vh * k);
  if (work.width !== w) { work.width = w; work.height = h; }
  const ctx = work.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, w, h);
  const g = toGray(ctx.getImageData(0, 0, w, h));
  const r = detectMarkers(g, w, h, { maxCandidates: 22, minArea: 6 });
  if (!r) return { pts: null, sharp: sharpness(g, w, h, w * .2, h * .2, w * .8, h * .8) };
  const xs = r.pts.map(p => p.x), ys = r.pts.map(p => p.y);
  return {
    pts: r.pts.map(p => ({ x: p.x / k, y: p.y / k, s: p.s / k })),
    sharp: sharpness(g, w, h, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)),
  };
}

/** Nitidez de una imagen candidata (canvas o bitmap), medida sobre una copia reducida. */
export function frameSharpness(source, maxSide = 1000) {
  const sw = source.width, sh = source.height;
  const d = drawScaled(source, sw, sh, maxSide);
  const img = d.ctx.getImageData(0, 0, d.c.width, d.c.height);
  const w = d.c.width, h = d.c.height;
  return sharpness(toGray(img), w, h, w * .1, h * .1, w * .9, h * .9);
}

/**
 * Procesa una foto completa.
 * @param source Blob | File | ImageBitmap | HTMLCanvasElement
 */
export async function processPhoto(source, opts = {}) {
  const fontsP = loadFonts(opts.fontsBase);
  const bmp = (source instanceof Blob) ? await createImageBitmap(source, { imageOrientation: 'from-image' }) : source;
  const sw = bmp.width, sh = bmp.height;
  const full = drawScaled(bmp, sw, sh, FULL_MAX);
  const fullImg = full.ctx.getImageData(0, 0, full.c.width, full.c.height);

  // 1) cuadrados fiduciarios (búsqueda a resolución media, varias escalas si hace falta)
  let pts = null;
  for (const m of [DETECT_MAX, 1100, 2200]) {
    const d = drawScaled(full.c, full.c.width, full.c.height, m);
    const img = d.ctx.getImageData(0, 0, d.c.width, d.c.height);
    const r = detectMarkers(toGray(img), d.c.width, d.c.height, { maxCandidates: 32 });
    if (r) { pts = r.pts.map(p => ({ x: p.x / d.k, y: p.y / d.k, s: p.s / d.k })); break; }
  }
  if (!pts) return null;
  pts = refineMarkers(toGray(fullImg), fullImg.width, fullImg.height, pts);

  // 2) código de página + orientación (lado izq/der, giro)
  await fontsP;
  const id = await identifyPage(fullImg, pts);
  if (!id) return null;

  // 3) aplanado
  const flat = warpPage(fullImg, id.H, OUTPUT_WIDTH);
  const fc = canvas(flat.width, flat.height);
  fc.getContext('2d').putImageData(flat, 0, 0);
  const flatDataUrl = fc.toDataURL('image/jpeg', OUTPUT_QUALITY);

  // 4) foto original (reducida) para archivar
  const orig = drawScaled(bmp, sw, sh, ORIGINAL_MAX);
  const originalDataUrl = orig.c.toDataURL('image/jpeg', 0.85);

  return {
    ...id, markers: pts, flatDataUrl, originalDataUrl,
    stripCanvas: codeStripPreview(fullImg, id.H, id.side),
  };
}

export async function fontsWarmup(base) { return loadFonts(base); }
