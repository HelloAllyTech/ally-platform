/**
 * Debrief v2 ("autonomy by default"): the console's new endpoints, typed exactly as the API
 * contract at the bottom of `docs/debrief-harness/V2_AUTONOMY.md` declares them. All live under
 * `v1/debriefs/console`. Money in USD numbers; dates ISO.
 */

export type ChangeState =
  | "waits"
  | "trying"
  | "building"
  | "testing"
  | "live"
  | "undone"
  | "stopped"
  | "turned_down";

/** `GET home`: the Debriefs home's headline, what needs a person, and this week's changes. */
export interface DebriefHomeV2 {
  headline: {
    score: number | null;
    lastWeekScore: number | null;
    debriefs: number;
    needsYou: number;
  };
  /** Always-ask changes only. */
  needsYou: Array<{ changeId: string; title: string; why: string }>;
  thisWeek: {
    score: number | null;
    wentLive: number;
    undone: number;
    changes: Array<{ id: string; title: string; state: ChangeState; result: string }>;
  };
}

/** `GET changes?state=`, `GET changes/:id`; also what `undo` and `stop` return. */
export interface DebriefChange {
  /** The idea id. */
  id: string;
  /** What changes, in one sentence. */
  title: string;
  /** "Prompt · Writer", "Pinned rule · Safety reader", "Model · Writer", "Code · Builder". */
  kind: string;
  state: ChangeState;
  /** The headline: what it did, or where it is. */
  result: string;
  /** Why the PM agent made it. */
  why: string;
  /** "live since 12 Nov". */
  when: string;
  /** Only for state 'waits'. */
  waitsBecause: string | null;
  confidence: "high" | "low" | null;
  /** Null = every language; else the languages it applies to. */
  languages: string[] | null;
  measures: Array<{ name: string; value: string; tone: "up" | "down" | "flat" }>;
  steps: Array<{ name: string; state: string; detail: string; tone: "pass" | "wait" | "fail" }>;
  /** Evidence in one line. */
  basedOn: string;
  /**
   * NOT IN THE CONTRACT YET (Home › Needs you, review 2026-11-16): the wording before and after,
   * for a text change, so a person can read the difference before answering. Absent or null for
   * a change with no text (a model, a setting, code).
   */
  wording?: { before: string; after: string } | null;
  /** Live: Undo now. */
  canUndo: boolean;
  /** Trying / testing: Stop now. */
  canStop: boolean;
}

/** What a PM agent message was about. */
export interface PmAbout {
  kind: "change" | "session" | "page";
  id?: string;
  label: string;
}

/** One message in the console's one PM agent conversation. */
export interface PmMessage {
  id: string;
  at: string;
  who: "person" | "agent";
  /** The person's name. */
  author: string | null;
  text: string;
  about: PmAbout | null;
  action: { label: string; status: "done" | "awaiting_yes" | "failed" } | null;
}

/** `GET pm-agent/conversation?before=<id>&limit=50`. */
export interface PmConversationPage {
  messages: PmMessage[];
  more: boolean;
}

/** `POST pm-agent/conversation`: the person's message and the agent's reply (~10–30 s). */
export interface PmConversationSend {
  text: string;
  about?: PmAbout;
}

/** `GET metrics/score?days=56`: the overall score, its measures and its two gates. */
export interface DebriefScoreView {
  current: number | null;
  previous: number | null;
  debriefs: number;
  byWeek: Array<{ week: string; score: number | null; n: number }>;
  markers: Array<{ week: string; kind: "live" | "undone"; changeId: string; title: string }>;
  measures: Array<{
    key: "quality" | "pass" | "helpful" | "flags";
    label: string;
    weight: number;
    value: number | null;
    display: string;
    trend: string;
    tone: "up" | "down" | "flat";
  }>;
  gates: Array<{ key: "risk" | "cost"; label: string; ok: boolean; display: string }>;
  byLanguage: Array<{ language: string; score: number | null; n: number }>;
}

/** A learner flag's answer from the Debrief agent (session view, each flag). */
export interface DebriefFlagAnswer {
  action: "kept" | "corrected" | "removed";
  reply: string;
  at: string;
}

/** Settings › Tests: the last change to one setting (by the PM agent or a person). */
export interface DebriefSettingLastChange {
  lastChangedBy: "PM agent" | string;
  /** The person's user id; absent or null when the PM agent made the change. */
  lastChangedById?: number | null;
  lastChangedAt: string;
  why: string;
  changeId: string;
}
