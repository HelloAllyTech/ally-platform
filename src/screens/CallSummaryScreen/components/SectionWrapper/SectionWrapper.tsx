import React, {memo, useEffect} from 'react';
import {View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {SECTION_LIST, SectionKey, summaryFields} from '@/constants';
import {useCallSummaryForm} from '@/hooks';
import {useEnhanceCallSummaryMutation} from '@/services/callSummaryApi';
import {useAppSelector} from '@/store/hooks';
import {selectCallInfo} from '@/store/slices/summarySlice';
import {colors, fontFamily} from '@/theme';
import {EditableFieldKey, SectionItem} from '@/types';

import {SectionHeader} from '../CallSummaryDetails/SectionHeader';
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
}: SectionWrapperProps) => {
  const {handleSectionFieldsReset, handleFieldChange, formData} =
    useCallSummaryForm();
  const {chatId} = useAppSelector(selectCallInfo);
  const [enhanceCallSummary, {isLoading: isEnhancing, data: enhancedResponse}] =
    useEnhanceCallSummaryMutation();

  useEffect(() => {
    if (enhancedResponse) {
      const field = summaryFields.find(
        _field => _field.sectionKey === sectionConfig.key,
      );
      if (field) {
        handleFieldChange(field.key)(enhancedResponse.enhanced_content);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enhancedResponse, sectionConfig.key]);

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
    handleSubmit();
  };

  const renderSection = () => {
    const sectionFields = summaryFields.filter(
      field => field.sectionKey === sectionConfig.key,
    );

    return (
      <GenericSectionContent
        fields={sectionFields}
        isEditing={isEditing}
        isEnhancing={isEnhancing}
      />
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
        canEdit={sectionConfig.canEdit}
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
