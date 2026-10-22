// Mirrors MilestoneEscrow.trancheAmount / payoutFor so the UI can show amounts for epochs that have not
// settled yet (and what a rejected claim would have released). Settled amounts always come from events.

export const BPS = 10_000;

export function trancheAmount(total: bigint, epochCount: number, epoch: number): bigint {
  const cumulative = (i: number) =>
    (total * BigInt((i + 1) * (i + 4))) / BigInt(epochCount * (epochCount + 3));
  return cumulative(epoch) - (epoch === 0 ? 0n : cumulative(epoch - 1));
}

export function trancheWeightBps(epochCount: number, epoch: number): number {
  return Math.round(((epoch + 2) * 2 * BPS) / (epochCount * (epochCount + 3)));
}

export function payoutFor(tranche: bigint, survivalBps: number, thresholdBps: number): bigint {
  if (survivalBps <= thresholdBps) return 0n;
  if (survivalBps >= BPS) return tranche;
  return (tranche * BigInt(survivalBps - thresholdBps)) / BigInt(BPS - thresholdBps);
}

/** Release share f(s) in basis points, for plotting. */
export function releaseShareBps(survivalBps: number, thresholdBps: number): number {
  if (survivalBps <= thresholdBps) return 0;
  if (survivalBps >= BPS) return BPS;
  return Math.floor(((survivalBps - thresholdBps) * BPS) / (BPS - thresholdBps));
}
