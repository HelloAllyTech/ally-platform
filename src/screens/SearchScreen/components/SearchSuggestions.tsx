import React from 'react';
import {Text, TouchableOpacity} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';

interface SearchSuggestionProps {
  colorTheme?: 'dark' | 'light';
  icon: React.ReactNode;
  text: string;
  onPressSuggestion: (suggestionId: number) => void;
  suggestionId: number;
}

export const SearchSuggestion: React.FC<SearchSuggestionProps> = ({
  colorTheme = 'light',
  icon,
  text,
  onPressSuggestion,
  suggestionId,
}) => {
  const themedStyles = getThemedStyles(colorTheme);
  return (
    <TouchableOpacity
      style={themedStyles.container}
      onPress={() => onPressSuggestion(suggestionId)}>
      {icon}
      <Text style={themedStyles.text}>{text}</Text>
    </TouchableOpacity>
  );
};

const getThemedStyles = (colorScheme: string | null) => {
  const isDark = colorScheme === 'dark';
  return ScaledSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 0.5,
      borderRadius: '8@ms',
      paddingVertical: '8@mvs',
      paddingHorizontal: '16@ms',
      marginBottom: '16@mvs',
      alignSelf: 'flex-start',
      borderColor: isDark ? colors.darkGray4 : colors.lightGray14,
      backgroundColor: isDark ? colors.darkGray5 : colors.white,
    },
    text: {
      ...fontFamily.IBM_PLEX_SERIF.REGULAR,
      fontSize: '14@ms',
      lineHeight: '20@ms',
      marginLeft: '12@s',
      fontWeight: '400',
      color: isDark ? colors.lightGray14 : colors.gray99,
    },
  });
};
