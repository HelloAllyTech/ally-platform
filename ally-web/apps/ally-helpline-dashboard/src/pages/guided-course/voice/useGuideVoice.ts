import { useCallback, useEffect, useRef, useState } from "react";

import { classifyMicrophoneError, logger } from "@ally-ui-mono/ui-shared";
import type { MicrophoneError } from "@ally-ui-mono/ui-shared";

/**
 * Talking to Ally (plan §5.3, §7.9, §11 F-1…F-9). The guide's voice worker
 * joins a LiveKit room the backend opens for the thread; captions arrive on
 * `lk.transcription`, and what is committed (messages, cards) still arrives
 * on the thread's SSE stream with `channel: "voice"`, so the conversation has
 * one source of truth.
 *
 * - Barge-in is the worker's job: talking over Ally just works.
 * - Microphone refused: the classified guidance, then text.
 * - The room drops: one reconnect attempt, then text with an explanation.
 * - A roleplay or case launching suspends voice; "Resume voice" shows on
 *   return and voice never rejoins on its own.
 * - Two false triggers (speech that produced no words) suggest push-to-talk.
 * - In a crisis voice stays open: the worker speaks the fixed message.
 */

export type VoicePhase = "off" | "connecting" | "live" | "reconnecting" | "failed";
export type VoiceTurnMode = "hands_free" | "push_to_talk";
export type VoiceFailure = "microphone" | "network" | "disabled";
export type AgentVoiceState = "listening" | "thinking" | "speaking" | "idle";

export interface VoiceSession {
  token: string;
  roomName: string;
  serverUrl: string;
}

/** The slice of livekit-client's Room this hook uses (a mock in tests). */
export interface RoomLike {
  on: (event: string, listener: (...args: any[]) => void) => unknown;
  off: (event: string, listener: (...args: any[]) => void) => unknown;
  connect: (url: string, token: string) => Promise<void>;
  disconnect: () => Promise<void> | void;
  localParticipant: {
    identity: string;
    setMicrophoneEnabled: (enabled: boolean) => Promise<unknown>;
  };
  remoteParticipants?: Map<string, { identity: string; attributes?: Record<string, string> }>;
  registerTextStreamHandler?: (
    topic: string,
    handler: (reader: any, participant: { identity?: string }) => void,
  ) => void;
  unregisterTextStreamHandler?: (topic: string) => void;
}

/** livekit-client's RoomEvent values, inlined so the journey's first load doesn't pull the SDK. */
export const ROOM_EVENTS = {
  Disconnected: "disconnected",
  Reconnecting: "reconnecting",
  Reconnected: "reconnected",
  ActiveSpeakersChanged: "activeSpeakersChanged",
  ParticipantAttributesChanged: "participantAttributesChanged",
  ParticipantConnected: "participantConnected",
} as const;

export const TRANSCRIPTION_TOPIC = "lk.transcription";
const AGENT_STATE_ATTRIBUTE = "lk.agent.state";
const FINAL_ATTRIBUTE = "lk.transcription_final";
/** Speech with no words within this long counts as a false trigger. */
export const FALSE_TRIGGER_WINDOW_MS = 3_000;
export const FALSE_TRIGGERS_BEFORE_SUGGESTING = 2;
const RESUME_KEY = "allyGuideVoiceResume";

export interface GuideVoiceState {
  phase: VoicePhase;
  turnMode: VoiceTurnMode;
  agentState: AgentVoiceState | null;
  learnerSpeaking: boolean;
  allyCaption: string;
  learnerCaption: string;
  failure: VoiceFailure | null;
  microphoneError: MicrophoneError | null;
  suggestPushToTalk: boolean;
  /** Voice was suspended for a roleplay or case; offer to resume, never rejoin alone. */
  canResume: boolean;
  /** Push-to-talk: the button is held. */
  pushing: boolean;
}

export interface UseGuideVoiceOptions {
  threadId: string | null;
  /** `availability.voice` and signed in. */
  enabled: boolean;
  language?: string | null;
  requestSession: (body: { turnMode: VoiceTurnMode; language?: string }) => Promise<VoiceSession>;
  createRoom?: () => Promise<RoomLike>;
  onFallback?: (failure: VoiceFailure) => void;
}

const defaultCreateRoom = async (): Promise<RoomLike> => {
  const [{ Room }, { LIVEKIT_CONFIG }] = await Promise.all([
    import("livekit-client"),
    import("@constants/simulation"),
  ]);
  return new Room(LIVEKIT_CONFIG) as unknown as RoomLike;
};

const VOICE_LANGUAGES = ["en", "hi", "mr", "ta", "kn"];

const readResume = (threadId: string | null): boolean => {
  try {
    return Boolean(threadId) && sessionStorage.getItem(RESUME_KEY) === threadId;
  } catch {
    return false;
  }
};

const initialState = (threadId: string | null): GuideVoiceState => ({
  phase: "off",
  turnMode: "hands_free",
  agentState: null,
  learnerSpeaking: false,
  allyCaption: "",
  learnerCaption: "",
  failure: null,
  microphoneError: null,
  suggestPushToTalk: false,
  canResume: readResume(threadId),
  pushing: false,
});

export const useGuideVoice = ({
  threadId,
  enabled,
  language,
  requestSession,
  createRoom = defaultCreateRoom,
  onFallback,
}: UseGuideVoiceOptions) => {
  const [state, setState] = useState<GuideVoiceState>(() => initialState(threadId));
  const patch = useCallback(
    (next: Partial<GuideVoiceState>) => setState(prev => ({ ...prev, ...next })),
    [],
  );

  const room = useRef<RoomLike | null>(null);
  const detach = useRef<(() => void) | null>(null);
  const leaving = useRef(false);
  const reconnected = useRef(false);
  const falseTriggers = useRef(0);
  const pendingWords = useRef<ReturnType<typeof setTimeout> | null>(null);
  const turnMode = useRef<VoiceTurnMode>("hands_free");
  const deps = useRef({ requestSession, createRoom, onFallback, language });
  deps.current = { requestSession, createRoom, onFallback, language };

  useEffect(() => {
    setState(prev => ({ ...prev, canResume: readResume(threadId) }));
  }, [threadId]);

  const teardown = useCallback(async () => {
    leaving.current = true;
    detach.current?.();
    detach.current = null;
    if (pendingWords.current) clearTimeout(pendingWords.current);
    const current = room.current;
    room.current = null;
    try {
      await current?.disconnect();
    } catch {
      // Already gone.
    }
  }, []);

  const fail = useCallback(
    async (failure: VoiceFailure, microphoneError: MicrophoneError | null = null) => {
      await teardown();
      setState(prev => ({
        ...prev,
        phase: "failed",
        failure,
        microphoneError,
        agentState: null,
        learnerSpeaking: false,
        pushing: false,
      }));
      deps.current.onFallback?.(failure);
    },
    [teardown],
  );

  /** A learner burst ended: if no words follow, it was a false trigger. */
  const watchForWords = useCallback(() => {
    if (pendingWords.current) clearTimeout(pendingWords.current);
    pendingWords.current = setTimeout(() => {
      pendingWords.current = null;
      falseTriggers.current += 1;
      if (
        falseTriggers.current >= FALSE_TRIGGERS_BEFORE_SUGGESTING &&
        turnMode.current === "hands_free"
      ) {
        setState(prev => ({ ...prev, suggestPushToTalk: true }));
      }
    }, FALSE_TRIGGER_WINDOW_MS);
  }, []);

  const heardWords = useCallback(() => {
    if (pendingWords.current) clearTimeout(pendingWords.current);
    pendingWords.current = null;
  }, []);

  const attach = useCallback(
    (r: RoomLike) => {
      const local = () => r.localParticipant?.identity;

      const onDisconnected = () => {
        if (leaving.current || room.current !== r) return;
        if (reconnected.current) {
          void fail("network");
          return;
        }
        reconnected.current = true;
        patch({ phase: "reconnecting" });

        void connect(true);
      };
      const onAttributes = (
        _changed: Record<string, string>,
        participant: { identity?: string; attributes?: Record<string, string> },
      ) => {
        if (!participant || participant.identity === local()) return;
        const value = participant.attributes?.[AGENT_STATE_ATTRIBUTE] as
          | AgentVoiceState
          | undefined;
        if (value) patch({ agentState: value });
      };
      let wasSpeaking = false;
      const onSpeakers = (speakers: Array<{ identity?: string }>) => {
        const speaking = speakers.some(s => s.identity === local());
        if (speaking !== wasSpeaking) {
          wasSpeaking = speaking;
          patch({ learnerSpeaking: speaking });
          if (!speaking) watchForWords();
        }
      };
      const onTranscription = (reader: any, participant: { identity?: string }) => {
        const learner = participant?.identity === local();
        const final = reader?.info?.attributes?.[FINAL_ATTRIBUTE] === "true";
        let text = "";
        void (async () => {
          try {
            for await (const chunk of reader) {
              text += chunk;
              patch(learner ? { learnerCaption: text } : { allyCaption: text });
            }
          } catch (error) {
            logger.warn(`Guide caption stream ended early: ${error}`);
          }
          if (learner && text.trim()) {
            heardWords();
            if (final) falseTriggers.current = 0;
          }
        })();
      };

      r.on(ROOM_EVENTS.Disconnected, onDisconnected);
      r.on(ROOM_EVENTS.ParticipantAttributesChanged, onAttributes);
      r.on(ROOM_EVENTS.ActiveSpeakersChanged, onSpeakers);
      try {
        r.registerTextStreamHandler?.(TRANSCRIPTION_TOPIC, onTranscription);
      } catch (error) {
        logger.warn(`Could not listen for guide captions: ${error}`);
      }
      r.remoteParticipants?.forEach(p => onAttributes({}, p));

      return () => {
        r.off(ROOM_EVENTS.Disconnected, onDisconnected);
        r.off(ROOM_EVENTS.ParticipantAttributesChanged, onAttributes);
        r.off(ROOM_EVENTS.ActiveSpeakersChanged, onSpeakers);
        try {
          r.unregisterTextStreamHandler?.(TRANSCRIPTION_TOPIC);
        } catch {
          // Gone with the room.
        }
      };
    },
    // `connect` is defined below and stable; fail/patch/watch are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fail, patch, watchForWords, heardWords],
  );

  const connect = useCallback(
    async (isReconnect = false) => {
      if (!threadId) return;
      const lang = deps.current.language?.slice(0, 2);
      let session: VoiceSession;
      try {
        session = await deps.current.requestSession({
          turnMode: turnMode.current,
          ...(lang && VOICE_LANGUAGES.includes(lang) ? { language: lang } : {}),
        });
      } catch (error) {
        const code = (error as { data?: { errorCode?: string } })?.data?.errorCode;
        await fail(code === "GUIDE_DISABLED" ? "disabled" : "network");
        return;
      }

      const previous = room.current;
      detach.current?.();
      detach.current = null;
      if (previous) {
        leaving.current = true;
        try {
          await previous.disconnect();
        } catch {
          // Already gone.
        }
      }

      let next: RoomLike;
      try {
        next = await deps.current.createRoom();
        room.current = next;
        leaving.current = false;
        detach.current = attach(next);
        await next.connect(session.serverUrl, session.token);
      } catch (error) {
        logger.warn(`Guide voice could not connect${isReconnect ? " again" : ""}: ${error}`);
        await fail("network");
        return;
      }

      try {
        await next.localParticipant.setMicrophoneEnabled(turnMode.current === "hands_free");
      } catch (error) {
        await fail("microphone", classifyMicrophoneError(error));
        return;
      }
      patch({ phase: "live", failure: null, microphoneError: null });
    },
    [threadId, attach, fail, patch],
  );

  const start = useCallback(async () => {
    if (!enabled || !threadId) return;
    reconnected.current = false;
    falseTriggers.current = 0;
    try {
      sessionStorage.removeItem(RESUME_KEY);
    } catch {
      // Private mode.
    }
    setState(prev => ({
      ...prev,
      phase: "connecting",
      failure: null,
      microphoneError: null,
      canResume: false,
      suggestPushToTalk: false,
      allyCaption: "",
      learnerCaption: "",
    }));
    await connect();
  }, [enabled, threadId, connect]);

  const stop = useCallback(async () => {
    await teardown();
    setState(prev => ({
      ...initialState(null),
      turnMode: prev.turnMode,
      canResume: false,
    }));
  }, [teardown]);

  /** A roleplay or case is opening: let go of the room and offer "Resume voice" later. */
  const suspend = useCallback(async () => {
    if (!room.current) return;
    try {
      if (threadId) sessionStorage.setItem(RESUME_KEY, threadId);
    } catch {
      // Private mode: resume is offered only within this page.
    }
    await teardown();
    setState(prev => ({ ...initialState(null), turnMode: prev.turnMode, canResume: true }));
  }, [teardown, threadId]);

  const dismissResume = useCallback(() => {
    try {
      sessionStorage.removeItem(RESUME_KEY);
    } catch {
      // Private mode.
    }
    patch({ canResume: false });
  }, [patch]);

  const setTurnMode = useCallback(
    async (mode: VoiceTurnMode) => {
      turnMode.current = mode;
      patch({ turnMode: mode, suggestPushToTalk: false, pushing: false });
      falseTriggers.current = 0;
      try {
        await room.current?.localParticipant.setMicrophoneEnabled(mode === "hands_free");
      } catch (error) {
        await fail("microphone", classifyMicrophoneError(error));
      }
    },
    [patch, fail],
  );

  /** Push-to-talk: the microphone is open only while the button is held. */
  const pressToTalk = useCallback(
    async (down: boolean) => {
      if (turnMode.current !== "push_to_talk" || !room.current) return;
      patch({ pushing: down });
      try {
        await room.current.localParticipant.setMicrophoneEnabled(down);
      } catch (error) {
        await fail("microphone", classifyMicrophoneError(error));
      }
    },
    [patch, fail],
  );

  const dismissSuggestion = useCallback(() => {
    falseTriggers.current = 0;
    patch({ suggestPushToTalk: false });
  }, [patch]);

  const clearFailure = useCallback(
    () => patch({ phase: "off", failure: null, microphoneError: null }),
    [patch],
  );

  useEffect(() => () => void teardown(), [teardown]);

  return {
    state,
    active:
      state.phase === "connecting" || state.phase === "live" || state.phase === "reconnecting",
    start,
    stop,
    suspend,
    dismissResume,
    setTurnMode,
    pressToTalk,
    dismissSuggestion,
    clearFailure,
  };
};

export type GuideVoice = ReturnType<typeof useGuideVoice>;
