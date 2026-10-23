import React, {memo, useEffect} from 'react';
import {useTranslation} from 'react-i18next';
import {View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {useToast} from '@/components';
import {
  ALWAYS_VISIBLE_SECTIONS,
  SECTION_LIST,
  SectionKey,
  summaryFields,
  USER_PERMISSIONS,
} from '@/constants';
import {useCallSummaryForm} from '@/hooks';
import {useEnhanceCallSummaryMutation} from '@/services/callSummaryApi';
import {
  CustomFieldDefinition,
  CustomFieldValue,
} from '@/services/customFieldsApi';
import {useAppSelector} from '@/store/hooks';
import {
  selectCallInfo,
  selectSummaryVisibleFields,
} from '@/store/slices/summarySlice';
import {colors, fontFamily} from '@/theme';
import {EditableFieldKey, SectionItem} from '@/types';

import {SectionHeader} from '../CallSummaryDetails/SectionHeader';
import {CustomFieldsSection} from '../CustomFieldsSection/CustomFieldsSection';
import {GenericSectionContent} from '../GenericSectionContent';

interface SectionWrapperProps {
  label: string;
  isExpanded: boolean;
  onToggle: () => void;
  icon: React.ReactNode;
  sectionConfig: SectionItem;
  index: number;
  handleSubmit: () => void;
  isEditing: boolean;
  setIsEditing: React.Dispatch<
    React.SetStateAction<Record<SectionKey, boolean>>
  >;
  customFieldDefs?: CustomFieldDefinition[];
  customFieldValues?: CustomFieldValue[];
  customFieldLocalValues?: Record<string, string | null>;
  onCustomFieldChange?: (
    fieldDefinitionId: string,
    value: string | null,
  ) => void;
  onCustomFieldSave?: (sectionKey: string) => Promise<void>;
}

const SectionWrapperComponent = ({
  label,
  isExpanded,
  onToggle,
  icon,
  sectionConfig,
  index,
  handleSubmit,
  isEditing,
  setIsEditing,
  customFieldDefs,
  customFieldLocalValues,
  onCustomFieldChange,
  onCustomFieldSave,
}: SectionWrapperProps) => {
  const {t} = useTranslation();
  const {showToast} = useToast();
  const {handleSectionFieldsReset, handleFieldChange, formData} =
    useCallSummaryForm();
  const {chatId, counselorId} = useAppSelector(selectCallInfo);
  const visibleFields = useAppSelector(selectSummaryVisibleFields);
  const permissions = useAppSelector(state => state.user.permissions);
  const currentUserId = useAppSelector(state => state.user.user?.id);
  const isAdmin =
    permissions?.includes(USER_PERMISSIONS.MANAGE_CUSTOM_FIELD_DEFINITIONS) ??
    false;
  const isCounsellorForCall =
    counselorId !== undefined && counselorId === currentUserId;
  const [
    enhanceCallSummary,
    {isLoading: isEnhancing, data: enhancedResponse, error: enhanceError},
  ] = useEnhanceCallSummaryMutation();

  useEffect(() => {
    // Guard on the CONTENT, not on the response object. A failed enhance used
    // to arrive here as a truthy `{}` (the backend answered 200 with an empty
    // body) and wrote `undefined` straight into the field — the wand wiped the
    // counsellor's text instead of enhancing it.
    if (!enhancedResponse?.enhanced_content) {
      return;
    }
    const field = summaryFields.find(
      _field => _field.sectionKey === sectionConfig.key,
    );
    if (field) {
      handleFieldChange(field.key)(enhancedResponse.enhanced_content);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enhancedResponse, sectionConfig.key]);

  useEffect(() => {
    // Either a real error status or a 200 that carried no enhancement: both are
    // dead ends the counsellor has to be told about, or the wand just looks
    // broken.
    const enhanceReturnedNothing =
      enhancedResponse !== undefined && !enhancedResponse?.enhanced_content;
    if (enhanceError || enhanceReturnedNothing) {
      showToast(t('summary.enhanceFailed'), 'error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enhanceError, enhancedResponse]);

  const onWandPress = () => {
    if (!chatId) return;
    const field = summaryFields.find(
      _field => _field.sectionKey === sectionConfig.key,
    );
    if (!field?.key || !field?.isEditable) return;
    const content = formData?.[field.key as EditableFieldKey];
    if (!content) return;
    enhanceCallSummary({content});
  };

  const onEditPress = () => {
    setIsEditing(prev => ({
      ...prev,
      [sectionConfig.key]: true,
    }));
  };

  const onClosePress = () => {
    setIsEditing(prev => ({
      ...prev,
      [sectionConfig.key]: false,
    }));
    handleSectionFieldsReset(sectionConfig.key);
  };

  const onTickPress = async () => {
    setIsEditing(prev => ({
      ...prev,
      [sectionConfig.key]: false,
    }));
    await handleSubmit();
    if (onCustomFieldSave) {
      await onCustomFieldSave(sectionConfig.key);
    }
  };

  const renderSection = () => {
    const sectionFields = summaryFields.filter(field => {
      // Filter by section
      if (field.sectionKey !== sectionConfig.key) {
        return false;
      }

      // Always show fields for always-visible sections
      if (ALWAYS_VISIBLE_SECTIONS.includes(sectionConfig.key)) {
        return true;
      }

      // If visibleFields is empty or not set, show all fields
      if (!visibleFields || visibleFields.length === 0) {
        return true;
      }

      // Otherwise, only show fields that are in visibleFields
      return visibleFields.includes(field.key);
    });

    return (
      <>
        <GenericSectionContent
          fields={sectionFields}
          isEditing={isEditing}
          isEnhancing={isEnhancing}
        />
        {customFieldDefs && customFieldLocalValues && onCustomFieldChange && (
          <CustomFieldsSection
            definitions={customFieldDefs}
            localValues={customFieldLocalValues}
            onValueChange={onCustomFieldChange}
            isEditing={isEditing}
            sectionKey={sectionConfig.key}
            isAdmin={isAdmin}
            isCounsellorForCall={isCounsellorForCall}
          />
        )}
      </>
    );
  };

  return (
    <View
      style={[
        isEditing && isExpanded
          ? styles.sectionBoxEditing
          : index !== SECTION_LIST.length - 1
            ? styles.sectionBox
            : null,
      ]}>
      <SectionHeader
        label={label}
        isExpanded={isExpanded}
        onToggle={onToggle}
        icon={icon}
        canEdit={sectionConfig.canEdit && (isAdmin || isCounsellorForCall)}
        canEnhance={sectionConfig.canEnhance}
        isEditing={isEditing}
        onTickPress={onTickPress}
        onClosePress={onClosePress}
        onEditPress={onEditPress}
        onWandPress={onWandPress}
      />
      {isExpanded && (
        <View style={styles.sectionContent}>{renderSection()}</View>
      )}
    </View>
  );
};

export const SectionWrapper = memo(SectionWrapperComponent);

const styles = ScaledSheet.create({
  sectionBox: {
    borderBottomColor: colors.lightGray5,
    borderBottomWidth: 0.5,
  },
  sectionBoxEditing: {
    marginTop: '8@ms',
    borderWidth: 0.5,
    borderColor: colors.gray,
    borderRadius: '16@ms',
  },
  sectionContent: {
    paddingLeft: '30@ms',
  },
  editableText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    lineHeight: '20@mvs',
    color: colors.black,
    marginBottom: '20@ms',
    marginRight: '20@ms',
  },
  label: {
    fontSize: '14@ms',
    fontWeight: 'bold',
    marginBottom: '5@ms',
  },
  displayText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    lineHeight: '20@mvs',
    color: colors.lightGray3,
    marginBottom: '20@ms',
  },
  textContent: {
    paddingBottom: '12@ms',
  },
});
