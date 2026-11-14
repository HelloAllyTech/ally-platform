import { SafetyPackId } from '../enum/bot-draft.enum';
import type { BotDraft } from '../type/bot-draft.type';
import { packFor } from './safety-packs';

/** Why a change was refused: it would remove or weaken a pack rule. */
export class SafetyLockedError extends Error {
  readonly code = 'safety_locked';
  constructor(readonly reason: string) {
    super(
      "That would turn off a safety rule, so I can't make that change. I can add a rule of your own instead.",
    );
  }
}

/**
 * Refuse a draft change that weakens its safety pack. Adding is always fine: a stronger pack, more
 * of the owner's own rules, a longer disclaimer. Removing a pack's disclaimer, switching to a weaker
 * pack, or dropping the pack is not. (The pack's own rules aren't in the draft at all: the engine
 * adds them on every run, so nothing a draft says can remove them.)
 */
export function assertDraftKeepsPack(before: BotDraft, after: BotDraft): void {
  const was = packFor(before.safetyPackId);
  const now = packFor(after.safetyPackId);
  if (was && (!now || now.strength < was.strength)) {
    throw new SafetyLockedError('weaker_pack');
  }
  const pack = now ?? was;
  if (
    pack?.disclaimer &&
    !after.branding.disclaimer?.includes(pack.disclaimer)
  ) {
    throw new SafetyLockedError('disclaimer_removed');
  }
}

/** Settings a bot with a pack may never turn off. */
export function assertSettingsKeepPack(
  packId: SafetyPackId | string | null | undefined,
  next: { crisisClassifierEnabled?: boolean } | null | undefined,
): void {
  const pack = packFor(packId);
  if (!pack) return;
  if (
    pack.requiredSettings.crisisClassifierEnabled &&
    next?.crisisClassifierEnabled === false
  ) {
    throw new SafetyLockedError('crisis_classifier_off');
  }
}
