import React, {useCallback, useState} from 'react';
import {Modal, Text, TouchableOpacity, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {CustomDropdown} from '@/components';
import {SummaryFieldKey} from '@/constants/summary';
import {useTranslate} from '@/hooks/useTranslate';
import {colors, fontFamily, typography} from '@/theme';
import {
  formatCustomFieldDate,
  normalizeCustomFieldDate,
} from '@/utils/customFieldDate';

import {
  CustomFieldDefinition,
  CustomFieldEditPermission,
  CustomFieldType,
} from '../../../../services/customFieldsApi';
import {EditableField} from '../EditableField/EditableField';
import {FieldRow} from '../FieldRow/FieldRow';

interface CustomFieldsSectionProps {
  definitions: CustomFieldDefinition[];
  localValues: Record<string, string | null>;
  onValueChange: (fieldDefinitionId: string, value: string | null) => void;
  isEditing: boolean;
  sectionKey: string;
  isAdmin?: boolean;
  isCounsellorForCall?: boolean;
}

const parseMultiSelectValue = (value: string | null): string[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [value];
  } catch {
    return value ? [value] : [];
  }
};

const formatMultiSelectForDisplay = (value: string | null): string => {
  const selected = parseMultiSelectValue(value);
  return selected.length ? selected.join(', ') : '-';
};

interface MultiSelectModalProps {
  options: string[];
  selected: string[];
  onDone: (values: string[]) => void;
  onClose: () => void;
}

const MultiSelectModal: React.FC<MultiSelectModalProps> = ({
  options,
  selected,
  onDone,
  onClose,
}) => {
  const {t} = useTranslate();
  const [localSelected, setLocalSelected] = useState<string[]>(selected);

  const toggle = (option: string) => {
    setLocalSelected(prev =>
      prev.includes(option)
        ? prev.filter(o => o !== option)
        : [...prev, option],
    );
  };

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity
        style={styles.modalOverlay}
        activeOpacity={1}
        onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={styles.modalContent}>
          {options.map(option => (
            <TouchableOpacity
              key={option}
              style={styles.multiOption}
              onPress={() => toggle(option)}>
              <View
                style={[
                  styles.checkbox,
                  localSelected.includes(option) && styles.checkboxSelected,
                ]}
              />
              <Text style={styles.multiOptionText}>{option}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={styles.doneButton}
            onPress={() => {
              onDone(localSelected);
              onClose();
            }}>
            <Text style={styles.doneButtonText}>{t('common.done')}</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};

export const CustomFieldsSection: React.FC<CustomFieldsSectionProps> = ({
  definitions,
  localValues,
  onValueChange,
  isEditing,
  sectionKey,
  isAdmin = false,
  isCounsellorForCall = false,
}) => {
  const {t} = useTranslate();
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [multiSelectOpen, setMultiSelectOpen] = useState<string | null>(null);

  const sectionDefs = definitions.filter(d => d.sectionKey === sectionKey);

  const canEditField = useCallback(
    (def: CustomFieldDefinition) => {
      if (def.editPermission === CustomFieldEditPermission.BOTH) return true;
      if (def.editPermission === CustomFieldEditPermission.ADMIN_ONLY)
        return isAdmin;
      if (def.editPermission === CustomFieldEditPermission.COUNSELLOR_ONLY)
        return isCounsellorForCall;
      return false;
    },
    [isAdmin, isCounsellorForCall],
  );

  if (sectionDefs.length === 0) return null;

  return (
    <>
      {sectionDefs.map(def => {
        const value = localValues[def.id] ?? null;
        const fieldIsEditable = canEditField(def);

        switch (def.fieldType) {
          case CustomFieldType.TEXT:
            return (
              <FieldRow
                key={def.id}
                label={def.name}
                value={value ?? '-'}
                renderEdit={
                  isEditing && fieldIsEditable
                    ? () => (
                        <View style={styles.editFieldContainer}>
                          <EditableField
                            fieldKey={def.id as SummaryFieldKey}
                            label={def.name}
                            value={value}
                            onChangeText={text =>
                              onValueChange(def.id, text || null)
                            }
                            canEdit={fieldIsEditable}
                            isEditing={isEditing}
                            isEnhancing={false}
                            placeholder="-"
                          />
                        </View>
                      )
                    : undefined
                }
              />
            );

          case CustomFieldType.NUMBER:
            // Wrap in FieldRow so the field name is always shown, but keep a
            // real, wired input via renderEdit — a previous static <Text>
            // meant typed numbers never reached onValueChange, so the edit
            // never saved and the field appeared to revert to the old value.
            return (
              <FieldRow
                key={def.id}
                label={def.name}
                value={value ?? '-'}
                renderEdit={
                  isEditing && fieldIsEditable
                    ? () => (
                        <View style={styles.editFieldContainer}>
                          <EditableField
                            fieldKey={def.id as SummaryFieldKey}
                            label={def.name}
                            value={value}
                            onChangeText={text =>
                              onValueChange(def.id, text || null)
                            }
                            canEdit={fieldIsEditable}
                            isEditing={isEditing}
                            isEnhancing={false}
                            placeholder="-"
                            keyboardType="numeric"
                          />
                        </View>
                      )
                    : undefined
                }
              />
            );

          case CustomFieldType.SINGLE_SELECT: {
            const options = (def.options ?? [])
              .sort((a, b) => a.order - b.order)
              .map(o => o.label);
            return (
              <FieldRow
                key={def.id}
                label={def.name}
                value={value ?? '-'}
                renderEdit={
                  isEditing && fieldIsEditable
                    ? () => (
                        <View style={styles.dropdownContainer}>
                          <CustomDropdown
                            value={value ?? ''}
                            options={options}
                            onSelect={v => {
                              onValueChange(def.id, v);
                              setOpenDropdown(null);
                            }}
                            isOpen={openDropdown === def.id}
                            setIsOpen={open =>
                              setOpenDropdown(open ? def.id : null)
                            }
                            placeholder={t('common.select')}
                            modalTranslateX="-50%"
                          />
                        </View>
                      )
                    : undefined
                }
              />
            );
          }

          case CustomFieldType.BOOLEAN: {
            const yesLabel = t('common.yes');
            const noLabel = t('common.no');
            const boolOptions = [yesLabel, noLabel];
            const boolDisplay =
              value === 'true'
                ? yesLabel
                : value === 'false'
                  ? noLabel
                  : (value ?? '-');
            return (
              <FieldRow
                key={def.id}
                label={def.name}
                value={boolDisplay}
                renderEdit={
                  isEditing && fieldIsEditable
                    ? () => (
                        <View style={styles.dropdownContainer}>
                          <CustomDropdown
                            value={boolDisplay === '-' ? '' : boolDisplay}
                            options={boolOptions}
                            onSelect={v => {
                              onValueChange(
                                def.id,
                                v === yesLabel ? 'true' : 'false',
                              );
                              setOpenDropdown(null);
                            }}
                            isOpen={openDropdown === def.id}
                            setIsOpen={open =>
                              setOpenDropdown(open ? def.id : null)
                            }
                            placeholder={t('common.select')}
                            modalTranslateX="-50%"
                          />
                        </View>
                      )
                    : undefined
                }
              />
            );
          }

          case CustomFieldType.DATE:
            // A DATE value is a calendar date stored as YYYY-MM-DD. Values
            // written by the old web build are full ISO instants at local
            // midnight, i.e. 18:30 the previous day in UTC — rendering those
            // raw is what showed the day before the one the user picked, so
            // they are resolved back to the org calendar date here.
            return (
              <FieldRow
                key={def.id}
                label={def.name}
                value={formatCustomFieldDate(value)}
                renderEdit={
                  isEditing && fieldIsEditable
                    ? () => (
                        <View style={styles.editFieldContainer}>
                          <EditableField
                            fieldKey={def.id as SummaryFieldKey}
                            label={def.name}
                            value={normalizeCustomFieldDate(value) ?? value}
                            onChangeText={text =>
                              onValueChange(def.id, text || null)
                            }
                            canEdit={fieldIsEditable}
                            isEditing={isEditing}
                            isEnhancing={false}
                            placeholder="YYYY-MM-DD"
                          />
                        </View>
                      )
                    : undefined
                }
              />
            );

          case CustomFieldType.MULTI_SELECT: {
            const multiOptions = (def.options ?? [])
              .sort((a, b) => a.order - b.order)
              .map(o => o.label);
            const displayValue = formatMultiSelectForDisplay(value);
            const selectedArr = parseMultiSelectValue(value);
            return (
              <React.Fragment key={def.id}>
                <FieldRow
                  label={def.name}
                  value={displayValue}
                  renderEdit={
                    isEditing && fieldIsEditable
                      ? () => (
                          <TouchableOpacity
                            onPress={() => setMultiSelectOpen(def.id)}
                            style={styles.multiSelectTrigger}>
                            <Text style={styles.multiSelectValue}>
                              {displayValue}
                            </Text>
                          </TouchableOpacity>
                        )
                      : undefined
                  }
                />
                {multiSelectOpen === def.id && (
                  <MultiSelectModal
                    options={multiOptions}
                    selected={selectedArr}
                    onDone={values => {
                      onValueChange(
                        def.id,
                        values.length ? JSON.stringify(values) : null,
                      );
                    }}
                    onClose={() => setMultiSelectOpen(null)}
                  />
                )}
              </React.Fragment>
            );
          }

          default:
            return (
              <FieldRow key={def.id} label={def.name} value={value ?? '-'} />
            );
        }
      })}
    </>
  );
};

const styles = ScaledSheet.create({
  dropdownContainer: {
    flex: 1,
    maxWidth: '200@ms',
  },
  editFieldContainer: {
    flex: 1,
  },
  multiSelectTrigger: {
    flex: 1,
  },
  multiSelectValue: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.typography.highEmphasis,
    flex: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: colors.white,
    borderRadius: '12@ms',
    padding: '16@ms',
    width: '80%',
    maxHeight: '400@ms',
  },
  multiOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: '10@ms',
    borderBottomWidth: 0.5,
    borderBottomColor: colors.lightGray5,
  },
  checkbox: {
    width: '18@ms',
    height: '18@ms',
    borderRadius: '4@ms',
    borderWidth: 1.5,
    borderColor: colors.gray,
    marginRight: '10@ms',
  },
  checkboxSelected: {
    backgroundColor: colors.darkSlate,
    borderColor: colors.darkSlate,
  },
  multiOptionText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.typography.highEmphasis,
  },
  doneButton: {
    marginTop: '12@ms',
    alignSelf: 'flex-end',
    paddingHorizontal: '16@ms',
    paddingVertical: '8@ms',
    backgroundColor: colors.darkSlate,
    borderRadius: '8@ms',
  },
  doneButtonText: {
    ...typography.label.medium,
    color: colors.white,
  },
});
