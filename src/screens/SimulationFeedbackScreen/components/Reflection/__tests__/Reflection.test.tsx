import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {Reflection} from '../Reflection';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (key: string) => key}),
}));

jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (key: string) => key}),
}));

jest.mock('@/components', () => {
  const React = require('react');
  const {View, TextInput} = require('react-native');
  return {
    useErrorToast: () => ({showErrorToast: jest.fn()}),
  };
});

const mockUseGetReflectionPromptsQuery = jest.fn();
const mockUseUpdateReflectionPromptMutation = jest.fn(() => [
  jest.fn().mockResolvedValue({}),
]);

jest.mock('@/services', () => ({
  useGetReflectionPromptsQuery: (args: unknown) =>
    mockUseGetReflectionPromptsQuery(args),
  useUpdateReflectionPromptMutation: () =>
    mockUseUpdateReflectionPromptMutation(),
}));

const defaultProps = {
  scenarioSessionId: 'session-1',
};

const mockPrompts = [
  {
    id: 'prompt-1',
    scenarioSessionId: 'session-1',
    promptId: 'p1',
    prompt: 'What went well?',
    response: '',
  },
  {
    id: 'prompt-2',
    scenarioSessionId: 'session-1',
    promptId: 'p2',
    prompt: 'What would you improve?',
    response: 'Practice more',
  },
];

describe('Reflection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockUseGetReflectionPromptsQuery.mockReturnValue({
      data: {reflectionPrompts: mockPrompts},
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders without crashing', () => {
    const {getByText} = render(<Reflection {...defaultProps} />);
    expect(getByText('reflection.sectionTitle')).toBeTruthy();
  });

  it('renders prompts with numbered badges', () => {
    const {getByText} = render(<Reflection {...defaultProps} />);
    expect(getByText('1')).toBeTruthy();
    expect(getByText('2')).toBeTruthy();
    expect(getByText('What went well?')).toBeTruthy();
    expect(getByText('What would you improve?')).toBeTruthy();
  });

  it('shows empty text when no prompts', () => {
    mockUseGetReflectionPromptsQuery.mockReturnValue({
      data: {reflectionPrompts: []},
    });

    const {getByText} = render(<Reflection {...defaultProps} />);
    expect(getByText('reflection.noPrompts')).toBeTruthy();
  });

  it('renders text inputs for each prompt', () => {
    const {getAllByPlaceholderText} = render(
      <Reflection {...defaultProps} />,
    );
    const inputs = getAllByPlaceholderText(
      'reflection.writeThoughts',
    );
    expect(inputs).toHaveLength(2);
  });
});
