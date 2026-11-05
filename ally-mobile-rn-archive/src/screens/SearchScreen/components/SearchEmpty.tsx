import React from 'react';
import {Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {SearchActiveIcon, SearchIcon} from '@/assets/icons';
import {useTranslate} from '@/hooks';
import {colors, fontFamily} from '@/theme';

import {SearchSuggestion} from './SearchSuggestions';

interface SearchEmptyProps {
  searchText: string;
  trySuggestions: {id: number; text: string}[];
  colorTheme: 'light' | 'dark';
  onPressSuggestion: (suggestion: string) => void;
}

export const SearchEmpty: React.FC<SearchEmptyProps> = ({
  searchText,
  trySuggestions,
  colorTheme = 'light',
  onPressSuggestion,
}) => {
  const {t} = useTranslate();
  const themedStyles = getThemedStyles(colorTheme);

  return (
    <View style={themedStyles.emptyComponent}>
      {searchText.length > 0 && (
        <Text style={themedStyles.emptyComponentText}>
          {`${t('search.noResults')} "${searchText}"`}
        </Text>
      )}
      <Text style={themedStyles.tryText}>{t('search.suggestionsTitle')}</Text>
      {trySuggestions.map(suggestion => (
        <React.Fragment key={suggestion.id}>
          <View style={themedStyles.marginL16}>
            <SearchSuggestion
              colorTheme={colorTheme}
              icon={
                colorTheme === 'dark' ? (
                  <SearchActiveIcon
                    width={14}
                    height={14}
                    color={colors.darkGray8}
                  />
                ) : (
                  <SearchIcon width={14} height={14} />
                )
              }
              text={suggestion.text}
              onPressSuggestion={() => onPressSuggestion(suggestion.text)}
              suggestionId={suggestion.id}
            />
          </View>
        </React.Fragment>
      ))}
    </View>
  );
};

const getThemedStyles = (colorTheme: 'light' | 'dark') => {
  const isDark = colorTheme === 'dark';
  return ScaledSheet.create({
    emptyComponent: {
      flex: 1,
      paddingVertical: '32@vs',
    },
    emptyComponentText: {
      ...fontFamily.IBM_PLEX_SERIF.REGULAR,
      color: isDark ? colors.gray99 : colors.lightGray12,
      fontSize: '14@ms',
      lineHeight: '20@ms',
      marginLeft: '16@ms',
    },
    tryText: {
      ...fontFamily.IBM_PLEX_SERIF.REGULAR,
      color: isDark ? colors.white : colors.black,
      fontSize: '14@ms',
      lineHeight: '20@ms',
      marginLeft: '16@ms',
      marginTop: '18@ms',
      marginBottom: '10@ms',
    },
    marginL16: {
      marginLeft: '16@ms',
    },
  });
};
