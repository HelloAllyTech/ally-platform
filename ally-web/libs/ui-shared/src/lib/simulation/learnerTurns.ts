import { useEffect, useRef, useState } from "react";

import { RoomEvent } from "livekit-client";

export type TurnSpeaker = "learner" | "client";

/**
 * A learner turn is one thing the learner says: consecutive learner messages
 * count as one. Mirrors the server's rule so the live counter and the
 * submission decision agree. Display only; the server decides.
 */
export const countLearnerTurns = (messages: ReadonlyArray<{ role: TurnSpeaker }>): number => {
  let turns = 0;
  let previous: TurnSpeaker | null = null;
  for (const { role } of messages) {
    if (role === "learner" && previous !== "learner") turns += 1;
    previous = role;
  }
  return turns;
};

/** The localised-template strings for the counter; `{{turn}}` / `{{required}}` are substituted. */
export interface TurnCounterTranslations {
  progress: string;
  reached: string;
}

export const DEFAULT_TURN_COUNTER_TRANSLATIONS: TurnCounterTranslations = {
  progress: "Turn {{turn}} of {{required}}",
  reached: "Minimum turns reached",
};

export const formatTurnCounter = (
  turns: number,
  required: number,
  translations: TurnCounterTranslations = DEFAULT_TURN_COUNTER_TRANSLATIONS,
): string => {
  if (turns >= required) return translations.reached;
  // Show the turn the learner is on, never "Turn 0".
  return translations.progress
    .replace("{{turn}}", String(Math.max(1, turns + 1)))
    .replace("{{required}}", String(required));
};

/**
 * Live learner-turn count for a voice session, from LiveKit's transcription
 * events (final segments only, each counted once). Inert unless `enabled`, so
 * the page can call it unconditionally. Text chats count from the chat
 * messages instead (see countLearnerTurns).
 */
export const useVoiceLearnerTurns = (room: any, enabled: boolean): number => {
  const [turns, setTurns] = useState(0);
  const lastSpeakerRef = useRef<TurnSpeaker | null>(null);
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled || typeof room?.on !== "function") return undefined;

    const onTranscription = (segments: any[], participant: any) => {
      const localIdentity = room.localParticipant?.identity;
      const role: TurnSpeaker =
        participant && localIdentity && participant.identity === localIdentity
          ? "learner"
          : "client";
      for (const segment of segments ?? []) {
        if (!segment?.final || !segment.text?.trim()) continue;
        if (segment.id) {
          if (seenRef.current.has(segment.id)) continue;
          seenRef.current.add(segment.id);
        }
        if (role === "learner" && lastSpeakerRef.current !== "learner") {
          setTurns(prev => prev + 1);
        }
        lastSpeakerRef.current = role;
      }
    };

    room.on(RoomEvent.TranscriptionReceived, onTranscription);
    return () => {
      room.off?.(RoomEvent.TranscriptionReceived, onTranscription);
    };
  }, [room, enabled]);

  return turns;
};
