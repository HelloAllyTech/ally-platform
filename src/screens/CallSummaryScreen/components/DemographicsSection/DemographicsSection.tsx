import React from 'react';
import {Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';

interface DemographicsSectionProps {
  demographics: {
    callerId?: string;
    age?: number;
    gender?: string;
    profession?: string;
    concernCode?: string;
    diagnosis?: string;
  };
}

export const DemographicsSection: React.FC<DemographicsSectionProps> = ({
  demographics,
}) => {
  return (
    <View style={styles.container}>
      <Text style={styles.detailText}>
        Caller ID:{' '}
        <Text style={styles.detailValue}>{demographics.callerId || '--'}</Text>
      </Text>
      <Text style={styles.detailText}>
        Age: <Text style={styles.detailValue}>{demographics.age || '--'}</Text>
      </Text>
      <Text style={styles.detailText}>
        Gender:{' '}
        <Text style={styles.detailValue}>{demographics.gender || '--'}</Text>
      </Text>
      <Text style={styles.detailText}>
        Profession:{' '}
        <Text style={styles.detailValue}>
          {demographics.profession || '--'}
        </Text>
      </Text>
      <Text style={styles.detailText}>
        Concern code:{' '}
        <Text style={styles.detailValue}>
          {demographics.concernCode || '--'}
        </Text>
      </Text>
      <Text style={styles.detailText}>
        Formal diagnosis:{' '}
        <Text style={styles.detailValue}>{demographics.diagnosis || '--'}</Text>
      </Text>
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    paddingTop: '4@ms',
    paddingBottom: '6@ms',
  },
  detailText: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    color: colors.darkSlate,
    lineHeight: '26@ms',
  },
  detailValue: {
    fontWeight: '500',
    color: colors.lightGray3,
  },
});
