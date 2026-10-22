// The whole story in one run, on the oracle's Sentinel-2 evidence:
//   register three plots · refuse a double registration · fund · attest every epoch · settle them ·
//   catch a false claim · let the honest claim take its slot · return what stayed frozen.
//
//   RPC_URL=http://127.0.0.1:8545 node scripts/demo.ts      (scripts/demo-local.sh does this for you)
//
// Expects a fresh deployment at deployments/<chainId>.json (contracts/script/Deploy.s.sol) and the
// oracle's files in data/attestations/<plotId>/epoch-<n>.json. The plot/epoch that also has an
// epoch-<n>.false-claim.json is held back for the dispute.
// Env (.env is loaded): ESCROW_PER_PROJECT (ether, default 0.003); on a public chain the keys in .env.example.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { formatEther, keccak256, parseEther, toBytes, type Address, type Hash } from 'viem';
import { connect, type Role } from './lib/chain.ts';
import { canonicalGeoJson, canonicalRing, h3Cells, ringFromGeoJson, shiftRing } from './lib/geo.ts';
import { loadEnv } from './lib/keys.ts';
import { bold, dim, green, line, red, step, yellow } from './lib/log.ts';
import { fromRoot, readJson, writeJson } from './lib/paths.ts';

const EPOCHS = 5;
const THRESHOLD_BPS = 7000;
const BURN_ADDRESS: Address = '0x000000000000000000000000000000000000dEaD';

interface ManifestPlot {
  id: string;
  role: 'healthy' | 'degraded' | 'burned';
  name: string;
  file: string;
  plotHash: Hash;
  areaHectares: number;
  cells: string[];
}

interface Evidence {
  plotId: string;
  epoch: number;
  path: string;
  evidenceHash: Hash;
  survivalBps: number;
  falseClaim: boolean;
}

interface AttestationView {
  submittedAt: bigint;
}

type EscrowView = readonly [Address, bigint, bigint, bigint, number];

loadEnv();
const rpcUrl = process.env.RPC_URL ?? 'http://127.0.0.1:8545';
const escrowPerProject = parseEther(process.env.ESCROW_PER_PROJECT ?? '0.003');

const ctx = await connect(rpcUrl);
const { accounts, deployment, publicClient, send, expectRevert, read } = ctx;

const manifest = readJson<{ plots: ManifestPlot[] }>(fromRoot('data/plots/manifest.json'));
const plotFor = (role: ManifestPlot['role']) => {
  const plot = manifest.plots.find((p) => p.role === role);
  if (!plot) throw new Error(`manifest has no ${role} plot`);
  return plot;
};
const plots = [plotFor('healthy'), plotFor('degraded'), plotFor('burned')];

const evidence: Evidence[] = plots.flatMap((plot) => {
  const dir = `data/attestations/${plot.id}`;
  if (!existsSync(fromRoot(dir))) throw new Error(`${dir} missing; run the oracle first`);
  return readdirSync(fromRoot(dir))
    .map((name) => name.match(/^epoch-(\d+)(\.false-claim)?\.json$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => {
      const path = `${dir}/${m[0]}`;
      const bytes = readFileSync(fromRoot(path));
      const json = JSON.parse(bytes.toString('utf8'));
      if (json.plotHash !== plot.plotHash) throw new Error(`${path} is for a different plot geometry`);
      return { plotId: plot.id, epoch: Number(m[1]), path, evidenceHash: keccak256(bytes), survivalBps: json.metrics.survivalRatioBps, falseClaim: Boolean(m[2]) };
    });
});
const lie = evidence.find((e) => e.falseClaim);
const truth = lie && evidence.find((e) => !e.falseClaim && e.plotId === lie.plotId && e.epoch === lie.epoch);
const honest = evidence.filter((e) => !e.falseClaim && e !== truth);

const verifierStake = await read<bigint>('SurvivalOracle', 'verifierStake');
const challengeBond = await read<bigint>('SurvivalOracle', 'challengeBond');
const challengeWindow = await read<bigint>('SurvivalOracle', 'challengeWindow');
if (deployment.arbiter.toLowerCase() !== accounts.deployer.address.toLowerCase()) {
  throw new Error(`demo resolves disputes as the deployer, but the arbiter is ${deployment.arbiter}`);
}

const eth = (wei: bigint) => `${Number(formatEther(wei)).toFixed(6)} ETH`;
const pct = (bps: bigint | number) => `${(Number(bps) / 100).toFixed(2)}%`;
const short = (hex: string) => `${hex.slice(0, 10)}…${hex.slice(-6)}`;

console.log(bold('\nProof of Canopy — demo run'));
line(`chain            ${ctx.chain.name} (${ctx.chainId})`);
line(`ProjectRegistry  ${deployment.ProjectRegistry}`);
line(`SurvivalOracle   ${deployment.SurvivalOracle}`);
line(`MilestoneEscrow  ${deployment.MilestoneEscrow}`);
line(`stake ${eth(verifierStake)} · bond ${eth(challengeBond)} · challenge window ${challengeWindow}s · ${evidence.length} evidence files`);

// ------------------------------------------------------------------------------------------------
if (!ctx.isLocal) {
  step(0, 'Top up role accounts from the deployer');
  const gas = parseEther(process.env.GAS_BUFFER ?? '0.0003');
  const needs: [Role, bigint][] = [
    ['developer', gas],
    ['funder', escrowPerProject * BigInt(plots.length) + challengeBond + gas],
    ['verifier', verifierStake * BigInt(honest.length) + gas],
    ['rogueVerifier', verifierStake + gas],
  ];
  for (const [role, need] of needs) {
    const balance = await publicClient.getBalance({ address: accounts[role].address });
    if (balance >= need) continue;
    const hash = await ctx.walletClient.sendTransaction({
      account: accounts.deployer, to: accounts[role].address, value: need - balance,
    });
    await publicClient.waitForTransactionReceipt({ hash });
    line(`${`fund ${role} +${eth(need - balance)}`.padEnd(44)} ${dim(hash)}`);
  }
}

// ------------------------------------------------------------------------------------------------
step(1, 'Developer registers three 250 ha plots');
const projectIds = new Map<string, bigint>();
for (const plot of plots) {
  const { result } = await send<bigint>(`register ${plot.id}`, {
    account: accounts.developer, contract: 'ProjectRegistry', functionName: 'register',
    args: [plot.plotHash, plot.cells.map(BigInt), plot.areaHectares, EPOCHS, THRESHOLD_BPS],
  });
  projectIds.set(plot.id, result);
  line(dim(`  project #${result} · plotHash ${short(plot.plotHash)} · ${plot.cells.length} H3 cells · ${plot.role}`));
}

// ------------------------------------------------------------------------------------------------
step(2, 'The same forest cannot be registered twice');
const burned = plotFor('burned');
const sameAgain = await expectRevert({
  account: accounts.developer, contract: 'ProjectRegistry', functionName: 'register',
  args: [burned.plotHash, burned.cells.map(BigInt), burned.areaHectares, EPOCHS, THRESHOLD_BPS],
});
line(`identical polygon             → ${red(`✗ ${sameAgain}`)}`);
const ring = ringFromGeoJson(readFileSync(fromRoot('data/plots', burned.file), 'utf8'));
const shifted = canonicalRing(shiftRing(ring, 15, 0));
const shiftedHash = keccak256(toBytes(canonicalGeoJson(shifted)));
const overlap = await expectRevert({
  account: accounts.developer, contract: 'ProjectRegistry', functionName: 'register',
  args: [shiftedHash, h3Cells(shifted, 9), burned.areaHectares, EPOCHS, THRESHOLD_BPS],
});
line(`same polygon moved 15 m east  → ${red(`✗ ${overlap}`)}`);
line(dim(`  its plotHash ${short(shiftedHash)} is new, so a hash-only check would have accepted it`));

// ------------------------------------------------------------------------------------------------
step(3, `Funder locks ${eth(escrowPerProject)} per project in escrow`);
for (const plot of plots) {
  await send(`fund project #${projectIds.get(plot.id)}`, {
    account: accounts.funder, contract: 'MilestoneEscrow', functionName: 'fund',
    args: [projectIds.get(plot.id)], value: escrowPerProject,
  });
}

// ------------------------------------------------------------------------------------------------
step(4, `Verifier stakes and attests ${honest.length} epochs from the Sentinel-2 evidence`);
await send(`stake ${eth(verifierStake * BigInt(honest.length))}`, {
  account: accounts.verifier, contract: 'SurvivalOracle', functionName: 'stake', value: verifierStake * BigInt(honest.length),
});
const records: Record<string, unknown>[] = [];
const attestationIds = new Map<Evidence, bigint>();
for (const e of honest) {
  const { result } = await send<bigint>(`attest ${e.plotId} E${e.epoch} = ${pct(e.survivalBps)}`, {
    account: accounts.verifier, contract: 'SurvivalOracle', functionName: 'submitAttestation',
    args: [projectIds.get(e.plotId), e.epoch, e.survivalBps, e.evidenceHash],
  });
  attestationIds.set(e, result);
  records.push({ attestationId: result.toString(), plotId: e.plotId, epoch: e.epoch, survivalBps: e.survivalBps, evidenceFile: e.path, evidenceHash: e.evidenceHash, verifier: accounts.verifier.address });
}

// ------------------------------------------------------------------------------------------------
async function waitWindow(attestationId: bigint) {
  const a = await read<AttestationView>('SurvivalOracle', 'getAttestation', [attestationId]);
  await ctx.waitUntil(a.submittedAt + challengeWindow);
  process.stdout.write('\r');
  line(ctx.isLocal ? dim('anvil: fast-forwarded chain time past the window') : 'window closed');
}

async function settle(e: Evidence, id: bigint) {
  await send(`finalize #${id}`, { account: accounts.funder, contract: 'SurvivalOracle', functionName: 'finalize', args: [id] });
  await send(`release ${e.plotId} E${e.epoch}`, {
    account: accounts.funder, contract: 'MilestoneEscrow', functionName: 'release', args: [projectIds.get(e.plotId), e.epoch],
  });
}

step(5, `Challenge window (${challengeWindow}s)`);
await waitWindow([...attestationIds.values()].at(-1)!);
line('no challenges → attestations can be finalized');

step(6, 'Finalize and release');
for (const [e, id] of attestationIds) await settle(e, id);
await printSchedule();

// ------------------------------------------------------------------------------------------------
if (lie && truth) {
  step(7, `A verifier lies: "${lie.plotId} recovered to ${pct(lie.survivalBps)} in epoch ${lie.epoch}"`);
  const projectId = projectIds.get(lie.plotId)!;
  const [, total] = await read<EscrowView>('MilestoneEscrow', 'escrows', [projectId]);
  const tranche = await read<bigint>('MilestoneEscrow', 'trancheAmount', [total, EPOCHS, lie.epoch]);
  const wouldPay = await read<bigint>('MilestoneEscrow', 'payoutFor', [tranche, lie.survivalBps, THRESHOLD_BPS]);

  await send(`rogue verifier stakes ${eth(verifierStake)}`, {
    account: accounts.rogueVerifier, contract: 'SurvivalOracle', functionName: 'stake', value: verifierStake,
  });
  const { result: lieId } = await send<bigint>(`attest ${lie.plotId} E${lie.epoch} = ${pct(lie.survivalBps)}`, {
    account: accounts.rogueVerifier, contract: 'SurvivalOracle', functionName: 'submitAttestation',
    args: [projectId, lie.epoch, lie.survivalBps, lie.evidenceHash],
  });
  line(dim(`  evidence ${lie.path} → ${short(lie.evidenceHash)}`));
  line(dim(`  if unchallenged this would release ${eth(wouldPay)} of a ${eth(tranche)} tranche`));

  const burnBefore = await publicClient.getBalance({ address: BURN_ADDRESS });
  const funderBefore = await read<bigint>('SurvivalOracle', 'available', [accounts.funder.address]);
  await send(`funder challenges (bond ${eth(challengeBond)})`, {
    account: accounts.funder, contract: 'SurvivalOracle', functionName: 'challenge',
    args: [lieId, truth.evidenceHash], value: challengeBond,
  });
  line(dim(`  counter-evidence ${truth.path} (${pct(truth.survivalBps)}) → ${short(truth.evidenceHash)}`));
  await send('arbiter upholds the challenge', {
    account: accounts.deployer, contract: 'SurvivalOracle', functionName: 'resolve', args: [lieId, true],
  });
  const funderAfter = await read<bigint>('SurvivalOracle', 'available', [accounts.funder.address]);
  const burnedNow = (await publicClient.getBalance({ address: BURN_ADDRESS })) - burnBefore;
  console.log();
  line(`rogue verifier stake    ${red(`-${eth(verifierStake)}`)}`);
  line(`challenger              ${green(`+${eth(funderAfter - funderBefore - challengeBond)}`)}   reward, plus bond returned`);
  line(`burned to 0x…dEaD       ${eth(burnedNow)}`);
  line(`released for the lie    ${eth(0n)}`);
  records.push({ attestationId: lieId.toString(), plotId: lie.plotId, epoch: lie.epoch, survivalBps: lie.survivalBps, evidenceFile: lie.path, evidenceHash: lie.evidenceHash, verifier: accounts.rogueVerifier.address, outcome: 'rejected after challenge' });

  step(8, 'The slot reopens: the honest attestation goes in');
  const { result: truthId } = await send<bigint>(`attest ${truth.plotId} E${truth.epoch} = ${pct(truth.survivalBps)}`, {
    account: accounts.verifier, contract: 'SurvivalOracle', functionName: 'submitAttestation',
    args: [projectId, truth.epoch, truth.survivalBps, truth.evidenceHash],
  });
  records.push({ attestationId: truthId.toString(), plotId: truth.plotId, epoch: truth.epoch, survivalBps: truth.survivalBps, evidenceFile: truth.path, evidenceHash: truth.evidenceHash, verifier: accounts.verifier.address });
  await waitWindow(truthId);
  await settle(truth, truthId);
}

// ------------------------------------------------------------------------------------------------
step(9, 'Every epoch settled: frozen money goes back, earned money goes out');
for (const plot of plots) {
  const [, , , frozen, settled] = await read<EscrowView>('MilestoneEscrow', 'escrows', [projectIds.get(plot.id)]);
  if (settled === EPOCHS && frozen > 0n) {
    await send(`funder reclaims ${eth(frozen)} (${plot.id})`, {
      account: accounts.funder, contract: 'MilestoneEscrow', functionName: 'reclaimFrozen', args: [projectIds.get(plot.id)],
    });
  }
}
for (const role of ['developer', 'funder'] as const) {
  const owed = await read<bigint>('MilestoneEscrow', 'withdrawable', [accounts[role].address]);
  if (owed > 0n) {
    await send(`${role} withdraws ${eth(owed)}`, { account: accounts[role], contract: 'MilestoneEscrow', functionName: 'withdraw' });
  }
}
await printSchedule();

// ------------------------------------------------------------------------------------------------
const outPath = fromRoot('deployments', `${ctx.chainId}.demo.json`);
writeJson(outPath, {
  chainId: ctx.chainId,
  ranAt: new Date().toISOString(),
  contracts: { ProjectRegistry: deployment.ProjectRegistry, SurvivalOracle: deployment.SurvivalOracle, MilestoneEscrow: deployment.MilestoneEscrow },
  roles: Object.fromEntries(Object.entries(accounts).map(([role, account]) => [role, account.address])),
  projects: plots.map((p) => ({ plotId: p.id, role: p.role, projectId: projectIds.get(p.id)!.toString(), plotHash: p.plotHash })),
  attestations: records,
  transactions: ctx.txLog,
});
console.log(`\n${green('✓')} ${ctx.txLog.length} transactions · log written to ${outPath}\n`);

async function printSchedule() {
  console.log();
  line(bold(`${'plot'.padEnd(22)} ${Array.from({ length: EPOCHS }, (_, e) => `E${e}`.padStart(16)).join('')}   ${'released'.padStart(15)} ${'frozen'.padStart(15)}`));
  for (const plot of plots) {
    const id = projectIds.get(plot.id)!;
    const [, , released, frozen] = await read<EscrowView>('MilestoneEscrow', 'escrows', [id]);
    const cells: string[] = [];
    for (let epoch = 0; epoch < EPOCHS; epoch++) {
      const settledEpoch = await read<boolean>('MilestoneEscrow', 'epochSettled', [id, epoch]);
      const e = evidence.find((x) => x.plotId === plot.id && x.epoch === epoch && !x.falseClaim);
      if (!settledEpoch || !e) { cells.push(dim('—'.padStart(16))); continue; }
      const share = Math.floor((Math.max(0, Math.min(10_000, e.survivalBps) - THRESHOLD_BPS) * 10_000) / (10_000 - THRESHOLD_BPS));
      const text = `${(e.survivalBps / 100).toFixed(0)}%→${(share / 100).toFixed(0)}%`.padStart(16);
      cells.push(share === 0 ? red(text) : share >= 5000 ? green(text) : yellow(text));
    }
    line(`${plot.id.padEnd(22)} ${cells.join('')}   ${eth(released).padStart(15)} ${eth(frozen).padStart(15)}`);
  }
  line(dim('cells: canopy retained → share of that epoch’s tranche released'));
}
