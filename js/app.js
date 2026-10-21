// ============================================================================
//  app.js — Controlador de la PWA (vistas, cámara, captura, envío)
// ============================================================================
import { routeFor, PAGE } from './config.js';
import { CATALOG } from './catalog.js';
import { detectInBoxes, processPhoto, fontsWarmup, frameSharpness } from './pipeline.js';
import { getAccount, sendScan, flushQueue, queue } from './api.js';
import { linkAccount, unlinkAccount } from './auth.js';

const $ = id => document.getElementById(id);
const BY_ID = new Map(CATALOG.map(p => [p.id, p]));
const state = { stream: null, track: null, loop: 0, auto: true, stable: 0, last: null, busy: false, result: null, pageId: null, torch: false };

// ------------------------------------------------------------------ vistas
function show(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === view));
  if (view === 'v-scan') { vf.key = ''; startCamera(); } else stopCamera();
}
function toast(msg, ms = 2600) {
  const t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}
function busy(on, text = '') {
  $('busy').classList.toggle('hidden', !on); $('busy').classList.toggle('flex', on);
  $('busy-text').textContent = text;
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

// ------------------------------------------------------------------ visores fijos (como ZipGrade)
//  Los 4 cuadrados de la agenda forman siempre el mismo rectángulo (en páginas izquierdas y derechas),
//  así que se dibujan 4 visores fijos con esa proporción. La persona mueve el teléfono hasta que cada
//  cuadrado cae en su visor; cada visor se pone verde por separado y con los 4 verdes se dispara solo.
const MARK_W = PAGE.W - PAGE.M_OUT - PAGE.M_INN, MARK_H = PAGE.H - 2 * PAGE.M_V;
const work = document.createElement('canvas');
const vf = { screen: null, video: null, key: '' };   // visores en px de pantalla y de video

function layoutViewfinders(v) {
  const c = $('overlay'), r = c.getBoundingClientRect();
  const vw = v.videoWidth, vh = v.videoHeight; if (!vw) return null;
  const key = [r.width, r.height, vw, vh].join('x');
  if (vf.key === key) return vf;
  const top = $('scan-top').getBoundingClientRect().bottom, bottom = $('scan-bottom').getBoundingClientRect().top;
  const availH = Math.max(200, bottom - top - 16);
  const availW = (r.width - 12) / 1.16;                // deja espacio para que los visores no se corten
  const gh = Math.min(availH / 1.1, availW * MARK_H / MARK_W), gw = gh * MARK_W / MARK_H;
  const gx = (r.width - gw) / 2, gy = top + 8 + (availH - gh) / 2;
  const B = Math.max(54, gw * 0.16);                 // lado del visor
  const centers = [[gx, gy], [gx + gw, gy], [gx + gw, gy + gh], [gx, gy + gh]];   // TL, TR, BR, BL
  vf.screen = centers.map(([x, y]) => ({ x0: x - B / 2, y0: y - B / 2, x1: x + B / 2, y1: y + B / 2, cx: x, cy: y }));
  const k = Math.max(r.width / vw, r.height / vh), ox = (r.width - vw * k) / 2, oy = (r.height - vh * k) / 2;
  const toV = (x, y) => ({ x: (x - ox) / k, y: (y - oy) / k });
  vf.video = vf.screen.map(b => { const a = toV(b.x0, b.y0), z = toV(b.x1, b.y1); return { x0: a.x, y0: a.y, x1: z.x, y1: z.y }; });
  vf.toScreen = (x, y) => ({ x: ox + x * k, y: oy + y * k });
  vf.boxVideo = B / k;
  vf.key = key;
  return vf;
}

const scan = { hits: 0, prev: null, sharpMax: 0, needRelease: false, lostAt: 0, cardOpen: false };
window.__phy = { vf, scan };   // solo para diagnóstico
let lastT = 0;

function loop(t = 0) {
  state.loop = requestAnimationFrame(loop);
  if (state.busy || scan.cardOpen || t - lastT < 100) return;      // ~10 análisis por segundo
  lastT = t;
  const v = $('cam');
  const L = layoutViewfinders(v); if (!L) return;
  const { found, sharp } = detectInBoxes(v, work, L.video);
  const n = found.filter(Boolean).length;
  drawViewfinders(found);

  const now = performance.now();
  if (n < 4) {
    scan.hits = 0; scan.prev = null;
    if (!scan.lostAt) scan.lostAt = now;
    if (scan.needRelease && now - scan.lostAt > 400) scan.needRelease = false;   // ya se retiró la hoja anterior
    $('scan-hint').textContent = n === 0 ? 'Alinea los 4 cuadrados en los visores' : `Cuadrados encontrados: ${n} de 4`;
    $('scan-sub').textContent = n ? 'Ajusta la distancia hasta que los 4 visores se pongan verdes' : '';
    $('btn-shutter').classList.remove('armed');
    return;
  }
  scan.lostAt = 0;
  const moved = scan.prev ? Math.max(...found.map((p, i) => Math.hypot(p.x - scan.prev[i].x, p.y - scan.prev[i].y))) / L.boxVideo : 1;
  scan.prev = found;
  scan.hits = moved < 0.18 ? scan.hits + 1 : 1;
  scan.sharpMax = Math.max(scan.sharpMax * 0.98, sharp);
  const nitida = sharp >= scan.sharpMax * 0.7;
  $('btn-shutter').classList.add('armed');
  if (scan.needRelease) {
    $('scan-hint').textContent = 'Pasa a la siguiente página';
    $('scan-sub').textContent = 'O toca el botón para volver a capturar esta';
    return;
  }
  if (!state.auto) { $('scan-hint').textContent = '4 de 4 · toca el botón para capturar'; $('scan-sub').textContent = ''; return; }
  $('scan-hint').textContent = nitida ? '4 de 4 · quieto…' : '4 de 4 · enfocando…';
  $('scan-sub').textContent = '';
  if (scan.hits >= 3 && nitida) capture(found);
}

function drawViewfinders(found = []) {
  const c = $('overlay'), r = c.getBoundingClientRect(), dpr = devicePixelRatio || 1;
  if (c.width !== Math.round(r.width * dpr)) { c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); vf.key = ''; }
  const ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, r.width, r.height);
  if (!vf.screen) return;
  vf.screen.forEach((b, i) => {
    const ok = !!found[i], L = (b.x1 - b.x0) * 0.28;
    ctx.lineWidth = ok ? 4 : 3; ctx.strokeStyle = ok ? '#7BD88F' : 'rgba(255,255,255,.9)';
    if (ok) { ctx.fillStyle = 'rgba(123,216,143,.18)'; ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); }
    ctx.beginPath();            // esquinas del visor
    for (const [x, y, dx, dy] of [[b.x0, b.y0, 1, 1], [b.x1, b.y0, -1, 1], [b.x1, b.y1, -1, -1], [b.x0, b.y1, 1, -1]]) {
      ctx.moveTo(x + dx * L, y); ctx.lineTo(x, y); ctx.lineTo(x, y + dy * L);
    }
    ctx.stroke();
    if (ok) {                   // cuadrado encontrado
      const p = vf.toScreen(found[i].x, found[i].y), s = Math.max(8, found[i].s * (b.x1 - b.x0) / vf.boxVideo);
      ctx.strokeStyle = '#7BD88F'; ctx.lineWidth = 2.5; ctx.strokeRect(p.x - s / 2 - 3, p.y - s / 2 - 3, s + 6, s + 6);
    }
  });
}

// ------------------------------------------------------------------ captura
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Toma varias imágenes seguidas del video y las ordena de la más nítida a la menos nítida. */
async function grabBest(n = 4) {
  const v = $('cam'), cands = [];
  for (let i = 0; i < n; i++) {
    const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    cands.push({ src: c, sharp: frameSharpness(c) });
    if (i < n - 1) await sleep(60);
  }
  cands.sort((a, b) => b.sharp - a.sharp);
  return cands.map(c => c.src);
}

const GOOD = r => r && r.score >= 0.6;
const CONFIDENT = r => r.score >= 0.8 && r.margin >= 0.015;

async function capture(hints) {
  if (state.busy) return;
  state.busy = true; scan.hits = 0;
  busy(true, 'Leyendo la página…');
  if (navigator.vibrate) navigator.vibrate(30);
  try {
    let r = null;
    if (hints instanceof Blob) {
      r = await processPhoto(hints);
    } else {
      const opts = Array.isArray(hints) ? { hints, hintBox: vf.boxVideo } : {};
      for (let intento = 0; intento < 2 && !GOOD(r); intento++) {
        if (intento) { $('busy-text').textContent = 'Salió movida, otra vez…'; await sleep(200); }
        for (const src of (await grabBest()).slice(0, 2)) {
          const x = await processPhoto(src, opts);
          if (x && (!r || x.score > r.score)) r = x;
          if (GOOD(r)) break;
        }
      }
    }
    if (!r) { toast('No pude leer la página. Vuelve a alinear los 4 cuadrados.', 3000); return; }
    openCard(r);
  } catch (e) {
    console.error(e); toast('Error al procesar la foto: ' + e.message, 4000);
  } finally { busy(false); state.busy = false; }
}

$('btn-shutter').addEventListener('click', () => capture(scan.prev && scan.prev.every(Boolean) ? scan.prev : null));
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

// ------------------------------------------------------------------ tarjeta de resultado (sobre la cámara)
function describe(id) {
  const p = BY_ID.get(id), rt = routeFor(id);
  const dest = { sheet: 'Sheets', doc: 'Docs', photo: 'Drive' }[rt.dest];
  return { p, rt, destText: rt.dest === 'photo' ? 'Solo se guarda la foto' : `${dest} · ${rt.label}` };
}
function setCardPage(id) {
  state.pageId = id;
  const { p, rt, destText } = describe(id);
  $('card-id').textContent = id;
  $('card-desc').textContent = p ? `${p.desc} · pág. ${p.pag}` : 'Código fuera del catálogo';
  $('card-dest').textContent = destText;
  $('card-dest').className = 'inline-block mt-2 text-[11px] rounded-full px-2.5 py-1 ' + (rt.dest === 'sheet' ? 'bg-sage-soft' : rt.dest === 'doc' ? 'bg-sky-soft' : 'bg-line');
}
function openCard(r) {
  state.result = r;
  $('card-img').src = r.flatDataUrl;
  setCardPage(r.id);
  $('card-warn').classList.toggle('hidden', CONFIDENT(r));
  $('card').classList.remove('hidden');
  scan.cardOpen = true;
  drawViewfinders([]);
}
function closeCard() {
  $('card').classList.add('hidden');
  scan.cardOpen = false; scan.needRelease = true; scan.prev = null; scan.hits = 0;
  state.result = null;
}
$('card-discard').addEventListener('click', closeCard);
$('card-change').addEventListener('click', () => openPages());
$('card-send').addEventListener('click', () => {
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
  closeCard();
  uploadInBackground(payload);
});

// ------------------------------------------------------------------ cambiar página (lista con buscador)
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function renderPages(q = '') {
  const words = norm(q).split(/\s+/).filter(Boolean);
  const list = CATALOG.filter(p => { const t = norm(`${p.id} ${p.desc} pag ${p.pag} ${routeFor(p.id).label}`); return words.every(w => t.includes(w)); }).slice(0, 120);
  $('pages-list').innerHTML = '';
  for (const p of list) {
    const li = document.createElement('li');
    li.className = 'py-3 flex items-center gap-3 cursor-pointer' + (p.id === state.pageId ? ' bg-sage-soft/60 -mx-4 px-4' : '');
    li.innerHTML = `<span class="font-mono text-sm w-16 shrink-0">${p.id}</span><span class="flex-1 text-sm">${p.desc}<span class="block text-[11px] text-muted">pág. ${p.pag} · ${describe(p.id).destText}</span></span>`;
    li.onclick = () => { setCardPage(p.id); $('card-warn').classList.add('hidden'); closePages(); };
    $('pages-list').appendChild(li);
  }
}
function openPages() {
  $('v-pages').classList.add('active'); $('v-scan').classList.remove('active');   // la cámara sigue encendida
  $('pages-q').value = ''; renderPages(); setTimeout(() => $('pages-q').focus(), 50);
}
function closePages() { $('v-pages').classList.remove('active'); $('v-scan').classList.add('active'); }
$('pages-q').addEventListener('input', e => renderPages(e.target.value));
$('pages-back').addEventListener('click', closePages);

// ------------------------------------------------------------------ envíos en segundo plano
const UPLOADS_KEY = 'phygital.uploads';
let uploads = [];
try { uploads = JSON.parse(localStorage.getItem(UPLOADS_KEY) || '[]'); } catch { uploads = []; }
function saveUploads() { try { localStorage.setItem(UPLOADS_KEY, JSON.stringify(uploads.slice(0, 30))); } catch { /* nada */ } }
function renderUploads() {
  const sending = uploads.filter(u => u.status === 'sending').length;
  const queued = uploads.filter(u => u.status === 'queued').length;
  const done = uploads.filter(u => u.status === 'ok').length;
  const err = uploads.filter(u => u.status === 'error').length;
  const b = $('btn-uploads');
  b.classList.toggle('hidden', !uploads.length);
  b.textContent = [sending && `↑ ${sending}`, queued && `⏳ ${queued}`, err && `! ${err}`, `✓ ${done}`].filter(Boolean).join('  ');
  const ul = $('uploads-list'); ul.innerHTML = '';
  for (const u of uploads) {
    const li = document.createElement('li'); li.className = 'py-3';
    const icon = { sending: '↑', queued: '⏳', ok: '✓', error: '!' }[u.status];
    const label = { sending: 'Enviando…', queued: 'En cola: se reintenta sola', ok: u.target_name || 'Guardada', error: u.message || 'Error' }[u.status];
    li.innerHTML = `<div class="flex gap-3 items-start"><span class="w-5 text-center">${icon}</span><div class="flex-1 min-w-0">
      <p><span class="font-mono">${u.page_id}</span> <span class="text-muted text-xs">${new Date(u.t).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</span></p>
      <p class="text-xs text-ink/70 break-words">${label}</p>
      ${u.target_url ? `<a class="text-xs underline" target="_blank" rel="noopener" href="${u.target_url}">Abrir</a>` : ''}</div></div>`;
    ul.appendChild(li);
  }
}
async function uploadInBackground(payload) {
  const u = { page_id: payload.page_id, t: Date.now(), status: 'sending' };
  uploads.unshift(u); renderUploads(); saveUploads();
  toast(`Enviando ${payload.page_id}… puedes seguir escaneando`, 2000);
  const res = await sendScan(payload);
  if (res.status === 'ok') Object.assign(u, { status: 'ok', page_id: res.page_id, target_url: res.target_url, target_name: res.target_name });
  else if (res.status === 'queued') u.status = 'queued';
  else Object.assign(u, { status: 'error', message: res.message });
  if (res.code === 'reauth') { toast('Tu permiso de Google venció: vuelve a vincular la cuenta.', 5000); show('v-link'); }
  else if (res.status === 'ok') toast(`✓ ${res.page_id} guardada${res.page_id !== payload.page_id ? ' (Gemini corrigió el código)' : ''}`);
  else if (res.status === 'error') toast(`No se pudo guardar ${payload.page_id}: ${res.message || 'error'}`, 4000);
  renderUploads(); saveUploads(); refreshQueueBadge();
}
$('btn-uploads').addEventListener('click', () => { renderUploads(); $('uploads').showModal(); });
$('uploads-close').addEventListener('click', () => $('uploads').close());

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
  // si la cola quedó vacía, lo que estaba "en cola" ya se procesó
  if (!n) { uploads.forEach(u => { if (u.status === 'queued') u.status = 'ok'; }); saveUploads(); }
  renderUploads();
}
const flushNow = () => flushQueue(r => r.status === 'ok' && toast('Página procesada: ' + r.page_id)).then(refreshQueueBadge);
addEventListener('online', flushNow);
addEventListener('resize', () => { vf.key = ''; });
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
renderUploads();
refreshQueueBadge();
if (getAccount()?.session) { show('v-scan'); flushQueue().then(refreshQueueBadge); } else show('v-link');
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopCamera(); else if ($('v-scan').classList.contains('active') || $('v-pages').classList.contains('active')) startCamera();
});
