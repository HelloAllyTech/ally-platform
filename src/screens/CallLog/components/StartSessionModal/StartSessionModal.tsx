import React, {useState} from 'react';
import {Modal, StyleSheet, Text, TouchableOpacity, View} from 'react-native';

import {CloseIcon} from '@/assets';
import {Button, NotificationModal, SecurityCarousel} from '@/components';
import {useTranslate} from '@/hooks';

import {styles} from './styles';

interface StartSessionModalProps {
  visible: boolean;
  onClose: () => void;
  onListenLive: (mode: 'scribe' | 'dictation') => void;
  hasMicrophoneChatType?: boolean;
  hasDictationChatType?: boolean;
}

export const StartSessionModal: React.FC<StartSessionModalProps> = ({
  visible,
  onClose,
  onListenLive,
  hasMicrophoneChatType,
  hasDictationChatType,
}) => {
  const {t} = useTranslate();
  const [showNotification, setShowNotification] = useState(false);
  const [selectedMode, setSelectedMode] = useState<'scribe' | 'dictation'>('scribe');

  const handleStart = (mode: 'scribe' | 'dictation') => {
    setSelectedMode(mode);
    setShowNotification(true);
  };

  const handleNotificationConfirm = () => {
    setShowNotification(false);
    onListenLive(selectedMode);
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
            {t('CallLogs.start')}{' '}
            <Text style={styles.titleItalic}>{t('CallLogs.session')}</Text>
          </Text>
          <View style={styles.carouselContainer}>
            <SecurityCarousel />
          </View>
          <Text style={styles.description}>
            {t('CallLogs.startSessionDescription')}
          </Text>

          <View style={styles.separator} />

          <View style={styles.optionRow}>
            <View style={styles.optionTextBlock}>
              <Text style={styles.optionTitle}>{t('CallLogs.listenLive')}</Text>
              <Text style={styles.optionSubtitle}>
                {t('CallLogs.allyWillHearAudio')}
              </Text>
            </View>
          </View>

          <View style={[styles.separator, styles.marginB16]} />

          {hasMicrophoneChatType && (
            <Button
              label={t('CallLogs.startScribeMode')}
              onPress={() => handleStart('scribe')}
              customContainerStyle={styles.ctaBtn}
            />
          )}

          {hasDictationChatType && (
            <Button
              label={t('CallLogs.startDictationMode')}
              onPress={() => handleStart('dictation')}
              customContainerStyle={[
                styles.ctaBtn,
                hasMicrophoneChatType ? { backgroundColor: 'white', borderWidth: 1, borderColor: '#007AFF', marginTop: 10 } : {},
              ]}
              customTextStyle={hasMicrophoneChatType ? { color: '#007AFF' } : {}}
            />
          )}

          <Text style={styles.consent}>{t('CallLogs.consentNotice')}</Text>
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
