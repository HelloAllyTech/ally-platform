import type { ChatbotDecision } from '../engine/chatbot-engine.types';
import { WaHandledBy } from '../../whatsapp/enum/whatsapp.enum';

/** 1 at risk, 2 medical emergency (the `safety_level` column). */
export type CrisisLevel = 1 | 2;
export type CrisisPath = 'keyword' | 'classifier' | 'handover';

export interface CrisisFlag {
  level: CrisisLevel;
  path: CrisisPath;
}

/** How long a flagged chat is kept: first flag + 12 months (D14). */
export const CRISIS_RETENTION_MONTHS = 12;

/** A flagged chat nobody has taken for this long is raised to Ally staff. */
export const UNTAKEN_LIMIT_MINUTES = 30;

/** The holding message waits this long, so it lands after the crisis reply itself. */
export const HOLDING_DELAY_MS = 3_000;

/**
 * What a decision says about a crisis, or null. Stage 4: the engine sets `decision.crisis` on every
 * crisis decision, so nothing is inferred from a template id or an alert's wording. A crisis
 * decision that somehow carries no `crisis` (an older caller) still flags, as at risk by the
 * classifier: a flag is never dropped for want of a level.
 */
export function crisisOf(
  decision: Pick<ChatbotDecision, 'handledBy'> & {
    crisis?: Partial<CrisisFlag>;
  },
): CrisisFlag | null {
  if (decision.handledBy !== WaHandledBy.CRISIS) return null;
  return {
    level: decision.crisis?.level === 2 ? 2 : 1,
    path: decision.crisis?.path ?? 'classifier',
  };
}
