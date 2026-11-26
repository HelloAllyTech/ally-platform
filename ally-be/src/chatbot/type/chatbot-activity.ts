/**
 * TF1 round 2: a change to an assistant made outside its home's fields (going live, pausing,
 * taking someone off the access list, confirming the helpline numbers). Emitted in-process; the
 * assistant home records it in the History (`AssistantHomeService.onActivity`), where it is
 * listed but never undone.
 */
export const CHATBOT_ACTIVITY = 'chatbot.activity';

export interface ChatbotActivityEvent {
  chatbotId: string;
  /** What changed, as the History names it: `status`, `audience` or `helpline`. */
  field: 'status' | 'audience' | 'helpline';
  before?: unknown;
  after?: unknown;
  /** Who did it, when known. */
  userId?: number | null;
}
