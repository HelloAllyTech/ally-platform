import React, {useEffect, useMemo, useState} from 'react';
import {
  Image,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import {CloseIcon} from '@/assets/icons';
import images from '@/assets/images';
import {PrimaryButton} from '@/components';
import {CHAT_TYPES} from '@/constants';
import {useTranslate} from '@/hooks';

import {styles} from './styles';

type AllowedType =
  | CHAT_TYPES.EXOTEL_CONFERENCE_CHAT
  | CHAT_TYPES.MICROPHONE_CHAT;

interface StartSessionModalProps {
  visible: boolean;
  onClose: () => void;
  enabledChatTypes?: CHAT_TYPES[];
  onJoinCall: () => void;
  onListenLive: () => void;
}

export const StartSessionModal: React.FC<StartSessionModalProps> = ({
  visible,
  onClose,
  enabledChatTypes = [],
  onJoinCall,
  onListenLive,
}) => {
  const {t} = useTranslate();

  const allowedTypes = useMemo<AllowedType[]>(() => {
    return [
      CHAT_TYPES.EXOTEL_CONFERENCE_CHAT,
      CHAT_TYPES.MICROPHONE_CHAT,
    ].filter(chatType => enabledChatTypes?.includes(chatType)) as AllowedType[];
  }, [enabledChatTypes]);

  const [selected, setSelected] = useState<AllowedType | null>(null);

  useEffect(() => {
    if (visible) {
      // preselect when only one option is available
      setSelected(allowedTypes.length === 1 ? allowedTypes[0] : null);
    }
  }, [visible, allowedTypes]);

  const handleStart = () => {
    if (selected === CHAT_TYPES.EXOTEL_CONFERENCE_CHAT) {
      onJoinCall();
      onClose();
      return;
    }
    if (selected === CHAT_TYPES.MICROPHONE_CHAT) {
      onListenLive();
      onClose();
    }
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
          <Image source={images.conversation} style={styles.illustration} />
          <Text style={styles.description}>
            {t('CallLogs.startSessionDescription')}
          </Text>
          <Text style={styles.sectionLabel}>
            {t('CallLogs.chooseListening')}
          </Text>

          {allowedTypes.includes(CHAT_TYPES.EXOTEL_CONFERENCE_CHAT) && (
            <TouchableOpacity
              accessibilityRole="radio"
              style={styles.optionRow}
              activeOpacity={0.7}
              onPress={() => setSelected(CHAT_TYPES.EXOTEL_CONFERENCE_CHAT)}>
              <View style={styles.radioOuter}>
                {selected === CHAT_TYPES.EXOTEL_CONFERENCE_CHAT && (
                  <View style={styles.radioInner} />
                )}
              </View>
              <View style={styles.optionTextBlock}>
                <Text style={styles.optionTitle}>{t('CallLogs.joinCall')}</Text>
                <Text style={styles.optionSubtitle}>
                  {t('CallLogs.allyWillJoinOngoingCall')}
                </Text>
              </View>
            </TouchableOpacity>
          )}

          {allowedTypes.includes(CHAT_TYPES.MICROPHONE_CHAT) && (
            <TouchableOpacity
              accessibilityRole="radio"
              style={styles.optionRow}
              activeOpacity={0.7}
              onPress={() => setSelected(CHAT_TYPES.MICROPHONE_CHAT)}>
              <View style={styles.radioOuter}>
                {selected === CHAT_TYPES.MICROPHONE_CHAT && (
                  <View style={styles.radioInner} />
                )}
              </View>
              <View style={styles.optionTextBlock}>
                <Text style={styles.optionTitle}>
                  {t('CallLogs.listenLive')}
                </Text>
                <Text style={styles.optionSubtitle}>
                  {t('CallLogs.allyWillHearAudio')}
                </Text>
              </View>
            </TouchableOpacity>
          )}

          <View style={styles.separator} />

          <PrimaryButton
            label={t('CallLogs.startSessionNow')}
            onPress={handleStart}
            customContainerStyle={[
              styles.ctaBtn,
              !selected && styles.ctaBtnDisabled,
            ]}
            isDisabled={!selected}
          />

          <Text style={styles.consent}>{t('CallLogs.consentNotice')}</Text>
        </View>
      </View>
    </Modal>
  );
};
