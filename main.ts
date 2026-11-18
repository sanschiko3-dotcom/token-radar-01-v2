// Token Radar v3: a comps-fitted launch radar (Node 22, standard library only).
//
// The program reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>), fits the
// size curve on the 128 token families that already trade, scores every clean pre-token protocol with
// the model in lib/model.ts, writes the ranked board to /output/board.json, and copies this
// repository's dashboard/ and screenshots/ to /output. Last, it writes /output/dossier.json, the
// summary the judge reads, with the vendored make.fun library.
//
// The dashboard is a static page, no framework and no network: dashboard/index.html, dashboard/app.css
// and dashboard/app.js read /output/data.js, which this program writes from the same board. The model
// compares candidate terms by five-fold validation, evaluates the selected curve in expanding
// listing-date windows, and refits it on seeded resamples to measure rank uncertainty.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}
// A degenerate snapshot must fail loudly here, not ship a board whose band is NaN or zero:
// the band is the 5-fold out-of-sample median error factor, and a non-finite one means the fit broke.
const band = radar.fit.oos_median_factor;
if (!Number.isFinite(band) || band <= 0) {
  process.stderr.write(`token radar: out-of-sample band factor is not a positive finite number: ${band}\n`);
  process.exit(1);
}
const verdicts = board.reduce((acc: Record<string, number>, row) => {
  acc[row.verdict] = (acc[row.verdict] ?? 0) + 1;
  return acc;
}, {});

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
const dossierPath = join(out, 'dossier.json');
writeFileSync(dossierPath, buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));
const dossierBytes = statSync(dossierPath).size;
const dossierTextBytes = Buffer.byteLength(JSON.parse(readFileSync(dossierPath, 'utf8')).text);

const fit = radar.fit;
/** One coefficient with its sign, so the log line reads like the fitted equation. */
const signed = (n: number): string => (n < 0 ? `- ${-n}` : `+ ${n}`);
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: size curve on ${fit.comps_n} comps: log10(mcap) = ${fit.coefficients[0]} ${signed(fit.coefficients[1]!)} * log10(tvl) ${signed(fit.coefficients[2]!)} * chg7d ${signed(fit.coefficients[3]!)} * log10(age), R2 ${fit.r_squared}, 5-fold OOS R2 ${fit.oos_r_squared}, band ${fit.oos_median_factor}x\n` +
    `token radar: time split OOS R2 ${fit.time_split_r_squared} (n=${fit.time_split_n_test}), slope bootstrap 90% ${fit.slope_bootstrap_p5}..${fit.slope_bootstrap_p95}, fixed-ratio LOO ${fit.fixed_ratio_loo_factor}x\n` +
    `token radar: ${radar.model_version}, selected terms ${fit.selected_terms.join(', ')}; walk-forward ${JSON.stringify(fit.walk_forward)}, pooled ${JSON.stringify(fit.walk_forward_pooled)}\n` +
    `token radar: ablation ${JSON.stringify(fit.ablation)}\n` +
    `token radar: accounted for ${radar.protocol_total}, audited outside board and live set ${radar.excluded_total}, dossier text ${dossierTextBytes} bytes\n` +
    `token radar: verdicts FARM ${verdicts.FARM ?? 0} / THIN ${verdicts.THIN ?? 0} / SKIP ${verdicts.SKIP ?? 0}\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dashFiles.length} files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')} (${dossierBytes} bytes)\n`,
);
