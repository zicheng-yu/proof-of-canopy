import { releaseShareBps } from '../lib/escrowMath';
import { pct } from '../lib/format';

export interface CurvePoint {
  label: string;
  survivalBps: number;
  color: string;
}

/** The release rule f(s) with each plot's latest settled epoch placed on it. */
export function ReleaseCurve({ thresholdBps, points }: { thresholdBps: number; points: CurvePoint[] }) {
  const L = 56, R = 500, T = 24, B = 290;
  const x = (bps: number) => L + ((R - L) * bps) / 10_000;
  const y = (bps: number) => B - ((B - T) * bps) / 10_000;
  const tx = x(thresholdBps);

  const placed = points
    .map((p) => {
      const share = releaseShareBps(p.survivalBps, thresholdBps);
      const px = x(p.survivalBps);
      const py = y(share);
      const nearLeft = px < 190;
      const anchor: 'middle' | 'end' = nearLeft ? 'middle' : 'end';
      return { ...p, share, px, py, lx: nearLeft ? px : px - 12, ly: nearLeft ? py - 16 : py - 8, anchor };
    })
    .sort((a, b) => a.ly - b.ly);
  for (let i = 1; i < placed.length; i++) {
    if (placed[i].ly - placed[i - 1].ly < 18) placed[i].ly = placed[i - 1].ly + 18;
  }

  const summary = points
    .map((p) => `${p.label} at ${pct(p.survivalBps, 0)} releases ${pct(releaseShareBps(p.survivalBps, thresholdBps), 1)}`)
    .join('; ');

  return (
    <svg viewBox="0 0 520 340" width="100%" role="img" style={{ display: 'block', overflow: 'visible', fontFamily: 'var(--sans)' }}
      aria-label={`Release rule. Nothing is released at or below ${pct(thresholdBps, 0)} of baseline canopy; above that, release rises linearly to 100% at full canopy. ${summary}.`}>
      <rect x={L} y={T} width={tx - L} height={B - T} fill="#eeefea" />
      <text x={L + 10} y={T + 22} fontSize="11" fill="var(--ink-3)" fontFamily="var(--mono)" letterSpacing="0.06em">NO RELEASE AT OR BELOW T</text>
      {[T, (T + B) / 2].map((gy) => <line key={gy} x1={L} x2={R} y1={gy} y2={gy} stroke="#e1e3dd" />)}
      <line x1={L} x2={R} y1={B} y2={B} stroke="#9aa197" />
      <text x={L - 10} y={T + 4} fontSize="12" fill="var(--ink-3)" textAnchor="end">100%</text>
      <text x={L - 10} y={(T + B) / 2 + 4} fontSize="12" fill="var(--ink-3)" textAnchor="end">50%</text>
      <text x={L - 10} y={B + 4} fontSize="12" fill="var(--ink-3)" textAnchor="end">0%</text>
      {[0, 5000, 10_000].map((b) => (
        <text key={b} x={x(b)} y={B + 20} fontSize="12" fill="var(--ink-3)" textAnchor="middle">{pct(b, 0)}</text>
      ))}
      <text x={tx} y={B + 20} fontSize="12" fill="var(--ink)" fontWeight="600" textAnchor="middle">{pct(thresholdBps, 0)}</text>
      <line x1={tx} x2={tx} y1={T} y2={B} stroke="var(--ink-2)" strokeDasharray="4 4" />
      <text x={tx - 6} y={B - 10} fontSize="12" fill="var(--ink)" textAnchor="end">T = {pct(thresholdBps, 0)}</text>
      <path d={`M${L} ${B} H${tx} L${R} ${T}`} fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" />
      {placed.map((p) => (
        <g key={p.label}>
          <circle cx={p.px} cy={p.py} r="6" fill={p.color} stroke="#fff" strokeWidth="2">
            <title>{`${p.label}: ${pct(p.survivalBps)} canopy retained → ${pct(p.share)} of the tranche released`}</title>
          </circle>
          <text x={p.lx} y={p.ly} fontSize="13" fill="var(--ink)" textAnchor={p.anchor}>
            <tspan fontWeight="600">{p.label}</tspan> {pct(p.survivalBps, 0)} → {pct(p.share, 1)}
          </text>
        </g>
      ))}
      <text x={(L + R) / 2} y={B + 44} fontSize="13" fill="var(--ink-2)" textAnchor="middle">Canopy retained vs. baseline</text>
      <text x={-(T + B) / 2} y="14" fontSize="13" fill="var(--ink-2)" textAnchor="middle" transform="rotate(-90)">Share of tranche released</text>
    </svg>
  );
}

export interface EpochScore {
  epoch: number;
  survivalBps: number;
  state: 'final' | 'window' | 'rejected';
  color: string;
}

/** Attested canopy retention per epoch, against the release threshold. */
export function EpochScores({ epochCount, thresholdBps, scores }: { epochCount: number; thresholdBps: number; scores: EpochScore[] }) {
  const L = 48, R = 620, T = 20, B = 240;
  const band = (R - L) / epochCount;
  const cx = (e: number) => L + band * (e + 0.5);
  const y = (bps: number) => B - ((B - T) * bps) / 10_000;
  return (
    <svg viewBox="0 0 640 290" width="100%" role="img" style={{ display: 'block', overflow: 'visible', fontFamily: 'var(--sans)' }}
      aria-label={`Attested canopy retained by epoch. ${scores.map((s) => `Epoch ${s.epoch}: ${pct(s.survivalBps)} (${s.state === 'final' ? 'final' : s.state === 'window' ? 'in challenge window' : 'rejected'})`).join('; ') || 'No attestations yet'}.`}>
      {Array.from({ length: epochCount }, (_, e) => e % 2 === 0 && (
        <rect key={e} x={L + band * e} y={T} width={band} height={B - T} fill="#f7f7f4" />
      ))}
      {[0, 2500, 5000, 7500, 10_000].map((b) => (
        <g key={b}>
          <line x1={L} x2={R} y1={y(b)} y2={y(b)} stroke={b === 0 ? '#9aa197' : '#e1e3dd'} />
          <text x={L - 8} y={y(b) + 4} fontSize="12" fill="var(--ink-3)" textAnchor="end">{pct(b, 0)}</text>
        </g>
      ))}
      <line x1={L} x2={R} y1={y(thresholdBps)} y2={y(thresholdBps)} stroke="var(--ink)" strokeDasharray="6 4" />
      <text x={R - 4} y={y(thresholdBps) - 7} fontSize="12" fill="var(--ink)" fontWeight="600" textAnchor="end">T = {pct(thresholdBps, 0)} of baseline</text>
      {Array.from({ length: epochCount }, (_, e) => (
        <text key={e} x={cx(e)} y={B + 22} fontSize="12" fill="var(--ink-3)" textAnchor="middle" fontFamily="var(--mono)">E{e}</text>
      ))}
      {scores.map((s, i) => {
        const same = scores.filter((o) => o.epoch === s.epoch);
        const offset = same.length > 1 ? (same.indexOf(s) - (same.length - 1) / 2) * 34 : 0;
        const px = cx(s.epoch) + offset;
        const py = y(s.survivalBps);
        const labelY = py > T + 30 ? py - 12 : py + 22;
        return (
          <g key={i}>
            {s.state === 'final' && <circle cx={px} cy={py} r="6" fill={s.color} stroke="#fff" strokeWidth="2" />}
            {s.state === 'window' && <circle cx={px} cy={py} r="5.5" fill="#fff" stroke="var(--ink)" strokeWidth="2" strokeDasharray="3 2" />}
            {s.state === 'rejected' && (
              <g stroke="var(--critical)" strokeWidth="2">
                <circle cx={px} cy={py} r="6" fill="#fff" />
                <path d={`M${px - 3.5} ${py - 3.5}l7 7M${px + 3.5} ${py - 3.5}l-7 7`} />
              </g>
            )}
            <text x={px} y={labelY} fontSize="12" fill="var(--ink)" textAnchor="middle"
              textDecoration={s.state === 'rejected' ? 'line-through' : undefined}>{pct(s.survivalBps, 0)}</text>
          </g>
        );
      })}
    </svg>
  );
}
