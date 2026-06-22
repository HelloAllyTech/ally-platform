import React from 'react';
import {render} from '@testing-library/react-native';

import {ReviewTypeChip} from '../ReviewTypeChip';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: {reviewType?: string}) =>
      key === 'review.feedCard.reviewType' && options?.reviewType
        ? options.reviewType
        : key,
  }),
}));

jest.mock('@/utils', () => ({
  capitalizeFirstLetter: (str: string) =>
    str.charAt(0).toUpperCase() + str.slice(1).toLowerCase(),
}));

describe('ReviewTypeChip', () => {
  it('renders simulation type label', () => {
    const {getByText} = render(
      <ReviewTypeChip reviewType="simulation" />,
    );
    expect(getByText('Simulation')).toBeTruthy();
  });

  it('renders scribe type label', () => {
    const {getByText} = render(
      <ReviewTypeChip reviewType="scribe" />,
    );
    expect(getByText('Scribe')).toBeTruthy();
  });

  it('uses translation with capitalized review type', () => {
    const {getByText} = render(
      <ReviewTypeChip reviewType="simulation" />,
    );
    expect(getByText('Simulation')).toBeTruthy();
  });

  it('renders without crashing for scribe', () => {
    const {toJSON} = render(
      <ReviewTypeChip reviewType="scribe" />,
    );
    expect(toJSON()).not.toBeNull();
  });
});
