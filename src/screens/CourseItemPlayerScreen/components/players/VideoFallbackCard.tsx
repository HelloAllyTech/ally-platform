import React from 'react';
import {Linking, Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {Button} from '@/components';
import {useTranslate} from '@/hooks';
import {colors, fontFamily, fontWeights, typography} from '@/theme';

export interface VideoFallbackCardProps {
  url: string;
  onMarkWatched: () => void;
}

/**
 * Fallback for youtube/vimeo/loom sources: no native SDK integration for
 * these hosts on mobile (a deliberate v1 gap, called out explicitly — see
 * the port plan), so the learner opens the video externally and marks it
 * watched manually. Unlike ally-web's Loom fallback, this doesn't gate the
 * button behind a foreground-elapsed-time estimate — porting that timer
 * without a real playback signal to back it would just fake a percentage,
 * so the button is available as soon as the learner has had a chance to
 * open the video.
 */
export const VideoFallbackCard: React.FC<VideoFallbackCardProps> = ({
  url,
  onMarkWatched,
}) => {
  const {t} = useTranslate();

  return (
    <View style={styles.container}>
      <Text style={styles.hint}>{t('courses.meta.video')}</Text>
      <Button
        testID="video-open-external"
        label={t('courses.video.openVideo')}
        variant="secondary"
        onPress={() => Linking.openURL(url)}
      />
      <Button
        testID="video-mark-watched"
        label={t('courses.video.markWatched')}
        onPress={onMarkWatched}
      />
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12@ms',
    paddingHorizontal: '24@ms',
  },
  hint: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.mediumEmphasis,
  },
});
