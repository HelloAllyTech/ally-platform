import {useMemo, useRef} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  ScrollView,
  Text,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {SearchActiveIcon} from '@/assets/icons';
import {CustomTabs, ResourceArticleCard} from '@/components';
import {getThemedStyles} from '@/components/CustomTabs/styles';
import {useSearch, useTranslate} from '@/hooks';
import {SearchInput, SearchSuggestion} from '@/screens/SearchScreen/components';
import {SearchEmpty} from '@/screens/SearchScreen/components/SearchEmpty';
import {trySuggestions} from '@/screens/SearchScreen/searchConfig';
import {ResourceArticle} from '@/screens/SearchScreen/types';
import {colors, fontFamily} from '@/theme';

export const Search = () => {
  const flatListRef = useRef<FlatList>(null);

  const {
    searchText,
    showSearchResults,
    onSearchBlur,
    focused,
    onChangeText,
    handleSuggestionPress,
    triggerSearchOnSubmit,
    filteredSuggestions,
    setShowSuggestions,
    onSearchFocus,
    setFocused,
    onPressSuggestion,
    lastSearchedText,
    resources,
    tabsMeta,
    activeTabIndex,
    handleTabChange,
    showInitialLoader,
    showFooterLoader,
    showEmptyState,
    selectedCategory,
    handleEndReached,
    resetSearch,
  } = useSearch(flatListRef);

  const {t} = useTranslate();
  const {tabBody: tabBodyStyle, tabBodyContent: tabBodyContentStyle} = useMemo(
    () => getThemedStyles('dark'),
    [],
  );
  const onFocus = () => {
    onSearchFocus();
    if (searchText.trim() !== '') setShowSuggestions(true);
  };

  const renderItem = ({item}: {item: ResourceArticle}) => {
    if (item) {
      return <ResourceArticleCard {...item} colorTheme="dark" />;
    }
    return <View />;
  };

  const renderEmptyComponent = () => {
    return (
      <SearchEmpty
        searchText={lastSearchedText}
        trySuggestions={trySuggestions}
        colorTheme="dark"
        onPressSuggestion={onPressSuggestion}
      />
    );
  };

  const flatListProps = {
    onEndReached: handleEndReached,
    onEndReachedThreshold: 0.5,
    ListEmptyComponent: renderEmptyComponent(),
  };

  const renderDetailSearch = () => {
    return (
      <View style={styles.container}>
        {renderSearchInput()}
        {resources.length > 0 && tabsMeta.length > 0 && (
          <CustomTabs
            tabs={tabsMeta}
            activeTab={activeTabIndex}
            onTabChange={handleTabChange}
            colorScheme="dark"
          />
        )}
        {showInitialLoader ? (
          <ActivityIndicator style={styles.activityIndicator} />
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
        showSuggestions={false}
        onSuggestionPress={handleSuggestionPress}
        onSubmitEditing={triggerSearchOnSubmit}
        colorTheme="dark"
        customStyles={styles.input}
        resetSearch={resetSearch}
      />
    );
  };

  if (showSearchResults) return renderDetailSearch();
  return (
    <TouchableWithoutFeedback
      onPress={() => {
        Keyboard.dismiss();
        setFocused(false);
      }}>
      <View style={styles.container}>
        {renderSearchInput()}
        <ScrollView
          style={styles.suggestionsScrollView}
          showsVerticalScrollIndicator={false}>
          <View style={styles.suggestionsContainer}>
            <View style={styles.tryContainer}>
              <Text style={styles.tryLabel}>
                {t('search.suggestionsTitle')}
              </Text>
            </View>
            {trySuggestions.map(suggestion => (
              <SearchSuggestion
                key={suggestion.id}
                text={suggestion.text}
                icon={
                  <SearchActiveIcon
                    width={16}
                    height={16}
                    color={colors.darkGray8}
                  />
                }
                onPressSuggestion={() => onPressSuggestion(suggestion.text)}
                suggestionId={suggestion.id}
                colorTheme="dark"
              />
            ))}
          </View>
        </ScrollView>
      </View>
    </TouchableWithoutFeedback>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    width: '100%',
    marginTop: '14@mvs',
  },
  input: {
    marginVertical: '0@mvs',
    borderRadius: '8@ms',
    marginTop: '0@mvs',
  },
  suggestionsScrollView: {
    maxHeight: '500@vs',
  },
  suggestionsContainer: {
    marginTop: '80@mvs',
    marginLeft: '10%',
  },
  tryContainer: {
    flexDirection: 'row',
    marginBottom: '10@mvs',
  },
  tryLabel: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '16@ms',
    color: colors.white,
    marginRight: '10@s',
  },
  footerActivityIndicator: {
    marginVertical: '16@vs',
  },
  activityIndicator: {
    marginVertical: '16@vs',
  },
});
