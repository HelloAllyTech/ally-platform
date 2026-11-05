import React, {useEffect} from 'react';
import {Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {Button} from '@/components';
import {SCREEN_NAMES} from '@/constants';
import {useAppNavigation, useTranslate} from '@/hooks';
import {colors, fontFamily, typography} from '@/theme';
import {
  StartGameItemPayload,
  TrackGameKey,
  TrackItemCompletionResult,
} from '@/types';
import {setActiveTrackContext} from '@/utils';

export interface NativeGamePlayerProps {
  payload: StartGameItemPayload;
  itemId: string;
  trackId: string;
  onCompleted: (result: TrackItemCompletionResult) => void;
}

export const NativeGamePlayer: React.FC<NativeGamePlayerProps> = ({
  payload,
  itemId,
  trackId,
  onCompleted,
}) => {
  const {t} = useTranslate();
  const navigation = useAppNavigation();

  useEffect(() => {
    onCompleted(payload.completion);
  }, [onCompleted, payload.completion]);

  const handleLaunch = async () => {
    await setActiveTrackContext({trackId, itemId});
    if (
      payload.gameKey === TrackGameKey.BREATHING_EXERCISE &&
      payload.breathingExercise
    ) {
      navigation.navigate(SCREEN_NAMES.BREATHING_EXERCISE, {
        config: payload.breathingExercise,
        itemId,
        trackId,
      });
    }
  };

  if (payload.gameKey !== TrackGameKey.BREATHING_EXERCISE) {
    return null;
  }

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>{t('courses.breathing.title')}</Text>
        {payload.intro ? (
          <Text style={styles.intro}>{payload.intro}</Text>
        ) : (
          <Text style={styles.intro}>
            {t('courses.breathing.defaultIntro')}
          </Text>
        )}
      </View>

      <Button
        label={t('courses.breathing.start')}
        onPress={handleLaunch}
        customContainerStyle={styles.button}
      />
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24@ms',
    gap: '24@ms',
  },
  content: {
    alignItems: 'center',
    gap: '8@ms',
  },
  title: {
    ...typography.display.small,
    color: colors.ds.typography.highEmphasis,
    fontFamily: fontFamily.IBM_PLEX_SERIF.MEDIUM.fontFamily,
    textAlign: 'center',
  },
  intro: {
    ...typography.body.medium,
    color: colors.ds.typography.mediumEmphasis,
    fontFamily: fontFamily.IBM_PLEX_SERIF.REGULAR.fontFamily,
    textAlign: 'center',
  },
  button: {
    width: '100%',
  },
});
