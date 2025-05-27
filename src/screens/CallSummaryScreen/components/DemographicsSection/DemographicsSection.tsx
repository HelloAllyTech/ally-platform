import {useMemo} from 'react';
import {View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {
  FIELD_LABELS,
  SUMMARY_FIELDS,
  SummaryFieldKey,
} from '@/constants/summary';
import useTranslate from '@/hooks/useTranslate';
import {CallSummaryResponse} from '@/services/callSummaryApi';
import {formatTimeHHmm} from '@/utils/date';

import {FieldRow} from '../FieldRow/FieldRow';

interface FieldConfig {
  field: SummaryFieldKey;
  value: string | number;
  showSeparator?: boolean;
}

const renderField = (fieldConfig: FieldConfig) => (
  <FieldRow
    key={fieldConfig.field}
    label={FIELD_LABELS[fieldConfig.field]}
    value={fieldConfig.value}
  />
);

export const DemographicsSection = ({
  summaryDetails,
}: {
  summaryDetails: CallSummaryResponse['details'];
}) => {
  const {t} = useTranslate();
  const summary = summaryDetails.summary;
  const duration =
    summaryDetails.callDuration || summary[SUMMARY_FIELDS.CALL_DURATION];

  const fields: FieldConfig[] = useMemo(
    () => [
      {
        field: SUMMARY_FIELDS.CALL_ID,
        value: summaryDetails?.chatId || summary[SUMMARY_FIELDS.CALL_ID] || '-',
      },
      {
        field: SUMMARY_FIELDS.CALL_DURATION,
        value: duration
          ? `${Math.floor(Number(duration))} ${t('CallSummary.minutes')}`
          : '-',
      },
      {
        field: SUMMARY_FIELDS.CALL_DATE,
        value: summary[SUMMARY_FIELDS.CALL_DATE] || '-',
      },
      {
        field: SUMMARY_FIELDS.CALL_TIME,
        value:
          summaryDetails?.startTime && summaryDetails?.endTime
            ? `${formatTimeHHmm(summaryDetails.startTime)}-${formatTimeHHmm(summaryDetails.endTime)}`
            : '-',
      },
      {
        field: SUMMARY_FIELDS.CALLER_ID,
        value: summary[SUMMARY_FIELDS.CALLER_ID] || '-',
      },
      {
        field: SUMMARY_FIELDS.COUNSELOR_NAME,
        value: summary[SUMMARY_FIELDS.COUNSELOR_NAME] || '-',
      },
      {
        field: SUMMARY_FIELDS.CALLER_TYPE,
        value: summary[SUMMARY_FIELDS.CALLER_TYPE] || '-',
      },
      {
        field: SUMMARY_FIELDS.AGE,
        value: summary[SUMMARY_FIELDS.AGE] || '-',
      },
      {
        field: SUMMARY_FIELDS.GENDER,
        value: summary[SUMMARY_FIELDS.GENDER] || '-',
      },
      {
        field: SUMMARY_FIELDS.PROFESSION,
        value: summary[SUMMARY_FIELDS.PROFESSION] || '-',
      },
      {
        field: SUMMARY_FIELDS.RELATIONSHIP_STATUS,
        value: summary[SUMMARY_FIELDS.RELATIONSHIP_STATUS] || '-',
      },
      {
        field: SUMMARY_FIELDS.LANGUAGES,
        value:
          summary[SUMMARY_FIELDS.LANGUAGES]
            ?.map(language => `${language.language} (${language.percentage}%)`)
            .join(', ') || '-',
      },
      {
        field: SUMMARY_FIELDS.LOCATION,
        value: summary[SUMMARY_FIELDS.LOCATION] || '-',
      },
      {
        field: SUMMARY_FIELDS.CONCERN_CODE,
        value: summary[SUMMARY_FIELDS.CONCERN_CODE] || '-',
      },
    ],
    [duration, summary, summaryDetails, t],
  );

  return <View style={styles.container}>{fields.map(renderField)}</View>;
};

const styles = ScaledSheet.create({
  container: {
    paddingTop: '4@ms',
    paddingBottom: '6@ms',
  },
});
