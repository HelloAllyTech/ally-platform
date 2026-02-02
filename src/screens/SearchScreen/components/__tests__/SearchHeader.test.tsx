import React from 'react';
import {render} from '@testing-library/react-native';

import {SearchHeader} from '../SearchHeader';

jest.mock('@/hooks', () => ({
  useTranslate: () => ({
    t: (key: string) => key,
  }),
  useTabScreenHeader: () => ({
    showHamburger: false,
    handleOpenDrawer: jest.fn(),
  }),
}));

describe('SearchHeader', () => {
  it('renders title and subtitle with translations', () => {
    const {getByText} = render(<SearchHeader isFocused={false} />);
    expect(getByText('SearchScreen.header.subTitle')).toBeTruthy();
  });

  it('updates animation styles when focused', () => {
    const {update} = render(<SearchHeader isFocused={false} />);

    update(<SearchHeader isFocused />);
  });
});


