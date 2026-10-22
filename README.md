# Proof of Canopy

**Track: Carbon Markets & Emissions Transparency** · Live: https://proofofcanopy.zichengyu.com

Afforestation money should not be paid out once, at planting. Proof of Canopy keeps it in escrow and
releases it year by year according to **satellite-verified canopy survival**: healthy forest releases,
degraded forest releases partially, burned forest releases nothing. The verifier who reports survival
must stake, can be challenged, and is slashed when caught lying.

> **Scope.** This is a monitoring, reporting and verification (MRV) and payout layer. It does not do
> carbon accounting: tonnes of CO₂ per hectare come from the project's own methodology, not from us.

## Three real plots, five years

Sentinel-2 L2A, 10 m, 2019-01 → 2026-09, 250 ha each. Canopy retained against the 2019–2020 baseline,
and the share of that year's tranche released with `T = 70%`:

| Plot | 2021 | 2022 | 2023 | 2024 | 2025 |
|---|---|---|---|---|---|
| Yedigöller, Bolu (healthy) | 100% → 100% | 100% → 100% | 100% → 100% | 100% → 100% | 99.8% → 99.4% |
| Novo Progresso, Pará (degraded) | 100% → 100% | 81.7% → 38.9% | 86.9% → 56.4% | 86.1% → 53.8% | 89.4% → 64.6% |
| Manavgat, Antalya (2021 fire) | 16.2% → 0% | 14.5% → 0% | 26.6% → 0% | 47.5% → 0% | 50.9% → 0% |

The Manavgat fire is confirmed three independent ways in the evidence: the canopy break in 2021-08,
dNBR 0.33 across it, and 15 NASA FIRMS detections inside the plot on 1–2 August 2021.

## How it works

| Contract | Job |
|---|---|
| `ProjectRegistry` | One identity per plot: `plotHash` = keccak256 of the canonical GeoJSON bytes, plus the H3 (res 9, ~10.5 ha) cells the plot covers. Each cell can belong to one project only, so a copy shifted by a few metres is rejected too. |
| `SurvivalOracle` | Verifiers stake, then attest `survivalBps` for a (project, epoch) with the keccak256 of the evidence file. Anyone may challenge within the window by posting a bond. The arbiter decides; the loser's stake or bond is split 50% to the winner, 50% burned. |
| `MilestoneEscrow` | Funder deposits once. Each finalized epoch releases `tranche × f(s)`, with `f(s) = clamp((s − T) / (1 − T), 0, 1)` and the threshold `T` set per project at registration. Unreleased money stays frozen; the funder can reclaim it after the last epoch. Payments are pull-based (`withdraw`). |

Tranches are back-loaded, weight ∝ (epoch + 2): with five epochs that's 10 / 15 / 20 / 25 / 30 %.
Every epoch is judged on its own, so a plot that recovers still earns its later tranches.

Deployed on Base Sepolia (sources verified on Sourcify), with the full demo run on them:

| Contract | Address |
|---|---|
| ProjectRegistry | [`0xf03893E77fB5e8b28be7E73A929Ff930731E9eba`](https://sepolia.basescan.org/address/0xf03893E77fB5e8b28be7E73A929Ff930731E9eba) |
| SurvivalOracle | [`0x2622A1d172477551B905728e96FcCC54c554243D`](https://sepolia.basescan.org/address/0x2622A1d172477551B905728e96FcCC54c554243D) |
| MilestoneEscrow | [`0x493B840959dDbD2c1B958aBC4ef41006AF7E18eC`](https://sepolia.basescan.org/address/0x493B840959dDbD2c1B958aBC4ef41006AF7E18eC) |

Every transaction of that run is listed in `deployments/84532.demo.json` and on each plot's page.

## The measurement (`oracle/`)

1. **Site selection** (`oracle/scan.ts`): a grid of candidate 250 ha squares is scored by late-season
   canopy in a baseline and a test year; for the fire plot the grid is centred on the densest FIRMS
   cluster. Results are in `data/scan/`.
2. **Series** (`oracle/run.ts` → `data/series/<plot>.json`): Sentinel Hub Statistical API on the
   Copernicus Data Space, monthly least-cloudy mosaic, SCL mask (cloud, shadow, cirrus, snow out),
   an NDVI histogram per month. Canopy fraction = share of cloud-free pixels with NDVI ≥ 0.5.
3. **Score** (`shared/method.ts`, used by both the oracle and the website): each year is scored on its
   greenest cloud-free Aug–Oct month, against the median of 2019 and 2020. Clouds, haze and smoke only
   lower NDVI, so the maximum is the reading least contaminated by them; real canopy loss lowers every
   month. (This mattered: the Amazon plot reads near zero in September 2022 and 2024 from fire-season
   smoke, while its NBR barely moves.)
4. **Evidence** (`data/attestations/<plot>/epoch-<n>.json`): baseline, observed value, survival in
   basis points, the scored months, and `seriesHash` = keccak256 of the series file. A fire break
   (May–Oct canopy drop ≥ 0.2 with dNBR ≥ 0.1) carries its FIRMS count.

Anyone can redo step 3 from the published series. The Verify page does exactly that in the browser,
with the same code, and compares the result with the number on chain.

## What the demo shows

1. A developer registers the three plots. Registering the same polygon again reverts with
   `PlotAlreadyRegistered`; moving it 15 m (new hash) still reverts with `CellAlreadyClaimed`.
2. A funder escrows money for each project.
3. A verifier stakes and attests every epoch from the evidence files; after the challenge window the
   attestations are finalized and each epoch's tranche is released or frozen.
4. A second verifier claims the burned forest recovered to 94% in 2022, with a file whose numbers are
   inflated to match. The funder challenges with the honest evidence, the arbiter upholds it, the
   liar's stake is split between the challenger and the burn address, and the honest 14.49% takes the
   slot. On the Verify page the false file's hash matches the chain, but recomputing from the series
   gives 14.49%, not 94%.
5. With every epoch settled, the funder reclaims what stayed frozen and the developer withdraws what
   the canopy earned.

## Run it

Requires [Foundry](https://getfoundry.sh) and Node ≥ 22.18.

```bash
npm install
git submodule update --init      # forge-std
npm test                         # 41 Foundry tests, incl. fuzz
npm run demo:local               # anvil + deploy + full story
```

- **Oracle:** put `CDSE_CLIENT_ID`, `CDSE_CLIENT_SECRET` and `FIRMS_MAP_KEY` in `.env` (see
  `.env.example`), then `npm run oracle`. `npm run plots` rebuilds the plot geometry from
  `data/plots/plots.config.json` first if you change a plot.
- **Base Sepolia:** fill the keys in `.env` (a raw key or an encrypted keystore for the deployer), fund
  the deployer, then `npm run demo:testnet`. It deploys fresh contracts, submits the sources to
  Sourcify, runs the story and writes `deployments/84532.json` and `84532.demo.json`.
- **Web:** `cd web && npm install`, then `npm run dev` (live against a local anvil started with
  `KEEP_ANVIL=1 npm run demo:local`) or `npm run deploy` (sync data, build, deploy to Cloudflare).
  The site is read-only, has no wallet, and rebuilds every number from contract events. It reads a live
  deployment when `deployments/84532.json` exists, otherwise a recorded replay (`data/replay/`) behind a
  banner saying so.

## Repository

```
contracts/   Foundry: src/ (3 contracts), test/ (41 tests incl. fuzz), script/Deploy.s.sol
oracle/      Sentinel-2 + FIRMS pipeline: scan.ts (site selection), run.ts (series + evidence)
shared/      method.ts: the survival computation, shared by the oracle and the website
scripts/     plot preparation, deploy, demo runner, replay snapshot, web data sync
web/         Vite + React site: overview, plot record, in-browser verification
data/        plots, scans, series, attestations, replay
deployments/ contract addresses per chain, demo transaction logs
```

## Limits, stated plainly

- **One arbiter address.** In production this would be a multisig or a dispute protocol.
- **NDVI sees the canopy surface.** Thinning under a closed canopy barely moves it, and shrub regrowth
  counts as canopy once its NDVI passes 0.5: part of Manavgat's climb to 51% is maquis, not pine. The
  70% threshold keeps that from releasing money, but a production method would add structure (radar,
  lidar) or species-aware thresholds.
- **Plots are 250 ha squares placed by the scan**, standing in for real project boundaries.
- The contract cannot check that the H3 cells match the polygon; anyone can recompute them from the
  GeoJSON, and the Verify page does.
- One funding round per project; frozen funds can only be reclaimed after the final epoch.
- Testnet amounts are small (0.003 ETH per project) to fit the faucet budget.

Contains modified Copernicus Sentinel data (2019–2026). Fire data: NASA FIRMS (VIIRS S-NPP).
