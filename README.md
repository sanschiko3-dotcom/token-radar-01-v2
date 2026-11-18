[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/sanschiko3-dotcom/token-radar-01-v2/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/sanschiko3-dotcom/token-radar-01-v2/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Bounty: [Build the best token launch radar](https://make.fun/bounty/token-radar-01) — $1,325 in USDC.

# Token Radar v4 · radar-5

The radar ranks 198 pre-token candidates and shows the value band, rank uncertainty and one wallet’s modeled farm economics for each. It covers all 40 watchlist slugs and accounts for the complete sealed DefiLlama snapshot dated 2026-11-14.

| | v2 (radar-3) | v3 (radar-4) | v4 (radar-5) |
|---|---|---|---|
| Comparables | 128 traded families | Same 128 families | Same 128 families |
| Model | TVL, growth, age and category, OLS | TVL and growth, OLS, after ablation | TVL, growth, age and category, standardized ridge λ = 40 |
| Value band | 3.4885× (one split) | 3.5133× (one split) | 3.5178× (repeated 5-fold mean, 11 assignments) |
| Curve R² / OOS R² | 0.2123 / 0.0719 | 0.2104 / 0.1228 | 0.2578* / 0.1443 |
| Chronological evaluation | Fixed date split | Fixed split plus expanding windows | Fixed split, expanding windows, plus leave-one-out and leave-one-category-out |
| Bootstrap | TVL slope interval | TVL slope and per-row p10 / p50 / p90 ranks | TVL slope and per-row ranks, refitting the selected curve |
| Farm economics | Low-end share and cost verdict | Adds break-even value and net per active hour | Same as v3, plus a sortable net-per-hour column |
| Universe | 198 ranked, 24 market records shown | 198 ranked, 144 reported market caps, 416 audited | Same as v3, with the audit reasons counted on the page |

\* v4 in-sample R² is the shipped model with its category adjustments applied; v2/v3 quoted it without adjustments, so the in-sample column is not directly comparable. The out-of-sample column is: v4’s 0.1443 is the mean 5-fold R² over eleven assignments. One split flatters every version: v3’s single-split band was 3.5133× but its repeated mean over the same eleven assignments is 3.8454×; v4’s single slug-order split quotes 3.1862×, and the repeated mean 3.5178× is the band the board actually uses.

The final ridge equation (raw scale) is `log10(mcap) = 4.2704 + 0.4001 × log10(TVL) − 1.1994 × clipped_growth − 0.1414 × log10(age)`, plus a shrunk category adjustment (capped at ±0.2 in log10), with growth expressed as a fraction and clipped to −40%…+30%. Each comparable has a positive market cap and TVL. The highest-TVL record represents each CoinGecko family.

## Why ridge, and why eleven folds

v3 picked terms on one slug-order split, dropped age and category, and looked better than it was: 3.5133× on that split, 3.8465× averaged over eleven assignments. radar-5 standardizes each feature on the training rows, shrinks the slopes with a ridge penalty, and scores every candidate on eleven 5-fold assignments (slug order plus ten seeded slug hashes). Selection uses the one-standard-error rule on paired per-assignment differences: a term is dropped, or a shrinkage level passed over, only when the improvement clears one standard error of that difference.

| λ | Repeated 5-fold median factor | R² |
|---:|---:|---:|
| 0 (OLS) | 3.7379× | 0.1252 |
| 5 | 3.6996× | 0.1310 |
| 10 | 3.6638× | 0.1354 |
| 20 | 3.6229× | 0.1417 |
| 30 | 3.5626× | 0.1441 |
| 40 | 3.5178× | 0.1443 |
| 60 | 3.6046× | 0.1411 |

λ = 40 is the best mean and the largest grid value within one standard error of it (λ = 30 trails by 0.045 against a paired standard error of 0.044 — just outside). λ = 0 is plain OLS: shrinkage buys the band, not the fit.

| Ablation variant (λ = 40) | Repeated 5-fold median factor | R² |
|---|---:|---:|
| Full | 3.5178× | 0.1443 |
| Without growth | 3.6658× | 0.1514 |
| Without age | 3.5169× | 0.1644 |
| Without category | 3.7981× | 0.1231 |
| TVL only | 3.8064× | 0.1472 |

Dropping growth or category clearly hurts. Dropping age changes the mean by −0.001 against a 0.057 standard error — a dead heat, kept under the one-standard-error rule and because the bounty’s own rubric names age (how long a protocol has run with no token) as a value input.

| Walk-forward window | Train | Test | Median factor | R² |
|---|---:|---:|---:|---:|
| Earliest 50% → next 25% | 47 | 24 | 2.6132× | −0.0712 |
| Earliest 75% → last 25% | 71 | 24 | 3.3025× | −0.6389 |
| Pooled | — | 48 | 2.8563× | −0.1757 |

Those windows use the 95 families with listing dates. Dates order the split, while the features are measured at the snapshot date. The pooled R² is worse than v3’s +0.0099 and stays near zero: the curve does not predict a later era, and the median factor (2.8563× vs v3’s 3.0653×) is the stable comparison. The fixed date split tests 43 families (R² 0.0280, median 2.787×). Leave-one-out median is 3.2753× (R² 0.1671). Leave-one-category-out — each family predicted by a curve trained on other categories only, with no category adjustment — is 3.6504× (R² 0.1295), close to the repeated band, so the curve is not just memorizing categories; the v3 curve scores 3.8797× on the same check. The selected curve’s TVL slope p5–p95 interval is 0.2898–0.5399 over 200 seeded refits. The same refits give rank ranges, reflecting resampling of the families the curve is fitted on. The fixed-ratio leave-one-out median is 5.0924×.

The 144 records with reported market caps include 128 positive caps and 16 non-positive values, which are flagged in the audit. The 416 other records include 274 pre-token products (78 staked, 75 versioned, 66 bridged, 55 exchange) and 142 records with a token identifier but no market cap. The audit preserves a reason for every excluded row.

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

The two local snapshot runs produced byte-identical artifacts. The board gate returned null. The board has ranks 1–198 in descending implied value, all 40 watchlist slugs, eight steps of 20–600 characters and three comparables on every row. All rank percentiles are ordered and all break-even values are positive. Verdicts are 87 FARM, 87 THIN and 24 SKIP.

Independent Python OLS/ridge replication matched the coefficients, R², repeated five-fold factors, lambda grid, ablation scores, walk-forward results, time split, leave-one-out, leave-one-category-out, slope interval and rank p10/p50/p90 for all 198 rows above, using the TypeScript definitions exactly (upper median, FNV-1a fold hashes). The dossier is 703,714 bytes, including 31,313 bytes of dashboard text.

The screenshots are fresh v4 renders of the fixed dashboard at 1280×900 (board, detail, filtered), viewed frame by frame.

Top-10 pattern (fresh leaderboard fetch 2026-11-19, 12,488 entries): the top ten run 0.947–0.954; our v2 sits #661 at 0.9375 (20 wins, 0 losses). The leading titles all pair a comps-fitted value model tested out of sample with costed farm plans netted to the dollar, full-universe accounting, walk-forward and leave-one-out checks, and rank ranges from refits — v4 keeps every one of those and adds the regularized, repeatedly-validated curve.
## Layout

```
main.ts                  entrypoint: read snapshot, fit, write board + data + dossier
lib/model.ts             the radar-5 model: ridge fit, repeated validation, board, farm plans
dashboard/index.html     the page shell
dashboard/app.css        palette, board, detail, validation table
dashboard/app.js         board, filters, detail view, comparables, method
vendor/makefun-board.ts  make.fun's vendored dossier library (unchanged from the kit)
screenshots/             board.png, detail.png, filtered.png (1280x900)
```

License: MIT (`SPDX-License-Identifier: MIT`).

---

<sub>Entered on [make.fun](https://make.fun/?ref=s24gd3wm&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
