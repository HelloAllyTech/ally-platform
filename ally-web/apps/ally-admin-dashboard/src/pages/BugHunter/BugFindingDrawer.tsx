import { FC, ReactNode, useEffect, useState } from "react";

import { Launch, ThreeDot } from "@icons";
import { toast } from "sonner";

import {
  Button,
  Checkbox,
  OverflowMenu,
  OverflowMenuItem,
  Select,
  SelectItem,
  SidePanel,
  TextArea,
} from "@ally-ui-mono/ui-shared";
import {
  useAnswerBugFindingMutation,
  useApproveBugFindingMutation,
  useCancelBugFixSessionMutation,
  useEditBugFindingDescriptionMutation,
  useGetBugFindingDecisionsQuery,
  useGetBugFindingQuery,
  useMergeBugFindingMutation,
  useRejectBugFindingMutation,
  useReleaseBugFindingMutation,
  useStartBugFixSessionMutation,
} from "@api";
import { ActionConfirmationPopup } from "@components/action-confirmation-popup";
import { AgentAvatar } from "@components/agent-avatar";
import { en } from "@constants";
import {
  BUG_FINDING_DESCRIPTION_EDITABLE_STATUSES,
  BUG_FINDING_DESCRIPTION_MAX_LENGTH,
  BUG_FINDING_FIX_SESSION_START_STATUSES,
  BugFindingDecisionReason,
  BugFindingDetail,
  BugFindingSource,
  BugFindingStatus,
  BugHuntEventStage,
} from "@types";
import { formatDateTime } from "@utils";

import { BrailleSpinner } from "./BrailleSpinner";
import {
  BUG_FINDING_DECISION_REASON_LABELS,
  BUG_FINDING_SEVERITY_LABELS,
  BUG_FINDING_SOURCE_LABELS,
  BUG_FINDING_STAGE_LABELS,
  engineModelLabel,
} from "./bugFindingLabels";
import { BugFindingStageEditor } from "./BugFindingStageEditor";
import { BugFindingStatusBadge } from "./BugFindingStatusBadge";
import { DecisionLogList } from "./DecisionLog";
import { canSubmitDecline, DeclineReasonPicker } from "./DeclineReasonPicker";
import { DrawerSection } from "./DrawerSection";
import { FindingConfidence, hasConfidenceDetails } from "./FindingConfidence";
import { PostmortemDetails, StudyDetails } from "./FindingStudy";
import { FindingWorkLog, workLogEntries } from "./FindingWorkLog";
import { PipelineRail } from "./PipelineRail";
import { stageFromFindingStatus } from "./pipelineStage";
import { ReportedBugPanel } from "./ReportedBugPanel";
import { BUG_HUNTER_REPOS } from "./repos";
import { ageInDays, formatAge } from "./triage";

interface BugFindingDrawerProps {
  id: string;
  onClose: () => void;
  /**
   * False for a SUPER_ADMIN, who can read the bug table but not act on it —
   * resolved once by the tab root (`BugHunter.tsx`) and threaded down, so
   * there is exactly one copy of that rule. See `BugHunter.tsx`'s `canTriage`
   * doc for why the tiers differ.
   */
  canTriage: boolean;
}

/**
 * One item of the header's meta line. The dot trails each item rather than
 * leading the next, so when the line wraps the dot stays at the end of a line
 * instead of opening the following one. The last item carries none.
 */
const DRAWER_META_ITEM =
  "text-xs font-normal text-typography-600 after:ml-2 after:text-typography-400 after:content-['·'] last:after:hidden";

/** Statuses where something is in flight and the drawer should poll rather than sit stale. */
const IN_FLIGHT_STATUSES: BugFindingStatus[] = [
  BugFindingStatus.QUEUED,
  BugFindingStatus.FIXING,
  BugFindingStatus.RELEASING,
  BugFindingStatus.COORDINATING,
];

/** Nothing left to decide: a guarded-path warning or a "settle your rewrite" note means nothing here. */
const SETTLED_STATUSES: BugFindingStatus[] = [
  BugFindingStatus.RELEASED,
  BugFindingStatus.DISMISSED,
  BugFindingStatus.REJECTED,
];

/**
 * Where "Put me on it" is the decision block's one primary action. Everywhere
 * else it can start (NEEDS_INPUT, PR_OPENED) something else is the decision —
 * answer the question, merge the PR — so a fresh session moves to the "⋯"
 * menu, worded as the retry it is. At PENDING_APPROVAL it is not offered at
 * all: Approve is the decision there, and once approved the button is back.
 */
const FIX_SESSION_PRIMARY_STATUSES: BugFindingStatus[] = [
  BugFindingStatus.NEW,
  BugFindingStatus.APPROVED,
  BugFindingStatus.FAILED,
  BugFindingStatus.CANCELLED,
];
const FIX_SESSION_MENU_STATUSES: BugFindingStatus[] = [
  BugFindingStatus.NEEDS_INPUT,
  BugFindingStatus.PR_OPENED,
];

/**
 * The rail's colour override for the current node. A bug can sit at one stage
 * for different reasons: an outright failure, an open question it's waiting on
 * you for, or nothing left to happen at all. Released finishes the rail;
 * declined and stopped bugs settle where they stopped. Neither of those pulses,
 * since nothing about them is live. Everything else is plain "working" amber.
 */
const railVariantForStatus = (
  status: BugFindingStatus,
): "error" | "waiting" | "done" | "stopped" | undefined => {
  switch (status) {
    case BugFindingStatus.FAILED:
    case BugFindingStatus.RELEASE_FAILED:
      return "error";
    case BugFindingStatus.NEEDS_INPUT:
    case BugFindingStatus.PENDING_APPROVAL:
      return "waiting";
    case BugFindingStatus.RELEASED:
      return "done";
    case BugFindingStatus.DISMISSED:
    case BugFindingStatus.REJECTED:
    case BugFindingStatus.CANCELLED:
      return "stopped";
    default:
      return undefined;
  }
};

/**
 * The decision block's one sentence: where the bug is and what happens next.
 *
 * It replaces the queued/releasing/released/failed banners and the meta-row
 * spinner, which each stated a piece of the same fact in a different place
 * (Stacks: *Balance Transparency with Cognitive Load in Agent UX*). Returns
 * null only for an open question, where the question itself is the sentence.
 */
const statusSentence = (
  finding: BugFindingDetail,
  latestFailureReason: string | undefined,
): string | null => {
  const declined = finding.decisionReason
    ? en.bugHunter.drawerDeclinedAs.replace(
        "{reason}",
        BUG_FINDING_DECISION_REASON_LABELS[finding.decisionReason],
      )
    : null;
  switch (finding.status) {
    case BugFindingStatus.NEW:
      return finding.source === BugFindingSource.REPORTED_BUG
        ? en.bugHunter.drawerReportedBugNotice
        : en.bugHunter.drawerStatusNew;
    case BugFindingStatus.PENDING_APPROVAL:
      return en.bugHunter.drawerStatusPendingApproval;
    case BugFindingStatus.APPROVED:
      return en.bugHunter.drawerStatusApproved;
    case BugFindingStatus.QUEUED:
      return en.bugHunter.drawerFixSessionQueued;
    case BugFindingStatus.FIXING:
      return en.bugHunter.drawerStatusFixing;
    case BugFindingStatus.COORDINATING:
      return en.bugHunter.drawerStatusCoordinating;
    case BugFindingStatus.BLOCKED:
      return en.bugHunter.drawerStatusBlocked;
    case BugFindingStatus.NEEDS_INPUT:
      if (finding.escalationAnswer) return en.bugHunter.drawerStatusAnswerReceived;
      return finding.escalationQuestion ? null : en.bugHunter.drawerEscalationQuestionTitle;
    case BugFindingStatus.PR_OPENED:
      return en.bugHunter.drawerStatusPrOpened;
    case BugFindingStatus.MERGED:
      return en.bugHunter.drawerStatusMerged;
    case BugFindingStatus.RELEASING:
      return en.bugHunter.drawerReleasingNotice.replace("{tag}", finding.releaseTag ?? "—");
    case BugFindingStatus.RELEASED:
      // No tag: the release was cut from GitHub by a person, not from this
      // tab, and the run does not say which version it shipped.
      return finding.releaseTag
        ? en.bugHunter.drawerReleasedNotice.replace("{tag}", finding.releaseTag)
        : en.bugHunter.drawerReleasedOutOfBandNotice;
    case BugFindingStatus.RELEASE_FAILED:
      return en.bugHunter.drawerReleaseFailedNotice.replace("{tag}", finding.releaseTag ?? "—");
    case BugFindingStatus.FAILED:
      // A plain FAILED carries no reason field of its own; the failure text
      // only ever lands as an ERROR-stage timeline event.
      return latestFailureReason || en.bugHunter.drawerFixSessionFailedNotice;
    case BugFindingStatus.CANCELLED:
      return en.bugHunter.drawerStatusCancelled;
    case BugFindingStatus.DISMISSED:
      return declined ?? en.bugHunter.drawerStatusDismissed;
    case BugFindingStatus.REJECTED:
      return declined ?? en.bugHunter.drawerStatusRejected;
    default:
      return null;
  }
};

/** The decision block's tint: red when something broke, green once it shipped, plain otherwise. */
const decisionTone = (status: BugFindingStatus): string => {
  switch (status) {
    case BugFindingStatus.FAILED:
    case BugFindingStatus.RELEASE_FAILED:
      return "border-destructive-200 bg-destructive-50";
    case BugFindingStatus.RELEASED:
      return "border-green-200 bg-green-50";
    default:
      return "border-border-light bg-white";
  }
};

/**
 * Carbon's menu item types no `target`, so its links open a new tab by hand —
 * a PR or a GitHub run should never replace the console the reader came from.
 */
const openInNewTab = (url: string | null) => {
  if (url) window.open(url, "_blank", "noopener,noreferrer");
};

/** "found 3d ago", from the same compact age the table's Age column shows. */
const foundAgo = (finding: BugFindingDetail): string | null => {
  const days = ageInDays(finding);
  if (days == null) return null;
  const age = formatAge(days);
  return age === "now"
    ? en.bugHunter.drawerFoundJustNow
    : en.bugHunter.drawerFoundAgo.replace("{age}", age);
};

/**
 * One bug, decision first.
 *
 * Top to bottom: the title and one meta line (with everything occasional in a
 * "⋯" menu), then the decision this bug is waiting on — one status sentence
 * and at most one primary button — then where it is on the pipeline, then the
 * brief and who reported it. Everything else is the audit trail and sits in
 * collapsed sections below: evidence, how sure Bug Hunter is, how it planned
 * the fix, how it decided, and its work log.
 *
 * The order is the reader's: someone opening a bug wants to know what it needs
 * from them, and the evidence for that decision is a click away rather than
 * between them and the button (Stacks: *Desert Oasis: Isolating the Primary
 * Call-to-Action*; *Progressive Disclosure and Contextual Relevance in Agent
 * Interfaces*).
 *
 * "Put me on it" and "Release to production" stay separate decisions. A fix
 * session is autonomous: an agent writes a failing test, fixes it, keeps the
 * suite green and merges. A release deploys — for the backend that means a
 * production database migration and an ECS rollout — so it stays a human
 * decision, made after the fix is visibly merged. See ally-be's
 * BugFixSessionService for the full reasoning.
 */
export const BugFindingDrawer: FC<BugFindingDrawerProps> = ({ id, onClose, canTriage }) => {
  // A dispatched session or release is reconciled server-side minutes later,
  // and there is no push channel for a single finding — the SSE stream is
  // per-run, and a release outlives its run entirely. So the drawer polls, but
  // only while something is actually in flight; a settled bug's drawer makes
  // no repeat requests at all.
  const [pollingInterval, setPollingInterval] = useState(0);
  const {
    data: finding,
    isLoading,
    isError,
  } = useGetBugFindingQuery(id, { pollingInterval, skipPollingIfUnfocused: true });
  const { data: decisions } = useGetBugFindingDecisionsQuery(id);
  const [approve, { isLoading: isApproving }] = useApproveBugFindingMutation();
  const [reject, { isLoading: isRejecting }] = useRejectBugFindingMutation();
  const [answer, { isLoading: isAnswering }] = useAnswerBugFindingMutation();
  const [startFixSession, { isLoading: isStartingSession }] = useStartBugFixSessionMutation();
  // The codebase an admin names for a bug that has none, or "" to let Bug
  // Hunter classify it. The API has always taken the override; the dialog
  // never offered it, which left a failed classification as a dead end.
  const [fixRepo, setFixRepo] = useState<string>("");
  // Two different overrides, ticked separately in the fix-session dialog. They
  // used to share one state, so ticking "past the budget" also ticked "skip
  // locating" — and a report nobody had located went straight to a fix
  // session. The API takes one `force` for both, so they only meet in the
  // request.
  const [skipLocating, setSkipLocating] = useState(false);
  const [overrideBudget, setOverrideBudget] = useState(false);
  const budgetSpent = Boolean(finding?.budget?.exhausted);
  // A plan whose open step passed the Verifier: the merge is the STEP's PR,
  // and the server checks that step's own chain, not the parent's.
  const mergeStep = finding?.attention?.kind === "merge" ? finding.attention : null;
  const chainBlocked = !mergeStep && Boolean(finding?.chain && !finding.chain.mergeable);
  // A human report nobody has located yet: "Put me on it" locates first
  // (the server sends the Verifier, not a fix session) unless forced.
  const needsLocating =
    finding?.source === BugFindingSource.REPORTED_BUG &&
    finding?.independentVerification !== "confirmed";
  const willLocate = needsLocating && !skipLocating;
  const [cancelFixSession, { isLoading: isCancellingSession }] = useCancelBugFixSessionMutation();
  const [merge, { isLoading: isMerging }] = useMergeBugFindingMutation();
  const [forceMerge, setForceMerge] = useState(false);
  const [release, { isLoading: isReleasing }] = useReleaseBugFindingMutation();
  const [editDescription, { isLoading: isSavingDescription }] =
    useEditBugFindingDescriptionMutation();

  const [confirmAction, setConfirmAction] = useState<
    "approve" | "reject" | "fixSession" | "stopFixSession" | "merge" | "release" | null
  >(null);
  /** The decline reason and note, held here so cancelling the dialog does not lose a typed note. */
  const [declineReason, setDeclineReason] = useState<BugFindingDecisionReason | null>(null);
  const [declineNote, setDeclineNote] = useState("");
  const [answerText, setAnswerText] = useState("");
  // `null` is not editing. A string is the draft, which starts as the current
  // description rather than empty: this is a rewrite of an existing brief, and
  // an empty box would invite retyping what is already there.
  const [descriptionDraft, setDescriptionDraft] = useState<string | null>(null);
  const [showOriginalDescription, setShowOriginalDescription] = useState(false);
  const [stageEditorOpen, setStageEditorOpen] = useState(false);

  useEffect(() => {
    setFixRepo("");
    setSkipLocating(false);
    setOverrideBudget(false);
    setForceMerge(false);
    setConfirmAction(null);
    setDeclineReason(null);
    setDeclineNote("");
    setAnswerText("");
    setDescriptionDraft(null);
    setShowOriginalDescription(false);
    setStageEditorOpen(false);
  }, [id]);

  /**
   * Copies the address bar, which identifies this exact bug (`?bug=<id>`), so
   * "take a look at this one" is a link rather than a description of how to
   * find a row.
   *
   * `navigator.clipboard` is unavailable on an insecure origin and can be
   * refused by permissions policy, so the failure is reported rather than
   * swallowed — a copy button that silently does nothing is worse than none.
   */
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success(en.bugHunter.drawerCopyLinkDone);
    } catch {
      toast.error(en.bugHunter.drawerCopyLinkFailed);
    }
  };

  // Both arrays are defaulted rather than read straight off the response. A
  // backend one release behind this build omits `steps` entirely, and reading
  // `.some` off that undefined threw during render — which, with no error
  // boundary above this drawer, blanked the whole admin console on every row.
  // An absent array means the same thing as an empty one here, so treat it so.
  const steps = finding?.steps ?? [];
  const events = finding?.events ?? [];

  // Events are returned oldest-first, so the last ERROR entry is the one that
  // explains a FAILED bug.
  const latestFailureReason = [...events]
    .reverse()
    .find(event => event.stage === BugHuntEventStage.ERROR)?.summary;

  const inFlight = finding
    ? IN_FLIGHT_STATUSES.includes(finding.status) ||
      // A coordinating parent's own status doesn't change between steps, but
      // its steps do — so poll while any of them is still moving.
      steps.some(step => IN_FLIGHT_STATUSES.includes(step.status))
    : false;
  useEffect(() => {
    setPollingInterval(inFlight ? 15_000 : 0);
  }, [inFlight]);

  // `canTriage` gates every mutating control in this drawer: false for a
  // SUPER_ADMIN, who can read a bug's whole history here but not act on it —
  // see BugHunter.tsx's doc on why the tiers differ.
  const canStartSession = finding
    ? canTriage && BUG_FINDING_FIX_SESSION_START_STATUSES.includes(finding.status)
    : false;

  // Mirrors the backend's own gate (QUEUED or FIXING) so a stale click never
  // makes a round trip just to be told 403.
  const canStopSession = finding
    ? canTriage &&
      (finding.status === BugFindingStatus.QUEUED || finding.status === BugFindingStatus.FIXING)
    : false;

  // The description is the fix agent's whole brief (see ally-be's
  // `buildFixSessionPrompt`), so the edit is offered exactly where a fix
  // session can still start from it, mirroring the backend's own gate.
  const canEditDescription = finding
    ? canTriage && BUG_FINDING_DESCRIPTION_EDITABLE_STATUSES.includes(finding.status)
    : false;

  const draftTooLong = (descriptionDraft?.trim().length ?? 0) > BUG_FINDING_DESCRIPTION_MAX_LENGTH;

  // An open draft closes the decisions. "Put me on it" would dispatch a
  // session reading the OLD description while the admin's rewrite sat unsaved
  // — the fix briefed on the text they had just decided was wrong. Approving
  // has the same shape: the next sweep would pick up the old words.
  const isDraftingDescription = descriptionDraft !== null;

  const handleSaveDescription = async () => {
    const next = descriptionDraft?.trim();
    if (!next || draftTooLong) return;
    try {
      await editDescription({ id, description: next }).unwrap();
      setDescriptionDraft(null);
    } catch (error) {
      // The backend's own refusal is the useful one — "is queued, its
      // description can't be changed from there" names the reason a generic
      // line would hide. The draft stays put so nothing typed is lost.
      toast.error(
        (error as { data?: { message?: string } })?.data?.message ??
          en.bugHunter.drawerDescriptionEditFailed,
      );
    }
  };

  const handleDecision = async () => {
    if (!confirmAction) return;
    // Guarded rather than assumed: the confirm button is disabled without a
    // reason, but the dialog can also be submitted by keyboard.
    if (confirmAction === "reject" && !canSubmitDecline(declineReason, declineNote)) {
      toast.error(en.bugHunter.declineReasonRequired);
      return;
    }
    try {
      if (confirmAction === "approve") await approve(id).unwrap();
      else {
        await reject({
          id,
          reason: declineReason as BugFindingDecisionReason,
          note: declineNote,
        }).unwrap();
      }
      setDeclineReason(null);
      setDeclineNote("");
    } catch {
      toast.error(en.bugHunter.drawerDecisionFailed);
    } finally {
      setConfirmAction(null);
    }
  };

  const handleMerge = async () => {
    try {
      await merge({
        id: mergeStep?.stepId ?? id,
        ...(forceMerge ? { force: true } : {}),
      }).unwrap();
      setConfirmAction(null);
    } catch (error) {
      // GitHub's own refusal is the useful one — "At least 1 approving review
      // is required", "Base branch was modified" — and each names the admin's
      // next move, which a generic line would hide. The dialog stays open.
      toast.error(
        (error as { data?: { message?: string } })?.data?.message ?? en.bugHunter.drawerMergeFailed,
      );
    }
  };

  const handleStartFixSession = async () => {
    // One `force` on the wire for two separate ticks: skipping the locate step
    // and starting past a spent budget. Start stays disabled past the budget
    // until its own box is ticked, so a skip-locating tick alone never spends
    // past the budget unasked.
    const force = (needsLocating && skipLocating) || (budgetSpent && overrideBudget);
    try {
      await startFixSession({
        id,
        ...(fixRepo ? { repo: fixRepo } : {}),
        ...(force ? { force: true } : {}),
      }).unwrap();
      setSkipLocating(false);
      setOverrideBudget(false);
      setConfirmAction(null);
    } catch (error) {
      // The backend's own message is the useful one here — "Bug Hunter is
      // OFF", "not set up for fix sessions", a GitHub error verbatim — so it
      // is surfaced rather than replaced with a generic failure line. The
      // dialog stays open so the admin can act on it.
      toast.error(
        (error as { data?: { message?: string } })?.data?.message ??
          en.bugHunter.drawerFixSessionFailed,
      );
    }
  };

  const handleStopFixSession = async () => {
    try {
      await cancelFixSession(id).unwrap();
      setConfirmAction(null);
    } catch (error) {
      // Same reasoning as handleStartFixSession: the backend's own refusal
      // (e.g. the session already finished) is more useful than a generic line.
      toast.error(
        (error as { data?: { message?: string } })?.data?.message ??
          en.bugHunter.drawerStopFixSessionFailed,
      );
    }
  };

  const handleRelease = async () => {
    try {
      await release(id).unwrap();
      setConfirmAction(null);
    } catch (error) {
      toast.error(
        (error as { data?: { message?: string } })?.data?.message ??
          en.bugHunter.drawerReleaseFailed,
      );
    }
  };

  const handleSubmitAnswer = async () => {
    if (!answerText.trim()) return;
    try {
      await answer({ id, answer: answerText.trim() }).unwrap();
      setAnswerText("");
    } catch {
      toast.error(en.bugHunter.drawerAnswerFailed);
    }
  };

  const engineLabel = finding ? engineModelLabel(finding.engine, finding.model) : null;
  const age = finding ? foundAgo(finding) : null;
  const sentence = finding ? statusSentence(finding, latestFailureReason) : null;
  const logEntries = finding ? workLogEntries(finding) : [];
  const decisionList = decisions ?? [];

  const header = (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        {/* Two clamped lines, with the full title a hover away: a long bug
            title at three lines ran into the close button. */}
        <span
          title={finding?.title}
          className="block text-base font-semibold leading-snug text-typography-900 line-clamp-2"
        >
          {finding?.title}
        </span>
        {finding && (
          <p data-testid="drawer-meta" className="mt-1 flex flex-wrap items-center gap-x-2">
            {finding.repo && <span className={DRAWER_META_ITEM}>{finding.repo}</span>}
            <span className={DRAWER_META_ITEM}>{BUG_FINDING_SOURCE_LABELS[finding.source]}</span>
            {/* Kept beside the source: severity is an input to the decision
                below it, not audit detail. */}
            {finding.severity && (
              <span className={DRAWER_META_ITEM}>
                {BUG_FINDING_SEVERITY_LABELS[finding.severity]}
              </span>
            )}
            {age && (
              <span className={DRAWER_META_ITEM} title={formatDateTime(finding.createdAt)}>
                {age}
              </span>
            )}
          </p>
        )}
      </div>
      {finding && (
        // Everything here is occasional — a link, a rewrite, a hand-set stage,
        // somewhere to watch — so it waits behind one icon instead of sitting
        // between the reader and the decision.
        <OverflowMenu
          size="sm"
          flipped
          align="bottom"
          renderIcon={ThreeDot}
          iconDescription={en.bugHunter.drawerMoreActions}
          // Above the panel (which sits at z-index 9001), and wide enough
          // that "Rewrite the description" and the engine line aren't cut off.
          menuOptionsClass="!z-[9100] !w-64 [&_.cds--overflow-menu-options\_\_btn]:!max-w-none"
        >
          <OverflowMenuItem
            itemText={en.bugHunter.drawerCopyLink}
            onClick={() => void copyLink()}
          />
          {canEditDescription && !isDraftingDescription && (
            <OverflowMenuItem
              itemText={en.bugHunter.drawerDescriptionEdit}
              onClick={() => setDescriptionDraft(finding.description)}
            />
          )}
          {canTriage && (
            <OverflowMenuItem
              itemText={en.bugHunter.stageEditLabel}
              onClick={() => setStageEditorOpen(true)}
            />
          )}
          {canStartSession && FIX_SESSION_MENU_STATUSES.includes(finding.status) && (
            <OverflowMenuItem
              itemText={en.bugHunter.drawerRetryFixSession}
              disabled={isStartingSession || isDraftingDescription}
              onClick={() => setConfirmAction("fixSession")}
            />
          )}
          {finding.prUrl && (
            <OverflowMenuItem
              itemText={en.bugHunter.viewPr}
              onClick={() => openInNewTab(finding.prUrl)}
            />
          )}
          {finding.sessionRunUrl && (
            <OverflowMenuItem
              itemText={en.bugHunter.drawerWatchSession}
              onClick={() => openInNewTab(finding.sessionRunUrl)}
            />
          )}
          {finding.releaseRunUrl && (
            <OverflowMenuItem
              itemText={en.bugHunter.drawerViewReleaseRun}
              onClick={() => openInNewTab(finding.releaseRunUrl)}
            />
          )}
          {engineLabel && (
            <OverflowMenuItem
              hasDivider
              disabled
              requireTitle
              itemText={en.bugHunter.drawerLastRunOn.replace("{model}", engineLabel)}
            />
          )}
        </OverflowMenu>
      )}
    </div>
  );

  return (
    <SidePanel open onClose={onClose} title={header} className="w-[32rem]">
      {isLoading ? (
        <p className="text-sm text-typography-600">{en.bugHunter.drawerLoading}</p>
      ) : isError || !finding ? (
        <p className="text-sm text-destructive-600">{en.bugHunter.drawerLoadFailed}</p>
      ) : (
        // Keyed by bug so every collapsed section and toggle starts closed
        // again when the drawer moves to another bug.
        <div key={finding.id} className="flex flex-col gap-5">
          {/* ── 1. The decision ──────────────────────────────────────────── */}
          <div
            data-testid="decision-block"
            className={`rounded-lg border p-4 flex flex-col gap-3 ${decisionTone(finding.status)}`}
          >
            {sentence && (
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <BugFindingStatusBadge status={finding.status} />
                <p data-testid="status-sentence" className="text-sm text-typography-900">
                  {sentence}
                </p>
              </div>
            )}

            {/* A decline's own note and how often the bug has come back since:
                what anyone reconsidering this decision reads first. */}
            {finding.decisionNote &&
              (finding.status === BugFindingStatus.REJECTED ||
                finding.status === BugFindingStatus.DISMISSED) && (
                <p className="text-xs text-typography-600 whitespace-pre-wrap break-words">
                  {finding.decisionNote}
                </p>
              )}
            {finding.rediscoveredCount > 0 && (
              <p className="text-xs text-typography-600">
                {en.bugHunter.drawerRediscovered.replace(
                  "{count}",
                  String(finding.rediscoveredCount),
                )}
              </p>
            )}

            {/* The open question, asked and signed by Bug Hunter, with the
                answer box right under it rather than below the audit trail. */}
            {finding.status === BugFindingStatus.NEEDS_INPUT && finding.escalationQuestion && (
              <div className="flex flex-col gap-2">
                {!sentence && (
                  <div className="flex items-center gap-2">
                    <AgentAvatar
                      size="sm"
                      presence="waiting_on_you"
                      label={en.bugHunter.agentName}
                    />
                    <h3 className="text-xs font-semibold text-typography-700">
                      {en.bugHunter.drawerEscalationQuestionTitle}
                    </h3>
                  </div>
                )}
                <p className="text-sm text-typography-900">{finding.escalationQuestion}</p>
                {finding.escalationAnswer ? (
                  <p className="text-sm text-typography-700 whitespace-pre-wrap break-words border-l-2 border-border-light pl-3">
                    {finding.escalationAnswer}
                  </p>
                ) : canTriage ? (
                  <TextArea
                    id={`bug-finding-answer-${finding.id}`}
                    labelText={en.bugHunter.drawerAnswerLabel}
                    hideLabel
                    placeholder={en.bugHunter.drawerAnswerPlaceholder}
                    value={answerText}
                    onChange={e => setAnswerText(e.target.value)}
                    rows={3}
                  />
                ) : null}
              </div>
            )}

            {/* Beside the retry, the post-mortem is the decision: whether
                trying again is worth it. */}
            {finding.postmortem &&
              (finding.status === BugFindingStatus.FAILED ||
                finding.status === BugFindingStatus.CANCELLED) && (
                <PostmortemDetails postmortem={finding.postmortem} />
              )}

            {/* Merged but not releasable from here — say why rather than just
                omitting the button the admin came looking for. */}
            {finding.releaseBlockedReason && (
              <p className="text-xs text-typography-700">
                <span className="font-semibold">{en.bugHunter.drawerReleaseBlocked}: </span>
                {finding.releaseBlockedReason}
              </p>
            )}

            {finding.touchesGuardedPath && !SETTLED_STATUSES.includes(finding.status) && (
              <p className="text-xs text-destructive-600">{en.bugHunter.drawerGuardedPathNotice}</p>
            )}

            <DecisionActions>
              {canTriage && finding.status === BugFindingStatus.PENDING_APPROVAL && (
                <>
                  <Button
                    size="sm"
                    kind="primary"
                    disabled={isApproving || isDraftingDescription}
                    onClick={() => setConfirmAction("approve")}
                  >
                    {en.bugHunter.drawerApprove}
                  </Button>
                  <Button
                    size="sm"
                    kind="danger--tertiary"
                    disabled={isRejecting || isDraftingDescription}
                    onClick={() => setConfirmAction("reject")}
                  >
                    {en.bugHunter.drawerReject}
                  </Button>
                </>
              )}

              {canTriage &&
                finding.status === BugFindingStatus.NEEDS_INPUT &&
                finding.escalationQuestion &&
                !finding.escalationAnswer && (
                  <Button
                    size="sm"
                    kind="primary"
                    disabled={isAnswering || !answerText.trim()}
                    onClick={handleSubmitAnswer}
                  >
                    {en.bugHunter.drawerAnswerSubmit}
                  </Button>
                )}

              {/* The merge Bug Hunter cannot do itself on a protected repo.
                  The backend re-checks the PR's own CI and refuses a red one,
                  so this is a shortcut past a trip to GitHub, not past a gate. */}
              {canTriage &&
                ((finding.status === BugFindingStatus.PR_OPENED && finding.prUrl) || mergeStep) && (
                  <Button
                    size="sm"
                    kind="primary"
                    disabled={isMerging || isDraftingDescription}
                    onClick={() => setConfirmAction("merge")}
                  >
                    {en.bugHunter.drawerMerge}
                  </Button>
                )}

              {canTriage && finding.releasable && (
                <Button
                  size="sm"
                  kind="primary"
                  disabled={isReleasing}
                  onClick={() => setConfirmAction("release")}
                >
                  {finding.status === BugFindingStatus.RELEASE_FAILED
                    ? en.bugHunter.drawerReleaseRetry
                    : en.bugHunter.drawerRelease}
                </Button>
              )}

              {canStartSession && FIX_SESSION_PRIMARY_STATUSES.includes(finding.status) && (
                <Button
                  size="sm"
                  kind="primary"
                  disabled={isStartingSession || isDraftingDescription}
                  onClick={() => setConfirmAction("fixSession")}
                >
                  {/* CANCELLED reads as a retry too — same story as FAILED,
                      just stopped on purpose rather than given up on. */}
                  {finding.status === BugFindingStatus.FAILED ||
                  finding.status === BugFindingStatus.CANCELLED
                    ? en.bugHunter.drawerRetryFixSession
                    : en.bugHunter.drawerStartFixSession}
                </Button>
              )}

              {canStopSession && (
                <Button
                  size="sm"
                  kind="danger--tertiary"
                  disabled={isCancellingSession}
                  onClick={() => setConfirmAction("stopFixSession")}
                >
                  {en.bugHunter.drawerStopFixSession}
                </Button>
              )}
            </DecisionActions>

            {isDraftingDescription && !SETTLED_STATUSES.includes(finding.status) && (
              <p className="text-xs text-typography-600">
                {en.bugHunter.drawerDescriptionSettleFirst}
              </p>
            )}
          </div>

          {/* ── 2. Where it is ──────────────────────────────────────────────
              The rail alone: no Stage line and no spinner beside it, which
              were two more ways of saying the same thing. A stage pinned by
              hand is the exception — then the rail and the stage disagree,
              and the reader needs to know why. */}
          <div className="flex flex-col gap-2">
            <PipelineRail
              stage={stageFromFindingStatus(finding.status)}
              variant={railVariantForStatus(finding.status)}
            />
            {!finding.stageIsAuto && (
              <p data-testid="stage-pinned" className="text-xs text-typography-500">
                {BUG_FINDING_STAGE_LABELS[finding.stage]} ·{" "}
                {en.bugHunter.findingStagePinnedTooltip
                  .replace("{name}", finding.stageOverriddenByName ?? en.bugHunter.reporterUnknown)
                  .replace(
                    "{date}",
                    finding.stageOverriddenAt ? formatDateTime(finding.stageOverriddenAt) : "—",
                  )}
              </p>
            )}
            {stageEditorOpen && (
              <BugFindingStageEditor
                id={finding.id}
                stage={finding.stage}
                isAuto={finding.stageIsAuto}
                pinnedByName={finding.stageOverriddenByName}
                pinnedAt={finding.stageOverriddenAt}
                canEdit={canTriage}
                startEditing
                onDone={() => setStageEditorOpen(false)}
              />
            )}

            {/* The plan, when this bug needs more than one repo. */}
            {steps.length > 0 && (
              <div className="border border-border-light rounded p-3">
                <h3 className="text-xs font-semibold text-typography-900">
                  {en.bugHunter.planTitle.replace("{count}", String(steps.length))}
                </h3>
                <p className="text-xs text-typography-600 mt-0.5 mb-3">
                  {en.bugHunter.planSubtitle}
                </p>
                {finding?.attention && (
                  <p
                    className="text-xs text-orange-700 border border-orange-200 bg-orange-50 rounded px-2 py-1.5 mb-3"
                    data-testid="plan-attention"
                  >
                    {(finding.attention.kind === "merge"
                      ? en.bugHunter.planAttentionMergeHint
                      : en.bugHunter.planAttentionReviewHint
                    )
                      .replace("{n}", String(finding.attention.stepIndex + 1))
                      .replace("{repo}", finding.attention.repo ?? "")}
                  </p>
                )}
                <ol className="flex flex-col gap-2">
                  {steps.map(step => (
                    <li key={step.id} className="flex items-start gap-2">
                      <span className="text-xs text-typography-500 whitespace-nowrap mt-0.5 tabular-nums">
                        {en.bugHunter.planStepLabel.replace("{n}", String(step.stepIndex + 1))}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-typography-900">
                            {step.repo}
                          </span>
                          <BugFindingStatusBadge status={step.status} />
                          {step.fixVerdict && (
                            <span
                              className={`text-xs ${
                                step.fixVerdict === "pass" ? "text-green-700" : "text-amber-700"
                              }`}
                            >
                              {step.fixVerdict === "pass"
                                ? en.bugHunter.planStepVerified
                                : en.bugHunter.planStepRefused}
                            </span>
                          )}
                          {IN_FLIGHT_STATUSES.includes(step.status) && (
                            <BrailleSpinner className="text-amber-600" />
                          )}
                          {step.releaseTag && (
                            <span className="text-xs text-typography-600">{step.releaseTag}</span>
                          )}
                        </div>
                        {step.stepSummary && (
                          <p className="text-xs text-typography-700 mt-0.5">{step.stepSummary}</p>
                        )}
                        <div className="flex gap-3 mt-0.5">
                          {step.prUrl && (
                            <a
                              href={step.prUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center text-primary-600 hover:text-primary-800"
                              aria-label={en.bugHunter.viewPr}
                              title={en.bugHunter.viewPr}
                            >
                              <Launch className="h-3.5 w-3.5" aria-hidden="true" />
                            </a>
                          )}
                          {step.sessionRunUrl && (
                            <a
                              href={step.sessionRunUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs text-primary-600 underline"
                            >
                              {en.bugHunter.drawerWatchSession}
                            </a>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>

          {/* ── 3. The brief, and who reported it ───────────────────────────
              Editable, because this text is not a record of the bug — it is
              the instruction a fix session runs on. See ally-be's
              BugFindingService.editDescription. */}
          <div>
            <h3 className="text-xs font-semibold text-typography-700 mb-1">
              {en.bugHunter.drawerDescriptionTitle}
            </h3>

            {descriptionDraft === null ? (
              <p className="text-sm text-typography-900 whitespace-pre-wrap break-words">
                {finding.description}
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                <TextArea
                  id={`bug-finding-description-${finding.id}`}
                  labelText={en.bugHunter.drawerDescriptionEditLabel}
                  helperText={en.bugHunter.drawerDescriptionEditHelp}
                  placeholder={en.bugHunter.drawerDescriptionEditPlaceholder}
                  value={descriptionDraft}
                  onChange={e => setDescriptionDraft(e.target.value)}
                  rows={8}
                  // Opened from the header menu, so the field is usually
                  // below the fold: focusing it brings it into view.
                  autoFocus
                  invalid={draftTooLong}
                  invalidText={en.bugHunter.drawerDescriptionEditTooLong
                    .replace("{length}", String(descriptionDraft.trim().length))
                    .replace("{max}", String(BUG_FINDING_DESCRIPTION_MAX_LENGTH))}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    kind="primary"
                    disabled={isSavingDescription || !descriptionDraft.trim() || draftTooLong}
                    onClick={handleSaveDescription}
                  >
                    {en.bugHunter.drawerDescriptionEditSave}
                  </Button>
                  <Button size="sm" kind="ghost" onClick={() => setDescriptionDraft(null)}>
                    {en.bugHunter.drawerDescriptionEditCancel}
                  </Button>
                </div>
              </div>
            )}

            {/* What Bug Hunter originally found stays reachable once an admin
                has rewritten it: when a fix goes wrong the first question is
                whether the agent misread the bug or was handed a different
                one. */}
            {finding.originalDescription && descriptionDraft === null && (
              <div className="mt-2">
                <p className="text-xs text-typography-500">
                  {en.bugHunter.drawerDescriptionEditedBy.replace(
                    "{name}",
                    finding.descriptionEditedByName || en.bugHunter.drawerAuditSomeone,
                  )}
                  {finding.descriptionEditedAt
                    ? ` · ${formatDateTime(finding.descriptionEditedAt)}`
                    : ""}
                </p>
                <button
                  type="button"
                  className="text-xs text-primary-600 underline cursor-pointer mt-1"
                  onClick={() => setShowOriginalDescription(open => !open)}
                >
                  {showOriginalDescription
                    ? en.bugHunter.drawerDescriptionHideOriginal
                    : en.bugHunter.drawerDescriptionShowOriginal}
                </button>
                {showOriginalDescription && (
                  <div className="mt-1 border-l-2 border-border-light pl-3">
                    <p className="text-xs font-semibold text-typography-600">
                      {en.bugHunter.drawerDescriptionOriginalTitle}
                    </p>
                    <p className="text-sm text-typography-700 whitespace-pre-wrap break-words">
                      {finding.originalDescription}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {finding.report && <ReportedBugPanel report={finding.report} />}

          {/* ── 4. The audit trail, closed ──────────────────────────────── */}
          <div className="border-b border-border-light">
            {finding.evidence && (
              <DrawerSection title={en.bugHunter.drawerEvidenceTitle} testId="section-evidence">
                <pre className="text-xs bg-neutral-50 border border-border-light rounded p-2 whitespace-pre-wrap overflow-x-auto">
                  {finding.evidence}
                </pre>
              </DrawerSection>
            )}

            {hasConfidenceDetails(finding) && (
              <DrawerSection
                title={en.bugHunter.drawerSectionConfidence}
                hint={
                  finding.confidence != null ? `${Math.round(finding.confidence * 100)}%` : null
                }
                testId="section-confidence"
              >
                <FindingConfidence finding={finding} />
              </DrawerSection>
            )}

            {(finding.study ||
              (finding.postmortem &&
                finding.status !== BugFindingStatus.FAILED &&
                finding.status !== BugFindingStatus.CANCELLED)) && (
              <DrawerSection title={en.bugHunter.drawerSectionPlan} testId="section-plan">
                {finding.study && <StudyDetails study={finding.study} />}
                {/* An earlier attempt's post-mortem, once a later one moved
                    on: history now, read beside the plan that followed it. */}
                {finding.postmortem &&
                  finding.status !== BugFindingStatus.FAILED &&
                  finding.status !== BugFindingStatus.CANCELLED && (
                    <PostmortemDetails postmortem={finding.postmortem} />
                  )}
              </DrawerSection>
            )}

            {decisionList.length > 0 && (
              <DrawerSection
                title={en.bugHunter.decisions.title}
                hint={String(decisionList.length)}
                testId="finding-decisions"
              >
                <DecisionLogList decisions={decisionList} />
              </DrawerSection>
            )}

            <DrawerSection
              title={en.bugHunter.drawerTimelineTitle}
              hint={logEntries.length ? String(logEntries.length) : null}
              testId="section-work-log"
            >
              {/* A question answered and moved past is history, not a
                  decision: it reads here, above the log that followed it. */}
              {finding.escalationQuestion && finding.status !== BugFindingStatus.NEEDS_INPUT && (
                <div className="border-l-2 border-orange-200 pl-3">
                  <p className="text-xs font-semibold text-typography-700">
                    {en.bugHunter.drawerEscalationQuestionTitle}
                  </p>
                  <p className="text-sm text-typography-900">{finding.escalationQuestion}</p>
                  {finding.escalationAnswer && (
                    <p className="text-sm text-typography-700 whitespace-pre-wrap break-words mt-1">
                      {finding.escalationAnswer}
                    </p>
                  )}
                </div>
              )}
              <FindingWorkLog entries={logEntries} />
            </DrawerSection>
          </div>
        </div>
      )}

      {(confirmAction === "approve" || confirmAction === "reject") && (
        <ActionConfirmationPopup
          isOpen
          onClose={() => setConfirmAction(null)}
          title={
            confirmAction === "approve"
              ? en.bugHunter.drawerApproveConfirmTitle
              : en.bugHunter.drawerRejectConfirmTitle
          }
          description={
            confirmAction === "approve"
              ? en.bugHunter.drawerApproveConfirmBodyNoRush
              : en.bugHunter.drawerRejectConfirmBody
          }
          primaryButton={{
            label:
              confirmAction === "approve" ? en.bugHunter.drawerApprove : en.bugHunter.drawerReject,
            onClick: handleDecision,
            // The reason is what makes a decline teach the next sweep anything,
            // so the button waits for it rather than the request 400ing.
            disabled: confirmAction === "reject" && !canSubmitDecline(declineReason, declineNote),
          }}
          secondaryButton={{ label: en.bugHunter.cancel, onClick: () => setConfirmAction(null) }}
        >
          {confirmAction === "reject" && (
            <DeclineReasonPicker
              idPrefix={`drawer-${id}`}
              reason={declineReason}
              onReasonChange={setDeclineReason}
              note={declineNote}
              onNoteChange={setDeclineNote}
            />
          )}
        </ActionConfirmationPopup>
      )}

      {confirmAction === "merge" && (
        <ActionConfirmationPopup
          isOpen
          onClose={() => setConfirmAction(null)}
          title={en.bugHunter.drawerMergeConfirmTitle}
          description={en.bugHunter.drawerMergeConfirmBody}
          primaryButton={{
            label: en.bugHunter.drawerMergeConfirm,
            onClick: handleMerge,
            disabled: isMerging || (chainBlocked && !forceMerge),
          }}
          secondaryButton={{ label: en.bugHunter.cancel, onClick: () => setConfirmAction(null) }}
        >
          {/* The case chain, before the one click that cannot be undone from
              here: the refusal the server would give, shown first, with the
              override recorded. */}
          {chainBlocked && (
            <div className="mt-3 text-left" data-testid="merge-chain-warning">
              <p className="text-xs text-amber-700 mb-2">
                {en.bugHunter.drawerMergeChainIncomplete.replace(
                  "{links}",
                  (finding?.chain.blocking ?? [])
                    .map(l => en.bugHunter.drawerChainLinks[l].toLowerCase())
                    .join(", "),
                )}
              </p>
              <Checkbox
                id={`drawer-${id}-force-merge`}
                labelText={en.bugHunter.drawerMergeForceLabel}
                helperText={en.bugHunter.drawerMergeForceHelp}
                checked={forceMerge}
                onChange={(_e: unknown, { checked }: { checked: boolean }) =>
                  setForceMerge(checked)
                }
              />
            </div>
          )}
        </ActionConfirmationPopup>
      )}

      {confirmAction === "fixSession" && (
        <ActionConfirmationPopup
          isOpen
          onClose={() => setConfirmAction(null)}
          title={en.bugHunter.drawerFixSessionConfirmTitle}
          description={
            finding?.repo
              ? en.bugHunter.drawerFixSessionConfirmBody.replace("{repo}", finding.repo)
              : en.bugHunter.drawerFixSessionConfirmBodyUnknownRepo
          }
          primaryButton={{
            label: willLocate
              ? en.bugHunter.drawerLocateFirstStart
              : en.bugHunter.drawerFixSessionStart,
            onClick: handleStartFixSession,
            // Locating runs the Verifier, not a fix session, so a spent
            // budget only holds Start once the session would actually run.
            disabled: isStartingSession || (!willLocate && budgetSpent && !overrideBudget),
          }}
          secondaryButton={{ label: en.bugHunter.cancel, onClick: () => setConfirmAction(null) }}
        >
          {needsLocating && (
            <div className="mt-3 text-left" data-testid="locate-first">
              <p className="text-xs text-typography-700 mb-2">
                {en.bugHunter.drawerLocateFirstNote}
              </p>
              <Checkbox
                id={`drawer-${id}-locate-force`}
                labelText={en.bugHunter.drawerLocateFirstForceLabel}
                helperText={en.bugHunter.drawerLocateFirstForceHelp}
                checked={skipLocating}
                onChange={(_e: unknown, { checked }: { checked: boolean }) =>
                  setSkipLocating(checked)
                }
              />
            </div>
          )}
          {/* Past the budget, Start is disabled until the admin ticks the
              override: the refusal the server would give is shown here first,
              so nobody learns about the budget from an error toast. */}
          {budgetSpent && !willLocate && (
            <div className="mt-3 text-left" data-testid="budget-override">
              <p className="text-xs text-amber-700 mb-2">
                {en.bugHunter.drawerBudgetExhausted.replace(
                  "{kind}",
                  finding?.budget.exhausted?.kind ?? "",
                )}
              </p>
              <Checkbox
                id={`drawer-${id}-force`}
                labelText={en.bugHunter.drawerFixSessionForceLabel}
                helperText={en.bugHunter.drawerFixSessionForceHelp}
                checked={overrideBudget}
                onChange={(_e: unknown, { checked }: { checked: boolean }) =>
                  setOverrideBudget(checked)
                }
              />
            </div>
          )}
          {/* Only for a bug with no repo. One with a repo already says where
              it will work, and a picker beside that would be a second answer
              to a question already settled. */}
          {!finding?.repo && (
            <div className="mt-3 text-left" data-testid="repo-picker">
              <Select
                id={`drawer-${id}-repo`}
                labelText={en.bugHunter.drawerFixSessionRepoLabel}
                helperText={en.bugHunter.drawerFixSessionRepoHelp}
                value={fixRepo}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFixRepo(e.target.value)}
              >
                <SelectItem value="" text={en.bugHunter.drawerFixSessionRepoAuto} />
                {BUG_HUNTER_REPOS.map(name => (
                  <SelectItem key={name} value={name} text={name} />
                ))}
              </Select>
            </div>
          )}
        </ActionConfirmationPopup>
      )}

      {confirmAction === "stopFixSession" && (
        <ActionConfirmationPopup
          isOpen
          onClose={() => setConfirmAction(null)}
          title={en.bugHunter.drawerStopFixSessionConfirmTitle}
          description={en.bugHunter.drawerStopFixSessionConfirmBody}
          primaryButton={{
            label: en.bugHunter.drawerStopFixSessionConfirm,
            onClick: handleStopFixSession,
            disabled: isCancellingSession,
          }}
          secondaryButton={{ label: en.bugHunter.cancel, onClick: () => setConfirmAction(null) }}
        />
      )}

      {confirmAction === "release" && (
        <ActionConfirmationPopup
          isOpen
          onClose={() => setConfirmAction(null)}
          title={en.bugHunter.drawerReleaseConfirmTitle}
          description={en.bugHunter.drawerReleaseConfirmBody.replace(
            "{target}",
            finding?.releaseTarget ?? finding?.repo ?? en.bugHunter.drawerReleaseTargetFallback,
          )}
          primaryButton={{
            label: en.bugHunter.drawerReleaseConfirm,
            onClick: handleRelease,
            disabled: isReleasing,
          }}
          secondaryButton={{ label: en.bugHunter.cancel, onClick: () => setConfirmAction(null) }}
        />
      )}
    </SidePanel>
  );
};

/**
 * The decision block's button row. Renders nothing when there is nothing to
 * press — a fixing, releasing or settled bug has a sentence and no buttons,
 * not an empty row of whitespace.
 */
const DecisionActions: FC<{ children: ReactNode }> = ({ children }) => {
  const hasAny = (Array.isArray(children) ? children : [children]).some(Boolean);
  return hasAny ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null;
};
