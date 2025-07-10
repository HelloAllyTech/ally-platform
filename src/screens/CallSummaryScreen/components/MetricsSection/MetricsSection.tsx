import React from 'react';
import {View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {FIELD_LABELS, SUMMARY_FIELDS} from '@/constants/summary';

import {FieldRow} from '../FieldRow/FieldRow';

interface MetricsSectionProps {
  metrics: {
    listeningShare: string | null;
    reflectiveQuestionsAsked: number | null;
    emotionalLift: number | null;
  };
}

export const MetricsSection: React.FC<MetricsSectionProps> = ({metrics}) => {
  return (
    <View style={styles.container}>
      <FieldRow
        label={FIELD_LABELS[SUMMARY_FIELDS.LISTENING_RATIO]}
        value={
          metrics.listeningShare
            ? `${Math.round(Number(metrics.listeningShare) * 100)}%`
            : '-'
        }
        showSeparator
      />
      <FieldRow
        label={FIELD_LABELS[SUMMARY_FIELDS.REFLECTIVE_QUESTIONS_ASKED]}
        value={metrics.reflectiveQuestionsAsked || '-'}
        showSeparator
      />
      <FieldRow
        label={FIELD_LABELS[SUMMARY_FIELDS.EMOTIONAL_LIFT]}
        value={metrics.emotionalLift || '-'}
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
