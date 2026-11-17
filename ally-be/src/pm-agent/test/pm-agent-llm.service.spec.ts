import 'reflect-metadata';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { PmAgentLlmService } from '../pipeline/pm-agent-llm.service';
import { PmRunLedger } from '../util/run-ledger';
import { submitTurn } from './pm-pipeline.fakes';

function build(opts: { failFirst?: number; configured?: string[] } = {}) {
  const usage = { record: jest.fn().mockResolvedValue(undefined) };
  const steps = { insert: jest.fn().mockResolvedValue(undefined) };
  const created: string[] = [];
  const factory = {
    isConfigured: (p: string) =>
      (opts.configured ?? ['openai', 'anthropic']).includes(p),
    create: (provider: string, model: string) => {
      created.push(`${provider}/${model}`);
      return {
        name: provider,
        async *stream() {
          if (provider === 'anthropic' && opts.failFirst) {
            const error: any = new Error('credit balance too low');
            error.status = 400 + opts.failFirst;
            throw error;
          }
          yield { type: 'final', message: submitTurn([]) };
        },
      };
    },
  };
  const resolver = {
    resolve: jest.fn().mockResolvedValue({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      tierModel: 'gpt-5-mini',
      fallbackEnabled: true,
    }),
  };
  const service = new PmAgentLlmService(
    resolver as never,
    factory as never,
    usage as never,
    { resolvePrompt: async () => ({ prompt: 'p', version: 2 }) } as never,
    { llmTiers: { fast: 'gpt-4o-mini', reasoning: 'gpt-5-mini' } } as never,
    steps as never,
  );
  return { service, usage, steps, created, resolver };
}

const request = (
  service: PmAgentLlmService,
  target: any,
  ledger: PmRunLedger,
) => ({
  runId: '11111111-1111-4111-8111-111111111111',
  lane: 'analytics',
  kind: 'lane' as const,
  taskId: 'pm-agent-lane-analytics',
  promptCode: 'pm_agent_lane_analytics',
  promptVersion: 2,
  target,
  system: [{ text: 'sys' }],
  messages: [{ role: 'user' as const, content: 'go' }],
  tools: [],
  maxTokens: 1000,
  timeoutMs: 1000,
  ledger,
});

describe('PmAgentLlmService', () => {
  it('meters every call as pm_agent and writes a trace row with the prompt version', async () => {
    const { service, usage, steps } = build();
    const target = await service.resolveTarget(
      'pm-agent-lane-analytics',
      'pm_agent_lane_analytics',
      false,
    );
    const ledger = new PmRunLedger(5, 0);
    const result = await service.step(request(service, target, ledger));
    expect(result.status).toBe('ok');
    expect(usage.record).toHaveBeenCalledWith(
      expect.objectContaining({
        task: LlmTask.PM_AGENT,
        model: 'claude-sonnet-4-6',
      }),
    );
    expect(steps.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        promptCode: 'pm_agent_lane_analytics',
        promptVersion: 2,
        outcome: 'ok',
      }),
    );
    expect(ledger.spent).toBeGreaterThan(0);
  });

  it('falls back to the tier model on OpenAI when the primary provider fails (lapsed credit)', async () => {
    const { service, created } = build({ failFirst: 3 }); // 403
    const target = await service.resolveTarget('t', 'p', false);
    const result = await service.step(
      request(service, target, new PmRunLedger(5, 0)),
    );
    expect(result.status).toBe('ok');
    expect(created).toEqual([
      'anthropic/claude-sonnet-4-6',
      'openai/gpt-5-mini',
    ]);
  });

  it('uses the tier model directly when the prompt’s provider has no key here', async () => {
    const { service } = build({ configured: ['openai'] });
    expect(await service.resolveTarget('t', 'p', false)).toEqual({
      provider: 'openai',
      model: 'gpt-5-mini',
    });
  });

  it('a cheap target is an explicit FAST-tier override', async () => {
    const { service, resolver } = build();
    await service.resolveTarget('t', 'p', true);
    expect(resolver.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ tier: 'fast', model: 'gpt-4o-mini' }),
    );
  });

  it('a call that cannot reserve never reaches the provider', async () => {
    const { service, created, usage, steps } = build();
    const target = await service.resolveTarget('t', 'p', false);
    const result = await service.step(
      request(service, target, new PmRunLedger(0, 0)),
    );
    expect(result.status).toBe('budget');
    expect(created).toHaveLength(0);
    expect(usage.record).not.toHaveBeenCalled();
    expect(steps.insert).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'budget' }),
    );
  });
});
