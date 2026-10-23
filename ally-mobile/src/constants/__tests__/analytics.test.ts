import {AnalyticsType} from '../analytics';

describe('constants/analytics', () => {
  it('enum AnalyticsType has expected values', () => {
    expect(AnalyticsType.CALL_LOG_ANALYTICS).toBe('CALL_LOG_ANALYTICS');
    expect(AnalyticsType.SIMULATION_ANALYTICS).toBe('SIMULATION_ANALYTICS');
  });
});
