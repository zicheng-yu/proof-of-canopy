// NASA FIRMS active-fire detections (area API, CSV). MAP_KEY comes from .env and only appears in the
// request URL, never in output.
import { loadEnv } from '../../scripts/lib/keys.ts';
import type { LonLat } from '../../scripts/lib/geo.ts';

export interface FirePoint {
  lat: number;
  lon: number;
  date: string;
  frp: number;
  confidence: string;
}

const MAX_DAYS = 5;

/** Detections inside bbox [west, south, east, north] between two dates (inclusive), in 5-day requests. */
export async function fetchFires(bbox: [number, number, number, number], from: string, to: string, source = 'VIIRS_SNPP_SP'): Promise<FirePoint[]> {
  loadEnv();
  const key = process.env.FIRMS_MAP_KEY;
  if (!key) throw new Error('FIRMS_MAP_KEY missing from .env');
  const points: FirePoint[] = [];
  for (let day = new Date(`${from}T00:00:00Z`); day <= new Date(`${to}T00:00:00Z`); day.setUTCDate(day.getUTCDate() + MAX_DAYS)) {
    const date = day.toISOString().slice(0, 10);
    const left = Math.round((Date.parse(`${to}T00:00:00Z`) - day.getTime()) / 86_400_000) + 1;
    const range = Math.min(MAX_DAYS, left);
    const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/${source}/${bbox.join(',')}/${range}/${date}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`FIRMS HTTP ${res.status} for ${source} ${date}`);
    points.push(...parseCsv(await res.text()));
  }
  return points;
}

function parseCsv(text: string): FirePoint[] {
  const [head, ...rows] = text.trim().split('\n');
  if (!head?.startsWith('latitude')) return [];
  const cols = head.split(',');
  const at = (name: string) => cols.indexOf(name);
  return rows.map((r) => {
    const v = r.split(',');
    return {
      lat: Number(v[at('latitude')]),
      lon: Number(v[at('longitude')]),
      date: v[at('acq_date')],
      frp: Number(v[at('frp')]),
      confidence: v[at('confidence')],
    };
  });
}

/** Ray casting; ring in [lon, lat]. */
export function inside([lon, lat]: LonLat, ring: LonLat[]): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
