// CallSummaryDetails.tsx

import React, {useState} from 'react';
import {ActivityIndicator, View} from 'react-native';
import {KeyboardAwareScrollView} from 'react-native-keyboard-aware-scroll-view';
import {ScaledSheet} from 'react-native-size-matters';

import {
  CallDetailsIcon,
  CallHighlightsIcon,
  DemogsIcon,
  FlowIcon,
  KeyConcernIcon,
} from '@/assets/icons';
import {WINDOW_HEIGHT} from '@/constants/general';
import {useAppNavigation} from '@/hooks/useAppNavigation';
import {CallSummaryResponse} from '@/services/callSummaryApi';
import {colors} from '@/theme/colors';
import {SectionKey, summaryFields, visibleFields} from '@/types/callSummary';
import {getFormattedCallSummary} from '@/utils/callSummary';

import {CallDetailsSection} from '../CallDetails/CallDetailsSection';
import {CallHighlightsSection} from '../CallHighlights/CallHighlightsSection';
import {DemographicsSection} from '../DemographicsSection/DemographicsSection';
import {FlowSection} from '../FlowSection/FlowSection';
import {KeyConcernSection} from '../KeyConcern/KeyConcernSection';
import {NotesSection} from './NotesSection';
import {SectionHeader} from './SectionHeader';

interface Props {
  summaryData: CallSummaryResponse;
  isLoading: boolean;
}

const SECTION_LIST = [
  {
    key: SectionKey.CallDetails,
    label: 'Call Details',
    icon: <CallDetailsIcon />,
  },
  {key: SectionKey.KeyConcern, label: 'Key concern', icon: <KeyConcernIcon />},
  {
    key: SectionKey.CallHighlights,
    label: 'Call highlights',
    icon: <CallHighlightsIcon />,
  },
  {key: SectionKey.Demographics, label: 'Demographics', icon: <DemogsIcon />},
  {key: SectionKey.Flow, label: 'Flow', icon: <FlowIcon />},
];

export const CallSummaryDetails: React.FC<Props> = ({
  summaryData,
  isLoading,
}) => {
  const navigation = useAppNavigation();
  const futureData = undefined;

  const [expanded, setExpanded] = useState({
    [SectionKey.CallDetails]: true,
    [SectionKey.KeyConcern]: true,
    [SectionKey.CallHighlights]: true,
    [SectionKey.Demographics]: true,
    [SectionKey.Flow]: true,
  });
  const [notes, setNotes] = useState('');

  // Convert API responses to our flat structure with priority fallback
  const formattedSummary = getFormattedCallSummary(summaryData, futureData);

  // Use the flat data structure but fall back to dummy data when needed
  const formattedData = {
    [SectionKey.CallDetails]: {
      date: formattedSummary.callDate || '--',
      time: formattedSummary.callTime || '--',
      type: formattedSummary.callerType || '--',
      counsellor: formattedSummary.counsellorName || '--',
    },
    [SectionKey.KeyConcern]: formattedSummary.keyConcerns || '--',
    [SectionKey.CallHighlights]: {
      duration: formattedSummary.callLastedOver,
      questions: formattedSummary.youAsked,
      copilot: formattedSummary.usedCopilot,
      listeningRatio: formattedSummary.listeningRatio,
      moodImproved: formattedSummary.moodImprovedBy,
    },
    [SectionKey.Demographics]: {
      callerId: formattedSummary.callerId,
      age: formattedSummary.age,
      gender: formattedSummary.gender,
      profession: formattedSummary.profession,
      concernCode: formattedSummary.concernCode,
      diagnosis: formattedSummary.formalDiagnosis,
      location: formattedSummary.location,
    },
    [SectionKey.Flow]: formattedSummary.flow || '',
  };

  const toggleSection = (key: SectionKey) => {
    setExpanded(prev => ({...prev, [key]: !prev[key]}));
  };

  const handleSubmit = () => {
    // Handle submit logic here
    navigation.navigate('Home');
  };

  const renderSection = (section: {
    key: SectionKey;
    label: string;
    icon: React.ReactNode;
  }) => {
    // Only render sections that have visible fields
    const sectionFields = summaryFields.filter(
      field => field.sectionKey === section.key,
    );
    const hasVisibleFields = sectionFields.some(
      field => visibleFields[field.key],
    );

    if (!hasVisibleFields) {
      return null;
    }

    switch (section.key) {
      case SectionKey.CallDetails:
        return <CallDetailsSection callDetails={formattedData[section.key]} />;
      case SectionKey.KeyConcern:
        return <KeyConcernSection concerns={formattedData[section.key]} />;
      case SectionKey.CallHighlights:
        return (
          <CallHighlightsSection highlights={formattedData[section.key]} />
        );
      case SectionKey.Demographics:
        return (
          <DemographicsSection demographics={formattedData[section.key]} />
        );
      case SectionKey.Flow:
        return <FlowSection flow={formattedData[section.key]} />;
    }
  };

  // TO DO: Add loading state
  if (isLoading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={colors.darkSlate} />
      </View>
    );
  }

  return (
    <KeyboardAwareScrollView style={styles.container}>
      <View style={styles.card}>
        {SECTION_LIST.map(section => {
          // Only render sections that have visible fields
          const sectionFields = summaryFields.filter(
            field => field.sectionKey === section.key,
          );
          const hasVisibleFields = sectionFields.some(
            field => visibleFields[field.key],
          );

          if (!hasVisibleFields) {
            return null;
          }

          return (
            <View key={section.key} style={styles.sectionBox}>
              <SectionHeader
                label={section.label}
                isExpanded={expanded[section.key]}
                onToggle={() => toggleSection(section.key)}
                icon={section.icon}
              />
              {expanded[section.key] && (
                <View style={styles.sectionContent}>
                  {renderSection(section)}
                </View>
              )}
            </View>
          );
        })}
        <NotesSection
          notes={notes}
          onNotesChange={setNotes}
          onSubmit={handleSubmit}
        />
      </View>
    </KeyboardAwareScrollView>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    padding: '20@ms',
  },
  card: {
    backgroundColor: colors.white,
    width: '95%',
    minHeight: WINDOW_HEIGHT * 1.2,
    marginBottom: '20@ms',
  },
  sectionBox: {
    borderBottomColor: colors.lightGray2,
    borderBottomWidth: 1,
    overflow: 'hidden',
  },
  sectionContent: {
    paddingLeft: '30@ms',
  },
});
