import React, {useEffect, useState} from 'react';
import {AccessibilityInfo, Modal, Text, View} from 'react-native';
import ConfettiCannon from 'react-native-confetti-cannon';
import {ScaledSheet} from 'react-native-size-matters';

import {Button} from '@/components';
import {useTranslate} from '@/hooks';
import {colors, fontFamily, fontWeights, typography} from '@/theme';

export type CelebrationKind = 'section' | 'track';

export interface CelebrationModalProps {
  kind: CelebrationKind | null;
  /** Completed-item count, shown on the track-complete card. */
  completedCount?: number;
  onContinue: () => void;
  onBackToLearn: () => void;
}

/**
 * Celebratory modal shown when a section (small) or the whole course
 * (bigger, with stats) completes. Fires a confetti burst unless the device
 * has "reduce motion" enabled. Mirrors ally-web's `CelebrationOverlay`.
 */
export const CelebrationModal: React.FC<CelebrationModalProps> = ({
  kind,
  completedCount,
  onContinue,
  onBackToLearn,
}) => {
  const {t, tVariable} = useTranslate();
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

  const isTrack = kind === 'track';

  return (
    <Modal
      visible={!!kind}
      transparent
      animationType="fade"
      statusBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={isTrack ? onBackToLearn : onContinue}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.iconCircle}>
            <Text style={styles.iconText}>{isTrack ? '🎉' : '✨'}</Text>
          </View>
          <Text style={styles.title}>
            {isTrack
              ? t('courses.celebration.trackCompleteTitle')
              : t('courses.celebration.sectionCompleteTitle')}
          </Text>
          <Text style={styles.body}>
            {isTrack
              ? t('courses.celebration.trackCompleteBody')
              : t('courses.celebration.sectionCompleteBody')}
          </Text>

          {isTrack && completedCount !== undefined && (
            <View style={styles.statsPill}>
              <Text style={styles.statsPillText}>
                {tVariable('courses.celebration.itemsCompleted', {
                  count: completedCount,
                })}
              </Text>
            </View>
          )}

          <Button
            testID="celebration-cta"
            label={
              isTrack
                ? t('courses.celebration.backToLearn')
                : t('courses.celebration.continue')
            }
            onPress={isTrack ? onBackToLearn : onContinue}
          />
        </View>
      </View>
      {kind && !reduceMotion && (
        <ConfettiCannon
          fadeOut
          count={isTrack ? 160 : 90}
          origin={{x: 0, y: 0}}
        />
      )}
    </Modal>
  );
};

const styles = ScaledSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.blackTransparent50,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: '24@ms',
  },
  card: {
    width: '100%',
    maxWidth: '360@ms',
    backgroundColor: colors.ds.neutral.white,
    borderRadius: '20@ms',
    padding: '24@ms',
    alignItems: 'center',
    gap: '4@ms',
  },
  iconCircle: {
    width: '64@ms',
    height: '64@ms',
    borderRadius: '32@ms',
    backgroundColor: colors.ds.lightBlue[50],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '8@ms',
  },
  iconText: {
    fontSize: '28@ms',
  },
  title: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.large,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.highEmphasis,
    textAlign: 'center',
  },
  body: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.small,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.mediumEmphasis,
    textAlign: 'center',
    marginBottom: '12@ms',
  },
  statsPill: {
    backgroundColor: colors.ds.grey[50],
    borderRadius: '12@ms',
    paddingVertical: '10@ms',
    width: '100%',
    marginBottom: '16@ms',
  },
  statsPillText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.small,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.highEmphasis,
    textAlign: 'center',
  },
});
