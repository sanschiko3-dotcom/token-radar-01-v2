// Token Radar — radar-5 model library.
//
// The value model is a standardized ridge curve fitted on the 128 traded
// protocol families in the sealed snapshot. It predicts log10(market cap)
// from log10(TVL), clipped 7-day TVL growth and log10(age in days), plus a
// shrunk per-category adjustment. Everything in this file is deterministic:
// the same snapshot bytes always produce the same board bytes.
//
// Conventions (kept identical to the independent Python replication):
//   - median(xs) is the UPPER median: sorted[floor(n / 2)].
//   - quantile(xs, q) is sorted[min(n - 1, floor(q * n))].
//   - round4 / round2 round half away from zero, never banker's rounding.
//   - folds: assignment 0 is slug order mod 5; assignments 1..10 are
//     FNV-1a hashes of "<seed>:<slug>" mod 5.
//   - the ridge is fitted on TRAIN-standardized features (population
//     standard deviation), the intercept is never penalised, and the
//     reported coefficients are the back-transformed raw slopes rounded
//     to four decimals. Validation uses the unrounded fit; the board and
//     the bootstrap rank ranges use the rounded coefficients.

export interface Proto {
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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Proto[];
  watchlist: string[];
}

// A traded family: one protocol per token, the highest-TVL record kept.
export interface Comp extends Proto {
  age_days: number | null;
}

export interface ModelSpec {
  terms: string[]; // subset of ["g", "la"]; lt is always in
  cat: boolean;
  lam: number;
}

export const FULL_SPEC: ModelSpec = { terms: ["g", "la"], cat: true, lam: 40 };
export const LAMBDA_GRID = [0, 5, 10, 20, 30, 40, 60];
export const RIDGE_LAMBDA = 40;
export const GROWTH_FLOOR = -0.4;
export const GROWTH_CAP = 0.3;
export const UNKNOWN_AGE_DAYS = 1000;
export const CATEGORY_SHRINK_K = 4;
export const CATEGORY_CAP = 0.2;
export const CATEGORY_MIN_COMPS = 3;
export const TIME_SPLIT_CUT = "2024-06-01";
export const BOOTSTRAP_DRAWS = 200;
export const REPEATED_CV_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
export const FARMER_SHARE_LOW = 0.05;
export const FARMER_POSITION_USD = 10000;
export const VERDICT_FARM = 3;
export const VERDICT_THIN = 1;
export const ACTIVE_HOURS = 1.25;

// ---------------------------------------------------------------------------
// Small numeric helpers
// ---------------------------------------------------------------------------

/** Round half away from zero to 4 decimals. */
export function round4(n: number): number {
  return n >= 0
    ? Math.floor(n * 1e4 + 0.5) / 1e4
    : -Math.floor(-n * 1e4 + 0.5) / 1e4;
}

/** Round half away from zero to 2 decimals. */
export function round2(n: number): number {
  return n >= 0
    ? Math.floor(n * 100 + 0.5) / 100
    : -Math.floor(-n * 100 + 0.5) / 100;
}

/** Upper median: the element at sorted[floor(n / 2)]. */
export function medianUpper(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** TS quantile: sorted[min(n - 1, floor(q * n))]. */
export function quantileTs(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

export function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Population standard deviation (divide by n, not n - 1). */
export function stdPop(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / xs.length);
}

/** FNV-1a 32-bit hash, the fold hash used for repeated CV assignments. */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Deterministic LCG stream, seededRandom(0x3ad0) in the Python check. */
export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Solve A x = b by Gaussian elimination with partial pivoting. */
export function solveLinear(aIn: number[][], bIn: number[]): number[] {
  const n = bIn.length;
  const a = aIn.map((row) => [...row]);
  const b = [...bIn];
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    }
    if (pivot !== col) {
      const tmpRow = a[col];
      a[col] = a[pivot];
      a[pivot] = tmpRow;
      const tmpB = b[col];
      b[col] = b[pivot];
      b[pivot] = tmpB;
    }
    const diag = a[col][col];
    for (let r = col + 1; r < n; r++) {
      const factor = a[r][col] / diag;
      if (factor === 0) continue;
      for (let c = col; c < n; c++) a[r][c] -= factor * a[col][c];
      b[r] -= factor * b[col];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let sum = b[r];
    for (let c = r + 1; c < n; c++) sum -= a[r][c] * x[c];
    x[r] = sum / a[r][r];
  }
  return x;
}

// ---------------------------------------------------------------------------
// Snapshot -> traded families, features
// ---------------------------------------------------------------------------

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(asOf + "T00:00:00Z");
  const b = Date.parse(listedAt + "T00:00:00Z");
  return Math.max(0, Math.round((a - b) / 86400000));
}

export function clippedGrowth(p: Proto): number {
  const g = (p.change_7d === null ? 0 : p.change_7d) / 100;
  return Math.min(GROWTH_CAP, Math.max(GROWTH_FLOOR, g));
}

/** Feature vector [1, log10 TVL, growth?, log10 age?] for one protocol. */
export function featureVec(p: Proto, asOf: string, spec: ModelSpec): number[] {
  const lt = Math.log10(p.tvl_usd);
  const cols = [1, lt];
  if (spec.terms.includes("g")) cols.push(clippedGrowth(p));
  if (spec.terms.includes("la")) {
    const age = ageDays(asOf, p.listed_at);
    const used = age === null ? UNKNOWN_AGE_DAYS : age;
    cols.push(Math.log10(Math.max(1, used)));
  }
  return cols;
}

export function logMcap(p: Proto): number {
  return Math.log10(p.mcap_usd as number);
}

/**
 * Traded families: protocols that record a token with a positive market
 * cap and positive TVL, deduplicated by gecko_id keeping the highest-TVL
 * record, sorted by slug. 128 families on this snapshot.
 */
export function buildFamilies(snap: Snapshot): Comp[] {
  const byFam = new Map<string, Proto>();
  for (const p of snap.protocols) {
    if (p.gecko_id === null) continue;
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const cur = byFam.get(p.gecko_id);
    if (cur === undefined || p.tvl_usd > cur.tvl_usd) byFam.set(p.gecko_id, p);
  }
  return [...byFam.values()]
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .map((p) => ({ ...p, age_days: ageDays(snap.as_of, p.listed_at) }));
}

// ---------------------------------------------------------------------------
// Standardized ridge fit
// ---------------------------------------------------------------------------

export interface RidgeFit {
  coefZ: number[]; // standardized slopes (unrounded), [intercept, ...]
  raw: number[]; // back-transformed raw coefficients (unrounded)
  mu: number[]; // train means of the non-intercept columns
  sd: number[]; // train population stds of the non-intercept columns
  adj: Record<string, number>; // shrunk category adjustments, round4
  x: number[][]; // feature matrix for every comp, in comp order
}

export function categoryAdjustments(
  trainIdx: number[],
  resid: number[],
  comps: Comp[],
  spec: ModelSpec,
): Record<string, number> {
  if (!spec.cat) return {};
  const byCat = new Map<string, number[]>();
  trainIdx.forEach((idx, k) => {
    const cat = comps[idx].category ?? "null";
    const arr = byCat.get(cat) ?? [];
    arr.push(resid[k]);
    byCat.set(cat, arr);
  });
  const out: Record<string, number> = {};
  for (const [cat, rs] of byCat) {
    if (rs.length < CATEGORY_MIN_COMPS) continue;
    const shrink = rs.length / (rs.length + CATEGORY_SHRINK_K);
    out[cat] = round4(
      Math.max(-CATEGORY_CAP, Math.min(CATEGORY_CAP, medianUpper(rs) * shrink)),
    );
  }
  return out;
}

/**
 * Standardized ridge on the given training rows. Features are standardized
 * on TRAIN rows only; the intercept is unpenalised; the ridge penalty
 * (lambda) applies to the standardized slopes. Category adjustments come
 * from the training residuals (median, shrunk, capped).
 */
export function fitStdRidge(
  trainIdx: number[],
  spec: ModelSpec,
  comps: Comp[],
  asOf: string,
): RidgeFit {
  const x = comps.map((p) => featureVec(p, asOf, spec));
  const y = comps.map((p) => logMcap(p));
  const k = x[0].length;
  const xTr = trainIdx.map((i) => x[i]);
  const yTr = trainIdx.map((i) => y[i]);
  const mu: number[] = [];
  const sd: number[] = [];
  for (let j = 1; j < k; j++) {
    const col = xTr.map((row) => row[j]);
    mu.push(mean(col));
    const s = stdPop(col);
    sd.push(s === 0 ? 1 : s);
  }
  // Standardized design: [1, (x - mu) / sd].
  const zTr = xTr.map((row) => {
    const z = [1];
    for (let j = 1; j < k; j++) z.push((row[j] - mu[j - 1]) / sd[j - 1]);
    return z;
  });
  // Normal equations (Z'Z + lam * diag(0, 1, ...)) coef = Z'y.
  const a: number[][] = [];
  const b: number[] = [];
  for (let r = 0; r < k; r++) {
    const row: number[] = [];
    for (let c = 0; c < k; c++) {
      let sum = 0;
      for (let t = 0; t < zTr.length; t++) sum += zTr[t][r] * zTr[t][c];
      if (r === c && r > 0) sum += spec.lam;
      row.push(sum);
    }
    a.push(row);
    let sumB = 0;
    for (let t = 0; t < zTr.length; t++) sumB += zTr[t][r] * yTr[t];
    b.push(sumB);
  }
  const coefZ = solveLinear(a, b);
  const resid = yTr.map((yt, t) => {
    let pred = 0;
    for (let j = 0; j < k; j++) pred += zTr[t][j] * coefZ[j];
    return yt - pred;
  });
  const adj = categoryAdjustments(trainIdx, resid, comps, spec);
  const raw = new Array<number>(k).fill(0);
  let intercept = coefZ[0];
  for (let j = 1; j < k; j++) {
    raw[j] = coefZ[j] / sd[j - 1];
    intercept -= (coefZ[j] * mu[j - 1]) / sd[j - 1];
  }
  raw[0] = intercept;
  return { coefZ, raw, mu, sd, adj, x };
}

/** Predict log10(mcap) for rows, adding each row's category adjustment. */
export function predictStd(
  fit: RidgeFit,
  testIdx: number[],
  comps: Comp[],
): number[] {
  return testIdx.map((i) => {
    const row = fit.x[i];
    let base = fit.coefZ[0];
    for (let j = 1; j < row.length; j++) {
      base += fit.coefZ[j] * ((row[j] - fit.mu[j - 1]) / fit.sd[j - 1]);
    }
    return base + (fit.adj[comps[i].category ?? "null"] ?? 0);
  });
}

/** Predict with ROUNDED raw coefficients (the board / bootstrap path). */
export function predictRounded(
  fit: RidgeFit,
  testIdx: number[],
  comps: Comp[],
): number[] {
  const coef = fit.raw.map((c) => round4(c));
  return testIdx.map((i) => {
    const row = fit.x[i];
    let sum = 0;
    for (let j = 0; j < row.length; j++) sum += coef[j] * row[j];
    return sum + (fit.adj[comps[i].category ?? "null"] ?? 0);
  });
}

/** Median absolute error as a factor, and R^2, with the TS median. */
export function metricsTs(
  yTrue: number[],
  pred: number[],
): { medianFactor: number; rSquared: number } {
  const err = yTrue.map((yt, i) => yt - pred[i]);
  const med = Math.pow(10, medianUpper(err.map((e) => Math.abs(e))));
  const ss = err.reduce((a, e) => a + e * e, 0);
  const m = mean(yTrue);
  const tot = yTrue.reduce((a, yt) => a + (yt - m) * (yt - m), 0);
  return { medianFactor: med, rSquared: tot === 0 ? 0 : 1 - ss / tot };
}

// ---------------------------------------------------------------------------
// Repeated cross-validation and selection
// ---------------------------------------------------------------------------

/** The 11 fold assignments: slug order mod 5, then FNV seeds 1..10. */
export function foldAssignments(comps: Comp[]): number[][] {
  const out: number[][] = [[...comps.keys()].map((i) => i % 5)];
  for (const seed of REPEATED_CV_SEEDS) {
    out.push(comps.map((p) => fnv1a(`${seed}:${p.slug}`) % 5));
  }
  return out;
}

export interface CvResult {
  medianFactor: number;
  rSquared: number;
}

/** One full 5-fold pass under one assignment, returning per-fold predictions. */
export function cvPredictions(
  spec: ModelSpec,
  foldOf: number[],
  comps: Comp[],
  asOf: string,
): number[] {
  const y = comps.map((p) => logMcap(p));
  const pred = new Array<number>(comps.length).fill(0);
  for (let f = 0; f < 5; f++) {
    const te = comps.map((_, i) => i).filter((i) => foldOf[i] === f);
    const tr = comps.map((_, i) => i).filter((i) => foldOf[i] !== f);
    const fit = fitStdRidge(tr, spec, comps, asOf);
    const p = predictStd(fit, te, comps);
    te.forEach((idx, k) => {
      pred[idx] = p[k];
    });
  }
  return pred;
}

export function cvMetrics(
  spec: ModelSpec,
  foldOf: number[],
  comps: Comp[],
  asOf: string,
): CvResult {
  const y = comps.map((p) => logMcap(p));
  const pred = cvPredictions(spec, foldOf, comps, asOf);
  const m = metricsTs(y, pred);
  return { medianFactor: m.medianFactor, rSquared: m.rSquared };
}

/** Repeated-CV mean over all 11 assignments, plus the per-assignment list. */
export function repeatedCv(
  spec: ModelSpec,
  comps: Comp[],
  asOf: string,
): { mean: CvResult; per: CvResult[] } {
  const per = foldAssignments(comps).map((fo) => cvMetrics(spec, fo, comps, asOf));
  return {
    mean: {
      medianFactor: mean(per.map((p) => p.medianFactor)),
      rSquared: mean(per.map((p) => p.rSquared)),
    },
    per,
  };
}

/** Paired per-assignment differences: mean and standard error. */
export function pairedDiff(a: number[], b: number[]): { diff: number; se: number } {
  const d = a.map((v, i) => v - b[i]);
  const m = mean(d);
  const sd = Math.sqrt(
    d.reduce((s, v) => s + (v - m) * (v - m), 0) / (d.length - 1),
  );
  return { diff: m, se: sd / Math.sqrt(d.length) };
}

export interface SelectionEvidence {
  fullMean: number;
  lambdaBest: number;
  lambdaBestMean: number;
  lambda30Diff: number;
  lambda30Se: number;
  dropAgeDiff: number;
  dropAgeSe: number;
  dropGrowthDiff: number;
  dropGrowthSe: number;
  dropCategoryDiff: number;
  dropCategorySe: number;
}

/**
 * The one-standard-error evidence behind the selected spec. A term is
 * dropped, or lambda moved, only when the paired improvement beats one
 * standard error of the paired per-assignment differences. At lambda 40
 * dropping age improves the repeated mean by only -0.001 against a paired
 * SE of 0.057 — a dead heat — so age stays, and the bounty rubric names
 * age as a value input. Lambda 30 trails the best (40) by 0.045 against
 * a paired SE of 0.044 — just outside one SE — so 40 is both the best
 * mean and the largest lambda within one SE of it.
 */
export function selectionEvidence(comps: Comp[], asOf: string): SelectionEvidence {
  const assigns = foldAssignments(comps);
  const factors = (spec: ModelSpec): number[] =>
    assigns.map((fo) => cvMetrics(spec, fo, comps, asOf).medianFactor);
  const grid: Record<number, number[]> = {};
  for (const lam of LAMBDA_GRID) {
    grid[lam] = factors({ terms: ["g", "la"], cat: true, lam });
  }
  const gridMeans = LAMBDA_GRID.map((lam) => [lam, mean(grid[lam])] as const);
  let bestLam = LAMBDA_GRID[0];
  for (const [lam, m] of gridMeans) {
    if (m < mean(grid[bestLam])) bestLam = lam;
  }
  const full = grid[RIDGE_LAMBDA];
  const lam30 = pairedDiff(grid[30], grid[bestLam]);
  const noAge = pairedDiff(
    factors({ terms: ["g"], cat: true, lam: RIDGE_LAMBDA }),
    full,
  );
  const noGrowth = pairedDiff(
    factors({ terms: ["la"], cat: true, lam: RIDGE_LAMBDA }),
    full,
  );
  const noCat = pairedDiff(
    factors({ terms: ["g", "la"], lam: RIDGE_LAMBDA }),
    full,
  );
  return {
    fullMean: mean(full),
    lambdaBest: bestLam,
    lambdaBestMean: mean(grid[bestLam]),
    lambda30Diff: lam30.diff,
    lambda30Se: lam30.se,
    dropAgeDiff: noAge.diff,
    dropAgeSe: noAge.se,
    dropGrowthDiff: noGrowth.diff,
    dropGrowthSe: noGrowth.se,
    dropCategoryDiff: noCat.diff,
    dropCategorySe: noCat.se,
  };
}

// ---------------------------------------------------------------------------
// Walk-forward, time split, leave-one-out, leave-one-category-out
// ---------------------------------------------------------------------------

export interface WindowResult {
  nTrain: number;
  validation: { nTest: number; medianFactor: number; rSquared: number };
}

export function walkForward(
  spec: ModelSpec,
  comps: Comp[],
  asOf: string,
): { windows: WindowResult[]; pooled: CvResult & { nTest: number } } {
  const dated = comps
    .map((p, i) => i)
    .filter((i) => comps[i].listed_at !== null)
    .sort((a, b) => {
      const da = comps[a].listed_at as string;
      const db = comps[b].listed_at as string;
      if (da !== db) return da < db ? -1 : 1;
      return a - b;
    });
  const n = dated.length;
  const y = comps.map((p) => logMcap(p));
  const windows: WindowResult[] = [];
  const pooledPred: number[] = [];
  const pooledTrue: number[] = [];
  for (const [start, end] of [
    [Math.floor(n / 2), Math.floor((3 * n) / 4)],
    [Math.floor((3 * n) / 4), n],
  ]) {
    const tr = dated.slice(0, start);
    const te = dated.slice(start, end);
    const fit = fitStdRidge(tr, spec, comps, asOf);
    const pred = predictStd(fit, te, comps);
    const m = metricsTs(
      te.map((i) => y[i]),
      pred,
    );
    windows.push({
      nTrain: start,
      validation: { nTest: te.length, medianFactor: m.medianFactor, rSquared: m.rSquared },
    });
    pooledPred.push(...pred);
    pooledTrue.push(...te.map((i) => y[i]));
  }
  const pooled = metricsTs(pooledTrue, pooledPred);
  return { windows, pooled: { nTest: pooledTrue.length, ...pooled } };
}

export function timeSplit(
  spec: ModelSpec,
  comps: Comp[],
  asOf: string,
): { nTest: number; medianFactor: number; rSquared: number } {
  const before = comps
    .map((_, i) => i)
    .filter((i) => comps[i].listed_at !== null && (comps[i].listed_at as string) < TIME_SPLIT_CUT);
  const after = comps
    .map((_, i) => i)
    .filter((i) => comps[i].listed_at !== null && (comps[i].listed_at as string) >= TIME_SPLIT_CUT);
  const fit = fitStdRidge(before, spec, comps, asOf);
  const pred = predictStd(fit, after, comps);
  const y = comps.map((p) => logMcap(p));
  const m = metricsTs(
    after.map((i) => y[i]),
    pred,
  );
  return { nTest: after.length, medianFactor: m.medianFactor, rSquared: m.rSquared };
}

/** Leave-one-out predictions (each comp predicted by a fit without it). */
export function leaveOneOut(
  spec: ModelSpec,
  comps: Comp[],
  asOf: string,
): CvResult {
  const y = comps.map((p) => logMcap(p));
  const pred = new Array<number>(comps.length).fill(0);
  for (let i = 0; i < comps.length; i++) {
    const tr = comps.map((_, j) => j).filter((j) => j !== i);
    const fit = fitStdRidge(tr, spec, comps, asOf);
    pred[i] = predictStd(fit, [i], comps)[0];
  }
  const m = metricsTs(y, pred);
  return { medianFactor: m.medianFactor, rSquared: m.rSquared };
}

/** The fixed-ratio baseline: predict each comp's mcap/TVL ratio by the
 *  median ratio of all other comps, scored as a leave-one-out factor. */
export function fixedRatioLoo(comps: Comp[]): number {
  const ratios = comps.map((p) => Math.log10(p.mcap_usd as number) - Math.log10(p.tvl_usd));
  const errs = ratios.map((r, i) => {
    const others = ratios.filter((_, j) => j !== i);
    return Math.abs(r - medianUpper(others));
  });
  return Math.pow(10, medianUpper(errs));
}

/**
 * Leave-one-category-out: each comp is predicted by a curve trained only
 * on comps of other categories, so its own category adjustment is unseen
 * and contributes zero.
 */
export function leaveOneCategoryOut(
  spec: ModelSpec,
  comps: Comp[],
  asOf: string,
): CvResult {
  const y = comps.map((p) => logMcap(p));
  const cats = comps.map((p) => p.category ?? "null");
  const pred = new Array<number>(comps.length).fill(0);
  for (let i = 0; i < comps.length; i++) {
    const tr = comps.map((_, j) => j).filter((j) => cats[j] !== cats[i]);
    const fit = fitStdRidge(tr, spec, comps, asOf);
    pred[i] = predictStd(fit, [i], comps)[0];
  }
  const m = metricsTs(y, pred);
  return { medianFactor: m.medianFactor, rSquared: m.rSquared };
}

// ---------------------------------------------------------------------------
// Bootstrap: slope interval and rank ranges
// ---------------------------------------------------------------------------

export interface BootstrapResult {
  slopeP5: number;
  slopeP95: number;
  ranks: Record<string, { p10: number; p50: number; p90: number }>;
}

/**
 * 200 seeded bootstrap refits of the selected curve. Each draw resamples
 * the 128 comps with replacement from the LCG stream seeded 0x3ad0; the
 * slope interval comes from the refit TVL slopes (rounded), and each
 * candidate's rank range comes from ranking all candidates by the refit
 * curve's implied values (rounded coefficients, rounded adjustments).
 */
export function bootstrapRanks(
  spec: ModelSpec,
  comps: Comp[],
  candidates: Proto[],
  asOf: string,
): BootstrapResult {
  const rng = lcg(0x3ad0);
  const slopes: number[] = [];
  const rankLists = new Map<string, number[]>();
  for (const p of candidates) rankLists.set(p.slug, []);
  for (let d = 0; d < BOOTSTRAP_DRAWS; d++) {
    const draw = Array.from({ length: comps.length }, () =>
      Math.floor(rng() * comps.length),
    );
    const refit = fitStdRidge(draw, spec, comps, asOf);
    slopes.push(round4(refit.raw[1]));
    const coef = refit.raw.map((c) => round4(c));
    const vals = candidates.map((p) => {
      const row = featureVec(p, asOf, spec);
      let sum = 0;
      for (let j = 0; j < row.length; j++) sum += coef[j] * row[j];
      const v =
        sum + (refit.adj[p.category ?? "null"] ?? 0);
      return { slug: p.slug, value: Math.max(1, Math.round(Math.pow(10, v))) };
    });
    vals.sort((a, b) => b.value - a.value || (a.slug < b.slug ? -1 : 1));
    vals.forEach((v, i) => {
      rankLists.get(v.slug)?.push(i + 1);
    });
  }
  const ranks: Record<string, { p10: number; p50: number; p90: number }> = {};
  for (const [slug, list] of rankLists) {
    ranks[slug] = {
      p10: quantileTs(list, 0.1),
      p50: quantileTs(list, 0.5),
      p90: quantileTs(list, 0.9),
    };
  }
  return {
    slopeP5: round4(quantileTs(slopes, 0.05)),
    slopeP95: round4(quantileTs(slopes, 0.95)),
    ranks,
  };
}

// ---------------------------------------------------------------------------
// Board candidates, farm economics, comparables
// ---------------------------------------------------------------------------

export function isPreToken(p: Proto): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const EXCHANGE_NAMES = [
  "Binance",
  "Coinbase",
  "Bybit",
  "Kraken",
  "Bitget",
  "OKX",
  "Bitfinex",
  "Gemini",
];

const WRAPPED_CATEGORIES = new Set([
  "Bridge",
  "Canonical Bridge",
  "Liquid Staking",
  "Liquid Restaking",
  "Restaked BTC",
  "CEX",
]);

const VERSION_RE = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD_RE = /\b(wrapped|staked|staking)\b/i;

/**
 * A wrapped, staked or bridged product of a protocol whose token already
 * trades: an exchange's own product, a bridge / liquid-staking / restaking
 * product, a versioned release, or a name carrying wrapped / staked /
 * staking. Mirrors the snapshot's own watchlist rule.
 */
export function isWrapped(p: Proto): boolean {
  if (p.category === "CEX") return true;
  if (EXCHANGE_NAMES.some((n) => p.name.startsWith(n))) return true;
  if (p.category !== null && p.category.includes("Bridge") && WRAPPED_CATEGORIES.has(p.category)) {
    return true;
  }
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return true;
  if (VERSION_RE.test(p.name)) return true;
  if (WRAPPED_WORD_RE.test(p.name)) return true;
  return false;
}

/** Board candidates: every watchlist slug, plus every pre-token protocol
 *  that is not a wrapped / staked / bridged product. 198 on this snapshot. */
export function boardCandidates(snap: Snapshot): Proto[] {
  const watch = new Set(snap.watchlist);
  return snap.protocols.filter(
    (p) => watch.has(p.slug) || (isPreToken(p) && !isWrapped(p)),
  );
}

export function holdDaysFor(ageUsed: number): number {
  if (ageUsed >= 365) return 30;
  if (ageUsed >= 180) return 45;
  return 60;
}

export interface FarmEconomics {
  farmers: number;
  farmValueLow: number;
  perFarmer: number;
  holdDays: number;
  depositUsd: number;
  step2GasUsd: number;
  farmCost: number;
  netPerHour: number;
  breakEven: number;
  verdict: "FARM" | "THIN" | "SKIP";
}

/**
 * Farm economics for one board row. A farmer is assumed to hold a $10,000
 * position, so the farmer count is TVL / $10,000; the low-end farm value
 * is 5% of the low end of the implied-value band, shared evenly across
 * farmers. The verdict compares one farmer's low-end share with the
 * farming cost: at least 3x is FARM, at least 1x is THIN, below is SKIP.
 * Costs come from the hold length (30 / 45 / 60 days by age) plus the
 * main action's gas: $4 normally, $8 for a $150 deposit. The deposit is
 * $150 at TVL $1B+, $100 at $100M+, $50 below that, $25 flat for a swap.
 * Net per active hour divides the rounded per-farmer share minus cost by
 * 1.25h at a 30-day hold, growing 20 minutes per extra 15 days.
 */
export function farmEconomics(
  row: { tvl_usd: number; age_days_used: number; implied_value_usd: number },
  band: number,
  depositUsd: number,
): FarmEconomics {
  const farmers = Math.round(row.tvl_usd / FARMER_POSITION_USD);
  const impliedLow = Math.round(row.implied_value_usd / band);
  const farmValueLow = Math.round(impliedLow * FARMER_SHARE_LOW);
  const perFarmer = round2(farmValueLow / farmers);
  const holdDays = holdDaysFor(row.age_days_used);
  const step2GasUsd = depositUsd >= 150 ? 8 : 4;
  const farmCost = 14 + 4 * ((holdDays - 30) / 15) + (step2GasUsd === 8 ? 4 : 0);
  // Net per active hour: the rounded per-farmer share minus cost, over
  // active hours that grow with the hold — 1.25h at 30 days, +20 min per
  // extra 15 days (1.583h at 45, 1.917h at 60).
  const activeHours = ACTIVE_HOURS + (holdDays - 30) / 45;
  const netPerHour = round2((perFarmer - farmCost) / activeHours);
  const breakEven = Math.round((farmCost * farmers) / FARMER_SHARE_LOW);
  const ratio = perFarmer / farmCost;
  const verdict = ratio >= VERDICT_FARM ? "FARM" : ratio >= VERDICT_THIN ? "THIN" : "SKIP";
  return {
    farmers,
    farmValueLow,
    perFarmer,
    holdDays,
    depositUsd,
    step2GasUsd,
    farmCost,
    netPerHour,
    breakEven,
    verdict,
  };
}

export interface Comparable {
  name: string;
  tvl_usd: number;
  mcap_usd: number;
}

/**
 * The three closest traded families: same-category comps first, then the
 * smallest |log10 TVL| distance, slug as the tie-break. A reader can check
 * the row's implied value against real tokens of the same kind and size.
 */
export function comparablesFor(row: Proto, comps: Comp[]): Comparable[] {
  const lt = Math.log10(row.tvl_usd);
  return [...comps]
    .sort((a, b) => {
      const ca = a.category === row.category ? 0 : 1;
      const cb = b.category === row.category ? 0 : 1;
      if (ca !== cb) return ca - cb;
      const da = Math.abs(Math.log10(a.tvl_usd) - lt);
      const db = Math.abs(Math.log10(b.tvl_usd) - lt);
      if (da !== db) return da - db;
      return a.slug < b.slug ? -1 : 1;
    })
    .slice(0, 3)
    .map((c) => ({ name: c.name, tvl_usd: c.tvl_usd, mcap_usd: c.mcap_usd as number }));
}

// ---------------------------------------------------------------------------
// Audit: what the board and the live set leave out
// ---------------------------------------------------------------------------

export interface AuditRow {
  slug: string;
  name: string;
  category: string | null;
  reason: string;
}

const BRIDGE_CATEGORIES = new Set(["Bridge", "Canonical Bridge"]);
const STAKE_CATEGORIES = new Set(["Liquid Staking", "Liquid Restaking", "Restaked BTC"]);

/** One reason per protocol left out of both lists, in a fixed precedence:
 *  versioned product, bridged product, exchange product, staked product,
 *  token identifier with no market cap. */
export function auditReason(p: Proto): string | null {
  if (
    p.category === "CEX" ||
    EXCHANGE_NAMES.some((n) => p.name.startsWith(n))
  ) {
    return "Exchange product";
  }
  if (p.category !== null && BRIDGE_CATEGORIES.has(p.category)) return "Bridged product";
  if (
    (p.category !== null && STAKE_CATEGORIES.has(p.category)) ||
    WRAPPED_WORD_RE.test(p.name)
  ) {
    return "Staked product";
  }
  if (VERSION_RE.test(p.name)) return "Versioned product";
  if ((p.gecko_id !== null || p.symbol !== null) && p.mcap_usd === null) {
    return "Token identifier, no market cap";
  }
  return null;
}

export function auditExcluded(
  snap: Snapshot,
  boardSlugs: Set<string>,
  liveSlugs: Set<string>,
): AuditRow[] {
  return snap.protocols
    .filter((p) => !boardSlugs.has(p.slug) && !liveSlugs.has(p.slug))
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      reason: auditReason(p) ?? "Token identifier, no market cap",
    }))
    .sort((a, b) => (a.slug < b.slug ? -1 : 1));
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
}

/** Protocols that record a token (market cap present, even zero or
 *  negative), set aside from the board: sorted by market cap, then TVL,
 *  then slug. 144 on this snapshot. */
export function liveSet(snap: Snapshot): LiveRow[] {
  return snap.protocols
    .filter((p) => p.mcap_usd !== null)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd as number,
      change_7d: p.change_7d,
    }))
    .sort((a, b) => {
      if (a.mcap_usd !== b.mcap_usd) return b.mcap_usd - a.mcap_usd;
      if (a.tvl_usd !== b.tvl_usd) return b.tvl_usd - a.tvl_usd;
      return a.slug < b.slug ? -1 : 1;
    });
}

// ---------------------------------------------------------------------------
// Farm plans: one mechanism-aware 8-step plan per protocol
// ---------------------------------------------------------------------------

export type FarmTemplate =
  | "vault"
  | "supply"
  | "swap"
  | "stake"
  | "yield"
  | "rwa"
  | "bridge"
  | "margin"
  | "stable"
  | "predict"
  | "insurance"
  | "deposit";

export function templateFor(category: string | null): FarmTemplate {
  switch (category) {
    case "Risk Curators":
    case "Onchain Capital Allocator":
    case "Basis Trading":
      return "vault";
    case "Lending":
    case "CDP":
    case "CDP Manager":
    case "Uncollateralized Lending":
    case "Collateral Markets":
    case "OTC Marketplace":
      return "supply";
    case "Dexs":
    case "Indexes":
    case "Leveraged Farming":
      return "swap";
    case "Restaking":
    case "Staking Pool":
      return "stake";
    case "Yield":
    case "Yield Aggregator":
    case "Farm":
    case "Governance Incentives":
    case "Liquidity Manager":
      return "yield";
    case "RWA":
      return "rwa";
    case "Cross Chain Bridge":
      return "bridge";
    case "Derivatives":
    case "Interest Rate Derivatives":
      return "margin";
    case "Dual-Token Stablecoin":
    case "Stablecoin Wrapper":
      return "stable";
    case "Prediction Market":
      return "predict";
    case "Insurance":
      return "insurance";
    default:
      return "deposit";
  }
}

/** The position size for the main step, by template and TVL. */
export function depositFor(tpl: FarmTemplate, tvlUsd: number): number {
  if (tpl === "swap") return 25;
  if (tvlUsd >= 1000000000) return 150;
  if (tvlUsd >= 100000000) return 100;
  return 50;
}

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function fmtMoney2(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}$${abs}`;
}

interface StepCtx {
  name: string;
  chain: string;
  amount: number;
  gas: number;
  holdDays: number;
  perFarmer: number;
  cost: number;
  farmers: number;
  breakEven: number;
  netPerHour: number;
  verdict: "FARM" | "THIN" | "SKIP";
}

function stepTwo(tpl: FarmTemplate, c: StepCtx): string {
  const cap = `$${c.amount} of capital and about $${c.gas} of gas`;
  switch (tpl) {
    case "vault":
      return `Put $${c.amount} of USDC into a ${c.name} vault on ${c.chain} and keep the vault shares in your wallet. Cost: ${cap}. Time: 15 minutes to set up.`;
    case "supply":
      return `Supply $${c.amount} of USDC to ${c.name} on ${c.chain} as collateral and keep the receipt token. Cost: ${cap}. Time: 15 minutes to set up.`;
    case "swap":
      return `Swap $${c.amount} of USDC into the pool's other asset on ${c.name} (${c.chain}) and add it as liquidity. Cost: ${cap}. Time: 15 minutes to set up.`;
    case "stake":
      return `Stake $${c.amount} of the chain's staking asset through ${c.name} on ${c.chain} and keep the receipt token. Cost: ${cap}. Time: 15 minutes to set up.`;
    case "yield":
      return `Deposit $${c.amount} of USDC into ${c.name}'s highest-yield pool on ${c.chain} and hold the receipt token. Cost: ${cap}. Time: 15 minutes to set up.`;
    case "rwa":
      return `Mint $${c.amount} of the protocol's yield asset on ${c.chain} through ${c.name} and hold it in your wallet. Cost: ${cap}. Time: 15 minutes to set up.`;
    case "bridge":
      return `Bridge $${c.amount} of USDC to ${c.chain} through ${c.name} and keep the receipt on the destination chain. Cost: ${cap}. Time: 15 minutes to set up.`;
    case "margin":
      return `Deposit $${c.amount} of USDC as margin on ${c.name} (${c.chain}) and open a small position. Cost: ${cap}. Time: 15 minutes to set up.`;
    case "stable":
      return `Mint or deposit $${c.amount} of the stable asset on ${c.chain} through ${c.name} and hold it in your wallet. Cost: ${cap}. Time: 15 minutes to set up.`;
    case "predict":
      return `Fund $${c.amount} on ${c.name} (${c.chain}) and place it on a market you have actually read. Cost: ${cap}. Time: 15 minutes to set up.`;
    case "insurance":
      return `Buy $${c.amount} of cover from ${c.name} on ${c.chain} for a protocol you already use. Cost: ${cap}. Time: 15 minutes to set up.`;
    default:
      return `Deposit $${c.amount} of USDC into ${c.name} on ${c.chain} and keep the receipt in your wallet. Cost: ${cap}. Time: 15 minutes to set up.`;
  }
}

function stepThree(tpl: FarmTemplate, c: StepCtx): string {
  switch (tpl) {
    case "vault":
      return `Read the vault's allocation report once a month and add a small top-up, about $10, so the position stays active. Cost: about $2 of gas. Time: 10 minutes.`;
    case "supply":
      return `Check the borrow rate and the collateral ratio once a month and top up about $10 if the ratio drifts. Cost: about $2 of gas. Time: 10 minutes.`;
    case "swap":
      return `Collect the trading fees once a month and re-add them to the pool instead of cashing out. Cost: about $2 of gas. Time: 10 minutes.`;
    case "stake":
      return `Delegate or restake the receipt once through ${c.name}'s own interface and leave the position staked. Cost: about $2 of gas. Time: 10 minutes.`;
    case "yield":
      return `Claim or compound the yield once a month through ${c.name}'s own page and keep the principal invested. Cost: about $2 of gas. Time: 10 minutes.`;
    case "rwa":
      return `Claim or compound the yield once a month through ${c.name}'s own page and keep the principal invested. Cost: about $2 of gas. Time: 10 minutes.`;
    case "bridge":
      return `Bridge a small amount back once a month so the address shows activity in both directions. Cost: about $2 of gas. Time: 10 minutes.`;
    case "margin":
      return `Check the position once a month, trim it if the funding rate turns against you, and keep margin above the minimum. Cost: about $2 of gas. Time: 10 minutes.`;
    case "stable":
      return `Check the peg once a month and redeem a small amount to confirm the redemption path still works. Cost: about $2 of gas. Time: 10 minutes.`;
    case "predict":
      return `Settle one market a month and roll the winnings into the next market instead of withdrawing. Cost: about $2 of gas. Time: 10 minutes.`;
    case "insurance":
      return `Check the cover terms once a month and renew before it lapses if you still hold the underlying. Cost: about $2 of gas. Time: 10 minutes.`;
    default:
      return `Use the protocol once a month — a deposit, a swap or a vote — so the wallet shows steady activity. Cost: about $2 of gas. Time: 10 minutes.`;
  }
}

function stepSix(tpl: FarmTemplate, _c: StepCtx): string {
  switch (tpl) {
    case "vault":
      return `A vault's strategy can change without notice, so read each allocation report and be ready to withdraw if the strategy turns. Cost: nothing to read, everything to lose if ignored. Time: 10 minutes.`;
    case "supply":
      return `Collateral can be liquidated if the ratio slips, so watch the health factor and keep a buffer above the minimum. Cost: nothing to read, everything to lose if ignored. Time: 10 minutes.`;
    case "swap":
      return `Liquidity pools lose value when prices move apart, so check impermanent loss before adding more. Cost: nothing to read, everything to lose if ignored. Time: 10 minutes.`;
    case "stake":
      return `Staked assets can be slashed or locked for an unbonding period, so check the lock-up before you stake and keep gas aside to exit. Cost: nothing to read, everything to lose if ignored. Time: 10 minutes.`;
    case "yield":
      return `A headline yield can come from emissions that fade, so check where the yield is paid from before adding more. Cost: nothing to read, everything to lose if ignored. Time: 10 minutes.`;
    case "rwa":
      return `Real-world backing is only as good as its custodian and its audits: read who holds the assets and how redemption works before minting. Cost: nothing to read, everything to lose if ignored. Time: 10 minutes.`;
    case "bridge":
      return `Bridges hold the funds between chains, so check the bridge's audits and limits before moving a large amount. Cost: nothing to read, everything to lose if ignored. Time: 10 minutes.`;
    case "margin":
      return `Leveraged positions can be liquidated in a fast move, so size the position small and never use the full margin. Cost: nothing to read, everything to lose if ignored. Time: 10 minutes.`;
    case "stable":
      return `A stable asset is only as good as its backing and its redemption path, so read both before minting more. Cost: nothing to read, everything to lose if ignored. Time: 10 minutes.`;
    case "predict":
      return `Prediction markets pay only when the outcome resolves your way, so never stake money you need back. Cost: nothing to read, everything to lose if ignored. Time: 10 minutes.`;
    case "insurance":
      return `Cover pays only for the events its policy names, so read the exclusions before you rely on it. Cost: nothing to read, everything to lose if ignored. Time: 10 minutes.`;
    default:
      return `A new protocol can change its rules or pause without notice, so read its updates before adding more funds. Cost: nothing to read, everything to lose if ignored. Time: 10 minutes.`;
  }
}

function stepEight(c: StepCtx): string {
  const share = fmtMoney2(c.perFarmer);
  const tail = `Break-even low-end implied value: $${fmtInt(c.breakEven)}. Modeled net per active hour: ${fmtMoney2(c.netPerHour)}. Cost: about $${c.cost} of costs in all. Time: read once, then decide.`;
  if (c.verdict === "FARM") {
    return `Farm it: one farmer's low-end share is about ${share} against about $${c.cost} of costs, more than three times the cost, split across an estimated ${fmtInt(c.farmers)} farmers. ${tail}`;
  }
  if (c.verdict === "THIN") {
    return `Thin: one farmer's low-end share is about ${share} against about $${c.cost} of costs, barely above the cost, so farm small or skip it. ${tail}`;
  }
  return `Skip it for now: one farmer's low-end share is about ${share} against about $${c.cost} of costs, below the cost, so the farm does not pay for one wallet. ${tail}`;
}

export function farmSteps(p: Proto, econ: FarmEconomics): string[] {
  const tpl = templateFor(p.category);
  const ctx: StepCtx = {
    name: p.name,
    chain: p.chains[0] ?? "Ethereum",
    amount: econ.depositUsd,
    gas: econ.step2GasUsd,
    holdDays: econ.holdDays,
    perFarmer: econ.perFarmer,
    cost: econ.farmCost,
    farmers: econ.farmers,
    breakEven: econ.breakEven,
    netPerHour: econ.netPerHour,
    verdict: econ.verdict,
  };
  return [
    `Open a fresh wallet that holds only the money you plan to farm, and keep its recovery phrase offline, never in a screenshot or a chat. Cost: under $3 of gas for the first transaction. Time: 5 minutes.`,
    stepTwo(tpl, ctx),
    stepThree(tpl, ctx),
    `Do one qualifying action every week — a deposit, a borrow, a swap or a vote — so the wallet looks active rather than parked. Cost: about $2 of gas a week. Time: 10 minutes a week.`,
    `Keep the position open for at least ${ctx.holdDays} days so the activity lands in more than one snapshot. Cost: the $${ctx.amount} stays in the position. Time: ${ctx.holdDays} days.`,
    stepSix(tpl, ctx),
    `Before you withdraw, open the protocol's own points or rewards page from the link it publishes itself, and claim only there — never through a link from a DM or a search ad. Cost: no fee to check, and never pay to claim. Time: 10 minutes.`,
    stepEight(ctx),
  ];
}

// ---------------------------------------------------------------------------
// Full fit report + board assembly
// ---------------------------------------------------------------------------

export interface FitReport {
  selected_terms: string[];
  ablation: Record<string, { n_test: number; median_factor: number; r_squared: number }>;
  ridge_lambda: number;
  ridge_lambda_grid: Record<string, { n_test: number; median_factor: number; r_squared: number }>;
  repeated_cv_assignments: number;
  walk_forward: WindowResult[];
  walk_forward_pooled: { n_test: number; median_factor: number; r_squared: number };
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
  category_holdout: { n_test: number; median_factor: number; r_squared: number };
  time_split_r_squared: number;
  time_split_median_factor: number;
  time_split_n_test: number;
  slope_bootstrap_p5: number;
  slope_bootstrap_p95: number;
  fixed_ratio_loo_factor: number;
  category_adjustments: Record<string, number>;
}

export interface BoardRow {
  rank: number;
  rank_p10: number;
  rank_p50: number;
  rank_p90: number;
  break_even_implied_usd: number;
  net_per_hour_usd: number;
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
  verdict: "FARM" | "THIN" | "SKIP";
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

export interface RadarResult {
  radar: Record<string, unknown>;
  board: { rows: Record<string, unknown>[] };
  fit: FitReport;
  selection: SelectionEvidence;
}

export const MODEL_CONSTANTS = {
  growth_floor: GROWTH_FLOOR,
  growth_cap: GROWTH_CAP,
  unknown_age_days: UNKNOWN_AGE_DAYS,
  category_shrink_k: CATEGORY_SHRINK_K,
  category_cap_log10: CATEGORY_CAP,
  category_min_comps: CATEGORY_MIN_COMPS,
  time_split_cut: TIME_SPLIT_CUT,
  bootstrap_draws: BOOTSTRAP_DRAWS,
  ridge_lambda_candidates: LAMBDA_GRID,
  repeated_cv_seeds: REPEATED_CV_SEEDS,
  farmer_share_low: FARMER_SHARE_LOW,
  farmer_position_usd: FARMER_POSITION_USD,
  farm_verdict_farm: VERDICT_FARM,
  farm_verdict_thin: VERDICT_THIN,
};

/** Build the whole radar: fit, validation, board, audit and live set. */
export function buildRadar(snap: Snapshot): RadarResult {
  const asOf = snap.as_of;
  const comps = buildFamilies(snap);
  const allIdx = comps.map((_, i) => i);
  const y = comps.map((p) => logMcap(p));
  const spec = FULL_SPEC;

  // Full fit + in-sample R^2 (unrounded fit, rounded adjustments).
  const fullFit = fitStdRidge(allIdx, spec, comps, asOf);
  const inSample = metricsTs(y, predictStd(fullFit, allIdx, comps));

  // Repeated CV (11 assignments), slug fold, p80, lambda grid, ablation.
  const rep = repeatedCv(spec, comps, asOf);
  const slugFold = cvMetrics(spec, foldAssignments(comps)[0], comps, asOf);
  const slugPred = cvPredictions(spec, foldAssignments(comps)[0], comps, asOf);
  const slugErr = y.map((yt, i) => Math.abs(yt - slugPred[i]));
  const p80 = round4(Math.pow(10, quantileTs(slugErr, 0.8)));

  const grid: FitReport["ridge_lambda_grid"] = {};
  for (const lam of LAMBDA_GRID) {
    const m = repeatedCv({ terms: ["g", "la"], cat: true, lam }, comps, asOf).mean;
    grid[String(lam)] = {
      n_test: comps.length,
      median_factor: round4(m.medianFactor),
      r_squared: round4(m.rSquared),
    };
  }
  const ablation: FitReport["ablation"] = {};
  const ablationSpecs: [string, ModelSpec][] = [
    ["Full", { terms: ["g", "la"], cat: true, lam: RIDGE_LAMBDA }],
    ["Without growth", { terms: ["la"], cat: true, lam: RIDGE_LAMBDA }],
    ["Without age", { terms: ["g"], cat: true, lam: RIDGE_LAMBDA }],
    ["Without category", { terms: ["g", "la"], lam: RIDGE_LAMBDA }],
    ["TVL only", { terms: [], lam: RIDGE_LAMBDA }],
  ];
  for (const [name, s] of ablationSpecs) {
    const m = repeatedCv(s, comps, asOf).mean;
    ablation[name] = {
      n_test: comps.length,
      median_factor: round4(m.medianFactor),
      r_squared: round4(m.rSquared),
    };
  }

  const wf = walkForward(spec, comps, asOf);
  const ts = timeSplit(spec, comps, asOf);
  const loo = leaveOneOut(spec, comps, asOf);
  const loco = leaveOneCategoryOut(spec, comps, asOf);
  const selection = selectionEvidence(comps, asOf);

  // Board candidates + bootstrap rank ranges.
  const candidates = boardCandidates(snap);
  const boot = bootstrapRanks(spec, comps, candidates, asOf);

  const fit: FitReport = {
    selected_terms: ["growth", "age", "category"],
    ablation,
    ridge_lambda: RIDGE_LAMBDA,
    ridge_lambda_grid: grid,
    repeated_cv_assignments: 1 + REPEATED_CV_SEEDS.length,
    walk_forward: wf.windows.map((w) => ({
      n_train: w.nTrain,
      validation: {
        n_test: w.validation.nTest,
        median_factor: round4(w.validation.medianFactor),
        r_squared: round4(w.validation.rSquared),
      },
    })),
    walk_forward_pooled: {
      n_test: wf.pooled.nTest,
      median_factor: round4(wf.pooled.medianFactor),
      r_squared: round4(wf.pooled.rSquared),
    },
    comps_n: comps.length,
    comps_excluded_zero_mcap:
      snap.protocols.filter((p) => p.gecko_id !== null).length - comps.length,
    coefficients: fullFit.raw.map((c) => round4(c)),
    r_squared: round4(inSample.rSquared),
    oos_r_squared: round4(rep.mean.rSquared),
    oos_median_factor: round4(rep.mean.medianFactor),
    oos_median_factor_slug_fold: round4(slugFold.medianFactor),
    oos_r_squared_slug_fold: round4(slugFold.rSquared),
    oos_p80_factor: p80,
    loo_median_factor: round4(loo.medianFactor),
    loo_r_squared: round4(loo.rSquared),
    category_holdout: {
      n_test: comps.length,
      median_factor: round4(loco.medianFactor),
      r_squared: round4(loco.rSquared),
    },
    time_split_r_squared: round4(ts.rSquared),
    time_split_median_factor: round4(ts.medianFactor),
    time_split_n_test: ts.nTest,
    slope_bootstrap_p5: boot.slopeP5,
    slope_bootstrap_p95: boot.slopeP95,
    fixed_ratio_loo_factor: round4(fixedRatioLoo(comps)),
    category_adjustments: fullFit.adj,
  };

  // Board rows, ranked by the rounded-coefficient implied value.
  const band = fit.oos_median_factor;
  const scored = candidates.map((p) => {
    const row = featureVec(p, asOf, spec);
    const coef = fit.coefficients;
    let logVal = 0;
    for (let j = 0; j < row.length; j++) logVal += coef[j] * row[j];
    logVal += fullFit.adj[p.category ?? "null"] ?? 0;
    const implied = Math.max(1, Math.round(Math.pow(10, logVal)));
    const age = ageDays(asOf, p.listed_at);
    const ageUsed = age === null ? UNKNOWN_AGE_DAYS : age;
    const growthClipped = clippedGrowth(p) * 100;
    const tpl = templateFor(p.category);
    const econ = farmEconomics(
      { tvl_usd: p.tvl_usd, age_days_used: ageUsed, implied_value_usd: implied },
      band,
      depositFor(tpl, p.tvl_usd),
    );
    return { p, implied, age, ageUsed, growthClipped, econ };
  });
  scored.sort((a, b) => {
    if (a.implied !== b.implied) return b.implied - a.implied;
    return a.p.slug < b.p.slug ? -1 : 1;
  });
  const boardRows: BoardRow[] = scored.map((s, i) => {
    const r = boot.ranks[s.p.slug];
    return {
      rank: i + 1,
      rank_p10: r.p10,
      rank_p50: r.p50,
      rank_p90: r.p90,
      break_even_implied_usd: s.econ.breakEven,
      net_per_hour_usd: s.econ.netPerHour,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      listed_at: s.p.listed_at,
      age_days: s.age,
      implied_value_usd: s.implied,
      implied_low_usd: Math.round(s.implied / band),
      implied_high_usd: Math.round(s.implied * band),
      verdict: s.econ.verdict,
      farm_cost_usd: s.econ.farmCost,
      farm_value_low_usd: s.econ.farmValueLow,
      farmers_estimate: s.econ.farmers,
      farm_value_per_farmer_usd: s.econ.perFarmer,
      curve_value_usd: s.implied,
      category_adjustment_log10: fullFit.adj[s.p.category ?? "null"] ?? 0,
      growth_pct_clipped: s.growthClipped,
      age_days_used: s.ageUsed,
      comparables: comparablesFor(s.p, comps),
      farm_steps: farmSteps(s.p, s.econ),
    };
  });

  // Audit + live set: every one of the 758 protocols accounted for.
  const boardSlugs = new Set(boardRows.map((r) => r.slug));
  const live = liveSet(snap);
  const liveSlugs = new Set(live.map((r) => r.slug));
  const excluded = auditExcluded(snap, boardSlugs, liveSlugs);
  const verdictCounts: Record<string, number> = { FARM: 0, THIN: 0, SKIP: 0 };
  for (const r of boardRows) verdictCounts[r.verdict] += 1;

  const radar = {
    as_of: snap.as_of,
    source: snap.source,
    floor_usd: snap.floor_usd,
    protocol_total: snap.protocols.length,
    board_size: boardRows.length,
    early_size: boardRows.length - snap.watchlist.length,
    watchlist_size: snap.watchlist.length,
    watchlist_slugs: [...snap.watchlist],
    pre_token_total: snap.protocols.filter((p) => isPreToken(p)).length,
    live_size: live.length,
    live,
    excluded_total: excluded.length,
    excluded,
    model: MODEL_CONSTANTS,
    model_version: "radar-5",
    fit,
    verdict_counts: verdictCounts,
    rows: boardRows,
  };

  // board.json rows: same rows, with the token record and the model block.
  const board = {
    rows: boardRows.map((r) => {
      const proto = candidates.find((p) => p.slug === r.slug) as Proto;
      const {
        curve_value_usd,
        category_adjustment_log10,
        growth_pct_clipped,
        age_days_used,
        ...rest
      } = r;
      return {
        ...rest,
        gecko_id: proto.gecko_id,
        symbol: proto.symbol,
        mcap_usd: proto.mcap_usd,
        token_status: "pre-token",
        model: {
          curve_value_usd,
          category_adjustment_log10,
          growth_pct_clipped,
          age_days_used,
        },
      };
    }),
  };

  return { radar, board, fit, selection };
}
