import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {ReactionsCount} from '../ReactionsCount';

const mockNavigate = jest.fn();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'Review.card.reaction' ? 'reaction' : key),
    i18n: {language: 'en'},
  }),
}));

jest.mock('@/hooks', () => ({
  useAppNavigation: () => ({
    navigate: mockNavigate,
  }),
}));

jest.mock('@/components/EmojiPicker', () => ({
  EMOJI_UNICODE_MAP: {
    '1f44d': '👍',
    '2764-fe0f': '❤️',
  },
}));

jest.mock('@/constants', () => ({
  SCREEN_NAMES: {
    REACTIONS: 'Reactions',
  },
}));

jest.mock('@/utils', () => ({
  pluralize: (count: number, singular: string) =>
    count === 1 ? `1 ${singular}` : `${count} ${singular}s`,
}));

jest.mock('@/utils/reviews', () => ({
  getTopReactions: (reactions: Record<string, number>, limit?: number) =>
    Object.entries(reactions)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .map(([code]) => code)
      .slice(0, limit ?? 3),
}));

const defaultProps = {
  reviewId: 'review-123',
  reactions: {'1f44d': 5, '2764-fe0f': 3},
  totalReactions: 8,
};

describe('ReactionsCount', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders without crashing', () => {
    const {toJSON} = render(<ReactionsCount {...defaultProps} />);
    expect(toJSON()).not.toBeNull();
  });

  it('renders total reactions text', () => {
    const {getByText} = render(<ReactionsCount {...defaultProps} />);
    expect(getByText('8 review.feedCard.reactionss')).toBeTruthy();
  });

  it('renders singular when totalReactions is 1', () => {
    const {getByText} = render(
      <ReactionsCount
        reviewId="r1"
        reactions={{'1f44d': 1}}
        totalReactions={1}
      />,
    );
    expect(getByText('1 review.feedCard.reactions')).toBeTruthy();
  });

  it('calls navigate to REACTIONS screen when pressed', () => {
    const {getByText} = render(<ReactionsCount {...defaultProps} />);
    fireEvent.press(getByText('8 review.feedCard.reactionss'));
    expect(mockNavigate).toHaveBeenCalledWith('Reactions', {
      reviewId: 'review-123',
    });
  });

  it('renders with empty reactions object', () => {
    const {getByText} = render(
      <ReactionsCount
        reviewId="r1"
        reactions={{}}
        totalReactions={0}
      />,
    );
    expect(getByText('0 review.feedCard.reactionss')).toBeTruthy();
  });

  it('uses default totalReactions of 0 when not provided', () => {
    const {getByText} = render(
      <ReactionsCount reviewId="r1" reactions={{}} totalReactions={0} />,
    );
    expect(getByText('0 review.feedCard.reactionss')).toBeTruthy();
  });
});
