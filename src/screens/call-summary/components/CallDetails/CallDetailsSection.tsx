import React from 'react';
import {Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';

interface CallDetailsSectionProps {
  callDetails: {
    date: string;
    time: string;
    type: string;
    counsellor: string;
  };
}

export const CallDetailsSection: React.FC<CallDetailsSectionProps> = ({
  callDetails,
}) => {
  return (
    <View style={styles.container}>
      <Text style={styles.detailText}>
        Date: <Text style={styles.detailValue}>{callDetails.date}</Text>
      </Text>
      <Text style={styles.detailText}>
        Time: <Text style={styles.detailValue}>{callDetails.time}</Text>
      </Text>
      <Text style={styles.detailText}>
        Call Type: <Text style={styles.detailValue}>{callDetails.type}</Text>
      </Text>
      <Text style={styles.detailText}>
        Counsellor:{' '}
        <Text style={styles.detailValue}>{callDetails.counsellor}</Text>
      </Text>
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    paddingTop: '8@ms',
    paddingBottom: '6@ms',
  },
  detailText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    color: colors.darkSlate,
    lineHeight: '26@ms',
  },
  detailValue: {
    color: colors.lightGray3,
  },
});
