[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/sanschiko3-dotcom/token-radar-01-v2/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/sanschiko3-dotcom/token-radar-01-v2/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Bounty: [Build the best token launch radar](https://make.fun/bounty/token-radar-01) — $1,325 in USDC.

# Token Radar v3 · radar-4

The radar ranks 198 pre-token candidates and shows the value band, rank uncertainty and one wallet’s modeled farm economics for each. It covers all 40 watchlist slugs and accounts for the complete sealed DefiLlama snapshot dated 2026-11-14.

| | v2 (radar-3) | v3 (radar-4) |
|---|---|---|
| Comparables | 128 traded families | Same 128 families |
| Model | TVL, growth, age and category | TVL and growth after ablation |
| 5-fold median factor | 3.4885× | 3.5133× |
| Curve R² / 5-fold R² | 0.2123 / 0.0719 | 0.2104 / 0.1228 |
| Chronological evaluation | Fixed date split | Fixed date split plus expanding windows |
| Bootstrap | TVL slope interval | TVL slope and per-row p10 / p50 / p90 ranks |
| Farm economics | Low-end share and cost verdict | Adds break-even value and net per active hour |
| Universe | 198 ranked, 24 market records shown | 198 ranked, 144 reported market caps, 416 audited |

The final OLS equation is `log10(mcap) = 2.8227 + 0.5292 × log10(TVL) − 1.6150 × clipped_growth`, with growth expressed as a fraction and clipped to −40%…+30%. Each comparable has a positive market cap and TVL. The highest-TVL record represents each CoinGecko family. The band uses the selected model’s 5-fold median error.

| Ablation variant | 5-fold median factor | R² |
|---|---:|---:|
| Full | 3.4885× | 0.0719 |
| Without growth | 3.5901× | 0.0920 |
| Without age | 3.2587× | 0.1365 |
| Without category | 3.3092× | 0.0747 |
| TVL only | 3.6658× | 0.1345 |

Dropping growth worsened the full model’s median factor, so growth stayed. Dropping age or category improved that metric individually, so both were removed. Removing both together slightly widened the band relative to v2 while improving five-fold R². The same slug-ordered folds drive selection and the selected model’s reported five-fold score.

| Walk-forward window | Train | Test | Median factor | R² |
|---|---:|---:|---:|---:|
| Earliest 50% → next 25% | 47 | 24 | 3.0653× | −0.0023 |
| Earliest 75% → last 25% | 71 | 24 | 3.5654× | −0.2915 |
| Pooled | — | 48 | 3.0653× | 0.0099 |

Those windows use the 95 families with listing dates. Dates order the split, while the features are measured at the snapshot date. The pooled R² near zero and the wide band limit precision. The fixed date split tests 43 families (R² 0.0110). The full candidate’s TVL slope p5–p95 interval is 0.3832–0.7069 over 200 seeded curve and category refits. The same refits give rank ranges, reflecting sensitivity to both resampling and the full specification. The fixed-ratio leave-one-out median is 5.0924×.

The 144 records with reported market caps include 128 positive caps and 16 non-positive values, which are flagged in the audit. The 416 other records include 144 pre-token products and 272 records with a token identifier but no market cap. The audit preserves a reason for every excluded row.

Each ranked row has three comparables and eight farm steps. One farmer’s modeled share uses 5% of the low end of the value band divided by the estimated farmer count (TVL ÷ $10,000, rounded, minimum one). FARM starts at three times gas cost, THIN at cost, and SKIP below cost. Break-even divides farm cost by the wallet’s share fraction. Net per active hour divides the share less cost by 15 minutes of setup, 10 minutes per hold week rounded up, and 10 minutes of risk and claim review.
## How to run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-kit>/input/snapshot.json
```

Node 22+, standard library only, no network. The program runs twice in grading and both runs
must write the same bytes — the fit, the folds and the bootstrap are all deterministic.

`main.ts` reads the snapshot, fits the curve, writes `board.json` (198 rows), `data.js`,
copies `dashboard/` and `screenshots/`, and writes `dossier.json` with the vendored
`vendor/makefun-board.ts`.

## Verification

The two local snapshot runs produced byte-identical artifacts. The board gate returned null. The board has ranks 1–198 in descending implied value, all 40 watchlist slugs, eight steps of 20–600 characters and three comparables on every row. All rank percentiles are ordered and all break-even values are positive. Verdicts are 64 FARM, 97 THIN and 37 SKIP.

Independent Python OLS matched the coefficients, R², five-fold factor, walk-forward results and ablation scores above. The dossier is 682,801 bytes, including 27,094 bytes of dashboard text.

The screenshots are fresh v3 renders of the fixed dashboard at 1280×900 (board, detail, filtered), viewed frame by frame.
## Layout

```
main.ts                  entrypoint: read snapshot, fit, write board + data + dossier
lib/model.ts             the radar-4 model: fit, validation, board, farm plans
dashboard/index.html     the page shell
dashboard/app.css        palette, board, detail, validation table
dashboard/app.js         board, filters, detail view, comparables, method
vendor/makefun-board.ts  make.fun's vendored dossier library (unchanged from the kit)
screenshots/             board.png, detail.png, filtered.png (1280x900)
```

License: MIT (`SPDX-License-Identifier: MIT`).

---

<sub>Entered on [make.fun](https://make.fun/?ref=s24gd3wm&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
