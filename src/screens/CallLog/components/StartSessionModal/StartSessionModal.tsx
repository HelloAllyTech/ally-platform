import React, {useState} from 'react';
import {Modal, StyleSheet, Text, TouchableOpacity, View} from 'react-native';

import {CloseIcon} from '@/assets';
import {Button, NotificationModal, SecurityCarousel} from '@/components';
import {useTranslate} from '@/hooks';

import {styles} from './styles';

interface StartSessionModalProps {
  visible: boolean;
  onClose: () => void;
  onListenLive: () => void;
  hasMicrophoneChatType?: boolean;
  /** Tenant toggle + counsellor permission gate (see useScribeNoteCreationEnabled). */
  showCreateNote?: boolean;
  onCreateNote?: () => void;
  isCreatingNote?: boolean;
}

export const StartSessionModal: React.FC<StartSessionModalProps> = ({
  visible,
  onClose,
  onListenLive,
  hasMicrophoneChatType,
  showCreateNote,
  onCreateNote,
  isCreatingNote,
}) => {
  const {t} = useTranslate();
  const [showNotification, setShowNotification] = useState(false);

  const handleStart = () => {
    setShowNotification(true);
  };

  const handleNotificationConfirm = () => {
    setShowNotification(false);
    onListenLive();
    onClose();
  };

  const handleNotificationCancel = () => {
    setShowNotification(false);
  };

  if (!visible) return null;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      presentationStyle="overFullScreen">
      <View style={[StyleSheet.absoluteFill, styles.overlay]}>
        <View style={styles.container}>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <CloseIcon />
          </TouchableOpacity>
          <Text style={styles.title}>
            {t('calls.dialog.startSession.titleNormal')}{' '}
            <Text style={styles.titleItalic}>
              {t('calls.dialog.startSession.titleItalic')}
            </Text>
          </Text>
          <View style={styles.carouselContainer}>
            <SecurityCarousel />
          </View>
          <Text style={styles.description}>
            {t('calls.dialog.startSession.description1')}
          </Text>

          <View style={styles.separator} />

          <View style={styles.optionRow}>
            <View style={styles.optionTextBlock}>
              <Text style={styles.optionTitle}>
                {t('calls.dialog.startSession.embedTitle')}
              </Text>
              <Text style={styles.optionSubtitle}>
                {t('calls.dialog.startSession.embedDesc')}
              </Text>
            </View>
          </View>

          <View style={[styles.separator, styles.marginB16]} />

          {hasMicrophoneChatType && (
            <Button
              label={t('calls.dialog.startSession.startScribeMode')}
              onPress={handleStart}
              customContainerStyle={styles.ctaBtn}
            />
          )}

          {showCreateNote && (
            <Button
              testID="start-session-create-note"
              label={t('calls.createNote.button')}
              onPress={() => onCreateNote?.()}
              isLoading={isCreatingNote}
              customContainerStyle={[
                styles.ctaBtn,
                hasMicrophoneChatType
                  ? {
                      backgroundColor: 'white',
                      borderWidth: 1,
                      borderColor: '#007AFF',
                      marginTop: 10,
                    }
                  : {},
              ]}
              customTextStyle={hasMicrophoneChatType ? {color: '#007AFF'} : {}}
            />
          )}

          <Text style={styles.consent}>
            {t('calls.dialog.startSession.footer')}
          </Text>
        </View>
      </View>
      <NotificationModal
        visible={showNotification}
        onConfirm={handleNotificationConfirm}
        onClose={handleNotificationCancel}
      />
    </Modal>
  );
};
