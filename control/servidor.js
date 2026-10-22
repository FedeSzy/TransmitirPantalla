#!/usr/bin/env node
/* Ayudante de control remoto para Transmitir Pantalla.
 * Corre en la PC, escucha solo en 127.0.0.1 y traduce los clics de la web en toques del celular vía ADB.
 * Requisitos: Node.js 18+ y ADB (Android Platform Tools) con la depuración USB activada en el celular.
 * Uso: node servidor.js            (variables opcionales: PUERTO, ADB, ADB_SERIAL, ORIGENES) */
'use strict';

const http = require('http');
const { execFile } = require('child_process');

const PUERTO = Number(process.env.PUERTO) || 8765;
const ADB = process.env.ADB || 'adb';
const ORIGENES = [
  'https://fedeszy.github.io',
  ...(process.env.ORIGENES || '').split(',').map((o) => o.trim()).filter(Boolean),
];
const HOSTS_VALIDOS = new Set([`127.0.0.1:${PUERTO}`, `localhost:${PUERTO}`]);
const TECLAS = {
  ATRAS: 4, INICIO: 3, RECIENTES: 187, ENCENDIDO: 26, VOL_MAS: 24, VOL_MENOS: 25,
  BORRAR: 67, ENTER: 66, TAB: 61, ESCAPE: 111, IZQUIERDA: 21, DERECHA: 22, ARRIBA: 19, ABAJO: 20,
};

let serial = process.env.ADB_SERIAL || '';
let tamano = null; // { ancho, alto } en orientación natural

function adb(args) {
  const completos = (serial ? ['-s', serial, ...args] : args).map(String);
  return new Promise((resolve, reject) => {
    execFile(ADB, completos, { timeout: 10000 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim()));
      else resolve(stdout);
    });
  });
}

function origenPermitido(origen) {
  if (!origen) return false;
  if (ORIGENES.includes(origen)) return true;
  try {
    const url = new URL(origen);
    return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

async function buscarDispositivo() {
  const salida = await new Promise((resolve, reject) => {
    execFile(ADB, ['devices'], { timeout: 10000 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
  const dispositivos = salida.split('\n').slice(1)
    .map((l) => l.trim().split(/\s+/))
    .filter(([id, estado]) => id && estado === 'device')
    .map(([id]) => id);
  if (!dispositivos.includes(serial)) {
    serial = process.env.ADB_SERIAL && dispositivos.includes(process.env.ADB_SERIAL)
      ? process.env.ADB_SERIAL : dispositivos[0] || '';
    tamano = null;
  }
  return dispositivos;
}

async function obtenerTamano() {
  if (tamano) return tamano;
  const salida = await adb(['shell', 'wm', 'size']);
  // Si hay "Override size" tiene prioridad sobre "Physical size"
  const medidas = [...salida.matchAll(/(\d+)x(\d+)/g)];
  const [, ancho, alto] = medidas[medidas.length - 1] || [];
  if (!ancho) throw new Error('No se pudo leer la resolución del celular.');
  tamano = { ancho: Number(ancho), alto: Number(alto) };
  return tamano;
}

/* Convierte coordenadas normalizadas (0..1) en píxeles, según la orientación que se ve en el video. */
async function aPixeles(x, y, horizontal) {
  let { ancho, alto } = await obtenerTamano();
  if (Boolean(horizontal) !== ancho > alto) [ancho, alto] = [alto, ancho];
  const limitar = (v) => Math.min(1, Math.max(0, Number(v) || 0));
  return [Math.round(limitar(x) * (ancho - 1)), Math.round(limitar(y) * (alto - 1))];
}

function escaparTexto(texto) {
  // `input text` no acepta espacios (se usa %s) y el shell de Android interpreta símbolos
  return String(texto).replace(/[^\x20-\x7e]/g, '').replace(/([\\'"`$&|;<>()*?!#~[\]{}])/g, '\\$1').replace(/ /g, '%s');
}

const acciones = {
  async estado() {
    const dispositivos = await buscarDispositivo();
    if (!serial) return { ok: true, conectado: false, dispositivos };
    const modelo = (await adb(['shell', 'getprop', 'ro.product.model'])).trim();
    return { ok: true, conectado: true, serial, modelo, dispositivos, pantalla: await obtenerTamano() };
  },
  async toque({ x, y, horizontal }) {
    const [px, py] = await aPixeles(x, y, horizontal);
    await adb(['shell', 'input', 'tap', px, py]);
  },
  async deslizar({ x1, y1, x2, y2, ms, horizontal }) {
    const [ax, ay] = await aPixeles(x1, y1, horizontal);
    const [bx, by] = await aPixeles(x2, y2, horizontal);
    const duracion = Math.min(3000, Math.max(30, Math.round(Number(ms) || 200)));
    await adb(['shell', 'input', 'swipe', ax, ay, bx, by, duracion]);
  },
  async tecla({ tecla }) {
    if (!(tecla in TECLAS)) throw new Error(`Tecla desconocida: ${tecla}`);
    await adb(['shell', 'input', 'keyevent', TECLAS[tecla]]);
  },
  async texto({ texto }) {
    const escapado = escaparTexto(texto);
    if (escapado) await adb(['shell', 'input', 'text', escapado]);
  },
};

const servidor = http.createServer((req, res) => {
  const origen = req.headers.origin;
  // Evita que otras webs (o un ataque de DNS rebinding) controlen el celular
  if (!HOSTS_VALIDOS.has(req.headers.host) || (origen && !origenPermitido(origen))) {
    res.writeHead(403).end();
    return;
  }
  if (origen) {
    res.setHeader('Access-Control-Allow-Origin', origen);
    res.setHeader('Vary', 'Origin');
  }

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.headers['access-control-request-private-network']) {
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
    res.writeHead(204).end();
    return;
  }

  const nombre = req.url.replace(/^\/+/, '').split('?')[0];
  const accion = Object.hasOwn(acciones, nombre) && acciones[nombre];
  if (!accion || (nombre !== 'estado' && req.method !== 'POST')) {
    res.writeHead(404).end();
    return;
  }
  if (nombre !== 'estado' && !origen) {
    res.writeHead(403).end(); // las acciones solo llegan desde la web
    return;
  }

  let cuerpo = '';
  req.on('data', (parte) => {
    cuerpo += parte;
    if (cuerpo.length > 10000) req.destroy();
  });
  req.on('end', async () => {
    try {
      const datos = cuerpo ? JSON.parse(cuerpo) : {};
      if (nombre !== 'estado') {
        await buscarDispositivo();
        if (!serial) throw new Error('No hay ningún celular conectado por ADB.');
      }
      const resultado = (await accion(datos)) || { ok: true };
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(resultado));
    } catch (err) {
      const sinAdb = err.code === 'ENOENT';
      res.writeHead(sinAdb ? 503 : 500, { 'Content-Type': 'application/json' }).end(JSON.stringify({
        ok: false,
        error: sinAdb ? 'No se encontró ADB. Instalá Android Platform Tools o indicá la ruta con la variable ADB.' : err.message,
      }));
    }
  });
});

servidor.listen(PUERTO, '127.0.0.1', async () => {
  console.log(`Control remoto escuchando en http://127.0.0.1:${PUERTO}`);
  console.log(`Webs permitidas: ${ORIGENES.join(', ')} y localhost`);
  try {
    const dispositivos = await buscarDispositivo();
    console.log(serial
      ? `Celular conectado: ${serial}${dispositivos.length > 1 ? ` (hay ${dispositivos.length}; elegí otro con ADB_SERIAL)` : ''}`
      : 'Todavía no hay ningún celular conectado. Conectalo por USB y aceptá la depuración USB.');
  } catch (err) {
    console.log(err.code === 'ENOENT'
      ? 'ATENCIÓN: no se encontró ADB. Instalá Android Platform Tools: https://developer.android.com/tools/releases/platform-tools'
      : `No se pudo consultar ADB: ${err.message}`);
  }
  console.log('Dejá esta ventana abierta mientras uses el control. Ctrl+C para salir.');
});
