import { BuilderLessonsService } from '../builder-lessons.service';

const lesson = (code: string, statement: string) => ({ code, statement });

function setup(options: { search?: jest.Mock; frozen?: string[] } = {}) {
  const agentChunks = {
    listActive: jest.fn().mockResolvedValue([lesson('BL-0001', 'pinned')]),
    search:
      options.search ??
      jest
        .fn()
        .mockResolvedValue([
          { chunk: lesson('BL-0007', 'relevant'), band: 'strong', card: '' },
        ]),
    activeByCodes: jest
      .fn()
      .mockResolvedValue([lesson('BL-0009', 'frozen choice')]),
    card: jest.fn((c: any) => `[${c.code}] ${c.statement}`),
  };
  const dataSource = { query: jest.fn().mockResolvedValue([]) };
  const service = new BuilderLessonsService(
    dataSource as any,
    agentChunks as any,
  );
  const session: any = {
    id: 'session-1',
    title: 'Rate the debrief',
    repos: ['ally-web'],
    metadata: options.frozen ? { lessons: { codes: options.frozen } } : {},
  };
  return { service, agentChunks, dataSource, session };
}

describe('BuilderLessonsService', () => {
  it('carries pinned lessons first, then the ones search finds for this session, and freezes the choice', async () => {
    const { service, agentChunks, dataSource, session } = setup();

    const block = await service.blockForSession(
      session,
      'Let learners rate it',
    );

    expect(agentChunks.listActive).toHaveBeenCalledWith(
      expect.objectContaining({ repos: ['ally-web'], pinnedOnly: true }),
    );
    expect(agentChunks.search).toHaveBeenCalledWith(
      expect.objectContaining({
        useCase: 'builder_interview',
        collection: 'builder_lessons',
        repos: ['ally-web'],
        sessionId: 'session-1',
        excludeCodes: ['BL-0001'],
      }),
    );
    expect(block).toContain('# Lessons from previous builds');
    expect(block.indexOf('[BL-0001] pinned')).toBeLessThan(
      block.indexOf('[BL-0007] relevant'),
    );
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('{lessons}'),
      ['session-1', expect.stringContaining('"codes":["BL-0007"]')],
    );
  });

  it('re-reads a frozen choice by code instead of searching again, so the prefix stays cached', async () => {
    const { service, agentChunks, dataSource, session } = setup({
      frozen: ['BL-0009'],
    });

    const block = await service.blockForSession(session, 'turn 5');

    expect(agentChunks.search).not.toHaveBeenCalled();
    expect(agentChunks.activeByCodes).toHaveBeenCalledWith(['BL-0009']);
    expect(block).toContain('[BL-0009] frozen choice');
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('falls back to pinned lessons when search fails, and tries again next turn', async () => {
    const { service, dataSource, session } = setup({
      search: jest.fn().mockRejectedValue(new Error('Retrieval failed')),
    });

    const block = await service.blockForSession(session, 'hello');

    expect(block).toContain('[BL-0001] pinned');
    expect(block).not.toContain('BL-0007');
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('renders nothing without the Context Library', async () => {
    const service = new BuilderLessonsService(undefined, undefined);
    await expect(
      service.block({ useCase: 'builder_research' as any, request: 'x' }),
    ).resolves.toEqual({ block: '', retrieved: null });
  });
});
