# oracle/

Sentinel-2 and NASA FIRMS → evidence files the verifier stakes on.

```bash
node oracle/scan.ts manavgat 31.45 36.9 5 2020 2021 --fires 31.2,36.6,31.9,37.3,2021-07-28,2021-08-12
node oracle/run.ts                                   # every plot in data/plots/manifest.json
node oracle/stage-false-claim.ts TR-MANAVGAT-001 1 9400   # the dispute demo's false claim
```

Credentials come from `.env`: `CDSE_CLIENT_ID`, `CDSE_CLIENT_SECRET` (Copernicus Data Space OAuth
client, client-credentials flow) and `FIRMS_MAP_KEY`. Tokens stay in memory and keys never reach the
output files.

## Files it writes

- `data/series/<plotId>.json`: one entry per month with pixel counts, NDVI/NBR means and a 40-bin NDVI
  histogram over [-1, 1], plus the exact request (evalscript, resolution, mosaicking).
- `data/attestations/<plotId>/epoch-<n>.json`: method parameters, `inputs.seriesFile` and
  `inputs.seriesHash` (keccak256 of the series bytes), the scored months, `metrics.survivalRatioBps`
  and the canopy fractions it came from, and `events.fire` when a fire break falls in that year.

The chain stores `evidenceHash` = keccak256 of the attestation file's exact bytes, so files are written
once and never re-serialized. `shared/method.ts` is the single implementation of the score; the Verify
page imports the same file to recompute it.

## Request details that matter

- The plot is sent as an EPSG:4326 polygon with `resx`/`resy` set to ~10 m in degrees at the plot's
  latitude (`resx = 10 m` would mean 10 degrees in that CRS).
- `mosaickingOrder: "leastCC"` picks the least cloudy scene per month; SCL classes 0, 1, 3, 8, 9, 10,
  11 are masked per pixel.
- Histogram edges must be sent as `-1.0` / `1.0`; the API rejects integer edges for FLOAT32 output.
- The free tier rate-limits bursts (HTTP 429); requests run one at a time and back off on 429.
- FIRMS returns at most 5 days per request; `VIIRS_SNPP_SP` (standard processing) covers past years.
