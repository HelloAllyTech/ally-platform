import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {ScrollView, Text, View} from 'react-native';
import {ms, ScaledSheet} from 'react-native-size-matters';
import WebView, {WebViewMessageEvent} from 'react-native-webview';

import {useTranslate} from '@/hooks';
import type {TranslationType} from '@/localization/locales/type';
import {useRecordGameResultMutation} from '@/services';
import {colors, fontFamily, fontWeights, typography} from '@/theme';
import {
  StartGameItemPayload,
  TrackGameKey,
  TrackItemCompletionResult,
} from '@/types';

import {CUB_N_PUP_HTML} from './games/cubNPupHtml';
import {MEMORY_MATCH_HTML} from './games/memoryMatchHtml';
import {SNAKE_HTML} from './games/snakeHtml';
import {SPROUT_HTML} from './games/sproutHtml';
import {TIC_TAC_TOE_HTML} from './games/ticTacToeHtml';
import {TREX_RUNNER_HTML} from './games/trexRunnerHtml';

export interface GamePlayerProps {
  payload: StartGameItemPayload;
  itemId: string;
  onCompleted: (result: TrackItemCompletionResult) => void;
}

/** Every game bundle the app can render, by key. */
const GAME_HTML: Partial<Record<TrackGameKey, string>> = {
  [TrackGameKey.TREX_RUNNER]: TREX_RUNNER_HTML,
  [TrackGameKey.TIC_TAC_TOE]: TIC_TAC_TOE_HTML,
  [TrackGameKey.MEMORY_MATCH]: MEMORY_MATCH_HTML,
  [TrackGameKey.CUB_N_PUP]: CUB_N_PUP_HTML,
  [TrackGameKey.SNAKE]: SNAKE_HTML,
  [TrackGameKey.SPROUT]: SPROUT_HTML,
};

/**
 * How tall a WebView each game needs. A bundle sizes itself to whatever
 * viewport it is given, so this is the one thing about a game the host has to
 * know: the runner is a 150px canvas, a board game needs room for a board.
 */
const GAME_HEIGHT: Partial<Record<TrackGameKey, number>> = {
  [TrackGameKey.TREX_RUNNER]: 200,
  [TrackGameKey.TIC_TAC_TOE]: 400,
  [TrackGameKey.MEMORY_MATCH]: 380,
  // Taller than the rest: the puzzle spins, so the board needs the room its
  // corners sweep through, and the level list opens into the same view.
  [TrackGameKey.CUB_N_PUP]: 440,
  [TrackGameKey.SNAKE]: 400,
  // The plant grows upwards and the moisture meter runs the full height, so
  // this one wants height more than width.
  [TrackGameKey.SPROUT]: 420,
};

/**
 * Words a bundle draws inside its own WebView, by game.
 *
 * A bundle is a static document with no reach into the app, so it cannot read
 * the learner's language for itself — anything it renders in words has to be
 * handed to it. The runner and the tic-tac-toe board are pure canvas and need
 * nothing; the memory deck has a move counter and an end-of-round card, the
 * puzzle has a level list, a solved count and the lines that teach it, the
 * snake has a score, a best and a restart button, and the plant has a picker,
 * a running commentary and the whole of its screen-reader narration, so those
 * four get these. A bundle falls back to its own baked-in English if the host
 * sends nothing, which is what keeps this list optional.
 */
const FRAME_STRING_KEYS: Partial<
  Record<TrackGameKey, Readonly<Record<string, TranslationType>>>
> = {
  [TrackGameKey.MEMORY_MATCH]: {
    moves: 'courses.game.frameStrings.MEMORY_MATCH.moves',
    restart: 'courses.game.frameStrings.MEMORY_MATCH.restart',
    wonTitle: 'courses.game.frameStrings.MEMORY_MATCH.wonTitle',
    wonDetail: 'courses.game.frameStrings.MEMORY_MATCH.wonDetail',
    playAgain: 'courses.game.frameStrings.MEMORY_MATCH.playAgain',
    cardLabel: 'courses.game.frameStrings.MEMORY_MATCH.cardLabel',
  },
  [TrackGameKey.CUB_N_PUP]: {
    levels: 'courses.game.frameStrings.CUB_N_PUP.levels',
    close: 'courses.game.frameStrings.CUB_N_PUP.close',
    nextLevel: 'courses.game.frameStrings.CUB_N_PUP.nextLevel',
    solved: 'courses.game.frameStrings.CUB_N_PUP.solved',
    tutorial: 'courses.game.frameStrings.CUB_N_PUP.tutorial',
    hintDragToStar: 'courses.game.frameStrings.CUB_N_PUP.hintDragToStar',
    hintRotate: 'courses.game.frameStrings.CUB_N_PUP.hintRotate',
    hintFree: 'courses.game.frameStrings.CUB_N_PUP.hintFree',
    hintPivot: 'courses.game.frameStrings.CUB_N_PUP.hintPivot',
    hintRotateLink: 'courses.game.frameStrings.CUB_N_PUP.hintRotateLink',
  },
  [TrackGameKey.SNAKE]: {
    score: 'courses.game.frameStrings.SNAKE.score',
    best: 'courses.game.frameStrings.SNAKE.best',
    restart: 'courses.game.frameStrings.SNAKE.restart',
    gameOver: 'courses.game.frameStrings.SNAKE.gameOver',
  },
  /*
   * The longest list here by some way, and deliberately so: the plant's scene
   * is aria-hidden, which makes the live region the entire game for a screen
   * reader. Every one of these is read aloud to somebody.
   */
  [TrackGameKey.SPROUT]: {
    pickerLabel: 'courses.game.frameStrings.SPROUT.pickerLabel',
    plantSUCCULENT: 'courses.game.frameStrings.SPROUT.plantSUCCULENT',
    plantMARIGOLD: 'courses.game.frameStrings.SPROUT.plantMARIGOLD',
    plantFERN: 'courses.game.frameStrings.SPROUT.plantFERN',
    plantTOMATO: 'courses.game.frameStrings.SPROUT.plantTOMATO',
    visitorsLabel: 'courses.game.frameStrings.SPROUT.visitorsLabel',
    hintStart: 'courses.game.frameStrings.SPROUT.hintStart',
    aimSoil: 'courses.game.frameStrings.SPROUT.aimSoil',
    aimLeaves: 'courses.game.frameStrings.SPROUT.aimLeaves',
    aimAway: 'courses.game.frameStrings.SPROUT.aimAway',
    stateDry: 'courses.game.frameStrings.SPROUT.stateDry',
    stateGood: 'courses.game.frameStrings.SPROUT.stateGood',
    stateWet: 'courses.game.frameStrings.SPROUT.stateWet',
    stage0: 'courses.game.frameStrings.SPROUT.stage0',
    stage1: 'courses.game.frameStrings.SPROUT.stage1',
    stage2: 'courses.game.frameStrings.SPROUT.stage2',
    stage3: 'courses.game.frameStrings.SPROUT.stage3',
    stage4: 'courses.game.frameStrings.SPROUT.stage4',
    stage5: 'courses.game.frameStrings.SPROUT.stage5',
    leafDropped: 'courses.game.frameStrings.SPROUT.leafDropped',
    leafScorched: 'courses.game.frameStrings.SPROUT.leafScorched',
    bloomed: 'courses.game.frameStrings.SPROUT.bloomed',
    plantAnother: 'courses.game.frameStrings.SPROUT.plantAnother',
    visitorArrived: 'courses.game.frameStrings.SPROUT.visitorArrived',
    visitorBEE: 'courses.game.frameStrings.SPROUT.visitorBEE',
    visitorBUTTERFLY: 'courses.game.frameStrings.SPROUT.visitorBUTTERFLY',
    visitorLADYBIRD: 'courses.game.frameStrings.SPROUT.visitorLADYBIRD',
  },
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
  const height = GAME_HEIGHT[payload.gameKey];

  /**
   * Handed over before the document runs rather than posted in afterwards, so
   * the first paint is already in the learner's language.
   *
   * `skipInterpolation` because these are templates for the bundle to fill in,
   * not finished sentences — without it i18next would resolve `{{moves}}` here
   * against nothing and hand the frame a string with the number cut out. The
   * whole object goes through JSON.stringify, so a quote or a newline in a
   * translation cannot break out of the statement.
   */
  const gameKey = payload.gameKey;
  const injectedStrings = useMemo(() => {
    const keys = FRAME_STRING_KEYS[gameKey];
    if (!keys) {
      return undefined;
    }
    const strings = Object.fromEntries(
      Object.entries(keys).map(([name, key]) => [
        name,
        t(key, {skipInterpolation: true}),
      ]),
    );
    return `window.__allyGameStrings = ${JSON.stringify(strings)}; true;`;
  }, [gameKey, t]);

  // The backend is the source of truth for which games exist; a released
  // build only knows the games shipped as of its build date. Rather than
  // hand an unrecognised key to the lookups below — a blank WebView sized to
  // NaN — say so plainly, the same way UnsupportedItemCard does for an
  // unrecognised item type.
  if (!html || !height) {
    return (
      <View style={styles.unsupported} testID="game-unsupported">
        <Text style={styles.unsupportedTitle}>
          {t('courses.player.unsupportedTitle')}
        </Text>
        <Text style={styles.unsupportedBody}>
          {t('courses.player.unsupportedBody')}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      testID="game-player"
      // The WebView owns horizontal drags; let it, or the dino never jumps.
      scrollEnabled>
      {payload.intro ? <Text style={styles.intro}>{payload.intro}</Text> : null}

      <View style={[styles.frame, {height: ms(height)}]}>
        <WebView
          source={{html}}
          onMessage={handleMessage}
          injectedJavaScriptBeforeContentLoaded={injectedStrings}
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

      <Text style={styles.hint}>
        {t(
          `courses.game.controlsTouch.${gameKey as keyof typeof GAME_HTML}` as any,
        )}
      </Text>

      <View style={styles.scores}>
        {lastScore !== null ? (
          <Text style={styles.score}>
            {t(
              `courses.game.lastScore.${gameKey as keyof typeof GAME_HTML}` as any,
              {score: lastScore},
            )}
          </Text>
        ) : null}
        {bestScore !== null ? (
          <Text style={styles.best}>
            {t(
              `courses.game.bestScore.${gameKey as keyof typeof GAME_HTML}` as any,
              {
                score: bestScore,
              },
            )}
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
  unsupported: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12@ms',
    paddingHorizontal: '24@ms',
  },
  unsupportedTitle: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.large,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.highEmphasis,
    textAlign: 'center',
  },
  unsupportedBody: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.mediumEmphasis,
    textAlign: 'center',
  },
  intro: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.mediumEmphasis,
    textAlign: 'center',
  },
  frame: {
    // height is per game — see GAME_HEIGHT.
    width: '100%',
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
