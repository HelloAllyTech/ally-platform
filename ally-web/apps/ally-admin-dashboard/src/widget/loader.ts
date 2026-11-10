/**
 * The website widget's loader (chunk 13), served as `/widget.js` and added by an owner with one line:
 *
 *   <script src="https://<bot page>/widget.js" data-assistant="<slug>" async></script>
 *
 * It draws a chat bubble on the owner's site and, on the first click, opens the bot page in a panel
 * (`/b/<slug>?embed=1`). Plain TypeScript with no imports, so the build stays a few KB.
 *
 * What it touches on the host page: one element of its own, appended to `<body>`, with everything
 * inside a shadow root (so the site's CSS can't break it, nor its CSS the site's), and one
 * `localStorage` key for open or closed. It never reads the site's cookies or DOM, and talks to the
 * frame only by postMessage, checking the sender's origin and window both ways.
 */

export interface WidgetConfig {
  position: "right" | "left";
  label: string;
  autoOpenSeconds: number | null;
  showOnPhones: boolean;
  accent: string;
  logo: string | null;
  title: string;
  pageUrl: string;
}

export interface WidgetHandle {
  open(): void;
  close(): void;
  readonly root: ShadowRoot;
}

/** Narrower than this, the panel fills the screen. */
const PHONE = "(max-width: 480px)";

/** "Chat with {business}" (copy §22): the panel's and the frame's accessible name. */
const chatWith = (title: string) => `Chat with ${title}`;

/** Black or white text, whichever reads better on the accent. */
function inkOn(hex: string): string {
  const n = parseInt(hex.replace("#", ""), 16);
  if (Number.isNaN(n)) return "#fff";
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "#111" : "#fff";
}

function css(config: WidgetConfig): string {
  const side = config.position === "left" ? "left" : "right";
  const accent = /^#[0-9a-f]{6}$/i.test(config.accent) ? config.accent : "#264D8E";
  return `
:host{all:initial}
*{box-sizing:border-box}
.bubble{position:fixed;${side}:20px;bottom:20px;z-index:2147483000;display:flex;align-items:center;gap:10px;min-height:52px;padding:6px 18px 6px 6px;border:0;border-radius:999px;background:${accent};color:${inkOn(accent)};font:600 15px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.18);cursor:pointer}
.bubble:focus-visible{outline:3px solid ${accent};outline-offset:3px}
.mark{width:40px;height:40px;border-radius:50%;flex:none;overflow:hidden;background:radial-gradient(circle at 35% 30%,#fff 0,rgba(255,255,255,.55) 25%,rgba(255,255,255,.15) 60%,transparent 70%),${accent};border:2px solid rgba(255,255,255,.7)}
.mark img{width:100%;height:100%;object-fit:cover;display:block;background:#fff}
.dot{position:absolute;top:4px;${side === "right" ? "left" : "right"}:4px;width:12px;height:12px;border-radius:50%;background:#d93025;border:2px solid #fff}
.dot[hidden],.panel[hidden]{display:none}
.panel{position:fixed;${side}:20px;bottom:84px;z-index:2147483001;width:380px;height:640px;max-height:calc(100vh - 104px);border-radius:16px;overflow:hidden;background:#fff;box-shadow:0 12px 48px rgba(0,0,0,.24)}
.panel iframe{width:100%;height:100%;border:0;display:block}
@media ${PHONE}{.panel{inset:0;width:100%;height:100%;max-height:none;border-radius:0}.open .bubble{display:none}}
@media (prefers-reduced-motion:no-preference){.panel{animation:rise .18s ease-out}@keyframes rise{from{opacity:0;transform:translateY(8px)}}}
`;
}

/**
 * Draw the bubble for `slug`. Resolves to null when there's nothing to draw: the settings aren't
 * there for this site (not an allowed website, or the page is off), or it's a phone and the owner
 * turned phones off.
 */
export async function mountWidget(options: {
  slug: string;
  apiBase: string;
  win?: Window;
  fetcher?: typeof fetch;
}): Promise<WidgetHandle | null> {
  const win = options.win ?? window;
  const doc = win.document;
  const fetcher = options.fetcher ?? win.fetch.bind(win);
  let config: WidgetConfig;
  try {
    const response = await fetcher(
      `${options.apiBase}/api/v1/public/widget/${encodeURIComponent(options.slug)}`,
      { credentials: "omit" },
    );
    if (!response.ok) return null;
    config = (await response.json()) as WidgetConfig;
  } catch {
    return null;
  }
  const phone = win.matchMedia?.(PHONE).matches ?? false;
  if (phone && !config.showOnPhones) return null;

  let pageOrigin: string;
  try {
    pageOrigin = new URL(config.pageUrl).origin;
  } catch {
    return null;
  }

  const key = `ally-widget:${options.slug}`;
  const remembered = (): string | null => {
    try {
      return win.localStorage.getItem(key);
    } catch {
      return null;
    }
  };
  const remember = (state: "open" | "closed") => {
    try {
      win.localStorage.setItem(key, state);
    } catch {
      // Storage blocked: it just won't be remembered.
    }
  };

  const host = doc.createElement("div");
  host.setAttribute("data-ally-widget", options.slug);
  const root = host.attachShadow({ mode: "open" });
  const style = doc.createElement("style");
  style.textContent = css(config);

  const wrap = doc.createElement("div");
  const bubble = doc.createElement("button");
  bubble.type = "button";
  bubble.className = "bubble";
  bubble.setAttribute("aria-expanded", "false");
  bubble.setAttribute("aria-controls", "ally-panel");
  const mark = doc.createElement("span");
  mark.className = "mark";
  mark.setAttribute("aria-hidden", "true");
  if (config.logo) {
    const img = doc.createElement("img");
    img.src = config.logo;
    img.alt = "";
    mark.appendChild(img);
  }
  const label = doc.createElement("span");
  label.textContent = config.label;
  const dot = doc.createElement("span");
  dot.className = "dot";
  dot.hidden = true;
  dot.setAttribute("aria-hidden", "true");
  bubble.append(mark, label, dot);

  const panel = doc.createElement("div");
  panel.id = "ally-panel";
  panel.className = "panel";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", chatWith(config.title));

  wrap.append(bubble, panel);
  root.append(style, wrap);
  doc.body.appendChild(host);

  let frame: HTMLIFrameElement | null = null;
  let isOpen = false;
  const tell = (type: "ally:opened" | "ally:closed") =>
    frame?.contentWindow?.postMessage({ type }, pageOrigin);

  // The frame is made on the first open, never on page load, so the owner's site isn't slowed.
  const ensureFrame = () => {
    if (frame) return;
    frame = doc.createElement("iframe");
    const src = new URL(config.pageUrl);
    src.searchParams.set("embed", "1");
    src.searchParams.set("page", `${win.location.origin}${win.location.pathname}`);
    frame.src = src.toString();
    frame.title = chatWith(config.title);
    // No camera, microphone or other features; and a referrer (the host's origin) even on sites
    // that send none, so Firefox, which has no ancestorOrigins, can still name the host.
    frame.setAttribute("allow", "");
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    panel.appendChild(frame);
  };

  const open = () => {
    ensureFrame();
    isOpen = true;
    panel.hidden = false;
    wrap.classList.add("open");
    dot.hidden = true;
    bubble.setAttribute("aria-expanded", "true");
    remember("open");
    tell("ally:opened");
    frame?.focus();
  };
  const close = () => {
    isOpen = false;
    panel.hidden = true;
    wrap.classList.remove("open");
    bubble.setAttribute("aria-expanded", "false");
    remember("closed");
    tell("ally:closed");
    bubble.focus();
  };

  bubble.addEventListener("click", () => (isOpen ? close() : open()));
  root.addEventListener("keydown", event => {
    if ((event as KeyboardEvent).key === "Escape" && isOpen) close();
  });
  win.addEventListener("message", event => {
    if (!frame || event.origin !== pageOrigin || event.source !== frame.contentWindow) return;
    const data = event.data as { type?: unknown; count?: unknown } | null;
    if (data?.type === "ally:close") close();
    else if (data?.type === "ally:ready") tell(isOpen ? "ally:opened" : "ally:closed");
    else if (data?.type === "ally:unread" && !isOpen) dot.hidden = !(Number(data.count) > 0);
  });

  const state = remembered();
  if (state === "open") open();
  else if (state === null && config.autoOpenSeconds) {
    win.setTimeout(() => {
      if (!isOpen && remembered() === null) open();
    }, config.autoOpenSeconds * 1000);
  }

  return { open, close, root };
}

/** Run as the snippet: the script tag names the assistant; the API base is set at build time. */
const script =
  typeof document !== "undefined" ? (document.currentScript as HTMLScriptElement) : null;
const slug = script?.dataset.assistant;
if (slug && !document.querySelector(`[data-ally-widget="${CSS.escape(slug)}"]`)) {
  const start = () => void mountWidget({ slug, apiBase: import.meta.env.VITE_API_BASE_URL ?? "" });
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
}
