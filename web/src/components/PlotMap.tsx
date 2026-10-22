import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { cellToBoundary } from 'h3-js';

const TILES = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/default/g/{z}/{y}/{x}.jpg';
const ATTRIBUTION = 'Sentinel-2 cloudless 2023 by <a href="https://s2maps.eu">EOX IT Services GmbH</a> (contains modified Copernicus Sentinel data 2023)';

/** Sentinel-2 basemap with the registered boundary and the H3 cells claimed on chain. */
export function PlotMap({ geojsonUrl, cells }: { geojsonUrl: string; cells: bigint[] }) {
  const el = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!el.current) return;
    const map = L.map(el.current, { scrollWheelZoom: false, attributionControl: true });
    L.tileLayer(TILES, { attribution: ATTRIBUTION, maxNativeZoom: 15, maxZoom: 17 }).addTo(map);
    let cancelled = false;
    fetch(geojsonUrl)
      .then((r) => r.json())
      .then((geometry) => {
        if (cancelled) return;
        for (const cell of cells) {
          L.polygon(cellToBoundary(cell.toString(16)), {
            color: '#f2f3ef', opacity: 0.75, weight: 1.2, fillColor: '#f2f3ef', fillOpacity: 0.08, interactive: false,
          }).addTo(map);
        }
        const boundary = L.geoJSON(geometry, { style: { color: '#ffffff', weight: 2.5, fill: false }, interactive: false }).addTo(map);
        map.fitBounds(boundary.getBounds(), { padding: [28, 28] });
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      map.remove();
    };
  }, [geojsonUrl, cells]);

  return (
    <div className="map">
      <div ref={el} role="img" aria-label={`Satellite map of the plot boundary and the ${cells.length} H3 cells it claims`} />
      {failed && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#e6e8e2', fontSize: 14 }}>Boundary file could not be loaded</div>}
    </div>
  );
}
