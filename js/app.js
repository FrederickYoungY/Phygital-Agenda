// ============================================================================
//  app.js — Controlador de la PWA (vistas, cámara, captura, envío)
// ============================================================================
import { routeFor } from './config.js';
import { CATALOG } from './catalog.js';
import { detectInFrame, processPhoto, fontsWarmup, frameSharpness } from './pipeline.js';
import { getAccount, sendScan, flushQueue, queue } from './api.js';
import { linkAccount, unlinkAccount } from './auth.js';

const $ = id => document.getElementById(id);
const BY_ID = new Map(CATALOG.map(p => [p.id, p]));
const state = { stream: null, track: null, loop: 0, auto: true, stable: 0, last: null, busy: false, result: null, pageId: null, torch: false };

// ------------------------------------------------------------------ vistas
function show(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === view));
  if (view === 'v-scan') startCamera(); else stopCamera();
}
function toast(msg, ms = 2600) {
  const t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}
function busy(on, text = '', sub = '') {
  $('busy').classList.toggle('hidden', !on); $('busy').classList.toggle('flex', on);
  $('busy-text').textContent = text; $('busy-sub').textContent = sub;
}

// ------------------------------------------------------------------ vincular
$('btn-link').addEventListener('click', async () => {
  const btn = $('btn-link'), st = $('link-status');
  btn.disabled = true; st.textContent = 'Abriendo Google…';
  try {
    const r = await linkAccount(btn.dataset.hint);
    if (r.status === 'retry') {
      btn.dataset.hint = r.email || '';
      $('btn-link-label').textContent = 'Confirmar permisos';
      st.textContent = 'Falta un paso: vuelve a tocar el botón para confirmar los permisos.';
    } else {
      st.textContent = '';
      toast(IN_APP ? 'Cuenta vinculada. Recuerda: ábrela en Chrome o Brave para que quede guardada.' : 'Cuenta vinculada: ' + r.email, IN_APP ? 5000 : 2600);
      show('v-scan');
    }
  } catch (e) { st.textContent = e.message; }
  finally { btn.disabled = false; }
});

// ------------------------------------------------------------------ cámara
async function startCamera() {
  if (state.stream) return loop();
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
    });
  } catch (e) {
    $('scan-hint').textContent = 'No hay acceso a la cámara. Usa el botón de galería o revisa los permisos.';
    return;
  }
  const v = $('cam'); v.srcObject = state.stream; await v.play().catch(() => {});
  state.track = state.stream.getVideoTracks()[0];
  try {
    const caps = state.track.getCapabilities?.() || {};
    if (caps.torch) $('btn-torch').classList.remove('hidden');
    if (caps.focusMode?.includes('continuous')) await state.track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
  } catch { /* opcional */ }
  loop();
}
function stopCamera() {
  cancelAnimationFrame(state.loop); state.loop = 0;
  if (state.stream) { state.stream.getTracks().forEach(t => t.stop()); state.stream = null; state.track = null; }
}

const work = document.createElement('canvas');
let lastT = 0;
const HOLD_MS = 500;           // mantener el último marco medio segundo si se pierde la página
const SMOOTH = 0.35;           // suavizado del marco (0 = quieto, 1 = sin suavizar)
const view = { smooth: null, seen: 0, sharpMax: 0 };

/** Reordena los puntos nuevos para que cada uno siga a su esquina anterior (evita "saltos" de orden). */
function matchOrder(prev, pts) {
  if (!prev) return pts;
  const used = new Set(), out = [];
  for (const p of prev) {
    let bi = -1, bd = Infinity;
    pts.forEach((q, i) => { if (used.has(i)) return; const d = Math.hypot(p.x - q.x, p.y - q.y); if (d < bd) { bd = d; bi = i; } });
    used.add(bi); out.push(pts[bi]);
  }
  return out;
}

function loop(t = 0) {
  state.loop = requestAnimationFrame(loop);
  if (state.busy || t - lastT < 110) return;           // ~9 análisis por segundo
  lastT = t;
  const v = $('cam');
  const { pts: raw, sharp } = detectInFrame(v, work);
  const now = performance.now();
  const diag = Math.hypot(v.videoWidth, v.videoHeight) || 1;

  if (raw) {
    const pts = matchOrder(state.last, raw);
    const moved = state.last ? Math.max(...pts.map((p, i) => Math.hypot(p.x - state.last[i].x, p.y - state.last[i].y))) / diag : 1;
    state.stable = moved < 0.01 ? state.stable + 1 : 0;
    state.last = pts;
    // marco suavizado: si el salto es grande (otra página / otro encuadre) se reinicia
    view.smooth = (!view.smooth || moved > 0.08) ? pts.map(p => ({ ...p }))
      : view.smooth.map((p, i) => ({ x: p.x + (pts[i].x - p.x) * SMOOTH, y: p.y + (pts[i].y - p.y) * SMOOTH }));
    view.seen = now;
    view.sharpMax = Math.max(view.sharpMax * 0.98, sharp);
  } else if (now - view.seen > HOLD_MS) {
    state.stable = 0; state.last = null; view.smooth = null;
  }
  const showing = !!view.smooth;
  drawOverlay(v, view.smooth, raw ? 1 : 0.45);
  document.querySelectorAll('.dot').forEach(d => d.classList.toggle('on', showing));
  $('btn-shutter').classList.toggle('armed', showing);
  if (!showing) { $('scan-hint').textContent = 'Encuadra la página completa: busca los 4 cuadrados negros'; return; }
  if (!raw) return;

  const nitida = sharp >= view.sharpMax * 0.7;
  if (!state.auto) { $('scan-hint').textContent = 'Página detectada. Toca el botón para capturar'; return; }
  $('scan-hint').textContent = !nitida ? 'Enfocando… mantén el teléfono quieto'
    : state.stable > 2 ? 'Quieto… capturando' : 'Página detectada. Mantén el teléfono quieto';
  if (state.stable >= 5 && nitida) capture();
}

function drawOverlay(v, pts, alpha = 1) {
  const c = $('overlay'), r = c.getBoundingClientRect(), dpr = devicePixelRatio || 1;
  if (c.width !== Math.round(r.width * dpr)) { c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); }
  const ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, r.width, r.height);
  const vw = v.videoWidth, vh = v.videoHeight; if (!vw) return;
  const k = Math.max(r.width / vw, r.height / vh), ox = (r.width - vw * k) / 2, oy = (r.height - vh * k) / 2;
  if (!pts) {   // guía B5
    const gw = Math.min(r.width * 0.84, r.height * 0.62 * 176 / 250), gh = gw * 250 / 176;
    ctx.setLineDash([6, 6]); ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1.5;
    ctx.strokeRect((r.width - gw) / 2, (r.height - gh) / 2 - 10, gw, gh); ctx.setLineDash([]);
    return;
  }
  const P = pts.map(p => ({ x: ox + p.x * k, y: oy + p.y * k }));
  ctx.globalAlpha = alpha;
  ctx.fillStyle = 'rgba(220,230,214,.16)'; ctx.strokeStyle = '#DCE6D6'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
  ctx.beginPath(); P.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.fill(); ctx.stroke();
  for (const p of P) { ctx.beginPath(); ctx.arc(p.x, p.y, 10, 0, Math.PI * 2); ctx.stroke(); }
  ctx.globalAlpha = 1;
}

// ------------------------------------------------------------------ captura
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Toma varias imágenes seguidas del video y devuelve la más nítida. */
async function grabBest(n = 4) {
  const v = $('cam');
  const cands = [];
  for (let i = 0; i < n; i++) {
    const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    cands.push({ src: c, sharp: frameSharpness(c) });
    if (i < n - 1) await sleep(70);
  }
  // si el video es de baja resolución, se suma una foto de la cámara (si el navegador lo permite)
  if (v.videoWidth * v.videoHeight < 2.5e6 && state.track && 'ImageCapture' in window) {
    try {
      const blob = await new ImageCapture(state.track).takePhoto();
      const bmp = await createImageBitmap(blob);
      cands.push({ src: bmp, sharp: frameSharpness(bmp) * 0.9 });
    } catch { /* opcional */ }
  }
  cands.sort((a, b) => b.sharp - a.sharp);
  return cands.map(c => c.src);
}

const GOOD = r => r && r.score >= 0.6;

async function capture(fileBlob) {
  if (state.busy) return;
  state.busy = true; state.stable = 0;
  busy(true, 'Enderezando la página…', 'Buscando los cuadrados y el código');
  try {
    let r = null;
    if (fileBlob) {
      r = await processPhoto(fileBlob);
    } else {
      // hasta 2 intentos: en cada uno se prueban las imágenes de la más nítida a la menos nítida
      for (let intento = 0; intento < 2 && !GOOD(r); intento++) {
        if (intento) { $('busy-sub').textContent = 'La foto salió movida, tomando otra…'; await sleep(250); }
        for (const src of (await grabBest()).slice(0, 2)) {
          const x = await processPhoto(src);
          if (x && (!r || x.score > r.score)) r = x;
          if (GOOD(r)) break;
        }
      }
    }
    if (!r) {
      toast('No encontré los 4 cuadrados. Acércate y que se vea la hoja completa.', 3500);
      return;
    }
    state.result = r;
    openReview(r);
  } catch (e) {
    console.error(e); toast('Error al procesar la foto: ' + e.message, 4000);
  } finally { busy(false); state.busy = false; view.smooth = null; state.last = null; }
}

$('btn-shutter').addEventListener('click', () => capture());
$('file-input').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) capture(f); });
$('btn-auto').addEventListener('click', () => {
  state.auto = !state.auto;
  $('btn-auto').setAttribute('aria-pressed', state.auto);
  $('btn-auto').className = 'w-12 h-12 rounded-full text-[10px] leading-tight font-medium ' + (state.auto ? 'bg-sage text-ink' : 'bg-white/15 text-paper');
});
$('btn-torch').addEventListener('click', async () => {
  state.torch = !state.torch;
  try { await state.track.applyConstraints({ advanced: [{ torch: state.torch }] }); } catch { toast('Linterna no disponible'); }
});

// ------------------------------------------------------------------ revisión
const CONFIDENT = r => r.score >= 0.8 && r.margin >= 0.015;

function setPage(id) {
  state.pageId = id;
  const p = BY_ID.get(id), rt = routeFor(id);
  $('review-id').textContent = id;
  $('review-desc').textContent = p ? `${p.desc} · pág. ${p.pag}` : 'Código fuera del catálogo';
  const dest = { sheet: 'Sheets', doc: 'Docs', photo: 'Drive' }[rt.dest];
  $('review-dest').textContent = rt.dest === 'photo' ? 'Solo se guarda la foto' : `${dest} · ${rt.label}`;
  $('review-dest').className = 'text-[11px] rounded-full px-2 py-0.5 ' + (rt.dest === 'sheet' ? 'bg-sage-soft' : rt.dest === 'doc' ? 'bg-sky-soft' : 'bg-line');
}

function openReview(r) {
  $('review-img').src = r.flatDataUrl;
  const sc = $('review-strip');
  if (r.stripCanvas) {
    sc.width = r.stripCanvas.width; sc.height = r.stripCanvas.height;
    sc.getContext('2d').drawImage(r.stripCanvas, 0, 0); sc.classList.remove('hidden');
  }
  setPage(r.id);
  const alts = [...new Set(r.ranking.map(x => x.id))].filter(x => x !== r.id).slice(0, 3);
  $('review-warn').classList.toggle('hidden', CONFIDENT(r));
  $('review-alts').innerHTML = '';
  for (const a of [r.id, ...alts]) {
    const b = document.createElement('button');
    b.className = 'font-mono text-xs rounded-full border border-ink/30 px-3 py-1 bg-white';
    b.textContent = a; b.onclick = () => { setPage(a); $('review-warn').classList.add('hidden'); };
    $('review-alts').appendChild(b);
  }
  $('review-select').classList.add('hidden');
  show('v-review');
}

function buildSelect() {
  const s = $('review-select'); if (s.options.length) return;
  const groups = new Map();
  for (const p of CATALOG) {
    const g = routeFor(p.id).label;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(p);
  }
  for (const [g, list] of groups) {
    const og = document.createElement('optgroup'); og.label = g;
    for (const p of list) { const o = document.createElement('option'); o.value = p.id; o.textContent = `${p.id} — ${p.desc} (pág. ${p.pag})`; og.appendChild(o); }
    s.appendChild(og);
  }
  s.addEventListener('change', () => { setPage(s.value); $('review-warn').classList.add('hidden'); });
}
$('btn-change').addEventListener('click', () => {
  buildSelect(); const s = $('review-select');
  s.value = state.pageId; s.classList.toggle('hidden');
});
$('btn-retake').addEventListener('click', () => show('v-scan'));

// ------------------------------------------------------------------ envío
$('btn-send').addEventListener('click', async () => {
  const r = state.result; if (!r) return;
  const payload = {
    page_id: state.pageId,
    page_desc: BY_ID.get(state.pageId)?.desc || '',
    id_check: { auto_id: r.id, score: +r.score.toFixed(3), margin: +r.margin.toFixed(3), confirmed: state.pageId !== r.id || CONFIDENT(r),
                alternatives: [...new Set(r.ranking.map(x => x.id))].slice(0, 8) },
    image: r.flatDataUrl.split(',')[1],
    original: r.originalDataUrl.split(',')[1],
    captured_at: new Date().toISOString(),
  };
  show('v-result'); resultBusy();
  const res = await sendScan(payload);
  renderResult(res);
  refreshQueueBadge();
});

function resultBusy() {
  $('res-icon').innerHTML = '<div class="spinner"></div>'; $('res-icon').className = 'w-16 h-16 grid place-items-center mb-5';
  $('res-kicker').textContent = 'Enviando'; $('res-kicker').className = 'kicker text-muted mb-2';
  $('res-title').textContent = 'Gemini está leyendo tu página…';
  $('res-text').textContent = 'Suele tardar entre 10 y 30 segundos. Puedes esperar aquí.';
  $('res-open').classList.add('hidden'); $('btn-again').classList.add('hidden');
}
function renderResult(res) {
  $('btn-again').classList.remove('hidden');
  const ok = res.status === 'ok', queued = res.status === 'queued';
  $('res-icon').className = 'w-16 h-16 rounded-full grid place-items-center mb-5 text-2xl ' + (ok ? 'bg-sage-soft' : queued ? 'bg-butter-soft' : 'bg-blush-soft');
  $('res-icon').textContent = ok ? '✓' : queued ? '⏳' : '!';
  $('res-kicker').className = 'kicker mb-2 ' + (ok ? 'text-sage-deep' : 'text-muted');
  if (ok) {
    $('res-kicker').textContent = 'Guardado en tu Drive';
    $('res-title').textContent = res.target_name || res.page_id;
    $('res-text').textContent = (res.page_id !== state.pageId ? `Gemini corrigió el código a ${res.page_id}. ` : '') + (res.resumen || '');
    if (res.target_url) { $('res-open').href = res.target_url; $('res-open').classList.remove('hidden');
      $('res-open').textContent = res.destino === 'sheet' ? 'Abrir en Hojas de cálculo' : res.destino === 'doc' ? 'Abrir el documento' : 'Ver la foto en Drive'; }
  } else if (queued && res.reason === 'busy') {
    $('res-kicker').textContent = 'Gemini está saturado';
    $('res-title').textContent = 'Tu página quedó guardada';
    $('res-text').textContent = 'La foto ya está en tu Drive. La app volverá a intentarlo sola en unos minutos (deja la app abierta o vuelve a abrirla más tarde).';
  } else if (queued) {
    $('res-kicker').textContent = 'Sin conexión';
    $('res-title').textContent = 'Quedó en cola';
    $('res-text').textContent = 'Se enviará sola cuando vuelvas a tener internet.';
  } else if (res.code === 'reauth') {
    $('res-kicker').textContent = 'Permiso vencido';
    $('res-title').textContent = 'Vuelve a vincular tu cuenta';
    $('res-text').textContent = res.message || 'Google retiró el permiso de la app.';
    $('btn-again').textContent = 'Vincular de nuevo';
    $('btn-again').onclick = () => { $('btn-again').textContent = 'Escanear otra página'; $('btn-again').onclick = null; show('v-link'); };
  } else {
    $('res-kicker').textContent = 'No se pudo guardar';
    $('res-title').textContent = 'Algo falló';
    $('res-text').textContent = res.message || 'Inténtalo nuevamente.';
  }
}
$('btn-again').addEventListener('click', () => { if (!$('btn-again').onclick) show('v-scan'); });

// ------------------------------------------------------------------ cuenta y cola
$('btn-account').addEventListener('click', () => {
  const a = getAccount(); $('acc-email').textContent = a?.email || '';
  $('acc-folder').href = a?.folderUrl || 'https://drive.google.com';
  $('account').showModal();
});
$('acc-close').addEventListener('click', () => $('account').close());
$('acc-unlink').addEventListener('click', async () => {
  const a = getAccount(); $('account').close();
  await unlinkAccount(a?.session); show('v-link');
});
async function refreshQueueBadge() {
  const n = await queue.count().catch(() => 0);
  $('btn-queue').classList.toggle('hidden', !n);
  $('btn-queue').textContent = `${n} pendiente${n === 1 ? '' : 's'}`;
}
$('btn-queue').addEventListener('click', () => flushQueue().then(refreshQueueBadge));
const flushNow = () => flushQueue(r => r.status === 'ok' && toast('Página procesada: ' + r.page_id)).then(refreshQueueBadge);
addEventListener('online', flushNow);
// reintento automático de la cola (p. ej. cuando Gemini estaba saturado)
setInterval(async () => { if (navigator.onLine && await queue.count().catch(() => 0)) flushNow(); }, 120000);

// ------------------------------------------------------------------ navegador integrado (Claude, WhatsApp, Instagram…)
const UA = navigator.userAgent;
const IN_APP = /; wv\)|FBAN|FBAV|Instagram|Line\/|WhatsApp|Claude/i.test(UA) || (/iPhone|iPad/.test(UA) && !/Safari\//.test(UA));
function storageWorks() {
  try { localStorage.setItem('phygital.t', '1'); const ok = localStorage.getItem('phygital.t') === '1'; localStorage.removeItem('phygital.t'); return ok; }
  catch { return false; }
}
if (IN_APP || !storageWorks()) $('browser-warn').classList.remove('hidden');
navigator.storage?.persist?.().catch(() => {});

// ------------------------------------------------------------------ inicio
if ('serviceWorker' in navigator) navigator.serviceWorker.register('service-worker.js').catch(() => {});
fontsWarmup();
refreshQueueBadge();
if (getAccount()?.session) { show('v-scan'); flushQueue().then(refreshQueueBadge); } else show('v-link');
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopCamera(); else if ($('v-scan').classList.contains('active')) startCamera();
});
