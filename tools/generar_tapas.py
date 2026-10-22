# -*- coding: utf-8 -*-
"""
Tapa y contratapa de la Agenda Docente 2027 (v3.3), formato B5 + 3 mm de sangrado.
  python generar_tapas.py botanico|artdeco [salida.pdf]
Genera 2 páginas: tapa y contratapa (el QR de la app va en el interior de la contratapa, dentro de la agenda).
"""
import sys, os, importlib.util
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.graphics import renderPDF

STYLE = (sys.argv[1] if len(sys.argv) > 1 else 'botanico').lower()
OUT = sys.argv[2] if len(sys.argv) > 2 else 'Agenda Docente 2027 - v3.3 %s - Tapas (B5).pdf' % ('Art Deco' if STYLE == 'artdeco' else 'Botanica')
HERE = os.path.dirname(os.path.abspath(__file__))
sys.argv = [sys.argv[0], STYLE]
os.environ['VARIANT'] = 'digital'                     # fondos de color
spec = importlib.util.spec_from_file_location('ag', os.path.join(HERE, 'generar_agenda_v33.py'))
ag = importlib.util.module_from_spec(spec); spec.loader.exec_module(ag)

W, H = ag.W, ag.H
BLEED = 3 * ag.MM
APP_URL = 'https://frederickyoungy.github.io/Phygital-Agenda/'
c = canvas.Canvas(OUT, pagesize=(W + 2 * BLEED, H + 2 * BLEED))
c.setTitle('Agenda Docente %d — Tapas (%s)' % (ag.YEAR, 'Art déco' if ag.DECO else 'Botánica'))
c.setAuthor(ag.AUTOR)
NAVY, GOLD, CREAM = HexColor('#1D2440'), HexColor('#B8963E'), HexColor('#F6F1E4')

def page(bg):
    c.saveState(); c.setFillColor(bg); c.rect(0, 0, W + 2 * BLEED, H + 2 * BLEED, stroke=0, fill=1); c.restoreState()
    c.translate(BLEED, BLEED)        # desde aquí, coordenadas de la página terminada

def qr(x, y, size, fg, bg):
    w = QrCodeWidget(APP_URL, barLevel='M'); b = w.getBounds()
    d = Drawing(size, size, transform=[size / (b[2] - b[0]), 0, 0, size / (b[3] - b[1]), 0, 0])
    w.barFillColor = fg; d.add(w)
    c.saveState(); c.setFillColor(bg); c.roundRect(x - 6, y - 6, size + 12, size + 12, 4, stroke=0, fill=1); c.restoreState()
    renderPDF.draw(d, c, x, y)

def credits(cx, y, ink, muted, serif_size=13):
    ag.st(c, cx, y, ag.T('Agenda Docente %d' % ag.YEAR), 'Serif', serif_size, ink, ag.TITLE_CS, 'c')
    yy = y - 22
    for t in ['© %d %s' % (ag.ANIO_IMPRESION, ag.AUTOR), 'Año de impresión: %d' % ag.ANIO_IMPRESION,
              'Todos los derechos reservados.', 'Prohibida su reproducción total o parcial sin autorización del autor.']:
        ag.st(c, cx, yy, t, 'Sans', 8.5, muted, 0, 'c'); yy -= 13.5
    return yy

def scan_block(cx, y, ink, muted, fg, bg):
    s = 74
    qr(cx - s / 2, y - s, s, fg, bg)
    ag.st(c, cx, y - s - 24, 'Digitaliza tus páginas', 'Serif', 12, ink, 0, 'c')
    ag.st(c, cx, y - s - 38, 'Escanea este código, vincula tu cuenta de Google y fotografía', 'Sans', 7.6, muted, 0, 'c')
    ag.st(c, cx, y - s - 49, 'cualquier página: llega ordenada a tu propio Google Drive.', 'Sans', 7.6, muted, 0, 'c')

cx = W / 2
if not ag.DECO:
    # ---------------------------------------------------------------- BOTÁNICA
    BG = HexColor('#FBF8F2'); INK = ag.INK; MUT = ag.MUTED; ROSE = ag.P['blush'][1]
    # tapa
    page(BG)
    ag.blob(c, W - 40, H - 70, 210, 'blush', .55)
    ag.blob(c, 40, 120, 150, 'sage', .5)
    ag.blob(c, W - 90, 150, 46, 'lav', .55)
    ag.blob(c, 70, H - 150, 30, 'butter', .7)
    ag.sprig(c, W - 30, H - 250, 1.6, 150, 'sage', .75, n=11)
    ag.sprig(c, 30, 250, 1.4, -35, 'sage', .7, n=10)
    ag.flower(c, W - 150, H - 120, 11, 'blush'); ag.flower(c, W - 112, H - 160, 7.5, 'lav'); ag.flower(c, 120, 205, 8, 'peach')
    y0 = H * .52
    ag.lab(c, cx, y0 + 92, 'Planificador del año escolar', ROSE, 8.5, 'c', cs=4)
    ag.st(c, cx, y0 + 30, 'Agenda', 'Serif', 62, INK, 0, 'c')
    ag.st(c, cx, y0 - 34, 'Docente', 'SerifIt', 62, ROSE, 0, 'c')
    ag.hline(c, cx - 30, cx + 30, y0 - 62, ROSE, 1.2)
    ag.st(c, cx, y0 - 96, str(ag.YEAR), 'Serif', 26, INK, 10, 'c')
    c.showPage()
    # contratapa con QR / sin QR
    page(BG)
    ag.blob(c, 30, H - 40, 190, 'sage', .45); ag.blob(c, W - 10, H * .45, 120, 'blush', .4)
    ag.blob(c, W - 80, H - 120, 34, 'butter', .7)
    ag.sprig(c, 40, H - 190, 1.4, 25, 'sage', .7, n=10); ag.flower(c, W - 70, H * .45 + 40, 9, 'blush')
    ag.flower(c, 150, H - 90, 6, 'lav')
    credits(cx, 118, INK, MUT)
    c.showPage()
else:
    # ---------------------------------------------------------------- ART DÉCO
    def frame_deco(col):
        c.saveState(); c.setStrokeColor(col)
        c.setLineWidth(1.4); c.rect(22, 22, W - 44, H - 44, stroke=1, fill=0)
        c.setLineWidth(.6); c.rect(30, 30, W - 60, H - 60, stroke=1, fill=0)
        for x, y, sx, sy in [(30, 30, 1, 1), (W - 30, 30, -1, 1), (W - 30, H - 30, -1, -1), (30, H - 30, 1, -1)]:
            for k in (14, 24, 34):
                c.line(x, y + sy * k, x + sx * k, y)
            c.saveState(); c.translate(x + sx * 46, y + sy * 46); c.rotate(45)
            c.rect(-3, -3, 6, 6, stroke=1, fill=0); c.restoreState()
        c.restoreState()
    # tapa
    page(NAVY)
    frame_deco(GOLD)
    c.saveState(); ag.ORN = GOLD; ag.deco_sun(c, cx, H * .70, 150, .9); c.restoreState()
    y0 = H * .50
    c.saveState(); c.setFillColor(NAVY); c.rect(cx - 170, y0 - 78, 340, 150, stroke=0, fill=1); c.restoreState()
    c.saveState(); c.setStrokeColor(GOLD); c.setLineWidth(.8)
    c.rect(cx - 160, y0 - 70, 320, 134, stroke=1, fill=0); c.rect(cx - 154, y0 - 64, 308, 122, stroke=1, fill=0); c.restoreState()
    ag.st(c, cx, y0 + 30, 'AGENDA', 'Serif', 40, CREAM, 8, 'c')
    ag.st(c, cx, y0 - 10, 'DOCENTE', 'Serif', 40, CREAM, 8, 'c')
    ag.hline(c, cx - 60, cx + 60, y0 - 28, GOLD, 1)
    ag.st(c, cx, y0 - 52, str(ag.YEAR), 'Serif', 22, GOLD, 10, 'c')
    c.showPage()
    page(NAVY)
    frame_deco(GOLD)
    c.saveState(); ag.ORN = GOLD; ag.deco_fan(c, cx, H * .60, 60, 0, .9); c.restoreState()
    credits(cx, 128, CREAM, HexColor('#D8D1B8'))
    c.showPage()
c.save()
print('ok', OUT)
