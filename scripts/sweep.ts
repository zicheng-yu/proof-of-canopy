// Collects test ETH left in the role wallets back to the deployer: unstakes what the oracle still holds
// for each role, withdraws what the escrow owes it, then sends the wallet balance (minus a small gas
// reserve) to the deployer. Run against the deployment in deployments/<chainId>.json.
//
//   RPC_URL=https://sepolia.base.org node scripts/sweep.ts
import { formatEther, parseEther } from 'viem';
import { connect, ROLES } from './lib/chain.ts';
import { loadEnv } from './lib/keys.ts';
import { line } from './lib/log.ts';

loadEnv();
const ctx = await connect(process.env.RPC_URL ?? 'https://sepolia.base.org');
const { accounts, publicClient, walletClient, read, send } = ctx;
// covers the L2 fee plus the L1 data fee of one plain transfer, with room to spare
const RESERVE = parseEther('0.00002');

for (const role of ROLES.filter((r) => r !== 'deployer')) {
  const account = accounts[role];
  const staked = await read<bigint>('SurvivalOracle', 'available', [account.address]);
  if (staked > 0n) await send(`${role} unstakes ${formatEther(staked)}`, { account, contract: 'SurvivalOracle', functionName: 'unstake', args: [staked] });
  const owed = await read<bigint>('MilestoneEscrow', 'withdrawable', [account.address]);
  if (owed > 0n) await send(`${role} withdraws ${formatEther(owed)}`, { account, contract: 'MilestoneEscrow', functionName: 'withdraw' });

  const balance = await publicClient.getBalance({ address: account.address });
  if (balance <= RESERVE) {
    line(`${role.padEnd(14)} ${formatEther(balance)} ETH, nothing to send`);
    continue;
  }
  const hash = await walletClient.sendTransaction({ account, to: accounts.deployer.address, value: balance - RESERVE });
  await publicClient.waitForTransactionReceipt({ hash });
  line(`${role.padEnd(14)} sent ${formatEther(balance - RESERVE)} ETH to the deployer`);
}
line(`deployer balance ${formatEther(await publicClient.getBalance({ address: accounts.deployer.address }))} ETH`);
