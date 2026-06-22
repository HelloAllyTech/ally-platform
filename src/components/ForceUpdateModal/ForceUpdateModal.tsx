import React from 'react';
import {Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {ForceUpdateAlertIcon} from '@/assets';
import {Button} from '@/components';
import {useTranslate} from '@/hooks';
import {colors, fontFamily} from '@/theme';
import {ForceUpdateModalProps} from '@/types';
import {openAppStore} from '@/utils';

export const ForceUpdateModal: React.FC<ForceUpdateModalProps> = ({
  visible = false,
}) => {
  const {t} = useTranslate();

  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <View style={styles.modalContainer}>
        <Text style={styles.title}>
          {t('forceUpdate.title')}
          <Text style={styles.titleBold}>{t('forceUpdate.titleBold')}</Text>
        </Text>
        <View style={styles.iconContainer}>
          <ForceUpdateAlertIcon width={125} height={125} />
        </View>

        <Text style={styles.description}>{t('forceUpdate.description')}</Text>

        <Button
          label={t('forceUpdate.updateButton')}
          onPress={openAppStore}
          customContainerStyle={styles.updateButton}
          customTextStyle={styles.updateButtonText}
        />
      </View>
    </View>
  );
};

const styles = ScaledSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.blackTransparent50,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    left: 0,
    zIndex: 10000,
  },
  modalContainer: {
    backgroundColor: colors.white,
    borderRadius: '14@ms',
    padding: '24@ms',
    minWidth: '280@ms',
    width: '80%',
    maxWidth: '320@ms',
    alignItems: 'center',
    marginTop: '100@ms',
    shadowColor: colors.black,
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.25,
    shadowRadius: '8@ms',
    elevation: 8,
  },
  iconContainer: {
    marginBottom: '14@ms',
    alignItems: 'center',
  },
  title: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: colors.darkGray12,
    fontSize: '20@ms',
    textAlign: 'center',
    marginBottom: '4@ms',
  },
  titleBold: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
  },
  description: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '13@ms',
    color: colors.darkGray2,
    textAlign: 'center',
    lineHeight: '22@ms',
    marginBottom: '12@ms',
  },
  versionContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    marginBottom: '12@ms',
    paddingHorizontal: '16@ms',
  },
  versionLabel: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '14@ms',
    color: colors.darkGray2,
  },
  versionText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '14@ms',
    color: colors.brightBlue,
    fontWeight: '700',
  },
  updateButton: {
    paddingVertical: '8@ms',
    paddingHorizontal: '20@ms',
    width: '150@ms',
    backgroundColor: colors.brightBlue,
  },
  updateButtonText: {
    ...fontFamily.ROBOTO.REGULAR,
    color: colors.white,
  },
});
