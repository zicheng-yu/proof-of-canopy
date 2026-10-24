// Screenshots for the Devpost image gallery: 3:2, 1800×1200, from the live site plus two frames from
// the video material. Writes docs/gallery/*.png.
//
//   node gallery.mjs     (needs out/slides/arch.png and out/run/terminal/*.webm from the video build)
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '../docs/gallery');
const SITE = process.env.SITE_URL ?? 'https://proofofcanopy.zichengyu.com';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1.25 });
const scrollToText = (text, offset) => page.evaluate(([t, o]) => {
  const el = [...document.querySelectorAll('h1,h2,h3,div,span')].find((n) => n.textContent?.trim().startsWith(t));
  if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - o);
}, [text, offset]);
const hoverMonth = async (month) => {
  const box = await page.locator('svg[aria-label^="Monthly canopy fraction"]').boundingBox();
  const i = (Number(month.slice(0, 4)) - 2019) * 12 + Number(month.slice(5)) - 1;
  const s = box.width / 760;
  await page.mouse.move(box.x + (44 + (700 * i) / 92) * s, box.y + 130 * s);
};
const shot = async (name) => {
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(name);
};

await page.goto(`${SITE}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
// the next section's heading would show half-cut at the bottom edge
const hide = await page.addStyleTag({ content: '#plots { visibility: hidden; }' });
await shot('01-overview');
await hide.evaluate((el) => el.remove());

await scrollToText('Three plots, one standard', 24);
await shot('02-three-plots');

await page.goto(`${SITE}/plot/3`, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
await scrollToText('Boundary and claimed cells', 40);
await shot('03-manavgat-fire');

await page.goto(`${SITE}/plot/2`, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
await scrollToText('Boundary and claimed cells', 40);
await hoverMonth('2022-09');
await shot('04-novo-progresso-smoke');

await page.goto(`${SITE}/plot/3`, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
await scrollToText('EPOCH 1', 60);
await shot('05-false-claim-slashed');

await page.goto(`${SITE}/verify?a=15`, { waitUntil: 'networkidle' });
await page.waitForTimeout(5000);
await scrollToText('Check 2', 60);
await shot('06-verify-recompute');

await browser.close();

// 16:9 video material, padded to 3:2 on the page background
const pad = (input, name, color) => {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', input, '-vf', `scale=1800:-2,pad=1800:1200:0:(oh-ih)/2:color=${color}`, '-frames:v', '1', join(OUT, `${name}.png`)]);
  console.log(name);
};
pad(join(HERE, 'out/slides/arch.png'), '07-architecture', '0xf2f3ef');
const terminal = join(HERE, 'out/run/terminal', readdirSync(join(HERE, 'out/run/terminal')).find((f) => f.endsWith('.webm')));
const frame = join(HERE, 'out/check/terminal-frame.png');
mkdirSync(dirname(frame), { recursive: true });
execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '216', '-i', terminal, '-frames:v', '1', frame]);
pad(frame, '08-live-run-terminal', '0xe9ebe5');
