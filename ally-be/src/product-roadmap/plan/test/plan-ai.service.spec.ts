import { PlanAiService } from '../plan-ai.service';

/** Roadmap v2 (§5.6): a specialist is a spend point on its plan. */
describe('PlanAiService ceiling', () => {
  const build = (assert: jest.Mock) => {
    const prompts = { getPromptByCode: jest.fn(async () => 'system') };
    const llm = {
      complete: jest.fn(async () => ({
        text: '{"ok":true}',
        provider: 'anthropic',
        model: 'm',
        usage: { inputTokens: 1, outputTokens: 1 },
      })),
    };
    const spend = { record: jest.fn() };
    const service = new PlanAiService(
      prompts as never,
      llm as never,
      spend as never,
      { assertWithinCeiling: assert } as never,
    );
    return { service, llm, spend };
  };
  const input = (sessionId: string | null) => ({
    promptCode: 'planning_safety_review',
    payload: '{}',
    maxTokens: 10,
    sessionId,
    stage: null,
    actorUserId: 7,
    specialist: 'safety',
  });

  it('refuses before the model call when the plan is past its ceiling', async () => {
    const assert = jest.fn().mockRejectedValue(new Error('ceiling'));
    const { service, llm, spend } = build(assert);
    await expect(service.json(input('s1'))).rejects.toThrow('ceiling');
    expect(assert).toHaveBeenCalledWith('s1', 'specialist');
    expect(llm.complete).not.toHaveBeenCalled();
    expect(spend.record).not.toHaveBeenCalled();
  });

  it('runs as before when the check passes', async () => {
    const assert = jest.fn().mockResolvedValue(undefined);
    const { service, llm } = build(assert);
    await expect(service.json(input(null))).resolves.toEqual({ ok: true });
    expect(assert).toHaveBeenCalledWith(null, 'specialist');
    expect(llm.complete).toHaveBeenCalled();
  });
});
