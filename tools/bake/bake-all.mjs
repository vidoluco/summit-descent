// Bakes several worlds in parallel, one process each, then writes data/worlds/index.json once.
// Usage: node tools/bake/bake-all.mjs [id ...] [--jobs 3] [--offline] [--out data/worlds]
// Without ids it bakes every config in tools/bake/worlds/. Each world writes only its own folder.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { listConfigs } from './config.mjs';
import { writeIndex } from './world-index.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const jobs = Math.max(1, Number(opt('--jobs', 3)));
const out = opt('--out', 'data/worlds');
const ids = args.filter((a, i) => !a.startsWith('--') && !['--jobs', '--out'].includes(args[i - 1]));
const todo = ids.length ? ids : listConfigs();
const entry = fileURLToPath(new URL('./index.mjs', import.meta.url));
const results = {};
async function run(id) {
  const child = spawn(process.execPath, [entry, id, '--out', out, '--no-index', ...(args.includes('--offline') ? ['--offline'] : [])], { stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = (d) => d.toString().split('\n').filter(Boolean).map((l) => `[${id}] ${l}`).join('\n');
  child.stdout.on('data', (d) => console.log(tag(d)));
  child.stderr.on('data', (d) => console.error(tag(d)));
  results[id] = await new Promise((r) => child.on('close', r));
}
const queue = todo.slice();
await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => { while (queue.length) await run(queue.shift()); }));
await writeIndex(out, { log: console.log });
const failed = Object.entries(results).filter(([, c]) => c !== 0).map(([id]) => id);
console.log(failed.length ? `failed: ${failed.join(', ')}` : `baked: ${todo.join(', ')}`);
process.exit(failed.length ? 1 : 0);
