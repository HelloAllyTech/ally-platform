import React, {memo, useCallback, useMemo, useState} from 'react';
import {TextInput, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {CustomDropdown, SearchableLocationDropdown} from '@/components';
import commonStyles from '@/components/styles';
import {
  FIELD_LABELS,
  LanguageMap,
  SUMMARY_FIELDS,
  SummaryFieldKey,
  summaryFields,
} from '@/constants';
import {useCallSummaryForm, useTranslate} from '@/hooks';
import {useAppSelector} from '@/store/hooks';
import {
  selectCallDetails,
  selectSummary,
  selectSummaryVisibleFields,
} from '@/store/slices/summarySlice';
import {colors} from '@/theme/colors';
import {EditableFieldKey, FieldConfig, FieldType} from '@/types';
import {formatDateWithOrdinal, formatTimeHHmm} from '@/utils/date';

import {FieldRow} from '../FieldRow/FieldRow';

interface DemographicsSectionProps {
  isEditing: boolean;
  handleFieldChange?: (field: string) => (value: string) => void;
}

const DemographicsSectionComponent: React.FC<DemographicsSectionProps> = ({
  isEditing,
}) => {
  const {t} = useTranslate();
  const {handleFieldChange, formData} = useCallSummaryForm();
  const visibleFields = useAppSelector(selectSummaryVisibleFields);

  const [openDropdown, setOpenDropdown] = useState<SummaryFieldKey | null>(
    null,
  );

  const callDetails = useAppSelector(selectCallDetails);
  const summary = useAppSelector(selectSummary);

  const fields = useMemo(() => {
    const durationInSeconds =
      callDetails?.callDuration || summary?.[SUMMARY_FIELDS.CALL_DURATION];

    return [
      {
        field: SUMMARY_FIELDS.CALL_ID,
        value: callDetails?.chatId || summary?.[SUMMARY_FIELDS.CALL_ID] || '-',
      },
      {
        field: SUMMARY_FIELDS.CALL_DURATION,
        value: durationInSeconds
          ? `${Math.floor(Number(durationInSeconds) / 60)} ${t('CallSummary.minutes')}`
          : '-',
      },
      {
        field: SUMMARY_FIELDS.CALL_DATE,
        value: callDetails?.startTime
          ? formatDateWithOrdinal(callDetails.startTime)
          : '-',
      },
      {
        field: SUMMARY_FIELDS.CALL_TIME,
        value:
          callDetails?.startTime && callDetails?.endTime
            ? `${formatTimeHHmm(callDetails.startTime)}-${formatTimeHHmm(callDetails.endTime)}`
            : '-',
      },
      {
        field: SUMMARY_FIELDS.CALLER_ID,
        value: (() => {
          const callerId =
            callDetails?.clientId || summary?.[SUMMARY_FIELDS.CALLER_ID];
          if (callerId === -1) {
            return 'N/A';
          }
          return callerId || '-';
        })(),
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
            ?.map(
              (language: {language: string; percentage: number}) =>
                `${LanguageMap[language.language as keyof typeof LanguageMap]} (${language.percentage}%)`,
            )
            .join(', ') || '-',
      },
      {
        field: SUMMARY_FIELDS.LOCATION,
        value: formData?.[SUMMARY_FIELDS.LOCATION] || '-',
      },
      {
        field: SUMMARY_FIELDS.CONCERN_CODE,
        value: formData?.[SUMMARY_FIELDS.CONCERN_CODE] || '-',
      },
    ];
  }, [callDetails, summary, formData, t]);

  const handleDropdownToggle = useCallback(
    (field: SummaryFieldKey, value: boolean) => {
      setOpenDropdown(value ? field : null);
    },
    [],
  );

  const handleDropdownSelect = useCallback(
    (field: SummaryFieldKey) => (value: string) => {
      handleFieldChange?.(field)(value);
    },
    [handleFieldChange],
  );

  const renderField = useCallback(
    (fieldConfig: FieldConfig) => {
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
                    style={[
                      commonStyles.fieldValueText,
                      styles.inlineTextInput,
                    ]}
                    value={
                      fieldItem?.isEditable
                        ? formData?.[fieldConfig.field as EditableFieldKey] ||
                          ''
                        : (fieldConfig.value as string) || ''
                    }
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
                      onSelect={handleDropdownSelect(fieldConfig.field)}
                      isOpen={openDropdown === fieldConfig.field}
                      setIsOpen={(value: boolean) =>
                        handleDropdownToggle(fieldConfig.field, value)
                      }
                    />
                  </View>
                ) : (
                  (fieldConfig.value as string)
                )
              }
            />
          );

        case FieldType.SearchableDropdown:
          return (
            <FieldRow
              key={fieldConfig.field}
              label={FIELD_LABELS[fieldConfig.field]}
              value={
                isEditing ? (
                  <View style={styles.dropdownContainer}>
                    <SearchableLocationDropdown
                      value={fieldConfig.value as string}
                      onSelect={handleDropdownSelect(fieldConfig.field)}
                      isOpen={openDropdown === fieldConfig.field}
                      setIsOpen={(value: boolean) =>
                        handleDropdownToggle(fieldConfig.field, value)
                      }
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
    },
    [
      isEditing,
      formData,
      handleFieldChange,
      t,
      openDropdown,
      handleDropdownToggle,
      handleDropdownSelect,
    ],
  );

  const filteredFields = fields.filter(field =>
    visibleFields.includes(field.field),
  );

  return (
    <View style={styles.container}>{filteredFields.map(renderField)}</View>
  );
};

export const DemographicsSection = memo(DemographicsSectionComponent);

const styles = ScaledSheet.create({
  container: {
    flex: 1,
  },
  dropdownContainer: {
    flex: 1,
  },
  inlineTextInput: {
    flex: 1,
    marginRight: '10@ms',
  },
});
