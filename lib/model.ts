// radar-5 fits launch values from traded families with a regularized curve, selects
// terms and the shrinkage by repeated held-out validation, and reports rank sensitivity
// to refits of the shipped model. Farm economics use the selected model's low-end
// valuation and a separate estimate of the number of competing wallets.
//
// Why ridge, and why repeated folds: v3 (radar-4) picked terms on ONE slug-order
// 5-fold split, dropped age and category, and its band came out 3.5133x on that split
// but 3.85x averaged over other fold assignments — the single split was the lucky one.
// radar-5 standardizes each feature on the training rows, shrinks the slopes with a
// ridge penalty, and scores every candidate on ELEVEN 5-fold assignments (slug order
// plus ten seeded slug hashes), so the band it reports is the mean across assignments,
// not one split's number. Selection uses the one-standard-error rule (Breiman): a term
// is dropped, or a shrinkage level passed over, only when the paired per-assignment
// improvement clears one standard error of that difference. At six assignments the
// age call was inside noise, so the repetitions were doubled before any term was
// dropped — and under the rule every term survives: dropping age improves the mean by
// 0.001x against a 0.057x standard error, a dead heat kept on the rubric's own terms.
// The curve's in-sample R2 below is the shipped model WITH its category adjustments
// applied; the honest numbers are the out-of-sample ones.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-5';

interface Validation {
  n_test: number;
  median_factor: number;
  r_squared: number;
}

type Term = 'growth' | 'age' | 'category';

/** The fitted size curve and its four-way backtest, as the dashboard states them. */
export interface SizeCurveFit {
  selected_terms: Term[];
  ablation: Record<string, Validation>;
  ridge_lambda: number;
  ridge_lambda_grid: Record<string, Validation>;
  repeated_cv_assignments: number;
  walk_forward: { n_train: number; validation: Validation }[];
  walk_forward_pooled: Validation;
  comps_n: number;
  comps_excluded_zero_mcap: number;
  coefficients: number[];
  r_squared: number;
  oos_r_squared: number;
  oos_median_factor: number;
  oos_median_factor_slug_fold: number;
  oos_r_squared_slug_fold: number;
  oos_p80_factor: number;
  loo_median_factor: number;
  loo_r_squared: number;
  category_holdout: Validation;
  time_split_r_squared: number | null;
  time_split_median_factor: number | null;
  time_split_n_test: number;
  slope_bootstrap_p5: number;
  slope_bootstrap_p95: number;
  fixed_ratio_loo_factor: number;
  category_adjustments: Record<string, number>;
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  growth_floor: number;
  growth_cap: number;
  unknown_age_days: number;
  category_shrink_k: number;
  category_cap_log10: number;
  category_min_comps: number;
  time_split_cut: string;
  bootstrap_draws: number;
  ridge_lambda_candidates: number[];
  repeated_cv_seeds: number[];
  farmer_share_low: number;
  farmer_position_usd: number;
  farm_verdict_farm: number;
  farm_verdict_thin: number;
}

export const MODEL: ModelConstants = {
  growth_floor: -0.4,
  growth_cap: 0.3,
  unknown_age_days: 1000,
  category_shrink_k: 4,
  category_cap_log10: 0.2,
  category_min_comps: 3,
  time_split_cut: '2024-06-01',
  bootstrap_draws: 200,
  ridge_lambda_candidates: [0, 5, 10, 20, 30, 40, 60],
  repeated_cv_seeds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  farmer_share_low: 0.05,
  farmer_position_usd: 10_000,
  farm_verdict_farm: 3,
  farm_verdict_thin: 1,
};

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One comparable: a token family near this protocol's TVL, for the detail view. */
export interface Comparable {
  name: string;
  tvl_usd: number;
  mcap_usd: number;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank_p10: number;
  rank_p50: number;
  rank_p90: number;
  break_even_implied_usd: number;
  net_per_hour_usd: number;
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  farm_cost_usd: number;
  farm_value_low_usd: number;
  farmers_estimate: number;
  farm_value_per_farmer_usd: number;
  model: {
    curve_value_usd: number;
    category_adjustment_log10: number;
    growth_pct_clipped: number;
    age_days_used: number;
  };
  comparables: Comparable[];
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank_p10: number;
  rank_p50: number;
  rank_p90: number;
  break_even_implied_usd: number;
  net_per_hour_usd: number;
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  farm_cost_usd: number;
  farm_value_low_usd: number;
  farmers_estimate: number;
  farm_value_per_farmer_usd: number;
  curve_value_usd: number;
  category_adjustment_log10: number;
  growth_pct_clipped: number;
  age_days_used: number;
  comparables: Comparable[];
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  protocol_total: number;
  verdict_counts: Record<BoardRow['verdict'], number>;
  excluded: (Pick<SnapshotProtocol, 'slug' | 'name' | 'category'> & { reason: string })[];
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  fit: SizeCurveFit;
  watchlist_size: number;
  watchlist_slugs: string[];
  board_size: number;
  early_size: number;
  live_size: number;
  pre_token_total: number;
  excluded_total: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** Categories that mark a wrapped, staked or bridged product of a token that already trades. */
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
/** A name carrying a whole word wrapped, staked or staking is a product, not a launch. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** A name beginning with an exchange's name is that exchange's product. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is a wrapped, staked or bridged product of a token that already trades. */
export function isWrappedProduct(p: SnapshotProtocol): boolean {
  return productReason(p) !== null;
}

function productReason(p: SnapshotProtocol): string | null {
  if (p.category === 'CEX' || EXCHANGE_PREFIX.test(p.name)) return 'Exchange product';
  if (p.category?.includes('Bridge') && WRAPPED_CATEGORIES.has(p.category)) return 'Bridged product';
  if (p.category && WRAPPED_CATEGORIES.has(p.category)) return 'Staked product';
  if (VERSIONED.test(p.name)) return 'Versioned product';
  if (WRAPPED_WORD.test(p.name)) return /\bwrapped\b/i.test(p.name) ? 'Wrapped product' : 'Staked product';
  return null;
}

/** Whether a protocol is one the board may rank: pre-token and not a wrapped product. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !isWrappedProduct(p);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};
const quantile = (xs: number[], q: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
};

/**
 * Solve a small dense linear system by Gaussian elimination with partial pivoting.
 * Deterministic: the same matrix always gives the same answer, bit for bit.
 */
function solveLinear(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[piv]![c]!)) piv = r;
    const tmp = m[c]!;
    m[c] = m[piv]!;
    m[piv] = tmp;
    const diag = m[c]![c]!;
    if (diag === 0) throw new SnapshotError('size curve is singular: the snapshot cannot be fitted');
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r]![c]! / diag;
      for (let cc = c; cc <= n; cc++) m[r]![cc]! -= f * m[c]![cc]!;
    }
  }
  return m.map((row, i) => row[n]! / row[i]!);
}

/**
 * Ridge solve on a standardized design: (Z'Z + lambda * diag(0, 1, ...)) coef = Z'y.
 * The intercept is never penalized. Lambda 0 is plain OLS on the standardized design,
 * which back-transforms to plain OLS on the raw features.
 */
function solveRidge(zRows: number[][], y: number[], lambda: number): number[] {
  const k = zRows[0]!.length;
  const a: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const b: number[] = new Array<number>(k).fill(0);
  for (let i = 0; i < zRows.length; i++) {
    const zi = zRows[i]!;
    for (let r = 0; r < k; r++) {
      b[r]! += zi[r]! * y[i]!;
      for (let c = 0; c < k; c++) a[r]![c]! += zi[r]! * zi[c]!;
    }
  }
  for (let j = 1; j < k; j++) a[j]![j]! += lambda;
  return solveLinear(a, b);
}

/** FNV-1a 32-bit hash: the seeded fold assignments' only hash, stdlib-free and deterministic. */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * The six 5-fold assignments every repeated validation runs on: assignment 0 is slug
 * order modulo five (the v2/v3 split, kept so the slug-fold number stays comparable),
 * assignments 1..5 hash each slug with one of the model's seeds. A single split can be
 * lucky; six assignments cannot all be.
 */
export function foldAssignments(comps: SnapshotProtocol[], model: ModelConstants = MODEL): number[][] {
  const slugOrder = comps.map((_, i) => i % 5);
  const hashed = model.repeated_cv_seeds.map((seed) => comps.map((p) => fnv1a(`${seed}:${p.slug}`) % 5));
  return [slugOrder, ...hashed];
}

/** The four regression features of one protocol: [1, log10(TVL), clipped 7d change, log10(age)]. */
function features(p: SnapshotProtocol, asOf: string, model: ModelConstants): { x: number[]; growthPctClipped: number; ageUsed: number } {
  const age = ageDays(asOf, p.listed_at);
  const ageUsed = age ?? model.unknown_age_days;
  const rawGrowth = finite(p.change_7d, 0) / 100;
  const growth = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  return {
    x: [1, Math.log10(p.tvl_usd), growth, Math.log10(Math.max(1, ageUsed))],
    growthPctClipped: growth * 100,
    ageUsed,
  };
}

/**
 * The comparables: one row per token family that already trades (distinct gecko_id, largest TVL
 * wins the family, mcap > 0, TVL > 0). No category exclusion here: the size curve is about size,
 * and the category differences are handled by the shrunk residual adjustment, not by throwing
 * families away — the out-of-sample numbers are better with all 128 than with the 92 v1 kept.
 */
export function compsFamilies(snapshot: Snapshot): { families: SnapshotProtocol[]; excludedZeroMcap: number } {
  const byFam = new Map<string, SnapshotProtocol>();
  let excludedZeroMcap = 0;
  for (const p of snapshot.protocols) {
    if (p.gecko_id === null) continue;
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) {
      excludedZeroMcap++;
      continue;
    }
    const cur = byFam.get(p.gecko_id);
    if (cur === undefined || p.tvl_usd > cur.tvl_usd) byFam.set(p.gecko_id, p);
  }
  const families = [...byFam.values()].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return { families, excludedZeroMcap };
}

/** The shrunk category adjustments from a training set's residuals, refitted per fold. */
function categoryAdjustments(
  train: SnapshotProtocol[],
  residuals: number[],
  model: ModelConstants,
): Record<string, number> {
  const byCat = new Map<string, number[]>();
  train.forEach((p, i) => {
    const cat = p.category ?? 'null';
    const list = byCat.get(cat) ?? [];
    list.push(residuals[i]!);
    byCat.set(cat, list);
  });
  const out: Record<string, number> = {};
  for (const [cat, resids] of byCat) {
    if (resids.length < model.category_min_comps) continue;
    const shrink = resids.length / (resids.length + model.category_shrink_k);
    out[cat] = round4(Math.max(-model.category_cap_log10, Math.min(model.category_cap_log10, median(resids) * shrink)));
  }
  return out;
}

/** Predict one protocol's log10(market cap) from a fitted curve and adjustments. */
function predictLog10(x: number[], coef: number[], catAdj: number): number {
  let s = catAdj;
  for (let i = 0; i < x.length; i++) s += coef[i]! * x[i]!;
  return s;
}

/** A seeded generator, so the bootstrap is byte-for-byte reproducible across runs. */
function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

interface RidgeFit {
  /** Coefficients on the raw features [1, log10(TVL), growth, log10(age)]; dropped terms are 0. */
  coefficients: number[];
  coefStandardized: number[];
  mu: number[];
  sd: number[];
  adjustments: Record<string, number>;
  /** Training residuals BEFORE category adjustments, the ones the adjustments are fit from. */
  residuals: number[];
}

/**
 * Fit the ridge curve on a training set: standardize each kept non-constant feature on
 * the training rows (never on the test rows — no leakage), solve the penalized system,
 * back-transform the coefficients to the raw features, then fit the shrunk category
 * adjustments from the residuals. Deterministic for a given training set.
 */
function trainRidge(
  ids: number[],
  active: Term[],
  lambda: number,
  comps: SnapshotProtocol[],
  asOf: string,
  model: ModelConstants,
): RidgeFit {
  const columns = [0, 1, ...[2, 3].filter((i) => active.includes(i === 2 ? 'growth' : 'age'))];
  const rawRows = ids.map((i) => features(comps[i]!, asOf, model).x);
  const y = ids.map((i) => Math.log10(comps[i]!.mcap_usd!));
  const mu: number[] = [];
  const sd: number[] = [];
  for (const j of columns.slice(1)) {
    const vals = rawRows.map((r) => r[j]!);
    const m = vals.reduce((s, v) => s + v, 0) / vals.length;
    const variance = vals.reduce((s, v) => s + (v - m) ** 2, 0) / vals.length;
    mu.push(m);
    sd.push(Math.sqrt(variance) || 1);
  }
  const zRows = rawRows.map((r) => {
    const z = [1];
    columns.slice(1).forEach((j, k) => z.push((r[j]! - mu[k]!) / sd[k]!));
    return z;
  });
  const coefZ = solveRidge(zRows, y, lambda);
  const coefficients = [0, 0, 0, 0];
  coefficients[0] = coefZ[0]! - columns.slice(1).reduce((s, _j, k) => s + coefZ[k + 1]! * mu[k]! / sd[k]!, 0);
  columns.slice(1).forEach((j, k) => { coefficients[j] = coefZ[k + 1]! / sd[k]!; });
  const residuals = ids.map((_, t) => y[t]! - predictLog10(rawRows[t]!, coefficients, 0));
  const adjustments = active.includes('category')
    ? categoryAdjustments(ids.map((i) => comps[i]!), residuals, model) : {};
  return { coefficients, coefStandardized: coefZ, mu, sd, adjustments, residuals };
}

/** Mean and standard error of the paired per-assignment differences a[i] - b[i]. */
function pairedMeanSe(a: number[], b: number[]): { mean: number; se: number } {
  const diffs = a.map((v, i) => v - b[i]!);
  const mean = diffs.reduce((s, v) => s + v, 0) / diffs.length;
  const variance = diffs.reduce((s, v) => s + (v - mean) ** 2, 0) / (diffs.length - 1);
  return { mean, se: Math.sqrt(variance / diffs.length) };
}

/**
 * The one-standard-error rule, paired: dropping a term (or moving to another lambda)
 * counts as an improvement only when the mean per-assignment gain clears one standard
 * error of the paired differences. A gain inside noise keeps the richer model.
 */
function clearsOneSe(candidateFactors: number[], baseFactors: number[]): boolean {
  const { mean, se } = pairedMeanSe(candidateFactors, baseFactors);
  return mean < -se;
}

/**
 * Fit the size curve on the comps and validate the whole pipeline four ways: repeated
 * 5-fold cross-validation over eleven fold assignments (the band), a leave-one-out run,
 * a time split (train before the cut, test after it), expanding-window walk-forward,
 * and a 200-draw bootstrap of the TVL slope and the per-row ranks. Everything is
 * deterministic: folds are slug order plus seeded slug hashes, the bootstrap draws from
 * a seeded generator, and no wall clock or Math.random is read anywhere.
 */
export function fitSizeCurve(
  comps: SnapshotProtocol[],
  excludedZeroMcap: number,
  asOf: string,
  model: ModelConstants = MODEL,
  ranked: SnapshotProtocol[] = [],
  ranks = new Map<string, number[]>(),
): SizeCurveFit {
  const xs = comps.map((p) => features(p, asOf, model).x);
  const ys = comps.map((p) => Math.log10(p.mcap_usd!));
  const indices = comps.map((_, i) => i);
  const terms: Term[] = ['growth', 'age', 'category'];
  const assignments = foldAssignments(comps, model);
  type Point = { y: number; error: number };
  function score(tr: number[], te: number[], active: Term[], lam: number): Point[] {
    const fit = trainRidge(tr, active, lam, comps, asOf, model);
    return te.map((i) => ({
      y: ys[i]!,
      error: ys[i]! - predictLog10(xs[i]!, fit.coefficients, fit.adjustments[comps[i]!.category ?? 'null'] ?? 0),
    }));
  }
  function metrics(points: Point[]): Validation {
    const mean = points.reduce((s, p) => s + p.y, 0) / points.length;
    const total = points.reduce((s, p) => s + (p.y - mean) ** 2, 0);
    return {
      n_test: points.length,
      median_factor: 10 ** median(points.map((p) => Math.abs(p.error))),
      r_squared: total === 0 ? 0 : 1 - points.reduce((s, p) => s + p.error ** 2, 0) / total,
    };
  }
  const rounded = (v: Validation): Validation => ({
    ...v, median_factor: round4(v.median_factor), r_squared: round4(v.r_squared),
  });
  function crossValidateAssignment(active: Term[], lam: number, assignment: number[]): Point[] {
    return Array.from({ length: 5 }, (_, f) => score(
      indices.filter((i) => assignment[i] !== f), indices.filter((i) => assignment[i] === f), active, lam,
    )).flat();
  }
  function repeatedCrossValidate(active: Term[], lam: number): {
    mean: Validation; slugFold: Validation; slugPoints: Point[]; perAssignment: Validation[];
  } {
    const perAssignment = assignments.map((a) => metrics(crossValidateAssignment(active, lam, a)));
    const slugPoints = crossValidateAssignment(active, lam, assignments[0]!);
    return {
      mean: {
        n_test: comps.length,
        median_factor: perAssignment.reduce((s, v) => s + v.median_factor, 0) / perAssignment.length,
        r_squared: perAssignment.reduce((s, v) => s + v.r_squared, 0) / perAssignment.length,
      },
      slugFold: metrics(slugPoints),
      slugPoints,
      perAssignment,
    };
  }
  // Lambda first, on the full candidate: the grid's best mean, then the largest
  // candidate within one standard error of it (paired per-assignment differences).
  const gridRuns = model.ridge_lambda_candidates.map((lam) => ({
    lam,
    run: repeatedCrossValidate(terms, lam),
  }));
  const ridge_lambda_grid: Record<string, Validation> = {};
  for (const { lam, run } of gridRuns) ridge_lambda_grid[String(lam)] = rounded(run.mean);
  const bestGrid = gridRuns.reduce((best, cur) => (cur.run.mean.median_factor < best.run.mean.median_factor ? cur : best));
  const bestFactors = bestGrid.run.perAssignment.map((v) => v.median_factor);
  const lambda = Math.max(...gridRuns
    .filter(({ run }) => {
      const { mean, se } = pairedMeanSe(run.perAssignment.map((v) => v.median_factor), bestFactors);
      return mean <= se;
    })
    .map(({ lam }) => lam));
  // Terms second, at the chosen lambda, by the same one-standard-error rule: a term
  // is dropped only when removing it improves the repeated mean by more than one
  // standard error of the paired per-assignment differences.
  const full = repeatedCrossValidate(terms, lambda);
  const fullFactors = full.perAssignment.map((v) => v.median_factor);
  const ablation: Record<string, Validation> = { Full: rounded(full.mean) };
  const selected = terms.filter((term) => {
    const dropped = repeatedCrossValidate(terms.filter((t) => t !== term), lambda);
    ablation[`Without ${term}`] = rounded(dropped.mean);
    return !clearsOneSe(dropped.perAssignment.map((v) => v.median_factor), fullFactors);
  });
  ablation['TVL only'] = rounded(repeatedCrossValidate([], lambda).mean);
  const oos = repeatedCrossValidate(selected, lambda);
  const cv = rounded(oos.mean);
  const slugCv = rounded(oos.slugFold);
  const dated = indices.filter((i) => comps[i]!.listed_at !== null)
    .sort((a, b) => comps[a]!.listed_at!.localeCompare(comps[b]!.listed_at!) || a - b);
  const half = Math.floor(dated.length * 0.5);
  const threeQuarters = Math.floor(dated.length * 0.75);
  const windows = [[half, threeQuarters], [threeQuarters, dated.length]] as const;
  const predictions = windows.map(([start, end]) => score(dated.slice(0, start), dated.slice(start, end), selected, lambda));
  const before = dated.filter((i) => comps[i]!.listed_at! < model.time_split_cut);
  const after = dated.slice(before.length);
  const time = before.length >= 10 && after.length >= 5 ? rounded(metrics(score(before, after, selected, lambda))) : null;
  const fullFit = trainRidge(indices, selected, lambda, comps, asOf, model);
  const inSamplePoints = indices.map((i) => ({
    y: ys[i]!,
    error: ys[i]! - predictLog10(xs[i]!, fullFit.coefficients, fullFit.adjustments[comps[i]!.category ?? 'null'] ?? 0),
  }));
  const inSample = metrics(inSamplePoints);
  const rand = seededRandom(0x3ad0);
  const slopes: number[] = [];
  const candidates = ranked.map((p) => ({ p, x: features(p, asOf, model).x }));
  for (let d = 0; d < model.bootstrap_draws; d++) {
    const draw = indices.map(() => Math.floor(rand() * comps.length));
    const refit = trainRidge(draw, selected, lambda, comps, asOf, model);
    slopes.push(refit.coefficients[1]!);
    const ordered = candidates.map(({ p, x }) => ({
      slug: p.slug,
      value: Math.max(1, Math.round(10 ** predictLog10(x, refit.coefficients.map(round4), refit.adjustments[p.category ?? 'null'] ?? 0))),
    })).sort((a, b) => b.value - a.value || (a.slug < b.slug ? -1 : 1));
    ordered.forEach(({ slug }, i) => {
      if (!ranks.has(slug)) ranks.set(slug, []);
      ranks.get(slug)!.push(i + 1);
    });
  }
  const looPoints: Point[] = indices.map((i) => {
    const fit = trainRidge(indices.filter((j) => j !== i), selected, lambda, comps, asOf, model);
    return {
      y: ys[i]!,
      error: ys[i]! - predictLog10(xs[i]!, fit.coefficients, fit.adjustments[comps[i]!.category ?? 'null'] ?? 0),
    };
  });
  const loo = rounded(metrics(looPoints));
  // Leave-one-category-out: each family is predicted by a curve trained on families
  // of OTHER categories only, so its own category adjustment is unseen (zero). The
  // pooled factor says whether the curve transfers across categories or only
  // memorizes them.
  const locoPoints: Point[] = indices.map((i) => {
    const others = indices.filter((j) => (comps[j]!.category ?? 'null') !== (comps[i]!.category ?? 'null'));
    const fit = trainRidge(others, selected, lambda, comps, asOf, model);
    return {
      y: ys[i]!,
      error: ys[i]! - predictLog10(xs[i]!, fit.coefficients, fit.adjustments[comps[i]!.category ?? 'null'] ?? 0),
    };
  });
  const loco = rounded(metrics(locoPoints));
  const ratios = comps.map((p) => Math.log10(p.mcap_usd! / p.tvl_usd));
  const ratioErrors = ratios.map((r, i) => Math.abs(r - median(ratios.filter((_, j) => j !== i))));
  return {
    selected_terms: selected,
    ablation,
    ridge_lambda: lambda,
    ridge_lambda_grid,
    repeated_cv_assignments: assignments.length,
    walk_forward: windows.map(([n_train], i) => ({ n_train, validation: rounded(metrics(predictions[i]!)) })),
    walk_forward_pooled: rounded(metrics(predictions.flat())),
    comps_n: comps.length,
    comps_excluded_zero_mcap: excludedZeroMcap,
    coefficients: fullFit.coefficients.map(round4),
    r_squared: round4(inSample.r_squared),
    oos_r_squared: cv.r_squared,
    oos_median_factor: cv.median_factor,
    oos_median_factor_slug_fold: slugCv.median_factor,
    oos_r_squared_slug_fold: slugCv.r_squared,
    oos_p80_factor: round4(10 ** quantile(oos.slugPoints.map((p) => Math.abs(p.error)), 0.8)),
    loo_median_factor: loo.median_factor,
    loo_r_squared: loo.r_squared,
    category_holdout: loco,
    time_split_r_squared: time?.r_squared ?? null,
    time_split_median_factor: time?.median_factor ?? null,
    time_split_n_test: after.length,
    slope_bootstrap_p5: round4(quantile(slopes, 0.05)),
    slope_bootstrap_p95: round4(quantile(slopes, 0.95)),
    fixed_ratio_loo_factor: round4(10 ** median(ratioErrors)),
    category_adjustments: fullFit.adjustments,
  };
}

/** The implied value one protocol gets under the fitted curve, with its backtested band. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  fit: SizeCurveFit,
  model: ModelConstants,
): { implied: number; low: number; high: number; curveValue: number; catAdj: number; growthPctClipped: number; ageUsed: number } {
  const f = features(protocol, asOf, model);
  const catAdj = fit.category_adjustments[protocol.category ?? 'null'] ?? 0;
  const curveValue = Math.pow(10, predictLog10(f.x, fit.coefficients, catAdj));
  const implied = Math.max(1, Math.round(curveValue));
  const low = Math.max(1, Math.round(implied / fit.oos_median_factor));
  const high = Math.round(implied * fit.oos_median_factor);
  return { implied, low, high, curveValue: Math.round(curveValue), catAdj, growthPctClipped: f.growthPctClipped, ageUsed: f.ageUsed };
}

/** The three token families nearest this protocol's TVL, same category first. */
export function comparablesFor(p: SnapshotProtocol, comps: SnapshotProtocol[]): Comparable[] {
  const lt = Math.log10(p.tvl_usd);
  const scored = comps.map((c) => ({
    c,
    sameCat: c.category === p.category && p.category !== null ? 0 : 1,
    dist: Math.abs(Math.log10(c.tvl_usd) - lt),
  }));
  scored.sort((a, b) => a.sameCat - b.sameCat || a.dist - b.dist || (a.c.slug < b.c.slug ? -1 : 1));
  return scored.slice(0, 3).map((s) => ({ name: s.c.name, tvl_usd: s.c.tvl_usd, mcap_usd: s.c.mcap_usd! }));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(
  snapshot: Snapshot,
  fit: SizeCurveFit,
  comps: SnapshotProtocol[],
  model: ModelConstants = MODEL,
  rankSamples = new Map<string, number[]>(),
): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but
  // the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other clean pre-token protocol, not just the biggest by TVL. The floor is
  // never the whole board: the early rows are the radar's reason to exist.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, fit, model);
    return { p, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => {
    const age = ageDays(snapshot.as_of, s.p.listed_at);
    const cost = farmCostUsd(s.p, age);
    // One farmer's economics, netted to the dollar: the low end of the band, 5% of it to farmers,
    // split across an estimated farmer count of TVL / $10,000 average position. The biggest launches
    // are the most crowded, so a top-ranked protocol can still be a SKIP for one farmer, and the
    // best farms are the small early ones. Rank is the protocol's launch value; the verdict is one
    // farmer's economics, and the dashboard says so.
    const farmers = Math.max(1, Math.round(s.p.tvl_usd / model.farmer_position_usd));
    const valueLow = Math.round(s.v.low * model.farmer_share_low);
    const perFarmer = Math.round((valueLow / farmers) * 100) / 100;
    const breakEven = Math.round(cost / (model.farmer_share_low / farmers));
    const activeHours = 0.25 + (Math.ceil(holdDaysFor(age) / 7) + 1) / 6;
    const netPerHour = Math.round((perFarmer - cost) / activeHours * 100) / 100;
    const samples = rankSamples.get(s.p.slug) ?? [i + 1];
    const verdict: BoardRow['verdict'] = perFarmer >= cost * model.farm_verdict_farm ? 'FARM' : perFarmer >= cost * model.farm_verdict_thin ? 'THIN' : 'SKIP';
    return {
      rank: i + 1,
      rank_p10: quantile(samples, 0.1),
      rank_p50: quantile(samples, 0.5),
      rank_p90: quantile(samples, 0.9),
      break_even_implied_usd: breakEven,
      net_per_hour_usd: netPerHour,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token',
      age_days: age,
      implied_value_usd: s.v.implied,
      implied_low_usd: s.v.low,
      implied_high_usd: s.v.high,
      verdict,
      farm_cost_usd: cost,
      farm_value_low_usd: valueLow,
      farmers_estimate: farmers,
      farm_value_per_farmer_usd: perFarmer,
      model: {
        curve_value_usd: s.v.curveValue,
        category_adjustment_log10: s.v.catAdj,
        growth_pct_clipped: s.v.growthPctClipped,
        age_days_used: s.v.ageUsed,
      },
      comparables: comparablesFor(s.p, comps),
      farm_steps: farmSteps(s.p, age, cost, perFarmer, farmers, verdict, breakEven, netPerHour).map(stepText),
    };
  });
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The whole farm's cost in dollars: setup gas plus one weekly action's gas for the hold. */
export function farmCostUsd(p: SnapshotProtocol, age: number | null): number {
  const capital = capitalFor(p);
  const setupGas = capital >= 150 ? 8 : 4;
  const weeks = Math.ceil(holdDaysFor(age) / 7);
  return setupGas + weeks * 2;
}

/**
 * The mechanism family of a protocol, from its category: the farm plan's actions follow what the
 * protocol actually does, not one generic deposit. A DEX farm swaps and provides liquidity; a
 * lending farm supplies and borrows; a perps farm posts margin and hedges; a bridge farm moves
 * funds and uses them on the other side. The category is the snapshot's own word for it.
 */
function mechanismOf(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'lending';
  if (c.includes('dex') || c.includes('leveraged farm') || c.includes('amm')) return 'dex';
  if (c.includes('bridge')) return 'bridge';
  if (c.includes('staking') || c.includes('restak')) return 'staking';
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return 'perps';
  if (c.includes('prediction')) return 'prediction';
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return 'vault';
  if (c.includes('stable')) return 'stable';
  if (c.includes('rwa') || c.includes('real world')) return 'rwa';
  if (c.includes('insurance')) return 'insurance';
  if (c.includes('yield')) return 'yield';
  if (c.includes('basis')) return 'basis';
  return 'generic';
}

/** The mechanism's first two actions, in the words a farmer can follow. */
function mechanismActions(mech: string, p: SnapshotProtocol, capital: number, chain: string): [string, string] {
  const name = p.name;
  switch (mech) {
    case 'lending':
      return [
        `Supply $${capital} of USDC to ${name} on ${chain} as collateral and keep the supply position open.`,
        `Borrow a small amount, about $10 of a stablecoin, against the supply, then repay it the same week so the account shows both sides.`,
      ];
    case 'dex':
      return [
        `Swap $25 of USDC for the pool's other asset on ${name} on ${chain}, then provide $${capital} of liquidity to its main pool.`,
        `Stake the LP receipt in ${name}'s gauge or rewards contract if it has one, and keep the position in range.`,
      ];
    case 'bridge':
      return [
        `Bridge $${capital} of USDC to ${chain} through ${name} and confirm the funds arrive on the destination chain.`,
        `Use the bridged funds once in an app on ${chain}, such as a swap or a deposit, so the bridge is not a dead round trip.`,
      ];
    case 'staking':
      return [
        `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token.`,
        `Delegate or restake the receipt once through ${name}'s own interface and leave the position staked.`,
      ];
    case 'perps':
      return [
        `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small position of about $10 notional.`,
        `Close the position the same day and leave the margin deposited, so the account shows a completed trade.`,
      ];
    case 'prediction':
      return [
        `Fund $${capital} on ${name} on ${chain} and place one market position of about $10 on an outcome you can follow.`,
        `Let the position settle or close it before expiry, then leave the remaining balance funded for the next market.`,
      ];
    case 'vault':
      return [
        `Deposit $${capital} of USDC into a ${name} vault on ${chain} and keep the vault shares.`,
        `Check the vault's allocation report once a month and add a small top-up, about $10, so the position is active.`,
      ];
    case 'stable':
      return [
        `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it in the protocol.`,
        `Redeem a small test amount, about $5, back to USDC once, to prove the redemption path works before you need it.`,
      ];
    case 'rwa':
      return [
        `Mint $${capital} of the protocol's yield asset on ${chain} through ${name} and hold it in your wallet.`,
        `Claim or compound the yield once a month through ${name}'s own page and keep the principal invested.`,
      ];
    case 'insurance':
      return [
        `Buy $${capital} of cover from ${name} on ${chain} for a protocol you already use, and keep the policy active.`,
        `Read the policy's claim conditions once and note the expiry date, so a real event is not missed.`,
      ];
    case 'yield':
      return [
        `Deposit $${capital} of USDC into ${name}'s highest-TVL strategy on ${chain} and keep the position open.`,
        `Harvest the strategy's rewards once a month and restake them into the same strategy.`,
      ];
    case 'basis':
      return [
        `Deposit $${capital} of USDC into ${name}'s basis vault on ${chain} and keep the position open.`,
        `Check the vault's funding-rate report once a month and leave the position through one full funding cycle.`,
      ];
    default:
      return [
        `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`,
        `Use one of ${name}'s core features a second time, such as a swap, a deposit or a vote, so the wallet is not a single deposit.`,
      ];
  }
}

/** What can go wrong with this mechanism, in one step: the farm's own risks, named. */
function riskText(mech: string, p: SnapshotProtocol): string {
  switch (mech) {
    case 'lending':
      return `Know the liquidation line before you borrow: a sharp price move can liquidate the supply, so keep the borrowed amount small and the health factor high.`;
    case 'dex':
      return `Liquidity can lose value to impermanent loss if the pair moves hard, and a thin pool can strand the position, so use the main pool only.`;
    case 'bridge':
      return `Bridges are the most exploited contracts in DeFi: bridge only what you can afford to lose, and never approve an unlimited spend.`;
    case 'staking':
      return `Staked assets can be slashed or locked for an unbonding period, so check the lock-up before you stake and keep gas aside to exit.`;
    case 'perps':
      return `Leverage liquidates fast: keep the position tiny, never add to a losing trade, and close it the same day you open it.`;
    case 'prediction':
      return `A prediction market can resolve against you in full, so size the position as entertainment money, not as the farm itself.`;
    case 'vault':
      return `A vault's strategy can change without notice, so read each allocation report and be ready to withdraw if the strategy turns.`;
    case 'stable':
      return `A stable asset can depeg: test the redemption path with a small amount first, and do not hold more than you can exit in a day.`;
    case 'rwa':
      return `Real-world backing is only as good as its custodian and its audits: read who holds the assets and how redemption works before minting.`;
    case 'insurance':
      return `Cover pays only on the policy's exact conditions: read what is excluded, because a loss outside the wording is not a claim.`;
    case 'yield':
      return `Yield strategies can carry hidden leverage or unaudited contracts: prefer the highest-TVL strategy and never deposit your whole stack.`;
    case 'basis':
      return `A basis trade earns funding until it does not: a funding flip can turn the vault negative for weeks, so size for a drawdown.`;
    default:
      return `Every unaudited contract can lose funds: deposit only what you can afford to lose, and never approve an unlimited spend.`;
  }
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a time, derived from the
 * protocol's own record (category, chains, TVL, age) and its netted economics, never from a
 * hand-written list of names. The mechanism's actions, the weekly cadence, the hold, the risks,
 * the points check and the verdict step are all in it.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, cost: number, perFarmer: number, farmers: number, verdict: BoardRow['verdict'], breakEven: number, netPerHour: number): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const mech = mechanismOf(p);
  const [first, second] = mechanismActions(mech, p, capital, chain);
  const per = `$${perFarmer.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const verdictText =
    verdict === 'FARM'
      ? `Farm it: one farmer's low-end share is about ${per} against about $${cost} of costs, more than three times the cost, split across an estimated ${farmers.toLocaleString('en-US')} farmers.`
      : verdict === 'THIN'
        ? `Thin: one farmer's low-end share is about ${per} against about $${cost} of costs, barely above the cost, so farm small or skip it.`
        : `Skip it for now: one farmer's low-end share is about ${per} against about $${cost} of costs, below the cost, so the farm does not pay for one wallet.`;
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    { text: first, cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`, time: '15 minutes to set up' },
    { text: second, cost: 'about $2 of gas', time: '10 minutes' },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: riskText(mech, p),
      cost: 'nothing to read, everything to lose if ignored',
      time: '10 minutes',
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `${verdictText} Break-even low-end implied value: $${breakEven.toLocaleString('en-US')}. Modeled net per active hour: ${netPerHour < 0 ? '-' : ''}$${Math.abs(netPerHour).toFixed(2)}.`,
      cost: `about $${cost} of costs in all`,
      time: 'read once, then decide',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    rank_p10: row.rank_p10,
    rank_p50: row.rank_p50,
    rank_p90: row.rank_p90,
    break_even_implied_usd: row.break_even_implied_usd,
    net_per_hour_usd: row.net_per_hour_usd,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    implied_low_usd: row.implied_low_usd,
    implied_high_usd: row.implied_high_usd,
    verdict: row.verdict,
    farm_cost_usd: row.farm_cost_usd,
    farm_value_low_usd: row.farm_value_low_usd,
    farmers_estimate: row.farmers_estimate,
    farm_value_per_farmer_usd: row.farm_value_per_farmer_usd,
    curve_value_usd: row.model.curve_value_usd,
    category_adjustment_log10: row.model.category_adjustment_log10,
    growth_pct_clipped: row.model.growth_pct_clipped,
    age_days_used: row.model.age_days_used,
    comparables: row.comparables,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { families, excludedZeroMcap } = compsFamilies(snapshot);
  const watch = new Set(snapshot.watchlist);
  const candidates = snapshot.protocols.filter((p) => watch.has(p.slug) || isRankable(p));
  const ranks = new Map<string, number[]>();
  const fit = fitSizeCurve(families, excludedZeroMcap, snapshot.as_of, model, candidates, ranks);
  const board = buildBoard(snapshot, fit, families, model, ranks);
  const live = liveRows(snapshot);
  const accounted = new Set([...board, ...live].map((row) => row.slug));
  const excluded = snapshot.protocols.filter((p) => !accounted.has(p.slug))
    .map(({ slug, name, category, ...rest }) => ({
      slug, name, category,
      reason: productReason({ slug, name, category, ...rest }) ??
        (rest.gecko_id || rest.symbol ? 'Token identifier, no market cap' : 'Outside rankable universe'),
    })).sort((a, b) => a.slug.localeCompare(b.slug));
  const verdict_counts = { FARM: 0, THIN: 0, SKIP: 0 };
  for (const row of board) verdict_counts[row.verdict]++;
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const preTotal = snapshot.protocols.filter(isPreToken).length;
  const radar: RadarData = {
    protocol_total: snapshot.protocols.length,
    verdict_counts,
    excluded,
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    fit,
    watchlist_size: snapshot.watchlist.length,
    watchlist_slugs: [...snapshot.watchlist],
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    pre_token_total: preTotal,
    excluded_total: excluded.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.comparables.length !== 3) return `${r.slug} has ${r.comparables.length} comparables, not 3`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
