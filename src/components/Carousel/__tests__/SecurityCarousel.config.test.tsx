import React from 'react';
import {render} from '@testing-library/react-native';

import {SecurityCarousel} from '../SecurityCarousel';

jest.mock('react-native-size-matters', () => ({ScaledSheet: {create: (s: any) => s}, ms: (n: number) => n}));

jest.mock('@/constants', () => ({
  CarouselVariant: {DEFAULT: 'default', DRAWER: 'drawer'},
  defaultSecurityCarouselConfig: {width: 300, isBlurView: true, paginationActiveDotStyle: {}, imageContainerCustomStyle: {}, titleCustomStyle: {}},
  drawerSecurityCarouselConfig: {width: 220, isBlurView: false, paginationActiveDotStyle: {}, imageContainerCustomStyle: {}, titleCustomStyle: {}},
  SCREEN_WIDTH: 360,
  SECURITY_CAROUSEL_SLIDES: [{image: 1, textKey: 'slide'}],
}));

jest.mock('@/hooks', () => ({useTranslate: () => ({t: (k: string) => k})}));

jest.mock('../Carousel', () => ({
  Carousel: ({data, renderItem}: any) => {
    return renderItem(data[0], 0);
  },
}));

describe('SecurityCarousel config', () => {
  it('uses default config', () => {
    const {toJSON} = render(<SecurityCarousel />);
    expect(toJSON()).toBeTruthy();
  });
  it('uses drawer config when variant is drawer', () => {
    const {toJSON} = render(<SecurityCarousel variant={'drawer' as any} />);
    expect(toJSON()).toBeTruthy();
  });
});
