import React from 'react';
import {Image, Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {ChevronRight} from '@/assets';
import {Button, RichText} from '@/components';
import {useTranslate} from '@/hooks/useTranslate';
import {colors, fontFamily, fontWeights, typography} from '@/theme';

import {ProgressBar} from './ProgressBar';

interface LearningPathListHeaderProps {
  title?: string;
  description?: string;
  coverImageUrl?: string;
  completedScenarios?: number;
  totalScenarios: number;
  isCompleted: boolean;
  startButtonLabel: string;
  onStartPress: () => void;
  isStartDisabled: boolean;
  isCreatingSession: boolean;
  /**
   * Opens the progress + consolidated feedback sheet. Omitted on screens
   * that have no such drill-down (SimulationPathDetails, CaseDetails) — the
   * bar then renders inert, same as before this prop existed.
   */
  onProgressPress?: () => void;
}

export const LearningPathListHeader: React.FC<LearningPathListHeaderProps> = ({
  title,
  description,
  coverImageUrl,
  completedScenarios,
  totalScenarios,
  isCompleted,
  startButtonLabel,
  onStartPress,
  isStartDisabled,
  isCreatingSession,
  onProgressPress,
}) => {
  const {t} = useTranslate();
  const showProgressBar = !!completedScenarios && totalScenarios > 0;

  return (
    <View style={styles.listHeaderSection}>
      {!!coverImageUrl && (
        <Image
          source={{uri: coverImageUrl}}
          style={styles.coverImage}
          resizeMode="cover"
        />
      )}
      <View style={styles.listHeaderContent}>
        <Text style={styles.pathTitle}>{title}</Text>
        <RichText html={description} />

        {showProgressBar &&
          completedScenarios !== undefined &&
          (onProgressPress ? (
            <TouchableOpacity
              style={styles.progressBarTappable}
              onPress={onProgressPress}
              accessibilityRole="button"
              testID="learning-path-progress-bar">
              <View style={styles.progressBarRow}>
                <View style={styles.progressBarFlex}>
                  <ProgressBar
                    current={completedScenarios}
                    total={totalScenarios}
                  />
                </View>
                <ChevronRight />
              </View>
              <Text style={styles.progressTapHint}>
                {t('courses.progressDashboard.tapHint')}
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.progressBarContainer}>
              <ProgressBar
                current={completedScenarios}
                total={totalScenarios}
              />
            </View>
          ))}

        {!isCompleted && (
          <Button
            label={startButtonLabel}
            onPress={onStartPress}
            isDisabled={isStartDisabled}
            isLoading={isCreatingSession}
          />
        )}
      </View>
    </View>
  );
};

const styles = ScaledSheet.create({
  listHeaderSection: {
    marginBottom: '16@ms',
  },
  coverImage: {
    width: '100%',
    height: '177@ms',
    borderRadius: '4@ms',
    backgroundColor: colors.ds.grey[200],
    marginBottom: '16@ms',
  },
  listHeaderContent: {
    gap: '12@ms',
  },
  pathTitle: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.display.small,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.highEmphasis,
    textAlign: 'center',
  },
  progressBarContainer: {
    marginVertical: '12@ms',
    width: '60%',
    alignSelf: 'center',
  },
  progressBarTappable: {
    marginVertical: '12@ms',
    width: '100%',
    borderWidth: 1,
    borderColor: colors.ds.stroke.primary,
    borderRadius: '12@ms',
    padding: '12@ms',
  },
  progressBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '8@ms',
  },
  progressBarFlex: {
    flex: 1,
  },
  progressTapHint: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.tiny,
    fontWeight: fontWeights.medium,
    color: colors.ds.theme.primary,
    marginTop: '6@mvs',
  },
});
