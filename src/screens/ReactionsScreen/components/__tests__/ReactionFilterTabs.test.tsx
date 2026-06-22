import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {ReactionFilterTabs} from '../ReactionFilterTabs';
import type {ReactionFilterTabsProps} from '../../types';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'Reactions.allFilter' ? 'All' : key),
    i18n: {language: 'en'},
  }),
}));

const defaultProps: ReactionFilterTabsProps = {
  summary: [
    {reaction: '1f44d', count: 5, emoji: '👍'},
    {reaction: '2764-fe0f', count: 3, emoji: '❤️'},
  ],
  selectedReaction: null,
  totalCount: 8,
  onFilterChange: jest.fn(),
};

describe('ReactionFilterTabs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders without crashing', () => {
    const {toJSON} = render(<ReactionFilterTabs {...defaultProps} />);
    expect(toJSON()).not.toBeNull();
  });

  it('renders All tab with total count', () => {
    const {getByText} = render(<ReactionFilterTabs {...defaultProps} />);
    expect(getByText('achievements.filters.all 8')).toBeTruthy();
  });

  it('renders reaction tabs with counts', () => {
    const {getByText} = render(<ReactionFilterTabs {...defaultProps} />);
    expect(getByText('5')).toBeTruthy();
    expect(getByText('3')).toBeTruthy();
  });

  it('calls onFilterChange with null when All tab is pressed', () => {
    const onFilterChange = jest.fn();
    const {getByText} = render(
      <ReactionFilterTabs {...defaultProps} onFilterChange={onFilterChange} />,
    );
    fireEvent.press(getByText('achievements.filters.all 8'));
    expect(onFilterChange).toHaveBeenCalledWith(null);
  });

  it('calls onFilterChange with reaction when reaction tab is pressed', () => {
    const onFilterChange = jest.fn();
    const {getByText} = render(
      <ReactionFilterTabs {...defaultProps} onFilterChange={onFilterChange} />,
    );
    fireEvent.press(getByText('5'));
    expect(onFilterChange).toHaveBeenCalledWith('1f44d');
  });

  it('renders with empty summary', () => {
    const {getByText} = render(
      <ReactionFilterTabs
        summary={[]}
        selectedReaction={null}
        totalCount={0}
        onFilterChange={jest.fn()}
      />,
    );
    expect(getByText('achievements.filters.all 0')).toBeTruthy();
  });

  it('renders with selectedReaction set', () => {
    const {toJSON} = render(
      <ReactionFilterTabs
        {...defaultProps}
        selectedReaction="1f44d"
      />,
    );
    expect(toJSON()).not.toBeNull();
  });
});
