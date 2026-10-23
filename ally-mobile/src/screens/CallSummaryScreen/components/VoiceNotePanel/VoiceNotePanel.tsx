import React, {useEffect, useState} from 'react';
import {ActivityIndicator, Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {DeleteIcon, MicIcon, PauseIcon, PlayIcon} from '@/assets/icons';
import {useTranslate} from '@/hooks';
import {VoiceRecorderStatus} from '@/hooks/useVoiceNoteRecorder';
import {colors, typography} from '@/theme';

interface VoiceNotePanelProps {
  status: VoiceRecorderStatus;
  /** Elapsed recorded time in milliseconds. */
  durationMs: number;
  isGenerating: boolean;
  /** Rotating status lines shown while generating (already translated). */
  generatingMessages: string[];
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onGenerate: () => void;
  onDiscard: () => void;
}

const formatDuration = (ms: number): string => {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

/**
 * The recording / generation surface for the manual scribe-note voice flow.
 * Presentational only — VoiceNoteSection owns the recorder and the generate
 * call and passes state + handlers in. Mirrors the web VoiceNotePanel.
 */
export const VoiceNotePanel: React.FC<VoiceNotePanelProps> = ({
  status,
  durationMs,
  isGenerating,
  generatingMessages,
  onPause,
  onResume,
  onStop,
  onGenerate,
  onDiscard,
}) => {
  const {t} = useTranslate();
  const [messageIndex, setMessageIndex] = useState(0);

  // Cycle the generating status lines so the user sees continuous progress.
  useEffect(() => {
    if (!isGenerating || generatingMessages.length <= 1) {
      setMessageIndex(0);
      return undefined;
    }
    const id = setInterval(() => {
      setMessageIndex(prev => (prev + 1) % generatingMessages.length);
    }, 2200);
    return () => clearInterval(id);
  }, [isGenerating, generatingMessages.length]);

  const isRecording = status === 'recording';
  const isPaused = status === 'paused';
  const isStopped = status === 'stopped';

  if (isGenerating) {
    return (
      <View style={styles.panel} testID="voice-note-generating">
        <View style={styles.generatingContent}>
          <ActivityIndicator size="small" color={colors.azureBlue} />
          <Text style={styles.statusText}>
            {generatingMessages[messageIndex] ??
              t('calls.createNote.voice.generating')}
          </Text>
        </View>
      </View>
    );
  }

  if (isRecording || isPaused) {
    return (
      <View style={styles.panel} testID="voice-note-recording">
        <View style={styles.statusBlock}>
          <View
            style={[
              styles.recordDot,
              isPaused ? styles.recordDotPaused : styles.recordDotActive,
            ]}
          />
          <View style={styles.statusTextBlock}>
            <Text style={styles.statusText}>
              {isRecording
                ? t('calls.createNote.voice.listening')
                : t('calls.createNote.voice.paused')}
            </Text>
            <Text style={styles.durationText}>
              {formatDuration(durationMs)}
            </Text>
          </View>
        </View>
        <View style={styles.controls}>
          {isRecording ? (
            <TouchableOpacity
              style={styles.ctrlButton}
              onPress={onPause}
              testID="voice-note-pause">
              <PauseIcon width={16} height={16} />
              <Text style={styles.ctrlText}>
                {t('calls.createNote.voice.pause')}
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.ctrlButton}
              onPress={onResume}
              testID="voice-note-resume">
              <PlayIcon width={16} height={16} />
              <Text style={styles.ctrlText}>
                {t('calls.createNote.voice.resume')}
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.ctrlButton, styles.stopButton]}
            onPress={onStop}
            testID="voice-note-stop">
            <View style={styles.stopSquare} />
            <Text style={[styles.ctrlText, styles.stopText]}>
              {t('calls.createNote.voice.stop')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (isStopped) {
    return (
      <View style={styles.panel} testID="voice-note-ready">
        <View style={styles.statusBlock}>
          <MicIcon width={18} height={18} />
          <View style={styles.statusTextBlock}>
            <Text style={styles.statusText}>
              {t('calls.createNote.voice.ready')}
            </Text>
            <Text style={styles.durationText}>
              {formatDuration(durationMs)}
            </Text>
          </View>
        </View>
        <View style={styles.controls}>
          <TouchableOpacity
            style={styles.ctrlButton}
            onPress={onDiscard}
            testID="voice-note-discard">
            <DeleteIcon width={16} height={16} />
            <Text style={styles.ctrlText}>
              {t('calls.createNote.voice.discard')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.ctrlButton, styles.generateButton]}
            onPress={onGenerate}
            testID="voice-note-generate">
            <Text style={[styles.ctrlText, styles.generateText]}>
              {t('calls.createNote.voice.generate')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return null;
};

const styles = ScaledSheet.create({
  panel: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.lightGray5,
    backgroundColor: colors.white,
    borderRadius: '8@ms',
    padding: '12@ms',
    marginHorizontal: '16@s',
    marginTop: '10@ms',
  },
  generatingContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10@ms',
    paddingVertical: '6@ms',
  },
  statusBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '10@ms',
    flexShrink: 1,
  },
  statusTextBlock: {
    flexShrink: 1,
  },
  recordDot: {
    width: '10@ms',
    height: '10@ms',
    borderRadius: '5@ms',
  },
  recordDotActive: {
    backgroundColor: colors.ds.red[400],
  },
  recordDotPaused: {
    backgroundColor: colors.ashGray,
  },
  statusText: {
    ...typography.body.small,
    color: colors.darkSlate,
  },
  durationText: {
    ...typography.body.small,
    color: colors.ashGray,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '8@ms',
  },
  ctrlButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '4@ms',
    borderWidth: 1,
    borderColor: colors.ashGray,
    borderRadius: '6@ms',
    paddingHorizontal: '10@ms',
    paddingVertical: '6@ms',
  },
  ctrlText: {
    ...typography.body.small,
    color: colors.darkSlate,
  },
  stopButton: {
    borderColor: colors.ds.red[400],
  },
  stopSquare: {
    width: '10@ms',
    height: '10@ms',
    borderRadius: '2@ms',
    backgroundColor: colors.ds.red[400],
  },
  stopText: {
    color: colors.ds.red[400],
  },
  generateButton: {
    backgroundColor: colors.azureBlue,
    borderColor: colors.azureBlue,
  },
  generateText: {
    color: colors.white,
  },
});
