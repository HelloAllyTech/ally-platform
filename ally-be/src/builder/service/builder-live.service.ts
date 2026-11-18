import { Injectable } from '@nestjs/common';

/** What changed, for the Builder tab to refetch. Payload-free on purpose. */
export type BuilderLiveEvent = 'decisionsChanged' | 'sessionsChanged';

type BuilderLiveListener = (events: BuilderLiveEvent[]) => void;

/** Coalesce a burst (a run posting twenty events) into one push. */
const DEBOUNCE_MS = 500;

/**
 * "Something changed" for the Builder tab, pushed over the `/builder` socket.
 *
 * Deliberately carries no data: the client refetches the Now snapshot, so a
 * dropped or duplicated push costs one request and can never leave the page
 * showing a decision that the server no longer has. The 10 s poll stays as the
 * fallback, which also covers clients on another instance (this pushes only to
 * sockets connected to the instance that saw the change).
 *
 * A listener rather than a gateway dependency, like BuilderEventService, so
 * services that report changes need no socket server in their tests.
 */
@Injectable()
export class BuilderLiveService {
  private listener: BuilderLiveListener | null = null;
  private pending = new Set<BuilderLiveEvent>();
  private timer: NodeJS.Timeout | null = null;

  setListener(listener: BuilderLiveListener | null): void {
    this.listener = listener;
  }

  changed(...events: BuilderLiveEvent[]): void {
    for (const event of events) this.pending.add(event);
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), DEBOUNCE_MS);
    this.timer.unref?.();
  }

  private flush(): void {
    this.timer = null;
    const events = [...this.pending];
    this.pending.clear();
    if (!this.listener || !events.length) return;
    try {
      this.listener(events);
    } catch {
      // A broken socket must never fail the change that reported it.
    }
  }
}
