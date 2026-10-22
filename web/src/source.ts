import type { Address } from 'viem';

export interface Contracts {
  ProjectRegistry: Address;
  SurvivalOracle: Address;
  MilestoneEscrow: Address;
}

/** Written by scripts/sync-web-data.ts into /data/source.json. */
export type Source =
  | {
      mode: 'live';
      chainId: number;
      chainName: string;
      rpcUrls: string[];
      explorer?: string;
      startBlock: number;
      arbiter: Address;
      contracts: Contracts;
    }
  | {
      mode: 'replay';
      chainId: number;
      chainName: string;
      replay: string;
      recordedAt: string;
    };

export async function loadSource(): Promise<Source> {
  const res = await fetch('/data/source.json');
  if (!res.ok) throw new Error('missing /data/source.json — run scripts/sync-web-data.ts');
  return res.json();
}
