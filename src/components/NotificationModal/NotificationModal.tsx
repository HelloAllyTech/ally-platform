import React from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {CloseIcon} from '@/assets';
import {Button} from '@/components';
import {SIMULATION_START_NOTIFICATION} from '@/constants';
import {colors, fontFamily} from '@/theme';

export interface NotificationModalProps {
  visible: boolean;
  onConfirm: () => void;
  onClose?: () => void;
}

export const NotificationModal: React.FC<NotificationModalProps> = ({
  visible,
  onConfirm,
  onClose,
}) => {
  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <View style={styles.modalContainer}>
        {onClose && (
          <TouchableOpacity
            onPress={onClose}
            style={styles.closeButton}
            testID="close-button"
            hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}>
            <CloseIcon width={24} height={24} color={colors.black} />
          </TouchableOpacity>
        )}
        <Text style={styles.title}>
          <Text style={styles.titleMain}>
            {SIMULATION_START_NOTIFICATION.TITLE.split(' ')[0]}{' '}
          </Text>
          <Text style={styles.titleItalic}>
            {SIMULATION_START_NOTIFICATION.TITLE.split(' ').slice(1).join(' ')}
          </Text>
        </Text>

        <Text style={styles.description}>
          {SIMULATION_START_NOTIFICATION.DESCRIPTION}
        </Text>

        <Button
          label={SIMULATION_START_NOTIFICATION.START_SESSION}
          onPress={onConfirm}
          customContainerStyle={styles.actionButton}
          customTextStyle={styles.actionButtonText}
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
    zIndex: 1001,
  },
  modalContainer: {
    backgroundColor: colors.white,
    borderRadius: '12@ms',
    padding: '20@s',
    minWidth: '280@ms',
    maxWidth: '85%',
    alignItems: 'center',
  },
  closeButton: {
    position: 'absolute',
    top: '10@ms',
    right: '10@ms',
    zIndex: 1,
  },
  title: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    color: colors.darkGray12,
    fontSize: '20@ms',
    textAlign: 'center',
    marginBottom: '16@mvs',
    marginTop: '8@mvs',
  },
  titleMain: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
  },
  titleItalic: {
    ...fontFamily.REPLAY_PRO.BOLD_ITALIC,
  },
  description: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    color: colors.black,
    textAlign: 'center',
    marginBottom: '20@mvs',
    lineHeight: '22@mvs',
  },
  actionButton: {
    width: '100%',
    backgroundColor: colors.azureBlue,
    borderRadius: '24@ms',
    paddingVertical: '16@mvs',
    paddingHorizontal: '24@ms',
  },
  actionButtonText: {
    color: colors.white,
    fontWeight: '600',
  },
});
