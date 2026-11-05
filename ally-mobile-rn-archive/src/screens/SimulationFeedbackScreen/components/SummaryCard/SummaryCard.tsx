import React from 'react';
import {StyleProp, Text, View, ViewStyle} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily, typography} from '@/theme';

interface SummaryCardProps {
  title?: string;
  titleRight?: React.ReactNode;
  children: React.ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
}

export const SummaryCard: React.FC<SummaryCardProps> = ({
  title,
  titleRight,
  children,
  containerStyle,
}) => {
  return (
    <View style={[styles.container, containerStyle]}>
      {!!title && (
        <View style={styles.titleRow}>
          <Text style={styles.title}>{title}</Text>
          {!!titleRight && titleRight}
        </View>
      )}
      {children}
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    flex: 1,
    marginVertical: '10@vs',
    marginHorizontal: '10@ms',
    borderWidth: '0.5@ms',
    borderColor: colors.ds.stroke.primary,
    padding: '16@ms',
    borderRadius: '8@ms',
    backgroundColor: colors.white,
    shadowColor: colors.ds.grey[900],
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8@ms',
    marginBottom: '16@vs',
    borderBottomWidth: '0.5@ms',
    borderBottomColor: colors.ds.stroke.primary,
    paddingBottom: '14@vs',
  },
  title: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    ...typography.body.medium,
    fontSize: '14@ms',
    color: colors.ds.typography.highEmphasis,
    letterSpacing: '0.25@ms',
    flexShrink: 1,
  },
});
