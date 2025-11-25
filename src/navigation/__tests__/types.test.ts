import type {RootStackParamList, TabParamList, RouteNames} from '../types';

describe('navigation types', () => {
  it('allows indexing route names union', () => {
    const name: RouteNames = 'CallLog';
    expect(typeof name).toBe('string');
  });

  it('RootStackParamList contains expected routes', () => {
    const params: RootStackParamList['SimulationAssistant'] = {
      sessionData: {} as any,
      scenario: undefined,
    };
    expect(params).toBeTruthy();
  });

  it('TabParamList has expected tabs', () => {
    const tab: keyof TabParamList = 'Search';
    expect(tab).toBe('Search');
  });
});


