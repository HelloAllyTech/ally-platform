import { PromptSharedService } from '../prompt-shared.service';

describe('PromptSharedService.getPromptsForRuntime', () => {
  const build = () => {
    const mockQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    const promptsRepository = {
      createQueryBuilder: jest.fn(() => mockQueryBuilder),
    } as any;
    const service = new PromptSharedService(promptsRepository);
    const read = jest.spyOn(service, 'getPromptsByOptions');
    const readDefaults = jest.spyOn(
      service as any,
      'getPromptsDefaultsForRuntime',
    );
    return { service, read, readDefaults, mockQueryBuilder };
  };
  const row = (promptCode: string, prompt = `live ${promptCode}`) =>
    ({ promptCode, prompt }) as any;

  it('retries a failed read once', async () => {
    const { service, read } = build();
    read
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValueOnce([row('ally_ai_summary_summary')]);

    const rows = await service.getPromptsForRuntime({
      promptCode: ['ally_ai_summary_summary'],
    });

    expect(rows).toEqual([row('ally_ai_summary_summary')]);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('serves the last good rows when the store stops answering', async () => {
    const { service, read } = build();
    read.mockResolvedValueOnce([row('ally_ai_summary_summary')]);
    await service.getPromptsForRuntime({
      promptCode: ['ally_ai_summary_summary'],
    });
    read.mockRejectedValue(new Error('statement timeout'));

    const rows = await service.getPromptsForRuntime({
      promptCode: ['ally_ai_summary_summary'],
    });

    expect(rows).toEqual([row('ally_ai_summary_summary')]);
  });

  it('serves a whole prefix from the cache once it was read in full', async () => {
    const { service, read } = build();
    read.mockResolvedValueOnce([
      row('ally_ai_learn_system_main_agent_prompt'),
      row('ally_ai_learn_events_guardrail_system'),
    ]);
    await service.getPromptsForRuntime({ promptCodePrefix: 'ally_ai_learn_' });
    read.mockRejectedValue(new Error('statement timeout'));

    const rows = await service.getPromptsForRuntime({
      promptCodePrefix: 'ally_ai_learn_',
    });

    expect(rows.map((r) => r.promptCode).sort()).toEqual([
      'ally_ai_learn_events_guardrail_system',
      'ally_ai_learn_system_main_agent_prompt',
    ]);
  });

  it('refuses when the cache does not cover the whole request', async () => {
    const { service, read, readDefaults } = build();
    read.mockResolvedValueOnce([row('ally_ai_summary_summary')]);
    await service.getPromptsForRuntime({
      promptCode: ['ally_ai_summary_summary'],
    });
    read.mockRejectedValue(new Error('statement timeout'));
    readDefaults.mockRejectedValue(new Error('defaults failed'));

    await expect(
      service.getPromptsForRuntime({
        promptCode: ['ally_ai_summary_summary', 'ally_ai_audio_diarization'],
      }),
    ).rejects.toThrow(
      'The prompt store could not be read, and defaults could not be served: defaults failed',
    );
    // Some codes read is not the whole prefix.
    await expect(
      service.getPromptsForRuntime({ promptCodePrefix: 'ally_ai_' }),
    ).rejects.toThrow(
      'The prompt store could not be read, and defaults could not be served: defaults failed',
    );
  });

  it('refuses with nothing cached and defaults fail', async () => {
    const { service, read, readDefaults } = build();
    read.mockRejectedValue(new Error('down'));
    readDefaults.mockRejectedValue(new Error('also down'));

    await expect(
      service.getPromptsForRuntime({ promptCodePrefix: 'ally_ai_learn_' }),
    ).rejects.toThrow(
      'The prompt store could not be read, and defaults could not be served: also down',
    );
  });
});
