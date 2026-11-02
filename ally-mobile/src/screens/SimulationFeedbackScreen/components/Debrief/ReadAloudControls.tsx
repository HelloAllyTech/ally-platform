import React, {createContext, useContext} from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import Video from 'react-native-video';

import {useTranslate} from '@/hooks';

import {cardStyles as s} from './cardStyles';
import {READ_ALOUD_SPEEDS, ReadAloud} from './useDebriefReadAloud';

/** The debrief's read-aloud, shared by the header bar and every card. */
export const ReadAloudContext = createContext<ReadAloud | null>(null);

/**
 * "Listen all" in the header strip: plays every card in order, with pause,
 * stop and speed (0.75 / 1 / 1.25×). Audio is never the only way to the
 * content; on an error the cards stay as they are. Mirrors ally-web's
 * ListenAllBar, with the speed as three choices instead of a select.
 */
export const ListenAllBar: React.FC<{sections: string[]}> = ({sections}) => {
  const {t} = useTranslate();
  const ra = useContext(ReadAloudContext);
  if (!ra || !sections.length) {
    return null;
  }
  const active =
    ra.status === 'playing' ||
    ra.status === 'paused' ||
    ra.status === 'loading';
  const button = (label: string, onPress: () => void) => (
    <TouchableOpacity
      accessibilityRole="button"
      style={s.listenBarButton}
      onPress={onPress}>
      <Text style={s.listenBarText}>{label}</Text>
    </TouchableOpacity>
  );
  return (
    <View style={s.listenBar} testID="debrief-listen-all">
      {!active &&
        button(t('postSim.debriefCards.listen.all'), () => ra.play(sections))}
      {ra.status === 'playing' &&
        button(t('postSim.debriefCards.listen.pause'), ra.pause)}
      {ra.status === 'paused' &&
        button(t('postSim.debriefCards.listen.resume'), ra.resume)}
      {active && button(t('postSim.debriefCards.listen.stop'), ra.stop)}
      <View
        style={s.speedGroup}
        accessibilityRole="radiogroup"
        accessibilityLabel={t('postSim.debriefCards.listen.speed')}>
        <Text style={s.listenBarText}>
          {t('postSim.debriefCards.listen.speed')}
        </Text>
        {READ_ALOUD_SPEEDS.map(speed => (
          <TouchableOpacity
            key={speed}
            accessibilityRole="radio"
            accessibilityState={{checked: ra.speed === speed}}
            style={[s.speedChoice, ra.speed === speed && s.speedChoiceOn]}
            onPress={() => ra.setSpeed(speed)}>
            <Text
              style={[
                s.speedChoiceText,
                ra.speed === speed && s.speedChoiceTextOn,
              ]}>
              {speed}×
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
};

/** The live status line: getting audio ready, or why it stopped. */
export const ReadAloudStatusLine: React.FC = () => {
  const {t} = useTranslate();
  const ra = useContext(ReadAloudContext);
  if (!ra || (ra.status !== 'loading' && ra.status !== 'error')) {
    return null;
  }
  return (
    <Text
      style={s.bodyText}
      testID="debrief-listen-status"
      accessibilityLiveRegion={ra.status === 'error' ? 'assertive' : 'polite'}
      accessibilityRole={ra.status === 'error' ? 'alert' : 'text'}>
      {ra.status === 'error'
        ? t('postSim.debriefCards.listen.error')
        : t('postSim.debriefCards.listen.loading')}
    </Text>
  );
};

/** "Listen" on one card. */
export const ListenButton: React.FC<{section: string; cardLabel: string}> = ({
  section,
  cardLabel,
}) => {
  const {t} = useTranslate();
  const ra = useContext(ReadAloudContext);
  if (!ra) {
    return null;
  }
  const reading = ra.current === section && ra.status === 'playing';
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={
        reading
          ? t('postSim.debriefCards.listen.pause')
          : t('postSim.debriefCards.listen.cardLabel', {card: cardLabel})
      }
      style={s.linkButton}
      testID="debrief-listen-card"
      onPress={() => (reading ? ra.pause() : ra.play([section]))}>
      <Text style={s.linkText}>
        {reading
          ? t('postSim.debriefCards.listen.pause')
          : t('postSim.debriefCards.listen.card')}
      </Text>
    </TouchableOpacity>
  );
};

/** A highlight on the card being read, so the eye can follow the voice. */
export const useIsBeingRead = (section: string) => {
  const ra = useContext(ReadAloudContext);
  return (
    !!ra &&
    ra.current === section &&
    ra.status !== 'idle' &&
    ra.status !== 'error'
  );
};

/**
 * The player itself: an invisible react-native-video element, already a
 * dependency of the app, because it plays a remote mp3 with a playback rate
 * (react-native-sound-player has no speed). Remounted per card via `key`.
 */
export const ReadAloudPlayer: React.FC = () => {
  const ra = useContext(ReadAloudContext);
  if (!ra?.track) {
    return null;
  }
  return (
    <Video
      key={ra.track.key}
      testID="debrief-read-aloud-player"
      source={{uri: ra.track.url}}
      paused={ra.status === 'paused'}
      rate={ra.speed}
      ignoreSilentSwitch="ignore"
      playInBackground={false}
      onLoad={ra.onLoad}
      onEnd={ra.onEnd}
      onError={ra.onError}
      style={s.hiddenPlayer}
    />
  );
};
