import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LandingPageConfig } from "@ally-ui-mono/ui-shared";

import {
  chooseInitialLanguage,
  forgetMissingLandingPages,
  LandingPublicPage,
} from "../LandingPublicPage";

const query = vi.fn();
vi.mock("../../../api/landingPages", () => ({
  useGetPublicLandingPageQuery: (...args: unknown[]) => query(...args),
}));
vi.mock("../../blog/usePageMeta", () => ({ usePageMeta: vi.fn() }));

const config = (): LandingPageConfig => ({
  version: 1,
  template: "standard",
  languages: { enabled: ["en", "hi"], default: "en" },
  signUp: { enabled: false },
  logo: { source: "tenant", url: null, alt: {} },
  headings: {
    first: { en: "Baat Se Baat Banegi", hi: "बात से बात बनेगी" },
    second: { en: "Get ready" },
    third: {},
  },
  hero: { enabled: false, imageUrl: null, imageAlt: {} },
  helpline: { enabled: true, text: { en: "Call [number]", hi: "[नंबर] पर कॉल करें" } },
  slider: { enabled: false, slides: [] },
  cards: {
    enabled: true,
    items: [
      {
        key: "practice",
        enabled: true,
        title: { en: "Practice", hi: "अभ्यास" },
        intro: {},
        entries: [],
      },
      { key: "courses", enabled: true, title: { en: "Courses" }, intro: {}, entries: [] },
      { key: "resources", enabled: true, title: { en: "Resources" }, intro: {}, entries: [] },
    ],
  },
  footer: {
    disclaimer: { enabled: false, text: {} },
    showAllyLogo: false,
    showTenantLogo: false,
    partners: [],
  },
});

const page = () => ({
  name: "Campaign",
  slug: "campaign",
  tenantCode: "agatsu",
  config: config(),
  branding: { displayName: "Agatsu Foundation", logoUrl: null },
});

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/:tenantCode/:slug/*"
          element={<LandingPublicPage fallback={<div>the app</div>} />}
        />
      </Routes>
    </MemoryRouter>,
  );

describe("LandingPublicPage", () => {
  beforeEach(() => {
    query.mockReset();
    forgetMissingLandingPages();
  });

  it("draws the live page", () => {
    query.mockReturnValue({ data: page(), isLoading: false, isError: false });
    renderAt("/agatsu/campaign");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Baat Se Baat Banegi");
    expect(screen.queryByText("the app")).toBeNull();
  });

  it("asks for the page by the address's organization code and slug", () => {
    query.mockReturnValue({ data: page(), isLoading: false, isError: false });
    renderAt("/agatsu/campaign");
    expect(query).toHaveBeenCalledWith({ tenantCode: "agatsu", slug: "campaign" }, { skip: false });
  });

  it("hands an app address to the app without asking the server", () => {
    query.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    renderAt("/settings/profile");
    expect(screen.getByText("the app")).toBeTruthy();
    expect(query).toHaveBeenCalledWith({ tenantCode: "settings", slug: "profile" }, { skip: true });
  });

  it("hands over to the app when no such page is live", () => {
    query.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: { status: 404 },
    });
    renderAt("/agatsu/nope");
    expect(screen.getByText("the app")).toBeTruthy();
  });

  it("does not ask again about an address already found not to be a landing page", () => {
    query.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: { status: 404 },
    });
    const first = renderAt("/agatsu/nope");
    expect(screen.getByText("the app")).toBeTruthy();
    first.unmount();

    // The same address mounted again, as when React restarts a render that suspended.
    query.mockClear();
    renderAt("/agatsu/nope");
    expect(screen.getByText("the app")).toBeTruthy();
    expect(query).toHaveBeenCalledWith({ tenantCode: "agatsu", slug: "nope" }, { skip: true });
  });

  it("still asks about a different address", () => {
    query.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: { status: 404 },
    });
    renderAt("/agatsu/nope").unmount();
    query.mockClear();
    query.mockReturnValue({ data: page(), isLoading: false, isError: false });
    renderAt("/agatsu/campaign");
    expect(query).toHaveBeenCalledWith({ tenantCode: "agatsu", slug: "campaign" }, { skip: false });
  });

  it("says so, in English and Hindi, when the page could not be loaded", () => {
    query.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: { status: 500 },
      refetch: vi.fn(),
    });
    renderAt("/agatsu/campaign");
    expect(screen.getByText("Couldn't load this page. Try again.")).toBeTruthy();
    expect(screen.getByText("यह पेज लोड नहीं हो सका। दोबारा कोशिश करें।")).toBeTruthy();
    expect(screen.queryByText("the app")).toBeNull();
  });

  it("shows nothing but a busy marker while loading", () => {
    query.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    renderAt("/agatsu/campaign");
    expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
  });

  it("opens a block's own page from the address", () => {
    query.mockReturnValue({ data: page(), isLoading: false, isError: false });
    renderAt("/agatsu/campaign/courses");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Courses");
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeTruthy();
  });

  it("sends an unknown block address back to the landing page", () => {
    query.mockReturnValue({ data: page(), isLoading: false, isError: false });
    renderAt("/agatsu/campaign/nope");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Baat Se Baat Banegi");
  });

  it("links cards to real addresses under the page", () => {
    query.mockReturnValue({ data: page(), isLoading: false, isError: false });
    renderAt("/agatsu/campaign");
    expect(screen.getByRole("link", { name: /Courses/ }).getAttribute("href")).toBe(
      "/agatsu/campaign/courses",
    );
  });

  it("opens in the language asked for in the address", () => {
    query.mockReturnValue({ data: page(), isLoading: false, isError: false });
    renderAt("/agatsu/campaign?lang=hi");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("बात से बात बनेगी");
  });
});

describe("chooseInitialLanguage", () => {
  const offered = config();

  it("prefers ?lang= when the page offers it", () => {
    expect(chooseInitialLanguage(offered, "?lang=hi", ["en-US"])).toBe("hi");
  });

  it("ignores ?lang= for a language the page does not offer", () => {
    expect(chooseInitialLanguage(offered, "?lang=ta", ["en-US"])).toBe("en");
  });

  it("follows the browser's language when the page offers it", () => {
    expect(chooseInitialLanguage(offered, "", ["hi-IN", "en"])).toBe("hi");
  });

  it("falls back to the page's default language", () => {
    expect(chooseInitialLanguage(offered, "", ["fr-FR"])).toBe("en");
  });
});
