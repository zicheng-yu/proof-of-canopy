import { useState } from 'react';
import type { Address, Hash as Hex } from 'viem';
import type { Ref } from '../chain/events';
import { useChain } from '../chain/ChainProvider';
import { shortHex } from '../lib/format';
import { Copy } from './icons';

/** Transaction hash, linked to the block explorer when the chain has one. */
export function TxLink({ txRef, label }: { txRef: Ref; label?: string }) {
  const { source } = useChain();
  const explorer = source?.mode === 'live' ? source.explorer : undefined;
  const text = label ?? shortHex(txRef.tx);
  if (!explorer) return <span className="mono" title={txRef.tx} style={{ fontSize: 13, color: 'var(--ink)' }}>{text}</span>;
  return <a className="mono" href={`${explorer}/tx/${txRef.tx}`} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>{text}</a>;
}

export function AddressLink({ address, explorer, full }: { address?: Address; explorer?: string; full?: boolean }) {
  if (!address) return null;
  const text = full ? address : shortHex(address);
  if (!explorer) return <span className="mono" title={address}>{text}</span>;
  return <a className="mono" href={`${explorer}/address/${address}`} target="_blank" rel="noreferrer">{text}</a>;
}

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="icon-btn" aria-label={label}
      onClick={() => navigator.clipboard.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); })}>
      <Copy />{done && <span>Copied</span>}
    </button>
  );
}

export function FullHash({ value }: { value: Hex }) {
  return <code className="mono" style={{ fontSize: 13, color: 'var(--ink)', overflowWrap: 'anywhere' }}>{value}</code>;
}
