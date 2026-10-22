import { useChain } from '../chain/ChainProvider';
import { latestSettlement, plotStatus, type ChainState, type PlotStatus, type Project } from '../chain/derive';
import { ReleaseCurve, type CurvePoint } from '../components/Charts';
import { Arrow, Info, XCircle } from '../components/icons';
import { Layout } from '../components/Layout';
import { StatusBadge, TrancheStrip, Waffle, epochViews, shareText, type EpochView } from '../components/Plot';
import { usePlots, type PlotMeta } from '../data/plots';
import { eth, pct } from '../lib/format';
import { Link } from '../router';

const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];

export const STATUS_COLOR: Record<PlotStatus, string> = {
  unsettled: 'var(--ink-3)',
  holding: 'var(--good)',
  degrading: 'var(--warn)',
  lost: 'var(--critical)',
};

export function attestationPhase(state: ChainState, p: Project) {
  return (epoch: number): 'none' | 'live' | 'final' => {
    const live = p.attestationIds
      .map((id) => state.attestations.get(id)!)
      .filter((a) => a.epoch === epoch && a.status !== 'rejected');
    if (live.some((a) => a.status === 'finalized')) return 'final';
    return live.length ? 'live' : 'none';
  };
}

export function Overview() {
  const { state } = useChain();
  const plots = usePlots();

  const rows = (plots ?? []).map((meta) => ({
    meta,
    project: state?.projects.find((p) => p.plotHash.toLowerCase() === meta.plotHash.toLowerCase()),
  }));
  const threshold = rows.find((r) => r.project)?.project?.thresholdBps ?? 7000;
  const points: CurvePoint[] = rows.flatMap(({ meta, project }) => {
    const s = project && latestSettlement(project);
    return s ? [{ label: meta.name, survivalBps: s.survivalBps, color: STATUS_COLOR[plotStatus(project)] }] : [];
  });
  const t = state?.totals;
  const funded = state?.projects.filter((p) => p.funding).length ?? 0;

  return (
    <Layout page="plots">
      <section className="wrap hero">
        <div className="copy">
          <div className="eyebrow">Monitoring, reporting &amp; verification · payout escrow</div>
          <h1 className="display">Pay for forests that are still standing.</h1>
          <p className="lede">
            Afforestation funding sits in escrow and is released one year at a time, in proportion to how much of the
            original canopy Sentinel-2 still sees. Every survival claim is staked by the verifier who makes it, and
            anyone can challenge it.
          </p>
          <div className="note">
            <Info />
            <p style={{ margin: 0 }}>
              <strong>We measure canopy, not carbon.</strong> Tonnes of CO₂ per hectare stay with each project’s own
              methodology. What we add is proof, year after year, that the trees behind those tonnes are still there.
            </p>
          </div>
          <div className="actions">
            <Link to="#plots" className="btn btn-primary">See the plots</Link>
            <Link to="/verify" className="btn btn-secondary">Check a claim yourself</Link>
          </div>
        </div>
        <figure className="card">
          <div>
            <div className="fig-title">Release rule</div>
            <div className="fig-sub">Share of a year’s tranche paid out, by canopy retained</div>
          </div>
          <ReleaseCurve thresholdBps={threshold} points={points} />
          <figcaption className="mono">f(s) = clamp((s − T) / (1 − T), 0, 1) · T is fixed per project when it registers</figcaption>
        </figure>
      </section>

      <section className="wrap" aria-label="Totals" style={{ paddingBottom: 80 }}>
        <div className="stats">
          <Stat label="Escrowed by funders" value={t?.escrowed} hint={`${funded} project${funded === 1 ? '' : 's'} funded`} />
          <Stat label="Released to developers" value={t?.released} hint="for canopy still standing" />
          <Stat label="Frozen by canopy loss" value={t?.frozen}
            hint={t && t.returned > 0n ? `${eth(t.returned, 4)} ETH returned to funders` : 'back to funders after the last epoch'} />
          <Stat label="Waiting on later years" value={t?.awaiting} hint={t && t.awaiting === 0n && t.escrowed > 0n ? 'every epoch settled' : 'epochs not yet settled'} />
          <Stat label="Slashed from false claims" value={t?.slashed}
            hint={`${t?.rejectedClaims ?? 0} claim${t?.rejectedClaims === 1 ? '' : 's'} rejected after challenge`} />
        </div>
        <p className="muted" style={{ margin: '10px 0 0', fontSize: 13 }}>
          Every total is rebuilt in your browser from contract events{state ? ` (${state.eventCount} so far)` : ''}.
        </p>
      </section>

      <section id="plots" className="wrap" style={{ paddingBottom: 88, display: 'flex', flexDirection: 'column', gap: 28, scrollMarginTop: 24 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 640 }}>
            <h2 className="section">{NUMBER_WORDS[rows.length] ?? rows.length} plots, one standard</h2>
            <p className="body">Same 250 ha footprint, same sensor, same baseline years. The only thing that differs is what happened on the ground.</p>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }} className="mono ink-2">
            <span className="chip">Sentinel-2 L2A</span>
            <span className="chip">10 m pixels</span>
            <span className="chip">baseline 2019–2020</span>
            <span className="chip">T = {pct(threshold, 0)}</span>
          </div>
        </div>
        <div className="plot-grid">
          {rows.map(({ meta, project }) => <PlotCard key={meta.id} meta={meta} project={project} state={state} />)}
          {!plots && <div className="skeleton">Loading plots…</div>}
        </div>
      </section>

      <section id="how" className="dark" style={{ scrollMarginTop: 0 }}>
        <div className="wrap" style={{ paddingBlock: 88, display: 'flex', flexDirection: 'column', gap: 40 }}>
          <div style={{ maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h2 className="section">What the chain does here, and what it doesn’t</h2>
            <p className="body" style={{ fontSize: 17 }}>
              Trees are measured off-chain by a pipeline anyone can re-run. The chain holds what no single party
              should hold: the plot’s identity, the money, and a public record of who claimed what, with their stake
              behind it.
            </p>
          </div>
          <ol className="steps">
            <li><div className="n">01</div><h3>One plot, one record</h3><p>The boundary is hashed and the H3 cells it covers are claimed. Registering the same land again, even shifted a few metres, is rejected.</p></li>
            <li><div className="n">02</div><h3>Claims carry stake</h3><p>A verifier locks a stake to attest one year’s canopy retention, together with the hash of the evidence file it is based on.</p></li>
            <li><div className="n">03</div><h3>Anyone can object</h3><p>During the challenge window anyone can post a bond with counter-evidence. The loser’s stake is split between the winner and a burn address.</p></li>
            <li><div className="n">04</div><h3>Money follows the canopy</h3><p>Each settled year releases its tranche × f(s). The rest stays frozen, and returns to the funder only after the final year.</p></li>
          </ol>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px 40px' }}>
            <p className="body" style={{ flex: '1 1 360px' }}><strong>Off-chain, reproducible.</strong> Sentinel-2 statistics, cloud masking, NDVI histograms, trend and fire detection. Inputs, parameters and outputs are published and hashed.</p>
            <p className="body" style={{ flex: '1 1 360px' }}><strong>On-chain, final.</strong> Plot identity, escrow balances, attestations, challenges, slashing and every release, each with a transaction you can open.</p>
          </div>
        </div>
      </section>
    </Layout>
  );
}

function Stat({ label, value, hint }: { label: string; value?: bigint; hint: string }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{value === undefined ? '—' : eth(value, 4)} <span className="unit">ETH</span></div>
      <div className="hint">{hint}</div>
    </div>
  );
}

function PlotCard({ meta, project, state }: { meta: PlotMeta; project?: Project; state?: ChainState }) {
  const settled = project && latestSettlement(project);
  const epochs: EpochView[] = project && state ? epochViews(project, attestationPhase(state, project)) : [];
  const latest = settled && epochs.find((e) => e.epoch === settled.epoch);
  const rejected = project && state
    ? project.attestationIds.map((id) => state.attestations.get(id)!).filter((a) => a.status === 'rejected')
    : [];

  return (
    <article className="card plot-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <div className="mono muted" style={{ fontSize: 12 }}>{meta.id}</div>
          <h3>{meta.name}</h3>
          <div className="muted" style={{ fontSize: 14 }}>{meta.region}</div>
        </div>
        {project && <StatusBadge status={plotStatus(project)} meta={meta} />}
      </div>

      <Waffle survivalBps={settled?.survivalBps} />

      <dl className="nums">
        <div><dt>Canopy retained</dt><dd>{settled ? pct(settled.survivalBps) : '—'}</dd></div>
        <div><dt>{settled ? `Tranche ${settled.epoch} released` : 'Released'}</dt><dd>{latest ? shareText(latest) : '—'}</dd></div>
        <div><dt>Frozen, ETH</dt><dd>{project ? eth(project.frozen) : '—'}</dd></div>
      </dl>

      {epochs.length > 0 && <TrancheStrip epochs={epochs} />}

      {rejected.map((a) => (
        <div key={a.id.toString()} className="callout">
          <XCircle />
          <span>Epoch {a.epoch}: a verifier claimed {pct(a.survivalBps)}. The challenge was upheld and the verifier lost its stake.</span>
        </div>
      ))}
      {meta.placeholder && (
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>Boundary is a placeholder until the satellite data check picks the real polygon.</p>
      )}

      {project
        ? <Link to={`/plot/${project.id}`} className="open">Open plot record<Arrow /></Link>
        : <span className="open muted" style={{ fontWeight: 500 }}>Not registered on this chain</span>}
    </article>
  );
}
