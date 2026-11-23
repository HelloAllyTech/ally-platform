import { Injectable, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { LoggerService } from 'src/logger/logger.service';

/** Emitted when a crisis keyword matched on a blocked or unlisted turn (R1). */
export const BLOCKED_CRISIS_EVENT = 'chatbot.blocked_crisis';

export interface BlockedCrisisEvent {
  chatbotId: string;
  /** The conversation id when the channel has one, else the sender's channel id. */
  conversationRef: string | null;
  /** Which blocked state the turn was in. */
  state: string;
  at: Date;
}

/**
 * R1: on a blocked or unlisted turn the free keyword crisis check still runs, and a match flags the
 * conversation and alerts the builder.
 *
 * The flag itself (D14 fields: `safety_first_at`, `safety_level`, `retain_until`, the alert outbox)
 * is set by the channel: the engine returns a `handledBy: crisis` decision with the keyword's
 * template id, and `HandoverService.afterDecision` → `CrisisAlertService.flag` flags it exactly as
 * on an unblocked turn. `markBlockedCrisis` is the engine's explicit record that the match happened
 * on a BLOCKED turn: it emits `BLOCKED_CRISIS_EVENT` (for a listener that wants the blocked state,
 * e.g. a count shown to the builder) and logs it without PII.
 */
@Injectable()
export class BlockedCrisisService {
  private readonly logger = LoggerService.getInstance(
    BlockedCrisisService.name,
  );

  constructor(@Optional() private readonly events?: EventEmitter2) {}

  async markBlockedCrisis(
    chatbotId: string,
    conversationRef: string | null | undefined,
    state = 'OUT_OF_CREDITS',
  ): Promise<void> {
    const event: BlockedCrisisEvent = {
      chatbotId,
      conversationRef: conversationRef ?? null,
      state,
      at: new Date(),
    };
    this.logger.warn(
      `Crisis keyword on a blocked turn (${state}) for chatbot ${chatbotId}: flagged for the builder`,
    );
    try {
      this.events?.emit(BLOCKED_CRISIS_EVENT, event);
    } catch (error) {
      this.logger.warn(
        `Blocked-crisis listener failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }
}
