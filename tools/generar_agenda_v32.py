# -*- coding: utf-8 -*-
"""
Agenda Phygital Docente 2027 — Versión 3.2 (Mezcla 1.0 + 2.0)
  Variantes (VARIANT=escanear|fisica|digital): ver bloque VARIANTE.
Formato B5 · anillado · 310 páginas · campos interactivos (PDF)

  python generar_agenda_v31.py botanico   -> estilo pastel/botánico (v2.0)
  python generar_agenda_v31.py artdeco    -> estilo art déco (dorado y azul noche)

Reglas de compaginación
  · Impares a la derecha, pares a la izquierda (pág. 1 = derecha, al abrir la tapa).
  · El anillo va en el borde interior: margen grande al lado del anillo; las pestañas
    van siempre en el borde exterior (izquierda en páginas pares, derecha en impares).
  · Cuatro cuadrados de encuadre por página, disimulados en adornos.
  · Código abreviado de cada página, rotado 90°, abajo en el borde exterior.
"""
import calendar, datetime as dt, math, sys, csv, os
from reportlab.lib.colors import HexColor, transparent, black
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

STYLE = (sys.argv[1] if len(sys.argv) > 1 else 'botanico').lower()
HERE = os.path.dirname(os.path.abspath(__file__))
GF = '/usr/share/fonts/truetype/google-fonts/'
FD = os.path.join(HERE, 'fonts') + '/'

# ================================================================ TEMA
if STYLE == 'artdeco':
    pdfmetrics.registerFont(TTFont('Serif', FD + 'Marcellus-Regular.ttf'))
    pdfmetrics.registerFont(TTFont('SerifIt', FD + 'Marcellus-Regular.ttf'))
    pdfmetrics.registerFont(TTFont('Sans', FD + 'JosefinSans-Light.ttf'))
    pdfmetrics.registerFont(TTFont('SansR', FD + 'JosefinSans-Regular.ttf'))
    pdfmetrics.registerFont(TTFont('SansM', FD + 'JosefinSans-SemiBold.ttf'))
    pdfmetrics.registerFont(TTFont('SansB', FD + 'JosefinSans-SemiBold.ttf'))
    BG = HexColor('#F6F1E4')
    INK = HexColor('#1D2440')
    MUTED = HexColor('#8C8270')
    LINE = HexColor('#D9CDAE')
    FAINT = HexColor('#EEE6D2')
    ORN = HexColor('#8C6A1E')            # oro de los adornos
    SQC = HexColor('#0E1A3A')            # cuadrados de encuadre (azul noche)
    CODEC = HexColor('#6E6656')
    P = {'blush': (HexColor('#EDE1C4'), HexColor('#8C6A1E')),
         'sky': (HexColor('#DCDFE8'), HexColor('#1F2D55')),
         'sage': (HexColor('#E2E4D3'), HexColor('#55623F')),
         'lav': (HexColor('#E3DFE8'), HexColor('#463C63')),
         'butter': (HexColor('#F0E5C4'), HexColor('#A07C2A')),
         'peach': (HexColor('#EBDCCB'), HexColor('#875838'))}
    UPPER, RADIUS, TITLE_CS = True, 1.5, 1.5
else:
    pdfmetrics.registerFont(TTFont('Serif', GF + 'Lora-Variable.ttf'))
    pdfmetrics.registerFont(TTFont('SerifIt', GF + 'Lora-Italic-Variable.ttf'))
    pdfmetrics.registerFont(TTFont('Sans', GF + 'Poppins-Light.ttf'))
    pdfmetrics.registerFont(TTFont('SansR', GF + 'Poppins-Regular.ttf'))
    pdfmetrics.registerFont(TTFont('SansM', GF + 'Poppins-Medium.ttf'))
    pdfmetrics.registerFont(TTFont('SansB', GF + 'Poppins-SemiBold.ttf' if os.path.exists(GF + 'Poppins-SemiBold.ttf') else GF + 'Poppins-Bold.ttf'))
    BG = HexColor('#FBF8F2')
    INK = HexColor('#4A4443')
    MUTED = HexColor('#9A8F8C')
    LINE = HexColor('#E5DCD5')
    FAINT = HexColor('#F4EEE8')
    ORN = HexColor('#A39C97')            # gris de las hojas (como la Opción 4)
    SQC = HexColor('#2E2A29')
    CODEC = HexColor('#8F8784')
    P = {'blush': (HexColor('#F3DAD7'), HexColor('#D4A19B')),
         'sage': (HexColor('#DCE6D6'), HexColor('#97AE8E')),
         'lav': (HexColor('#E5DEF0'), HexColor('#A698C4')),
         'butter': (HexColor('#F6EBD2'), HexColor('#D2B47A')),
         'sky': (HexColor('#D9E5EE'), HexColor('#8EAAC0')),
         'peach': (HexColor('#F7E1D2'), HexColor('#D9A27F'))}
    UPPER, RADIUS, TITLE_CS = False, 7, 0
WHITE = HexColor('#FFFFFF')
DECO = STYLE == 'artdeco'

# ================================================================ VARIANTE
#   escanear : cuadrados + código (app Phygital), pestañas y enlaces, fondo blanco (papel de color)
#   fisica   : sin cuadrados, sin código, sin pestañas ni enlaces ni campos, fondo blanco
#   digital  : sin cuadrados ni código; pestañas, enlaces y campos; fondo de color; PDF bloqueado
VARIANT = os.environ.get('VARIANT', 'escanear').lower()
SCAN, FISICA, DIGITAL = VARIANT == 'escanear', VARIANT == 'fisica', VARIANT == 'digital'
if not DIGITAL:
    BG = WHITE

# ================================================================ PÁGINA
YEAR = 2027
W, H = 498.898, 708.661                      # B5
MM = 72 / 25.4
if SCAN:
    SQ = float(os.environ.get('SQ_MM', '4')) * MM     # lado del cuadrado de encuadre (v3.2: 4 mm)
    CLR = float(os.environ.get('CLR_MM', '2')) * MM   # papel limpio alrededor del cuadrado (v3.2: 2 mm)
else:                                               # sin cuadrado: el adorno conserva el tamaño de la v3.1
    SQ, CLR = 6.5, (2.4 if DECO else 3.2)
SQ_OUT, SQ_INN, SQ_V = 22, 46, 22
CODE_SIZE = float(os.environ.get('CODE_PT', '9'))            # centros: borde exterior, borde del anillo, vertical
M_OUT, M_INN = 42, 60                        # márgenes de contenido (exterior / anillo)
TOP, BOT = H - 52, 46
TAB_W, TAB_E = 18, 8                         # pestañas: ancho y separación del borde
TAB_TOP, TAB_BOT = H - 76, 78
ML = MR = CW = 0
ODD = True

CYCLE = ['sky', 'blush', 'sage', 'lav', 'butter', 'peach']
MONTH_COL = CYCLE * 2
MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto',
         'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
MES_AB = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC']
DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
DIA_AB = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do']
N_CURSOS, N_ENTREV, N_APUNTES, N_BLOQUES = 15, 60, 40, 14
PLANIF_START, N_SEMANAS = dt.date(YEAR, 3, 1), 41
AUTOR, ANIO_IMPRESION = 'Frederick Young', 2026

# ============================================================ helpers
def T(s): return s.upper() if UPPER else s

def st(c, x, y, s, font='Sans', size=9, color=None, cs=0, align='l'):
    color = INK if color is None else color
    w = pdfmetrics.stringWidth(s, font, size) + cs * max(len(s) - 1, 0)
    if align == 'c': x -= w / 2
    elif align == 'r': x -= w
    t = c.beginText(x, y); t.setFont(font, size); t.setCharSpace(cs)
    t.setFillColor(color); t.textOut(s); c.drawText(t)
    return w

def lab(c, x, y, s, color=None, size=6.2, align='l', cs=1.2, font='SansM'):
    return st(c, x, y, s.upper(), font, size, MUTED if color is None else color, cs, align)

def fit_lab(c, x, y, s, maxw, color=None, size=6, align='c', cs=1.0):
    s = s.upper()
    while size > 3.6 and pdfmetrics.stringWidth(s, 'SansM', size) + cs * (len(s) - 1) > maxw:
        size -= .2; cs = max(cs - .1, .3)
    return st(c, x, y, s, 'SansM', size, INK if color is None else color, cs, align)

def link(c, key, x, y, w, h):
    if FISICA: return
    c.linkAbsolute('', key, (x, y, x + w, y + h), thickness=0)

def rrect(c, x, y, w, h, r=None, fill=None, stroke=None, lw=0.6, alpha=1, nostroke=False):
    r = RADIUS if r is None else r
    stroke = None if nostroke else (LINE if stroke is None else stroke)
    c.saveState(); c.setLineWidth(lw)
    if fill is not None: c.setFillColor(fill); c.setFillAlpha(alpha)
    if stroke is not None: c.setStrokeColor(stroke)
    if r > 0: c.roundRect(x, y, w, h, r, stroke=1 if stroke is not None else 0, fill=1 if fill is not None else 0)
    else: c.rect(x, y, w, h, stroke=1 if stroke is not None else 0, fill=1 if fill is not None else 0)
    c.restoreState()

def box(c, x, y, w, h, fill, alpha=1):
    rrect(c, x, y, w, h, 0, fill=fill, alpha=alpha, nostroke=True)

def hline(c, x1, x2, y, color=None, lw=0.5, dash=None):
    c.saveState(); c.setStrokeColor(LINE if color is None else color); c.setLineWidth(lw)
    if dash: c.setDash(*dash)
    c.line(x1, y, x2, y); c.restoreState()

def vline(c, x, y1, y2, color=None, lw=0.5):
    c.saveState(); c.setStrokeColor(LINE if color is None else color); c.setLineWidth(lw)
    c.line(x, y1, x, y2); c.restoreState()

def dot(c, x, y, r=0.55, color=None):
    c.saveState(); c.setFillColor(color or (HexColor('#CFC4C0') if not DECO else HexColor('#C9BB95')))
    c.circle(x, y, r, stroke=0, fill=1); c.restoreState()

def circ(c, x, y, r, fill=None, stroke=None, lw=0.55, alpha=1):
    c.saveState(); c.setLineWidth(lw)
    if fill is not None: c.setFillColor(fill); c.setFillAlpha(alpha)
    if stroke is not None: c.setStrokeColor(stroke)
    c.circle(x, y, r, stroke=1 if stroke is not None else 0, fill=1 if fill is not None else 0)
    c.restoreState()

def bullet(c, x, y, col):
    """Marcador de título de panel: punto (botánico) o rombo (art déco)."""
    if DECO:
        c.saveState(); c.setFillColor(P[col][1]); c.translate(x, y); c.rotate(45)
        c.rect(-1.8, -1.8, 3.6, 3.6, stroke=0, fill=1); c.restoreState()
    else:
        circ(c, x, y, 2.4, fill=P[col][1])

# --------------------------------------------------- campos interactivos
class F:
    c = None; code = ''; n = 0
def _fname():
    F.n += 1
    return '%s__%d' % (F.code, F.n)

def tf(x, y, w, h, size=7, multi=False):
    """Campo de texto transparente (se escribe sobre la línea / celda)."""
    if w < 6 or h < 5 or not DIGITAL: return
    F.c.acroForm.textfield(name=_fname(), x=x, y=y, width=w, height=h, borderWidth=0,
                           borderColor=transparent, fillColor=transparent, textColor=black,
                           fontName='Helvetica', fontSize=size, forceBorder=False,
                           fieldFlags='multiline' if multi else '')

def checkbox(c, x, y, s=6.2, color=None, field=True):
    """Casilla dibujada + casilla interactiva (marca ✓ negra al hacer clic)."""
    c.saveState(); c.setStrokeColor(MUTED if color is None else color); c.setLineWidth(0.55)
    if DECO: c.rect(x, y, s, s, stroke=1, fill=0)
    else: c.roundRect(x, y, s, s, 1.4, stroke=1, fill=0)
    c.restoreState()
    if field and DIGITAL:
        c.acroForm.checkbox(name=_fname(), x=x - .4, y=y - .4, size=s + .8, buttonStyle='check',
                            borderWidth=0, borderColor=transparent, fillColor=transparent,
                            textColor=black, forceBorder=False)

def wline(c, x1, x2, y, gap=13, size=7, color=None, dash=None):
    """Línea para escribir con su campo de texto encima."""
    hline(c, x1, x2, y, color, dash=dash)
    tf(x1, y + .6, x2 - x1, min(gap - 2.5, 12), size)

# ------------------------------------------------------------ adornos
def leaf(c, L, Wd):
    p = c.beginPath(); p.moveTo(0, 0)
    p.curveTo(L * .3, Wd, L * .72, Wd, L, 0)
    p.curveTo(L * .72, -Wd, L * .3, -Wd, 0, 0)
    c.drawPath(p, stroke=0, fill=1)

def leaf_line(c, L, Wd):
    """Hoja solo contorno con nervio central (estilo Opción 4)."""
    p = c.beginPath(); p.moveTo(0, 0)
    p.curveTo(L * .3, Wd, L * .72, Wd, L, 0)
    p.curveTo(L * .72, -Wd, L * .3, -Wd, 0, 0)
    c.drawPath(p, stroke=1, fill=0)
    p = c.beginPath(); p.moveTo(L * .12, 0); p.curveTo(L * .4, Wd * .25, L * .7, Wd * .2, L * .9, 0)
    c.drawPath(p, stroke=1, fill=0)

def sprig(c, x, y, scale=1, angle=0, col='sage', alpha=.75, n=8, bend=10, length=100):
    if DECO:
        return deco_fan(c, x, y, 22 * scale, angle - 90, alpha)
    c.saveState(); c.translate(x, y); c.rotate(angle); c.scale(scale, scale)
    color = P[col][1]
    c.setStrokeColor(color); c.setFillColor(color)
    c.setStrokeAlpha(alpha); c.setFillAlpha(alpha * .8); c.setLineWidth(0.9)
    f = lambda t: (length * t, bend * math.sin(math.pi * t))
    p = c.beginPath(); p.moveTo(0, 0)
    for i in range(1, 41): p.lineTo(*f(i / 40))
    c.drawPath(p, stroke=1, fill=0)
    for i in range(n):
        t = 0.12 + 0.8 * i / max(n - 1, 1)
        px, py = f(t); tx, ty = f(t + .01)
        ang = math.degrees(math.atan2(ty - py, tx - px))
        side = 1 if i % 2 == 0 else -1
        c.saveState(); c.translate(px, py); c.rotate(ang + side * 38)
        leaf(c, 20 * (1 - .35 * t), 5.2 * (1 - .3 * t)); c.restoreState()
    ex, ey = f(1); c.saveState(); c.translate(ex, ey); c.rotate(-5); leaf(c, 14, 4); c.restoreState()
    c.restoreState()

def flower(c, x, y, r=6, col='blush', alpha=.8):
    if DECO:
        c.saveState(); c.translate(x, y); c.rotate(45); c.setStrokeColor(ORN); c.setLineWidth(.6)
        c.rect(-r * .5, -r * .5, r, r, stroke=1, fill=0)
        c.setFillColor(ORN); c.rect(-r * .2, -r * .2, r * .4, r * .4, stroke=0, fill=1); c.restoreState()
        return
    c.saveState(); c.translate(x, y); c.setFillColor(P[col][1]); c.setFillAlpha(alpha * .6)
    for i in range(5):
        c.saveState(); c.rotate(i * 72); leaf(c, r * 1.9, r * .62); c.restoreState()
    c.setFillAlpha(1); c.setFillColor(P['butter'][1]); c.circle(0, 0, r * .28, stroke=0, fill=1)
    c.restoreState()

def blob(c, x, y, r, col, alpha=.5):
    if DECO:
        return deco_sun(c, x, y, r * .8, alpha)
    c.saveState(); c.setFillColor(P[col][0]); c.setFillAlpha(alpha); c.circle(x, y, r, stroke=0, fill=1); c.restoreState()

def deco_fan(c, x, y, r, angle=0, alpha=.9):
    """Abanico art déco (medio sol con rayos)."""
    c.saveState(); c.translate(x, y); c.rotate(angle); c.setStrokeColor(ORN); c.setStrokeAlpha(alpha)
    c.setLineWidth(.55)
    for k in (1, .72, .45):
        p = c.beginPath(); p.arc(-r * k, -r * k, r * k, r * k, 0, 180); c.drawPath(p, stroke=1, fill=0)
    for i in range(9):
        a = math.radians(i * 22.5)
        c.line(math.cos(a) * r * .45, math.sin(a) * r * .45, math.cos(a) * r, math.sin(a) * r)
    c.line(-r, 0, r, 0)
    c.restoreState()

def deco_sun(c, x, y, r, alpha=.5):
    c.saveState(); c.translate(x, y); c.setStrokeColor(ORN); c.setStrokeAlpha(min(alpha + .2, .8))
    c.setLineWidth(.5)
    for k in (1, .82, .64):
        c.circle(0, 0, r * k, stroke=1, fill=0)
    for i in range(36):
        a = math.radians(i * 10)
        c.line(math.cos(a) * r * .64, math.sin(a) * r * .64, math.cos(a) * r * (1 if i % 2 else .82), math.sin(a) * r * (1 if i % 2 else .82))
    c.restoreState()

# ------------------------------------- cuadrados de encuadre disimulados
def corner(c, cx, cy, sx, sy, outer_bottom=False):
    """Cuadrado de encuadre en (cx, cy) con adorno. sx/sy = dirección hacia el interior."""
    q = CLR                                    # zona despejada alrededor del cuadrado
    hs = SQ / 2
    if DECO:
        c.saveState(); c.setStrokeColor(ORN); c.setLineWidth(.55)
        f = hs + CLR                            # marco fino alrededor del cuadrado
        c.rect(cx - f, cy - f, 2 * f, 2 * f, stroke=1, fill=0)
        g = f + 2.6
        # líneas dobles a lo largo de los bordes
        for off in (0, 3):
            c.line(cx + sx * (f + 2), cy + sy * (-f + off), cx + sx * 54, cy + sy * (-f + off))
            if not outer_bottom:
                c.line(cx + sx * (-f + off), cy + sy * (f + 2), cx + sx * (-f + off), cy + sy * 44)
        if outer_bottom:
            c.line(cx + sx * (f + 3.5), cy + sy * (f + 2), cx + sx * (f + 3.5), cy + sy * 50)
        # diagonal escalonada
        c.line(cx + sx * g, cy + sy * g, cx + sx * 26, cy + sy * 26)
        c.saveState(); c.translate(cx + sx * 26, cy + sy * 26); c.rotate(45); c.rect(-2.2, -2.2, 4.4, 4.4, stroke=1, fill=0); c.restoreState()
        c.line(cx + sx * 10, cy + sy * (f + 7), cx + sx * 30, cy + sy * (f + 7))
        if not outer_bottom:
            c.line(cx + sx * (f + 7), cy + sy * 10, cx + sx * (f + 7), cy + sy * 30)
        c.restoreState()
    else:
        c.saveState(); c.setStrokeColor(ORN); c.setLineWidth(.6)
        # tallo horizontal que nace junto al cuadrado, con hojas de contorno
        def stem(dx, dy, L, nleaf, flip=1):
            c.saveState(); c.translate(cx + dx * (hs + q), cy + dy * (hs + q))
            ang = math.degrees(math.atan2(dy, dx)); c.rotate(ang)
            p = c.beginPath(); p.moveTo(0, 0)
            p.curveTo(L * .35, 2.5 * flip, L * .7, 3.2 * flip, L, 1.0 * flip); c.drawPath(p, stroke=1, fill=0)
            for i in range(nleaf):
                t = .25 + .62 * i / max(nleaf - 1, 1)
                side = 1 if i % 2 == 0 else -1
                c.saveState(); c.translate(L * t, 2.6 * flip * math.sin(math.pi * t)); c.rotate(side * 42 + (8 if flip > 0 else -8))
                leaf_line(c, 11 * (1 - .3 * t), 2.9); c.restoreState()
            c.saveState(); c.translate(L, flip); c.rotate(6 * flip); leaf_line(c, 9, 2.6); c.restoreState()
            c.restoreState()
        stem(sx, 0, 46, 4, sy)
        if outer_bottom:
            c.line(cx + sx * 7, cy + sy * (hs + q + 9), cx + sx * 7, cy + sy * 50)   # tallo recto junto al código
        else:
            stem(0, sy, 34, 3, -sx)
        # pétalos de contorno en las diagonales: el cuadrado queda como el centro de una flor
        for ax, ay in [(1, 1), (1, -1), (-1, 1), (-1, -1)]:
            if outer_bottom and (ax, ay) == (0, 0): continue
            c.saveState(); c.translate(cx + ax * (hs + q), cy + ay * (hs + q))
            c.rotate(math.degrees(math.atan2(ay, ax))); leaf_line(c, 7.5 if (ax, ay) != (sx, sy) else 10, 2.6)
            c.restoreState()
        c.circle(cx, cy, hs + q + 1.2, stroke=1, fill=0)
        c.restoreState()
    if SCAN:
        c.saveState(); c.setFillColor(SQC); c.rect(cx - hs, cy - hs, SQ, SQ, stroke=0, fill=1); c.restoreState()

# ======================================================= ESTRUCTURA
PAGES = []                                  # (código, tipo, kw)
def add(code, kind, **kw):
    PAGES.append((code, kind, kw))
def blank():
    add('B%03d' % (len(PAGES) + 1), 'blank')

def build():
    add('PT', 'cover')
    add('DR', 'derechos')
    add('DP', 'datos')
    blank()
    add('IX', 'indice')
    add('CG_1', 'calgen', sem=1); add('CG_2', 'calgen', sem=2)
    add('MC_1', 'minical', sem=1); add('MC_2', 'minical', sem=2)
    add('H_L', 'horario', dias=[0, 1, 2]); add('H_R', 'horario', dias=[3, 4, 5])
    for m in range(2, 13):
        b = 'M%02d' % m
        add(b + '_P', 'mes_portada', m=m); add(b + '_H', 'mes_hitos', m=m)
        add(b + '_L', 'mes_grid', m=m, lado='L'); add(b + '_R', 'mes_grid', m=m, lado='R')
    blank(); add('J_P', 'sec_jefatura'); add('J_A', 'jef_alumnos'); add('J_C', 'jef_cumple')
    blank(); add('C_P', 'sec_cursos')
    for k in range(1, N_CURSOS + 1):
        b = 'C%02d' % k
        add(b + '_S1', 'notas', k=k, sem=1); add(b + '_S2', 'notas', k=k, sem=2)
        add(b + '_T1', 'temp', k=k, sem=1); add(b + '_T2', 'temp', k=k, sem=2)
    blank(); add('S_P', 'sec_planif')
    for s in range(1, N_SEMANAS + 1):
        lun = PLANIF_START + dt.timedelta(days=7 * (s - 1))
        add('S%02d_L' % s, 'planif', s=s, lun=lun, lado='L'); add('S%02d_R' % s, 'planif', s=s, lun=lun, lado='R')
    blank(); add('E_P', 'sec_entrev')
    for k in range(1, N_ENTREV + 1): add('E%02d' % k, 'entrev', k=k)
    blank(); add('A_P', 'sec_apuntes')
    for k in range(1, N_APUNTES + 1): add('A%02d' % k, 'apuntes', k=k)
    blank()

build()
NUM = {code: i + 1 for i, (code, _, _) in enumerate(PAGES)}
if SCAN:   # las pestañas empiezan sobre el código más largo
    _code_end = SQ_V + SQ / 2 + CLR + 4 + max(pdfmetrics.stringWidth(k, 'SansB', CODE_SIZE) + 1.0 * len(k) for k, _, _ in PAGES)
    TAB_BOT = max(TAB_BOT, _code_end + 6)
# comprobaciones de compaginación
assert len(NUM) == len(PAGES) and len(PAGES) % 2 == 0
for code in ['PT', 'DP', 'IX', 'J_P', 'C_P', 'S_P', 'E_P', 'A_P', 'J_C', 'C15_T2', 'S41_R', 'E60', 'A40']:
    assert NUM[code] % 2 == 1, code
for code in ['DR', 'CG_1', 'H_L', 'M02_P', 'M02_L', 'J_A', 'C01_S1', 'S01_L', 'E01', 'A01']:
    assert NUM[code] % 2 == 0, code

def week_code(d, lado='L'):
    lun = d - dt.timedelta(days=d.weekday())
    s = (lun - PLANIF_START).days // 7 + 1
    return 'S%02d_%s' % (s, lado) if 1 <= s <= N_SEMANAS else None

def section_of(code, kind):
    if kind in ('cover', 'derechos', 'blank'): return None
    if code in ('DP', 'IX'): return 'inicio'
    if kind in ('calgen', 'minical'): return 'anio'
    if kind == 'horario': return 'horario'
    if code.startswith('M'): return 'm' + code[1:3]
    if code.startswith('J'): return 'jefatura'
    if code.startswith('C'): return 'cursos'
    if code.startswith('S'): return 'planif'
    if code.startswith('E'): return 'entrev'
    return 'apuntes'

TABS = [('Inicio', 'inicio', 'DP', 'blush'), ('Año', 'anio', 'CG_1', 'sky'), ('Horario', 'horario', 'H_L', 'sage')] + \
       [(MES_AB[m - 1], 'm%02d' % m, 'M%02d_P' % m, MONTH_COL[m - 1]) for m in range(2, 13)] + \
       [('Jefatura', 'jefatura', 'J_P', 'lav'), ('Cursos', 'cursos', 'C_P', 'butter'),
        ('Planif.', 'planif', 'S_P', 'sky'), ('Entrev.', 'entrev', 'E_P', 'peach'), ('Apuntes', 'apuntes', 'A_P', 'blush')]

# ============================================================ marco
def set_side(n):
    global ML, MR, CW, ODD
    ODD = n % 2 == 1
    if ODD:   ML, MR = M_INN, W - M_OUT        # derecha: anillo a la izquierda
    else:     ML, MR = M_OUT, W - M_INN        # izquierda: anillo a la derecha
    CW = MR - ML

def frame(c, n, code, section):
    """Fondo (al inicio de la página)."""
    c.saveState(); c.setFillColor(BG); c.rect(0, 0, W, H, stroke=0, fill=1); c.restoreState()

def finish(c, n, code, section, show_num=True):
    if section and not FISICA: tabs(c, section)
    # cuadrados en las 4 esquinas
    xo = W - SQ_OUT if ODD else SQ_OUT          # exterior
    xi = SQ_INN if ODD else W - SQ_INN          # lado del anillo
    so = -1 if ODD else 1                       # hacia el interior desde el borde exterior
    corner(c, xo, H - SQ_V, so, -1)
    corner(c, xi, H - SQ_V, -so, -1)
    corner(c, xi, SQ_V, -so, 1)
    corner(c, xo, SQ_V, so, 1, outer_bottom=True)
    # código abreviado: rotado 90°, abajo, sobre el cuadrado exterior (lectura de abajo hacia arriba)
    size = CODE_SIZE
    if SCAN:
      c.saveState(); c.translate(xo + size * .36, SQ_V + SQ / 2 + CLR + 4); c.rotate(90)
      t = c.beginText(0, 0); t.setFont('SansB', size); t.setCharSpace(1.0)
      if DECO: t.setTextRenderMode(2)          # Josefin no trae negrita real: relleno + contorno
      c.setFillColor(SQC); c.setStrokeColor(SQC); c.setLineWidth(.35)
      t.textOut(code); c.drawText(t); c.restoreState()
    if show_num:
        st(c, W / 2, 19, str(n), 'SansR', 6.4, MUTED, 0, 'c')
    c.showPage()

def tabs(c, active):
    th = (TAB_TOP - TAB_BOT) / len(TABS)
    for i, (t, key, dest, col) in enumerate(TABS):
        y = TAB_TOP - (i + 1) * th
        act = key == active
        w = TAB_W + (5 if act else 0)
        x = W - TAB_E - TAB_W - (5 if act else 0) if ODD else TAB_E
        if DECO:
            rrect(c, x, y + 1.1, w, th - 2.2, 0, fill=P[col][1] if act else P[col][0],
                  stroke=ORN if not act else None, lw=.4, nostroke=act)
        else:
            rrect(c, x, y + 1.1, w, th - 2.2, 3.5, fill=P[col][1] if act else P[col][0],
                  alpha=1 if act else .8, nostroke=True)
        size = 5.2; s = t.upper()
        while pdfmetrics.stringWidth(s, 'SansM', size) + .7 * (len(s) - 1) > th - 7: size -= .2
        c.saveState(); c.translate(x + w / 2 + size * .36, y + th / 2); c.rotate(90)
        st(c, 0, 0, s, 'SansM', size, WHITE if act else INK, .7, 'c'); c.restoreState()
        link(c, dest, x, y + 1.1, w, th - 2.2)

def header(c, title, kicker=None, col='blush', deco=True, size=22):
    if kicker: lab(c, ML, TOP - 6, kicker, P[col][1], 6.8, cs=2)
    st(c, ML, TOP - 32, T(title), 'Serif', size * (.86 if UPPER else 1), INK, TITLE_CS)
    hline(c, ML, ML + 30, TOP - 42, P[col][1] if not DECO else ORN, 1.1)
    if deco:
        if DECO:
            deco_fan(c, MR - 22, TOP - 34, 16, 0, .9)
        else:
            sprig(c, MR - 6, TOP - 2, .45, 200, col='sage', alpha=.55, n=7)
            flower(c, MR - 52, TOP - 16, 3.6, col)
    return TOP - 52

def pill(c, x, y, text, col='blush', key=None, align='l', h=13, size=5.8, solid=False):
    w = pdfmetrics.stringWidth(text.upper(), 'SansM', size) + 1.1 * (len(text) - 1) + 14
    if align == 'r': x -= w
    if DECO:
        rrect(c, x, y, w, h, 0, fill=P[col][1] if solid else None, stroke=P[col][1], lw=.5)
    else:
        rrect(c, x, y, w, h, h / 2, fill=P[col][1] if solid else P[col][0], nostroke=True)
    st(c, x + w / 2, y + h / 2 - size * 0.36, text.upper(), 'SansM', size, WHITE if solid else INK, 1.1, 'c')
    if key: link(c, key, x, y, w, h)
    return w

def pills_right(c, items, y):
    x = MR
    for t, col, key, solid in reversed(items):
        w = pill(c, x, y, t, col, key, 'r', solid=solid); x -= w + 4

def panel(c, x, y, w, h, title=None, col='blush', kind=None, gap=16):
    rrect(c, x, y, w, h, stroke=LINE if not DECO else HexColor('#CDBE95'))
    tp = 9
    if title:
        bullet(c, x + 11, y + h - 12.6, col)
        lab(c, x + 17, y + h - 15.2, title, INK, 7)
        tp = 23
    ytop = y + h - tp
    if kind == 'lines':
        yy = ytop - gap + 4
        while yy > y + 7:
            wline(c, x + 10, x + w - 10, yy, gap); yy -= gap
    elif kind == 'checks':
        yy = ytop - gap + 4
        while yy > y + 7:
            checkbox(c, x + 10, yy + 1.5); wline(c, x + 21, x + w - 10, yy, gap); yy -= gap
    elif kind == 'dots':
        sp = 11.5; yy = ytop - 5
        while yy > y + 7:
            xx = x + 10
            while xx < x + w - 8:
                dot(c, xx, yy); xx += sp
            yy -= sp
        tf(x + 6, y + 6, w - 12, ytop - y - 8, 8, multi=True)
    return ytop

def grid_table(c, x, ytop, w, cols, nrows, rowh, col='blush', head_h=16, numbered=False, zebra=False,
               fields=True, skip_cols=1):
    box(c, x, ytop - head_h, w, head_h, P[col][0])
    xs = []; xx = x
    for t, f in cols:
        cw = w * f; xs.append((xx, cw))
        if '\n' in t:
            a, b2 = t.split('\n')
            fit_lab(c, xx + cw / 2, ytop - head_h / 2 + 1.2, a, cw - 4, INK, 5.2)
            fit_lab(c, xx + cw / 2, ytop - head_h / 2 - 5.2, b2, cw - 4, INK, 5.2)
        else:
            fit_lab(c, xx + cw / 2, ytop - head_h / 2 - 2, t, cw - 4, INK, 5.6)
        xx += cw
    y = ytop - head_h
    for i in range(nrows):
        if zebra and i % 2 == 1: box(c, x, y - rowh, w, rowh, FAINT)
        if numbered:
            st(c, xs[0][0] + xs[0][1] / 2, y - rowh / 2 - 2, str(i + 1), 'Sans', 5.6, MUTED, 0, 'c')
        if fields:
            for cx_, cw_ in xs[skip_cols:]:
                tf(cx_ + 1.5, y - rowh + .8, cw_ - 3, rowh - 1.6, min(7, rowh * .62))
        y -= rowh
        hline(c, x, x + w, y)
    for xx, _ in xs[1:]: vline(c, xx, ytop - head_h, y)
    return y, xs

def mini_cal(c, x, ytop, w, month, title=True, size=5.8, col=None, link_month=True):
    col = col or MONTH_COL[month - 1]
    cw = w / 7; rh = min(cw * .8, 10.5)
    y = ytop
    if title:
        lab(c, x + 2, y - 7, MESES[month - 1], INK, 6.2, cs=1.6)
        if link_month and month >= 2: link(c, 'M%02d_P' % month, x, y - 10, w, 12)
        y -= 17
    for i, d in enumerate('LMMJVSD'):
        st(c, x + cw * i + cw / 2, y - 5, d, 'SansM', size - .5, P[col][1], 0, 'c')
    y -= rh + 1
    for wk in calendar.monthcalendar(YEAR, month):
        for i, d in enumerate(wk):
            if not d: continue
            cx = x + cw * i + cw / 2
            st(c, cx, y - 4, str(d), 'Sans', size, MUTED if i >= 5 else INK, 0, 'c')
            k = week_code(dt.date(YEAR, month, d), 'L' if i < 3 else 'R')
            if k and i < 6: link(c, k, cx - cw / 2, y - 4 - rh * .3, cw, rh)
        y -= rh
    return y

# ================================================================ PÁGINAS
def p_cover(c, kw):
    # Solo el logo "Agenda Docente"
    cx, cy = (ML + MR) / 2, H * .55
    if DECO:
        deco_sun(c, cx, cy + 10, 120, .5)
        c.saveState(); c.setFillColor(BG); c.rect(cx - 150, cy - 62, 300, 116, stroke=0, fill=1); c.restoreState()
        c.saveState(); c.setStrokeColor(ORN); c.setLineWidth(.7)
        c.rect(cx - 140, cy - 56, 280, 104, stroke=1, fill=0); c.rect(cx - 135, cy - 51, 270, 94, stroke=1, fill=0)
        c.restoreState()
        st(c, cx, cy + 6, 'AGENDA DOCENTE', 'Serif', 26, INK, 3, 'c')
        hline(c, cx - 50, cx + 50, cy - 8, ORN, .8)
        st(c, cx, cy - 34, str(YEAR), 'Serif', 20, ORN, 6, 'c')
        flower(c, cx - 64, cy - 27, 6); flower(c, cx + 64, cy - 27, 6)
    else:
        blob(c, cx + 70, cy + 70, 120, 'blush', .55)
        blob(c, cx - 110, cy - 60, 70, 'sage', .45)
        blob(c, cx + 120, cy - 110, 26, 'lav', .55)
        sprig(c, cx + 150, cy + 10, 1.1, 140, 'sage', .7, n=9)
        sprig(c, cx - 150, cy - 10, 1.0, -30, 'sage', .6, n=8)
        flower(c, cx + 95, cy + 70, 8, 'blush'); flower(c, cx + 118, cy + 46, 5.5, 'lav')
        st(c, cx, cy + 4, 'Agenda Docente', 'Serif', 40, INK, 0, 'c')
        st(c, cx, cy - 36, str(YEAR), 'SerifIt', 30, P['blush'][1], 3, 'c')
        hline(c, cx - 22, cx + 22, cy - 50, P['blush'][1], .9)

def p_derechos(c, kw):
    y = 150
    st(c, (ML + MR) / 2, y, T('Agenda Docente %d' % YEAR), 'Serif', 11, INK, TITLE_CS, 'c')
    lines = ['© %d %s' % (ANIO_IMPRESION, AUTOR),
             'Año de impresión: %d' % ANIO_IMPRESION,
             'Todos los derechos reservados.',
             'Prohibida su reproducción total o parcial sin autorización del autor.']
    yy = y - 20
    for t in lines:
        st(c, (ML + MR) / 2, yy, t, 'Sans', 7.5, MUTED, 0, 'c'); yy -= 12

def p_datos(c, kw):
    y = header(c, 'Datos personales', 'Agenda Docente %d' % YEAR, 'blush')
    campos = ['Nombre', 'RUT', 'Teléfono', 'Correo electrónico', 'Dirección personal', 'Establecimiento',
              'Cargo', 'Jefatura', 'Asignaturas', 'Teléfono del establecimiento', 'Correo del establecimiento',
              'Dirección del establecimiento', 'Cantidad de horas', 'Contacto de emergencia', 'Teléfono de emergencia']
    ph = y - BOT
    panel(c, ML, BOT, CW, ph, 'Mis datos', 'blush')
    rowh = (ph - 30) / len(campos)
    yy = y - 30
    for t in campos:
        lab(c, ML + 12, yy - rowh + 8, t, MUTED, 7, cs=1)
        wline(c, ML + 172, MR - 12, yy - rowh + 6, rowh)
        yy -= rowh

def p_indice(c, kw):
    y = header(c, 'Índice', 'Contenido', 'sage')
    ent = [('Datos personales', 'DP', 0), ('Calendario general %d' % YEAR, 'CG_1', 0),
           ('Minicalendarios e hitos', 'MC_1', 0), ('Mi horario', 'H_L', 0), ('Calendarios mensuales', 'M02_P', 0)]
    ent += [(MESES[m - 1], 'M%02d_P' % m, 1) for m in range(2, 13)]
    ent += [('Jefatura', 'J_P', 0), ('Alumnos de mi jefatura', 'J_A', 1), ('Cumpleaños del curso', 'J_C', 1)]
    ent2 = [('Cursos', 'C_P', 0)] + [('Curso %02d' % k, 'C%02d_S1' % k, 1) for k in range(1, N_CURSOS + 1)]
    ent2 += [('Planificación semanal', 'S_P', 0), ('Entrevistas con apoderados', 'E_P', 0), ('Hojas de apuntes', 'A_P', 0)]
    colw = (CW - 18) / 2
    rh = min(16.5, (y - BOT - 10) / max(len(ent), len(ent2)))
    for col, lst in enumerate([ent, ent2]):
        for r, (t, code, lvl) in enumerate(lst):
            x = ML + col * (colw + 18); yy = y - 14 - r * rh
            num = str(NUM[code])
            if lvl == 0:
                bullet(c, x + 2, yy + 2.6, CYCLE[r % 6])
                tw = lab(c, x + 9, yy, t, INK, 6, cs=1.3) + 9
            else:
                tw = st(c, x + 16, yy, t, 'Sans', 7.6) + 16
            st(c, x + colw, yy, num, 'SansR', 7, MUTED, 0, 'r')
            hline(c, x + tw + 5, x + colw - pdfmetrics.stringWidth(num, 'SansR', 7) - 5, yy + 2, LINE, .5, (1, 2))
            link(c, code, x, yy - 4, colw, 13)

def p_calgen(c, kw):
    sem = kw['sem']; ms = range(1, 7) if sem == 1 else range(7, 13)
    y = header(c, 'Calendario general %d' % YEAR, 'El año completo', 'sky', deco=False)
    pills_right(c, [('Ene – Jun', 'sky', 'CG_1', sem == 1), ('Jul – Dic', 'blush', 'CG_2', sem == 2)], TOP - 30)
    dw = 22; mw = (CW - dw) / 6
    head = 16; rowh = (y - BOT - head) / 31
    box(c, ML, y - head, CW, head, P['sky'][0])
    lab(c, ML + dw / 2, y - head / 2 - 2, 'Día', INK, 5.4, 'c', 1)
    for j, m in enumerate(ms):
        x = ML + dw + j * mw
        lab(c, x + mw / 2, y - head / 2 - 2, MESES[m - 1], INK, 5.4, 'c', 1)
        link(c, 'M%02d_P' % m if m >= 2 else 'MC_1', x, y - head, mw, head)
    yy = y - head
    for day in range(1, 32):
        st(c, ML + dw / 2, yy - rowh / 2 - 2.2, str(day), 'SansR', 6, INK, 0, 'c')
        for j, m in enumerate(ms):
            x = ML + dw + j * mw
            try: dd = dt.date(YEAR, m, day)
            except ValueError:
                box(c, x + .5, yy - rowh + .5, mw - 1, rowh - 1, FAINT); continue
            wd = dd.weekday()
            if wd >= 5: box(c, x + .5, yy - rowh + .5, mw - 1, rowh - 1, P[MONTH_COL[m - 1]][0], .6)
            st(c, x + 2.5, yy - 6.3, DIA_AB[wd], 'Sans', 4.4, P[MONTH_COL[m - 1]][1] if wd < 5 else INK)
            tf(x + 12, yy - rowh + .8, mw - 13.5, rowh - 1.6, 6)
        yy -= rowh
        hline(c, ML, MR, yy)
    for j in range(6): vline(c, ML + dw + j * mw, y - head, yy)

def p_minical(c, kw):
    sem = kw['sem']; ms = list(range(1, 7) if sem == 1 else range(7, 13))
    y = header(c, 'Minicalendarios %d' % YEAR, 'Hitos del año', 'lav', deco=False)
    pills_right(c, [('Ene – Jun', 'lav', 'MC_1', sem == 1), ('Jul – Dic', 'peach', 'MC_2', sem == 2)], TOP - 30)
    gap = 7; bh = (y - BOT - 5 * gap) / 6
    for i, m in enumerate(ms):
        yt = y - i * (bh + gap)
        col = MONTH_COL[m - 1]
        rrect(c, ML, yt - bh, CW, bh)
        calw = 108
        box(c, ML + 4, yt - bh + 4, calw, bh - 8, P[col][0], .45)
        mini_cal(c, ML + 8, yt - 3, calw - 8, m, size=5.1)
        x2 = ML + calw + 14
        bullet(c, x2 + 2, yt - 10.4, col)
        lab(c, x2 + 8, yt - 12.6, 'Hitos y fechas clave', INK, 6.6)
        yy = yt - 26
        while yy > yt - bh + 6:
            wline(c, x2, MR - 10, yy, 13); yy -= 13

def p_horario(c, kw):
    dias = kw['dias']
    y = header(c, 'Mi horario', 'Semana tipo', 'sage', deco=False)
    pills_right(c, [('Lun – Mié', 'sage', 'H_L', dias[0] == 0), ('Jue – Sáb', 'butter', 'H_R', dias[0] == 3)], TOP - 30)
    cols = [('Hora', .12), ('Blq', .07)] + [(DIAS[i], .81 / 3) for i in dias]
    total_h = 24
    rowh = (y - BOT - 18 - total_h) / N_BLOQUES
    yb, xs = grid_table(c, ML, y, CW, cols, N_BLOQUES, rowh, 'sage', 18, fields=False)
    for r in range(N_BLOQUES):
        yy = y - 18 - r * rowh
        box(c, xs[1][0] + .5, yy - rowh + .5, xs[1][1] - 1, rowh - 1, P['sage'][0], .5)
        st(c, xs[1][0] + xs[1][1] / 2, yy - rowh / 2 - 2.2, str(r + 1), 'SansR', 6.5, INK, 0, 'c')
        tf(xs[0][0] + 2, yy - rowh + 1, xs[0][1] - 4, rowh - 2, 6.5)
        for xx, cw in xs[2:]:
            tf(xx + 2, yy - rowh + 1, cw - 4, rowh - 2, 7, multi=True)
    box(c, ML, yb - total_h, CW, total_h, P['butter'][0], .7)
    lab(c, ML + (xs[0][1] + xs[1][1]) / 2, yb - total_h / 2 - 2, 'Total horas', INK, 5.4, 'c', 1)
    for xx, cw in xs[2:]:
        vline(c, xx, yb, yb - total_h); tf(xx + 2, yb - total_h + 2, cw - 4, total_h - 4, 9)

def p_mes_portada(c, kw):
    m = kw['m']; col = MONTH_COL[m - 1]; b = 'M%02d' % m
    # página izquierda: los adornos van hacia la izquierda (exterior), el texto se alinea a la derecha
    if DECO:
        deco_sun(c, ML + 70, H - 150, 90, .5)
    else:
        blob(c, ML + 30, H - 120, 140, col, .6)
        blob(c, MR - 40, 130, 80, 'sage' if col != 'sage' else 'lav', .35)
        sprig(c, ML + 4, H - 196, 1.0, 35, 'sage', .65, n=9)
        flower(c, ML + 96, H - 108, 7, col)
    _mes_portada_body(c, m, col, b)

def _mes_portada_body(c, m, col, b):
    RX = MR - 4
    lab(c, RX, H - 112, 'Mes %02d  ·  calendario mensual' % m, P[col][1], 6.6, 'r', cs=3)
    st(c, RX, H - 166, T(MESES[m - 1]), 'Serif', 46 if not UPPER else 38, INK, TITLE_CS * 2, 'r')
    st(c, RX, H - 198, str(YEAR), 'SerifIt', 20, P[col][1] if not DECO else ORN, 3, 'r')
    hline(c, RX - 36, RX, H - 212, P[col][1] if not DECO else ORN, 1.1)
    items = [('Hitos', b + '_H'), ('Lun – Mié', b + '_L'), ('Jue – Sáb', b + '_R')]
    pills_right(c, [(t, col, k, False) for t, k in items], H - 240)
    y = H - 258
    calw = 146
    box(c, ML, y - 118, calw, 118, P[col][0], .45)
    mini_cal(c, ML + 8, y - 4, calw - 16, m, size=5.8, link_month=False)
    panel(c, ML + calw + 10, y - 118, CW - calw - 10, 118, 'Prioridades del mes', col, 'checks', 16)
    y -= 130
    panel(c, ML, BOT, CW, y - BOT, 'Objetivos del mes', col, 'lines', 17)

def p_mes_hitos(c, kw):
    m = kw['m']; col = MONTH_COL[m - 1]; b = 'M%02d' % m
    y = header(c, 'Hitos de %s' % MESES[m - 1].lower(), 'Planifica tu mes', col, deco=False)
    pills_right(c, [(MESES[m - 1], col, b + '_P', True), ('Lun – Mié', col, b + '_L', False),
                    ('Jue – Sáb', col, b + '_R', False)], TOP - 30)
    hw = (CW - 10) / 2
    h1 = (y - BOT - 20) * .5
    alt = lambda a, z: a if col != a else z
    panel(c, ML, y - h1, hw, h1, 'Fechas importantes', col, 'checks', 16)
    panel(c, ML + hw + 10, y - h1, hw, h1, 'Evaluaciones', alt('sage', 'sky'), 'checks', 16)
    y2 = y - h1 - 10
    h2 = (y2 - BOT - 10) * .55
    panel(c, ML, y2 - h2, hw, h2, 'Reuniones y consejos', alt('lav', 'blush'), 'checks', 16)
    panel(c, ML + hw + 10, y2 - h2, hw, h2, 'Pendientes', alt('butter', 'peach'), 'checks', 16)
    y3 = y2 - h2 - 10
    panel(c, ML, BOT, CW, y3 - BOT, 'Notas', col, 'dots')

def p_mes_grid(c, kw):
    m = kw['m']; col = MONTH_COL[m - 1]; b = 'M%02d' % m; L = kw['lado'] == 'L'
    y = header(c, '%s %d' % (MESES[m - 1], YEAR), 'Calendario mensual', col, deco=False)
    pills_right(c, [(MESES[m - 1], col, b + '_P', False), ('Lun – Mié', col, b + '_L', L),
                    ('Jue – Sáb', col, b + '_R', not L)], TOP - 30)
    weeks = calendar.monthcalendar(YEAR, m)
    idx = [0, 1, 2] if L else [3, 4, 5]
    wkw = 18 if L else 0                       # columna "semana" solo en la página izquierda
    cw = (CW - wkw) / 3; head = 16
    rh = (y - BOT - head) / len(weeks)
    box(c, ML + wkw, y - head, CW - wkw, head, P[col][0])
    for j, di in enumerate(idx):
        lab(c, ML + wkw + j * cw + cw / 2, y - head / 2 - 2, DIAS[di], INK, 5.8, 'c', 1.2)
    yy = y - head
    for wk in weeks:
        first = next(dd for dd in wk if dd)
        k = week_code(dt.date(YEAR, m, first), 'L' if L else 'R')
        if L:
            box(c, ML, yy - rh + 2, wkw - 4, rh - 4, P[col][0], .7)
            c.saveState(); c.translate(ML + (wkw - 4) / 2 + 2, yy - rh / 2); c.rotate(90)
            lab(c, 0, 0, ('Sem ' + k[1:3]) if k else '—', INK, 4.8, 'c', .8); c.restoreState()
            if k: link(c, k, ML, yy - rh + 2, wkw - 4, rh - 4)
        for j, di in enumerate(idx):
            x = ML + wkw + j * cw
            dd = wk[di]
            if dd:
                rrect(c, x + 2, yy - rh + 2, cw - 4, rh - 4, None if DECO else 5)
                st(c, x + cw - 9, yy - 13, '%02d' % dd, 'SansR', 9, P[col][1], 0, 'r')
                kk = week_code(dt.date(YEAR, m, dd), 'L' if di < 3 else 'R')
                if kk: link(c, kk, x + cw - 26, yy - 17, 22, 14)
                tf(x + 5, yy - rh + 5, cw - 10, rh - 24, 7, multi=True)
            else:
                rrect(c, x + 2, yy - rh + 2, cw - 4, rh - 4, None if DECO else 5, fill=FAINT, nostroke=True)
        yy -= rh

def section_cover(c, title, kicker, quote, col, items, extra=None):
    """Mini portada de sección (siempre en página derecha)."""
    if DECO:
        deco_sun(c, MR - 70, H - 150, 95, .5)
    else:
        blob(c, MR - 30, H - 120, 140, col, .6)
        blob(c, ML + 20, 110, 70, 'blush' if col != 'blush' else 'sage', .35)
        sprig(c, MR - 4, H - 196, 1.0, 145, 'sage', .65, n=9)
        flower(c, MR - 96, H - 108, 7, col)
    lab(c, ML + 4, H - 112, kicker, P[col][1], 6.6, cs=3)
    st(c, ML + 2, H - 162, T(title), 'Serif', 44 if not UPPER else 34, INK, TITLE_CS * 2)
    st(c, ML + 4, H - 186, quote, 'SerifIt', 10.5, MUTED)
    hline(c, ML + 4, ML + 40, H - 200, P[col][1] if not DECO else ORN, 1.1)
    yy = H - 228
    for t, code in items:
        bullet(c, ML + 8, yy + 3, col)
        st(c, ML + 18, yy, t, 'Sans', 8.8); link(c, code, ML + 2, yy - 5, 240, 15)
        st(c, ML + 250, yy, str(NUM[code]), 'SansR', 7.5, MUTED, 0, 'r')
        yy -= 17
    if extra: extra(yy - 10)

def p_sec_jefatura(c, kw):
    def extra(y):
        panel(c, ML, BOT, CW, y - BOT, 'Mi curso', 'lav')
        yy = y - 36
        for t in ['Curso', 'Sala', 'Atención de apoderados', 'Correo del curso', 'Co-docente / asistente',
                  'Presidente/a de curso', 'Presidente/a de apoderados']:
            if yy < BOT + 10: break
            lab(c, ML + 12, yy, t, MUTED, 6.6, cs=.9); wline(c, ML + 165, MR - 12, yy - 2, 16); yy -= 20
    section_cover(c, 'Jefatura', 'Sección', '“Cada estudiante es un mundo.”', 'lav',
                  [('Alumnos de mi jefatura', 'J_A'), ('Cumpleaños del curso', 'J_C')], extra)

def p_jef_alumnos(c, kw):
    y = header(c, 'Alumnos de mi jefatura', 'Jefatura', 'lav', deco=False)
    lab(c, MR - 124, TOP - 30, 'Curso', MUTED, 6.8); wline(c, MR - 92, MR, TOP - 32, 12)
    cols = [('N°', .06), ('Nombre estudiante', .34), ('Contacto est.', .17), ('Nombre apoderado', .26), ('Contacto\napod.', .17)]
    n = 45
    grid_table(c, ML, y, CW, cols, n, (y - BOT - 18) / n, 'lav', 18, numbered=True, zebra=True)

def p_jef_cumple(c, kw):
    y = header(c, 'Cumpleaños del curso', 'Jefatura', 'lav')
    gw = (CW - 16) / 3; gh = (y - BOT - 30) / 4
    for i in range(12):
        r, k = i // 3, i % 3
        x = ML + k * (gw + 8); yy = y - r * (gh + 10)
        panel(c, x, yy - gh, gw, gh, MESES[i], MONTH_COL[i], 'lines', 15)

def p_sec_cursos(c, kw):
    def extra(y):
        panel(c, ML, BOT, CW, y - BOT, 'Mis cursos', 'butter')
        rh = (y - BOT - 30) / N_CURSOS
        yy = y - 30
        for k in range(1, N_CURSOS + 1):
            code = 'C%02d_S1' % k
            lab(c, ML + 12, yy - rh + 6, 'Curso %02d' % k, INK, 6.8, cs=1)
            wline(c, ML + 82, MR - 40, yy - rh + 4, rh)
            st(c, MR - 12, yy - rh + 6, str(NUM[code]), 'SansR', 6.5, MUTED, 0, 'r')
            link(c, code, MR - 36, yy - rh + 2, 26, rh - 2)
            yy -= rh
    section_cover(c, 'Cursos', 'Sección', '“Enseñar es aprender dos veces.”', 'butter',
                  [('Registro de notas', 'C01_S1'), ('Temporalización', 'C01_T1')], extra)

def course_head(c, k, kicker, col):
    lab(c, ML, TOP - 6, kicker, P[col][1], 6.8, cs=2)
    w = st(c, ML, TOP - 32, T('Curso %02d' % k), 'Serif', 22 * (.86 if UPPER else 1), INK, TITLE_CS)
    wline(c, ML + w + 8, ML + w + 120, TOP - 32, 14, 8)
    hline(c, ML, ML + 30, TOP - 42, P[col][1] if not DECO else ORN, 1.1)

def p_notas(c, kw):
    k, sem = kw['k'], kw['sem']; col = CYCLE[(k - 1) % 6]; b = 'C%02d_' % k
    course_head(c, k, 'Registro de notas', col)
    pills_right(c, [('1° sem.', col, b + 'S1', sem == 1), ('2° sem.', col, b + 'S2', sem == 2),
                    ('Temporaliz.', 'sage', b + 'T1', False)], TOP - 30)
    y = TOP - 52
    cols = [('N°', .05), ('Nombre estudiante', .37)] + [('N%d' % i, .047) for i in range(1, 11)] + [('Prom.', .11)]
    n = 45
    yb, xs = grid_table(c, ML, y, CW, cols, n, (y - BOT - 18) / n, col, 18, numbered=True, zebra=True)
    box(c, xs[-1][0] + .5, yb + .5, xs[-1][1] - 1, y - 18 - yb - 1, P[col][0], .35)

def p_temp(c, kw):
    k, sem = kw['k'], kw['sem']; col = CYCLE[(k - 1) % 6]; b = 'C%02d_' % k
    ms = list(range(2, 7)) if sem == 1 else list(range(7, 13))
    course_head(c, k, 'Temporalización', col)
    pills_right(c, [('Feb – Jun', col, b + 'T1', sem == 1), ('Jul – Dic', col, b + 'T2', sem == 2),
                    ('Notas', 'sage', b + 'S1', False)], TOP - 30)
    y = TOP - 52
    semw = .07
    cols = [('Sem', semw)] + [(MESES[m - 1], (1 - semw) / len(ms)) for m in ms]
    n = 5
    rowh = (y - BOT - 18) / n
    yb, xs = grid_table(c, ML, y, CW, cols, n, rowh, col, 18, fields=False)
    for r in range(n):
        yy = y - 18 - r * rowh
        box(c, xs[0][0] + .5, yy - rowh + .5, xs[0][1] - 1, rowh - 1, P[col][0], .5)
        st(c, xs[0][0] + xs[0][1] / 2, yy - rowh / 2 - 2.5, str(r + 1), 'SansR', 8, INK, 0, 'c')
        for xx, cw in xs[1:]:
            lab(c, xx + 4, yy - 9, 'Unidad', P[col][1], 4.6, cs=.6)
            hline(c, xx + 4, xx + cw - 4, yy - 22, LINE, .4)
            tf(xx + 3, yy - 21.5, cw - 6, 10, 6)
            lab(c, xx + 4, yy - 31, 'Contenidos', P[col][1], 4.6, cs=.6)
            q = yy - 44
            while q > yy - rowh + 6:
                hline(c, xx + 4, xx + cw - 4, q, LINE, .4, (1, 2)); q -= 12
            tf(xx + 3, yy - rowh + 4, cw - 6, rowh - 38, 6, multi=True)

def p_sec_planif(c, kw):
    def extra(y):
        panel(c, ML, BOT, CW, y - BOT, 'Semanas por mes', 'sky')
        yy = y - 34
        for m in range(3, 13):
            d1 = dt.date(YEAR, m, 1)
            sem = [s for s in range(1, N_SEMANAS + 1)
                   if (PLANIF_START + dt.timedelta(days=7 * (s - 1))).month == m]
            if not sem: continue
            lab(c, ML + 12, yy, MESES[m - 1], INK, 5.6, cs=1)
            x = ML + 82
            for s in sem:
                x += pill(c, x, yy - 4, '%02d' % s, MONTH_COL[m - 1], 'S%02d_L' % s, h=11, size=5.2) + 3
            yy -= 17
    section_cover(c, 'Planificación', 'Sección  ·  semanal', '“Planificar es traer el futuro al presente.”', 'sky',
                  [('Semana 01 (1 de marzo)', 'S01_L'), ('Semana %02d (última)' % N_SEMANAS, 'S%02d_L' % N_SEMANAS)], extra)

def p_planif(c, kw):
    s, lun, L = kw['s'], kw['lun'], kw['lado'] == 'L'
    fin = lun + dt.timedelta(days=5)
    col = MONTH_COL[lun.month - 1]
    lab(c, ML, TOP - 6, 'Planificación semanal  ·  %d %s – %d %s' % (lun.day, MESES[lun.month - 1].lower(),
                                                                      fin.day, MESES[fin.month - 1].lower()), P[col][1], 6.8, cs=2)
    w = st(c, ML, TOP - 32, T('Semana %02d' % s), 'Serif', 22 * (.86 if UPPER else 1), INK, TITLE_CS)
    flower(c, ML + w + 10, TOP - 25, 3.4, col)
    hline(c, ML, ML + 30, TOP - 42, P[col][1] if not DECO else ORN, 1.1)
    nav = []
    if s > 1: nav.append(('‹ Ant.', col, 'S%02d_L' % (s - 1), False))
    nav.append((MES_AB[lun.month - 1], col, 'M%02d_P' % lun.month, False))
    nav.append(('Lun – Mié', col, 'S%02d_L' % s, L))
    nav.append(('Jue – Sáb', col, 'S%02d_R' % s, not L))
    if s < N_SEMANAS: nav.append(('Sig. ›', col, 'S%02d_L' % (s + 1), False))
    pills_right(c, nav, TOP - 30)
    y = TOP - 52
    offs = [0, 1, 2] if L else [3, 4, 5]
    cols = [('Hora', .09), ('Blq', .06)] + [(DIAS[o], .85 / 3) for o in offs]
    head = 24
    rowh = (y - BOT - head) / N_BLOQUES
    yb, xs = grid_table(c, ML, y, CW, cols, N_BLOQUES, rowh, col, head, fields=False)
    for (xx, cw), o in zip(xs[2:], offs):
        dd = lun + dt.timedelta(days=o)
        st(c, xx + cw - 5, y - head + 3.5, dd.strftime('%d/%m'), 'SansR', 5.6, P[col][1], 0, 'r')
    for r in range(N_BLOQUES):
        yy = y - head - r * rowh
        box(c, xs[1][0] + .5, yy - rowh + .5, xs[1][1] - 1, rowh - 1, P[col][0], .5)
        st(c, xs[1][0] + xs[1][1] / 2, yy - rowh / 2 - 2.2, str(r + 1), 'SansR', 6.3, INK, 0, 'c')
        hline(c, xs[0][0] + 4, xs[0][0] + xs[0][1] - 4, yy - rowh / 2 - 1, LINE, .4, (1, 2))
        tf(xs[0][0] + 2, yy - rowh / 2 - .5, xs[0][1] - 4, 9, 5.5)
        for xx, cw in xs[2:]:
            lab(c, xx + 4, yy - 7.5, 'Obj.', P[col][1], 4.3, cs=.5)
            hline(c, xx + 20, xx + cw - 4, yy - 9, LINE, .4, (1, 2))
            tf(xx + 19, yy - 8.6, cw - 23, 8.2, 5.5)
            lab(c, xx + 4, yy - rowh / 2 - 5, 'Actividad', P[col][1], 4.3, cs=.5)
            hline(c, xx + 32, xx + cw - 4, yy - rowh / 2 - 6.5, LINE, .4, (1, 2))
            tf(xx + 3, yy - rowh + 1.5, cw - 6, rowh / 2 - 6.5, 5.5, multi=True)

def p_sec_entrev(c, kw):
    def extra(y):
        panel(c, ML, BOT, CW, y - BOT, 'Registro de entrevistas', 'peach')
        cols = [('N°', .08), ('Fecha', .17), ('Estudiante', .45), ('Pág.', .1), ('N°', .08), ('Fecha', .12)]
        yy = y - 30
        rh = 12
        per = int((yy - BOT - 6) / rh)
        n = min(per, 30)
        hw = (CW - 30) / 2
        for half in range(2):
            x0 = ML + 10 + half * (hw + 10)
            for i in range(n):
                k = half * n + i + 1
                if k > N_ENTREV: break
                ry = yy - i * rh
                st(c, x0, ry - 8, '%02d' % k, 'SansR', 6, MUTED)
                wline(c, x0 + 14, x0 + hw - 22, ry - 10, rh, 6)
                st(c, x0 + hw - 2, ry - 8, str(NUM['E%02d' % k]), 'SansR', 5.6, MUTED, 0, 'r')
                link(c, 'E%02d' % k, x0 + hw - 20, ry - 11, 20, rh)
    section_cover(c, 'Entrevistas', 'Sección  ·  apoderados', '“Educar es una tarea compartida.”', 'peach',
                  [('Entrevista N° 01', 'E01')], extra)

def p_entrev(c, kw):
    k = kw['k']; col = 'peach'
    lab(c, ML, TOP - 6, 'Registro de entrevista', P[col][1], 6.8, cs=2)
    st(c, ML, TOP - 32, T('Entrevista con apoderado'), 'Serif', 20 * (.84 if UPPER else 1), INK, TITLE_CS)
    hline(c, ML, ML + 30, TOP - 42, P[col][1] if not DECO else ORN, 1.1)
    pill(c, MR, TOP - 30, 'N° %02d' % k, col, 'E_P', 'r', solid=True)
    y = TOP - 52
    hw = (CW - 10) / 2
    panel(c, ML, y - 126, CW, 126, 'Datos de la entrevista', col)
    yy = y - 36
    for a, b2 in [('Fecha', 'Hora'), ('Curso', 'Asignatura'), ('Estudiante', 'RUT'), ('Apoderado', 'Parentesco'), ('Contacto', 'Correo')]:
        lab(c, ML + 12, yy, a, MUTED, 6.6, cs=.8); wline(c, ML + 78, ML + hw - 4, yy - 2, 16)
        lab(c, ML + hw + 12, yy, b2, MUTED, 6.6, cs=.8); wline(c, ML + hw + 78, MR - 12, yy - 2, 16)
        yy -= 18
    y -= 136
    lab(c, ML + 2, y - 7, 'Citado por', MUTED, 6.6)
    x = ML + 2 + pdfmetrics.stringWidth('CITADO POR', 'SansM', 6.6) + 1.2 * 9 + 10
    for t in ['Docente', 'Apoderado', 'Convivencia', 'Dirección', 'Otro']:
        checkbox(c, x, y - 9, 6.2); st(c, x + 9, y - 8, t, 'Sans', 8.5); x += 22 + pdfmetrics.stringWidth(t, 'Sans', 8.5)
    y -= 18
    h = (y - BOT - 82) / 2
    panel(c, ML, y - h, CW, h, 'Motivo de la entrevista', 'blush', 'lines', 16)
    y -= h + 8
    panel(c, ML, y - h, CW, h, 'Acuerdos y compromisos', 'sage', 'checks', 16)
    y -= h + 8
    panel(c, ML, BOT, hw, y - BOT, 'Firma apoderado', 'lav')
    panel(c, ML + hw + 10, BOT, hw, y - BOT, 'Firma docente', 'sky')
    hline(c, ML + 16, ML + hw - 16, BOT + 14, MUTED, .5)
    hline(c, ML + hw + 26, MR - 16, BOT + 14, MUTED, .5)

def p_sec_apuntes(c, kw):
    def extra(y):
        panel(c, ML, BOT, CW, y - BOT, 'Ideas sueltas', 'blush', 'dots')
    section_cover(c, 'Apuntes', 'Sección', '“Lo que se escribe, no se olvida.”', 'blush',
                  [('Hoja de apuntes 01', 'A01'), ('Hoja de apuntes %02d' % N_APUNTES, 'A%02d' % N_APUNTES)], extra)

def p_apuntes(c, kw):
    k = kw['k']; col = CYCLE[k % 6]
    y = header(c, 'Apuntes', 'Hoja %02d' % k, col, size=20)
    checkbox(c, ML, y - 3); st(c, ML + 10, y - 2, 'Apuntes', 'Sans', 8.5)
    checkbox(c, ML + 66, y - 3); st(c, ML + 76, y - 2, 'Reunión', 'Sans', 8.5)
    lab(c, MR - 114, y - 2, 'Fecha', MUTED, 6.8); wline(c, MR - 84, MR, y - 4, 12)
    y -= 14
    panel(c, ML, BOT, CW, y - BOT, None, col, 'lines', 17)

def p_blank(c, kw):
    pass

RENDER = {k[2:]: v for k, v in globals().items() if k.startswith('p_')}

DESC = {'cover': 'Portada (logo)', 'derechos': 'Derechos reservados', 'datos': 'Datos personales', 'blank': 'Página en blanco',
        'indice': 'Índice', 'calgen': 'Calendario general', 'minical': 'Minicalendarios e hitos', 'horario': 'Mi horario',
        'mes_portada': 'Mes: portada', 'mes_hitos': 'Mes: hitos', 'mes_grid': 'Mes: calendario',
        'sec_jefatura': 'Portada Jefatura', 'jef_alumnos': 'Alumnos de mi jefatura', 'jef_cumple': 'Cumpleaños del curso',
        'sec_cursos': 'Portada Cursos', 'notas': 'Curso: notas', 'temp': 'Curso: temporalización',
        'sec_planif': 'Portada Planificación', 'planif': 'Planificación semanal', 'sec_entrev': 'Portada Entrevistas',
        'entrev': 'Entrevista con apoderado', 'sec_apuntes': 'Portada Apuntes', 'apuntes': 'Hoja de apuntes'}

OUTLINE = {'PT': 'Portada', 'DP': 'Datos personales', 'IX': 'Índice', 'CG_1': 'Calendario general',
           'MC_1': 'Minicalendarios e hitos', 'H_L': 'Mi horario', 'M02_P': 'Calendarios mensuales',
           'J_P': 'Jefatura', 'C_P': 'Cursos', 'S_P': 'Planificación semanal', 'E_P': 'Entrevistas con apoderados',
           'A_P': 'Hojas de apuntes'}

def main(out_pdf, out_csv):
    c = canvas.Canvas(out_pdf, pagesize=(W, H))
    c.setTitle('Agenda Docente %d — Versión 3.2 (%s · %s)' % (YEAR, 'Art déco' if DECO else 'Botánica',
               {'escanear': 'para escanear', 'fisica': 'solo física', 'digital': 'solo digital'}[VARIANT]))
    c.setAuthor(AUTOR)
    F.c = c
    only = set(os.environ.get('SAMPLE', '').split(',')) - {''}
    for n, (code, kind, kw) in enumerate(PAGES, 1):
        if only and code not in only: continue
        set_side(n)
        F.code, F.n = code, 0
        c.bookmarkPage(code)
        if code in OUTLINE: c.addOutlineEntry(OUTLINE[code], code, 0)
        sec = section_of(code, kind)
        frame(c, n, code, sec)
        RENDER[kind](c, kw)
        finish(c, n, code, sec, show_num=kind != 'cover')
    c.save()
    with open(out_csv, 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f, delimiter=';'); w.writerow(['pagina', 'codigo', 'lado', 'descripcion'])
        for n, (code, kind, kw) in enumerate(PAGES, 1):
            d = DESC[kind]
            if kind.startswith('mes'): d += ' ' + MESES[kw['m'] - 1]
            if kind in ('notas', 'temp'): d += ' %02d · %d° sem.' % (kw['k'], kw['sem'])
            if kind == 'planif': d += ' %02d (%s)' % (kw['s'], 'lun–mié' if kw['lado'] == 'L' else 'jue–sáb')
            w.writerow([n, code, 'derecha' if n % 2 else 'izquierda', d])

def compress(path):
    import pikepdf
    with pikepdf.open(path, allow_overwriting_input=True) as pdf:
        enc = None
        if DIGITAL:   # bloqueado: solo se puede completar campos, anotar/dibujar e imprimir
            import secrets
            enc = pikepdf.Encryption(owner=os.environ.get('PDF_OWNER_PW') or secrets.token_urlsafe(18), user='', R=6,
                                     allow=pikepdf.Permissions(accessibility=True, extract=False, modify_annotation=True,
                                                               modify_assembly=False, modify_form=True, modify_other=False,
                                                               print_lowres=True, print_highres=True))
        pdf.save(path, compress_streams=True, object_stream_mode=pikepdf.ObjectStreamMode.generate,
                 recompress_flate=True, encryption=enc)

if __name__ == '__main__':
    name = 'Art Deco' if DECO else 'Botanica'
    vname = {'escanear': 'Escanear', 'fisica': 'Fisica', 'digital': 'Digital'}[VARIANT]
    out = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else 'Agenda Docente 2027 - v3.2 %s - %s (B5).pdf' % (name, vname)
    main(out, sys.argv[3] if len(sys.argv) > 3 else 'Agenda Docente 2027 - v3.2 Codigos.csv')
    compress(out)
