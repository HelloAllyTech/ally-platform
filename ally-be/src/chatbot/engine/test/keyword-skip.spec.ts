import { WaTemplateKind } from '../../../whatsapp/enum/whatsapp.enum';
import type { Chatbot } from '../../entity/chatbot.entity';
import { agentAnswersInstead, isGreetingReply } from '../keyword-skip';

const reply = (kind: WaTemplateKind, patterns: string[] = ['x']) => ({
  kind,
  patterns,
});
const GREETING = reply(WaTemplateKind.COMMAND, ['Hello', 'hi']);
const HELP = reply(WaTemplateKind.COMMAND, ['help', 'menu']);

const turn = (text: string, { welcome = '', isFirstMessage = false } = {}) => ({
  text,
  isFirstMessage,
  chatbot: { persona: { greeting: welcome } } as unknown as Chatbot,
});

describe('isGreetingReply', () => {
  it.each([
    ['a command triggered by greeting words', GREETING, true],
    ['a command triggered by other words', HELP, false],
    [
      'an FAQ reply that happens to match "hi"',
      reply(WaTemplateKind.FAQ, ['hi']),
      false,
    ],
  ])('%s → %s', (_, template, expected) => {
    expect(isGreetingReply(template)).toBe(expected);
  });
});

describe('agentAnswersInstead', () => {
  it.each([
    ['an FAQ reply', reply(WaTemplateKind.FAQ), 'what is ally?', {}, true],
    ['a command reply', HELP, 'menu', {}, true],
    ['the shared greeting', GREETING, 'hello', {}, true],
    ['a crisis reply', reply(WaTemplateKind.CRISIS), 'kill myself', {}, false],
    ['a consent reply', reply(WaTemplateKind.CONSENT), 'stop', {}, false],
    ['a bare "help"', HELP, ' Help ', {}, false],
    [
      'the welcome message on a first message',
      GREETING,
      'hello',
      { welcome: 'Welcome!', isFirstMessage: true },
      false,
    ],
    [
      'the welcome message later in a conversation',
      GREETING,
      'hello',
      { welcome: 'Welcome!', isFirstMessage: false },
      true,
    ],
  ])('%s → %s', (_, template, text, options, expected) => {
    expect(agentAnswersInstead(template, turn(text, options))).toBe(expected);
  });
});
