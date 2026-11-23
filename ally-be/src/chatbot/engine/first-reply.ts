import { WaHandledBy } from '../../whatsapp/enum/whatsapp.enum';

/**
 * The reply to a person's FIRST message.
 *
 * Stage 4: every first reply carries the start notice (`chatbot/safety/chat-notice.ts`: an AI and
 * people at the organisation may read this chat), on every channel. A greeting is answered with the
 * welcome message and then the notice; a real question gets its answer first, then the notice, so
 * nothing stands in front of the answer.
 *
 * A crisis reply always goes out alone.
 *
 * Shared by every channel and by Preview, so Preview shows exactly what a new person receives.
 */
export function withFirstMessageParts(input: {
  body: string;
  handledBy: WaHandledBy;
  notice?: string | null;
  /** The body is the chatbot's welcome message — the person said hello. */
  bodyIsWelcome?: boolean;
}): string {
  if (input.handledBy === WaHandledBy.CRISIS) return input.body;
  const notice = input.notice?.trim();
  if (notice && input.body.includes(notice)) return input.body;
  return [input.body, notice]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join('\n\n');
}
