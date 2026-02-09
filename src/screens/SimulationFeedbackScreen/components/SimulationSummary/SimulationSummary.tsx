import React, {useState} from 'react';
import {Image, Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {ArrowDown, HelpIcon, LightBulbIcon, ThumbUpIcon} from '@/assets';
import {useTranslate} from '@/hooks';
import {SimulationDetailsModal} from '@/screens/SimulationPathDetailsScreen/components/SimulationDetailsModal';
import {colors, fontFamily, typography} from '@/theme';
import {SimulationSummaryData} from '@/types';
import {formatDateTime} from '@/utils';

interface SimulationSummaryProps {
  data: SimulationSummaryData | null;
}

export const SimulationSummary: React.FC<SimulationSummaryProps> = ({data}) => {
  const {t} = useTranslate();

  const [expandedSections, setExpandedSections] = useState({
    keyEvents: false,
    whatWentWell: false,
    areasForImprovement: false,
  });
  const [showSimulationDetailsModal, setShowSimulationDetailsModal] =
    useState(false);

  const formatDurationAsMMSS = (startedAt?: string, endedAt?: string) => {
    if (!startedAt || !endedAt) return '-';
    const startedAtDate = new Date(startedAt);
    const endedAtDate = new Date(endedAt);
    const duration = endedAtDate.getTime() - startedAtDate.getTime();
    const minutes = Math.floor(duration / (1000 * 60));
    const seconds = Math.floor((duration % (1000 * 60)) / 1000);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')} Min`;
  };

  const formatSimulationId = (id?: string) => {
    if (!id) return '';
    return `ID: SS-${id}`;
  };

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const renderFeedbackItem = (item: string, index: number) => (
    <View key={index} style={styles.feedbackItemContainer}>
      <Text style={styles.feedbackText}>{item}</Text>
    </View>
  );

  const renderExpandableSection = <T,>(
    title: string,
    icon: React.ReactNode,
    items: T[] = [],
    sectionKey: keyof typeof expandedSections,
    renderItem: (item: T, index: number) => React.ReactNode,
  ) => {
    const isExpanded = expandedSections[sectionKey];
    const displayItems = isExpanded ? items : items?.slice(0, 3);

    return (
      <View style={styles.feedbackSectionContainer}>
        <View style={styles.feedbackSectionHeader}>
          <Text style={styles.feedbackSectionTitle}>{title}</Text>
        </View>
        <View style={styles.feedbackSectionContent}>
          {displayItems?.length > 0 ? (
            displayItems?.map(renderItem)
          ) : (
            <Text style={styles.noItemsText}>
              {t('SimulationFeedback.noDataAvailable')}
            </Text>
          )}
          {items.length > 3 && (
            <TouchableOpacity
              style={styles.viewMoreButton}
              onPress={() => toggleSection(sectionKey)}>
              <Text style={styles.viewMoreText}>
                {isExpanded ? t('Common.viewLess') : t('Common.viewMore')}
              </Text>
              <ArrowDown
                width={10}
                height={10}
                color={colors.black}
                style={[isExpanded && styles.arrowIconRotated]}
              />
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  const positives =
    data?.details?.summary?.feedback?.positives || data?.whatWentWell || [];
  const improvements =
    data?.details?.summary?.feedback?.improvements ||
    data?.areasForImprovement ||
    [];

  // Note: coverImageUrl may be available in extended scenario data
  const coverImageUrl =
    (data?.scenario as {coverImageUrl?: string})?.coverImageUrl || undefined;

  return (
    <View style={styles.container}>
      <Text style={styles.summaryTitle}>
        {t('SimulationFeedback.sessionFeedback')}
      </Text>
      <View style={styles.headerContainer}>
        {coverImageUrl && (
          <Image
            source={{uri: coverImageUrl}}
            style={styles.coverImage}
            resizeMode="cover"
          />
        )}
        <View style={styles.headerContent}>
          <View style={styles.idRow}>
            <Text style={styles.idText}>{formatSimulationId(data?.id)}</Text>
          </View>
          {data?.scenario?.title && (
            <View style={styles.titleRow}>
              <Text style={styles.titleText}>{data.scenario.title}</Text>
              <TouchableOpacity
                onPress={() => {
                  setShowSimulationDetailsModal(true);
                }}>
                <HelpIcon width={14} height={14} />
              </TouchableOpacity>
            </View>
          )}
          <View style={styles.metadataRow}>
            {data?.startedAt && (
              <>
                <Text style={styles.metadataText}>
                  {formatDateTime(data.startedAt)}
                </Text>
                <Text style={styles.bulletSeparator}>•</Text>
                <Text style={styles.metadataText}>
                  {formatDurationAsMMSS(data?.startedAt, data?.endedAt)}
                </Text>
              </>
            )}
          </View>
        </View>
      </View>
      {renderExpandableSection(
        t('SimulationFeedback.whatWentWell'),
        <ThumbUpIcon width={20} height={20} style={styles.sectionIcon} />,
        positives,
        'whatWentWell',
        renderFeedbackItem,
      )}
      {renderExpandableSection(
        t('SimulationFeedback.areasForImprovement'),
        <LightBulbIcon width={20} height={20} style={styles.sectionIcon} />,
        improvements,
        'areasForImprovement',
        renderFeedbackItem,
      )}
      <SimulationDetailsModal
        visible={showSimulationDetailsModal}
        onClose={() => setShowSimulationDetailsModal(false)}
        title={t('Review.card.simulationDetails')}
        description={data?.scenario?.description}
        coverImageUrl={coverImageUrl}
        coverVideoUrl={data?.scenario?.coverVideoUrl || undefined}
        headerTitle={data?.scenario?.title}
        fitContent
      />
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    marginVertical: '10@vs',
    borderWidth: '0.5@ms',
    borderColor: colors.ds.stroke.primary,
    padding: '16@ms',
    borderRadius: '8@ms',
    backgroundColor: colors.white,
    shadowColor: colors.ds.grey[900],
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  summaryTitle: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.medium,
    fontSize: '14@ms',
    color: colors.ds.typography.highEmphasis,
    marginBottom: '16@vs',
    letterSpacing: '0.25@ms',
    borderBottomWidth: '0.5@ms',
    borderBottomColor: colors.ds.stroke.primary,
    paddingBottom: '16@vs',
  },
  section: {
    paddingBottom: '12@vs',
    marginBottom: '16@vs',
    borderBottomWidth: '0.4@ms',
    borderColor: colors.lightGray4,
  },
  sectionHeader: {
    marginBottom: '12@vs',
  },
  scenarioName: {
    ...fontFamily.REPLAY_PRO.BOLD,
    ...typography.body.large,
    color: colors.ds.typography.highEmphasis,
    marginTop: '16@vs',
    marginBottom: '24@vs',
  },
  sectionTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionIcon: {
    marginRight: '8@ms',
    color: colors.darkGray2,
  },
  sectionTitle: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.medium,
    color: colors.ds.typography.highEmphasis,
  },
  sectionContent: {
    gap: '12@vs',
  },
  eventItem: {
    backgroundColor: colors.white,
    borderRadius: '8@ms',
    padding: '16@ms',
    paddingVertical: '4@vs',
  },
  eventHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '4@ms',
    marginBottom: '4@vs',
  },
  eventTimestamp: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.small,
    color: colors.ds.typography.mediumEmphasis,
  },
  eventScore: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.small,
    color: colors.ds.typography.mediumEmphasis,
  },
  eventDescription: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.typography.highEmphasis,
  },
  feedbackItem: {
    backgroundColor: colors.white,
    borderRadius: '8@ms',
    padding: '16@ms',
    paddingVertical: '4@vs',
  },
  feedbackText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '13@ms',
    lineHeight: '20@ms',
    letterSpacing: '0.25@ms',
    color: colors.black,
    flex: 1,
  },
  viewMoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '4@ms',
  },
  viewMoreText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.medium,
    color: colors.ds.typography.mediumEmphasis,
  },
  arrowIconRotated: {
    transform: [{rotate: '180deg'}],
  },
  dot: {
    width: '4@ms',
    height: '4@ms',
    backgroundColor: colors.ds.typography.lowEmphasis,
    borderRadius: '2@ms',
    marginTop: '3@ms',
  },
  bulletPoint: {
    width: '4@ms',
    height: '4@ms',
    backgroundColor: colors.ds.typography.mediumEmphasis,
    borderRadius: '50%',
    position: 'absolute',
    left: '4@ms',
    top: '12@ms',
  },
  bulletPointEvents: {
    width: '4@ms',
    height: '4@ms',
    backgroundColor: colors.ds.typography.mediumEmphasis,
    borderRadius: '50%',
    position: 'absolute',
    left: '4@ms',
    top: '35@ms',
  },
  noItemsText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.typography.lowEmphasis,
  },
  feedbackSectionContainer: {
    borderWidth: '0.5@ms',
    borderColor: colors.ds.deepPurple[300],
    borderRadius: '4@ms',
    backgroundColor: colors.white,
    marginBottom: '16@vs',
  },
  feedbackSectionHeader: {
    backgroundColor: colors.ds.deepPurpleAlpha[50],
    paddingHorizontal: '16@ms',
    paddingVertical: '8@vs',
    flexDirection: 'row',
    alignItems: 'center',
    gap: '10@ms',
  },
  feedbackSectionTitle: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '13@ms',
    lineHeight: '20@ms',
    letterSpacing: '0.25@ms',
    color: colors.ds.typography.highEmphasis,
  },
  feedbackSectionContent: {
    padding: '16@ms',
    gap: '16@vs',
    borderBottomWidth: '0.5@ms',
    borderBottomColor: colors.ds.stroke.lightGray,
  },
  feedbackItemContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: '8@ms',
  },
  headerContainer: {
    flexDirection: 'column',
    gap: '16@vs',
    alignSelf: 'stretch',
    marginBottom: '16@vs',
  },
  coverImage: {
    width: '100%',
    height: '152.9@vs',
    borderRadius: '4@ms',
  },
  headerContent: {
    flexDirection: 'column',
    justifyContent: 'center',
    gap: '8@vs',
    alignSelf: 'stretch',
  },
  idRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '12@ms',
    height: '24@vs',
  },
  idText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '12@ms',
    lineHeight: '18@ms',
    color: colors.ds.typography.mediumEmphasis,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '4@ms',
  },
  titleText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    lineHeight: '18.2@ms',
    color: colors.ds.typography.highEmphasis,
  },
  metadataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '8@ms',
  },
  metadataText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '12@ms',
    lineHeight: '18@ms',
    color: colors.ds.typography.mediumEmphasis,
  },
  bulletSeparator: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '16@ms',
    lineHeight: '24@ms',
    letterSpacing: -0.5,
    textAlign: 'center',
    color: colors.ds.stroke.lightGray,
  },
});
