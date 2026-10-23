import {formatSimulationKeyEvents} from '../simulationSummary';

describe('formatSimulationKeyEvents', () => {
  it('returns empty array when no summary or events', () => {
    expect(formatSimulationKeyEvents(null)).toEqual([]);
    expect(formatSimulationKeyEvents({} as any)).toEqual([]);
  });

  it('sorts by timestamp and maps fields correctly', () => {
    const summary: any = {
      createdAt: '2024-01-01T00:00:00Z',
      events: [
        {createdAt: '2024-01-01T00:00:10Z', events: {message: 'B', score: 2}},
        {createdAt: '2024-01-01T00:00:05Z', events: {message: 'A', score: 1}},
      ],
    };
    const res = formatSimulationKeyEvents(summary);
    expect(res[0].event).toBe('A');
    expect(res[1].event).toBe('B');
  });
});


