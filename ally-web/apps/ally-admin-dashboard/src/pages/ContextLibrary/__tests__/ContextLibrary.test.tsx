import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ContextChunk,
  ContextCollection,
  ContextInsights,
  ContextLoopChange,
  ContextLoopSettings,
  ContextReaderKey,
  ContextRollout,
  ContextUseCase,
} from "@types";

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
  setChunkAudience: vi.fn(),
  createChunk: vi.fn(),
  details: new WeakMap<object, unknown>(),
  insights: undefined as unknown,
  changes: vi.fn(),
  undoChange: vi.fn(),
  dismissGap: vi.fn(),
  loops: undefined as unknown,
  setLoops: vi.fn(),
  runLoops: vi.fn(),
  keys: [] as unknown[],
  createKey: vi.fn(),
  revokeKey: vi.fn(),
  restoreKey: vi.fn(),
  access: { mode: "platform", canEdit: true, orgIds: null } as {
    mode: "platform" | "organisation" | null;
    canEdit: boolean;
    orgIds: string[] | null;
  },
  tenants: [] as Array<{ id: string; name: string }>,
  collectionsArg: vi.fn(),
  chunksArg: vi.fn(),
  rollout: undefined as unknown,
  rolloutError: undefined as unknown,
}));

// Who is looking: the store is not mounted here, so the access hook is set per test.
vi.mock("../contextLibraryScope", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useContextLibraryAccess: () => mocks.access,
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
    useGetContextCollectionsQuery: (arg: unknown) => {
      mocks.collectionsArg(arg);
      return query(mocks.collections);
    },
    useGetPermissionsQuery: () => query(mocks.permissions),
    useGetTenantsQuery: () => query({ data: mocks.tenants }),
    useGetContextChunksQuery: (arg: unknown) => {
      mocks.chunksArg(arg);
      return query({ items: mocks.chunks, total: (mocks.chunks as unknown[]).length });
    },
    useSearchContextLibraryQuery: (args: unknown) => query(mocks.search(args)),
    useGetContextChunkQuery: ({ code }: { code: string }) => {
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
    useSetContextChunkAudienceMutation: mutation(mocks.setChunkAudience),
    useSetContextSourceAudienceMutation: mutation(vi.fn()),
    useCreateContextChunkMutation: mutation(mocks.createChunk),
    useUpdateContextChunkMutation: mutation(vi.fn()),
    useBulkContextChunksMutation: mutation(vi.fn()),
    useLazyGetContextTemplateQuery: () => [vi.fn(), { isFetching: false }],
    useGetContextInsightsQuery: () => query(mocks.insights),
    useGetContextChangesQuery: (args: unknown) => query(mocks.changes(args)),
    useUndoContextChangeMutation: mutation(mocks.undoChange),
    useDismissContextGapMutation: mutation(mocks.dismissGap),
    useGetContextLoopSettingsQuery: () => query(mocks.loops),
    useSetContextLoopSettingsMutation: mutation(mocks.setLoops),
    useRunContextLoopsMutation: mutation(mocks.runLoops),
    useGetContextReaderKeysQuery: () => query(mocks.keys),
    useCreateContextReaderKeyMutation: mutation(mocks.createKey),
    useRevokeContextReaderKeyMutation: mutation(mocks.revokeKey),
    useRestoreContextReaderKeyMutation: mutation(mocks.restoreKey),
    useGetContextRolloutQuery: () =>
      mocks.rolloutError
        ? { ...query(undefined), isError: true, isSuccess: false, error: mocks.rolloutError }
        : query(mocks.rollout),
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
    mocks.access = { mode: "platform", canEdit: true, orgIds: null };
    mocks.tenants = [];
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
      "Insights are per collection. Choose one to see how it's doing.",
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

  it("lets a platform admin choose which organisations an entry reaches", async () => {
    mocks.tenants = [
      { id: "org-a", name: "Acme Helpline" },
      { id: "org-b", name: "Bravo Care" },
    ];
    mocks.setChunkAudience.mockReturnValue(chunk("FP-0001", "x"));
    renderAt("?collection=first_principles&chunk=FP-0001");
    const dialog = screen.getByRole("dialog", { name: "FP-0001" });
    const editor = within(dialog).getByTestId("cl-audience-editor");
    expect(within(editor).getByText("Global")).toBeInTheDocument();
    fireEvent.click(within(editor).getByTestId("cl-audience-change"));

    fireEvent.click(within(dialog).getByTestId("cl-audience-targeted"));
    // "Only these" with nothing ticked would reach no one, so Save waits.
    expect(within(dialog).getByText("Choose at least one organisation.")).toBeInTheDocument();
    expect(within(dialog).getByTestId("cl-audience-save")).toBeDisabled();

    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Bravo Care" }));
    await act(async () => {
      fireEvent.click(within(dialog).getByTestId("cl-audience-save"));
    });
    expect(mocks.setChunkAudience).toHaveBeenCalledWith({
      code: "FP-0001",
      audience: { isGlobal: false, tenantIds: ["org-b"] },
    });
  });

  it("keeps an organisation's own entry targeted at it, with no Change", () => {
    mocks.chunks = [
      chunk("FP-0009", "Theirs.", {
        isGlobal: false,
        tenantIds: ["org-a"],
        ownerTenantId: "org-a",
      }),
    ];
    mocks.tenants = [{ id: "org-a", name: "Acme Helpline" }];
    renderAt("?collection=first_principles&chunk=FP-0009");
    const editor = within(screen.getByRole("dialog", { name: "FP-0009" })).getByTestId(
      "cl-audience-editor",
    );
    expect(within(editor).getByText("Acme Helpline")).toBeInTheDocument();
    expect(within(editor).queryByTestId("cl-audience-change")).not.toBeInTheDocument();
    expect(
      within(editor).getByText("Belongs to an organisation, so it reaches that organisation only."),
    ).toBeInTheDocument();
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

const loopSettings = (over: Partial<ContextLoopSettings> = {}): ContextLoopSettings => ({
  collectionId: "first_principles",
  judgeSampleRate: 0.2,
  paused: [],
  loops: ["judge", "query_learning", "curator", "tuning"],
  searchSetup: {
    weights: { bm25: 1, statement: 1, situations: 0.6 },
    rerank: true,
    mmrLambda: 0.7,
    contextualise: false,
  },
  searchSetupIsDefault: false,
  setupPromotedAt: "2026-11-02T10:00:00Z",
  ...over,
});

const change = (id: string, over: Partial<ContextLoopChange> = {}): ContextLoopChange => ({
  id,
  loop: "curator",
  action: "archive",
  code: "FP-0001",
  reason: "FP-0001: shown 40 times, judged off-topic on 30 of 35",
  evidence: null,
  createdAt: "2026-11-08T02:00:00Z",
  undoneAt: null,
  canUndo: true,
  ...over,
});

const insights = (over: Partial<ContextInsights> = {}): ContextInsights => ({
  collectionId: "first_principles",
  days: 30,
  helping: {
    precision: 0.6,
    judgedResults: 40,
    judgedSearches: 12,
    holdoutNdcg: 0.71,
    holdoutSearches: 25,
    weekly: [
      { week: "2026-10-19T00:00:00Z", precision: 0.5, judged: 10 },
      { week: "2026-10-26T00:00:00Z", precision: null, judged: 0 },
      { week: "2026-11-02T00:00:00Z", precision: 0.65, judged: 30 },
    ],
    byUseCase: [
      {
        useCase: "builder_interview",
        surfaced: 120,
        read: 40,
        cited: 12,
        applied: 5,
        rejectedCitations: 2,
      },
    ],
  },
  missing: [
    {
      id: "gap-1",
      label: "Offline states on mobile",
      kind: "platform",
      queryCount: 7,
      exampleQueries: ["what to show when offline"],
      lastSeenAt: "2026-11-07T00:00:00Z",
      action: "upload_documents",
    },
    {
      id: "gap-2",
      label: "Pricing pages",
      kind: "organisation",
      queryCount: 3,
      exampleQueries: [],
      lastSeenAt: null,
      action: "add_entries",
    },
  ],
  changes: [change("c-1"), change("c-2", { action: "promote_setup", code: null, loop: "tuning" })],
  forOwners: [
    {
      code: "FP-0002",
      statement: "Ask one question at a time.",
      origin: "authored",
      surfaced: 34,
      judged: 25,
      judgedOffTopic: 22,
    },
  ],
  settings: loopSettings(),
  ...over,
});

describe("ContextLibrary Insights", () => {
  beforeEach(() => {
    mocks.collections = [firstPrinciples];
    mocks.permissions = ["edit:admin:context-library", "view:admin:context-library"];
    mocks.chunks = [chunk("FP-0001", "Show the payoff, not the pipeline.")];
    mocks.insights = insights();
    mocks.changes.mockReset();
    mocks.undoChange.mockReset();
    mocks.dismissGap.mockReset();
    toastFn.mockReset();
    toastFn.error.mockReset();
  });

  it("asks for one collection under All, and picking one selects it", () => {
    renderAt("?view=insights");
    fireEvent.click(screen.getByRole("button", { name: "First Principles" }));
    expect(screen.getByTestId("location")).toHaveTextContent("collection=first_principles");
  });

  it("is it helping: judged share with its weekly trend, ranking quality and usage per use case", () => {
    renderAt("?view=insights&collection=first_principles");
    const helping = screen.getByTestId("cl-helping");
    expect(within(helping).getByText("Results judged useful")).toBeInTheDocument();
    expect(within(helping).getByText("60%")).toBeInTheDocument();
    expect(within(helping).getByText("0.71")).toBeInTheDocument();
    expect(within(helping).getByRole("img", { name: "Results judged useful trend" })).toBeTruthy();
    expect(within(helping).getByText("Week of 26 Oct: nothing judged")).toBeInTheDocument();
    const table = within(helping).getByTestId("cl-usage-table");
    expect(within(table).getByRole("rowheader", { name: "Builder interview" })).toBeInTheDocument();
    expect(table).toHaveTextContent("2 turned down");
  });

  it("is it helping: says plainly that nothing has been judged yet, and why", () => {
    mocks.insights = insights({
      helping: { ...insights().helping, precision: null, judgedResults: 0, weekly: [] },
    });
    renderAt("?view=insights&collection=first_principles");
    expect(screen.getByTestId("cl-helping-empty")).toHaveTextContent(
      "Each night the judge grades a sample of searches (20% of them).",
    );
    mocks.insights = insights({
      helping: { ...insights().helping, precision: null, judgedResults: 0, weekly: [] },
      settings: loopSettings({ paused: ["judge"] }),
    });
    cleanup();
    renderAt("?view=insights&collection=first_principles");
    expect(screen.getByTestId("cl-helping-empty")).toHaveTextContent(
      "The judge is paused for this collection",
    );
  });

  it("what's missing: each gap offers its way in, and Dismiss hides it", async () => {
    renderAt("?view=insights&collection=first_principles");
    const gaps = screen.getAllByTestId("cl-gap");
    expect(gaps[0]).toHaveTextContent("Offline states on mobile");
    expect(gaps[0]).toHaveTextContent("7 searches");
    expect(gaps[0]).toHaveTextContent("“what to show when offline”");

    const picker = screen.getByTestId("cl-file-input") as HTMLInputElement;
    const click = vi.spyOn(picker, "click").mockImplementation(() => undefined);
    fireEvent.click(within(gaps[0]).getByRole("button", { name: /Upload documents/ }));
    expect(click).toHaveBeenCalled();

    fireEvent.click(within(gaps[1]).getByRole("button", { name: /Add principles/ }));
    expect(screen.getByTestId("location")).toHaveTextContent("sheet=new");
    fireEvent.keyDown(window, { key: "Escape" });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: 'Dismiss "Pricing pages"' }));
    });
    expect(mocks.dismissGap).toHaveBeenCalledWith({ gapId: "gap-2" });
    expect(screen.queryByText("Pricing pages")).not.toBeInTheDocument();
    expect(toastFn).toHaveBeenCalledWith('"Pricing pages" won\'t be listed again');
  });

  it("what changed: plain words, Undo at once, and put back if the server refuses", async () => {
    renderAt("?view=insights&collection=first_principles");
    const rows = screen.getAllByTestId("cl-change");
    expect(rows[0]).toHaveTextContent("Archived FP-0001");
    expect(rows[0]).toHaveTextContent("Curator");
    expect(rows[1]).toHaveTextContent("Changed how this collection is searched");

    await act(async () => {
      fireEvent.click(within(rows[0]).getByRole("button", { name: "Undo: Archived FP-0001" }));
    });
    expect(mocks.undoChange).toHaveBeenCalledWith({ actionId: "c-1" });
    expect(within(rows[0]).getByTestId("cl-change-undone")).toHaveTextContent("Undone");
    expect(toastFn).toHaveBeenCalledWith("Undone. The system won't make that change again.");

    mocks.undoChange.mockImplementation(() => {
      throw new Error("nope");
    });
    await act(async () => {
      fireEvent.click(
        within(rows[1]).getByRole("button", {
          name: "Undo: Changed how this collection is searched",
        }),
      );
    });
    expect(within(rows[1]).queryByTestId("cl-change-undone")).not.toBeInTheDocument();
    expect(within(rows[1]).getByTestId("cl-change-undo")).toBeInTheDocument();
    expect(toastFn.error).toHaveBeenCalledWith("Couldn't undo that. Nothing changed.");
  });

  it("what changed: Show more pages back with `before`", () => {
    const full = Array.from({ length: 30 }, (_, i) =>
      change(`c-${i}`, { createdAt: `2026-11-08T02:${String(59 - i).padStart(2, "0")}:00Z` }),
    );
    mocks.insights = insights({ changes: full });
    mocks.changes.mockReturnValue([change("older-1", { code: "FP-0009" })]);
    renderAt("?view=insights&collection=first_principles");
    fireEvent.click(screen.getByTestId("cl-changes-more"));
    expect(mocks.changes).toHaveBeenCalledWith({
      collectionId: "first_principles",
      before: "2026-11-08T02:30:00Z",
      limit: 30,
    });
    expect(screen.getAllByTestId("cl-change")).toHaveLength(31);
    // A short page is the last one.
    expect(screen.queryByTestId("cl-changes-more")).not.toBeInTheDocument();
  });

  it("for owners: lists never-useful written entries verbatim, each opening its sheet", () => {
    renderAt("?view=insights&collection=first_principles");
    const owners = screen.getByTestId("cl-owners");
    expect(owners).toHaveTextContent("Shown 34 times · judged off-topic 22 of 25");
    expect(within(owners).getByText("Written")).toBeInTheDocument();
    fireEvent.click(within(owners).getByRole("button", { name: "Ask one question at a time." }));
    expect(screen.getByTestId("location")).toHaveTextContent("chunk=FP-0002");
  });

  it("is read-only without the edit grant: no Undo, no gap actions", () => {
    mocks.permissions = ["view:admin:context-library"];
    renderAt("?view=insights&collection=first_principles");
    expect(screen.queryByTestId("cl-change-undo")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Upload documents/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Dismiss/ })).not.toBeInTheDocument();
  });
});

describe("ContextLibrary loop settings", () => {
  beforeEach(() => {
    mocks.collections = [firstPrinciples];
    mocks.permissions = ["edit:admin:context-library", "view:admin:context-library"];
    mocks.loops = loopSettings({ paused: ["tuning"] });
    mocks.setLoops.mockReset();
    mocks.runLoops.mockReset();
    toastFn.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("asks for a collection under All", () => {
    renderAt("?view=settings");
    expect(screen.getByTestId("cl-loops")).toHaveTextContent(
      "Choose a collection at the top of the page to see its learning loops.",
    );
  });

  it("switches a loop with an undo; on means not paused", async () => {
    renderAt("?view=settings&collection=first_principles");
    expect(screen.getByRole("switch", { name: "Tuning runs for this collection" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    const judge = screen.getByRole("switch", { name: "Judge runs for this collection" });
    expect(judge).toHaveAttribute("aria-checked", "true");
    await act(async () => {
      fireEvent.click(judge);
    });
    expect(mocks.setLoops).toHaveBeenCalledWith({
      collectionId: "first_principles",
      patch: { paused: ["tuning", "judge"] },
    });
    expect(judge).toHaveAttribute("aria-checked", "false");
    expect(toastFn).toHaveBeenCalledWith(
      "Judge paused for First Principles",
      expect.objectContaining({ action: expect.objectContaining({ label: "Undo" }) }),
    );
  });

  it("saves the sample rate once the slider settles", async () => {
    vi.useFakeTimers();
    renderAt("?view=settings&collection=first_principles");
    const slider = screen.getByTestId("cl-sample-rate");
    expect(slider).toHaveValue("20");
    fireEvent.change(slider, { target: { value: "30" } });
    fireEvent.change(slider, { target: { value: "35" } });
    expect(mocks.setLoops).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    expect(mocks.setLoops).toHaveBeenCalledTimes(1);
    expect(mocks.setLoops).toHaveBeenCalledWith({
      collectionId: "first_principles",
      patch: { judgeSampleRate: 0.35 },
    });
  });

  it("summarises the search setup in force and runs the loops on demand", async () => {
    renderAt("?view=settings&collection=first_principles");
    const setup = screen.getByTestId("cl-search-setup");
    expect(setup).toHaveTextContent("Keyword 1.0 · Meaning 1.0 · Situations 0.6");
    expect(setup).toHaveTextContent("Re-rankOn");
    // The help tooltips sit between each label and its value.
    expect(setup).toHaveTextContent(/Diversity.*0\.70/);
    expect(setup).toHaveTextContent(/Fusion constant.*60/);
    expect(setup).toHaveTextContent("Last changed 2 Nov 2026");
    await act(async () => {
      fireEvent.click(screen.getByTestId("cl-run-tuning"));
    });
    expect(mocks.runLoops).toHaveBeenCalledWith({
      collectionId: "first_principles",
      kind: "tuning",
    });
    expect(toastFn).toHaveBeenCalledWith(
      "Started — changes will appear under Insights → What changed?",
    );
  });

  it("is read-only without the edit grant", () => {
    mocks.permissions = ["view:admin:context-library"];
    renderAt("?view=settings&collection=first_principles");
    const loops = screen.getByTestId("cl-loops");
    expect(within(loops).queryByRole("switch")).not.toBeInTheDocument();
    expect(within(loops).getAllByText("Paused")).toHaveLength(1);
    expect(screen.queryByTestId("cl-sample-rate")).not.toBeInTheDocument();
    expect(loops).toHaveTextContent("20% of searches");
    expect(screen.queryByTestId("cl-run-nightly")).not.toBeInTheDocument();
  });
});

describe("Connect Claude Code", () => {
  const key: ContextReaderKey = {
    id: "k-1",
    label: "Work laptop",
    keyPrefix: "clr_AbCdEf",
    lastUsedAt: null,
    createdAt: "2026-11-01T09:00:00Z",
  };
  beforeEach(() => {
    mocks.collections = [firstPrinciples];
    mocks.permissions = ["view:admin:context-library"];
    mocks.keys = [key];
    mocks.createKey.mockReset();
    mocks.revokeKey.mockReset();
    mocks.restoreKey.mockReset();
    toastFn.mockReset();
  });

  it("opens from the header as a history entry, with the endpoint derived from the API base", () => {
    renderAt();
    fireEvent.click(screen.getByTestId("cl-connect-button"));
    expect(screen.getByTestId("location")).toHaveTextContent("sheet=connect");
    const shell = screen.getByTestId("cl-connect-shell");
    expect(shell.textContent).toMatch(
      /^export ALLY_CONTEXT_LIBRARY_URL=\S+\/api\/v1\/context-library\/mcp\nexport ALLY_CONTEXT_LIBRARY_KEY=<your key>$/,
    );
    const row = screen.getByTestId("cl-key-row");
    expect(row).toHaveTextContent("Work laptop");
    expect(row).toHaveTextContent("clr_AbCdEf…");
    expect(row).toHaveTextContent("never used");
  });

  it("shows a new key once, in the shell lines too, and forgets it when you're done", async () => {
    mocks.createKey.mockReturnValue({ ...key, id: "k-2", label: "Desk", key: "clr_secret123" });
    renderAt("?sheet=connect");
    fireEvent.change(screen.getByTestId("cl-connect-label"), { target: { value: " Desk " } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("cl-connect-create"));
    });
    expect(mocks.createKey).toHaveBeenCalledWith({ label: "Desk" });
    expect(screen.getByTestId("cl-connect-key")).toHaveTextContent("clr_secret123");
    expect(screen.getByTestId("cl-connect-fresh")).toHaveTextContent(
      "Copy it now. You won't see this key again.",
    );
    expect(screen.getByTestId("cl-connect-shell")).toHaveTextContent(
      "export ALLY_CONTEXT_LIBRARY_KEY=clr_secret123",
    );
    fireEvent.click(screen.getByRole("button", { name: "I've copied it" }));
    expect(screen.queryByText("clr_secret123", { exact: false })).not.toBeInTheDocument();
  });

  it("tests a new key against the MCP endpoint and says what it found, in plain words", async () => {
    mocks.createKey.mockReturnValue({ ...key, id: "k-2", label: "Desk", key: "clr_secret123" });
    const fetchMock = vi.fn(async () => ({
      status: 200,
      json: async () => ({ jsonrpc: "2.0", id: 1, result: {} }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      renderAt("?sheet=connect");
      // No key in hand, nothing to test: the button arrives with the key.
      expect(screen.queryByTestId("cl-connect-test")).not.toBeInTheDocument();
      fireEvent.change(screen.getByTestId("cl-connect-label"), { target: { value: "Desk" } });
      await act(async () => {
        fireEvent.click(screen.getByTestId("cl-connect-create"));
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId("cl-connect-test"));
      });
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toMatch(/\/api\/v1\/context-library\/mcp$/);
      expect(init.method).toBe("POST");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer clr_secret123");
      expect(JSON.parse(String(init.body))).toMatchObject({ jsonrpc: "2.0", method: "ping" });
      expect(screen.getByTestId("cl-connect-test-result")).toHaveTextContent(
        "Connected. Claude Code can reach the library with this key.",
      );

      fetchMock.mockImplementation(async () => ({
        status: 401,
        json: async () => ({ jsonrpc: "2.0", id: null, error: { code: -32001 } }),
      }));
      await act(async () => {
        fireEvent.click(screen.getByTestId("cl-connect-test"));
      });
      expect(screen.getByTestId("cl-connect-test-result")).toHaveTextContent(
        "The library turned this key away.",
      );

      fetchMock.mockImplementation(async () => {
        throw new TypeError("Failed to fetch");
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId("cl-connect-test"));
      });
      expect(screen.getByTestId("cl-connect-test-result")).toHaveTextContent(
        "Couldn't reach the library from here.",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("revokes at once, with a six-second undo that restores the key", async () => {
    renderAt("?sheet=connect");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Revoke Work laptop" }));
    });
    expect(mocks.revokeKey).toHaveBeenCalledWith("k-1");
    expect(screen.queryByTestId("cl-key-row")).not.toBeInTheDocument();
    const [message, options] = toastFn.mock.calls[0];
    expect(message).toBe("Work laptop revoked");
    expect(options.duration).toBe(6000);
    await act(async () => {
      options.action.onClick();
    });
    expect(mocks.restoreKey).toHaveBeenCalledWith("k-1");
    expect(screen.getByTestId("cl-key-row")).toHaveTextContent("Work laptop");
  });
});

describe("ContextLibrary for an organisation's admin (§10.2)", () => {
  const ORG = "11111111-1111-4111-8111-111111111111";
  const OTHER = "22222222-2222-4222-8222-222222222222";
  const allyGuide: ContextCollection = {
    ...firstPrinciples,
    id: "ally_guide_library",
    name: "Ally Guide Library",
    noun: "entry",
    nounPlural: "entries",
    codePrefix: "AG",
    allowedOrigins: ["authored", "imported", "distilled"],
    allowsOrgChunks: true,
    takesDocuments: false,
    facets: {},
    counts: { active: 3 },
    ownActive: 1,
  };
  const entry = (code: string, statement: string, over: Partial<ContextChunk> = {}) =>
    chunk(code, statement, { collectionId: "ally_guide_library", facets: {}, ...over });

  beforeEach(() => {
    mocks.access = { mode: "organisation", canEdit: true, orgIds: [ORG] };
    mocks.tenants = [
      { id: ORG, name: "Acme Helpline" },
      { id: OTHER, name: "Other Org" },
    ];
    mocks.permissions = [];
    mocks.collections = [allyGuide];
    mocks.chunks = [
      entry("AG-0001", "Rest is part of the work.", { origin: "imported" }),
      entry("AG-0002", "Our out-of-hours escalation.", {
        origin: "authored",
        isGlobal: false,
        tenantIds: [ORG],
        ownerTenantId: ORG,
      }),
    ];
    mocks.collectionsArg.mockReset();
    mocks.chunksArg.mockReset();
  });

  it("shows one organisation's view: no Settings, no Connect, no All, every request scoped", () => {
    renderAt();
    expect(screen.queryByRole("tab", { name: /Settings/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId("cl-connect-button")).not.toBeInTheDocument();
    const switcher = screen.getByTestId("cl-collection-switcher");
    expect(switcher).toHaveValue("ally_guide_library");
    expect(within(switcher).queryByText("All collections")).not.toBeInTheDocument();
    expect(mocks.collectionsArg).toHaveBeenCalledWith({ tenantId: ORG });
    expect(mocks.chunksArg).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: ORG, collectionId: "ally_guide_library" }),
    );
  });

  it("badges each entry with who it reaches, an icon and a word", () => {
    renderAt();
    const rows = screen.getAllByTestId("cl-chunk-row");
    expect(within(rows[0]).getByTestId("cl-audience")).toHaveTextContent("Global");
    expect(within(rows[1]).getByTestId("cl-audience")).toHaveTextContent("Your organisation");
    expect(within(rows[0]).getByTestId("cl-audience").querySelector("svg")).not.toBeNull();
  });

  it("filters Global · My organisation", () => {
    renderAt();
    const filter = screen.getByTestId("cl-audience-filter");
    fireEvent.click(within(filter).getByRole("button", { name: "My organisation" }));
    expect(mocks.chunksArg).toHaveBeenLastCalledWith(
      expect.objectContaining({ audience: "mine", tenantId: ORG }),
    );
  });

  it("asks for the organisation's protocols when it has written none", () => {
    mocks.collections = [{ ...allyGuide, ownActive: 0 }];
    renderAt();
    expect(screen.getByTestId("cl-org-empty")).toHaveTextContent(
      "Add your organisation's protocols so your learners' guide can use them",
    );
  });

  it("scopes Insights to its own entries: no loop changes, no gap dismissal", () => {
    mocks.insights = {
      collectionId: "ally_guide_library",
      days: 30,
      helping: {
        precision: null,
        judgedResults: 0,
        judgedSearches: 0,
        holdoutNdcg: null,
        holdoutSearches: 0,
        weekly: [],
        byUseCase: [],
      },
      missing: [
        {
          id: "g1",
          label: "Night-shift escalation",
          kind: "organisation",
          queryCount: 4,
          exampleQueries: [],
          action: "add_entries",
        },
      ],
      changes: [],
      forOwners: [],
      settings: null,
    };
    renderAt("?view=insights&collection=ally_guide_library");
    expect(screen.getByTestId("cl-helping-empty")).toHaveTextContent(
      "Numbers for your organisation's entries appear here",
    );
    expect(screen.queryByTestId("cl-changes")).not.toBeInTheDocument();
    expect(screen.getByTestId("cl-missing")).toHaveTextContent("Night-shift escalation");
    expect(screen.queryByRole("button", { name: /Dismiss/ })).not.toBeInTheDocument();
  });

  it("keeps Ally's global entries read-only in the sheet", () => {
    renderAt("?collection=ally_guide_library&chunk=AG-0001");
    expect(screen.getByTestId("cl-global-read-only")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
  });

  it("opens Settings as the Library, never as Settings", () => {
    renderAt("?view=settings");
    expect(screen.getByRole("tab", { name: /Library/ })).toHaveAttribute("aria-selected", "true");
  });

  it("lets a platform admin narrow to one named organisation", () => {
    mocks.access = { mode: "platform", canEdit: true, orgIds: null };
    mocks.permissions = ["view:admin:context-library"];
    renderAt("?collection=ally_guide_library");
    fireEvent.change(screen.getByTestId("cl-audience-org"), { target: { value: OTHER } });
    expect(mocks.chunksArg).toHaveBeenLastCalledWith(
      expect.objectContaining({ audience: OTHER, tenantId: undefined }),
    );
    expect(mocks.collectionsArg).toHaveBeenCalledWith(undefined);
  });
});

describe("Content Catalogue items (synced from Studio)", () => {
  const catalogue: ContextCollection = {
    ...firstPrinciples,
    id: "content_catalogue",
    name: "Content Catalogue",
    noun: "item",
    nounPlural: "items",
    codePrefix: "CC",
    allowedOrigins: ["synced"],
    allowsOrgChunks: true,
    takesDocuments: false,
    facets: { itemKind: { label: "Kind", values: ["roleplay"], multi: false } },
    attributes: {},
  };

  beforeEach(() => {
    mocks.access = { mode: "platform", canEdit: true, orgIds: null };
    mocks.permissions = ["view:admin:context-library", "edit:admin:context-library"];
    mocks.collections = [catalogue];
    mocks.chunks = [
      chunk("CC-0001", "Grief at work — a colleague asks for help", {
        collectionId: "content_catalogue",
        origin: "synced",
        syncKey: "scenarios:42",
        facets: { itemKind: "roleplay" },
        attributes: {},
      }),
    ];
  });

  it("links to the item in Studio instead of offering Edit or Archive", () => {
    renderAt("?collection=content_catalogue&chunk=CC-0001");
    expect(screen.getByTestId("cl-synced-note")).toHaveTextContent(
      "Synced from Studio — edit the item there.",
    );
    const links = screen.getAllByTestId("cl-open-in-studio");
    expect(links[0]).toHaveAttribute("href", "/create-simulation/edit/42");
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
  });
});

describe("Release steps (Settings)", () => {
  const rollout = (over: Partial<ContextRollout> = {}): ContextRollout => ({
    automatic: true,
    retireAfterHours: 24,
    maxAttempts: 8,
    corpora: [
      {
        corpus: "character_library",
        collectionId: "first_principles",
        steps: [
          {
            step: "import",
            status: "done",
            attempts: 1,
            startedAt: "2026-11-10T08:00:00Z",
            finishedAt: "2026-11-10T09:00:00Z",
            nextAttemptAt: null,
            lastError: null,
            detail: { importable: 12, complete: 12 },
            waitingUntil: null,
          },
          {
            step: "smoke_check",
            status: "done",
            attempts: 1,
            startedAt: "2026-11-10T09:00:00Z",
            finishedAt: "2026-11-10T09:05:00Z",
            nextAttemptAt: null,
            lastError: null,
            detail: { replayed: 9, answered: 7, inGaps: 2, gapTopics: 1, failed: 0 },
            waitingUntil: null,
          },
          {
            step: "retire",
            status: "pending",
            attempts: 0,
            startedAt: null,
            finishedAt: null,
            nextAttemptAt: null,
            lastError: null,
            detail: { activeChunks: 40 },
            waitingUntil: "2026-11-11T09:05:00Z",
          },
        ],
      },
      {
        corpus: "debrief_knowledge",
        collectionId: "debrief_guidance",
        steps: [
          {
            step: "enrich",
            status: "failed",
            attempts: 2,
            startedAt: "2026-11-10T08:00:00Z",
            finishedAt: null,
            nextAttemptAt: "2026-11-10T10:00:00Z",
            lastError: "Enrichment stopped with 3 passage(s) still waiting.",
            detail: { pending: 3, passagesCopied: 80 },
            waitingUntil: null,
          },
        ],
      },
    ],
    ...over,
  });

  beforeEach(() => {
    mocks.access = { mode: "platform", canEdit: true, orgIds: null };
    mocks.collections = [firstPrinciples];
    mocks.permissions = ["view:admin:context-library"];
    mocks.rollout = rollout();
    mocks.rolloutError = undefined;
  });
  afterEach(() => {
    mocks.rollout = undefined;
    mocks.rolloutError = undefined;
  });

  it("shows each corpus's steps with an icon and a word, counts and when", () => {
    renderAt("?view=settings");
    const section = screen.getByTestId("cl-release-steps");
    expect(within(section).getByRole("heading", { name: "Release steps" })).toBeInTheDocument();
    const corpora = within(section).getAllByTestId("cl-release-corpus");
    expect(corpora).toHaveLength(2);
    const character = corpora[0];
    expect(character).toHaveTextContent("Character library");
    expect(character).toHaveTextContent("into First Principles");
    const steps = within(character).getAllByTestId("cl-release-step");
    expect(steps[0]).toHaveTextContent("Done");
    expect(steps[0]).toHaveTextContent("Character material imported");
    expect(steps[0]).toHaveTextContent("12 of 12 documents imported");
    expect(steps[0]).toHaveTextContent(/Finished 10 Nov/);
    expect(steps[1]).toHaveTextContent(
      "7 of 9 searches found a good answer · 2 in 1 missing topic",
    );
    expect(steps[2]).toHaveTextContent("Waiting");
    expect(steps[2]).toHaveTextContent("Waiting 24 h before removing the old corpus");
    expect(steps[2]).toHaveTextContent(/Due 11 Nov/);
    // An unknown collection falls back to its id rather than vanishing.
    expect(corpora[1]).toHaveTextContent("into debrief_guidance");
    const enrich = within(corpora[1]).getByTestId("cl-release-step");
    expect(enrich).toHaveTextContent("Failed");
    expect(enrich).toHaveTextContent("3 passages still to enrich");
    expect(enrich).toHaveTextContent("Enrichment stopped with 3 passage(s) still waiting.");
    expect(enrich).toHaveTextContent(/Trying again 10 Nov/);
    // Read-only: nothing to press.
    expect(within(section).queryByRole("button")).not.toBeInTheDocument();
  });

  it("says so when the automatic steps are switched off", () => {
    mocks.rollout = rollout({ automatic: false });
    renderAt("?view=settings");
    expect(screen.getByTestId("cl-release-steps")).toHaveTextContent(
      "Automatic release steps are switched off on the server.",
    );
  });

  it("is hidden from an admin the server does not treat as a platform admin", () => {
    mocks.rolloutError = { status: 403, data: { message: "Only a platform admin can do this." } };
    renderAt("?view=settings");
    expect(screen.queryByTestId("cl-release-steps")).not.toBeInTheDocument();
  });

  it("is not part of an organisation admin's page", () => {
    mocks.access = { mode: "organisation", canEdit: true, orgIds: null };
    renderAt("?view=settings");
    expect(screen.queryByTestId("cl-release-steps")).not.toBeInTheDocument();
  });
});
