import { PromptSharedService } from '../prompt-shared.service';

describe('PromptSharedService.getPromptsForRuntime fallback', () => {
  const build = () => {
    const service = new PromptSharedService({} as any);
    const read = jest.spyOn(service, 'getPromptsByOptions');
    const readDefaults = jest.spyOn(
      service as any,
      'getPromptsDefaultsForRuntime',
    );
    return { service, read, readDefaults };
  };
  const row = (promptCode: string, prompt = `default ${promptCode}`) =>
    ({
      promptCode,
      prompt,
      version: null,
      contentHash: expect.any(String),
      temperature: undefined,
    }) as any;

  it('serves defaults when the store is down on a cold start', async () => {
    const { service, read, readDefaults } = build();
    read.mockRejectedValue(new Error('statement timeout'));
    readDefaults.mockResolvedValue([row('ally_ai_summary_summary')]);

    const rows = await service.getPromptsForRuntime({
      promptCode: ['ally_ai_summary_summary'],
    });

    expect(rows).toEqual([row('ally_ai_summary_summary')]);
    expect(read).toHaveBeenCalledTimes(2);
    expect(readDefaults).toHaveBeenCalledTimes(1);
  });

  it('throws if both store and defaults fail', async () => {
    const { service, read, readDefaults } = build();
    read.mockRejectedValue(new Error('statement timeout'));
    readDefaults.mockRejectedValue(new Error('defaults failed'));

    await expect(
      service.getPromptsForRuntime({
        promptCode: ['ally_ai_summary_summary'],
      }),
    ).rejects.toThrow(
      'The prompt store could not be read, and defaults could not be served: defaults failed',
    );
    expect(read).toHaveBeenCalledTimes(2);
    expect(readDefaults).toHaveBeenCalledTimes(1);
  });
});
