# -*- coding: utf-8 -*-
"""
Genera pwa/js/catalog.js a partir del CSV de códigos de la agenda
("Agenda Docente 2027 - vX Codigos.csv", separador ';': pagina;codigo;lado;descripcion).

Uso:  python generar_catalogo.py "ruta/al/Codigos.csv" ../pwa/js/catalog.js
Si se regenera la agenda (cambian páginas o códigos), basta con volver a correr este script.
"""
import csv, json, sys, os

src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), 'codigos.csv')
out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), '..', 'pwa', 'js', 'catalog.js')

pages = []
with open(src, encoding='utf-8-sig') as f:
    for row in csv.DictReader(f, delimiter=';'):
        pages.append({
            'id': row['codigo'].strip(),
            'pag': int(row['pagina']),
            'lado': 'L' if row['lado'].strip().startswith('izq') else 'R',
            'desc': row['descripcion'].strip(),
        })

js = ('// Generado automáticamente por tools/generar_catalogo.py — no editar a mano.\n'
      '// lado: L = página izquierda (anillo a la derecha), R = página derecha (anillo a la izquierda).\n'
      'export const CATALOG = ' + json.dumps(pages, ensure_ascii=False, separators=(',', ':')) + ';\n')
with open(out, 'w', encoding='utf-8') as f:
    f.write(js)
print('Catálogo:', len(pages), 'páginas ->', out)
