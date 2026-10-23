import { GuideAtmosphere } from '../contract/generated/guide-contract';
import { GuideMode } from '../enum/guide.enum';

/** How the interface looks in each mode (plans/ally-guide/plan.md §5.9). */
export function atmosphereFor(mode: GuideMode): GuideAtmosphere {
  switch (mode) {
    case GuideMode.CRISIS:
      return 'still';
    case GuideMode.CARE:
    case GuideMode.CRISIS_FOLLOWUP:
      return 'hushed';
    default:
      return 'bright';
  }
}

/** SSE heartbeat; under any load balancer's idle timeout (plan §7.10). */
export const GUIDE_SSE_PING_INTERVAL_MS = 15_000;

/** Open turns older than this at boot were cut off by a restart (plan §7.10). */
export const GUIDE_STALE_TURN_MS = 2 * 60_000;
