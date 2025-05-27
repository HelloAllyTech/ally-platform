import React from 'react';
import {View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {FIELD_LABELS, SUMMARY_FIELDS} from '@/constants/summary';

import {FieldRow} from '../FieldRow/FieldRow';

interface MetricsSectionProps {
  metrics: {
    listeningShare: number | null;
    reflectiveQuestionsAsked: number | null;
    emotionsLift: number | null;
  };
}

export const MetricsSection: React.FC<MetricsSectionProps> = ({metrics}) => {
  return (
    <View style={styles.container}>
      <FieldRow
        label={FIELD_LABELS[SUMMARY_FIELDS.LISTENING_RATIO]}
        value={metrics.listeningShare || '-'}
        showSeparator
      />
      <FieldRow
        label={FIELD_LABELS[SUMMARY_FIELDS.REFLECTIVE_QUESTIONS_ASKED]}
        value={metrics.reflectiveQuestionsAsked || '-'}
        showSeparator
      />
      <FieldRow
        label={FIELD_LABELS[SUMMARY_FIELDS.EMOTIONS_LIFT]}
        value={metrics.emotionsLift || '-'}
      />
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    paddingTop: '4@ms',
    paddingBottom: '6@ms',
  },
});
