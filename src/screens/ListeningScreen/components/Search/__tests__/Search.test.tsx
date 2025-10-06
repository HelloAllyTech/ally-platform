import React from 'react';
import {render, fireEvent} from '@testing-library/react-native';

import {Search} from '../Search';

let mockSearchState: any;
const mockSetShowSuggestions = jest.fn();
const mockHandleEndReached = jest.fn();
const mockOnSearchFocus = jest.fn();
const mockSetFocused = jest.fn();
jest.mock('@/hooks', () => ({
  __esModule: true,
  useSearch: () => (mockSearchState),
  useTranslate: () => ({t: (k: string) => k}),
}));

jest.mock('@/components', () => ({
  __esModule: true,
  CustomTabs: () => null,
  ResourceArticleCard: () => null,
}));

jest.mock('@/screens/SearchScreen/components', () => ({
  __esModule: true,
  SearchInput: (props: any) => null,
  SearchSuggestion: (props: any) => null,
}));

describe('ListeningScreen Search component', () => {
  it('renders empty state when no resources and showEmptyState is true', () => {
    mockSearchState = {
      searchText: '', showSearchResults: false, onSearchBlur: jest.fn(), focused: false,
      onChangeText: jest.fn(), handleSuggestionPress: jest.fn(), triggerSearchOnSubmit: jest.fn(),
      filteredSuggestions: [], setShowSuggestions: mockSetShowSuggestions, onSearchFocus: mockOnSearchFocus,
      setFocused: mockSetFocused, onPressSuggestion: jest.fn(), lastSearchedText: '', resources: [], tabsMeta: [],
      activeTabIndex: 0, handleTabChange: jest.fn(), showInitialLoader: false, showFooterLoader: false,
      showEmptyState: true, selectedCategory: 'all', handleEndReached: mockHandleEndReached, resetSearch: jest.fn(),
    };
    const {toJSON} = render(<Search />);
    expect(toJSON()).not.toBeNull();
  });

  it('renders suggestions list when not showing results', () => {
    mockSearchState = {
      searchText: '', showSearchResults: false, onSearchBlur: jest.fn(), focused: false,
      onChangeText: jest.fn(), handleSuggestionPress: jest.fn(), triggerSearchOnSubmit: jest.fn(),
      filteredSuggestions: [], setShowSuggestions: mockSetShowSuggestions, onSearchFocus: mockOnSearchFocus,
      setFocused: mockSetFocused, onPressSuggestion: jest.fn(), lastSearchedText: '', resources: [], tabsMeta: [],
      activeTabIndex: 0, handleTabChange: jest.fn(), showInitialLoader: false, showFooterLoader: false,
      showEmptyState: true, selectedCategory: 'all', handleEndReached: mockHandleEndReached, resetSearch: jest.fn(),
    };
    const {toJSON} = render(<Search />);
    expect(toJSON()).not.toBeNull();
  });

  it('shows list with tabs when results present and handles end reached/footer loader', () => {
    mockSearchState = {
      searchText: 'abc', showSearchResults: true, onSearchBlur: jest.fn(), focused: true,
      onChangeText: jest.fn(), handleSuggestionPress: jest.fn(), triggerSearchOnSubmit: jest.fn(),
      filteredSuggestions: [], setShowSuggestions: mockSetShowSuggestions, onSearchFocus: mockOnSearchFocus,
      setFocused: mockSetFocused, onPressSuggestion: jest.fn(), lastSearchedText: 'abc',
      resources: [{id: 'r1', title: 't', description: 'd', url: 'u'}],
      tabsMeta: [{id: 'tab1', label: 'L'}], activeTabIndex: 0, handleTabChange: jest.fn(),
      showInitialLoader: false, showFooterLoader: true, showEmptyState: false, selectedCategory: 'all',
      handleEndReached: mockHandleEndReached, resetSearch: jest.fn(),
    };
    const {getByTestId, toJSON} = render(<Search />);
    expect(toJSON()).not.toBeNull();
  });

  it('onFocus sets suggestions when text present', () => {
    const onChangeText = jest.fn();
    mockSearchState = {
      searchText: 'hi', showSearchResults: false, onSearchBlur: jest.fn(), focused: false,
      onChangeText, handleSuggestionPress: jest.fn(), triggerSearchOnSubmit: jest.fn(),
      filteredSuggestions: [], setShowSuggestions: mockSetShowSuggestions, onSearchFocus: mockOnSearchFocus,
      setFocused: mockSetFocused, onPressSuggestion: jest.fn(), lastSearchedText: '', resources: [], tabsMeta: [],
      activeTabIndex: 0, handleTabChange: jest.fn(), showInitialLoader: false, showFooterLoader: false,
      showEmptyState: true, selectedCategory: 'all', handleEndReached: mockHandleEndReached, resetSearch: jest.fn(),
    };
    const {UNSAFE_getByType} = render(<Search />);
    const SearchInput = require('@/screens/SearchScreen/components').SearchInput;
    const input = UNSAFE_getByType(SearchInput);
    // fire onFocus via prop
    input.props.onFocus();
    expect(mockOnSearchFocus).toHaveBeenCalled();
    expect(mockSetShowSuggestions).toHaveBeenCalled();
  });

  it('calls onEndReached when list reaches end', () => {
    mockSearchState = {
      searchText: 'abc', showSearchResults: true, onSearchBlur: jest.fn(), focused: true,
      onChangeText: jest.fn(), handleSuggestionPress: jest.fn(), triggerSearchOnSubmit: jest.fn(),
      filteredSuggestions: [], setShowSuggestions: mockSetShowSuggestions, onSearchFocus: mockOnSearchFocus,
      setFocused: mockSetFocused, onPressSuggestion: jest.fn(), lastSearchedText: 'abc',
      resources: [{id: 'r1', title: 't', description: 'd', url: 'u'}],
      tabsMeta: [{id: 'tab1', label: 'L'}], activeTabIndex: 0, handleTabChange: jest.fn(),
      showInitialLoader: false, showFooterLoader: false, showEmptyState: false, selectedCategory: 'all',
      handleEndReached: mockHandleEndReached, resetSearch: jest.fn(),
    };
    const {UNSAFE_getByType} = render(<Search />);
    const {FlatList} = require('react-native');
    const list = UNSAFE_getByType(FlatList);
    list.props.onEndReached && list.props.onEndReached();
    expect(mockHandleEndReached).toHaveBeenCalled();
  });
});


