import React, {useState} from 'react';
import {Image, Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {HelpIcon} from '@/assets';
import {useTranslate} from '@/hooks';
import {SimulationDetailsModal} from '@/screens/SimulationPathDetailsScreen/components/SimulationDetailsModal';
import {colors, fontFamily} from '@/theme';
import {ExperienceMode, SimulationSummaryData} from '@/types';
import {formatDateTime, isShortSession} from '@/utils';

import {EventChecklist} from '../EventChecklist';
import {ShortSessionUI} from '../ShortSessionUI';
import {SummaryCard} from '../SummaryCard';

interface SimulationSummaryProps {
  data: SimulationSummaryData | null;
}

// This component now only renders for short sessions (see
// getSimulationSummaryTabs) — the "strengths / areas for growth" lists it
// used to show for the full-length case were retired in favour of Ally's
// debrief note (see components/Debrief/DebriefTab, which now renders
// EventChecklist for CHECKLIST-mode roleplays that AREN'T short). The
// EventChecklist branch just below is left exactly as it was: unreachable
// whenever isShortSession is true (as it always has been), so untouched
// rather than deleted.
export const SimulationSummary: React.FC<SimulationSummaryProps> = ({data}) => {
  const {t} = useTranslate();

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

  // Match ally-web: use metadata.sessionName for session id display (FeedbackSection shows "ID: {formattedData.sessionName}")
  const sessionName = data?.metadata?.sessionName ?? data?.id ?? '';

  const experienceMode = data?.scenario?.metadata?.experienceMode;
  const isChecklistMode = experienceMode === ExperienceMode.CHECKLIST;

  // Note: coverImageUrl may be available in extended scenario data
  const coverImageUrl =
    (data?.scenario as {coverImageUrl?: string})?.coverImageUrl || undefined;

  const headerContent = (
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
  );

  return (
    <SummaryCard title={t('postSim.feedback.sessionFeedback')}>
      {headerContent}
      {isShortSession(data?.details?.callDuration) ? (
        <ShortSessionUI />
      ) : (
        isChecklistMode &&
        data?.id && <EventChecklist scenarioSessionId={data.id} />
      )}
      <SimulationDetailsModal
        visible={showSimulationDetailsModal}
        onClose={() => setShowSimulationDetailsModal(false)}
        title={t('simulationPage.simulationDetails')}
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
});
