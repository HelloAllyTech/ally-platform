import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { en } from "@constants";
import { BugFindingSource, BugFindingStatus } from "@types";

import { BugFindingDrawer } from "../BugFindingDrawer";

const startFixSession = vi.fn();
const cancelFixSession = vi.fn();
const mergeFinding = vi.fn();
const releaseFinding = vi.fn();
const editDescription = vi.fn();
const setStage = vi.fn();
const getBugFinding = vi.fn();
const getFindingDecisions = vi.fn(() => ({ data: [], isError: false }));

vi.mock("@api", () => ({
  useGetBugFindingQuery: (...args: unknown[]) => getBugFinding(...args),
  useGetBugFindingDecisionsQuery: () => getFindingDecisions(),
  useApproveBugFindingMutation: () => [vi.fn(), { isLoading: false }],
  useRejectBugFindingMutation: () => [vi.fn(), { isLoading: false }],
  useAnswerBugFindingMutation: () => [vi.fn(), { isLoading: false }],
  useStartBugFixSessionMutation: () => [startFixSession, { isLoading: false }],
  useCancelBugFixSessionMutation: () => [cancelFixSession, { isLoading: false }],
  useMergeBugFindingMutation: () => [mergeFinding, { isLoading: false }],
  useReleaseBugFindingMutation: () => [releaseFinding, { isLoading: false }],
  useEditBugFindingDescriptionMutation: () => [editDescription, { isLoading: false }],
  useSetBugFindingStageMutation: () => [setStage, { isLoading: false }],
}));

// The @hooks barrel reaches the real Redux store (useScenarioReportsSocket ->
// store -> baseAPI), which the mocked @api above cannot satisfy. Nothing in
// this drawer uses it, so stubbing the barrel keeps the render self-contained
// — the same reason BugHunter.test.tsx stubs it.
vi.mock("@hooks", () => ({}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

// @constants reads `cellTypes` off the @components barrel at module-eval time,
// which drags the whole barrel (and the real store with it) into this render.
// Same stub, same reason as BugHunter.test.tsx.
vi.mock("@components", () => ({ cellTypes: {} }));

vi.mock("@utils", () => ({
  formatDate: (d: string) => d,
  formatDateTime: (d: string) => d,
  formatTimestamp: (d: string) => d,
}));
vi.mock("@assets", () => ({ TooltipIcon: () => <svg data-testid="tooltip-icon" /> }));

vi.mock("@ally-ui-mono/ui-shared", () => ({
  Button: ({ children, onClick, disabled, kind }: any) => (
    <button onClick={onClick} disabled={disabled} data-kind={kind}>
      {children}
    </button>
  ),
  // Rendered open: the menu's own open/close is Carbon's, and what these tests
  // care about is which items it offers.
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
  TextArea: ({ value, onChange, placeholder, labelText, invalid, invalidText }: any) => (
    <>
      <textarea
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        aria-label={labelText}
      />
      {invalid && <p>{invalidText}</p>}
    </>
  ),
  Tooltip: ({ children }: any) => <>{children}</>,
  Select: ({ id, value, onChange, children, labelText }: any) => (
    <select id={id} aria-label={labelText} value={value} onChange={onChange}>
      {children}
    </select>
  ),
  SelectItem: ({ value, text }: any) => <option value={value}>{text}</option>,
  Checkbox: ({ id, labelText, checked, onChange }: any) => (
    <label htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e, { checked: e.target.checked })}
      />
      {labelText}
    </label>
  ),
  SidePanel: ({ open, title, children }: any) =>
    open ? (
      <div data-testid="side-panel">
        <h2>{title}</h2>
        {children}
      </div>
    ) : null,
}));

vi.mock("@components/action-confirmation-popup", () => ({
  ActionConfirmationPopup: ({ title, description, children, primaryButton }: any) => (
    <div data-testid="confirm-popup">
      <p>{title}</p>
      <p>{description}</p>
      {children}
      <button onClick={primaryButton.onClick} disabled={primaryButton.disabled}>
        {primaryButton.label}
      </button>
    </div>
  ),
}));

const finding = (overrides: Record<string, unknown> = {}) => ({
  id: "finding-1",
  runId: null,
  repo: "ally-be",
  source: "reported_bug",
  title: "Terms link is not formatted correctly",
  description: "The external emergency-services link renders unstyled.",
  originalDescription: null,
  descriptionEditedBy: null,
  descriptionEditedAt: null,
  file: "src/app.ts",
  evidence: null,
  severity: null,
  proven: false,
  touchesGuardedPath: false,
  reportedBugId: null,
  status: BugFindingStatus.NEW,
  prUrl: null,
  escalationQuestion: null,
  escalationAnswer: null,
  escalationAnsweredBy: null,
  escalationAnsweredAt: null,
  decidedBy: null,
  decidedAt: null,
  sessionRunUrl: null,
  sessionRunId: null,
  releaseTag: null,
  releaseRunUrl: null,
  releasedBy: null,
  releasedAt: null,
  cancelledBy: null,
  cancelledAt: null,
  decisionReason: null,
  decisionNote: null,
  confidence: null,
  regressionOf: null,
  regressed: false,
  rediscoveredCount: 0,
  miss: null,
  latestFixVerdict: null,
  independentVerification: null,
  chain: {
    links: [
      { link: "observed", status: "present", evidence: "reporter's steps" },
      { link: "reproduced", status: "present", evidence: "seen" },
      { link: "located", status: "present", evidence: "code in ally-be" },
      { link: "changed", status: "present", evidence: "1 file" },
      { link: "resolved", status: "weak", evidence: "test only" },
      { link: "held", status: "missing", evidence: null },
    ],
    mergeable: true,
    blocking: [],
  },
  pr: null,
  budget: {
    caps: { sessions: 2, attempts: 4, escalations: 1, usd: 15, minutes: 120 },
    used: { sessions: 0, attempts: 0, escalations: 0, usd: 0, minutes: 0 },
    exhausted: null,
    overriddenBy: null,
    overriddenAt: null,
  },
  stage: "new",
  stageIsAuto: true,
  stageOverriddenBy: null,
  stageOverriddenByName: null,
  stageOverriddenAt: null,
  report: null,
  createdAt: "2026-08-17",
  updatedAt: "2026-08-17",
  events: [],
  steps: [],
  releasable: false,
  releaseTarget: null,
  releaseBlockedReason: null,
  ...overrides,
});

const renderDrawer = (data: Record<string, unknown>, canTriage = true) => {
  getBugFinding.mockReturnValue({ data, isLoading: false, isError: false });
  return render(<BugFindingDrawer id="finding-1" onClose={vi.fn()} canTriage={canTriage} />);
};

/** Opens one of the drawer's collapsed sections by its header. */
const openSection = (title: string | RegExp) =>
  fireEvent.click(screen.getByRole("button", { name: title }));

const menu = () => within(screen.getByRole("menu", { name: "More actions" }));
const decisionBlock = () => within(screen.getByTestId("decision-block"));

describe("BugFindingDrawer — the decision log (OPP-0776)", () => {
  it("shows every orchestration choice about the bug, with the pick not taken", () => {
    getFindingDecisions.mockReturnValueOnce({
      data: [
        {
          id: "dec-5",
          runId: null,
          findingId: "finding-1",
          repo: "ally-be",
          point: "D5",
          owner: "model",
          menu: ["fix", "ask_human"],
          pick: "fix",
          shadowOwner: "rule",
          shadowPick: "fix",
          reason: "verified with a reproduction",
          inputs: null,
          model: "gemini-2.5-flash",
          outcome: null,
          createdAt: "2026-10-08T10:00:00Z",
        },
        {
          id: "dec-7",
          runId: "run-verify",
          findingId: "finding-1",
          repo: "ally-be",
          point: "D7",
          owner: "rule",
          menu: ["retry_fix", "escalate_model", "ask_human", "close"],
          pick: "retry_fix",
          shadowOwner: "model",
          shadowPick: "ask_human",
          reason: "Rule-owned point; the model shadows.",
          inputs: null,
          model: "gemini-2.5-flash",
          outcome: null,
          createdAt: "2026-10-08T11:00:00Z",
        },
      ],
      isError: false,
    });
    renderDrawer(finding());
    const log = screen.getByTestId("finding-decisions");
    expect(log).toHaveTextContent("How I decided");
    // Closed by default: the log is audit trail, not the decision.
    expect(screen.queryByTestId("decision-D5")).not.toBeInTheDocument();
    openSection(/How I decided/);
    const d5 = screen.getByTestId("decision-D5");
    // Plain words for the point, never the pipeline's D-number.
    expect(d5).toHaveTextContent("Fix now or hold");
    expect(d5).not.toHaveTextContent("D5");
    expect(d5).toHaveTextContent("fix");
    expect(d5).toHaveTextContent("by the model");
    expect(d5).toHaveTextContent("both agreed");
    const d7 = screen.getByTestId("decision-D7");
    expect(d7).toHaveTextContent("retry_fix");
    expect(d7).toHaveTextContent("by the rule");
    expect(d7).toHaveTextContent("the model would have: ask_human");
  });

  it("shows no log for a bug nothing has decided about yet", () => {
    renderDrawer(finding());
    expect(screen.queryByTestId("finding-decisions")).toBeNull();
  });
});

describe("BugFindingDrawer — a finding from a PR review (OPP-0785)", () => {
  it("links to the pull request it was found on, and to the comment once made", () => {
    renderDrawer(
      finding({
        pr: {
          number: 42,
          url: "https://github.com/HelloAllyTech/ally-be/pull/42",
          headSha: "abc",
          commentUrl: "https://github.com/HelloAllyTech/ally-be/pull/42#pullrequestreview-1",
        },
      }),
    );
    openSection(/How sure I am/);
    const pr = screen.getByTestId("finding-pr");
    expect(pr).toHaveTextContent("Found reviewing pull request #42");
    expect(pr).toHaveTextContent("my comment is on the PR");
    expect(pr.querySelector("a")?.getAttribute("href")).toBe(
      "https://github.com/HelloAllyTech/ally-be/pull/42#pullrequestreview-1",
    );
  });
});

describe("BugFindingDrawer — fix session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    startFixSession.mockReturnValue({ unwrap: () => Promise.resolve({}) });
    releaseFinding.mockReturnValue({ unwrap: () => Promise.resolve({}) });
  });

  it("locates first on a human report nobody has located: the button reads Locate the fault and sends no force", async () => {
    renderDrawer(finding({ independentVerification: null }));
    fireEvent.click(screen.getByText("Put me on it"));
    expect(screen.getByTestId("locate-first")).toBeInTheDocument();
    expect(screen.getByText("Locate the fault")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Locate the fault"));
    await waitFor(() => expect(startFixSession).toHaveBeenCalled());
    expect(startFixSession.mock.calls[0][0]).toEqual({ id: "finding-1" });
  });

  it("offers a fix session on a new, untriaged bug — the whole point of the button", () => {
    renderDrawer(finding());
    expect(screen.getByText("Put me on it")).toBeInTheDocument();
  });

  it("starts the session on confirm, without asking for a repo", async () => {
    renderDrawer(finding({ independentVerification: "confirmed" }));
    fireEvent.click(screen.getByText("Put me on it"));
    fireEvent.click(screen.getByText("Start now"));

    await waitFor(() => expect(startFixSession).toHaveBeenCalledWith({ id: "finding-1" }));
  });

  it("offers a codebase picker when the bug has no repo, defaulting to letting Bug Hunter classify it", async () => {
    renderDrawer(finding({ independentVerification: "confirmed", repo: null }));
    fireEvent.click(screen.getByText("Put me on it"));

    expect(screen.getByText("Start now")).not.toBeDisabled();
    expect(screen.getByTestId("repo-picker")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Start now"));
    await waitFor(() => expect(startFixSession).toHaveBeenCalledWith({ id: "finding-1" }));
  });

  it("sends the codebase the admin picked, which is how a bug the classifier could not place gets fixed", async () => {
    renderDrawer(finding({ independentVerification: "confirmed", repo: null }));
    fireEvent.click(screen.getByText("Put me on it"));

    fireEvent.change(screen.getByLabelText("Which codebase?"), { target: { value: "ally-web" } });
    fireEvent.click(screen.getByText("Start now"));

    await waitFor(() =>
      expect(startFixSession).toHaveBeenCalledWith({ id: "finding-1", repo: "ally-web" }),
    );
  });

  it("shows what the bug has cost so far against its budget", () => {
    renderDrawer(
      finding({
        budget: {
          caps: { sessions: 2, attempts: 4, escalations: 1, usd: 15, minutes: 120 },
          used: { sessions: 1, attempts: 2, escalations: 0, usd: 3.5, minutes: 22 },
          exhausted: null,
          overriddenBy: null,
          overriddenAt: null,
        },
      }),
    );
    openSection(/How sure I am/);

    expect(screen.getByTestId("budget")).toHaveTextContent(
      "1 of 2 sessions · 2 of 4 attempts · $3.50 of $15.00",
    );
  });

  it("keeps Start disabled once the budget is spent until the admin ticks the override, then sends force", async () => {
    renderDrawer(
      finding({
        independentVerification: "confirmed",
        budget: {
          caps: { sessions: 2, attempts: 4, escalations: 1, usd: 15, minutes: 120 },
          used: { sessions: 2, attempts: 4, escalations: 0, usd: 6, minutes: 70 },
          exhausted: { kind: "sessions", at: "2026-10-07T05:00:00Z" },
          overriddenBy: null,
          overriddenAt: null,
        },
      }),
    );
    fireEvent.click(screen.getByText("Put me on it"));

    expect(screen.getByTestId("budget-override")).toHaveTextContent("Budget spent (sessions)");
    expect(screen.getByText("Start now")).toBeDisabled();

    fireEvent.click(screen.getByLabelText("Start anyway, past the budget"));
    expect(screen.getByText("Start now")).not.toBeDisabled();

    fireEvent.click(screen.getByText("Start now"));
    await waitFor(() =>
      expect(startFixSession).toHaveBeenCalledWith({ id: "finding-1", force: true }),
    );
  });

  it("shows no picker for a bug that already has a repo", () => {
    renderDrawer(finding({ repo: "ally-be" }));
    fireEvent.click(screen.getByText("Put me on it"));
    expect(screen.queryByTestId("repo-picker")).not.toBeInTheDocument();
  });

  it("hides the button while a session is already in flight", () => {
    renderDrawer(finding({ status: BugFindingStatus.FIXING }));
    expect(screen.queryByText("Put me on it")).not.toBeInTheDocument();
  });

  it("offers a retry, worded as such, after a failed attempt", () => {
    renderDrawer(finding({ status: BugFindingStatus.FAILED }));
    expect(screen.getByText("Ask me to try again")).toBeInTheDocument();
  });

  it("explains the wait while queued rather than showing an idle drawer", () => {
    renderDrawer(finding({ status: BugFindingStatus.QUEUED }));
    expect(screen.getByText(/waiting for a runner/i)).toBeInTheDocument();
  });

  it("links to the running session from the menu once the backend has correlated it", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    renderDrawer(
      finding({ status: BugFindingStatus.FIXING, sessionRunUrl: "https://github.com/run/1" }),
    );
    fireEvent.click(menu().getByText("Watch me work"));
    expect(open).toHaveBeenCalledWith("https://github.com/run/1", "_blank", "noopener,noreferrer");
    open.mockRestore();
  });

  it("surfaces the backend's own refusal message rather than a generic one", async () => {
    const { toast } = await import("sonner");
    startFixSession.mockReturnValue({
      unwrap: () => Promise.reject({ data: { message: "Bug Hunter is OFF." } }),
    });
    renderDrawer(finding({ independentVerification: "confirmed" }));

    fireEvent.click(screen.getByText("Put me on it"));
    fireEvent.click(screen.getByText("Start now"));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Bug Hunter is OFF."));
  });
});

describe("BugFindingDrawer — stop fix session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cancelFixSession.mockReturnValue({ unwrap: () => Promise.resolve({}) });
  });

  it("offers to stop a session that's queued", () => {
    renderDrawer(finding({ status: BugFindingStatus.QUEUED }));
    expect(screen.getByText("Stop fix session")).toBeInTheDocument();
  });

  it("offers to stop a session that's actively fixing", () => {
    renderDrawer(finding({ status: BugFindingStatus.FIXING }));
    expect(screen.getByText("Stop fix session")).toBeInTheDocument();
  });

  it("hides the stop button once nothing is running — the whole point is stopping something in flight", () => {
    renderDrawer(finding({ status: BugFindingStatus.NEW }));
    expect(screen.queryByText("Stop fix session")).not.toBeInTheDocument();
  });

  it("hides the stop button once the session has already settled", () => {
    renderDrawer(finding({ status: BugFindingStatus.MERGED }));
    expect(screen.queryByText("Stop fix session")).not.toBeInTheDocument();
  });

  it("asks for confirmation before cancelling, rather than stopping on the first click", () => {
    renderDrawer(finding({ status: BugFindingStatus.FIXING }));
    fireEvent.click(screen.getByText("Stop fix session"));

    expect(screen.getByTestId("confirm-popup")).toBeInTheDocument();
    expect(screen.getByText("Stop this fix session?")).toBeInTheDocument();
    expect(cancelFixSession).not.toHaveBeenCalled();
  });

  it("cancels the session only once the confirm dialog is accepted", async () => {
    renderDrawer(finding({ status: BugFindingStatus.FIXING }));
    fireEvent.click(screen.getByText("Stop fix session"));
    fireEvent.click(screen.getByText("Stop it"));

    await waitFor(() => expect(cancelFixSession).toHaveBeenCalledWith("finding-1"));
  });

  it("surfaces the backend's own refusal message rather than a generic one", async () => {
    const { toast } = await import("sonner");
    cancelFixSession.mockReturnValue({
      unwrap: () => Promise.reject({ data: { message: "Session already finished." } }),
    });
    renderDrawer(finding({ status: BugFindingStatus.QUEUED }));

    fireEvent.click(screen.getByText("Stop fix session"));
    fireEvent.click(screen.getByText("Stop it"));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Session already finished."));
  });

  it("falls back to a generic failure message when the backend gives none", async () => {
    const { toast } = await import("sonner");
    cancelFixSession.mockReturnValue({ unwrap: () => Promise.reject({}) });
    renderDrawer(finding({ status: BugFindingStatus.QUEUED }));

    fireEvent.click(screen.getByText("Stop fix session"));
    fireEvent.click(screen.getByText("Stop it"));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't stop the fix session."));
  });

  it("offers a retry worded the same as a failed attempt once cancelled, not a fresh 'put me on it'", () => {
    renderDrawer(finding({ status: BugFindingStatus.CANCELLED }));
    expect(screen.getByText("Ask me to try again")).toBeInTheDocument();
    expect(screen.queryByText("Stop fix session")).not.toBeInTheDocument();
  });

  it("credits who stopped it by name in the work log, never as a user id", () => {
    renderDrawer(
      finding({
        status: BugFindingStatus.CANCELLED,
        cancelledBy: 9,
        cancelledByName: "Priya",
        cancelledAt: "2026-08-19",
      }),
    );
    openSection(/My work log/);
    const log = screen.getByTestId("work-log");
    expect(log).toHaveTextContent("Priya");
    expect(log).toHaveTextContent("stopped the fix session");
    expect(screen.queryByText(/user #/)).not.toBeInTheDocument();
  });
});

describe("BugFindingDrawer — release to production", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    releaseFinding.mockReturnValue({ unwrap: () => Promise.resolve({}) });
  });

  it("offers the release only once the backend says it is releasable", () => {
    renderDrawer(
      finding({
        status: BugFindingStatus.MERGED,
        releasable: true,
        releaseTarget: "Ally backend (ECS)",
      }),
    );
    expect(screen.getByText("Release to production")).toBeInTheDocument();
  });

  it("never offers a release on an unmerged bug", () => {
    renderDrawer(finding({ status: BugFindingStatus.PR_OPENED }));
    expect(screen.queryByText("Release to production")).not.toBeInTheDocument();
  });

  it("names what will be deployed in the confirmation, so the blast radius is visible", () => {
    renderDrawer(
      finding({
        status: BugFindingStatus.MERGED,
        releasable: true,
        releaseTarget: "Admin dashboard (CloudFront)",
      }),
    );
    fireEvent.click(screen.getByText("Release to production"));

    expect(screen.getByText(/Admin dashboard \(CloudFront\)/)).toBeInTheDocument();
  });

  it("releases on confirm", async () => {
    renderDrawer(
      finding({ status: BugFindingStatus.MERGED, releasable: true, releaseTarget: "x" }),
    );
    fireEvent.click(screen.getByText("Release to production"));
    fireEvent.click(screen.getByText("Release"));

    await waitFor(() => expect(releaseFinding).toHaveBeenCalledWith("finding-1"));
  });

  it("explains why a merged fix cannot be released here instead of just hiding the button", () => {
    renderDrawer(
      finding({
        status: BugFindingStatus.MERGED,
        releasable: false,
        releaseBlockedReason: "A change in libs/ ships in all three apps.",
      }),
    );
    expect(screen.getByText(/ships in all three apps/)).toBeInTheDocument();
    expect(screen.queryByText("Release to production")).not.toBeInTheDocument();
  });

  it("says the fix is merged but not deployed when a release fails, and offers a retry", () => {
    renderDrawer(
      finding({
        status: BugFindingStatus.RELEASE_FAILED,
        releaseTag: "v1.4.2",
        releasable: true,
        releaseTarget: "Ally backend (ECS)",
      }),
    );
    expect(screen.getByText(/still merged to master/i)).toBeInTheDocument();
    expect(screen.getByText("Retry release")).toBeInTheDocument();
  });

  it("shows what the last failed fix session wrote for the retry, leading with what to try next", () => {
    renderDrawer(
      finding({
        status: BugFindingStatus.FAILED,
        postmortem: {
          attempts: 2,
          failingCheck: "full suite",
          lastFailure: "queue.spec.ts: expected 3 jobs, received 2",
          rootCauseHypothesis: "the reconnect hook fires before the subscriber is re-registered",
          whyItFailed: "both fixes re-registered on connect, not on ready",
          tryNext: "register the listener inside the ready callback",
          repoGotcha: "scheduler specs need a live Redis on the runner",
          recordedAt: "2026-09-26T02:10:00.000Z",
          runId: "run-9",
        },
      }),
    );
    // The summary sits in the decision block, beside the retry it decides on.
    const block = decisionBlock();
    expect(block.getByText("Why my last fix session failed")).toBeInTheDocument();
    expect(block.getByText("2 attempt(s) · full suite")).toBeInTheDocument();
    expect(block.getByText("What a retry should do differently")).toBeInTheDocument();
    expect(block.getByText("register the listener inside the ready callback")).toBeInTheDocument();
    expect(block.getByText("Ask me to try again")).toBeInTheDocument();
    // The raw record is one click further down.
    expect(
      screen.queryByText("queue.spec.ts: expected 3 jobs, received 2"),
    ).not.toBeInTheDocument();
    fireEvent.click(block.getByText("Show the full post-mortem"));
    expect(screen.getByText("queue.spec.ts: expected 3 jobs, received 2")).toBeInTheDocument();
    expect(screen.getByText(/A trap in this repo I hit/)).toBeInTheDocument();
  });

  it("shows how the session understood the feature before fixing, leading with where the value lives", () => {
    renderDrawer(
      finding({
        status: BugFindingStatus.PR_OPENED,
        study: {
          feature: "CMS tooltips shown in the selected language",
          entryPoints: ["AppTooltip.tsx"],
          howItWorksToday: [
            "tooltips + tooltip_translations tables, edited under Manage Tooltips",
            "GET /v1/tooltips/active translates by language",
            "AppTooltip.tsx fetches without a language",
          ],
          valueLivesIn: "database",
          workingSibling: "Checklist.tsx passes languageCode: i18n.language",
          rootCause: "The app never sends its language, so the server answers in English.",
          approach: "Send languageCode from AppTooltip and accept it on the endpoint.",
          filesToChange: ["AppTooltip.tsx", "api/tooltips.ts"],
          leaveAlone: ["en.json — tooltips are not locale keys"],
          otherRepos: ["ally-be"],
          risks: [],
          testPlan: "AppTooltip.test.tsx asserts the hook is called with the language",
          previousStudyWasWrongBecause: null,
          recordedAt: "2026-10-10T08:00:00.000Z",
          runId: "run-3",
          review: {
            concerns: ["Name the client that sends languageCode on the backend half."],
            model: "gemini-2.5-flash",
            at: "2026-10-10T08:00:10.000Z",
          },
        },
      }),
    );
    expect(screen.queryByText("How I understood it before fixing")).not.toBeInTheDocument();
    openSection(/How I planned the fix/);
    expect(screen.getByText("How I understood it before fixing")).toBeInTheDocument();
    expect(screen.getByText("a database table an admin edits")).toBeInTheDocument();
    expect(screen.getByText("GET /v1/tooltips/active translates by language")).toBeInTheDocument();
    expect(
      screen.getByText("Checklist.tsx passes languageCode: i18n.language"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Reviewed by gemini-2.5-flash — concerns/)).toBeInTheDocument();
    expect(
      screen.getByText("Name the client that sends languageCode on the backend half."),
    ).toBeInTheDocument();
  });

  it("shows no study box before a session has studied the bug", () => {
    renderDrawer(finding({ status: BugFindingStatus.APPROVED, study: null }));
    expect(screen.queryByText("How I understood it before fixing")).not.toBeInTheDocument();
  });

  it("shows where the verifier located the fault, with the repair, and no fix session for a data fault", () => {
    renderDrawer(
      finding({
        status: BugFindingStatus.PENDING_APPROVAL,
        source: BugFindingSource.REPORTED_BUG,
        independentVerification: "confirmed",
        faultLocation: {
          layer: "data",
          repo: "ally-be",
          evidence: "GET /api/v1/learn/scenarios/public?languageCode=mr returns the English titles",
          repair:
            "Generate and publish Marathi translations for the four public scenarios in Studio.",
        },
      }),
    );
    openSection(/How sure I am/);
    expect(screen.getByTestId("fault-location")).toBeInTheDocument();
    expect(screen.getByText("Fault located in data (ally-be)")).toBeInTheDocument();
    expect(screen.getByText(/returns the English titles/)).toBeInTheDocument();
    expect(screen.getByText(/Generate and publish Marathi translations/)).toBeInTheDocument();
    expect(screen.getByText(/This is not a code bug/)).toBeInTheDocument();
  });

  it("shows the case chain link by link and refuses a merge until the admin reads a broken chain", () => {
    renderDrawer(
      finding({
        status: BugFindingStatus.PR_OPENED,
        prUrl: "https://github.com/HelloAllyTech/ally-web/pull/798",
        chain: {
          links: [
            { link: "observed", status: "present", evidence: "reporter's steps" },
            {
              link: "reproduced",
              status: "present",
              evidence: "GET …?languageCode=mr returns English",
            },
            { link: "located", status: "present", evidence: "data in ally-be" },
            {
              link: "changed",
              status: "broken",
              evidence: "the fault is in data and the change is in locale_file",
            },
            { link: "resolved", status: "missing", evidence: null },
            { link: "held", status: "missing", evidence: null },
          ],
          mergeable: false,
          blocking: ["changed", "resolved"],
        },
      }),
    );
    openSection(/How sure I am/);
    expect(screen.getByTestId("case-chain")).toBeInTheDocument();
    expect(screen.getByTestId("chain-changed")).toHaveAttribute("data-status", "broken");
    expect(
      screen.getByText(/the fault is in data and the change is in locale_file/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText("Merge it"));
    expect(screen.getByTestId("merge-chain-warning")).toBeInTheDocument();
    expect(
      screen.getByText(/changed in that mechanism, resolved for the reporter/),
    ).toBeInTheDocument();
    expect(screen.getByText("Merge").closest("button")).toBeDisabled();
  });

  it("shows no post-mortem box for a bug no session has given up on", () => {
    renderDrawer(finding({ status: BugFindingStatus.FAILED, postmortem: null }));
    expect(screen.queryByText("Why my last fix session failed")).not.toBeInTheDocument();
  });

  it("shows the shipped version once released, and who released it in the work log", () => {
    renderDrawer(
      finding({
        status: BugFindingStatus.RELEASED,
        releaseTag: "v1.4.2",
        releasedBy: 7,
        releasedByName: "Priya",
        releasedAt: "2026-08-17",
      }),
    );
    expect(decisionBlock().getByText(/live in production as v1\.4\.2/i)).toBeInTheDocument();
    openSection(/My work log/);
    const log = within(screen.getByTestId("work-log"));
    expect(log.getByText("Priya")).toBeInTheDocument();
    expect(log.getByText("released it to production")).toBeInTheDocument();
  });

  it("says 'An admin' rather than a user id when the backend sends no name", () => {
    renderDrawer(
      finding({
        status: BugFindingStatus.RELEASED,
        releaseTag: "v1.4.2",
        releasedBy: 7,
        releasedAt: "2026-08-17",
      }),
    );
    openSection(/My work log/);
    expect(within(screen.getByTestId("work-log")).getByText("An admin")).toBeInTheDocument();
    expect(screen.queryByText(/#7/)).not.toBeInTheDocument();
  });

  it("says how it went live when a release run from GitHub shipped it, rather than printing a dash for the tag", () => {
    renderDrawer(
      finding({
        status: BugFindingStatus.RELEASED,
        releaseTag: null,
        releasedBy: null,
        releasedAt: "2026-09-26",
        releaseRunUrl: "https://github.com/helloallytech/ally-be/actions/runs/5150",
      }),
    );
    expect(screen.getByText(/somebody ran from GitHub/i)).toBeInTheDocument();
    expect(screen.queryByText(/live in production as/i)).not.toBeInTheDocument();
    openSection(/My work log/);
    expect(screen.queryByText(/released it to production/)).not.toBeInTheDocument();
  });
});

describe("BugFindingDrawer — multi-repo plan", () => {
  const steps = [
    {
      id: "step-0",
      stepIndex: 0,
      repo: "ally-be",
      stepSummary: "Add the emergencyServicesUrl field",
      status: BugFindingStatus.MERGED,
      prUrl: "https://github.com/pr/1",
      releaseTag: "v1.4.2",
      sessionRunUrl: null,
      releaseRunUrl: null,
    },
    {
      id: "step-1",
      stepIndex: 1,
      repo: "ally-web",
      stepSummary: "Render it as a proper link",
      status: BugFindingStatus.BLOCKED,
      prUrl: null,
      releaseTag: null,
      sessionRunUrl: null,
      releaseRunUrl: null,
    },
  ];

  beforeEach(() => vi.clearAllMocks());

  it("shows the plan in ship order, with each step's own state", () => {
    renderDrawer(finding({ status: BugFindingStatus.COORDINATING, steps }));

    expect(screen.getByText("This fix spans 2 repos")).toBeInTheDocument();
    // Scoped to the step: the parent's own meta line names ally-be too.
    const stepOne = screen.getByText("Step 1").closest("li") as HTMLElement;
    expect(within(stepOne).getByText("ally-be")).toBeInTheDocument();
    expect(screen.getByText("Add the emergencyServicesUrl field")).toBeInTheDocument();
    expect(screen.getByText("Step 2")).toBeInTheDocument();
    expect(screen.getByText("Render it as a proper link")).toBeInTheDocument();
  });

  it("says the order matters, since that is the whole reason for the plan", () => {
    renderDrawer(finding({ status: BugFindingStatus.COORDINATING, steps }));
    expect(screen.getByText(/release them in the same order/i)).toBeInTheDocument();
  });

  it("offers no fix-session button on a coordinated parent — Bug Hunter drives it", () => {
    renderDrawer(finding({ status: BugFindingStatus.COORDINATING, steps }));
    expect(screen.queryByText("Put me on it")).not.toBeInTheDocument();
  });

  it("offers one release for the whole sequence once every step is merged", () => {
    renderDrawer(
      finding({
        status: BugFindingStatus.MERGED,
        steps: steps.map(step => ({ ...step, status: BugFindingStatus.MERGED })),
        releasable: true,
        releaseTarget: "Ally backend (ECS) → Admin dashboard (CloudFront)",
      }),
    );

    expect(screen.getAllByText("Release to production")).toHaveLength(1);
    fireEvent.click(screen.getByText("Release to production"));
    // The confirm names every deploy the click sets off, in order.
    expect(
      screen.getByText(/Ally backend \(ECS\) → Admin dashboard \(CloudFront\)/),
    ).toBeInTheDocument();
  });

  it("shows no plan block for an ordinary single-repo bug", () => {
    renderDrawer(finding());
    expect(screen.queryByText(/This fix spans/)).not.toBeInTheDocument();
  });
});

describe("BugFindingDrawer — a backend older than this build", () => {
  beforeEach(() => vi.clearAllMocks());

  /**
   * The admin console shipped the plan/release drawer one release ahead of the
   * ally-be that serves `steps`, and the drawer read `.some`/`.length` straight
   * off the missing array. With no error boundary above it the throw unmounted
   * the whole console — every row in the bugs table went to a blank screen.
   * The drawer has to survive a response that predates a field it knows about.
   */
  it("still renders the bug when the response carries no steps or events at all", () => {
    const legacy = finding();
    delete legacy.steps;
    delete legacy.events;
    delete legacy.releasable;
    delete legacy.releaseTarget;
    delete legacy.releaseBlockedReason;

    renderDrawer(legacy);

    // What the admin came for is on screen, not a blank page.
    expect(screen.getByText("Terms link is not formatted correctly")).toBeInTheDocument();
    expect(
      screen.getByText("The external emergency-services link renders unstyled."),
    ).toBeInTheDocument();
    // The timeline degrades to its empty state rather than taking the page down.
    openSection(/My work log/);
    expect(screen.getByText(/haven.t touched this one yet/i)).toBeInTheDocument();
    // And no plan block, since an absent step list means the same as an empty one.
    expect(screen.queryByText(/This fix spans/)).not.toBeInTheDocument();
  });
});

/**
 * Rewriting the brief before a fix session runs.
 *
 * The description is not a record of the bug — it is the text ally-be pastes
 * into the fix agent's prompt as the entire statement of what is wrong. So
 * these cover where the control appears (exactly where "Put me on it" does),
 * that it says nothing about approving, and that the original stays reachable
 * once it has been replaced.
 */
describe("BugFindingDrawer — rewriting the description", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    editDescription.mockReturnValue({ unwrap: () => Promise.resolve({}) });
  });

  const openEditor = (data: Record<string, unknown>) => {
    renderDrawer(data);
    fireEvent.click(menu().getByText("Rewrite the description"));
    return screen.getByRole("textbox", { name: /as you want me to understand it/i });
  };

  it("offers the rewrite on a bug that hasn't been fixed yet", () => {
    renderDrawer(finding());
    expect(screen.getByText("Rewrite the description")).toBeInTheDocument();
  });

  it.each([
    BugFindingStatus.QUEUED,
    BugFindingStatus.FIXING,
    BugFindingStatus.MERGED,
    BugFindingStatus.RELEASED,
  ])("hides the rewrite while the bug is %s", status => {
    renderDrawer(finding({ status }));
    expect(screen.queryByText("Rewrite the description")).not.toBeInTheDocument();
  });

  it("starts the draft from the current description, not an empty box", () => {
    const textarea = openEditor(finding());
    expect(textarea).toHaveValue("The external emergency-services link renders unstyled.");
  });

  it("saves the trimmed rewrite", async () => {
    const textarea = openEditor(finding());
    fireEvent.change(textarea, {
      target: { value: "  Tapping the terms link opens an unstyled page on Android only.  " },
    });
    fireEvent.click(screen.getByText("Save description"));

    await waitFor(() =>
      expect(editDescription).toHaveBeenCalledWith({
        id: "finding-1",
        description: "Tapping the terms link opens an unstyled page on Android only.",
      }),
    );
  });

  it("refuses to save an emptied description", () => {
    const textarea = openEditor(finding());
    fireEvent.change(textarea, { target: { value: "   " } });

    // A blank brief would leave the fix agent's prompt saying "Bug:" and
    // nothing else, so the button is closed rather than the failure deferred
    // to a 400.
    expect(screen.getByText("Save description")).toBeDisabled();
  });

  it("blocks and explains a brief that's too long to be one", () => {
    const textarea = openEditor(finding());
    fireEvent.change(textarea, { target: { value: "x".repeat(5001) } });

    expect(screen.getByText(/longer than I can take as a brief/i)).toBeInTheDocument();
    expect(screen.getByText("Save description")).toBeDisabled();
  });

  it("leaves the description alone on cancel", () => {
    const textarea = openEditor(finding());
    fireEvent.change(textarea, { target: { value: "a different bug entirely" } });
    fireEvent.click(screen.getByText("Cancel"));

    expect(editDescription).not.toHaveBeenCalled();
    expect(
      screen.getByText("The external emergency-services link renders unstyled."),
    ).toBeInTheDocument();
  });

  it("keeps what Bug Hunter originally found reachable after a rewrite", () => {
    renderDrawer(
      finding({
        description: "Tapping the terms link opens an unstyled page on Android only.",
        originalDescription: "terms link looks wrong",
        descriptionEditedBy: 42,
        descriptionEditedByName: "Gayatri",
        descriptionEditedAt: "2026-08-19",
      }),
    );

    expect(screen.getByText(/Rewritten by Gayatri/)).toBeInTheDocument();
    // Collapsed by default — the current brief is what matters day to day.
    expect(screen.queryByText("terms link looks wrong")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("See what I originally found"));
    expect(screen.getByText("terms link looks wrong")).toBeInTheDocument();
  });

  it("says nothing about an original on a bug nobody has rewritten", () => {
    renderDrawer(finding());
    expect(screen.queryByText(/Rewritten by/)).not.toBeInTheDocument();
    expect(screen.queryByText("See what I originally found")).not.toBeInTheDocument();
  });

  it("surfaces the backend's own refusal verbatim", async () => {
    const { toast } = await import("sonner");
    editDescription.mockReturnValue({
      unwrap: () =>
        Promise.reject({
          data: { message: "Finding finding-1 is queued — its description can't be changed." },
        }),
    });

    const textarea = openEditor(finding());
    fireEvent.change(textarea, { target: { value: "a better brief" } });
    fireEvent.click(screen.getByText("Save description"));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Finding finding-1 is queued — its description can't be changed.",
      ),
    );
  });
});

/**
 * An open draft and a live "Put me on it" cannot coexist.
 *
 * Caught in the real console, not by the tests above: the fix-session button
 * sits directly under the editor, and pressing it mid-rewrite dispatched a
 * session that read the OLD description while the admin's unsaved words went
 * nowhere — briefing the agent on exactly the text that had just been judged
 * wrong. Approving has the same shape via the next sweep.
 */
describe("BugFindingDrawer — an unsaved rewrite blocks the decisions under it", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    editDescription.mockReturnValue({ unwrap: () => Promise.resolve({}) });
    startFixSession.mockReturnValue({ unwrap: () => Promise.resolve({}) });
  });

  it("closes 'Put me on it' while a draft is open, and says why", () => {
    renderDrawer(finding());
    expect(screen.getByText("Put me on it")).not.toBeDisabled();

    fireEvent.click(screen.getByText("Rewrite the description"));

    expect(screen.getByText("Put me on it")).toBeDisabled();
    expect(screen.getByText(/Save or cancel your rewrite first/i)).toBeInTheDocument();
  });

  it("closes the Manual-mode decision too — the next sweep would read the old words", () => {
    renderDrawer(finding({ status: BugFindingStatus.PENDING_APPROVAL }));
    fireEvent.click(screen.getByText("Rewrite the description"));

    expect(screen.getByText("Approve — go fix it")).toBeDisabled();
    expect(screen.getByText("Reject")).toBeDisabled();
  });

  it("reopens them once the rewrite is settled", async () => {
    renderDrawer(finding());
    fireEvent.click(screen.getByText("Rewrite the description"));
    fireEvent.click(screen.getByText("Cancel"));

    await waitFor(() => expect(screen.getByText("Put me on it")).not.toBeDisabled());
    expect(screen.queryByText(/Save or cancel your rewrite first/i)).not.toBeInTheDocument();
  });
});

describe("BugFindingDrawer — stage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setStage.mockReturnValue({ unwrap: () => Promise.resolve({}) });
  });

  it("says nothing about a stage that just follows the pipeline — the rail already shows it", () => {
    renderDrawer(finding({ stage: "under_development", stageIsAuto: true }), false);

    expect(screen.queryByText("In development")).not.toBeInTheDocument();
    expect(screen.queryByTestId("stage-pinned")).not.toBeInTheDocument();
    // And a read-only reader is offered no way to pin one.
    expect(screen.queryByText("Set stage by hand")).not.toBeInTheDocument();
  });

  it("says when a stage was set by hand, since the rail and the stage then disagree", () => {
    renderDrawer(
      finding({
        stage: "released",
        stageIsAuto: false,
        stageOverriddenBy: 7,
        stageOverriddenByName: "Priya",
        stageOverriddenAt: "2026-10-01",
      }),
    );
    expect(screen.getByTestId("stage-pinned")).toHaveTextContent("Released");
    expect(screen.getByTestId("stage-pinned")).toHaveTextContent("Stage set by hand by Priya");
  });

  it("offers to pin the stage from the menu, and saves the chosen value", async () => {
    renderDrawer(finding({ stage: "new", stageIsAuto: true }));

    fireEvent.click(menu().getByText("Set stage by hand"));
    fireEvent.change(screen.getByLabelText("Stage"), { target: { value: "released" } });
    fireEvent.click(screen.getByText("Set stage"));

    await waitFor(() =>
      expect(setStage).toHaveBeenCalledWith({ id: "finding-1", stage: "released" }),
    );
  });

  it("offers 'Back to automatic' only once a stage is actually pinned", () => {
    renderDrawer(
      finding({
        stage: "released",
        stageIsAuto: false,
        stageOverriddenBy: 7,
        stageOverriddenByName: "Priya",
      }),
    );
    fireEvent.click(menu().getByText("Set stage by hand"));

    expect(screen.getByText("Back to automatic")).toBeInTheDocument();
  });

  it("clears the pin when 'Back to automatic' is pressed", async () => {
    renderDrawer(finding({ stage: "released", stageIsAuto: false, stageOverriddenBy: 7 }));
    fireEvent.click(menu().getByText("Set stage by hand"));

    fireEvent.click(screen.getByText("Back to automatic"));

    await waitFor(() => expect(setStage).toHaveBeenCalledWith({ id: "finding-1", stage: null }));
  });
});

describe("BugFindingDrawer — reported bug context", () => {
  it("renders nothing extra for a sweep-found bug with no reporter", () => {
    renderDrawer(finding({ report: null }));
    expect(screen.queryByText("Reported by")).not.toBeInTheDocument();
  });

  it("shows the reporter, their source badge and captured context for a human-filed bug", () => {
    renderDrawer(
      finding({
        source: "reported_bug",
        report: {
          opportunityId: "opp-1",
          reporterSource: "consumer",
          reportedBy: 12,
          reportedByName: "Priya",
          tenantId: "acme",
          reporterContext: { screen: "/cases", os: "Android 14" },
          reportedAt: "2026-08-20T10:00:00.000Z",
        },
      }),
    );

    expect(screen.getByText("Reported by")).toBeInTheDocument();
    expect(screen.getByText("Consumer")).toBeInTheDocument();
    expect(screen.getByText("Priya")).toBeInTheDocument();
    expect(screen.getByText("/cases")).toBeInTheDocument();
    expect(screen.getByText("Android 14")).toBeInTheDocument();
    // A raw tenant id means nothing to the reader.
    expect(screen.queryByText(/acme/)).not.toBeInTheDocument();
  });
});

describe("BugFindingDrawer — state persistence", () => {
  it("resets forceFix state when the finding ID changes", () => {
    const finding1 = finding({
      id: "finding-1",
      status: BugFindingStatus.NEW,
      independentVerification: "confirmed",
      budget: {
        ...finding().budget,
        exhausted: { kind: "sessions", at: "2026-10-07T05:00:00Z" },
      },
    });
    const finding2 = finding({
      id: "finding-2",
      status: BugFindingStatus.NEW,
      independentVerification: "confirmed",
      budget: {
        ...finding().budget,
        exhausted: { kind: "sessions", at: "2026-10-07T05:00:00Z" },
      },
    });

    getBugFinding.mockImplementation((id: string) => {
      if (id === "finding-1") return { data: finding1, isLoading: false, isError: false };
      if (id === "finding-2") return { data: finding2, isLoading: false, isError: false };
      return { data: undefined, isLoading: false, isError: true };
    });

    const { rerender } = render(
      <BugFindingDrawer id="finding-1" onClose={vi.fn()} canTriage={true} />,
    );

    fireEvent.click(screen.getByText("Put me on it"));

    const checkbox = screen.getByLabelText("Start anyway, past the budget");
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();

    rerender(<BugFindingDrawer id="finding-2" onClose={vi.fn()} canTriage={true} />);

    fireEvent.click(screen.getByText("Put me on it"));
    const checkboxAfterRerender = screen.getByLabelText("Start anyway, past the budget");
    expect(checkboxAfterRerender).not.toBeChecked();
  });
});

/**
 * The merge Bug Hunter cannot perform itself.
 *
 * On ally-be, ally-web and ally-ai its token has push access against a master
 * that requires a review, so every fix on those repos ends at a green PR — and
 * 89 of the 122 bot PRs merged so far were clicked through by hand on GitHub,
 * nearly all within the hour. These cases are about that button being offered
 * exactly where it can do something, and refusing verbatim where it cannot.
 */
describe("BugFindingDrawer — merging a green PR", () => {
  beforeEach(() => {
    mergeFinding.mockReset();
    mergeFinding.mockReturnValue({ unwrap: () => Promise.resolve({}) });
  });

  it("offers the merge once a PR is open", () => {
    renderDrawer(
      finding({
        status: BugFindingStatus.PR_OPENED,
        prUrl: "https://github.com/HelloAllyTech/ally-be/pull/443",
      }),
    );

    expect(screen.getByText("Merge it")).toBeInTheDocument();
  });

  it("never offers it before there is a PR to merge", () => {
    renderDrawer(finding({ status: BugFindingStatus.FIXING }));

    expect(screen.queryByText("Merge it")).not.toBeInTheDocument();
  });

  it("never offers it once the fix is already on master", () => {
    renderDrawer(finding({ status: BugFindingStatus.MERGED, prUrl: "https://x/pull/1" }));

    expect(screen.queryByText("Merge it")).not.toBeInTheDocument();
  });

  it("does not offer it on a PR_OPENED row with no recorded PR url", () => {
    // The button would 400 — the backend has nothing to merge either.
    renderDrawer(finding({ status: BugFindingStatus.PR_OPENED, prUrl: null }));

    expect(screen.queryByText("Merge it")).not.toBeInTheDocument();
  });

  it("asks for confirmation, and says it does not deploy", () => {
    renderDrawer(finding({ status: BugFindingStatus.PR_OPENED, prUrl: "https://x/pull/1" }));

    fireEvent.click(screen.getByText("Merge it"));

    expect(screen.getByText("Merge this fix to master?")).toBeInTheDocument();
    // The release gate is the point of the two-button split, so the merge
    // dialog has to say it is not the release.
    expect(screen.getByText(/does NOT deploy it/)).toBeInTheDocument();
    expect(mergeFinding).not.toHaveBeenCalled();
  });

  it("merges only once the confirmation is accepted", async () => {
    renderDrawer(finding({ status: BugFindingStatus.PR_OPENED, prUrl: "https://x/pull/1" }));

    fireEvent.click(screen.getByText("Merge it"));
    fireEvent.click(screen.getByText("Merge"));

    await waitFor(() => expect(mergeFinding).toHaveBeenCalledWith({ id: "finding-1" }));
  });

  it("surfaces GitHub's own refusal rather than a generic failure", async () => {
    // "At least 1 approving review is required" and "Base branch was
    // modified" each name the admin's next move; a generic line hides it.
    const { toast } = await import("sonner");
    mergeFinding.mockReturnValue({
      unwrap: () =>
        Promise.reject({
          data: { message: "Base branch was modified. Review and try the merge again." },
        }),
    });
    renderDrawer(finding({ status: BugFindingStatus.PR_OPENED, prUrl: "https://x/pull/1" }));

    fireEvent.click(screen.getByText("Merge it"));
    fireEvent.click(screen.getByText("Merge"));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Base branch was modified. Review and try the merge again.",
      ),
    );
  });

  it("hides it from a reader who cannot act", () => {
    renderDrawer(finding({ status: BugFindingStatus.PR_OPENED, prUrl: "https://x/pull/1" }), false);

    expect(screen.queryByText("Merge it")).not.toBeInTheDocument();
  });
});

/**
 * How sure the verifiers were, and what happened to this bug before.
 *
 * Both are new facts on the row and both have a "no data" case that must not
 * render as a bad one: no score is not zero confidence, and a bug that has
 * never regressed says nothing rather than saying it is fine.
 */
describe("BugFindingDrawer — confidence and regressions", () => {
  it("shows the verifiers' score as a percentage, on the closed section and inside it", () => {
    renderDrawer(finding({ confidence: 0.85 }));

    expect(screen.getByRole("button", { name: /How sure I am/ })).toHaveTextContent("85%");
    openSection(/How sure I am/);
    expect(screen.getAllByText("85%")).toHaveLength(2);
  });

  it("says an unproven finding was not scored rather than showing 0%", () => {
    renderDrawer(finding({ confidence: null, proven: false }));
    openSection(/How sure I am/);

    expect(screen.getByText("Not scored")).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("stays quiet about scoring on a proven finding, which had nothing to verify", () => {
    renderDrawer(finding({ confidence: null, proven: true }));
    openSection(/How sure I am/);

    expect(screen.queryByText("Not scored")).not.toBeInTheDocument();
  });

  it("names the reason a declined bug was turned down", () => {
    renderDrawer(
      finding({
        status: BugFindingStatus.REJECTED,
        decisionReason: "wont_fix",
        decisionNote: "Cosmetic, and the screen is being replaced.",
      }),
    );

    expect(screen.getByText("Turned down: Real, but not worth fixing")).toBeInTheDocument();
    expect(screen.getByText("Cosmetic, and the screen is being replaced.")).toBeInTheDocument();
  });

  it("says how often a declined bug has been re-found, so a circular argument is visible", () => {
    renderDrawer(
      finding({
        status: BugFindingStatus.REJECTED,
        decisionReason: "not_a_bug",
        rediscoveredCount: 4,
      }),
    );

    expect(screen.getByText(/I have found this again 4 time\(s\) since/)).toBeInTheDocument();
  });

  it("links a regression back to the fix that did not hold", () => {
    renderDrawer(finding({ regressionOf: "older-finding" }));
    openSection(/How sure I am/);

    expect(screen.getByText("See the fix that didn't hold")).toBeInTheDocument();
  });

  it("explains why a reported bug was missed and what would have caught it", () => {
    renderDrawer(
      finding({
        miss: {
          reason: "no_sense",
          sense: "locale_parity",
          matchedFindingId: null,
          confidence: 0.9,
          rationale: "Keys were added to en.json only.",
          classifiedAt: "2026-10-07T05:00:00Z",
        },
      }),
    );
    openSection(/How sure I am/);

    const block = screen.getByTestId("miss-record");
    expect(block).toHaveTextContent("Why I didn't find this first");
    expect(block).toHaveTextContent("I have no sense that could have seen this");
    expect(block).toHaveTextContent(
      "What would have caught it: comparing locale files and rendered text against English",
    );
    expect(block).toHaveTextContent("Keys were added to en.json only.");
    expect(screen.queryByText("See what I had already found")).not.toBeInTheDocument();
  });

  it("links a detected-and-declined miss to the finding Bug Hunter already had", () => {
    renderDrawer(
      finding({
        miss: {
          reason: "detected_declined",
          sense: "ux_signal",
          matchedFindingId: "earlier-1",
          confidence: 0.8,
          rationale: "",
          classifiedAt: "2026-10-07T05:00:00Z",
        },
      }),
    );
    openSection(/How sure I am/);

    expect(screen.getByText("I had found this, and it was turned down")).toBeInTheDocument();
    expect(screen.getByText("See what I had already found")).toHaveAttribute(
      "href",
      "?bug=earlier-1",
    );
  });

  it("says nothing at all when there is no history to report", () => {
    renderDrawer(finding({ proven: true }));
    openSection(/How sure I am/);

    expect(screen.queryByText("Not scored")).not.toBeInTheDocument();
    expect(screen.queryByText(/Turned down/)).not.toBeInTheDocument();
    expect(screen.queryByText(/found this again/)).not.toBeInTheDocument();
  });
});

/**
 * Decision first. The drawer used to open on the status badge, the rail, a
 * Stage line, notices, the description, evidence and a fourteen-line
 * confidence box — and only then the buttons. Now the decision block sits
 * directly under the header, with one status sentence and at most one primary
 * button, and the audit trail is collapsed below.
 */
describe("BugFindingDrawer — decision first", () => {
  beforeEach(() => vi.clearAllMocks());

  const primaries = () =>
    within(screen.getByTestId("decision-block"))
      .queryAllByRole("button")
      .filter(button => button.getAttribute("data-kind") === "primary");

  it("puts the decision above the rail, the description and the audit trail", () => {
    renderDrawer(finding({ status: BugFindingStatus.PENDING_APPROVAL, evidence: "trace" }));
    const order = [
      screen.getByTestId("decision-block"),
      screen.getByRole("group", { name: "Pipeline stage" }),
      screen.getByText("The external emergency-services link renders unstyled."),
      screen.getByTestId("section-evidence"),
    ];
    order.slice(1).forEach((node, i) => {
      // DOCUMENT_POSITION_FOLLOWING: each comes after the one before it.
      expect(order[i].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    });
  });

  it.each([
    [BugFindingStatus.PENDING_APPROVAL, {}, "Approve — go fix it"],
    [BugFindingStatus.NEEDS_INPUT, { escalationQuestion: "Which locale?" }, "Send answer"],
    [BugFindingStatus.PR_OPENED, { prUrl: "https://x/pull/1" }, "Merge it"],
    [BugFindingStatus.MERGED, { releasable: true, releaseTarget: "x" }, "Release to production"],
    [BugFindingStatus.RELEASE_FAILED, { releasable: true, releaseTarget: "x" }, "Retry release"],
    [BugFindingStatus.FAILED, {}, "Ask me to try again"],
    [BugFindingStatus.CANCELLED, {}, "Ask me to try again"],
    [BugFindingStatus.NEW, {}, "Put me on it"],
  ])("offers exactly one primary button at %s", (status, extra, label) => {
    renderDrawer(finding({ status, ...extra }));
    expect(primaries().map(button => button.textContent)).toEqual([label]);
  });

  it.each([BugFindingStatus.QUEUED, BugFindingStatus.FIXING])(
    "offers no primary at %s — only the way to stop it",
    status => {
      renderDrawer(finding({ status }));
      expect(primaries()).toHaveLength(0);
      expect(decisionBlock().getByText("Stop fix session")).toBeInTheDocument();
    },
  );

  it.each([
    BugFindingStatus.RELEASING,
    BugFindingStatus.RELEASED,
    BugFindingStatus.REJECTED,
    BugFindingStatus.DISMISSED,
  ])("offers nothing to press at %s, just the sentence", status => {
    renderDrawer(finding({ status, releaseTag: "v1.4.2" }));
    expect(decisionBlock().queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByTestId("status-sentence")).toBeInTheDocument();
  });

  it("drops 'Put me on it' at PENDING_APPROVAL — Approve is the decision there", () => {
    renderDrawer(finding({ status: BugFindingStatus.PENDING_APPROVAL }));
    expect(screen.queryByText("Put me on it")).not.toBeInTheDocument();
    expect(menu().queryByText("Ask me to try again")).not.toBeInTheDocument();
  });

  it("moves 'try again' to the menu once a PR is open, leaving Merge as the one primary", () => {
    renderDrawer(finding({ status: BugFindingStatus.PR_OPENED, prUrl: "https://x/pull/1" }));
    expect(decisionBlock().queryByText("Ask me to try again")).not.toBeInTheDocument();
    fireEvent.click(menu().getByText("Ask me to try again"));
    expect(screen.getByText("Put Bug Hunter on this bug?")).toBeInTheDocument();
  });

  it("asks the open question with the answer box and Send answer together, above the rail", () => {
    renderDrawer(
      finding({
        status: BugFindingStatus.NEEDS_INPUT,
        escalationQuestion: "Skip the oversized document or fail the batch?",
      }),
    );
    const block = decisionBlock();
    expect(block.getByText("Skip the oversized document or fail the batch?")).toBeInTheDocument();
    expect(block.getByRole("textbox", { name: "Your answer" })).toBeInTheDocument();
    expect(block.getByText("Send answer")).toBeDisabled();
  });

  it("states where a bug is once, in one sentence, with no banners or spinner beside the rail", () => {
    renderDrawer(finding({ status: BugFindingStatus.QUEUED }));
    expect(screen.getByTestId("status-sentence")).toHaveTextContent(/waiting for a runner/i);
    expect(screen.queryByText("Stage")).not.toBeInTheDocument();
  });

  it("keeps the meta line to repo, source and age, with the engine moved to the menu", () => {
    renderDrawer(finding({ engine: "claude-code", model: "claude-sonnet-5" }));
    const meta = screen.getByTestId("drawer-meta");
    expect(meta).toHaveTextContent("ally-be");
    expect(meta).toHaveTextContent(/found .* ago|found just now/);
    expect(meta).not.toHaveTextContent(/sonnet/);
    expect(menu().getByText(/Last run on .*claude-sonnet-5/)).toBeDisabled();
  });

  it("keeps the audit trail closed until asked for", () => {
    renderDrawer(finding({ evidence: "TypeError at line 4", confidence: 0.9 }));
    expect(screen.queryByText("TypeError at line 4")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Evidence/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    openSection(/Evidence/);
    expect(screen.getByText("TypeError at line 4")).toBeInTheDocument();
  });

  it("shows plain loading text, not a bare ellipsis", () => {
    getBugFinding.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    render(<BugFindingDrawer id="finding-1" onClose={vi.fn()} canTriage />);
    expect(screen.getByText("Loading this bug…")).toBeInTheDocument();
  });
});

/**
 * "Skip locating" and "Start anyway, past the budget" are two separate
 * overrides. They used to share one state, so ticking the budget box also
 * skipped locating a report nobody had located — straight to a fix session.
 */
describe("BugFindingDrawer — the two fix-session overrides", () => {
  const spentBudget = {
    caps: { sessions: 2, attempts: 4, escalations: 1, usd: 15, minutes: 120 },
    used: { sessions: 2, attempts: 4, escalations: 0, usd: 6, minutes: 70 },
    exhausted: { kind: "sessions", at: "2026-10-07T05:00:00Z" },
    overriddenBy: null,
    overriddenAt: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    startFixSession.mockReturnValue({ unwrap: () => Promise.resolve({}) });
  });

  it("locates first on a spent budget without asking for the budget override", async () => {
    renderDrawer(finding({ independentVerification: null, budget: spentBudget }));
    fireEvent.click(screen.getByText("Put me on it"));

    // Locating runs the Verifier, not a fix session, so the budget is not in play.
    expect(screen.queryByTestId("budget-override")).not.toBeInTheDocument();
    expect(screen.getByText("Locate the fault")).not.toBeDisabled();
    fireEvent.click(screen.getByText("Locate the fault"));
    await waitFor(() => expect(startFixSession).toHaveBeenCalledWith({ id: "finding-1" }));
  });

  it("asks for the budget override separately once locating is skipped, then sends force", async () => {
    renderDrawer(finding({ independentVerification: null, budget: spentBudget }));
    fireEvent.click(screen.getByText("Put me on it"));

    fireEvent.click(screen.getByLabelText("Skip locating, start the fix session now"));
    expect(screen.getByLabelText("Start anyway, past the budget")).not.toBeChecked();
    expect(screen.getByText("Start now")).toBeDisabled();

    fireEvent.click(screen.getByLabelText("Start anyway, past the budget"));
    expect(screen.getByLabelText("Skip locating, start the fix session now")).toBeChecked();
    fireEvent.click(screen.getByText("Start now"));
    await waitFor(() =>
      expect(startFixSession).toHaveBeenCalledWith({ id: "finding-1", force: true }),
    );
  });

  it("skips locating on its own tick, within budget", async () => {
    renderDrawer(finding({ independentVerification: null }));
    fireEvent.click(screen.getByText("Put me on it"));
    fireEvent.click(screen.getByLabelText("Skip locating, start the fix session now"));

    expect(screen.queryByTestId("budget-override")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Start now"));
    await waitFor(() =>
      expect(startFixSession).toHaveBeenCalledWith({ id: "finding-1", force: true }),
    );
  });
});

describe("BugFindingDrawer — the rail settles on terminal states", () => {
  it.each([
    [BugFindingStatus.RELEASED, 6],
    [BugFindingStatus.REJECTED, 1],
    [BugFindingStatus.DISMISSED, 1],
  ])("does not pulse at %s", (status, done) => {
    const { container } = renderDrawer(finding({ status, releaseTag: "v1" }));
    expect(screen.queryByTestId("pipeline-rail-pulse")).not.toBeInTheDocument();
    expect(container.querySelectorAll(".bg-green-500.border-green-500")).toHaveLength(done);
  });

  it("still pulses on a bug being worked", () => {
    renderDrawer(finding({ status: BugFindingStatus.FIXING }));
    expect(screen.getByTestId("pipeline-rail-pulse")).toBeInTheDocument();
  });
});

describe("BugFindingDrawer — names, not ids", () => {
  it("merges who decided and who answered into the work log, in time order", () => {
    renderDrawer(
      finding({
        status: BugFindingStatus.FIXING,
        decidedBy: 1,
        decidedByName: "Admin User",
        decidedAt: "2026-10-01T10:00:00Z",
        escalationQuestion: "Which locale?",
        escalationAnswer: "Marathi",
        escalationAnsweredBy: 2,
        escalationAnsweredByName: "Gayatri",
        escalationAnsweredAt: "2026-10-03T10:00:00Z",
        events: [
          {
            id: "e1",
            runId: null,
            repo: "ally-be",
            stage: "session_dispatched",
            summary: "Fix session started.",
            payload: null,
            suggestionId: null,
            findingId: "finding-1",
            createdAt: "2026-10-02T10:00:00Z",
          },
        ],
      }),
    );
    openSection(/My work log/);
    const rows = within(screen.getByTestId("work-log")).getAllByRole("listitem");
    expect(rows.map(row => row.textContent)).toEqual([
      "2026-10-01T10:00:00ZAdmin Userapproved it",
      "2026-10-02T10:00:00ZFix session startedFix session started.",
      "2026-10-03T10:00:00ZGayatrianswered: Marathi",
    ]);
  });
});

describe("BugFindingDrawer — no hard-coded English", () => {
  it("names a release with no target and no repo from the copy file", () => {
    renderDrawer(
      finding({
        status: BugFindingStatus.MERGED,
        releasable: true,
        releaseTarget: null,
        repo: null,
      }),
    );
    fireEvent.click(screen.getByText("Release to production"));
    expect(screen.getByText(/This deploys this service to production/)).toBeInTheDocument();
  });

  it("names an unnamed study reviewer from the copy file", () => {
    renderDrawer(
      finding({
        study: {
          feature: "f",
          entryPoints: [],
          howItWorksToday: ["a", "b"],
          valueLivesIn: "code",
          workingSibling: null,
          rootCause: "r",
          approach: "a",
          filesToChange: ["x.ts"],
          leaveAlone: [],
          otherRepos: [],
          risks: [],
          testPlan: "t",
          previousStudyWasWrongBecause: null,
          recordedAt: "2026-10-10T08:00:00.000Z",
          runId: null,
          review: { concerns: [], model: null, at: "2026-10-10T08:00:10.000Z" },
        },
      }),
    );
    openSection(/How I planned the fix/);
    expect(screen.getByText("Reviewed by a second model: no concerns.")).toBeInTheDocument();
  });
});

/**
 * Every help icon left in the drawer holds one short sentence. Sixteen of the
 * seventeen used to run past 25 words, several restating the confirm dialog
 * the button opened anyway.
 */
describe("BugFindingDrawer — tooltips stay short", () => {
  const t = en.bugHunter;
  it.each([
    ["drawerConfidenceTooltip", t.drawerConfidenceTooltip],
    ["drawerConfidenceUnscoredTooltip", t.drawerConfidenceUnscoredTooltip],
    ["drawerIndependentTooltip", t.drawerIndependentTooltip],
    ["drawerChainTooltip", t.drawerChainTooltip],
    ["drawerVerdictTooltip", t.drawerVerdictTooltip],
    ["drawerBudgetTooltip", t.drawerBudgetTooltip],
    ["drawerMissTooltip", t.drawerMissTooltip],
    ["drawerStudyTooltip", t.drawerStudyTooltip],
    ["drawerPostmortemTooltip", t.drawerPostmortemTooltip],
    ["reporterConsumerTooltip", t.reporterConsumerTooltip],
    ["reporterStaffTooltip", t.reporterStaffTooltip],
  ])("%s is one sentence of at most 20 words", (_key, text) => {
    expect(text.trim().split(/\s+/).length).toBeLessThanOrEqual(20);
    expect(text.trim().replace(/[.!?]$/, "")).not.toMatch(/[.!?]\s/);
  });
});
