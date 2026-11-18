/**
 * The bot page inside the website widget (chunk 13): a frame on the owner's own site.
 *
 * The host is what the browser says framed us (`location.ancestorOrigins`, else the referrer's
 * origin; the loader asks for `strict-origin-when-cross-origin` so Firefox sends one), never what
 * the loader or the URL claims. ally-be accepts it only for the bot's allowed websites, and with no
 * host at all the page refuses: it fails closed.
 */
export interface EmbedContext {
  /** The host page's origin, or null when the browser didn't say (refused). */
  host: string | null;
  /** The page the bubble is on, as the loader passed it (only a label: ally-be keeps it on the host). */
  page: string | null;
}

export function embedContext(win: Window = window): EmbedContext | null {
  let framed: boolean;
  try {
    framed = win.top !== win.self;
  } catch {
    framed = true;
  }
  // Framed at all, `?embed=1` or not: the same check, so the page can't be framed any other way.
  if (!framed) return null;
  const params = new URLSearchParams(win.location.search);
  return { host: hostOf(win), page: params.get("page") };
}

function hostOf(win: Window): string | null {
  const ancestors = win.location.ancestorOrigins;
  if (ancestors && ancestors.length) return originOf(ancestors[0]);
  return originOf(win.document.referrer);
}

function originOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const { origin, protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:" ? origin : null;
  } catch {
    return null;
  }
}

/** What the frame and the loader say to each other. Nothing about the visitor or the chat. */
export type ToLoader =
  | { type: "ally:ready" }
  | { type: "ally:close" }
  | { type: "ally:unread"; count: number };
export type FromLoader = { type: "ally:opened" } | { type: "ally:closed" };

/**
 * The frame's side of the postMessage bridge: messages go only to the verified host, and only the
 * parent window on that origin is listened to.
 */
export function bridge(
  host: string,
  onMessage: (message: FromLoader) => void,
  win: Window = window,
): { post(message: ToLoader): void; stop(): void } {
  const listener = (event: MessageEvent) => {
    if (event.source !== win.parent || event.origin !== host) return;
    const type = (event.data as { type?: unknown } | null)?.type;
    if (type === "ally:opened" || type === "ally:closed") onMessage({ type });
  };
  win.addEventListener("message", listener);
  return {
    post: message => win.parent.postMessage(message, host),
    stop: () => win.removeEventListener("message", listener),
  };
}
