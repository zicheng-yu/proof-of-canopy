// Records every event of a deployment, plus the reads the web app needs, into a replay file. The site
// shows this replay, clearly labelled, when no public deployment exists yet.
//
//   RPC_URL=http://127.0.0.1:8545 node scripts/snapshot-events.ts [out]   (default data/replay/demo-<chainId>.json)
import { createPublicClient, http, type Address } from 'viem';
import { abi, type Deployment } from './lib/chain.ts';
import { fromRoot, readJson, writeJson } from './lib/paths.ts';

const client = createPublicClient({ transport: http(process.env.RPC_URL ?? 'http://127.0.0.1:8545') });
const chainId = await client.getChainId();
const deployment = readJson<Deployment>(fromRoot('deployments', `${chainId}.json`));
const latest = await client.getBlockNumber();

const logs = await client.getLogs({
  address: [deployment.ProjectRegistry, deployment.SurvivalOracle, deployment.MilestoneEscrow],
  fromBlock: BigInt(deployment.startBlock),
  toBlock: latest,
});

const timestamps = new Map<bigint, bigint>();
for (const log of logs) {
  if (!timestamps.has(log.blockNumber)) {
    timestamps.set(log.blockNumber, (await client.getBlock({ blockNumber: log.blockNumber })).timestamp);
  }
}

const read = <T>(address: Address, name: 'ProjectRegistry' | 'SurvivalOracle', functionName: string, args: unknown[] = []) =>
  client.readContract({ address, abi: abi(name), functionName, args }) as Promise<T>;

const projectCount = await read<bigint>(deployment.ProjectRegistry, 'ProjectRegistry', 'projectCount');
const cells: Record<string, string[]> = {};
for (let id = 1n; id <= projectCount; id++) {
  const list = await read<readonly bigint[]>(deployment.ProjectRegistry, 'ProjectRegistry', 'cellsOf', [id]);
  cells[id.toString()] = list.map(String);
}

const out = process.argv[2] ?? fromRoot('data/replay', `demo-${chainId}.json`);
writeJson(out, {
  note: 'Replay of a recorded run. Not a live chain: transactions here are not on any public explorer.',
  chainId,
  recordedAt: new Date().toISOString(),
  latestBlock: latest.toString(),
  contracts: {
    ProjectRegistry: deployment.ProjectRegistry,
    SurvivalOracle: deployment.SurvivalOracle,
    MilestoneEscrow: deployment.MilestoneEscrow,
  },
  params: {
    arbiter: await read<Address>(deployment.SurvivalOracle, 'SurvivalOracle', 'arbiter'),
    verifierStake: (await read<bigint>(deployment.SurvivalOracle, 'SurvivalOracle', 'verifierStake')).toString(),
    challengeBond: (await read<bigint>(deployment.SurvivalOracle, 'SurvivalOracle', 'challengeBond')).toString(),
    challengeWindow: (await read<bigint>(deployment.SurvivalOracle, 'SurvivalOracle', 'challengeWindow')).toString(),
  },
  logs: logs.map((log) => ({
    address: log.address,
    topics: log.topics,
    data: log.data,
    blockNumber: log.blockNumber.toString(),
    logIndex: log.logIndex,
    transactionHash: log.transactionHash,
    timestamp: timestamps.get(log.blockNumber)!.toString(),
  })),
  cells,
});
console.log(`recorded ${logs.length} events from chain ${chainId} → ${out}`);
