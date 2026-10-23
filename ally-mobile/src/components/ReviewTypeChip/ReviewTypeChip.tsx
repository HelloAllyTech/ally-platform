import {useTranslation} from 'react-i18next';
import {Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {ReviewType} from '@/contexts/ReviewApiContext';
import {colors, fontFamily, radius, typography} from '@/theme';
import {capitalizeFirstLetter} from '@/utils';

interface ReviewTypeChipProps {
  reviewType: ReviewType;
}

const chipColorsByType = ScaledSheet.create({
  simulation: {
    backgroundColor: colors.ds.deepPurple[50],
  },
  scribe: {
    backgroundColor: colors.ds.orange[50],
  },
});

const chipTextColorsByType = ScaledSheet.create({
  simulation: {
    color: colors.ds.deepPurple[400],
  },
  scribe: {
    color: colors.ds.orange[900],
  },
});

export const ReviewTypeChip = ({reviewType}: ReviewTypeChipProps) => {
  const {t} = useTranslation();

  return (
    <View style={[styles.chip, chipColorsByType[reviewType]]}>
      <Text style={[styles.chipText, chipTextColorsByType[reviewType]]}>
        {t('review.feedCard.reviewType', {
          reviewType: capitalizeFirstLetter(reviewType),
        })}
      </Text>
    </View>
  );
};

const styles = ScaledSheet.create({
  chip: {
    alignSelf: 'flex-start',
    paddingVertical: '4@ms',
    paddingHorizontal: '8@ms',
    borderRadius: radius.lg,
  },
  chipText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.small,
  },
});
