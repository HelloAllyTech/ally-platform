import React from 'react';
import {render, fireEvent} from '@testing-library/react-native';
import {TouchableOpacity} from 'react-native';

import {DismissableBanner} from '../DismissableBanner';

jest.mock('@/hooks', () => ({
  __esModule: true,
  useTranslate: () => ({ t: (k: string) => k }),
}));

describe('DismissableBanner', () => {
  it('renders text and triggers onClose', () => {
    const onClose = jest.fn();
    const {getByText, UNSAFE_getAllByType} = render(<DismissableBanner onClose={onClose} />);

    expect(getByText('listeningScreen.scribeStopTakingNotesBanner')).toBeTruthy();
    const touchables = UNSAFE_getAllByType(TouchableOpacity);
    // The second TouchableOpacity is the close button
    fireEvent.press(touchables[touchables.length - 1]);
    expect(onClose).toHaveBeenCalled();
  });
});


