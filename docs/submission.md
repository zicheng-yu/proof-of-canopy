# Proof of Canopy

**Track: Carbon Markets & Emissions Transparency**

Afforestation funding, released only while the forest is still standing.

- Live site: https://proofofcanopy.zichengyu.com
- Code: https://github.com/zicheng-yu/proof-of-canopy
- Contracts (Base Sepolia, sources verified on Sourcify): ProjectRegistry `0x9b63be2BC0c7a056606A46cdC2Dd0cb5723fda2d`, SurvivalOracle `0x5BA5da334254FBbDF611ad1b2AbC7B22aFB44702`, MilestoneEscrow `0xb2AC9d36301cA0Cd1F001A19CE600fc5d6954a39`
- Demo video (3:26, recorded live on Base Sepolia): https://proofofcanopy.zichengyu.com/video/

## Problem

Forest carbon projects promise decades of storage, but money and credits often move once, after a single verification. If the trees burn or are cleared in year two, nothing in the payment flow reacts, and the party that certified the plot carries no consequence for having been wrong.

## Solution

Proof of Canopy holds the funding in an on-chain escrow and releases it one year at a time, in proportion to how much of the plot's 2019–2020 canopy Sentinel-2 still sees. At or below a threshold set when the project registers (70% here), that year's tranche is frozen; a plot that recovers still earns its later tranches. The survival figure comes from a verifier who must stake on every claim. Anyone can challenge a claim within a window by posting a bond, and whoever is wrong loses their deposit: half to the other side, half burned.

We measure canopy, not carbon. Tonnes of CO₂ per hectare stay with each project's own methodology; what we add is year-by-year proof that the trees behind those tonnes are still there.

## What is built and running

- **Real satellite evidence for three 250 ha plots chosen from data:** Yedigöller (Bolu, Türkiye, healthy), Novo Progresso (Pará, Brazil, degraded), and Manavgat (Antalya, Türkiye, burned in the 2021 wildfire). Each has 93 months of Sentinel-2 L2A statistics from the Copernicus Data Space plus NASA FIRMS fire detections.
- **Five years settled on chain:** Yedigöller kept ~100% of its canopy and received its full tranches. Novo Progresso kept 82–89% and received 39–65% of each tranche. Manavgat kept 14–51% and received nothing. The Manavgat fire is confirmed three independent ways: a canopy break in August 2021, dNBR 0.33 across it, and 15 FIRMS detections inside the plot on 1–2 August 2021.
- **Three Solidity contracts on Base Sepolia, with the whole story run on them in 61 transactions:** registration, a refused double registration, funding, 15 settled years, and a staged false claim ("the burned forest recovered to 94%") that is challenged and slashed. At the end the funder reclaims the frozen money.
- **41 Foundry tests, including fuzz tests:** tranches always sum to the escrowed amount, a higher survival never releases less, and funds are conserved.

## Why it needs a chain

A database has an owner, and the owner is always one of the three parties: funder, developer or verifier. Plain escrow can lock money, but not the number that unlocks it. A signature proves who said something, but neither stops them from saying two different things nor makes lying cost anything. Here, a plot's identity is unique on chain: a polygon shifted 15 m is still refused, because its H3 cells are already claimed. Every claim is public, timestamped, staked and challengeable. The measurement itself stays off chain, but its inputs and outputs are hashed on chain, so anyone can recompute it.

## Verify it yourself

The website is read-only and rebuilds every number from contract events. Its Verify page fetches the published evidence, hashes it in the browser, compares the hash with the one on chain, and recomputes survival from the satellite series using the same code the oracle uses. For the staged false claim, the file's hash matches the chain, but recomputing gives 14.49%, not the 94% that was claimed.

## Target users

- **Funders and credit buyers** (corporate pre-purchase, climate funds) who want payment tied to outcomes rather than promises.
- **Project developers** who can raise staged money against a credible, public survival record.
- **Independent verifiers** who earn by staking on accurate claims, and lose stake on wrong ones.
- **Registries** that need a guard against registering the same land twice.

## Scale and adoption path

Scale: one API request fetches seven years of monthly statistics for a plot. Settling one plot-year costs ~320k gas (attest, finalize, release), and registering a plot ~780k. H3 cells give a global index for "has this land already been claimed?". The method is open: one file, `shared/method.ts`.

Adoption path:
1. Run alongside an existing project as a monitoring layer, without changing its methodology.
2. A funder escrows one pilot tranche.
3. Open the verifier role to staked third parties.
4. Replace the single arbiter with a multisig or dispute protocol, and add radar or lidar so canopy structure can be measured, not only canopy greenness.

## Limits, stated plainly

- Disputes are resolved by one arbiter address in this version.
- NDVI sees the canopy surface. Shrub regrowth counts as canopy once its NDVI passes 0.5; part of Manavgat's climb to 51% is maquis. The 70% threshold keeps that from releasing money.
- Plots are 250 ha squares placed by our scan, standing in for real project boundaries.
- Testnet amounts are small.
