import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {FlatList, Keyboard} from 'react-native';

import {PAGE_SIZE, trySuggestions} from '@/screens/SearchScreen/searchConfig';
import {ResourceArticle} from '@/screens/SearchScreen/types';
import {useLazyGetSearchResultsQuery} from '@/services/searchApi';
import {logger} from '@/utils/logger';

export const useSearch = (flatListRef?: React.RefObject<FlatList | null>) => {
  const [searchText, setSearchText] = useState('');
  const [lastSearchedText, setLastSearchedText] = useState('');
  const [focused, setFocused] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [filteredSuggestions, setFilteredSuggestions] =
    useState(trySuggestions);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceTimeout = useRef<NodeJS.Timeout | null>(null);

  // State management matching web implementation
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [resources, setResources] = useState<ResourceArticle[]>([]);
  const [categoryCountList, setCategoryCountList] = useState<{
    [key: string]: number;
  }>({});

  const [hasMore, setHasMore] = useState(true);
  const [initialTotal, setInitialTotal] = useState<number | null>(null);

  const [searchDocuments, {isLoading, isFetching}] =
    useLazyGetSearchResultsQuery();

  // Reset pagination when search query changes
  useEffect(() => {
    if (lastSearchedText !== searchText && searchText.trim() !== '') {
      setSelectedCategory('All');
    }
  }, [searchText, lastSearchedText]);

  // Main search function
  const triggerSearch = useCallback(
    async (query: string, category?: string) => {
      let filters;
      if (category && category !== 'All') {
        filters = {category};
      }

      flatListRef?.current?.scrollToOffset({offset: 0, animated: true});

      try {
        const response = await searchDocuments({
          query,
          limit: PAGE_SIZE,
          filters,
        });

        if (response.data) {
          const documents = response.data.documents || [];
          setResources(documents);
          setInitialTotal(response.data.total);
          setHasMore(response.data.total > documents.length);

          // Only set category count list for "All" category or initial search
          if (!(category && category !== 'All')) {
            setCategoryCountList(response.data.categories || {});
          }
        }
      } catch (error) {
        logger.error(`Error fetching search results: ${error}`);
      }
    },
    [searchDocuments, flatListRef],
  );

  // Category change handler
  const onCategoryChange = useCallback(
    async (category: string) => {
      setSelectedCategory(category);
      if (lastSearchedText) {
        await triggerSearch(lastSearchedText, category);
      }
    },
    [lastSearchedText, triggerSearch],
  );

  // Infinite scroll handler
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
          initialTotal !== null
            ? initialTotal > resources.length + newDocuments.length
            : true,
        );
      }
    } catch (error) {
      logger.error(`Error fetching remaining resources: ${error}`);
    }
  }, [
    isLoading,
    isFetching,
    hasMore,
    selectedCategory,
    lastSearchedText,
    resources,
    searchDocuments,
    initialTotal,
  ]);

  // Search handler matching web implementation
  const onSearch = useCallback(
    async (query: string) => {
      setSearchText(query);
      setLastSearchedText(query);
      setSelectedCategory('All');
      setInitialTotal(null);

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
      return;
    }
    if (debounceTimeout.current) clearTimeout(debounceTimeout.current);
    debounceTimeout.current = setTimeout(() => {
      const filtered = trySuggestions.filter(s =>
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
    setShowSuggestions(true);
  };

  const onPressSuggestion = useCallback(
    (suggestion: string) => {
      setShowSearchResults(true);
      onSearch(suggestion);
    },
    [onSearch],
  );

  // Trigger search on submit
  const triggerSearchOnSubmit = useCallback(() => {
    if (searchText.trim()) {
      onSearch(searchText);
    }
  }, [searchText, onSearch]);

  const loading = isLoading || isFetching;

  // --- Centralized tab meta and active tab logic ---
  const tabsMeta = useMemo(
    () => [
      {
        key: 'all',
        title: `All (${Object.values(categoryCountList).reduce((acc, curr) => acc + curr, 0)})`,
      },
      ...Object.entries(categoryCountList).map(([category, count]) => ({
        key: category.toLowerCase(),
        title: `${category} (${count})`,
      })),
    ],
    [categoryCountList],
  );

  const normalizedSelectedCategory = selectedCategory.toLowerCase();
  const activeTabIndex = tabsMeta.findIndex(
    tab => tab.key === normalizedSelectedCategory,
  );

  // Centralized loader/empty state logic
  const showInitialLoader = resources.length === 0 && loading;
  const showFooterLoader = resources.length > 0 && loading;
  const showEmptyState = resources.length === 0 && !loading;

  // Centralized tab change handler
  const handleTabChange = useCallback(
    (tabIndex: number) => {
      const tabKey = tabsMeta[tabIndex].key;
      if (tabKey === 'all') {
        onCategoryChange('All');
      } else {
        onCategoryChange(tabKey);
      }
    },
    [tabsMeta, onCategoryChange],
  );

  const resetSearch = () => {
    setSearchText('');
    setLastSearchedText('');
    setResources([]);
    setCategoryCountList({});
    setSelectedCategory('All');
    setInitialTotal(null);
    setHasMore(true);
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
    loading,
    triggerSearchOnSubmit,
    searchDocuments,
    handleEndReached: fetchRemainingResources,
    onPressSuggestion,
    lastSearchedText,
    selectedCategory,
    onCategoryChange,
    resources,
    categoryCountList,
    hasMore,
    tabsMeta,
    activeTabIndex,
    handleTabChange,
    showInitialLoader,
    showFooterLoader,
    showEmptyState,
    resetSearch,
  };
};
