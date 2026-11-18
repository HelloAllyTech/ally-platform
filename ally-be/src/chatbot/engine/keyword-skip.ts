import { WaTemplateKind } from '../../whatsapp/enum/whatsapp.enum';
import { ChatbotReplyService } from '../service/chatbot-reply.service';
import type { ChatTurn } from './chatbot-engine.types';

/** A keyword reply, as far as these rules need it. */
type KeywordReply = { kind: WaTemplateKind; patterns: string[] };

/** Words that make a command reply the "say hello" reply (the shared Greeting). */
const GREETING_WORDS = new Set([
  'hi',
  'hello',
  'hey',
  'hii',
  'namaste',
  'hola',
  'good morning',
]);

/** The shared reply to a bare hello: a command reply triggered by greeting words. */
export const isGreetingReply = (template: KeywordReply): boolean =>
  template.kind === WaTemplateKind.COMMAND &&
  (template.patterns ?? []).some((p) =>
    GREETING_WORDS.has(ChatbotReplyService.normalise(p)),
  );

/**
 * Whether an agent bot answers this keyword match itself instead of sending the template.
 *
 * Only the command and FAQ replies (greeting, help, "what can you do", FAQ answers) give way.
 * Crisis and consent replies never do. Two command replies stay:
 * - a bare `help`, which keeps the fixed Help text and its safety wording;
 * - the bot's own welcome message, on a person's first message only.
 */
export const agentAnswersInstead = (
  template: KeywordReply,
  turn: Pick<ChatTurn, 'text' | 'chatbot' | 'isFirstMessage'>,
): boolean => {
  if (
    template.kind !== WaTemplateKind.COMMAND &&
    template.kind !== WaTemplateKind.FAQ
  ) {
    return false;
  }
  if (ChatbotReplyService.normalise(turn.text) === 'help') return false;
  const welcome = turn.chatbot.persona?.greeting?.trim();
  if (welcome && turn.isFirstMessage && isGreetingReply(template)) return false;
  return true;
};
