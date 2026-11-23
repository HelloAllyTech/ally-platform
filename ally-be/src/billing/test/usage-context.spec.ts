import { ENDPOINTS } from 'src/ai/constants/endpoints.constants';
import {
  ENDPOINT_USAGE_KIND,
  usageContext,
  usageHeaders,
} from '../context/usage-context';
import { ownerUsageContextFor } from '../context/owner-usage.interceptor';
import { UsageChannel, UsageKind } from '../enum/billing.enum';

/**
 * The metering map's ally-be half (CR1 Part A): every ally-ai endpoint an assistant's work calls
 * that makes a model call sends `X-Ally-Usage`. A new metered endpoint missing from
 * ENDPOINT_USAGE_KIND fails here.
 */
const METERED = [
  ENDPOINTS.AGENT_RUN,
  ENDPOINTS.AGENT_RUN_STREAM,
  ENDPOINTS.KNOWLEDGE_AGENT_ANSWER,
  ENDPOINTS.KNOWLEDGE_AGENT_CRISIS_CHECK,
  ENDPOINTS.AGENT_MEMORY_CHECK,
  ENDPOINTS.AGENT_CONVERSATION_SUMMARY,
  ENDPOINTS.AGENT_INSTRUCTIONS,
  ENDPOINTS.AGENT_INSTRUCTIONS_CHECK,
  ENDPOINTS.AGENT_INSTRUCTIONS_JUDGE,
  ENDPOINTS.BUILDER_STEP_STREAM,
  ENDPOINTS.BUILDER_EXTRACT,
  ENDPOINTS.BUILDER_CHANGE,
  ENDPOINTS.CHECKUP_QUESTIONS,
  ENDPOINTS.CHECKUP_GRADE,
  ENDPOINTS.KNOWLEDGE_CHUNK_BULK_UPSERT,
];

const ctx = {
  runId: 'run-1',
  chatbotId: 'b0000000-0000-4000-8000-000000000001',
  conversationId: 'c-1',
  channel: UsageChannel.BOT_PAGE,
  runKind: UsageKind.CUSTOMER_REPLY,
};

const header = (endpoint: string) =>
  JSON.parse(usageHeaders(endpoint)['X-Ally-Usage'] ?? 'null');

describe('usage headers', () => {
  it('maps every metered endpoint', () => {
    for (const endpoint of METERED) {
      expect(ENDPOINT_USAGE_KIND[endpoint]).toBeDefined();
    }
  });

  it('sends nothing outside a usage context (today’s behaviour)', () => {
    expect(usageHeaders(ENDPOINTS.AGENT_RUN)).toEqual({});
  });

  it('names the run, assistant, chat and kind, the run itself taking the context’s kind', () => {
    usageContext.run(ctx, () => {
      expect(header(ENDPOINTS.AGENT_RUN_STREAM)).toMatchObject({
        run_id: 'run-1',
        kind: 'customer_reply',
        channel: 'bot_page',
        chatbot_id: ctx.chatbotId,
        conversation_id: 'c-1',
      });
      expect(header(ENDPOINTS.KNOWLEDGE_AGENT_CRISIS_CHECK).kind).toBe(
        'crisis_check',
      );
      expect(header(ENDPOINTS.AGENT_MEMORY_CHECK).kind).toBe('memory_check');
    });
  });

  it('keeps the query string out of the match (a corpus on bulk-upsert)', () => {
    usageContext.run(ctx, () => {
      expect(
        header(`${ENDPOINTS.KNOWLEDGE_CHUNK_BULK_UPSERT}?corpus=x`).kind,
      ).toBe('indexing');
    });
  });

  it('gives a request with no run its own run id', () => {
    usageContext.run({ ...ctx, runId: undefined }, () => {
      const a = header(ENDPOINTS.BUILDER_CHANGE).run_id;
      const b = header(ENDPOINTS.BUILDER_CHANGE).run_id;
      expect(a).toBeTruthy();
      expect(a).not.toBe(b);
    });
  });

  it('sends nothing for an endpoint that makes no assistant model call', () => {
    usageContext.run(ctx, () => {
      expect(usageHeaders(ENDPOINTS.KNOWLEDGE_CHUNK_IDS)).toEqual({});
    });
  });

  it('keeps the context across awaits', async () => {
    await usageContext.run(ctx, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      expect(header(ENDPOINTS.AGENT_RUN).run_id).toBe('run-1');
    });
  });
});

describe('owner routes', () => {
  it('attributes work under an assistant or a draft', () => {
    expect(
      ownerUsageContextFor(
        '/v1/chatbots/AAAAAAAA-0000-4000-8000-000000000001/test/stream',
      ),
    ).toMatchObject({
      channel: 'owner',
      chatbotId: 'aaaaaaaa-0000-4000-8000-000000000001',
    });
    expect(
      ownerUsageContextFor(
        '/v1/bot-drafts/aaaaaaaa-0000-4000-8000-000000000002/step',
      ),
    ).toMatchObject({
      draftId: 'aaaaaaaa-0000-4000-8000-000000000002',
    });
  });
  it('leaves everything else alone, the public bot page included', () => {
    expect(
      ownerUsageContextFor('/v1/public/bots/sunrise/messages/stream'),
    ).toBeNull();
    expect(ownerUsageContextFor('/v1/chatbots')).toBeNull();
  });
});
