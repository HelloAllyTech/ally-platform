import { RoadmapGateway } from '../roadmap.gateway';
import { RoadmapEvents } from '../../enum/roadmap-events.enum';
import { RoadmapEvent } from '../../type/roadmap-event.type';

/** Roadmap v2's idea rooms, presence relay and item-changed fan-out (§4.12, §5.7b). */
function build(enabled = true) {
  let listener: ((event: RoadmapEvent) => void) | undefined;
  const notifications = {
    addListener: jest.fn((fn) => (listener = fn)),
    removeListener: jest.fn(),
  };
  const planSettings = {
    getRoadmapV2: jest.fn(async () => ({ enabled })),
  };
  const dataSource = {
    query: jest.fn(async () => [{ name: 'Ana' }]),
  };
  const gateway = new RoadmapGateway(
    { webSocketMiddleware: jest.fn(() => jest.fn()) } as never,
    notifications as never,
    { list: jest.fn() } as never,
    planSettings as never,
    dataSource as never,
  );
  const emitted: { rooms: string[]; event: string; payload: unknown }[] = [];
  const server = {
    use: jest.fn(),
    to(room: string) {
      const rooms = [room];
      const chain = {
        to(next: string) {
          rooms.push(next);
          return chain;
        },
        emit(event: string, payload: unknown) {
          emitted.push({ rooms, event, payload });
        },
      };
      return chain;
    },
  };
  gateway.server = server as never;
  gateway.afterInit(server);
  const relayed: { room: string; event: string; payload: any }[] = [];
  const client = {
    data: { user: { id: 7, username: 'ana@example.org' } } as Record<
      string,
      any
    >,
    join: jest.fn(async () => undefined),
    leave: jest.fn(async () => undefined),
    to: (room: string) => ({
      emit: (event: string, payload: unknown) =>
        relayed.push({ room, event, payload }),
    }),
  };
  return {
    gateway,
    client,
    relayed,
    emitted,
    planSettings,
    dataSource,
    fire: (event: RoadmapEvent) => listener?.(event),
  };
}

describe('RoadmapGateway (Roadmap v2)', () => {
  it('relays presence to the idea room, by name, never the username', async () => {
    const { gateway, client, relayed } = build();
    await gateway.handlePresence(client, {
      code: 'opp-0388',
      kind: 'typing',
      questionId: 'q1',
    });
    expect(client.join).toHaveBeenCalledWith('roadmap:item:OPP-0388');
    expect(relayed).toHaveLength(1);
    expect(relayed[0]).toMatchObject({
      room: 'roadmap:item:OPP-0388',
      event: RoadmapEvents.PRESENCE,
      payload: {
        code: 'OPP-0388',
        userId: 7,
        name: 'Ana',
        kind: 'typing',
        questionId: 'q1',
      },
    });
    expect(JSON.stringify(relayed)).not.toContain('example.org');
  });

  it('reads the name once per socket and the flag once per window', async () => {
    const { gateway, client, dataSource, planSettings } = build();
    await gateway.handlePresence(client, { code: 'OPP-1', kind: 'viewing' });
    await gateway.handlePresence(client, { code: 'OPP-1', kind: 'viewing' });
    expect(dataSource.query).toHaveBeenCalledTimes(1);
    expect(planSettings.getRoadmapV2).toHaveBeenCalledTimes(1);
  });

  it('ignores presence and joins while roadmap_v2 is off, and junk payloads always', async () => {
    const off = build(false);
    await off.gateway.handlePresence(off.client, {
      code: 'OPP-1',
      kind: 'viewing',
    });
    await off.gateway.handleJoinItem(off.client, { code: 'OPP-1' });
    expect(off.relayed).toEqual([]);
    expect(off.client.join).not.toHaveBeenCalled();

    const on = build();
    await on.gateway.handlePresence(on.client, {
      code: 'DROP TABLE',
      kind: 'viewing',
    });
    await on.gateway.handlePresence(on.client, {
      code: 'OPP-1',
      kind: 'shouting',
    });
    expect(on.relayed).toEqual([]);
  });

  it('fans item-changed out to the board and the idea room, names only', () => {
    const { fire, emitted } = build();
    fire({
      kind: 'ITEM_CHANGED',
      actorId: 3,
      code: 'OPP-0388',
      fields: ['title'],
    });
    expect(emitted).toEqual([
      {
        rooms: ['roadmap:board', 'roadmap:item:OPP-0388'],
        event: 'roadmap:item-changed',
        payload: { code: 'OPP-0388', fields: ['title'], actorId: 3 },
      },
    ]);
  });
});
