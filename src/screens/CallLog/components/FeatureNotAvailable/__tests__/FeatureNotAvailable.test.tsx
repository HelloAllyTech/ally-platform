import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {FeatureNotAvailable} from '@/screens/CallLog/components/FeatureNotAvailable/FeatureNotAvailable';

jest.mock('@/hooks', () => ({
  useTranslate: () => ({ t: (k: string) => k }),
}));

jest.mock('@/constants/general', () => ({ DEFAULT_HIT_SLOP: {} }));

describe('FeatureNotAvailable', () => {
  it('renders description and title fallback', () => {
    const {getByText} = render(
      <FeatureNotAvailable description="desc" />,
    );
    expect(getByText('audioCall.error.oops')).toBeTruthy();
    expect(getByText('desc')).toBeTruthy();
  });

  it('renders CTA and handles press', () => {
    const onCtaPress = jest.fn();
    const {getByText} = render(
      <FeatureNotAvailable description="desc" ctaText="More" onCtaPress={onCtaPress} />,
    );
    fireEvent.press(getByText('More'));
    expect(onCtaPress).toHaveBeenCalled();
  });
});
