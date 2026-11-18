import { WaHandledBy } from '../../whatsapp/enum/whatsapp.enum';

/**
 * The reply to a person's FIRST message.
 *
 * A greeting ("hi", "hello") is answered with the chatbot's welcome message and then the notice they
 * must see (not medical advice, not a crisis service, how to opt out). A real question is answered
 * straight away, with nothing in front of the answer — someone who asks something wants the answer,
 * not an introduction.
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
  if (input.handledBy === WaHandledBy.CRISIS || !input.bodyIsWelcome) {
    return input.body;
  }
  return [input.body, input.notice]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join('\n\n');
}
