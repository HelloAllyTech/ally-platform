import React from 'react';
import LottieView from 'lottie-react-native';
import {Text, View} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';

import {animations, RankBadgeIcon} from '@/assets';
import {useTranslate} from '@/hooks';
import {colors} from '@/theme';

import {styles} from './styles';
import {AskAIChatMessage, Citation} from './types';

// ── User Bubble ─────────────────────────────────────────────────

export const UserMessageBubble: React.FC<{
  message: AskAIChatMessage;
}> = React.memo(({message}) => (
  <View style={styles.questionBubble}>
    <Text style={styles.questionText}>{message.content}</Text>
  </View>
));

// ── Citations Table ─────────────────────────────────────────────

export const CitationsTable: React.FC<{
  citations: Citation[];
  clientLabel: string;
  youLabel: string;
}> = React.memo(({citations, clientLabel, youLabel}) => {
  const {t} = useTranslate();
  return (
    <View style={styles.citationsContainer}>
      <Text style={styles.citationsHeader}>
        {t('askAi.transcriptReferences')}
      </Text>
      {citations.map(citation => (
        <View key={citation.transcriptId} style={styles.citationRow}>
          <Text style={styles.citationTimestamp}>{citation.timestamp}</Text>
          <Text style={styles.citationContent}>
            <Text style={styles.citationSpeaker}>
              {citation.senderId === -1 ? clientLabel : youLabel}:{' '}
            </Text>
            {citation.content}
          </Text>
        </View>
      ))}
    </View>
  );
});

// ── AI Bubble ───────────────────────────────────────────────────

export const AIMessageBubble: React.FC<{
  message: AskAIChatMessage;
  clientName: string;
}> = React.memo(({message, clientName}) => {
  const {t} = useTranslate();
  const clientLabel = clientName
    ? `${clientName} (${t('transcription.aiClientSuffix')})`
    : t('transcription.aiClientSuffix');
  const youLabel = t('transcription.youLabel');
  const showCitations =
    !message.isStreaming && message.citations && message.citations.length > 0;

  return (
    <View style={styles.responseContainer}>
      <View style={styles.rankBadgeContainer}>
        <LinearGradient
          colors={[colors.ds.blue[50], colors.white]}
          start={{x: 0, y: 0}}
          end={{x: 0, y: 1}}
          style={styles.rankBadgeGradient}>
          <RankBadgeIcon width={9} height={9} />
        </LinearGradient>
      </View>
      <View style={styles.responseTextContainer}>
        <Text style={styles.responseText}>
          {message.content}
          {message.isStreaming ? '▍' : ''}
        </Text>
        {showCitations && (
          <CitationsTable
            citations={message.citations!}
            clientLabel={clientLabel}
            youLabel={youLabel}
          />
        )}
      </View>
    </View>
  );
});

// ── Thinking Indicator ──────────────────────────────────────────

export const ThinkingIndicator: React.FC = () => (
  <View style={styles.responseContainer}>
    <LottieView
      source={animations.thinking}
      style={styles.thinkingLottie}
      autoPlay
      loop
      resizeMode="contain"
    />
  </View>
);
