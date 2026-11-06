// Test helpers for the net unit (used by test/net*.test.mjs): a server on a random port and ws clients with an inbox.
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { createServer } from './index.js';

export function fakeDist() {
  const dir = mkdtempSync(join(tmpdir(), 'summit-descent-dist-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>host</title>');
  writeFileSync(join(dir, 'pad.html'), '<!doctype html><title>pad</title>');
  mkdirSync(join(dir, 'data'));
  writeFileSync(join(dir, 'data', 'h.bin'), Buffer.from([1, 2, 3, 4]));
  writeFileSync(join(dir, 'app.js'), 'export {}');
  return dir;
}

export async function startServer(opts = {}) {
  const srv = createServer({ port: 0, host: '127.0.0.1', distDir: opts.distDir || fakeDist(), ...opts });
  await srv.listen();
  srv.base = `http://127.0.0.1:${srv.port}`;
  srv.wsBase = `ws://127.0.0.1:${srv.port}/ws`;
  return srv;
}

export function client(url) {
  const ws = new WebSocket(url);
  const inbox = [];
  const waiters = [];
  let closed = null;
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    const i = waiters.findIndex((w) => w.pred(m));
    if (i >= 0) waiters.splice(i, 1)[0].ok(m);
    else inbox.push(m);
  });
  ws.on('close', (code) => {
    closed = code;
    for (const w of waiters.splice(0)) w.closed?.(code);
  });
  const c = {
    ws,
    inbox,
    get closedCode() { return closed; },
    open: () => new Promise((ok, fail) => { ws.once('open', ok); ws.once('error', fail); }),
    send: (m) => ws.send(typeof m === 'string' ? m : JSON.stringify(m)),
    next(pred = () => true, ms = 1500) {
      if (typeof pred === 'string') { const t = pred; pred = (m) => m.t === t; }
      const i = inbox.findIndex(pred);
      if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
      return new Promise((ok, fail) => {
        const w = { pred, ok: (m) => { clearTimeout(timer); ok(m); }, closed: (code) => { clearTimeout(timer); fail(new Error(`closed ${code} while waiting`)); } };
        const timer = setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); fail(new Error('timeout waiting for message')); }, ms);
        waiters.push(w);
      });
    },
    // Resolves true if no message matching pred arrives within ms.
    async none(pred, ms = 200) {
      if (typeof pred === 'string') { const t = pred; pred = (m) => m.t === t; }
      try { await c.next(pred, ms); return false; } catch { return true; }
    },
    closed: () => new Promise((ok) => (closed !== null ? ok(closed) : ws.once('close', ok))),
    close: () => { ws.close(); return c.closed(); },
  };
  return c;
}

export async function host(srv) {
  const c = client(`${srv.wsBase}?role=host`);
  await c.open();
  return c;
}

export async function pad(srv, id) {
  const c = client(`${srv.wsBase}?role=pad&id=${encodeURIComponent(id)}`);
  await c.open();
  return c;
}

export const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
