import React from 'react';
import {render, fireEvent} from '@testing-library/react-native';

import {SimulationSummary} from '../SimulationSummary';

jest.mock('@/hooks', () => ({
  useTranslate: () => ({
    t: (key: string, vars?: any) => (vars ? `${key}:${JSON.stringify(vars)}` : key),
  }),
}));

jest.mock('../../../utils/simulationSummary', () => ({
  formatSimulationKeyEvents: (data: any) => data?.events || [],
}));

describe('SimulationSummary', () => {
  const baseData = {
    startedAt: '2024-01-01T00:00:00Z',
    endedAt: '2024-01-01T00:01:30Z',
    score: 42,
    scenario: {title: 'Scenario Title'},
    events: [{time: '00:10', event: 'Evt', score: 1}],
    details: {
      summary: {
        feedback: {positives: ['Good'], improvements: ['Better']},
      },
    },
  };

  it('renders title, duration and score', () => {
    const {getByText} = render(<SimulationSummary data={baseData as any} />);
    expect(getByText('Scenario Title')).toBeTruthy();
    expect(getByText('SimulationFeedback.sessionDuration')).toBeTruthy();
    expect(getByText(/mins/)).toBeTruthy();
    expect(getByText(/SimulationFeedback.benchmark/)).toBeTruthy();
  });

  it('toggles sections with view more/view less', () => {
    const data = {
      ...baseData,
      events: Array.from({length: 5}).map((_, i) => ({time: `00:0${i}`, event: `E${i}`, score: i})),
      details: {summary: {feedback: {positives: ['a','b','c','d'], improvements: ['x','y','z','w']}}},
    };
    const {getAllByText} = render(<SimulationSummary data={data as any} />);
    const viewMoreButtons = getAllByText('Common.viewMore');
    fireEvent.press(viewMoreButtons[0]);
  });
});


