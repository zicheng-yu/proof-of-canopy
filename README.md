# Proof of Canopy

**Track: Carbon Markets & Emissions Transparency**

Afforestation money should not be paid out once, at planting. Proof of Canopy keeps it in escrow and
releases it year by year according to **satellite-verified canopy survival**: healthy forest releases,
degraded forest releases partially, burned forest releases nothing. The verifier who reports survival
must stake, can be challenged, and is slashed when caught lying.

> **Scope.** This is a monitoring, reporting and verification (MRV) and payout layer. It does not do
> carbon accounting: tonnes of CO₂ per hectare come from the project's own methodology, not from us.

## How it works

| Contract | Job |
|---|---|
| `ProjectRegistry` | One identity per plot: `plotHash` = keccak256 of the canonical GeoJSON bytes, plus the H3 (res 9, ~10.5 ha) cells the plot covers. Each cell can belong to one project only, so a copy shifted by a few metres is rejected too. |
| `SurvivalOracle` | Verifiers stake, then attest `survivalBps` for a (project, epoch) with the keccak256 of the evidence file. Anyone may challenge within the window by posting a bond. The arbiter decides; the loser's stake or bond is split 50% to the winner, 50% burned. |
| `MilestoneEscrow` | Funder deposits once. Each finalized epoch releases `tranche × f(s)`, with `f(s) = clamp((s − T) / (1 − T), 0, 1)` and the threshold `T` set per project at registration. Unreleased money stays frozen; the funder can reclaim it after the last epoch. Payments are pull-based (`withdraw`). |

Tranches are back-loaded, weight ∝ (epoch + 2): with five epochs that's 10 / 15 / 20 / 25 / 30 %.
Every epoch is judged on its own, so a plot that recovers still earns its later tranches.

With `T = 70%`, a plot at 96% survival gets 86.7% of its tranche, 78% gets 26.7%, 31% gets nothing.

## Repository

```
contracts/   Foundry: src/ (3 contracts), test/ (41 tests incl. fuzz), script/Deploy.s.sol
scripts/     TypeScript (Node ≥ 22.18, no build step): plot preparation, demo runner
data/plots/  plots.config.json → canonical *.geojson + manifest.json (hashes, H3 cells)
data/attestations/  evidence files whose keccak256 goes on chain
deployments/ contract addresses per chain, demo transaction logs
oracle/      Sentinel-2 pipeline (to do) and its output contract
```

## Run it

Requires [Foundry](https://getfoundry.sh) and Node ≥ 22.18.

```bash
npm install
git submodule update --init      # forge-std
npm test                         # forge test
npm run demo:local               # anvil + deploy + full story, about 10 s
```

`npm run plots` rebuilds plot geometry from `data/plots/plots.config.json`. To use a real polygon,
export it from EO Browser into `data/plots/`, set `"source": "<file>.geojson"` on the plot (instead of
`center`) and rerun.

**Base Sepolia:** copy `.env.example` to `.env`, fill in the keys, fund the deployer, then
`npm run demo:testnet`. It deploys fresh contracts, verifies them on Basescan when
`ETHERSCAN_API_KEY` is set, and writes `deployments/84532.json` and `84532.demo.json`.

## What the demo shows

1. A developer registers three 250 ha plots.
2. Registering the same polygon again reverts with `PlotAlreadyRegistered`; moving it 15 m (new hash)
   still reverts with `CellAlreadyClaimed`.
3. A funder escrows money for each project.
4. A verifier stakes and attests epoch 0 for each plot, with the hash of the evidence file.
5. The challenge window passes.
6. Finalize and release: 86.66% / 26.66% / 0% of the first tranche; the developer withdraws.
7. A second verifier claims the burned forest recovered to 94%. The funder challenges with counter-
   evidence, the arbiter upholds it, the liar's stake is split between the challenger and the burn
   address, and an honest attestation takes the slot.

## Current limits, stated plainly

- **Plots are placeholders** (squares around candidate points) until the satellite data check picks
  the real polygons.
- **Attestation values are fixtures** taken from the project plan, marked `"fixture": true` in every
  file. The Sentinel-2 pipeline in `oracle/` will replace them.
- **One arbiter address.** In production this would be a multisig or a dispute protocol.
- The contract cannot check that the H3 cells match the polygon; anyone can recompute them from the
  GeoJSON with `scripts/lib/geo.ts`.
- One funding round per project; frozen funds can only be reclaimed after the final epoch.
