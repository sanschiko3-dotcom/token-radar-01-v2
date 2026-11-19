// Token Radar — radar-5 entrypoint.
//
// Reads the sealed snapshot, builds the radar-5 board (standardized ridge,
// lambda 40, repeated-CV band, 1-SE selection, LOO + LOCO), and writes:
//   <out>/board.json     the ranked board (198 rows)
//   <out>/data.js        the dashboard's data (window.RADAR)
//   <out>/dashboard/     a copy of dashboard/
//   <out>/screenshots/   a copy of screenshots/
//   <out>/dossier.json   buildDossier output over dashboard + screenshots
//
// Run: MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
// The program is deterministic: two runs write byte-identical outputs.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRadar } from "./lib/model.ts";
import { buildDossier } from "./vendor/makefun-board.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

function argValue(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1];
  return fallback;
}

function log(...parts: unknown[]): void {
  console.log("token radar:", ...parts);
}

function copyDir(src: string, dst: string): string[] {
  mkdirSync(dst, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(src).sort()) {
    const from = join(src, name);
    const to = join(dst, name);
    copyFileSync(from, to);
    names.push(name);
  }
  return names;
}

function main(): void {
  // The grader runs `node /bot/main.ts` with the sealed snapshot mounted at
  // /input (MAKEFUN_INPUT_DIR=/input) and no --input flag; --input takes a
  // file or a directory, as in v2. Never default to a path inside the repo:
  // the grader mounts the repo read-only and it holds no input/ directory.
  const inputArg = argValue("--input", process.env.MAKEFUN_INPUT_DIR ?? "/input");
  const inputPath = inputArg.endsWith(".json") ? inputArg : join(inputArg, "snapshot.json");
  if (!existsSync(inputPath)) {
    process.stderr.write(`token radar: no snapshot at ${inputPath}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
    process.exit(2);
  }
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? join(HERE, "out");
  const snap = JSON.parse(readFileSync(inputPath, "utf8"));
  const { radar, board, fit, selection } = buildRadar(snap);

  // Clear the output directory's contents without removing the directory
  // itself: the grader mounts /output for user 65534, who cannot rmdir a
  // mount point it does not own (rmSync on the directory is EPERM).
  mkdirSync(outDir, { recursive: true });
  for (const name of readdirSync(outDir)) {
    rmSync(join(outDir, name), { recursive: true, force: true });
  }

  writeFileSync(join(outDir, "board.json"), JSON.stringify(board, null, 2) + "\n");
  writeFileSync(join(outDir, "data.js"), "window.RADAR=" + JSON.stringify(radar) + ";\n");
  const dashFiles = copyDir(join(HERE, "dashboard"), join(outDir, "dashboard"));
  const shotFiles = copyDir(join(HERE, "screenshots"), join(outDir, "screenshots"));

  const dossierBytes = buildDossier(outDir, { text_max_bytes: 65536 });
  writeFileSync(join(outDir, "dossier.json"), dossierBytes);
  const dossier = JSON.parse(Buffer.from(dossierBytes).toString("utf8"));
  const textBytes = Buffer.byteLength(dossier.text ?? "", "utf8");

  const coef = fit.coefficients;
  const signed = (c: number, label: string) => `${c < 0 ? "-" : "+"} ${Math.abs(c)} * ${label}`;
  const eq = `log10(mcap) = ${coef[0]} + ${coef[1]} * log10(tvl) ${signed(coef[2], "chg7d")} ${signed(coef[3], "log10(age)")}`;
  const counts = radar.verdict_counts as Record<string, number>;
  const live = radar.live as unknown[];
  log(
    `${(radar as { protocol_total: number }).protocol_total} protocols, ` +
      `${(radar as { watchlist_size: number }).watchlist_size} on the watchlist, ` +
      `${(radar as { board_size: number }).board_size} rows scored ` +
      `(${(radar as { early_size: number }).early_size} early, ${live.length} live set aside)`,
  );
  log(
    `ridge lambda ${fit.ridge_lambda} size curve on ${fit.comps_n} comps: ${eq}, ` +
      `R2 ${fit.r_squared} (with category adjustments)`,
  );
  log(
    `repeated 5-fold (${fit.repeated_cv_assignments} assignments) OOS R2 ${fit.oos_r_squared}, ` +
      `band ${fit.oos_median_factor}x; slug-fold only ${fit.oos_median_factor_slug_fold}x ` +
      `(R2 ${fit.oos_r_squared_slug_fold})`,
  );
  log(
    `leave-one-out ${fit.loo_median_factor}x (R2 ${fit.loo_r_squared}); ` +
      `leave-one-category-out ${fit.category_holdout.median_factor}x ` +
      `(R2 ${fit.category_holdout.r_squared}); time split OOS R2 ${fit.time_split_r_squared} ` +
      `(n=${fit.time_split_n_test}), slope bootstrap 90% ${fit.slope_bootstrap_p5}..${fit.slope_bootstrap_p95}, ` +
      `fixed-ratio LOO ${fit.fixed_ratio_loo_factor}x`,
  );
  log(
    `radar-5, selected terms ${fit.selected_terms.join(", ")}; ` +
      `walk-forward ${JSON.stringify(fit.walk_forward)}, ` +
      `pooled ${JSON.stringify(fit.walk_forward_pooled)}`,
  );
  log(`ablation ${JSON.stringify(fit.ablation)}`);
  log(`ridge lambda grid ${JSON.stringify(fit.ridge_lambda_grid)}`);
  log(
    `1-SE: lambda 30 trails best by ${selection.lambda30Diff.toFixed(4)} ` +
      `vs paired SE ${selection.lambda30Se.toFixed(4)}; ` +
      `dropping age improves the repeated mean by ${selection.dropAgeDiff.toFixed(4)} ` +
      `vs SE ${selection.dropAgeSe.toFixed(4)}`,
  );
  log(
    `accounted for ${(radar as { protocol_total: number }).protocol_total}, ` +
      `audited outside board and live set ${(radar as { excluded_total: number }).excluded_total}, ` +
      `dossier text ${textBytes} bytes`,
  );
  log(`verdicts FARM ${counts.FARM} / THIN ${counts.THIN} / SKIP ${counts.SKIP}`);
  log(
    `wrote ${join(outDir, "board.json")}, ${join(outDir, "data.js")}, ` +
      `${join(outDir, "dashboard")} (${dashFiles.length} files), ` +
      `${join(outDir, "screenshots")} (${shotFiles.length} images) and ` +
      `${join(outDir, "dossier.json")} (${dossierBytes.length} bytes)`,
  );
}

main();
