import React from 'react';
import {TextInput, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {CustomDropdown, SearchableLocationDropdown} from '@/components';
import commonStyles from '@/components/styles';
import {FIELD_LABEL_KEYS, SummaryFieldKey} from '@/constants/summary';
import {colors} from '@/theme';
import {FieldDataContext, FieldType, SummaryField} from '@/types';

import {EditableField} from '../screens/CallSummaryScreen/components/EditableField/EditableField';
import {FieldRow} from '../screens/CallSummaryScreen/components/FieldRow/FieldRow';

/**
 * Get the value for a field from the appropriate data source
 */
export function getFieldValue(
  field: SummaryField,
  data: FieldDataContext,
): unknown {
  // 1. If field has custom compute function, use it
  if (field.computeValue) {
    return field.computeValue(data);
  }

  // 2. If field is editable, get from formData
  if (field.isEditable && data.formData && field.key in data.formData) {
    return data.formData[field.key];
  }

  // 3. Default: get from summary
  return data.summary?.[field.key];
}

/**
 * Format a field value for display
 */
export function formatFieldValue(
  field: SummaryField,
  value: unknown,
  t?: (key: string, params?: Record<string, unknown>) => string,
): string {
  // Use custom formatter if provided
  if (field.formatDisplay) {
    return field.formatDisplay(value, t);
  }

  // Default formatting
  if (value === null || value === undefined) {
    return '-';
  }

  return value.toString();
}

/**
 * Extra props for field rendering
 */
export interface RenderFieldExtraProps {
  openDropdown?: SummaryFieldKey | null;
  onDropdownToggle?: (field: SummaryFieldKey, open: boolean) => void;
  onDropdownSelect?: (field: SummaryFieldKey) => (value: string) => void;
  t?: (key: string, params?: Record<string, unknown>) => string;
  canEdit?: boolean;
}

/**
 * Render a field based on its type
 */
export function renderField(
  field: SummaryField,
  value: unknown,
  displayValue: string,
  isEditing: boolean,
  isEnhancing: boolean,
  onChange: (value: string) => void,
  extraProps: RenderFieldExtraProps = {},
): React.ReactElement {
  const {
    openDropdown,
    onDropdownToggle,
    onDropdownSelect,
    t,
    canEdit = true,
  } = extraProps;

  // Prefer the localized label; fall back to the hardcoded English label
  // when no translator is provided (e.g. some test contexts).
  const label = t ? t(FIELD_LABEL_KEYS[field.key]) : field.label;

  switch (field.type) {
    case FieldType.Text:
      return <FieldRow key={field.key} label={label} value={displayValue} />;

    case FieldType.InlineTextInput:
      return (
        <FieldRow
          key={field.key}
          label={label}
          value={displayValue}
          renderEdit={
            isEditing && field.isEditable
              ? () => (
                  <TextInput
                    style={[
                      commonStyles.fieldValueText,
                      styles.inlineTextInput,
                    ]}
                    value={value?.toString() || ''}
                    onChangeText={onChange}
                    placeholder={field.placeholder || 'Enter detail'}
                    placeholderTextColor={colors.lightGray3}
                    autoCapitalize="words"
                    returnKeyType="done"
                    numberOfLines={1}
                  />
                )
              : undefined
          }
        />
      );

    case FieldType.MultilineTextInput:
      return (
        <EditableField
          key={field.key}
          fieldKey={field.key}
          label={label}
          value={
            typeof value === 'string' ? value : value ? String(value) : null
          }
          onChangeText={onChange}
          canEdit={canEdit}
          isEditing={isEditing}
          isEnhancing={isEnhancing}
          placeholder="-"
        />
      );

    case FieldType.Dropdown:
      return (
        <FieldRow
          key={field.key}
          label={label}
          value={displayValue}
          renderEdit={
            isEditing
              ? () => (
                  <View style={styles.dropdownContainer}>
                    <CustomDropdown
                      value={displayValue}
                      options={Array.from(field.options || [])}
                      onSelect={onDropdownSelect?.(field.key) || onChange}
                      isOpen={openDropdown === field.key}
                      setIsOpen={(open: boolean) =>
                        onDropdownToggle?.(field.key, open)
                      }
                      modalTranslateX="-50%"
                    />
                  </View>
                )
              : undefined
          }
        />
      );

    case FieldType.SearchableDropdown:
      return (
        <FieldRow
          key={field.key}
          label={label}
          value={displayValue}
          renderEdit={
            isEditing
              ? () => (
                  <View style={styles.dropdownContainer}>
                    <SearchableLocationDropdown
                      value={displayValue}
                      onSelect={onDropdownSelect?.(field.key) || onChange}
                      isOpen={openDropdown === field.key}
                      setIsOpen={(open: boolean) =>
                        onDropdownToggle?.(field.key, open)
                      }
                    />
                  </View>
                )
              : undefined
          }
        />
      );

    default:
      // Fallback to text display
      return <FieldRow key={field.key} label={label} value={displayValue} />;
  }
}

const styles = ScaledSheet.create({
  inlineTextInput: {
    flex: 1,
    color: colors.ds.typography.highEmphasis,
    marginRight: '10@ms',
    maxWidth: '200@ms',
  },
  dropdownContainer: {
    flex: 1,
    maxWidth: '200@ms',
  },
});
