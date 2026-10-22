// Where events come from: a live chain polled every few seconds, or a recorded replay file.
import { createPublicClient, fallback, http, type Address, type PublicClient } from 'viem';
import { projectRegistryAbi } from '../abi';
import type { Contracts, Source } from '../source';
import type { RawLog } from './events';

export const POLL_MS = 3000;
const MAX_RANGE = 50_000n;

export interface Feed {
  contracts: Contracts;
  arbiter?: Address;
  /** Starts delivering the full log list (always cumulative). Returns a stop function. */
  start(onLogs: (logs: RawLog[], head: { block: bigint; at: number }) => void, onError: (e: Error) => void): () => void;
  cellsOf(projectId: bigint): Promise<bigint[]>;
}

export async function openFeed(source: Source): Promise<Feed> {
  return source.mode === 'live' ? liveFeed(source) : replayFeed(source);
}

function liveFeed(source: Extract<Source, { mode: 'live' }>): Feed {
  const client: PublicClient = createPublicClient({ transport: fallback(source.rpcUrls.map((url) => http(url))) });
  const addresses = Object.values(source.contracts);
  const logs: RawLog[] = [];
  const blockTimes = new Map<bigint, bigint>();
  let cursor = BigInt(source.startBlock) - 1n;

  async function poll() {
    const head = await client.getBlockNumber();
    while (cursor < head) {
      const from = cursor + 1n;
      const to = head - cursor > MAX_RANGE ? cursor + MAX_RANGE : head;
      const batch = await client.getLogs({ address: addresses, fromBlock: from, toBlock: to });
      for (const log of batch) {
        // most RPCs now return blockTimestamp on logs; fall back to one getBlock per block otherwise
        const inline = (log as { blockTimestamp?: string | bigint }).blockTimestamp;
        let ts = inline !== undefined ? BigInt(inline) : blockTimes.get(log.blockNumber!);
        if (ts === undefined) {
          ts = (await client.getBlock({ blockNumber: log.blockNumber! })).timestamp;
        }
        blockTimes.set(log.blockNumber!, ts);
        logs.push({
          address: log.address,
          topics: log.topics,
          data: log.data,
          blockNumber: log.blockNumber!,
          logIndex: log.logIndex!,
          transactionHash: log.transactionHash!,
          timestamp: ts,
        });
      }
      cursor = to;
    }
    return head;
  }

  return {
    contracts: source.contracts,
    arbiter: source.arbiter,
    start(onLogs, onError) {
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const tick = async () => {
        try {
          const head = await poll();
          if (!stopped) onLogs([...logs], { block: head, at: Date.now() });
        } catch (e) {
          if (!stopped) onError(e as Error);
        }
        if (!stopped) timer = setTimeout(tick, POLL_MS);
      };
      tick();
      return () => {
        stopped = true;
        clearTimeout(timer);
      };
    },
    async cellsOf(projectId) {
      const cells = await client.readContract({
        address: source.contracts.ProjectRegistry,
        abi: projectRegistryAbi,
        functionName: 'cellsOf',
        args: [projectId],
      });
      return [...cells];
    },
  };
}

interface ReplayFile {
  latestBlock: string;
  contracts: Contracts;
  params: { arbiter: Address };
  logs: (Omit<RawLog, 'blockNumber' | 'timestamp'> & { blockNumber: string; timestamp: string })[];
  cells: Record<string, string[]>;
}

async function replayFeed(source: Extract<Source, { mode: 'replay' }>): Promise<Feed> {
  const res = await fetch(source.replay);
  if (!res.ok) throw new Error(`cannot load replay ${source.replay}`);
  const file = (await res.json()) as ReplayFile;
  const logs: RawLog[] = file.logs.map((l) => ({
    ...l,
    blockNumber: BigInt(l.blockNumber),
    timestamp: BigInt(l.timestamp),
  }));
  return {
    contracts: file.contracts,
    arbiter: file.params.arbiter,
    start(onLogs) {
      onLogs(logs, { block: BigInt(file.latestBlock), at: Date.now() });
      return () => {};
    },
    async cellsOf(projectId) {
      return (file.cells[projectId.toString()] ?? []).map(BigInt);
    },
  };
}
