import "@constants";
import React from "react";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { en } from "@constants";
import type { ManualDraftCard } from "@types";

const mockSave = vi.fn();
const mockDismiss = vi.fn();
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSaveManualDraftMutation: () => [mockSave, { isLoading: false }],
  useDismissManualDraftMutation: () => [mockDismiss, { isLoading: false }],
}));

import { DraftsTray } from "../components/DraftsTray";

const draft: ManualDraftCard = {
  id: "d1",
  title: "Explain scores after a roleplay",
  text: "Learners ask why their score moved.",
  relatedPages: [{ slug: "scores", title: "Scores" }],
  savedCode: null,
  discarded: false,
};

const resolved = (value: unknown) => ({ unwrap: () => Promise.resolve(value) });
const rejected = (error: unknown) => ({ unwrap: () => Promise.reject(error) });

const renderTray = (drafts: ManualDraftCard[], onUpdate = vi.fn()) => {
  render(
    <MemoryRouter>
      <DraftsTray drafts={drafts} conversationId="c1" onUpdate={onUpdate} />
    </MemoryRouter>,
  );
  return onUpdate;
};

describe("DraftsTray", () => {
  const copy = en.productManual.drafts;
  beforeEach(() => {
    mockSave.mockReset();
    mockDismiss.mockReset();
  });

  it("is absent with no drafts, and counts the ones not dismissed", () => {
    const { container } = render(
      <MemoryRouter>
        <DraftsTray drafts={[]} conversationId="c1" onUpdate={vi.fn()} />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
    renderTray([draft, { ...draft, id: "d2", discarded: true }]);
    expect(screen.getByText(copy.count(1))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Scores" })).toHaveAttribute(
      "href",
      "/roadmap/manual/scores",
    );
  });

  it("saves to my drafts and settles to the saved code", async () => {
    mockSave.mockReturnValue(resolved({ code: "OPP-42" }));
    const onUpdate = renderTray([draft]);
    fireEvent.click(screen.getByRole("button", { name: copy.save }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith("d1", { savedCode: "OPP-42" }));
    expect(mockSave).toHaveBeenCalledWith({ conversationId: "c1", draftId: "d1" });
  });

  it("sends edited text with the save", async () => {
    mockSave.mockReturnValue(resolved({ code: "OPP-43" }));
    renderTray([draft]);
    fireEvent.click(screen.getByRole("button", { name: copy.edit }));
    fireEvent.change(screen.getByLabelText(copy.textField), { target: { value: "Shorter" } });
    fireEvent.click(screen.getByRole("button", { name: copy.save }));
    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith({
        conversationId: "c1",
        draftId: "d1",
        text: "Shorter",
      }),
    );
  });

  it("shows a saved card as a link to its idea", () => {
    renderTray([{ ...draft, savedCode: "OPP-42" }]);
    expect(screen.getByRole("link", { name: copy.openDraft("OPP-42") })).toHaveAttribute(
      "href",
      "/roadmap/i/OPP-42",
    );
    expect(screen.queryByRole("button", { name: copy.save })).toBeNull();
  });

  it("explains the Idea role on a 403, in words", async () => {
    mockSave.mockReturnValue(rejected({ status: 403 }));
    renderTray([draft]);
    fireEvent.click(screen.getByRole("button", { name: copy.save }));
    expect(await screen.findByRole("alert")).toHaveTextContent(copy.needsIdeaRole);
  });

  it("says a save failed otherwise", async () => {
    mockSave.mockReturnValue(rejected({ status: 500 }));
    renderTray([draft]);
    fireEvent.click(screen.getByRole("button", { name: copy.save }));
    expect(await screen.findByRole("alert")).toHaveTextContent(copy.saveFailed);
  });

  it("dismisses a card", async () => {
    mockDismiss.mockReturnValue(resolved(undefined));
    const onUpdate = renderTray([draft]);
    fireEvent.click(screen.getByRole("button", { name: copy.dismiss }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith("d1", { discarded: true }));
    expect(mockDismiss).toHaveBeenCalledWith({ conversationId: "c1", draftId: "d1" });
  });

  it("collapses and expands", () => {
    renderTray([draft]);
    fireEvent.click(screen.getByRole("button", { name: copy.hide }));
    expect(screen.getByRole("button", { name: copy.show })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});
