// Sentinel-2 L2A statistics from the Copernicus Data Space Ecosystem (Sentinel Hub Statistical API).
// Credentials come from .env (CDSE_CLIENT_ID / CDSE_CLIENT_SECRET); the access token stays in memory.
import { loadEnv } from '../../scripts/lib/keys.ts';
import type { LonLat } from '../../scripts/lib/geo.ts';

const TOKEN_URL = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
const STATS_URL = 'https://sh.dataspace.copernicus.eu/statistics/v1';

/** Pixels are valid unless SCL marks them as no data, saturated, cloud shadow, cloud, cirrus or snow. */
export const EVALSCRIPT = `//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B04", "B08", "B12", "SCL", "dataMask"] }],
    output: [
      { id: "ndvi", bands: 1, sampleType: "FLOAT32" },
      { id: "nbr", bands: 1, sampleType: "FLOAT32" },
      { id: "dataMask", bands: 1 }
    ],
    mosaicking: "SIMPLE"
  };
}
function evaluatePixel(s) {
  const red = s.B08 + s.B04;
  const swir = s.B08 + s.B12;
  const valid = s.dataMask === 1 && red > 0 && swir > 0 && [0, 1, 3, 8, 9, 10, 11].indexOf(s.SCL) === -1;
  return {
    ndvi: [red > 0 ? (s.B08 - s.B04) / red : 0],
    nbr: [swir > 0 ? (s.B08 - s.B12) / swir : 0],
    dataMask: [valid ? 1 : 0]
  };
}
`;

/** NDVI histogram: 40 bins of 0.05 over [-1, 1], so 0.5 (the canopy threshold) is a bin edge. */
export const NDVI_BINS = 40;

export interface IntervalStats {
  from: string;
  to: string;
  sampleCount: number;
  noDataCount: number;
  ndviMean: number | null;
  nbrMean: number | null;
  /** counts per bin, low edge -1 + 0.05 * i */
  ndviHistogram: number[];
}

let token: { value: string; expires: number } | undefined;

async function accessToken(): Promise<string> {
  if (token && Date.now() < token.expires - 60_000) return token.value;
  loadEnv();
  const id = process.env.CDSE_CLIENT_ID;
  const secret = process.env.CDSE_CLIENT_SECRET;
  if (!id || !secret) throw new Error('CDSE_CLIENT_ID / CDSE_CLIENT_SECRET missing from .env');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret }),
  });
  if (!res.ok) throw new Error(`CDSE token request failed: HTTP ${res.status}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: body.access_token, expires: Date.now() + body.expires_in * 1000 };
  return token.value;
}

/** Pixel size in degrees that is ~10 m on the ground at this latitude. */
export function tenMetreResolution(lat: number): { resx: number; resy: number } {
  const resy = 10 / 110_574;
  const resx = 10 / (111_320 * Math.cos((lat * Math.PI) / 180));
  return { resx: Number(resx.toPrecision(6)), resy: Number(resy.toPrecision(6)) };
}

export function statsRequest(ring: LonLat[], from: string, to: string, interval: string) {
  const lat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  return {
    input: {
      bounds: {
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' },
      },
      data: [{ type: 'sentinel-2-l2a', dataFilter: { mosaickingOrder: 'leastCC' } }],
    },
    aggregation: {
      timeRange: { from, to },
      aggregationInterval: { of: interval },
      ...tenMetreResolution(lat),
      evalscript: EVALSCRIPT,
    },
    calculations: {
      ndvi: { histograms: { default: { nBins: NDVI_BINS, lowEdge: -1.0, highEdge: 1.0 } } },
      nbr: { statistics: { default: {} } },
    },
  };
}

/** The API rejects integer histogram edges for FLOAT32 output, and JSON.stringify drops the ".0". */
function serialise(body: unknown): string {
  return JSON.stringify(body).replace('"lowEdge":-1,', '"lowEdge":-1.0,').replace('"highEdge":1}', '"highEdge":1.0}');
}

export async function fetchStats(ring: LonLat[], from: string, to: string, interval = 'P1M'): Promise<{ request: unknown; intervals: IntervalStats[] }> {
  const request = statsRequest(ring, from, to, interval);
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(STATS_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${await accessToken()}` },
      body: serialise(request),
    });
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 8) throw new Error(`Statistical API HTTP ${res.status} after ${attempt} attempts`);
      const retryAfter = Number(res.headers.get('retry-after'));
      const waitMs = retryAfter > 0 ? retryAfter * 1000 : Math.min(60_000, 3000 * 2 ** (attempt - 1));
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    const body = (await res.json()) as StatsResponse;
    if (!res.ok || body.status !== 'OK') throw new Error(`Statistical API HTTP ${res.status}: ${JSON.stringify(body).slice(0, 400)}`);
    return { request, intervals: body.data.map(parseInterval) };
  }
}

interface StatsResponse {
  status: string;
  data: {
    interval: { from: string; to: string };
    error?: unknown;
    outputs: Record<string, { bands: { B0: { stats: Record<string, number>; histogram?: { bins: { count: number }[] } } } }>;
  }[];
}

function parseInterval(d: StatsResponse['data'][number]): IntervalStats {
  const ndvi = d.outputs?.ndvi?.bands.B0;
  const nbr = d.outputs?.nbr?.bands.B0;
  const sampleCount = ndvi?.stats.sampleCount ?? 0;
  const noDataCount = ndvi?.stats.noDataCount ?? sampleCount;
  const valid = sampleCount - noDataCount;
  return {
    from: d.interval.from.slice(0, 10),
    to: d.interval.to.slice(0, 10),
    sampleCount,
    noDataCount,
    ndviMean: valid > 0 ? round(ndvi!.stats.mean) : null,
    nbrMean: valid > 0 && nbr ? round(nbr.stats.mean) : null,
    ndviHistogram: ndvi?.histogram?.bins.map((b) => b.count) ?? [],
  };
}

const round = (v: number) => Number(v.toFixed(4));

/** Share of valid pixels with NDVI >= threshold (the threshold must sit on a bin edge). */
export function canopyFraction(s: IntervalStats, threshold = 0.5): number | null {
  const total = s.ndviHistogram.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const first = Math.round((threshold + 1) / (2 / NDVI_BINS));
  const above = s.ndviHistogram.slice(first).reduce((a, b) => a + b, 0);
  return above / total;
}

export const validRatio = (s: IntervalStats) => (s.sampleCount > 0 ? (s.sampleCount - s.noDataCount) / s.sampleCount : 0);
