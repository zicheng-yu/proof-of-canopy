// The survival method, shared by the oracle (Node) and the Verify page (browser) so both compute the
// same number from the same series file. No imports: keep it runnable everywhere.

// Each year is scored on its greenest usable late-season month (maximum-value composite): clouds,
// haze and smoke only ever lower NDVI, so the maximum is the reading least contaminated by them,
// while real canopy loss lowers every month. Baseline = median of the baseline years' scores.
export const METHOD_ID = 'canopy-late-season-max-v1';

export interface MethodParams {
  /** NDVI at or above this counts as canopy; must be a histogram bin edge. */
  canopyNdviThreshold: number;
  /** Months of the year scored, 1-12 (late growing season, fewest clouds at our sites). */
  scoredMonths: number[];
  /** A month counts only if at least this share of the plot's pixels were cloud-free. */
  minValidRatio: number;
  baselineYears: number[];
  epochYears: number[];
}

export interface SeriesMonth {
  month: string; // YYYY-MM
  sampleCount: number;
  noDataCount: number;
  ndviMean: number | null;
  nbrMean: number | null;
  /** 40 bins over [-1, 1], low edge of bin i = -1 + 0.05 i */
  ndviHistogram: number[];
}

export const BIN_WIDTH = 0.05;

export function canopyFraction(histogram: number[], threshold: number): number | null {
  const total = histogram.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const first = Math.round((threshold + 1) / BIN_WIDTH);
  return histogram.slice(first).reduce((a, b) => a + b, 0) / total;
}

export const validRatio = (m: SeriesMonth) => (m.sampleCount > 0 ? (m.sampleCount - m.noDataCount) / m.sampleCount : 0);

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Rounds the way attestation files store fractions, so recomputation matches byte for byte. */
export const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

/** Scored months of the given years that pass the cloud filter. */
export function usableMonths(series: SeriesMonth[], years: number[], p: MethodParams): SeriesMonth[] {
  return series.filter((m) => {
    const [y, mo] = m.month.split('-').map(Number);
    return years.includes(y) && p.scoredMonths.includes(mo) && validRatio(m) >= p.minValidRatio;
  });
}

/** A year's score: the highest canopy fraction among its usable scored months, rounded to 6 decimals. */
export function yearCanopy(series: SeriesMonth[], year: number, p: MethodParams): { value: number | null; month: string | null } {
  let best: { value: number; month: string } | null = null;
  for (const m of usableMonths(series, [year], p)) {
    const c = canopyFraction(m.ndviHistogram, p.canopyNdviThreshold);
    if (c !== null && (!best || c > best.value)) best = { value: c, month: m.month };
  }
  return best ? { value: round6(best.value), month: best.month } : { value: null, month: null };
}

/** Baseline: median of the baseline years' scores. */
export function baselineCanopy(series: SeriesMonth[], p: MethodParams): { value: number | null; months: string[] } {
  const years = p.baselineYears.map((y) => yearCanopy(series, y, p)).filter((y) => y.value !== null);
  const med = median(years.map((y) => y.value!));
  return { value: med === null ? null : round6(med), months: years.map((y) => y.month!) };
}

/** Survival in basis points: observed / baseline canopy, capped at 1, floored. */
export function survivalBps(baseline: number, observed: number): number {
  return Math.floor(Math.min(1, observed / baseline) * 10_000);
}

/** Theil–Sen slope: median of pairwise slopes, robust to a single outlier year. */
export function theilSen(points: [number, number][]): number | null {
  const slopes: number[] = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (points[j][0] !== points[i][0]) slopes.push((points[j][1] - points[i][1]) / (points[j][0] - points[i][0]));
    }
  }
  return median(slopes);
}
