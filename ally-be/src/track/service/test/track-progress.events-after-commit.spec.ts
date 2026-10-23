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
