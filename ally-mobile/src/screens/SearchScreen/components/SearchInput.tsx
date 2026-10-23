import React, {useEffect, useRef} from 'react';
import {
  StyleProp,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {CloseIcon, SearchActiveIcon, SearchIcon} from '@/assets/icons';
import {colors, fontFamily} from '@/theme';
import {ThemeMode} from '@/types';

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
  customStyles?: StyleProp<ViewStyle>;
  resetSearch: () => void;
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
  customStyles,
  colorTheme = 'light',
  resetSearch,
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
          showSuggestions && suggestions.length > 0 && styles.noBottomRadius,
          isFocused && !showSearchResults && styles.cardContainer,
          customStyles,
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
        {searchText.length > 0 && (
          <TouchableOpacity style={styles.closeButton} onPress={resetSearch}>
            <CloseIcon
              width={16}
              height={16}
              color={isDark ? colors.white : colors.black}
            />
          </TouchableOpacity>
        )}
      </View>
      {showSuggestions && suggestions.length > 0 && (
        <View
          style={[
            styles.suggestionsContainer,
            isFocused &&
              !showSearchResults &&
              styles.suggestionsContainerOffset,
          ]}>
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
        </View>
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
      borderRadius: '20@ms',
      paddingVertical: '8@mvs',
      paddingHorizontal: '12@ms',
      flexDirection: 'row',
      alignItems: 'center',
      marginVertical: '10@mvs',
      maxHeight: '40@ms',
    },
    noBottomRadius: {
      borderBottomLeftRadius: '0@ms',
      borderBottomRightRadius: '0@ms',
    },
    searchIconContainer: {
      width: '18@ms',
      height: '18@ms',
      alignItems: 'center',
      justifyContent: 'center',
    },
    closeButton: {
      width: '18@ms',
      height: '18@ms',
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: '8@ms',
    },
    input: {
      ...fontFamily.IBM_PLEX_SERIF.REGULAR,
      fontSize: '14@ms',
      marginLeft: '8@ms',
      flex: 1,
      height: '44@ms',
      color: isDark ? colors.white : colors.darkSlate,
      padding: 0,
    },
    suggestionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: '10@vs',
      paddingHorizontal: '16@s',
      width: '99%',
      backgroundColor: colors.white,
    },
    suggestionText: {
      ...fontFamily.IBM_PLEX_SERIF.REGULAR,
      fontSize: '16@ms',
      color: colors.gray99,
      marginLeft: '12@s',
    },
    cardContainer: {
      backgroundColor: isDark ? colors.darkGray5 : colors.white,
      borderRadius: '12@ms',
      marginTop: '4@mvs',
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
      backgroundColor: isDark ? colors.darkGray5 : colors.white,
      borderWidth: 0.5,
      borderColor: isDark ? colors.darkGray11 : colors.lightGray4,
      borderRadius: '12@ms',
    },
    suggestionsContainer: {
      position: 'absolute',
      backgroundColor: isDark ? colors.darkGray5 : colors.white,
      overflow: 'hidden',
      top: '46@mvs',
      left: '0@s',
      right: '0@s',
      zIndex: 1000,
      borderBottomLeftRadius: '12@ms',
      borderBottomRightRadius: '12@ms',
      borderWidth: 0.5,
      borderColor: isDark ? colors.darkGray11 : colors.lightGray4,
    },
    suggestionsContainerOffset: {
      left: -0.5,
      right: -0.5,
      top: '44@mvs',
    },
  });
};
