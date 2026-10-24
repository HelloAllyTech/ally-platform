import { PromptSharedService } from '../prompt-shared.service';

describe('PromptSharedService resolver cache', () => {
  const build = () => {
    const getRawOne = jest.fn().mockResolvedValue({
      prompt: 'Live text',
      version: 3,
    });
    const qb: any = {
      leftJoin: () => qb,
      select: () => qb,
      addSelect: () => qb,
      where: () => qb,
      getRawOne,
    };
    const repo = { createQueryBuilder: jest.fn(() => qb) };
    return { service: new PromptSharedService(repo as any), getRawOne };
  };

  afterEach(() => {
    delete process.env.PROMPT_CACHE_TTL_MS;
  });

  it('reuses a resolved prompt within the TTL', async () => {
    const { service, getRawOne } = build();
    await service.resolvePrompt('some_code');
    const again = await service.resolvePrompt('some_code');
    expect(getRawOne).toHaveBeenCalledTimes(1);
    expect(again).toEqual(expect.objectContaining({ version: 3 }));
  });

  it('reads the store again after a publish drops the cached copy', async () => {
    const { service, getRawOne } = build();
    await service.resolvePrompt('some_code');
    service.invalidate();
    await service.resolvePrompt('some_code');
    expect(getRawOne).toHaveBeenCalledTimes(2);
  });

  it('does not cache when PROMPT_CACHE_TTL_MS=0', async () => {
    process.env.PROMPT_CACHE_TTL_MS = '0';
    const { service, getRawOne } = build();
    await service.resolvePrompt('some_code');
    await service.resolvePrompt('some_code');
    expect(getRawOne).toHaveBeenCalledTimes(2);
  });
});
