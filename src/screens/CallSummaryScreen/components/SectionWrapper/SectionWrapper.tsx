import {View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';
import {SvgProps} from 'react-native-svg';

import {SECTION_LIST, SectionKey} from '@/constants/summary';
import {useCallSummaryForm} from '@/hooks/useCallSummaryForm';
import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';

import {SectionContent} from '../CallSummaryDetails/SectionContent';
import {SectionHeader} from '../CallSummaryDetails/SectionHeader';

interface SectionWrapperProps {
  label: string;
  isExpanded: boolean;
  onToggle: () => void;
  icon: React.ReactNode;
  canEdit: boolean;
  sectionConfig: {
    key: SectionKey;
    label: string;
    icon: React.FC<SvgProps>;
  };
  expanded: Record<SectionKey, any>;
  index: number;
  handleSubmit: () => void;
  isEditing: boolean;
  setIsEditing: React.Dispatch<
    React.SetStateAction<Record<SectionKey, boolean>>
  >;
}

const SectionWrapper = ({
  label,
  isExpanded,
  onToggle,
  icon,
  canEdit,
  sectionConfig,
  expanded,
  index,
  handleSubmit,
  isEditing,
  setIsEditing,
}: SectionWrapperProps) => {
  const {handleSectionFieldsReset} = useCallSummaryForm();

  const onPressWand = () => {
    setIsEditing(prev => ({
      ...prev,
      [sectionConfig.key]: false,
    }));
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
    return (
      <SectionContent
        section={sectionConfig}
        canEdit={canEdit}
        isEditing={isEditing}
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
        canEdit={canEdit}
        isEditing={isEditing}
        onTickPress={onTickPress}
        onClosePress={onClosePress}
        onEditPress={onEditPress}
        onPressWand={onPressWand}
      />
      {isExpanded && expanded[sectionConfig.key] && (
        <View style={styles.sectionContent}>{renderSection()}</View>
      )}
    </View>
  );
};

export default SectionWrapper;

const styles = ScaledSheet.create({
  sectionBox: {
    marginTop: '8@ms',
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
