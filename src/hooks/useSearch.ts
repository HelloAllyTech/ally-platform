import {useCallback, useEffect, useRef, useState} from 'react';
import {Keyboard} from 'react-native';

import {searchSuggestions} from '@/screens/SearchScreen/searchConfig';
import {
  ResourceArticle,
  TabDefinition,
  TabState,
} from '@/screens/SearchScreen/types';
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

  const [activeTab, setActiveTab] = useState(0);
  const [dynamicTabs, setDynamicTabs] = useState<TabDefinition[]>([]);
  const [tabsState, setTabsState] = useState<TabState[]>([]);

  useEffect(() => {
    if (searchResults?.documents) {
      // Filter documents by category
      const resourcesDocs = searchResults.documents.filter(
        (result: ResourceArticle) => result.category === 'Resources',
      );
      const questionDocs = searchResults.documents.filter(
        (result: ResourceArticle) => result.category === 'Question',
      );
      const techniquesDocs = searchResults.documents.filter(
        (result: ResourceArticle) => result.category === 'Techniques',
      );
      const assessmentDocs = searchResults.documents.filter(
        (result: ResourceArticle) => result.category === 'Assessment',
      );
      const metaphorDocs = searchResults.documents.filter(
        (result: ResourceArticle) => result.category === 'Metaphor',
      );
      const interventionDocs = searchResults.documents.filter(
        (result: ResourceArticle) => result.category === 'Intervention',
      );

      // Fixed list of tabs
      const fixedTabs: TabDefinition[] = [
        {
          key: 'all',
          label: `All (${searchResults.documents.length})`,
          data: searchResults.documents,
        },
        {
          key: 'resources',
          label: `Resources (${resourcesDocs.length})`,
          data: resourcesDocs,
        },
        {
          key: 'question',
          label: `Question (${questionDocs.length})`,
          data: questionDocs,
        },
        {
          key: 'techniques',
          label: `Techniques (${techniquesDocs.length})`,
          data: techniquesDocs,
        },
        {
          key: 'metaphor',
          label: `Metaphor (${metaphorDocs.length})`,
          data: metaphorDocs,
        },
        {
          key: 'assessment',
          label: `Assessment (${assessmentDocs.length})`,
          data: assessmentDocs,
        },
        {
          key: 'intervention',
          label: `Intervention (${interventionDocs.length})`,
          data: interventionDocs,
        },
      ];

      setDynamicTabs(fixedTabs);

      // Initialize tab states with data
      setTabsState(
        fixedTabs.map(tab => ({
          data: tab.data || [],
          page: 0,
          hasMore: false,
          loading: false,
          error: null,
        })),
      );
    }
  }, [searchResults]);

  const loadTabData = useCallback(
    (tabIdx: number = 0, nextPage: number = 0, append = false) => {
      const currentTab = dynamicTabs[tabIdx];
      if (!currentTab?.data) return;

      setTabsState(prev => {
        const newState = [...prev];
        newState[tabIdx] = {...newState[tabIdx], loading: true, error: null};
        return newState;
      });

      try {
        const data = currentTab.data;
        setTabsState(prev => {
          const newState = [...prev];
          newState[tabIdx] = {
            ...newState[tabIdx],
            data: append ? [...newState[tabIdx].data, ...data] : data,
            page: nextPage,
            hasMore: false,
            loading: false,
            error: null,
          };
          return newState;
        });
      } catch (e) {
        setTabsState(prev => {
          const newState = [...prev];
          newState[tabIdx] = {
            ...newState[tabIdx],
            loading: false,
            error: 'Failed to load data',
          };
          return newState;
        });
      }
    },
    [dynamicTabs],
  );

  // Load data when tab changes
  useEffect(() => {
    if (dynamicTabs.length > 0) {
      loadTabData(activeTab, 0, false);
    }
  }, [activeTab, dynamicTabs, loadTabData]);

  // Handler for loading more data
  const handleEndReached = () => {
    const tab = tabsState[activeTab];
    if (!tab.loading && tab.hasMore) {
      loadTabData(activeTab, tab.page + 1, true);
    }
  };

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

  const onPressSuggestion = (suggestion: string) => {
    setSearchText(suggestion);
    searchDocuments({query: suggestion});
    setShowSearchResults(true);
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
    setActiveTab,
    handleEndReached,
    tabsState,
    activeTab,
    dynamicTabs,
    onPressSuggestion,
  };
};
