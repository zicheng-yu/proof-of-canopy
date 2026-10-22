import { existsSync } from 'node:fs';
import {
  BaseError, ContractFunctionRevertedError, createPublicClient, createTestClient, createWalletClient, defineChain,
  http, type Abi, type Account, type Address, type Chain, type Hash,
} from 'viem';
import { mnemonicToAccount, privateKeyToAccount } from 'viem/accounts';
import { baseSepolia, foundry } from 'viem/chains';
import { dim, line } from './log.ts';
import { fromRoot, readJson } from './paths.ts';

export type ContractName = 'ProjectRegistry' | 'SurvivalOracle' | 'MilestoneEscrow';

export interface Deployment {
  chainId: number;
  startBlock: number;
  arbiter: Address;
  ProjectRegistry: Address;
  SurvivalOracle: Address;
  MilestoneEscrow: Address;
}

/** Foundry's public test mnemonic; only ever used against a local anvil node. */
const ANVIL_MNEMONIC = 'test test test test test test test test test test test junk';

export const ROLES = ['deployer', 'developer', 'funder', 'verifier', 'rogueVerifier'] as const;
export type Role = (typeof ROLES)[number];
const ENV_KEY: Record<Role, string> = {
  deployer: 'DEPLOYER_KEY',
  developer: 'DEVELOPER_KEY',
  funder: 'FUNDER_KEY',
  verifier: 'VERIFIER_KEY',
  rogueVerifier: 'ROGUE_VERIFIER_KEY',
};

export async function connect(rpcUrl: string) {
  const probe = createPublicClient({ transport: http(rpcUrl) });
  const chainId = await probe.getChainId();
  const chain: Chain = chainId === foundry.id ? foundry
    : chainId === baseSepolia.id ? baseSepolia
    : defineChain({
      id: chainId, name: `chain-${chainId}`,
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    });
  const isLocal = chainId === foundry.id;
  const transport = http(rpcUrl);

  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ chain, transport });
  const testClient = isLocal ? createTestClient({ chain, transport, mode: 'anvil' }) : undefined;

  const accounts = Object.fromEntries(ROLES.map((role, i) => {
    if (isLocal) return [role, mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: i })];
    const key = process.env[ENV_KEY[role]];
    if (!key) throw new Error(`${ENV_KEY[role]} is not set (see .env.example)`);
    return [role, privateKeyToAccount(key as Hash)];
  })) as Record<Role, Account>;

  const deploymentPath = fromRoot('deployments', `${chainId}.json`);
  if (!existsSync(deploymentPath)) throw new Error(`no deployment at ${deploymentPath}; run the Deploy script first`);
  const deployment = readJson<Deployment>(deploymentPath);

  const explorer = chain.blockExplorers?.default.url;
  const txUrl = (hash: Hash) => (explorer ? `${explorer}/tx/${hash}` : undefined);

  const txLog: { label: string; hash: Hash; url?: string }[] = [];

  /** Simulates, sends, waits for the receipt and prints the tx hash. Returns the simulated result. */
  async function send<T = unknown>(label: string, call: {
    account: Account; contract: ContractName; functionName: string; args?: readonly unknown[]; value?: bigint;
  }): Promise<{ hash: Hash; result: T }> {
    const { request, result } = await publicClient.simulateContract({
      account: call.account,
      address: deployment[call.contract],
      abi: abi(call.contract),
      functionName: call.functionName,
      args: call.args ?? [],
      value: call.value,
    });
    const hash = await walletClient.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') throw new Error(`${label}: transaction ${hash} reverted`);
    const url = txUrl(hash);
    txLog.push({ label, hash, url });
    line(`${label.padEnd(40)} ${dim(url ?? hash)}`);
    return { hash, result: result as T };
  }

  /** Runs the call against current chain state and returns the decoded custom error it reverts with. */
  async function expectRevert(call: {
    account: Account; contract: ContractName; functionName: string; args?: readonly unknown[]; value?: bigint;
  }): Promise<string> {
    try {
      await publicClient.simulateContract({
        account: call.account,
        address: deployment[call.contract],
        abi: abi(call.contract),
        functionName: call.functionName,
        args: call.args ?? [],
        value: call.value,
      });
    } catch (err) {
      const revert = err instanceof BaseError ? err.walk((e) => e instanceof ContractFunctionRevertedError) : null;
      if (revert instanceof ContractFunctionRevertedError && revert.data?.errorName) {
        const args = (revert.data.args ?? []).map((a) => (typeof a === 'bigint' ? a.toString() : String(a)));
        return `${revert.data.errorName}(${args.join(', ')})`;
      }
      throw err;
    }
    throw new Error(`${call.contract}.${call.functionName} was expected to revert but succeeded`);
  }

  async function read<T>(contract: ContractName, functionName: string, args: readonly unknown[] = []): Promise<T> {
    return (await publicClient.readContract({
      address: deployment[contract], abi: abi(contract), functionName, args,
    })) as T;
  }

  /** Waits until chain time reaches `timestamp`; on anvil, jumps there instead. */
  async function waitUntil(timestamp: bigint): Promise<void> {
    if (testClient) {
      const now = (await publicClient.getBlock()).timestamp;
      if (now < timestamp) await testClient.increaseTime({ seconds: Number(timestamp - now) });
      await testClient.mine({ blocks: 1 });
      return;
    }
    for (;;) {
      const now = (await publicClient.getBlock()).timestamp;
      if (now >= timestamp) return;
      process.stdout.write(`\r    ${dim(`${timestamp - now}s left in challenge window…`)}   `);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  return {
    chain, chainId, isLocal, publicClient, walletClient, accounts, deployment, txLog, send, expectRevert, read,
    waitUntil,
  };
}

const abiCache = new Map<ContractName, Abi>();

export function abi(name: ContractName): Abi {
  let cached = abiCache.get(name);
  if (!cached) {
    cached = readJson<{ abi: Abi }>(fromRoot('contracts/out', `${name}.sol`, `${name}.json`)).abi;
    abiCache.set(name, cached);
  }
  return cached;
}
