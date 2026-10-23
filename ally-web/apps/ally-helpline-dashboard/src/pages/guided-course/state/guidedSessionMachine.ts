/**
 * The journey's lifecycle, separate from its content (`guideFeedReducer`):
 * where boot ended up, whether the stream is live, and where the current
 * turn is. Pure, so every designed state in plan §5.12 is reachable from a
 * test without timers or a network.
 *
 *   boot:        loading → ready | denied | unavailable | disabled | signed_out | error
 *   connection:  idle → connecting → open ⇄ reconnecting;  any → offline → reconnecting
 *   turn:        idle → sending → waiting → streaming → idle
 *
 * Timing cues are derived, not stored: `turnCues(state, now)` says whether
 * the thinking caption (after 600 ms) or the slow-turn line (after 8 s)
 * should show (plan §5.1, Appendix A).
 */
import { TrackAccessDenialReason } from "@types";
import type { GuideEvent, GuideFailureCode } from "@types/generated/guide-contract";

export type BootPhase =
  | "loading"
  | "ready"
  | "denied"
  | "unavailable"
  | "disabled"
  | "signed_out"
  | "error";

export type ConnectionPhase = "idle" | "connecting" | "open" | "reconnecting" | "offline";

export type TurnPhase = "idle" | "sending" | "waiting" | "streaming";

export interface GuidedSessionState {
  boot: BootPhase;
  denialReason: TrackAccessDenialReason | null;
  connection: ConnectionPhase;
  /** Consecutive failed connection attempts; resets when the stream opens. */
  reconnectAttempt: number;
  turn: TurnPhase;
  /** When the learner's turn was sent (ms); drives the thinking and slow cues. */
  turnSince: number | null;
  /** The browser said it is offline; reconnecting waits for `online`. */
  networkOffline: boolean;
}

export type GuidedSessionEvent =
  | { type: "BOOT_OK" }
  | { type: "BOOT_DENIED"; reason: TrackAccessDenialReason | null }
  | { type: "BOOT_UNAVAILABLE" }
  | { type: "BOOT_DISABLED" }
  | { type: "BOOT_SIGNED_OUT" }
  | { type: "BOOT_ERROR" }
  | { type: "STREAM_CONNECTING" }
  | { type: "STREAM_OPEN" }
  | { type: "STREAM_LOST" }
  | { type: "NETWORK_OFFLINE" }
  | { type: "NETWORK_ONLINE" }
  | { type: "TURN_SUBMITTED"; at: number }
  | { type: "TURN_REJECTED" }
  | { type: "SERVER_EVENT"; event: GuideEvent; at: number };

export const initialSessionState: GuidedSessionState = {
  boot: "loading",
  denialReason: null,
  connection: "idle",
  reconnectAttempt: 0,
  turn: "idle",
  turnSince: null,
  networkOffline: false,
};

/** Failure codes that end the guided session rather than one turn. */
const FATAL_CODES: Partial<Record<GuideFailureCode, BootPhase>> = {
  guide_disabled: "disabled",
  no_access: "denied",
};

export const guidedSessionMachine = (
  state: GuidedSessionState,
  event: GuidedSessionEvent,
): GuidedSessionState => {
  switch (event.type) {
    case "BOOT_OK":
      return { ...state, boot: "ready", denialReason: null };
    case "BOOT_DENIED":
      return { ...state, boot: "denied", denialReason: event.reason, connection: "idle" };
    case "BOOT_UNAVAILABLE":
      return { ...state, boot: "unavailable", connection: "idle" };
    case "BOOT_DISABLED":
      return { ...state, boot: "disabled", connection: "idle" };
    case "BOOT_SIGNED_OUT":
      return { ...state, boot: "signed_out", connection: "idle" };
    case "BOOT_ERROR":
      return { ...state, boot: "error", connection: "idle" };

    case "STREAM_CONNECTING":
      if (state.networkOffline) return { ...state, connection: "offline" };
      return {
        ...state,
        connection: state.connection === "idle" ? "connecting" : "reconnecting",
      };
    case "STREAM_OPEN":
      return { ...state, connection: "open", reconnectAttempt: 0 };
    case "STREAM_LOST":
      return {
        ...state,
        connection: state.networkOffline ? "offline" : "reconnecting",
        reconnectAttempt: state.reconnectAttempt + 1,
        // A turn cut off mid-stream resolves on reconnect: its result is
        // replayed, or it arrives as `turn.failed{interrupted}`.
        turn: state.turn === "streaming" ? "waiting" : state.turn,
      };
    case "NETWORK_OFFLINE":
      return { ...state, networkOffline: true, connection: "offline" };
    case "NETWORK_ONLINE":
      return {
        ...state,
        networkOffline: false,
        connection: state.connection === "offline" ? "reconnecting" : state.connection,
      };

    case "TURN_SUBMITTED":
      return { ...state, turn: "sending", turnSince: event.at };
    case "TURN_REJECTED":
      return { ...state, turn: "idle", turnSince: null };

    case "SERVER_EVENT": {
      const server = event.event;
      switch (server.type) {
        case "hello":
          return { ...state, connection: "open", reconnectAttempt: 0 };
        case "turn.started":
          return {
            ...state,
            turn: "waiting",
            turnSince: state.turnSince ?? event.at,
          };
        case "assistant.delta":
          return { ...state, turn: "streaming" };
        case "turn.completed":
          return { ...state, turn: "idle", turnSince: null };
        case "turn.failed": {
          const fatal = FATAL_CODES[server.data.code];
          return {
            ...state,
            turn: "idle",
            turnSince: null,
            ...(fatal ? { boot: fatal } : {}),
          };
        }
        case "crisis.response":
          return { ...state, turn: "idle", turnSince: null };
        default:
          return state;
      }
    }
    default:
      return state;
  }
};

/** Thinking caption after 600 ms; "taking me a moment" after 8 s. */
export const THINKING_CAPTION_AFTER_MS = 600;
export const SLOW_TURN_AFTER_MS = 8_000;

export interface TurnCues {
  thinking: boolean;
  showCaption: boolean;
  slow: boolean;
}

export const turnCues = (state: GuidedSessionState, now: number): TurnCues => {
  const waiting = state.turn === "sending" || state.turn === "waiting";
  const elapsed = waiting && state.turnSince !== null ? now - state.turnSince : 0;
  return {
    thinking: waiting,
    showCaption: waiting && elapsed >= THINKING_CAPTION_AFTER_MS,
    slow: waiting && elapsed >= SLOW_TURN_AFTER_MS,
  };
};

/** Whether the composer may send right now (otherwise it queues or waits). */
export const canSendNow = (state: GuidedSessionState): boolean =>
  state.boot === "ready" && state.turn === "idle";

/** Offline or reconnecting: messages queue and send on reconnect. */
export const shouldQueue = (state: GuidedSessionState): boolean =>
  state.networkOffline || state.connection === "offline";

/** The offline line shows once a drop has outlasted one quick retry. */
export const showOfflineNotice = (state: GuidedSessionState): boolean =>
  state.boot === "ready" &&
  (state.connection === "offline" ||
    (state.connection === "reconnecting" && state.reconnectAttempt >= 2));
