import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';

/** What the Owners are told when the breaker opens. */
export interface BreakerTrippedNotice {
  pausedAt: Date;
  reason: string;
  /** The failed or unhealthy releases that tripped it, newest first. */
  releases: {
    service: string;
    tag: string | null;
    runUrl: string | null;
    detail: string;
  }[];
}

/**
 * P0 SEAM — how the auto-release policy reaches the Owners.
 *
 * Plan §4.7: when the circuit breaker opens, Owners are notified with
 * **Resume**. That goes through P0's `RoadmapNotificationService` (the
 * `roadmap_notifications` stream), which is not merged yet, so the policy
 * depends on this port and the default implementation only logs.
 *
 * TODO(P0): bind `ReleasePolicyOwnerNotifier` to an adapter over P0's
 * `RoadmapNotificationService` (recipients: every Owner; kind: breaker
 * tripped; payload: the notice) in `ProductRoadmapModule`. Nothing else
 * changes.
 *
 * In P5 nothing can trip the real breaker (shadow mode makes no releases of
 * its own), so this is unreachable in production until the policy goes live.
 */
export abstract class ReleasePolicyOwnerNotifier {
  abstract breakerTripped(notice: BreakerTrippedNotice): Promise<void>;
}

@Injectable()
export class LoggingReleasePolicyOwnerNotifier extends ReleasePolicyOwnerNotifier {
  private readonly logger = LoggerService.getInstance(
    'ReleasePolicyOwnerNotifier',
  );

  async breakerTripped(notice: BreakerTrippedNotice): Promise<void> {
    this.logger.warn(
      `[RELEASE-POLICY] Auto-release paused at ${notice.pausedAt.toISOString()}: ${notice.reason}. ` +
        'An Owner must resume it (POST /v1/roadmap/release/resume). ' +
        '(Owner notifications arrive with Roadmap v2 P0; logged only until then.)',
    );
  }
}
