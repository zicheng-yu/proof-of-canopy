import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { loadSource, type Source } from '../source';
import { deriveState, type ChainState } from './derive';
import { decode } from './events';
import { openFeed, type Feed } from './feed';

export interface ChainContext {
  source?: Source;
  feed?: Feed;
  state?: ChainState;
  head?: { block: bigint; at: number };
  error?: string;
}

const Ctx = createContext<ChainContext>({});

export function ChainProvider({ children }: { children: ReactNode }) {
  const [ctx, setCtx] = useState<ChainContext>({});
  const seen = useRef(-1);

  useEffect(() => {
    let stop = () => {};
    let cancelled = false;
    (async () => {
      try {
        const source = await loadSource();
        const feed = await openFeed(source);
        if (cancelled) return;
        setCtx({ source, feed });
        stop = feed.start(
          (logs, head) => {
            if (logs.length === seen.current) {
              setCtx((c) => ({ ...c, head, error: undefined }));
              return;
            }
            seen.current = logs.length;
            const state = deriveState(decode(logs, feed.contracts), feed.arbiter);
            setCtx((c) => ({ ...c, state, head, error: undefined }));
          },
          (e) => setCtx((c) => ({ ...c, error: e.message })),
        );
      } catch (e) {
        if (!cancelled) setCtx({ error: (e as Error).message });
      }
    })();
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;
}

export const useChain = () => useContext(Ctx);
