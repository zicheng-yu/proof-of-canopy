// Site selection (gate G1): scores a grid of candidate 250 ha squares by late-season canopy fraction
// in a baseline year and a test year, so plots are picked from data rather than by eye.
//
//   node oracle/scan.ts <name> <lon> <lat> <size> <baselineYear> <testYear> [--fires west,south,east,north,from,to]
//
// With --fires the grid is centred on the densest cluster of FIRMS detections in that box instead.
// Writes data/scan/<name>.json.
import { canonicalRing, squareAround, type LonLat } from '../scripts/lib/geo.ts';
import { fromRoot, writeJson } from '../scripts/lib/paths.ts';
import { canopyFraction, fetchStats, validRatio } from './lib/cdse.ts';
import { fetchFires } from './lib/firms.ts';

const [name, lonArg, latArg, sizeArg, baseYear, testYear] = process.argv.slice(2);
if (!testYear) throw new Error('usage: node oracle/scan.ts <name> <lon> <lat> <size> <baselineYear> <testYear> [--fires w,s,e,n,from,to]');
const size = Number(sizeArg);
const firesArg = process.argv.indexOf('--fires');

const AREA_HA = 250;
const STEP_M = 1600;
let center: LonLat = [Number(lonArg), Number(latArg)];
let fireSummary: unknown;

if (firesArg !== -1) {
  const [w, s, e, n, from, to] = process.argv[firesArg + 1].split(',');
  const fires = await fetchFires([Number(w), Number(s), Number(e), Number(n)], from, to);
  // densest ~1.6 km cell
  const cell = 0.016;
  const counts = new Map<string, number>();
  for (const f of fires) {
    const k = `${Math.floor(f.lon / cell)},${Math.floor(f.lat / cell)}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const [best, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const [cx, cy] = best.split(',').map(Number);
  center = [(cx + 0.5) * cell, (cy + 0.5) * cell];
  fireSummary = { detections: fires.length, densestCell: { center, count } };
  console.log(`FIRMS: ${fires.length} detections, densest cell ${center.map((v) => v.toFixed(4))} with ${count}`);
}

const lat0 = center[1];
const dLat = STEP_M / 110_574;
const dLon = STEP_M / (111_320 * Math.cos((lat0 * Math.PI) / 180));
const half = Math.floor(size / 2);
const candidates: { id: string; center: LonLat }[] = [];
for (let row = -half; row <= half; row++) {
  for (let col = -half; col <= half; col++) {
    candidates.push({
      id: `${row >= 0 ? '+' : ''}${row},${col >= 0 ? '+' : ''}${col}`,
      center: [Number((center[0] + col * dLon).toFixed(5)), Number((center[1] + row * dLat).toFixed(5))],
    });
  }
}

// One request per candidate: 3-month intervals from August of the baseline year to October of the
// test year, so the first and last intervals are the two Aug–Oct windows.
const lateSeasons = async (ring: LonLat[]) => {
  const { intervals } = await fetchStats(ring, `${baseYear}-08-01T00:00:00Z`, `${testYear}-11-01T00:00:00Z`, 'P3M');
  const pick = (s = intervals[0]) => (s ? { canopy: canopyFraction(s), valid: validRatio(s), ndvi: s.ndviMean } : { canopy: null, valid: 0, ndvi: null });
  return { base: pick(intervals[0]), test: pick(intervals.at(-1)) };
};

const results = [];
let done = 0;
for (const c of candidates) {
  const ring = canonicalRing(squareAround(c.center, AREA_HA));
  const { base, test } = await lateSeasons(ring);
  const retention = base.canopy && test.canopy !== null ? test.canopy / base.canopy : null;
  results.push({ ...c, base, test, retention });
  process.stdout.write(`\r${++done}/${candidates.length}`);
}
console.log();

results.sort((a, b) => (a.id < b.id ? -1 : 1));
for (const r of results) {
  console.log(`${r.id.padEnd(7)} ${r.center.map((v) => v.toFixed(5)).join(', ').padEnd(22)} base ${fmt(r.base.canopy)} (valid ${r.base.valid.toFixed(2)})  test ${fmt(r.test.canopy)} (valid ${r.test.valid.toFixed(2)})  retention ${fmt(r.retention)}`);
}
writeJson(fromRoot('data/scan', `${name}.json`), {
  note: `Late-season (Aug–Oct) canopy fraction, NDVI >= 0.5, ${baseYear} vs ${testYear}; ${AREA_HA} ha squares ${STEP_M} m apart.`,
  scannedAt: new Date().toISOString(),
  center,
  fires: fireSummary,
  results,
});

function fmt(v: number | null) {
  return v === null ? '  —  ' : v.toFixed(3);
}
