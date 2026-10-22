/* Transmitir Pantalla: el celular envía su pantalla (o cámara) a la PC por WebRTC.
 * La señalización usa el servidor público de PeerJS; el video viaja directo entre dispositivos. */
(() => {
  'use strict';

  const PREFIJO_ID = 'transmitirpantalla-';
  const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O ni 1/I para evitar confusiones
  const LARGO_CODIGO = 6;
  const BITRATE_MAX = 4_000_000;

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
  const urlEnviar = (codigo) => `${location.origin}${location.pathname}?modo=enviar&codigo=${codigo}`;

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

    function crearPeer() {
      codigo = generarCodigo();
      peer = new Peer(idDesdeCodigo(codigo), { debug: 1 });

      peer.on('open', () => {
        $('#codigo').textContent = codigo;
        dibujarQR(urlEnviar(codigo));
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
      mostrarEstado(estado, 'Conectando con el celular…');

      nueva.on('stream', (stream) => {
        if (llamada !== nueva) return;
        mostrarVisor(stream, nueva.metadata || {});
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
    }

    async function mostrarVisor(stream, metadata) {
      video.srcObject = stream;
      video.muted = true;
      espera.hidden = true;
      visor.hidden = false;
      btnSonido.hidden = stream.getAudioTracks().length === 0;
      btnSonido.textContent = '🔈 Activar sonido';
      actualizarInfo(metadata);
      video.onresize = () => actualizarInfo(metadata);
      video.play().catch(() => {});
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
      llamada = null;
      cual.close();
      video.srcObject = null;
      visor.hidden = true;
      espera.hidden = false;
      wakeLock?.release().catch(() => {});
      wakeLock = null;
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      mostrarEstado(estado, 'La transmisión terminó. Podés volver a conectarte con el mismo código.');
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
        await navigator.clipboard.writeText(urlEnviar(codigo));
        e.target.textContent = '¡Copiado!';
      } catch {
        prompt('Copiá este enlace:', urlEnviar(codigo));
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
      temporizador = setTimeout(() => visor.classList.add('inactivo'), 3000);
    };
    visor.addEventListener('mousemove', despertarBarra);
    visor.addEventListener('click', despertarBarra);
    video.addEventListener('dblclick', () => $('#btn-pantalla-completa').click());

    // Si la pestaña vuelve a estar visible, recuperar el wake lock
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible' && !visor.hidden && !wakeLock) wakeLock = await pedirWakeLock();
    });

    window.addEventListener('beforeunload', () => peer?.destroy());
    crearPeer();
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

      peer = new Peer({ debug: 1 });
      peer.on('open', () => {
        llamada = peer.call(idDesdeCodigo(codigo), stream, {
          metadata: { fuente, dispositivo: nombreDispositivo() },
        });
        subirCalidad(llamada.peerConnection);
        llamada.peerConnection.addEventListener('connectionstatechange', () => {
          const s = llamada?.peerConnection.connectionState;
          if (s === 'connected') {
            clearTimeout(timeoutConexion);
            mostrarEstado(estado, '🔴 Transmitiendo a la PC.');
          } else if (s === 'failed') {
            detener('Se perdió la conexión con la PC.', true);
          }
        });
        llamada.on('close', () => detener('La PC cortó la transmisión.'));
        llamada.on('error', (err) => detener(`Error: ${describirError(err)}`, true));
      });
      peer.on('error', (err) => {
        if (err.type === 'peer-unavailable') {
          detener('No se encontró ese código. Fijate que la página siga abierta en la PC.', true);
        } else {
          detener(`Error: ${describirError(err)}`, true);
        }
      });

      timeoutConexion = setTimeout(() => {
        detener('No se pudo conectar. Probá que ambos dispositivos tengan internet, o usá la misma red Wi-Fi.', true);
      }, 30000);

      wakeLock = await pedirWakeLock();
    });

    function detener(mensaje = 'Transmisión detenida.', esError = false) {
      if (!stream && !peer) return;
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
