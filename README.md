# Transmitir Pantalla

Web para ver la pantalla (o la cámara) del celular en la PC, sin instalar nada.
Usa WebRTC: el video viaja directo entre los dispositivos; solo la "presentación"
inicial pasa por el servidor público gratuito de [PeerJS](https://peerjs.com/).

## Cómo se usa

1. En la **PC**, abrí la web y elegí **Ver en esta pantalla**. Aparece un código de 6 letras y un QR.
2. En el **celular**, escaneá el QR (o abrí la web, elegí **Transmitir** y escribí el código).
3. Elegí *Pantalla* o *Cámara* y tocá **Empezar a transmitir**.
4. En la PC podés poner pantalla completa (botón o doble clic) y activar el sonido si se comparte audio.

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
