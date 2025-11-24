import React from 'react';
import {Image, Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {
  colors,
  fontFamily,
  fontWeights,
  globalStyles,
  radius,
  typography,
} from '@/theme';

export interface SimulationCardProps {
  title: string;
  description?: string;
  coverImageUrl?: string | null;
  rightAccessory?: React.ReactNode;
  onPress?: () => void;
  titleNumberOfLines?: number;
  descriptionNumberOfLines?: number;
}

/**
 * SimulationCard Component
 *
 * A reusable card component for displaying simulation and path items.
 * Supports optional cover image and right accessory (e.g., progress indicator).
 */
export const SimulationCard: React.FC<SimulationCardProps> = ({
  title,
  description,
  coverImageUrl,
  rightAccessory,
  onPress,
  titleNumberOfLines = 2,
  descriptionNumberOfLines = 3,
}) => {
  return (
    <View style={styles.cardContainer}>
      <TouchableOpacity
        activeOpacity={0.8}
        style={styles.card}
        onPress={onPress}
        disabled={!onPress}>
        {!!coverImageUrl && (
          <View style={styles.coverContainer}>
            <Image
              source={{uri: coverImageUrl}}
              style={styles.cover}
              resizeMode="cover"
            />
          </View>
        )}
        <View style={styles.cardBody}>
          <View style={styles.textContainer}>
            <Text style={styles.cardTitle} numberOfLines={titleNumberOfLines}>
              {title || '-'}
            </Text>
            {!!description && (
              <Text
                style={styles.cardDesc}
                numberOfLines={descriptionNumberOfLines}>
                {description}
              </Text>
            )}
          </View>
          {rightAccessory && (
            <View style={globalStyles.center}>{rightAccessory}</View>
          )}
        </View>
      </TouchableOpacity>
    </View>
  );
};

const styles = ScaledSheet.create({
  cardContainer: {
    padding: '2@ms',
  },
  card: {
    backgroundColor: colors.white,
    borderColor: colors.ds.stroke.primary,
    borderWidth: 0.5,
    borderRadius: radius.xl3,
    width: '100%',
    shadowColor: colors.ds.grey[900],
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 1,
    overflow: 'hidden',
    paddingTop: '8@ms',
    paddingBottom: '16@ms',
  },
  coverContainer: {
    width: '100%',
  },
  cover: {
    minHeight: '180@ms',
    backgroundColor: colors.ds.grey[100],
    borderRadius: radius.xl2,
    marginBottom: '8@ms',
    marginHorizontal: '8@ms',
  },
  cardBody: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: '18@ms',
  },
  textContainer: {
    flex: 1,
  },
  cardTitle: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.large,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.highEmphasis,
    marginBottom: '5@ms',
  },
  cardDesc: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.small,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.mediumEmphasis,
  },
});
