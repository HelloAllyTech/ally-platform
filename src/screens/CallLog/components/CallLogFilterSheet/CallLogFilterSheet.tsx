import React, {useEffect, useState} from 'react';
import {BottomSheetScrollView} from '@gorhom/bottom-sheet';
import {Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {BottomSheet, Button, LineTextInput} from '@/components';
import {useTranslate} from '@/hooks';
import {CustomFieldDefinition} from '@/services/customFieldsApi.types';
import {colors, fontFamily, typography} from '@/theme';

import {
  FilterFieldDef,
  FilterState,
  FilterValue,
  getFilterFields,
} from '../../utils/fieldFilters';

interface CallLogFilterSheetProps {
  visible: boolean;
  onClose: () => void;
  definitions: CustomFieldDefinition[];
  /** Tenant tag options for the built-in Tags filter. */
  tagOptions?: {label: string; value: string}[];
  /** Currently-applied filter state, used to seed the draft when opened. */
  appliedState: FilterState;
  onApply: (state: FilterState) => void;
}

/** Reads the [min/from, max/to] tuple of a range value, tolerating partials. */
const rangeAt = (value: FilterValue | undefined, idx: number): string =>
  Array.isArray(value) ? (value[idx] ?? '') : '';

export const CallLogFilterSheet: React.FC<CallLogFilterSheetProps> = ({
  visible,
  onClose,
  definitions,
  tagOptions = [],
  appliedState,
  onApply,
}) => {
  const {t} = useTranslate();
  const [draft, setDraft] = useState<FilterState>(appliedState);

  // Reseed the draft from the applied state each time the sheet opens so an
  // abandoned edit (closed without applying) doesn't leak into the next open.
  useEffect(() => {
    if (visible) setDraft(appliedState);
  }, [visible, appliedState]);

  const fields = getFilterFields(definitions, tagOptions);

  const setValue = (id: string, value: FilterValue) =>
    setDraft(prev => ({...prev, [id]: value}));

  const setRange = (id: string, idx: 0 | 1, next: string) =>
    setDraft(prev => {
      const current = Array.isArray(prev[id])
        ? [...(prev[id] as string[])]
        : ['', ''];
      current[idx] = next;
      return {...prev, [id]: current};
    });

  const toggleOption = (id: string, optValue: string) =>
    setDraft(prev => {
      const current = Array.isArray(prev[id]) ? (prev[id] as string[]) : [];
      const next = current.includes(optValue)
        ? current.filter(v => v !== optValue)
        : [...current, optValue];
      return {...prev, [id]: next};
    });

  const handleClear = () => setDraft({});

  const handleApply = () => {
    onApply(draft);
    onClose();
  };

  const renderControl = (field: FilterFieldDef) => {
    const {key, control, options = []} = field;
    const value = draft[key];

    switch (control) {
      case 'multiselect':
        return (
          <View style={styles.chipRow}>
            {options.map(opt => {
              const selected =
                Array.isArray(value) && value.includes(opt.value);
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => toggleOption(key, opt.value)}>
                  <Text
                    style={[
                      styles.chipText,
                      selected && styles.chipTextSelected,
                    ]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        );

      case 'number':
      case 'date':
        return (
          <View style={styles.rangeRow}>
            <View style={styles.rangeInput}>
              <LineTextInput
                placeholder={
                  control === 'number'
                    ? t('calls.filters.min')
                    : t('calls.filters.from')
                }
                value={rangeAt(value, 0)}
                onChangeText={text => setRange(key, 0, text)}
              />
            </View>
            <Text style={styles.rangeDash}>–</Text>
            <View style={styles.rangeInput}>
              <LineTextInput
                placeholder={
                  control === 'number'
                    ? t('calls.filters.max')
                    : t('calls.filters.to')
                }
                value={rangeAt(value, 1)}
                onChangeText={text => setRange(key, 1, text)}
              />
            </View>
          </View>
        );

      case 'text':
      default:
        return (
          <LineTextInput
            placeholder={t('calls.filters.searchPlaceholder')}
            value={typeof value === 'string' ? value : ''}
            onChangeText={text => setValue(key, text)}
          />
        );
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      initialSnapPoint={70}
      // The scroll view below is flex:1, so it reports no height of its own; with
      // dynamic sizing left on, this sheet's snap points never resolve.
      enableDynamicSizing={false}
      backgroundColor={colors.white}>
      <View style={styles.container}>
        <Text style={styles.title}>{t('calls.filters.title')}</Text>
        {fields.length === 0 ? (
          <Text style={styles.empty}>{t('calls.filters.noFields')}</Text>
        ) : (
          /*
           * BottomSheetScrollView, not ScrollView. @gorhom/bottom-sheet drives
           * the sheet from a pan gesture, and it only yields a vertical drag to
           * inner content that registers with it. A plain RN ScrollView never
           * does, so the sheet swallowed every drag and the filter list could
           * not be scrolled at all — the Apply button was unreachable on any
           * tenant with more than a screenful of tags.
           */
          <BottomSheetScrollView
            style={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            {fields.map(field => (
              <View key={field.key} style={styles.field}>
                <Text style={styles.fieldLabel}>{field.label}</Text>
                {renderControl(field)}
              </View>
            ))}
          </BottomSheetScrollView>
        )}
        <View style={styles.footer}>
          <View style={styles.footerButton}>
            <Button
              label={t('calls.filters.clear')}
              variant="secondary"
              onPress={handleClear}
            />
          </View>
          <View style={styles.footerButton}>
            <Button label={t('calls.filters.apply')} onPress={handleApply} />
          </View>
        </View>
      </View>
    </BottomSheet>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: '20@ms',
    paddingBottom: '16@ms',
  },
  title: {
    ...typography.label.large,
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    color: colors.ds.typography.highEmphasis,
    marginBottom: '12@ms',
  },
  scroll: {
    flex: 1,
  },
  empty: {
    ...typography.body.medium,
    color: colors.ds.typography.mediumEmphasis,
    paddingVertical: '24@ms',
    textAlign: 'center',
  },
  field: {
    marginBottom: '20@ms',
  },
  fieldLabel: {
    ...typography.body.medium,
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    color: colors.ds.typography.highEmphasis,
    marginBottom: '8@ms',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: '8@ms',
  },
  chip: {
    paddingHorizontal: '12@ms',
    paddingVertical: '6@ms',
    borderRadius: '16@ms',
    borderWidth: 1,
    borderColor: colors.ds.stroke.primary,
  },
  chipSelected: {
    backgroundColor: colors.azureBlue,
    borderColor: colors.azureBlue,
  },
  chipText: {
    ...typography.body.small,
    color: colors.ds.typography.mediumEmphasis,
  },
  chipTextSelected: {
    color: colors.white,
  },
  rangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '8@ms',
  },
  rangeInput: {
    flex: 1,
  },
  rangeDash: {
    ...typography.body.medium,
    color: colors.ds.typography.mediumEmphasis,
  },
  footer: {
    flexDirection: 'row',
    gap: '12@ms',
    paddingTop: '12@ms',
  },
  footerButton: {
    flex: 1,
  },
});
