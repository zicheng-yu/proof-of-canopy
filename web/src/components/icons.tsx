// Stroke icons, decorative unless a label is passed. Status icons always sit next to a text label.
const base = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', strokeWidth: 1.8, 'aria-hidden': true } as const;

export const CheckCircle = ({ color = 'var(--good)' }: { color?: string }) => (
  <svg {...base} stroke={color}><circle cx="8" cy="8" r="6.4" /><path d="M5 8.2l2 2 4-4.4" /></svg>
);

export const Warning = ({ color = 'var(--warn)' }: { color?: string }) => (
  <svg {...base} stroke={color} strokeLinejoin="round"><path d="M8 2.2L14.4 13.4H1.6Z" /><path d="M8 6.6v3.2M8 11.3v.2" /></svg>
);

export const Flame = ({ color = 'var(--critical)' }: { color?: string }) => (
  <svg {...base} stroke={color} strokeLinejoin="round">
    <path d="M8 1.8c.5 2.4 3.9 3.9 3.9 7.5a3.9 3.9 0 0 1-7.8 0c0-1.7.8-2.7 1.7-3.5.2 1.3.8 2 1.6 2.3-.4-2.3.1-4.5.6-6.3z" />
  </svg>
);

export const XCircle = ({ color = 'var(--critical)' }: { color?: string }) => (
  <svg {...base} stroke={color}><circle cx="8" cy="8" r="6.4" /><path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" /></svg>
);

export const Clock = ({ color = 'var(--ink-2)' }: { color?: string }) => (
  <svg {...base} stroke={color} strokeWidth={1.6}><circle cx="8" cy="8" r="6.4" /><path d="M8 4.8V8l2.2 1.6" /></svg>
);

export const Info = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="var(--ink-2)" strokeWidth="1.6" aria-hidden="true" style={{ flex: 'none', marginTop: 2 }}>
    <circle cx="9" cy="9" r="7.2" /><path d="M9 8v4.5M9 5.6v.2" />
  </svg>
);

export const Arrow = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" /></svg>
);

export const Copy = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <rect x="5" y="5" width="8.5" height="8.5" rx="1.5" />
    <path d="M10.5 5V3.8A1.3 1.3 0 0 0 9.2 2.5H3.8a1.3 1.3 0 0 0-1.3 1.3v5.4a1.3 1.3 0 0 0 1.3 1.3H5" />
  </svg>
);

/** The mark: baseline canopy as cells, two of them lost. */
export const Mark = () => (
  <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
    {[0, 1, 2].flatMap((r) =>
      [0, 1, 2].map((c) => (
        <rect key={`${r}${c}`} x={2 + c * 8} y={2 + r * 8} width="6" height="6" rx="1"
          fill={r === 2 && c > 0 ? 'var(--lost)' : 'var(--canopy)'} />
      )),
    )}
  </svg>
);
