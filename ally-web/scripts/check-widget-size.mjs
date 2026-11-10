#!/usr/bin/env node
/**
 * The website widget loader's size budget (Agents v2 chunk 13): `widget.js`, which every page of an
 * owner's site loads, must stay under 10 KB gzipped. Run after `npm run build:widget` (CI does):
 *
 *   node scripts/check-widget-size.mjs [path/to/dist/apps/ally-admin-dashboard]
 *
 * Exits non-zero when it is over.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const BUDGET = 10 * 1024;

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(process.argv[2] ?? join(here, "../dist/apps/ally-admin-dashboard"));
const file = join(dist, "widget.js");
if (!existsSync(file)) {
  console.error(`No widget build at ${file}. Run \`npm run build:widget\` first.`);
  process.exit(2);
}
const raw = readFileSync(file);
const gz = gzipSync(raw).length;
const kb = n => `${(n / 1024).toFixed(1)} KB`;
console.log(`widget.js: ${kb(gz)} gzipped (${kb(raw.length)} raw), the most is ${kb(BUDGET)}.`);
if (gz > BUDGET) {
  console.error(`Over budget: widget.js is ${kb(gz)} gzipped, the most is ${kb(BUDGET)}.`);
  process.exit(1);
}
