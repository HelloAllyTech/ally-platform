import {FlatList, Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {ArrowUpRight} from '@/assets';
import {ASK_AI_EMPTY_STATE_QUESTIONS} from '@/constants';
import {useTranslate} from '@/hooks';
import {colors, fontFamily, radius, typography} from '@/theme';

interface AskAiInitialStateProps {
  onQuestionSelection: (question: string) => void;
}

export const AskAiInitialState = ({
  onQuestionSelection,
}: AskAiInitialStateProps) => {
  const {t} = useTranslate();
  const renderInitialStateItem = ({item}: {item: string}) => {
    return (
      <TouchableOpacity
        style={styles.initialStateItem}
        onPress={() => onQuestionSelection(item)}
        activeOpacity={0.7}>
        <Text style={styles.initialStateItemText}>{item}</Text>
        <View style={styles.initialStateItemArrowButton}>
          <ArrowUpRight width={16} height={16} />
        </View>
      </TouchableOpacity>
    );
  };

  const renderInitialStateItemSeparator = () => {
    return <View style={styles.initialStateItemSeparator} />;
  };

  return (
    <View style={styles.initialStateContainer}>
      <Text
        style={[
          styles.initialStateItemHeaderText,
          styles.initialStateItemTitle,
        ]}>
        {t('askAi.initial.titlePrefix')}
        <Text
          style={[
            styles.initialStateItemHeaderText,
            styles.initialStateItemSubtitle,
          ]}>
          {t('askAi.initial.titleSuffix')}
        </Text>
      </Text>
      <Text style={styles.initialStateItemDescription}>
        {t('askAi.initial.subtitle')}
      </Text>
      <FlatList
        data={ASK_AI_EMPTY_STATE_QUESTIONS}
        contentContainerStyle={styles.initialStateItemsContainer}
        horizontal
        showsHorizontalScrollIndicator={false}
        renderItem={renderInitialStateItem}
        ItemSeparatorComponent={renderInitialStateItemSeparator}
      />
    </View>
  );
};

const styles = ScaledSheet.create({
  initialStateContainer: {
    gap: '8@ms',
    marginVertical: 'auto',
  },
  initialStateItemsContainer: {
    paddingVertical: '24@ms',
  },
  initialStateItem: {
    paddingHorizontal: '16@ms',
    paddingVertical: '24@ms',
    gap: '8@ms',
    borderRadius: '8@ms',
    borderWidth: '0.5@ms',
    maxWidth: '160@ms',
    borderColor: colors.ds.stroke.primary,
    backgroundColor: colors.ds.neutral.white,
    shadowColor: '#A09E9E',
    shadowOffset: {width: 12, height: 16},
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 12,
  },
  initialStateItemText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.typography.highEmphasis,
  },
  initialStateItemHeaderText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.headline.large,
    color: colors.ds.typography.highEmphasis,
  },
  initialStateItemTitle: {
    color: colors.ds.typography.lowEmphasis,
  },
  initialStateItemSubtitle: {
    color: colors.ds.typography.mediumEmphasis,
  },
  initialStateItemSeparator: {
    width: '16@ms',
  },
  initialStateItemDescription: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.small,
    color: colors.ds.typography.mediumEmphasis,
  },
  initialStateItemArrowButton: {
    alignSelf: 'flex-end',
    width: '36@ms',
    height: '36@ms',
    borderRadius: radius.full,
    backgroundColor: colors.ds.theme.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 'auto',
  },
});
