// TF1 step a1: the owner signs in to the admin dashboard as a person would (email, Next, code).
// Saves the browser session to evals/tf1/runs/owner-state.json for the later owner scripts.
//   node evals/tf1/scripts/owner-login.mjs [email] [otp]
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(resolve(here, '../../../ally-web/package.json'))('playwright');
const email = process.argv[2] ?? 'tf1-owner@example.com';
const otp = process.argv[3] ?? '1234';
const shots = resolve(here, '../screenshots');
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto('http://localhost:8081/login', { waitUntil: 'networkidle' });
await page.fill('input[type=email]', email);
await page.getByRole('button', { name: 'Next' }).click();
await page.waitForTimeout(2000);
await page.screenshot({ path: `${shots}/a1-otp-screen.png` });
const boxes = page.locator('input:not([type=email]):not([type=checkbox])');
const n = await boxes.count();
if (n >= otp.length) {
  for (let i = 0; i < otp.length; i++) await boxes.nth(i).fill(otp[i]);
} else {
  await boxes.first().fill(otp);
}
const verify = page.getByRole('button', { name: /verify|continue|sign in|log in|next/i });
if (await verify.count()) await verify.first().click().catch(() => {});
await page.waitForTimeout(4000);
await page.screenshot({ path: `${shots}/a1-after-login.png`, fullPage: true });
console.log('URL', page.url());
console.log((await page.innerText('body')).slice(0, 2000));
await ctx.storageState({ path: resolve(here, '../runs/owner-state.json') });
await browser.close();
