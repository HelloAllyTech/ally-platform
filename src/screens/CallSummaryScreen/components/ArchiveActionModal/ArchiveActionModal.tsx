import React, {useCallback} from 'react';
import {Modal, Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {CloseIcon} from '@/assets';
import {Button, useErrorToast} from '@/components';
import {useTranslate} from '@/hooks';
import {
  colors,
  fontFamily,
  fontWeights,
  typography,
  typographyColors,
} from '@/theme';

interface ArchiveActionModalProps {
  visible: boolean;
  onClose: () => void;
  actionType: 'archive' | 'unarchive' | null;
  setActionType: (actionType: 'archive' | 'unarchive' | null) => void;
  onArchive: (archive: boolean) => void;
}
export const ArchiveActionModal = React.memo(
  ({
    visible,
    onClose,
    actionType,
    setActionType,
    onArchive,
  }: ArchiveActionModalProps) => {
    const {t} = useTranslate();
    const {showErrorToast} = useErrorToast();

    const title =
      actionType === 'archive'
        ? t('CallSummary.archiveActionModal.archive.header.title')
        : t('CallSummary.archiveActionModal.unarchive.header.title');
    const subtitle =
      actionType === 'archive'
        ? t('CallSummary.archiveActionModal.archive.header.subtitle')
        : t('CallSummary.archiveActionModal.unarchive.header.subtitle');
    const description =
      actionType === 'archive'
        ? t('CallSummary.archiveActionModal.archive.description')
        : t('CallSummary.archiveActionModal.unarchive.description');
    const confirm =
      actionType === 'archive'
        ? t('CallSummary.archiveActionModal.archive.confirm')
        : t('CallSummary.archiveActionModal.unarchive.confirm');
    const cancel =
      actionType === 'archive'
        ? t('CallSummary.archiveActionModal.archive.cancel')
        : t('CallSummary.archiveActionModal.unarchive.cancel');

    const onConfirm = useCallback(async () => {
      try {
        await onArchive(actionType === 'archive');
        actionType === 'archive'
          ? setActionType('unarchive')
          : setActionType('archive');
      } catch (error) {
        showErrorToast(
          error,
          actionType === 'archive'
            ? 'CallSummary.archiveActionModal.archive.failed'
            : 'CallSummary.archiveActionModal.unarchive.failed',
        );
      } finally {
        onClose();
      }
    }, [actionType, onClose, onArchive, showErrorToast, setActionType]);

    return (
      <Modal
        visible={visible}
        onRequestClose={onClose}
        transparent
        animationType="fade"
        statusBarTranslucent>
        <View style={styles.overlay}>
          <View style={styles.container}>
            <TouchableOpacity style={styles.closeButton} onPress={onClose}>
              <CloseIcon />
            </TouchableOpacity>
            <View style={styles.header}>
              <Text style={styles.title}>{title} </Text>
              <Text style={styles.subtitle}>{subtitle}</Text>
            </View>
            <Text style={styles.description}>{description}</Text>
            <View style={styles.buttonContainer}>
              <Button
                label={cancel}
                onPress={onClose}
                variant="secondary"
                customContainerStyle={styles.button}
              />
              <Button
                label={confirm}
                onPress={onConfirm}
                variant={actionType === 'archive' ? 'destructive' : 'primary'}
                customContainerStyle={styles.button}
              />
            </View>
          </View>
        </View>
      </Modal>
    );
  },
);

const styles = ScaledSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.blackTransparent50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    backgroundColor: colors.white,
    borderRadius: '12@ms',
    padding: '16@s',
    maxWidth: '80%',
    alignItems: 'center',
    gap: '10@ms',
  },
  closeButton: {
    position: 'absolute',
    top: '8@ms',
    right: '8@ms',
    width: '24@ms',
    height: '24@ms',
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '4@ms',
    marginBottom: '10@mvs',
  },
  title: {
    ...fontFamily.REPLAY_PRO.HEADLINE,
    color: colors.darkGray12,
    ...typography.body.large,
  },
  subtitle: {
    ...fontFamily.REPLAY_PRO.BOLD_ITALIC,
    color: colors.darkGray12,
    ...typography.body.large,
  },
  description: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    color: typographyColors.mediumEmphasis,
    ...typography.body.small,
    fontWeight: fontWeights.regular,
    textAlign: 'center',
    marginBottom: '10@mvs',
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: '12@ms',
    width: '100%',
  },
  button: {
    flex: 1,
  },
});
