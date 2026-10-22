import { useEffect, useState } from 'react';
import { yearCanopy, type MethodParams, type SeriesMonth } from '../../../shared/method.ts';
import { useChain } from '../chain/ChainProvider';
import { latestSettlement, plotStatus, statusFor, type Attestation, type ChainState, type Project } from '../chain/derive';
import { CanopySeries, type FireMark, type RejectedClaim, type ScoredPoint } from '../components/CanopySeries';
import { EpochScores, type EpochScore } from '../components/Charts';
import { AddressLink, CopyButton, FullHash, TxLink } from '../components/Hash';
import { Layout } from '../components/Layout';
import { Legend, StatusBadge, epochViews, releasedWidth, shareText, type EpochView } from '../components/Plot';
import { PlotMap } from '../components/PlotMap';
import { plotByHash, usePlots, type PlotMeta } from '../data/plots';
import { payoutFor, trancheAmount } from '../lib/escrowMath';
import { eth, pct, shortHex } from '../lib/format';
import { Link } from '../router';
import { STATUS_COLOR, attestationPhase } from './Overview';

export function PlotRecord({ id }: { id: string }) {
  const { state, source } = useChain();
  const plots = usePlots();
  const project = state?.projects.find((p) => p.id.toString() === id);
  const meta = project && plotByHash(plots, project.plotHash);

  if (!state || !plots) return <Layout page="plots"><div className="wrap skeleton">Reading the chain…</div></Layout>;
  if (!project) {
    return (
      <Layout page="plots">
        <div className="wrap skeleton">No project #{id} on {source?.chainName}. <Link to="/">Back to the plots</Link></div>
      </Layout>
    );
  }
  return <Layout page="plots"><Record project={project} meta={meta} state={state} /></Layout>;
}

function Record({ project: p, meta, state }: { project: Project; meta?: PlotMeta; state: ChainState }) {
  const { feed, source } = useChain();
  const explorer = source?.mode === 'live' ? source.explorer : undefined;
  const [cells, setCells] = useState<bigint[]>();
  useEffect(() => {
    feed?.cellsOf(p.id).then(setCells);
  }, [feed, p.id]);

  const attestations = p.attestationIds.map((aid) => state.attestations.get(aid)!);
  const epochs = epochViews(p, attestationPhase(state, p));
  const settled = latestSettlement(p);
  const status = plotStatus(p);
  const disputes = attestations.filter((a) => a.challenge);
  const verifyTarget = attestations.at(-1)?.id;
  const colorFor = (bps: number) => STATUS_COLOR[statusFor(bps, p.thresholdBps)];
  const scores: EpochScore[] = attestations.map((a) => ({
    epoch: a.epoch,
    survivalBps: a.survivalBps,
    state: a.status === 'rejected' ? 'rejected' : a.status === 'finalized' ? 'final' : 'window',
    color: colorFor(a.survivalBps),
  }));
  const evidence = usePlotEvidence(meta?.id);
  const series = evidence && seriesMarks(evidence, attestations, colorFor);

  const name = meta?.name ?? `Project #${p.id}`;
  const summary = !settled
    ? 'No epoch has been settled yet.'
    : settled.released === 0n
      ? `Epoch ${settled.epoch}: ${pct(settled.survivalBps)} of baseline canopy retained, at or below the threshold, so that year’s tranche stayed frozen.`
      : `Epoch ${settled.epoch}: ${pct(settled.survivalBps)} of baseline canopy retained, so ${shareText(epochs[settled.epoch])} of that year’s tranche was released.`;

  return (
    <>
      <section className="wrap" style={{ paddingBlock: '40px 32px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        <nav aria-label="Breadcrumb" className="muted" style={{ fontSize: 14, display: 'flex', gap: 8 }}>
          <Link to="/#plots" style={{ color: 'var(--ink-2)' }}>Plots</Link>
          <span aria-hidden="true">/</span>
          <span className="mono" style={{ color: 'var(--ink)' }}>{meta?.id ?? shortHex(p.plotHash)}</span>
        </nav>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: 20 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 760 }}>
            <div className="mono muted" style={{ fontSize: 13 }}>
              Project #{p.id.toString()} · registered by developer <AddressLink address={p.developer} explorer={explorer} />
            </div>
            <h1 className="title">{name}</h1>
            {meta && <div className="ink-2" style={{ fontSize: 17 }}>{meta.region}</div>}
            <p className="body" style={{ fontSize: 17 }}>
              {summary}
              {disputes.some((a) => a.status === 'rejected') && ' A false claim about this plot was challenged and rejected.'}
            </p>
            {meta?.placeholder && <p className="muted" style={{ margin: 0, fontSize: 13 }}>Boundary is a placeholder until the satellite data check picks the real polygon.</p>}
          </div>
          <StatusBadge status={status} meta={meta} />
        </div>
        <dl className="meta">
          <div><dt>Area</dt><dd>{p.areaHectares} ha</dd></div>
          <div><dt>H3 cells claimed</dt><dd>{p.cellCount} · res 9</dd></div>
          <div><dt>Release threshold</dt><dd>T = {pct(p.thresholdBps, 0)}</dd></div>
          <div><dt>Epochs</dt><dd>{p.epochCount}</dd></div>
          <div><dt>Escrowed</dt><dd>{p.funding ? `${eth(p.funding.amount)} ETH` : 'not funded'}</dd></div>
        </dl>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 14px', fontSize: 13 }} className="muted">
          <span>plotHash, keccak256 of the boundary file</span>
          <FullHash value={p.plotHash} />
          <CopyButton value={p.plotHash} label="Copy plotHash" />
          <Link to={verifyTarget ? `/verify?a=${verifyTarget}` : '/verify'} style={{ fontWeight: 500 }}>Verify against the file</Link>
        </div>
      </section>

      <section className="wrap" style={{ paddingBottom: 64, display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'stretch' }}>
        <figure className="card" style={{ flex: '1 1 380px', minWidth: 0, margin: 0, padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div className="fig-title">Boundary and claimed cells</div>
            <div className="fig-sub">Sentinel-2 cloudless basemap, 2023</div>
          </div>
          {meta && cells ? <PlotMap geojsonUrl={`/data/plots/${meta.file}`} cells={cells} /> : <div className="map" />}
          <figcaption>
            White square: the registered boundary. Hexagons: the {p.cellCount} H3 cells it claims on chain. Any later
            plot that touches one of them is rejected by the registry, however its boundary is drawn.
          </figcaption>
        </figure>
        <figure className="card" style={{ flex: '2 1 560px', minWidth: 0, margin: 0, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {evidence && series ? (
            <>
              <div>
                <div className="fig-title">Canopy, month by month</div>
                <div className="fig-sub">Share of cloud-free 10 m Sentinel-2 pixels with NDVI ≥ {evidence.params.canopyNdviThreshold}</div>
              </div>
              <CanopySeries months={evidence.months} params={evidence.params} baseline={evidence.baseline}
                thresholdBps={p.thresholdBps} scored={series.scored} rejected={series.rejected} fire={evidence.fire} />
              <div className="legend">
                <span><svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="var(--ink-2)" /></svg>Attested month (greenest of Aug–Oct)</span>
                <span><svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="4.5" fill="#fff" stroke="var(--critical)" strokeWidth="1.5" /><path d="M3.5 3.5l5 5M8.5 3.5l-5 5" stroke="var(--critical)" strokeWidth="1.5" /></svg>Claim rejected after challenge</span>
                <span><span className="sw" style={{ background: '#e8ece6' }} />Scored season</span>
              </div>
              <figcaption>
                Each year is scored on its greenest Aug–Oct month: clouds, haze and smoke only lower NDVI, real canopy
                loss lowers every month. Percentages are canopy retained against the 2019–2020 baseline.{' '}
                <a href={`/${evidence.seriesFile}`}>Download the monthly series</a> (JSON, {evidence.months.length} months).
              </figcaption>
            </>
          ) : (
            <>
              <div>
                <div className="fig-title">Attested canopy retained, by epoch</div>
                <div className="fig-sub">Each value is a verifier’s staked claim, relative to the 2019–2020 baseline</div>
              </div>
              <EpochScores epochCount={p.epochCount} thresholdBps={p.thresholdBps} scores={scores} />
              <figcaption>No published Sentinel-2 series matches this plot yet.</figcaption>
            </>
          )}
        </figure>
      </section>

      <section className="wrap" style={{ paddingBottom: 64, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 }}>
          <h2 className="sub">Escrow schedule</h2>
          {p.funding && (
            <div className="ink-2" style={{ fontSize: 14 }}>
              {eth(p.funding.amount)} ETH from funder <AddressLink address={p.funding.funder} explorer={explorer} /> · released {eth(p.released)} · frozen {eth(p.frozen)}
              {p.reclaimed > 0n && `, ${eth(p.reclaimed)} returned to the funder`}
            </div>
          )}
        </div>
        <div className="tranche-cards">
          {epochs.map((e) => <TrancheCard key={e.epoch} e={e} p={p} attestations={attestations} />)}
        </div>
        <Legend withWindow />
      </section>

      {disputes.map((a) => <Dispute key={a.id.toString()} a={a} p={p} explorer={explorer} />)}

      <section id="ledger" className="wrap" style={{ paddingBlock: '56px 72px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div>
          <h2 className="sub">On-chain record</h2>
          <p className="body" style={{ marginTop: 6, fontSize: 15 }}>Every event for this project, oldest first{explorer ? ', each linked to its transaction' : ''}.</p>
        </div>
        <div className="table-box">
          <table className="ledger">
            <thead><tr><th scope="col">Event</th><th scope="col">Detail</th><th scope="col">By</th><th scope="col">Transaction</th></tr></thead>
            <tbody>
              {p.timeline.map((row) => (
                <tr key={`${row.ref.tx}-${row.ref.logIndex}`}>
                  <td>{row.event}</td>
                  <td>{row.detail}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{row.actorRole ?? 'anyone'} <AddressLink address={row.actor} explorer={explorer} /></td>
                  <td style={{ whiteSpace: 'nowrap' }}><TxLink txRef={row.ref} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function TrancheCard({ e, p, attestations }: { e: EpochView; p: Project; attestations: Attestation[] }) {
  const mine = attestations.filter((a) => a.epoch === e.epoch);
  const rejected = mine.filter((a) => a.status === 'rejected');
  const live = mine.find((a) => a.status === 'pending' || a.status === 'challenged');
  let text: string;
  if (e.phase === 'settled') {
    text = e.released === 0n
      ? `${pct(e.survivalBps!)} retained, at or below T. Nothing released; all of it frozen.`
      : `${pct(e.survivalBps!)} retained, so ${shareText(e)} released.`;
  } else if (live) {
    text = `${pct(live.survivalBps)} attested, ${live.status === 'challenged' ? 'under challenge' : 'in its challenge window'}.`;
  } else if (mine.some((a) => a.status === 'finalized')) {
    text = 'Attestation final; waiting for someone to call release.';
  } else {
    text = e.epoch === p.epochCount - 1
      ? 'Not yet attested. After it settles, the funder can reclaim what stayed frozen.'
      : 'Not yet attested.';
  }
  if (rejected.length) text = `False ${rejected.map((a) => pct(a.survivalBps)).join(', ')} claim rejected. ${text}`;

  return (
    <div className="card tranche-card" style={{ flex: `${e.weightPct} 1 170px` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13 }}>
        <span style={{ fontWeight: 600 }}>Epoch {e.epoch}</span>
        <span className="mono muted">{e.weightPct}%</span>
      </div>
      {e.phase === 'settled'
        ? <div className="bar seg-settled"><div style={{ width: `${releasedWidth(e)}%` }} /></div>
        : <div className={`bar ${e.phase === 'window' ? 'seg-window' : 'seg-open'}`} />}
      <div className="mono" style={{ fontSize: 13 }}>{e.tranche > 0n ? `${eth(e.tranche)} ETH` : '—'}</div>
      <p style={{ color: e.phase === 'open' && !rejected.length ? 'var(--ink-3)' : undefined }}>{text}</p>
    </div>
  );
}

function Dispute({ a, p, explorer }: { a: Attestation; p: Project; explorer?: string }) {
  const c = a.challenge!;
  const r = a.resolution;
  const tranche = p.funding ? trancheAmount(p.funding.amount, p.epochCount, a.epoch) : 0n;
  const wouldPay = payoutFor(tranche, a.survivalBps, p.thresholdBps);
  const slashed = r ? r.reward + r.burned : 0n;
  return (
    <section style={{ background: 'var(--surface)', borderBlock: '1px solid var(--line)' }}>
      <div className="wrap" style={{ paddingBlock: 56, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 760 }}>
          <div className="mono" style={{ fontSize: 13, letterSpacing: '0.04em', color: 'var(--critical)' }}>
            EPOCH {a.epoch} · {r ? 'DISPUTE RESOLVED' : 'DISPUTE OPEN'}
          </div>
          <h2 className="sub">
            {!r ? 'A claim is under challenge' : r.upheld ? 'A false claim, caught inside the window' : 'A challenge that failed'}
          </h2>
          <p className="body">
            Verifier <AddressLink address={a.verifier} explorer={explorer} /> attested {pct(a.survivalBps)} canopy retained.
            {r?.upheld && ' Had nobody objected, the escrow would have paid for trees that are not there.'}
          </p>
        </div>
        <div className="dispute">
          <div>
            <div className="muted" style={{ fontSize: 13, fontWeight: 600 }}>1 · Claim</div>
            <div className={`big${r?.upheld ? ' struck' : ''}`}>{pct(a.survivalBps)}</div>
            <p className="body" style={{ fontSize: 14 }}>Stake locked by the verifier. Evidence <span className="mono">{shortHex(a.evidenceHash)}</span>.</p>
            <p className="body" style={{ fontSize: 14 }}>If it stood: <strong style={{ color: 'var(--ink)' }}>{eth(wouldPay)} ETH</strong> of the {eth(tranche)} ETH tranche released.</p>
            <div style={{ marginTop: 'auto' }}><TxLink txRef={a.submitted} label={`tx ${shortHex(a.submitted.tx)}`} /></div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 13, fontWeight: 600 }}>2 · Challenge</div>
            <div className="big" style={{ fontSize: 22, paddingBlock: 8 }}>Bond {eth(c.bond)} ETH</div>
            <p className="body" style={{ fontSize: 14 }}>
              Posted by <AddressLink address={c.challenger} explorer={explorer} /> with counter-evidence <span className="mono">{shortHex(c.counterEvidenceHash)}</span>.
            </p>
            <div style={{ marginTop: 'auto' }}><TxLink txRef={c.ref} label={`tx ${shortHex(c.ref.tx)}`} /></div>
          </div>
          <div style={{ borderColor: 'var(--ink)' }}>
            <div className="muted" style={{ fontSize: 13, fontWeight: 600 }}>3 · Outcome</div>
            {!r && <div style={{ fontSize: 20, fontWeight: 600 }}>Waiting for the arbiter.</div>}
            {r && (
              <>
                <div style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.3 }}>
                  {r.upheld ? 'Challenge upheld. The liar paid for it.' : 'Challenge rejected. The challenger paid for it.'}
                </div>
                <dl className="kv">
                  <dt>{r.upheld ? 'Stake slashed' : 'Bond slashed'}</dt><dd>{eth(slashed)}</dd>
                  <dt>To the {r.upheld ? 'challenger' : 'verifier'}</dt><dd>{eth(r.reward)}</dd>
                  <dt>Burned to 0x…dEaD</dt><dd>{eth(r.burned)}</dd>
                  {r.upheld && <><dt>Paid for the claim</dt><dd>{eth(0n)}</dd></>}
                </dl>
                <div style={{ marginTop: 'auto' }}><TxLink txRef={r.ref} label={`tx ${shortHex(r.ref.tx)}`} /></div>
              </>
            )}
          </div>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>
          Disputes are decided by one arbiter address in this demo. A production deployment would hand that role to a
          multisig or a dispute protocol; the stake and bond mechanics stay the same.
        </p>
      </div>
    </section>
  );
}

interface PlotEvidence {
  seriesFile: string;
  months: SeriesMonth[];
  params: MethodParams;
  baseline: number;
  fire?: FireMark;
}

/** The oracle's published files for this plot: its attestations (for method and events) and the series they cite. */
function usePlotEvidence(plotId?: string): PlotEvidence | undefined {
  const [evidence, setEvidence] = useState<PlotEvidence>();
  useEffect(() => {
    if (!plotId) return;
    let cancelled = false;
    (async () => {
      const index: string[] = await fetch('/data/attestations/index.json').then((r) => r.json());
      const files = index.filter((path) => path.includes(`/${plotId}/`) && !path.includes('false-claim'));
      if (files.length === 0) return;
      const attestations = await Promise.all(files.map((path) => fetch(path).then((r) => r.json())));
      const first = attestations[0];
      if (!first.inputs?.seriesFile) return;
      const series = await fetch(`/${first.inputs.seriesFile}`).then((r) => r.json());
      const fire = attestations.find((a) => a.events?.fire)?.events.fire;
      if (!cancelled) {
        setEvidence({
          seriesFile: first.inputs.seriesFile,
          months: series.months,
          params: first.method,
          baseline: first.metrics.canopyFractionBaseline,
          fire: fire && { month: fire.month, firmsDetections: fire.firmsDetections, dnbr: fire.dnbr },
        });
      }
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [plotId]);
  return evidence;
}

/** Places on-chain attestations on the series: the scored month the method picks for each epoch. */
function seriesMarks(e: PlotEvidence, attestations: Attestation[], colorFor: (bps: number) => string) {
  const scored: ScoredPoint[] = [];
  const rejected: RejectedClaim[] = [];
  for (const a of attestations) {
    const year = e.params.epochYears[a.epoch];
    const pick = year === undefined ? null : yearCanopy(e.months, year, e.params);
    if (!pick?.month) continue;
    if (a.status === 'rejected') {
      rejected.push({ epoch: a.epoch, month: pick.month, canopy: Math.min(1, (a.survivalBps * e.baseline) / 10_000), survivalBps: a.survivalBps });
    } else {
      scored.push({ epoch: a.epoch, month: pick.month, canopy: pick.value!, survivalBps: a.survivalBps, color: colorFor(a.survivalBps) });
    }
  }
  return { scored, rejected };
}
