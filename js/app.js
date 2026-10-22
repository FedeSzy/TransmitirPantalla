/* Transmitir Pantalla: el celular envía su pantalla (o cámara) a la PC por WebRTC.
 * La señalización usa el servidor público de PeerJS; el video viaja directo entre dispositivos. */
(() => {
  'use strict';

  const PREFIJO_ID = 'transmitirpantalla-';
  const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O ni 1/I para evitar confusiones
  const LARGO_CODIGO = 6;
  const BITRATE_MAX = 4_000_000;
  const URL_CONTROL = 'http://127.0.0.1:8765'; // ayudante local (control/servidor.js)
  const ESPERA_CONEXION = 20000; // si no hay imagen en este tiempo, la red probablemente bloquea WebRTC
  const CLAVE_TURN = 'transmitirpantalla-turn';

  const $ = (sel) => document.querySelector(sel);
  const params = new URLSearchParams(location.search);
  const esMovil = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));

  function generarCodigo() {
    const valores = crypto.getRandomValues(new Uint32Array(LARGO_CODIGO));
    return Array.from(valores, (v) => ALFABETO[v % ALFABETO.length]).join('');
  }

  const normalizarCodigo = (texto) => texto.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const idDesdeCodigo = (codigo) => PREFIJO_ID + codigo.toLowerCase();

  /* Servidor TURN propio (opcional): se guarda en la PC y viaja al celular dentro del enlace del QR. */
  const codificar = (obj) => btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const decodificar = (texto) => JSON.parse(atob(texto.replace(/-/g, '+').replace(/_/g, '/')));

  function leerTurnGuardado() {
    try {
      return JSON.parse(localStorage.getItem(CLAVE_TURN));
    } catch {
      return null;
    }
  }

  function leerTurnDeUrl() {
    try {
      return params.get('turn') ? decodificar(params.get('turn')) : null;
    } catch {
      return null;
    }
  }

  function opcionesPeer(turn) {
    const iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
    ];
    if (turn?.urls?.length) iceServers.unshift(turn);
    return { debug: 1, config: { iceServers } };
  }

  const urlEnviar = (codigo, turn) =>
    `${location.origin}${location.pathname}?modo=enviar&codigo=${codigo}${turn ? `&turn=${codificar(turn)}` : ''}`;

  function mostrarEstado(el, texto, esError = false) {
    el.textContent = texto;
    el.classList.toggle('error', esError);
  }

  async function pedirWakeLock() {
    try {
      return await navigator.wakeLock?.request('screen');
    } catch {
      return null;
    }
  }

  function mostrarVista(nombre) {
    for (const vista of document.querySelectorAll('.vista')) {
      vista.hidden = vista.id !== `vista-${nombre}`;
    }
  }

  /* ---------- Inicio ---------- */

  function iniciarInicio() {
    mostrarVista('inicio');
    $(esMovil ? '#opcion-enviar' : '#opcion-recibir').classList.add('sugerida');
  }

  /* ---------- PC: recibir ---------- */

  function iniciarRecibir() {
    mostrarVista('recibir');
    const estado = $('#estado-recibir');
    const video = $('#video');
    const visor = $('#visor');
    const espera = $('#espera');
    const btnSonido = $('#btn-sonido');
    let peer = null;
    let llamada = null;
    let codigo = '';
    let wakeLock = null;
    let turn = leerTurnGuardado();
    let temporizadorConexion = null;
    const problemaRed = $('#problema-red-recibir');
    const control = crearControl(video, visor);

    function crearPeer() {
      codigo = generarCodigo();
      peer = new Peer(idDesdeCodigo(codigo), opcionesPeer(turn));

      peer.on('open', () => {
        $('#codigo').textContent = codigo;
        dibujarQR(urlEnviar(codigo, turn));
        mostrarEstado(estado, 'Listo. Esperando que el celular se conecte…');
      });

      peer.on('call', atenderLlamada);

      peer.on('disconnected', () => {
        // Se perdió la conexión con el servidor de señalización; la transmisión en curso sigue funcionando.
        if (!peer.destroyed) {
          mostrarEstado(estado, 'Reconectando con el servidor…');
          setTimeout(() => !peer.destroyed && peer.reconnect(), 1000);
        }
      });

      peer.on('error', (err) => {
        if (err.type === 'unavailable-id') {
          peer.destroy();
          crearPeer();
          return;
        }
        console.error(err);
        mostrarEstado(estado, `Error: ${describirError(err)}`, true);
      });
    }

    function atenderLlamada(nueva) {
      if (llamada) llamada.close();
      llamada = nueva;
      nueva.answer(); // solo recibimos, no enviamos nada
      problemaRed.hidden = true;
      mostrarEstado(estado, 'El celular se encontró. Estableciendo la conexión…');

      // El stream llega antes de que la conexión funcione: el visor se muestra recién con la primera imagen.
      nueva.on('stream', (stream) => {
        if (llamada !== nueva) return;
        video.srcObject = stream;
        video.muted = true;
        video.play().catch(() => {});
        video.addEventListener('loadeddata', () => {
          if (llamada !== nueva) return;
          clearTimeout(temporizadorConexion);
          mostrarVisor(stream, nueva.metadata || {});
        }, { once: true });
      });
      nueva.on('close', () => terminarLlamada(nueva));
      nueva.on('error', (err) => {
        console.error(err);
        terminarLlamada(nueva);
      });

      const pc = nueva.peerConnection;
      pc?.addEventListener('connectionstatechange', () => {
        if (['failed', 'closed'].includes(pc.connectionState)) terminarLlamada(nueva);
      });

      clearTimeout(temporizadorConexion);
      temporizadorConexion = setTimeout(() => {
        if (llamada === nueva && visor.hidden) terminarLlamada(nueva);
      }, ESPERA_CONEXION);
    }

    async function mostrarVisor(stream, metadata) {
      espera.hidden = true;
      visor.hidden = false;
      btnSonido.hidden = stream.getAudioTracks().length === 0;
      $('#btn-control').hidden = metadata.fuente !== 'pantalla';
      btnSonido.textContent = '🔈 Activar sonido';
      actualizarInfo(metadata);
      video.onresize = () => actualizarInfo(metadata);
      for (const pista of stream.getVideoTracks()) {
        pista.addEventListener('ended', () => terminarLlamada(llamada));
      }
      wakeLock = await pedirWakeLock();
    }

    function actualizarInfo(metadata) {
      const fuente = { pantalla: 'Pantalla', 'camara-trasera': 'Cámara trasera', 'camara-frontal': 'Cámara frontal' }[metadata.fuente] || 'Transmisión';
      const resolucion = video.videoWidth ? ` · ${video.videoWidth}×${video.videoHeight}` : '';
      $('#info-visor').textContent = `${fuente}${metadata.dispositivo ? ` desde ${metadata.dispositivo}` : ''}${resolucion}`;
    }

    function terminarLlamada(cual) {
      if (!cual || cual !== llamada) return;
      const llegoImagen = !visor.hidden;
      llamada = null;
      clearTimeout(temporizadorConexion);
      cual.close();
      video.srcObject = null;
      visor.hidden = true;
      espera.hidden = false;
      wakeLock?.release().catch(() => {});
      wakeLock = null;
      control.desactivar();
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      if (llegoImagen) {
        mostrarEstado(estado, 'La transmisión terminó. Podés volver a conectarte con el mismo código.');
      } else {
        mostrarEstado(estado, 'No se pudo recibir el video del celular.', true);
        problemaRed.hidden = false;
      }
    }

    function dibujarQR(texto) {
      const qr = qrcode(0, 'M');
      qr.addData(texto);
      qr.make();
      const img = new Image();
      img.src = qr.createDataURL(8, 0);
      img.alt = `QR para abrir ${texto}`;
      $('#qr').replaceChildren(img);
    }

    $('#btn-copiar').addEventListener('click', async (e) => {
      if (!codigo) return;
      try {
        await navigator.clipboard.writeText(urlEnviar(codigo, turn));
        e.target.textContent = '¡Copiado!';
      } catch {
        prompt('Copiá este enlace:', urlEnviar(codigo, turn));
      }
      setTimeout(() => (e.target.textContent = 'Copiar enlace'), 2000);
    });

    btnSonido.addEventListener('click', () => {
      video.muted = !video.muted;
      btnSonido.textContent = video.muted ? '🔈 Activar sonido' : '🔇 Silenciar';
    });

    $('#btn-pantalla-completa').addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else visor.requestFullscreen?.().catch(() => {});
    });

    $('#btn-cortar').addEventListener('click', () => terminarLlamada(llamada));

    // Ocultar la barra si el mouse no se mueve
    let temporizador;
    const despertarBarra = () => {
      visor.classList.remove('inactivo');
      clearTimeout(temporizador);
      temporizador = setTimeout(() => !control.activo() && visor.classList.add('inactivo'), 3000);
    };
    visor.addEventListener('mousemove', despertarBarra);
    visor.addEventListener('click', despertarBarra);
    video.addEventListener('dblclick', () => !control.activo() && $('#btn-pantalla-completa').click());

    // Si la pestaña vuelve a estar visible, recuperar el wake lock
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible' && !visor.hidden && !wakeLock) wakeLock = await pedirWakeLock();
    });

    // Opciones avanzadas: servidor TURN
    const formTurn = $('#form-turn');
    const estadoTurn = $('#estado-turn');
    if (turn) {
      $('#turn-urls').value = turn.urls.join(', ');
      $('#turn-usuario').value = turn.username || '';
      $('#turn-clave').value = turn.credential || '';
      mostrarEstado(estadoTurn, 'Usando el servidor TURN guardado.');
    }

    function aplicarTurn(nuevo) {
      turn = nuevo;
      try {
        if (turn) localStorage.setItem(CLAVE_TURN, JSON.stringify(turn));
        else localStorage.removeItem(CLAVE_TURN);
      } catch { /* sin almacenamiento: vale solo para esta sesión */ }
      // PeerJS lee esta configuración al crear cada conexión nueva
      peer.options.config = opcionesPeer(turn).config;
      if (codigo) dibujarQR(urlEnviar(codigo, turn));
    }

    formTurn.addEventListener('submit', (e) => {
      e.preventDefault();
      const urls = $('#turn-urls').value.split(',').map((u) => u.trim()).filter(Boolean);
      if (!urls.length || urls.some((u) => !/^turns?:/.test(u))) {
        mostrarEstado(estadoTurn, 'Las direcciones tienen que empezar con turn: o turns:', true);
        return;
      }
      aplicarTurn({ urls, username: $('#turn-usuario').value.trim(), credential: $('#turn-clave').value.trim() });
      mostrarEstado(estadoTurn, 'Guardado. Escaneá el QR nuevo con el celular.');
    });

    $('#btn-borrar-turn').addEventListener('click', () => {
      formTurn.reset();
      aplicarTurn(null);
      mostrarEstado(estadoTurn, 'Se borró el servidor TURN.');
    });

    window.addEventListener('beforeunload', () => peer?.destroy());
    crearPeer();
  }

  /* ---------- PC: controlar el celular (Android + ADB) ---------- */

  function crearControl(video, visor) {
    const panel = $('#panel-control');
    const ayuda = $('#ayuda-control');
    const botonera = $('#botonera');
    const estado = $('#estado-control');
    const btnControl = $('#btn-control');
    let activo = false;
    let cola = Promise.resolve();
    let inicio = null;
    let ultimaRueda = 0;
    let textoPendiente = '';
    let temporizadorTexto = null;

    async function pedir(accion, datos) {
      const opciones = datos
        ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(datos) }
        : {};
      const respuesta = await fetch(`${URL_CONTROL}/${accion}`, opciones);
      const json = await respuesta.json();
      if (!json.ok) throw new Error(json.error);
      return json;
    }

    // Los comandos se mandan en orden, uno detrás de otro
    function enviar(accion, datos) {
      cola = cola.then(() => pedir(accion, datos)).catch((err) => {
        $('#info-control').textContent = `⚠️ ${err instanceof TypeError ? 'Se perdió el ayudante (servidor.js).' : err.message}`;
      });
    }

    async function comprobar() {
      mostrarEstado(estado, 'Buscando el ayudante en esta PC…');
      try {
        const info = await pedir('estado');
        if (!info.conectado) {
          throw new Error('El ayudante está abierto pero no hay ningún celular conectado por USB (o falta aceptar la depuración).');
        }
        ayuda.hidden = true;
        botonera.hidden = false;
        $('#info-control').textContent =
          `Controlando ${info.modelo}: clic = tocar · mantener = tocar largo · arrastrar = deslizar · rueda = desplazar · clic derecho = atrás · teclado = escribir`;
        activo = true;
        visor.classList.add('controlando');
        visor.classList.remove('inactivo');
        video.focus();
      } catch (err) {
        activo = false;
        visor.classList.remove('controlando');
        ayuda.hidden = false;
        botonera.hidden = true;
        mostrarEstado(estado, err instanceof TypeError
          ? 'No se encontró el ayudante. ¿Está corriendo "node servidor.js" en esta PC?'
          : err.message, true);
      }
    }

    function desactivar() {
      activo = false;
      panel.hidden = true;
      visor.classList.remove('controlando');
      btnControl.setAttribute('aria-pressed', 'false');
    }

    /* Posición del puntero dentro de la imagen (0..1), descontando las franjas negras de object-fit: contain */
    function posicion(ev, limitar = false) {
      const ancho = video.videoWidth;
      const alto = video.videoHeight;
      if (!ancho) return null;
      const r = video.getBoundingClientRect();
      const escala = Math.min(r.width / ancho, r.height / alto);
      const w = ancho * escala;
      const h = alto * escala;
      let x = (ev.clientX - r.left - (r.width - w) / 2) / w;
      let y = (ev.clientY - r.top - (r.height - h) / 2) / h;
      if (limitar) {
        x = Math.min(1, Math.max(0, x));
        y = Math.min(1, Math.max(0, y));
      } else if (x < 0 || x > 1 || y < 0 || y > 1) {
        return null;
      }
      return { x, y, horizontal: ancho > alto };
    }

    function marcarToque(ev) {
      const contenedor = video.parentElement;
      const r = contenedor.getBoundingClientRect();
      const marca = document.createElement('div');
      marca.className = 'toque';
      marca.style.left = `${ev.clientX - r.left}px`;
      marca.style.top = `${ev.clientY - r.top}px`;
      contenedor.append(marca);
      marca.addEventListener('animationend', () => marca.remove());
    }

    video.addEventListener('pointerdown', (ev) => {
      if (!activo || ev.button !== 0) return;
      const p = posicion(ev);
      if (!p) return;
      ev.preventDefault();
      video.focus();
      video.setPointerCapture(ev.pointerId);
      inicio = { ...p, t: performance.now(), cx: ev.clientX, cy: ev.clientY };
    });

    video.addEventListener('pointerup', (ev) => {
      if (!activo || !inicio || ev.button !== 0) return;
      const a = inicio;
      inicio = null;
      const b = posicion(ev, true);
      const duracion = performance.now() - a.t;
      marcarToque(ev);
      if (Math.hypot(ev.clientX - a.cx, ev.clientY - a.cy) < 8) {
        if (duracion > 500) enviar('deslizar', { x1: a.x, y1: a.y, x2: a.x, y2: a.y, ms: duracion, horizontal: a.horizontal });
        else enviar('toque', a);
      } else {
        enviar('deslizar', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, ms: Math.min(duracion, 1500), horizontal: a.horizontal });
      }
    });

    video.addEventListener('pointercancel', () => (inicio = null));

    video.addEventListener('contextmenu', (ev) => {
      if (!activo) return;
      ev.preventDefault();
      enviar('tecla', { tecla: 'ATRAS' });
    });

    video.addEventListener('wheel', (ev) => {
      if (!activo) return;
      ev.preventDefault();
      const ahora = performance.now();
      const p = posicion(ev);
      if (!p || ahora - ultimaRueda < 300 || ev.deltaY === 0) return;
      ultimaRueda = ahora;
      const distancia = Math.sign(ev.deltaY) * 0.3;
      const y1 = Math.min(0.9, Math.max(0.1, p.y));
      const y2 = Math.min(0.95, Math.max(0.05, y1 - distancia));
      enviar('deslizar', { x1: p.x, y1, x2: p.x, y2, ms: 200, horizontal: p.horizontal });
    }, { passive: false });

    const TECLAS_ESPECIALES = {
      Backspace: 'BORRAR', Enter: 'ENTER', Tab: 'TAB',
      ArrowLeft: 'IZQUIERDA', ArrowRight: 'DERECHA', ArrowUp: 'ARRIBA', ArrowDown: 'ABAJO',
    };

    function vaciarTexto() {
      clearTimeout(temporizadorTexto);
      if (textoPendiente) enviar('texto', { texto: textoPendiente });
      textoPendiente = '';
    }

    video.addEventListener('keydown', (ev) => {
      if (!activo || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (TECLAS_ESPECIALES[ev.key]) {
        ev.preventDefault();
        vaciarTexto();
        enviar('tecla', { tecla: TECLAS_ESPECIALES[ev.key] });
      } else if (ev.key.length === 1) {
        ev.preventDefault();
        textoPendiente += ev.key;
        clearTimeout(temporizadorTexto);
        temporizadorTexto = setTimeout(vaciarTexto, 150);
      }
    });

    for (const boton of document.querySelectorAll('[data-tecla]')) {
      boton.addEventListener('click', () => {
        enviar('tecla', { tecla: boton.dataset.tecla });
        video.focus();
      });
    }

    btnControl.addEventListener('click', () => {
      if (!panel.hidden) {
        desactivar();
        return;
      }
      panel.hidden = false;
      btnControl.setAttribute('aria-pressed', 'true');
      comprobar();
    });

    $('#btn-reintentar-control').addEventListener('click', comprobar);

    return { desactivar, activo: () => activo };
  }

  /* ---------- Celular: enviar ---------- */

  function iniciarEnviar() {
    mostrarVista('enviar');
    const estado = $('#estado-enviar');
    const form = $('#form-enviar');
    const input = $('#input-codigo');
    const btnTransmitir = $('#btn-transmitir');
    const previa = $('#vista-previa');
    let peer = null;
    let llamada = null;
    let stream = null;
    let wakeLock = null;
    let timeoutConexion = null;

    if (!window.isSecureContext || !navigator.mediaDevices) {
      mostrarEstado(estado, 'Esta página tiene que abrirse con https:// para poder transmitir.', true);
      btnTransmitir.disabled = true;
    }

    const puedeCompartirPantalla = typeof navigator.mediaDevices?.getDisplayMedia === 'function';
    if (!puedeCompartirPantalla) {
      const radioPantalla = form.querySelector('input[value="pantalla"]');
      radioPantalla.disabled = true;
      form.querySelector('input[value="camara-trasera"]').checked = true;
      $('#aviso-pantalla').hidden = false;
    }

    input.value = normalizarCodigo(params.get('codigo') || '');
    input.addEventListener('input', () => {
      input.value = normalizarCodigo(input.value).slice(0, LARGO_CODIGO);
    });

    function obtenerStream(fuente) {
      if (fuente === 'pantalla') {
        return navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 30 } },
          audio: true,
        });
      }
      return navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: fuente === 'camara-trasera' ? 'environment' : 'user',
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
    }

    function nombreDispositivo() {
      const ua = navigator.userAgent;
      if (/iPhone/.test(ua)) return 'iPhone';
      if (/iPad/.test(ua)) return 'iPad';
      const android = ua.match(/Android[^;]*;\s*([^;)]+?)(?:\s+Build|\))/);
      if (android) return android[1].trim();
      if (/Android/.test(ua)) return 'Android';
      return '';
    }

    function subirCalidad(pc) {
      const aplicar = () => {
        if (pc.connectionState !== 'connected') return;
        for (const sender of pc.getSenders()) {
          if (sender.track?.kind !== 'video') continue;
          const p = sender.getParameters();
          if (!p.encodings?.length) continue;
          p.encodings[0].maxBitrate = BITRATE_MAX;
          sender.setParameters(p).catch(() => {});
        }
      };
      pc.addEventListener('connectionstatechange', aplicar);
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const codigo = normalizarCodigo(input.value);
      if (codigo.length !== LARGO_CODIGO) {
        mostrarEstado(estado, `El código tiene ${LARGO_CODIGO} caracteres.`, true);
        input.focus();
        return;
      }
      const fuente = new FormData(form).get('fuente');
      btnTransmitir.disabled = true;
      $('#problema-red-enviar').hidden = true;

      // Pedir la captura primero: el navegador exige que sea consecuencia directa del toque.
      try {
        stream = await obtenerStream(fuente);
      } catch (err) {
        btnTransmitir.disabled = false;
        const cancelado = err.name === 'NotAllowedError' || err.name === 'AbortError';
        mostrarEstado(estado, cancelado ? 'Se canceló el permiso para capturar.' : `No se pudo capturar: ${err.message}`, true);
        return;
      }

      for (const pista of stream.getVideoTracks()) {
        if ('contentHint' in pista) pista.contentHint = fuente === 'pantalla' ? 'detail' : 'motion';
        pista.addEventListener('ended', () => detener('Dejaste de compartir.'));
      }

      previa.srcObject = stream;
      form.hidden = true;
      $('#transmitiendo').hidden = false;
      mostrarEstado(estado, 'Conectando…');

      let conectado = false;
      peer = new Peer(opcionesPeer(leerTurnDeUrl()));
      peer.on('open', () => {
        llamada = peer.call(idDesdeCodigo(codigo), stream, {
          metadata: { fuente, dispositivo: nombreDispositivo() },
        });
        subirCalidad(llamada.peerConnection);
        llamada.peerConnection.addEventListener('connectionstatechange', () => {
          const s = llamada?.peerConnection.connectionState;
          if (s === 'connected') {
            conectado = true;
            clearTimeout(timeoutConexion);
            mostrarEstado(estado, '🔴 Transmitiendo a la PC.');
          } else if (s === 'failed') {
            if (conectado) detener('Se perdió la conexión con la PC.', true);
            else detener('No se pudo conectar con la PC.', true, true);
          } else if (s === 'connecting') {
            mostrarEstado(estado, 'La PC respondió. Estableciendo la conexión…');
          }
        });
        llamada.on('close', () => {
          if (conectado) detener('La PC cortó la transmisión.');
          else detener('No se pudo conectar con la PC.', true, true);
        });
        llamada.on('error', (err) => detener(`Error: ${describirError(err)}`, true));
      });
      peer.on('error', (err) => {
        if (err.type === 'peer-unavailable') {
          detener('No se encontró ese código. Fijate que la página siga abierta en la PC.', true);
        } else {
          detener(`Error: ${describirError(err)}`, true);
        }
      });

      timeoutConexion = setTimeout(() => detener('No se pudo conectar con la PC.', true, true), ESPERA_CONEXION);

      wakeLock = await pedirWakeLock();
    });

    function detener(mensaje = 'Transmisión detenida.', esError = false, problemaRed = false) {
      if (!stream && !peer) return;
      $('#problema-red-enviar').hidden = !problemaRed;
      clearTimeout(timeoutConexion);
      const l = llamada;
      llamada = null;
      l?.close();
      peer?.destroy();
      peer = null;
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      previa.srcObject = null;
      wakeLock?.release().catch(() => {});
      wakeLock = null;
      $('#transmitiendo').hidden = true;
      form.hidden = false;
      btnTransmitir.disabled = false;
      mostrarEstado(estado, mensaje, esError);
    }

    $('#btn-detener').addEventListener('click', () => detener());
    window.addEventListener('beforeunload', () => detener());
  }

  function describirError(err) {
    const mensajes = {
      'browser-incompatible': 'este navegador no soporta WebRTC.',
      network: 'no hay conexión con el servidor de señalización.',
      'server-error': 'el servidor de señalización no responde.',
      'socket-error': 'falló la conexión con el servidor.',
      'socket-closed': 'se cerró la conexión con el servidor.',
      'webrtc': 'falló la conexión directa entre los dispositivos.',
    };
    return mensajes[err?.type] || err?.message || String(err);
  }

  /* ---------- Arranque ---------- */

  if (typeof Peer === 'undefined') {
    document.body.insertAdjacentHTML('afterbegin',
      '<p class="estado error" style="text-align:center">No se pudo cargar PeerJS. Revisá la conexión a internet.</p>');
  }

  const modo = params.get('modo');
  if (modo === 'recibir') iniciarRecibir();
  else if (modo === 'enviar') iniciarEnviar();
  else iniciarInicio();
})();
