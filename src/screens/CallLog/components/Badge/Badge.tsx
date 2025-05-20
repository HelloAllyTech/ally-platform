import React from 'react';
import {Text, View} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';

const Badge = ({children}: {children: React.ReactNode}) => (
  <View style={styles.badge}>
    <Text style={styles.badgeText}>{children}</Text>
  </View>
);

const styles = ScaledSheet.create({
  badge: {
    backgroundColor: colors.lightGray,
    minWidth: '50@ms',
    minHeight: '20@ms',
    borderRadius: '12@ms',
    marginLeft: '4@ms',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 0.4,
    borderColor: colors.gray99,
  },
  badgeText: {
    color: colors.gray99,
    fontSize: '12@ms',
    fontWeight: '400',
    ...fontFamily.REPLAY_PRO.HEADLINE,
  },
});

export default Badge;
