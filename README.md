[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/sanschiko3-dotcom/token-radar-01-v2/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/sanschiko3-dotcom/token-radar-01-v2/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![License: MIT](https://img.shields.io/badge/license-MIT-84cbb0)](LICENSE)

# Token Radar v5 — radar-6

[Open the Token Radar bounty](https://make.fun/bounty/token-radar-01).

An offline launch-pricing and farming dashboard over the sealed DefiLlama snapshot. Every snapshot protocol appears in the board. A ridge model estimates launch value from token-bearing peers; a regularized logistic model estimates the odds that a token is already recorded, and the board presents that as a transparent listing proxy rather than a timing forecast.

Expected value for a protocol with no token record is fitted launch value × P(list) × own-token share. The own-token share is assumed to be 1.00 because the snapshot contains no dilution or allocation data. Farming plans state deposit, fees, time, an expected-value-per-hour proxy, and threshold verdict for each no-token row. They are scenarios, not promises of a launch or airdrop.

The sealed input contains no 30-day trajectory or audit-status fields. Those signals are marked unavailable in the board; they are not imputed. The model-validation and integrity strips show the fitted statistics and all self-checks.

## Run

Set MAKEFUN_INPUT_DIR=/input and MAKEFUN_OUTPUT_DIR=/output, then run node main.ts.

Pass --input snapshot.json or --input /path/to/input-directory to select a snapshot, and --output /path/to/output to select an output directory.
