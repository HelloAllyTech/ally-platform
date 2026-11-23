import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LandingPageView, LandingPageViewProps } from "../LandingPageView";
import { LandingPageConfig } from "../types";

const baseConfig = (): LandingPageConfig => ({
  version: 1,
  template: "standard",
  languages: { enabled: ["en", "hi"], default: "en" },
  signUp: { enabled: false },
  logo: { source: "tenant", url: null, alt: {} },
  headings: {
    first: { en: "Baat Se Baat Banegi", hi: "बात से बात बनेगी" },
    second: { en: "Get ready for a hard conversation" },
    third: { en: "Short courses and safe practice" },
  },
  hero: { enabled: false, imageUrl: null, imageAlt: {} },
  helpline: { enabled: true, text: { en: "Call [number]", hi: "[नंबर] पर कॉल करें" } },
  slider: {
    enabled: true,
    slides: [
      { quote: { en: "A quote" }, name: { en: "A Name" }, role: { en: "Actor" }, photoUrl: null },
    ],
  },
  cards: {
    enabled: true,
    items: [
      {
        key: "practice",
        enabled: true,
        title: { en: "Conversation practice", hi: "बातचीत का अभ्यास" },
        intro: { en: "Practise talking" },
        entries: [],
      },
      {
        key: "courses",
        enabled: true,
        title: { en: "Courses" },
        intro: { en: "Learn the signs" },
        entries: [
          {
            title: { en: "Course one" },
            description: { en: "About it" },
            linkUrl: "https://example.com/c1",
          },
          { title: { en: "Course two" }, description: {}, linkUrl: null },
        ],
      },
      { key: "resources", enabled: false, title: { en: "Resources" }, intro: {}, entries: [] },
    ],
  },
  footer: {
    disclaimer: { enabled: true, text: { en: "Not an emergency service" } },
    showAllyLogo: true,
    showTenantLogo: false,
    partners: [
      { name: "ElevenLabs", logoUrl: "https://x.test/11.svg", linkUrl: "https://elevenlabs.io" },
    ],
  },
});

const renderView = (overrides: Partial<LandingPageViewProps> = {}) => {
  const props: LandingPageViewProps = {
    config: baseConfig(),
    branding: { displayName: "Agatsu Foundation", logoUrl: "https://x.test/agatsu.png" },
    language: "en",
    onLanguageChange: vi.fn(),
    section: null,
    onSectionChange: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<LandingPageView {...props} />) };
};

describe("LandingPageView as a visitor sees it", () => {
  it("draws the headings, helpline line, slider and cards", () => {
    renderView();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Baat Se Baat Banegi");
    expect(screen.getByText("Get ready for a hard conversation")).toBeTruthy();
    expect(screen.getByText("Call [number]")).toBeTruthy();
    expect(screen.getByText("A quote")).toBeTruthy();
    expect(screen.getByText("Conversation practice")).toBeTruthy();
  });

  it("has no editing controls", () => {
    renderView();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText(/^Hide /)).toBeNull();
  });

  it("uses the organization's logo, named for the organization", () => {
    renderView();
    expect(screen.getByRole("img", { name: "Agatsu Foundation" }).getAttribute("src")).toBe(
      "https://x.test/agatsu.png",
    );
  });

  it("uses a custom logo when the page has one", () => {
    const config = baseConfig();
    config.logo = { source: "custom", url: "https://x.test/custom.png", alt: { en: "Custom" } };
    renderView({ config });
    expect(screen.getByRole("img", { name: "Custom" }).getAttribute("src")).toBe(
      "https://x.test/custom.png",
    );
  });

  it("falls back to the organization's name when it has no logo", () => {
    renderView({ branding: { displayName: "Agatsu Foundation", logoUrl: null } });
    expect(screen.getByText("Agatsu Foundation")).toBeTruthy();
  });

  it("does not draw a hidden card or a hidden block", () => {
    const config = baseConfig();
    config.helpline.enabled = false;
    config.slider.enabled = false;
    renderView({ config });
    expect(screen.queryByText("Resources")).toBeNull();
    expect(screen.queryByText("Call [number]")).toBeNull();
    expect(screen.queryByText("A quote")).toBeNull();
  });

  it("shows text in the chosen language, and the default language where that one is missing", () => {
    renderView({ language: "hi" });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("बात से बात बनेगी");
    expect(screen.getByText("[नंबर] पर कॉल करें")).toBeTruthy();
    // The second heading has no Hindi text, so the default language shows.
    expect(screen.getByText("Get ready for a hard conversation")).toBeTruthy();
  });

  it("switches language from the dropdown, and only when more than one is offered", () => {
    const onLanguageChange = vi.fn();
    renderView({ onLanguageChange });
    fireEvent.click(screen.getByRole("button", { name: "Toggle options" }));
    fireEvent.click(screen.getByRole("option", { name: "हिन्दी" }));
    expect(onLanguageChange).toHaveBeenCalledWith("hi");
  });

  it("has no language dropdown when the page offers one language", () => {
    const config = baseConfig();
    config.languages = { enabled: ["en"], default: "en" };
    renderView({ config });
    expect(screen.queryByRole("button", { name: "Toggle options" })).toBeNull();
  });

  it("links each card to its page, and opens it on a plain click", () => {
    const onSectionChange = vi.fn();
    renderView({ onSectionChange, sectionHref: key => `/agatsu/campaign/${key}` });
    const card = screen.getByRole("link", { name: /Courses/ });
    expect(card.getAttribute("href")).toBe("/agatsu/campaign/courses");
    fireEvent.click(card);
    expect(onSectionChange).toHaveBeenCalledWith("courses");
  });

  it("leaves a modified click to the browser, so a card can open in a new tab", () => {
    const onSectionChange = vi.fn();
    renderView({ onSectionChange, sectionHref: key => `/agatsu/campaign/${key}` });
    // The browser would open a new tab; the test DOM would try to navigate, so stop that here.
    document.addEventListener("click", event => event.preventDefault(), { once: true });
    fireEvent.click(screen.getByRole("link", { name: /Courses/ }), { ctrlKey: true });
    expect(onSectionChange).not.toHaveBeenCalled();
  });

  it("draws a card's page with breadcrumbs, its entries, and links where an entry has one", () => {
    const onSectionChange = vi.fn();
    renderView({ section: "courses", onSectionChange });
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(crumbs).getByText("Courses")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Courses");
    expect(screen.getByRole("link", { name: /Course one/ }).getAttribute("href")).toBe(
      "https://example.com/c1",
    );
    expect(screen.queryByRole("link", { name: /Course two/ })).toBeNull();
    expect(screen.getByText("Course two")).toBeTruthy();
    fireEvent.click(within(crumbs).getByRole("link", { name: "Home" }));
    expect(onSectionChange).toHaveBeenCalledWith(null);
  });

  it("draws the footer: disclaimer, Ally logo, and partner logos that link out", () => {
    renderView();
    expect(screen.getByText("Not an emergency service")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Ally" })).toBeTruthy();
    const partner = screen.getByRole("img", { name: "ElevenLabs" });
    expect(partner.closest("a")?.getAttribute("href")).toBe("https://elevenlabs.io");
  });

  it("leaves the Ally logo out when switched off, and adds the organization logo when switched on", () => {
    const config = baseConfig();
    config.footer.showAllyLogo = false;
    config.footer.showTenantLogo = true;
    renderView({ config });
    expect(screen.queryByRole("img", { name: "Ally" })).toBeNull();
    expect(screen.getAllByRole("img", { name: "Agatsu Foundation" })).toHaveLength(2);
  });

  it("marks the page as being edited, so the footer can stop being pinned", () => {
    const visitor = renderView();
    expect(visitor.container.querySelector(".lp")?.getAttribute("data-editing")).toBe("false");
    visitor.unmount();
    const editor = renderView({ editable: true, onConfigChange: vi.fn() });
    expect(editor.container.querySelector(".lp")?.getAttribute("data-editing")).toBe("true");
  });

  it("fills the screen only when asked, so a short public page keeps its footer at the bottom", () => {
    const { container, unmount } = renderView();
    expect(container.querySelector(".lp")?.getAttribute("data-fill")).toBe("false");
    unmount();
    const filled = renderView({ fillScreen: true });
    expect(filled.container.querySelector(".lp")?.getAttribute("data-fill")).toBe("true");
  });

  it("marks the template on the page so its design applies", () => {
    const config = baseConfig();
    config.template = "split";
    const { container } = renderView({ config });
    expect(container.querySelector(".lp")?.getAttribute("data-template")).toBe("split");
  });
});

describe("LandingPageView as an editor sees it", () => {
  const edit = (overrides: Partial<LandingPageViewProps> = {}) =>
    renderView({ editable: true, onConfigChange: vi.fn(), onUploadImage: vi.fn(), ...overrides });

  it("makes the headings click-to-edit", () => {
    edit();
    expect(screen.getByRole("textbox", { name: /first heading in English/ }).textContent).toBe(
      "Baat Se Baat Banegi",
    );
    expect(screen.getByRole("textbox", { name: /second heading/ })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: /third heading/ })).toBeTruthy();
  });

  it("changes only the language being edited", () => {
    const onConfigChange = vi.fn();
    edit({ language: "hi", onConfigChange });
    const box = screen.getByRole("textbox", { name: /first heading in Hindi/ });
    box.textContent = "नया शीर्षक";
    fireEvent.blur(box);
    const next: LandingPageConfig = onConfigChange.mock.calls[0][0];
    expect(next.headings.first).toEqual({ en: "Baat Se Baat Banegi", hi: "नया शीर्षक" });
  });

  it("shows an empty language as empty to edit, not as the default language's text", () => {
    edit({ language: "hi" });
    expect(screen.getByRole("textbox", { name: /second heading in Hindi/ }).textContent).toBe("");
  });

  it("does not change the config it was given", () => {
    const config = baseConfig();
    const before = JSON.stringify(config);
    const onConfigChange = vi.fn();
    edit({ config, onConfigChange });
    const box = screen.getByRole("textbox", { name: /first heading/ });
    box.textContent = "Changed";
    fireEvent.blur(box);
    expect(JSON.stringify(config)).toBe(before);
  });

  it("lets a hidden block be switched back on", () => {
    const config = baseConfig();
    config.slider.enabled = false;
    const onConfigChange = vi.fn();
    edit({ config, onConfigChange });
    expect(screen.getByText(/Quote slider is hidden/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show Quote slider" }));
    expect(onConfigChange.mock.calls[0][0].slider.enabled).toBe(true);
  });

  it("lets a block be hidden", () => {
    const onConfigChange = vi.fn();
    edit({ onConfigChange });
    fireEvent.click(screen.getByRole("button", { name: "Hide Helpline line" }));
    expect(onConfigChange.mock.calls[0][0].helpline.enabled).toBe(false);
  });

  it("opens a card's page for editing without following a link", () => {
    const onSectionChange = vi.fn();
    edit({ onSectionChange });
    fireEvent.click(screen.getAllByRole("button", { name: /Edit this page/ })[0]);
    expect(onSectionChange).toHaveBeenCalledWith("practice");
  });

  it("hides and shows a single card", () => {
    const onConfigChange = vi.fn();
    edit({ onConfigChange });
    fireEvent.click(screen.getAllByRole("button", { name: "Hide card" })[0]);
    expect(onConfigChange.mock.calls[0][0].cards.items[0].enabled).toBe(false);
  });

  it("adds, edits the link of, and removes an entry on a card's page", () => {
    const onConfigChange = vi.fn();
    edit({ section: "courses", onConfigChange });
    fireEvent.click(screen.getByRole("button", { name: "+ Add an entry" }));
    expect(onConfigChange.mock.calls[0][0].cards.items[1].entries).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Remove entry 1" }));
    expect(onConfigChange.mock.calls[1][0].cards.items[1].entries).toHaveLength(1);
  });

  it("refuses a link that is not http(s) or an app path", () => {
    const onConfigChange = vi.fn();
    edit({ section: "courses", onConfigChange });
    fireEvent.click(screen.getAllByRole("button", { name: /Link/ })[1]);
    const input = screen.getByLabelText("Link");
    fireEvent.change(input, { target: { value: "javascript:alert(1)" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("alert").textContent).toContain("http(s)");
    expect(onConfigChange).not.toHaveBeenCalled();
  });

  it("adds and removes quotes", () => {
    const onConfigChange = vi.fn();
    edit({ onConfigChange });
    fireEvent.click(screen.getByRole("button", { name: "+ Add a quote" }));
    expect(onConfigChange.mock.calls[0][0].slider.slides).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Remove quote 1" }));
    expect(onConfigChange.mock.calls[1][0].slider.slides).toHaveLength(0);
  });

  it("removes a partner logo and switches the footer logos", () => {
    const onConfigChange = vi.fn();
    edit({ onConfigChange });
    fireEvent.click(screen.getByRole("button", { name: /Remove image: ElevenLabs/ }));
    expect(onConfigChange.mock.calls[0][0].footer.partners).toHaveLength(0);
    fireEvent.click(screen.getByLabelText("Ally logo"));
    expect(onConfigChange.mock.calls[1][0].footer.showAllyLogo).toBe(false);
    fireEvent.click(screen.getByLabelText("Organization logo"));
    expect(onConfigChange.mock.calls[2][0].footer.showTenantLogo).toBe(true);
  });

  it("returns to the organization's logo when a custom logo is removed", () => {
    const config = baseConfig();
    config.logo = { source: "custom", url: "https://x.test/custom.png", alt: {} };
    const onConfigChange = vi.fn();
    edit({ config, onConfigChange });
    fireEvent.click(screen.getByRole("button", { name: /Remove image: Add a logo/ }));
    const next: LandingPageConfig = onConfigChange.mock.calls[0][0];
    expect(next.logo.source).toBe("tenant");
    expect(next.logo.url).toBeNull();
  });
});
