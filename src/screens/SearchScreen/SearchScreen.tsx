import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Keyboard,
  ScrollView,
  StatusBar,
  Text,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {ScaledSheet} from 'react-native-size-matters';

import {SearchIcon} from '@/assets/icons';
import CustomTabs from '@/components/CustomTabs/CustomTabs';
import ResourceArticleCard from '@/components/ResourceArticleCard/ResourceArticleCard';
import {useSearch} from '@/hooks/useSearch';
import useTranslate from '@/hooks/useTranslate';
import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';

import {SearchHeader, SearchInput, SearchSuggestion} from './components';
import {SearchEmpty} from './components/SearchEmpty';
import {trySuggestions} from './searchConfig';
import {ResourceArticle, TabDefinition, TabState} from './types';

export const SearchScreen: React.FC = () => {
  const {
    searchText,
    setSearchText,
    filteredSuggestions,
    focused,
    showSearchResults,
    onSearchFocus,
    onSearchBlur,
    handleSuggestionPress,
    setShowSuggestions,
    setShowSearchResults,
    setFocused,
    onChangeText,
    searchResults,
    isLoading,
    triggerSearch,
    searchDocuments,
    isFetching,
  } = useSearch();
  const {t} = useTranslate();

  const [activeTab, setActiveTab] = useState(0);
  const [dynamicTabs, setDynamicTabs] = useState<TabDefinition[]>([]);
  const [tabsState, setTabsState] = useState<TabState[]>([]);

  useEffect(() => {
    if (searchResults?.documents) {
      // Create unique categories
      const categories = Array.from(
        new Set(
          searchResults.documents.map(
            (result: ResourceArticle) => result.category,
          ),
        ),
      ) as string[];

      // Create tab definitions with "All" as first tab
      const newTabs: TabDefinition[] = [
        {
          key: 'all',
          label: `All (${searchResults.documents.length})`,
          data: searchResults.documents,
        },
        ...categories.map((category: string) => {
          const categoryDocs = searchResults.documents.filter(
            (result: ResourceArticle) => result.category === category,
          );
          const formattedCategory = category
            .split('-')
            .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
          return {
            key: category,
            label: `${formattedCategory} (${categoryDocs.length})`,
            data: categoryDocs,
          };
        }),
      ];

      setDynamicTabs(newTabs);

      // Initialize tab states with data
      setTabsState(
        newTabs.map(tab => ({
          data: tab.data || [],
          page: 0,
          hasMore: false,
          loading: false,
          error: null,
        })),
      );
    }
  }, [searchResults]);

  const anim = useSharedValue(0);

  useEffect(() => {
    anim.value = withTiming(focused ? 1 : 0, {duration: 300});
  }, [focused, anim]);

  const titleAnimStyle = useAnimatedStyle(() => {
    const translateY = interpolate(anim.value, [0, 1], [0, -60], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    return {
      transform: [{translateY}],
    };
  });

  const searchAnimStyle = useAnimatedStyle(() => {
    const translateY = interpolate(anim.value, [0, 1], [0, -50], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    return {
      transform: [{translateY}],
    };
  });

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

  const onFocus = () => {
    onSearchFocus();
    if (searchText.trim() !== '') setShowSuggestions(true);
  };

  const renderItem = ({item}: {item: ResourceArticle}) => {
    if (item) {
      return <ResourceArticleCard {...item} />;
    }
    return <View />;
  };

  const renderEmptyComponent = () => {
    return (
      <SearchEmpty
        searchText={searchText}
        trySuggestions={trySuggestions}
        colorTheme="dark"
      />
    );
  };

  const flatListProps = {
    onEndReached: handleEndReached,
    onEndReachedThreshold: 0.5,
    ListEmptyComponent: renderEmptyComponent(),
    ListFooterComponent:
      tabsState[activeTab]?.loading && tabsState[activeTab]?.data.length > 0 ? (
        <ActivityIndicator style={styles.footerActivityIndicator} />
      ) : null,
  };

  const renderDetailSearch = () => {
    return (
      <View style={styles.container}>
        {renderSearchInput()}
        {isLoading || isFetching ? (
          <ActivityIndicator style={styles.activityIndicator} />
        ) : (
          dynamicTabs.length > 0 && (
            <CustomTabs
              tabs={dynamicTabs.map((tab, idx) => ({
                ...tab,
                title: tab.label,
                data: tabsState[idx]?.data || [],
              }))}
              onTabChange={setActiveTab}
              renderItem={renderItem}
              initialTab={activeTab}
              flatListProps={flatListProps}
            />
          )
        )}
      </View>
    );
  };

  // const isShowSuggestions =
  //   !showSearchResults &&
  //   showSuggestions &&
  //   focused &&
  //   searchText.trim() !== '';

  const renderSearchInput = () => {
    return (
      <SearchInput
        showSearchResults={showSearchResults}
        onFocus={onFocus}
        placeholder={t('CallLogs.search.placeholder')}
        onBlur={onSearchBlur}
        isFocused={focused}
        searchText={searchText}
        setSearchText={onChangeText}
        suggestions={filteredSuggestions}
        showSuggestions={false}
        onSuggestionPress={handleSuggestionPress}
        onSubmitEditing={triggerSearch}
      />
    );
  };

  const onPressSuggestion = (suggestion: string) => {
    setSearchText(suggestion);
    searchDocuments({query: suggestion});
    setShowSearchResults(true);
  };

  const renderSearchLaunch = () => {
    return (
      <TouchableWithoutFeedback
        onPress={() => {
          Keyboard.dismiss();
          setFocused(false);
          anim.value = withTiming(0, {duration: 300});
        }}>
        <View style={styles.searchContainer}>
          <StatusBar barStyle="dark-content" />
          <Animated.View style={titleAnimStyle}>
            <SearchHeader isFocused={focused} />
          </Animated.View>
          <Animated.View style={searchAnimStyle}>
            {renderSearchInput()}
          </Animated.View>
          {!focused && (
            <>
              <View style={styles.tryContainer}>
                <Text style={styles.tryLabel}>{t('SearchScreen.try')}</Text>
              </View>
              <ScrollView
                style={styles.trySuggestions}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.trySuggestionsContainer}>
                {trySuggestions.map(suggestion => (
                  <SearchSuggestion
                    key={suggestion.id}
                    text={suggestion.text}
                    icon={<SearchIcon width={16} height={16} />}
                    onPressSuggestion={() => onPressSuggestion(suggestion.text)}
                    suggestionId={suggestion.id}
                  />
                ))}
              </ScrollView>
            </>
          )}
        </View>
      </TouchableWithoutFeedback>
    );
  };

  if (showSearchResults) return renderDetailSearch();
  return renderSearchLaunch();
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
    paddingTop: '44@vs',
    paddingHorizontal: '16@ms',
  },
  searchContainer: {
    flex: 1,
    backgroundColor: colors.white,
    paddingTop: '44@vs',
    paddingHorizontal: '24@ms',
  },
  activityIndicator: {
    marginVertical: '16@vs',
  },
  errorText: {
    color: colors.brightRed,
  },
  itemText: {
    height: '50@ms',
    marginBottom: '10@vs',
  },
  footerActivityIndicator: {
    marginVertical: '16@vs',
  },
  tryContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: '10@vs',
  },
  tryLabel: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '16@ms',
    color: colors.black,
    marginRight: '10@s',
  },
  emptyComponent: {
    flex: 1,
    paddingVertical: '32@vs',
  },
  emptyComponentText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.lightGray12,
    fontSize: '14@ms',
    lineHeight: '20@ms',
    marginLeft: '16@ms',
  },
  trySuggestionsContainer: {
    paddingBottom: '100@ms',
  },
  trySuggestions: {
    flex: 1,
  },
});
