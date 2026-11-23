import { expect, test } from "@playwright/test";
import { createServer, type Server } from "node:http";

import { LOCAL_NETWORK_OFF, SITE } from "./widget.fixture";

import type { AddressInfo } from "node:net";

/**
 * The website widget (chunk 13) with third-party cookies blocked: Chromium's own switch for the
 * phase-out, set at launch (so this file is its own). The frame's API calls go to a small real
 * server here, since a mocked response's cookies don't go through the browser's cookie rules. It
 * sets one cookie exactly as ally-be sets the widget's (`EMBED_COOKIE`, SameSite=None; Secure;
 * HttpOnly; Partitioned) and a control without Partitioned, then reads back what arrives.
 */
test.use({ launchOptions: { args: ["--test-third-party-cookie-phaseout", LOCAL_NETWORK_OFF] } });

let server: Server;
let api = "";
let seen = "";

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const cors = {
      "Access-Control-Allow-Origin": req.headers.origin ?? "",
      "Access-Control-Allow-Credentials": "true",
    };
    if (req.method === "POST") {
      res.writeHead(204, {
        ...cors,
        "Set-Cookie": [
          "ally_bpe_probe=1; Path=/; Secure; HttpOnly; SameSite=None; Partitioned",
          "plain=1; Path=/; Secure; HttpOnly; SameSite=None",
        ],
      });
      return res.end();
    }
    seen = req.headers.cookie ?? "";
    res.writeHead(200, { ...cors, "Content-Type": "application/json" });
    res.end("{}");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  api = `http://localhost:${(server.address() as AddressInfo).port}`;
});
test.afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

test("the widget's cookie survives third-party cookies being blocked; a plain one doesn't", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "one browser is enough");
  const base = info.project.use.baseURL ?? "http://localhost:8081";
  seen = "";
  await page.route(`${SITE}/**`, route =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><iframe title="frame" src="${base}/b/cookie-check?embed=1"></iframe>`,
    }),
  );
  // The frame, on the bot page's origin, sets and reads the cookies as the bot page would.
  await page.route(`${base}/b/cookie-check*`, route =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><script>
        fetch("${api}/probe", { method: "POST", credentials: "include" })
          .then(() => fetch("${api}/probe", { credentials: "include" }))
          .then(() => { document.title = "done"; });
      </script>`,
    }),
  );
  await page.goto(`${SITE}/`);
  await expect.poll(() => page.frames()[1]?.title()).toBe("done");
  expect(seen).toContain("ally_bpe_probe=1");
  expect(seen).not.toContain("plain=1");
});
