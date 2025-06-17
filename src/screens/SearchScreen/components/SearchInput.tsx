import React, {useEffect, useRef} from 'react';
import {Text, TextInput, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {SearchActiveIcon, SearchIcon} from '@/assets/icons';
import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';
import {ThemeMode} from '@/types/general';

interface SearchInputProps {
  onFocus: () => void;
  placeholder: string;
  onBlur: () => void;
  isFocused: boolean;
  searchText: string;
  setSearchText: (text: string) => void;
  suggestions: Array<{id: number; text: string}>;
  onSuggestionPress: (suggestion: {id: number; text: string}) => void;
  showSuggestions: boolean;
  onSubmitEditing: () => void;
  showSearchResults: boolean;
  colorTheme?: ThemeMode;
}

export const SearchInput: React.FC<SearchInputProps> = ({
  onFocus,
  placeholder,
  onBlur,
  isFocused,
  searchText,
  setSearchText,
  suggestions,
  onSuggestionPress,
  showSuggestions,
  onSubmitEditing,
  showSearchResults,
  colorTheme = 'light',
}) => {
  const inputRef = useRef<TextInput>(null);

  const styles = getThemedStyles(colorTheme);

  const isDark = colorTheme === 'dark';

  useEffect(() => {
    if (isFocused) {
      inputRef.current?.focus();
    }
  }, [isFocused]);

  return (
    <View style={isFocused && !showSearchResults && styles.baseContainer}>
      <View
        style={[
          styles.searchBar,
          isFocused && !showSearchResults && styles.cardContainer,
        ]}>
        <View style={styles.searchIconContainer}>
          {isDark ? (
            <SearchActiveIcon width={14} height={14} color={colors.darkGray8} />
          ) : (
            <SearchIcon width={14} height={14} />
          )}
        </View>
        <TextInput
          ref={inputRef}
          style={styles.input}
          placeholder={placeholder}
          placeholderTextColor={isDark ? colors.darkGray8 : colors.lightGray13}
          onFocus={onFocus}
          onBlur={onBlur}
          value={searchText}
          onChangeText={setSearchText}
          onSubmitEditing={onSubmitEditing}
        />
      </View>
      {showSuggestions && suggestions.length > 0 && (
        <>
          <View style={styles.divider} />
          <View style={styles.suggestionsWrapper}>
            {suggestions.map(suggestion => (
              <TouchableOpacity
                key={suggestion.id}
                style={styles.suggestionRow}
                activeOpacity={0.7}
                onPress={() => onSuggestionPress(suggestion)}>
                <SearchIcon width={16} height={16} />
                <Text style={styles.suggestionText}>{suggestion.text}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}
    </View>
  );
};

const getThemedStyles = (colorTheme: 'light' | 'dark') => {
  const isDark = colorTheme === 'dark';
  return ScaledSheet.create({
    searchBar: {
      backgroundColor: isDark ? colors.darkGray5 : colors.white,
      borderColor: isDark ? colors.darkGray11 : colors.lightGray4,
      borderWidth: 0.5,
      borderRadius: '60@ms',
      paddingVertical: '8@mvs',
      paddingHorizontal: '12@ms',
      flexDirection: 'row',
      alignItems: 'center',
      marginVertical: '10@mvs',
    },
    searchIconContainer: {
      width: '18@ms',
      height: '18@ms',
      alignItems: 'center',
      justifyContent: 'center',
    },
    input: {
      ...fontFamily.IBM_PLEX_SERIF.REGULAR,
      fontSize: '14@ms',
      marginLeft: '8@ms',
      flex: 1,
      color: isDark ? colors.white : colors.darkSlate,
      padding: 0,
    },
    suggestionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: '12@vs',
      paddingHorizontal: '20@s',
      backgroundColor: colors.white,
    },
    suggestionText: {
      ...fontFamily.IBM_PLEX_SERIF.REGULAR,
      fontSize: '16@ms',
      color: colors.gray99,
      marginLeft: '12@s',
    },
    cardContainer: {
      backgroundColor: colors.white,
      borderRadius: '12@ms',
      marginVertical: '0@mvs',
      borderWidth: 0,
    },
    divider: {
      borderBottomWidth: 0.6,
      borderColor: colors.lightGray4,
      height: 1,
      marginHorizontal: '8@s',
    },
    suggestionsWrapper: {
      paddingBottom: '8@vs',
    },
    baseContainer: {
      backgroundColor: colors.white,
      borderWidth: 0.5,
      borderColor: colors.lightGray4,
      borderRadius: '12@ms',
      padding: '1@s',
    },
  });
};
