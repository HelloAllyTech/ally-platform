import { AgentStreamEvent } from 'src/llm-agent/type/agent-llm.type';
import {
  ReleaseGate,
  runOrchestrator,
  trimToCompleteExchange,
} from '../guide-orchestrator.runner';

const final = (
  content: any[],
  stopReason: any = 'end_turn',
): AgentStreamEvent => ({
  type: 'final',
  message: { content, stopReason, usage: { inputTokens: 1, outputTokens: 1 } },
});

function streamOf(passes: AgentStreamEvent[][]) {
  const requests: any[] = [];
  const stream = jest.fn(async function* (request: any) {
    requests.push(request);
    for (const event of passes.shift() ?? []) {
      if (request.signal?.aborted) throw new Error('aborted');
      yield event;
    }
  });
  return { stream, requests };
}

describe('ReleaseGate', () => {
  it('buffers until released, then streams through', async () => {
    const out: string[] = [];
    const gate = new ReleaseGate(async (text) => {
      out.push(text);
    });
    await gate.push('Hel');
    await gate.push('lo');
    expect(out).toEqual([]);
    await gate.release();
    await gate.push(' there');
    expect(out).toEqual(['Hello', ' there']);
    expect(gate.releasedText).toBe('Hello there');
  });

  it('drops everything once discarded', async () => {
    const out: string[] = [];
    const gate = new ReleaseGate(async (text) => {
      out.push(text);
    });
    await gate.push('never seen');
    gate.discard();
    await gate.release();
    await gate.push('nor this');
    expect(out).toEqual([]);
  });
});

describe('runOrchestrator', () => {
  const base = () => ({
    system: [{ text: 'persona' }],
    messages: [{ role: 'user' as const, content: 'hi' }],
    tools: [
      {
        name: 'get_progress',
        description: 'progress',
        input_schema: { type: 'object' },
        strict: true,
      },
    ],
    maxTokens: 100,
    maxPasses: 2,
    signal: new AbortController().signal,
  });

  it('runs a tool and continues, appending exactly what was exchanged', async () => {
    const { stream, requests } = streamOf([
      [
        { type: 'text_delta', text: 'Let me check.' },
        final(
          [
            { type: 'thinking', thinking: '', signature: 's1' },
            { type: 'text', text: 'Let me check.' },
            { type: 'tool_use', id: 'tu1', name: 'get_progress', input: {} },
          ],
          'tool_use',
        ),
      ],
      [
        { type: 'text_delta', text: 'You are halfway.' },
        final([{ type: 'text', text: 'You are halfway.' }]),
      ],
    ]);
    const released: string[] = [];
    const gate = new ReleaseGate(async (text) => {
      released.push(text);
    });
    await gate.release();
    const executeTool = jest.fn(async () => ({
      content: '{"completed":3}',
      isError: false,
    }));

    const out = await runOrchestrator({
      ...base(),
      stream,
      executeTool,
      gate,
    });

    expect(executeTool).toHaveBeenCalledWith('get_progress', {});
    expect(out.appended.map((m) => m.role)).toEqual([
      'assistant',
      'user',
      'assistant',
    ]);
    expect((out.appended[1].content as any[])[0]).toEqual({
      type: 'tool_result',
      tool_use_id: 'tu1',
      content: '{"completed":3}',
    });
    expect(out.text).toBe('Let me check.\n\nYou are halfway.');
    expect(released.join('')).toBe('Let me check.\n\nYou are halfway.');
    // Every pass keeps the same tools and caches the conversation.
    expect(requests.every((r) => r.tools.length === 1)).toBe(true);
    expect(requests.every((r) => r.cacheConversation)).toBe(true);
    expect(requests[1].messages).toHaveLength(3);
  });

  it('closes with tool_choice none after the pass limit, keeping the tools', async () => {
    const toolPass = () => [
      final(
        [
          {
            type: 'tool_use',
            id: `tu${Math.random()}`,
            name: 'get_progress',
            input: {},
          },
        ],
        'tool_use',
      ),
    ];
    const { stream, requests } = streamOf([
      toolPass(),
      toolPass(),
      [final([{ type: 'text', text: 'Done.' }])],
    ]);
    const gate = new ReleaseGate(async () => undefined);
    await gate.release();
    const out = await runOrchestrator({
      ...base(),
      stream,
      executeTool: async () => ({ content: '{}', isError: false }),
      gate,
    });
    expect(requests).toHaveLength(3);
    expect(requests[2].toolChoice).toBe('none');
    expect(requests[2].tools).toHaveLength(1);
    expect(out.text).toBe('Done.');
  });

  it('marks a refusal and stops', async () => {
    const { stream } = streamOf([[final([], 'refusal')]]);
    const out = await runOrchestrator({
      ...base(),
      stream,
      executeTool: jest.fn(),
      gate: new ReleaseGate(async () => undefined),
    });
    expect(out.refusal).toEqual({ category: null });
    expect(out.appended).toEqual([]);
  });

  it('reports an abort and keeps only complete exchanges', async () => {
    const controller = new AbortController();
    const { stream } = streamOf([
      [
        final(
          [{ type: 'tool_use', id: 'tu1', name: 'get_progress', input: {} }],
          'tool_use',
        ),
      ],
      [
        { type: 'text_delta', text: 'partial' },
        final([{ type: 'text', text: 'x' }]),
      ],
    ]);
    const out = await runOrchestrator({
      ...base(),
      signal: controller.signal,
      stream,
      executeTool: async () => {
        controller.abort();
        return { content: '{}', isError: false };
      },
      gate: new ReleaseGate(async () => undefined),
    });
    expect(out.aborted).toBe(true);
    expect(out.appended).toEqual([]);
  });
});

describe('trimToCompleteExchange', () => {
  it('drops a trailing tool round that never got its answer', () => {
    expect(
      trimToCompleteExchange([
        { role: 'assistant', content: [{ type: 'text', text: 'a' }] },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 't', name: 'x', input: {} }],
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 't', content: '{}' }],
        },
      ]),
    ).toEqual([{ role: 'assistant', content: [{ type: 'text', text: 'a' }] }]);
  });
});
