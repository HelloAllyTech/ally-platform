// CallSummaryDetails.tsx

import React, {useState} from 'react';
import {View} from 'react-native';
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
import {colors} from '@/theme/colors';

import {CallDetailsSection} from '../CallDetails/CallDetailsSection';
import {CallHighlightsSection} from '../CallHighlights/CallHighlightsSection';
import {DemogsSection} from '../DemogsSection/DemogsSection';
import {FlowSection} from '../FlowSection/FlowSection';
import {KeyConcernSection} from '../KeyConcern/KeyConcernSection';
import {NotesSection} from './NotesSection';
import {SectionHeader} from './SectionHeader';

// Dummy data as per the screenshot
const CALL_SUMMARY_DATA = {
  callDetails: {
    date: '11th February 2025',
    time: '11:03 – 11:32',
    type: 'Repeat caller, 3rd call',
    counsellor: 'Shruti Bhatia',
  },
  keyConcern:
    "-> Made space for the client to share thoughts and experiences. \n -> Validated their experiences and acknowledged the difficulty of caregiving. \n Reframed self-care and taking time off as not selfish. \n -> Encouraged a small behavioural experiment for letting go of. \n -> Explored the client's dreams and aspirations and acknowledged inner conflict. \n -> Explored the client's dreams and aspirations and acknowledged inner conflict.",
  callHighlights: {
    duration: '30 minutes',
    questions: 6,
    copilot: 4,
    listeningRatio: 0.67,
    moodImproved: 28,
  },
  demogs: {
    callerId: '134567',
    age: 28,
    gender: 'Male',
    profession: 'Engineer',
    concernCode: 'Seeking information',
    diagnosis: 'Depression',
  },
  flow: "-> Made space for the client to share thoughts and experiences. \n -> Validated their experiences and acknowledged the difficulty of caregiving. \n Reframed self-care and taking time off as not selfish. \n -> Encouraged a small behavioural experiment for letting go of. \n -> Explored the client's dreams and aspirations and acknowledged inner conflict. \n -> Explored the client's dreams and aspirations and acknowledged inner conflict.",
};

const SECTION_LIST = [
  {key: 'callDetails', label: 'Call Details', icon: <CallDetailsIcon />},
  {key: 'keyConcern', label: 'Key concern', icon: <KeyConcernIcon />},
  {
    key: 'callHighlights',
    label: 'Call highlights',
    icon: <CallHighlightsIcon />,
  },
  {key: 'demogs', label: 'Demogs', icon: <DemogsIcon />},
  {key: 'flow', label: 'Flow', icon: <FlowIcon />},
];

export const CallSummaryDetails: React.FC = () => {
  const navigation = useAppNavigation();

  const [expanded, setExpanded] = useState({
    callDetails: true,
    keyConcern: true,
    callHighlights: true,
    demogs: true,
    flow: true,
  });
  const [notes, setNotes] = useState('');

  const toggleSection = (key: string) => {
    setExpanded(prev => ({...prev, [key]: !prev[key as keyof typeof prev]}));
  };

  const handleSubmit = () => {
    // Handle submit logic here
    navigation.navigate('Home');
  };

  const renderSection = (section: (typeof SECTION_LIST)[number]) => {
    switch (section.key) {
      case 'callDetails':
        return (
          <CallDetailsSection callDetails={CALL_SUMMARY_DATA.callDetails} />
        );
      case 'keyConcern':
        return <KeyConcernSection concerns={CALL_SUMMARY_DATA.keyConcern} />;
      case 'callHighlights':
        return (
          <CallHighlightsSection
            highlights={CALL_SUMMARY_DATA.callHighlights}
          />
        );
      case 'demogs':
        return <DemogsSection demogs={CALL_SUMMARY_DATA.demogs} />;
      case 'flow':
        return <FlowSection flow={CALL_SUMMARY_DATA.flow} />;
    }
  };

  return (
    <KeyboardAwareScrollView style={styles.container}>
      <View style={styles.card}>
        {SECTION_LIST.map(section => (
          <View key={section.key} style={styles.sectionBox}>
            <SectionHeader
              label={section.label}
              isExpanded={expanded[section.key as keyof typeof expanded]}
              onToggle={() => toggleSection(section.key)}
              icon={section.icon}
            />
            {expanded[section.key as keyof typeof expanded] && (
              <View style={styles.sectionContent}>
                {renderSection(section)}
              </View>
            )}
          </View>
        ))}
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
    paddingHorizontal: '20@ms',
  },
});
