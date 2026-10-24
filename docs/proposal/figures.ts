// Generates the proposal's data-driven parts from the committed data files, so no measurement in the PDF
// is typed by hand: TikZ charts of the monthly canopy series, the release-rule chart with every settled
// epoch, the five-year results table, and a macro file with the numbers quoted in the text.
//
//   npm run proposal     (this script, then latexmk in docs/proposal)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fromRoot, readJson } from '../../scripts/lib/paths.ts';
import { canopyFraction, validRatio, type MethodParams, type SeriesMonth } from '../../shared/method.ts';

// As registered and funded by scripts/demo.ts on Base Sepolia.
const THRESHOLD_BPS = 7000;
const EPOCHS = 5;
const ESCROW_WEI = 3_000_000_000_000_000n; // 0.003 ETH per project
const HOLDING_BPS = 9500; // same status rule as the website

const OUT = fromRoot('docs/proposal/generated');
mkdirSync(OUT, { recursive: true });

interface ManifestPlot { id: string; role: 'healthy' | 'degraded' | 'burned'; name: string; region: string }
interface Attestation {
  epoch: number;
  method: MethodParams;
  observation: { year: number; scoredMonth: string };
  baseline: { scoredMonths: string[] };
  metrics: { canopyFractionBaseline: number; canopyFractionObserved: number; survivalRatioBps: number };
  events: { fire?: { month: string; firmsDetections: number; dnbr: number | null; firstDetection: string | null; lastDetection: string | null; canopyBefore: number; canopyAfter: number } };
}

const manifest = readJson<{ plots: ManifestPlot[] }>(fromRoot('data/plots/manifest.json'));
const order = ['healthy', 'degraded', 'burned'] as const;
const plots = order.map((role) => manifest.plots.find((p) => p.role === role)!);

const load = (plotId: string, name: string) =>
  JSON.parse(readFileSync(fromRoot('data/attestations', plotId, name), 'utf8')) as Attestation;

const data = plots.map((plot) => {
  const epochs = Array.from({ length: EPOCHS }, (_, e) => load(plot.id, `epoch-${e}.json`));
  const series = readJson<{ months: SeriesMonth[] }>(fromRoot('data/series', `${plot.id}.json`)).months;
  return { plot, epochs, series, params: epochs[0].method, baseline: epochs[0].metrics.canopyFractionBaseline };
});

// ------------------------------------------------------------------------------- escrow arithmetic
// Mirrors MilestoneEscrow.trancheAmount / payoutFor exactly (integer wei).
const tranche = (epoch: number) => {
  const cum = (i: number) => (ESCROW_WEI * BigInt((i + 1) * (i + 4))) / BigInt(EPOCHS * (EPOCHS + 3));
  return cum(epoch) - (epoch === 0 ? 0n : cum(epoch - 1));
};
const payout = (t: bigint, s: number) =>
  s <= THRESHOLD_BPS ? 0n : s >= 10_000 ? t : (t * BigInt(s - THRESHOLD_BPS)) / BigInt(10_000 - THRESHOLD_BPS);
const shareBps = (s: number) => Number((payout(10_000n, s) * 10_000n) / 10_000n);
const status = (s: number) => (s <= THRESHOLD_BPS ? 'critical' : s >= HOLDING_BPS ? 'good' : 'warn');

const pct = (bps: number, digits = 1) => {
  const v = (bps / 100).toFixed(digits);
  return `${v.replace(/\.0+$/, '')}\\%`;
};
const eth = (wei: bigint) => (Number(wei) / 1e18).toFixed(6);
const f = (v: number, d = 2) => v.toFixed(d);

// ----------------------------------------------------------------------------------- results table
let table = '';
const released: bigint[] = [];
for (const { plot, epochs } of data) {
  let total = 0n;
  const cells = epochs.map((a) => {
    const s = a.metrics.survivalRatioBps;
    total += payout(tranche(a.epoch), s);
    return `\\cell{${status(s)}}{${pct(s)}}{${pct(shareBps(s))}}`;
  });
  released.push(total);
  table += `\\textbf{${plot.name}} {\\color{ink3}\\scriptsize ${plot.role}} & ${cells.join(' & ')} & \\mono{${eth(total)}} \\\\\n`;
}
// a macro, not a file to \input inside the tabular: \input there breaks the following \bottomrule
writeFileSync(`${OUT}/results-rows.tex`, `\\newcommand{\\ResultsRows}{%\n${table}}\n`);

// ------------------------------------------------------------------------------- series charts
const W = 15.0; // cm, plot area
const H = 2.8;

function monthIndex(month: string, first: string) {
  const [y, m] = month.split('-').map(Number);
  const [y0, m0] = first.split('-').map(Number);
  return (y - y0) * 12 + (m - m0);
}

function seriesChart(d: (typeof data)[number], falseClaim?: Attestation, annotations: { month: string; text: string; dx: number; y: number; anchor: string }[] = []) {
  const { series, params, baseline, epochs } = d;
  const first = series[0].month;
  const n = series.length;
  const dx = W / (n - 1);
  const x = (month: string) => (monthIndex(month, first) * dx);
  const y = (v: number) => v * H;
  const c = (v: number) => v.toFixed(3);
  const lines: string[] = [];
  const band = (year: number, fill: string) => {
    const a = x(`${year}-08`) - dx / 2;
    const b = x(`${year}-10`) + dx / 2;
    lines.push(`\\fill[${fill}] (${c(a)},0) rectangle (${c(b)},${c(H)});`);
    return (a + b) / 2;
  };
  const baseCenters = params.baselineYears.map((yr) => band(yr, 'bandbase'));
  const epochCenters = params.epochYears.map((yr) => band(yr, 'bandepoch'));

  for (const v of [0.5, 1]) lines.push(`\\draw[grid] (0,${c(y(v))}) -- (${c(W)},${c(y(v))});`);
  lines.push(`\\draw[axis] (0,0) -- (${c(W)},0);`);
  for (const v of [0, 0.5, 1]) lines.push(`\\node[ticklabel, anchor=east] at (-0.06,${c(y(v))}) {${v}};`);
  for (let yr = Number(first.slice(0, 4)); yr <= Number(series[n - 1].month.slice(0, 4)); yr++) {
    const xx = x(`${yr}-01`);
    lines.push(`\\draw[axis] (${c(xx)},0) -- (${c(xx)},-0.06);`);
    lines.push(`\\node[ticklabel, anchor=north] at (${c(xx)},-0.08) {${yr}};`);
  }
  lines.push(`\\node[ticklabel, anchor=south] at (${c((baseCenters[0] + baseCenters.at(-1)!) / 2)},${c(H + 0.02)}) {baseline years};`);

  const t = baseline * THRESHOLD_BPS / 10_000;
  lines.push(`\\draw[baseline] (0,${c(y(baseline))}) -- (${c(W)},${c(y(baseline))});`);
  lines.push(`\\draw[threshold] (0,${c(y(t))}) -- (${c(W)},${c(y(t))});`);
  lines.push(`\\node[sidelabel] at (${c(W + 0.1)},${c(y(baseline))}) {baseline ${f(baseline)}};`);
  lines.push(`\\node[sidelabel, font=\\tiny\\bfseries] at (${c(W + 0.1)},${c(y(t))}) {T: 70\\% = ${f(t)}};`);

  // fire breaks recorded in the evidence
  for (const a of epochs) {
    const fire = a.events.fire;
    if (!fire) continue;
    const xx = x(fire.month);
    lines.push(`\\draw[fire] (${c(xx)},0) -- (${c(xx)},${c(H)});`);
    lines.push(`\\node[annot, anchor=east, align=right] at (${c(xx - 0.06)},${c(y(0.32))}) {\\textbf{fire ${fire.month}}\\\\${fire.firmsDetections} FIRMS in plot · dNBR ${f(fire.dnbr ?? 0)}};`);
  }

  // the series: cloud-free months only, with gaps where the month is unusable
  let path: string[] = [];
  const paths: string[][] = [];
  for (const m of series) {
    const v = canopyFraction(m.ndviHistogram, params.canopyNdviThreshold);
    if (validRatio(m) >= params.minValidRatio && v !== null) path.push(`(${c(x(m.month))},${c(y(v))})`);
    else if (path.length) { paths.push(path); path = []; }
  }
  if (path.length) paths.push(path);
  for (const p of paths) lines.push(`\\draw[series] ${p.join(' -- ')};`);

  for (const m of epochs[0].baseline.scoredMonths) {
    const s = series.find((s) => s.month === m)!;
    const v = canopyFraction(s.ndviHistogram, params.canopyNdviThreshold)!;
    lines.push(`\\node[basepoint] at (${c(x(m))},${c(y(v))}) {};`);
  }
  for (const a of epochs) {
    const s = a.metrics.survivalRatioBps;
    lines.push(`\\node[scored, fill=${status(s)}] at (${c(x(a.observation.scoredMonth))},${c(y(a.metrics.canopyFractionObserved))}) {};`);
  }
  if (falseClaim) {
    const xx = x(falseClaim.observation.scoredMonth);
    const yy = y(falseClaim.metrics.canopyFractionObserved);
    lines.push(`\\node[rejected] at (${c(xx)},${c(yy)}) {};`);
    lines.push(`\\draw[critical, line width=0.6pt] (${c(xx - 0.045)},${c(yy - 0.045)}) -- (${c(xx + 0.045)},${c(yy + 0.045)}) (${c(xx - 0.045)},${c(yy + 0.045)}) -- (${c(xx + 0.045)},${c(yy - 0.045)});`);
    lines.push(`\\node[annot, anchor=west] at (${c(xx + 0.12)},${c(yy)}) {${pct(falseClaim.metrics.survivalRatioBps, 0)} claimed for ${falseClaim.observation.year}, rejected after challenge};`);
  }
  for (const a of annotations) {
    lines.push(`\\node[annot, anchor=${a.anchor}] at (${c(x(a.month) + a.dx)},${c(y(a.y))}) {${a.text}};`);
  }

  // one summary per epoch under the axis: canopy retained -> share of that tranche released
  epochs.forEach((a, e) => {
    const s = a.metrics.survivalRatioBps;
    lines.push(`\\node[epochlabel] at (${c(epochCenters[e])},-0.42) {\\textbf{E${e}} ${pct(s)} $\\rightarrow$ ${pct(shareBps(s))}};`);
  });

  return `\\begin{tikzpicture}[x=1cm,y=1cm]\n${lines.join('\n')}\n\\end{tikzpicture}\n`;
}

const [yed, novo, manavgat] = data;
const smoke = novo.series.find((m) => m.month === '2022-09')!;
const smokeBefore = novo.series.find((m) => m.month === '2022-08')!;
const cf = (m: SeriesMonth) => canopyFraction(m.ndviHistogram, novo.params.canopyNdviThreshold)!;

writeFileSync(`${OUT}/series-healthy.tex`, seriesChart(yed));
writeFileSync(`${OUT}/series-degraded.tex`, seriesChart(novo, undefined, [{
  month: '2022-09', dx: -0.1, y: 0.1, anchor: 'east',
  text: `Sep 2022: ${f(cf(smokeBefore))} $\\rightarrow$ ${f(cf(smoke))}, NBR unchanged (haze)`,
}]));
const falseClaim = load(manavgat.plot.id, 'epoch-1.false-claim.json');
writeFileSync(`${OUT}/series-burned.tex`, seriesChart(manavgat, falseClaim));

// ------------------------------------------------------------------------------ release-rule chart
{
  const RW = 6.5;
  const RH = 3.3;
  const x = (bps: number) => (bps / 10_000) * RW;
  const y = (bps: number) => (bps / 10_000) * RH;
  const c = (v: number) => v.toFixed(3);
  const lines: string[] = [];
  lines.push(`\\fill[bandbase] (0,0) rectangle (${c(x(THRESHOLD_BPS))},${c(RH)});`);
  lines.push(`\\node[ticklabel, anchor=north west, align=left] at (0.05,${c(RH - 0.05)}) {no release\\\\at or below T};`);
  for (const v of [5000, 10_000]) lines.push(`\\draw[grid] (0,${c(y(v))}) -- (${c(RW)},${c(y(v))});`);
  lines.push(`\\draw[axis] (0,0) -- (${c(RW)},0);`);
  for (const v of [0, 5000, 10_000]) {
    lines.push(`\\node[ticklabel, anchor=east] at (-0.06,${c(y(v))}) {${v / 100}\\%};`);
    lines.push(`\\node[ticklabel, anchor=north] at (${c(x(v))},-0.06) {${v / 100}\\%};`);
  }
  lines.push(`\\node[ticklabel, anchor=north, font=\\tiny\\bfseries] at (${c(x(THRESHOLD_BPS))},-0.06) {70\\%};`);
  lines.push(`\\draw[threshold] (${c(x(THRESHOLD_BPS))},0) -- (${c(x(THRESHOLD_BPS))},${c(RH)});`);
  lines.push(`\\draw[ink, line width=0.9pt, line join=round] (0,0) -- (${c(x(THRESHOLD_BPS))},0) -- (${c(RW)},${c(RH)});`);
  const shapes = { healthy: 'circle', degraded: 'rectangle', burned: 'regular polygon, regular polygon sides=3' };
  for (const { plot, epochs } of data) {
    for (const a of epochs) {
      const s = a.metrics.survivalRatioBps;
      lines.push(`\\node[rulepoint, ${shapes[plot.role]}, fill=${status(s)}] at (${c(x(s))},${c(y(shareBps(s)))}) {};`);
    }
  }
  lines.push(`\\node[annot, anchor=east] at (${c(x(10_000) - 0.16)},${c(y(10_000) - 0.02)}) {Yedigöller, all 5 years};`);
  // right of the points and under the curve, clear of the threshold line
  const novoPts = novo.epochs.slice(1).map((a) => a.metrics.survivalRatioBps);
  lines.push(`\\node[annot, anchor=north west, align=left] at (${c(x(Math.max(...novoPts)) + 0.16)},${c(y(shareBps(Math.min(...novoPts))))}) {Novo Progresso\\\\2022--2025};`);
  const mPts = manavgat.epochs.map((a) => a.metrics.survivalRatioBps);
  lines.push(`\\node[annot, anchor=south] at (${c((x(Math.min(...mPts)) + x(Math.max(...mPts))) / 2)},0.12) {Manavgat, all 5 years: nothing released};`);
  lines.push(`\\node[ticklabel, anchor=north] at (${c(RW / 2)},-0.36) {canopy retained against baseline (s)};`);
  lines.push(`\\node[ticklabel, anchor=south, rotate=90] at (-0.62,${c(RH / 2)}) {share of tranche released};`);
  writeFileSync(`${OUT}/release-rule.tex`, `\\begin{tikzpicture}[x=1cm,y=1cm]\n${lines.join('\n')}\n\\end{tikzpicture}\n`);
}

// ---------------------------------------------------------------------------------------- numbers
const fire = manavgat.epochs.find((a) => a.events.fire)!.events.fire!;
const novoFire = novo.epochs.find((a) => a.events.fire)?.events.fire;
const falseRecompute = load(manavgat.plot.id, 'epoch-1.json').metrics.survivalRatioBps;
const macros: Record<string, string> = {
  SeriesMonths: String(yed.series.length),
  SeriesFrom: yed.series[0].month,
  SeriesTo: yed.series.at(-1)!.month,
  FireMonth: fire.month,
  FireFirms: String(fire.firmsDetections),
  FireFirst: fire.firstDetection ?? '',
  FireLast: fire.lastDetection ?? '',
  FireDnbr: f(fire.dnbr ?? 0),
  FireBefore: f(fire.canopyBefore),
  FireAfter: f(fire.canopyAfter),
  NovoFireMonth: novoFire?.month ?? '',
  NovoFireFirms: String(novoFire?.firmsDetections ?? 0),
  NovoFireDnbr: f(novoFire?.dnbr ?? 0),
  SmokeBefore: f(cf(smokeBefore)),
  SmokeAfter: f(cf(smoke)),
  SmokeNbr: f(smoke.nbrMean!),
  FalseClaim: pct(falseClaim.metrics.survivalRatioBps, 0),
  FalseRecompute: pct(falseRecompute, 2),
  ReleasedHealthy: eth(released[0]),
  ReleasedDegraded: eth(released[1]),
  ReleasedBurned: eth(released[2]),
  ReturnedTotal: eth(ESCROW_WEI * 3n - released.reduce((a, b) => a + b, 0n)),
};
for (const [i, d] of data.entries()) {
  const key = ['Healthy', 'Degraded', 'Burned'][i];
  macros[`Baseline${key}`] = f(d.baseline);
  const s = d.epochs.map((a) => a.metrics.survivalRatioBps);
  macros[`Min${key}`] = pct(Math.min(...s));
  macros[`Max${key}`] = pct(Math.max(...s));
}
// dates contain hyphens TeX would break a line at
for (const k of ['SeriesFrom', 'SeriesTo', 'FireMonth', 'FireFirst', 'FireLast', 'NovoFireMonth']) macros[k] = `\\mbox{${macros[k]}}`;
writeFileSync(`${OUT}/numbers.tex`,
  `% Generated by docs/proposal/figures.ts. Do not edit.\n${Object.entries(macros).map(([k, v]) => `\\newcommand{\\${k}}{${v}}`).join('\n')}\n`);

console.log(`wrote ${OUT}: results-rows, series-{healthy,degraded,burned}, release-rule, numbers`);
for (const [k, v] of Object.entries(macros)) console.log(`  ${k.padEnd(18)} ${v}`);
