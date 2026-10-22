// Loads .env and resolves the deployer key, either from DEPLOYER_KEY or from an encrypted keystore
// (DEPLOYER_KEYSTORE + DEPLOYER_PASSWORD_FILE). Decrypted keys stay in memory; nothing here prints them.
import { createDecipheriv, scryptSync } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { keccak256, type Hex } from 'viem';
import { fromRoot } from './paths.ts';

let loaded = false;

export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  if (existsSync(fromRoot('.env'))) process.loadEnvFile(fromRoot('.env'));
}

export function deployerKey(): Hex | undefined {
  loadEnv();
  if (process.env.DEPLOYER_KEY) return process.env.DEPLOYER_KEY as Hex;
  const keystore = process.env.DEPLOYER_KEYSTORE;
  const passwordFile = process.env.DEPLOYER_PASSWORD_FILE;
  if (!keystore || !passwordFile) return undefined;
  return decryptKeystore(readFileSync(keystore, 'utf8'), readFileSync(passwordFile, 'utf8').trim());
}

/** Web3 Secret Storage v3 (scrypt + aes-128-ctr), as written by ethers or geth. */
export function decryptKeystore(json: string, password: string): Hex {
  const ks = JSON.parse(json);
  const c = ks.crypto ?? ks.Crypto;
  if (c.kdf !== 'scrypt' || c.cipher !== 'aes-128-ctr') throw new Error(`unsupported keystore: ${c.kdf}/${c.cipher}`);
  const { n, r, p, dklen, salt } = c.kdfparams;
  const derived = scryptSync(password.normalize('NFKC'), Buffer.from(salt, 'hex'), dklen, {
    N: n, r, p, maxmem: 256 * n * r + 1024 * 1024,
  });
  const ciphertext = Buffer.from(c.ciphertext, 'hex');
  const mac = keccak256(Buffer.concat([derived.subarray(16, 32), ciphertext])).slice(2);
  if (mac !== c.mac.toLowerCase()) throw new Error('keystore password is wrong (MAC mismatch)');
  const decipher = createDecipheriv('aes-128-ctr', derived.subarray(0, 16), Buffer.from(c.cipherparams.iv, 'hex'));
  return `0x${Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('hex')}`;
}
