import React from "react";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

import { COPY } from "../copy";
import { OnboardingStart } from "../OnboardingStart";

const start = {
  resume: null,
  busy: false,
  error: null,
  startWithWebsite: vi.fn(),
  startWithDescription: vi.fn(),
  startWithFiles: vi.fn(),
  startWithInterview: vi.fn(),
};
vi.mock("../useOnboardingStart", () => ({ useOnboardingStart: () => start }));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  // T1's template hooks: no templates and no origin unless a test says so.
  useGetTemplateCatalogueQuery: () => ({ data: undefined, isLoading: false, isError: false }),
  useGetTemplateOriginQuery: () => ({ data: undefined }),
  useApplyDraftTemplateMutation: () => [vi.fn()],
  useGetAssistantTemplatesQuery: () => ({ data: undefined, isLoading: false, isError: false }),
  useInstallTemplateMutation: () => [vi.fn(), { isLoading: false }],
}));

const renderStart = () =>
  render(
    <MemoryRouter initialEntries={["/assistants/new"]}>
      <Routes>
        <Route path="/assistants/new" element={<OnboardingStart />} />
        <Route path="/assistants" element={<div>assistants list</div>} />
        <Route path="/assistants/new/:id" element={<div>session</div>} />
      </Routes>
    </MemoryRouter>,
  );

const pdf = (name = "menu.pdf") => new File(["x"], name, { type: "application/pdf" });

describe("onboarding start: five ways to begin", () => {
  beforeEach(() => {
    // jsdom has no Element.scrollTo; StepFrame scrolls the new screen to the top.
    Element.prototype.scrollTo = vi.fn();
    Object.values(start).forEach(v => typeof v === "function" && (v as any).mockReset?.());
    start.startWithInterview.mockResolvedValue("draft-9");
    start.startWithFiles.mockResolvedValue("draft-3");
  });

  it("opens on five cards, in order, with a close button", () => {
    renderStart();
    const cards = screen.getAllByTestId(/start-method-/).map(c => c.getAttribute("data-testid"));
    expect(cards).toEqual([
      "start-method-website",
      "start-method-documents",
      "start-method-describe",
      "start-method-interview",
      // T1: Start from a template.
      "start-method-template",
    ]);
    expect(screen.getByRole("button", { name: COPY.frame.close })).toBeTruthy();
    expect(screen.queryByPlaceholderText(COPY.start.placeholder)).toBeNull();
  });

  it("close goes back to the assistants list", () => {
    renderStart();
    fireEvent.click(screen.getByRole("button", { name: COPY.frame.close }));
    expect(screen.getByText("assistants list")).toBeTruthy();
  });

  it("shows a method's input, and Back returns to the cards", () => {
    renderStart();
    fireEvent.click(screen.getByTestId("start-method-website"));
    expect(screen.getByPlaceholderText(COPY.start.placeholder)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(COPY.frame.back) }));
    expect(screen.getAllByTestId(/start-method-/)).toHaveLength(5);
  });

  it("documents need an explicit start, then upload what was chosen", async () => {
    renderStart();
    fireEvent.click(screen.getByTestId("start-method-documents"));
    const go = screen.getByRole("button", { name: COPY.start.documentsStart });
    expect((go as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId("onboarding-upload"), { target: { files: [pdf()] } });
    expect(screen.getByText("menu.pdf")).toBeTruthy();
    expect(start.startWithFiles).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: COPY.start.documentsStart }));
    await waitFor(() => expect(start.startWithFiles).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("session")).toBeTruthy();
  });

  it("refuses a format it can't read", () => {
    renderStart();
    fireEvent.click(screen.getByTestId("start-method-documents"));
    fireEvent.change(screen.getByTestId("onboarding-upload"), {
      target: { files: [new File(["x"], "a.png", { type: "image/png" })] },
    });
    expect(screen.getByRole("alert").textContent).toBe(COPY.start.uploadLimits);
  });

  it("interview starts a draft and opens it", async () => {
    renderStart();
    fireEvent.click(screen.getByTestId("start-method-interview"));
    fireEvent.click(screen.getByRole("button", { name: COPY.start.interviewButton }));
    await waitFor(() => expect(start.startWithInterview).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("session")).toBeTruthy();
  });
});
