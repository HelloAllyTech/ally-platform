import {FlatList, Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {ASK_AI_EMPTY_STATE_QUESTIONS} from '@/constants';
import {useTranslate} from '@/hooks';
import {colors, fontFamily, typography} from '@/theme';

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
        onPress={() => onQuestionSelection(item)}>
        <Text style={styles.initialStateItemText}>{item}</Text>
      </TouchableOpacity>
    );
  };

  const renderInitialStateItemSeparator = () => {
    return <View style={styles.initialStateItemSeparator} />;
  };

  return (
    <View style={styles.initialStateContainer}>
      <Text style={styles.initialStateItemText}>
        {t('SimulationFeedback.askAIInitialStateTitle')}
      </Text>
      <FlatList
        data={ASK_AI_EMPTY_STATE_QUESTIONS}
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
    marginTop: 'auto',
    gap: '8@ms',
  },
  initialStateItem: {
    padding: '12@ms',
    gap: '8@ms',
    borderRadius: '8@ms',
    borderWidth: '0.5@ms',
    maxWidth: '200@ms',
    borderColor: colors.ds.stroke.primary,
    backgroundColor: colors.ds.neutral.white,
    shadowColor: '#A09E9E',
    shadowOffset: {width: 2, height: 3},
    shadowOpacity: 0.1,
    shadowRadius: 7.81,
    elevation: 4,
  },
  initialStateItemText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.small,
    color: colors.ds.typography.highEmphasis,
  },
  initialStateItemSeparator: {
    width: '4@ms',
  },
});
