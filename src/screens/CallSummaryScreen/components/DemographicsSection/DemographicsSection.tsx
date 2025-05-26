import React from 'react';
import {useTranslation} from 'react-i18next';
import {View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {FIELD_LABELS, SUMMARY_FIELDS} from '@/constants/summary';

import {FieldRow} from '../FieldRow/FieldRow';

interface DemographicsSectionProps {
  demographics: {
    callId: string | null;
    callDuration: number | null;
    callDate: string | null;
    callTime: string | null;
    callerId: string | null;
    callerType: string | null;
    age: string | number | null;
    gender: string | null;
    profession: string | null;
    location: string | null;
    languages: string | null;
    concernCode: string | null;
    moodImprovedBy: number | null;
    counsellorName: string | null;
  };
}

export const DemographicsSection: React.FC<DemographicsSectionProps> = ({
  demographics,
}) => {
  const {t} = useTranslation();

  return (
    <View style={styles.container}>
      <FieldRow
        label={FIELD_LABELS[SUMMARY_FIELDS.CALL_ID]}
        value={demographics.callId || '-'}
      />
      <FieldRow
        label={FIELD_LABELS[SUMMARY_FIELDS.CALL_DURATION]}
        value={
          demographics.callDuration
            ? `${demographics.callDuration} ${t('CallSummary.minutes')}`
            : '-'
        }
      />
      <FieldRow
        label={FIELD_LABELS[SUMMARY_FIELDS.CALL_DATE]}
        value={demographics.callDate || '-'}
      />
      <FieldRow
        label={FIELD_LABELS[SUMMARY_FIELDS.CALL_TIME]}
        value={demographics.callTime || '-'}
      />
      <FieldRow
        label={FIELD_LABELS[SUMMARY_FIELDS.CALLER_ID]}
        value={demographics.callerId || '-'}
        showSeparator
      />
      <FieldRow
        label={FIELD_LABELS[SUMMARY_FIELDS.CALLER_TYPE]}
        value={demographics.callerType || '-'}
      />
      <FieldRow
        label={FIELD_LABELS[SUMMARY_FIELDS.AGE]}
        value={demographics.age?.toString() || '-'}
      />
      <FieldRow
        label={FIELD_LABELS[SUMMARY_FIELDS.GENDER]}
        value={demographics.gender || '-'}
      />
      <FieldRow
        label={FIELD_LABELS[SUMMARY_FIELDS.PROFESSION]}
        value={demographics.profession || '-'}
      />
      <FieldRow
        label={FIELD_LABELS[SUMMARY_FIELDS.LOCATION]}
        value={demographics.location || '-'}
      />
      <FieldRow
        label={FIELD_LABELS[SUMMARY_FIELDS.LANGUAGES]}
        value={demographics.languages || '-'}
      />
      <FieldRow
        label={FIELD_LABELS[SUMMARY_FIELDS.CONCERN_CODE]}
        value={demographics.concernCode || '-'}
        showSeparator
      />
      <FieldRow
        label={FIELD_LABELS[SUMMARY_FIELDS.MOOD_IMPROVED_BY]}
        value={
          demographics.moodImprovedBy
            ? `${demographics.moodImprovedBy} ${t('CallSummary.points')}`
            : '-'
        }
      />
      <FieldRow
        label={FIELD_LABELS[SUMMARY_FIELDS.COUNSELOR_NAME]}
        value={demographics.counsellorName || '-'}
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
