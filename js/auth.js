// ============================================================================
//  auth.js — Vinculación única con Google (OAuth 2.0, flujo "authorization code")
//  El código se canjea en el backend por un refresh token, de modo que el
//  usuario autoriza UNA vez y la app sigue escribiendo en SU Drive sin volver a
//  pedir permiso. El navegador solo guarda una clave de sesión opaca.
// ============================================================================
import { GOOGLE_CLIENT_ID, OAUTH_SCOPES } from './config.js';
import { call, setAccount } from './api.js';

function gisReady() {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function wait() {
      if (window.google?.accounts?.oauth2) return resolve(window.google.accounts.oauth2);
      if (Date.now() - t0 > 15000) return reject(new Error('No se pudo cargar el inicio de sesión de Google. Revisa tu conexión.'));
      setTimeout(wait, 120);
    })();
  });
}

function requestCode(oauth2, hint) {
  return new Promise((resolve, reject) => {
    const client = oauth2.initCodeClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: OAUTH_SCOPES,
      ux_mode: 'popup',
      select_account: !hint,
      login_hint: hint || undefined,
      callback: r => (r.error ? reject(new Error(r.error_description || r.error)) : resolve(r.code)),
      error_callback: e => reject(new Error(e.type === 'popup_closed' ? 'Se cerró la ventana de Google.' : (e.message || e.type))),
    });
    client.requestCode();
  });
}

/**
 * Debe llamarse desde un clic (los navegadores bloquean ventanas emergentes sin gesto).
 * @returns {Promise<{status:'ok'|'retry', email?:string}>}
 */
export async function linkAccount(hint) {
  const oauth2 = await gisReady();
  const code = await requestCode(oauth2, hint);
  const r = await call('link', { code, origin: location.origin });
  if (r.status === 'ok') {
    setAccount({ session: r.session, email: r.email, folderUrl: r.folder_url, linkedAt: Date.now() });
    return { status: 'ok', email: r.email };
  }
  if (r.status === 'retry_consent') return { status: 'retry', email: r.email };
  throw new Error(r.message || 'No se pudo vincular la cuenta.');
}

export async function unlinkAccount(session) {
  try { await call('unlink', { session }); } finally { setAccount(null); }
}
