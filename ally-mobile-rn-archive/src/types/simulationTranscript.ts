/**
 * Represents a formatted message in a simulation transcript
 */
export interface SimulationTranscriptMessage {
  id: number;
  time: string;
  message: string;
  isLearner: boolean;
  startSeconds: number;
}

/**
 * A request to bring one transcript message into view — raised by the "See
 * this moment" chips in Ally's debrief note. `messageId` is the anchor's raw
 * `scenarioSessionMessageId` (a string in the note, numeric in the transcript
 * payload, so compare as strings). `requestId` increments per request so
 * tapping the same chip twice scrolls to the moment twice. Mirrors ally-web's
 * TranscriptFocusRequest.
 */
export interface TranscriptFocusRequest {
  messageId: string;
  requestId: number;
}
