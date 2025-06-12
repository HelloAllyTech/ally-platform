import React, {useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Keyboard,
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
import ResourceArticleCard from '@/components/ResourceArticleCard';
import {useSearch} from '@/hooks/useSearch';
import useTranslate from '@/hooks/useTranslate';
import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';

import {SearchHeader, SearchInput, SearchSuggestion} from './components';
import {allData, PAGE_SIZE, tabDefs, trySuggestions} from './searchConfig';
import {ResourceArticle, TabState} from './types';

const fetchTabData = async (
  key: string,
  page: number,
  pageSize: number = PAGE_SIZE,
): Promise<{data: ResourceArticle[]; hasMore: boolean}> => {
  await new Promise(res => setTimeout(res, 500));
  const all = allData[key] || [];
  const start = page * pageSize;
  const end = start + pageSize;
  const data = all.slice(start, end);
  return {data, hasMore: end < all.length};
};

export const SearchScreen: React.FC = () => {
  const {
    searchText,
    setSearchText,
    filteredSuggestions,
    showSuggestions,
    debounceSearch,
    focused,
    showSearchResults,
    onSearchFocus,
    onSearchBlur,
    handleSuggestionPress,
    setShowSuggestions,
    setShowSearchResults,
    setFocused,
    onChangeText,
  } = useSearch();
  const {t} = useTranslate();

  const [activeTab, setActiveTab] = useState(0);
  const [tabsState, setTabsState] = useState<TabState[]>(() =>
    tabDefs.map(() => ({
      data: [],
      page: 0,
      hasMore: true,
      loading: false,
      error: null,
    })),
  );

  useEffect(() => {
    debounceSearch();
  }, [searchText, debounceSearch]);

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

  const loadTabData = async (
    tabIdx: number,
    nextPage: number = 0,
    append = false,
  ) => {
    setTabsState(prev => {
      const newState = [...prev];
      newState[tabIdx] = {...newState[tabIdx], loading: true, error: null};
      return newState;
    });
    try {
      const {data, hasMore} = await fetchTabData(tabDefs[tabIdx].key, nextPage);
      setTabsState(prev => {
        const newState = [...prev];
        newState[tabIdx] = {
          ...newState[tabIdx],
          data: append ? [...newState[tabIdx].data, ...data] : data,
          page: nextPage,
          hasMore,
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
  };

  // Load data when tab changes
  useEffect(() => {
    if (
      tabsState[activeTab].data.length === 0 &&
      !tabsState[activeTab].loading
    ) {
      loadTabData(activeTab, 0, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

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
    const tab = tabsState[activeTab];
    if (tab.loading && tab.data.length === 0) {
      return <ActivityIndicator style={styles.activityIndicator} />;
    }
    if (tab.error) {
      return (
        <View style={styles.emptyComponent}>
          <Text style={styles.emptyComponentText}>{tab.error}</Text>
        </View>
      );
    }
    return (
      <View style={styles.emptyComponent}>
        <Text style={styles.emptyComponentText}>
          {`${t('SearchScreen.noData')} "${searchText}"`}
        </Text>
        <Text style={styles.tryText}>{t('SearchScreen.try')}</Text>
        {trySuggestions.map(suggestion => (
          <View key={suggestion.id} style={styles.trySuggestion}>
            <SearchIcon width={14} height={14} />
            <Text style={styles.suggestionText}>{suggestion.text}</Text>
          </View>
        ))}
      </View>
    );
  };

  const flatListProps = {
    onEndReached: handleEndReached,
    onEndReachedThreshold: 0.5,
    ListEmptyComponent: renderEmptyComponent(),
    ListFooterComponent:
      tabsState[activeTab].loading && tabsState[activeTab].data.length > 0 ? (
        <ActivityIndicator style={styles.footerActivityIndicator} />
      ) : null,
  };

  const renderDetailSearch = () => {
    return (
      <View style={styles.container}>
        {renderSearchInput()}
        <CustomTabs
          tabs={tabDefs.map((tab, idx) => ({
            ...tab,
            data: tabsState[idx].data,
          }))}
          onTabChange={setActiveTab}
          renderItem={renderItem}
          initialTab={activeTab}
          flatListProps={flatListProps}
        />
      </View>
    );
  };

  const isShowSuggestions =
    !showSearchResults &&
    showSuggestions &&
    focused &&
    searchText.trim() !== '';

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
        showSuggestions={isShowSuggestions}
        onSuggestionPress={handleSuggestionPress}
        onSubmitEditing={() => setShowSearchResults(true)}
      />
    );
  };

  const onPressSuggestion = (suggestion: string) => {
    setSearchText(suggestion);
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
        <View style={styles.container}>
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
              {trySuggestions.map(suggestion => (
                <SearchSuggestion
                  key={suggestion.id}
                  text={suggestion.text}
                  icon={<SearchIcon width={16} height={16} />}
                  onPressSuggestion={() => onPressSuggestion(suggestion.text)}
                  suggestionId={suggestion.id}
                />
              ))}
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
    paddingHorizontal: '24@s',
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
  tryText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.black,
    fontSize: '14@ms',
    lineHeight: '20@ms',
    marginLeft: '16@ms',
    marginTop: '18@ms',
    marginBottom: '10@ms',
  },
  trySuggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: '18@ms',
    marginLeft: '16@ms',
  },
  suggestionText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.darkGray6,
    fontSize: '14@ms',
    lineHeight: '20@ms',
    marginLeft: '10@ms',
  },
});
