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
import {CHAT_TYPES, SCREEN_NAMES} from '@/constants';
import {useAppNavigation, useTranslate} from '@/hooks';

import {styles} from './styles';

type AllowedType =
  | CHAT_TYPES.EXOTEL_CONFERENCE_CHAT
  | CHAT_TYPES.MICROPHONE_CHAT
  | CHAT_TYPES.LEARN_CHAT;

interface StartSessionModalProps {
  visible: boolean;
  onClose: () => void;
  enabledChatTypes?: CHAT_TYPES[];
  onJoinCall: () => void;
  onListenLive: () => void;
}

// TODO: Remove once backend config is available
const DUMMY_ENABLED_CHAT_TYPES = [
  CHAT_TYPES.EXOTEL_CONFERENCE_CHAT,
  CHAT_TYPES.MICROPHONE_CHAT,
  CHAT_TYPES.LEARN_CHAT,
];

export const StartSessionModal: React.FC<StartSessionModalProps> = ({
  visible,
  onClose,
  enabledChatTypes = [],
  onJoinCall,
  onListenLive,
}) => {
  const {t} = useTranslate();
  const navigation = useAppNavigation();

  const allowedListeningTypes = useMemo<AllowedType[]>(() => {
    return [
      CHAT_TYPES.EXOTEL_CONFERENCE_CHAT,
      CHAT_TYPES.MICROPHONE_CHAT,
      CHAT_TYPES.LEARN_CHAT,
    ].filter(chatType =>
      // TODO: Remove and replace with enabledChatTypes once backend config is available
      DUMMY_ENABLED_CHAT_TYPES?.includes(chatType),
    ) as AllowedType[];
  }, []);

  const [selected, setSelected] = useState<AllowedType | null>(null);

  useEffect(() => {
    if (visible) {
      // preselect when only one option is available
      setSelected(
        allowedListeningTypes.length === 1 ? allowedListeningTypes[0] : null,
      );
    }
  }, [visible, allowedListeningTypes]);

  const handleStart = () => {
    switch (selected) {
      case CHAT_TYPES.EXOTEL_CONFERENCE_CHAT:
        onJoinCall();
        break;
      case CHAT_TYPES.MICROPHONE_CHAT:
        onListenLive();
        break;
      case CHAT_TYPES.LEARN_CHAT:
        navigation.navigate(SCREEN_NAMES.SIMULATIONS);
        break;
      default:
        break;
    }
    onClose();
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
          {allowedListeningTypes.length > 1 && (
            <Text style={styles.sectionLabel}>
              {t('CallLogs.chooseListening')}
            </Text>
          )}

          {allowedListeningTypes.length === 1 && (
            <View style={styles.separator} />
          )}

          {allowedListeningTypes.includes(
            CHAT_TYPES.EXOTEL_CONFERENCE_CHAT,
          ) && (
            <TouchableOpacity
              accessibilityRole="radio"
              style={[
                styles.optionRow,
                allowedListeningTypes.length === 1 && styles.singleOptionRow,
              ]}
              activeOpacity={0.7}
              onPress={() => setSelected(CHAT_TYPES.EXOTEL_CONFERENCE_CHAT)}>
              {allowedListeningTypes.length > 1 && (
                <View style={styles.radioOuter}>
                  {selected === CHAT_TYPES.EXOTEL_CONFERENCE_CHAT && (
                    <View style={styles.radioInner} />
                  )}
                </View>
              )}
              <View
                style={[
                  styles.optionTextBlock,
                  allowedListeningTypes.length === 1 &&
                    styles.singleOptionTextBlock,
                ]}>
                <Text style={styles.optionTitle}>{t('CallLogs.joinCall')}</Text>
                <Text style={styles.optionSubtitle}>
                  {t('CallLogs.allyWillJoinOngoingCall')}
                </Text>
              </View>
            </TouchableOpacity>
          )}

          {allowedListeningTypes.includes(CHAT_TYPES.MICROPHONE_CHAT) && (
            <TouchableOpacity
              accessibilityRole="radio"
              style={[
                styles.optionRow,
                allowedListeningTypes.length === 1 && styles.singleOptionRow,
              ]}
              activeOpacity={0.7}
              onPress={() => setSelected(CHAT_TYPES.MICROPHONE_CHAT)}>
              {allowedListeningTypes.length > 1 && (
                <View style={styles.radioOuter}>
                  {selected === CHAT_TYPES.MICROPHONE_CHAT && (
                    <View style={styles.radioInner} />
                  )}
                </View>
              )}
              <View
                style={[
                  styles.optionTextBlock,
                  allowedListeningTypes.length === 1 &&
                    styles.singleOptionTextBlock,
                ]}>
                <Text style={styles.optionTitle}>
                  {t('CallLogs.listenLive')}
                </Text>
                <Text style={styles.optionSubtitle}>
                  {t('CallLogs.allyWillHearAudio')}
                </Text>
              </View>
            </TouchableOpacity>
          )}

          {/* TODO: Learn option - always visible for now, remove this when backend config is available */}
          {allowedListeningTypes.includes(CHAT_TYPES.LEARN_CHAT) && (
            <TouchableOpacity
              accessibilityRole="radio"
              style={[
                styles.optionRow,
                allowedListeningTypes.length === 1 && styles.singleOptionRow,
              ]}
              activeOpacity={0.7}
              onPress={() => setSelected(CHAT_TYPES.LEARN_CHAT)}>
              {allowedListeningTypes.length > 1 && (
                <View style={styles.radioOuter}>
                  {selected === CHAT_TYPES.LEARN_CHAT && (
                    <View style={styles.radioInner} />
                  )}
                </View>
              )}
              <View
                style={[
                  styles.optionTextBlock,
                  allowedListeningTypes.length === 1 &&
                    styles.singleOptionTextBlock,
                ]}>
                <Text style={styles.optionTitle}>{t('CallLogs.learn')}</Text>
                <Text style={styles.optionSubtitle}>
                  {t('CallLogs.learnDescription')}
                </Text>
              </View>
            </TouchableOpacity>
          )}

          <View style={[styles.separator, styles.marginB16]} />

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
