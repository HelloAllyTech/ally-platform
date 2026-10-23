import React, {ReactNode} from 'react';
import {Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import commonStyles from '@/components/styles';
import {colors, fontFamily, typography} from '@/theme';

interface FieldRowProps {
  label: string;
  value: string | number | ReactNode; // Keep for backward compatibility
  showSeparator?: boolean;
  renderEdit?: () => ReactNode; // New: Optional render prop for edit mode
}

export const FieldRow: React.FC<FieldRowProps> = ({
  label,
  value,
  showSeparator = false,
  renderEdit,
}) => (
  <>
    <View style={styles.fieldContainer}>
      <Text style={styles.label}>{label}:</Text>
      {renderEdit ? (
        renderEdit() // Use custom edit renderer if provided
      ) : typeof value === 'string' || typeof value === 'number' ? (
        <Text style={[styles.value, commonStyles.fieldValueText]}>{value}</Text>
      ) : (
        value
      )}
    </View>
    {showSeparator && <View style={styles.separator} />}
  </>
);

const styles = ScaledSheet.create({
  fieldContainer: {
    flexDirection: 'row',
    marginBottom: '5@vs',
    alignItems: 'center',
  },
  label: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    ...typography.body.medium,
    color: colors.ds.typography.lowEmphasis,
    marginRight: '8@ms',
  },
  value: {
    flex: 1,
  },
  separator: {
    height: '1@vs',
    backgroundColor: colors.lightGray2,
    marginTop: '-3@vs',
    marginBottom: '8@vs',
  },
});
