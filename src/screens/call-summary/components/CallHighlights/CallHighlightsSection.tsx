import React from 'react';
import {Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';

interface CallHighlightsSectionProps {
  highlights: {
    duration: string;
    questions: number;
    copilot: number;
    listeningRatio: number;
    moodImproved: number;
  };
}

export const CallHighlightsSection: React.FC<CallHighlightsSectionProps> = ({
  highlights,
}) => {
  return (
    <View style={styles.container}>
      <Text style={styles.detailText}>
        Call lasted over:{' '}
        <Text style={styles.detailValue}>{highlights.duration}</Text>
      </Text>
      <Text style={styles.detailText}>
        You asked:{' '}
        <Text style={styles.detailValue}>{highlights.questions} Questions</Text>
      </Text>
      <Text style={styles.detailText}>
        Used Copilot:{' '}
        <Text style={styles.detailValue}>{highlights.copilot} nudges</Text>
      </Text>
      <Text style={styles.detailText}>
        Listening ratio:{' '}
        <Text style={styles.detailValue}>{highlights.listeningRatio}</Text>
      </Text>
      <Text style={styles.detailText}>
        Mood improved by:{' '}
        <Text style={styles.detailValue}>{highlights.moodImproved} points</Text>
      </Text>
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    paddingTop: '8@ms',
    paddingBottom: '6@ms',
  },
  detailText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    color: colors.darkSlate,
    lineHeight: '26@ms',
  },
  detailValue: {
    color: colors.lightGray3,
  },
});
