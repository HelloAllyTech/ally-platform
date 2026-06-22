import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {SearchEmpty} from '../SearchEmpty';

jest.mock('@/hooks', () => ({
  useTranslate: () => ({
    t: (key: string) => key,
  }),
}));

describe('SearchEmpty', () => {
  const baseProps = {
    searchText: '',
    trySuggestions: [
      {id: 1, text: 'alpha'},
      {id: 2, text: 'beta'},
    ],
    colorTheme: 'light' as const,
    onPressSuggestion: jest.fn(),
  };

  it('renders try label and suggestions', () => {
    const {getByText} = render(<SearchEmpty {...baseProps} />);
    expect(getByText('search.suggestionsTitle')).toBeTruthy();
    expect(getByText('alpha')).toBeTruthy();
    expect(getByText('beta')).toBeTruthy();
  });

  it('renders no data text when searchText provided', () => {
    const {getByText} = render(
      <SearchEmpty {...baseProps} searchText="term" />,
    );
    expect(getByText('search.noResults "term"')).toBeTruthy();
  });

  it('calls onPressSuggestion with suggestion text', () => {
    const onPressSuggestion = jest.fn();
    const {getByText} = render(
      <SearchEmpty {...baseProps} onPressSuggestion={onPressSuggestion} />,
    );
    fireEvent.press(getByText('alpha'));
    expect(onPressSuggestion).toHaveBeenCalledWith('alpha');
  });
});
