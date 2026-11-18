import type { KnowledgeAnswerRequest } from '../../../ai/dto/knowledge.dto';
import { DEFAULT_WHATSAPP_SETTINGS } from '../../../whatsapp/type/whatsapp-settings.type';
import type { Chatbot } from '../../entity/chatbot.entity';
import type { ChatTurn } from '../chatbot-engine.types';
import {
  buildAgentRunRequest,
  buildKnowledgeRequest,
  MAX_DECLINE_TEXT_CHARS,
  MAX_HISTORY_MESSAGES,
} from '../knowledge-request';
import { purposePromptCodes } from '../chatbot-engine.service';
import { chatbotFixture } from './engine.fixtures';

const turn = (over: Partial<ChatTurn> = {}): ChatTurn => ({
  chatbot: chatbotFixture(),
  settings: DEFAULT_WHATSAPP_SETTINGS,
  text: 'How do I sign in?',
  history: [],
  sender: { externalId: '919876543210', label: '…3210' },
  channel: { type: 'whatsapp' },
  ...over,
});

const KNOWLEDGE = {
  audience: { unrestricted: true },
  document_ids: ['doc-1'],
};

describe('buildKnowledgeRequest', () => {
  it('sends only the last MAX_HISTORY_MESSAGES of a long conversation (v1 too)', () => {
    const history = Array.from({ length: 15 }, (_, i) => ({
      role: i % 2 ? 'assistant' : 'user',
      content: `message ${i}`,
    }));
    const body = buildKnowledgeRequest(turn({ history }), {}, KNOWLEDGE);
    expect(MAX_HISTORY_MESSAGES).toBe(10);
    expect(body.history).toEqual(history.slice(-10));
  });

  it('sends the persona trimmed, without its blank parts', () => {
    const chatbot = chatbotFixture({
      persona: { displayName: ' Ally ', systemPrompt: '   ', tone: 'warm' },
    } as Partial<Chatbot>);
    const body = buildKnowledgeRequest(turn({ chatbot }), {}, KNOWLEDGE);
    expect(body.persona).toEqual({
      display_name: 'Ally',
      system_prompt: undefined,
      tone: 'warm',
    });
  });

  it('sends the purpose, and the note only as written (chunk 20a-2)', () => {
    const chatbot = chatbotFixture({
      purpose: 'custom',
      purposeNote: ' Help parents choose a class ',
    } as Partial<Chatbot>);
    const body = buildKnowledgeRequest(turn({ chatbot }), {}, KNOWLEDGE);
    expect(body.persona).toMatchObject({
      purpose: 'custom',
      purpose_note: 'Help parents choose a class',
    });
  });

  it('sends no purpose for a bot made before purposes', () => {
    const body = buildKnowledgeRequest(turn(), {}, KNOWLEDGE);
    expect(body.persona?.purpose).toBeUndefined();
  });

  it('loads a purpose section only for a bot that has one', () => {
    expect(purposePromptCodes('enquiries')).toEqual([
      'ally_ai_agent_purpose_enquiries',
    ]);
    expect(purposePromptCodes('custom')).toEqual([]);
    expect(purposePromptCodes(null)).toEqual([]);
    expect(purposePromptCodes('anything')).toEqual([]);
  });

  it('sends no persona at all when every part is blank', () => {
    const chatbot = chatbotFixture({
      persona: { displayName: ' ' },
    } as Partial<Chatbot>);
    const body = buildKnowledgeRequest(turn({ chatbot }), {}, KNOWLEDGE);
    expect(body.persona).toBeUndefined();
  });
});

const REQUEST: KnowledgeAnswerRequest = {
  question: 'How do I sign in?',
  audience: { unrestricted: true },
  document_ids: ['doc-1'],
};

const RUN = { conversationId: 'conv-1', runId: 'run-1', chatbotId: 'bot-1' };

describe('buildAgentRunRequest', () => {
  it('leaves the agent fields out, rather than null, when they are not given', () => {
    const body = buildAgentRunRequest(REQUEST, RUN);
    expect(body).toEqual({
      ...REQUEST,
      conversation_id: 'conv-1',
      run_id: 'run-1',
      chatbot_id: 'bot-1',
      runtime_version: 'v2',
    });
    for (const field of [
      'log_retrieval',
      'features',
      'knowledge_topics',
      'decline_text',
    ]) {
      expect(body).not.toHaveProperty(field);
    }
  });

  it('sends a decline wording within the limit as it is', () => {
    const body = buildAgentRunRequest(REQUEST, {
      ...RUN,
      declineText: 'Ask your supervisor.',
    });
    expect(body.decline_text).toBe('Ask your supervisor.');
  });

  it("cuts a decline wording longer than ally-ai accepts, so the run isn't refused", () => {
    const body = buildAgentRunRequest(REQUEST, {
      ...RUN,
      declineText: 'x'.repeat(MAX_DECLINE_TEXT_CHARS + 120),
    });
    expect(body.decline_text).toHaveLength(MAX_DECLINE_TEXT_CHARS);
    expect(MAX_DECLINE_TEXT_CHARS).toBe(500);
  });
});
