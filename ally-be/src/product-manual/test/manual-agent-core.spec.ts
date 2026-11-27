import { LlmTask } from 'src/learn/enum/llm-task.enum';
import type {
  AgentStreamEvent,
  AgentStreamRequest,
  AgentTurnResult,
} from 'src/llm-agent/type/agent-llm.type';
import {
  ManualAgentCore,
  ManualLoopEvent,
  ManualLoopRequest,
  ManualLoopResult,
} from '../service/manual-agent-core';
import { ManualRunLedger } from '../service/manual-run-ledger';

type Step = AgentTurnResult | Error;

const turn = (
  content: AgentTurnResult['content'],
  stopReason: AgentTurnResult['stopReason'] = 'end_turn',
): AgentTurnResult => ({
  content,
  stopReason,
  usage: { inputTokens: 1000, outputTokens: 200 },
});
const text = (t: string) => turn([{ type: 'text', text: t }]);
const toolUse = (...calls: [string, string, Record<string, any>][]) =>
  turn(
    calls.map(([id, name, input]) => ({
      type: 'tool_use' as const,
      id,
      name,
      input,
    })),
    'tool_use',
  );

/** A provider factory that plays a script of passes and records every request. */
function fakeFactory(script: Step[], perModel?: Record<string, Step[]>) {
  const requests: { model: string; request: AgentStreamRequest }[] = [];
  const queues: Record<string, Step[]> = { ...(perModel ?? {}) };
  const factory = {
    isConfigured: () => true,
    create: (_provider: string, model: string) => ({
      name: 'fake',
      async *stream(
        request: AgentStreamRequest,
      ): AsyncGenerator<AgentStreamEvent> {
        requests.push({ model, request: JSON.parse(JSON.stringify(request)) });
        const queue = queues[model] ?? script;
        const step = queue.shift();
        if (!step) throw new Error('script exhausted');
        if (step instanceof Error) throw step;
        for (const block of step.content) {
          if (block.type === 'text')
            yield { type: 'text_delta', text: block.text };
        }
        yield { type: 'final', message: step };
      },
    }),
  };
  return { factory, requests };
}

async function drain(
  gen: AsyncGenerator<ManualLoopEvent, ManualLoopResult>,
): Promise<{ events: ManualLoopEvent[]; result: ManualLoopResult }> {
  const events: ManualLoopEvent[] = [];
  for (;;) {
    const step = await gen.next();
    if (step.done) return { events, result: step.value };
    events.push(step.value);
  }
}

function setup(script: Step[], perModel?: Record<string, Step[]>) {
  const { factory, requests } = fakeFactory(script, perModel);
  const llmUsage = { record: jest.fn().mockResolvedValue(undefined) };
  const core = new ManualAgentCore(
    {} as never,
    factory as never,
    llmUsage as never,
  );
  const execute = jest.fn(async (name: string) => ({
    modelResult: JSON.stringify({ ok: true, name }),
    summary: `ran ${name}`,
    ok: true,
  }));
  const request = (
    over: Partial<ManualLoopRequest> = {},
  ): ManualLoopRequest => ({
    taskId: 'product-manual-chat',
    usageTask: LlmTask.PRODUCT_MANUAL_CHAT,
    target: { provider: 'openai', model: 'gpt-5-mini' },
    system: [{ text: 'sys', cache: true }],
    messages: [{ role: 'user', content: 'hello' }],
    tools: [
      {
        name: 'search_manual',
        description: '',
        input_schema: { type: 'object' },
      },
      {
        name: 'read_manual_page',
        description: '',
        input_schema: { type: 'object' },
      },
    ],
    maxIterations: 3,
    maxTokens: 1000,
    timeoutMs: 1000,
    execute,
    describe: (name) => `doing ${name}`,
    metadata: { conversationId: 'c1', userId: 7 },
    ...over,
  });
  return { core, requests, llmUsage, execute, request };
}

describe('ManualAgentCore.run', () => {
  it('runs tool_use → tool_result → final answer, answering parallel calls in one user message', async () => {
    const { core, requests, llmUsage, execute, request } = setup([
      toolUse(
        ['t1', 'search_manual', { query: 'x' }],
        ['t2', 'read_manual_page', { slug: 'a' }],
      ),
      text('The answer.'),
    ]);
    const { events, result } = await drain(core.run(request()));

    expect(result).toMatchObject({
      status: 'done',
      text: 'The answer.',
      iterations: 2,
    });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(events.map((e) => e.type)).toEqual([
      'tool_start',
      'tool_start',
      'tool_done',
      'tool_done',
      'text',
    ]);
    // Second pass: assistant tool_use turn, then ONE user message with both results.
    const second = requests[1].request.messages;
    expect(second).toHaveLength(3);
    expect(second[1].role).toBe('assistant');
    const results = second[2].content as any[];
    expect(results.map((b) => [b.type, b.tool_use_id])).toEqual([
      ['tool_result', 't1'],
      ['tool_result', 't2'],
    ]);
    // One usage row per pass, under the manual's label.
    expect(llmUsage.record).toHaveBeenCalledTimes(2);
    expect(llmUsage.record.mock.calls[0][0]).toMatchObject({
      task: LlmTask.PRODUCT_MANUAL_CHAT,
      metadata: {
        feature: 'product-manual',
        conversationId: 'c1',
        userId: 7,
        iteration: 1,
      },
    });
  });

  it('marks a failed tool result as an error for the model and never throws out of a tool', async () => {
    const { core, requests, request } = setup([
      toolUse(['t1', 'search_manual', { query: 'x' }]),
      text('ok'),
    ]);
    const { result } = await drain(
      core.run(
        request({
          execute: async () => {
            throw new Error('boom');
          },
        }),
      ),
    );
    expect(result.status).toBe('done');
    const block = (requests[1].request.messages[2].content as any[])[0];
    expect(block).toMatchObject({ type: 'tool_result', is_error: true });
    expect(JSON.parse(block.content)).toEqual({ ok: false, error: 'boom' });
  });

  it('stops at the iteration cap, with a closing no-tools pass when asked', async () => {
    const always = () => toolUse(['t', 'search_manual', { query: 'x' }]);
    const capped = setup([always(), always(), always()]);
    const plain = await drain(
      capped.core.run(capped.request({ maxIterations: 3 })),
    );
    expect(plain.result.status).toBe('iteration_cap');
    expect(capped.requests).toHaveLength(3);

    const closing = setup([always(), always(), text('Here is what I found.')]);
    const out = await drain(
      closing.core.run(
        closing.request({ maxIterations: 2, closingPass: true }),
      ),
    );
    expect(out.result).toMatchObject({
      status: 'done',
      text: 'Here is what I found.',
    });
    expect(closing.requests).toHaveLength(3);
    expect(closing.requests[2].request.toolChoice).toBe('none');
    const lastUser = closing.requests[2].request.messages.slice(-1)[0]
      .content as any[];
    expect(lastUser[lastUser.length - 1].type).toBe('text');
  });

  it('stops when the signal is aborted', async () => {
    const controller = new AbortController();
    const { core, request } = setup([
      toolUse(['t1', 'search_manual', { query: 'x' }]),
      text('never'),
    ]);
    const { result } = await drain(
      core.run(
        request({
          signal: controller.signal,
          execute: async () => {
            controller.abort();
            return { modelResult: '{}', summary: '', ok: true };
          },
        }),
      ),
    );
    expect(result.status).toBe('aborted');
  });

  it('makes no call the spend gate cannot reserve', async () => {
    const { core, requests, request } = setup([text('x')]);
    const { result } = await drain(
      core.run(request({ gate: new ManualRunLedger(0) })),
    );
    expect(result.status).toBe('budget');
    expect(requests).toHaveLength(0);
  });

  it('settles the reservation to the actual cost', async () => {
    const { core, request } = setup([text('x')]);
    const ledger = new ManualRunLedger(10);
    const { result } = await drain(core.run(request({ gate: ledger })));
    expect(result.status).toBe('done');
    expect(ledger.reserved).toBe(0);
    expect(ledger.spent).toBeGreaterThan(0);
    expect(ledger.spent).toBe(Number(result.costUsd.toFixed(4)));
  });

  it('retries a failed pass once on the fallback model', async () => {
    const { core, requests, request } = setup([], {
      'gpt-5-mini': [new Error('500 upstream')],
      'claude-x': [text('from fallback')],
    });
    const { result } = await drain(
      core.run(
        request({
          target: {
            provider: 'openai',
            model: 'gpt-5-mini',
            fallback: { provider: 'anthropic', model: 'claude-x' },
          },
        }),
      ),
    );
    expect(result).toMatchObject({ status: 'done', text: 'from fallback' });
    expect(requests.map((r) => r.model)).toEqual(['gpt-5-mini', 'claude-x']);
  });

  it('reports provider_failed when there is no fallback', async () => {
    const { core, request } = setup([new Error('down')]);
    const { result } = await drain(core.run(request()));
    expect(result).toMatchObject({ status: 'provider_failed', error: 'down' });
  });
});

describe('ManualAgentCore anti-loop guard', () => {
  const failing = (error = 'github_not_configured') =>
    jest.fn(async () => ({
      modelResult: JSON.stringify({ ok: false, error }),
      summary: "Code search isn't available right now",
      ok: false,
    }));

  it('does not re-run a call that already failed with the same (normalised) input', async () => {
    const { core, requests, request } = setup([
      toolUse(['t1', 'search_manual', { query: 'Refunds' }]),
      toolUse(['t2', 'search_manual', { query: '  refunds ' }]),
      text('done'),
    ]);
    const execute = failing('search_failed');
    const { events, result } = await drain(core.run(request({ execute })));
    expect(result.status).toBe('done');
    expect(execute).toHaveBeenCalledTimes(1);
    const repeat = (requests[2].request.messages[4].content as any[])[0];
    expect(JSON.parse(repeat.content)).toEqual({
      ok: false,
      error: 'That already failed; do not retry it.',
    });
    const done = events.filter((e) => e.type === 'tool_done') as any[];
    expect(done[1].outcome.summary).toBe(
      'Skipped a lookup that already failed',
    );
  });

  it('refuses a tool for the rest of the turn after three failed calls', async () => {
    const { core, requests, request } = setup([
      toolUse(['a', 'search_manual', { query: 'one' }]),
      toolUse(['b', 'search_manual', { query: 'two' }]),
      toolUse(['c', 'search_manual', { query: 'three' }]),
      toolUse(['d', 'search_manual', { query: 'four' }]),
      text('answer without it'),
    ]);
    const execute = failing('search_failed');
    const { result } = await drain(
      core.run(request({ execute, maxIterations: 6 })),
    );
    expect(result.status).toBe('done');
    expect(execute).toHaveBeenCalledTimes(3);
    const refused = (
      requests[4].request.messages.slice(-1)[0].content as any[]
    )[0];
    expect(JSON.parse(refused.content).error).toMatch(
      /not available for the rest/,
    );
    // The definition stays in the request (prefix and cache unchanged); calls are refused instead.
    expect(requests[4].request.tools!.map((t) => t.name)).toContain(
      'search_manual',
    );
  });

  it('gives a plain sentence, not the exception text, when a tool throws', async () => {
    const { core, request } = setup([
      toolUse(['t1', 'search_manual', { query: 'x' }]),
      text('ok'),
    ]);
    const { events } = await drain(
      core.run(
        request({
          execute: async () => {
            throw new Error('ECONNRESET socket_hang_up');
          },
        }),
      ),
    );
    const done = events.find((e) => e.type === 'tool_done') as any;
    expect(done.outcome.summary).toBe("That step didn't work");
  });
});
