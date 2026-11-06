// Summit Descent LAN server: serves dist/, the phone pad, a QR code and the WebSocket room.
// Usage: node server/index.js [--open]   (PORT env overrides 5190, LAN_IP the address the QR points to,
// DIST the folder it serves instead of dist/)
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import QRCode from 'qrcode';
import { createRoom, validId } from './room.js';

export const DEFAULT_PORT = 5190;
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.map': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif',
  '.ktx2': 'image/ktx2', '.hdr': 'application/octet-stream', '.exr': 'application/octet-stream',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

// The address a phone on the same Wi-Fi can reach: the first non-internal IPv4, Wi-Fi/Ethernet (en*, eth*, wlan*,
// Windows "Wi-Fi"/"Ethernet") before anything else, and VPN tunnels last: NordVPN (NordLynx is a utun on macOS,
// `nordlynx` on Linux, a "NordLynx"/"TAP-NordVPN" adapter on Windows), WireGuard, Tailscale, ZeroTier, OpenVPN
// tun/tap, plus bridges and VM networks. Among equals a private LAN range (192.168/16, 10/8, 172.16/12) beats a
// carrier-grade one (100.64/10: Tailscale, NordVPN Meshnet); a self-assigned 169.254 address never wins.
// LAN_IP env forces a specific address.
const VPN_RE = /^(utun|tun|tap|ipsec|ppp|gif|stf|wg|nord|tailscale|zt|bridge|vmnet|vboxnet|vnic|docker|veth|virbr|awdl|llw|anpi)|vpn|wireguard|nordlynx|tap-|virtual|vethernet|hyper-v|loopback/i;
const LAN_RE = /^(en|eth|wlan|wl|wifi|wi-fi|ethernet)/i;
function rankAddress({ name, address }) {
  const iface = LAN_RE.test(name) && !VPN_RE.test(name) ? 0 : VPN_RE.test(name) ? 20 : 10;
  const [a, b] = address.split('.').map(Number);
  const range = a === 192 && b === 168 ? 0 : a === 10 ? 1 : a === 172 && b >= 16 && b <= 31 ? 1
    : a === 100 && b >= 64 && b <= 127 ? 4 : a === 169 && b === 254 ? 100 : 2;
  return iface + range;
}
// Every candidate, best first: [{ name, address }].
export function lanAddresses(ifaces = networkInterfaces()) {
  const found = [];
  for (const [name, list] of Object.entries(ifaces)) {
    for (const a of list || []) {
      if ((a.family === 'IPv4' || a.family === 4) && !a.internal) found.push({ name, address: a.address });
    }
  }
  return found.sort((a, b) => rankAddress(a) - rankAddress(b));
}
export function lanAddress(ifaces = networkInterfaces(), env = process.env) {
  if (env.LAN_IP) return env.LAN_IP;
  return lanAddresses(ifaces)[0]?.address || null;
}
// Is this address (from lanAddresses) on a VPN tunnel rather than the Wi-Fi? The console warns about it.
export const viaVpn = (ifaces, address) => lanAddresses(ifaces).some((f) => f.address === address && VPN_RE.test(f.name));

export function createServer({
  port = DEFAULT_PORT, host = '0.0.0.0', distDir = join(ROOT, 'dist'),
  reserveMs = 60000, pingMs = 5000, padSilentMs = 4000, log = () => {},
} = {}) {
  const dist = resolve(distDir);
  const room = createRoom({ reserveMs, log });
  let boundPort = port;

  const urls = () => {
    const ip = lanAddress() || '127.0.0.1';
    const lanUrl = `http://${ip}:${boundPort}/`;
    return { lanUrl, padUrl: `${lanUrl}pad`, localUrl: `http://localhost:${boundPort}/` };
  };

  async function sendFile(res, file, head) {
    try {
      const st = await stat(file);
      if (st.isDirectory()) return sendFile(res, join(file, 'index.html'), head);
      const body = head ? null : await readFile(file);
      res.writeHead(200, {
        'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': st.size,
        'Cache-Control': 'no-cache',
      });
      res.end(body);
    } catch {
      notFound(res, file);
    }
  }

  function notFound(res, file) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    const hint = file && /(index|pad)\.html$/.test(file) && !existsSync(dist) ? ' (dist/ is missing: run npm run build)' : '';
    res.end(`not found${hint}`);
  }

  const json = (res, code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  };

  async function onRequest(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      return res.end();
    }
    let url;
    try { url = new URL(req.url, 'http://x'); } catch { res.writeHead(400); return res.end(); }
    const path = url.pathname;
    const head = req.method === 'HEAD';

    if (path === '/api/info') {
      const { lanUrl, padUrl } = urls();
      return json(res, 200, { lanUrl, padUrl, ...room.status() });
    }
    if (path === '/qr.svg') {
      const u = url.searchParams.get('u') || urls().padUrl;
      if (u.length > 1024) return json(res, 400, { error: 'url too long' });
      try {
        const svg = await QRCode.toString(u, {
          type: 'svg', margin: 1, errorCorrectionLevel: 'M',
          color: { dark: url.searchParams.get('dark') === 'light' ? '#ffffffff' : '#0a1420ff', light: '#00000000' },
        });
        res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
        return res.end(head ? null : svg);
      } catch {
        return json(res, 400, { error: 'cannot encode' });
      }
    }
    if (path === '/' || path === '/index.html') return sendFile(res, join(dist, 'index.html'), head);
    // The pages declare an inline drop icon; a browser that still asks for /favicon.ico gets "no icon", not a 404.
    if (path === '/favicon.ico' && !existsSync(join(dist, 'favicon.ico'))) { res.writeHead(204); return res.end(); }
    if (path === '/pad') return sendFile(res, join(dist, 'pad.html'), head);
    // pad.html loads pad.js relatively: under /pad/ it would resolve to /pad/pad.js.
    if (path === '/pad/') { res.writeHead(302, { Location: '/pad' + url.search }); return res.end(); }

    let rel;
    try { rel = decodeURIComponent(path); } catch { return notFound(res); }
    if (rel.includes('\0')) return notFound(res);
    const file = resolve(dist, '.' + normalize('/' + rel));
    if (file !== dist && !file.startsWith(dist + sep)) return notFound(res);
    return sendFile(res, file, head);
  }

  const server = http.createServer((req, res) => {
    onRequest(req, res).catch((e) => {
      log(`request error: ${e.message}`);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 8192 });
  server.on('upgrade', (req, socket, headBuf) => {
    let url;
    try { url = new URL(req.url, 'http://x'); } catch { return socket.destroy(); }
    const role = url.searchParams.get('role');
    if (url.pathname !== '/ws' || (role !== 'host' && role !== 'pad')) {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, headBuf, (ws) => {
      ws._alive = true;
      ws._rx = Date.now();
      ws.on('pong', () => { ws._alive = true; });
      ws.on('error', () => {});
      ws.on('message', (raw) => { ws._rx = Date.now(); room.message(ws, raw); });
      if (role === 'host') {
        room.addHost(ws);
        ws.on('close', () => room.removeHost(ws));
      } else {
        const given = url.searchParams.get('id');
        room.addPad(ws, validId(given) ? given : randomUUID());
        ws.on('close', () => room.removePad(ws));
      }
    });
  });

  // Phones that sleep do not close their socket: ping and drop the silent ones.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws._alive) { ws.terminate(); continue; }
      ws._alive = false;
      try { ws.ping(); } catch {}
    }
  }, pingMs);
  heartbeat.unref();
  // The pad page talks all the time (inputs at 30 Hz, a ping every second): one silent for padSilentMs walked out of
  // the Wi-Fi or was locked. Dropping it now, not after two missed pings, lets the TV say "waiting for" in seconds;
  // its slot stays reserved for the same phone. Only pads that sent a ping are held to it: a client that never
  // speaks that keep-alive (a scripted test pad, an older page) is left to the heartbeat above.
  const liveness = setInterval(() => {
    const now = Date.now();
    for (const ws of wss.clients) if (ws._role === 'pad' && ws._pings && now - ws._rx > padSilentMs) ws.terminate();
  }, Math.max(100, Math.min(1000, padSilentMs / 4)));
  liveness.unref();

  return {
    room,
    get port() { return boundPort; },
    urls,
    listen() {
      return new Promise((ok, fail) => {
        const onErr = (e) => { server.off('listening', onOk); fail(e); };
        const onOk = () => {
          server.off('error', onErr);
          boundPort = server.address().port;
          ok(urls());
        };
        server.once('error', onErr);
        server.once('listening', onOk);
        server.listen(port, host);
      });
    },
    close() {
      clearInterval(heartbeat);
      clearInterval(liveness);
      room.close();
      for (const ws of wss.clients) ws.terminate();
      return new Promise((ok) => {
        wss.close();
        server.close(() => ok());
        server.closeAllConnections?.();
      });
    },
  };
}

async function main() {
  const port = process.env.PORT ? Number(process.env.PORT) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`Invalid PORT: ${process.env.PORT}`);
    process.exit(1);
  }
  const distDir = process.env.DIST ? resolve(process.env.DIST) : join(ROOT, 'dist');
  if (!existsSync(join(distDir, 'index.html'))) console.warn('Warning: dist/index.html not found, run "npm run build" first.');
  if (!existsSync(join(distDir, 'pad.html'))) console.warn('Warning: dist/pad.html not found, run "npm run build" first.');

  const srv = createServer({ port, distDir, log: (m) => console.log(`  ${m}`) });
  let u;
  try {
    u = await srv.listen();
  } catch (e) {
    if (e.code === 'EADDRINUSE') console.error(`Port ${port} is already in use. Is Summit Descent already running? Try PORT=${port + 1} npm start`);
    else if (e.code === 'EACCES') console.error(`No permission to listen on port ${port}.`);
    else console.error(`Cannot start the server: ${e.message}`);
    process.exit(1);
  }
  const ip = lanAddress();
  console.log('\nSummit Descent');
  console.log(`  game (this Mac): ${u.localUrl}`);
  console.log(`  game (LAN):      ${u.lanUrl}`);
  console.log(`  phone pad:       ${u.padUrl}`);
  if (!ip) console.log('  No LAN address found: phones need the Mac and the phone on the same Wi-Fi.');
  else if (!process.env.LAN_IP && viaVpn(networkInterfaces(), ip)) {
    console.log('  That address is a VPN tunnel: a phone on the Wi-Fi may not reach it. Turn the VPN off, allow LAN');
    console.log('  access in it (NordVPN: "Allow LAN discovery"), or set LAN_IP to the Wi-Fi address.');
  }
  const others = lanAddresses().filter((f) => f.address !== ip);
  if (others.length && !process.env.LAN_IP) console.log(`  other addresses:  ${others.map((f) => `${f.address} (${f.name})`).join(', ')}  (LAN_IP=<address> picks one)`);
  try {
    console.log(await QRCode.toString(u.padUrl, { type: 'terminal', small: true }));
  } catch {}
  if (process.argv.includes('--open')) {
    execFile('open', [u.localUrl], (err) => { if (err) console.log(`  open ${u.localUrl} in a browser`); });
  }
  const stop = () => { console.log('\nbye'); srv.close().then(() => process.exit(0)); setTimeout(() => process.exit(0), 1500).unref(); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
