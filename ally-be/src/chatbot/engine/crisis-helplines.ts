import type { WhatsAppBotSettings } from '../../whatsapp/type/whatsapp-settings.type';

type HelplineSettings = Pick<
  WhatsAppBotSettings,
  'helplineNumbers' | 'helplineSource' | 'helplineConfirmedAt'
>;

/**
 * The assistant's own numbers a crisis reply may carry (Q4 G7, Round 7 S2: "You can also call:
 * 9920805299", a number not on the organisation's pages): only the owner's, confirmed in Safety.
 * A number a template or setup wrote waits for that confirmation; until then crisis replies carry
 * the pack's national numbers only. Values saved before Q4 have no source and count as the owner's.
 */
export function crisisHelplines(
  settings: Partial<HelplineSettings> | null | undefined,
): string {
  const numbers = settings?.helplineNumbers?.trim() ?? '';
  if (!settings || !numbers) return '';
  if (!settings.helplineSource) return numbers;
  if (settings.helplineSource === 'owner') return numbers;
  return settings.helplineConfirmedAt ? numbers : '';
}

/** Whether the helpline waits for the owner's confirmation before crisis replies use it. */
export function helplineNeedsConfirming(settings: HelplineSettings): boolean {
  return (
    Boolean(settings.helplineNumbers?.trim()) && !crisisHelplines(settings)
  );
}

/**
 * What the owner's save does to the helpline's source (Q4 G7): a number the owner changed, or
 * confirmed, is theirs; otherwise the stored source and confirmation stay as they were. A client
 * can never set the source or the confirmation itself.
 */
export function ownerHelplineFields(
  previous: Partial<HelplineSettings> | null | undefined,
  next: { helplineNumbers?: string | null; helplineConfirm?: boolean },
  now: Date,
): Pick<HelplineSettings, 'helplineSource' | 'helplineConfirmedAt'> {
  const before = previous?.helplineNumbers?.trim() ?? '';
  const after =
    next.helplineNumbers === undefined
      ? before
      : (next.helplineNumbers ?? '').trim();
  if (after && (after !== before || next.helplineConfirm)) {
    return { helplineSource: 'owner', helplineConfirmedAt: now.toISOString() };
  }
  if (!after) return { helplineSource: null, helplineConfirmedAt: null };
  return {
    helplineSource: previous?.helplineSource ?? null,
    helplineConfirmedAt: previous?.helplineConfirmedAt ?? null,
  };
}
