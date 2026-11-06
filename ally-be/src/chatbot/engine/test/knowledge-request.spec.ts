import type { KnowledgeAnswerRequest } from '../../../ai/dto/knowledge.dto';
import {
  buildAgentRunRequest,
  MAX_DECLINE_TEXT_CHARS,
} from '../knowledge-request';

const REQUEST: KnowledgeAnswerRequest = {
  question: 'How do I sign in?',
  audience: { unrestricted: true },
  document_ids: ['doc-1'],
};

const RUN = { conversationId: 'conv-1', runId: 'run-1', chatbotId: 'bot-1' };

describe('buildAgentRunRequest', () => {
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
