import React from "react";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LookAndFeel } from "../LookAndFeel";

vi.mock("@api", () => ({
  useGetBotPageQuery: vi.fn(() => ({})),
  useGetChatbotTeamNamesQuery: vi.fn(() => ({})),
  useGetBotImagesQuery: vi.fn(() => ({})),
  useUpdateBotPageBrandMutation: vi.fn(() => [saveBrand, { isLoading: false }]),
  useUploadBotImageMutation: vi.fn(() => [vi.fn()]),
  useRemoveBotImageMutation: vi.fn(() => [vi.fn()]),
  useRestoreBotImageMutation: vi.fn(() => [vi.fn()]),
}));

const saveBrand = vi.hoisted(() => vi.fn(() => ({ unwrap: () => Promise.resolve({}) })));

import { savedBrandPatch } from "../../../hooks/brand/useBrandEditor";
import type { BrandEditor } from "../../../hooks/brand/useBrandEditor";
import { CHANNELS_COPY } from "../../AssistantHome/copy/channels";

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

describe("Look and feel (stage 7: name, logo, one colour, a welcome line)", () => {
  it("has no heading style, theme, cover, share or team photo controls any more", () => {
    render(<LookAndFeel name="Sunrise Mind" editor={editor()} canEdit live botId="bot-1" />);
    expect(screen.queryByRole("radio", { name: /Friendly/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Dark" })).not.toBeInTheDocument();
    expect(screen.queryByText("Team photos")).not.toBeInTheDocument();
    expect(screen.queryByText("Images")).not.toBeInTheDocument();
    expect(screen.getByText(CHANNELS_COPY.look.lookNote)).toBeInTheDocument();
    // The preview is always light, with classic headings.
    expect(preview().getAttribute("data-heading")).toBe("classic");
    expect(preview().getAttribute("data-theme")).toBe("light");
  });

  it("saves the welcome line when it loses focus, trimmed, and shows it in the preview", async () => {
    saveBrand.mockClear();
    render(
      <LookAndFeel
        name="Sunrise Mind"
        editor={editor()}
        canEdit
        live
        botId="bot-1"
        welcome="Hello"
      />,
    );
    expect(screen.getByTestId("phone-preview")).toHaveTextContent("Hello");
    const input = screen.getByLabelText(CHANNELS_COPY.look.welcome);
    expect(input).toHaveAttribute("maxLength", "140");
    fireEvent.change(input, { target: { value: "  Ask us about fees.  " } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(saveBrand).toHaveBeenCalledWith({ id: "bot-1", welcome: "Ask us about fees." }),
    );
  });

  it("offers Undo after a change, and says it's live once saved", () => {
    const e = editor({ changed: true });
    render(<LookAndFeel name="Sunrise Mind" editor={e} canEdit live />);
    expect(screen.getByText("Saved. Live on your page now.")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Undo"));
    expect(e.undo).toHaveBeenCalled();
  });

  it("changes nothing for a viewer", () => {
    saveBrand.mockClear();
    render(
      <LookAndFeel
        name="Sunrise Mind"
        editor={editor()}
        canEdit={false}
        live={false}
        botId="bot-1"
        welcome="Hi"
      />,
    );
    const input = screen.getByLabelText(CHANNELS_COPY.look.welcome);
    expect(input).toBeDisabled();
    fireEvent.blur(input);
    expect(saveBrand).not.toHaveBeenCalled();
  });

  it("only ever sends the logo and colour as the look (ally-be refuses the retired fields)", () => {
    expect(
      savedBrandPatch({
        accent: "#C4512D",
        logo: null,
        headingStyle: "modern",
        theme: "dark",
        coverImage: "img-1",
        peoplePhotos: {},
      }),
    ).toEqual({ accent: "#C4512D", logo: null });
    expect(savedBrandPatch({ coverImage: "img-1" })).toEqual({});
  });
});
