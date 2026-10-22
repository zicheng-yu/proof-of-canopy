// The oracle: for every plot in data/plots/manifest.json, fetch the monthly Sentinel-2 series and write
//   data/series/<plotId>.json                  the raw monthly statistics (what everything else is computed from)
//   data/attestations/<plotId>/epoch-<n>.json  one attestation per epoch, citing the series by hash
//
//   node oracle/run.ts [plotId ...]
//
// Re-running fetches fresh data; commit the files you attest with, since their hashes go on chain.
import { readFileSync, writeFileSync } from 'node:fs';
import { keccak256 } from 'viem';
import { ringFromGeoJson } from '../scripts/lib/geo.ts';
import { fromRoot, readJson, writeJson } from '../scripts/lib/paths.ts';
import {
  METHOD_ID, baselineCanopy, canopyFraction, round6, survivalBps, theilSen, validRatio, yearCanopy,
  type MethodParams, type SeriesMonth,
} from '../shared/method.ts';
import { EVALSCRIPT, NDVI_BINS, fetchStats, tenMetreResolution } from './lib/cdse.ts';
import { fetchFires, inside } from './lib/firms.ts';

const FROM = '2019-01-01';
const TO = '2026-10-01';
const BREAK_DROP = 0.2;
const MIN_DNBR = 0.1;
const FIRE_MONTHS = [5, 6, 7, 8, 9, 10];

interface ManifestPlot { id: string; file: string; plotHash: string }

const config = readJson<{ method: MethodParams }>(fromRoot('data/plots/plots.config.json'));
const params = config.method;
const manifest = readJson<{ plots: ManifestPlot[] }>(fromRoot('data/plots/manifest.json'));
const only = process.argv.slice(2);

for (const plot of manifest.plots.filter((p) => only.length === 0 || only.includes(p.id))) {
  const ring = ringFromGeoJson(readFileSync(fromRoot('data/plots', plot.file), 'utf8'));
  console.log(`${plot.id}: fetching ${FROM} → ${TO} monthly`);
  const { intervals } = await fetchStats(ring, `${FROM}T00:00:00Z`, `${TO}T00:00:00Z`, 'P1M');
  const series: SeriesMonth[] = intervals.map((s) => ({
    month: s.from.slice(0, 7),
    sampleCount: s.sampleCount,
    noDataCount: s.noDataCount,
    ndviMean: s.ndviMean,
    nbrMean: s.nbrMean,
    ndviHistogram: s.ndviHistogram,
  }));

  const seriesPath = `data/series/${plot.id}.json`;
  writeJson(fromRoot(seriesPath), {
    schema: 'proof-of-canopy/series@1',
    plotId: plot.id,
    plotHash: plot.plotHash,
    source: 'Copernicus Sentinel-2 L2A, Copernicus Data Space Ecosystem, Sentinel Hub Statistical API',
    fetchedAt: new Date().toISOString(),
    request: {
      dataset: 'sentinel-2-l2a',
      mosaicking: 'SIMPLE, mosaickingOrder leastCC (least cloudy scene per month)',
      aggregationInterval: 'P1M',
      timeRange: [FROM, TO],
      resolutionDegrees: tenMetreResolution(ring.reduce((s, p) => s + p[1], 0) / ring.length),
      ndviHistogram: { nBins: NDVI_BINS, lowEdge: -1, highEdge: 1 },
      evalscript: EVALSCRIPT,
    },
    months: series,
  });
  const seriesHash = keccak256(readFileSync(fromRoot(seriesPath)));

  const baseline = baselineCanopy(series, params);
  if (baseline.value === null) throw new Error(`${plot.id}: no usable baseline months`);
  const fire = await detectFire(series, ring);
  if (fire) console.log(`  fire ${fire.month}: canopy −${fire.drop} · dNBR ${fire.dnbr} · ${fire.firmsDetections} FIRMS detections in plot`);

  const annual: [number, number][] = [];
  for (const year of params.baselineYears) {
    const v = yearCanopy(series, year, params).value;
    if (v !== null) annual.push([year, v]);
  }

  params.epochYears.forEach((year, epoch) => {
    const observed = yearCanopy(series, year, params);
    if (observed.value === null) {
      console.log(`  epoch ${epoch} (${year}): no usable months, skipped`);
      return;
    }
    annual.push([year, observed.value]);
    const bps = survivalBps(baseline.value!, observed.value);
    const scored = series.filter((m) => {
      const [y, mo] = m.month.split('-').map(Number);
      return y === year && params.scoredMonths.includes(mo);
    });
    const slope = theilSen(annual);
    writeJson(fromRoot('data/attestations', plot.id, `epoch-${epoch}.json`), {
      schema: 'proof-of-canopy/attestation@1',
      plotId: plot.id,
      plotHash: plot.plotHash,
      epoch,
      method: { id: METHOD_ID, ...params },
      inputs: { seriesFile: seriesPath, seriesHash },
      baseline: { years: params.baselineYears, scoredMonths: baseline.months },
      observation: { year, scoredMonth: observed.month },
      metrics: {
        canopyFractionBaseline: baseline.value,
        canopyFractionObserved: observed.value,
        survivalRatioBps: bps,
        cloudFreeRatioOfSeason: round6(scored.reduce((s, m) => s + validRatio(m), 0) / scored.length),
        canopyTrendPerYear: slope === null ? null : round6(slope),
      },
      events: fire && Number(fire.month.slice(0, 4)) === year ? { fire } : {},
    });
    console.log(`  epoch ${epoch} (${year}): canopy ${observed.value.toFixed(3)} (${observed.month}) / baseline ${baseline.value!.toFixed(3)} → ${(bps / 100).toFixed(2)}%`);
  });
}

/**
 * A fire break is the largest month-to-month canopy drop (May–October, cloud-filtered, so snow is out)
 * that exceeds BREAK_DROP and comes with a burn signature, dNBR >= MIN_DNBR; smoke haze drops NDVI but
 * barely moves NBR. For that break, count NASA FIRMS detections inside the plot over the two months.
 */
async function detectFire(series: SeriesMonth[], ring: [number, number][]) {
  const usable = series
    .filter((m) => validRatio(m) >= params.minValidRatio && FIRE_MONTHS.includes(Number(m.month.slice(5))))
    .map((m) => ({ m, c: canopyFraction(m.ndviHistogram, params.canopyNdviThreshold) }))
    .filter((x): x is { m: SeriesMonth; c: number } => x.c !== null);
  let best: { before: SeriesMonth; after: SeriesMonth; drop: number } | undefined;
  for (let i = 1; i < usable.length; i++) {
    const before = usable[i - 1].m;
    const after = usable[i].m;
    const sameSeason = before.month.slice(0, 4) === after.month.slice(0, 4);
    const dnbr = before.nbrMean !== null && after.nbrMean !== null ? before.nbrMean - after.nbrMean : 0;
    const drop = usable[i - 1].c - usable[i].c;
    if (sameSeason && drop >= BREAK_DROP && dnbr >= MIN_DNBR && (!best || drop > best.drop)) best = { before, after, drop };
  }
  if (!best) return null;

  const lons = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  const pad = 0.005;
  const bbox: [number, number, number, number] = [
    Math.min(...lons) - pad, Math.min(...lats) - pad, Math.max(...lons) + pad, Math.max(...lats) + pad,
  ].map((v) => Number(v.toFixed(4))) as [number, number, number, number];
  const from = `${best.before.month}-01`;
  const [y, mo] = best.after.month.split('-').map(Number);
  const to = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); // last day of the break month
  const fires = (await fetchFires(bbox, from, to)).filter((f) => inside([f.lon, f.lat], ring));
  const dates = fires.map((f) => f.date).sort();
  return {
    month: best.after.month,
    canopyBefore: round6(canopyFraction(best.before.ndviHistogram, params.canopyNdviThreshold)!),
    canopyAfter: round6(canopyFraction(best.after.ndviHistogram, params.canopyNdviThreshold)!),
    drop: round6(best.drop),
    dnbr: best.before.nbrMean !== null && best.after.nbrMean !== null ? round6(best.before.nbrMean - best.after.nbrMean) : null,
    firmsSource: 'VIIRS_SNPP_SP',
    firmsWindow: [from, to],
    firmsDetections: fires.length,
    firstDetection: dates[0] ?? null,
    lastDetection: dates.at(-1) ?? null,
  };
}
