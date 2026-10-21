# Agenda Phygital 2027 — App de escaneo (PWA + Apps Script + Gemini)

```
Phygital PWA/
├── pwa/                      ← se publica tal cual en un hosting HTTPS
│   ├── index.html            vistas: vincular cuenta · escáner · revisión · resultado
│   ├── manifest.json         instalable (Android / iPhone / escritorio)
│   ├── service-worker.js     funciona sin conexión (cola de envíos)
│   ├── js/config.js          ← CLIENT_ID, URL del webhook, geometría de la página, rutas
│   ├── js/catalog.js         310 códigos de la agenda v3.1 (generado desde el CSV)
│   ├── js/scanner.js         detección de los 4 cuadrados + homografía + aplanado
│   ├── js/idreader.js        lectura del código rotado 90° (plantillas, sin OCR externo)
│   ├── js/pipeline.js        foto → cuadrados → código → página aplanada (JPEG)
│   ├── js/auth.js            vinculación única con Google (OAuth2, código de autorización)
│   ├── js/api.js             envío al webhook + cola sin conexión (IndexedDB)
│   ├── js/app.js             controlador de la interfaz y la cámara
│   ├── fonts/                Poppins (Botánica) y Josefin Sans (Art déco) para leer el código
│   └── icons/
├── backend/
│   ├── Código.gs             webhook: Gemini (gemini-flash-latest) → Sheets / Docs / Drive
│   └── appsscript.json       manifiesto (solo pide permiso de UrlFetch al dueño)
└── tools/generar_catalogo.py  regenera js/catalog.js si cambian los códigos
```

## Cómo funciona

1. **Vinculación (una vez):** el usuario toca *Vincular mi cuenta de Google*. Google entrega un código de autorización; `Código.gs` lo canjea por un *refresh token* y crea en **el Drive del usuario** la carpeta `Agenda Phygital 2027` con subcarpetas y la hoja `Agenda Phygital 2027 · Datos`. El teléfono solo guarda una clave de sesión. Permiso pedido: `drive.file` (la app solo ve lo que ella crea; no requiere verificación de permisos sensibles).
2. **Escáner:** la cámara analiza ~9 cuadros por segundo buscando los 4 cuadrados negros (umbral adaptativo + componentes conexas + momentos → "cuadrado macizo", sirve con la página girada o en perspectiva). Cuando están quietos ~0,6 s, captura sola (modo AUTO) a resolución completa.
3. **Aplanado y código:** con los 4 centros se calcula la homografía, se prueba la página como izquierda/derecha y derecha/al revés, y se lee el código de la esquina inferior exterior comparándolo con los 310 códigos del catálogo (misma fuente y tamaño que la imprenta). La combinación ganadora define orientación, lado e ID. Si la lectura es dudosa, la app muestra alternativas para confirmar.
4. **Backend:** recibe la página aplanada + la foto original en Base64, pide a Gemini un JSON según el tipo de página y:
   - **Sheets** (una pestaña por sección): Datos personales, Calendario general, Hitos del año, Horario, Hitos mensuales, Calendario mensual, Jefatura, Alumnos, Cumpleaños, Mis cursos, Notas, Temporalización, Planificación semanal, Registro de entrevistas, Entrevistas. Re-escanear una página **reemplaza** sus filas (columna *ID página*).
   - **Docs** (un documento por página, con historial de versiones): Apuntes (A01–A40), Entrevistas (E01–E60), otras.
   - **Drive:** `Fotos originales/` (todas, con fecha) y `Páginas escaneadas/` (la última versión aplanada de cada página).
   - Portada, derechos, índice, portadillas y páginas en blanco: solo se guarda la foto (no gasta Gemini).
   - Gemini además lee el código impreso; si la app no estaba segura y Gemini lee otro código del mismo tipo, se corrige solo.

## Puesta en marcha (≈ 30 min)

### 1. Google Cloud (una vez)
1. https://console.cloud.google.com → **Crear proyecto** (p. ej. *Agenda Phygital*).
2. **APIs y servicios → Biblioteca:** habilitar **Google Drive API** y **Google Sheets API**.
3. **Pantalla de consentimiento OAuth:** tipo *Externo*; nombre *Agenda Phygital 2027*; permisos: `openid`, `email`, `.../auth/drive.file`. Mientras pruebas, agrega tu correo en *Usuarios de prueba*; para venderla, pulsa **Publicar app**.
4. **Credenciales → Crear ID de cliente OAuth → Aplicación web.**
   *Orígenes de JavaScript autorizados:* la URL donde publicarás la PWA (p. ej. `https://tuusuario.github.io`). No hace falta URI de redirección.
   Copia el **ID de cliente** y el **secreto**.

### 2. Clave de Gemini
https://aistudio.google.com → *Get API key* → crear clave.

### 3. Apps Script (backend)
1. https://script.new → renombrar a *Agenda Phygital – Backend*.
2. Pegar `backend/Código.gs`. En **Configuración del proyecto** marcar *Mostrar el archivo de manifiesto* y pegar `backend/appsscript.json`.
3. **Configuración del proyecto → Propiedades del script:** `GEMINI_API_KEY`, `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`.
4. Ejecutar `verificarConfiguracion` (autoriza el permiso de conexiones externas y prueba Gemini).
5. **Implementar → Nueva implementación → Aplicación web:** *Ejecutar como:* **Yo** · *Quién tiene acceso:* **Cualquier usuario**. Copiar la URL que termina en `/exec`.
   Cada vez que cambies el código: *Implementar → Administrar implementaciones → Editar → Nueva versión* (así la URL no cambia).

### 4. PWA
1. En `pwa/js/config.js` pegar `GOOGLE_CLIENT_ID` y `WEBHOOK_URL`.
2. Publicar la carpeta `pwa/` en HTTPS (la cámara y la instalación lo exigen): GitHub Pages, Netlify (arrastrar la carpeta) o Firebase Hosting.
3. Instalar: **Android/Chrome** → menú ⋮ → *Instalar app*. **iPhone/Safari** → Compartir → *Agregar a pantalla de inicio*.

## Si cambias la agenda
- **Códigos o páginas:** `python tools/generar_catalogo.py "Agenda Docente 2027 - vX Codigos.csv" pwa/js/catalog.js` y sube la versión nueva de `VERSION` en `service-worker.js`.
- **Tamaño o posición de los cuadrados / del código:** solo `PAGE` en `pwa/js/config.js`. Desde la v3.2 los cuadrados miden **4 × 4 mm** con 2 mm de papel limpio alrededor, a 22 pt del borde exterior, 46 pt del anillo y 22 pt arriba/abajo; el código va en 9 pt negrita. Las versiones "Física" y "Digital" de la agenda no tienen cuadrados ni código (no se escanean).
- **Nuevos tipos de página:** agregar la regla en `ROUTES` de `config.js` (etiqueta en la app) y en `ROUTES` de `Código.gs` (prompt, columnas y filas).

## Límites a tener en cuenta
El web app corre con las cuotas del dueño del script: ~20 000 llamadas UrlFetch/día con cuenta Gmail (≈ 1 500 escaneos/día; 100 000 con Workspace) y 30 ejecuciones simultáneas. Las sesiones se guardan en Propiedades del script (≈ 1 000+ usuarios). Para una venta masiva, el mismo diseño se puede mover a Cloud Run/Firebase Functions sin tocar la PWA.
