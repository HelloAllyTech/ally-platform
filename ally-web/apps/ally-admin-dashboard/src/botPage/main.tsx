import { StrictMode } from "react";

import { createRoot } from "react-dom/client";

import { botPageApi, setApiBase } from "./api";
import { BotPageApp } from "./BotPageApp";
import { embedContext } from "./embed";
import { addressUrl, pageRoute } from "./route";
import "./page.css";

/**
 * The public bot page (chunk 12b): a second entry of this app (`b.html`), served for `/chat/<id>`
 * (stage 7), for old `/b/<slug>` links, and for every path on a verified custom domain. It shares
 * no providers, store or styles with the dashboard, so a visitor downloads only this.
 */
// Deployed under a base path (app.helloally.ai/admin/), so match after it.
const base = import.meta.env.BASE_URL.replace(/\/$/, "");
const route = pageRoute(window.location.pathname, base, window.location.hostname);
/** Framed by another site (the website widget, chunk 13), or null on the page itself. */
const embed = embedContext();

// On a custom domain the API is proxied on the page's own origin (ally-be docs/custom-domains.md).
if (route.kind === "domain") setApiBase(window.location.origin);

const render = () =>
  createRoot(document.getElementById("root") as HTMLElement).render(
    <StrictMode>
      <BotPageApp slug={route.key} embed={embed} />
    </StrictMode>,
  );

if (route.kind === "legacy") {
  // An old link: go to the page's address. If the page can't be read (off, unknown), stay and let
  // the app explain, exactly as before.
  botPageApi
    .page(route.key)
    .then(page => {
      if (page.publicId) {
        window.location.replace(
          addressUrl(base, page.publicId, window.location.search, window.location.hash),
        );
      } else render();
    })
    .catch(render);
} else {
  render();
}
