/**
 * ============================================================================
 *  AGENDA PHYGITAL 2027 — Backend (Google Apps Script)            Código.gs
 * ============================================================================
 *  Webhook que recibe desde la PWA la página ya aplanada (Base64), la lee con
 *  Gemini (gemini-flash-latest) y guarda el resultado EN EL DRIVE DEL USUARIO:
 *    · tablas  → Google Sheets  ("Agenda Phygital 2027 · Datos", una pestaña por sección)
 *    · notas   → Google Docs    (un documento por página: Apuntes, Entrevistas…)
 *    · fotos   → Drive          (foto original + página aplanada)
 *
 *  Cómo se escribe en el Drive de cada usuario
 *  -------------------------------------------
 *  La PWA hace el flujo OAuth2 "authorization code" una sola vez. Este script
 *  canjea el código por un refresh token (guardado en Script Properties) y, en
 *  cada escaneo, obtiene un access token del usuario y llama a las APIs REST de
 *  Drive / Sheets con él. Así, aunque el web app se ejecute "como yo", todo
 *  queda en el Drive del usuario y con el permiso mínimo `drive.file`
 *  (la app solo ve los archivos que ella misma creó).
 *
 *  Propiedades del script (Configuración del proyecto → Propiedades del script):
 *    GEMINI_API_KEY        clave de Google AI Studio
 *    OAUTH_CLIENT_ID       ID de cliente OAuth (tipo "Aplicación web")
 *    OAUTH_CLIENT_SECRET   secreto de ese cliente
 *
 *  Implementar → Nueva implementación → Aplicación web
 *    Ejecutar como: Yo      ·      Quién tiene acceso: Cualquier usuario
 * ============================================================================
 */

const APP = {
  VERSION: '1.0.0',
  YEAR: 2027,
  TZ: 'America/Santiago',
  MODEL: 'gemini-flash-latest',
  PLANIF_START: [2027, 3, 1],          // lunes de la semana 01 (S01)
  ROOT_NAME: 'Agenda Phygital 2027',
  SHEET_NAME: 'Agenda Phygital 2027 · Datos',
  FOLDERS: {
    fotos: 'Fotos originales',
    scans: 'Páginas escaneadas',
    apuntes: 'Apuntes',
    entrevistas: 'Entrevistas',
    otras: 'Otras páginas',
  },
};

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

// ============================================================================
//  ENTRADA HTTP
// ============================================================================
function doGet() {
  return json_({ status: 'ok', app: 'Agenda Phygital 2027', version: APP.VERSION });
}

function doPost(e) {
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    switch (req.action) {
      case 'link':   return json_(actionLink_(req));
      case 'scan':   return json_(actionScan_(req));
      case 'status': return json_(actionStatus_(req));
      case 'unlink': return json_(actionUnlink_(req));
      default:       throw new AppError('bad_request', 'Acción desconocida.');
    }
  } catch (err) {
    console.error(err && err.stack || err);
    return json_({ status: 'error', code: err.code || 'internal', message: err.userMessage || String(err.message || err) });
  }
}

function AppError(code, message) { this.code = code; this.message = message; this.userMessage = message; }
AppError.prototype = Object.create(Error.prototype);

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function prop_(k) {
  const v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v) throw new AppError('config', 'Falta configurar la propiedad del script ' + k + '.');
  return v;
}

// ============================================================================
//  CUENTAS: vinculación única (refresh token) y sesiones
// ============================================================================
function actionLink_(req) {
  if (!req.code) throw new AppError('bad_request', 'Falta el código de autorización.');
  const tok = oauthToken_({
    code: req.code, client_id: prop_('OAUTH_CLIENT_ID'), client_secret: prop_('OAUTH_CLIENT_SECRET'),
    redirect_uri: 'postmessage', grant_type: 'authorization_code',
  });
  const idt = decodeJwt_(tok.id_token);
  if (idt.aud !== prop_('OAUTH_CLIENT_ID')) throw new AppError('auth', 'Token de otra aplicación.');
  if (String(tok.scope || '').indexOf('drive.file') < 0) {
    throw new AppError('scope', 'Debes aceptar el permiso de Google Drive para que la app pueda guardar tus páginas.');
  }
  let user = loadUser_(idt.sub) || { sub: idt.sub, created: new Date().toISOString(), roles: {}, cursos: {} };
  user.email = idt.email;
  if (tok.refresh_token) {
    user.rt = tok.refresh_token;
  } else if (!user.rt) {
    // Google no entrega refresh token si ya existía un permiso previo: se revoca y se pide de nuevo.
    revoke_(tok.access_token);
    return { status: 'retry_consent', email: idt.email };
  }
  CacheService.getScriptCache().put('at:' + user.sub, tok.access_token, Math.max(60, (tok.expires_in || 3600) - 300));
  const at = tok.access_token;
  ensureWorkspace_(at, user);
  const session = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  user.sessions = (user.sessions || []).concat([hash_(session)]).slice(-10);
  saveUser_(user);
  setProp_('s:' + hash_(session), user.sub);
  return { status: 'ok', session: session, email: user.email, folder_url: folderUrl_(user.roles.root) };
}

function actionStatus_(req) {
  const user = userFromSession_(req.session);
  return { status: 'ok', email: user.email, folder_url: folderUrl_(user.roles.root) };
}

function actionUnlink_(req) {
  const user = userFromSession_(req.session);
  if (user.rt) revoke_(user.rt);
  const sp = PropertiesService.getScriptProperties();
  (user.sessions || []).forEach(function (h) { sp.deleteProperty('s:' + h); });
  sp.deleteProperty('u:' + user.sub);
  CacheService.getScriptCache().remove('at:' + user.sub);
  return { status: 'ok' };
}

function userFromSession_(session) {
  if (!session) throw new AppError('reauth', 'Vincula tu cuenta de Google para continuar.');
  const sub = PropertiesService.getScriptProperties().getProperty('s:' + hash_(session));
  const user = sub && loadUser_(sub);
  if (!user || !user.rt) throw new AppError('reauth', 'Tu sesión ya no es válida. Vuelve a vincular tu cuenta.');
  return user;
}

function accessToken_(user) {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('at:' + user.sub);
  if (hit) return hit;
  let tok;
  try {
    tok = oauthToken_({ refresh_token: user.rt, client_id: prop_('OAUTH_CLIENT_ID'), client_secret: prop_('OAUTH_CLIENT_SECRET'), grant_type: 'refresh_token' });
  } catch (e) {
    if (/invalid_grant/.test(e.message)) {
      delete user.rt; saveUser_(user);
      throw new AppError('reauth', 'Google retiró el permiso de la app. Vuelve a vincular tu cuenta.');
    }
    throw e;
  }
  cache.put('at:' + user.sub, tok.access_token, Math.max(60, (tok.expires_in || 3600) - 300));
  return tok.access_token;
}

function oauthToken_(payload) {
  const r = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', { method: 'post', payload: payload, muteHttpExceptions: true });
  const j = JSON.parse(r.getContentText() || '{}');
  if (r.getResponseCode() !== 200) throw new AppError('auth', 'OAuth: ' + (j.error || r.getResponseCode()) + ' ' + (j.error_description || ''));
  return j;
}
function revoke_(token) {
  try { UrlFetchApp.fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(token), { method: 'post', muteHttpExceptions: true }); } catch (e) { /* nada */ }
}
function decodeJwt_(jwt) {
  const p = String(jwt || '').split('.')[1];
  if (!p) throw new AppError('auth', 'Respuesta de Google sin identidad (id_token).');
  return JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(p + '==='.slice((p.length + 3) % 4))).getDataAsString());
}
function hash_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s).map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}
function loadUser_(sub) {
  const v = PropertiesService.getScriptProperties().getProperty('u:' + sub);
  return v ? JSON.parse(v) : null;
}
function saveUser_(u) { setProp_('u:' + u.sub, JSON.stringify(u)); }
function setProp_(k, v) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { PropertiesService.getScriptProperties().setProperty(k, v); } finally { lock.releaseLock(); }
}

// ============================================================================
//  ESCANEO
// ============================================================================
function actionScan_(req) {
  const user = userFromSession_(req.session);
  if (!req.image) throw new AppError('bad_request', 'No llegó la imagen.');
  const at = accessToken_(user);
  let pageId = String(req.page_id || '').trim().toUpperCase();
  let route = routeFor_(pageId);
  const when = req.captured_at ? new Date(req.captured_at) : new Date();
  const stamp = Utilities.formatDate(when, APP.TZ, 'yyyy-MM-dd HH:mm');

  ensureWorkspace_(at, user);

  // 1) Gemini (las páginas sin campos solo guardan la foto)
  let data = null;
  if (route.dest !== 'photo') {
    data = gemini_(req.image, buildPrompt_(route, pageId, user));
    // Verificación del código: si la PWA no estaba segura y Gemini lee otro código del mismo tipo, se corrige.
    const leido = normCode_(data.codigo_leido);
    const chk = req.id_check || {};
    if (leido && leido !== pageId && !chk.confirmed && routeFor_(leido).key === route.key &&
        (!chk.alternatives || chk.alternatives.indexOf(leido) >= 0)) {
      pageId = leido; route = routeFor_(pageId);
    }
  }

  // 2) Fotos: original (historial) + página aplanada (siempre la última)
  const scan = upsertFile_(at, {
    name: pageId + '.jpg', parent: user.roles.scans, mimeType: 'image/jpeg',
    app: { phygital: 'scan', pageId: pageId }, description: 'Página ' + pageId + ' escaneada el ' + stamp,
  }, Utilities.base64Decode(req.image), 'image/jpeg');
  let original = null;
  if (req.original) {
    original = createFile_(at, {
      name: pageId + ' · ' + stamp.replace(':', '.') + '.jpg', parents: [user.roles.fotos], mimeType: 'image/jpeg',
      appProperties: { phygital: 'original', pageId: pageId },
    }, Utilities.base64Decode(req.original), 'image/jpeg');
  }

  const out = { status: 'ok', page_id: pageId, destino: route.dest, photo_url: scan.webViewLink, resumen: (data && data.resumen) || '' };
  if (route.dest === 'photo') {
    out.target_url = scan.webViewLink;
    out.target_name = 'Foto guardada (' + route.label + ')';
    out.resumen = 'Esta página no tiene campos para transcribir; se guardó la foto.';
    return out;
  }

  const ctx = route.ctx ? route.ctx(pageId.match(route.re), user) : {};
  ctx.pageId = pageId; ctx.stamp = stamp; ctx.scanUrl = scan.webViewLink; ctx.originalUrl = original && original.webViewLink;

  // 3) Documento (apuntes, entrevistas, otras)
  if (route.doc) {
    const d = writeDoc_(at, user, route, ctx, data);
    out.target_url = d.webViewLink; out.target_name = d.name;
  }
  // 4) Hoja de cálculo
  if (route.tab) {
    if (route.after) route.after(data, ctx, user);
    const rows = (route.rows(data || {}, ctx) || []).filter(function (r) { return r.some(function (c) { return c !== '' && c !== null && c !== undefined; }); });
    const s = writeRows_(at, user, route, ctx, rows, out.target_url);
    if (!route.doc) { out.target_url = s.url; out.target_name = route.tab + ' · ' + rows.length + ' fila' + (rows.length === 1 ? '' : 's'); }
    out.filas = rows.length;
  }
  return out;
}

function normCode_(s) {
  return String(s || '').toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9_]/g, '');
}

// ============================================================================
//  RUTAS: qué hace cada página según su código
//  (mismos códigos que "Agenda Docente 2027 - v3.1 Codigos.csv"; también se
//   aceptan los prefijos antiguos DAT_, IND_, N01_S1_L, PS_0103_R, ENT_001)
// ============================================================================
function monthsOfSem_(sem) { return sem === 1 ? [1, 2, 3, 4, 5, 6] : [7, 8, 9, 10, 11, 12]; }
function ymd_(y, m, d) { return y + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2); }
function dow_(y, m, d) { return DIAS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]; }
function addDays_(arr, n) { const t = new Date(Date.UTC(arr[0], arr[1] - 1, arr[2]) + n * 864e5); return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()]; }
function val_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'Sí' : '';
  const s = String(v).trim();
  if (/^-?\d+([.,]\d+)?$/.test(s)) return Number(s.replace(',', '.'));
  return /^[=+@]/.test(s) ? "'" + s : s;          // evita fórmulas accidentales
}
function list_(a) { return Array.isArray(a) ? a : []; }

const ROUTES = [
  { key: 'datos', re: /^(DP|DAT_\d+)$/, dest: 'sheet', label: 'Datos personales', tab: 'Datos personales', cols: ['Campo', 'Valor'],
    prompt: 'Página con etiquetas impresas (Nombre, RUT, Teléfono, Correo electrónico, Dirección personal, Establecimiento, Cargo, Jefatura, Asignaturas, Teléfono del establecimiento, Correo del establecimiento, Dirección del establecimiento, Cantidad de horas, Contacto de emergencia, Teléfono de emergencia).\n"campos": [{"campo": etiqueta impresa, "valor": lo escrito a mano}] solo para líneas con texto.',
    rows: function (d) { return list_(d.campos).map(function (c) { return [c.campo, val_(c.valor)]; }); } },

  { key: 'calgen', re: /^CG_(\d)$/, dest: 'sheet', label: 'Calendario general', tab: 'Calendario general', cols: ['Fecha', 'Día', 'Anotación'],
    ctx: function (m) { return { meses: monthsOfSem_(+m[1]) }; },
    prompt: function (c) { return 'Tabla: filas = días 1 a 31; columnas = meses ' + c.meses.map(function (m) { return MESES[m - 1]; }).join(', ') + '. Cada celda trae impresa la abreviatura del día de la semana (Lu, Ma…).\n"eventos": [{"mes": número 1-12, "dia": número, "texto": lo escrito}] solo celdas con escritura.'; },
    rows: function (d) { return list_(d.eventos).map(function (e) { return [ymd_(APP.YEAR, e.mes, e.dia), dow_(APP.YEAR, e.mes, e.dia), val_(e.texto)]; }); } },

  { key: 'minical', re: /^MC_(\d)$/, dest: 'sheet', label: 'Hitos del año', tab: 'Hitos del año', cols: ['Mes', 'Hito / fecha clave'],
    ctx: function (m) { return { meses: monthsOfSem_(+m[1]) }; },
    prompt: function (c) { return '6 bloques, uno por mes (' + c.meses.map(function (m) { return MESES[m - 1]; }).join(', ') + '), cada uno con un minicalendario y líneas "Hitos y fechas clave".\n"hitos": [{"mes": número 1-12, "texto": cada línea escrita}].'; },
    rows: function (d) { return list_(d.hitos).map(function (h) { return [MESES[(h.mes || 1) - 1], val_(h.texto)]; }); } },

  { key: 'horario', re: /^H_([LR])$/, dest: 'sheet', label: 'Horario', tab: 'Horario', cols: ['Día', 'Bloque', 'Hora', 'Curso / actividad'],
    ctx: function (m) { return { dias: m[1] === 'L' ? ['Lunes', 'Martes', 'Miércoles'] : ['Jueves', 'Viernes', 'Sábado'] }; },
    prompt: function (c) { return 'Tabla de horario: columnas Hora, Blq (1 a 14) y ' + c.dias.join(', ') + '. Al final, fila "Total horas".\n"bloques": [{"bloque": 1-14, "hora": texto de la columna Hora de esa fila, "dia": uno de ' + JSON.stringify(c.dias) + ', "texto": lo escrito}] solo celdas con escritura (no repitas filas sin texto de día), "total_horas": {"<día>": texto}.'; },
    rows: function (d) {
      const r = list_(d.bloques).map(function (b) { return [b.dia, b.bloque, val_(b.hora), val_(b.texto)]; });
      Object.keys(d.total_horas || {}).forEach(function (k) { if (d.total_horas[k]) r.push([k, 'Total', '', val_(d.total_horas[k])]); });
      return r;
    } },

  { key: 'mesinfo', re: /^M(\d\d)_([PH])$/, dest: 'sheet', label: 'Hitos mensuales', tab: 'Hitos mensuales', cols: ['Mes', 'Sección', 'Texto', 'Hecho'],
    ctx: function (m) { return { mes: +m[1], tipo: m[2] }; },
    prompt: function (c) {
      const sec = c.tipo === 'P' ? '"Prioridades del mes" (con casillas) y "Objetivos del mes" (líneas). Ignora el minicalendario impreso.'
                                 : '"Fechas importantes", "Evaluaciones", "Reuniones y consejos", "Pendientes" (todas con casillas) y "Notas" (zona punteada).';
      return 'Página del mes de ' + MESES[c.mes - 1] + ' con los paneles ' + sec + '\n"items": [{"seccion": nombre del panel, "texto": cada línea escrita, "hecho": true si la casilla está marcada}].';
    },
    rows: function (d, c) { return list_(d.items).map(function (i) { return [MESES[c.mes - 1], i.seccion, val_(i.texto), i.hecho ? '✓' : '']; }); } },

  { key: 'mesgrid', re: /^M(\d\d)_([LR])$/, dest: 'sheet', label: 'Calendario mensual', tab: 'Calendario mensual', cols: ['Fecha', 'Día', 'Anotación'],
    ctx: function (m) { return { mes: +m[1], dias: m[2] === 'L' ? 'lunes, martes y miércoles' : 'jueves, viernes y sábado' }; },
    prompt: function (c) { return 'Calendario de ' + MESES[c.mes - 1] + ' ' + APP.YEAR + ', columnas ' + c.dias + '. Cada casilla tiene impreso el número del día arriba a la derecha.\n"dias": [{"dia": número impreso de la casilla, "texto": lo escrito en ella}] solo casillas con escritura.'; },
    rows: function (d, c) { return list_(d.dias).filter(function (x) { return x.dia; }).map(function (x) { return [ymd_(APP.YEAR, c.mes, x.dia), dow_(APP.YEAR, c.mes, x.dia), val_(x.texto)]; }); } },

  { key: 'jefatura', re: /^J_P$/, dest: 'sheet', label: 'Jefatura', tab: 'Jefatura', cols: ['Campo', 'Valor'],
    prompt: 'Portada de la sección Jefatura con el panel "Mi curso" (Curso, Sala, Atención de apoderados, Correo del curso, Co-docente / asistente, Presidente/a de curso, Presidente/a de apoderados).\n"campos": [{"campo": etiqueta, "valor": lo escrito}].',
    rows: function (d) { return list_(d.campos).map(function (c) { return [c.campo, val_(c.valor)]; }); } },

  { key: 'alumnos', re: /^J_A$/, dest: 'sheet', label: 'Jefatura · Alumnos', tab: 'Jefatura · Alumnos', cols: ['Curso', 'N°', 'Estudiante', 'Contacto estudiante', 'Apoderado', 'Contacto apoderado'],
    prompt: 'Tabla de 45 filas numeradas: N°, Nombre estudiante, Contacto est., Nombre apoderado, Contacto apod. Arriba a la derecha "Curso".\n"curso": texto, "alumnos": [{"n": número, "estudiante", "contacto_est", "apoderado", "contacto_apod"}] solo filas con escritura.',
    rows: function (d) { return list_(d.alumnos).map(function (a) { return [val_(d.curso), a.n, val_(a.estudiante), val_(a.contacto_est), val_(a.apoderado), val_(a.contacto_apod)]; }); } },

  { key: 'cumple', re: /^J_C$/, dest: 'sheet', label: 'Cumpleaños', tab: 'Cumpleaños', cols: ['Mes', 'Día', 'Nombre', 'Detalle'],
    prompt: '12 paneles, uno por mes (Enero a Diciembre), con líneas para cumpleaños del curso.\n"cumpleanos": [{"mes": número 1-12, "dia": número o null, "nombre": texto, "detalle": resto de la línea}].',
    rows: function (d) { return list_(d.cumpleanos).map(function (c) { return [MESES[(c.mes || 1) - 1], val_(c.dia), val_(c.nombre), val_(c.detalle)]; }); } },

  { key: 'cursos', re: /^C_P$/, dest: 'sheet', label: 'Mis cursos', tab: 'Mis cursos', cols: ['Curso N°', 'Nombre del curso'],
    prompt: 'Portada de Cursos con el panel "Mis cursos": líneas "Curso 01" a "Curso 15" con el nombre escrito a mano.\n"cursos": [{"n": número, "nombre": lo escrito}].',
    after: function (d, c, user) { list_(d.cursos).forEach(function (x) { if (x.n && x.nombre) user.cursos[x.n] = String(x.nombre); }); saveUser_(user); },
    rows: function (d) { return list_(d.cursos).map(function (x) { return ['Curso ' + ('0' + x.n).slice(-2), val_(x.nombre)]; }); } },

  { key: 'notas', re: /^(?:C(\d\d)_S([12])|N(\d\d)_S(\d)(?:_[LR])?)$/, dest: 'sheet', label: 'Notas', tab: 'Notas',
    cols: ['Curso', 'Nombre del curso', 'Semestre', 'N°', 'Estudiante', 'N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8', 'N9', 'N10', 'Promedio'],
    ctx: function (m, user) { const k = +(m[1] || m[3]); return { curso: k, sem: +(m[2] || m[4]), nombre: (user.cursos || {})[k] || '' }; },
    prompt: function (c) { return 'Registro de notas del "Curso ' + ('0' + c.curso).slice(-2) + '", ' + c.sem + '° semestre. Tabla de 45 filas: N°, Nombre estudiante, N1 a N10 y Prom. Junto al título puede estar escrito el nombre del curso. Las notas chilenas van de 1,0 a 7,0.\n"nombre_curso": texto o null, "alumnos": [{"n": número, "estudiante": texto, "notas": arreglo de 10 valores (string o null) en orden N1..N10, "promedio": string o null}] solo filas con escritura.'; },
    after: function (d, c, user) { if (d.nombre_curso && !c.nombre) { c.nombre = d.nombre_curso; user.cursos[c.curso] = d.nombre_curso; saveUser_(user); } },
    rows: function (d, c) {
      return list_(d.alumnos).map(function (a) {
        const n = list_(a.notas).slice(0, 10); while (n.length < 10) n.push(null);
        return ['Curso ' + ('0' + c.curso).slice(-2), c.nombre || d.nombre_curso || '', c.sem + '°', a.n, val_(a.estudiante)].concat(n.map(val_)).concat([val_(a.promedio)]);
      });
    } },

  { key: 'temp', re: /^C(\d\d)_T([12])$/, dest: 'sheet', label: 'Temporalización', tab: 'Temporalización', cols: ['Curso', 'Nombre del curso', 'Semestre', 'Mes', 'Semana', 'Unidad', 'Contenidos'],
    ctx: function (m, user) { const k = +m[1], s = +m[2]; return { curso: k, sem: s, meses: s === 1 ? [2, 3, 4, 5, 6] : [7, 8, 9, 10, 11, 12], nombre: (user.cursos || {})[k] || '' }; },
    prompt: function (c) { return 'Temporalización del "Curso ' + ('0' + c.curso).slice(-2) + '": columnas = meses ' + c.meses.map(function (m) { return MESES[m - 1]; }).join(', ') + '; filas = semanas 1 a 5. Cada celda tiene "Unidad" y "Contenidos".\n"celdas": [{"mes": número 1-12, "semana": 1-5, "unidad": texto, "contenidos": texto}] solo celdas con escritura.'; },
    rows: function (d, c) { return list_(d.celdas).map(function (x) { return ['Curso ' + ('0' + c.curso).slice(-2), c.nombre, c.sem + '°', MESES[(x.mes || 1) - 1], x.semana, val_(x.unidad), val_(x.contenidos)]; }); } },

  { key: 'planif', re: /^(?:S(\d\d)_([LR])|PS_(\d\d)(\d\d)_([LR]))$/, dest: 'sheet', label: 'Planificación semanal', tab: 'Planificación semanal',
    cols: ['Semana', 'Fecha', 'Día', 'Bloque', 'Hora', 'Objetivo', 'Actividad'],
    ctx: function (m) {
      let lun, sem;
      if (m[1]) { sem = +m[1]; lun = addDays_(APP.PLANIF_START, 7 * (sem - 1)); }
      else { lun = [APP.YEAR, +m[4], +m[3]]; sem = Math.round((Date.UTC(lun[0], lun[1] - 1, lun[2]) - Date.UTC(APP.PLANIF_START[0], APP.PLANIF_START[1] - 1, APP.PLANIF_START[2])) / 6048e5) + 1; }
      const off = (m[2] || m[5]) === 'L' ? [0, 1, 2] : [3, 4, 5];
      const fechas = {};
      off.forEach(function (o) { const f = addDays_(lun, o); fechas[DIAS[(o + 1) % 7]] = ymd_(f[0], f[1], f[2]); });
      return { sem: sem, fechas: fechas };
    },
    prompt: function (c) { return 'Planificación semanal, Semana ' + c.sem + '. Columnas: Hora, Blq (1 a 14) y los días ' + Object.keys(c.fechas).map(function (k) { return k + ' ' + c.fechas[k]; }).join(', ') + '. Cada celda tiene "Obj." (objetivo, arriba) y "Actividad" (abajo).\n"bloques": [{"bloque": 1-14, "hora": texto de la columna Hora, "dia": uno de ' + JSON.stringify(Object.keys(c.fechas)) + ', "objetivo": texto, "actividad": texto}] solo celdas con escritura. Si una anotación ocupa varios bloques, ponla en el primero.'; },
    rows: function (d, c) { return list_(d.bloques).map(function (b) { return [c.sem, c.fechas[b.dia] || '', b.dia, b.bloque, val_(b.hora), val_(b.objetivo), val_(b.actividad)]; }); } },

  { key: 'regentrev', re: /^E_P$/, dest: 'sheet', label: 'Registro de entrevistas', tab: 'Registro de entrevistas', cols: ['N°', 'Fecha', 'Estudiante'],
    prompt: 'Portada de Entrevistas con el "Registro de entrevistas": dos columnas de líneas numeradas 01 a 60 (N°, línea escrita, número de página impreso).\n"registro": [{"n": número, "fecha": AAAA-MM-DD o texto, "estudiante": texto}] solo líneas con escritura.',
    rows: function (d) { return list_(d.registro).map(function (r) { return [r.n, val_(r.fecha), val_(r.estudiante)]; }); } },

  { key: 'entrev', re: /^(?:E(\d\d)|ENT_(\d+))$/, dest: 'doc', label: 'Entrevistas', doc: 'entrevistas', tab: 'Entrevistas',
    cols: ['N°', 'Fecha', 'Hora', 'Curso', 'Asignatura', 'Estudiante', 'RUT', 'Apoderado', 'Parentesco', 'Contacto', 'Correo', 'Citado por', 'Motivo', 'Acuerdos', 'Documento'],
    ctx: function (m) { return { n: +(m[1] || m[2]) }; },
    prompt: function (c) { return 'Ficha "Entrevista con apoderado" N° ' + c.n + '. Paneles: "Datos de la entrevista" (Fecha, Hora, Curso, Asignatura, Estudiante, RUT, Apoderado, Parentesco, Contacto, Correo), casillas "Citado por" (Docente, Apoderado, Convivencia, Dirección, Otro), "Motivo de la entrevista" (líneas), "Acuerdos y compromisos" (casillas), "Firma apoderado" y "Firma docente".\n"datos": {"fecha","hora","curso","asignatura","estudiante","rut","apoderado","parentesco","contacto","correo"}, "citado_por": [opciones marcadas], "motivo": texto, "acuerdos": [{"texto","hecho": bool}], "firmas": {"apoderado": bool, "docente": bool}, "html": la ficha completa transcrita y ordenada (ver formato HTML).'; },
    docName: function (d, c) { const x = d.datos || {}; return 'E' + ('0' + c.n).slice(-2) + ' · Entrevista' + (x.estudiante ? ' — ' + x.estudiante : '') + (x.fecha ? ' (' + x.fecha + ')' : ''); },
    rows: function (d, c) {
      const x = d.datos || {};
      return [[c.n, val_(x.fecha), val_(x.hora), val_(x.curso), val_(x.asignatura), val_(x.estudiante), val_(x.rut), val_(x.apoderado), val_(x.parentesco), val_(x.contacto), val_(x.correo),
               list_(d.citado_por).join(', '), val_(d.motivo), list_(d.acuerdos).map(function (a) { return (a.hecho ? '☑ ' : '☐ ') + a.texto; }).join('\n'), c.docUrl || '']];
    } },

  { key: 'apuntes', re: /^(?:A(\d\d)|A_P)$/, dest: 'doc', label: 'Apuntes', doc: 'apuntes',
    ctx: function (m) { return { n: m[1] ? +m[1] : 0 }; },
    prompt: function (c) { return (c.n ? 'Hoja de apuntes N° ' + c.n + '. Arriba hay casillas "Apuntes" / "Reunión" y una línea "Fecha"; el resto son líneas libres.' : 'Portada de Apuntes con el panel "Ideas sueltas" (zona punteada libre).') + '\n"titulo": título breve inferido del contenido (máx. 8 palabras), "tipo": "Apuntes" o "Reunión" según la casilla marcada (o null), "fecha": AAAA-MM-DD o null, "html": la transcripción completa (ver formato HTML).'; },
    docName: function (d, c) { return (c.n ? 'A' + ('0' + c.n).slice(-2) : 'A_P') + ' · ' + (d.tipo || 'Apuntes') + (d.titulo ? ' — ' + d.titulo : '') + (d.fecha ? ' (' + d.fecha + ')' : ''); } },

  { key: 'foto', re: /^(PT|DR|IX|IND_\d+|S_P|B\d{3})$/, dest: 'photo', label: 'Solo foto' },
];
const ROUTE_OTRAS = { key: 'otras', re: /.*/, dest: 'doc', label: 'Otras páginas', doc: 'otras',
  prompt: 'Página de la agenda sin formato conocido.\n"titulo": título breve, "html": transcripción completa de lo escrito a mano (ver formato HTML).',
  docName: function (d, c) { return c.pageId + ' · ' + (d.titulo || 'Página escaneada'); } };

function routeFor_(id) {
  for (let i = 0; i < ROUTES.length; i++) if (ROUTES[i].re.test(id)) return ROUTES[i];
  return ROUTE_OTRAS;
}

// ============================================================================
//  GEMINI
// ============================================================================
function buildPrompt_(route, pageId, user) {
  const ctx = route.ctx ? route.ctx(pageId.match(route.re), user) : {};
  const specific = typeof route.prompt === 'function' ? route.prompt(ctx) : route.prompt;
  return [
    'Eres un transcriptor experto de agendas docentes chilenas escritas a mano.',
    'La imagen es una página de la "Agenda Docente ' + APP.YEAR + '", ya recortada y enderezada. Código de la página: ' + pageId + '.',
    'Reglas:',
    '- Transcribe SOLO lo escrito a mano. Ignora títulos, etiquetas, números de página, pestañas y adornos impresos, salvo que se pidan.',
    '- No inventes nada. Si algo es ilegible escribe [ilegible]. Omite los campos vacíos (o usa null).',
    '- Respeta la ortografía de la persona salvo errores evidentes de lectura. Fechas en formato AAAA-MM-DD (año ' + APP.YEAR + ' si no se indica).',
    '- Lee también el código pequeño impreso girado 90° en la esquina inferior exterior (p. ej. "M02_L", "S05_R", "E12") y entrégalo en "codigo_leido".',
    '- Formato HTML (solo cuando se pida "html"): usa únicamente <h2>, <h3>, <p>, <ul>, <ol>, <li>, <b>, <i>, <u>, <table>, <tr>, <th>, <td>, <br>. Casillas como ☐ / ☑. Conserva el orden y la estructura de la página.',
    '',
    'Estructura de la página y datos que debes devolver:',
    specific,
    '',
    'Responde ÚNICAMENTE con un objeto JSON válido que incluya además: "codigo_leido": string, "vacia": boolean (true si no hay nada escrito a mano), "resumen": string (máx. 20 palabras, en español, sobre lo escrito).',
  ].join('\n');
}

function gemini_(imageB64, prompt) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + APP.MODEL + ':generateContent';
  const body = {
    contents: [{ role: 'user', parts: [{ inline_data: { mime_type: 'image/jpeg', data: imageB64 } }, { text: prompt }] }],
    generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
  };
  const opts = { method: 'post', contentType: 'application/json', payload: JSON.stringify(body), muteHttpExceptions: true,
                 headers: { 'x-goog-api-key': prop_('GEMINI_API_KEY') } };
  let last = '';
  for (let i = 0; i < 4; i++) {
    const r = UrlFetchApp.fetch(url, opts);
    const code = r.getResponseCode();
    const j = JSON.parse(r.getContentText() || '{}');
    if (code === 200 && j.candidates && j.candidates[0] && j.candidates[0].content) {
      const text = (j.candidates[0].content.parts || []).filter(function (p) { return p.text && !p.thought; }).map(function (p) { return p.text; }).join('');
      return parseJson_(text);
    }
    last = (j.error && j.error.message) || ('HTTP ' + code);
    if ([429, 500, 502, 503, 504].indexOf(code) < 0 && !/overloaded|high demand/i.test(last)) break;
    Utilities.sleep(1500 * Math.pow(2, i));
  }
  throw new AppError(/quota|429/i.test(last) ? 'busy' : 'gemini', 'Gemini no pudo leer la página: ' + last);
}

function parseJson_(t) {
  const s = String(t || '').replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(s); } catch (e) {
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a >= 0 && b > a) return JSON.parse(s.slice(a, b + 1));
    throw new AppError('gemini', 'Gemini devolvió una respuesta que no es JSON.');
  }
}

// ============================================================================
//  DRIVE (REST v3, con el token del usuario)
// ============================================================================
function api_(at, method, url, body, extra) {
  const o = { method: method, muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + at } };
  if (body !== undefined && body !== null) { o.contentType = 'application/json'; o.payload = JSON.stringify(body); }
  if (extra) Object.keys(extra).forEach(function (k) { o[k] = extra[k]; });
  const r = UrlFetchApp.fetch(url, o);
  const code = r.getResponseCode(), txt = r.getContentText();
  if (code === 401) throw new AppError('reauth', 'El permiso de Google venció. Vuelve a vincular tu cuenta.');
  if (code >= 300) {
    const e = new AppError(code === 404 ? 'not_found' : 'google', 'Google API ' + code + ': ' + txt.slice(0, 300));
    e.http = code; throw e;
  }
  return txt ? JSON.parse(txt) : {};
}
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FIELDS = 'id,name,webViewLink,trashed';

function findByApp_(at, props, parent) {
  const q = Object.keys(props).map(function (k) { return "appProperties has { key='" + k + "' and value='" + String(props[k]).replace(/'/g, "\\'") + "' }"; })
    .concat(['trashed = false']).concat(parent ? ["'" + parent + "' in parents"] : []).join(' and ');
  const r = api_(at, 'get', DRIVE + '?pageSize=5&fields=files(' + FIELDS + ')&q=' + encodeURIComponent(q));
  return (r.files || [])[0] || null;
}
function exists_(at, id) {
  if (!id) return false;
  try { const f = api_(at, 'get', DRIVE + '/' + id + '?fields=id,trashed'); return !f.trashed; } catch (e) { if (e.http === 404) return false; throw e; }
}
function folderUrl_(id) { return id ? 'https://drive.google.com/drive/folders/' + id : 'https://drive.google.com'; }

/** Carpeta raíz, subcarpetas y hoja de datos (se recrean si el usuario las borró). */
function ensureWorkspace_(at, user) {
  user.roles = user.roles || {};
  const cache = CacheService.getScriptCache(), ck = 'ws:' + user.sub;
  if (cache.get(ck) === JSON.stringify(user.roles)) return;      // verificado hace poco
  const before = JSON.stringify(user.roles);
  const ensure = function (role, name, mime, parent) {
    if (exists_(at, user.roles[role])) return;
    const found = findByApp_(at, { phygital: role });
    if (found) { user.roles[role] = found.id; return; }
    const meta = { name: name, mimeType: mime, appProperties: { phygital: role } };
    if (parent) meta.parents = [parent];
    user.roles[role] = api_(at, 'post', DRIVE + '?fields=' + FIELDS, meta).id;
    if (role === 'datos') initSpreadsheet_(at, user.roles[role]);
  };
  ensure('root', APP.ROOT_NAME, 'application/vnd.google-apps.folder', null);
  Object.keys(APP.FOLDERS).forEach(function (k) { ensure(k, APP.FOLDERS[k], 'application/vnd.google-apps.folder', user.roles.root); });
  ensure('datos', APP.SHEET_NAME, 'application/vnd.google-apps.spreadsheet', user.roles.root);
  if (JSON.stringify(user.roles) !== before) saveUser_(user);
  cache.put(ck, JSON.stringify(user.roles), 900);
}

function multipart_(meta, bytes, mime) {
  const b = 'phygital' + Utilities.getUuid().replace(/-/g, '');
  const head = Utilities.newBlob('--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) +
                                 '\r\n--' + b + '\r\nContent-Type: ' + mime + '\r\n\r\n').getBytes();
  const tail = Utilities.newBlob('\r\n--' + b + '--').getBytes();
  return { contentType: 'multipart/related; boundary=' + b, payload: head.concat(bytes).concat(tail) };
}
function createFile_(at, meta, bytes, mime) {
  const m = multipart_(meta, bytes, mime);
  return api_(at, 'post', UPLOAD + '?uploadType=multipart&fields=' + FIELDS, null, { contentType: m.contentType, payload: m.payload });
}
function updateFile_(at, id, meta, bytes, mime) {
  const m = multipart_(meta, bytes, mime);
  return api_(at, 'patch', UPLOAD + '/' + id + '?uploadType=multipart&fields=' + FIELDS, null, { contentType: m.contentType, payload: m.payload });
}
/** Crea o reemplaza (Drive guarda el historial de versiones) el archivo identificado por o.app dentro de o.parent. */
function upsertFile_(at, o, bytes, mime) {
  const f = findByApp_(at, o.app, o.parent);
  const meta = { name: o.name, description: o.description || '', appProperties: o.app };
  if (o.mimeType) meta.mimeType = o.mimeType;
  if (f) return updateFile_(at, f.id, meta, bytes, mime);
  meta.parents = [o.parent];
  return createFile_(at, meta, bytes, mime);
}

// ============================================================================
//  GOOGLE DOCS (HTML → Documento de Google, un documento por página)
// ============================================================================
function writeDoc_(at, user, route, ctx, d) {
  const name = (route.docName ? route.docName(d || {}, ctx) : ctx.pageId).slice(0, 180);
  const links = '<a href="' + ctx.scanUrl + '">página escaneada</a>' + (ctx.originalUrl ? ' · <a href="' + ctx.originalUrl + '">foto original</a>' : '');
  let extra = '';
  if (route.key === 'entrev' && d && d.datos) {
    const x = d.datos, rows = [['Fecha', x.fecha], ['Hora', x.hora], ['Curso', x.curso], ['Asignatura', x.asignatura], ['Estudiante', x.estudiante], ['RUT', x.rut],
      ['Apoderado', x.apoderado], ['Parentesco', x.parentesco], ['Contacto', x.contacto], ['Correo', x.correo], ['Citado por', list_(d.citado_por).join(', ')]]
      .filter(function (r) { return r[1]; });
    if (rows.length) extra = '<table border="1" cellpadding="4" style="border-collapse:collapse">' + rows.map(function (r) { return '<tr><td><b>' + esc_(r[0]) + '</b></td><td>' + esc_(r[1]) + '</td></tr>'; }).join('') + '</table>';
  }
  const html = '<html><head><meta charset="utf-8"></head><body style="font-family:Arial">' +
    '<h1>' + esc_(name) + '</h1>' +
    '<p style="color:#8F8784;font-size:9pt">Agenda Docente ' + APP.YEAR + ' · código ' + ctx.pageId + ' · escaneada el ' + ctx.stamp + ' · ' + links + '</p>' +
    (d && d.resumen ? '<p><i>' + esc_(d.resumen) + '</i></p>' : '') + extra +
    sanitize_((d && d.html) || (d && d.vacia ? '<p>(Página sin escritura)</p>' : '')) + '</body></html>';
  const doc = upsertFile_(at, { name: name, parent: user.roles[route.doc], mimeType: 'application/vnd.google-apps.document',
                                app: { phygital: 'doc', pageId: ctx.pageId } }, Utilities.newBlob(html).getBytes(), 'text/html');
  ctx.docUrl = doc.webViewLink;
  return doc;
}
function esc_(s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function sanitize_(h) {
  return String(h)
    .replace(/<\s*(script|style|iframe|object|embed|link|meta)[\s\S]*?(<\/\s*\1\s*>|\/?>)/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '');
}

// ============================================================================
//  GOOGLE SHEETS (una pestaña por sección; re-escanear reemplaza las filas de esa página)
// ============================================================================
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets/';

function initSpreadsheet_(at, id) {
  try {
    const ss = api_(at, 'get', SHEETS + id + '?fields=sheets.properties');
    const first = ss.sheets[0].properties.sheetId;
    api_(at, 'post', SHEETS + id + ':batchUpdate', { requests: [
      { updateSpreadsheetProperties: { properties: { locale: 'es_CL', timeZone: APP.TZ }, fields: 'locale,timeZone' } },
      { updateSheetProperties: { properties: { sheetId: first, title: 'Inicio' }, fields: 'title' } },
    ] });
    api_(at, 'put', SHEETS + id + '/values/' + encodeURIComponent("'Inicio'!A1") + '?valueInputOption=RAW', { values: [
      ['Agenda Phygital ' + APP.YEAR], ['Cada pestaña se llena sola al escanear las páginas de la agenda.'],
      ['Si vuelves a escanear una página, sus filas se reemplazan (columna "ID página").'],
    ] });
  } catch (e) { console.warn('initSpreadsheet_', e); }
}

function sheetTabs_(at, id) {
  const ss = api_(at, 'get', SHEETS + id + '?fields=sheets.properties(sheetId,title)');
  const m = {}; (ss.sheets || []).forEach(function (s) { m[s.properties.title] = s.properties.sheetId; });
  return m;
}

function writeRows_(at, user, route, ctx, rows, docUrl) {
  const id = user.roles.datos;
  const tab = route.tab;
  const header = ['ID página', 'Escaneado'].concat(route.cols).concat(['Foto']);
  const tabs = sheetTabs_(at, id);
  let sheetId = tabs[tab];
  const A1 = function (r) { return encodeURIComponent("'" + tab + "'!" + r); };

  if (sheetId === undefined) {
    const res = api_(at, 'post', SHEETS + id + ':batchUpdate', { requests: [{ addSheet: { properties: { title: tab, gridProperties: { frozenRowCount: 1 } } } }] });
    sheetId = res.replies[0].addSheet.properties.sheetId;
    api_(at, 'put', SHEETS + id + '/values/' + A1('A1') + '?valueInputOption=RAW', { values: [header] });
    api_(at, 'post', SHEETS + id + ':batchUpdate', { requests: [
      { repeatCell: { range: { sheetId: sheetId, startRowIndex: 0, endRowIndex: 1 },
        cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.953, green: 0.855, blue: 0.843 } } },
        fields: 'userEnteredFormat(textFormat,backgroundColor)' } },
      { setBasicFilter: { filter: { range: { sheetId: sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: header.length } } } },
    ] });
  }

  // borrar las filas anteriores de esta página (re-escaneo)
  const colA = api_(at, 'get', SHEETS + id + '/values/' + A1('A:A')).values || [];
  const del = [];
  for (let i = colA.length - 1; i >= 1; i--) if (colA[i][0] === ctx.pageId) del.push(i);
  if (del.length) {
    const reqs = [];
    let i = 0;
    while (i < del.length) {           // agrupa filas consecutivas (orden descendente)
      let end = del[i] + 1, start = del[i];
      while (i + 1 < del.length && del[i + 1] === start - 1) { start = del[++i]; }
      reqs.push({ deleteDimension: { range: { sheetId: sheetId, dimension: 'ROWS', startIndex: start, endIndex: end } } });
      i++;
    }
    api_(at, 'post', SHEETS + id + ':batchUpdate', { requests: reqs });
  }

  const foto = ctx.scanUrl;                       // Sheets lo muestra como enlace
  const values = (rows.length ? rows : [route.cols.map(function () { return ''; })]).map(function (r) {
    return [ctx.pageId, ctx.stamp].concat(r).concat([foto]);
  });
  if (!rows.length) values[0][2] = '(sin escritura)';
  api_(at, 'post', SHEETS + id + '/values/' + A1('A1') + ':append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS', { values: values });
  return { url: 'https://docs.google.com/spreadsheets/d/' + id + '/edit#gid=' + sheetId };
}

// ============================================================================
//  UTILIDADES PARA EL DUEÑO DEL SCRIPT
// ============================================================================
/** Ejecútala una vez desde el editor para comprobar la configuración. */
function verificarConfiguracion() {
  ['GEMINI_API_KEY', 'OAUTH_CLIENT_ID', 'OAUTH_CLIENT_SECRET'].forEach(function (k) {
    const v = PropertiesService.getScriptProperties().getProperty(k);
    console.log(k + ': ' + (v ? 'OK (' + v.slice(0, 6) + '…)' : 'FALTA'));
  });
  const r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + APP.MODEL + '?key=' + prop_('GEMINI_API_KEY'), { muteHttpExceptions: true });
  console.log('Gemini (' + APP.MODEL + '): HTTP ' + r.getResponseCode());
}

/** Cantidad de usuarios vinculados. */
function contarUsuarios() {
  const keys = PropertiesService.getScriptProperties().getKeys();
  console.log('Usuarios vinculados: ' + keys.filter(function (k) { return k.indexOf('u:') === 0; }).length);
}
