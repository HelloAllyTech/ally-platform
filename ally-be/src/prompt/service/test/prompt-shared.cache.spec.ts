import { PromptSharedService } from '../prompt-shared.service';

describe('PromptSharedService resolver cache', () => {
  const build = () => {
    const findOne = jest.fn().mockResolvedValue({
      id: 'prompt-id',
      currentVersion: 3,
    });
    const manager = {
      findOne: jest.fn().mockResolvedValue({
        prompt: 'Live text',
        version: 3,
      }),
    };
    const repo = {
      findOne,
      manager,
      createQueryBuilder: jest.fn(), // still needed for other methods not under test
    };
    return { service: new PromptSharedService(repo as any), findOne, manager };
  };

  afterEach(() => {
    delete process.env.PROMPT_CACHE_TTL_MS;
  });

  it('reuses a resolved prompt within the TTL', async () => {
    const { service, findOne, manager } = build();
    await service.resolvePrompt('some_code');
    const again = await service.resolvePrompt('some_code');
    expect(findOne).toHaveBeenCalledTimes(1);
    expect(manager.findOne).toHaveBeenCalledTimes(1);
    expect(again).toEqual(expect.objectContaining({ version: 3 }));
  });

  it('reads the store again after a publish drops the cached copy', async () => {
    const { service, findOne, manager } = build();
    await service.resolvePrompt('some_code');
    service.invalidate();
    await service.resolvePrompt('some_code');
    expect(findOne).toHaveBeenCalledTimes(2);
    expect(manager.findOne).toHaveBeenCalledTimes(2);
  });

  it('does not cache when PROMPT_CACHE_TTL_MS=0', async () => {
    process.env.PROMPT_CACHE_TTL_MS = '0';
    const { service, findOne, manager } = build();
    await service.resolvePrompt('some_code');
    await service.resolvePrompt('some_code');
    expect(findOne).toHaveBeenCalledTimes(2);
    expect(manager.findOne).toHaveBeenCalledTimes(2);
  });
});
