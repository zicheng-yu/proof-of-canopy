import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from 'react';

function current() {
  return { path: window.location.pathname, search: window.location.search, hash: window.location.hash };
}

export function useLocation() {
  const [loc, setLoc] = useState(current);
  useEffect(() => {
    const update = () => setLoc(current());
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);
  return loc;
}

export function navigate(to: string) {
  window.history.pushState({}, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
  const hash = new URL(to, window.location.href).hash;
  if (hash) {
    // wait for the target route to render before scrolling to the anchor
    requestAnimationFrame(() => document.getElementById(hash.slice(1))?.scrollIntoView());
  } else {
    window.scrollTo(0, 0);
  }
}

export function Link({ to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (to.startsWith('#')) return; // same-page anchor: let the browser scroll
    e.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={handle} {...rest} />;
}
