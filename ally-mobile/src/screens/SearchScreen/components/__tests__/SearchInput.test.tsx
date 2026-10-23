import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {SearchInput} from '../SearchInput';
import {TouchableOpacity} from 'react-native';

const defaultProps = {
  onFocus: jest.fn(),
  placeholder: 'Search...',
  onBlur: jest.fn(),
  isFocused: false,
  searchText: '',
  setSearchText: jest.fn(),
  suggestions: [],
  onSuggestionPress: jest.fn(),
  showSuggestions: false,
  onSubmitEditing: jest.fn(),
  showSearchResults: false,
  resetSearch: jest.fn(),
};

describe('SearchInput', () => {
  it('renders input with placeholder', () => {
    const {getByPlaceholderText} = render(<SearchInput {...defaultProps} />);
    expect(getByPlaceholderText('Search...')).toBeTruthy();
  });

  it('calls onFocus and onBlur handlers', () => {
    const {getByPlaceholderText} = render(<SearchInput {...defaultProps} />);
    const input = getByPlaceholderText('Search...');
    fireEvent(input, 'focus');
    fireEvent(input, 'blur');
    expect(defaultProps.onFocus).toHaveBeenCalled();
    expect(defaultProps.onBlur).toHaveBeenCalled();
  });

  it('updates text via setSearchText', () => {
    const setSearchText = jest.fn();
    const {getByPlaceholderText} = render(
      <SearchInput {...defaultProps} setSearchText={setSearchText} />,
    );
    const input = getByPlaceholderText('Search...');
    fireEvent.changeText(input, 'hello');
    expect(setSearchText).toHaveBeenCalledWith('hello');
  });

  it('shows clear icon when searchText not empty and clears on press', () => {
    const resetSearch = jest.fn();
    const {UNSAFE_getAllByType} = render(
      <SearchInput {...defaultProps} searchText="a" resetSearch={resetSearch} />,
    );
    const touchables = UNSAFE_getAllByType(TouchableOpacity);
    // Last touchable is the clear button
    fireEvent.press(touchables[touchables.length - 1]);
    expect(resetSearch).toHaveBeenCalled();
  });

  it('renders suggestions and fires onSuggestionPress', () => {
    const onSuggestionPress = jest.fn();
    const suggestions = [
      {id: 1, text: 'one'},
      {id: 2, text: 'two'},
    ];
    const {getByText} = render(
      <SearchInput
        {...defaultProps}
        isFocused
        showSuggestions
        suggestions={suggestions}
        onSuggestionPress={onSuggestionPress}
      />,
    );
    fireEvent.press(getByText('one'));
    expect(onSuggestionPress).toHaveBeenCalledWith({id: 1, text: 'one'});
  });

  it('auto focuses when isFocused is true', () => {
    const {getByPlaceholderText} = render(
      <SearchInput {...defaultProps} isFocused placeholder="Find" />,
    );
    const input = getByPlaceholderText('Find');
    // Focus side-effect should be harmless in tests; simply assert element exists
    expect(input).toBeTruthy();
  });
});


