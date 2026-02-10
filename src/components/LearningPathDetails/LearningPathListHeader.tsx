import React from 'react';
import {Image, Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {PrimaryButton} from '@/components';
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
}) => {
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
        <Text style={styles.pathDescription}>{description ?? ''}</Text>

        {showProgressBar && completedScenarios !== undefined && (
          <View style={styles.progressBarContainer}>
            <ProgressBar current={completedScenarios} total={totalScenarios} />
          </View>
        )}

        {!isCompleted && (
          <PrimaryButton
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
  pathDescription: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.mediumEmphasis,
    textAlign: 'center',
  },
  progressBarContainer: {
    marginVertical: '12@ms',
    width: '60%',
    alignSelf: 'center',
  },
});
