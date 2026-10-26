import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import PromptVersionsSection from "../PromptVersionsSection";
import { PromptVersionSummary } from "@types";

const { mockDiscard, mockPromote, mockToastSuccess } = vi.hoisted(() => ({
  mockDiscard: vi.fn(),
  mockPromote: vi.fn(),
  mockToastSuccess: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: mockToastSuccess, error: vi.fn(), warning: vi.fn(), message: vi.fn() },
}));

vi.mock("@api", () => ({
  useGetLanguagesQuery: () => ({ data: [] }),
  usePromotePromptVersionMutation: () => [mockPromote, { isLoading: false }],
  useTranslatePromptVersionMutation: () => [vi.fn(), { isLoading: false }],
  useDiscardPromptVersionMutation: () => [mockDiscard, { isLoading: false }],
}));

vi.mock("@components", () => ({
  // The real constants (labels under test) read cellTypes while loading.
  cellTypes: new Proxy({}, { get: (_target, key) => String(key) }),
  ActionConfirmationPopup: ({ isOpen, title, description, primaryButton }: any) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        <p>{description}</p>
        <button onClick={primaryButton.onClick}>{`confirm: ${primaryButton.label}`}</button>
      </div>
    ) : null,
  Button: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

const version = (over: Partial<PromptVersionSummary>): PromptVersionSummary => ({
  version: 1,
  status: "history",
  prompt: "",
  provider: null,
  model: null,
  temperature: null,
  contentHash: "h",
  source: null,
  note: null,
  createdBy: null,
  createdAt: "2026-10-26T10:00:00Z",
  publishedAt: null,
  ...over,
});

const versions: PromptVersionSummary[] = [
  version({ version: 3, status: "candidate", prompt: "Hello {name}.\nAsk about {topic}." }),
  version({ version: 2, status: "live", prompt: "Hello {name}.\nBe brief." }),
  version({ version: 1, status: "history", prompt: "Plain text, no variables." }),
];

describe("PromptVersionsSection", () => {
  beforeEach(() => {
    mockDiscard.mockReset();
    mockPromote.mockReset();
    mockDiscard.mockReturnValue({ unwrap: () => Promise.resolve({ promptId: "p1", version: 3 }) });
  });

  const renderSection = () =>
    render(<PromptVersionsSection promptId="p1" versions={versions} onReload={vi.fn()} />);

  it("keeps each version collapsed until it is expanded, then shows its text and variables", () => {
    renderSection();
    expect(screen.queryByTestId("prompt-version-3-text")).toBeNull();

    fireEvent.click(screen.getAllByText("Show text")[0]);

    expect(screen.getByTestId("prompt-version-3-text").textContent).toContain("Ask about {topic}.");
    expect(screen.getByText("{name}")).toBeTruthy();
    expect(screen.getByText("{topic}")).toBeTruthy();
  });

  it("says when a version has no variables", () => {
    renderSection();
    fireEvent.click(screen.getAllByText("Show text")[2]);
    expect(screen.getByText("No variables: the text is used as written.")).toBeTruthy();
  });

  it("compares a version with the live one line by line", () => {
    renderSection();
    fireEvent.click(screen.getAllByText("Show text")[0]);
    fireEvent.click(screen.getByText("Compare with live v2"));

    const diff = screen.getByTestId("prompt-version-3-diff").textContent ?? "";
    expect(diff).toContain("- Be brief.");
    expect(diff).toContain("+ Ask about {topic}.");
    expect(diff).toContain("  Hello {name}.");
  });

  it("offers no comparison on the live version itself", () => {
    renderSection();
    fireEvent.click(screen.getAllByText("Show text")[1]);
    expect(screen.queryByText(/Compare with live/)).toBeNull();
  });

  it("discards a draft only after confirming", async () => {
    renderSection();
    fireEvent.click(screen.getByText("Discard"));
    expect(mockDiscard).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("confirm: Discard"));

    expect(mockDiscard).toHaveBeenCalledWith({ id: "p1", version: 3 });
    await vi.waitFor(() => expect(mockToastSuccess).toHaveBeenCalledWith("Draft v3 discarded."));
  });

  it("shows progress on the Discard button, not on Publish, while discarding", async () => {
    let finish: () => void = () => undefined;
    mockDiscard.mockReturnValue({
      unwrap: () => new Promise(resolve => (finish = () => resolve({}))),
    });
    renderSection();
    fireEvent.click(screen.getByText("Discard"));
    fireEvent.click(screen.getByText("confirm: Discard"));

    expect(await screen.findByText("Discarding…")).toBeTruthy();
    expect(screen.queryByText("Publishing…")).toBeNull();
    finish();
    await vi.waitFor(() => expect(screen.getByText("Discard")).toBeTruthy());
  });

  it("explains why a guard prompt needs confirming, then publishes with the confirmation", async () => {
    mockPromote
      .mockReturnValueOnce({
        unwrap: () =>
          Promise.reject({
            status: 409,
            data: { errorCode: "SKILLS_STORE_PROMPT_PINNED", details: { reason: "guard" } },
          }),
      })
      .mockReturnValueOnce({ unwrap: () => Promise.resolve({ version: 3, previousVersion: 2 }) });
    renderSection();
    fireEvent.click(screen.getByText("Publish"));

    expect(await screen.findByRole("dialog", { name: "This prompt is a check" })).toBeTruthy();
    fireEvent.click(screen.getByText("confirm: It's reviewed — publish"));

    await vi.waitFor(() =>
      expect(mockPromote).toHaveBeenLastCalledWith({
        id: "p1",
        version: 3,
        body: { expectedCurrentVersion: 2, confirmPinnedChange: true },
      }),
    );
  });

  it("offers Discard only on drafts", () => {
    renderSection();
    expect(screen.getAllByText("Discard")).toHaveLength(1);
  });
});
