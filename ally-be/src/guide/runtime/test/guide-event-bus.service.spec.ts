import { EventEmitter } from 'events';
import {
  GuideEventBusService,
  GuideReplayGate,
} from '../guide-event-bus.service';
import { GuideEvent } from '../../contract/generated/guide-contract';

/** An in-process stand-in for Redis pub/sub with pattern subscriptions. */
function fakeRedisHub() {
  const subscribers: Array<{ pattern: RegExp; client: EventEmitter }> = [];
  const make = () => {
    const client = new EventEmitter() as EventEmitter & Record<string, any>;
    client.publish = jest.fn(async (channel: string, message: string) => {
      for (const s of subscribers) {
        if (s.pattern.test(channel)) {
          s.client.emit('pmessage', 'p', channel, message);
        }
      }
      return 1;
    });
    client.psubscribe = jest.fn(async (pattern: string) => {
      subscribers.push({
        pattern: new RegExp(
          `^${pattern.replace(/[.]/g, '\\.').replace('*', '.*')}$`,
        ),
        client,
      });
    });
    client.quit = jest.fn();
    return client;
  };
  return { createClient: jest.fn(() => make()) };
}

function fakeDataSource(lastEventSeq = 0) {
  const inserted: any[] = [];
  let seq = lastEventSeq;
  const manager = {
    query: jest.fn(async () => [[{ lastEventSeq: ++seq }], 1]),
    getRepository: () => ({
      insert: jest.fn(async (row: any) => inserted.push(row)),
    }),
  };
  return {
    inserted,
    dataSource: {
      transaction: async (fn: any) => fn(manager),
      getRepository: () => ({
        createQueryBuilder: () => {
          const qb: any = {};
          let after = 0;
          qb.where = () => qb;
          qb.andWhere = (_: string, p: any) => {
            after = p.afterSeq;
            return qb;
          };
          qb.orderBy = () => qb;
          qb.limit = () => qb;
          qb.getMany = async () =>
            inserted
              .filter((r) => r.seq > after)
              .map((r) => ({ payload: r.payload }));
          return qb;
        },
      }),
    },
  };
}

const config = { redis: { prefix: 'ally' } };

describe('GuideEventBusService', () => {
  it('stores durable events with a monotonic seq and delivers them live', async () => {
    const hub = fakeRedisHub();
    const db = fakeDataSource(4);
    const bus = new GuideEventBusService(
      db.dataSource as never,
      hub as never,
      config as never,
    );
    const received: GuideEvent[] = [];
    bus.subscribe('th1', (e) => received.push(e));
    await bus.ensureSubscribed();

    const first = await bus.appendDurable('th1', 'assistant.message', {
      messageId: 'm1',
      turnId: 'u1',
      text: 'Hi',
      channel: 'text',
    });
    const second = await bus.appendDurable('th1', 'spine.updated', {
      currentItemId: null,
      completedItems: 0,
      totalItems: 3,
    });

    expect([first.seq, second.seq]).toEqual([5, 6]);
    expect(first.durable).toBe(true);
    expect(db.inserted.map((r) => r.seq)).toEqual([5, 6]);
    expect(received.map((e) => e.type)).toEqual([
      'assistant.message',
      'spine.updated',
    ]);
  });

  it('refuses to store an ephemeral event', async () => {
    const bus = new GuideEventBusService(
      fakeDataSource().dataSource as never,
      fakeRedisHub() as never,
      config as never,
    );
    await expect(bus.appendDurable('th1', 'ping', {} as never)).rejects.toThrow(
      'ephemeral',
    );
  });

  it('publishes ephemeral events without storing them', async () => {
    const hub = fakeRedisHub();
    const db = fakeDataSource();
    const bus = new GuideEventBusService(
      db.dataSource as never,
      hub as never,
      config as never,
    );
    const received: GuideEvent[] = [];
    bus.subscribe('th1', (e) => received.push(e));
    await bus.ensureSubscribed();

    await bus.emitEphemeral('th1', 'presence', { state: 'thinking' }, 9);

    expect(db.inserted).toHaveLength(0);
    expect(received[0]).toMatchObject({
      type: 'presence',
      seq: 9,
      durable: false,
    });
  });

  it('only delivers a thread its own events, and stops after unsubscribe', async () => {
    const hub = fakeRedisHub();
    const bus = new GuideEventBusService(
      fakeDataSource().dataSource as never,
      hub as never,
      config as never,
    );
    const a: string[] = [];
    const b: string[] = [];
    const stopA = bus.subscribe('A', (e) => a.push(e.type));
    bus.subscribe('B', (e) => b.push(e.type));
    await bus.ensureSubscribed();

    await bus.emitEphemeral('A', 'ping', {}, 0);
    stopA();
    await bus.emitEphemeral('A', 'ping', {}, 0);
    await bus.emitEphemeral('B', 'ping', {}, 0);

    expect(a).toEqual(['ping']);
    expect(b).toEqual(['ping']);
  });

  it('replays durable events after a given seq', async () => {
    const db = fakeDataSource();
    const bus = new GuideEventBusService(
      db.dataSource as never,
      fakeRedisHub() as never,
      config as never,
    );
    for (let i = 0; i < 3; i++) {
      await bus.appendDurable('th1', 'card.updated', {
        cardId: 'c',
        state: 'done',
      });
    }
    const replayed = await bus.replay('th1', 1);
    expect(replayed.map((e) => e.seq)).toEqual([2, 3]);
  });
});

describe('GuideReplayGate', () => {
  const durable = (seq: number) => ({ seq, durable: true }) as GuideEvent;
  const ephemeral = (seq: number) => ({ seq, durable: false }) as GuideEvent;

  it('drops durable events already sent and passes newer ones', () => {
    const gate = new GuideReplayGate(5);
    expect(gate.accept(durable(4))).toBe(false);
    expect(gate.accept(durable(5))).toBe(false);
    expect(gate.accept(durable(6))).toBe(true);
    expect(gate.accept(durable(6))).toBe(false);
    expect(gate.lastSeq).toBe(6);
  });

  it('always passes ephemeral events', () => {
    const gate = new GuideReplayGate(5);
    expect(gate.accept(ephemeral(2))).toBe(true);
    expect(gate.lastSeq).toBe(5);
  });
});
