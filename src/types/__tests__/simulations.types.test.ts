import type {Scenario, RoomData} from '../simulations';

describe('types/simulations', () => {
  it('accepts basic Scenario and RoomData shapes', () => {
    const scenario: Scenario = {id: '1', title: 't', description: 'd'} as any;
    const room: RoomData = {id: 'r1', createdAt: 'now', accessToken: 't', liveKitServerUrl: 'u'} as any;
    expect(scenario.id).toBe('1');
    expect(room.accessToken).toBe('t');
  });
});
