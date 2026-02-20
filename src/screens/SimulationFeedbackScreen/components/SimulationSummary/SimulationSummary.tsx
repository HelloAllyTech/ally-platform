import React, {useState} from 'react';
import {Image, Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {ArrowDown, HelpIcon} from '@/assets';
import {useTranslate} from '@/hooks';
import {SimulationDetailsModal} from '@/screens/SimulationPathDetailsScreen/components/SimulationDetailsModal';
import {colors, fontFamily, typography} from '@/theme';
import {SimulationSummaryData} from '@/types';
import {formatDateTime} from '@/utils';

import {SummaryCard} from '../SummaryCard';

interface SimulationSummaryProps {
  data: SimulationSummaryData | null;
  positives?: string[];
  improvements?: string[];
}

export const SimulationSummary: React.FC<SimulationSummaryProps> = ({
  data,
  positives = [],
  improvements = [],
}) => {
  const {t} = useTranslate();

  const [showSimulationDetailsModal, setShowSimulationDetailsModal] =
    useState(false);
  const [expandedSections, setExpandedSections] = useState({
    whatWentWell: false,
    areasForImprovement: false,
  });

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections(prev => ({...prev, [section]: !prev[section]}));
  };

  const formatDurationAsMMSS = (startedAt?: string, endedAt?: string) => {
    if (!startedAt || !endedAt) return '-';
    const startedAtDate = new Date(startedAt);
    const endedAtDate = new Date(endedAt);
    const duration = endedAtDate.getTime() - startedAtDate.getTime();
    const minutes = Math.floor(duration / (1000 * 60));
    const seconds = Math.floor((duration % (1000 * 60)) / 1000);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')} Min`;
  };

  // Match ally-web: use metadata.sessionName for session id display (FeedbackSection shows "ID: {formattedData.sessionName}")
  const sessionName = data?.metadata?.sessionName ?? data?.id ?? '';

  // Note: coverImageUrl may be available in extended scenario data
  const coverImageUrl =
    (data?.scenario as {coverImageUrl?: string})?.coverImageUrl || undefined;

  const renderFeedbackItem = (item: string, index: number) => (
    <View key={index} style={styles.feedbackItemContainer}>
      <Text style={styles.feedbackText}>{item}</Text>
    </View>
  );

  const renderExpandableSection = (
    title: string,
    items: string[],
    sectionKey: keyof typeof expandedSections,
  ) => {
    const isExpanded = expandedSections[sectionKey];
    const displayItems = isExpanded ? items : items.slice(0, 3);

    return (
      <View style={styles.feedbackSectionContainer}>
        <View style={styles.feedbackSectionHeader}>
          <Text style={styles.feedbackSectionTitle}>{title}</Text>
        </View>
        <View style={styles.feedbackSectionContent}>
          {displayItems.length > 0 ? (
            displayItems.map(renderFeedbackItem)
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

  return (
    <SummaryCard title={t('SimulationFeedback.sessionFeedback')}>
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
            {!!sessionName && (
              <Text style={styles.idText}>ID: {sessionName}</Text>
            )}
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
      {/* {data?.id && <EventChecklist scenarioSessionId={data.id} />} */}
      {renderExpandableSection(
        t('SimulationFeedback.biggestStrengthsSkills'),
        positives,
        'whatWentWell',
      )}
      {renderExpandableSection(
        t('SimulationFeedback.areasOfGrowth'),
        improvements,
        'areasForImprovement',
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
    </SummaryCard>
  );
};

const styles = ScaledSheet.create({
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
  feedbackSectionContainer: {
    borderWidth: '0.5@ms',
    borderColor: colors.ds.deepPurple[300],
    borderRadius: '4@ms',
    backgroundColor: colors.white,
    marginTop: '16@vs',
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
  feedbackText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '13@ms',
    lineHeight: '20@ms',
    letterSpacing: '0.25@ms',
    color: colors.black,
    flex: 1,
  },
  noItemsText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.typography.lowEmphasis,
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
});
