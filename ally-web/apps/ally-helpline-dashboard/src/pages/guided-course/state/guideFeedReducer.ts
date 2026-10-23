/**
 * The conversation as the learner sees it, folded from the thread's event
 * stream (plan §9.2). Pure: every SSE event, every optimistic echo and every
 * local card action goes through `guideFeedReducer`, so reload, replay and
 * reconnect all land on the same state.
 *
 * Rules that matter:
 * - Durable events carry a monotonic `seq`; anything at or below the last
 *   applied seq is a replay and is ignored, so a reconnect with
 *   `Last-Event-ID` can never duplicate a message or a card.
 * - Ephemeral events (deltas, presence, next step…) reuse the last durable
 *   seq and are applied as they come.
 * - The learner's message is echoed at once under its `clientTurnId` and
 *   swapped in place for the stored message when `learner.message` arrives.
 * - Card state is the server's (`card.updated`). The client only decides
 *   which card's player is open (`activeCardId`), and only one is.
 */
import type { JourneyBootstrap, JourneyNextStep } from "../contract/bootstrap";
import type {
  GuideAnchor,
  GuideAtmosphere,
  GuideCard,
  GuideCardState,
  GuideCrisisLine,
  GuideEvent,
  GuideEventMilestone,
  GuideEventNotebookAdded,
  GuideFailureCode,
  GuideMemoryRef,
  GuideMode,
  GuidePresenceState,
  GuideSceneReceipt,
} from "../contract/wire";

export type LearnerEchoStatus = "sending" | "queued" | "failed";

export interface MessageEntry {
  kind: "message";
  id: string;
  role: "ally" | "learner" | "system";
  text: string;
  /** `streaming` while deltas arrive; echo states before the server stores it. */
  status: "final" | "streaming" | LearnerEchoStatus;
  turnId: string | null;
  clientTurnId: string | null;
  seq: number | null;
  sceneId: string | null;
  interrupted?: boolean;
  memoryRefs?: GuideMemoryRef[];
  anchor?: GuideAnchor | null;
  /** Pre-written copy (crisis, fixed lines), never model text. */
  fixed?: boolean;
}

export interface CardEntry {
  kind: "card";
  id: string;
  seq: number | null;
  sceneId: string | null;
}

export interface SceneEntry {
  kind: "scene";
  id: string;
  seq: number;
  sceneId: string;
}

export interface ReceiptEntry {
  kind: "receipt";
  id: string;
  seq: number;
  sceneId: string;
}

export interface MilestoneEntry {
  kind: "milestone";
  id: string;
  seq: number;
  sceneId: string | null;
  milestone: GuideEventMilestone["data"];
}

export interface NotebookEntry {
  kind: "notebook";
  id: string;
  seq: number;
  sceneId: string | null;
  entry: GuideEventNotebookAdded["data"];
}

export interface CrisisEntry {
  kind: "crisis";
  id: string;
  seq: number;
}

export type FeedEntry =
  | MessageEntry
  | CardEntry
  | SceneEntry
  | ReceiptEntry
  | MilestoneEntry
  | NotebookEntry
  | CrisisEntry;

export interface SceneState {
  sceneId: string;
  sectionId: string;
  title: string;
  stakes: string | null;
  closed: boolean;
  receipt: GuideSceneReceipt | null;
}

export interface CrisisState {
  messageId: string;
  text: string;
  language: string;
  lines: GuideCrisisLine[];
}

export interface TurnFailure {
  code: GuideFailureCode;
  message: string;
  turnId: string | null;
  /** The echo the failure belongs to, so Retry can resend its text. */
  clientTurnId: string | null;
}

export interface GuideFeedState {
  threadId: string | null;
  /** Last durable seq applied; the stream resumes after it. */
  lastSeq: number;
  entries: FeedEntry[];
  cards: Record<string, GuideCard>;
  scenes: Record<string, SceneState>;
  currentSceneId: string | null;
  mode: GuideMode;
  atmosphere: GuideAtmosphere;
  presence: { state: GuidePresenceState; caption: string | null };
  activeTurnId: string | null;
  toolActivity: string | null;
  nextStep: JourneyNextStep | null;
  allowance: { remaining: number; limit: number } | null;
  failure: TurnFailure | null;
  /** The server asked for this card to open in the Shelf (`shelf.open`). */
  shelfRequest: { cardId: string; width: "reading" | "utility" } | null;
  progress: { currentItemId: string | null; completedItems: number; totalItems: number } | null;
  crisis: CrisisState | null;
  /** "I'm safe right now" was chosen: the crisis card folds into a Support chip. */
  supportPinned: boolean;
  /** The one card whose player is open. */
  activeCardId: string | null;
}

export type GuideFeedAction =
  | { type: "hydrate"; bootstrap: JourneyBootstrap }
  | { type: "event"; event: GuideEvent }
  | {
      type: "learner/echo";
      clientTurnId: string;
      text: string;
      anchor?: GuideAnchor | null;
      status?: LearnerEchoStatus;
    }
  | { type: "learner/accepted"; clientTurnId: string; turnId: string }
  | { type: "learner/status"; clientTurnId: string; status: LearnerEchoStatus }
  | { type: "learner/discard"; clientTurnId: string }
  | { type: "failure/local"; failure: TurnFailure }
  | { type: "failure/dismiss" }
  | { type: "card/open"; cardId: string }
  | { type: "card/close"; cardId?: string }
  | { type: "card/localState"; cardId: string; state: GuideCardState }
  | { type: "shelf/consumed" }
  | { type: "crisis/safe" };

export const initialFeedState: GuideFeedState = {
  threadId: null,
  lastSeq: 0,
  entries: [],
  cards: {},
  scenes: {},
  currentSceneId: null,
  mode: "NORMAL",
  atmosphere: "bright",
  presence: { state: "idle", caption: null },
  activeTurnId: null,
  toolActivity: null,
  nextStep: null,
  allowance: null,
  failure: null,
  shelfRequest: null,
  progress: null,
  crisis: null,
  supportPinned: false,
  activeCardId: null,
};

const learnerRoleOf = (role: string): MessageEntry["role"] =>
  role === "learner" ? "learner" : role === "ally" ? "ally" : "system";

const replaceEntry = (
  entries: FeedEntry[],
  predicate: (entry: FeedEntry) => boolean,
  update: (entry: FeedEntry) => FeedEntry,
): FeedEntry[] | null => {
  const index = entries.findIndex(predicate);
  if (index < 0) return null;
  const next = entries.slice();
  next[index] = update(entries[index]);
  return next;
};

const isMessage = (entry: FeedEntry): entry is MessageEntry => entry.kind === "message";

/** Drops a turn's half-streamed text (a crisis or a failure cut it off). */
const dropStreaming = (entries: FeedEntry[], turnId: string | null): FeedEntry[] =>
  entries.filter(
    entry =>
      !(
        isMessage(entry) &&
        entry.status === "streaming" &&
        (turnId === null || entry.turnId === turnId)
      ),
  );

const hydrate = (bootstrap: JourneyBootstrap): GuideFeedState => {
  const thread = bootstrap.thread;
  const base: GuideFeedState = {
    ...initialFeedState,
    threadId: thread?.id ?? null,
    mode: thread?.mode ?? "NORMAL",
    atmosphere: thread?.atmosphere ?? "bright",
    nextStep: bootstrap.nextStep,
    progress: bootstrap.progress,
    // A reload during a crisis brings the pinned card straight back.
    crisis: bootstrap.crisis
      ? {
          messageId: bootstrap.crisis.messageId,
          text: bootstrap.crisis.text,
          language: bootstrap.crisis.language,
          lines: bootstrap.crisis.lines,
        }
      : null,
  };
  if (!bootstrap.complete) {
    // Nothing trustworthy to show yet: the stream replays from seq 0.
    return base;
  }

  const cards: Record<string, GuideCard> = {};
  type Placed = { seq: number; order: number; entry: FeedEntry };
  const placed: Placed[] = [];
  bootstrap.messages.forEach((message, order) => {
    placed.push({
      seq: message.seq,
      order,
      entry: {
        kind: "message",
        id: message.id,
        role: learnerRoleOf(message.role),
        text: message.text,
        status: "final",
        turnId: message.turnId,
        clientTurnId: null,
        seq: message.seq,
        sceneId: null,
        interrupted: message.interrupted ?? false,
        fixed: message.kind === "fixed" || message.kind === "crisis_fixed",
      },
    });
  });
  bootstrap.cards.forEach((card, order) => {
    const { seq, ...rest } = card;
    cards[card.cardId] = rest;
    placed.push({
      // Cards without a position go after everything the server ordered.
      seq: seq ?? Number.MAX_SAFE_INTEGER,
      order: bootstrap.messages.length + order,
      entry: { kind: "card", id: card.cardId, seq: seq ?? null, sceneId: null },
    });
  });
  placed.sort((a, b) => a.seq - b.seq || a.order - b.order);

  return {
    ...base,
    lastSeq: thread?.lastEventSeq ?? 0,
    entries: placed.map(p => p.entry),
    cards,
  };
};

const applyDurable = (state: GuideFeedState, event: GuideEvent): GuideFeedState => {
  const seq = event.seq;
  const sceneId = state.currentSceneId;
  switch (event.type) {
    case "learner.message": {
      const { data } = event;
      const final: MessageEntry = {
        kind: "message",
        id: data.messageId,
        role: "learner",
        text: data.text,
        status: "final",
        turnId: data.turnId ?? null,
        clientTurnId: data.clientTurnId ?? null,
        seq,
        sceneId,
        anchor: data.anchor ?? null,
      };
      const swapped = data.clientTurnId
        ? replaceEntry(
            state.entries,
            e => isMessage(e) && e.role === "learner" && e.clientTurnId === data.clientTurnId,
            existing => ({ ...final, sceneId: (existing as MessageEntry).sceneId }),
          )
        : null;
      return { ...state, entries: swapped ?? [...state.entries, final] };
    }
    case "assistant.message": {
      const { data } = event;
      const update = (existing?: MessageEntry): MessageEntry => ({
        kind: "message",
        id: data.messageId,
        role: "ally",
        text: data.text,
        status: "final",
        turnId: data.turnId,
        clientTurnId: null,
        seq,
        sceneId: existing?.sceneId ?? sceneId,
        interrupted: data.interrupted ?? false,
        memoryRefs: data.memoryRefs ?? [],
      });
      const swapped = replaceEntry(
        state.entries,
        e => isMessage(e) && e.id === data.messageId,
        existing => update(existing as MessageEntry),
      );
      return { ...state, entries: swapped ?? [...state.entries, update()] };
    }
    case "card.presented": {
      const { card } = event.data;
      const cards = { ...state.cards, [card.cardId]: card };
      const known = state.entries.some(e => e.kind === "card" && e.id === card.cardId);
      return {
        ...state,
        cards,
        entries: known
          ? state.entries
          : [...state.entries, { kind: "card", id: card.cardId, seq, sceneId }],
      };
    }
    case "card.updated": {
      const { data } = event;
      const card = state.cards[data.cardId];
      if (!card) return state;
      return {
        ...state,
        cards: {
          ...state.cards,
          [data.cardId]: {
            ...card,
            state: data.state,
            ...(data.tone ? { tone: data.tone } : {}),
            ...(data.payload ? { payload: { ...(card.payload ?? {}), ...data.payload } } : {}),
          },
        },
      };
    }
    case "spine.updated":
      return { ...state, progress: { ...event.data } };
    case "scene.opened": {
      const { data } = event;
      return {
        ...state,
        currentSceneId: data.sceneId,
        scenes: {
          ...state.scenes,
          [data.sceneId]: {
            sceneId: data.sceneId,
            sectionId: data.sectionId,
            title: data.title,
            stakes: data.stakes ?? null,
            closed: false,
            receipt: null,
          },
        },
        entries: [
          ...state.entries,
          { kind: "scene", id: `scene:${data.sceneId}`, seq, sceneId: data.sceneId },
        ],
      };
    }
    case "scene.closed": {
      const { data } = event;
      const scene = state.scenes[data.sceneId] ?? {
        sceneId: data.sceneId,
        sectionId: data.sectionId,
        title: "",
        stakes: null,
        closed: false,
        receipt: null,
      };
      return {
        ...state,
        currentSceneId: state.currentSceneId === data.sceneId ? null : state.currentSceneId,
        scenes: {
          ...state.scenes,
          [data.sceneId]: { ...scene, closed: true, receipt: data.receipt },
        },
        entries: [
          ...state.entries,
          { kind: "receipt", id: `receipt:${data.sceneId}`, seq, sceneId: data.sceneId },
        ],
      };
    }
    case "mode.changed": {
      const { mode, atmosphere } = event.data;
      const leavingCrisis = state.mode === "CRISIS" && mode !== "CRISIS";
      return {
        ...state,
        mode,
        atmosphere,
        supportPinned: state.supportPinned || leavingCrisis,
        // The Shelf and Theatre close in a crisis (plan §6.3).
        activeCardId: mode === "CRISIS" ? null : state.activeCardId,
        shelfRequest: mode === "CRISIS" ? null : state.shelfRequest,
      };
    }
    case "crisis.response": {
      const { data } = event;
      return {
        ...state,
        crisis: {
          messageId: data.messageId,
          text: data.text,
          language: data.language,
          lines: data.lines,
        },
        supportPinned: false,
        activeCardId: null,
        shelfRequest: null,
        // Output is held until the Sentinel clears it; whatever streamed is dropped.
        entries: [
          ...dropStreaming(state.entries, null),
          { kind: "crisis", id: data.messageId, seq },
        ],
        presence: { state: "idle", caption: null },
        toolActivity: null,
      };
    }
    case "notebook.added":
      return {
        ...state,
        entries: [
          ...state.entries,
          {
            kind: "notebook",
            id: `notebook:${event.data.entryId}`,
            seq,
            sceneId,
            entry: event.data,
          },
        ],
      };
    case "milestone":
      return {
        ...state,
        entries: [
          ...state.entries,
          { kind: "milestone", id: `milestone:${seq}`, seq, sceneId, milestone: event.data },
        ],
      };
    default:
      return state;
  }
};

const applyEphemeral = (state: GuideFeedState, event: GuideEvent): GuideFeedState => {
  switch (event.type) {
    case "hello":
      return { ...state, mode: event.data.mode, atmosphere: event.data.atmosphere };
    case "turn.started":
      return { ...state, activeTurnId: event.data.turnId, failure: null, toolActivity: null };
    case "assistant.delta": {
      const { data } = event;
      const index = state.entries.findIndex(e => isMessage(e) && e.id === data.messageId);
      if (index >= 0) {
        const existing = state.entries[index] as MessageEntry;
        if (existing.status !== "streaming") return state;
        const entries = state.entries.slice();
        entries[index] = { ...existing, text: existing.text + data.text };
        return { ...state, entries };
      }
      const draft: MessageEntry = {
        kind: "message",
        id: data.messageId,
        role: "ally",
        text: data.text,
        status: "streaming",
        turnId: data.turnId,
        clientTurnId: null,
        seq: null,
        sceneId: state.currentSceneId,
      };
      return { ...state, entries: [...state.entries, draft] };
    }
    case "presence":
      return {
        ...state,
        presence: { state: event.data.state, caption: event.data.caption ?? null },
      };
    case "shelf.open":
      return { ...state, shelfRequest: { ...event.data } };
    case "next_step":
      return {
        ...state,
        nextStep: {
          ...event.data,
          itemId: event.data.itemId ?? null,
          title: event.data.title ?? null,
          minutes: event.data.minutes ?? null,
        },
      };
    case "tool.activity":
      return { ...state, toolActivity: event.data.label };
    case "allowance":
      return { ...state, allowance: { ...event.data } };
    case "turn.completed":
      return {
        ...state,
        activeTurnId: state.activeTurnId === event.data.turnId ? null : state.activeTurnId,
        toolActivity: null,
        presence:
          state.presence.state === "thinking" ? { state: "idle", caption: null } : state.presence,
      };
    case "turn.failed": {
      const { data } = event;
      const turnId = data.turnId ?? null;
      // The learner's own message stays, marked so Retry can resend it.
      const echo = state.entries.find(
        (e): e is MessageEntry =>
          isMessage(e) &&
          e.role === "learner" &&
          e.status !== "final" &&
          (turnId === null || e.turnId === turnId),
      );
      const entries = dropStreaming(state.entries, turnId).map(entry =>
        echo && entry === echo ? { ...echo, status: "failed" as const } : entry,
      );
      return {
        ...state,
        entries,
        activeTurnId: null,
        toolActivity: null,
        presence: { state: "idle", caption: null },
        failure: {
          code: data.code,
          message: data.message,
          turnId,
          clientTurnId: echo?.clientTurnId ?? null,
        },
      };
    }
    default:
      return state;
  }
};

export const guideFeedReducer = (
  state: GuideFeedState,
  action: GuideFeedAction,
): GuideFeedState => {
  switch (action.type) {
    case "hydrate":
      return hydrate(action.bootstrap);
    case "event": {
      const { event } = action;
      if (state.threadId && event.threadId !== state.threadId) return state;
      if (event.durable) {
        if (event.seq <= state.lastSeq) return state;
        return { ...applyDurable(state, event), lastSeq: event.seq };
      }
      return applyEphemeral(state, event);
    }
    case "learner/echo": {
      const echo: MessageEntry = {
        kind: "message",
        id: `echo:${action.clientTurnId}`,
        role: "learner",
        text: action.text,
        status: action.status ?? "sending",
        turnId: null,
        clientTurnId: action.clientTurnId,
        seq: null,
        sceneId: state.currentSceneId,
        anchor: action.anchor ?? null,
      };
      return { ...state, entries: [...state.entries, echo], failure: null };
    }
    case "learner/accepted": {
      const entries = replaceEntry(
        state.entries,
        e => isMessage(e) && e.clientTurnId === action.clientTurnId && e.status !== "final",
        e => ({ ...(e as MessageEntry), turnId: action.turnId, status: "sending" }),
      );
      return entries ? { ...state, entries } : state;
    }
    case "learner/status": {
      const entries = replaceEntry(
        state.entries,
        e => isMessage(e) && e.clientTurnId === action.clientTurnId && e.status !== "final",
        e => ({ ...(e as MessageEntry), status: action.status }),
      );
      return entries ? { ...state, entries } : state;
    }
    case "learner/discard":
      return {
        ...state,
        entries: state.entries.filter(
          e => !(isMessage(e) && e.clientTurnId === action.clientTurnId && e.status !== "final"),
        ),
      };
    case "failure/local":
      return { ...state, failure: action.failure };
    case "failure/dismiss":
      return { ...state, failure: null };
    case "card/open":
      if (!state.cards[action.cardId] || state.mode === "CRISIS") return state;
      return { ...state, activeCardId: action.cardId };
    case "card/close":
      if (action.cardId && state.activeCardId !== action.cardId) return state;
      return { ...state, activeCardId: null };
    case "card/localState": {
      const card = state.cards[action.cardId];
      if (!card) return state;
      return {
        ...state,
        cards: { ...state.cards, [action.cardId]: { ...card, state: action.state } },
      };
    }
    case "shelf/consumed":
      return { ...state, shelfRequest: null };
    case "crisis/safe":
      return { ...state, supportPinned: true };
    default:
      return state;
  }
};

/** The learner's messages that still need sending (offline queue, plan §11 E-6). */
export const queuedEchoes = (state: GuideFeedState): MessageEntry[] =>
  state.entries.filter(
    (e): e is MessageEntry => isMessage(e) && e.role === "learner" && e.status === "queued",
  );

/** The last thing Ally said, for "That's not what I meant". */
export const lastAllyMessage = (state: GuideFeedState): MessageEntry | null => {
  for (let i = state.entries.length - 1; i >= 0; i -= 1) {
    const entry = state.entries[i];
    if (isMessage(entry)) return entry.role === "ally" && entry.status === "final" ? entry : null;
  }
  return null;
};

export const isStreaming = (state: GuideFeedState): boolean =>
  state.entries.some(e => isMessage(e) && e.status === "streaming");

/**
 * What Retry should send again after a failed turn: the learner's message
 * from that turn, whether or not the server had stored it yet.
 */
export const failureRetryText = (state: GuideFeedState): string | null => {
  const { failure } = state;
  if (!failure) return null;
  const learner = state.entries.filter(
    (e): e is MessageEntry => isMessage(e) && e.role === "learner",
  );
  const match =
    (failure.clientTurnId && learner.find(e => e.clientTurnId === failure.clientTurnId)) ||
    (failure.turnId && learner.find(e => e.turnId === failure.turnId)) ||
    null;
  return match ? match.text : null;
};
