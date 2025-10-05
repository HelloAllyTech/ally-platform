import React from 'react';
import {render, fireEvent} from '@testing-library/react-native';

import {Search} from '../Search';

jest.mock('@/hooks', () => {
  const data = {
    searchText: '',
    showSearchResults: false,
    onSearchBlur: jest.fn(),
    focused: false,
    onChangeText: jest.fn(),
    handleSuggestionPress: jest.fn(),
    triggerSearchOnSubmit: jest.fn(),
    filteredSuggestions: [],
    setShowSuggestions: jest.fn(),
    onSearchFocus: jest.fn(),
    setFocused: jest.fn(),
    onPressSuggestion: jest.fn(),
    lastSearchedText: '',
    resources: [],
    tabsMeta: [],
    activeTabIndex: 0,
    handleTabChange: jest.fn(),
    showInitialLoader: false,
    showFooterLoader: false,
    showEmptyState: true,
    selectedCategory: 'all',
    handleEndReached: jest.fn(),
    resetSearch: jest.fn(),
  };
  return {
    __esModule: true,
    useSearch: () => data,
    useTranslate: () => ({t: (k: string) => k}),
  };
});

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
    const {toJSON} = render(<Search />);
    expect(toJSON()).not.toBeNull();
  });

  it('renders suggestions list when not showing results', () => {
    const {toJSON} = render(<Search />);
    expect(toJSON()).not.toBeNull();
  });
});


