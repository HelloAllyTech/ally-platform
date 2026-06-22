import {useState} from 'react';
import {useIsFocused} from '@react-navigation/native';
import {useTranslation} from 'react-i18next';
import {
  Image,
  NativeSyntheticEvent,
  Text,
  TextLayoutEventData,
  TouchableOpacity,
  View,
} from 'react-native';
import {ms, ScaledSheet} from 'react-native-size-matters';

import {ScribeReviewIcon} from '@/assets';
import {ReviewTypeChip, VideoPreview} from '@/components';
import {ReviewType} from '@/contexts/ReviewApiContext';
import {
  colors,
  fontFamily,
  fontWeights,
  radius,
  stroke,
  typography,
} from '@/theme';

interface SimulationDetailsCardProps {
  reviewType?: ReviewType;
  coverImageUrl?: string;
  coverVideoUrl?: string;
  title?: string;
  description?: string | React.ReactNode;
  titleNumberOfLines?: number;
  descriptionNumberOfLines?: number;
}

export const SimulationDetailsCard = ({
  reviewType,
  coverImageUrl,
  coverVideoUrl,
  title,
  description,
  titleNumberOfLines = 1,
  descriptionNumberOfLines = 2,
}: SimulationDetailsCardProps) => {
  const {t} = useTranslation();
  const isFocused = useIsFocused();
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [isTextTruncated, setIsTextTruncated] = useState(false);

  const toggleDescription = () => {
    setIsDescriptionExpanded(!isDescriptionExpanded);
  };

  const handleTextLayout = (
    event: NativeSyntheticEvent<TextLayoutEventData>,
  ) => {
    if (isDescriptionExpanded) return;
    const {lines} = event.nativeEvent;
    if (lines.length > descriptionNumberOfLines) {
      setIsTextTruncated(true);
    }
  };

  return (
    <View style={styles.scenarioContainer}>
      <View style={styles.coverContainer}>
        {!!coverVideoUrl && (
          <VideoPreview
            videoUrl={coverVideoUrl}
            autoPlay={false}
            shouldPause={!isFocused}
            testID="scenario-video-preview"
          />
        )}

        {!coverVideoUrl && !!coverImageUrl && (
          <Image source={{uri: coverImageUrl}} style={styles.cover} />
        )}

        {reviewType === 'scribe' && (
          <ScribeReviewIcon width="100%" height={ms(180)} />
        )}
      </View>
      <View style={styles.cardBody}>
        <View style={styles.textContainer}>
          {reviewType && <ReviewTypeChip reviewType={reviewType} />}
          <Text style={styles.cardTitle} numberOfLines={titleNumberOfLines}>
            {title || '-'}
          </Text>
          {!!description && (
            <View>
              <Text
                style={styles.cardDesc}
                numberOfLines={
                  isDescriptionExpanded ? undefined : descriptionNumberOfLines
                }
                onTextLayout={handleTextLayout}>
                {description}
              </Text>
              {(isTextTruncated || isDescriptionExpanded) && (
                <TouchableOpacity onPress={toggleDescription}>
                  <Text style={styles.viewMoreText}>
                    {isDescriptionExpanded
                      ? t('common.viewLess')
                      : t('common.viewMore')}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      </View>
    </View>
  );
};

const styles = ScaledSheet.create({
  scenarioContainer: {
    borderWidth: 0.5,
    borderColor: stroke.primary,
    borderRadius: radius.xl2,
    padding: '8@s',
    gap: '16@s',
  },
  coverContainer: {
    height: '180@ms',
    backgroundColor: colors.ds.grey[50],
    borderRadius: radius.lg,
    width: '100%',
  },
  cover: {
    minHeight: '180@ms',
    backgroundColor: colors.ds.grey[100],
    borderRadius: radius.lg,
  },
  cardBody: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  textContainer: {
    flex: 1,
  },
  cardTitle: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.highEmphasis,
    marginBottom: '5@ms',
  },
  cardDesc: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.mediumEmphasis,
  },
  viewMoreText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.medium,
    fontWeight: fontWeights.medium,
    color: colors.ds.typography.highEmphasis,
  },
});
