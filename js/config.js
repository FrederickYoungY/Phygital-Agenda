// ============================================================================
//  CONFIGURACIÓN — Agenda Phygital 2027 (PWA)
//  Rellena los dos primeros valores después de seguir el README.
// ============================================================================

// 1) ID de cliente OAuth 2.0 (tipo "Aplicación web") de tu proyecto de Google Cloud.
export const GOOGLE_CLIENT_ID = 'PEGA_AQUI_TU_CLIENT_ID.apps.googleusercontent.com';

// 2) URL de la implementación de Apps Script (termina en /exec).
export const WEBHOOK_URL = 'https://script.google.com/macros/s/PEGA_AQUI_EL_ID_DE_IMPLEMENTACION/exec';

// Permisos que se piden al usuario: solo los archivos que crea la app (no ve el resto de su Drive).
export const OAUTH_SCOPES = 'openid email https://www.googleapis.com/auth/drive.file';

// ----------------------------------------------------------------------------
//  Geometría de la página (en puntos PDF, 1 pt = 0,3528 mm), tomada de
//  generar_agenda_v31.py. Si cambias tamaño o posición de los cuadrados en la
//  agenda, cambia SOLO estos números.
// ----------------------------------------------------------------------------
export const PAGE = {
  W: 498.898,          // ancho B5 (176 mm)
  H: 708.661,          // alto  B5 (250 mm)
  MARKER: 6.5,         // lado del cuadrado negro (6,5 pt ≈ 2,3 mm). Si lo agrandas a 5 mm → 14.17
  M_OUT: 22,           // centro del cuadrado al borde EXTERIOR (lado del código)
  M_INN: 46,           // centro del cuadrado al borde del ANILLO
  M_V: 22,             // centro del cuadrado al borde superior / inferior
  // Código de página: rotado 90°, sobre el cuadrado inferior exterior, se lee de abajo hacia arriba
  CODE_SIZE: 7,        // tamaño de letra
  CODE_CS: 0.8,        // espaciado entre letras (charSpace de reportlab)
  CODE_DX: 7 * 0.36,   // desplazamiento de la línea base respecto al centro del cuadrado
  CODE_Y0: 22 + 6.5 / 2 + 7, // inicio del texto (desde el borde inferior)
  CODE_FONTS: ['PhyPoppins', 'PhyJosefin'],  // Botánica = Poppins · Art déco = Josefin Sans
};

// Resolución de la imagen aplanada que se envía (px de ancho; alto proporcional)
export const OUTPUT_WIDTH = 1400;
export const OUTPUT_QUALITY = 0.86;
// Foto original que se archiva en Drive (lado mayor, px)
export const ORIGINAL_MAX = 2400;

// ----------------------------------------------------------------------------
//  Destino de cada página según su código (misma tabla que en Código.gs).
//  Se aceptan también los prefijos antiguos (DAT_, IND_, N01_S1_L, PS_0103_R, ENT_001…)
// ----------------------------------------------------------------------------
export const ROUTES = [
  { re: /^(DP|DAT_\d+)$/,                 dest: 'sheet', label: 'Datos personales' },
  { re: /^CG_\d$/,                        dest: 'sheet', label: 'Calendario general' },
  { re: /^MC_\d$/,                        dest: 'sheet', label: 'Hitos del año' },
  { re: /^H_[LR]$/,                       dest: 'sheet', label: 'Horario' },
  { re: /^M\d\d_[PH]$/,                   dest: 'sheet', label: 'Hitos mensuales' },
  { re: /^M\d\d_[LR]$/,                   dest: 'sheet', label: 'Calendario mensual' },
  { re: /^J_P$/,                          dest: 'sheet', label: 'Jefatura' },
  { re: /^J_A$/,                          dest: 'sheet', label: 'Jefatura · Alumnos' },
  { re: /^J_C$/,                          dest: 'sheet', label: 'Cumpleaños' },
  { re: /^C_P$/,                          dest: 'sheet', label: 'Mis cursos' },
  { re: /^(C\d\d_S[12]|N\d\d_S\d(_[LR])?)$/, dest: 'sheet', label: 'Notas' },
  { re: /^C\d\d_T[12]$/,                  dest: 'sheet', label: 'Temporalización' },
  { re: /^(S\d\d_[LR]|PS_\d{4}_[LR])$/,   dest: 'sheet', label: 'Planificación semanal' },
  { re: /^E_P$/,                          dest: 'sheet', label: 'Registro de entrevistas' },
  { re: /^(E\d\d|ENT_\d+)$/,              dest: 'doc',   label: 'Entrevistas' },
  { re: /^(A\d\d|A_P)$/,                  dest: 'doc',   label: 'Apuntes' },
  { re: /^(PT|DR|IX|IND_\d+|S_P|B\d{3})$/, dest: 'photo', label: 'Solo foto' },
];

export function routeFor(id) {
  return ROUTES.find(r => r.re.test(id)) || { dest: 'doc', label: 'Notas varias' };
}
