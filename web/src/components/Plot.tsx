// Small pieces shared by the overview cards and the plot record.
import type { ReactNode } from 'react';
import type { PlotStatus, Project } from '../chain/derive';
import type { PlotMeta } from '../data/plots';
import { trancheAmount } from '../lib/escrowMath';
import { pct } from '../lib/format';
import { CheckCircle, Clock, Flame, Warning, XCircle } from './icons';

const STATUS: Record<PlotStatus, { label: string; icon: ReactNode }> = {
  unsettled: { label: 'Awaiting first settlement', icon: <Clock /> },
  holding: { label: 'Canopy holding', icon: <CheckCircle /> },
  degrading: { label: 'Degrading', icon: <Warning /> },
  lost: { label: 'Canopy lost', icon: <XCircle /> },
};

export function StatusBadge({ status, meta }: { status: PlotStatus; meta?: PlotMeta }) {
  // The cause (fire) comes from the plot's description; the status itself comes from the chain.
  const burned = status === 'lost' && meta?.role === 'burned';
  const { label, icon } = STATUS[status];
  return (
    <span className="badge">
      {burned ? <Flame /> : icon}
      {burned ? 'Burned · tranche frozen' : label}
    </span>
  );
}

const CELLS = 256;

/** Baseline canopy as 256 cells: dark = still present, light = lost since baseline. */
export function Waffle({ survivalBps }: { survivalBps?: number }) {
  const live = survivalBps === undefined ? 0 : Math.round((CELLS * survivalBps) / 10_000);
  const label = survivalBps === undefined
    ? 'No settled epoch yet'
    : `${pct(survivalBps)} of baseline canopy still present, ${pct(10_000 - survivalBps)} lost`;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="waffle" role="img" aria-label={label}>
        {Array.from({ length: CELLS }, (_, i) => (
          <i key={i} className={survivalBps === undefined ? 'empty' : i < live ? undefined : 'lost'} />
        ))}
      </div>
      <div className="legend">
        <span><span className="sw canopy" />Canopy still present</span>
        <span><span className="sw lost" />Lost since baseline</span>
        <span>1 cell = 1/256 of baseline canopy</span>
      </div>
    </div>
  );
}

export type EpochPhase = 'settled' | 'window' | 'open';

export interface EpochView {
  epoch: number;
  tranche: bigint;
  weightPct: number;
  phase: EpochPhase;
  released?: bigint;
  frozen?: bigint;
  survivalBps?: number;
}

export function epochViews(p: Project, attestationStatus: (epoch: number) => 'none' | 'live' | 'final'): EpochView[] {
  const total = p.funding?.amount ?? 0n;
  return Array.from({ length: p.epochCount }, (_, epoch) => {
    const s = p.settlements.find((x) => x.epoch === epoch);
    const weightPct = Math.round(((epoch + 2) * 200) / (p.epochCount * (p.epochCount + 3)));
    const tranche = total > 0n ? trancheAmount(total, p.epochCount, epoch) : 0n;
    if (s) return { epoch, tranche: s.tranche, weightPct, phase: 'settled', released: s.released, frozen: s.frozen, survivalBps: s.survivalBps };
    return { epoch, tranche, weightPct, phase: attestationStatus(epoch) === 'none' ? 'open' : 'window' };
  });
}

/** Compact five-segment schedule: widths follow tranche weights. */
export function TrancheStrip({ epochs }: { epochs: EpochView[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12, color: 'var(--ink-3)' }}>
        <span>{epochs.length}-year schedule</span>
        <span className="mono">{epochs.map((e) => e.weightPct).join(' · ')} %</span>
      </div>
      <div className="strip" role="img"
        aria-label={epochs.map((e) => `Epoch ${e.epoch}: ${e.phase === 'settled' ? `${shareText(e)} released` : e.phase === 'window' ? 'attested, in challenge window' : 'not yet attested'}`).join('; ')}>
        {epochs.map((e) => (
          <div key={e.epoch} style={{ flex: `${e.weightPct} 1 0` }}
            className={e.phase === 'settled' ? 'seg-settled' : e.phase === 'window' ? 'seg-window' : 'seg-open'}>
            {e.phase === 'settled' && <div style={{ width: `${releasedWidth(e)}%` }} />}
          </div>
        ))}
      </div>
      <Legend />
    </div>
  );
}

export function Legend({ withWindow }: { withWindow?: boolean }) {
  return (
    <div className="legend">
      <span><span className="sw released" />Released</span>
      <span><span className="sw frozen" />Frozen</span>
      {withWindow && <span><span className="sw window" />Attested, in challenge window</span>}
      <span><span className="sw unsettled" />Not yet settled</span>
    </div>
  );
}

export function releasedWidth(e: EpochView): number {
  if (!e.tranche || e.released === undefined) return 0;
  return Number((e.released * 10_000n) / e.tranche) / 100;
}

export function shareText(e: EpochView): string {
  if (!e.tranche || e.released === undefined) return '—';
  return pct(Number((e.released * 10_000n) / e.tranche));
}
