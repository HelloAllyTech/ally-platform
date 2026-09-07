import React from 'react';
import {Modal, StyleSheet, Text, TouchableOpacity, View} from 'react-native';

import {CloseIcon} from '@/assets';
import {Button} from '@/components';
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
  /** Microphone permission is being resolved; the sheet stays up meanwhile. */
  isStartingScribe?: boolean;
}

/**
 * Picks how to start a session, and doubles as the consent gate for scribe.
 *
 * Starting scribe used to take three taps: this sheet, then a second dialog,
 * then start. That second dialog was the *roleplay* pre-start warning ("the bot
 * may be unresponsive, or have unusual lag times") — scribe has no bot, it
 * listens and transcribes, so the copy was simply wrong. It's gone.
 *
 * Consent is why this sheet still exists: the counsellor reads the consent line
 * and taps a mode, and that tap is the confirmation. Keep the consent text
 * directly above the actions — it must not drift into a footnote.
 */
export const StartSessionModal: React.FC<StartSessionModalProps> = ({
  visible,
  onClose,
  onListenLive,
  hasMicrophoneChatType,
  showCreateNote,
  onCreateNote,
  isCreatingNote,
  isStartingScribe,
}) => {
  const {t} = useTranslate();

  /**
   * Deliberately does NOT close the sheet. Starting scribe has to resolve the
   * microphone permission first, and closing here meant the sheet vanished the
   * instant it was tapped and the counsellor was left looking at the call log
   * with nothing happening — indistinguishable from a frozen app if the
   * permission call never came back. The sheet now stays up, showing the tap was
   * received, and the caller closes it once it knows where it is going.
   */
  const handleStartScribe = () => {
    onListenLive();
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

          <Text
            style={[styles.consent, styles.marginB16]}
            testID="start-session-consent">
            {t('calls.dialog.startSession.footer')}
          </Text>

          {hasMicrophoneChatType && (
            <Button
              testID="start-session-scribe-mode"
              label={t('calls.dialog.startSession.startScribeMode')}
              onPress={handleStartScribe}
              isLoading={isStartingScribe}
              isDisabled={isStartingScribe || isCreatingNote}
              customContainerStyle={styles.ctaBtn}
            />
          )}

          {showCreateNote && (
            <Button
              testID="start-session-create-note"
              label={t('calls.dialog.startSession.startDictationMode')}
              onPress={() => onCreateNote?.()}
              isLoading={isCreatingNote}
              isDisabled={isStartingScribe || isCreatingNote}
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
        </View>
      </View>
    </Modal>
  );
};
