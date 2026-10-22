import { useEffect, useState } from 'react';
import type { Hash } from 'viem';

export interface PlotMeta {
  id: string;
  role: 'healthy' | 'degraded' | 'burned';
  name: string;
  region: string;
  placeholder: boolean;
  file: string;
  plotHash: Hash;
  areaHectares: number;
  centroid: [number, number];
  cellCount: number;
  cells: string[];
}

let cache: Promise<PlotMeta[]> | undefined;

export function loadPlots(): Promise<PlotMeta[]> {
  cache ??= fetch('/data/plots/manifest.json')
    .then((r) => r.json())
    .then((m: { plots: PlotMeta[] }) => m.plots);
  return cache;
}

export function usePlots(): PlotMeta[] | undefined {
  const [plots, setPlots] = useState<PlotMeta[]>();
  useEffect(() => {
    loadPlots().then(setPlots);
  }, []);
  return plots;
}

export const plotByHash = (plots: PlotMeta[] | undefined, hash: Hash) =>
  plots?.find((p) => p.plotHash.toLowerCase() === hash.toLowerCase());

/** Fetches a published file as raw bytes, exactly as served. */
export async function fetchBytes(path: string): Promise<Uint8Array> {
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
