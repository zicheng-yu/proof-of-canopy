// Writes a deliberately false attestation for the dispute demo: it cites the real series file but
// claims a survival value the series does not support, with canopy numbers inflated to match, so the
// file is internally consistent and only recomputing from the series exposes it.
//
//   node oracle/stage-false-claim.ts <plotId> <epoch> <claimedBps>
import { readFileSync } from 'node:fs';
import { fromRoot, writeJson } from '../scripts/lib/paths.ts';
import { round6, survivalBps } from '../shared/method.ts';

const [plotId, epochArg, bpsArg] = process.argv.slice(2);
if (!bpsArg) throw new Error('usage: node oracle/stage-false-claim.ts <plotId> <epoch> <claimedBps>');
const honest = JSON.parse(readFileSync(fromRoot('data/attestations', plotId, `epoch-${epochArg}.json`), 'utf8'));
const claimed = Number(bpsArg);
const base = honest.metrics.canopyFractionBaseline as number;

// smallest observed fraction (6 decimals) whose ratio floors to exactly the claimed bps
let observed = round6((base * claimed) / 10_000);
while (survivalBps(base, observed) < claimed) observed = round6(observed + 0.000001);

writeJson(fromRoot('data/attestations', plotId, `epoch-${epochArg}.false-claim.json`), {
  ...honest,
  staged: true,
  stagedNote: 'Deliberately false claim for the dispute demo. Its canopy numbers are inflated; recomputing them from the cited series file does not reproduce them.',
  metrics: { ...honest.metrics, canopyFractionObserved: observed, survivalRatioBps: claimed },
});
console.log(`${plotId} epoch ${epochArg}: honest ${honest.metrics.survivalRatioBps} bps, false claim ${claimed} bps (observed ${observed})`);
