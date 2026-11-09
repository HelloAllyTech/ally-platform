import { act, fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ContextChunk, ContextCollection, ContextUseCase } from "@types";

const { toastFn } = vi.hoisted(() => ({
  toastFn: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: toastFn }));

// `src/utils` and `src/hooks` pull in the real store; stubbed as the Builder page tests do.
vi.mock("@hooks", () => ({}));
vi.mock("@utils", () => ({}));
vi.mock("@components", () => ({ cellTypes: {} }));

const firstPrinciples: ContextCollection = {
  id: "first_principles",
  name: "First Principles",
  noun: "principle",
  nounPlural: "principles",
  codePrefix: "FP",
  allowedOrigins: ["distilled", "authored"],
  allowsOrgChunks: false,
  takesDocuments: true,
  facets: {
    domain: { label: "Domain", values: ["ux_ui", "data"], multi: false, required: true },
  },
  attributes: {
    rationale: { label: "Why", type: "text", maxChars: 300, shown: true },
  },
  statementMaxChars: 160,
  counts: { active: 2 },
};

const chunk = (code: string, statement: string, over: Partial<ContextChunk> = {}): ContextChunk =>
  ({
    id: code,
    collectionId: "first_principles",
    code,
    origin: "distilled",
    statement,
    body: null,
    situations: [],
    exampleQueries: [],
    keywords: [],
    topics: [],
    facets: { domain: "ux_ui" },
    attributes: { rationale: "People scan before they read." },
    citation: null,
    isGlobal: true,
    tenantIds: [],
    pinned: false,
    confidence: "standard",
    status: "active",
    sourceCount: 2,
    version: 1,
    ...over,
  }) as ContextChunk;

const useCases: ContextUseCase[] = [
  {
    useCase: "builder_interview",
    label: "Builder interview",
    audience: "platform",
    querySensitive: false,
    collections: [{ collectionId: "first_principles", enabled: true, locked: false, weight: 1 }],
  },
  {
    useCase: "ally_guide",
    label: "Ally guide",
    audience: "organisation",
    querySensitive: true,
    collections: [{ collectionId: "first_principles", enabled: false, locked: true, weight: 1 }],
  },
];

const mocks = vi.hoisted(() => ({
  collections: [] as unknown[],
  permissions: [] as string[],
  chunks: [] as unknown[],
  search: vi.fn(),
  setGrant: vi.fn(),
  chunkAction: vi.fn(),
  details: new WeakMap<object, unknown>(),
}));

vi.mock("@api", () => {
  const query = (data: unknown) => ({
    data,
    isLoading: false,
    isFetching: false,
    isError: false,
    isSuccess: true,
    refetch: vi.fn(),
  });
  const mutation = (fn: (...args: unknown[]) => unknown) => () => [
    (...args: unknown[]) => ({ unwrap: () => Promise.resolve(fn(...args)) }),
    { isLoading: false },
  ];
  return {
    useGetContextCollectionsQuery: () => query(mocks.collections),
    useGetPermissionsQuery: () => query(mocks.permissions),
    useGetContextChunksQuery: () =>
      query({ items: mocks.chunks, total: (mocks.chunks as unknown[]).length }),
    useSearchContextLibraryQuery: (args: unknown) => query(mocks.search(args)),
    useGetContextChunkQuery: (code: string) => {
      // Stable per code, as RTK Query's cache is.
      const found = (mocks.chunks as ContextChunk[]).find(c => c.code === code);
      if (found && !mocks.details.has(found)) mocks.details.set(found, { ...found, sources: [] });
      return query(found ? mocks.details.get(found) : undefined);
    },
    useGetContextSourcesQuery: () => query([]),
    useGetContextSourceQuery: () => query(undefined),
    useGetContextUseCasesQuery: () => query(useCases),
    useSetContextGrantMutation: mutation(mocks.setGrant),
    useContextChunkActionMutation: mutation(mocks.chunkAction),
    useCreateContextChunkMutation: mutation(vi.fn()),
    useUpdateContextChunkMutation: mutation(vi.fn()),
    useBulkContextChunksMutation: mutation(vi.fn()),
    useLazyGetContextTemplateQuery: () => [vi.fn(), { isFetching: false }],
  };
});

import { ContextLibrary } from "../ContextLibrary";

const LocationProbe: React.FC = () => {
  const location = useLocation();
  return <div data-testid="location">{location.search}</div>;
};

const renderAt = (search = "") =>
  render(
    <MemoryRouter initialEntries={[`/context-library${search}`]}>
      <Routes>
        <Route
          path="/context-library"
          element={
            <>
              <ContextLibrary />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );

describe("ContextLibrary page", () => {
  beforeEach(() => {
    mocks.collections = [firstPrinciples];
    mocks.permissions = ["edit:admin:context-library", "view:admin:context-library"];
    mocks.chunks = [
      chunk("FP-0001", "Show the payoff, not the pipeline."),
      chunk("FP-0002", "Ask one question at a time.", { confidence: "low", origin: "authored" }),
    ];
    mocks.search.mockReset();
    mocks.setGrant.mockReset();
    mocks.chunkAction.mockReset();
    toastFn.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("renders the shell: views, collection switcher, Add, and the entries", () => {
    renderAt("?collection=first_principles");
    expect(screen.getByRole("heading", { name: "Context Library" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Library/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Insights/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Settings/ })).toBeInTheDocument();
    expect(screen.getByTestId("cl-collection-switcher")).toHaveValue("first_principles");
    expect(screen.getByTestId("cl-add-button")).toBeInTheDocument();
    // The segmented control uses the collection's noun.
    expect(screen.getByRole("button", { name: "Principles" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const rows = screen.getAllByTestId("cl-chunk-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("Show the payoff, not the pipeline.")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Ux ui · from 2 documents")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Low confidence")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Written")).toBeInTheDocument();
  });

  it("deep-links views with ?view=", () => {
    renderAt("?view=insights");
    expect(screen.getByTestId("cl-insights")).toHaveTextContent(
      "Insights arrive once the library has been searched for a while",
    );
    fireEvent.click(screen.getByRole("tab", { name: /Settings/ }));
    expect(screen.getByTestId("location")).toHaveTextContent("view=settings");
  });

  it("shows the first-run hero when the library is empty", () => {
    mocks.collections = [{ ...firstPrinciples, counts: {} }];
    renderAt();
    const hero = screen.getByTestId("cl-first-run");
    expect(hero).toHaveTextContent(
      "Drop documentation. We extract what matters and delete the text.",
    );
    expect(hero).toHaveTextContent(
      "Files are never stored: they're read in memory and discarded, and their text is deleted once extracted, within 24 hours at most.",
    );
  });

  it("searches after a 250ms pause and says plainly when nothing matches", () => {
    vi.useFakeTimers();
    mocks.search.mockReturnValue({ results: [], noConfidentMatch: true });
    renderAt("?collection=first_principles");
    fireEvent.change(screen.getByTestId("cl-search"), { target: { value: "dark patterns" } });
    expect(mocks.search).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(260);
    });
    expect(mocks.search).toHaveBeenCalledWith({
      query: "dark patterns",
      collectionId: "first_principles",
      explain: undefined,
    });
    expect(screen.getByTestId("cl-no-confident-match")).toHaveTextContent(
      "No confident match. This says nothing about what the library holds.",
    );
  });

  it("labels matches with an icon and a word, and shows how each was found on request", () => {
    vi.useFakeTimers();
    mocks.search.mockImplementation(({ explain }: { explain?: boolean }) => ({
      noConfidentMatch: false,
      results: [
        {
          chunk: (mocks.chunks as ContextChunk[])[0],
          band: "strong",
          score: 0.9,
          ...(explain ? { diagnostics: { bm25Rank: 1, statementRank: 2, grade: 3 } } : {}),
        },
      ],
    }));
    renderAt("?collection=first_principles");
    fireEvent.change(screen.getByTestId("cl-search"), { target: { value: "payoff" } });
    act(() => {
      vi.advanceTimersByTime(260);
    });
    expect(screen.getByTestId("cl-band")).toHaveTextContent("Strong match");
    expect(screen.queryByTestId("cl-diagnostics")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("cl-how-found"));
    expect(screen.getByTestId("cl-diagnostics")).toHaveTextContent("Keyword rank #1");
  });

  it("opens an entry in a sheet and returns focus to the row when it closes", () => {
    renderAt("?collection=first_principles");
    const trigger = screen.getByRole("button", { name: "Show the payoff, not the pipeline." });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByTestId("location")).toHaveTextContent("chunk=FP-0001");
    const dialog = screen.getByRole("dialog", { name: "FP-0001" });
    expect(within(dialog).getByText("Why")).toBeInTheDocument();
    expect(within(dialog).getByText("People scan before they read.")).toBeInTheDocument();
    expect(within(dialog).getByText("Where it came from")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Show the payoff, not the pipeline." }),
    );
  });

  it("settings: locked cells say Never allowed and cannot be switched; others flip with an undo", async () => {
    renderAt("?view=settings");
    expect(screen.getByTestId("cl-grant-locked")).toHaveTextContent("Never allowed");
    const toggle = screen.getByRole("switch", { name: "Builder interview reads First Principles" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(mocks.setGrant).toHaveBeenCalledWith({
      useCase: "builder_interview",
      collectionId: "first_principles",
      enabled: false,
    });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toastFn).toHaveBeenCalledWith(
      "Builder interview no longer reads First Principles",
      expect.objectContaining({ action: expect.objectContaining({ label: "Undo" }) }),
    );
  });

  it("settings are read-only without the edit grant", () => {
    mocks.permissions = ["view:admin:context-library"];
    renderAt("?view=settings");
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.getByText("You can see these settings but not change them.")).toBeInTheDocument();
    expect(screen.queryByTestId("cl-add-button")).not.toBeInTheDocument();
  });
});
