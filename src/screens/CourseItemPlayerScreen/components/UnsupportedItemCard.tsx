import React from 'react';
import {Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {Button} from '@/components';
import {useTranslate} from '@/hooks';
import {colors, fontFamily, fontWeights, typography} from '@/theme';

export interface UnsupportedItemCardProps {
  onBackToCourse: () => void;
}

/**
 * Shown for a component type this build of the app doesn't have a player for.
 *
 * Courses are authored in one place and consumed on web and mobile, so the web
 * builder can always be a component type or two ahead of a shipped app binary.
 * Before this card that case rendered nothing: the learner got the top bar, an
 * empty body and a disabled Next, with no hint that anything was wrong.
 *
 * Deliberately does NOT force Next open. Advancing is still governed by the
 * item's own status, so a component the learner genuinely finished elsewhere
 * lets them straight through, while one that still needs a graded attempt
 * holds them — which is the correct answer for an exercise this app can't yet
 * present, and not a decision this card should quietly override.
 */
export const UnsupportedItemCard: React.FC<UnsupportedItemCardProps> = ({
  onBackToCourse,
}) => {
  const {t} = useTranslate();

  return (
    <View style={styles.container} testID="unsupported-item-card">
      <Text style={styles.title}>{t('courses.player.unsupportedTitle')}</Text>
      <Text style={styles.body}>{t('courses.player.unsupportedBody')}</Text>
      <Button
        testID="unsupported-back-to-course"
        label={t('courses.player.backToCourse')}
        variant="secondary"
        onPress={onBackToCourse}
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
  title: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.large,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.highEmphasis,
    textAlign: 'center',
  },
  body: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.mediumEmphasis,
    textAlign: 'center',
  },
});
