[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/sanschiko3-dotcom/token-radar-01-v2/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/sanschiko3-dotcom/token-radar-01-v2/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# Token Radar v8 — radar-5 model, resubmitted (v8-minimal)

Entry for the [make.fun token-radar-01 bounty](https://make.fun/bounty/token-radar-01): a program that reads a sealed snapshot of 758 DeFi protocols and writes a web dashboard ranking the pre-token ones by what their launch would be worth, each with the steps to farm it.

## What changed vs v7 (and why this is v8-minimal, not v8-full)

v6/v7 (score 0.410060, down from v4's 0.889086) rewrote the farm economics
without dilution and replaced the listing probability with a flat empirical
bucket estimate. A controlled diagnosis on the same snapshot showed both
changes were regressions: v6's FARM picked the largest protocols (median TVL
$90.0M, vs $10.7M for v4), 17 of its 69 FARM rows are rows v4 prices as SKIP,
and its P(list) had sd 0.057 with max 0.296 — no row could ever clear a
P ≥ 0.35 gate.

v8-full (v4 framework + a discriminative P(list)) was built and tested first:
hierarchical-backoff buckets (prior 5, most-specific bucket with n ≥ 30),
then logistic regressions with and without category dummies, all on the
mcap≠null label with 5-fold held-out evaluation. None of them passed the
pre-submit gates, measured on the kit snapshot:

- backoff n≥30 / prior 5: P sd 0.085, max 0.341, log-loss 0.4795, AUC 0.556;
  backoff n≥10: sd 0.090, max 0.372, log-loss 0.4654; backoff n≥5: sd 0.097,
  max 0.412, log-loss 0.4539 — still below the v6 odds' 0.4610 log-loss on
  the same folds for the n≥10/30 variants, and never near sd ≥ 0.15 / max ≥ 0.50.
- logistic (log TVL, growth, log age): log-loss 0.4630, AUC 0.655, board P
  sd 0.081, max 0.378. Logistic + category dummies (λ=5): log-loss 0.4497,
  AUC 0.686 — the best log-loss of any candidate — but board P sd 0.090,
  max 0.469, and the P-discounted ranking only reaches Spearman 0.58 vs v4.
- Discounting the farm economics by any of these P models leaves FARM at
  0–1 rows (the best row, anemoy-capital, is 10.9× cost undiscounted but
  only 2.9× at P 0.26), so the dual-gate board is degenerate.

The label itself carries too little signal on this snapshot for an honest
P(list) to be discriminative: the most favourable bucket in the data has a
raw listing rate of about 0.4. Submitting a P-discounted board would be a
measured step backwards, so v8 ships the undefeated design instead: the v4
(radar-5) code verbatim, with the v7 path fix (all paths resolve from the
entrypoint file's own directory, never from the working directory, so the
grader run from cwd=/ works) and this README. No P(list), no economics
change. v4 scored 0.889086 on the dev games; v5 scored 0.699255 and v6/v7
0.410060.

## What changed vs v3 (radar-4 → radar-5)

v3 picked its terms on a single slug-order split, which dropped age and the
category adjustments; that split's band was 3.5133× but its repeated mean
was 3.8454×. v4 selects on eleven fold assignments with a one-standard-error
rule, keeps all three terms, and fits a standardized ridge instead of OLS.

## The model

Standardized ridge (λ\* = 40) on the 128 traded families, features standardized on TRAIN rows only (population std), intercept unpenalised, category adjustments shrunk (k = 4, cap ±0.2, at least 3 comps):

```
log10(mcap) = 4.2704 + 0.4001 × log10(TVL) − 1.1994 × clipped growth − 0.1414 × log10(age) + category adjustment
```

Growth is the 7-day TVL change clipped to [−40%, +30%]; age is days since first listing (1000 when unlisted). Implied value = 10^prediction, rounded to whole dollars; the low–high band divides / multiplies by the repeated-CV factor 3.5178×.

## Validation (repeated 5-fold, 11 assignments)

| λ | Median factor | R² |
|---|---:|---:|
| 0 (OLS) | 3.7379× | 0.1252 |
| 5 | 3.6996× | 0.1310 |
| 10 | 3.6638× | 0.1354 |
| 20 | 3.6229× | 0.1417 |
| 30 | 3.5626× | 0.1441 |
| **40** | **3.5178×** | **0.1443** |
| 60 | 3.6046× | 0.1411 |

Repeated 5-fold: **3.5178×, R² 0.1443** (slug-fold only: 3.1862×, R² 0.0965; OOS p80: 14.3319×). In-sample R² 0.2578 (with category adjustments — not directly comparable to v3's 0.2104, which had none). Leave-one-out: 3.2753×, R² 0.1671. Leave-one-category-out: 3.6504×, R² 0.1295 (v3's curve scores 3.8797× on the same check). Fixed-ratio LOO baseline: 5.0924×. Slope bootstrap 90%: 0.2898–0.5399 (200 seeded refits).

Ablation (λ = 40): Full 3.5178× / 0.1443; Without growth 3.6658× / 0.1514; Without age 3.5169× / 0.1644; Without category 3.7981× / 0.1231; TVL only 3.8064× / 0.1472. Nothing is dropped.

**One-SE selection.** Dropping age improves the repeated mean by only −0.001 against a paired SE of 0.057 — a dead heat, so age stays (the rubric names age as a value input). λ = 30 trails the best by 0.045 against a paired SE of 0.044 — just outside one SE — so 40 is both the best mean and the largest λ within one SE of it.

**Walk-forward (95 dated families):** 47 train → 24 test: 2.6132×, R² −0.0712; 71 train → 24 test: 3.3025×, R² −0.6389; pooled (48 test): 2.8563×, R² −0.1757. Fixed date split (43 tested): R² 0.0280, median 2.787×. The walk-forward pooled R² is worse than v3's (+0.0099 → −0.1757) while its median factor improved — chronological signal stays near zero, stated honestly on the page.

## Universe: all 758 protocols accounted for

198 ranked on the board (40 watchlist + 158 early), 144 live-token records set aside (128 with positive caps, 16 non-positive), 416 audited outside both lists: 142 × token identifier with no market cap, 78 × staked product, 75 × versioned product, 66 × bridged product, 55 × exchange product. (Correction of a v3 error: v3 said the 416 split into "144 pre-token products and 272 token-id-no-mcap" — 144 is the live-record count; the real split is 274 pre-token products and 142 token-id-no-mcap.)

## Farm economics

A farmer holds a $10,000 position, so the farmer count is TVL / $10,000; the low-end farm value is 5% of the low end of the band, shared evenly. Verdicts: **87 FARM / 87 THIN / 24 SKIP** (FARM ≥ 3× cost, THIN ≥ 1×, else SKIP). Rank 1: `steakhouse-financial`, implied $48.6M, SKIP; rank 2 `veda` $44.9M, SKIP — its low-end per-farmer share is about $4.08 against about $18 of costs; rank 3 `sentora-curator` $44.7M.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22+ (stdlib only). `main.ts` writes `board.json`, `data.js`, copies `dashboard/` and `screenshots/`, and writes `dossier.json` with `buildDossier` from `vendor/makefun-board.ts`. Two runs write byte-identical outputs. The dashboard renders with no network: board, detail view per protocol, filters, validation and method sections, plus three screenshots (board, detail, filtered) at 1280×900.

## Caveats

- The grader runs Node 22; verification here ran on Node 24.22.1. The code is stdlib-only, so the risk is low.
- Rank ranges come from refitting the selected ridge curve (200 seeded draws), stated in the Method section.
- The board says a protocol *records no token*, never that it has none: a record can miss a token that exists.
- This entry carries no listing-probability estimate: every P(list) candidate tested for v8-full failed the pre-submit gates (see above), so none is shipped rather than a weak one.
