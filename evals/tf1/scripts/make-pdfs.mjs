// Prints evals/tf1/pdfs/src/*.html to evals/tf1/pdfs/*.pdf with Playwright's Chromium.
// Run: node evals/tf1/scripts/make-pdfs.mjs (uses ally-web's Playwright).
import { createRequire } from 'node:module';
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// Playwright lives in ally-web's node_modules.
const { chromium } = createRequire(resolve(here, '../../../ally-web/package.json'))('playwright');
const src = resolve(here, '../pdfs/src');
const out = resolve(here, '../pdfs');
const browser = await chromium.launch();
const page = await browser.newPage();
for (const f of readdirSync(src).filter((n) => n.endsWith('.html'))) {
  await page.goto(pathToFileURL(join(src, f)).href);
  await page.pdf({ path: join(out, f.replace(/\.html$/, '.pdf')), format: 'A4' });
  console.log('wrote', f.replace(/\.html$/, '.pdf'));
}
await browser.close();
