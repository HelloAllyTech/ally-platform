import { BuilderSessionStatus } from '../../enum/builder.enum';
import { BuilderAskService } from '../builder-ask.service';

/**
 * Tell is routed by where the session is, and a queued instruction reaches
 * exactly the run that reads it — once, and the same way on a re-read.
 */
describe('BuilderAskService', () => {
  const build = (
    status: BuilderSessionStatus,
    over: Record<string, any> = {},
  ) => {
    const session = {
      id: 'sess-1',
      title: 'Weekly digest',
      status,
      createdBy: 7,
    };
    const rows: any[] = over.rows ?? [];
    const historyRepository = {
      find: jest.fn(async ({ where }: any) => {
        const clauses = Array.isArray(where) ? where : [where];
        return rows.filter((row) =>
          clauses.some((clause: any) =>
            Object.entries(clause).every(([key, value]) => row[key] === value),
          ),
        );
      }),
      update: jest.fn(async ({ id }: any, fields: any) => {
        const ids: string[] = id?._value ?? [];
        rows
          .filter((row) => ids.includes(row.id))
          .forEach((row) => Object.assign(row, fields));
      }),
    };
    const historyService = {
      record: jest.fn().mockResolvedValue({ id: 'h-1' }),
    };
    const decisionService = {
      startBackgroundTurn: jest.fn().mockResolvedValue(undefined),
    };
    const buildService = {
      cancelRun: jest.fn().mockResolvedValue(undefined),
      startBuild: jest.fn().mockResolvedValue({}),
    };
    const service = new BuilderAskService(
      { findOne: jest.fn().mockResolvedValue(session) } as never,
      {} as never,
      { findOne: jest.fn().mockResolvedValue(over.activeRun ?? null) } as never,
      {} as never,
      {} as never,
      buildService as never,
      decisionService as never,
      historyService as never,
      historyRepository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, historyService, decisionService, buildService, rows };
  };

  it('sends an instruction to an interview straight away', async () => {
    const { service, decisionService, historyService } = build(
      BuilderSessionStatus.INTERVIEWING,
    );
    await expect(
      service.tell('sess-1', 'Email only', false, 7),
    ).resolves.toMatchObject({
      route: 'interview',
    });
    expect(decisionService.startBackgroundTurn).toHaveBeenCalledWith(
      'sess-1',
      'Email only',
      7,
    );
    expect(historyService.record).toHaveBeenCalledWith(
      expect.objectContaining({ entryType: 'tell', tellStatus: 'applied' }),
    );
  });

  it('queues an instruction to a building session for its next run', async () => {
    const { service, decisionService, buildService } = build(
      BuilderSessionStatus.BUILDING,
    );
    await expect(
      service.tell('sess-1', 'Top 10 only', false, 7),
    ).resolves.toMatchObject({
      route: 'queued',
    });
    expect(decisionService.startBackgroundTurn).not.toHaveBeenCalled();
    expect(buildService.cancelRun).not.toHaveBeenCalled();
  });

  it('restarts the run only when asked to apply now', async () => {
    const run = { id: 'run-3', sessionId: 'sess-1' };
    const { service, buildService } = build(BuilderSessionStatus.BUILDING, {
      activeRun: run,
    });
    await expect(
      service.tell('sess-1', 'Top 10 only', true, 7),
    ).resolves.toMatchObject({
      route: 'applied_now',
    });
    expect(buildService.cancelRun).toHaveBeenCalledWith(run, 7);
    expect(buildService.startBuild).toHaveBeenCalled();
  });

  it('hands queued instructions to one run and keeps them on a re-read', async () => {
    const { service, rows } = build(BuilderSessionStatus.BUILDING, {
      rows: [
        {
          id: 't-1',
          sessionId: 'sess-1',
          entryType: 'tell',
          tellStatus: 'queued',
          prompt: 'Top 10 only',
        },
      ],
    });

    const first = await service.tellsForRun('sess-1', 'run-4');
    expect(first).toContain('Top 10 only');
    expect(rows[0]).toMatchObject({
      tellStatus: 'applied',
      appliedRunId: 'run-4',
    });

    const again = await service.tellsForRun('sess-1', 'run-4');
    expect(again).toContain('Top 10 only');
    expect(await service.tellsForRun('sess-1', 'run-5')).toBe('');
  });
});
