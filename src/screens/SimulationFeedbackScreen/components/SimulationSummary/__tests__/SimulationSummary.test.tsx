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

jest.mock('@/assets', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    HelpIcon: () => <View testID="help-icon" />,
    LightBulbIcon: () => <View testID="lightbulb-icon" />,
    ThumbUpIcon: () => <View testID="thumbup-icon" />,
    ArrowDown: () => <View testID="arrow-down" />,
  };
});

jest.mock('@/screens/SimulationPathDetailsScreen/components/SimulationDetailsModal', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    SimulationDetailsModal: ({visible}: any) =>
      visible ? <View testID="simulation-details-modal" /> : null,
  };
});

jest.mock('@/utils', () => ({
  formatDateTime: (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).replace(' at ', ' ');
  },
}));

describe('SimulationSummary', () => {
  const baseData = {
    id: 'test-id-123',
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
    expect(getByText('SimulationFeedback.sessionFeedback')).toBeTruthy();
    // Session id shows "ID: {metadata.sessionName ?? id}" (ally-web format)
    expect(getByText('ID: test-id-123')).toBeTruthy();
    expect(getByText(/Min/)).toBeTruthy();
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


