// Deploys a fresh set of contracts with contracts/script/Deploy.s.sol to RPC_URL (default Base Sepolia)
// and writes deployments/<chainId>.json. The deployer key comes from .env (DEPLOYER_KEY or the
// encrypted DEPLOYER_KEYSTORE); it is handed to forge through the child's environment only.
//
//   node scripts/deploy.ts [--verify]     --verify also submits the sources to Sourcify (no API key needed)
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { deployerKey, loadEnv } from './lib/keys.ts';
import { fromRoot } from './lib/paths.ts';

loadEnv();
const key = deployerKey();
if (!key) throw new Error('set DEPLOYER_KEY or DEPLOYER_KEYSTORE + DEPLOYER_PASSWORD_FILE in .env');
const rpcUrl = process.env.RPC_URL ?? 'https://sepolia.base.org';

const args = ['script', 'script/Deploy.s.sol:Deploy', '--rpc-url', rpcUrl, '--broadcast', '--slow'];
if (process.argv.includes('--verify')) args.push('--verify', '--verifier', 'sourcify');

const result = spawnSync('forge', args, {
  cwd: fromRoot('contracts'),
  stdio: 'inherit',
  env: { ...process.env, DEPLOYER_KEY: key, PATH: `${process.env.PATH}:${homedir()}/.foundry/bin` },
});
process.exit(result.status ?? 1);
