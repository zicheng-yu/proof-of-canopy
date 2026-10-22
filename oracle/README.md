# oracle/

Python pipeline (not written yet): Sentinel-2 L2A statistics → canopy survival → attestation files.

## Output contract

The chain side only depends on this:

- One file per plot and epoch at `data/attestations/<plotId>/epoch-<n>.json`, schema
  `proof-of-canopy/attestation@1` (see the current fixtures for the shape).
- `plotHash` must equal the plot's entry in `data/plots/manifest.json`.
- `metrics.survivalRatioBps` is an integer 0–10000: canopy fraction in the observation window
  divided by canopy fraction in the baseline window, capped at 1.
- `evidenceHash` on chain = `keccak256` of the file's exact bytes. Write the file once and never
  re-serialize it; anyone re-checking hashes the bytes, not a parsed object.
- Do not put the verifier address in the file; the chain records who submitted it.

Remove `"fixture": true` / `fixtureNote` and delete `scripts/make-fixture-attestations.ts` once real
values are written.

## Notes for the Statistical API request

- Request statistics in a metric CRS (the plot's UTM zone, e.g. EPSG:32636 for Antalya/Bolu,
  EPSG:32721 for Novo Progresso) so `resx`/`resy` = 10 means 10 m. In EPSG:4326 the same numbers
  would mean 10 degrees.
- Monthly aggregation mosaics one image per interval; set `mosaickingOrder: "leastCC"` in
  `dataFilter` so cloud masking does not empty whole months.
- Ask for a histogram of NDVI, not only the mean; the canopy fraction comes from the bins.
- NASA FIRMS needs a free MAP_KEY and returns at most 10 days per request.
