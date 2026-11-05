import React from 'react';
import {Image, Text, View} from 'react-native';
import {ms, ScaledSheet} from 'react-native-size-matters';

import {colors, fontFamily, radius, typography} from '@/theme';

type TextStyle = keyof typeof typography.body;

interface UserProfileImageProps {
  name?: string;
  profileImageUri?: string;
  size?: number;
  fallbackIcon?: React.ReactNode;
  textSize?: TextStyle;
  textPadding?: number;
}

export const UserProfileImage: React.FC<UserProfileImageProps> = ({
  name,
  profileImageUri,
  size = ms(16),
  fallbackIcon,
  textSize = 'medium',
  textPadding,
}) => {
  const initials = React.useMemo(() => {
    if (!name) return '';
    return name.trim().charAt(0).toUpperCase();
  }, [name]);

  const showImage = Boolean(profileImageUri);

  return (
    <View
      style={[
        styles.container,
        {width: size, height: size},
        {padding: ms(textPadding ?? 0)},
      ]}>
      {showImage ? (
        <Image
          source={{uri: profileImageUri}}
          style={[styles.image, {width: size, height: size}]}
          resizeMode="cover"
        />
      ) : fallbackIcon ? (
        fallbackIcon
      ) : (
        <Text style={[styles.initials, typography.body[textSize as TextStyle]]}>
          {initials}
        </Text>
      )}
    </View>
  );
};

const styles = ScaledSheet.create({
  container: {
    backgroundColor: colors.lightGray,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.lightGray17,
  },
  image: {
    borderRadius: radius.full,
  },
  initials: {
    ...fontFamily.IBM_PLEX_SERIF.MEDIUM,
    color: colors.black,
    textTransform: 'uppercase',
  },
});
