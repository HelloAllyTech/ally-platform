import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock API hooks — mode state, the findings table, and run history all come entirely from these.
vi.mock("@api", () => ({
  // The header's ⋯ menu holds the UX Signals scan. The menu item is absent
  // without the UX_SIGNALS toggle, which these tests do not grant — but the
  // hook behind it still runs, so the mock has to supply its queries.
  useScanUxSignalsMutation: vi.fn(() => [vi.fn(), { isLoading: false }]),
  useGetUxSignalScansQuery: vi.fn(() => ({ data: { scans: [] } })),
  // The hook invalidates the findings and suggestions queues itself, once it
  // sees a scan finish — so it reaches for the store's util alongside the hooks.
  baseAPI: { util: { invalidateTags: vi.fn() } },
  useGetBugHunterSettingsQuery: vi.fn(),
  useUpdateBugHunterSettingsMutation: vi.fn(),
  useGetBugHuntRunsQuery: vi.fn(),
  useGetBugHuntRunQuery: vi.fn(),
  useGetBugFindingsQuery: vi.fn(),
  useGetBugFindingQuery: vi.fn(),
  useApproveBugFindingMutation: vi.fn(() => [vi.fn(), { isLoading: false }]),
  useRejectBugFindingMutation: vi.fn(() => [vi.fn(), { isLoading: false }]),
  useAnswerBugFindingMutation: vi.fn(() => [vi.fn(), { isLoading: false }]),
  useStartBugFixSessionMutation: vi.fn(() => [vi.fn(), { isLoading: false }]),
  useReleaseBugFindingMutation: vi.fn(() => [vi.fn(), { isLoading: false }]),
  useCancelBugFixSessionMutation: vi.fn(() => [vi.fn(), { isLoading: false }]),
  useMergeBugFindingMutation: vi.fn(() => [vi.fn(), { isLoading: false }]),
  // The Notebook tab's own hooks. Empty rather than absent: mounted only when
  // that section is open, but the module mock has to supply them.
  useGetBugHunterFeatureMapsQuery: () => ({
    data: { cards: [] },
    isLoading: false,
    isError: false,
  }),
  useRefreshBugHunterFeatureMapsMutation: () => [vi.fn(), { isLoading: false }],
  useRemoveBugHunterFeatureMapMutation: () => [vi.fn(), { isLoading: false }],
  useGetBugHunterMemoryQuery: vi.fn(() => ({
    data: { items: [] },
    isLoading: false,
    isError: false,
  })),
  useGetBugHunterRetiredMemoryQuery: vi.fn(() => ({
    data: { items: [] },
    isLoading: false,
    isError: false,
  })),
  useRestoreBugHunterMemoryMutation: vi.fn(() => [vi.fn(), { isLoading: false }]),
  useAddBugHunterMemoryMutation: vi.fn(() => [vi.fn(), { isLoading: false }]),
  useRetireBugHunterMemoryMutation: vi.fn(() => [vi.fn(), { isLoading: false }]),
}));

vi.mock("@utils", () => ({
  formatDate: (d: string) => d,
  formatDateTime: (d: string) => d,
  formatTimestamp: (d: string) => d,
  hasFeature: (features: string[], key: string) => features.includes(key),
}));

// Holds the bug_hunter toggle by default, so every existing assertion below —
// none of which is about the read/act split — keeps seeing the full triage
// surface.
vi.mock("react-redux", () => ({
  useSelector: (selector: any) => selector({ user: { user: {}, features: ["bug_hunter"] } }),
  useDispatch: () => vi.fn(),
}));

vi.mock("@assets", () => ({
  TooltipIcon: () => <svg data-testid="tooltip-icon" />,
}));

// Carbon components stand in as their essential DOM shape — a real ContentSwitcher's
// exact markup isn't what this test verifies, only that the tab wires the right
// label/state/handler into it.
// Real motion timing isn't what a layout test is about.
vi.mock("framer-motion", () => {
  // Defined inside the factory: `vi.mock` is hoisted above this file's own
  // declarations, so a helper referenced from out here would be in its TDZ by
  // the time the factory runs.
  //
  // Motion-only props are dropped rather than spread onto real elements —
  // React warns about `initial={false}` or `layout="position"` on a <div>, and
  // that warning would be this mock's rather than the component's. `li`/`p`
  // exist because the live board's rows and its sweep event line are those.
  const strip = ({ initial, animate, exit, transition, layout, layoutId, ...rest }: any) => rest;
  return {
    motion: {
      div: (props: any) => <div {...strip(props)} />,
      span: (props: any) => <span {...strip(props)} />,
      li: (props: any) => <li {...strip(props)} />,
      p: (props: any) => <p {...strip(props)} />,
    },
    AnimatePresence: ({ children }: any) => <>{children}</>,
    useReducedMotion: () => false,
  };
});

vi.mock("@ally-ui-mono/ui-shared", () => ({
  // Matches the real strip's `data-testid={`tab-${id}`}` so a test can address
  // a page section without going through its label.
  Tabs: ({ items, activeId, onChange }: any) => (
    <div data-testid="tabs">
      {items.map((item: any) => (
        <button
          key={item.id}
          data-testid={`tab-${item.id}`}
          aria-pressed={activeId === item.id}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  ),
  Search: ({ id, labelText, value, onChange, placeholder }: any) => (
    <input
      id={id}
      aria-label={labelText}
      placeholder={placeholder}
      value={value}
      onChange={onChange}
    />
  ),
  ContentSwitcher: ({ selectedIndex, onChange, children }: any) => (
    <div data-testid="mode-switcher" data-selected-index={selectedIndex}>
      {children.map((child: any, index: number) => (
        <button key={index} onClick={() => onChange({ index })} disabled={child.props.disabled}>
          {child.props.text}
        </button>
      ))}
    </div>
  ),
  Switch: ({ text }: any) => <span>{text}</span>,
  Accordion: ({ children }: any) => <div>{children}</div>,
  AccordionItem: ({ title, children }: any) => (
    <div>
      <h3>{title}</h3>
      {children}
    </div>
  ),
  Tooltip: ({ children }: any) => <>{children}</>,
  Table: ({ children }: any) => <table>{children}</table>,
  TableHead: ({ children }: any) => <thead>{children}</thead>,
  TableBody: ({ children }: any) => <tbody>{children}</tbody>,
  TableRow: ({ children, ...rest }: any) => <tr {...rest}>{children}</tr>,
  TableHeader: ({ children, ...rest }: any) => <th {...rest}>{children}</th>,
  TableCell: ({ children, ...rest }: any) => <td {...rest}>{children}</td>,
  Select: ({ id, value, onChange, children, labelText }: any) => (
    <select id={id} aria-label={labelText} value={value} onChange={onChange}>
      {children}
    </select>
  ),
  SelectItem: ({ value, text }: any) => <option value={value}>{text}</option>,
  Button: ({ children, onClick, disabled, iconDescription }: any) => (
    <button onClick={onClick} disabled={disabled} aria-label={iconDescription}>
      {children}
    </button>
  ),
  OverflowMenu: ({ children, iconDescription }: any) => (
    <div role="menu" aria-label={iconDescription}>
      {children}
    </div>
  ),
  OverflowMenuItem: ({ itemText, onClick, disabled }: any) => (
    <button role="menuitem" onClick={onClick} disabled={disabled}>
      {itemText}
    </button>
  ),
  TextArea: ({ value, onChange, placeholder }: any) => (
    <textarea value={value} onChange={onChange} placeholder={placeholder} />
  ),
  SidePanel: ({ open, title, children }: any) =>
    open ? (
      <div data-testid="side-panel">
        <h2>{title}</h2>
        {children}
      </div>
    ) : null,
}));

// @components is a large barrel: @constants -> SimulationCreator.ts reads
// `cellTypes` from it at MODULE-EVAL time (unrelated to this page), and
// `Button` transitively drags in the real Redux store. Providing a plain
// `cellTypes` stub (rather than spreading the real barrel via importOriginal)
// satisfies that load without pulling the real store into this render.
vi.mock("@components", () => ({
  EmptyState: ({ title, subtitle }: any) => (
    <div data-testid="empty-state">
      <h3>{title}</h3>
      <p>{subtitle}</p>
    </div>
  ),
  cellTypes: {
    editableText: "editableText",
    dropdown: "dropdown",
    dropdownSearchable: "dropdownSearchable",
    number: "number",
    image: "image",
    select: "select",
    switch: "switch",
    emoji_select: "emoji_select",
    normalText: "normalText",
    wrapText: "wrapText",
    triggerConditions: "triggerConditions",
    timeInput: "timeInput",
    score: "score",
    textAreaWithDropdown: "textAreaWithDropdown",
    tags: "tags",
  },
}));

vi.mock("@components/action-confirmation-popup", () => ({
  ActionConfirmationPopup: ({ isOpen, title, primaryButton, secondaryButton }: any) =>
    isOpen ? (
      <div data-testid="confirm-popup">
        <p>{title}</p>
        <button onClick={primaryButton.onClick}>{primaryButton.label}</button>
        <button onClick={secondaryButton.onClick}>{secondaryButton.label}</button>
      </div>
    ) : null,
}));

import * as api from "@api";
import { BugHunterMode } from "@types";
import { BugHunter } from "../BugHunter";

/** Renders the router's current address, so a redirect's target is assertable. */
const LocationProbe = () => {
  const { pathname, search } = useLocation();
  return <span data-testid="location">{`${pathname}${search}`}</span>;
};

const mockSettingsQuery = (overrides: Record<string, unknown> = {}) => {
  (api.useGetBugHunterSettingsQuery as any).mockReturnValue({
    data: { mode: BugHunterMode.OFF, updatedBy: null, updatedAt: "2026-08-01T00:00:00.000Z" },
    isLoading: false,
    isError: false,
    ...overrides,
  });
};

const mockRunsQuery = (overrides: Record<string, unknown> = {}) => {
  (api.useGetBugHuntRunsQuery as any).mockReturnValue({
    data: { items: [] },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...overrides,
  });
};

const mockFindingsQuery = (overrides: Record<string, unknown> = {}) => {
  (api.useGetBugFindingsQuery as any).mockReturnValue({
    data: { items: [], count: 0 },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...overrides,
  });
};

const mountPage = (url = "/") =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <BugHunter />
      <LocationProbe />
    </MemoryRouter>,
  );

const onDuty = () =>
  mockSettingsQuery({
    data: { mode: BugHunterMode.AI, updatedBy: 7, updatedAt: "2026-08-01T00:00:00.000Z" },
  });

const finding = (id: string, status: string, title: string) => ({
  id,
  status,
  title,
  source: "code_review",
  repo: "ally-be",
  severity: null,
  escalationQuestion: null,
  createdAt: "2026-08-18",
  updatedAt: "2026-08-18",
});

/**
 * This file covers the page as a *layout*: what is at the top of it, which
 * surfaces appear at all, and where About went. The header's own controls are
 * AgentProfileCard.test's; the table's are the BugFindingsTable suites'.
 */
describe("BugHunter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettingsQuery();
    mockRunsQuery();
    mockFindingsQuery();
    (api.useUpdateBugHunterSettingsMutation as any).mockReturnValue([
      vi.fn(() => ({ unwrap: () => Promise.resolve({}) })),
      { isLoading: false },
    ]);
    (api.useGetBugHuntRunQuery as any).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
    });
  });

  it("leads with the one-line header rather than a page heading", () => {
    mountPage();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Bug Hunter");
  });

  // About left the strip for the header's help button on 2026-10-13.
  it("has two sections, Work and Notebook", () => {
    onDuty();
    mountPage();
    expect(screen.getByTestId("tab-work")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("tab-notebook")).toBeInTheDocument();
    expect(screen.queryByTestId("tab-about")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tab-performance")).not.toBeInTheDocument();
  });

  it("opens About in a side panel from the help button, with every question in it", () => {
    mountPage();
    expect(screen.queryByTestId("side-panel")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "About Bug Hunter" }));
    const panel = screen.getByTestId("side-panel");
    expect(panel).toHaveTextContent("About me");
    expect(panel).toHaveTextContent("What do you do?");
    expect(panel).toHaveTextContent("What's the difference between the two working styles?");
    expect(panel).toHaveTextContent("How do I stop you?");
  });

  // The control says Autonomous and Manual now; the API and the logs say AI
  // and Manual. About names both so the vocabularies still join up.
  it("names the control's labels and the API's in About", () => {
    mountPage();
    fireEvent.click(screen.getByRole("button", { name: "About Bug Hunter" }));
    expect(screen.getByText(/On Autonomous \(AI mode\)/)).toBeInTheDocument();
    expect(screen.getByText(/On Manual it waits/)).toBeInTheDocument();
  });

  // The FAQ pointed at a messages inbox removed on 2026-10-01 and at a shift
  // log that moved to Analytics.
  it("points About at where things are now", () => {
    mountPage();
    fireEvent.click(screen.getByRole("button", { name: "About Bug Hunter" }));
    expect(screen.getByText(/Under Needs you, the first tab of my bugs table/)).toBeInTheDocument();
    expect(screen.getByText(/my shift log on Analytics → Bug Agent/)).toBeInTheDocument();
    expect(screen.queryByText(/In my messages at the top of this page/)).not.toBeInTheDocument();
  });

  it("opens the help panel for an old ?section=about link, and drops the param", () => {
    mountPage("/?section=about");
    expect(screen.getByTestId("side-panel")).toBeInTheDocument();
    expect(screen.getByTestId("location").textContent).toBe("/");
  });

  // The numbers moved to Analytics → Bug Agent; an old link to the section
  // still lands on them rather than on a blank Work tab.
  it("redirects the retired ?section=performance to the Analytics Bug Agent tab", () => {
    onDuty();
    render(
      <MemoryRouter initialEntries={["/bug-hunter?section=performance"]}>
        <Routes>
          <Route path="/bug-hunter" element={<BugHunter />} />
          <Route path="/analytics" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("location").textContent).toBe("/analytics?tab=bug-agent-performance");
  });

  // The header holds the kill switch, so it must be reachable from every
  // section rather than living on one of them.
  it("keeps the header above the tabs, whichever section is open", () => {
    onDuty();
    mountPage();
    fireEvent.click(screen.getByTestId("tab-notebook"));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Bug Hunter");
    expect(screen.getByTestId("bug-hunter-mode-select")).toBeInTheDocument();
  });

  it("reads the open section out of the address bar, so a section is linkable", () => {
    onDuty();
    mountPage("/?section=notebook");
    expect(screen.getByText("My notebook")).toBeInTheDocument();
  });

  it("falls back to Work for a hand-edited section, rather than erroring", () => {
    onDuty();
    mountPage("/?section=telemetry");
    expect(screen.getByTestId("tab-work")).toHaveAttribute("aria-pressed", "true");
  });

  /**
   * The 2026-10-13 cut: the Work tab is the bugs table and nothing else. The
   * live board repeated rows the table already had, the today board was a
   * report on the day, and the UX Signals bar was a nightly job's button.
   */
  it("puts nothing but the bugs table on the Work tab", () => {
    onDuty();
    mockFindingsQuery({
      data: {
        items: [
          finding("f-1", "pending_approval", "A bug awaiting your call"),
          finding("f-2", "fixing", "A bug being fixed right now"),
        ],
        count: 2,
      },
    });
    mountPage();

    expect(screen.queryByText("On it right now")).not.toBeInTheDocument();
    expect(screen.queryByText("Today, by repo")).not.toBeInTheDocument();
    expect(screen.queryByText("UX Signals")).not.toBeInTheDocument();
    expect(screen.queryByText("What I need from you")).not.toBeInTheDocument();
    expect(screen.queryByText("Messages from Bug Hunter")).not.toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "Bugs by what happens next" })).toBeInTheDocument();
    expect(screen.getByText("A bug awaiting your call")).toBeInTheDocument();
  });

  it("takes Fixing N now to the In progress tab, from whichever section you are on", () => {
    onDuty();
    mockFindingsQuery({
      data: {
        items: [
          finding("f-1", "pending_approval", "A bug awaiting your call"),
          finding("f-2", "fixing", "A bug being fixed right now"),
        ],
        count: 2,
      },
    });
    mountPage("/?section=notebook");

    fireEvent.click(screen.getByRole("button", { name: /Fixing 1 now/ }));
    expect(screen.getByTestId("location").textContent).toBe("/?bucket=in_progress");
    expect(screen.getByText("A bug being fixed right now")).toBeInTheDocument();
    expect(screen.queryByText("A bug awaiting your call")).not.toBeInTheDocument();
  });

  it("shows an empty state when there is nothing at all yet", () => {
    onDuty();
    mountPage();
    expect(
      screen.getAllByTestId("empty-state").some(el => el.textContent?.includes("No bugs yet")),
    ).toBe(true);
  });
});
