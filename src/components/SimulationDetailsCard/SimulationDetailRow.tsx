import {Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily, fontWeights, typography} from '@/theme';

interface SimulationDetailRowProps {
  label: string;
  value: string;
}
export const SimulationDetailRow = ({
  label,
  value,
}: SimulationDetailRowProps) => {
  return (
    <View style={styles.simulationDetailsTextContainer}>
      <Text
        style={[styles.simulationDetailsText, styles.simulationDetailsLabel]}>
        {label}
      </Text>
      <Text
        style={[styles.simulationDetailsText, styles.simulationDetailsValue]}>
        {value}
      </Text>
    </View>
  );
};

const styles = ScaledSheet.create({
  simulationDetailsText: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.small,
    fontWeight: fontWeights.regular,
    color: colors.ds.typography.mediumEmphasis,
  },
  simulationDetailsTextContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  simulationDetailsLabel: {
    width: '100@s',
  },
  simulationDetailsValue: {
    flex: 1,
  },
});
