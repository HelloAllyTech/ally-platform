import React from 'react';
import {render} from '@testing-library/react-native';
import {Text} from 'react-native';

import {SecurityCarousel} from '@/components/Carousel/SecurityCarousel';

jest.mock('@/components/Carousel/Carousel', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    Carousel: ({data, renderItem, onSnapToItem}: any) => {
      React.useEffect(() => onSnapToItem && onSnapToItem(0), [onSnapToItem]);
      return React.createElement(
        View,
        null,
        data && data.length > 0 ? renderItem(data[0], 0) : null,
      );
    },
  };
});

jest.mock('@/hooks', () => ({
  useTranslate: () => ({ t: (k: string) => k }),
}));

jest.mock('@/constants', () => ({
  CarouselVariant: { DEFAULT: 'DEFAULT', DRAWER: 'DRAWER' },
  defaultSecurityCarouselConfig: { width: 300 },
  drawerSecurityCarouselConfig: { width: 250 },
  SECURITY_CAROUSEL_SLIDES: [
    { image: 1, textKey: 'slide1' },
    { image: 2, textKey: 'slide2' },
  ],
}));

describe('SecurityCarousel', () => {
  it('renders slide text with default variant', () => {
    const {getByText} = render(<SecurityCarousel />);
    expect(getByText('slide1')).toBeTruthy();
  });
});
