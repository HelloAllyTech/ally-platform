import React, {useEffect} from 'react';
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
import {ResourceArticle} from './types';

export const SearchScreen: React.FC = () => {
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
    tabsState,
    activeTab,
    dynamicTabs,
    setActiveTab,
    isLoading,
    triggerSearch,
    isFetching,
    onPressSuggestion,
  } = useSearch();
  const {t} = useTranslate();

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
