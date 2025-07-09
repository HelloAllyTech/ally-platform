import {
  ActivityIndicator,
  Keyboard,
  Text,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {SearchActiveIcon} from '@/assets/icons';
import CustomTabs from '@/components/CustomTabs/CustomTabs';
import ResourceArticleCard from '@/components/ResourceArticleCard/ResourceArticleCard';
import {useSearch} from '@/hooks/useSearch';
import useTranslate from '@/hooks/useTranslate';
import {SearchInput, SearchSuggestion} from '@/screens/SearchScreen/components';
import {SearchEmpty} from '@/screens/SearchScreen/components/SearchEmpty';
import {trySuggestions} from '@/screens/SearchScreen/searchConfig';
import {ResourceArticle} from '@/screens/SearchScreen/types';
import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';

const Search = () => {
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
    dynamicTabs,
    tabsState,
    onPressSuggestion,
    loading,
    handleEndReached,
    lastSearchedText,
    resources,
    categoryCountList,
    selectedCategory,
    onCategoryChange,
    hasMore,
  } = useSearch();

  const {t} = useTranslate();
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
    ListFooterComponent:
      loading && resources.length > 0 ? (
        <ActivityIndicator style={styles.footerActivityIndicator} />
      ) : null,
  };

  const renderDetailSearch = () => {
    return (
      <View style={styles.container}>
        {renderSearchInput()}
        {loading ? (
          <ActivityIndicator style={styles.activityIndicator} />
        ) : (
          resources.length > 0 && (
            <CustomTabs
              tabs={[
                {
                  key: 'all',
                  title: `All (${resources.length})`,
                  data: resources,
                },
                ...Object.entries(categoryCountList).map(
                  ([category, count]) => ({
                    key: category.toLowerCase(),
                    title: `${category} (${count})`,
                    data: [], // Category data will be loaded separately
                  }),
                ),
              ]}
              onTabChange={tabIndex => {
                if (tabIndex === 0) {
                  onCategoryChange('All');
                } else {
                  const category = Object.keys(categoryCountList)[tabIndex - 1];
                  onCategoryChange(category);
                }
              }}
              renderItem={renderItem}
              initialTab={0}
              flatListProps={flatListProps}
              colorScheme="dark"
            />
          )
        )}
      </View>
    );
  };

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
        onSubmitEditing={triggerSearchOnSubmit}
        colorTheme="dark"
        customStyles={styles.input}
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
        <View style={styles.suggestionsContainer}>
          <View style={styles.tryContainer}>
            <Text style={styles.tryLabel}>{t('SearchScreen.try')}</Text>
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
      </View>
    </TouchableWithoutFeedback>
  );
};

export default Search;

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    width: '100%',
    marginTop: '14@mvs',
  },
  input: {
    marginVertical: '0@mvs',
    borderRadius: '8@ms',
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
