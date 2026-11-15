# Token Radar v2 — comps-fitted value, validated three ways

A launch radar for the 198 protocols in the sealed DefiLlama snapshot that record no token:
ranked by what their token would be worth if their record stayed as it is, with an 8-step
mechanism-aware farm plan for each one, netted to the dollar.

Competition: **token-radar-01** ("Build the best token launch radar"), $1,325. This is v2 of the
entry submitted as `token-radar-01` (v1: rank #2692, judge rate 0.8694). v2 rebuilds the value
model from the fit outward, because v1's fit was the weakest link.

## What changed vs v1

| | v1 (radar-2) | v2 (radar-3) |
|---|---|---|
| Comparables | 92 families (Bridge/CEX/LST excluded) | **128 families** — every family with a positive market cap |
| Curve | log10(mcap) ~ log10(TVL) only | log10(mcap) ~ log10(TVL) + 7d growth + log10(age), all fitted |
| Growth & age | hand-set multipliers (0.5 weight, 0.6–1.0 maturity ramp) | **fitted slopes** — no hand-set weights anywhere |
| Validation | leave-one-out only | **5-fold CV + time split + 200-draw bootstrap** |
| Band | ±3.51x (LOO median) | **±3.49x** (5-fold OOS median) |
| R² | 0.1041 in-sample | **0.2123 in-sample, 0.0719 out-of-sample** |
| Farm plans | 7 generic steps, one category action | **8 steps, mechanism-aware** (DEX swaps + LPs, lending supplies + borrows, perps post margin + hedge…) plus a risks step |
| Detail view | model breakdown + plan | + **3 nearest comparables** per protocol (same category first) |
| Board | 198 rows, 40/40 watchlist | 198 rows, 40/40 watchlist (every clean pre-token protocol — there are no more) |

The honest numbers, stated on the page itself: the time split — fitted before 2024-06-01,
tested on the families listed after — has an out-of-sample R² of about zero. The curve is a
ranking device, not a pricing oracle. What survives is the ranking: median error ±3.49x
against ±5.09x for a fixed mcap/TVL multiple, and the TVL slope stays positive in 90% of
bootstrap draws (0.38–0.71).

Two data facts the model is built around: one pre-token protocol prints **+4,448% TVL growth
in seven days**, so the growth feature is clipped to the comps' own observed range
(−40%..+30%) and no slope is ever extrapolated to it; and the fitted growth slope is
**negative** (−1.64) — at the same TVL, a protocol whose TVL just spiked trades *lower*,
because incentive-driven TVL does not come with market cap.

## The model (radar-3)

```
log10(mcap) = a + b·log10(TVL) + c·chg7d + d·log10(age_days) + category
```

- **Comps:** 128 token families (distinct `gecko_id`, largest TVL wins, mcap > 0). 30 token
  records carry a market cap of 0 or less (dead or unpriced tokens) and are excluded and named
  (the count is per record, before family de-duplication).
  v1 excluded Bridge/CEX/Liquid-Staking families from the comps; that exclusion is a
  *watchlist* rule about what counts as a launch still to come, not a fact about the size
  curve — and the out-of-sample numbers say to drop it (5-fold median error 3.49x on the
  128 vs 3.97x on the 92-family cleaned set, same model, same folds).
- **Category adjustment:** median log-residual of the protocol's category, shrunk by
  n/(n+4) toward zero, capped at ±0.2 dex, zero below 3 comps. The cap is tighter than v1's
  ±0.5 because the wider cap did not survive out-of-sample validation.
- **Band:** implied ÷ F … implied × F, F = 5-fold out-of-sample median error factor of the
  whole pipeline (curve + adjustment, refitted per fold). Deterministic: folds are slug
  order mod 5, the bootstrap draws from a seeded generator, no wall clock anywhere.
- **Verdict:** one farmer's low-end share = low end of the band × 5% to farmers ÷ (TVL /
  $10,000 estimated farmers). FARM at ≥3× the farm's gas cost, THIN at ≥1×, else SKIP.
  Rank is the protocol's launch value; the verdict is one farmer's economics.

## The board

- **198 rows** — every clean pre-token protocol in the snapshot, including all 40 of the
  watchlist. The 342 protocols that record no token include 144 versioned, wrapped, staked
  or bridged products of tokens that already trade; those are audited but not ranked.
- Each row: rank, implied value + band, TVL, 7-day change, age, one farmer's low-end share,
  verdict, and an 8-step farm plan with a cost and a time on every step.
- The dashboard is sortable (rank, TVL, growth, age, implied value, per-farmer), filterable
  (search, category, verdict, watchlist-only), and every row opens a detail view with the
  model breakdown, three comparables and the full plan. State lives in the URL hash
  (`#detail=<slug>`, `#watchlist=1`, `#category=`, `#verdict=`, `#q=`, `#sort=`).

## How to run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-kit>/input/snapshot.json
```

Node 22+, standard library only, no network. The program runs twice in grading and both runs
must write the same bytes — the fit, the folds and the bootstrap are all deterministic.

`main.ts` reads the snapshot, fits the curve, writes `board.json` (198 rows), `data.js`,
copies `dashboard/` and `screenshots/`, and writes `dossier.json` with the vendored
`vendor/makefun-board.ts`.

## Verification (local, this session)

- `main.ts` run twice on the kit snapshot: byte-for-byte identical output.
- Board: 198 rows, ranks 1..198, implied values non-increasing, 40/40 watchlist, every row
  8 farm steps of 20–600 chars and exactly 3 comparables.
- Fit: 128 comps, R² 0.2123, 5-fold OOS R² 0.0719, band ±3.49x (p80 ±13.5x), time-split OOS
  R² −0.0317 (n=43 tested), TVL slope bootstrap 90% 0.38–0.71, fixed-ratio baseline ±5.09x.
- Screenshots: real headless-Chromium renders of the built page (board, detail, filtered),
  1280×900, viewed frame by frame.

## Limits, stated on the page

- The board does not predict whether or when a token is issued; a protocol on it may still
  have a token its DefiLlama record does not carry.
- TVL, growth and age explain only ~21% of log market cap in-sample and ~7% out-of-sample;
  every implied value carries its ±3.49x band, and the time split says the curve does not
  predict a later era at all.
- The farmer count (TVL ÷ $10,000) is rough — TVL is whale-skewed — and the verdict rests
  on the stated 5%-of-low-end assumption.
- Implied values are this entry's own claim, never make.fun's; farm plans are a starting
  point, not financial advice.

## Layout

```
main.ts                  entrypoint: read snapshot, fit, write board + data + dossier
lib/model.ts             the radar-3 model: fit, validation, board, farm plans
dashboard/index.html     the page shell
dashboard/app.css        palette, board, detail, validation table
dashboard/app.js         board, filters, detail view, comparables, method
vendor/makefun-board.ts  make.fun's vendored dossier library (unchanged from the kit)
screenshots/             board.png, detail.png, filtered.png (1280x900)
```

License: MIT (`SPDX-License-Identifier: MIT`).
