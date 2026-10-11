#!/usr/bin/env node
/**
 * Precompresses the production build so the server never compresses on the fly:
 * writes `file.br` (Brotli, quality 11) and `file.gz` (gzip, level 9) next to
 * every .js/.mjs/.css/.html/.svg/.json/.wasm file larger than 1 KB - but only
 * when the compressed copy is actually smaller.
 *
 *   node tools/precompress.mjs           # dist/ in the project root
 *   node tools/precompress.mjs some/dir  # any other build directory
 *
 * Runs automatically as part of `npm run build`.
 */
import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import zlib from "node:zlib";

const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);

const EXTENSIONS = new Set([".js", ".mjs", ".css", ".html", ".svg", ".json", ".wasm"]);
const MIN_BYTES = 1024;
const CONCURRENCY = 4; // zlib work runs on libuv's thread pool (4 threads by default)

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.resolve(process.argv[2] ?? path.join(projectRoot, "dist"));

/** Recursively yields every regular file below `d`. */
async function* walk(d) {
  for (const entry of await readdir(d, { withFileTypes: true })) {
    const p = path.join(d, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (entry.isFile()) yield p;
  }
}

/** Writes `data` to `target` if it beats `original`; otherwise removes a stale copy. */
async function keepIfSmaller(target, data, original) {
  if (data.length < original) {
    await writeFile(target, data);
    return data.length;
  }
  await rm(target, { force: true });
  return original;
}

async function compressFile(file) {
  const source = await readFile(file);
  const isText = path.extname(file).toLowerCase() !== ".wasm";
  const [br, gz] = await Promise.all([
    brotli(source, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY,
        [zlib.constants.BROTLI_PARAM_MODE]: isText ? zlib.constants.BROTLI_MODE_TEXT : zlib.constants.BROTLI_MODE_GENERIC,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: source.length,
      },
    }),
    gzip(source, { level: zlib.constants.Z_BEST_COMPRESSION }),
  ]);
  return {
    original: source.length,
    br: await keepIfSmaller(`${file}.br`, br, source.length),
    gz: await keepIfSmaller(`${file}.gz`, gz, source.length),
  };
}

async function main() {
  if (!existsSync(dir)) {
    console.error(`precompress: ${dir} does not exist - run "vite build" first.`);
    process.exit(1);
  }

  const files = [];
  for await (const file of walk(dir)) {
    if (!EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
    files.push(file);
  }

  const totals = { files: 0, original: 0, br: 0, gz: 0 };
  const queue = [...files];
  const worker = async () => {
    for (let file = queue.shift(); file; file = queue.shift()) {
      if ((await stat(file)).size <= MIN_BYTES) {
        // Too small to be worth it; drop leftovers from an earlier run.
        await Promise.all([rm(`${file}.br`, { force: true }), rm(`${file}.gz`, { force: true })]);
        continue;
      }
      const r = await compressFile(file);
      totals.files += 1;
      totals.original += r.original;
      totals.br += r.br;
      totals.gz += r.gz;
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
  const shown = path.relative(process.cwd(), dir);
  console.log(
    `precompress: ${totals.files} file(s) in ${shown && !shown.startsWith("..") ? shown : dir}: ` +
      `${kb(totals.original)} -> ${kb(totals.br)} brotli / ${kb(totals.gz)} gzip`
  );
}

main().catch((err) => {
  console.error("precompress failed:", err);
  process.exit(1);
});
