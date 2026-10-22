import { useState } from 'react';
import { canopyFraction, validRatio, type MethodParams, type SeriesMonth } from '../../../shared/method.ts';
import { pct } from '../lib/format';

export interface ScoredPoint {
  epoch: number;
  month: string;
  canopy: number;
  survivalBps: number;
  color: string;
}

export interface FireMark {
  month: string;
  firmsDetections: number;
  dnbr: number | null;
}

export interface RejectedClaim {
  epoch: number;
  month: string;
  canopy: number;
  survivalBps: number;
}

interface Props {
  months: SeriesMonth[];
  params: MethodParams;
  baseline: number;
  thresholdBps: number;
  scored: ScoredPoint[];
  fire?: FireMark;
  rejected: RejectedClaim[];
}

const L = 44, R = 744, T = 26, B = 246;

/** Monthly canopy fraction with the scored months, threshold and events drawn on it. */
export function CanopySeries({ months, params, baseline, thresholdBps, scored, fire, rejected }: Props) {
  const [hover, setHover] = useState<number>();
  const n = months.length;
  const x = (i: number) => L + ((R - L) * i) / (n - 1);
  const y = (v: number) => B - (B - T) * v;
  const index = (month: string) => months.findIndex((m) => m.month === month);
  const points = months.map((m) => ({
    m,
    usable: validRatio(m) >= params.minValidRatio,
    c: canopyFraction(m.ndviHistogram, params.canopyNdviThreshold),
  }));

  // line segments through consecutive usable months
  const segments: string[] = [];
  let current = '';
  points.forEach((p, i) => {
    if (p.usable && p.c !== null) current += `${current ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.c).toFixed(1)}`;
    else if (current) { segments.push(current); current = ''; }
  });
  if (current) segments.push(current);

  const years = [...new Set(months.map((m) => Number(m.month.slice(0, 4))))];
  const season = (year: number) => {
    const first = index(`${year}-${String(Math.min(...params.scoredMonths)).padStart(2, '0')}`);
    const last = index(`${year}-${String(Math.max(...params.scoredMonths)).padStart(2, '0')}`);
    return first === -1 || last === -1 ? null : { x0: x(first) - 4, x1: x(last) + 4 };
  };
  const tLevel = (baseline * thresholdBps) / 10_000;
  const h = hover !== undefined ? points[hover] : undefined;

  const summary = scored.map((s) => `epoch ${s.epoch} (${s.month}): ${pct(s.survivalBps)} of baseline`).join('; ');

  return (
    // below ~620 px the labels get too small to read, so narrow screens scroll the chart sideways
    <div style={{ overflowX: 'auto' }}>
    <div style={{ position: 'relative', minWidth: 620 }}>
      <svg viewBox="0 0 760 290" width="100%" role="img" style={{ display: 'block', overflow: 'visible', fontFamily: 'var(--sans)' }}
        aria-label={`Monthly canopy fraction ${months[0].month} to ${months[n - 1].month}. Baseline ${baseline.toFixed(2)}. ${summary}.${fire ? ` Fire in ${fire.month} with ${fire.firmsDetections} FIRMS detections.` : ''}`}
        onMouseLeave={() => setHover(undefined)}>
        {params.baselineYears.map((year) => {
          const s = season(year);
          return s && <rect key={`b${year}`} x={s.x0} y={T} width={s.x1 - s.x0} height={B - T} fill="#eeefea" />;
        })}
        {params.epochYears.map((year, e) => {
          const s = season(year);
          return s && (
            <g key={`e${year}`}>
              <rect x={s.x0} y={T} width={s.x1 - s.x0} height={B - T} fill="#e8ece6" />
              <text x={(s.x0 + s.x1) / 2} y={T - 8} fontSize="11" fill="var(--ink-3)" textAnchor="middle" fontFamily="var(--mono)">E{e}</text>
            </g>
          );
        })}
        <text x={(season(params.baselineYears[0])?.x0 ?? L) + 2} y={T - 8} fontSize="11" fill="var(--ink-3)" fontFamily="var(--mono)">BASELINE</text>
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}>
            <line x1={L} x2={R} y1={y(v)} y2={y(v)} stroke={v === 0 ? '#9aa197' : '#e1e3dd'} />
            <text x={L - 8} y={y(v) + 4} fontSize="12" fill="var(--ink-3)" textAnchor="end">{v}</text>
          </g>
        ))}
        {years.map((year) => {
          const i = index(`${year}-01`);
          return i !== -1 && <text key={year} x={x(i)} y={B + 20} fontSize="12" fill="var(--ink-3)" textAnchor="middle">{year}</text>;
        })}
        <line x1={L} x2={R} y1={y(baseline)} y2={y(baseline)} stroke="var(--ink-2)" strokeDasharray="2 4" />
        <text x={R} y={y(baseline) - 6} fontSize="12" fill="var(--ink-2)" textAnchor="end">baseline {baseline.toFixed(2)}</text>
        <line x1={L} x2={R} y1={y(tLevel)} y2={y(tLevel)} stroke="var(--ink)" strokeDasharray="6 4" />
        <text x={R} y={y(tLevel) - 6} fontSize="12" fill="var(--ink)" fontWeight="600" textAnchor="end">T: {pct(thresholdBps, 0)} of baseline</text>

        {fire && index(fire.month) !== -1 && (
          <g>
            <line x1={x(index(fire.month))} x2={x(index(fire.month))} y1={T} y2={B} stroke="var(--critical)" strokeWidth="1.5" />
            {/* left of the fire line, low down: before a fire the canopy line runs high, so this area is clear */}
            <text x={x(index(fire.month)) - 6} y={y(0.3)} fontSize="12" fill="var(--ink)" textAnchor="end" fontWeight="600">Fire {fire.month}</text>
            <text x={x(index(fire.month)) - 6} y={y(0.3) + 16} fontSize="12" fill="var(--ink-2)" textAnchor="end">
              {fire.firmsDetections} FIRMS detections{fire.dnbr !== null ? ` · dNBR ${fire.dnbr.toFixed(2)}` : ''}
            </text>
          </g>
        )}

        {segments.map((d, i) => <path key={i} d={d} fill="none" stroke="var(--ink-2)" strokeWidth="1.5" strokeLinejoin="round" />)}

        {rejected.map((r) => {
          const i = index(r.month);
          if (i === -1) return null;
          const cx = x(i), cy = y(r.canopy);
          return (
            <g key={`r${r.epoch}`}>
              <circle cx={cx} cy={cy} r="6" fill="#fff" stroke="var(--critical)" strokeWidth="2" />
              <path d={`M${cx - 3.5} ${cy - 3.5}l7 7M${cx + 3.5} ${cy - 3.5}l-7 7`} stroke="var(--critical)" strokeWidth="2" />
              <text x={cx + 10} y={cy + 4} fontSize="12" fill="var(--ink)" textDecoration="line-through">{pct(r.survivalBps, 0)} claimed</text>
            </g>
          );
        })}
        {scored.map((s) => {
          const i = index(s.month);
          if (i === -1) return null;
          const cx = x(i), cy = y(s.canopy);
          return (
            <g key={`s${s.epoch}`}>
              <circle cx={cx} cy={cy} r="5.5" fill={s.color} stroke="#fff" strokeWidth="2" />
              <text x={cx} y={cy > T + 40 ? cy - 11 : cy + 20} fontSize="12" fontWeight="600" fill="var(--ink)" textAnchor="middle">{pct(s.survivalBps, 0)}</text>
            </g>
          );
        })}

        {h && hover !== undefined && <line x1={x(hover)} x2={x(hover)} y1={T} y2={B} stroke="var(--ink)" strokeOpacity="0.35" />}
        {points.map((_, i) => (
          <rect key={i} x={x(i) - (R - L) / (n - 1) / 2} y={T} width={(R - L) / (n - 1)} height={B - T} fill="transparent"
            onMouseEnter={() => setHover(i)} />
        ))}
      </svg>
      {h && hover !== undefined && (
        <div role="status" style={{
          position: 'absolute', top: 8, left: `${(x(hover) / 760) * 100}%`, transform: hover > n / 2 ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)',
          background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 6, padding: '8px 10px', fontSize: 12, lineHeight: 1.5,
          pointerEvents: 'none', whiteSpace: 'nowrap', boxShadow: '0 2px 8px rgba(19,23,18,0.08)',
        }}>
          <div className="mono" style={{ fontWeight: 500 }}>{h.m.month}</div>
          <div>Canopy fraction <span className="mono">{h.c === null ? '—' : h.c.toFixed(3)}</span></div>
          <div>Cloud-free <span className="mono">{(validRatio(h.m) * 100).toFixed(0)}%</span>{!h.usable && ' · not used'}</div>
          <div>NDVI mean <span className="mono">{h.m.ndviMean ?? '—'}</span></div>
        </div>
      )}
    </div>
    </div>
  );
}
