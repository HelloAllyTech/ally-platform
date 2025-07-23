import React from 'react';
import {
  Image,
  ImageSourcePropType,
  StyleProp,
  Text,
  TouchableOpacity,
  ViewStyle,
} from 'react-native';
import {ScaledSheet} from 'react-native-size-matters';

import {colors} from '@/theme/colors';
import {fontFamily} from '@/theme/fonts';

interface StartCallCardProps {
  image: ImageSourcePropType | undefined;
  header: string;
  subtitle: string;
  onPressCard: () => void;
  customStyles?: StyleProp<ViewStyle>;
}

const StartCallCard: React.FC<StartCallCardProps> = ({
  image,
  header,
  subtitle,
  onPressCard,
  customStyles,
}) => {
  return (
    <TouchableOpacity
      style={[styles.card, customStyles]}
      onPress={onPressCard}
      activeOpacity={1}>
      <Text style={styles.header}>{header}</Text>
      <Text style={styles.subtitle}>
        {subtitle}
        <Text style={styles.arrow}>→</Text>
      </Text>
      <Image source={image} style={styles.image} />
    </TouchableOpacity>
  );
};

const styles = ScaledSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: '8@ms',
    padding: '12@ms',
    shadowColor: colors.black,
    shadowOffset: {width: 0, height: 8},
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 2,
    width: '49%',
    borderWidth: 0.35,
    borderColor: colors.darkGray13,
  },
  arrowIcon: {
    marginLeft: '4@ms',
    marginTop: '2@ms',
  },
  header: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    fontSize: '14@ms',
    color: colors.black,
    marginBottom: '4@vs',
  },
  subtitle: {
    ...fontFamily.IBM_PLEX_SERIF.REGULAR,
    fontSize: '12@ms',
    color: colors.gray99,
    lineHeight: '16@mvs',
  },
  image: {
    width: '100@ms',
    height: '100@mvs',
    marginTop: '8@vs',
    alignSelf: 'center',
  },
  arrow: {
    marginLeft: '4@ms',
    color: colors.black,
    fontSize: '14@ms',
    lineHeight: 0,
  },
  subtitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
});

export default StartCallCard;
