import { INDIA_GENERAL_CRISIS_TEXT } from '../../../bot-draft/safety-pack/safety-packs';
import { WaHandledBy } from '../../../whatsapp/enum/whatsapp.enum';
import { DEFAULT_WHATSAPP_SETTINGS } from '../../../whatsapp/type/whatsapp-settings.type';
import type { ChatTurn } from '../chatbot-engine.types';
import {
  isChildSafeguarding,
  safeguardingLine,
  withSafeguardingLine,
} from '../safeguarding';
import {
  ANSWER,
  chatbotFixture,
  engineAiService,
  makeEngine,
} from './engine.fixtures';

/**
 * TF1 S7: "A child just told me her uncle hurts her at home. What do I do?" got the self-harm
 * crisis reply, not the handbook's safeguarding procedure.
 */
describe('isChildSafeguarding', () => {
  it.each([
    'A child just told me her uncle hurts her at home. What do I do?',
    "Who do I call if I'm worried about a child's safety?",
    'One of the girls in my class says her father beats her',
    'ek bachchi ne bataya ki uske chacha use maarte hain',
    'एक बच्ची ने बताया कि उसके चाचा उसे मारते हैं',
    'I think a student is being abused at home',
  ])('a worry about a child: %s', (text) => {
    expect(isChildSafeguarding(text)).toBe(true);
  });

  it.each([
    'How many children attend the Saturday class?',
    'Can I bring my kid to the volunteer orientation?',
    'I want to hurt myself',
    'What are the working hours?',
    "My child's tooth hurts, can I book a check-up?",
  ])('not one: %s', (text) => {
    expect(isChildSafeguarding(text)).toBe(false);
  });

  it('ends a reply with 112 and Childline, once', () => {
    const line = safeguardingLine('en', true);
    expect(line).toContain('112');
    expect(line).toContain('1098');
    expect(
      withSafeguardingLine('Tell the Safeguarding Lead today.', 'en', true),
    ).toBe(`Tell the Safeguarding Lead today.\n\n${line}`);
    expect(
      withSafeguardingLine(`Call 112 or Childline 1098.`, 'en', true),
    ).toBe('Call 112 or Childline 1098.');
  });
});

describe('ChatbotEngineService: a child-safeguarding message', () => {
  const PROCEDURE = {
    ...ANSWER,
    answer:
      'Report it the same day to our Designated Safeguarding Lead, Ms. Farah Naqvi, on +91 522 400 9911. Don’t promise to keep it secret.',
  };
  const turn = (text: string): ChatTurn => ({
    chatbot: chatbotFixture(),
    settings: { ...DEFAULT_WHATSAPP_SETTINGS, crisisClassifierEnabled: true },
    text,
    language: 'en',
    history: [{ role: 'user', content: text }],
    sender: { externalId: 'v1', label: 'visitor', tenantId: 'tenant-a' },
    channel: { type: 'web' },
    conversationId: 'conv-1',
  });
  const setup = (verdict: Record<string, unknown>) => {
    const aiService = engineAiService(PROCEDURE, PROCEDURE);
    aiService.checkWhatsAppCrisis.mockResolvedValue({
      is_crisis: true,
      level: 'at_risk',
      confidence: 0.9,
      signal: 'hurts her',
      ...verdict,
    });
    const engine = makeEngine({
      aiService,
      promptShared: { getPromptsByOptions: jest.fn().mockResolvedValue([]) },
    });
    return { engine, aiService };
  };

  it("answers with the organisation's own procedure, ending with 112 and Childline", async () => {
    // The check's own self-harm flag also fires on harm to someone else (seen live in TF1).
    const { engine } = setup({ self_harm: true });
    const decision = await engine.respond(
      turn('A child just told me her uncle hurts her at home. What do I do?'),
    );
    expect(decision.handledBy).not.toBe(WaHandledBy.CRISIS);
    expect(decision.body).toContain('Farah Naqvi');
    expect(decision.body).toContain('1098');
    expect(decision.body).not.toBe(INDIA_GENERAL_CRISIS_TEXT);
    expect(decision.alert).toBeDefined();
  });

  it('a person at risk themselves still gets the fixed crisis reply', async () => {
    const { engine } = setup({ self_harm: true });
    const decision = await engine.respond(
      turn('My uncle hurts me at home and I want to kill myself, I am a kid'),
    );
    expect(decision.handledBy).toBe(WaHandledBy.CRISIS);
  });
});
