import type {Scenario, SessionData} from '../simulations';

describe('types/simulations', () => {
  it('accepts basic Scenario and SessionData shapes', () => {
    const scenario: Scenario = {id: '1', title: 't', description: 'd'} as any;
    const session: SessionData = {id: 'r1', createdAt: 'now', accessToken: 't', liveKitServerUrl: 'u'} as any;
    expect(scenario.id).toBe('1');
    expect(session.accessToken).toBe('t');
  });
});
