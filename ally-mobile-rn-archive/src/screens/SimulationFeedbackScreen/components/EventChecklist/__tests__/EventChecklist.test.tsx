import React from 'react';
import {render} from '@testing-library/react-native';

import {EventChecklist} from '../EventChecklist';

jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (key: string) => key}),
}));

jest.mock('@/assets', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    CheckCircleIcon: (props: any) =>
      React.createElement(View, {...props, testID: 'check-circle-icon'}),
    CancelIcon: (props: any) =>
      React.createElement(View, {...props, testID: 'cancel-icon'}),
  };
});

const mockUseGetEventChecklistQuery = jest.fn();
jest.mock('@/services', () => ({
  useGetEventChecklistQuery: (args: any) => mockUseGetEventChecklistQuery(args),
}));

describe('EventChecklist', () => {
  const scenarioSessionId = 'session-123';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows loading indicator when loading', () => {
    mockUseGetEventChecklistQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
    });

    const {UNSAFE_getByType} = render(
      <EventChecklist scenarioSessionId={scenarioSessionId} />,
    );

    const {ActivityIndicator} = require('react-native');
    expect(UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
  });

  it('returns null when no items', () => {
    mockUseGetEventChecklistQuery.mockReturnValue({
      data: {eventChecklist: []},
      isLoading: false,
    });

    const {queryByText} = render(
      <EventChecklist scenarioSessionId={scenarioSessionId} />,
    );

    expect(queryByText('learn.evaluationChecklist')).toBeNull();
  });

  it('returns null when data is undefined', () => {
    mockUseGetEventChecklistQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
    });

    const {queryByText} = render(
      <EventChecklist scenarioSessionId={scenarioSessionId} />,
    );

    expect(queryByText('learn.evaluationChecklist')).toBeNull();
  });

  it('renders completed items with check icon', () => {
    mockUseGetEventChecklistQuery.mockReturnValue({
      data: {
        eventChecklist: [
          {id: '1', name: 'Item 1', hasOccurred: true},
          {id: '2', name: 'Item 2', hasOccurred: true},
        ],
      },
      isLoading: false,
    });

    const {getAllByTestId, getByText} = render(
      <EventChecklist scenarioSessionId={scenarioSessionId} />,
    );

    const checkIcons = getAllByTestId('check-circle-icon');
    expect(checkIcons).toHaveLength(2);
    expect(getByText('Item 1')).toBeTruthy();
    expect(getByText('Item 2')).toBeTruthy();
  });

  it('renders incomplete items with cancel icon', () => {
    mockUseGetEventChecklistQuery.mockReturnValue({
      data: {
        eventChecklist: [
          {id: '1', name: 'Incomplete Item', hasOccurred: false},
        ],
      },
      isLoading: false,
    });

    const {getByTestId, getByText} = render(
      <EventChecklist scenarioSessionId={scenarioSessionId} />,
    );

    expect(getByTestId('cancel-icon')).toBeTruthy();
    expect(getByText('Incomplete Item')).toBeTruthy();
  });

  it('renders header text', () => {
    mockUseGetEventChecklistQuery.mockReturnValue({
      data: {
        eventChecklist: [{id: '1', name: 'Test', hasOccurred: true}],
      },
      isLoading: false,
    });

    const {getByText} = render(
      <EventChecklist scenarioSessionId={scenarioSessionId} />,
    );

    expect(getByText('learn.evaluationChecklist')).toBeTruthy();
  });

  it('renders mixed completed and incomplete items', () => {
    mockUseGetEventChecklistQuery.mockReturnValue({
      data: {
        eventChecklist: [
          {id: '1', name: 'Done', hasOccurred: true},
          {id: '2', name: 'Pending', hasOccurred: false},
        ],
      },
      isLoading: false,
    });

    const {getAllByTestId, getByText} = render(
      <EventChecklist scenarioSessionId={scenarioSessionId} />,
    );

    expect(getAllByTestId('check-circle-icon')).toHaveLength(1);
    expect(getAllByTestId('cancel-icon')).toHaveLength(1);
    expect(getByText('Done')).toBeTruthy();
    expect(getByText('Pending')).toBeTruthy();
  });
});
