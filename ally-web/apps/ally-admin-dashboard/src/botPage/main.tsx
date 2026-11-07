import { StrictMode } from "react";

import { createRoot } from "react-dom/client";

import { BotPageApp } from "./BotPageApp";
import "./botPage.css";

/**
 * The public bot page (chunk 12b): a second entry of this app (`b.html`), served for `/b/<slug>`.
 * It shares no providers, store or styles with the dashboard, so a visitor downloads only this.
 */
const slug = decodeURIComponent(/^\/b\/([^/?#]+)/.exec(window.location.pathname)?.[1] ?? "");

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <BotPageApp slug={slug} />
  </StrictMode>,
);
