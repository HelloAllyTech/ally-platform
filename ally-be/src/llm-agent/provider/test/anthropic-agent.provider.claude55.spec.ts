import { AnthropicAgentProvider } from '../anthropic-agent.provider';
import {
  AgentStreamEvent,
  AgentStreamRequest,
  AgentTurnResult,
} from '../../type/agent-llm.type';

/** A fake `messages.stream` that records the body and replays given events. */
const fakeClient = (
  captured: any[],
  events: any[] = [],
  finalMessage: any = {
    content: [{ type: 'text', text: 'ok' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 3, output_tokens: 1 },
  },
) =>
  ({
    messages: {
      stream: (params: any) => {
        captured.push(params);
        return {
          async *[Symbol.asyncIterator]() {
            yield* events;
          },
          finalMessage: async () => finalMessage,
        };
      },
    },
  }) as any;

const run = async (
  over: Partial<AgentStreamRequest>,
  client: { events?: any[]; final?: any } = {},
): Promise<{ sent: any; result: AgentTurnResult }> => {
  const captured: any[] = [];
  const provider = new AnthropicAgentProvider(
    'key',
    fakeClient(captured, client.events, client.final),
  );
  let result: AgentTurnResult | undefined;
  for await (const event of provider.stream({
    model: 'claude-opus-5-5',
    system: 'be kind',
    messages: [{ role: 'user', content: 'hello' }],
    maxTokens: 64,
    ...over,
  }) as AsyncIterable<AgentStreamEvent>) {
    if (event.type === 'final') result = event.message;
  }
  return { sent: captured[0], result: result! };
};

describe('AnthropicAgentProvider — Claude 5.5 request surface', () => {
  it('sends effort and a structured-output schema under output_config', async () => {
    const schema = {
      type: 'object',
      properties: { mode: { type: 'string' } },
      required: ['mode'],
      additionalProperties: false,
    };
    const { sent } = await run({ effort: 'low', outputSchema: schema });
    expect(sent.output_config).toEqual({
      effort: 'low',
      format: { type: 'json_schema', schema },
    });
  });

  it('sends no output_config when neither is set', async () => {
    const { sent } = await run({});
    expect(sent).not.toHaveProperty('output_config');
  });

  it('keeps strict on tools and adds eager streaming only on request', async () => {
    const tool = {
      name: 'present_course_item',
      description: 'Show the next item',
      input_schema: { type: 'object', additionalProperties: false },
      strict: true,
    };
    const plain = await run({ tools: [tool] });
    expect(plain.sent.tools).toEqual([tool]);
    const eager = await run({ tools: [tool], eagerToolInput: true });
    expect(eager.sent.tools).toEqual([
      { ...tool, eager_input_streaming: true },
    ]);
  });

  it('sets a one-hour cache TTL when a system span asks for it', async () => {
    const { sent } = await run({
      system: [
        { text: 'persona', cache: '1h' },
        { text: 'course', cache: true },
        { text: 'volatile' },
      ],
    });
    expect(sent.system).toEqual([
      {
        type: 'text',
        text: 'persona',
        cache_control: { type: 'ephemeral', ttl: '1h' },
      },
      { type: 'text', text: 'course', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'volatile' },
    ]);
  });

  it('replays thinking blocks and mid-conversation system messages verbatim', async () => {
    const messages: AgentStreamRequest['messages'] = [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '', signature: 'sig-abc' },
          { type: 'redacted_thinking', data: 'opaque' },
          { type: 'text', text: 'Hello.' },
        ],
      },
      { role: 'user', content: 'next' },
      { role: 'system', content: '<situation_report>…</situation_report>' },
    ];
    const { sent } = await run({ messages });
    expect(sent.messages).toEqual(messages);
  });

  it('returns thinking blocks in the final content untouched', async () => {
    const content = [
      { type: 'thinking', thinking: '', signature: 'sig-1' },
      { type: 'text', text: 'Answer.' },
    ];
    const { result } = await run(
      {},
      {
        final: {
          content,
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      },
    );
    expect(result.content).toEqual(content);
  });

  it('maps a refusal and its category', async () => {
    const { result } = await run(
      {},
      {
        final: {
          content: [],
          stop_reason: 'refusal',
          stop_details: { category: 'bio', explanation: 'declined' },
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      },
    );
    expect(result.stopReason).toBe('refusal');
    expect(result.stopDetails).toEqual({
      category: 'bio',
      explanation: 'declined',
    });
  });

  it('reports a tool call as soon as it starts', async () => {
    const started: Array<{ id: string; name: string }> = [];
    await run(
      { onToolUseStart: (call) => started.push(call) },
      {
        events: [
          {
            type: 'content_block_start',
            content_block: {
              type: 'tool_use',
              id: 'tu_1',
              name: 'consult_tutor',
            },
          },
          {
            type: 'content_block_start',
            content_block: { type: 'text', text: '' },
          },
        ],
      },
    );
    expect(started).toEqual([{ id: 'tu_1', name: 'consult_tutor' }]);
  });

  it('caches the conversation with top-level cache_control on request', async () => {
    const { sent } = await run({ cacheConversation: true });
    expect(sent.cache_control).toEqual({ type: 'ephemeral' });
    const plain = await run({});
    expect(plain.sent).not.toHaveProperty('cache_control');
  });

  it('sends tool_choice none on a closing pass, keeping the tools', async () => {
    const tool = {
      name: 'get_progress',
      description: 'Read progress',
      input_schema: { type: 'object', additionalProperties: false },
      strict: true,
    };
    const { sent } = await run({ tools: [tool], toolChoice: 'none' });
    expect(sent.tool_choice).toEqual({ type: 'none' });
    expect(sent.tools).toEqual([tool]);
  });

  describe('deferred tool loading', () => {
    const tool = (name: string, deferLoading?: boolean) => ({
      name,
      description: `The ${name} tool`,
      input_schema: { type: 'object', additionalProperties: false },
      strict: true,
      ...(deferLoading !== undefined ? { deferLoading } : {}),
    });

    it('marks deferred tools and appends the search tool', async () => {
      const { sent } = await run({
        tools: [tool('get_progress'), tool('get_peer_signals', true)],
      });
      expect(sent.tools).toEqual([
        {
          name: 'get_progress',
          description: 'The get_progress tool',
          input_schema: { type: 'object', additionalProperties: false },
          strict: true,
        },
        {
          name: 'get_peer_signals',
          description: 'The get_peer_signals tool',
          input_schema: { type: 'object', additionalProperties: false },
          strict: true,
          defer_loading: true,
        },
        {
          type: 'tool_search_tool_bm25_20251119',
          name: 'tool_search_tool_bm25',
        },
      ]);
      expect(JSON.stringify(sent.tools)).not.toContain('deferLoading');
    });

    it('sends no search tool when nothing is deferred', async () => {
      const { sent } = await run({ tools: [tool('a'), tool('b', false)] });
      expect(sent.tools.map((t: any) => t.name)).toEqual(['a', 'b']);
      expect(JSON.stringify(sent.tools)).not.toContain('defer');
    });

    it('never defers every tool (the API rejects that)', async () => {
      const { sent } = await run({ tools: [tool('a', true), tool('b', true)] });
      expect(sent.tools.map((t: any) => t.name)).toEqual(['a', 'b']);
      expect(JSON.stringify(sent.tools)).not.toContain('defer');
    });

    it('returns the server tool traffic for replay, untouched', async () => {
      const content = [
        {
          type: 'server_tool_use',
          id: 'srv_1',
          name: 'tool_search_tool_bm25',
          input: { query: 'peer' },
        },
        {
          type: 'tool_search_tool_result',
          tool_use_id: 'srv_1',
          content: {
            type: 'tool_search_tool_search_result',
            tool_references: [
              { type: 'tool_reference', tool_name: 'get_peer_signals' },
            ],
          },
        },
        { type: 'text', text: 'ok' },
      ];
      const { result } = await run(
        { tools: [tool('a'), tool('get_peer_signals', true)] },
        {
          final: {
            content,
            stop_reason: 'end_turn',
            usage: { input_tokens: 1, output_tokens: 1 },
          },
        },
      );
      expect(result.content).toEqual(content);
    });
  });
});
