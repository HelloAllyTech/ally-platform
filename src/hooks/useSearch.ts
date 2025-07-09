import {useCallback, useEffect, useRef, useState} from 'react';
import {Keyboard} from 'react-native';

import {
  PAGE_SIZE,
  searchSuggestions,
} from '@/screens/SearchScreen/searchConfig';
import {ResourceArticle} from '@/screens/SearchScreen/types';
import {useLazyGetSearchResultsQuery} from '@/services/searchApi';

export const useSearch = () => {
  const [searchText, setSearchText] = useState('');
  console.log('🚀 ~ useSearch ~ searchText:', searchText);
  const [lastSearchedText, setLastSearchedText] = useState('');
  console.log('🚀 ~ useSearch ~ lastSearchedText:', lastSearchedText);
  const [focused, setFocused] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [filteredSuggestions, setFilteredSuggestions] =
    useState(searchSuggestions);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceTimeout = useRef<NodeJS.Timeout | null>(null);

  // State management matching web implementation
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [resources, setResources] = useState<ResourceArticle[]>([]);
  const [categoryCountList, setCategoryCountList] = useState<{
    [key: string]: number;
  }>({});

  console.log('🚀 ~ useSearch ~ categoryCountList:', categoryCountList);
  const [hasMore, setHasMore] = useState(true);

  const [searchDocuments, {isLoading, isFetching}] =
    useLazyGetSearchResultsQuery();

  // Reset pagination when search query changes
  useEffect(() => {
    if (lastSearchedText !== searchText && searchText.trim() !== '') {
      setSelectedCategory('All');
    }
  }, [searchText, lastSearchedText]);

  // Main search function matching web implementation
  const triggerSearch = useCallback(
    async (query: string, category?: string) => {
      let filters;
      if (category && category !== 'All') {
        filters = {category};
      }

      try {
        const response = await searchDocuments({
          query,
          limit: PAGE_SIZE,
          filters,
        });

        if (response.data) {
          const documents = response.data.documents || [];
          setResources(documents);
          setHasMore(response.data.total > documents.length);

          // Only set category count list for "All" category or initial search
          if (!(category && category !== 'All')) {
            setCategoryCountList(response.data.categories || {});
          }
        }
      } catch (error) {
        console.error('Error fetching search results:', error);
      }
    },
    [searchDocuments],
  );

  // Category change handler matching web implementation
  const onCategoryChange = useCallback(
    async (category: string) => {
      setSelectedCategory(category);
      if (lastSearchedText) {
        await triggerSearch(lastSearchedText, category);
      }
    },
    [lastSearchedText, triggerSearch],
  );

  // Infinite scroll handler matching web implementation
  const fetchRemainingResources = useCallback(async () => {
    if (isLoading || isFetching || !hasMore) return;

    let filters;
    if (selectedCategory && selectedCategory !== 'All') {
      filters = {category: selectedCategory};
    }

    try {
      const response = await searchDocuments({
        query: lastSearchedText,
        limit: PAGE_SIZE,
        filters,
        excludedIds: resources.map(resource => resource.id),
      });

      if (response.data) {
        const newDocuments = response.data.documents || [];
        setResources(prevResources => [...prevResources, ...newDocuments]);
        setHasMore(
          response.data.total > resources.length + newDocuments.length,
        );
      }
    } catch (error) {
      console.error('Error fetching remaining resources:', error);
    }
  }, [
    isLoading,
    isFetching,
    hasMore,
    selectedCategory,
    lastSearchedText,
    resources,
    searchDocuments,
  ]);

  // Search handler matching web implementation
  const onSearch = useCallback(
    async (query: string) => {
      setSearchText(query);
      setLastSearchedText(query);
      setSelectedCategory('All');

      if (query.trim()) {
        await triggerSearch(query);
        setShowSearchResults(true);
        setShowSuggestions(false);
      }
    },
    [triggerSearch],
  );

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

  const handleSuggestionPress = useCallback(
    (suggestion: {id: number; text: string}) => {
      setLastSearchedText(suggestion.text);
      setSearchText(suggestion.text);
      setShowSuggestions(false);
      setFocused(false);
      Keyboard.dismiss();
      onSearch(suggestion.text);
    },
    [onSearch],
  );

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

  const onPressSuggestion = useCallback(
    (suggestion: string) => {
      setShowSearchResults(true);
      console.log(
        '🚀 ~ handleSuggestionPress ~ showSearchResults:',
        showSearchResults,
      );
      onSearch(suggestion);
    },
    [onSearch, showSearchResults],
  );

  // Trigger search on submit
  const triggerSearchOnSubmit = useCallback(() => {
    if (searchText.trim()) {
      onSearch(searchText);
    }
  }, [searchText, onSearch]);

  const loading = isLoading || isFetching;

  // Generate dynamic tabs from category count list
  const dynamicTabs = useCallback(() => {
    if (Object.keys(categoryCountList).length === 0) {
      return [];
    }

    const tabs = [
      {
        key: 'all',
        label: `All (${resources.length})`,
        data: resources,
      },
    ];

    Object.entries(categoryCountList).forEach(([category, count]) => {
      tabs.push({
        key: category.toLowerCase(),
        label: `${category} (${count})`,
        data: [], // Category data will be loaded separately
      });
    });

    return tabs;
  }, [categoryCountList, resources]);

  // Tab state management
  const tabsState = useCallback(() => {
    return dynamicTabs().map((tab, idx) => ({
      data: idx === 0 ? tab.data : [], // Only "All" tab has data initially
      page: 0,
      hasMore: idx === 0 ? hasMore : false,
      loading: false,
      error: null,
    }));
  }, [dynamicTabs, hasMore]);

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
    loading,
    triggerSearchOnSubmit,
    searchDocuments,
    handleEndReached: fetchRemainingResources,
    tabsState: tabsState(),
    activeTab: 0, // We'll handle tab switching separately
    dynamicTabs: dynamicTabs(),
    onPressSuggestion,
    lastSearchedText,
    selectedCategory,
    onCategoryChange,
    resources,
    categoryCountList,
    hasMore,
  };
};
