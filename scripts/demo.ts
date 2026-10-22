// The whole story in one run: register three plots, fund them, attest, settle the first tranche,
// then catch a verifier lying about the burned plot.
//
//   RPC_URL=http://127.0.0.1:8545 node scripts/demo.ts      (scripts/demo-local.sh does this for you)
//
// Expects a fresh deployment at deployments/<chainId>.json (contracts/script/Deploy.s.sol).
// Env: ESCROW_PER_PROJECT (ether, default 0.02); on a public chain also the *_KEY variables in .env.example.
import { readFileSync } from 'node:fs';
import { formatEther, keccak256, parseEther, toBytes, type Address, type Hash } from 'viem';
import { connect, type Role } from './lib/chain.ts';
import { canonicalGeoJson, canonicalRing, h3Cells, ringFromGeoJson, shiftRing } from './lib/geo.ts';
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
  placeholder: boolean;
}

interface AttestationFile {
  plotHash: Hash;
  epoch: number;
  fixture?: boolean;
  metrics: { survivalRatioBps: number };
}

interface AttestationView {
  submittedAt: bigint;
}

type EscrowView = readonly [Address, bigint, bigint, bigint, number];

const rpcUrl = process.env.RPC_URL ?? 'http://127.0.0.1:8545';
const escrowPerProject = parseEther(process.env.ESCROW_PER_PROJECT ?? '0.02');

const ctx = await connect(rpcUrl);
const { accounts, deployment, publicClient, send, expectRevert, read } = ctx;

const manifest = readJson<{ plots: ManifestPlot[] }>(fromRoot('data/plots/manifest.json'));
const plotFor = (role: ManifestPlot['role']) => {
  const plot = manifest.plots.find((p) => p.role === role);
  if (!plot) throw new Error(`manifest has no ${role} plot`);
  return plot;
};
const plots = [plotFor('healthy'), plotFor('degraded'), plotFor('burned')];
const burned = plotFor('burned');

const verifierStake = await read<bigint>('SurvivalOracle', 'verifierStake');
const challengeBond = await read<bigint>('SurvivalOracle', 'challengeBond');
const challengeWindow = await read<bigint>('SurvivalOracle', 'challengeWindow');
if (deployment.arbiter.toLowerCase() !== accounts.deployer.address.toLowerCase()) {
  throw new Error(`demo resolves disputes as the deployer, but the arbiter is ${deployment.arbiter}`);
}

const eth = (wei: bigint) => `${Number(formatEther(wei)).toFixed(6)} ETH`;
const pct = (bps: bigint | number) => `${(Number(bps) / 100).toFixed(2)}%`;
const short = (hex: string) => `${hex.slice(0, 10)}…${hex.slice(-6)}`;

function loadAttestation(plotId: string, name: string) {
  const path = `data/attestations/${plotId}/${name}.json`;
  const bytes = readFileSync(fromRoot(path));
  const json = JSON.parse(bytes.toString('utf8')) as AttestationFile;
  return { path, json, evidenceHash: keccak256(bytes), survivalBps: json.metrics.survivalRatioBps };
}

console.log(bold('\nProof of Canopy — demo run'));
line(`chain            ${ctx.chain.name} (${ctx.chainId})`);
line(`ProjectRegistry  ${deployment.ProjectRegistry}`);
line(`SurvivalOracle   ${deployment.SurvivalOracle}`);
line(`MilestoneEscrow  ${deployment.MilestoneEscrow}`);
line(`stake ${eth(verifierStake)} · bond ${eth(challengeBond)} · challenge window ${challengeWindow}s`);
if (manifest.plots.some((p) => p.placeholder)) line(yellow('plots are placeholders until G1 picks the real polygons'));

// ------------------------------------------------------------------------------------------------
if (!ctx.isLocal) {
  step(0, 'Top up role accounts from the deployer');
  const gas = parseEther(process.env.GAS_BUFFER ?? '0.002');
  const needs: [Role, bigint][] = [
    ['developer', gas],
    ['funder', escrowPerProject * 3n + challengeBond + gas],
    ['verifier', verifierStake * 3n + gas],
    ['rogueVerifier', verifierStake + gas],
  ];
  for (const [role, need] of needs) {
    const balance = await publicClient.getBalance({ address: accounts[role].address });
    if (balance >= need) continue;
    const hash = await ctx.walletClient.sendTransaction({
      account: accounts.deployer, to: accounts[role].address, value: need - balance,
    });
    await publicClient.waitForTransactionReceipt({ hash });
    line(`${`fund ${role} +${eth(need - balance)}`.padEnd(40)} ${dim(hash)}`);
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
step(4, 'Verifier stakes and attests epoch 0 for each plot');
await send(`stake ${eth(verifierStake * 3n)}`, {
  account: accounts.verifier, contract: 'SurvivalOracle', functionName: 'stake', value: verifierStake * 3n,
});
const attestationIds = new Map<string, bigint>();
const records: Record<string, unknown>[] = [];
for (const plot of plots) {
  const a = loadAttestation(plot.id, 'epoch-0');
  if (a.json.plotHash !== plot.plotHash) throw new Error(`${a.path} is for a different plot geometry`);
  const { result } = await send<bigint>(`attest ${plot.id} = ${pct(a.survivalBps)}`, {
    account: accounts.verifier, contract: 'SurvivalOracle', functionName: 'submitAttestation',
    args: [projectIds.get(plot.id), 0, a.survivalBps, a.evidenceHash],
  });
  attestationIds.set(plot.id, result);
  line(dim(`  evidence ${a.path} → keccak256 ${short(a.evidenceHash)}${a.json.fixture ? ' (fixture)' : ''}`));
  records.push({
    attestationId: result.toString(), plotId: plot.id, epoch: 0, survivalBps: a.survivalBps,
    evidenceFile: a.path, evidenceHash: a.evidenceHash, verifier: accounts.verifier.address,
  });
}

// ------------------------------------------------------------------------------------------------
step(5, `Challenge window (${challengeWindow}s)`);
const lastId = attestationIds.get(burned.id)!;
const last = await read<AttestationView>('SurvivalOracle', 'getAttestation', [lastId]);
await ctx.waitUntil(last.submittedAt + challengeWindow);
process.stdout.write('\r');
line(ctx.isLocal ? dim('anvil: fast-forwarded chain time past the window') : 'window closed');
line('no challenges → attestations can be finalized');

// ------------------------------------------------------------------------------------------------
step(6, 'Finalize and release tranche 0');
for (const plot of plots) {
  await send(`finalize attestation #${attestationIds.get(plot.id)}`, {
    account: accounts.funder, contract: 'SurvivalOracle', functionName: 'finalize',
    args: [attestationIds.get(plot.id)],
  });
  await send(`release project #${projectIds.get(plot.id)} epoch 0`, {
    account: accounts.funder, contract: 'MilestoneEscrow', functionName: 'release',
    args: [projectIds.get(plot.id), 0],
  });
}

console.log();
line(bold(`${'plot'.padEnd(22)} ${'survival'.padStart(9)} ${'tranche 0'.padStart(15)} ${'released'.padStart(15)} ${'share'.padStart(8)} ${'frozen'.padStart(15)}`));
for (const plot of plots) {
  const id = projectIds.get(plot.id)!;
  const [, total, released, frozen] = await read<EscrowView>('MilestoneEscrow', 'escrows', [id]);
  const tranche = await read<bigint>('MilestoneEscrow', 'trancheAmount', [total, EPOCHS, 0]);
  const survival = records.find((r) => r.plotId === plot.id)!.survivalBps as number;
  const share = tranche === 0n ? 0n : (released * 10_000n) / tranche;
  const colour = share === 0n ? red : share > 5000n ? green : yellow;
  line(`${plot.id.padEnd(22)} ${pct(survival).padStart(9)} ${eth(tranche).padStart(15)} ${eth(released).padStart(15)} ${colour(pct(share).padStart(8))} ${eth(frozen).padStart(15)}`);
}
console.log();
const owed = await read<bigint>('MilestoneEscrow', 'withdrawable', [accounts.developer.address]);
await send(`developer withdraws ${eth(owed)}`, {
  account: accounts.developer, contract: 'MilestoneEscrow', functionName: 'withdraw',
});

// ------------------------------------------------------------------------------------------------
step(7, 'A verifier lies: "the burned forest recovered"');
const burnedId = projectIds.get(burned.id)!;
const lie = loadAttestation(burned.id, 'epoch-1.rogue');
const truth = loadAttestation(burned.id, 'epoch-1');
const [, burnedTotal] = await read<EscrowView>('MilestoneEscrow', 'escrows', [burnedId]);
const tranche1 = await read<bigint>('MilestoneEscrow', 'trancheAmount', [burnedTotal, EPOCHS, 1]);
const wouldPay = await read<bigint>('MilestoneEscrow', 'payoutFor', [tranche1, lie.survivalBps, THRESHOLD_BPS]);

await send(`rogue verifier stakes ${eth(verifierStake)}`, {
  account: accounts.rogueVerifier, contract: 'SurvivalOracle', functionName: 'stake', value: verifierStake,
});
const { result: lieId } = await send<bigint>(`attest ${burned.id} epoch 1 = ${pct(lie.survivalBps)}`, {
  account: accounts.rogueVerifier, contract: 'SurvivalOracle', functionName: 'submitAttestation',
  args: [burnedId, 1, lie.survivalBps, lie.evidenceHash],
});
line(dim(`  if unchallenged this would release ${eth(wouldPay)} of a ${eth(tranche1)} tranche`));

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
const rogueLeft = await read<bigint>('SurvivalOracle', 'available', [accounts.rogueVerifier.address]);
const burnedNow = (await publicClient.getBalance({ address: BURN_ADDRESS })) - burnBefore;
console.log();
line(`rogue verifier stake    ${red(`-${eth(verifierStake)}`)}   (left: ${eth(rogueLeft)})`);
line(`challenger              ${green(`+${eth(funderAfter - funderBefore - challengeBond)}`)}   reward, plus bond returned`);
line(`burned to 0x…dEaD       ${eth(burnedNow)}`);
line(`released to developer   ${eth(0n)}   (the lie paid nothing)`);

const { result: truthId } = await send<bigint>(`slot reopens: honest attest = ${pct(truth.survivalBps)}`, {
  account: accounts.verifier, contract: 'SurvivalOracle', functionName: 'submitAttestation',
  args: [burnedId, 1, truth.survivalBps, truth.evidenceHash],
});
records.push(
  {
    attestationId: lieId.toString(), plotId: burned.id, epoch: 1, survivalBps: lie.survivalBps,
    evidenceFile: lie.path, evidenceHash: lie.evidenceHash, verifier: accounts.rogueVerifier.address,
    outcome: 'rejected after challenge',
  },
  {
    attestationId: truthId.toString(), plotId: burned.id, epoch: 1, survivalBps: truth.survivalBps,
    evidenceFile: truth.path, evidenceHash: truth.evidenceHash, verifier: accounts.verifier.address,
    outcome: 'pending',
  },
);

// ------------------------------------------------------------------------------------------------
const outPath = fromRoot('deployments', `${ctx.chainId}.demo.json`);
writeJson(outPath, {
  chainId: ctx.chainId,
  ranAt: new Date().toISOString(),
  contracts: {
    ProjectRegistry: deployment.ProjectRegistry,
    SurvivalOracle: deployment.SurvivalOracle,
    MilestoneEscrow: deployment.MilestoneEscrow,
  },
  roles: Object.fromEntries(Object.entries(accounts).map(([role, account]) => [role, account.address])),
  projects: plots.map((p) => ({ plotId: p.id, role: p.role, projectId: projectIds.get(p.id)!.toString(), plotHash: p.plotHash })),
  attestations: records,
  transactions: ctx.txLog,
});
console.log(`\n${green('✓')} ${ctx.txLog.length} transactions · log written to ${outPath}\n`);
