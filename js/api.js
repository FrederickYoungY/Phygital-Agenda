// ============================================================================
//  api.js — Comunicación con el webhook de Apps Script + cola sin conexión
// ============================================================================
import { WEBHOOK_URL } from './config.js';

const LS_KEY = 'phygital.account';

export function getAccount() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { return null; }
}
export function setAccount(a) {
  try { a ? localStorage.setItem(LS_KEY, JSON.stringify(a)) : localStorage.removeItem(LS_KEY); } catch { /* modo privado */ }
}

/** POST como text/plain (petición "simple": sin preflight CORS, compatible con Apps Script). */
export async function call(action, body = {}, { timeoutMs = 300000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST', body: JSON.stringify({ action, ...body }), redirect: 'follow', signal: ctrl.signal,
    });
    const txt = await res.text();
    try { return JSON.parse(txt); } catch { return { status: 'error', code: 'bad_response', message: 'Respuesta inesperada del servidor.' }; }
  } finally { clearTimeout(t); }
}

// ------------------------------------------------------------- cola (IndexedDB)
function db() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('phygital', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('queue', { keyPath: 'qid', autoIncrement: true });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction('queue', mode);
    const out = fn(t.objectStore('queue'));
    t.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
    t.onerror = () => reject(t.error);
  });
}
export const queue = {
  add: item => tx('readwrite', s => s.add({ ...item, queuedAt: Date.now() })),
  all: () => tx('readonly', s => s.getAll()),
  remove: qid => tx('readwrite', s => s.delete(qid)),
  count: () => tx('readonly', s => s.count()),
};

/** Envía un escaneo. Si no hay red, lo deja en cola. */
export async function sendScan(payload) {
  const acc = getAccount();
  if (!navigator.onLine) { await queue.add(payload); return { status: 'queued' }; }
  try {
    return await call('scan', { session: acc?.session, ...payload });
  } catch (e) {
    await queue.add(payload);
    return { status: 'queued' };
  }
}

let flushing = false;
export async function flushQueue(onProgress) {
  if (flushing || !navigator.onLine) return;
  flushing = true;
  try {
    const items = await queue.all();
    for (const it of items) {
      const { qid, queuedAt, ...payload } = it;
      let r;
      try { r = await call('scan', { session: getAccount()?.session, ...payload }); } catch { break; }
      if (r.status === 'ok' || (r.status === 'error' && r.code !== 'reauth' && r.code !== 'busy')) await queue.remove(qid);
      if (r.code === 'reauth') break;
      onProgress && onProgress(r, payload);
    }
  } finally { flushing = false; }
}
