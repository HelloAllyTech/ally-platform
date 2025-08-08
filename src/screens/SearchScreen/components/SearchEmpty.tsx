import {Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {SearchActiveIcon, SearchIcon} from '@/assets/icons';
import {useTranslate} from '@/hooks';
import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';

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
      <Text style={themedStyles.emptyComponentText}>
        {`${t('SearchScreen.noData')} "${searchText}"`}
      </Text>
      <Text style={themedStyles.tryText}>{t('SearchScreen.try')}</Text>
      {trySuggestions.map(suggestion => (
        <TouchableOpacity
          activeOpacity={0.8}
          key={suggestion.id}
          style={themedStyles.trySuggestion}
          onPress={() => onPressSuggestion(suggestion.text)}>
          {colorTheme === 'dark' ? (
            <SearchActiveIcon width={14} height={14} color={colors.darkGray8} />
          ) : (
            <SearchIcon width={14} height={14} />
          )}
          <Text style={themedStyles.suggestionText}>{suggestion.text}</Text>
        </TouchableOpacity>
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
    trySuggestion: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: '18@ms',
      marginLeft: '16@ms',
    },
    suggestionText: {
      ...fontFamily.IBM_PLEX_SERIF.REGULAR,
      color: isDark ? colors.gray99 : colors.darkGray6,
      fontSize: '14@ms',
      lineHeight: '20@ms',
      marginLeft: '10@ms',
    },
  });
};
