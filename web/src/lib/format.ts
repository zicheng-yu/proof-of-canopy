import { formatEther } from 'viem';

export function eth(wei: bigint, decimals = 6): string {
  const [whole, frac = ''] = formatEther(wei).split('.');
  if (decimals === 0) return whole;
  // round half up at the requested precision
  const padded = (frac + '0'.repeat(18)).slice(0, 18);
  const scaled = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded.slice(0, decimals) || '0');
  const roundUp = Number(padded[decimals] ?? '0') >= 5 ? 1n : 0n;
  const v = (scaled + roundUp).toString().padStart(decimals + 1, '0');
  return `${v.slice(0, -decimals)}.${v.slice(-decimals)}`;
}

export function pct(bps: number | bigint, digits = 2): string {
  return `${(Number(bps) / 100).toFixed(digits)}%`;
}

export function shortHex(hex: string, head = 4, tail = 4): string {
  if (hex.length <= 2 + head + tail + 1) return hex;
  return `${hex.slice(0, 2 + head)}…${hex.slice(-tail)}`;
}

export function timeAgo(seconds: bigint, now = BigInt(Math.floor(Date.now() / 1000))): string {
  const d = Number(now - seconds);
  if (d < 60) return `${Math.max(d, 0)} s ago`;
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  return `${Math.floor(d / 86400)} d ago`;
}

export function utc(seconds: bigint): string {
  return new Date(Number(seconds) * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}
