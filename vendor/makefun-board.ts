// Build a makefun/dossier/v1 document from dashboard/ and screenshots/.
// The first screenshot in code-unit order is the cover. The Dashboard lists
// the whole tree, and Source shows recognized text files in path order.
// The text budget may shorten Source at a complete line. All other limits
// reject the dossier. Serialize the result as compact, key-sorted JSON.

import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readSync } from 'node:fs';
import { join } from 'node:path';

/** The dossier schema buildDossier writes (contracts/dossier.ts DOSSIER_SCHEMA). */
export const DOSSIER_SCHEMA = 'makefun/dossier/v1';
/** The most bytes a dossier holds (contracts/dossier.ts DOSSIER_MAX_BYTES): 4 MiB. */
export const DOSSIER_MAX_BYTES = 4 * 1024 * 1024;
/** The most images a dossier holds (contracts/dossier.ts DOSSIER_MAX_IMAGES). */
export const DOSSIER_MAX_IMAGES = 8;
/** A plain file's name (contracts/dossier.ts DossierImageName): a letter, digit or _ first, then letters, digits and . _ -, 1 to 128 of them, no directory. */
export const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
/** A dashboard file whose contents the dossier's text shows: source, never an image. */
export const TEXT_FILE = /\.(?:html|css|js|json|mjs|svg|md|txt)$/;

/** What buildDossier is held to: the text's cap in UTF-8 bytes, and, when given, the screenshot and dashboard caps, which only refuse. */
export interface DossierCaps {
  text_max_bytes: number;
  screenshots?: { max: number; max_bytes: number };
  dashboard?: { max_files: number; max_bytes: number };
}

/** Why buildDossier writes no dossier for a directory: its caps, its screenshots, its dashboard or its size. */
export class DossierError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DossierError';
  }
}

const byteLength = (text: string): number => Buffer.byteLength(text, 'utf8');
const byCodeUnit = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const jpegSignature = [0xff, 0xd8, 0xff];

function imageType(bytes: Uint8Array): string | null {
  for (const [signature, type] of [[pngSignature, 'image/png'], [jpegSignature, 'image/jpeg']] as const) {
    if (signature.every((byte, index) => bytes[index] === byte)) return type;
  }
  return null;
}

/**
 * A regular file's bytes when it is at most `cap` long; never through a link, never more than `cap`
 * bytes read. A link, a directory or a missing file is a DossierError with `what`.
 */
function readCapped(path: string, cap: number, what: string): Uint8Array {
  let size: number;
  try {
    const st = lstatSync(path);
    if (!st.isFile()) throw new DossierError(`buildDossier: ${what} is not a regular file`);
    size = st.size;
  } catch (err) {
    if (err instanceof DossierError) throw err;
    throw new DossierError(`buildDossier: ${what} cannot be read`);
  }
  if (size > cap) throw new DossierError(`buildDossier: ${what} is ${size} bytes, over the ${cap} a dossier reads`);
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw new DossierError(`buildDossier: ${what} is not a regular file`);
  }
  try {
    const now = fstatSync(fd).size;
    if (now > cap) throw new DossierError(`buildDossier: ${what} is ${now} bytes, over the ${cap} a dossier reads`);
    const buf = Buffer.alloc(now);
    let at = 0;
    while (at < buf.length) {
      const n = readSync(fd, buf, at, buf.length - at, at);
      if (n === 0) break;
      at += n;
    }
    return new Uint8Array(buf.buffer, buf.byteOffset, at);
  } finally {
    closeSync(fd);
  }
}

function lineCount(bytes: Uint8Array): number {
  let count = bytes.length > 0 && bytes[bytes.length - 1] !== 10 ? 1 : 0;
  for (const byte of bytes) {
    if (byte === 10) count++;
  }
  return count;
}

function fenceFor(body: string): string {
  let width = 3;
  for (const match of body.matchAll(/\x60+/g)) width = Math.max(width, match[0].length + 1);
  return '\x60'.repeat(width);
}

function languageOf(path: string): string {
  const extension = path.slice(path.lastIndexOf('.') + 1);
  return extension === 'mjs' ? 'js' : extension;
}

/**
 * JSON with every object's keys in code-unit order and no whitespace: one spelling per value. Takes
 * null, booleans, finite numbers, strings, arrays and plain objects; throws TypeError on anything else
 * (undefined, a function, a bigint, NaN, Infinity, a class instance).
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError(`canonicalJson: ${value} is not a finite number`);
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return '[' + value.map((item) => canonicalJson(item)).join(',') + ']';
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== null && prototype !== Object.prototype) {
        throw new TypeError('canonicalJson: only plain objects and arrays');
      }
      const record = value as Record<string, unknown>;
      const fields = Object.keys(record).sort().map((key) =>
        JSON.stringify(key) + ':' + canonicalJson(record[key]));
      return '{' + fields.join(',') + '}';
    }
    default:
      throw new TypeError(`canonicalJson: a ${typeof value} has no JSON form`);
  }
}

// ---------------------------------------------------------------- the dashboard walk

/** One file of the dashboard tree: its path relative to the directory, and its size in bytes. */
interface DashFile {
  path: string;
  size: number;
}

/**
 * Every regular file under `root` (symbolic links are neither followed nor taken for files), in path
 * order, with its size. Refuses a dot-directory, a file whose name a dossier refuses, an entry that is
 * neither a file nor a directory, and, when the caps are given, too many files or bytes in all.
 */
function dashboardFiles(root: string, caps: { max_files: number; max_bytes: number } | null): DashFile[] {
  let st: import('node:fs').Stats;
  try {
    st = lstatSync(root);
  } catch {
    throw new DossierError('buildDossier: no dashboard/ directory: the page and its source are what the judge reads');
  }
  if (!st.isDirectory()) throw new DossierError('buildDossier: dashboard is not a directory');
  const out: DashFile[] = [];
  let bytes = 0;
  const stack: string[] = [''];
  while (stack.length > 0) {
    const rel = stack.pop()!;
    for (const e of readdirSync(rel === '' ? root : join(root, rel), { withFileTypes: true })) {
      const p = rel === '' ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name.startsWith('.')) throw new DossierError(`buildDossier: dashboard/${p} is a dot-directory`);
        stack.push(p);
      } else if (e.isFile()) {
        if (!PLAIN_NAME.test(e.name)) throw new DossierError(`buildDossier: dashboard/${p}: a file's name is letters, digits and . _ -, 1 to 128 characters, not starting with . or -`);
        const size = lstatSync(join(root, p)).size;
        out.push({ path: p, size });
        bytes += size;
        if (caps !== null && out.length > caps.max_files) throw new DossierError(`buildDossier: dashboard/ holds more than the ${caps.max_files} files it may`);
        if (caps !== null && bytes > caps.max_bytes) throw new DossierError(`buildDossier: dashboard/'s files come to more than the ${caps.max_bytes} bytes they may`);
      } else {
        throw new DossierError(`buildDossier: dashboard/${p} is neither a file nor a directory`);
      }
    }
  }
  return out.sort((a, b) => byCodeUnit(a.path, b.path));
}

// ---------------------------------------------------------------- the dossier

/**
 * The dossier (makefun/dossier/v1, contracts/dossier.ts) of a dashboard directory, as canonical JSON
 * bytes: `dir/screenshots/`'s PNG and JPEG files (names starting with '.' skipped) are its images, the
 * first the cover; its text is the "## Dashboard" block and the "## Source" sections described above,
 * capped at `caps.text_max_bytes` UTF-8 bytes with the cut rule above. Throws DossierError on caps it
 * cannot keep and on a dashboard or screenshots directory it refuses (see the header).
 */
export function buildDossier(dir: string, caps: DossierCaps): Uint8Array {
  const max = caps.text_max_bytes;
  if (!Number.isSafeInteger(max) || max <= 0) throw new DossierError(`buildDossier: caps.text_max_bytes must be a positive integer, not ${String(max)}`);

  let maxImages = { n: DOSSIER_MAX_IMAGES, whose: 'a dossier holds' };
  let maxImageBytes = { n: DOSSIER_MAX_BYTES, whose: 'a dossier holds' };
  if (caps.screenshots !== undefined) {
    const s = caps.screenshots as { max?: unknown; max_bytes?: unknown } | null;
    if (typeof s !== 'object' || s === null) throw new DossierError('buildDossier: caps.screenshots must be an object {max, max_bytes}');
    for (const k of ['max', 'max_bytes'] as const) {
      const v = s[k];
      if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0) throw new DossierError(`buildDossier: caps.screenshots.${k} must be a positive integer, not ${String(v)}`);
    }
    if ((s.max as number) < maxImages.n) maxImages = { n: s.max as number, whose: 'caps.screenshots.max allows' };
    if ((s.max_bytes as number) < maxImageBytes.n) maxImageBytes = { n: s.max_bytes as number, whose: 'caps.screenshots.max_bytes allows' };
  }
  let fileCaps: { max_files: number; max_bytes: number } | null = null;
  if (caps.dashboard !== undefined) {
    const d = caps.dashboard as { max_files?: unknown; max_bytes?: unknown } | null;
    if (typeof d !== 'object' || d === null) throw new DossierError('buildDossier: caps.dashboard must be an object {max_files, max_bytes}');
    for (const k of ['max_files', 'max_bytes'] as const) {
      const v = d[k];
      if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0) throw new DossierError(`buildDossier: caps.dashboard.${k} must be a positive integer, not ${String(v)}`);
    }
    fileCaps = { max_files: d.max_files as number, max_bytes: d.max_bytes as number };
  }

  const files = dashboardFiles(join(dir, 'dashboard'), fileCaps);

  const images = collectScreenshots(dir, maxImages, maxImageBytes.n);
  const text = renderSource(dir, files, max);
  const doc = { schema: DOSSIER_SCHEMA, cover: 0, text, images };
  const bytes = Buffer.from(canonicalJson(doc), 'utf8');
  if (bytes.length > DOSSIER_MAX_BYTES) throw new DossierError(`buildDossier: the dossier is ${bytes.length} bytes, over the ${DOSSIER_MAX_BYTES} one holds`);
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length);
}

function collectScreenshots(dir: string, maxImages: { n: number; whose: string }, byteLimit: number) {
  const shotsDir = join(dir, 'screenshots');
  let shotNames: string[];
  try {
    shotNames = readdirSync(shotsDir, { withFileTypes: true })
      .filter((e) => e.isFile() && !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort(byCodeUnit);
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') throw new DossierError('buildDossier: no screenshots/ directory: the first screenshot is the cover');
    throw new DossierError('buildDossier: screenshots/ cannot be read');
  }
  if (shotNames.length === 0) throw new DossierError('buildDossier: screenshots/ holds no image: the first is the cover');
  if (shotNames.length > maxImages.n) throw new DossierError(`buildDossier: screenshots/ holds ${shotNames.length} files, over the ${maxImages.n} ${maxImages.whose}`);
  return shotNames.map((name) => {
    if (!PLAIN_NAME.test(name)) throw new DossierError(`buildDossier: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters, not starting with . or -`);
    const bytes = readCapped(join(shotsDir, name), byteLimit, `screenshots/${name}`);
    const media_type = imageType(bytes);
    if (media_type === null) throw new DossierError(`buildDossier: screenshots/${name} is neither a PNG nor a JPEG`);
    return { name, media_type, sha256: createHash('sha256').update(bytes).digest('hex'), base64: Buffer.from(bytes).toString('base64') };
  });
}

function renderSource(dir: string, files: DashFile[], max: number): string {
  const head = [
    '## Dashboard',
    '',
    `Files: ${files.length} (${files.reduce((n, f) => n + f.size, 0)} bytes)`,
    ...files.map((f) => `- ${f.path} (${f.size} bytes)`),
    '',
    '## Source',
    '',
    '',
  ].join('\n');

  // The files whose contents are shown, by path; a binary file is named in the Dashboard block only.
  const shown = files.filter((f) => TEXT_FILE.test(f.path));
  interface Section {
    heading: string;
    code: ShownFile | null;
    size: number;
    bytes: number;
  }
  const sections: Section[] = shown.map((f) => {
    const bytes = readCapped(join(dir, 'dashboard', f.path), DOSSIER_MAX_BYTES, `dashboard/${f.path}`);
    const lines = lineCount(bytes);
    const heading = `### ${f.path}\n\n${bytes.length} bytes, ${lines} line${lines === 1 ? '' : 's'}\n\n`;
    if (bytes.length === 0) return { heading, code: null, size: byteLength(heading), bytes: 0 };
    const text = new TextDecoder('utf-8').decode(bytes);
    const fence = fenceFor(text);
    const lang = languageOf(f.path);
    const block = `${fence}${lang}\n${text}${text.endsWith('\n') ? '' : '\n'}${fence}\n\n`;
    return { heading, code: { bytes, text, fence, lang, block, blockBytes: byteLength(block), lines }, size: byteLength(heading) + byteLength(block), bytes: bytes.length };
  });

  const cutLine = (count: number, bytes: number): string => `[Cut at ${max} bytes: ${count} file${count === 1 ? '' : 's'} and ${bytes} bytes left out.]\n`;
  let out = head;
  let used = byteLength(head);
  if (used + byteLength(cutLine(0, 0)) > max) throw new DossierError(`buildDossier: caps.text_max_bytes ${max} cannot hold even the Dashboard block and the cut line`);
  let remainingBytes = sections.reduce((sum, section) => sum + section.bytes, 0);
  let kept = 0;
  for (; kept < sections.length; kept++) {
    const section = sections[kept]!;
    const restCount = sections.length - kept - 1;
    remainingBytes -= section.bytes;
    const tail = restCount === 0 ? 0 : byteLength(cutLine(restCount, remainingBytes));
    if (used + section.size + tail > max) break;
    out += section.code === null ? section.heading : `${section.heading}${section.code.block}`;
    used += section.size;
  }
  if (kept < sections.length) {
    // The first file that does not fit whole: its head, up to its last complete line that fits, then nothing more.
    const first = sections[kept]!;
    const restCount = sections.length - kept - 1;
    const after = remainingBytes;
    const part = first.code === null ? null : fileHead(first.heading, first.code, max - used, (hidden) => cutLine(restCount, after + hidden));
    out += part ?? cutLine(restCount + 1, after + first.bytes);
  }
  if (byteLength(out) > max) throw new DossierError(`buildDossier: caps.text_max_bytes ${max} cannot hold even the Dashboard block and the cut line`);

  return out.replace(/\n+$/, '\n');
}

/** A shown file as the dossier shows it. */
interface ShownFile {
  bytes: Uint8Array;
  text: string;
  fence: string;
  /** The language the fence opens with (the file's extension, mjs as js). */
  lang: string;
  /** The fenced block: the fence and the language, the text (a last LF added when it lacks one), the fence, a blank line. */
  block: string;
  blockBytes: number;
  lines: number;
}

/**
 * A file's section cut inside its contents: its heading, its first k lines in its fence (closed), a line
 * naming how many of its lines are not shown, then `tail(hidden)` (the cut line, given the bytes this
 * file leaves out), k the most lines (at least one, fewer than all) whose whole fits in `room` UTF-8
 * bytes; null when not one line fits. It cuts only after a line's LF, which is never inside a UTF-8
 * sequence nor a replacement character's bytes, so no character is split, and a line's shown bytes are
 * those of its text.
 */
function fileHead(heading: string, code: ShownFile, room: number, tail: (hidden: number) => string): string | null {
  const total = code.lines;
  const lines = code.text.split('\n');
  const open = `${code.fence}${code.lang}\n`;
  const close = `${code.fence}\n\n`;
  const note = (k: number): string => `[${total - k} of this file's ${total} lines not shown.]\n`;
  const fixed = byteLength(heading) + byteLength(open) + byteLength(close);
  let best = 0;
  let shown = 0;
  let raw = 0;
  for (let k = 1; k < total; k++) {
    shown += byteLength(lines[k - 1]!) + 1;
    raw = code.bytes.indexOf(0x0a, raw) + 1;
    if (fixed + shown + byteLength(note(k)) + byteLength(tail(code.bytes.length - raw)) <= room) best = k;
  }
  if (best === 0) return null;
  let rawEnd = 0;
  for (let k = 0; k < best; k++) rawEnd = code.bytes.indexOf(0x0a, rawEnd) + 1;
  const head = lines.slice(0, best).map((l) => `${l}\n`).join('');
  return `${heading}${open}${head}${close}${note(best)}${tail(code.bytes.length - rawEnd)}`;
}
