import React from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {LockIcon, TickRoundIcon} from '@/assets';
import {useTranslate} from '@/hooks';
import {colors, fontFamily, fontWeights, typography} from '@/theme';
import {TrackDetailItem, TrackItemStatus, TrackItemType} from '@/types';
import {getTrackItemMeta} from '@/utils';

export interface CourseItemRowProps {
  item: TrackDetailItem;
  isNext: boolean;
  onPress: (item: TrackDetailItem) => void;
}

const TYPE_BADGE_LABEL: Record<TrackItemType, string> = {
  [TrackItemType.ROLEPLAY]: 'R',
  [TrackItemType.CASE]: 'C',
  [TrackItemType.QUIZ]: 'Q',
  [TrackItemType.ARTICLE]: 'A',
  [TrackItemType.VIDEO]: 'V',
  [TrackItemType.JOURNAL]: 'J',
  [TrackItemType.GAME]: 'G',
  [TrackItemType.BRANCHING_SCENARIO]: 'B',
  [TrackItemType.BUCKET_SORT]: 'S',
};

export const CourseItemRow: React.FC<CourseItemRowProps> = ({
  item,
  isNext,
  onPress,
}) => {
  const {t, tVariable} = useTranslate();
  const isLocked = item.status === TrackItemStatus.LOCKED;
  const isCompleted = item.status === TrackItemStatus.COMPLETED;
  const isInProgress =
    item.status === TrackItemStatus.UNLOCKED && !!item.startedAt;
  const isCurrent = isNext || isInProgress;

  const statusLabel = isCompleted
    ? t('courses.status.completed')
    : isInProgress
      ? t('courses.status.inProgress')
      : isNext
        ? t('common.next')
        : null;

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      style={[
        styles.row,
        isLocked && styles.rowLocked,
        !isLocked && isCurrent && styles.rowCurrent,
      ]}
      onPress={() => onPress(item)}
      disabled={isLocked}>
      <View
        style={[
          styles.badge,
          isCompleted && styles.badgeCompleted,
          isLocked && styles.badgeLocked,
        ]}>
        {isLocked ? (
          <LockIcon width={16} height={16} color={colors.ds.grey[400]} />
        ) : (
          <Text
            style={[
              styles.badgeText,
              isCompleted && styles.badgeTextCompleted,
            ]}>
            {TYPE_BADGE_LABEL[item.type]}
          </Text>
        )}
      </View>

      <View style={styles.content}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>
            {item.title}
          </Text>
          {isCompleted && (
            <TickRoundIcon
              width={16}
              height={16}
              color={colors.ds.green[700]}
            />
          )}
          {!isCompleted && statusLabel && (
            <View style={styles.statusChip}>
              <Text style={styles.statusChipText}>{statusLabel}</Text>
            </View>
          )}
        </View>
        <Text style={styles.meta}>{getTrackItemMeta(item, tVariable)}</Text>
        {/* A component the trainer could not localise — say so on the card
            rather than surprising the learner once it opens. */}
        {!!item.languageFallbackReason && (
          <Text style={styles.languageCaption}>
            {t(`courses.language.fallback.${item.languageFallbackReason}`)}
          </Text>
        )}
        {isLocked && (
          <Text style={styles.lockedCaption}>{t('courses.lockedTooltip')}</Text>
        )}
      </View>
    </TouchableOpacity>
  );
};

const styles = ScaledSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '12@ms',
    padding: '12@ms',
    borderRadius: '14@ms',
    borderWidth: 1,
    borderColor: colors.ds.stroke.primary,
    backgroundColor: colors.ds.neutral.white,
  },
  rowLocked: {
    backgroundColor: colors.ds.grey[50],
    opacity: 0.7,
  },
  rowCurrent: {
    borderColor: colors.ds.theme.primary,
    borderWidth: 1.5,
  },
  badge: {
    width: '40@ms',
    height: '40@ms',
    borderRadius: '20@ms',
    borderWidth: 1.5,
    borderColor: colors.ds.theme.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeCompleted: {
    backgroundColor: colors.ds.theme.primary,
    borderColor: colors.ds.theme.primary,
  },
  badgeLocked: {
    backgroundColor: colors.ds.grey[100],
    borderColor: colors.ds.stroke.primary,
  },
  badgeText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.medium,
    fontWeight: fontWeights.medium,
    color: colors.ds.theme.primary,
  },
  badgeTextCompleted: {
    color: colors.ds.neutral.white,
  },
  content: {
    flex: 1,
    gap: '2@ms',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '8@ms',
  },
  title: {
    flex: 1,
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.highEmphasis,
  },
  statusChip: {
    backgroundColor: colors.ds.lightBlue[50],
    paddingHorizontal: '8@ms',
    paddingVertical: '3@ms',
    borderRadius: '16@ms',
  },
  statusChipText: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.tiny,
    fontWeight: fontWeights.regular,
    color: colors.ds.theme.primary,
  },
  meta: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.small,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.mediumEmphasis,
  },
  lockedCaption: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.tiny,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.lowEmphasis,
  },
  languageCaption: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.tiny,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.mediumEmphasis,
  },
});
