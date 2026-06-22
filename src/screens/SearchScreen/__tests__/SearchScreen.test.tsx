import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';

import {SearchScreen} from '../SearchScreen';

jest.mock('@/hooks', () => ({
  useTabBackToHomeHandler: jest.fn(),
  useTranslate: () => ({
    t: (key: string) => key,
  }),
  useSearch: jest.fn().mockReturnValue({
    searchText: '',
    filteredSuggestions: [
      {id: 1, text: 'Violence safety plan'},
      {id: 2, text: 'Suicide assessment'},
      {id: 3, text: 'Survivors of abuse'},
      {id: 4, text: "Client's resistance"},
    ],
    focused: false,
    showSearchResults: false,
    onSearchFocus: jest.fn(),
    onSearchBlur: jest.fn(),
    handleSuggestionPress: jest.fn(),
    setShowSuggestions: jest.fn(),
    setFocused: jest.fn(),
    onChangeText: jest.fn(),
    handleEndReached: jest.fn(),
    onPressSuggestion: jest.fn(),
    lastSearchedText: '',
    resources: [],
    triggerSearchOnSubmit: jest.fn(),
    selectedCategory: 'all',
    showSuggestions: true,
    tabsMeta: [],
    activeTabIndex: 0,
    handleTabChange: jest.fn(),
    showInitialLoader: false,
    showFooterLoader: false,
    showEmptyState: false,
    resetSearch: jest.fn(),
  }),
}));

jest.mock('../components', () => {
  const React = require('react');
  const {Text} = require('react-native');
  return {
    SearchHeader: ({isFocused}: {isFocused: boolean}) => (
      <Text>{isFocused ? 'focused' : 'not-focused'}</Text>
    ),
    SearchInput: ({placeholder}: {placeholder: string}) => (
      <Text>{placeholder}</Text>
    ),
    SearchSuggestion: ({text}: {text: string}) => <Text>{text}</Text>,
    SearchEmpty: () => <Text>empty</Text>,
  };
});

// Also stub out '@/components' barrel to avoid native module imports such as NetworkLogger
jest.mock('@/components', () => ({
  CustomTabs: ({children}: any) => <>{children}</>,
  ResourceArticleCard: (props: any) => <>{props?.title || 'card'}</>,
}));

describe('SearchScreen', () => {
  it('renders launch view with header, input, and suggestions', () => {
    const {getByText} = render(<SearchScreen />);

    expect(getByText('not-focused')).toBeTruthy();
    expect(getByText('nav.tabs.search')).toBeTruthy();
    expect(getByText('search.suggestionsTitle')).toBeTruthy();
  });

  it('renders detail view with results list and tabs when showSearchResults=true', () => {
    // Override useSearch mock for this test
    const useSearch = require('@/hooks').useSearch as jest.Mock;
    useSearch.mockReturnValue({
      searchText: 'abc',
      filteredSuggestions: [],
      focused: true,
      showSearchResults: true,
      onSearchFocus: jest.fn(),
      onSearchBlur: jest.fn(),
      handleSuggestionPress: jest.fn(),
      setShowSuggestions: jest.fn(),
      setFocused: jest.fn(),
      onChangeText: jest.fn(),
      handleEndReached: jest.fn(),
      onPressSuggestion: jest.fn(),
      lastSearchedText: 'abc',
      resources: [{id: '1', title: 'res1'}],
      triggerSearchOnSubmit: jest.fn(),
      selectedCategory: 'all',
      showSuggestions: false,
      tabsMeta: [{id: 'all', title: 'All'}],
      activeTabIndex: 0,
      handleTabChange: jest.fn(),
      showInitialLoader: false,
      showFooterLoader: false,
      showEmptyState: false,
      resetSearch: jest.fn(),
    });

    const {getByText, queryByText} = render(<SearchScreen />);
    // Title replaced by mocked header; ensure suggestions header not present
    expect(queryByText('search.suggestionsTitle')).toBeNull();
    // Search input still exists via placeholder text
    expect(getByText('nav.tabs.search')).toBeTruthy();
  });
});


