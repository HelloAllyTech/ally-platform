import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {FeedbackPopup} from '@/components/FeedbackPopup';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

jest.mock('@/components', () => {
  const React = require('react');
  const {Text} = require('react-native');
  return {
    StarRating: ({onRatingChange, testID}: any) => (
      <Text testID={testID} onPress={() => onRatingChange(4)}>
        star
      </Text>
    ),
    Button: ({onPress, label, testID}: any) => (
      <Text testID={testID} onPress={onPress}>
        {label}
      </Text>
    ),
    ChipGroup: () => <Text>chips</Text>,
  };
});

describe('FeedbackPopup', () => {
  it('submits rating and closes', () => {
    const onSubmit = jest.fn();
    const onClose = jest.fn();

    const {getByTestId, getByText} = render(
      <FeedbackPopup visible onSubmit={onSubmit} onClose={onClose} testID="fp" showChips={false} />,
    );

    // Set rating via stub
    fireEvent.press(getByTestId('fp-stars'));

    // Press submit button
    fireEvent.press(getByText('callFeedback.submit'));

    expect(onSubmit).toHaveBeenCalledWith({rating: 4, issues: [], comment: '', tags: []});
    expect(onClose).toHaveBeenCalled();
  });
});
