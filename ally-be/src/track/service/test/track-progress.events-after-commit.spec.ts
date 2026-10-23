import { SessionItemStatus } from 'src/common/type/common.type';
import { TrackEnrollment } from '../../entity/track-enrollment.entity';
import { TrackItemProgress } from '../../entity/track-item-progress.entity';
import { TrackItem } from '../../entity/track-item.entity';
import { TrackSection } from '../../entity/track-section.entity';
import { TrackItemType } from '../../type/track.type';
import { TRACK_EVENTS, TrackProgressService } from '../track-progress.service';

jest.mock('src/logger/logger.service', () => ({
  LoggerService: {
    getInstance: jest.fn(() => ({
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    })),
  },
}));

/**
 * Progress events are a promise that the completion happened. They used to be
 * emitted inside completeItem's transaction, so an async listener could read
 * progress before the commit landed — or hear about a completion that was
 * then rolled back. The Ally guide reads progress back on every event, so
 * the events now go out after the transaction commits, and never on a
 * rollback.
 */
describe('TrackProgressService.completeItem — events after commit', () => {
  const item = {
    id: 'item-1',
    trackId: 'track-1',
    trackSectionId: 'sec-1',
    order: 1,
    type: TrackItemType.ARTICLE,
  };
  const progress = {
    id: 'tip-1',
    trackItemId: 'item-1',
    trackEnrollmentId: 'enr-1',
    userId: 7,
    status: SessionItemStatus.UNLOCKED,
    meta: {},
  };

  function setup(commit: 'ok' | 'rollback') {
    const order: string[] = [];
    const repos = new Map<unknown, any>([
      [
        TrackItemProgress,
        {
          findOne: jest.fn(async () => progress),
          find: jest.fn(async () => [progress]),
          update: jest.fn(),
        },
      ],
      [
        TrackEnrollment,
        {
          findOne: jest.fn(async () => ({
            id: 'enr-1',
            userId: 7,
            tenantId: 't',
            completedItems: 0,
          })),
          update: jest.fn(),
        },
      ],
      [
        TrackItem,
        {
          findOne: jest.fn(async () => item),
          find: jest.fn(async () => [item]),
        },
      ],
      [
        TrackSection,
        { find: jest.fn(async () => [{ id: 'sec-1', order: 1 }]) },
      ],
    ]);
    const manager = { getRepository: (entity: unknown) => repos.get(entity) };
    const dataSource = {
      transaction: jest.fn(async (cb: (m: typeof manager) => unknown) => {
        const result = await cb(manager);
        if (commit === 'rollback') throw new Error('serialization failure');
        order.push('commit');
        return result;
      }),
    };
    const emitter = {
      emit: jest.fn((name: string) => {
        order.push(name);
      }),
    };
    const service = new TrackProgressService(
      dataSource as any,
      { simulationPath: {} } as any,
      emitter as any,
      {} as any,
      {} as any,
    );
    return { service, order, emitter };
  }

  it('emits only once the transaction has committed', async () => {
    const { service, order } = setup('ok');
    const result = await service.completeItem('tip-1', {});
    expect(result.completed).toBe(true);
    expect(order).toEqual([
      'commit',
      TRACK_EVENTS.ITEM_COMPLETED,
      TRACK_EVENTS.SECTION_COMPLETED,
      TRACK_EVENTS.TRACK_COMPLETED,
    ]);
  });

  it('emits nothing when the transaction rolls back', async () => {
    const { service, emitter } = setup('rollback');
    await expect(service.completeItem('tip-1', {})).rejects.toThrow();
    expect(emitter.emit).not.toHaveBeenCalled();
  });
});

describe('TrackProgressService.handleRoleplayEnd — attempt-ended event', () => {
  function setup(item: Record<string, unknown>) {
    const emitted: Array<{ name: string; payload: any }> = [];
    const progress = {
      id: 'tip-1',
      trackItemId: 'item-1',
      trackEnrollmentId: 'enr-1',
      userId: 7,
      status: SessionItemStatus.UNLOCKED,
      attemptCount: 0,
    };
    const service = new TrackProgressService(
      { transaction: jest.fn() } as any,
      {
        simulationPath: { simulationPathItemMinDurationForCompletion: 60 },
      } as any,
      {
        emit: (name: string, payload: unknown) =>
          emitted.push({ name, payload }),
      } as any,
      { findOne: jest.fn(async () => progress), update: jest.fn() } as any,
      {
        findOne: jest.fn(async () => ({
          id: 'item-1',
          type: TrackItemType.ROLEPLAY,
          completionCriteria: {},
          ...item,
        })),
      } as any,
    );
    return { service, emitted };
  }

  it('reports a call too short to count', async () => {
    const { service, emitted } = setup({});
    await service.handleRoleplayEnd({
      trackItemProgressId: 'tip-1',
      score: 50,
      callDuration: 10_000,
    });
    expect(emitted).toEqual([
      {
        name: TRACK_EVENTS.ROLEPLAY_ATTEMPT_ENDED,
        payload: expect.objectContaining({
          outcome: 'too_short',
          trackItemId: 'item-1',
          callDurationMs: 10_000,
        }),
      },
    ]);
  });

  it('reports a score below the bar', async () => {
    const { service, emitted } = setup({
      completionCriteria: { minScore: 70 },
    });
    await service.handleRoleplayEnd({
      trackItemProgressId: 'tip-1',
      score: 20,
      callDuration: 120_000,
    });
    expect(emitted[0].payload).toMatchObject({
      outcome: 'below_score',
      score: 20,
    });
  });
});
