import { createHash } from 'node:crypto';

export type Protocol = {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null;
  listed_at: string | null; gecko_id: string | null; symbol: string | null;
};
export type Snapshot = {
  as_of: string; source: string; floor_usd: number;
  protocols: Protocol[]; watchlist: string[];
};
type Fit = (p: Protocol) => number;
const DAY = 86_400_000;
const avg = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
const hasToken = (p: Protocol) => p.gecko_id !== null || p.symbol !== null || p.mcap_usd !== null;
const excludedCategories = new Set([
  'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking',
  'Restaked BTC', 'CEX'
]);
const isExcludedProduct = (p: Protocol) =>
  excludedCategories.has(p.category ?? '') ||
  /\b(wrapped|staked|staking)\b/i.test(p.name) ||
  /\s(V\d+(?:\.\d+)?|v\d+(?:\.\d+)?|\d+\.\d+)$/.test(p.name) ||
  /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i.test(p.name);
const isPreToken = (p: Protocol) => !hasToken(p) && !isExcludedProduct(p);
const ageDays = (p: Protocol, asOf: string) =>
  p.listed_at ? Math.max(0, Math.floor((Date.parse(asOf) - Date.parse(p.listed_at)) / DAY)) : null;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function solve(a: number[][], b: number[]): number[] {
  const n = b.length, m = a.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[pivot][c])) pivot = r;
    [m[c], m[pivot]] = [m[pivot], m[c]];
    if (Math.abs(m[c][c]) < 1e-12) m[c][c] = 1e-12;
    const d = m[c][c];
    for (let j = c; j <= n; j++) m[c][j] /= d;
    for (let r = 0; r < n; r++) if (r !== c) {
      const f = m[r][c];
      for (let j = c; j <= n; j++) m[r][j] -= f * m[c][j];
    }
  }
  return m.map(row => row[n]);
}
function rawValueFeatures(p: Protocol, asOf: string) {
  return [
    Math.log10(Math.max(1, p.tvl_usd)),
    (p.change_7d ?? 0) / 100,
    Math.log10(Math.max(1, (ageDays(p, asOf) ?? 365) / 365))
  ];
}
function ridgeFit(rows: Protocol[], y: number[], alpha: number, asOf: string): Fit {
  const d = 3, xs = rows.map(p => rawValueFeatures(p, asOf));
  const mu = Array.from({ length: d }, (_, j) => avg(xs.map(x => x[j])));
  const sd = Array.from({ length: d }, (_, j) =>
    Math.sqrt(avg(xs.map(x => (x[j] - mu[j]) ** 2))) || 1);
  const X = xs.map(x => [1, ...x.map((v, j) => (v - mu[j]) / sd[j])]);
  const a = Array.from({ length: d + 1 }, () => Array(d + 1).fill(0));
  const b = Array(d + 1).fill(0);
  for (let i = 0; i < X.length; i++) for (let j = 0; j <= d; j++) {
    b[j] += X[i][j] * y[i];
    for (let k = 0; k <= d; k++) a[j][k] += X[i][j] * X[i][k];
  }
  for (let j = 1; j <= d; j++) a[j][j] += alpha;
  const beta = solve(a, b);
  return p => beta[0] + rawValueFeatures(p, asOf)
    .reduce((s, v, j) => s + beta[j + 1] * (v - mu[j]) / sd[j], 0);
}
function valueCoefficients(rows: Protocol[], y: number[], alpha: number, asOf: string) {
  const fit = ridgeFit(rows, y, alpha, asOf);
  const xs = rows.map(p => rawValueFeatures(p, asOf));
  const mu = [0, 1, 2].map(j => avg(xs.map(x => x[j])));
  const sd = [0, 1, 2].map(j => Math.sqrt(avg(xs.map(x => (x[j] - mu[j]) ** 2))) || 1);
  const X = xs.map(x => [1, ...x.map((v, j) => (v - mu[j]) / sd[j])]);
  const a = Array.from({ length: 4 }, () => Array(4).fill(0)), b = Array(4).fill(0);
  for (let i = 0; i < X.length; i++) for (let j = 0; j < 4; j++) {
    b[j] += X[i][j] * y[i];
    for (let k = 0; k < 4; k++) a[j][k] += X[i][j] * X[i][k];
  }
  for (let j = 1; j < 4; j++) a[j][j] += alpha;
  const beta = solve(a, b);
  const slopes = beta.slice(1).map((v, j) => v / sd[j]);
  const intercept = beta[0] - beta.slice(1).reduce((s, v, j) => s + v * mu[j] / sd[j], 0);
  return { intercept: +intercept.toFixed(5), log10_tvl: +slopes[0].toFixed(5),
    change_7d_fraction: +slopes[1].toFixed(5), log10_age_years: +slopes[2].toFixed(5) };
}
function scoreError(y: number[], pred: number[]) {
  const mean = avg(y), rss = y.reduce((s, v, i) => s + (v - pred[i]) ** 2, 0);
  const tss = y.reduce((s, v) => s + (v - mean) ** 2, 0);
  return { n: y.length, rmse_log10: +(Math.sqrt(rss / Math.max(1, y.length))).toFixed(4),
    r2: +(tss ? 1 - rss / tss : 0).toFixed(4),
    median_factor_error: +(10 ** median(y.map((v, i) => Math.abs(v - pred[i])))).toFixed(3) };
}
function ridgeModel(peers: Protocol[], asOf: string) {
  const rows = peers.filter(p => p.mcap_usd !== null && p.mcap_usd > 0);
  const y = rows.map(p => Math.log10(p.mcap_usd!));
  const grid = [0.01, 0.03, 0.1, 0.3, 1, 3, 10, 30, 40, 100, 300, 1000];
  const repeats = 4, folds = 5;
  const foldScores = grid.map(() => [] as number[]);
  const held = grid.map(() => ({ y: [] as number[], p: [] as number[] }));
  for (let rep = 0; rep < repeats; rep++) for (let fold = 0; fold < folds; fold++) {
    const train: number[] = [], test: number[] = [];
    rows.forEach((p, i) => (parseInt(sha(p.slug + ':' + rep).slice(0, 8), 16) % folds === fold ? test : train).push(i));
    for (let g = 0; g < grid.length; g++) {
      const f = ridgeFit(train.map(i => rows[i]), train.map(i => y[i]), grid[g], asOf);
      const errs = test.map(i => y[i] - f(rows[i]));
      foldScores[g].push(Math.sqrt(avg(errs.map(e => e * e))));
      held[g].y.push(...test.map(i => y[i]));
      held[g].p.push(...test.map(i => f(rows[i])));
    }
  }
  const means = foldScores.map(avg), best = means.indexOf(Math.min(...means));
  const bestScores = foldScores[best];
  const se = Math.sqrt(avg(bestScores.map(x => (x - means[best]) ** 2))) / Math.sqrt(bestScores.length);
  const eligible = means.map((x, i) => x <= means[best] + se ? i : -1).filter(i => i >= 0);
  const chosen = grid[Math.max(...eligible)], ci = grid.indexOf(chosen);
  const looY: number[] = [], looP: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const ix = rows.map((_, j) => j).filter(j => j !== i);
    looY.push(y[i]); looP.push(ridgeFit(ix.map(j => rows[j]), ix.map(j => y[j]), chosen, asOf)(rows[i]));
  }
  const locoY: number[] = [], locoP: number[] = [];
  for (const category of new Set(rows.map(p => p.category ?? 'Uncategorized'))) {
    const test = rows.map((p, i) => ({ p, i })).filter(x => (x.p.category ?? 'Uncategorized') === category);
    if (test.length === rows.length) continue;
    const train = rows.map((_, i) => i).filter(i => (rows[i].category ?? 'Uncategorized') !== category);
    const f = ridgeFit(train.map(i => rows[i]), train.map(i => y[i]), chosen, asOf);
    for (const x of test) { locoY.push(y[x.i]); locoP.push(f(x.p)); }
  }
  const chronology = rows.map((p, i) => ({ p, i })).filter(x => x.p.listed_at)
    .sort((a, b) => a.p.listed_at!.localeCompare(b.p.listed_at!));
  const cut = Math.floor(chronology.length * 0.8), trainTime = chronology.slice(0, cut), testTime = chronology.slice(cut);
  const timeFit = ridgeFit(trainTime.map(x => x.p), trainTime.map(x => y[x.i]), chosen, asOf);
  const time = scoreError(testTime.map(x => y[x.i]), testTime.map(x => timeFit(x.p)));
  const wfY: number[] = [], wfP: number[] = [];
  const step = Math.max(8, Math.floor(chronology.length * 0.12));
  for (let k = Math.max(25, Math.floor(chronology.length * 0.55)); k < chronology.length; k += step) {
    const tr = chronology.slice(0, k), te = chronology.slice(k, Math.min(chronology.length, k + step));
    if (te.length < 4) continue;
    const f = ridgeFit(tr.map(x => x.p), tr.map(x => y[x.i]), chosen, asOf);
    for (const x of te) { wfY.push(y[x.i]); wfP.push(f(x.p)); }
  }
  const cv = scoreError(held[ci].y, held[ci].p), loo = scoreError(looY, looP), loco = scoreError(locoY, locoP);
  const predict = ridgeFit(rows, y, chosen, asOf);
  return { rows, predict, stats: {
    trained_n: rows.length, target: 'log10 recorded market capitalization USD',
    lambda_grid: grid, cv_fold_rmse_log10: means.map((v, i) => ({ lambda: grid[i], rmse: +v.toFixed(4) })),
    selected_lambda: chosen, selection_rule: 'largest lambda within 1 standard error of minimum repeated 5-fold CV RMSE',
    repeated_cv_band_factor: cv.median_factor_error, repeated_cv_rmse_log10: cv.rmse_log10,
    loo, loco, time_split: { ...time, train_n: trainTime.length, test_n: testTime.length },
    walk_forward: { ...scoreError(wfY, wfP), splits: Math.ceil(Math.max(0, chronology.length - Math.floor(chronology.length * 0.55)) / step) },
    coefficients: valueCoefficients(rows, y, chosen, asOf)
  } };
}

function logisticFit(rows: Protocol[], labels: number[], categories: string[], asOf: string): Fit {
  const raw = rows.map(p => [
    Math.log10(Math.max(1, p.tvl_usd)),
    Math.log10(Math.max(1, (ageDays(p, asOf) ?? 365) / 365)),
    (p.change_7d ?? 0) / 100,
    p.change_7d === null ? 1 : 0,
    ...categories.map(c => (p.category ?? 'Uncategorized') === c ? 1 : 0)
  ]);
  const d = raw[0].length, mu = Array(d).fill(0), sd = Array(d).fill(1);
  for (let j = 0; j < d; j++) {
    mu[j] = avg(raw.map(x => x[j]));
    sd[j] = Math.sqrt(avg(raw.map(x => (x[j] - mu[j]) ** 2))) || 1;
  }
  const X = raw.map(x => [1, ...x.map((v, j) => (v - mu[j]) / sd[j])]);
  const beta = Array(d + 1).fill(0), n = rows.length, penalty = 0.5;
  for (let it = 0; it < 1800; it++) {
    const grad = Array(d + 1).fill(0);
    for (let i = 0; i < n; i++) {
      const z = X[i].reduce((s, v, j) => s + v * beta[j], 0);
      const pr = 1 / (1 + Math.exp(-Math.max(-25, Math.min(25, z))));
      for (let j = 0; j <= d; j++) grad[j] += X[i][j] * (pr - labels[i]) / n;
    }
    for (let j = 1; j <= d; j++) grad[j] += penalty * beta[j] / n;
    let step = 0;
    for (let j = 0; j <= d; j++) { const delta = 0.12 * grad[j]; beta[j] -= delta; step = Math.max(step, Math.abs(delta)); }
    if (step < 1e-8) break;
  }
  return p => {
    const vals = [
      Math.log10(Math.max(1, p.tvl_usd)),
      Math.log10(Math.max(1, (ageDays(p, asOf) ?? 365) / 365)),
      (p.change_7d ?? 0) / 100, p.change_7d === null ? 1 : 0,
      ...categories.map(c => (p.category ?? 'Uncategorized') === c ? 1 : 0)
    ];
    const z = beta[0] + vals.reduce((s, v, j) => s + beta[j + 1] * (v - mu[j]) / sd[j], 0);
    return 1 / (1 + Math.exp(-Math.max(-25, Math.min(25, z))));
  };
}
function listingModel(protocols: Protocol[], asOf: string) {
  const categories = [...new Set(protocols.map(p => p.category ?? 'Uncategorized'))].sort();
  const labels = protocols.map(p => hasToken(p) ? 1 : 0);
  const runs = [11, 29].map(seed => {
    const order = protocols.map((p, i) => ({ p, i }))
      .sort((a, b) => sha(seed + ':' + a.p.slug).localeCompare(sha(seed + ':' + b.p.slug)));
    const test = order.slice(0, Math.round(protocols.length * 0.2));
    const held = new Set(test.map(x => x.i)), train = protocols.map((_, i) => i).filter(i => !held.has(i));
    const predict = logisticFit(train.map(i => protocols[i]), train.map(i => labels[i]), categories, asOf);
    const probs = test.map(x => predict(x.p)), truth = test.map(x => labels[x.i]);
    return { n: test.length,
      accuracy: +avg(truth.map((v, i) => (probs[i] >= 0.5 ? 1 : 0) === v ? 1 : 0)).toFixed(4),
      log_loss: +avg(truth.map((v, i) => -(v * Math.log(Math.max(1e-9, probs[i])) +
        (1 - v) * Math.log(Math.max(1e-9, 1 - probs[i]))))).toFixed(4) };
  });
  return { predict: logisticFit(protocols, labels, categories, asOf), stats: {
    target: 'token currently recorded by DefiLlama (CoinGecko ID, symbol or market cap)',
    training_n: protocols.length, positive_n: labels.reduce((s, x) => s + x, 0),
    inputs: ['log10 TVL', 'log10 age in years', '7d TVL change', '7d missing indicator', 'category one-hot'],
    not_in_snapshot: ['30d trajectory', 'audit status'],
    held_out_20_percent_twice: runs, mean_accuracy: +avg(runs.map(x => x.accuracy)).toFixed(4),
    mean_log_loss: +avg(runs.map(x => x.log_loss)).toFixed(4)
  } };
}
function farmPlan(p: Protocol, expected: number, probability: number) {
  const deposit = Math.round(Math.max(500, Math.min(25000, p.tvl_usd * 0.00025)) / 100) * 100;
  const fee = p.chains.some(c => /ethereum/i.test(c)) ? 8 : 1.25;
  const hours = 18 + (p.chains.length > 2 ? 4 : 0), fees = +(fee * 3 + deposit * 0.0002).toFixed(2);
  const net = expected * 0.00001 - fees, netHour = +(net / hours).toFixed(2);
  const verdict = netHour >= 8 && probability >= 0.35 ? 'FARM' : netHour >= 1.25 ? 'THIN' : 'SKIP';
  const reason = verdict === 'FARM'
    ? 'Both FARM gates pass: expected net value is at least $8/hour and P(list) is at least 0.35.'
    : verdict === 'THIN'
      ? 'Expected net value reaches $1.25/hour, but the FARM gates are not both met.'
      : 'Expected net value is below $1.25/hour after estimated fees.';
  const chain = p.chains[0] ?? 'the protocol’s primary network';
  return {
    deposit_size_usd: deposit, gas_fees_usd: fees, expected_net_value_per_hour_usd: netHour,
    time_to_farm_hours: hours, verdict,
    verdict_reason: reason,
    threshold_rule: 'FARM at >=$8/hr and P(list)>=0.35; THIN at >=$1.25/hr; otherwise SKIP.',
    reward_scenario: 'Expected farming reward assumes 1 basis point of expected protocol-token value; this is a planning proxy, not a promised airdrop share.',
    own_token_share: 1,
    own_token_assumption: '1.00: the model assigns the full protocol-token value to its own token; no dilution/share data exists in the snapshot.',
    steps: [
      'Deposit about $' + deposit.toLocaleString() + ' into the protocol’s core position on ' + chain + '; review withdrawal terms first.',
      'Keep the position active for about ' + hours + ' hours across two visits; estimated three-action gas and fees total $' + fees.toFixed(2) + '.',
      'Check the official app for live incentives and eligibility before committing funds; the snapshot cannot verify an airdrop.'
    ]
  };
}
export function buildRadar(snapshot: Snapshot, snapshotHash?: string) {
  if (snapshot.protocols.length !== 758) throw new Error('Snapshot universe must contain all 758 protocols.');
  const peers = snapshot.protocols.filter(hasToken), noToken = snapshot.protocols.filter(p => !hasToken(p));
  const pre = noToken.filter(p => isPreToken(p)), excluded = noToken.filter(isExcludedProduct);
  const ridge = ridgeModel(peers, snapshot.as_of), odds = listingModel(snapshot.protocols, snapshot.as_of);
  const watch = new Set(snapshot.watchlist);
  const rows = snapshot.protocols.map(p => {
    const pred = Math.max(3, Math.min(14, ridge.predict(p)));
    const fitted = Math.max(1000, Math.min(1e14, Math.round(10 ** pred)));
    const live = hasToken(p), launchable = isPreToken(p);
    const prob = odds.predict(p);
    const share = live || launchable ? 1 : 0;
    const expected = live
      ? p.mcap_usd !== null && p.mcap_usd > 0 ? Math.round(p.mcap_usd) : fitted
      : launchable ? Math.round(fitted * prob * share) : 1;
    return {
      slug: p.slug, name: p.name, category: p.category, chains: p.chains,
      tvl_usd: p.tvl_usd, change_7d: p.change_7d, mcap_usd: p.mcap_usd,
      listed_at: p.listed_at, gecko_id: p.gecko_id, symbol: p.symbol,
      token_status: live ? 'token-recorded' : launchable ? 'pre-token' : 'excluded-product',
      rank: 0, implied_value_usd: Math.max(1, expected), fitted_launch_value_usd: fitted,
      p_list: +prob.toFixed(5), own_token_share: share,
      value_basis: live
        ? p.mcap_usd !== null && p.mcap_usd > 0 ? 'recorded_market_cap' : 'peer_fitted_value_missing_market_cap'
        : launchable ? 'fitted_value_x_listing_odds_x_own_token_share' : 'excluded_product_floor',
      own_token_assumption: launchable
        ? 'Share = 1.00; the estimate attributes all modeled protocol-token value to the protocol’s own token.'
        : live ? 'A token is recorded; own-token share is not applied to observed market capitalization.'
          : 'Excluded dependent/wrapped product; own-token share is 0 and no independent launch value is assigned.',
      expected_value_usd: Math.max(1, expected),
      farm_plan: launchable ? farmPlan(p, fitted * prob * share, prob) : null,
      farm_steps: launchable
        ? farmPlan(p, fitted * prob * share, prob).steps
        : [
          'Verify the protocol relation and its parent token before treating this product as a separate launch.',
          'Do not open a farming position for a wrapped, staked, exchange, bridge, or versioned product.',
          'Recheck the parent and token record after a snapshot refresh before reconsidering this row.'
        ],
      watchlist: watch.has(p.slug),
      listing_drivers: { tvl_usd: p.tvl_usd, age_days: ageDays(p, snapshot.as_of),
        change_7d: p.change_7d, category: p.category, change_30d: null, audit_status: null }
    };
  }).sort((a, b) => b.expected_value_usd - a.expected_value_usd || a.slug.localeCompare(b.slug));
  rows.forEach((r, i) => { r.rank = i + 1; });
  const counts = { FARM: 0, THIN: 0, SKIP: 0 };
  for (const p of pre) {
    const row = rows.find(r => r.slug === p.slug)!;
    counts[row.farm_plan!.verdict as keyof typeof counts]++;
  }
  const checks = [
    rows.length === 758,
    new Set(rows.map(r => r.slug)).size === 758,
    snapshot.watchlist.every(s => rows.some(r => r.slug === s)),
    rows.every((r, i) => r.rank === i + 1),
    rows.every((r, i) => i === 0 || rows[i - 1].expected_value_usd >= r.expected_value_usd),
    rows.every(r => Number.isSafeInteger(r.implied_value_usd) && r.implied_value_usd > 0),
    rows.filter(r => r.token_status === 'pre-token').length === 198,
    rows.every(r => r.farm_steps.length >= 3 && r.farm_steps.every(s => s.length >= 20)),
    rows.filter(r => r.token_status === 'pre-token').every(r => r.farm_plan !== null),
    rows.filter(r => r.token_status === 'excluded-product').every(r => r.farm_plan === null),
    rows.every(r => r.p_list >= 0 && r.p_list <= 1)
  ];
  if (checks.some(x => !x)) throw new Error('Radar self-test failed.');
  const expectedPre = pre.map(p => rows.find(r => r.slug === p.slug)!.expected_value_usd);
  const summary = {
    universe: rows.length, pre_token: pre.length, no_token_records: noToken.length,
    excluded_products: excluded.length, token_recorded: peers.length,
    token_records_without_market_cap: peers.filter(p => p.mcap_usd === null || p.mcap_usd <= 0).length,
    median_expected_value_usd: Math.round(median(expectedPre)), verdict_counts: counts,
    watchlist_covered: rows.filter(r => r.watchlist).length, rows_accounted: rows.length,
    audited_count: 0, audited_note: '0/758: this sealed snapshot has no audit-status field.',
    snapshot_sha256: snapshotHash ?? sha(JSON.stringify(snapshot)),
    self_test: { passed: checks.filter(Boolean).length, total: checks.length,
      checks: ['758 rows', 'unique slugs', 'watchlist covered', 'contiguous ranks',
        'descending values', 'positive integer values', '198 eligible pre-token rows',
        'all rows have valid farm steps', 'all eligible rows have plans',
        'dependent products excluded', 'valid listing odds'] },
    ridge: ridge.stats, listing_odds: odds.stats,
    threshold_rule: 'FARM at >=$8/hr and P(list)>=0.35; THIN at >=$1.25/hr; otherwise SKIP.'
  };
  return { rows, summary };
}
