import React from "react";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

import type { PackReleaseDetail, SafetyPacksOverview } from "../safetyPacksApi";

const h = vi.hoisted(() => ({
  overview: undefined as unknown,
  detail: undefined as unknown,
  create: vi.fn(),
  update: vi.fn(),
  run: vi.fn(),
  release: vi.fn(),
  rollback: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetChatbotsQuery: () => ({ data: { chatbots: [{ id: "bot-1", name: "Test bot" }] } }),
}));
vi.mock("../safetyPacksApi", () => ({
  useGetSafetyPacksQuery: () => ({
    data: h.overview,
    isLoading: false,
    isError: false,
    refetch: h.refetch,
  }),
  useGetSafetyPackReleaseQuery: () => ({ data: h.detail, isLoading: false, isError: false }),
  useCreateSafetyPackDraftMutation: () => [h.create, { isLoading: false }],
  useUpdateSafetyPackDraftMutation: () => [h.update, { isLoading: false }],
  useRunSafetyPackSuiteMutation: () => [h.run, { isLoading: false }],
  useReleaseSafetyPackMutation: () => [h.release, { isLoading: false }],
  useRollbackSafetyPackMutation: () => [h.rollback, { isLoading: false }],
}));

// eslint-disable-next-line import/first
import { blockerText, SafetyPacks } from "../SafetyPacks";

const ok = (value: unknown = {}) => ({ unwrap: () => Promise.resolve(value) });

const content = {
  id: "mental_health",
  version: 3,
  name: "Mental health safety",
  industryLabel: "mental health",
  builderMessage: "On",
  summary: "Line",
  disclaimer: "Not a crisis service",
  rules: ["Rule one", "Rule two"],
  always: ["Always A"],
  never: ["Never B"],
  atRisk: [],
  probes: [],
  requiredSettings: { crisisClassifierEnabled: true },
};

const release = (over: Partial<PackReleaseDetail> = {}): PackReleaseDetail => ({
  id: "r3",
  packId: "mental_health",
  version: 3,
  status: "testing",
  current: false,
  note: null,
  createdBy: 1,
  createdAt: "2026-11-23T00:00:00Z",
  releasedAt: null,
  releasedBy: null,
  rolledBackAt: null,
  rolledBackBy: null,
  previousReleaseId: null,
  testResults: {
    state: "done",
    chatbotId: "bot-1",
    startedAt: "x",
    allPassed: false,
    languages: [
      { language: "en", status: "pass", passed: 4, total: 4, failedCases: [] },
      { language: "hi", status: "fail", passed: 3, total: 4, failedCases: ["hi-2"] },
    ],
  },
  content,
  currentContent: { ...content, version: 2, rules: ["Rule one"] },
  diff: {
    lists: {
      rules: { added: ["Rule two"], removed: [] },
      always: { added: [], removed: [] },
      never: { added: [], removed: [] },
      atRisk: { added: [], removed: [] },
      probes: { added: [], removed: [] },
    },
    text: [],
    classifier: null,
    changed: true,
  },
  blockers: ["language_failed:hi"],
  ...over,
});

const overview = (canRollBack = true): SafetyPacksOverview => ({
  enabled: true,
  languages: ["en", "hi"],
  suiteVersion: "v1",
  packs: [
    {
      packId: "mental_health",
      name: "Mental health safety",
      codeVersion: 2,
      currentReleaseId: "r2",
      currentVersion: 2,
      canRollBack,
      chatbots: 4,
      releases: [
        {
          ...release(),
          diff: undefined,
          content: undefined,
          currentContent: undefined,
          blockers: undefined,
        } as never,
        {
          ...release({ id: "r2", version: 2, status: "released", current: true }),
        } as never,
      ],
    },
  ],
});

describe("Safety packs (stage 9)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.overview = overview();
    h.detail = release();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "prompt").mockReturnValue("");
  });

  it("lists packs with their current release and history", () => {
    render(<SafetyPacks />);
    expect(screen.getByText("Current release: version 2 · Code version 2")).toBeTruthy();
    expect(screen.getByText("4 chatbots use it")).toBeTruthy();
    expect(screen.getByText("Languages a release must pass: en, hi")).toBeTruthy();
  });

  it("shows the diff and per-language results, and blocks a release with a failing language", () => {
    render(<SafetyPacks />);
    fireEvent.click(screen.getAllByText("Open")[0]);
    expect(screen.getByTestId("pack-diff").textContent).toContain("Rule two");
    const langs = screen.getByTestId("pack-suite-languages").textContent ?? "";
    expect(langs).toContain("EN: Pass");
    expect(langs).toContain("HI: Fail");
    expect(screen.getByText("Failed in HI.")).toBeTruthy();
    const button = screen.getByText("Release to every chatbot") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("releases a draft that passed everywhere", async () => {
    h.detail = release({ blockers: [] });
    h.release.mockReturnValue(ok());
    render(<SafetyPacks />);
    fireEvent.click(screen.getAllByText("Open")[0]);
    fireEvent.click(screen.getByText("Release to every chatbot"));
    await waitFor(() => expect(h.release).toHaveBeenCalledWith("r3"));
    expect(await screen.findByText("Released. Owners will be emailed.")).toBeTruthy();
  });

  it("runs the crisis check on the chosen chatbot", async () => {
    h.run.mockReturnValue(ok());
    render(<SafetyPacks />);
    fireEvent.click(screen.getAllByText("Open")[0]);
    fireEvent.click(screen.getByText("Run crisis check"));
    await waitFor(() => expect(h.run).toHaveBeenCalledWith({ id: "r3", chatbotId: "bot-1" }));
  });

  it("rolls back in one click and refreshes", async () => {
    h.rollback.mockReturnValue(ok());
    render(<SafetyPacks />);
    fireEvent.click(screen.getByTestId("pack-rollback-mental_health"));
    await waitFor(() =>
      expect(h.rollback).toHaveBeenCalledWith({ packId: "mental_health", note: undefined }),
    );
    expect(h.refetch).toHaveBeenCalled();
  });

  it("disables rollback when there is nothing to go back to", () => {
    h.overview = overview(false);
    render(<SafetyPacks />);
    const button = screen.getByTestId("pack-rollback-mental_health") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("creates a draft from the current release and opens it", async () => {
    h.create.mockReturnValue(ok({ id: "r9" }));
    render(<SafetyPacks />);
    fireEvent.click(screen.getByText("New draft from current"));
    await waitFor(() =>
      expect(h.create).toHaveBeenCalledWith({ packId: "mental_health", source: "current" }),
    );
  });

  it("words every gate reason", () => {
    expect(blockerText("content_changed")).toContain("changed");
    expect(blockerText("language_missing:ta")).toBe("Not checked in TA.");
  });
});
