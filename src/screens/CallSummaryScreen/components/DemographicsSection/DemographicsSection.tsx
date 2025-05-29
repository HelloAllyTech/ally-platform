import React, {useMemo} from 'react';
import {TextInput, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {CustomDropdown} from '@/components/Dropdown/Dropdown';
import {
  FIELD_LABELS,
  SUMMARY_FIELDS,
  SummaryFieldKey,
  summaryFields,
} from '@/constants/summary';
import {useCallSummaryForm} from '@/hooks/useCallSummaryForm';
import useTranslate from '@/hooks/useTranslate';
import {useAppSelector} from '@/store/hooks';
import {AppRootState} from '@/store/store';
import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';
import {typography} from '@/theme/typography';
import {FieldType, SummaryFieldValueTypes} from '@/types/callSummary';
import {formatTimeHHmm} from '@/utils/date';

import {FieldRow} from '../FieldRow/FieldRow';

interface FieldConfig {
  field: SummaryFieldKey;
  value: SummaryFieldValueTypes;
}

interface DemographicsSectionProps {
  isEditing: boolean;
  handleFieldChange?: (field: string) => (value: string) => void;
}

export const DemographicsSection: React.FC<DemographicsSectionProps> = ({
  isEditing,
}) => {
  const {t} = useTranslate();
  const {handleFieldChange, formData} = useCallSummaryForm();
  const summaryData = useAppSelector(
    (state: AppRootState) => state.summary.summaryData,
  );
  const summary = summaryData?.details?.summary;
  const summaryDetails = summaryData?.details;

  const renderField = (fieldConfig: FieldConfig) => {
    const fieldItem = summaryFields.find(
      field => field.key === fieldConfig.field,
    );

    switch (fieldItem?.type) {
      case FieldType.Text:
        return (
          <FieldRow
            key={fieldConfig.field}
            label={FIELD_LABELS[fieldConfig.field]}
            value={fieldConfig.value as string}
          />
        );

      case FieldType.InlineTextInput:
        return (
          <FieldRow
            key={fieldConfig.field}
            label={FIELD_LABELS[fieldConfig.field]}
            value={
              isEditing && fieldItem?.isEditable ? (
                <TextInput
                  style={styles.inlineTextInput}
                  value={(formData?.[fieldConfig.field] as string) || ''}
                  onChangeText={handleFieldChange(fieldConfig.field)}
                  placeholder={t('CallSummary.enterDetail')}
                  placeholderTextColor={colors.lightGray3}
                  autoCapitalize="words"
                  returnKeyType="done"
                  numberOfLines={1}
                />
              ) : (
                (fieldConfig.value as string)
              )
            }
          />
        );

      case FieldType.Dropdown:
        return (
          <FieldRow
            key={fieldConfig.field}
            label={FIELD_LABELS[fieldConfig.field]}
            value={
              isEditing ? (
                <View style={styles.dropdownContainer}>
                  <CustomDropdown
                    value={fieldConfig.value as string}
                    options={Array.from(fieldItem.options || [])}
                    onSelect={(selectedValue: string) => {
                      handleFieldChange?.(fieldConfig.field)(selectedValue);
                    }}
                  />
                </View>
              ) : (
                (fieldConfig.value as string)
              )
            }
          />
        );

      default:
        return (
          <FieldRow
            key={fieldConfig.field}
            label={FIELD_LABELS[fieldConfig.field]}
            value={fieldConfig.value as string}
          />
        );
    }
  };
  const durationInSeconds =
    summaryDetails?.callDuration || summary?.[SUMMARY_FIELDS.CALL_DURATION];

  const fields: FieldConfig[] = useMemo(
    () => [
      {
        field: SUMMARY_FIELDS.CALL_ID,
        value:
          summaryDetails?.chatId || summary?.[SUMMARY_FIELDS.CALL_ID] || '-',
      },
      {
        field: SUMMARY_FIELDS.CALL_DURATION,
        value: durationInSeconds
          ? `${Math.floor(Number(durationInSeconds) / 60)} ${t('CallSummary.minutes')}`
          : '-',
      },
      {
        field: SUMMARY_FIELDS.CALL_DATE,
        value: summary?.[SUMMARY_FIELDS.CALL_DATE] || '-',
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
        value: summary?.[SUMMARY_FIELDS.CALLER_ID] || '-',
      },
      {
        field: SUMMARY_FIELDS.COUNSELOR_NAME,
        value: summary?.[SUMMARY_FIELDS.COUNSELOR_NAME] || '-',
      },
      {
        field: SUMMARY_FIELDS.CALLER_TYPE,
        value: summary?.[SUMMARY_FIELDS.CALLER_TYPE] || '-',
      },
      {
        field: SUMMARY_FIELDS.AGE,
        value: formData?.[SUMMARY_FIELDS.AGE] || '-',
      },
      {
        field: SUMMARY_FIELDS.GENDER,
        value: formData?.[SUMMARY_FIELDS.GENDER] || '-',
      },
      {
        field: SUMMARY_FIELDS.PROFESSION,
        value: formData?.[SUMMARY_FIELDS.PROFESSION] || '-',
      },
      {
        field: SUMMARY_FIELDS.RELATIONSHIP_STATUS,
        value: formData?.[SUMMARY_FIELDS.RELATIONSHIP_STATUS] || '-',
      },
      {
        field: SUMMARY_FIELDS.LANGUAGES,
        value:
          summary?.[SUMMARY_FIELDS.LANGUAGES]
            ?.map(language => `${language.language} (${language.percentage}%)`)
            .join(', ') || '-',
      },
      {
        field: SUMMARY_FIELDS.LOCATION,
        value: summary?.[SUMMARY_FIELDS.LOCATION] || '-',
      },
    ],
    [durationInSeconds, formData, summary, summaryDetails, t],
  );

  return (
    <View style={styles.container}>
      {fields.map(field => renderField(field))}
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
  },
  dropdownContainer: {
    flex: 1,
    minHeight: '40@vs',
  },
  inlineTextInput: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.lightGray3,
    flex: 1,
    marginRight: '10@ms',
  },
});
