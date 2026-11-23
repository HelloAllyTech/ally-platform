import { mountWidget, type WidgetConfig } from "../loader";

const CONFIG: WidgetConfig = {
  position: "right",
  label: "Ask us",
  autoOpenSeconds: null,
  showOnPhones: true,
  accent: "#0F766E",
  logo: null,
  title: "Sunrise Mind",
  pageUrl: "https://chat.ally.test/b/sunrise-mind",
};
const PAGE_ORIGIN = "https://chat.ally.test";

const respond = (body: unknown, ok = true) =>
  vi.fn().mockResolvedValue({ ok, json: async () => body }) as unknown as typeof fetch;

function phone(matches: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({ matches }) as never;
}

const mount = (config: Partial<WidgetConfig> = {}, ok = true) =>
  mountWidget({
    slug: "sunrise-mind",
    apiBase: "https://api.ally.test",
    fetcher: respond({ ...CONFIG, ...config }, ok),
  });

const parts = (root: ShadowRoot) => ({
  bubble: root.querySelector<HTMLButtonElement>(".bubble")!,
  panel: root.querySelector<HTMLDivElement>(".panel")!,
  dot: root.querySelector<HTMLSpanElement>(".dot")!,
  frame: () => root.querySelector("iframe"),
});

/** Messages from the frame, as the browser delivers them. */
function fromFrame(frame: HTMLIFrameElement | null, data: unknown, origin = PAGE_ORIGIN) {
  window.dispatchEvent(
    new MessageEvent("message", { data, origin, source: frame?.contentWindow ?? null }),
  );
}

describe("the website widget's loader (chunk 13)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    phone(false);
  });

  it("draws the bubble with its label, and touches nothing else on the page", async () => {
    document.body.innerHTML = "<main>The owner's page</main>";
    const widget = await mount();
    const { bubble, panel } = parts(widget!.root);
    expect(bubble.textContent).toContain("Ask us");
    expect(bubble.getAttribute("aria-expanded")).toBe("false");
    expect(panel.hidden).toBe(true);
    expect(document.body.children).toHaveLength(2);
    expect(document.body.lastElementChild?.getAttribute("data-ally-widget")).toBe("sunrise-mind");
  });

  it("makes the frame only on the first open, sandboxed and named", async () => {
    const widget = await mount();
    const { bubble, panel, frame } = parts(widget!.root);
    expect(frame()).toBeNull();
    bubble.click();
    const iframe = frame()!;
    expect(panel.hidden).toBe(false);
    expect(bubble.getAttribute("aria-expanded")).toBe("true");
    const src = new URL(iframe.src);
    expect(src.origin + src.pathname).toBe(CONFIG.pageUrl);
    expect(src.searchParams.get("embed")).toBe("1");
    expect(src.searchParams.get("page")).toBe(`${location.origin}${location.pathname}`);
    expect(iframe.title).toBe("Chat with Sunrise Mind");
    expect(iframe.getAttribute("allow")).toBe("");
    expect(iframe.referrerPolicy).toBe("strict-origin-when-cross-origin");
    expect(panel.getAttribute("aria-label")).toBe("Chat with Sunrise Mind");

    bubble.click();
    expect(panel.hidden).toBe(true);
    bubble.click();
    expect(widget!.root.querySelectorAll("iframe")).toHaveLength(1);
  });

  it("closes when the frame asks, and shows a dot for a reply while shut", async () => {
    const widget = await mount();
    const { bubble, panel, dot, frame } = parts(widget!.root);
    bubble.click();
    fromFrame(frame(), { type: "ally:close" });
    expect(panel.hidden).toBe(true);
    fromFrame(frame(), { type: "ally:unread", count: 1 });
    expect(dot.hidden).toBe(false);
    bubble.click();
    expect(dot.hidden).toBe(true);
  });

  it("ignores messages from any other origin or window", async () => {
    const widget = await mount();
    const { bubble, panel, frame } = parts(widget!.root);
    bubble.click();
    fromFrame(frame(), { type: "ally:close" }, "https://evil.example");
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "ally:close" },
        origin: PAGE_ORIGIN,
        source: window,
      }),
    );
    expect(panel.hidden).toBe(false);
  });

  it("closes on Escape, and remembers open or closed for the next page", async () => {
    let widget = await mount();
    parts(widget!.root).bubble.click();
    expect(localStorage.getItem("ally-widget:sunrise-mind")).toBe("open");
    widget!.root.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(parts(widget!.root).panel.hidden).toBe(true);
    expect(localStorage.getItem("ally-widget:sunrise-mind")).toBe("closed");

    localStorage.setItem("ally-widget:sunrise-mind", "open");
    document.body.innerHTML = "";
    widget = await mount();
    expect(parts(widget!.root).panel.hidden).toBe(false);
  });

  it("opens on its own after the owner's delay, only for someone who hasn't chosen", async () => {
    vi.useFakeTimers();
    try {
      const widget = await mount({ autoOpenSeconds: 5 });
      expect(parts(widget!.root).panel.hidden).toBe(true);
      vi.advanceTimersByTime(5000);
      expect(parts(widget!.root).panel.hidden).toBe(false);

      document.body.innerHTML = "";
      localStorage.setItem("ally-widget:sunrise-mind", "closed");
      const again = await mount({ autoOpenSeconds: 5 });
      vi.advanceTimersByTime(5000);
      expect(parts(again!.root).panel.hidden).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("on a phone the panel fills the screen; with phones off, nothing is drawn", async () => {
    phone(true);
    const widget = await mount();
    const style = widget!.root.querySelector("style")!.textContent!;
    expect(style).toMatch(/@media \(max-width: 480px\)\{\.panel\{inset:0;width:100%;height:100%/);
    document.body.innerHTML = "";
    expect(await mount({ showOnPhones: false })).toBeNull();
    expect(document.querySelector("[data-ally-widget]")).toBeNull();
  });

  it("draws nothing where it isn't allowed (403), or when it can't reach Ally", async () => {
    expect(await mount({}, false)).toBeNull();
    expect(
      await mountWidget({
        slug: "sunrise-mind",
        apiBase: "https://api.ally.test",
        fetcher: vi.fn().mockRejectedValue(new TypeError("offline")) as never,
      }),
    ).toBeNull();
    expect(document.querySelector("[data-ally-widget]")).toBeNull();
  });

  it("asks for the settings without cookies", async () => {
    const fetcher = respond(CONFIG);
    await mountWidget({ slug: "sunrise mind", apiBase: "https://api.ally.test", fetcher });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.ally.test/api/v1/public/widget/sunrise%20mind",
      { credentials: "omit" },
    );
  });
});
