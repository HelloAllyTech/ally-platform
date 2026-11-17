import { Injectable } from '@nestjs/common';

export type PmAgentLiveEvent =
  | { type: 'card.updated'; cardId: string }
  | { type: 'state.updated' };

/**
 * The PM Agent's change feed. Services announce; the gateway (namespace `/pm-agent`)
 * listens and pushes. Kept apart so services never import the socket server, and a
 * missing listener (tests, a worker-only task) costs nothing. Fire-and-forget: the UI
 * also polls GET /state every 30 s, so a dropped push only delays a refresh.
 */
@Injectable()
export class PmAgentEventsService {
  private listener: ((event: PmAgentLiveEvent) => void) | null = null;

  setListener(listener: ((event: PmAgentLiveEvent) => void) | null): void {
    this.listener = listener;
  }

  cardUpdated(cardId: string): void {
    this.emit({ type: 'card.updated', cardId });
    this.emit({ type: 'state.updated' });
  }

  stateUpdated(): void {
    this.emit({ type: 'state.updated' });
  }

  private emit(event: PmAgentLiveEvent): void {
    try {
      this.listener?.(event);
    } catch {
      // A failed push must never fail the write that caused it.
    }
  }
}
