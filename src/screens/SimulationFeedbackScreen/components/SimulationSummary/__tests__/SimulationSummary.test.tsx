import React from 'react';
import {render} from '@testing-library/react-native';

jest.mock('@/hooks', () => ({
  useTranslate: () => ({
    t: (key: string, vars?: any) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key,
  }),
}));

jest.mock('../../EventChecklist', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    EventChecklist: () => <View testID="event-checklist" />,
  };
});

jest.mock('../../ExpandableFeedbackSection', () => {
  const React = require('react');
  const {View, Text} = require('react-native');
  return {
    ExpandableFeedbackSection: ({title}: any) => (
      <View testID="expandable-feedback-section">
        <Text>{title}</Text>
      </View>
    ),
  };
});

jest.mock('@/assets', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    HelpIcon: () => <View testID="help-icon" />,
    ArrowDown: () => <View testID="arrow-down" />,
  };
});

jest.mock(
  '@/screens/SimulationPathDetailsScreen/components/SimulationDetailsModal',
  () => {
    const React = require('react');
    const {View} = require('react-native');
    return {
      SimulationDetailsModal: ({visible}: any) =>
        visible ? <View testID="simulation-details-modal" /> : null,
    };
  },
);

jest.mock('@/utils', () => ({
  formatDateTime: (dateString: string) => {
    const date = new Date(dateString);
    return date
      .toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })
      .replace(' at ', ' ');
  },
  isShortSession: () => false,
}));

import {SimulationSummary} from '../SimulationSummary';

describe('SimulationSummary', () => {
  const baseData = {
    id: 'test-id-123',
    startedAt: '2024-01-01T00:00:00Z',
    endedAt: '2024-01-01T00:01:30Z',
    score: 42,
    scenario: {title: 'Scenario Title'},
  };

  it('renders title, duration and score', () => {
    const {getByText} = render(
      <SimulationSummary data={baseData as any} />,
    );
    expect(getByText('Scenario Title')).toBeTruthy();
    expect(getByText('SimulationFeedback.sessionFeedback')).toBeTruthy();
    expect(getByText('ID: test-id-123')).toBeTruthy();
    expect(getByText(/Min/)).toBeTruthy();
  });

  it('hides EventChecklist and feedback sections when experienceMode is NONE', () => {
    const noneData = {
      ...baseData,
      scenario: {
        ...baseData.scenario,
        metadata: {experienceMode: 'NONE'},
      },
    };
    const {getByText, queryByTestId} = render(
      <SimulationSummary
        data={noneData as any}
        positives={['p1']}
        improvements={['i1']}
      />,
    );
    expect(getByText('Scenario Title')).toBeTruthy();
    expect(getByText('ID: test-id-123')).toBeTruthy();
    expect(queryByTestId('event-checklist')).toBeNull();
    expect(queryByTestId('expandable-feedback-section')).toBeNull();
  });
});
