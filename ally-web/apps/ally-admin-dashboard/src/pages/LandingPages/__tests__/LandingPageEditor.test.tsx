import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LandingPageConfig } from "@ally-ui-mono/ui-shared";

import { LandingPageEditor } from "../LandingPageEditor";

const hooks = vi.hoisted(() => ({
  page: vi.fn(),
  preview: vi.fn(),
  update: vi.fn(),
  publish: vi.fn(),
  unpublish: vi.fn(),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("../../../api/landingPages", () => ({
  useGetLandingPageQuery: () => hooks.page(),
  useGetLandingPagePreviewQuery: () => hooks.preview(),
  useUpdateLandingPageMutation: () => [hooks.update, { isLoading: false }],
  usePublishLandingPageMutation: () => [hooks.publish, { isLoading: false }],
  useUnpublishLandingPageMutation: () => [hooks.unpublish, { isLoading: false }],
  useGetLandingImageUploadUrlMutation: () => [vi.fn()],
}));
vi.mock("../../../api/userManagement", () => ({ useGetTenantsQuery: () => ({ data: undefined }) }));
vi.mock("sonner", () => ({ toast }));

const config = (): LandingPageConfig => ({
  version: 1,
  template: "standard",
  languages: { enabled: ["en", "hi"], default: "en" },
  signUp: { enabled: false },
  logo: { source: "tenant", url: null, alt: {} },
  headings: { first: { en: "Baat Se Baat Banegi" }, second: {}, third: {} },
  hero: { enabled: false, imageUrl: null, imageAlt: {} },
  helpline: { enabled: true, text: { en: "Call [number]" } },
  slider: { enabled: false, slides: [] },
  cards: {
    enabled: true,
    items: [
      { key: "practice", enabled: true, title: { en: "Practice" }, intro: {}, entries: [] },
      { key: "courses", enabled: true, title: { en: "Courses" }, intro: {}, entries: [] },
      { key: "resources", enabled: true, title: { en: "Resources" }, intro: {}, entries: [] },
    ],
  },
  footer: {
    disclaimer: { enabled: true, text: { en: "Not an emergency service" } },
    showAllyLogo: true,
    showTenantLogo: false,
    partners: [],
  },
});

const page = (overrides: Record<string, unknown> = {}) => ({
  id: "p1",
  tenantId: "t1",
  tenantName: "Agatsu Foundation",
  tenantCode: "agatsu",
  name: "Campaign",
  slug: "campaign",
  status: "DRAFT",
  path: "/agatsu/campaign",
  config: config(),
  publishedConfig: null,
  hasUnpublishedChanges: false,
  publishedAt: null,
  createdAt: "2026-11-20T00:00:00Z",
  updatedAt: "2026-11-20T00:00:00Z",
  ...overrides,
});

const renderEditor = () =>
  render(
    <MemoryRouter initialEntries={["/landing-pages/p1"]}>
      <Routes>
        <Route path="/landing-pages/:id" element={<LandingPageEditor />} />
        <Route path="/landing-pages" element={<div>the list</div>} />
      </Routes>
    </MemoryRouter>,
  );

const loaded = (data: unknown) => ({ data, isLoading: false, isError: false });
const unwrap = (value: unknown) => ({ unwrap: () => Promise.resolve(value) });
const reject = (error: unknown) => ({ unwrap: () => Promise.reject(error) });

const editHeading = (text: string) => {
  const box = screen.getByRole("textbox", { name: /first heading in English/ });
  box.textContent = text;
  fireEvent.blur(box);
};

describe("LandingPageEditor", () => {
  beforeEach(() => {
    Object.values(hooks).forEach(mock => mock.mockReset());
    toast.success.mockReset();
    toast.error.mockReset();
    hooks.page.mockReturnValue(loaded(page()));
    hooks.preview.mockReturnValue(
      loaded({ branding: { displayName: "Agatsu Foundation", logoUrl: null } }),
    );
  });

  it("is the page itself with one toolbar, not a form", () => {
    renderEditor();
    expect(screen.getByRole("toolbar", { name: "Landing page editor" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: /first heading in English/ }).textContent).toBe(
      "Baat Se Baat Banegi",
    );
    expect(screen.getByText("Campaign")).toBeTruthy();
    expect(screen.getByText("/agatsu/campaign")).toBeTruthy();
    expect(screen.getByText("Draft")).toBeTruthy();
  });

  it("starts with nothing to save, and Save off", () => {
    renderEditor();
    expect(screen.getByText("All changes saved")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("notices an edit and saves the whole draft", async () => {
    hooks.update.mockImplementation(({ data }) => unwrap(page({ config: data.config })));
    renderEditor();
    editHeading("A new heading");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Saved"));
    const sent = hooks.update.mock.calls[0][0];
    expect(sent.id).toBe("p1");
    expect(sent.data.config.headings.first.en).toBe("A new heading");
    expect(screen.getByText("All changes saved")).toBeTruthy();
  });

  it("tells the editor when saving fails, and keeps the edit", async () => {
    hooks.update.mockImplementation(() =>
      reject({ data: { message: "Image address not allowed" } }),
    );
    renderEditor();
    editHeading("A new heading");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Image address not allowed"));
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: /first heading/ }).textContent).toBe(
      "A new heading",
    );
  });

  it("changes the template", () => {
    renderEditor();
    fireEvent.change(screen.getByLabelText("Template"), { target: { value: "split" } });
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(document.querySelector(".lp")?.getAttribute("data-template")).toBe("split");
  });

  it("writes in the language chosen on the page's own language dropdown", () => {
    renderEditor();
    expect(screen.getByText("Writing in English")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Toggle options" }));
    fireEvent.click(screen.getByRole("option", { name: "हिन्दी" }));
    expect(screen.getByText("Writing in Hindi")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: /first heading in Hindi/ }).textContent).toBe("");
  });

  it("saves first, then publishes, when there are unsaved changes", async () => {
    hooks.update.mockImplementation(({ data }) => unwrap(page({ config: data.config })));
    hooks.publish.mockImplementation(() => unwrap(page({ status: "PUBLISHED" })));
    renderEditor();
    editHeading("Fresh heading");
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Published"));
    expect(hooks.update).toHaveBeenCalledTimes(1);
    expect(hooks.publish).toHaveBeenCalledWith("p1");
  });

  it("lists what is missing instead of publishing", async () => {
    hooks.publish.mockImplementation(() =>
      reject({
        data: {
          message: "This page is not ready to publish",
          problems: [
            "The first heading is empty in hi.",
            "The helpline line is on but empty in hi.",
          ],
        },
      }),
    );
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    const banner = await screen.findByText("This page isn't ready to publish yet.");
    const list = within(banner.closest("[role=alert]") as HTMLElement);
    expect(list.getByText("The first heading is empty in hi.")).toBeTruthy();
    expect(list.getByText("The helpline line is on but empty in hi.")).toBeTruthy();
    expect(toast.success).not.toHaveBeenCalled();
  });

  describe("a published page", () => {
    const published = (extra: Record<string, unknown> = {}) =>
      page({
        status: "PUBLISHED",
        publishedConfig: {
          ...config(),
          headings: { first: { en: "The live heading" }, second: {}, third: {} },
        },
        ...extra,
      });

    it("shows the live copy read-only when you switch to Live", () => {
      hooks.page.mockReturnValue(loaded(published()));
      renderEditor();
      fireEvent.click(screen.getByRole("button", { name: "Live" }));
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("The live heading");
      // Scoped to the page: the closed settings dialog keeps its inputs in the document.
      expect(document.querySelector(".lp [contenteditable]")).toBeNull();
      expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    });

    it("returns to the draft on Latest version", () => {
      hooks.page.mockReturnValue(loaded(published()));
      renderEditor();
      fireEvent.click(screen.getByRole("button", { name: "Live" }));
      fireEvent.click(screen.getByRole("button", { name: "Latest version" }));
      expect(screen.getByRole("textbox", { name: /first heading/ }).textContent).toBe(
        "Baat Se Baat Banegi",
      );
    });

    it("says when there are unpublished changes, and offers to publish them", () => {
      hooks.page.mockReturnValue(loaded(published({ hasUnpublishedChanges: true })));
      renderEditor();
      expect(screen.getByText("Live, with unpublished changes")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Publish changes" })).toBeTruthy();
    });

    it("has nothing to publish when the draft matches the live page", () => {
      hooks.page.mockReturnValue(loaded(published({ publishedConfig: config() })));
      renderEditor();
      expect(
        (screen.getByRole("button", { name: "Publish changes" }) as HTMLButtonElement).disabled,
      ).toBe(true);
    });

    it("takes the page down only after confirmation", async () => {
      hooks.page.mockReturnValue(loaded(published()));
      hooks.unpublish.mockImplementation(() => unwrap(page()));
      const confirm = vi
        .spyOn(window, "confirm")
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true);
      renderEditor();
      fireEvent.click(screen.getByRole("button", { name: "Unpublish" }));
      expect(hooks.unpublish).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Unpublish" }));
      await waitFor(() => expect(hooks.unpublish).toHaveBeenCalledWith("p1"));
      confirm.mockRestore();
    });
  });

  it("explains an unpublished page on the Live view", () => {
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Live" }));
    expect(screen.getByText(/isn't published yet/)).toBeTruthy();
  });

  it("asks before leaving with unsaved changes", () => {
    const confirm = vi
      .spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    renderEditor();
    editHeading("Unsaved");
    fireEvent.click(screen.getByRole("button", { name: /Landing pages/ }));
    expect(screen.queryByText("the list")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Landing pages/ }));
    expect(screen.getByText("the list")).toBeTruthy();
    confirm.mockRestore();
  });

  it("says so when the page cannot be found", () => {
    hooks.page.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    renderEditor();
    expect(screen.getByText(/couldn't be found/)).toBeTruthy();
  });
});
