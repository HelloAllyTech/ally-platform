import type {
  ActiveTrackContext,
  StartTrackItemResponse,
  TrackDetailItem,
  TrackItemCompletionResult,
} from "@types";

/**
 * What every item adapter receives. An adapter only translates between the
 * guided journey and an existing classic player; it adds no behaviour of its
 * own (plan §10.4 adapter rules):
 * - completion goes through the player's own mutation first, then the host
 *   posts one `completed_claim` card event that the server verifies;
 * - `onCompleted` is stable for the life of the card, because some players
 *   (the game) report completion from an effect keyed on it;
 * - only one adapter is mounted at a time.
 */
export interface ItemAdapterProps<P extends StartTrackItemResponse = StartTrackItemResponse> {
  payload: P;
  itemId: string;
  trackId: string;
  /** The classic course detail's item, when loaded (roleplay and case need it). */
  item: TrackDetailItem | null;
  alreadyCompleted: boolean;
  onCompleted: (result: TrackItemCompletionResult) => void;
  /** Collapse the card back into the conversation. */
  onClose: () => void;
  /** Before a roleplay or case leaves for the full-screen simulation. */
  onBeforeLaunch: () => void;
  /** Stashed with the return-to-track context so the learner comes back to Ally. */
  returnContext: Partial<ActiveTrackContext>;
  /** Video only: the playhead, for "Ask about this moment" (plan §5.8). */
  onPosition?: (seconds: number) => void;
}
