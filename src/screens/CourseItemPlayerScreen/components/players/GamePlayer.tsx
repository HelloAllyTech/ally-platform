import React, {useCallback, useEffect, useState} from 'react';
import {ScrollView, Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';
import WebView, {WebViewMessageEvent} from 'react-native-webview';

import {useTranslate} from '@/hooks';
import {useRecordGameResultMutation} from '@/services';
import {colors, fontFamily, fontWeights, typography} from '@/theme';
import {
  StartGameItemPayload,
  TrackGameKey,
  TrackItemCompletionResult,
} from '@/types';

import {TREX_RUNNER_HTML} from './games/trexRunnerHtml';

export interface GamePlayerProps {
  payload: StartGameItemPayload;
  itemId: string;
  onCompleted: (result: TrackItemCompletionResult) => void;
}

/** Every game bundle the app can render, by key. */
const GAME_HTML: Record<TrackGameKey, string> = {
  [TrackGameKey.TREX_RUNNER]: TREX_RUNNER_HTML,
};

/** What a game bundle posts to us. Mirrors the bridge inside each bundle. */
interface GameMessage {
  source?: string;
  type?: string;
  score?: number;
  highScore?: number;
}

/**
 * Game item: renders a self-contained game bundle in a WebView.
 *
 * The bundle is the same file the web app serves from its `public/games/`
 * directory, inlined at build time (see `games/trexRunnerHtml.ts`), and it
 * detects its host at runtime — posting to `window.ReactNativeWebView` here and
 * to `window.parent` in the browser. One bundle, two hosts, no fork to keep in
 * step.
 *
 * Nothing here gates anything. The item was completed server-side when it was
 * opened, so this reports that completion on mount — Next is live before the
 * learner has touched the game, and a score is only ever a personal best.
 */
export const GamePlayer: React.FC<GamePlayerProps> = ({
  payload,
  itemId,
  onCompleted,
}) => {
  const {t} = useTranslate();
  const [bestScore, setBestScore] = useState<number | null>(payload.bestScore);
  const [lastScore, setLastScore] = useState<number | null>(null);
  const [recordGameResult] = useRecordGameResultMutation();

  // The server already completed this item; tell the player so Next unlocks.
  const completion = payload.completion;
  useEffect(() => {
    onCompleted(completion);
  }, [completion, onCompleted]);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let message: GameMessage;
      try {
        message = JSON.parse(event.nativeEvent.data);
      } catch {
        return;
      }
      if (message.source !== 'ally-game') {
        return;
      }
      if (message.type === 'over' && typeof message.score === 'number') {
        const score = message.score;
        setLastScore(score);
        setBestScore(prev => (prev === null || score > prev ? score : prev));
        // Fire-and-forget: a lost personal best is not worth an error toast in
        // the middle of a break, and nothing downstream depends on it.
        recordGameResult({itemId, score})
          .unwrap()
          .catch(() => undefined);
      }
    },
    [itemId, recordGameResult],
  );

  const html = GAME_HTML[payload.gameKey];

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      testID="game-player"
      // The WebView owns horizontal drags; let it, or the dino never jumps.
      scrollEnabled>
      {payload.intro ? <Text style={styles.intro}>{payload.intro}</Text> : null}

      <View style={styles.frame}>
        <WebView
          source={{html}}
          onMessage={handleMessage}
          // Required for `source={{html}}` — the document has an opaque origin.
          originWhitelist={['*']}
          javaScriptEnabled
          // The game sizes itself to the viewport; letting the WebView scroll
          // would just let the learner drag the canvas around instead.
          scrollEnabled={false}
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          // Jump sounds are triggered by a tap, so no autoplay gesture needed.
          mediaPlaybackRequiresUserAction={false}
          style={styles.webView}
        />
      </View>

      <Text style={styles.hint}>{t('courses.game.controlsTouch')}</Text>

      <View style={styles.scores}>
        {lastScore !== null ? (
          <Text style={styles.score}>
            {t('courses.game.lastScore', {score: lastScore})}
          </Text>
        ) : null}
        {bestScore !== null ? (
          <Text style={styles.best}>
            {t('courses.game.bestScore', {score: bestScore})}
          </Text>
        ) : null}
      </View>

      <Text style={styles.optional}>{t('courses.game.optional')}</Text>
    </ScrollView>
  );
};

const styles = ScaledSheet.create({
  content: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12@ms',
    paddingHorizontal: '16@ms',
    paddingVertical: '16@ms',
  },
  intro: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.mediumEmphasis,
    textAlign: 'center',
  },
  frame: {
    width: '100%',
    height: '200@ms',
    borderRadius: '12@ms',
    overflow: 'hidden',
    backgroundColor: colors.ds.neutral.white,
  },
  webView: {flex: 1, backgroundColor: colors.ds.neutral.white},
  hint: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.small,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.mediumEmphasis,
    textAlign: 'center',
  },
  scores: {flexDirection: 'row', alignItems: 'center', gap: '16@ms'},
  score: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.small,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.mediumEmphasis,
  },
  best: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.small,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.highEmphasis,
  },
  optional: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.small,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.mediumEmphasis,
    textAlign: 'center',
  },
});
