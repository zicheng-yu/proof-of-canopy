**Track: Carbon Markets & Emissions Transparency** · [Live site](https://proofofcanopy.zichengyu.com) · [Verify a claim yourself](https://proofofcanopy.zichengyu.com/verify) · [Code](https://github.com/zicheng-yu/proof-of-canopy)

## Inspiration

A forest carbon project promises decades of storage, but its money often moves once, after a single verification near planting. If the trees burn in year two, nothing in the payment flow reacts, and whoever vouched for the plot carries no consequence for having been wrong.

We wanted to flip that: pay for forests that are **still standing**, year after year, and make lying about them expensive.

## What it does

Funding sits in an on-chain escrow and is released one year at a time, in proportion to how much of the plot's 2019–2020 canopy Sentinel-2 still sees. Each year \\( e \\) of a five-year schedule gets a back-loaded tranche (10 / 15 / 20 / 25 / 30 %), and pays out

$$ \text{payout}_e = \text{tranche}_e \times f(s_e), \qquad f(s) = \min\!\left(1,\ \max\!\left(0,\ \frac{s - T}{1 - T}\right)\right) $$

where \\( s_e \\) is the canopy retained against the baseline and \\( T \\) is a threshold fixed when the project registers (70% here). At or below \\( T \\) the year's money stays frozen. A plot that recovers still earns its later tranches, and the funder gets the frozen money back after the last year.

The survival number comes from a **verifier who stakes on every claim**. Anyone can challenge a claim within a window by posting a bond; whoever turns out to be wrong loses their deposit, half to the other side and half burned.

**We measure canopy, not carbon.** Tonnes of CO₂ per hectare stay with each project's own methodology; what we add is year-by-year proof that the trees behind those tonnes are still there.

### Three real plots, five years

| Plot (250 ha each) | 2021 | 2022 | 2023 | 2024 | 2025 |
|---|---|---|---|---|---|
| Yedigöller, Bolu, Türkiye (healthy) | 100% → 100% | 100% → 100% | 100% → 100% | 100% → 100% | 99.8% → 99.4% |
| Novo Progresso, Pará, Brazil (degrading) | 100% → 100% | 81.7% → 38.9% | 86.9% → 56.4% | 86.1% → 53.8% | 89.4% → 64.6% |
| Manavgat, Antalya, Türkiye (2021 wildfire) | 16.2% → 0% | 14.5% → 0% | 26.6% → 0% | 47.5% → 0% | 50.9% → 0% |

Each cell: canopy retained → share of that year's tranche released, all settled on Base Sepolia. The Manavgat fire is confirmed three independent ways: the canopy drops from 0.83 to 0.00 in August 2021, the burn ratio drops (dNBR 0.33), and NASA FIRMS records 15 active-fire detections inside the plot on 1–2 August 2021.

### Don't trust us, check it

The website is read-only and rebuilds every number from contract events. Its **Verify** page fetches the published evidence, hashes it in your browser, compares it with the hash on chain, and **recomputes survival from the satellite series with the same code the oracle uses**. In the demo a second verifier claims the burned forest "recovered to 94%". The file's hash matches the chain (it is exactly what was staked), but recomputing gives 14.49%. The funder challenged it in time, and the liar's stake was slashed.

## How we built it

- **Satellite oracle (TypeScript, Node).** A scan scores grids of candidate 250 ha squares to pick plots from data, not by eye; for the fire plot the grid is centred on the densest cluster of 2,721 FIRMS detections from the 2021 fire. For each plot, one Sentinel Hub Statistical API request on the Copernicus Data Space returns 93 months (2019-01 to 2026-09) of Sentinel-2 L2A statistics: the least cloudy scene per month, clouds, shadow and snow masked per pixel (SCL), and a 40-bin NDVI histogram. Canopy fraction = share of cloud-free 10 m pixels with NDVI ≥ 0.5.
- **The score (`shared/method.ts`).** Each year is scored on its greenest cloud-free August–October month, against the median of 2019 and 2020. Each evidence file stores the result plus `seriesHash`, the keccak256 of the series it was computed from; the chain stores keccak256 of the evidence file itself. The website imports the same file to recompute it.
- **Contracts (Solidity 0.8, Foundry).** `ProjectRegistry` gives each plot one identity: the hash of its canonical GeoJSON plus the H3 cells (resolution 9) it covers, each claimable once, so a copy shifted by 15 m is still rejected. `SurvivalOracle` handles stakes, attestations, bonded challenges, finalization and 50/50 slashing. `MilestoneEscrow` handles tranches, release, frozen funds, reclaim and pull payments. 41 Foundry tests, including fuzz tests: tranches always sum to the escrowed amount, a higher survival never releases less, funds are conserved. Deployed on Base Sepolia, sources verified on Sourcify.
- **Demo runner (viem).** One command registers the plots, funds them, attests and settles all five years, stages a false claim that gets challenged and slashed, and returns frozen money; 61 transactions per run.
- **Website (React, Vite, Leaflet, h3-js).** Event-sourced and wallet-free, hosted on Cloudflare Workers. Map tiles: Sentinel-2 cloudless by EOX.
- **Video.** Recorded live with Playwright: the real terminal output streamed into a page, and the website updating itself as transactions landed. Cut with ffmpeg; challenge windows are sped up and labelled.

## Challenges we ran into

- **Smoke fools NDVI.** Over the Amazon plot, September 2022 reads almost bare (canopy 0.79 → 0.01) while the burn ratio doesn't move (NBR 0.54). That is fire-season haze, not lost forest. Averaging months would have paid the developer less for smoke. We switched to a maximum-value composite: clouds, haze and smoke only ever lower NDVI, so the greenest late-season month is the least contaminated, while real loss lowers every month. Fire events must also show a burn signature (dNBR ≥ 0.1) before we flag them.
- **Snow and leaf-off look like loss.** Winter months at Yedigöller dip hard. Scoring only August–October avoids that.
- **API details that fail silently.** In EPSG:4326, `resx = 10` means 10 *degrees*, so we compute about 10 m in degrees per plot latitude. The histogram edges have to be sent as `-1.0`/`1.0` (integers are rejected for FLOAT32 output). The free tier rate-limits bursts.
- **Public RPC limits.** The official Base Sepolia endpoint caps `eth_getLogs` at 200 blocks, which would make the site slower every day. The browser reads from uncapped endpoints instead, using the block timestamps returned with the logs.
- **Honest numbers under a deadline.** We started with placeholder plots and fixture values, then replaced them all with measured data. Everything the site shows can be traced to a file with a hash on chain.

## Accomplishments that we're proud of

- Real data end to end: three plots, 93 months each, five settled years, a fire confirmed three independent ways.
- A false claim that is internally consistent, so its hash checks out, and is still caught by recomputing it in the browser.
- A double-registration guard that survives a 15 m shift of the boundary.
- 41 tests including fuzzing of the escrow invariants, and a full on-chain run anyone can replay with one command.

## What we learned

- The hard part of MRV isn't the chain, it's deciding what a satellite number means. A matching hash proves a file wasn't edited, not that it is right, which is why the verifier role needs stake and a challenge window.
- NDVI sees the canopy surface. At Manavgat, part of the climb to 51% by 2025 is shrubland (maquis), not pine. The 70% threshold keeps that from releasing money, but it shows where optical data stops.

## What's next for Proof of Canopy

- Run beside an existing afforestation project as a monitoring layer, without changing its carbon methodology, with a funder escrowing one pilot tranche.
- Open the verifier role to staked third parties, and replace the single arbiter address with a multisig or a dispute protocol.
- Add radar (Sentinel-1) or lidar so the method sees canopy structure, not only greenness, and use species-aware thresholds.
- Use real project boundaries instead of our 250 ha squares, and stablecoin escrow on mainnet.

*Contains modified Copernicus Sentinel data (2019–2026). Fire data: NASA FIRMS (VIIRS S-NPP).*
