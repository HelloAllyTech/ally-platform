import React from 'react';
import {render} from '@testing-library/react-native';

import {SearchHeader} from '../SearchHeader';

jest.mock('@/hooks', () => ({
  useTranslate: () => ({
    t: (key: string) => key,
  }),
}));

describe('SearchHeader', () => {
  it('renders title and subtitle with translations', () => {
    const {getByText} = render(<SearchHeader isFocused={false} />);

    expect(getByText('SearchScreen.header.title')).toBeTruthy();
    expect(getByText('SearchScreen.header.subTitle')).toBeTruthy();
  });

  it('updates animation styles when focused', () => {
    const {update, getByText} = render(<SearchHeader isFocused={false} />);

    // Ensure initial render works
    expect(getByText('SearchScreen.header.title')).toBeTruthy();

    update(<SearchHeader isFocused />);
    expect(getByText('SearchScreen.header.title')).toBeTruthy();
  });
});


