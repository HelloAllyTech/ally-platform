#!/usr/bin/env node
/**
 * The public bot page's size budget (Agents v2 chunk 20d): what a visitor downloads to open
 * /b/<slug>, gzipped, fonts excluded, must stay within 70 KB of JavaScript and 25 KB of CSS.
 *
 * Reads the built `b.html` from the admin dashboard's build and follows its scripts, module
 * preloads and stylesheets (and the CSS chunks Vite lists for them), so it measures exactly what
 * the page loads. Run after `npm run build:admin`:
 *
 *   node scripts/check-bot-page-size.mjs [path/to/dist/apps/ally-admin-dashboard]
 *
 * Exits non-zero, naming each file, when a budget is exceeded.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const BUDGET = { js: 70 * 1024, css: 25 * 1024 };

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(process.argv[2] ?? join(here, "../dist/apps/ally-admin-dashboard"));
const page = join(dist, "b.html");
if (!existsSync(page)) {
  console.error(`No bot page build at ${page}. Run \`npm run build:admin\` first.`);
  process.exit(2);
}

const html = readFileSync(page, "utf8");
const assets = new Set();
for (const match of html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"[^>]*>/g)) {
  const tag = match[0];
  const url = match[1];
  if (/^https?:/.test(url) || /\.woff2?($|\?)/.test(url)) continue;
  if (tag.startsWith("<link") && !/rel="(stylesheet|modulepreload)"/.test(tag)) continue;
  assets.add(url.replace(/^\//, "").split("?")[0]);
}

// Static imports inside the entry pull in shared chunks that are not always preloaded.
const queue = [...assets].filter(a => a.endsWith(".js"));
while (queue.length) {
  const file = join(dist, queue.shift());
  if (!existsSync(file)) continue;
  const code = readFileSync(file, "utf8");
  for (const match of code.matchAll(/(?:import|from)\s*["']\.\/([^"']+\.(?:js|css))["']/g)) {
    const rel = join(dirname(file).slice(dist.length + 1), match[1]);
    if (!assets.has(rel)) {
      assets.add(rel);
      if (rel.endsWith(".js")) queue.push(rel);
    }
  }
}

const totals = { js: 0, css: 0 };
const rows = [];
for (const asset of [...assets].sort()) {
  const kind = asset.endsWith(".css") ? "css" : asset.endsWith(".js") ? "js" : null;
  const file = join(dist, asset);
  if (!kind || !existsSync(file)) continue;
  const gz = gzipSync(readFileSync(file)).length;
  totals[kind] += gz;
  rows.push(`  ${kind.padEnd(3)} ${(gz / 1024).toFixed(1).padStart(6)} KB  ${asset}`);
}

const kb = n => `${(n / 1024).toFixed(1)} KB`;
console.log(`Bot page (gzipped, fonts excluded):\n${rows.join("\n")}`);
console.log(`  JS  ${kb(totals.js)} of ${kb(BUDGET.js)}`);
console.log(`  CSS ${kb(totals.css)} of ${kb(BUDGET.css)}`);

const over = Object.entries(BUDGET).filter(([kind, max]) => totals[kind] > max);
if (over.length) {
  for (const [kind] of over) {
    console.error(
      `Over budget: ${kind.toUpperCase()} is ${kb(totals[kind])}, the most is ${kb(BUDGET[kind])}.`,
    );
  }
  process.exit(1);
}
