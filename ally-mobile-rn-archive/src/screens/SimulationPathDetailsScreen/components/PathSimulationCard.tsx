import React from 'react';
import {Image, Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {FileIcon, LockIcon, TickRoundIcon} from '@/assets';
import {DEFAULT_HIT_SLOP} from '@/constants';
import {useTranslate} from '@/hooks';
import {colors, fontFamily, fontWeights, typography} from '@/theme';

export interface PathSimulationCardProps {
  order: number;
  title: string;
  thumbnailUrl?: string | null;
  isLocked?: boolean;
  isCompleted?: boolean;
  isNext?: boolean;
  onPress?: () => void;
  onFileIconPress?: () => void;
}

/**
 * PathSimulationCard Component
 *
 * A card component for displaying individual simulations within a path.
 * Shows thumbnail, order number, title, and locked state.
 */
export const PathSimulationCard: React.FC<PathSimulationCardProps> = ({
  order,
  title,
  thumbnailUrl,
  isLocked = false,
  isCompleted = false,
  isNext = false,
  onPress,
  onFileIconPress,
}) => {
  const {t} = useTranslate();

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      style={styles.card}
      onPress={onPress}
      disabled={!onPress || isLocked}>
      {/* Thumbnail */}
      <View style={styles.thumbnailContainer}>
        {thumbnailUrl && (
          <Image
            source={{uri: thumbnailUrl}}
            style={styles.thumbnail}
            resizeMode="cover"
          />
        )}
        {isLocked && (
          <>
            {/* Darker overlay for locked state */}
            <View style={styles.lockedOverlay} />
            <View style={styles.lockIconContainer}>
              <LockIcon
                width={20}
                height={20}
                color={colors.ds.neutral.white}
              />
            </View>
          </>
        )}
      </View>

      {/* Content */}
      <View style={styles.content}>
        <View style={styles.headerRow}>
          <Text style={styles.orderLabel}>
            {t('postSim.titlePrefix')} {order}
          </Text>
          {isCompleted && (
            <TickRoundIcon
              width={16}
              height={16}
              color={colors.ds.green[700]}
            />
          )}
          {isNext && (
            <View style={styles.nextBadge}>
              <Text style={styles.nextBadgeText}>{t('common.next')}</Text>
            </View>
          )}
        </View>
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
      </View>

      {/* FileIcon for completed simulations - placed at right end */}
      {isCompleted && (
        <TouchableOpacity
          style={styles.fileIconContainer}
          onPress={onFileIconPress}
          disabled={!onFileIconPress}
          activeOpacity={0.7}
          hitSlop={DEFAULT_HIT_SLOP}>
          <FileIcon width={18} height={18} />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
};

const styles = ScaledSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '12@ms',
    paddingVertical: '12@ms',
    backgroundColor: colors.ds.neutral.white,
  },
  thumbnailContainer: {
    position: 'relative',
    width: '120@ms',
    height: '60@ms',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
    borderRadius: '4@ms',
    backgroundColor: colors.ds.grey[200],
  },
  fileIconContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingRight: '12@ms',
  },
  lockedOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.ds.blackAlpha[800],
    borderRadius: '4@ms',
  },
  lockIconContainer: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: [{translateX: -10}, {translateY: -10}],
  },
  content: {
    flex: 1,
    gap: '8@ms',
    paddingHorizontal: '12@ms',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '8@ms',
  },
  orderLabel: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.small,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.lowEmphasis,
  },
  nextBadge: {
    backgroundColor: colors.ds.lightBlue[50],
    paddingHorizontal: '8@ms',
    paddingVertical: '4@ms',
    borderRadius: '16@ms',
  },
  nextBadgeText: {
    ...fontFamily.ROBOTO.REGULAR,
    ...typography.body.tiny,
    fontWeight: fontWeights.regular,
    color: colors.ds.theme.primary,
  },
  title: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.highEmphasis,
  },
});
