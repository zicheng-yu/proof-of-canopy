import { polygonToCells } from 'h3-js';

export type LonLat = [number, number];

const EARTH_RADIUS_M = 6_371_008.8;
const DEG = Math.PI / 180;
const DECIMALS = 6;

/** Axis-aligned square of the given area centred on a point, counter-clockwise and closed. */
export function squareAround([lon, lat]: LonLat, areaHectares: number): LonLat[] {
  const half = Math.sqrt(areaHectares * 10_000) / 2;
  const dLat = half / (EARTH_RADIUS_M * DEG);
  const dLon = half / (EARTH_RADIUS_M * Math.cos(lat * DEG) * DEG);
  return [
    [lon - dLon, lat - dLat],
    [lon + dLon, lat - dLat],
    [lon + dLon, lat + dLat],
    [lon - dLon, lat + dLat],
    [lon - dLon, lat - dLat],
  ];
}

/** Rounds to 6 decimals, closes the ring and makes it counter-clockwise (RFC 7946). */
export function canonicalRing(ring: LonLat[]): LonLat[] {
  const rounded = ring.map(([x, y]) => [round(x), round(y)] as LonLat);
  const [fx, fy] = rounded[0];
  const [lx, ly] = rounded[rounded.length - 1];
  if (fx !== lx || fy !== ly) rounded.push([fx, fy]);
  return signedArea(rounded) < 0 ? rounded.reverse() : rounded;
}

/**
 * The canonical file is a bare GeoJSON Polygon with sorted keys, no whitespace and fixed 6-decimal
 * coordinates. plotHash = keccak256 of exactly these bytes, so only the geometry identifies a plot.
 */
export function canonicalGeoJson(ring: LonLat[]): string {
  const coords = ring.map(([x, y]) => `[${x.toFixed(DECIMALS)},${y.toFixed(DECIMALS)}]`).join(',');
  return `{"coordinates":[[${coords}]],"type":"Polygon"}`;
}

export function ringFromGeoJson(text: string): LonLat[] {
  const parsed = JSON.parse(text);
  const geometry = parsed.type === 'FeatureCollection' ? parsed.features[0].geometry
    : parsed.type === 'Feature' ? parsed.geometry
    : parsed;
  if (geometry?.type !== 'Polygon') throw new Error(`expected a Polygon, got ${geometry?.type}`);
  return geometry.coordinates[0] as LonLat[];
}

/** Area on a local equirectangular projection; accurate to well under 1% at plot scale. */
export function areaHectares(ring: LonLat[]): number {
  return Math.abs(signedArea(ring)) / 10_000;
}

export function centroid(ring: LonLat[]): LonLat {
  const pts = ring.slice(0, -1);
  const lon = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const lat = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return [round(lon), round(lat)];
}

/** H3 cells whose centres fall inside the polygon, as ascending uint64 values. */
export function h3Cells(ring: LonLat[], resolution: number): bigint[] {
  return polygonToCells([ring], resolution, true)
    .map((h) => BigInt('0x' + h))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function shiftRing(ring: LonLat[], eastMetres: number, northMetres: number): LonLat[] {
  const lat0 = ring[0][1];
  const dLat = northMetres / (EARTH_RADIUS_M * DEG);
  const dLon = eastMetres / (EARTH_RADIUS_M * Math.cos(lat0 * DEG) * DEG);
  return ring.map(([x, y]) => [x + dLon, y + dLat] as LonLat);
}

function signedArea(ring: LonLat[]): number {
  const lat0 = ring[0][1] * DEG;
  const xy = ring.map(([x, y]) => [EARTH_RADIUS_M * x * DEG * Math.cos(lat0), EARTH_RADIUS_M * y * DEG]);
  let sum = 0;
  for (let i = 0; i + 1 < xy.length; i++) {
    sum += xy[i][0] * xy[i + 1][1] - xy[i + 1][0] * xy[i][1];
  }
  return sum / 2;
}

function round(v: number): number {
  return Number(v.toFixed(DECIMALS));
}
