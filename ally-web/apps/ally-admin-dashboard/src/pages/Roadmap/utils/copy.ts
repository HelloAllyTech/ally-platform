import { en } from "@constants";
import type {
  RoadmapItemDetail,
  RoadmapItemRow,
  RoadmapPersonRef,
  RoadmapShownStage,
  RoadmapSimpleStage,
  RoadmapStatusParts,
  RoadmapTimelineEntry,
  RoadmapWhyHere,
} from "@types";

/**
 * Every word the Roadmap shows about an idea's state, written from data (§2.2, §4.3). The server
 * sends ids, counts and dates; this file is the one place they become copy, so the row, the reading
 * pane and the full page can never describe the same idea two ways.
 */

const t = () => en.roadmapV2;

/** "3 Nov". Empty for a missing or unparseable date, so a line drops the part instead of lying. */
export const shortDate = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

/** Whole days between `iso` and `now`, never negative. */
export const daysSince = (iso: string | null | undefined, now: number = Date.now()): number => {
  if (!iso) return 0;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((now - then) / 86_400_000));
};

export const usd = (value: number | null | undefined): string => {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return n >= 100 || Number.isInteger(n) ? `$${Math.round(n)}` : `$${n.toFixed(2)}`;
};

export const stageWord = (stage: RoadmapShownStage | string | undefined): string =>
  (stage && t().stages[stage]) || "";

/** The tracker's steps: three, because the Roadmap shows five stages in all. Draft comes before them; Declined replaces them. */
export const TRACKER_STEPS: RoadmapSimpleStage[] = ["backlog", "being_built", "shipped"];

export interface TrackerStep {
  stage: RoadmapSimpleStage;
  label: string;
  state: "done" | "current" | "todo";
}

export type TrackerModel =
  | { kind: "steps"; steps: TrackerStep[]; currentIndex: number }
  | { kind: "terminal"; stage: RoadmapSimpleStage; label: string };

/**
 * A finer stage read as the simple stage it falls in (an idea's own `stage` is better when known:
 * an accepted or planning idea is To do until an Owner assigns a builder, Building after).
 */
export const simpleStageOfShown = (
  stage: RoadmapShownStage | RoadmapSimpleStage,
  hasLead = false,
): RoadmapSimpleStage => {
  switch (stage) {
    case "submitted":
      return "backlog";
    case "accepted":
    case "planning":
      return hasLead ? "being_built" : "backlog";
    case "building":
      return "being_built";
    case "closed":
      return "declined";
    default:
      return stage;
  }
};

export const trackerModel = (stage: RoadmapShownStage | RoadmapSimpleStage): TrackerModel => {
  const simple = simpleStageOfShown(stage);
  if (simple === "declined" || simple === "draft") {
    return { kind: "terminal", stage: simple, label: stageWord(simple) };
  }
  const currentIndex = TRACKER_STEPS.indexOf(simple);
  return {
    kind: "steps",
    currentIndex,
    steps: TRACKER_STEPS.map((step, index) => ({
      stage: step,
      label: stageWord(step),
      state: index < currentIndex ? "done" : index === currentIndex ? "current" : "todo",
    })),
  };
};

/** Resolve a user id to a display name from the people the server sent. Never "user 4". */
export const nameFor = (
  userId: number | null | undefined,
  people: RoadmapPersonRef[] | undefined,
  fallback?: RoadmapPersonRef,
): string | null => {
  if (userId == null) return fallback?.name ?? null;
  const person = (Array.isArray(people) ? people : []).find(p => p.id === userId);
  if (person) return person.name;
  if (fallback && fallback.id === userId) return fallback.name;
  return null;
};

const isParts = (parts: unknown): parts is RoadmapStatusParts =>
  !!parts && typeof parts === "object" && typeof (parts as { stage?: unknown }).stage === "string";

const num = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

/**
 * The status line under the tracker (§2.2's examples). `viewerIsAuthor` decides whether a decline
 * shows its reason: only the author and Owners ever receive `declineReason`, so its presence is
 * enough, but the flag keeps a cached copy from leaking it into a shared surface.
 */
export const statusLine = (
  item: Pick<RoadmapItemRow, "statusParts" | "lead" | "votes" | "shownStage"> &
    Partial<Pick<RoadmapItemDetail, "people" | "declineReason">>,
): string => {
  const s = t().status;
  const parts = item.statusParts;
  if (!isParts(parts)) return stageWord(item.shownStage);
  const people = item.people;
  const join = (...bits: (string | null | undefined | false)[]) =>
    bits.filter((b): b is string => typeof b === "string" && b.length > 0).join(" · ");

  switch (parts.stage) {
    case "draft":
      return s.checks(num(parts.checksMet), num(parts.checksTotal) || 5);
    case "submitted": {
      const since = shortDate(parts.since);
      return join(since ? s.waitingForReview(since) : s.submittedNoDate, s.votes(num(parts.votes)));
    }
    case "accepted": {
      if (parts.needsLead || parts.leadUserId == null) return s.needsLead;
      const lead = nameFor(parts.leadUserId, people, item.lead);
      return join(lead ? s.leads(lead) : null, s.planningNotStarted);
    }
    case "planning": {
      const mode = parts.buildMode ? s.buildMode[parts.buildMode] : null;
      // P4 moves "Brief sent to Claude Code … waiting for a PR" here, before any PR exists.
      if (parts.externalBuild) {
        const by = nameFor(parts.externalBuild.byUserId, people);
        return by ? s.briefSentBy(by) : s.briefSent;
      }
      // No builder yet: the Owner is planning it, or has closed the plan and assigns one next.
      if (parts.leadUserId == null) {
        if (parts.planClosed) return s.planClosed;
        return join(
          s.planning,
          parts.prdPercent != null ? s.prd(Math.round(num(parts.prdPercent))) : null,
          num(parts.openQuestions) > 0 ? s.questions(num(parts.openQuestions)) : null,
        );
      }
      const lead = nameFor(parts.leadUserId, people, item.lead);
      if (parts.step === "ready") return join(s.readyToBuild, lead ? s.leads(lead) : null, mode);
      if (parts.step === "design" || parts.designAwaitingApproval) {
        return join(
          parts.designAwaitingApproval ? s.designWaiting : s.designDrafting,
          lead ? s.leads(lead) : null,
        );
      }
      return join(
        lead ? s.leads(lead) : null,
        mode,
        parts.prdPercent != null ? s.prd(Math.round(num(parts.prdPercent))) : null,
        num(parts.openQuestions) > 0 ? s.questions(num(parts.openQuestions)) : null,
      );
    }
    case "building": {
      if (parts.heldReason) return s.held(parts.heldReason);
      // Released is a person's click: live work only prompts the builder.
      if (parts.workLive) return s.workLive;
      if (parts.waitingForPr) {
        const by = parts.externalBuild ? nameFor(parts.externalBuild.byUserId, people) : null;
        return by ? s.briefSentBy(by) : s.briefSent;
      }
      if (parts.releasing) return s.merged;
      const repos = Array.isArray(parts.repos) ? parts.repos : [];
      const prs = Array.isArray(parts.openPrs) ? parts.openPrs : [];
      const pr = prs[0];
      return join(
        repos.length ? s.building(repos.join(" + ")) : s.buildingHere,
        // An unknown CI state says nothing worth reading; the PR number alone still helps.
        pr ? (s.ciWords[pr.ci] ? s.pr(pr.number, s.ciWords[pr.ci]) : s.prOnly(pr.number)) : null,
      );
    }
    case "shipped": {
      if (
        parts.outcome &&
        parts.outcome.hitTarget !== null &&
        parts.outcome.hitTarget !== undefined
      ) {
        return parts.outcome.hitTarget ? s.hitTarget : s.missedTarget;
      }
      const live = shortDate(parts.liveSince);
      const review = shortDate(parts.outcomeReviewAt);
      return join(
        live ? s.liveSince(live) : s.shippedNoDate,
        review ? s.outcomeReview(review) : null,
      );
    }
    case "declined": {
      if (item.declineReason) {
        const by = nameFor(parts.byUserId, people);
        return by ? s.declinedBy(by, item.declineReason) : `${s.declined}: ${item.declineReason}`;
      }
      return s.declined;
    }
    case "closed":
      return parts.reason === "not_pursuing" ? s.notPursuing : s.archived;
    default:
      return stageWord(item.shownStage);
  }
};

/** The one line saying why a row is in this view (§4.3). Empty when the server sent none. */
export const whyHereLine = (why: RoadmapWhyHere | undefined, now: number = Date.now()): string => {
  if (!why || typeof why !== "object") return "";
  const w = t().why;
  const i2p = en.roadmapIdeaToPlan.why;
  switch (why.kind) {
    case "agentQuestion":
      if (why.forAuthor) return i2p.authorQuestion(why.questionPreview ?? "");
      return why.phase === "idea"
        ? w.ideaAgentAsks(why.questionPreview ?? "")
        : w.planAgentAsks(why.questionPreview ?? "");
    case "mention":
      return why.by?.name ? w.mention(why.by.name) : "";
    case "decision":
      return w.decisions[why.decision] ?? "";
    case "awaitingReview":
      return w.waitingDays(daysSince(why.since, now));
    case "needsLead":
      return w.needsLeadSince(shortDate(why.since));
    case "reassign":
      return w.reassign(num(why.idleDays));
    case "progress":
      return (why.notice && i2p.progress[why.notice]) || w.progress;
    case "notice":
      return why.notice === "planReady" ? i2p.planReady : i2p.questionAnswered(why.by?.name ?? "");
    case "shipped":
      return w.shipped(shortDate(why.at));
    default:
      return "";
  }
};

/** "Ravi wrote it · Priya leads". */
export const peopleLine = (item: Pick<RoadmapItemRow, "author" | "lead">): string => {
  const p = t().people;
  return [
    item.author?.name ? p.wrote(item.author.name) : null,
    item.lead?.name ? p.leads(item.lead.name) : null,
  ]
    .filter(Boolean)
    .join(" · ");
};

/** "Ravi (author)" / "Ana (Builder)". */
export const personLabel = (person: RoadmapPersonRef): string => {
  const p = t().people;
  const tag = (person.relation && p.relations[person.relation]) || p.roles[person.role] || "";
  return tag ? `${person.name} (${tag})` : person.name;
};

/**
 * The quiet line that stands where an action would be, when nothing on this idea is yours to do
 * (§4.0 #14, §4.5). Never a greyed-out button.
 */
export const quietLine = (
  item: Pick<RoadmapItemRow, "shownStage" | "lead"> & Partial<Pick<RoadmapItemRow, "statusParts">>,
): string => {
  const q = t().quietLine;
  if (item.lead?.name) return q.leadDecides(item.lead.name);
  if (item.shownStage === "submitted") return q.ownerReviews;
  if (item.shownStage === "accepted") return q.ownerPicksLead;
  if (item.shownStage === "planning") {
    const parts = item.statusParts;
    return isParts(parts) && parts.stage === "planning" && parts.planClosed
      ? q.ownerAssigns
      : q.ownerPlanning;
  }
  return q.nothingToDo;
};

/** The side-panel tab that matches the stage (§4.5 "opens on the tab that matches the stage"). */
export type IdeaPanelTab = "summary" | "prd" | "design" | "build" | "ship";
export const IDEA_PANEL_TABS: IdeaPanelTab[] = ["summary", "prd", "design", "build", "ship"];

export const panelTabForStage = (
  stage: RoadmapShownStage,
  parts?: RoadmapItemRow["statusParts"],
): IdeaPanelTab => {
  switch (stage) {
    case "planning":
      return isParts(parts) && parts.stage === "planning" && parts.step !== "prd"
        ? "design"
        : "prd";
    case "building":
      return "build";
    case "shipped":
      return "ship";
    default:
      return "summary";
  }
};

/**
 * One milestone on an idea's timeline, in words (lifecycle 2026-11-18). Null for a kind this
 * client doesn't know, so a newer server never shows a raw key.
 */
export const timelineLabel = (entry: RoadmapTimelineEntry): string | null => {
  const w = t().idea.timeline;
  const who = entry.actor?.name || t().idea.unknownPerson;
  const d = (entry.detail ?? {}) as Record<string, unknown>;
  const personName = (value: unknown): string | null =>
    value && typeof value === "object" && typeof (value as { name?: unknown }).name === "string"
      ? (value as { name: string }).name
      : null;
  switch (entry.kind) {
    case "submitted":
      return w.submitted(who);
    case "reviewed":
      if (d.decision === "decline") return w.declined(who);
      if (d.decision === "reopen") return w.reopened(who);
      return w.accepted(who);
    case "planning_started":
      return w.planningStarted(who);
    case "plan_closed":
      return w.planClosed(who);
    case "plan_reopened":
      return w.planReopened(who);
    case "lead_assigned": {
      const from = personName(d.from);
      const to = personName(d.to) ?? t().idea.unknownPerson;
      return from ? w.builderChanged(who, from, to) : w.builderAssigned(who, to);
    }
    case "lead_handed_back":
      return w.handedBack(who);
    case "design_approved":
      return w.designApproved(who);
    case "build_sent":
      return w.buildStarted(who);
    case "external_build":
      return w.briefSent(who);
    case "build_mode_set": {
      const mode = typeof d.to === "string" ? t().status.buildMode[d.to] : undefined;
      return mode ? w.buildMode(who, mode) : null;
    }
    case "release_live":
      return w.releaseLive(typeof d.service === "string" ? d.service : "");
    case "marked_released":
      return w.markedReleased(who);
    case "closed":
      return w.closed(who);
    case "reopened":
      return w.reopened(who);
    case "item_edited": {
      const field = typeof d.field === "string" ? w.fields[d.field] : undefined;
      return field ? w.edited(who, field) : null;
    }
    case "answer_settled":
      return w.answerSettled(who);
    default:
      return null;
  }
};

/**
 * Where each timeline milestone sits in the conversation: before the first message at or after
 * it (key: that message's id), or at the end (key: null). Pure; the feed is in time order.
 */
export const timelineAnchors = (
  timeline: RoadmapTimelineEntry[] | undefined,
  feed: { id: string }[],
  createdAt: (id: string) => string | undefined,
): Map<string | null, RoadmapTimelineEntry[]> => {
  const out = new Map<string | null, RoadmapTimelineEntry[]>();
  for (const entry of Array.isArray(timeline) ? timeline : []) {
    const at = new Date(entry.at).getTime();
    const anchor =
      feed.find(message => {
        const when = createdAt(message.id);
        return when ? new Date(when).getTime() >= at : false;
      })?.id ?? null;
    const list = out.get(anchor) ?? [];
    list.push(entry);
    out.set(anchor, list);
  }
  return out;
};
