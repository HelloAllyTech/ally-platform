import React from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {useTranslate} from '@/hooks/useTranslate';
import {colors, fontFamily, radius, typography} from '@/theme';

interface PrivacyToggleProps {
  isPrivate: boolean;
  onToggle: (isPrivate: boolean) => void;
}

export const PrivacyToggle: React.FC<PrivacyToggleProps> = ({
  isPrivate,
  onToggle,
}) => {
  const {t} = useTranslate();

  return (
    <View style={styles.outerContainer}>
      <View style={styles.innerContainer}>
        <TouchableOpacity
          style={[styles.option, isPrivate && styles.activeOption]}
          onPress={() => onToggle(true)}
          activeOpacity={0.9}>
          <Text style={[styles.text, isPrivate && styles.activeText]}>
            {t('review.privacy.private')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.option, !isPrivate && styles.activeOption]}
          onPress={() => onToggle(false)}
          activeOpacity={0.9}>
          <Text style={[styles.text, !isPrivate && styles.activeText]}>
            {t('postSim.common.shareForReview')}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = ScaledSheet.create({
  outerContainer: {
    backgroundColor: colors.ds.neutral.white,
    borderRadius: radius.full,
    borderWidth: '0.5@ms',
    borderColor: colors.ds.stroke.primary,
    padding: '8@ms',
    alignSelf: 'center',
    marginBottom: '16@ms',
    shadowColor: colors.black,
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 1,
  },
  innerContainer: {
    flexDirection: 'row',
    backgroundColor: colors.lightGray1,
    borderRadius: radius.full,
    borderWidth: '0.5@ms',
    borderColor: colors.ds.stroke.primary,
  },
  option: {
    paddingVertical: '10@ms',
    paddingHorizontal: '24@ms',
    borderRadius: '100@ms',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '140@ms',
  },
  activeOption: {
    backgroundColor: colors.ds.neutral.white,
    shadowColor: colors.black,
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 1,
  },
  text: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.small,
    color: colors.ds.typography.mediumEmphasis,
  },
  activeText: {
    color: colors.ds.typography.highEmphasis,
  },
});
