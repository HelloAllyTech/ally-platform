import { test, type Page } from "@playwright/test";

/** An owner's site for the website widget (chunk 13): another origin, carrying the snippet. */
export const SITE = "http://customer.test";

/**
 * A served-in-test site counts as public to Chromium, and the loader comes from the dev server on
 * localhost, which its local-network checks block. Real owners' sites and widget.js are both public,
 * so the tests turn those checks off.
 */
export const LOCAL_NETWORK_OFF =
  "--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights";

export async function mockSite(page: Page, allowed = true): Promise<void> {
  const base = test.info().project.use.baseURL ?? "http://localhost:8081";
  await page.route(`${SITE}/**`, route =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Sunrise Mind Clinic</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;font:16px/1.5 Georgia,serif;background:#f6f1ea;color:#222">
<main style="max-width:720px;margin:0 auto;padding:48px 24px"><h1>Sunrise Mind Clinic</h1>
<p>Therapy and counselling in Pune, in person and online.</p></main>
<script src="${base}/widget.js" data-assistant="sunrise-mind" async></script></body></html>`,
    }),
  );
  await page.route("**/api/v1/public/widget/sunrise-mind", route =>
    allowed
      ? route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "Access-Control-Allow-Origin": SITE },
          body: JSON.stringify({
            position: "right",
            label: "Ask us",
            autoOpenSeconds: null,
            showOnPhones: true,
            accent: "#B5431F",
            logo: null,
            title: "Sunrise Mind",
            pageUrl: `${base}/b/sunrise-mind`,
          }),
        })
      : route.fulfill({ status: 403, contentType: "application/json", body: "{}" }),
  );
}
