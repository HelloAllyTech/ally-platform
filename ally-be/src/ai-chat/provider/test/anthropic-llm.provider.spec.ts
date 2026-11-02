import { AnthropicLlmProvider } from '../anthropic-llm.provider';

const create = jest.fn();
// Referenced lazily inside the factory below, so hoisting is safe.
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ messages: { create } })),
}));

describe('AnthropicLlmProvider', () => {
  const provider = new AnthropicLlmProvider({
    anthropic: { apiKey: 'k' },
  } as any);

  beforeEach(() => create.mockReset());

  it('sends the system prompt apart from the turns, and no temperature to a model that refuses one', async () => {
    create.mockResolvedValue({
      content: [{ type: 'text', text: 'Hello' }],
      usage: { input_tokens: 10, output_tokens: 2 },
    });
    const onUsage = jest.fn();
    const text = await provider.getCompletion(
      [
        { role: 'system', content: 'Be kind.' },
        { role: 'user', content: 'Hi' },
      ],
      { model: 'claude-sonnet-5-5', maxTokens: 300, temperature: 0.2 },
      onUsage,
    );
    expect(text).toBe('Hello');
    const req = create.mock.calls[0][0];
    expect(req.system).toBe('Be kind.');
    expect(req.messages).toEqual([{ role: 'user', content: 'Hi' }]);
    expect(req.max_tokens).toBe(300);
    expect(req).not.toHaveProperty('temperature');
    expect(onUsage).toHaveBeenCalledWith({
      promptTokens: 10,
      completionTokens: 2,
      cachedTokens: undefined,
    });
  });

  it('streams text deltas and reports usage at the end', async () => {
    create.mockResolvedValue(
      (async function* () {
        yield {
          type: 'message_start',
          message: { usage: { input_tokens: 5 } },
        };
        yield {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Hel' },
        };
        yield {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'lo' },
        };
        yield {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { output_tokens: 3 },
        };
      })(),
    );
    const chunks: any[] = [];
    for await (const c of provider.streamCompletion(
      [{ role: 'user', content: 'Hi' }],
      { model: 'claude-haiku-4-5' },
    ))
      chunks.push(c);
    expect(chunks.map((c) => c.content).join('')).toBe('Hello');
    expect(chunks.slice(-1)[0]).toMatchObject({
      finishReason: 'end_turn',
      usage: { promptTokens: 5, completionTokens: 3 },
    });
    expect(create.mock.calls[0][0].stream).toBe(true);
  });

  it('refuses to run without a key', async () => {
    const bare = new AnthropicLlmProvider({ anthropic: {} } as any);
    await expect(
      bare.getCompletion([{ role: 'user', content: 'x' }], {
        model: 'claude-haiku-4-5',
      }),
    ).rejects.toThrow('ANTHROPIC_API_KEY');
  });
});
