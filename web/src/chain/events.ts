import { parseEventLogs, type Address, type Hash, type Hex } from 'viem';
import { milestoneEscrowAbi, projectRegistryAbi, survivalOracleAbi } from '../abi';
import type { Contracts } from '../source';

/** A log as stored in a replay file or returned by eth_getLogs, plus its block time. */
export interface RawLog {
  address: Address;
  topics: [Hex, ...Hex[]] | [];
  data: Hex;
  blockNumber: bigint;
  logIndex: number;
  transactionHash: Hash;
  timestamp: bigint;
}

export interface Ref {
  tx: Hash;
  block: bigint;
  logIndex: number;
  timestamp: bigint;
}

/** Decoded contract event. `args` keeps viem's decoded values (bigint for uint256, number for small ints). */
export interface ChainEvent {
  name: string;
  args: Record<string, unknown>;
  ref: Ref;
}

const ABI_BY_CONTRACT = {
  ProjectRegistry: projectRegistryAbi,
  SurvivalOracle: survivalOracleAbi,
  MilestoneEscrow: milestoneEscrowAbi,
} as const;

export function decode(logs: RawLog[], contracts: Contracts): ChainEvent[] {
  const events: ChainEvent[] = [];
  for (const [name, abi] of Object.entries(ABI_BY_CONTRACT) as [keyof Contracts, (typeof ABI_BY_CONTRACT)[keyof Contracts]][]) {
    const address = contracts[name].toLowerCase();
    const mine = logs.filter((l) => l.address.toLowerCase() === address);
    // parseEventLogs returns each input log with `eventName` and `args` added, so our fields survive.
    const parsed = parseEventLogs({ abi, logs: mine as never }) as unknown as (RawLog & {
      eventName: string;
      args: Record<string, unknown>;
    })[];
    for (const p of parsed) {
      events.push({
        name: p.eventName,
        args: p.args,
        ref: { tx: p.transactionHash, block: p.blockNumber, logIndex: p.logIndex, timestamp: p.timestamp },
      });
    }
  }
  return events.sort((a, b) =>
    a.ref.block === b.ref.block ? a.ref.logIndex - b.ref.logIndex : a.ref.block < b.ref.block ? -1 : 1,
  );
}
