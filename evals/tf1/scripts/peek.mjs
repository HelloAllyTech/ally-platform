// Open a URL in headless Chromium, save a screenshot and print the visible text and controls.
//   node evals/tf1/scripts/peek.mjs <url> <shot-name> [--state <storage.json>]
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(resolve(here, '../../../ally-web/package.json'))('playwright');
const [url, shot] = process.argv.slice(2);
const si = process.argv.indexOf('--state');
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...(si > 0 ? { storageState: process.argv[si + 1] } : {}) });
const page = await ctx.newPage();
await page.goto(url, { waitUntil: 'networkidle' }).catch(() => {});
await page.waitForTimeout(1500);
await page.screenshot({ path: resolve(here, '../screenshots', `${shot}.png`), fullPage: true });
console.log('URL', page.url());
console.log((await page.innerText('body')).slice(0, 3000));
console.log('--- controls');
for (const el of await page.locator('button, input, textarea, a[href], [role=button], [role=tab]').all()) {
  const d = await el.evaluate((n) => `${n.tagName.toLowerCase()} ${n.getAttribute('type') ?? ''} name=${n.getAttribute('name') ?? ''} ph=${n.getAttribute('placeholder') ?? ''} aria=${n.getAttribute('aria-label') ?? ''} txt=${(n.innerText || n.value || '').trim().slice(0, 50)} href=${n.getAttribute('href') ?? ''}`);
  console.log(d);
}
await browser.close();
