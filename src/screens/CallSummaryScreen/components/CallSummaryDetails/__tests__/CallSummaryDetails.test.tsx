import React from 'react';
import {render, fireEvent} from '@testing-library/react-native';
import {ActivityIndicator, Text} from 'react-native';

import {CallSummaryDetails} from '../CallSummaryDetails';

// Prevent circular import of store -> api during tests
jest.mock('@/services/api', () => ({
  api: {
    reducerPath: 'api',
    reducer: (state: any = {}) => state,
    middleware: () => (next: any) => (action: any) => next(action),
  },
}));

// Avoid importing real callSummaryApi from components used by CallSummaryDetails
jest.mock('@/services/callSummaryApi', () => ({
  useEnhanceCallSummaryMutation: () => [jest.fn(), {isLoading: false, data: undefined}],
}));

jest.mock('@/assets', () => ({
  GoldenShieldIcon: () => null,
}));

jest.mock('@/components', () => {
  const React = require('react');
  const {Text} = require('react-native');
  return {
    PrimaryButton: ({label, onPress}: any) => (
      <Text onPress={onPress}>{label}</Text>
    ),
  };
});

const mockHandleSubmit = jest.fn().mockResolvedValue({data: {}});

jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (k: string) => k}),
  useCallSummaryForm: () => ({isUpdating: false, handleSubmit: mockHandleSubmit}),
}));

jest.mock('@/store/hooks', () => ({
  useAppSelector: (sel: any) => sel({ summary: { summaryData: {} } }),
}));

jest.mock('@/store/slices/summarySlice', () => ({
  selectSummaryVisibleFields: () => [],
}));

jest.mock('@/constants', () => ({
  ALWAYS_VISIBLE_SECTIONS: [],
  SECTION_LIST: [],
  summaryFields: [],
}));

describe('CallSummaryScreen/CallSummaryDetails', () => {
  it('renders warning text and save button when showSaveButton=true', () => {
    const onSubmit = jest.fn();
    const {getByText} = render(
      <CallSummaryDetails isLoading={false} onSubmit={onSubmit} showSaveButton />,
    );

    expect(getByText('CallSummary.aiGeneratedWarning')).toBeTruthy();
    expect(getByText('save')).toBeTruthy();
  });

  it('shows loader when isLoading=true', () => {
    const {UNSAFE_getAllByType} = render(
      <CallSummaryDetails isLoading onSubmit={jest.fn()} showSaveButton />,
    );
    expect(UNSAFE_getAllByType(ActivityIndicator).length).toBeGreaterThan(0);
  });

  it('invokes handleSubmit and onSubmit(true) on save press', async () => {
    const onSubmit = jest.fn();
    const {getByText, findByText} = render(
      <CallSummaryDetails isLoading={false} onSubmit={onSubmit} showSaveButton />,
    );

    fireEvent.press(getByText('save'));
    // ensure handleSubmit awaited and onSubmit called with true (data exists)
    await findByText('save');
    expect(mockHandleSubmit).toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledWith(true);
  });
});


