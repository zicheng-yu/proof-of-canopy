# Demo video: narration and storyboard

Target 4:30, hard limit 5:00. English voice-over. Screen at 1440×900 or larger, browser zoom 100%.

**Before recording**
- For the "page updates live" shots: deploy fresh contracts and run `npm run demo:testnet` in a terminal beside the site (`cd web && npm run deploy` after the deploy writes `deployments/84532.json`). Each challenge window is 60 s; speed those stretches up in the edit and label them "sped up".
- Otherwise record the finished state on https://proofofcanopy.zichengyu.com and the terminal output from `deployments/84532.demo.json`.

| Time | Screen | Narration | On-screen text |
|---|---|---|---|
| 0:00–0:20 | Black, white text | "A forest carbon project promises decades of storage. The money often moves once, after one check. If the trees burn in year two, nothing in the payment flow reacts." | "Verified once. Paid once. What if the forest burns?" |
| 0:20–0:45 | Overview, hero and release-rule chart | "Proof of Canopy releases afforestation money one year at a time, in proportion to how much of the original canopy Sentinel-2 still sees. Below the threshold, the year's money is frozen." | "Money follows the canopy" |
| 0:45–1:20 | Scroll to the three plot cards, then the Manavgat page and its monthly chart | "Three real 250-hectare plots, one standard. Yedigöller in Türkiye is healthy. Novo Progresso in Brazil is degrading. Manavgat burned in the 2021 wildfire: canopy collapses in August 2021, confirmed by the burn index and fifteen NASA fire detections inside the plot." | "Sentinel-2 L2A · 93 months · NASA FIRMS" |
| 1:20–1:40 | Novo Progresso chart; hover a September dip | "Smoke fools NDVI: in the Amazon fire season this plot reads near zero for a month while the burn index barely moves. So each year is scored on its greenest late-season month, the reading least touched by smoke and cloud." | "Max-value composite" |
| 1:40–2:10 | Terminal: `npm run demo:testnet`, steps 1–3 | "Everything from here is on Base Sepolia. A developer registers the plots. Register the same land again and it's refused; shift the polygon fifteen metres and it's still refused, because its map cells are already claimed. A funder escrows the money." | "PlotAlreadyRegistered · CellAlreadyClaimed" |
| 2:10–2:50 | Terminal steps 4–6 beside the overview filling in; open one tx on Basescan | "A verifier stakes and attests every year, with the hash of the evidence file. After the challenge window, each year's tranche is released or frozen. Healthy: everything. Degraded: part. Burned: nothing." | "100% · 39–65% · 0%" |
| 2:50–3:30 | Terminal step 7; Manavgat page dispute section | "Now a verifier lies: 'the burned forest recovered to 94 percent.' Unchallenged, that would release money for trees that aren't there. The funder challenges with the honest evidence, and the liar's stake is slashed, half to the challenger, half burned." | "A lie has a price" |
| 3:30–3:55 | Verify page, attestation #15, Run the checks | "Don't trust us. The Verify page hashes the liar's file in your browser: the hash matches what's on chain. Then it recomputes survival from the satellite data with the oracle's own code: 14.49 percent, not 94." | "Hash ✓ · Recompute ✗" |
| 3:55–4:30 | Architecture diagram, then the overview | "The chain doesn't trust anyone; it makes lying expensive. The measurement isn't on chain, its evidence is, so anyone can recompute it. We measure canopy, not carbon: proof, year after year, that the trees are still there." | Site URL · GitHub URL |

**Cut first if over time:** the 1:20–1:40 smoke shot, then shorten the black-screen open.
