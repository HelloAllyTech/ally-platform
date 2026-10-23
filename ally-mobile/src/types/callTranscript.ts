/**
 * Represents a formatted message in a call transcript
 */
export interface CallTranscriptMessage {
  id: number;
  message: string;
  time: string;
  counselor: boolean;
  client: boolean;
}
