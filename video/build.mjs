// Cuts the recordings into the final video, one segment per narration line:
//   node build.mjs            → out/proof-of-canopy-demo.mp4 and out/proof-of-canopy-demo.vtt
// Inputs: out/run (record-run.mjs), out/tour (record-tour.mjs), out/slides (slides.html), and the
// narration audio rendered here from narration.json with macOS `say`.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out');
const SEG = join(OUT, 'segments');
mkdirSync(SEG, { recursive: true });
mkdirSync(join(OUT, 'audio'), { recursive: true });

const FONT = join(HERE, '../docs/proposal/fonts/InstrumentSans-SemiBold.ttf');
const LEAD = 0.5; // silence before each narration line
const TAIL = 0.7; // after it
const FPS = 30;

const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const duration = (file) => Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]));
const only = (dir) => join(dir, readdirSync(dir).find((f) => f.endsWith('.webm')));

// ---- narration
const narration = JSON.parse(readFileSync(join(HERE, 'narration.json'), 'utf8'));
const audio = {};
for (const s of narration.segments) {
  const file = join(OUT, 'audio', `${s.id}.aiff`);
  run('say', ['-v', narration.voice, '-r', String(narration.rate), '-o', file, s.say ?? s.text]);
  audio[s.id] = { file, seconds: duration(file), text: s.text };
}

// ---- sources
const { timeline } = JSON.parse(readFileSync(join(OUT, 'run/timeline.json'), 'utf8'));
const at = (label, track) => {
  const m = timeline.find((x) => x.label === label);
  if (!m) throw new Error(`timeline has no ${label}`);
  return m[track];
};
const TERM = only(join(OUT, 'run/terminal'));
const SITE = only(join(OUT, 'run/site'));
const tour = (name) => join(OUT, 'tour', `${name}.webm`);
const slide = (name) => join(OUT, 'slides', `${name}.png`);

// Live-run labels sit at the top over the terminal (its newest lines are at the bottom), at the bottom over the site.
const caption = (text, top) =>
  `drawtext=fontfile='${FONT}':text='${text.replace(/[:']/g, (c) => `\\${c}`)}':x=${top ? 64 : 48}:y=${top ? 100 : 'H-96'}:fontsize=30:fontcolor=white:box=1:boxcolor=0x131712@0.78:boxborderw=16`;

/**
 * Each segment: a main video (a slide, a tour clip, or a window of the live run, sped up to fit), an
 * optional picture-in-picture of the other run angle over the same wall-clock window, and a caption.
 */
const segments = [
  { id: 'open', slide: 'open' },
  { id: 'rule', clip: tour('overview'), from: 1.2 },
  { id: 'plots', clip: tour('manavgat'), from: 1.2 },
  { id: 'smoke', clip: tour('novoprogresso'), from: 1.2 },
  { id: 'register', live: ['start', 'step4-attest'], main: 'terminal', caption: 'Live on Base Sepolia · real transactions' },
  { id: 'settle', live: ['step4-attest', 'schedule-printed'], main: 'site', extra: 4, caption: 'Live on Base Sepolia · sped up' },
  { id: 'lie', live: ['step7-lie', 'step8-honest'], main: 'terminal', extra: 3, caption: 'Live on Base Sepolia · a staged false claim' },
  { id: 'verify', clip: tour('verifyLie'), from: 1.2 },
  { id: 'reclaim', live: ['step9-reclaim', 'done'], main: 'site', extra: 3, caption: 'Live on Base Sepolia' },
  { id: 'architecture', slide: 'arch' },
  { id: 'end', slide: 'end', hold: 2 },
];

const files = [];
const cues = [];
let clock = 0;
for (const s of segments) {
  const a = audio[s.id];
  const length = LEAD + a.seconds + TAIL + (s.hold ?? 0);
  const out = join(SEG, `${String(files.length).padStart(2, '0')}-${s.id}.mp4`);
  const inputs = [];
  let filter;

  if (s.slide) {
    inputs.push('-loop', '1', '-t', String(length), '-i', slide(s.slide));
    filter = `[0:v]scale=1920:1080,fps=${FPS},format=yuv420p[v0]`;
  } else if (s.clip) {
    inputs.push('-ss', String(s.from), '-i', s.clip);
    filter = `[0:v]fps=${FPS},tpad=stop_mode=clone:stop_duration=${length},format=yuv420p[v0]`;
  } else {
    const mainFile = s.main === 'terminal' ? TERM : SITE;
    const pipFile = s.main === 'terminal' ? SITE : TERM;
    const mainTrack = s.main;
    const pipTrack = s.main === 'terminal' ? 'site' : 'terminal';
    const span = at(s.live[1], mainTrack) - at(s.live[0], mainTrack) + (s.extra ?? 0);
    const speed = Math.max(1, span / length);
    inputs.push('-ss', String(at(s.live[0], mainTrack)), '-t', String(span), '-i', mainFile);
    inputs.push('-ss', String(at(s.live[0], pipTrack)), '-t', String(span), '-i', pipFile);
    filter = [
      `[0:v]setpts=(PTS-STARTPTS)/${speed},fps=${FPS},tpad=stop_mode=clone:stop_duration=${length}[m]`,
      `[1:v]setpts=(PTS-STARTPTS)/${speed},fps=${FPS},tpad=stop_mode=clone:stop_duration=${length},scale=760:-2,pad=iw+8:ih+8:4:4:color=0x9aa197[p]`,
      `[m][p]overlay=W-w-40:40,format=yuv420p[v0]`,
    ].join(';');
    if (speed > 1.05) s.caption = s.caption.includes('sped up') ? `${s.caption} ${speed.toFixed(1)}×` : `${s.caption} · sped up ${speed.toFixed(1)}×`;
  }
  const fadeOut = Math.max(0, length - 0.35);
  filter += `;[v0]${s.caption ? caption(s.caption, s.main === 'terminal') + ',' : ''}fade=t=in:st=0:d=0.35,fade=t=out:st=${fadeOut}:d=0.35,trim=duration=${length}[v]`;
  filter += `;[${inputs.filter((x) => x === '-i').length}:a]adelay=${LEAD * 1000}|${LEAD * 1000},apad,atrim=duration=${length},aresample=48000[a]`;

  run('ffmpeg', [
    '-v', 'error', '-y', ...inputs, '-i', a.file,
    '-filter_complex', filter, '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-r', String(FPS), '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-ac', '1', '-t', String(length), out,
  ]);
  files.push(out);
  cues.push({ start: clock + LEAD, end: clock + LEAD + a.seconds, text: a.text });
  clock += length;
  console.log(`${s.id.padEnd(13)} ${length.toFixed(1)}s`);
}

// ---- join and caption file
writeFileSync(join(SEG, 'list.txt'), files.map((f) => `file '${f}'`).join('\n'));
const final = join(OUT, 'proof-of-canopy-demo.mp4');
run('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(SEG, 'list.txt'), '-c', 'copy', '-movflags', '+faststart', final]);

const ts = (t) => new Date(t * 1000).toISOString().slice(11, 23);
const vtt = ['WEBVTT', ''];
for (const c of cues) {
  // split long lines into sentence-sized cues, timed by character share
  const parts = c.text.match(/[^.!?:]+[.!?:]?/g).map((p) => p.trim()).filter(Boolean);
  const total = parts.reduce((n, p) => n + p.length, 0);
  let t = c.start;
  for (const p of parts) {
    const d = ((c.end - c.start) * p.length) / total;
    vtt.push(`${ts(t)} --> ${ts(t + d)}`, p, '');
    t += d;
  }
}
writeFileSync(join(OUT, 'proof-of-canopy-demo.vtt'), vtt.join('\n'));
console.log(`\n${final}  ${clock.toFixed(1)}s`);
