import { useEffect, useState } from 'react';
import { keccak256 } from 'viem';
import { polygonToCells } from 'h3-js';
import { baselineCanopy, survivalBps, yearCanopy, type MethodParams } from '../../../shared/method.ts';
import { useChain } from '../chain/ChainProvider';
import type { Attestation, ChainState } from '../chain/derive';
import { CheckCircle, Clock, XCircle } from '../components/icons';
import { Layout } from '../components/Layout';
import { fetchBytes, plotByHash, usePlots, type PlotMeta } from '../data/plots';
import { pct } from '../lib/format';
import { navigate } from '../router';

type Outcome = 'match' | 'fail' | 'wait';

interface CheckResult {
  title: string;
  input: string;
  computed: string;
  onchainLabel: string;
  onchain: string;
  outcome: Outcome;
}

interface Evidence {
  path: string;
  hash: string;
  text: string;
  bytes: number;
  json: Record<string, unknown>;
}

export function Verify({ search }: { search: string }) {
  const { state } = useChain();
  const plots = usePlots();
  const requested = new URLSearchParams(search).get('a');
  const list = state ? [...state.attestations.values()].sort((a, b) => (a.id < b.id ? -1 : 1)) : [];
  const selected = list.find((a) => a.id.toString() === requested) ?? list.find((a) => a.status === 'finalized') ?? list[0];

  return (
    <Layout page="verify">
      <section className="wrap" style={{ paddingBlock: '56px 32px', display: 'flex', flexDirection: 'column', gap: 28 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 760 }}>
          <div className="eyebrow">Verify</div>
          <h1 className="title">Don’t trust this page. Check it.</h1>
          <p className="lede">
            Each check fetches a published file, hashes it in your browser and compares the result with what the
            contracts store. If anyone had edited a file after it was attested, the hashes would no longer match.
          </p>
        </div>
        {!state || !plots ? <div className="skeleton">Reading the chain…</div>
          : selected ? <Checks key={selected.id.toString()} list={list} selected={selected} state={state} plots={plots} autoRun={requested !== null} />
          : <div className="skeleton">No attestations on this chain yet.</div>}
      </section>
    </Layout>
  );
}

function label(a: Attestation, state: ChainState, plots: PlotMeta[]) {
  const p = state.projects.find((x) => x.id === a.projectId);
  const meta = p && plotByHash(plots, p.plotHash);
  return `#${a.id} · ${meta?.id ?? `project ${a.projectId}`} · epoch ${a.epoch} · ${pct(a.survivalBps)} · ${a.status}`;
}

function Checks({ list, selected, state, plots, autoRun }: {
  list: Attestation[]; selected: Attestation; state: ChainState; plots: PlotMeta[]; autoRun: boolean;
}) {
  const { feed, source } = useChain();
  const [results, setResults] = useState<CheckResult[]>();
  const [evidence, setEvidence] = useState<Evidence | null>();
  const [running, setRunning] = useState(false);
  const project = state.projects.find((p) => p.id === selected.projectId)!;
  const meta = plotByHash(plots, project.plotHash);

  async function run() {
    setRunning(true);
    try {
      const out: CheckResult[] = [];

      // 1. which published evidence file hashes to the on-chain evidenceHash?
      const index: string[] = await fetch('/data/attestations/index.json').then((r) => r.json());
      let found: Evidence | null = null;
      for (const path of index) {
        const bytes = await fetchBytes(path);
        const hash = keccak256(bytes);
        if (hash === selected.evidenceHash) {
          const text = new TextDecoder().decode(bytes);
          found = { path, hash, text, bytes: bytes.length, json: JSON.parse(text) };
          break;
        }
      }
      setEvidence(found);
      out.push({
        title: 'Evidence file matches the attestation',
        input: found
          ? `keccak256 over the raw bytes of ${found.path} (${found.bytes} bytes), found among ${index.length} published evidence files`
          : `keccak256 over the raw bytes of each of the ${index.length} published evidence files`,
        computed: found ? found.hash : 'No published file hashes to this value',
        onchainLabel: `SurvivalOracle attestation #${selected.id} · evidenceHash`,
        onchain: selected.evidenceHash,
        outcome: found ? 'match' : 'fail',
      });

      // 2. the boundary file hashes to the registered plotHash
      let ring: [number, number][] | undefined;
      if (meta) {
        const bytes = await fetchBytes(`/data/plots/${meta.file}`);
        const hash = keccak256(bytes);
        ring = JSON.parse(new TextDecoder().decode(bytes)).coordinates[0];
        out.push({
          title: 'Boundary file matches the registered plot',
          input: `keccak256 over the raw bytes of /data/plots/${meta.file} (${bytes.length} bytes)`,
          computed: hash,
          onchainLabel: `ProjectRegistry project #${project.id} · plotHash`,
          onchain: project.plotHash,
          outcome: hash === project.plotHash ? 'match' : 'fail',
        });
      } else {
        out.push({
          title: 'Boundary file matches the registered plot',
          input: 'No published boundary file is listed for this plotHash',
          computed: '—', onchainLabel: `ProjectRegistry project #${project.id} · plotHash`, onchain: project.plotHash, outcome: 'fail',
        });
      }

      // 3. the H3 cells claimed on chain are the ones the boundary covers
      const onchainCells = feed ? await feed.cellsOf(project.id) : [];
      if (ring) {
        const mine = polygonToCells([ring], 9, true).map((h) => BigInt(`0x${h}`)).sort((a, b) => (a < b ? -1 : 1));
        const same = mine.length === onchainCells.length && mine.every((c, i) => c === onchainCells[i]);
        const overlap = mine.filter((c) => onchainCells.includes(c)).length;
        out.push({
          title: 'Claimed cells are the ones the boundary covers',
          input: 'H3 cells at resolution 9 whose centres fall inside the boundary, recomputed with h3-js',
          computed: `${mine.length} cells, first ${mine[0]?.toString() ?? '—'}`,
          onchainLabel: `ProjectRegistry.cellsOf(${project.id})`,
          onchain: `${onchainCells.length} cells · ${overlap} of ${mine.length} identical`,
          outcome: same ? 'match' : 'fail',
        });
      }

      // 4. survival recomputed from the Sentinel-2 series the evidence cites, with the oracle's own method code
      const inputs = found?.json.inputs as { seriesFile?: string; seriesHash?: string } | undefined;
      const params = found?.json.method as MethodParams | undefined;
      const onchainSurvival = `${selected.survivalBps} (${pct(selected.survivalBps)})`;
      if (inputs?.seriesFile && params?.epochYears) {
        const bytes = await fetchBytes(`/${inputs.seriesFile}`);
        const hashOk = keccak256(bytes) === inputs.seriesHash;
        const months = JSON.parse(new TextDecoder().decode(bytes)).months;
        const base = baselineCanopy(months, params);
        const year = params.epochYears[selected.epoch];
        const obs = yearCanopy(months, year, params);
        const bps = base.value && obs.value !== null ? survivalBps(base.value, obs.value) : null;
        out.push({
          title: 'Survival recomputed from the satellite series',
          input: `${inputs.seriesFile} (${bytes.length} bytes; its keccak256 ${hashOk ? 'matches' : 'does NOT match'} the hash the evidence cites). Greenest cloud-free Aug–Oct month of ${year} against the median of ${params.baselineYears.join(' and ')}, canopy = NDVI ≥ ${params.canopyNdviThreshold}.`,
          computed: bps === null ? 'Not enough cloud-free months' : `${bps} (${pct(bps)}) = ${obs.value} (${obs.month}) ÷ ${base.value}`,
          onchainLabel: `SurvivalOracle attestation #${selected.id} · survivalBps`,
          onchain: onchainSurvival,
          outcome: hashOk && bps === selected.survivalBps ? 'match' : 'fail',
        });
      } else {
        out.push({
          title: 'Survival recomputed from the satellite series',
          input: 'The evidence file does not cite a Sentinel-2 series',
          computed: '—',
          onchainLabel: `SurvivalOracle attestation #${selected.id} · survivalBps`,
          onchain: onchainSurvival,
          outcome: 'wait',
        });
      }

      setResults(out);
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    if (autoRun) run();
  }, []);

  const oracle = feed?.contracts.SurvivalOracle;
  const rpc = source?.chainId === 84532 ? 'https://sepolia.base.org' : source?.mode === 'live' ? source.rpcUrls[0] : '<rpc url>';

  return (
    <>
      <div className="card picker">
        <div style={{ flex: '1 1 420px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label htmlFor="attestation">Attestation</label>
          <select id="attestation" value={selected.id.toString()} onChange={(e) => navigate(`/verify?a=${e.target.value}`)}>
            {list.map((a) => <option key={a.id.toString()} value={a.id.toString()}>{label(a, state, plots)}</option>)}
          </select>
        </div>
        <button type="button" className="btn btn-primary" onClick={run} disabled={running}>
          {running ? 'Checking…' : results ? 'Run again' : 'Run the checks'}
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} aria-live="polite">
        {(results ?? PENDING).map((r, i) => (
          <article key={i} className="card check">
            <div style={{ flex: '1 1 260px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="mono muted" style={{ fontSize: 12 }}>Check {i + 1}</div>
              <h2>{r.title}</h2>
              <div className="ink-2" style={{ fontSize: 14, lineHeight: 1.5 }}>{r.input}</div>
            </div>
            <dl>
              <div><dt>Computed in your browser</dt><dd>{results ? r.computed : '—'}</dd></div>
              <div><dt>{r.onchainLabel}</dt><dd>{results ? r.onchain : '—'}</dd></div>
            </dl>
            <div className="result"><Pill outcome={results ? r.outcome : undefined} /></div>
          </article>
        ))}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start', paddingBottom: 40 }}>
        <div className="card" style={{ flex: '3 1 560px', minWidth: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '14px 20px', borderBottom: '1px solid var(--line)' }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Evidence file</div>
              <div className="mono muted" style={{ fontSize: 12 }}>{evidence ? `${evidence.path} · ${evidence.bytes} bytes` : 'Run the checks to load it'}</div>
            </div>
            {evidence?.json.staged === true && <span className="tag-dashed" style={{ borderColor: 'var(--critical)' }}>STAGED FALSE CLAIM · for the dispute demo</span>}
          </div>
          <pre className="code">{evidence ? evidence.text : evidence === null ? 'No published file matches this attestation.' : '…'}</pre>
        </div>
        <div style={{ flex: '2 1 380px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>What a match proves, and what it doesn’t</h2>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12, fontSize: 14, lineHeight: 1.5 }} className="ink-2">
              <li style={{ display: 'flex', gap: 10 }}><span style={{ flex: 'none', marginTop: 2 }}><CheckCircle /></span><span><strong style={{ color: 'var(--ink)' }}>Proves</strong> the file is byte-for-byte the one the verifier staked on, and the boundary and cells are the ones the registry holds.</span></li>
              <li style={{ display: 'flex', gap: 10 }}><span style={{ flex: 'none', marginTop: 2 }}><XCircle /></span><span><strong style={{ color: 'var(--ink)' }}>Doesn’t prove</strong> the measurement is right. That is what the stake and the challenge window are for: anyone can rerun the pipeline on the same imagery and dispute a wrong number.</span></li>
            </ul>
          </div>
          <div className="dark" style={{ borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>Check it without this site</h2>
            <p className="body" style={{ fontSize: 14 }}>Hash the raw bytes of the file, then read the attestation straight from the contract.</p>
            <pre className="term">{`cast keccak 0x$(xxd -p ${evidence?.path.split('/').pop() ?? 'epoch-0.json'} | tr -d '\\n')

cast call ${oracle ?? '<SurvivalOracle>'} \\
  "getAttestation(uint256)((uint256,uint8,uint16,bytes32,address,uint64,uint8,uint256))" ${selected.id} \\
  --rpc-url ${rpc}`}</pre>
          </div>
        </div>
      </div>
    </>
  );
}

const PENDING: CheckResult[] = [
  ['Evidence file matches the attestation', 'keccak256 over the raw bytes of the published evidence files'],
  ['Boundary file matches the registered plot', 'keccak256 over the raw bytes of the plot’s GeoJSON file'],
  ['Claimed cells are the ones the boundary covers', 'H3 cells at resolution 9 whose centres fall inside the boundary, recomputed with h3-js'],
  ['Survival recomputed from the satellite series', 'Re-run the oracle’s method on the Sentinel-2 series the evidence cites, in your browser'],
].map(([title, input]) => ({ title, input, computed: '', onchainLabel: 'On chain', onchain: '', outcome: 'wait' }));

function Pill({ outcome }: { outcome?: Outcome }) {
  if (!outcome) return <span className="pill">Not run yet</span>;
  if (outcome === 'match') return <span className="pill match"><CheckCircle />Match</span>;
  if (outcome === 'fail') return <span className="pill fail"><XCircle />Mismatch</span>;
  return <span className="pill wait"><Clock />Awaiting data</span>;
}
