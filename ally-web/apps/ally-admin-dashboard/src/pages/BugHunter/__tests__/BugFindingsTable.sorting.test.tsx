import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getBugFindings = vi.fn();

vi.mock("@api", () => ({
  useGetBugFindingsQuery: (...args: unknown[]) => getBugFindings(...args),
  useApproveBugFindingMutation: () => [vi.fn(), { isLoading: false }],
  useRejectBugFindingMutation: () => [vi.fn(), { isLoading: false }],
  useStartBugFixSessionMutation: () => [vi.fn(), { isLoading: false }],
  useGetBugHuntRunQuery: () => ({ data: undefined }),
}));

vi.mock("@assets", () => ({ TooltipIcon: () => <svg data-testid="tooltip-icon" /> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@components/action-confirmation-popup", () => ({
  ActionConfirmationPopup: ({ title }: any) => <div role="dialog" aria-label={title} />,
}));

vi.mock("@utils", () => ({
  formatDate: (d: string) => d,
  formatDateTime: (d: string) => d,
  formatTimestamp: (d: string) => d,
  logger: { error: vi.fn() },
}));

vi.mock("@components", () => ({
  cellTypes: {},
  EmptyState: ({ title }: any) => <div data-testid="empty-state">{title}</div>,
}));

vi.mock("@components/error-boundary", () => ({
  ErrorBoundary: ({ children }: any) => <>{children}</>,
}));

vi.mock("../BugFindingDrawer", () => ({
  BugFindingDrawer: ({ id }: { id: string }) => <div data-testid="drawer">{id}</div>,
}));

vi.mock("@ally-ui-mono/ui-shared", () => ({
  Search: ({ id, labelText, value, onChange, placeholder }: any) => (
    <input
      id={id}
      aria-label={labelText}
      placeholder={placeholder}
      value={value}
      onChange={onChange}
    />
  ),
  Button: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  Tooltip: ({ children }: any) => <>{children}</>,
  Table: ({ children }: any) => <table>{children}</table>,
  TableHead: ({ children }: any) => <thead>{children}</thead>,
  // `aria-sort` is the point of several assertions below, so it has to survive
  // the stand-in.
  TableHeader: ({ children, ...rest }: any) => <th {...rest}>{children}</th>,
  TableBody: ({ children }: any) => <tbody>{children}</tbody>,
  TableRow: ({ children, ...rest }: any) => <tr {...rest}>{children}</tr>,
  TableCell: ({ children, ...rest }: any) => <td {...rest}>{children}</td>,
}));

vi.mock("framer-motion", () => ({
  motion: { span: ({ children, ...props }: any) => <span {...props}>{children}</span> },
  useReducedMotion: () => false,
}));

import {
  BugFinding,
  BugFindingSeverity,
  BugFindingSource,
  BugFindingStage,
  BugFindingStatus,
} from "@types";

import { BugFindingsTable } from "../BugFindingsTable";
import { bucketOf } from "../lifecycleBucket";

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

const finding = (overrides: Partial<BugFinding> & { id: string }): BugFinding =>
  ({
    runId: null,
    repo: "ally-be",
    source: BugFindingSource.CODE_REVIEW,
    title: `Bug ${overrides.id}`,
    description: "…",
    file: null,
    evidence: null,
    severity: null,
    proven: false,
    touchesGuardedPath: false,
    reportedBugId: null,
    status: BugFindingStatus.NEW,
    stage: BugFindingStage.NEW,
    stageIsAuto: true,
    stageOverriddenByName: null,
    stageOverriddenAt: null,
    report: null,
    prUrl: null,
    createdAt: ago(1),
    updatedAt: ago(1),
    ...overrides,
  }) as unknown as BugFinding;

/**
 * Opens on the tab the first fixture lives in unless told otherwise — most are
 * NEW, which is Backlog, and the page itself opens on Needs you or In progress.
 */
const mount = (
  items: BugFinding[],
  {
    url = items.length ? `/?bucket=${bucketOf(items[0])}` : "/",
    queryState = {},
  }: { url?: string; queryState?: Record<string, unknown> } = {},
) => {
  getBugFindings.mockReturnValue({
    data: { items, count: items.length },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...queryState,
  });
  return render(
    <MemoryRouter initialEntries={[url]}>
      <BugFindingsTable onShowShortcuts={vi.fn()} canTriage />
    </MemoryRouter>,
  );
};

/** Row titles in the order they are rendered — what every sort assertion reads. */
const titles = () =>
  screen.getAllByRole("button", { name: /^Open bug: / }).map(button => button.textContent ?? "");

const openFilters = () => {
  fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
  return screen.getByRole("dialog", { name: "Filter bugs" });
};

/**
 * The sorting and filtering the table gained in the "narrow 54 bugs to the 8
 * you meant" rebuild: every column sortable, every facet multi-select, both
 * carried in the URL, plus the age/duplicate filters and the paging controls.
 *
 * The other suites own what they always did — `…triage` the row action and
 * the tabs, `…keyboard` the cursor, `…runScope` the sweep scope.
 */
describe("BugFindingsTable — sorting", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sorts by status in lifecycle order rather than alphabetically", () => {
    mount([
      finding({ id: "rejected", status: BugFindingStatus.REJECTED }),
      finding({ id: "live", status: BugFindingStatus.RELEASED }),
      finding({ id: "merged", status: BugFindingStatus.MERGED }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: /^Status/ }));

    // Merged, then Live, then Rejected — the lifecycle's order within Done, not
    // the alphabet's, which would have put Live first.
    expect(titles()).toEqual(["Bug merged", "Bug live", "Bug rejected"]);
  });

  // Repo, severity and stage lost their columns on 2026-10-13; a sort the
  // reader can't see would read as a broken table.
  it("offers sorting only on the columns it shows", () => {
    mount([finding({ id: "a" })]);
    expect(screen.queryByRole("button", { name: /^Repo/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Stage/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Severity/ })).not.toBeInTheDocument();
  });

  it("reports the sort to a screen reader, not just with a caret", () => {
    mount([finding({ id: "a" }), finding({ id: "b" })]);

    fireEvent.click(screen.getByRole("button", { name: /^Bug\b/ }));
    const header = screen.getByRole("columnheader", { name: /^Bug/ });
    expect(header).toHaveAttribute("aria-sort", "ascending");

    fireEvent.click(screen.getByRole("button", { name: /^Bug\b/ }));
    expect(screen.getByRole("columnheader", { name: /^Bug/ })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
  });

  /**
   * The reason sort moved out of `useState`: "the oldest bugs nobody has
   * touched" is a sort plus a filter, and a link that carried only the filter
   * handed the recipient the same rows in a different order, silently.
   */
  it("reads the sort out of the address bar, so a sorted view is linkable", () => {
    mount([finding({ id: "b", title: "Bravo" }), finding({ id: "a", title: "Alpha" })], {
      url: "/?bucket=backlog&sort=title&dir=asc",
    });
    expect(titles()).toEqual(["Alpha", "Bravo"]);
  });
});

describe("BugFindingsTable — the filter panel", () => {
  beforeEach(() => vi.clearAllMocks());

  // The tabs are status now, and stage is derived from it — both facets were
  // a second way to ask a question the tabs already answer.
  it("offers no status or stage facet", () => {
    mount([
      finding({ id: "new", status: BugFindingStatus.NEW, stage: BugFindingStage.NEW }),
      finding({
        id: "approved",
        status: BugFindingStatus.APPROVED,
        stage: BugFindingStage.PRIORITISED,
      }),
    ]);

    const panel = openFilters();
    expect(within(panel).queryByText("Status")).not.toBeInTheDocument();
    expect(within(panel).queryByText("Roadmap stage")).not.toBeInTheDocument();
    expect(within(panel).queryByLabelText(/^Approved/)).not.toBeInTheDocument();
  });

  it("filters by age using the same boundary the Age column tints at", () => {
    mount([
      finding({ id: "fresh", createdAt: ago(2) }),
      finding({ id: "old", createdAt: ago(20) }),
    ]);

    fireEvent.click(within(openFilters()).getByLabelText(/Over a week old/));

    expect(screen.getByText("Bug old")).toBeInTheDocument();
    expect(screen.queryByText("Bug fresh")).not.toBeInTheDocument();
  });

  it("gathers the duplicates, which the ×2 badge could only point at one at a time", () => {
    mount([
      finding({ id: "dup-1", title: "Same bug" }),
      finding({ id: "dup-2", title: "Same bug" }),
      finding({ id: "unique", title: "Different bug" }),
    ]);

    fireEvent.click(within(openFilters()).getByLabelText(/Duplicates only/));

    expect(screen.getAllByText("Same bug")).toHaveLength(2);
    expect(screen.queryByText("Different bug")).not.toBeInTheDocument();
  });

  it("does not offer a duplicates toggle when the window holds no duplicates", () => {
    mount([finding({ id: "a" }), finding({ id: "b" })]);
    expect(within(openFilters()).queryByLabelText(/Duplicates only/)).not.toBeInTheDocument();
  });

  it("counts the active facets on the button, so a shut panel is never a silent filter", () => {
    mount([
      finding({ id: "a", severity: BugFindingSeverity.HIGH }),
      finding({ id: "b", severity: BugFindingSeverity.LOW }),
    ]);

    const panel = openFilters();
    fireEvent.click(within(panel).getByLabelText(/^High/));
    fireEvent.click(within(panel).getByLabelText(/Over a week old/));

    expect(screen.getByRole("button", { name: /Filters\s*2/ })).toBeInTheDocument();
  });

  /**
   * The panel can be shut while a facet is on, so the reset lives outside it,
   * beside the pills. It appears for facets only: a search clears itself with
   * the box's own ×, and a pill row holding nothing but "Clear filters" under
   * one typed letter was the bug.
   */
  it("offers one reset beside the pills whenever a facet is on", () => {
    mount([
      finding({ id: "a", severity: BugFindingSeverity.HIGH }),
      finding({ id: "b", severity: BugFindingSeverity.LOW }),
    ]);
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search bugs"), { target: { value: "Bug" } });
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();

    fireEvent.click(within(openFilters()).getByLabelText(/^High/));
    expect(screen.queryByText("Bug b")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("Bug b")).toBeInTheDocument();
  });

  it("searches the description and the reporter, not only the title", () => {
    mount([
      finding({ id: "a", description: "the retry loop never terminates" }),
      finding({ id: "b", description: "unrelated" }),
    ]);

    fireEvent.change(screen.getByLabelText("Search bugs"), {
      target: { value: "retry loop" },
    });

    expect(screen.getByText("Bug a")).toBeInTheDocument();
    expect(screen.queryByText("Bug b")).not.toBeInTheDocument();
  });
});

describe("BugFindingsTable — paging and selection", () => {
  beforeEach(() => vi.clearAllMocks());

  const many = (count: number) =>
    Array.from({ length: count }, (_, index) =>
      finding({ id: String(index).padStart(3, "0"), createdAt: ago(index + 1) }),
    );

  it("pages at 20 by default", () => {
    mount(many(45));
    expect(titles()).toHaveLength(20);
  });

  it("honours a bigger page size from the address bar", () => {
    cleanup();
    mount(many(45), { url: "/?bucket=backlog&size=50" });
    expect(titles()).toHaveLength(45);
  });

  it("changing the page size re-pages without losing the filters", () => {
    mount(many(45), { url: "/?bucket=backlog&q=Bug" });
    expect(titles()).toHaveLength(20);

    fireEvent.change(screen.getByRole("combobox", { name: "Rows" }), { target: { value: "50" } });
    expect(titles()).toHaveLength(45);
    expect(screen.getByLabelText("Search bugs")).toHaveValue("Bug");
  });

  /**
   * The header checkbox stays page-scoped on purpose — a checkbox in a column
   * header means "this column". Reaching past the page is a separate, named
   * action that states the number it is about to take.
   */
  it("offers select-all-matching only once a selection could reach past the page", () => {
    mount(many(45));
    // Nothing ticked yet, so there is nothing to extend.
    expect(screen.queryByRole("button", { name: /Select all 45/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Select every bug on this page"));
    fireEvent.click(screen.getByRole("button", { name: "Select all 45 matching bugs" }));

    // The prompt is gone once everything matching is ticked — which is how the
    // table says the selection now covers all 45 rather than the 20 on screen.
    expect(screen.queryByRole("button", { name: /Select all 45/ })).not.toBeInTheDocument();
  });

  it("does not offer it when the results already fit on one page", () => {
    mount(many(5));
    fireEvent.click(screen.getByLabelText("Select every bug on this page"));
    expect(screen.queryByRole("button", { name: /Select all/ })).not.toBeInTheDocument();
  });
});

describe("BugFindingsTable — a failed poll", () => {
  beforeEach(() => vi.clearAllMocks());

  /**
   * This list polls every fifteen seconds, and `isError` used to win over
   * `data` — so one timed-out poll replaced the whole table with a line of
   * error text and the next poll brought it back. Caught on the live page.
   */
  it("keeps the rows it already had, under a warning, when a poll fails", () => {
    mount([finding({ id: "a" })], { queryState: { isError: true } });

    expect(screen.getByText("Bug a")).toBeInTheDocument();
    expect(screen.getByText(/didn't get through/)).toBeInTheDocument();
    // Not the hard failure copy, which belongs to a table that has nothing.
    expect(screen.queryByText("Couldn't load the bugs table.")).not.toBeInTheDocument();
  });

  it("still fails loudly when there is nothing to fall back on", () => {
    mount([], { queryState: { isError: true } });

    expect(screen.getByText("Couldn't load the bugs table.")).toBeInTheDocument();
    expect(screen.queryByText(/didn't get through/)).not.toBeInTheDocument();
  });
});
