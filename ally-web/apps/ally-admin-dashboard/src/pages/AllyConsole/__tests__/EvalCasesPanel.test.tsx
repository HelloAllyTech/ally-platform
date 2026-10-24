import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({
  suites: vi.fn(),
  cases: vi.fn(),
  accept: vi.fn(),
  retire: vi.fn(),
  variants: vi.fn(),
  redTeam: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  access: { current: { canEdit: true } as Record<string, boolean> },
}));

vi.mock(
  "@ally-ui-mono/ui-shared",
  async () =>
    (await import("../../../components/ally-guide/__tests__/uiSharedFakes")).uiSharedFakes,
);
vi.mock("sonner", () => ({
  toast: { error: (m: string) => h.toastError(m), success: (m: string) => h.toastSuccess(m) },
}));
vi.mock("@hooks", () => ({ useAllyGuideAccess: () => h.access.current }));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetAllyGuideEvalSuitesQuery: () => h.suites(),
  useGetAllyGuideEvalCasesQuery: (args: unknown) => h.cases(args),
  useAcceptAllyGuideEvalCaseMutation: () => [h.accept],
  useRetireAllyGuideEvalCaseMutation: () => [h.retire],
  useCreateAllyGuideEvalVariantsMutation: () => [h.variants],
  useGenerateAllyGuideRedTeamMutation: () => [h.redTeam, { isLoading: false }],
}));

// eslint-disable-next-line import/first
import { EvalCasesPanel } from "../EvalCasesPanel";

const ok = (data: unknown) => ({ data, isLoading: false, isError: false, refetch: vi.fn() });
const loadedCases = (data: unknown) => ({
  currentData: data,
  isError: false,
  error: undefined,
  refetch: vi.fn(),
});

const SUITES = [
  {
    id: "s-1",
    key: "smoke",
    name: "Smoke",
    kind: "smoke",
    description: "A quick check",
    active: 10,
    proposed: 0,
    safety: 4,
  },
  {
    id: "s-2",
    key: "regression",
    name: "Regression",
    kind: "regression",
    description: null,
    active: 31,
    proposed: 6,
    safety: 9,
  },
  {
    id: "s-3",
    key: "red_team",
    name: "Red team",
    kind: "red_team",
    description: null,
    active: 12,
    proposed: 20,
    safety: 12,
  },
];

const evalCase = (overrides: Record<string, unknown> = {}) => ({
  id: "c-1",
  suiteId: "s-2",
  source: "failed_turn",
  status: "proposed",
  category: "regression",
  safety: false,
  title: "no_prompt_leak · turn abc12345",
  parentCaseId: null,
  sourceTurnId: "t-1",
  createdAt: "2026-10-22T09:00:00.000Z",
  ...overrides,
});

describe("EvalCasesPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.access.current = { canEdit: true };
    h.suites.mockReturnValue(ok(SUITES));
    h.cases.mockReturnValue(loadedCases([evalCase()]));
    h.accept.mockReturnValue({ unwrap: () => Promise.resolve({}) });
    h.retire.mockReturnValue({ unwrap: () => Promise.resolve({}) });
    h.variants.mockReturnValue({
      unwrap: () =>
        Promise.resolve([
          { id: "v-1", duplicate: false },
          { id: "v-2", duplicate: false },
          { id: "v-3", duplicate: true },
        ]),
    });
    h.redTeam.mockReturnValue({
      unwrap: () =>
        Promise.resolve({
          trackId: "tr-1",
          created: 14,
          duplicates: 2,
          byCategory: {},
          stoppedBy: null,
        }),
    });
  });

  describe("suites", () => {
    it("shows each suite with how many cases are active, waiting and safety", () => {
      render(<EvalCasesPanel />);

      const [smoke, regression] = screen.getAllByTestId("eval-suite");
      expect(smoke).toHaveTextContent("Smoke");
      expect(smoke).toHaveTextContent("10 active, 0 waiting, 4 safety");
      expect(regression).toHaveTextContent("31 active, 6 waiting, 9 safety");
    });

    it("tells a failed load of the suites from an empty one", () => {
      h.suites.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
        error: { status: 500 },
        refetch: vi.fn(),
      });
      render(<EvalCasesPanel />);

      expect(screen.getAllByTestId("ally-load-failed").length).toBeGreaterThan(0);
    });
  });

  describe("cases", () => {
    it("asks for the waiting cases first, and filters by status and suite", () => {
      render(<EvalCasesPanel />);
      expect(h.cases).toHaveBeenLastCalledWith({
        status: "proposed",
        suite: undefined,
        limit: 200,
      });

      fireEvent.click(screen.getByRole("button", { name: "Active" }));
      expect(h.cases).toHaveBeenLastCalledWith({ status: "active", suite: undefined, limit: 200 });

      fireEvent.change(screen.getByLabelText("Suite"), { target: { value: "red_team" } });
      expect(h.cases).toHaveBeenLastCalledWith({ status: "active", suite: "red_team", limit: 200 });

      fireEvent.click(screen.getByRole("button", { name: "All" }));
      expect(h.cases).toHaveBeenLastCalledWith({
        status: undefined,
        suite: "red_team",
        limit: 200,
      });
    });

    it("shows a case's title, suite, category, source and status, and never its input", () => {
      render(<EvalCasesPanel />);

      const row = screen.getByTestId("eval-case-row");
      expect(row).toHaveTextContent("no_prompt_leak · turn abc12345");
      expect(row).toHaveTextContent("Regression");
      expect(row).toHaveTextContent("A failed turn");
      expect(row).toHaveTextContent("Waiting");
      expect(screen.getByTestId("eval-cases-table")).not.toHaveTextContent(
        /message text|learner said/i,
      );
    });

    it("marks a safety case, since failing one fails the gate", () => {
      h.cases.mockReturnValue(
        loadedCases([evalCase({ safety: true, category: "answer_extraction" })]),
      );
      render(<EvalCasesPanel />);

      const row = screen.getByTestId("eval-case-row");
      expect(row).toHaveTextContent("Safety");
      expect(row).toHaveTextContent("answer extraction");
    });

    it("says there are no cases, apart from a failed load", () => {
      h.cases.mockReturnValue(loadedCases([]));
      const { unmount } = render(<EvalCasesPanel />);
      expect(screen.getByText("No cases here")).toBeInTheDocument();
      unmount();

      h.cases.mockReturnValue({
        currentData: undefined,
        isError: true,
        error: { status: 500 },
        refetch: vi.fn(),
      });
      render(<EvalCasesPanel />);
      expect(screen.getAllByTestId("ally-load-failed").length).toBeGreaterThan(0);
    });

    it("shows a skeleton while the list loads", () => {
      h.cases.mockReturnValue(loadedCases(undefined));
      render(<EvalCasesPanel />);

      expect(screen.getByTestId("ally-loading")).toBeInTheDocument();
    });
  });

  describe("changing a case", () => {
    it("accepts a waiting case so it runs in the next gate", async () => {
      render(<EvalCasesPanel />);

      fireEvent.click(screen.getByRole("button", { name: "Accept" }));

      await waitFor(() => expect(h.accept).toHaveBeenCalledWith("c-1"));
      expect(h.toastSuccess).toHaveBeenCalledWith("Accepted. It runs in the next gate.");
    });

    it("retires a case", async () => {
      render(<EvalCasesPanel />);

      fireEvent.click(screen.getByRole("button", { name: "Retire" }));

      await waitFor(() => expect(h.retire).toHaveBeenCalledWith("c-1"));
      expect(h.toastSuccess).toHaveBeenCalledWith("Retired. It no longer runs.");
    });

    it("makes variants, saying how many were new and how many already existed", async () => {
      render(<EvalCasesPanel />);

      fireEvent.click(screen.getByRole("button", { name: "Make variants" }));

      await waitFor(() => expect(h.variants).toHaveBeenCalledWith("c-1"));
      expect(h.toastSuccess).toHaveBeenCalledWith("Made 2 variants; 1 already existed.");
    });

    it("offers no variants of a variant, and nothing at all on a retired case", () => {
      h.cases.mockReturnValue(
        loadedCases([
          evalCase({ id: "v", source: "counterfactual", status: "active" }),
          evalCase({ id: "r", status: "retired" }),
        ]),
      );
      render(<EvalCasesPanel />);

      const [variant, retired] = screen.getAllByTestId("eval-case-row");
      expect(
        within(variant).queryByRole("button", { name: "Make variants" }),
      ).not.toBeInTheDocument();
      expect(within(variant).getByRole("button", { name: "Retire" })).toBeInTheDocument();
      expect(within(retired).queryByRole("button")).not.toBeInTheDocument();
    });

    it("shows the server's message when a change fails", async () => {
      h.accept.mockReturnValue({
        unwrap: () => Promise.reject({ status: 404, data: { message: "Eval case not found" } }),
      });
      render(<EvalCasesPanel />);

      fireEvent.click(screen.getByRole("button", { name: "Accept" }));

      await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("Eval case not found"));
    });

    it("offers no change to an admin who can only view", () => {
      h.access.current = { canEdit: false };
      render(<EvalCasesPanel />);

      const row = screen.getByTestId("eval-case-row");
      expect(within(row).queryByRole("button")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Generate a red-team set…" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("the red team", () => {
    const openDialog = () => {
      fireEvent.click(screen.getByRole("button", { name: "Generate a red-team set…" }));
      return screen.getByRole("dialog", { name: "Generate a red-team set" });
    };

    it("says what it does, what it costs and that every case lands waiting, before it runs", () => {
      render(<EvalCasesPanel />);

      const dialog = openDialog();

      expect(dialog).toHaveTextContent("spends model budget");
      expect(dialog).toHaveTextContent("Every case lands as waiting");
      expect(h.redTeam).not.toHaveBeenCalled();
    });

    it("generates and reports how many cases were written", async () => {
      render(<EvalCasesPanel />);

      fireEvent.click(within(openDialog()).getByRole("button", { name: "Generate" }));

      await waitFor(() => expect(h.redTeam).toHaveBeenCalledTimes(1));
      expect(h.toastSuccess).toHaveBeenCalledWith(
        "Wrote 14 cases (2 already existed). They are waiting for you to accept.",
      );
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("says why it stopped early", async () => {
      h.redTeam.mockReturnValue({
        unwrap: () =>
          Promise.resolve({
            trackId: null,
            created: 0,
            duplicates: 0,
            byCategory: {},
            stoppedBy: "no course has Ally conversations yet",
          }),
      });
      render(<EvalCasesPanel />);

      fireEvent.click(within(openDialog()).getByRole("button", { name: "Generate" }));

      await waitFor(() =>
        expect(h.toastError).toHaveBeenCalledWith(
          "It stopped early: no course has Ally conversations yet.",
        ),
      );
    });

    it("keeps the dialog open and shows the server's message when it fails", async () => {
      h.redTeam.mockReturnValue({
        unwrap: () => Promise.reject({ status: 400, data: { message: "Course not found" } }),
      });
      render(<EvalCasesPanel />);

      fireEvent.click(within(openDialog()).getByRole("button", { name: "Generate" }));

      await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("Course not found"));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });
});
