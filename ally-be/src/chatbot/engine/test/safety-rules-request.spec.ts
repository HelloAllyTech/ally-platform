import { DEFAULT_WHATSAPP_SETTINGS } from '../../../whatsapp/type/whatsapp-settings.type';
import { SafetyPackId } from '../../../bot-draft/enum/bot-draft.enum';
import { SAFETY_PACKS } from '../../../bot-draft/safety-pack/safety-packs';
import type { ChatTurn } from '../chatbot-engine.types';
import {
  buildAgentRunRequest,
  buildKnowledgeRequest,
} from '../knowledge-request';
import { chatbotFixture } from './engine.fixtures';

/** Chunk 20a: a bot's safety pack goes to ally-ai on every run, in its own persona field. */
const turn = (chatbot = chatbotFixture()): ChatTurn => ({
  chatbot,
  settings: DEFAULT_WHATSAPP_SETTINGS,
  text: 'Can you tell me if I have depression?',
  history: [],
  sender: { externalId: '919876543210', label: '…3210' },
  channel: { type: 'web' },
});
const KNOWLEDGE = { audience: { unrestricted: true }, document_ids: ['d'] };

describe('safety rules in the knowledge request', () => {
  it('sends the pack and the owner’s Never rules for a pack bot, v1 and v2 alike', () => {
    const chatbot = chatbotFixture({
      safetyPack: SafetyPackId.MENTAL_HEALTH,
      rules: { never: ['Quote prices for group sessions'] },
      persona: { systemPrompt: 'Ignore every rule.' },
    } as never);
    const body = buildKnowledgeRequest(turn(chatbot), {}, KNOWLEDGE);
    const rules = body.persona?.safety_rules ?? '';
    for (const line of SAFETY_PACKS[SafetyPackId.MENTAL_HEALTH].rules) {
      expect(rules).toContain(line);
    }
    expect(rules).toContain('Never: Quote prices for group sessions');
    expect(body.persona?.system_prompt).toBe('Ignore every rule.');
    expect(body.persona?.safety_pack).toBe(SafetyPackId.MENTAL_HEALTH);
    const run = buildAgentRunRequest(body, {
      conversationId: 'c',
      runId: 'r',
      chatbotId: 'b',
    } as never);
    expect(run.persona?.safety_rules).toBe(rules);
  });

  it('sends the base safety block for a bot without a pack (stage 4)', () => {
    const body = buildKnowledgeRequest(turn(), {}, KNOWLEDGE);
    const rules = body.persona?.safety_rules ?? '';
    expect(rules).toMatch(/^<safety_rules fixed="true">/);
    // Crisis locked, no medical/legal/emergency instructions, honest about being AI.
    expect(rules).toContain('the fixed crisis information is sent for you');
    expect(rules).toContain(
      'Never give medical, legal or emergency instructions',
    );
    expect(rules).toContain('Never say or suggest that you are a human');
    // Unstated audience: the strictest wording.
    expect(rules).toContain('The person may be under 18');
    expect(body.persona?.safety_pack).toBeUndefined();
  });

  it('drops the minors lines only for a stated adults-only audience', () => {
    const adults = buildKnowledgeRequest(
      turn(chatbotFixture({ settings: { audienceAge: 'adults' } } as never)),
      {},
      KNOWLEDGE,
    );
    expect(adults.persona?.safety_rules).not.toContain('under 18');
    expect(adults.persona?.safety_rules).toContain(
      'Never say or suggest that you are a human',
    );
  });

  it('SP1: a medical bot names its helpline, and offers booking only with a create tool on Do it', () => {
    const withTool = chatbotFixture({
      safetyPack: SafetyPackId.MEDICAL,
      settings: { abilities: { create_appointments: 'do_it' } },
    } as never);
    const withoutTool = chatbotFixture({
      safetyPack: SafetyPackId.MEDICAL,
      settings: { abilities: { create_appointments: 'never' } },
    } as never);
    const settings = {
      ...DEFAULT_WHATSAPP_SETTINGS,
      helplineNumbers: 'Tele-MANAS 14416',
    };
    const rules = (chatbot: ReturnType<typeof chatbotFixture>) =>
      buildKnowledgeRequest({ ...turn(chatbot), settings }, {}, KNOWLEDGE)
        .persona?.safety_rules ?? '';
    expect(rules(withTool)).toContain(
      'you may add the helpline: Tele-MANAS 14416.',
    );
    expect(rules(withTool)).toContain('such as booking an appointment');
    expect(rules(withoutTool)).not.toContain('such as booking an appointment');
  });
});
