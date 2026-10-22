# Transmitir Pantalla

Web para ver la pantalla (o la cámara) del celular en la PC, sin instalar nada.
Usa WebRTC: el video viaja directo entre los dispositivos; solo la "presentación"
inicial pasa por el servidor público gratuito de [PeerJS](https://peerjs.com/).

## Cómo se usa

1. En la **PC**, abrí la web y elegí **Ver en esta pantalla**. Aparece un código de 6 letras y un QR.
2. En el **celular**, escaneá el QR (o abrí la web, elegí **Transmitir** y escribí el código).
3. Elegí *Pantalla* o *Cámara* y tocá **Empezar a transmitir**.
4. En la PC podés poner pantalla completa (botón o doble clic) y activar el sonido si se comparte audio.

## Controlar el celular desde la PC (Android)

Una página web no puede tocar el celular por sí sola (el navegador lo impide), así que el control
usa un pequeño ayudante que corre en la PC y manda los toques por **ADB**:

1. En el celular: *Ajustes → Acerca del teléfono →* tocá 7 veces *Número de compilación*, y después
   activá *Opciones de desarrollador → Depuración USB*.
2. En la PC instalá [Android Platform Tools (ADB)](https://developer.android.com/tools/releases/platform-tools)
   y [Node.js](https://nodejs.org/).
3. Conectá el celular por USB y aceptá el aviso de depuración.
4. Descargá [`control/servidor.js`](control/servidor.js) y ejecutá `node servidor.js` (dejá la ventana abierta).
5. Con la pantalla transmitiéndose, tocá **🖱️ Controlar** en la PC.

| En la PC | En el celular |
|---|---|
| Clic | Tocar |
| Mantener apretado | Toque largo |
| Arrastrar | Deslizar |
| Rueda del mouse | Desplazar |
| Clic derecho | Atrás |
| Teclado | Escribir (Enter, Borrar y flechas incluidos) |

También hay botones de Atrás, Inicio, Recientes, volumen y bloqueo. Con *Depuración inalámbrica*
(Android 11+, `adb pair` / `adb connect`) funciona sin cable.

El ayudante escucha solo en `127.0.0.1:8765` y solo acepta órdenes de esta web y de `localhost`.
Si publicás la web en otro dominio, agregalo con `ORIGENES=https://tu-dominio node servidor.js`.
Otras variables: `PUERTO`, `ADB` (ruta a adb) y `ADB_SERIAL` (si hay varios celulares).

En iPhone no es posible controlar el teléfono desde la PC.

## Redes de colegios o empresas

Muchas de esas redes no dejan que dos dispositivos se conecten entre sí, y la transmisión no arranca.
La web lo detecta a los 20 segundos y muestra qué hacer:

1. **Lo más fácil:** activá la *Zona Wi-Fi / Hotspot* del celular y conectá la PC a esa red.
   El video viaja por esa red local, así que casi no gasta datos.
2. **Servidor TURN:** en la PC, *Opciones avanzadas*, cargá un servidor TURN que use el puerto 443
   (hay planes gratis en [Metered](https://www.metered.ca/stun-turn) o [ExpressTURN](https://www.expressturn.com/)).
   Se guarda en la PC y viaja al celular dentro del QR.

## Compatibilidad

| Dispositivo | Pantalla | Cámara |
|---|---|---|
| Android con Chrome reciente | Depende del celular y de la versión de Chrome | ✅ |
| iPhone / iPad (Safari) | ❌ Apple no lo permite desde una web | ✅ |
| PC (para recibir) | Chrome, Edge, Firefox, Safari | — |

Compartir la pantalla desde el navegador del celular (`getDisplayMedia`) **no está disponible en todos
los celulares**. La web lo detecta y, si no se puede, ofrece transmitir la cámara. Alternativas:

- **Android:** [scrcpy](https://github.com/Genymobile/scrcpy) (gratis, por USB o Wi-Fi).
- **iPhone:** *Duplicar pantalla* (AirPlay) hacia una Mac o receptor compatible.

## Publicarla

Los navegadores solo permiten capturar pantalla/cámara en páginas **https**, así que hay que publicarla:

- **GitHub Pages (incluido):** en el repo, *Settings → Pages → Source: GitHub Actions*.
  Cada push a `main` publica el sitio con `.github/workflows/pages.yml`.
- O cualquier hosting estático con https (Netlify, Vercel, Cloudflare Pages…).

## Probar en local

```bash
npx http-server -p 8080
```

Abrí `http://localhost:8080` en la PC. Para probar desde el celular necesitás https
(por ejemplo con un túnel como `cloudflared tunnel --url http://localhost:8080`).

## Archivos

- `index.html` – las tres vistas (inicio, recibir, transmitir).
- `css/estilos.css` – estilos.
- `js/app.js` – lógica WebRTC/PeerJS, QR y controles.
- `control/servidor.js` – ayudante para controlar el celular por ADB (Node.js, sin dependencias).
