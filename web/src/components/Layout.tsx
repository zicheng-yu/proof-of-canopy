import type { ReactNode } from 'react';
import { useChain } from '../chain/ChainProvider';
import { POLL_MS } from '../chain/feed';
import { utc } from '../lib/format';
import { Link } from '../router';
import { Info, Mark } from './icons';
import { AddressLink } from './Hash';

export function Layout({ page, children }: { page: 'plots' | 'verify' | 'other'; children: ReactNode }) {
  const { source, head, error } = useChain();
  const replay = source?.mode === 'replay';

  let chip = 'Connecting…';
  let dot = 'live';
  if (error) {
    chip = `Chain unreachable · ${error.slice(0, 60)}`;
    dot = 'error';
  } else if (replay) {
    chip = `Replay · ${source.chainName}`;
    dot = 'replay';
  } else if (source && head) {
    chip = `${source.chainName} · block ${head.block.toLocaleString('en-US')} · polling every ${POLL_MS / 1000} s`;
  }

  return (
    <>
      <header className="site-header">
        <div className="wrap">
          <Link to="/" className="brand"><Mark /><span>Proof of Canopy</span></Link>
          <nav className="nav" aria-label="Main">
            <Link to="/#plots" aria-current={page === 'plots' ? 'page' : undefined}>Plots</Link>
            <Link to="/#how">How it works</Link>
            <Link to="/verify" aria-current={page === 'verify' ? 'page' : undefined}>Verify</Link>
          </nav>
          <div className="chain-chip" role="status"><span className={`dot ${dot}`} />{chip}</div>
        </div>
      </header>
      {replay && (
        <div className="banner">
          <div className="wrap">
            <Info />
            <span>
              <strong>Replay of a recorded run</strong> on a local test chain ({utc(BigInt(Math.floor(Date.parse(source.recordedAt) / 1000)))}).
              The contracts are not on a public network yet, so transactions below have no explorer page.
            </span>
          </div>
        </div>
      )}
      <main>{children}</main>
      <Footer />
    </>
  );
}

function Footer() {
  const { source, feed } = useChain();
  const explorer = source?.mode === 'live' ? source.explorer : undefined;
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div style={{ flex: '1 1 420px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontWeight: 600, color: 'var(--ink)' }}>Contracts · {source?.chainName ?? '…'}</div>
          {feed && (Object.entries(feed.contracts) as [string, `0x${string}`][]).map(([name, address]) => (
            <div key={name} className="mono" style={{ fontSize: 13, overflowWrap: 'anywhere' }}>
              {name} · <AddressLink address={address} explorer={explorer} full />
            </div>
          ))}
        </div>
        <div style={{ flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div>Map imagery: Sentinel-2 cloudless by EOX IT Services GmbH (contains modified Copernicus Sentinel data).</div>
          <div>IEEE ClimateChain hackathon · Carbon Markets &amp; Emissions Transparency</div>
          <a href="https://github.com/zicheng-yu/proof-of-canopy">Source on GitHub</a>
        </div>
      </div>
    </footer>
  );
}
