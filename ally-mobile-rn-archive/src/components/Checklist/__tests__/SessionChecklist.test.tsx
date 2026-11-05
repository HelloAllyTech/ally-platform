import React from 'react';
import {render} from '@testing-library/react-native';

import {
  SessionChecklist,
  type SessionChecklistItem,
  type SessionChecklistProps,
} from '../SessionChecklist';

jest.mock('@/hooks', () => ({
  useTranslate: () => ({t: (key: string) => key}),
}));

jest.mock('@/utils', () => ({
  formatAsPercentage: (value: number) => `${Math.round(value * 100)}%`,
}));

jest.mock('@/assets', () => ({
  CancelIcon: 'CancelIcon',
  CheckCircleIcon: 'CheckCircleIcon',
}));

jest.mock('../../LearningPathDetails', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    ProgressBar: () => React.createElement(View, {testID: 'progress-bar'}),
  };
});

const mockItems: SessionChecklistItem[] = [
  {id: '1', name: 'Complete introduction', completed: true},
  {id: '2', name: 'Review feedback', completed: false},
  {id: '3', name: 'Share results', completed: true},
];

describe('SessionChecklist', () => {
  it('returns null when items array is empty', () => {
    const {toJSON} = render(
      <SessionChecklist items={[]} />,
    );
    expect(toJSON()).toBeNull();
  });

  it('renders header with checklist title and percentage', () => {
    const {getByText} = render(
      <SessionChecklist items={mockItems} />,
    );
    expect(getByText('learn.evaluationChecklist')).toBeTruthy();
    expect(getByText('67%')).toBeTruthy();
  });

  it('renders progress bar', () => {
    const {getByTestId} = render(
      <SessionChecklist items={mockItems} />,
    );
    expect(getByTestId('progress-bar')).toBeTruthy();
  });

  it('renders all checklist items with names', () => {
    const {getByText} = render(
      <SessionChecklist items={mockItems} />,
    );
    expect(getByText('Complete introduction')).toBeTruthy();
    expect(getByText('Review feedback')).toBeTruthy();
    expect(getByText('Share results')).toBeTruthy();
  });

  it('shows 100% when all items are completed', () => {
    const allCompleted: SessionChecklistItem[] = [
      {id: '1', name: 'Task 1', completed: true},
      {id: '2', name: 'Task 2', completed: true},
    ];
    const {getByText} = render(
      <SessionChecklist items={allCompleted} />,
    );
    expect(getByText('100%')).toBeTruthy();
  });

  it('shows 0% when no items are completed', () => {
    const noneCompleted: SessionChecklistItem[] = [
      {id: '1', name: 'Task 1', completed: false},
      {id: '2', name: 'Task 2', completed: false},
    ];
    const {getByText} = render(
      <SessionChecklist items={noneCompleted} />,
    );
    expect(getByText('0%')).toBeTruthy();
  });
});
