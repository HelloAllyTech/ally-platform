import React from "react";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LookAndFeel } from "../LookAndFeel";

vi.mock("@api", () => ({
  useGetBotPageQuery: vi.fn(() => ({})),
  useGetChatbotTeamNamesQuery: vi.fn(() => ({})),
  useGetBotImagesQuery: vi.fn(() => ({})),
  useUpdateBotPageBrandMutation: vi.fn(() => [vi.fn()]),
  useUploadBotImageMutation: vi.fn(() => [vi.fn()]),
  useRemoveBotImageMutation: vi.fn(() => [vi.fn()]),
  useRestoreBotImageMutation: vi.fn(() => [vi.fn()]),
}));

import type { BrandEditor } from "../../../hooks/brand/useBrandEditor";

const brand = {
  logo: null,
  accent: "#C4512D",
  accentContrast: "#B5431F",
  headingStyle: "classic" as const,
  theme: "light" as const,
  coverImage: null,
  shareImage: null,
  landingImages: { hero: null, gallery: [] },
  peoplePhotos: {},
};

const editor = (over: Partial<BrandEditor> = {}): BrandEditor => ({
  brand,
  images: {},
  imageFor: () => null,
  uploading: {},
  errors: {},
  changed: false,
  saved: true,
  change: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  uploadPerson: vi.fn(),
  personUploading: null,
  personError: null,
  undo: vi.fn(),
  dismissChanged: vi.fn(),
  ...over,
});

const preview = () => screen.getByTestId("phone-preview").querySelector(".brand-surface")!;

describe("Look and feel (chunk 20d)", () => {
  it("draws the page in its current style, and changes go to the editor", () => {
    const e = editor();
    const { rerender } = render(
      <LookAndFeel name="Sunrise Mind" editor={e} canEdit teamNames={["Dr Kavya Iyer"]} live />,
    );
    expect(preview().getAttribute("data-heading")).toBe("classic");
    fireEvent.click(screen.getByRole("radio", { name: /Friendly/ }));
    expect(e.change).toHaveBeenCalledWith({ headingStyle: "friendly" });
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(e.change).toHaveBeenCalledWith({ theme: "dark" });

    rerender(
      <LookAndFeel
        name="Sunrise Mind"
        editor={editor({ brand: { ...brand, headingStyle: "friendly", theme: "dark" } })}
        canEdit
        teamNames={["Dr Kavya Iyer"]}
        live
      />,
    );
    expect(preview().getAttribute("data-heading")).toBe("friendly");
    expect(preview().getAttribute("data-theme")).toBe("dark");
    expect(screen.getByText("Dr Kavya Iyer")).toBeTruthy();
  });

  it("offers Undo after a change, and says it's live once saved", () => {
    const e = editor({ changed: true });
    render(<LookAndFeel name="Sunrise Mind" editor={e} canEdit teamNames={[]} live />);
    expect(screen.getByText("Saved. Live on your page now.")).toBeTruthy();
    fireEvent.click(screen.getByText("Undo"));
    expect(e.undo).toHaveBeenCalled();
  });

  it("changes nothing for a viewer", () => {
    const e = editor();
    render(
      <LookAndFeel name="Sunrise Mind" editor={e} canEdit={false} teamNames={[]} live={false} />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(e.change).not.toHaveBeenCalled();
  });
});
