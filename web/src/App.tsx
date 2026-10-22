import { Layout } from './components/Layout';
import { Overview } from './pages/Overview';
import { PlotRecord } from './pages/PlotRecord';
import { Verify } from './pages/Verify';
import { Link, useLocation } from './router';

export function App() {
  const { path, search } = useLocation();
  const plot = path.match(/^\/plot\/(\d+)\/?$/);
  if (path === '/' || path === '') return <Overview />;
  if (plot) return <PlotRecord id={plot[1]} />;
  if (path === '/verify' || path === '/verify/') return <Verify search={search} />;
  return (
    <Layout page="other">
      <div className="wrap skeleton">Nothing at {path}. <Link to="/">Back to the plots</Link></div>
    </Layout>
  );
}
