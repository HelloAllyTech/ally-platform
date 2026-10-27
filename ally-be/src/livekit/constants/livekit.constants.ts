export const DEFAULT_ROOM_TTL = 3600;
export const MAX_PARTICIPANTS = 5;

/**
 * Ally guide voice rooms are named `guide-…` and served by their own agent
 * worker, never the roleplay one. The webhook handlers use this to leave them
 * alone: no roleplay agent dispatch, no scenario-session end handling.
 */
export const GUIDE_ROOM_PREFIX = 'guide-';

export const isGuideRoom = (roomName?: string | null): boolean =>
  !!roomName?.startsWith(GUIDE_ROOM_PREFIX);

/** Emitted (EventEmitter2) when a guide room finishes; payload `{ roomName }`. */
export const GUIDE_VOICE_ROOM_FINISHED_EVENT = 'guide.voice.room.finished';

export interface GuideVoiceRoomFinishedEventParams {
  roomName: string;
}
