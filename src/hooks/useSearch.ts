import {useCallback, useRef, useState} from 'react';
import {Keyboard} from 'react-native';

import {searchSuggestions} from '@/screens/SearchScreen/searchConfig';
import {useLazyGetSearchResultsQuery} from '@/services/searchApi';

export const useSearch = () => {
  const [searchText, setSearchText] = useState('');
  const [focused, setFocused] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [filteredSuggestions, setFilteredSuggestions] =
    useState(searchSuggestions);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceTimeout = useRef<NodeJS.Timeout | null>(null);

  const [searchDocuments, {data: searchResults, isLoading, isFetching}] =
    useLazyGetSearchResultsQuery();

  // Only call this to trigger a search
  const triggerSearch = useCallback(() => {
    if (searchText.trim() !== '') {
      searchDocuments({query: searchText});
      setShowSearchResults(true);
      setShowSuggestions(false);
    }
  }, [searchText, searchDocuments]);

  // Debounce for suggestions only
  const debounceSearch = useCallback(() => {
    if (searchText.trim() === '') {
      setFilteredSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    setShowSuggestions(true);
    if (debounceTimeout.current) clearTimeout(debounceTimeout.current);
    debounceTimeout.current = setTimeout(() => {
      const filtered = searchSuggestions.filter(s =>
        s.text.toLowerCase().includes(searchText.toLowerCase()),
      );
      setFilteredSuggestions(filtered);
    }, 250);
  }, [searchText]);

  const handleSuggestionPress = (suggestion: {id: number; text: string}) => {
    setSearchText(suggestion.text);
    setShowSuggestions(false);
    setFocused(false);
    Keyboard.dismiss();
    searchDocuments({query: suggestion.text});
    setShowSearchResults(true);
  };

  const onSearchFocus = () => {
    setFocused(true);
  };

  const onSearchBlur = () => {
    setFocused(false);
  };

  const onChangeText = (text: string) => {
    setSearchText(text);
    if (text.trim() !== '') setShowSuggestions(true);
    else setShowSuggestions(false);
  };

  return {
    searchText,
    setSearchText,
    filteredSuggestions,
    showSuggestions,
    debounceSearch,
    handleSuggestionPress,
    onSearchFocus,
    onSearchBlur,
    focused,
    showSearchResults,
    setShowSearchResults,
    setShowSuggestions,
    setFocused,
    onChangeText,
    searchResults,
    isLoading,
    isFetching,
    triggerSearch,
    searchDocuments,
  };
};
