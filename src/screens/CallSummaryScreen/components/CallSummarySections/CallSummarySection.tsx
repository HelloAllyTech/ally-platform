import {useState} from 'react';
import {View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';
import {SvgProps} from 'react-native-svg';

import {SECTION_LIST, SectionKey, SummaryFieldKey} from '@/constants/summary';
import {CallSummaryResponse} from '@/services/callSummaryApi';
import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';
import {FormData} from '@/utils/callSummary/formDataTransformer';

import {SectionContent} from '../CallSummaryDetails/SectionContent';
import {SectionHeader} from '../CallSummaryDetails/SectionHeader';

interface CallSummarySectionProps {
  label: string;
  isExpanded: boolean;
  onToggle: () => void;
  icon: React.ReactNode;
  canEdit: boolean;
  formData: FormData;
  sectionData: {
    key: SectionKey;
    label: string;
    icon: React.FC<SvgProps>;
  };
  expanded: Record<SectionKey, any>;
  summaryDetails: CallSummaryResponse['details'];
  onFieldChange: (field: SummaryFieldKey) => (value: string) => void;
  index: number;
}

const CallSummarySection = ({
  label,
  isExpanded,
  onToggle,
  icon,
  canEdit,
  formData,
  sectionData,
  expanded,
  summaryDetails,
  onFieldChange,
  index,
}: CallSummarySectionProps) => {
  const [isEditing, setIsEditing] = useState(false);

  const renderSection = () => {
    return (
      <SectionContent
        section={sectionData}
        formData={formData}
        summaryDetails={summaryDetails}
        onFieldChange={onFieldChange}
        canEdit={canEdit}
        isEditing={isEditing}
        setIsEditing={setIsEditing}
      />
    );
  };

  return (
    <View
      style={[
        isEditing
          ? styles.sectionBoxEditing
          : index !== SECTION_LIST.length - 1 && styles.sectionBox,
      ]}>
      <SectionHeader
        label={label}
        isExpanded={isExpanded}
        onToggle={onToggle}
        icon={icon}
        canEdit={canEdit}
        isEditing={isEditing}
        setIsEditing={setIsEditing}
      />
      {isExpanded && expanded[sectionData.key] && (
        <View style={styles.sectionContent}>{renderSection()}</View>
      )}
    </View>
  );
};

export default CallSummarySection;

const styles = ScaledSheet.create({
  sectionBox: {
    borderBottomColor: colors.lightGray5,
    borderBottomWidth: 0.5,
    overflow: 'hidden',
  },
  sectionBoxEditing: {
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
