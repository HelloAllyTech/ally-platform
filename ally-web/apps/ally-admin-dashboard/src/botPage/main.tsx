import { StrictMode } from "react";

import { createRoot } from "react-dom/client";

import { BotPageApp } from "./BotPageApp";
import { embedContext } from "./embed";
import "./page.css";

/**
 * The public bot page (chunk 12b): a second entry of this app (`b.html`), served for `/b/<slug>`.
 * It shares no providers, store or styles with the dashboard, so a visitor downloads only this.
 */
// Deployed under a base path (app.helloally.ai/admin/), so match after it.
const base = import.meta.env.BASE_URL.replace(/\/$/, "");
const pathname = window.location.pathname;
const path = pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
const slug = decodeURIComponent(/^\/b\/([^/?#]+)/.exec(path)?.[1] ?? "");
/** Framed by another site (the website widget, chunk 13), or null on the page itself. */
const embed = embedContext();

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <BotPageApp slug={slug} embed={embed} />
  </StrictMode>,
);
