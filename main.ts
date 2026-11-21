import {
  copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync,
  rmSync, writeFileSync
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRadar, type Snapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const ROOT = dirname(fileURLToPath(import.meta.url));
const TEXT_CAP = 65_536;
const SHOT_CAP = { max: 4, max_bytes: 524_288 };
function option(name: string): string | null {
  const at = process.argv.indexOf('--' + name);
  if (at >= 0 && process.argv[at + 1]) return process.argv[at + 1];
  const match = process.argv.find(a => a.startsWith('--' + name + '='));
  return match ? match.slice(name.length + 3) : null;
}
function locateInput(): string {
  const explicit = option('input');
  const candidates = explicit ? [explicit] : [process.env.MAKEFUN_INPUT_DIR, '/input'].filter(Boolean) as string[];
  for (const candidate of candidates) {
    const direct = existsSync(candidate) && lstatSync(candidate).isFile();
    const file = direct ? candidate : join(candidate, 'snapshot.json');
    if (existsSync(file) && lstatSync(file).isFile()) return file;
    if (explicit) break;
  }
  throw new Error('No snapshot found. Pass --input <file|dir>, set MAKEFUN_INPUT_DIR, or mount /input.');
}
function clearContents(dir: string): void {
  if (!existsSync(dir)) { mkdirSync(dir, { recursive: true }); return; }
  for (const name of readdirSync(dir)) {
    const child = join(dir, name), info = lstatSync(child);
    if (info.isDirectory() && !info.isSymbolicLink()) {
      clearContents(child);
      rmSync(child);
    } else rmSync(child);
  }
}
function copyFlat(source: string, target: string): string[] {
  mkdirSync(target, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(source)) {
    if (name.startsWith('.')) continue;
    const from = join(source, name);
    if (!lstatSync(from).isFile()) continue;
    copyFileSync(from, join(target, name));
    names.push(name);
  }
  return names;
}
const inputPath = locateInput();
const inputBytes = readFileSync(inputPath);
const snapshot = JSON.parse(inputBytes.toString('utf8')) as Snapshot;
const snapshotHash = createHash('sha256').update(inputBytes).digest('hex');
const { rows, summary } = buildRadar(snapshot, snapshotHash);
const outputPath = resolve(option('output') ?? process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
mkdirSync(outputPath, { recursive: true });
clearContents(outputPath);
writeFileSync(join(outputPath, 'board.json'), JSON.stringify({
  snapshot_as_of: snapshot.as_of, snapshot_sha256: snapshotHash,
  summary, rows
}) + '\n');
const browserData = { as_of: snapshot.as_of, summary, rows };
writeFileSync(join(outputPath, 'data.js'),
  'window.RADAR_DATA=' + JSON.stringify(browserData) + ';\n');
copyFlat(join(ROOT, 'dashboard'), join(outputPath, 'dashboard'));
const shotNames = copyFlat(join(ROOT, 'screenshots'), join(outputPath, 'screenshots'));
if (shotNames.length !== 3) throw new Error('screenshots/ must contain three rendered views.');
const dossier = buildDossier(outputPath, {
  text_max_bytes: TEXT_CAP, screenshots: SHOT_CAP,
  dashboard: { max_files: 400, max_bytes: 4_194_304 }
});
writeFileSync(join(outputPath, 'dossier.json'), dossier);
process.stdout.write('Token Radar radar-6: ' + rows.length + ' protocols; ' +
  summary.pre_token + ' eligible pre-token candidates; ' + summary.watchlist_covered +
  ' watchlist rows. Wrote board, dashboard, screenshots and dossier to ' + outputPath + '.\n');
