// Records the website tour scenes, one video file per scene, against the finished run:
//   out/tour/<scene>.webm  (1920×1080, site zoomed 4/3 as in record-run.mjs)
//
//   SITE_URL=http://localhost:4173 node record-tour.mjs [scene ...]
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out/tour');
const SITE = process.env.SITE_URL ?? 'http://localhost:4173';
mkdirSync(OUT, { recursive: true });

const wait = (page, ms) => page.waitForTimeout(ms);
const smooth = (page, top) => page.evaluate((y) => window.scrollTo({ top: y, behavior: 'smooth' }), top);
const scrollToText = (page, text, offset = 80) => page.evaluate(([t, o]) => {
  const el = [...document.querySelectorAll('h1,h2,h3,div,span')].find((n) => n.textContent?.trim().startsWith(t));
  if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - o, behavior: 'smooth' });
}, [text, offset]);

/** Moves the mouse along the canopy chart from one month to another, so the tooltip follows. */
async function sweepChart(page, fromMonth, toMonth, stepMs = 120) {
  const svg = page.locator('svg[aria-label^="Monthly canopy fraction"]');
  const box = await svg.boundingBox();
  const months = 93; // 2019-01 … 2026-09
  const index = (m) => (Number(m.slice(0, 4)) - 2019) * 12 + Number(m.slice(5)) - 1;
  const s = box.width / 760;
  const y = box.y + 130 * s;
  for (let i = index(fromMonth); i <= index(toMonth); i++) {
    await page.mouse.move(box.x + (44 + (700 * i) / (months - 1)) * s, y);
    await wait(page, stepMs);
  }
}

const scenes = {
  async overview(page) {
    await page.goto(`${SITE}/`, { waitUntil: 'networkidle' });
    await wait(page, 4000);
    await smooth(page, 430);
    await wait(page, 3500);
    await scrollToText(page, 'Three plots, one standard', 20);
    await wait(page, 5000);
    await smooth(page, (await page.evaluate(() => window.scrollY)) + 420);
    await wait(page, 4000);
  },
  async manavgat(page) {
    await page.goto(`${SITE}/plot/3`, { waitUntil: 'networkidle' });
    await wait(page, 3000);
    await scrollToText(page, 'Boundary and claimed cells', 60);
    await wait(page, 2500);
    await sweepChart(page, '2021-04', '2021-11', 450);
    await wait(page, 800);
    await sweepChart(page, '2021-12', '2025-10', 70);
    await page.mouse.move(10, 10);
    await wait(page, 2500);
  },
  async novoprogresso(page) {
    await page.goto(`${SITE}/plot/2`, { waitUntil: 'networkidle' });
    await wait(page, 2500);
    await scrollToText(page, 'Boundary and claimed cells', 60);
    await wait(page, 2000);
    await sweepChart(page, '2022-06', '2022-10', 900);
    await wait(page, 1200);
    await sweepChart(page, '2024-07', '2024-10', 900);
    await page.mouse.move(10, 10);
    await wait(page, 2000);
  },
  async yedigoller(page) {
    await page.goto(`${SITE}/plot/1`, { waitUntil: 'networkidle' });
    await wait(page, 2500);
    await scrollToText(page, 'Boundary and claimed cells', 60);
    await wait(page, 5000);
  },
  async dispute(page) {
    await page.goto(`${SITE}/plot/3`, { waitUntil: 'networkidle' });
    await wait(page, 2500);
    await scrollToText(page, 'Escrow schedule', 40);
    await wait(page, 4000);
    await scrollToText(page, 'EPOCH 1', 40);
    await wait(page, 6000);
    await scrollToText(page, 'On-chain record', 40);
    await wait(page, 5000);
  },
  async verifyLie(page) {
    await page.goto(`${SITE}/verify?a=15`, { waitUntil: 'networkidle' });
    await wait(page, 3500);
    await scrollToText(page, 'Check 1', 140);
    await wait(page, 4000);
    await scrollToText(page, 'Check 4', 200);
    await wait(page, 6000);
    await scrollToText(page, 'Evidence file', 40);
    await wait(page, 4000);
  },
  async verifyHonest(page) {
    await page.goto(`${SITE}/verify?a=16`, { waitUntil: 'networkidle' });
    await wait(page, 3500);
    await scrollToText(page, 'Check 1', 140);
    await wait(page, 3000);
    await scrollToText(page, 'Check 4', 200);
    await wait(page, 4000);
  },
};

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(scenes);
const browser = await chromium.launch();
for (const name of wanted) {
  const dir = join(OUT, `${name}.tmp`);
  rmSync(dir, { recursive: true, force: true });
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir, size: { width: 1920, height: 1080 } },
  });
  await ctx.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.zoom = String(4 / 3); }));
  const page = await ctx.newPage();
  const t0 = Date.now();
  await scenes[name](page);
  await ctx.close();
  const [file] = readdirSync(dir);
  renameSync(join(dir, file), join(OUT, `${name}.webm`));
  rmSync(dir, { recursive: true, force: true });
  console.log(`${name.padEnd(14)} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
await browser.close();
