import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BuilderEvalFixture, BuilderEvalSuite } from "@types";

import { evalSuite, evalSuiteDetail, interviewFixture, reviewFixture } from "./evalTestData";

// @constants reads off the @components barrel at module-eval time, so the barrel is stubbed. The
// page itself renders real Carbon: the tables are exactly what this test is about.
vi.mock("@components", () => ({ cellTypes: {} }));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<any>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

interface QueryResult<T> {
  data?: T;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}
let fixturesResult: QueryResult<BuilderEvalFixture[]>;
let suitesResult: QueryResult<BuilderEvalSuite[]>;
let lastSuitesQuery: { args: any; options: any };
let openedSuiteIds: unknown[];
const refetchFixtures = vi.fn();
const refetchSuites = vi.fn();
const updateFixture = vi.fn();
const startSuite = vi.fn();
const exportFixtures = vi.fn();

vi.mock("@api", () => ({
  useGetBuilderEvalFixturesQuery: () => fixturesResult,
  useGetBuilderEvalSuitesQuery: (args: unknown, options: unknown) => {
    lastSuitesQuery = { args, options };
    return suitesResult;
  },
  useGetBuilderEvalSuiteQuery: (id: unknown) => {
    openedSuiteIds.push(id);
    return {
      data: id ? evalSuiteDetail({ id: String(id) }) : undefined,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
  },
  useLazyExportBuilderEvalFixturesQuery: () => [exportFixtures, { isFetching: false }],
  useUpdateBuilderEvalFixtureMutation: () => [updateFixture, { isLoading: false }],
  useDeleteBuilderEvalFixtureMutation: () => [vi.fn(), { isLoading: false }],
  useStartBuilderEvalSuiteMutation: () => [startSuite, { isLoading: false }],
  useGetBuilderSessionsQuery: () => ({ data: [], isLoading: false, isError: false }),
  useCreateBuilderEvalFixtureFromSessionMutation: () => [vi.fn(), { isLoading: false }],
  useCreateBuilderEvalFixtureFromExportMutation: () => [vi.fn(), { isLoading: false }],
  useImportBuilderEvalFixturesMutation: () => [vi.fn(), { isLoading: false }],
}));

// eslint-disable-next-line import/first
import { en } from "@constants";

// eslint-disable-next-line import/first
import { BuilderEval } from "../BuilderEval";

const strings = en.builder.eval;

const ok = <T,>(value: T) => ({ unwrap: () => Promise.resolve(value) });

const loaded = <T,>(data: T): QueryResult<T> => ({
  data,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <BuilderEval />
    </MemoryRouter>,
  );

const openFixturesTab = () => fireEvent.click(screen.getByTestId("tab-fixtures"));

const fixtures = [
  interviewFixture({ id: "fix-1", name: "Digest email" }),
  reviewFixture({ id: "fix-2", name: "Clean control" }),
  interviewFixture({
    id: "fix-3",
    name: "No checklist yet",
    notes: null,
    active: false,
    payload: { openingMessage: "Hello", adminScript: [], checklist: [] },
  }),
];

beforeEach(() => {
  vi.clearAllMocks();
  openedSuiteIds = [];
  fixturesResult = loaded(fixtures);
  suitesResult = loaded([evalSuite()]);
  updateFixture.mockReturnValue(ok({}));
  startSuite.mockReturnValue(ok(evalSuite({ status: "running", summary: null })));
  exportFixtures.mockReturnValue(ok({ version: 1, fixtures: [{ name: "Digest email" }] }));
});

describe("BuilderEval page", () => {
  it("says up front that fixtures hold production admin text and stay in this database", () => {
    renderPage();

    expect(screen.getByText(strings.privacy.title)).toBeInTheDocument();
    expect(screen.getByText(strings.privacy.body)).toBeInTheDocument();
    expect(strings.privacy.body).toMatch(/database/);
    expect(strings.privacy.body).toMatch(/never committed to a repo/);
  });

  it("goes back to Builder", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(strings.backToBuilder) }));
    expect(navigateMock).toHaveBeenCalledWith("/builder");
  });

  describe("suites", () => {
    it("shows a finished suite's trigger, status, passed, gate violations, corrections, judge score and cost", () => {
      renderPage();

      const row = screen.getByText("4 of 6").closest("tr") as HTMLElement;
      expect(within(row).getByText(strings.trigger.manual)).toBeInTheDocument();
      expect(within(row).getByText(strings.suiteStatus.completed)).toBeInTheDocument();
      // Gate violations 3, corrections 2.
      const cells = within(row)
        .getAllByRole("cell")
        .map(cell => cell.textContent);
      expect(cells).toContain("3");
      expect(cells).toContain("2");
      expect(within(row).getByText("0.50")).toBeInTheDocument();
      expect(within(row).getByText("~$12.00")).toBeInTheDocument();
    });

    it("shows a prompt gate's verdict and whether it was published", () => {
      suitesResult = loaded([
        evalSuite({
          id: "gate-pass",
          trigger: "prompt_gate",
          candidate: { promptCode: "builder_interviewer_system", content: "x" },
          verdict: { pass: true, reasons: [], baselineSuiteId: "b" },
          publishedAt: "2026-10-20T10:00:00.000Z",
          createdAt: "2026-10-20T10:00:00.000Z",
        }),
        evalSuite({
          id: "gate-fail",
          trigger: "prompt_gate",
          candidate: { promptCode: "builder_platform_rules", content: "y" },
          verdict: { pass: false, reasons: ["Gate violations rose."], baselineSuiteId: "b" },
          createdAt: "2026-10-19T10:00:00.000Z",
        }),
      ]);
      renderPage();

      const rows = screen.getAllByRole("row").slice(1);
      expect(within(rows[0]).getByText("builder_interviewer_system")).toBeInTheDocument();
      expect(within(rows[0]).getByText(strings.suites.verdictPass)).toBeInTheDocument();
      expect(within(rows[0]).getByText(strings.suites.published)).toBeInTheDocument();

      expect(within(rows[1]).getByText(strings.suites.verdictFail)).toBeInTheDocument();
      expect(within(rows[1]).getByText(strings.suites.notPublished)).toBeInTheDocument();
    });

    it("lists the newest suite first whatever order they arrive in", () => {
      suitesResult = loaded([
        evalSuite({ id: "older", createdAt: "2026-10-01T00:00:00.000Z" }),
        evalSuite({ id: "newest", createdAt: "2026-10-20T00:00:00.000Z", trigger: "baseline" }),
      ]);
      renderPage();

      const rows = screen.getAllByRole("row").slice(1);
      expect(within(rows[0]).getByText(strings.trigger.baseline)).toBeInTheDocument();
    });

    it("shows a running suite as running, with no totals to mistake for a result", () => {
      suitesResult = loaded([evalSuite({ status: "running", summary: null })]);
      renderPage();

      const row = screen.getAllByRole("row")[1];
      expect(within(row).getByText(strings.suiteStatus.running)).toBeInTheDocument();
      expect(within(row).getByText(strings.suites.workingThrough(6))).toBeInTheDocument();
      expect(within(row).queryByText("0.50")).not.toBeInTheDocument();
    });

    it("refreshes every ten seconds while a suite is running, and not otherwise", () => {
      suitesResult = loaded([evalSuite({ status: "running", summary: null })]);
      renderPage();

      expect(lastSuitesQuery.options.pollingInterval).toBe(10_000);
      expect(screen.getByText(strings.suites.polling(10))).toBeInTheDocument();
    });

    it("sits still when every suite has settled", () => {
      renderPage();

      expect(lastSuitesQuery.options.pollingInterval).toBe(0);
      expect(screen.queryByText(strings.suites.polling(10))).not.toBeInTheDocument();
    });

    it("opens a suite's detail from its row", () => {
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: strings.suites.details }));

      expect(openedSuiteIds).toContain("suite-1");
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("explains the empty list, and points at fixtures when there are none", () => {
      suitesResult = loaded([]);
      renderPage();
      expect(screen.getByText(strings.suites.emptyTitle)).toBeInTheDocument();
      expect(screen.getByText(strings.suites.emptyBody)).toBeInTheDocument();

      fixturesResult = loaded([]);
      renderPage();
      expect(screen.getAllByText(strings.suites.emptyNoFixtures).length).toBeGreaterThan(0);
    });

    it("offers a retry when the suites will not load", () => {
      suitesResult = { data: undefined, isLoading: false, isError: true, refetch: refetchSuites };
      renderPage();

      expect(screen.getByText(strings.suites.loadFailed)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: strings.retry }));
      expect(refetchSuites).toHaveBeenCalled();
    });
  });

  describe("fixtures", () => {
    it("lists them with kind, checklist size, active switch and a short note", () => {
      renderPage();
      openFixturesTab();

      const digest = screen
        .getByRole("button", { name: "Digest email" })
        .closest("tr") as HTMLElement;
      expect(within(digest).getByText(strings.kind.interview)).toBeInTheDocument();
      expect(within(digest).getByText("2")).toBeInTheDocument();
      expect(
        within(digest).getByRole("button", { name: strings.fixtures.activeLabel("Digest email") }),
      ).toBeInTheDocument();
      expect(
        within(digest).getByText("Session 2bc3a5cf asked six questions it never read."),
      ).toBeInTheDocument();

      const control = screen
        .getByRole("button", { name: "Clean control" })
        .closest("tr") as HTMLElement;
      expect(within(control).getByText(strings.kind.prd_review)).toBeInTheDocument();
      expect(
        within(control).getByText(strings.fixtures.checklistNotApplicable),
      ).toBeInTheDocument();
    });

    it("flags an interview fixture that has no checklist yet", () => {
      renderPage();
      openFixturesTab();

      const row = screen
        .getByRole("button", { name: "No checklist yet" })
        .closest("tr") as HTMLElement;
      expect(within(row).getByText(strings.fixtures.checklistEmpty)).toBeInTheDocument();
      expect(within(row).getByText(strings.fixtures.noNote)).toBeInTheDocument();
    });

    it("switches a fixture off from its row", async () => {
      renderPage();
      openFixturesTab();

      fireEvent.click(
        screen.getByRole("button", { name: strings.fixtures.activeLabel("Digest email") }),
      );

      await waitFor(() =>
        expect(updateFixture).toHaveBeenCalledWith({ id: "fix-1", active: false }),
      );
    });

    it("says so when it cannot change a fixture", async () => {
      updateFixture.mockReturnValue({ unwrap: () => Promise.reject({ status: 500 }) });
      renderPage();
      openFixturesTab();

      fireEvent.click(
        screen.getByRole("button", { name: strings.fixtures.activeLabel("Digest email") }),
      );

      await waitFor(() => expect(toastError).toHaveBeenCalledWith(strings.fixtures.toggleFailed));
    });

    it("opens the editing panel from the name or the Edit button", () => {
      renderPage();
      openFixturesTab();

      fireEvent.click(screen.getByRole("button", { name: "Digest email" }));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      // The checklist editor is in it.
      expect(screen.getByLabelText(strings.checklist.textLabel("C1"))).toHaveValue(
        "Reuses the existing digest job",
      );
    });

    it("has the add-fixture actions and the export", () => {
      renderPage();
      openFixturesTab();

      expect(
        screen.getByRole("button", { name: strings.fixtures.fromSession }),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: strings.fixtures.paste })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: strings.fixtures.export })).toBeEnabled();
    });

    it("opens the From a session and Paste an export dialogs", () => {
      renderPage();
      openFixturesTab();

      fireEvent.click(screen.getByRole("button", { name: strings.fixtures.fromSession }));
      expect(screen.getByLabelText(strings.fromSession.sessionLabel)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: strings.cancel }));

      fireEvent.click(screen.getByRole("button", { name: strings.fixtures.paste }));
      expect(screen.getByLabelText(strings.paste.jsonLabel)).toBeInTheDocument();
    });

    it("explains an empty list", () => {
      fixturesResult = loaded([]);
      renderPage();
      openFixturesTab();

      expect(screen.getByText(strings.fixtures.emptyTitle)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: strings.fixtures.export })).toBeDisabled();
    });

    it("offers a retry when the fixtures will not load", () => {
      fixturesResult = {
        data: undefined,
        isLoading: false,
        isError: true,
        refetch: refetchFixtures,
      };
      renderPage();
      openFixturesTab();

      expect(screen.getByText(strings.fixtures.loadFailed)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: strings.retry }));
      expect(refetchFixtures).toHaveBeenCalled();
    });

    describe("export", () => {
      let createObjectURL: ReturnType<typeof vi.fn>;
      let clicked: HTMLAnchorElement[];

      beforeEach(() => {
        createObjectURL = vi.fn(() => "blob:fixtures");
        Object.defineProperty(URL, "createObjectURL", {
          value: createObjectURL,
          configurable: true,
        });
        Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true });
        clicked = [];
        vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
          this: HTMLAnchorElement,
        ) {
          clicked.push(this);
        });
      });

      afterEach(() => {
        vi.restoreAllMocks();
      });

      it("downloads every fixture as one JSON file", async () => {
        renderPage();
        openFixturesTab();
        fireEvent.click(screen.getByRole("button", { name: strings.fixtures.export }));

        await waitFor(() => expect(clicked).toHaveLength(1));
        // Every fixture: no ids narrowing the export.
        expect(exportFixtures).toHaveBeenCalledWith();
        expect(clicked[0].download).toMatch(/^builder-eval-fixtures-\d{4}-\d{2}-\d{2}\.json$/);

        const blob = createObjectURL.mock.calls[0][0] as Blob;
        expect(blob.type).toBe("application/json");
        const text = await new Promise<string>(resolve => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.readAsText(blob);
        });
        expect(JSON.parse(text)).toEqual({
          version: 1,
          fixtures: [{ name: "Digest email" }],
        });
      });

      it("says so when the export fails", async () => {
        exportFixtures.mockReturnValue({ unwrap: () => Promise.reject({ status: 500 }) });
        renderPage();
        openFixturesTab();
        fireEvent.click(screen.getByRole("button", { name: strings.fixtures.export }));

        await waitFor(() => expect(toastError).toHaveBeenCalledWith(strings.fixtures.exportFailed));
        expect(clicked).toHaveLength(0);
      });
    });
  });

  describe("run suite", () => {
    const openDialog = () =>
      fireEvent.click(screen.getByRole("button", { name: strings.suites.runSuite }));
    const submit = (runs: number) =>
      fireEvent.click(screen.getByRole("button", { name: strings.run.submit(runs) }));

    it("is not offered with nothing to run", () => {
      fixturesResult = loaded([]);
      renderPage();
      expect(screen.getByRole("button", { name: strings.suites.runSuite })).toBeDisabled();
    });

    it("warns that it costs about a full interview per run, before anything starts", () => {
      renderPage();
      openDialog();

      expect(screen.getByText(strings.run.costTitle)).toBeInTheDocument();
      expect(screen.getByText(strings.run.costBody)).toBeInTheDocument();
      expect(strings.run.costBody).toMatch(/full Builder interview/);
      expect(startSuite).not.toHaveBeenCalled();
    });

    it("puts a price on it from recent suites: 12 over 6 runs is $2.00 a run", () => {
      renderPage();
      openDialog();

      // Two active fixtures, three runs each: six runs, ~$12.00 at ~$2.00 a run.
      expect(
        screen.getByText(strings.run.costEstimate(6, "~$12.00", "~$2.00")),
      ).toBeInTheDocument();
    });

    it("does not invent a price before a suite has finished", () => {
      suitesResult = loaded([]);
      renderPage();
      openDialog();

      expect(screen.getByText(strings.run.costEstimate(6, null, null))).toBeInTheDocument();
    });

    it("starts with every active fixture ticked and three runs each", async () => {
      renderPage();
      openDialog();

      expect(screen.getByLabelText(/^Digest email/)).toBeChecked();
      expect(screen.getByLabelText(/^Clean control/)).toBeChecked();
      expect(screen.getByLabelText(/^No checklist yet/)).not.toBeChecked();
      expect(screen.getByLabelText(strings.run.repetitionsLabel)).toHaveValue("3");

      submit(6);

      await waitFor(() => expect(startSuite).toHaveBeenCalledTimes(1));
      expect(startSuite).toHaveBeenCalledWith({
        fixtureIds: ["fix-1", "fix-2"],
        repetitions: 3,
      });
      await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(strings.run.started));
      // The dialog closes and the suites tab is showing.
      await waitFor(() =>
        expect(screen.queryByText(strings.run.costTitle)).not.toBeInTheDocument(),
      );
    });

    it("runs the fixtures that were picked, as many times as asked", async () => {
      renderPage();
      openDialog();

      fireEvent.click(screen.getByLabelText(/^Clean control/));
      fireEvent.click(screen.getByLabelText(/^No checklist yet/));
      fireEvent.change(screen.getByLabelText(strings.run.repetitionsLabel), {
        target: { value: "5" },
      });
      submit(10);

      await waitFor(() => expect(startSuite).toHaveBeenCalled());
      expect(startSuite).toHaveBeenCalledWith({
        fixtureIds: ["fix-1", "fix-3"],
        repetitions: 5,
      });
    });

    it("cannot start with nothing ticked", () => {
      renderPage();
      openDialog();
      fireEvent.click(screen.getByRole("button", { name: strings.run.selectNone }));

      expect(screen.getByRole("button", { name: strings.run.submit(0) })).toBeDisabled();
    });

    it("shows the server's reason when it will not start (two suites already running)", async () => {
      startSuite.mockReturnValue({
        unwrap: () =>
          Promise.reject({
            status: 409,
            data: { message: "2 eval suites are already running. Wait for one to finish." },
          }),
      });
      renderPage();
      openDialog();
      submit(6);

      await waitFor(() =>
        expect(toastError).toHaveBeenCalledWith(
          "2 eval suites are already running. Wait for one to finish.",
        ),
      );
      // Still open, so the choice is not lost.
      expect(screen.getByText(strings.run.costTitle)).toBeInTheDocument();
    });
  });
});
