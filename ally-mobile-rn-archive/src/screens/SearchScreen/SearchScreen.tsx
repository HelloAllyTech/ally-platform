import React, {useEffect, useMemo, useRef} from 'react';
import {
  ActivityIndicator,
  FlatList,
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
import {CustomTabs, ResourceArticleCard} from '@/components';
import {getThemedStyles} from '@/components/CustomTabs/styles';
import {useSearch, useTabBackToHomeHandler, useTranslate} from '@/hooks';
import {colors, fontFamily} from '@/theme';

import {
  SearchEmpty,
  SearchHeader,
  SearchInput,
  SearchSuggestion,
} from './components';
import {trySuggestions} from './searchConfig';
import {ResourceArticle} from './types';

export const SearchScreen: React.FC = () => {
  const flatListRef = useRef<FlatList>(null);

  const {
    searchText,
    filteredSuggestions,
    focused,
    showSearchResults,
    onSearchFocus,
    onSearchBlur,
    handleSuggestionPress,
    setShowSuggestions,
    setFocused,
    onChangeText,
    handleEndReached,
    onPressSuggestion,
    lastSearchedText,
    resources,
    triggerSearchOnSubmit,
    selectedCategory,
    showSuggestions,
    tabsMeta,
    activeTabIndex,
    handleTabChange,
    showInitialLoader,
    showFooterLoader,
    showEmptyState,
    resetSearch,
  } = useSearch(flatListRef);
  const {t} = useTranslate();

  useTabBackToHomeHandler();

  const anim = useSharedValue(0);

  const {tabBody: tabBodyStyle, tabBodyContent: tabBodyContentStyle} = useMemo(
    () => getThemedStyles('light'),
    [],
  );

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

  const onFocus = () => {
    onSearchFocus();
    setShowSuggestions(true);
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
        searchText={lastSearchedText}
        trySuggestions={trySuggestions}
        colorTheme="light"
        onPressSuggestion={onPressSuggestion}
      />
    );
  };

  const flatListProps = {
    onEndReached: handleEndReached,
    onEndReachedThreshold: 0.5,
    ListFooterComponent:
      showFooterLoader && resources.length > 0 ? (
        <ActivityIndicator style={styles.footerActivityIndicator} />
      ) : null,
  };

  const renderDetailSearch = () => {
    return (
      <View style={styles.container}>
        <TouchableWithoutFeedback
          onPress={() => {
            Keyboard.dismiss();
            setFocused(false);
          }}>
          {renderSearchInput()}
        </TouchableWithoutFeedback>
        {tabsMeta.length > 0 && resources.length > 0 && (
          <CustomTabs
            tabs={tabsMeta}
            activeTab={activeTabIndex}
            onTabChange={handleTabChange}
          />
        )}
        {showInitialLoader ? (
          <ActivityIndicator style={styles.footerActivityIndicator} />
        ) : resources.length > 0 ? (
          <FlatList
            ref={flatListRef}
            data={resources}
            renderItem={renderItem}
            keyExtractor={(_, i) => `${selectedCategory}-resource-${i}`}
            {...flatListProps}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={tabBodyContentStyle}
            style={tabBodyStyle}
            removeClippedSubviews
            initialNumToRender={10}
            maxToRenderPerBatch={10}
            updateCellsBatchingPeriod={50}
            windowSize={5}
            ListFooterComponent={
              showFooterLoader ? (
                <ActivityIndicator style={styles.footerActivityIndicator} />
              ) : null
            }
          />
        ) : showEmptyState ? (
          renderEmptyComponent()
        ) : null}
      </View>
    );
  };

  const isShowSuggestions = showSuggestions && focused;

  const renderSearchInput = () => {
    return (
      <SearchInput
        showSearchResults={showSearchResults}
        onFocus={onFocus}
        placeholder={t('nav.tabs.search')}
        onBlur={onSearchBlur}
        isFocused={focused}
        searchText={searchText}
        setSearchText={onChangeText}
        suggestions={filteredSuggestions}
        showSuggestions={isShowSuggestions}
        onSuggestionPress={handleSuggestionPress}
        onSubmitEditing={triggerSearchOnSubmit}
        resetSearch={resetSearch}
      />
    );
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
                <Text style={styles.tryLabel}>
                  {t('search.suggestionsTitle')}
                </Text>
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
