import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {StarRating} from '@/components/StarRating';

jest.mock('@/assets', () => ({
  StarIcon: ({color}: {color: string}) => <MockStar color={color} />,
}));

const MockStar = ({color}: {color: string}) => {
  return <MockStarInner testID={`star-${color}`} />;
};

const MockStarInner = ({...props}) => <></>;

describe('StarRating', () => {
  it('renders five stars and updates rating on press', () => {
    let current = 0;
    const onRatingChange = (r: number) => (current = r);

    const {getByTestId} = render(
      <StarRating rating={current} onRatingChange={onRatingChange} testID="rating" />,
    );

    // Press third star
    fireEvent.press(getByTestId('rating-star-3'));
    expect(current).toBe(3);

    // Press fifth star
    fireEvent.press(getByTestId('rating-star-5'));
    expect(current).toBe(5);
  });
});
