// Copies the published data files into web/public/data and writes web/public/data/source.json, which
// tells the app where chain state comes from. The copies are byte-for-byte, so hashes checked in the
// browser match the ones on chain.
//
//   node scripts/sync-web-data.ts --live <chainId> [--rpc <url>]   events from deployments/<chainId>.json
//   node scripts/sync-web-data.ts --replay [file]                  a recorded run (default data/replay/demo-31337.json)
//   node scripts/sync-web-data.ts --auto                           live on Base Sepolia if deployed there, else replay
import { cpSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fromRoot, readJson, writeJson } from './lib/paths.ts';
import type { Deployment } from './lib/chain.ts';

// Read-only RPCs the browser uses. sepolia.base.org caps eth_getLogs at 200 blocks, so the site reads from
// endpoints without that cap (and with CORS); both also return blockTimestamp on logs.
const CHAINS: Record<number, { name: string; rpcUrls: string[]; explorer?: string }> = {
  31337: { name: 'Local anvil', rpcUrls: ['http://127.0.0.1:8545'] },
  84532: {
    name: 'Base Sepolia',
    rpcUrls: ['https://base-sepolia-rpc.publicnode.com', 'https://base-sepolia.gateway.tenderly.co'],
    explorer: 'https://sepolia.basescan.org',
  },
};
const DEFAULT_REPLAY = 'data/replay/demo-31337.json';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : '');
};

const out = fromRoot('web/public/data');
rmSync(out, { recursive: true, force: true });
cpSync(fromRoot('data'), out, { recursive: true, filter: (src) => !src.endsWith('plots.config.json') });

const attestationFiles = listJson(join(out, 'attestations')).map((f) => relative(out, f));
writeJson(join(out, 'attestations', 'index.json'), attestationFiles.map((f) => `/data/${f}`));

let source: Record<string, unknown>;
const live = flag('--live') ?? (flag('--auto') !== undefined && existsSync(fromRoot('deployments/84532.json')) ? '84532' : undefined);
if (live) {
  const chainId = Number(live);
  const chain = CHAINS[chainId] ?? { name: `Chain ${chainId}`, rpcUrls: [] };
  const deployment = readJson<Deployment>(fromRoot('deployments', `${chainId}.json`));
  source = {
    mode: 'live',
    chainId,
    chainName: chain.name,
    rpcUrls: flag('--rpc') ? [flag('--rpc')] : chain.rpcUrls,
    explorer: chain.explorer,
    startBlock: deployment.startBlock,
    arbiter: deployment.arbiter,
    contracts: {
      ProjectRegistry: deployment.ProjectRegistry,
      SurvivalOracle: deployment.SurvivalOracle,
      MilestoneEscrow: deployment.MilestoneEscrow,
    },
  };
} else {
  const file = flag('--replay') || DEFAULT_REPLAY;
  if (!existsSync(fromRoot(file))) throw new Error(`no replay at ${file}; run scripts/snapshot-events.ts first`);
  const replay = readJson<{ chainId: number; recordedAt: string }>(fromRoot(file));
  source = {
    mode: 'replay',
    chainId: replay.chainId,
    chainName: CHAINS[replay.chainId]?.name ?? `Chain ${replay.chainId}`,
    replay: `/data/${relative(fromRoot('data'), fromRoot(file))}`,
    recordedAt: replay.recordedAt,
  };
}
writeJson(join(out, 'source.json'), source);
console.log(`web/public/data ready · ${source.mode} · ${source.chainName}`);

function listJson(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return listJson(path);
    return name.endsWith('.json') && name !== 'index.json' ? [path] : [];
  });
}
