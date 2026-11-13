import * as jwt from 'jsonwebtoken';
import { AiUpstreamError } from '../../../ai/exception/ai-upstream.exception';
import { ErrorCode } from '../../../exception/error-code.enum';
import { WaHandledBy } from '../../../whatsapp/enum/whatsapp.enum';
import { DEFAULT_WHATSAPP_SETTINGS } from '../../../whatsapp/type/whatsapp-settings.type';
import { ToolRunStatus } from '../../entity/tool-run.entity';
import { AgentRuntimeUsed } from '../../enum/chatbot.enum';
import type { ChatTurn } from '../chatbot-engine.types';
import {
  ANSWER,
  chatbotFixture,
  engineAiService,
  makeEngine,
} from './engine.fixtures';

const CONVERSATION = '6f9c1a52-1111-4a8e-9a0c-1b2c3d4e5f60';
const HANDOVER_TEXT =
  "I've asked the team to join. They usually reply within a few hours.";
const CRISIS_TEXT = 'Crisis line: 14416';

/** `/agent/run`'s answer, as the agent returns it. */
const AGENT_ANSWER = {
  ...ANSWER,
  run_id: 'run-1',
  runtime: 'v2',
  trace: [{ node: 'agent', ms: 900, summary: 'agent: question, answer' }],
  turn_type: 'question',
};

/** The agent passed the chat on: an empty decline with `handover: true`. */
const HANDED_OVER = {
  ...AGENT_ANSWER,
  intent: 'decline',
  answer: '',
  citations: [],
  decline_reason: 'none',
  handover: true,
  trace: [
    { node: 'agent', ms: 900, summary: 'agent: question, calls hand_over' },
    { node: 'tool', ms: 120, summary: 'hand_over: ok' },
  ],
};

/**
 * The tool gateway in the engine (chunk 3b): who gets a gateway block, what a hand-over replies,
 * and that v1 never answers a message whose run has already done something.
 */
describe('ChatbotEngineService: the tool gateway', () => {
  const setup = ({
    agentAnswer = AGENT_ANSWER as unknown,
    abilities,
    acted = [] as string[],
    crisis = false,
  }: {
    agentAnswer?: unknown;
    abilities?: Record<string, 'do_it' | 'never'>;
    acted?: string[];
    crisis?: boolean;
  } = {}) => {
    const aiService = engineAiService(ANSWER, agentAnswer);
    aiService.checkWhatsAppCrisis.mockResolvedValue({
      is_crisis: crisis,
      confidence: crisis ? 0.95 : 0,
      signal: crisis ? 'self_harm' : '',
    });
    const toolRuns = {
      find: jest
        .fn()
        .mockResolvedValue(
          acted.map((tool) => ({ tool, status: ToolRunStatus.OK })),
        ),
    };
    const engine = makeEngine({
      aiService,
      promptShared: { getPromptsByOptions: jest.fn().mockResolvedValue([]) },
      toolRuns,
      tools: [{ name: 'hand_over' }],
    });
    const turn = (over: Partial<ChatTurn> = {}): ChatTurn => ({
      chatbot: chatbotFixture({ settings: abilities ? { abilities } : {} }),
      settings: {
        ...DEFAULT_WHATSAPP_SETTINGS,
        agentRuntimeAllowed: true,
        crisisClassifierEnabled: true,
        crisisEscalationText: CRISIS_TEXT,
        fallbackText: 'Sorry, something went wrong.',
      },
      text: 'can someone from your team call me back about my bill?',
      language: 'en',
      history: [],
      sender: { externalId: 'v1', label: 'visitor' },
      channel: { type: 'web' },
      conversationId: CONVERSATION,
      providerMessageId: 'msg-1',
      contactId: 'contact-1',
      ...over,
    });
    return { engine, aiService, toolRuns, turn };
  };

  const sentRequest = (aiService: { runAgent: jest.Mock }) =>
    aiService.runAgent.mock.calls[0][0];

  describe('the request', () => {
    it("is exactly today's, with no token, for a bot with no tool on", async () => {
      const off = setup();
      await off.engine.respond(off.turn());
      const never = setup({ abilities: { hand_over: 'never' } });
      await never.engine.respond(never.turn());
      expect(sentRequest(off.aiService)).not.toHaveProperty('gateway');
      expect(sentRequest(never.aiService)).toEqual(sentRequest(off.aiService));
    });

    it('carries the gateway, with a token for this run, for a bot with hand_over on', async () => {
      const h = setup({ abilities: { hand_over: 'do_it' } });
      await h.engine.respond(h.turn());
      const { gateway } = sentRequest(h.aiService);
      expect(gateway).toMatchObject({
        url: 'http://api.test/api/v1/internal/agent',
        tools: ['hand_over'],
      });
      const claims = jwt.decode(gateway.token) as Record<string, unknown>;
      expect(claims).toMatchObject({
        kind: 'chatbot_run',
        chatbotId: 'bot-1',
        conversationId: CONVERSATION,
        runId: sentRequest(h.aiService).run_id,
        contactId: 'contact-1',
        tools: ['hand_over'],
      });
    });

    it("signs Preview's run with no contact", async () => {
      const h = setup({ abilities: { hand_over: 'do_it' } });
      await h.engine.respond(
        h.turn({
          conversationId: 'preview-1',
          providerMessageId: undefined,
          contactId: undefined,
        }),
      );
      const claims = jwt.decode(
        sentRequest(h.aiService).gateway.token,
      ) as Record<string, unknown>;
      expect(claims).toMatchObject({
        conversationId: 'preview-1',
        contactId: null,
      });
    });

    it('reads abilities only from the bot: a platform-wide value turns nothing on', async () => {
      const h = setup();
      const turn = h.turn();
      // As if someone wrote `abilities` straight into the stored platform settings.
      (turn.settings as unknown as Record<string, unknown>).abilities = {
        hand_over: 'do_it',
      };
      await h.engine.respond(turn);
      expect(sentRequest(h.aiService)).not.toHaveProperty('gateway');
    });

    it('never sends a gateway with "How it works"', async () => {
      const h = setup({ abilities: { hand_over: 'do_it' } });
      const request = await h.engine.agentRequestFor(h.turn());
      expect(request).not.toHaveProperty('gateway');
    });
  });

  describe('the reply', () => {
    it("gets 11a's hand-over message when the agent handed over", async () => {
      const h = setup({
        abilities: { hand_over: 'do_it' },
        agentAnswer: HANDED_OVER,
      });
      const decision = await h.engine.respond(h.turn());
      expect(decision).toMatchObject({
        handledBy: WaHandledBy.HANDOVER,
        body: HANDOVER_TEXT,
        handover: 'assistant',
        agent: { runtime: AgentRuntimeUsed.V2, runId: 'run-1' },
      });
      expect(decision.unanswered).toBeUndefined();
      expect(h.aiService.answerKnowledgeQuestionWithin).not.toHaveBeenCalled();
    });

    it('a crisis still wins over a hand-over', async () => {
      const h = setup({
        abilities: { hand_over: 'do_it' },
        agentAnswer: HANDED_OVER,
        crisis: true,
      });
      const decision = await h.engine.respond(h.turn());
      expect(decision.handledBy).toBe(WaHandledBy.CRISIS);
      expect(decision.body).toBe(CRISIS_TEXT);
      expect(decision.handover).toBeUndefined();
    });

    it('a run that fails after hand_over acted gets the hand-over message, not v1', async () => {
      const h = setup({
        abilities: { hand_over: 'do_it' },
        acted: ['hand_over'],
      });
      h.aiService.runAgent.mockRejectedValue(
        new AiUpstreamError('late', ErrorCode.AI_SERVICE_TIMEOUT),
      );
      const decision = await h.engine.respond(h.turn());
      expect(decision).toMatchObject({
        handledBy: WaHandledBy.HANDOVER,
        body: HANDOVER_TEXT,
        handover: 'assistant',
        agent: {
          runtime: AgentRuntimeUsed.V2_FALLBACK,
          fallbackReason: 'timeout',
        },
      });
      expect(h.toolRuns.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            runId: sentRequest(h.aiService).run_id,
            status: ToolRunStatus.OK,
          },
        }),
      );
      expect(h.aiService.answerKnowledgeQuestionWithin).not.toHaveBeenCalled();
    });

    it('a run that fails after another tool acted gets the fallback wording, not v1', async () => {
      const h = setup({
        abilities: { hand_over: 'do_it' },
        acted: ['some_list_tool'],
      });
      h.aiService.runAgent.mockRejectedValue(
        new AiUpstreamError('bad', ErrorCode.AI_SERVICE_UNAVAILABLE, 502),
      );
      const decision = await h.engine.respond(h.turn());
      expect(decision).toMatchObject({
        handledBy: WaHandledBy.ERROR,
        body: 'Sorry, something went wrong.',
      });
      expect(decision.handover).toBeUndefined();
      expect(h.aiService.answerKnowledgeQuestionWithin).not.toHaveBeenCalled();
    });

    it('a run that fails before any tool acted falls back to v1 as today', async () => {
      const h = setup({ abilities: { hand_over: 'do_it' } });
      h.aiService.runAgent.mockRejectedValue(
        new AiUpstreamError('late', ErrorCode.AI_SERVICE_TIMEOUT),
      );
      const decision = await h.engine.respond(h.turn());
      expect(decision.handledBy).toBe(WaHandledBy.RAG);
      expect(h.aiService.answerKnowledgeQuestionWithin).toHaveBeenCalled();
    });

    it('a bot with no tool on never reads tool_runs when its run fails', async () => {
      const h = setup();
      h.aiService.runAgent.mockRejectedValue(
        new AiUpstreamError('late', ErrorCode.AI_SERVICE_TIMEOUT),
      );
      await h.engine.respond(h.turn());
      expect(h.toolRuns.find).not.toHaveBeenCalled();
      expect(h.aiService.answerKnowledgeQuestionWithin).toHaveBeenCalled();
    });
  });
});
