import React from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {BlueWarningIcon, CloseIcon} from '@/assets/icons';
import {DEFAULT_HIT_SLOP} from '@/constants';
import {useTranslate} from '@/hooks';
import {colors, fontFamily} from '@/theme';

interface ExotelFocusBannerProps {
  onClose: () => void;
}

export const DismissableBanner: React.FC<ExotelFocusBannerProps> = ({
  onClose,
}) => {
  const {t} = useTranslate();

  return (
    <View style={styles.container} accessibilityRole="summary">
      <View style={styles.contentWrapper}>
        <BlueWarningIcon width={18} height={16} />
        <Text style={styles.text}>
          {t('listeningScreen.scribeStopTakingNotesBanner')}
        </Text>
      </View>
      <TouchableOpacity
        onPress={onClose}
        hitSlop={DEFAULT_HIT_SLOP}
        activeOpacity={0.8}>
        <CloseIcon width={18} height={18} />
      </TouchableOpacity>
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.lightBlue5,
    borderRadius: '8@s',
    paddingVertical: '10@vs',
    paddingHorizontal: '12@s',
    marginHorizontal: '20@s',
    marginTop: '50@vs',
  },
  contentWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '10@s',
    flex: 1,
    paddingRight: '8@s',
  },
  text: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    color: colors.charcoal,
    flexShrink: 1,
  },
});
