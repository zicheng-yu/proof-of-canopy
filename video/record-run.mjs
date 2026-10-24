// Records a real demo run on Base Sepolia from two angles at once:
//   - a terminal page that streams the live stdout of `node scripts/demo.ts` (server-sent events)
//   - the website, reading the same contracts and updating on its own as transactions land
// The site is moved to the part of the page each demo step affects. Writes out/run/terminal/*.webm,
// out/run/site/*.webm, out/run/stdout.jsonl (every chunk with its time) and out/run/timeline.json.
//
//   SITE_URL=http://localhost:4173 node record-run.mjs
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import http from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(HERE, 'out/run');
const SITE = process.env.SITE_URL ?? 'http://localhost:4173';
const PORT = 4180;
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'stdout.jsonl'), '');

const bus = new EventEmitter();
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

const server = http.createServer((req, res) => {
  if (req.url === '/stream') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const child = spawn('node', ['scripts/demo.ts'], {
      cwd: ROOT,
      env: { ...process.env, FORCE_COLOR: '1', RPC_URL: process.env.DEMO_RPC_URL ?? 'https://sepolia.base.org' },
    });
    const forward = (chunk) => {
      const text = chunk.toString();
      appendFileSync(join(OUT, 'stdout.jsonl'), JSON.stringify({ t: Date.now(), text }) + '\n');
      res.write(`data: ${JSON.stringify(text)}\n\n`);
      bus.emit('text', strip(text));
    };
    child.stdout.on('data', forward);
    child.stderr.on('data', forward);
    child.on('exit', (code) => {
      res.write(`event: end\ndata: ${code}\n\n`);
      res.end();
      bus.emit('exit', code);
    });
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(readFileSync(join(HERE, 'terminal.html')));
});
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch();
// 1920×1080 frames. The site is zoomed 4/3 so it lays out as it does at 1440 px wide, but renders sharp.
const context = (name) => browser.newContext({
  viewport: { width: 1920, height: 1080 },
  recordVideo: { dir: join(OUT, name), size: { width: 1920, height: 1080 } },
});
const termCtx = await context('terminal');
const siteCtx = await context('site');
await siteCtx.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.zoom = String(4 / 3); }));
const term = await termCtx.newPage();
const termT0 = Date.now();
const site = await siteCtx.newPage();
const siteT0 = Date.now();

const timeline = [];
const mark = (label) => {
  const now = Date.now();
  timeline.push({ label, terminal: (now - termT0) / 1000, site: (now - siteT0) / 1000 });
  writeFileSync(join(OUT, 'timeline.json'), JSON.stringify({ termT0, siteT0, timeline }, null, 2));
  console.log(`${((now - termT0) / 1000).toFixed(1).padStart(6)}s  ${label}`);
};

const scrollTo = (top) => site.evaluate((y) => window.scrollTo({ top: y, behavior: 'smooth' }), top);
const scrollToText = (text, offset = 80) => site.evaluate(([t, o]) => {
  const el = [...document.querySelectorAll('h1,h2,h3,div,span')].find((n) => n.textContent?.trim().startsWith(t));
  if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - o, behavior: 'smooth' });
}, [text, offset]);

await site.goto(`${SITE}/`, { waitUntil: 'networkidle' });
await site.waitForTimeout(1500);
await scrollTo(430);
await term.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await term.waitForTimeout(1000);
mark('start');

// Site choreography, driven by what the demo prints.
let queue = Promise.resolve();
const then = (fn) => { queue = queue.then(fn).catch((e) => console.error('site step failed:', e.message)); };
const seen = new Set();
bus.on('text', (text) => {
  for (const [pattern, label, action] of [
    [/\[1\] Developer registers/, 'step1-register'],
    [/PlotAlreadyRegistered/, 'revert-same'],
    [/CellAlreadyClaimed/, 'revert-shifted'],
    [/\[3\] Funder locks/, 'step3-fund'],
    [/\[4\] Verifier stakes/, 'step4-attest', () => scrollToText('Three plots, one standard', 20)],
    [/\[5\] Challenge window/, 'step5-window'],
    [/\[6\] Finalize and release/, 'step6-release', () => scrollToText('Three plots, one standard', -150)],
    [/cells: canopy retained/, 'schedule-printed'],
    [/\[7\] A verifier lies/, 'step7-lie', async () => {
      await site.goto(`${SITE}/plot/3`, { waitUntil: 'networkidle' });
      await site.waitForTimeout(800);
      await scrollToText('Canopy, month by month', 120);
    }],
    [/funder challenges/, 'challenge'],
    [/arbiter upholds/, 'resolved', () => scrollToText('EPOCH 1', 40)],
    [/released for the lie/, 'slash-summary'],
    [/\[8\] The slot reopens/, 'step8-honest'],
    [/\[9\] Every epoch settled/, 'step9-reclaim', async () => {
      await site.goto(`${SITE}/`, { waitUntil: 'networkidle' });
      await site.waitForTimeout(800);
      await scrollTo(430);
    }],
    [/transactions · log written/, 'done'],
  ]) {
    if (!seen.has(label) && pattern.test(text)) {
      seen.add(label);
      mark(label);
      if (action) then(action);
    }
  }
});

const exited = new Promise((r) => bus.once('exit', r));
await term.evaluate(() => window.start('node scripts/demo.ts'));
const code = await exited;
mark(`exit ${code}`);
await queue;
await site.waitForTimeout(10_000);
mark('end');

await termCtx.close();
await siteCtx.close();
await browser.close();
server.close();
process.exit(code ?? 1);
