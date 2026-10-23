import React from 'react';
import {Text, View} from 'react-native';
import {ms, ScaledSheet} from 'react-native-size-matters';
import {SvgProps} from 'react-native-svg';

import {colors, fontFamily} from '@/theme';

interface EmptyStateProps {
  icon?: React.ComponentType<SvgProps>;
  title: string;
  description?: string;
  iconProps?: SvgProps;
  containerStyle?: object;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon,
  title,
  description,
  iconProps = {width: ms(160), height: ms(130)},
  containerStyle,
}) => {
  return (
    <View style={[styles.container, containerStyle]}>
      {Icon && <Icon style={styles.icon} {...iconProps} />}
      <Text style={styles.title}>{title}</Text>
      {!!description && <Text style={styles.description}>{description}</Text>}
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    alignItems: 'center',
  },
  icon: {
    marginBottom: '28@ms',
  },
  title: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '20@ms',
    lineHeight: '24@ms',
    color: colors.darkGray2,
  },
  description: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '14@ms',
    lineHeight: '24@ms',
    color: colors.darkGray2,
    textAlign: 'center',
    marginTop: '16@vs',
  },
});
